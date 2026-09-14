import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'test-only-not-a-real-password!';
const DOSE = {
  id: 'test-dose-1', productId: 'ritalin-ir', productName: 'Ritalin', formulation: 'Immediate-release tablet',
  strength: '10', quantity: '0.5', unit: 'tablet', amountMg: '5',
  administeredAt: '2026-09-12T23:30:00.000Z', timeZone: 'America/Los_Angeles', status: 'actual', note: 'Synthetic test only',
  ingredients: [{ name: 'methylphenidate hydrochloride', amountMg: '5', unit: 'mg' }],
};
const PROFILE = { name: 'Test A', timeZone: 'America/Los_Angeles', timeFormat: '24h', sleepEnabled: true, bedtime: '23:00', wakeTime: '07:00', weekendEnabled: false };
const RECEIPT = { id: 'synthetic-receipt', productId: 'ritalin-ir', productName: 'Ritalin', packageStrength: '10', strengthUnit: 'mg', unit: 'tablet', quantity: '50', receivedAt: '2026-09-12T08:00:00Z', timeZone: 'America/Los_Angeles', note: 'Synthetic opening balance only' };

test('planned confirmation preference persists across restart/export and rejects non-boolean writes and imports atomically', async t => {
  const dir=await mkdtemp(join(tmpdir(),'drug-planned-preference-')),dbPath=join(dir,'synthetic.sqlite');
  let service=await start(dbPath);const account=client(()=>service.url);
  t.after(async()=>{await service.stop();await rm(dir,{recursive:true,force:true});});
  await account.request('/api/auth/register','POST',{email:'planned-preference@example.test',password:PASSWORD});
  assert.equal((await account.request('/api/profile','PUT',{...PROFILE,plannedDoseConfirmation:false})).status,200);
  await service.stop();service=await start(dbPath);
  assert.equal((await account.request('/api/data')).data.profile.plannedDoseConfirmation,false);
  const backup=(await account.request('/api/export')).data;assert.equal(backup.data.profile.plannedDoseConfirmation,false);
  for(const value of [null,'false',0,1,[]]){
    const current=(await account.request('/api/data')).data.profile;
    assert.equal((await account.request('/api/profile','PUT',{...current,plannedDoseConfirmation:value})).status,400);
    const invalid=structuredClone(backup);invalid.data.profile.plannedDoseConfirmation=value;
    assert.equal((await account.request('/api/import','POST',{backup:invalid,mode:'replace'})).status,400);
    assert.equal((await account.request('/api/data')).data.profile.plannedDoseConfirmation,false);
  }
  const current=(await account.request('/api/data')).data.profile;
  assert.equal((await account.request('/api/profile','PUT',{...current,plannedDoseConfirmation:true})).status,200);
  assert.equal((await account.request('/api/data')).data.profile.plannedDoseConfirmation,true);
  assert.equal((await account.request('/api/import','POST',{backup,mode:'replace'})).status,200);
  assert.equal((await account.request('/api/data')).data.profile.plannedDoseConfirmation,false);
});

test('planned dose events persist independently of the clock and confirm under the same ID exactly once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drug-planned-api-')), dbPath = join(dir, 'synthetic.sqlite');
  let service = await start(dbPath);
  t.after(async () => { await service.stop(); await rm(dir, { recursive: true, force: true }); });
  const account = client(() => service.url);
  const registration = await account.request('/api/auth/register', 'POST', { email: 'planned-synthetic@example.test', password: PASSWORD });
  const headers = { 'X-Dose-Owner': registration.data.user.id };
  const future = { ...DOSE, id: 'future-planned', status: 'planned', administeredAt: '2099-09-13T12:00:00Z' };
  const overdue = { ...DOSE, id: 'past-planned', status: 'planned', administeredAt: '2020-09-13T12:00:00Z' };
  const first = await account.request(`/api/doses/${future.id}`, 'PUT', future, headers);
  const past = await account.request(`/api/doses/${overdue.id}`, 'PUT', overdue, headers);
  assert.equal(first.status, 200); assert.equal(past.status, 200);
  assert.equal((await account.request(`/api/doses/${future.id}`, 'PUT', future, headers)).data.revision, 1);
  await service.stop(); service = await start(dbPath);
  const restored = (await account.request('/api/data', 'GET', undefined, headers)).data.doses;
  assert.deepEqual(restored.map(d => [d.id, d.status, d.revision]).sort(), [['future-planned', 'planned', 1], ['past-planned', 'planned', 1]]);
  const confirmation = { ...past.data, status: 'actual' };
  const confirmed = await account.request(`/api/doses/${overdue.id}`, 'PUT', confirmation, headers);
  assert.equal(confirmed.status, 200); assert.equal(confirmed.data.revision, 2);
  const retried = await account.request(`/api/doses/${overdue.id}`, 'PUT', confirmation, headers);
  assert.equal(retried.data.revision, 2);
  const backup = (await account.request('/api/export', 'GET', undefined, headers)).data;
  assert.equal(backup.data.doses.length, 2);
  assert.equal(backup.data.doses.filter(d => d.status === 'actual').length, 1);
  assert.deepEqual(backup.revisions.filter(d => d.id === overdue.id).map(d => d.data.status), ['planned', 'actual']);
});

async function availablePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function start(dbPath) {
  const port = await availablePort();
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DOSE_DB_PATH: dbPath }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${logs}`)), 10000);
    child.stderr.on('data', (chunk) => { logs += chunk; });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${logs}`)); });
    child.stdout.on('data', (chunk) => {
      logs += chunk;
      if (logs.includes('Drug Tracker is running')) { clearTimeout(timeout); resolve(); }
    });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Server did not stop.')); }, 10000);
        child.once('exit', () => { clearTimeout(timeout); resolve(); });
      });
    },
  };
}

function client(getUrl) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async request(path, method = 'GET', body, headers = {}) {
      const response = await fetch(`${getUrl()}${path}`, {
        method,
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie !== null) cookie = setCookie.split(';')[0];
      const data = await response.json();
      return { status: response.status, headers: response.headers, data };
    },
  };
}

test('local API authentication, durable history, isolation, and conflict contract', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dose-timeline-api-'));
  const dbPath = join(dir, 'test.sqlite');
  let service = await start(dbPath);
  const a = client(() => service.url);
  const b = client(() => service.url);
  const anonymous = client(() => service.url);
  let recoveryCode;
  let dose;
  let profile;
  let bDose;
  let aOwner;
  let bOwner;
  let receipt;
  t.after(async () => { await service.stop(); await rm(dir, { recursive: true, force: true }); });

  await t.test('starts empty and rejects unauthenticated private access', async () => {
    assert.deepEqual((await anonymous.request('/api/session')).data, { user: null });
    for (const endpoint of ['/api/data', '/api/export']) assert.equal((await anonymous.request(endpoint)).status, 401);
    assert.equal((await anonymous.request('/api/doses/test-dose-1', 'PUT', DOSE)).status, 401);
  });

  await t.test('registers local accounts without seeding a health history', async () => {
    assert.equal((await a.request('/api/auth/register', 'POST', { email: 'a@example.test', password: 'short' })).status, 400);
    const registration = await a.request('/api/auth/register', 'POST', { email: 'A@example.test', name: 'Test A', password: PASSWORD });
    assert.equal(registration.status, 201);
    assert.equal(registration.data.user.email, 'a@example.test');
    recoveryCode = registration.data.recoveryCode;
    aOwner = registration.data.user.id;
    assert.match(recoveryCode, /^[A-Za-z0-9_-]{32}$/);
    assert.match(registration.headers.get('set-cookie'), /HttpOnly/);
    assert.match(registration.headers.get('set-cookie'), /SameSite=Strict/);
    assert.equal(registration.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await a.request('/api/data')).data, { profile: null, doses: [], scenarios: [], favorites: [], checkins: [], inventory: [] });
    const bRegistration = await b.request('/api/auth/register', 'POST', { email: 'b@example.test', password: PASSWORD });
    assert.equal(bRegistration.status, 201);
    bOwner = bRegistration.data.user.id;
    assert.equal((await anonymous.request('/api/auth/register', 'POST', { email: 'a@example.test', password: PASSWORD })).status, 409);
  });

  await t.test('expected-owner binding prevents cross-tab cookie changes from replaying into another account', async () => {
    assert.equal((await a.request('/api/data', 'GET', undefined, { 'X-Dose-Owner': aOwner })).status, 200);
    assert.equal((await a.request('/api/data', 'GET', undefined, { 'X-Dose-Owner': bOwner })).status, 401);
    assert.equal((await b.request('/api/export', 'GET', undefined, { 'X-Dose-Owner': aOwner })).status, 401);
    const pendingDose = { ...DOSE, id: 'cross-tab-pending' };
    // The browser's cookie now belongs to B, but an earlier A view/outbox still
    // identifies A as owner. The new ID must not be created under either user.
    assert.equal((await b.request('/api/doses/cross-tab-pending', 'PUT', pendingDose, { 'X-Dose-Owner': aOwner })).status, 401);
    assert.deepEqual((await a.request('/api/data')).data.doses, []);
    assert.deepEqual((await b.request('/api/data')).data.doses, []);
  });

  await t.test('validates quantities, UTC instants, zones, and unambiguous sleep schedules', async () => {
    for (const patch of [{ quantity: '0' }, { strength: '-10' }, { amountMg: 5 }, { quantity: '1e1' }, { timeZone: 'No/SuchPlace' }, { administeredAt: '2026-09-12T08:00' }, { administeredAt: '2026-02-30T08:00:00.000Z' }, { status: 'simulated' }, { removedAt: '2026-09-12T22:00:00.000Z' }, { removalAt: '2026-09-12T22:00:00.000Z' }, { removalAt: '2026-09-13T08:00' }]) {
      assert.equal((await a.request('/api/doses/test-dose-1', 'PUT', { ...DOSE, ...patch })).status, 400, JSON.stringify(patch));
    }
    assert.equal((await a.request('/api/profile', 'PUT', { ...PROFILE, wakeTime: '23:00' })).status, 400);
    assert.equal((await a.request('/api/profile', 'PUT', { ...PROFILE, timeFormat: '25h' })).status, 400);
    assert.equal((await a.request('/api/doses/test-dose-1', 'PUT', '{invalid')).status, 400);
    assert.equal((await a.request('/api/doses/test-dose-1', 'PUT', JSON.stringify(DOSE), { 'Content-Type': 'text/plain' })).status, 415);
  });

  await t.test('creates one idempotent dose and a persistent sleep profile', async () => {
    dose = (await a.request('/api/doses/test-dose-1', 'PUT', DOSE)).data;
    assert.equal(dose.revision, 1);
    const retry = await a.request('/api/doses/test-dose-1', 'PUT', { ...DOSE });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.data, dose);
    profile = (await a.request('/api/profile', 'PUT', PROFILE)).data;
    assert.equal(profile.revision, 1);
    const data = (await a.request('/api/data')).data;
    assert.equal(data.doses.length, 1);
    assert.equal(data.doses[0].quantity, '0.5');
    assert.equal(data.doses[0].amountMg, '5');
    assert.equal(data.profile.bedtime, '23:00');
  });

  await t.test('refuses concurrent conflicting changes and preserves immutable snapshots', async () => {
    const edited = await a.request('/api/doses/test-dose-1', 'PUT', { ...dose, quantity: '1', amountMg: '10', ingredients: [{ name: 'methylphenidate hydrochloride', amountMg: '10', unit: 'mg' }] });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.revision, 2);
    assert.equal((await a.request('/api/doses/test-dose-1', 'PUT', { ...dose, quantity: '2', amountMg: '20' })).status, 409);
    assert.equal((await a.request('/api/doses/test-dose-1', 'PUT', { ...edited.data, revision: 1 })).data.revision, 2);
    dose = edited.data;
    const backup = (await a.request('/api/export')).data;
    const revisions = backup.revisions.filter((row) => row.kind === 'doses' && row.id === DOSE.id);
    assert.deepEqual(revisions.map((row) => row.revision), [1, 2]);
    assert.equal(revisions[0].data.quantity, '0.5');
    assert.equal(revisions[0].data.ingredients[0].amountMg, '5');
  });

  await t.test('isolates all account-owned collections and direct guessed IDs', async () => {
    assert.deepEqual((await b.request('/api/data')).data.doses, []);
    assert.equal((await b.request('/api/doses/test-dose-1', 'PUT', dose)).status, 404);
    assert.equal((await b.request('/api/doses/test-dose-1', 'DELETE', { revision: dose.revision })).status, 404);
    for (const [kind, data] of [
      ['scenarios', { id: 'shared-scenario', name: 'Synthetic scenario', rows: [{ id: 'row-a', productId: 'ritalin-ir', administeredAt: '' }], modelVersions: { 'ritalin-ir': 'test-v1' }, version: 1 }],
      ['favorites', { id: 'shared-favorite', productId: 'ritalin-ir', strength: '10', quantity: '1' }],
      ['checkins', { id: 'shared-checkin', note: 'Synthetic observation', recordedAt: '2026-09-13T01:00:00Z', timeZone: 'America/Los_Angeles' }],
    ]) {
      const saved = await a.request(`/api/${kind}/${data.id}`, 'PUT', data);
      assert.equal(saved.status, 200);
      assert.equal((await b.request(`/api/${kind}/${data.id}`, 'PUT', data)).status, 404);
      assert.equal((await b.request(`/api/${kind}/${data.id}`, 'DELETE', { revision: 1 })).status, 404);
    }
    const bBackup = (await b.request('/api/export')).data;
    assert.deepEqual(bBackup.revisions, []);
    assert.deepEqual(bBackup.tombstones, []);
    assert.deepEqual(bBackup.data.scenarios, []);
    bDose = (await b.request('/api/doses/test-dose-b', 'PUT', { ...DOSE, id: 'test-dose-b' })).data;
    assert.equal(bDose.revision, 1);
  });

  await t.test('pins independent scenario rows and rejects duplicate row identities', async () => {
    const scenario = { id: 'invalid-scenario', name: 'Duplicate ids', rows: [{ id: 'x' }, { id: 'x' }] };
    assert.equal((await a.request('/api/scenarios/invalid-scenario', 'PUT', scenario)).status, 400);
    const snapshot = (await a.request('/api/data')).data;
    assert.equal(snapshot.scenarios[0].modelVersions['ritalin-ir'], 'test-v1');
    assert.equal(snapshot.doses.length, 1);
    assert.equal(snapshot.scenarios[0].rows[0].administeredAt, '');
  });

  await t.test('inventory receipts validate exact quantities, isolate owners, and retry without duplication', async () => {
    const invalid = await a.request('/api/inventory/invalid-receipt', 'PUT', { ...RECEIPT, id: 'invalid-receipt', quantity: '0' });
    assert.equal(invalid.status, 400);
    assert.equal((await a.request('/api/inventory/invalid-receipt', 'PUT', { ...RECEIPT, id: 'invalid-receipt', receivedAt: '2026-09-12T08:00' })).status, 400);
    receipt = (await a.request('/api/inventory/synthetic-receipt', 'PUT', RECEIPT)).data;
    assert.equal(receipt.revision, 1);
    assert.deepEqual((await a.request('/api/inventory/synthetic-receipt', 'PUT', RECEIPT)).data, receipt);
    assert.equal((await a.request('/api/data')).data.inventory.length, 1);
    assert.equal((await b.request('/api/inventory/synthetic-receipt', 'PUT', RECEIPT)).status, 404);
    assert.equal((await b.request('/api/inventory/synthetic-receipt', 'DELETE', { revision: 1 })).status, 404);
    assert.deepEqual((await b.request('/api/data')).data.inventory, []);
    receipt = (await a.request('/api/inventory/synthetic-receipt', 'PUT', { ...receipt, quantity: '49.5' })).data;
    assert.equal(receipt.revision, 2);
    assert.equal(receipt.quantity, '49.5');
    assert.equal((await a.request('/api/inventory/synthetic-receipt', 'PUT', { ...receipt, revision: 1, quantity: '48' })).status, 409);
    const versions = (await a.request('/api/export')).data.revisions.filter((row) => row.kind === 'inventory');
    assert.deepEqual(versions.map((row) => row.data.quantity), ['50', '49.5']);
  });

  await t.test('blocks cross-site, foreign Origin, DNS-rebinding Host, and excessive payloads', async () => {
    assert.equal((await a.request('/api/data', 'GET', undefined, { Origin: 'https://hostile.example' })).status, 403);
    assert.equal((await a.request('/api/data', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    // node:http is used here because fetch may normalize the Host header.
    const { request } = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      request(`${service.url}/api/session`, { headers: { Host: 'hostile.example' } }, (response) => { response.resume(); resolve(response.statusCode); }).on('error', reject).end();
    });
    assert.equal(status, 403);
    assert.equal((await a.request('/api/data', 'GET', undefined, { Origin: 'http://localhost:5173' })).status, 200);
    assert.equal((await a.request('/api/checkins/huge', 'PUT', { note: 'x'.repeat(1024 * 1024) })).status, 413);
    assert.equal((await a.request('/api/checkins/proto', 'PUT', '{"__proto__":{"admin":true}}')).status, 400);
  });

  await t.test('persists profile, exact dose snapshots, sessions, and revisions across a process restart', async () => {
    await service.stop();
    service = await start(dbPath);
    const restored = await a.request('/api/data');
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.data.doses, [dose]);
    assert.deepEqual(restored.data.profile, profile);
    assert.deepEqual(restored.data.inventory, [receipt]);
    assert.equal((await a.request('/api/export')).data.revisions.filter((row) => row.kind === 'doses').length, 2);
    const secondDevice = client(() => service.url);
    assert.equal((await secondDevice.request('/api/auth/login', 'POST', { email: 'a@example.test', password: PASSWORD })).status, 200);
    assert.deepEqual((await secondDevice.request('/api/data')).data.doses, [dose]);
    assert.equal((await b.request('/api/data')).data.doses[0].id, 'test-dose-b');
  });

  await t.test('keeps deletion tombstones and rejects old offline retries', async () => {
    assert.equal((await a.request('/api/doses/test-dose-1', 'DELETE', { revision: 1 })).status, 409);
    const removed = await a.request('/api/doses/test-dose-1', 'DELETE', { revision: 2 });
    assert.deepEqual(removed.data, { id: 'test-dose-1', revision: 3, deleted: true });
    assert.deepEqual((await a.request('/api/doses/test-dose-1', 'DELETE', { revision: 2 })).data, removed.data);
    assert.equal((await a.request('/api/doses/test-dose-1', 'PUT', DOSE)).status, 409);
    assert.equal((await a.request('/api/doses/not-an-id', 'DELETE', { revision: 1 })).status, 404);
    assert.deepEqual((await a.request('/api/data')).data.doses, []);
    const backup = (await a.request('/api/export')).data;
    assert.equal(backup.tombstones[0].id, DOSE.id);
    assert.equal(backup.revisions.filter((row) => row.kind === 'doses').length, 3);
    assert.equal(backup.revisions.find((row) => row.kind === 'doses' && row.revision === 3).deleted, true);
  });

  await t.test('logout and one-use recovery rotate secrets and revoke existing sessions', async () => {
    await a.request('/api/auth/logout', 'POST', {});
    assert.equal((await a.request('/api/data')).status, 401);
    assert.equal((await a.request('/api/auth/login', 'POST', { email: 'a@example.test', password: 'incorrect-password' })).status, 401);
    await a.request('/api/auth/login', 'POST', { email: 'a@example.test', password: PASSWORD });
    const reset = await anonymous.request('/api/auth/recover', 'POST', { email: 'a@example.test', recoveryCode, password: 'test-only-replacement-password!' });
    assert.equal(reset.status, 200);
    assert.notEqual(reset.data.recoveryCode, recoveryCode);
    assert.equal((await a.request('/api/data')).status, 401);
    assert.equal((await a.request('/api/auth/recover', 'POST', { email: 'a@example.test', recoveryCode, password: PASSWORD })).status, 401);
    assert.equal((await a.request('/api/auth/login', 'POST', { email: 'a@example.test', password: PASSWORD })).status, 401);
    assert.equal((await a.request('/api/auth/login', 'POST', { email: 'a@example.test', password: 'test-only-replacement-password!' })).status, 200);
    assert.equal((await a.request('/api/data')).data.profile.bedtime, '23:00');
  });

  await t.test('confirmed account deletion erases its live records, revisions, sessions, and tombstones only', async () => {
    assert.equal((await a.request('/api/account', 'DELETE', { password: 'incorrect-password' })).status, 401);
    assert.equal((await a.request('/api/account', 'DELETE', { password: 'test-only-replacement-password!' })).status, 200);
    assert.equal((await a.request('/api/data')).status, 401);
    assert.equal((await anonymous.request('/api/data')).status, 401);
    assert.equal((await a.request('/api/auth/login', 'POST', { email: 'a@example.test', password: 'test-only-replacement-password!' })).status, 401);
    assert.deepEqual((await b.request('/api/data')).data.doses, [bDose]);
    await service.stop();
    const db = new DatabaseSync(dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM entity_revisions WHERE entity_id = 'test-dose-1'").get().count, 0);
    const remaining = db.prepare('SELECT * FROM users').get();
    assert.match(remaining.password_hash, /^scrypt\$32768\$8\$1\$/);
    assert.notEqual(remaining.recovery_hash, recoveryCode);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 2);
    db.close();
    // Credential inputs are never stored in request logs or database payloads.
    const bytes = await readFile(dbPath);
    assert.equal(bytes.includes(Buffer.from(PASSWORD)), false);
  });
});

test('atomic backup import preserves full corrections, tombstones, and destination ownership', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dose-timeline-import-'));
  const service = await start(join(dir, 'test.sqlite'));
  const a = client(() => service.url);
  const b = client(() => service.url);
  t.after(async () => { await service.stop(); await rm(dir, { recursive: true, force: true }); });
  const registeredA = await a.request('/api/auth/register', 'POST', { email: 'source@example.test', password: PASSWORD });
  const registeredB = await b.request('/api/auth/register', 'POST', { email: 'restore@example.test', password: PASSWORD });
  const ownerB = registeredB.data.user.id;
  await a.request('/api/profile', 'PUT', PROFILE);
  await a.request('/api/doses/test-dose-1', 'PUT', DOSE);
  await a.request('/api/doses/test-dose-1', 'PUT', { ...DOSE, revision: 1, quantity: '1', amountMg: '10', ingredients: [{ name: 'methylphenidate hydrochloride', amountMg: '10', unit: 'mg' }] });
  await a.request('/api/doses/deleted-in-source', 'PUT', { ...DOSE, id: 'deleted-in-source' });
  await a.request('/api/doses/deleted-in-source', 'DELETE', { revision: 1 });
  await a.request('/api/inventory/synthetic-receipt', 'PUT', RECEIPT);
  const full = (await a.request('/api/export')).data;
  assert.equal(full.revisions.length, 6);
  const kept = (await b.request('/api/doses/keep-in-destination', 'PUT', { ...DOSE, id: 'keep-in-destination' })).data;

  await t.test('foreign-owned destination ID collisions reject the entire import', async () => {
    const result = await b.request('/api/import', 'POST', { backup: full, mode: 'replace' });
    assert.equal(result.status, 404);
    assert.deepEqual((await b.request('/api/data')).data.doses, [kept]);
    assert.equal((await b.request('/api/data')).data.profile, null);
    assert.equal((await a.request('/api/data')).data.doses[0].revision, 2);
  });

  // Simulate restoring a saved backup after its original account/database was
  // removed. Another existing user's records are never attached or overwritten.
  await a.request('/api/account', 'DELETE', { password: PASSWORD });

  await t.test('full restore maps the old profile owner and preserves every historical revision', async () => {
    const result = await b.request('/api/import', 'POST', { backup: full, mode: 'merge' }, { 'X-Dose-Owner': ownerB });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.imported, 4);
    assert.equal(result.data.skipped, 0);
    assert.equal(result.data.fullHistory, true);
    assert.equal(result.data.data.profile.id, ownerB);
    assert.notEqual(result.data.data.profile.id, full.data.profile.id);
    assert.equal(result.data.data.profile.bedtime, '23:00');
    const restored = result.data.data.doses.find((dose) => dose.id === DOSE.id);
    assert.deepEqual(restored, full.data.doses[0]);
    assert.deepEqual(result.data.data.inventory, full.data.inventory);
    const backup = (await b.request('/api/export')).data;
    assert.deepEqual(backup.revisions.filter((row) => row.kind === 'doses' && row.id !== kept.id), full.revisions.filter((row) => row.kind === 'doses'));
    assert.deepEqual(backup.tombstones, full.tombstones);
    assert.deepEqual(backup.revisions.filter((row) => row.kind === 'inventory'), full.revisions.filter((row) => row.kind === 'inventory'));
    const profileHistory = backup.revisions.find((row) => row.kind === 'profile');
    assert.equal(profileHistory.id, ownerB);
    assert.equal(profileHistory.data.id, ownerB);
    assert.equal((await b.request('/api/doses/deleted-in-source', 'PUT', { ...DOSE, id: 'deleted-in-source' })).status, 409);
  });

  await t.test('merge skips both owned live records and owned tombstones without rewriting revisions', async () => {
    const before = (await b.request('/api/export')).data;
    const result = await b.request('/api/import', 'POST', { backup: full, mode: 'merge' });
    assert.equal(result.status, 200);
    assert.equal(result.data.imported, 0);
    assert.equal(result.data.skipped, 4);
    const after = (await b.request('/api/export')).data;
    assert.deepEqual(after.revisions, before.revisions);
    assert.deepEqual(after.tombstones, before.tombstones);
    assert.deepEqual(after.data, before.data);
  });

  await t.test('malformed replace imports preserve all existing data and correction history', async () => {
    const before = (await b.request('/api/export')).data;
    const malformed = structuredClone(full);
    malformed.data.doses[0].quantity = '0';
    assert.equal((await b.request('/api/import', 'POST', { backup: malformed, mode: 'replace' })).status, 400);
    const missingRevision = structuredClone(full);
    missingRevision.revisions = missingRevision.revisions.filter((row) => !(row.kind === 'doses' && row.id === DOSE.id && row.revision === 1));
    assert.equal((await b.request('/api/import', 'POST', { backup: missingRevision, mode: 'replace' })).status, 400);
    const inconsistent = structuredClone(full);
    inconsistent.tombstones[0].revision = 99;
    assert.equal((await b.request('/api/import', 'POST', { backup: inconsistent, mode: 'replace' })).status, 400);
    const after = (await b.request('/api/export')).data;
    assert.deepEqual(after.data, before.data);
    assert.deepEqual(after.revisions, before.revisions);
    assert.deepEqual(after.tombstones, before.tombstones);
  });

  await t.test('explicit replace imports the complete archive and removes only the destination account data', async () => {
    const result = await b.request('/api/import', 'POST', { backup: full, mode: 'replace' });
    assert.equal(result.status, 200);
    assert.equal(result.data.imported, 4);
    assert.equal(result.data.skipped, 0);
    assert.deepEqual(result.data.data.doses, full.data.doses);
    const restored = (await b.request('/api/export')).data;
    assert.equal(restored.revisions.length, 6);
    assert.equal(restored.tombstones.length, 1);
    assert.equal(restored.revisions.some((row) => row.id === kept.id), false);
  });

  await t.test('current-data archives retain exact snapshots and create explicitly new correction histories', async () => {
    const current = { format: 'dose-timeline-backup', schemaVersion: 1, exportedAt: full.exportedAt, scope: 'current-data', data: structuredClone(full.data) };
    current.data.doses[0].id = 'current-data-import';
    const result = await b.request('/api/import', 'POST', { backup: current, mode: 'merge' });
    assert.equal(result.status, 200);
    assert.equal(result.data.fullHistory, false);
    assert.equal(result.data.imported, 1);
    assert.equal(result.data.skipped, 2);
    const dose = result.data.data.doses.find((dose) => dose.id === 'current-data-import');
    assert.equal(dose.quantity, full.data.doses[0].quantity);
    assert.equal(dose.administeredAt, full.data.doses[0].administeredAt);
    assert.equal(dose.createdAt, full.data.doses[0].createdAt);
    assert.equal(dose.revision, 1);
  });

  await t.test('a valid import above the ordinary 1 MiB request limit is accepted', async () => {
    const large = { format: 'dose-timeline-backup', schemaVersion: 1, exportedAt: full.exportedAt, scope: 'current-data', data: { profile: null, doses: [], scenarios: [], favorites: [], checkins: Array.from({ length: 150 }, (_, i) => ({ id: `large-checkin-${i}`, date: '2026-09-13', focus: '', sleepQuality: '', note: 'x'.repeat(7500) })) } };
    assert.ok(JSON.stringify(large).length > 1024 * 1024);
    const result = await b.request('/api/import', 'POST', { backup: large, mode: 'merge' });
    assert.equal(result.status, 200, result.data.error);
    assert.equal(result.data.imported, 150);
  });

  await t.test('an expected-owner mismatch prevents a destructive import before any write', async () => {
    const before = (await b.request('/api/data')).data;
    const result = await b.request('/api/import', 'POST', { backup: full, mode: 'replace' }, { 'X-Dose-Owner': registeredA.data.user.id });
    assert.equal(result.status, 401);
    assert.deepEqual((await b.request('/api/data')).data, before);
  });
});

test('profile increments and saved scenario views validate atomically with legacy backup compatibility', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dose-timeline-view-import-'));
  const service = await start(join(dir, 'test.sqlite'));
  const a = client(() => service.url);
  t.after(async () => { await service.stop(); await rm(dir, { recursive: true, force: true }); });
  await a.request('/api/auth/register', 'POST', { email: 'views@example.test', password: PASSWORD });
  const view = { date: '2024-02-29', days: 2, timeZone: 'America/Los_Angeles', publishedOnly: false };
  const scenario = { id: 'scenario-view-test', name: 'Synthetic view', doses: [], baseline: 'empty', modelVersion: 'fixture-v1' };
  const archive = (profile = PROFILE, savedScenario = scenario) => ({
    format: 'dose-timeline-backup', schemaVersion: 1, exportedAt: '2026-09-13T12:00:00Z', scope: 'current-data',
    data: { profile, doses: [], scenarios: [savedScenario], favorites: [], checkins: [] },
  });
  const keep = await a.request('/api/doses/keep-during-view-validation', 'PUT', { ...DOSE, id: 'keep-during-view-validation' });
  assert.equal(keep.status, 200);
  const before = (await a.request('/api/export')).data;
  for (const timeIncrementMinutes of [-1, 0, 2, 15, 5.5, '1', '5', null]) {
    const invalidProfile = { ...PROFILE, timeIncrementMinutes };
    assert.equal((await a.request('/api/profile', 'PUT', invalidProfile)).status, 400);
    assert.equal((await a.request('/api/import', 'POST', { backup: archive(invalidProfile), mode: 'replace' })).status, 400);
  }
  for (const invalidView of [null, [], {},
    { ...view, date: '2026-02-29' }, { ...view, date: '2026-02-30' }, { ...view, date: '2026-9-13' },
    { ...view, days: 0 }, { ...view, days: 4 }, { ...view, days: 1.5 }, { ...view, days: '2' },
    { ...view, timeZone: 'No/SuchZone' }, { ...view, timeZone: '+08:00' },
    { ...view, publishedOnly: 'false' }, { ...view, publishedOnly: undefined },
  ]) {
    const invalidScenario = { ...scenario, view: invalidView };
    assert.equal((await a.request(`/api/scenarios/${scenario.id}`, 'PUT', invalidScenario)).status, 400);
    assert.equal((await a.request('/api/import', 'POST', { backup: archive(PROFILE, invalidScenario), mode: 'replace' })).status, 400);
  }
  const after = (await a.request('/api/export')).data;
  assert.deepEqual(after.data, before.data);
  assert.deepEqual(after.revisions, before.revisions);
  for (const timeIncrementMinutes of [1, 5, 10]) for (const days of [1, 2, 3]) {
    const result = await a.request('/api/import', 'POST', { backup: archive({ ...PROFILE, timeIncrementMinutes }, { ...scenario, view: { ...view, days } }), mode: 'replace' });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.data.profile.timeIncrementMinutes, timeIncrementMinutes);
    assert.deepEqual(result.data.data.scenarios[0].view, { ...view, days });
  }
  for (const timeIncrementMinutes of [1, 5, 10]) {
    const current = (await a.request('/api/data')).data.profile;
    const saved = await a.request('/api/profile', 'PUT', { ...current, timeIncrementMinutes });
    assert.equal(saved.status, 200);
    assert.equal((await a.request('/api/data')).data.profile.timeIncrementMinutes, timeIncrementMinutes);
    assert.equal((await a.request('/api/export')).data.data.profile.timeIncrementMinutes, timeIncrementMinutes);
  }
  // Exported audit payloads are validated too, not only the live data preview.
  const full = (await a.request('/api/export')).data;
  const historyProfile = full.revisions.find(row => row.kind === 'profile');
  historyProfile.data.timeIncrementMinutes = 15;
  assert.equal((await a.request('/api/import', 'POST', { backup: full, mode: 'replace' })).status, 400);
  const legacy = await a.request('/api/import', 'POST', { backup: archive(), mode: 'replace' });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.data.data.profile.timeIncrementMinutes, undefined);
  assert.equal(legacy.data.data.scenarios[0].view, undefined);
});

test('inventory migration preserves an existing pre-inventory dose and its immutable revision', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dose-timeline-migration-'));
  const dbPath = join(dir, 'old.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;');
  db.exec(await readFile(join(ROOT, 'server/migrations/001_initial.sql'), 'utf8'));
  const time = '2026-09-12T08:00:00.000Z';
  const snapshot = JSON.stringify(DOSE);
  db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run('001_initial.sql', time);
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('legacy-owner', 'legacy@example.test', 'Synthetic legacy account', 'unusable-test-password-hash', 'unusable-recovery-hash', time);
  db.prepare('INSERT INTO entities VALUES (?,?,?,?,?,?,?,?)').run('doses', DOSE.id, 'legacy-owner', snapshot, 1, 0, time, time);
  db.prepare('INSERT INTO entity_revisions VALUES (?,?,?,?,?,?,?)').run('doses', DOSE.id, 'legacy-owner', 1, snapshot, 0, time);
  db.close();
  const service = await start(dbPath);
  t.after(async () => { await service.stop(); await rm(dir, { recursive: true, force: true }); });
  assert.equal((await client(() => service.url).request('/api/health')).data.schemaVersion, 2);
  await service.stop();
  const restored = new DatabaseSync(dbPath);
  assert.equal(restored.prepare('SELECT payload FROM entities WHERE id = ?').get(DOSE.id).payload, snapshot);
  assert.equal(restored.prepare('SELECT payload FROM entity_revisions WHERE entity_id = ?').get(DOSE.id).payload, snapshot);
  assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 2);
  assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(), []);
  restored.close();
});

test('concurrent server startup applies each database migration once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dose-timeline-startup-race-'));
  const dbPath = join(dir, 'shared-test.sqlite');
  const services = [];
  t.after(async () => {
    await Promise.all(services.map(service => service.stop()));
    await rm(dir, { recursive: true, force: true });
  });
  const starts = await Promise.allSettled(Array.from({ length: 3 }, () => start(dbPath)));
  for (const result of starts) if (result.status === 'fulfilled') services.push(result.value);
  assert.ok(starts.every(result => result.status === 'fulfilled'), starts.filter(result => result.status === 'rejected').map(result => result.reason.message).join('\n'));
  for (const service of services) {
    assert.equal((await client(() => service.url).request('/api/health')).data.schemaVersion, 2);
  }
  await Promise.all(services.map(service => service.stop()));
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('entities_next', 'entity_revisions_next')").get().count, 0);
  db.close();
});

test('symptom check-ins validate tags and original dates, retain corrections, and restore alongside legacy observations', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drug-tracker-symptoms-'));
  let service = await start(join(dir, 'test.sqlite'));
  const a = client(() => service.url), b = client(() => service.url);
  t.after(async () => { await service.stop(); await rm(dir, { recursive: true, force: true }); });
  await a.request('/api/auth/register', 'POST', { email: 'symptoms-a@example.test', password: PASSWORD });
  await b.request('/api/auth/register', 'POST', { email: 'symptoms-b@example.test', password: PASSWORD });
  const checkin = { id: 'symptom-headache', date: '2026-09-13', recordedAt: '2026-09-14T06:30:00Z', timeZone: 'America/Los_Angeles', symptoms: ['headache'], note: 'Synthetic observation only' };
  for (const patch of [
    { symptoms: [] }, { symptoms: ['none', 'headache'] }, { symptoms: ['headache', 'headache'] }, { symptoms: ['not-a-tag'] }, { symptoms: [1] },
    { symptoms: ['none', 'anxiety'] }, { symptoms: ['palpitations', 'none'] }, { symptoms: ['other', 'none'] },
    { symptoms: ['concentrated', 'none'] }, { symptoms: ['high-heart-rate', 'none'] }, { symptoms: ['refreshed', 'none'] }, { symptoms: ['refreshed', 'refreshed'] },
    { recordedAt: undefined }, { timeZone: undefined }, { date: undefined }, { date: '2026-09-14' },
    { recordedAt: '2026-02-30T08:00:00Z' }, { timeZone: 'No/SuchZone' },
  ]) assert.equal((await a.request('/api/checkins/symptom-headache', 'PUT', { ...checkin, ...patch })).status, 400, JSON.stringify(patch));
  assert.deepEqual((await a.request('/api/data')).data.checkins, []);
  const symptomIds = ['headache', 'low-appetite', 'nausea', 'dry-mouth', 'sleep-trouble', 'anxiety', 'palpitations', 'other', 'concentrated', 'high-heart-rate', 'refreshed', 'none'];
  for (const id of symptomIds) {
    const response = await a.request(`/api/checkins/symptom-${id}`, 'PUT', { ...checkin, id: `symptom-${id}`, symptoms: [id] });
    assert.equal(response.status, 200);
  }
  await service.stop(); service = await start(join(dir, 'test.sqlite'));
  const saved = (await a.request('/api/data')).data.checkins;
  assert.equal(saved.length, symptomIds.length, 'Same-day observations must remain distinct records after restart.');
  assert.deepEqual(saved.flatMap(row => row.symptoms).sort(), [...symptomIds].sort());
  assert.equal((await b.request('/api/checkins/symptom-headache', 'PUT', checkin)).status, 404);
  const corrected = { ...checkin, symptoms: ['nausea', 'dry-mouth'], revision: 1 };
  assert.equal((await a.request('/api/checkins/symptom-headache', 'PUT', corrected)).data.revision, 2);
  assert.equal((await a.request('/api/checkins/symptom-headache', 'PUT', corrected)).data.revision, 2);
  assert.equal((await a.request('/api/checkins/symptom-headache', 'DELETE', { revision: 2 })).data.revision, 3);
  assert.equal((await a.request('/api/checkins/symptom-headache', 'PUT', checkin)).status, 409);
  for (const legacy of [
    { id: 'legacy-date', date: '2026-09-13', focus: '3', sleepQuality: '4', note: '' },
    { id: 'legacy-time', recordedAt: checkin.recordedAt, timeZone: checkin.timeZone, note: 'Timestamp-only legacy observation' },
  ]) assert.equal((await a.request(`/api/checkins/${legacy.id}`, 'PUT', legacy)).status, 200);
  const backup = (await a.request('/api/export')).data;
  assert.deepEqual(backup.revisions.filter(row => row.id === checkin.id).map(row => row.data.symptoms), [['headache'], ['nausea', 'dry-mouth'], ['nausea', 'dry-mouth']]);
  await a.request('/api/account', 'DELETE', { password: PASSWORD });
  const restored = await b.request('/api/import', 'POST', { backup, mode: 'replace' });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.deepEqual(restored.data.data.checkins, backup.data.checkins);
  const exported = (await b.request('/api/export')).data;
  assert.deepEqual(exported.revisions, backup.revisions);
  assert.deepEqual(exported.tombstones, backup.tombstones);
  const bad = structuredClone(backup);
  bad.data.checkins.find(row => row.symptoms).symptoms = ['none', 'headache'];
  assert.equal((await b.request('/api/import', 'POST', { backup: bad, mode: 'replace' })).status, 400);
  assert.deepEqual((await b.request('/api/data')).data.checkins, backup.data.checkins);
});

test('favorite duplicates converge across repeated adds, legacy cleanup, deletion and backup restore without changing dose history', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drug-tracker-favorites-'));
  const dbPath = join(dir, 'test.sqlite');
  let service = await start(dbPath);
  const a = client(() => service.url), b = client(() => service.url);
  t.after(async () => { await service.stop(); await rm(dir, { recursive: true, force: true }); });
  const registration = await a.request('/api/auth/register', 'POST', { email: 'favorites-a@example.test', password: PASSWORD });
  await b.request('/api/auth/register', 'POST', { email: 'favorites-b@example.test', password: PASSWORD });
  const favorite = (id, strength = '10', quantity = '1') => ({ id, productId: 'ritalin', strength, packageStrength: strength, quantity });
  const canonical = (await a.request('/api/favorites/canonical', 'PUT', favorite('canonical'))).data;
  const duplicate = favorite('duplicate-request', '10.0', '0.5');
  const additions = await Promise.all([
    a.request('/api/favorites/duplicate-request', 'PUT', duplicate),
    a.request('/api/favorites/another-duplicate', 'PUT', favorite('another-duplicate', '10.00')),
  ]);
  assert.ok(additions.every(response => response.status === 200 && response.data.id === canonical.id));
  assert.equal((await a.request('/api/favorites/duplicate-request', 'PUT', duplicate)).data.id, canonical.id);
  assert.deepEqual((await a.request('/api/data')).data.favorites, [canonical]);
  assert.equal((await b.request('/api/favorites/duplicate-request', 'PUT', duplicate)).status, 404);
  const otherStrength = (await a.request('/api/favorites/strength-20', 'PUT', favorite('strength-20', '20'))).data;
  const collision = await a.request('/api/favorites/strength-20', 'PUT', { ...favorite('strength-20'), revision: otherStrength.revision });
  assert.equal(collision.status, 409);
  assert.equal(collision.data.current.id, canonical.id);
  assert.equal((await a.request('/api/data')).data.favorites.length, 2);
  for (const id of ['taken-1', 'taken-2']) assert.equal((await a.request(`/api/doses/${id}`, 'PUT', { ...DOSE, id })).status, 200);
  await a.request('/api/scenarios/repeated-plan', 'PUT', { id: 'repeated-plan', rows: [{ id: 'planned-1', productId: 'ritalin' }, { id: 'planned-2', productId: 'ritalin' }] });
  await a.request('/api/favorites/canonical', 'DELETE', { revision: canonical.revision });
  assert.equal((await a.request('/api/favorites/duplicate-request', 'PUT', duplicate)).status, 409);
  assert.deepEqual((await a.request('/api/data')).data.favorites.map(row => row.id), ['strength-20']);

  // Reproduce a database produced by an older client, before semantic identity
  // checks existed. Only synthetic favorite selections are inserted directly.
  await service.stop();
  const db = new DatabaseSync(dbPath);
  const insert = (id, strength, quantity, timestamp) => {
    const payload = JSON.stringify(favorite(id, strength, quantity));
    db.prepare('INSERT INTO entities VALUES (?,?,?,?,1,0,?,?)').run('favorites', id, registration.data.user.id, payload, timestamp, timestamp);
    db.prepare('INSERT INTO entity_revisions VALUES (?,?,?,1,?,0,?)').run('favorites', id, registration.data.user.id, payload, timestamp);
  };
  insert('legacy-older', '10', '1', '2026-01-01T00:00:00Z');
  insert('legacy-latest', '10.00', '0.5', '2026-01-02T00:00:00Z');
  db.close();
  service = await start(dbPath);
  const cleaned = (await a.request('/api/data')).data;
  assert.deepEqual(cleaned.favorites.map(row => row.id).sort(), ['legacy-latest', 'strength-20']);
  assert.equal(cleaned.favorites.find(row => row.id === 'legacy-latest').quantity, '0.5');
  assert.equal(cleaned.doses.length, 2);
  assert.equal(cleaned.scenarios[0].rows.length, 2);
  const beforeDelete = (await a.request('/api/export')).data;
  const oldVersions = beforeDelete.revisions.filter(row => row.id === 'legacy-older');
  assert.deepEqual(oldVersions.map(row => row.revision), [1, 2]);
  assert.equal(oldVersions[0].data.quantity, '1');
  assert.equal(oldVersions[1].data.deduplicatedInto, 'legacy-latest');
  assert.equal(oldVersions[1].deleted, true);
  await a.request('/api/favorites/legacy-latest', 'DELETE', { revision: 1 });
  assert.equal((await a.request('/api/favorites/legacy-older', 'PUT', favorite('legacy-older'))).status, 409);
  assert.deepEqual((await a.request('/api/data')).data.favorites.map(row => row.id), ['strength-20']);
  const full = (await a.request('/api/export')).data;
  await a.request('/api/account', 'DELETE', { password: PASSWORD });
  const restored = await b.request('/api/import', 'POST', { backup: full, mode: 'replace' });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.deepEqual(restored.data.data.favorites.map(row => row.id), ['strength-20']);
  const restoredFull = (await b.request('/api/export')).data;
  assert.deepEqual(restoredFull.revisions, full.revisions);
  assert.deepEqual(restoredFull.tombstones, full.tombstones);
  assert.equal(restored.data.data.doses.length, 2);
  assert.equal(restored.data.data.scenarios[0].rows.length, 2);
  const incoming = { format: full.format, schemaVersion: 1, exportedAt: full.exportedAt, data: { profile: null, doses: [], scenarios: [], checkins: [], favorites: [favorite('merged-duplicate', '20.00', '2'), favorite('strength-30', '30')] } };
  const merged = await b.request('/api/import', 'POST', { backup: incoming, mode: 'merge' });
  assert.equal(merged.status, 200, JSON.stringify(merged.data));
  assert.deepEqual(merged.data.data.favorites.map(row => row.id).sort(), ['strength-20', 'strength-30']);
  assert.equal(merged.data.data.favorites.find(row => row.id === 'strength-20').quantity, '1', 'Merge must preserve the existing preference rather than replace it with a duplicate.');
  assert.ok((await b.request('/api/export')).data.tombstones.some(row => row.id === 'merged-duplicate'));
});

test('custom package strengths and nine-decimal combinations persist and restore without catalog replacement or brand ID merging', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dose-custom-package-'));
  let service = await start(join(dir, 'synthetic.sqlite'));
  const a = client(() => service.url), b = client(() => service.url);
  t.after(async () => { await service.stop(); await rm(dir, { recursive: true, force: true }); });
  await a.request('/api/auth/register', 'POST', { email: 'custom-a@example.test', password: PASSWORD });
  await b.request('/api/auth/register', 'POST', { email: 'custom-b@example.test', password: PASSWORD });
  const favorites = [
    { id: 'custom-brand', productId: 'ritalin', strength: '7.5', packageStrength: '7.5', quantity: '1.5' },
    { id: 'custom-generic', productId: 'methylphenidate-ir', strength: '7.500000000', packageStrength: '7.500000000', quantity: '0.5' },
    { id: 'custom-combination', productId: 'azstarys', strength: '26.123456789', packageStrength: '26.123456789/5.200000001', quantity: '1' },
  ];
  for (const favorite of favorites) {
    const result = await a.request(`/api/favorites/${favorite.id}`, 'PUT', favorite);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    for (const [field, value] of Object.entries(favorite)) assert.equal(result.data[field], value);
  }
  const equivalent = await a.request('/api/favorites/equivalent-brand', 'PUT', { ...favorites[0], id: 'equivalent-brand', strength: '7.500', packageStrength: '7.500000000' });
  assert.equal(equivalent.status, 200);
  assert.equal(equivalent.data.id, 'custom-brand');
  assert.equal(equivalent.data.packageStrength, '7.5');
  for (const changes of [
    { strength: '7.5000000001', packageStrength: '7.5000000001' },
    { strength: '7.5', packageStrength: '7.5/0' },
    { strength: '7.5', packageStrength: '8/2' },
    { strength: '7.5', packageStrength: '7.5/2.0000000001' },
  ]) assert.equal((await a.request('/api/favorites/invalid-custom', 'PUT', { ...favorites[0], id: 'invalid-custom', ...changes })).status, 400);
  const doses = favorites.map((favorite, index) => ({
    ...DOSE, id: `dose-${favorite.id}`, productId: favorite.productId, strength: favorite.strength, packageStrength: favorite.packageStrength,
    quantity: favorite.quantity, amountMg: ['11.25', '3.75', '26.123456789'][index],
    ingredients: index === 2 ? [
      { name: 'Synthetic first combination ingredient', strengthMg: '26.123456789', amountMg: '26.123456789', unit: 'mg' },
      { name: 'Synthetic second combination ingredient', strengthMg: '5.200000001', amountMg: '5.200000001', unit: 'mg' },
    ] : [{ name: 'methylphenidate hydrochloride', strengthMg: favorite.strength, amountMg: ['11.25', '3.75'][index], unit: 'mg' }],
  }));
  for (const dose of doses) assert.equal((await a.request(`/api/doses/${dose.id}`, 'PUT', dose)).status, 200);
  for (const packageStrength of [
    '', '0', '7.5/0', '8', '7.5000000001', '7.5/2.0000000001', '7.5/1000000000000',
    `7.5/${Array(10).fill('1').join('/')}`, `7.5/${Array(9).fill('1.000000001').join('/')}`,
  ]) {
    const rejected = await a.request('/api/doses/invalid-custom-dose', 'PUT', { ...doses[0], id: 'invalid-custom-dose', packageStrength });
    assert.equal(rejected.status, 400, `Dose package ${packageStrength} must fail consistently with backup validation.`);
  }
  const original = (await a.request('/api/export')).data;
  assert.equal(original.data.favorites.length, 3);
  assert.equal(original.data.doses.length, 3);
  assert.deepEqual(original.data.favorites.map(row => row.productId).sort(), ['azstarys', 'methylphenidate-ir', 'ritalin']);
  const malformedBackup = structuredClone(original);
  malformedBackup.data.doses[0].packageStrength = '8/2';
  assert.equal((await a.request('/api/import', 'POST', { backup: malformedBackup, mode: 'replace' })).status, 400);
  assert.deepEqual((await a.request('/api/export')).data.data, original.data, 'A malformed package import must not partially replace valid records.');
  await service.stop();
  service = await start(join(dir, 'synthetic.sqlite'));
  assert.deepEqual((await a.request('/api/export')).data.data, original.data);
  await a.request('/api/account', 'DELETE', { password: PASSWORD });
  const restored = await b.request('/api/import', 'POST', { backup: original, mode: 'replace' });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.deepEqual(restored.data.data.favorites, original.data.favorites);
  assert.deepEqual(restored.data.data.doses, original.data.doses);
  assert.deepEqual((await b.request('/api/export')).data.revisions, original.revisions);
});
