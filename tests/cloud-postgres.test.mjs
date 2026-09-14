import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Pool } from 'pg';
import { openCloudPostgres } from '../server/cloud-postgres.mjs';
import { createCloudServer } from '../server/cloud.mjs';
import { createVaultKey, encryptVault, decryptVault, wrapVaultKey, unwrapVaultKey } from '../src/lib/vault-crypto.ts';

const testUrl = process.env.DRUG_TEST_POSTGRES_URL;
const origin = 'https://drug-tracker-7e9d0c2e62c1.herokuapp.com';
const accountPassword = 'SYNTHETIC ACCOUNT PASSWORD 8352';
const vaultPassword = 'SYNTHETIC SEPARATE ENCRYPTION PASSWORD 8352';
const healthNote = 'SYNTHETIC PRIVATE HEALTH NOTE 8352';
const hash = value => createHash('sha256').update(value).digest('hex');
const session = () => ({ tokenHash: hash(randomBytes(32)), expiresAt: Date.now() + 86_400_000 });
const account = username => ({ id: randomUUID(), username, name: username, password_hash: 'synthetic-test-hash-only' });
function opaque(ownerId, expectedRevision = 0, marker = 63) {
  const binary = n => Buffer.alloc(n, marker).toString('base64url');
  const common = { protocol: 'dose-timeline-vault', version: 1, ownerId, cipher: 'AES-256-GCM', iv: binary(12) };
  return { expectedRevision, dataEnvelope: { ...common, kind: 'data', ciphertext: binary(17) },
    keyEnvelope: { ...common, kind: 'wrapped-key', ciphertext: binary(48), kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt: binary(16) } } };
}
async function request(instance, path, { method = 'GET', body, cookie, owner, headers = {} } = {}) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: instance.server.address().port, path: `/drug/api${path}`, method, headers: {
      Host: new URL(origin).host, 'X-Forwarded-Proto': 'https', ...(!['GET','HEAD'].includes(method) ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...(owner ? { 'X-Dose-Owner': owner } : {}),
      ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}), ...headers,
    } }, res => {
      let output = ''; res.on('data', chunk => { output += chunk; });
      res.once('end', () => resolve({ status: res.statusCode, data: JSON.parse(output), cookie: res.headers['set-cookie']?.[0].split(';')[0], headers: res.headers }));
    }); req.once('error', reject); req.end(encoded);
  });
}
async function waitUntilBlocked(pool, queryFragment) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name='drug-tracker-cloud' AND wait_event_type='Lock' AND query LIKE $1", [`%${queryFragment}%`]);
    if (result.rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected PostgreSQL lock wait was not observed.');
}

test('real PostgreSQL cloud integration (explicit temporary local database only)', { skip: !testUrl, timeout: 60_000 }, async t => {
  const url = new URL(testUrl);
  assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'Integration tests never connect to a remote database.');
  assert.equal(url.search, '', 'Use an explicit unencrypted loopback test URL.');
  const admin = new Pool({ connectionString: url.toString(), ssl: false, max: 2 });
  const database = `drug_test_${randomBytes(8).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${database}`);
  url.pathname = `/${database}`;
  const options = { databaseUrl: url.toString(), allowInsecurePostgresLoopback: true };
  const control = new Pool({ connectionString: url.toString(), ssl: false, max: 3 });
  const stores = [], instances = [];
  t.after(async () => {
    await Promise.all(instances.map(async instance => {
      await new Promise(resolve => { instance.server.close(resolve); instance.server.closeAllConnections(); }); await instance.closeStorage();
    }));
    await Promise.all(stores.map(store => store.close())); await control.end();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`); await admin.end();
  });
  const [a, b, c] = await Promise.all(Array.from({ length: 3 }, () => openCloudPostgres(options)));
  stores.push(a, b, c);
  const owner = account('repo_owner'), ownerSession = session();
  await a.register(owner, ownerSession);

  await t.test('concurrent schema initialization and registration preserve unique accounts and shared sessions', async () => {
    assert.equal((await control.query('SELECT version FROM drug_tracker.meta')).rows[0].version, 1);
    const attempts = await Promise.allSettled([a,b].map(store => store.register(account('same_username'), session())));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(result => result.status === 'rejected').reason.status, 409);
    assert.equal((await c.session(ownerSession.tokenHash)).id, owner.id);
    assert.equal((await control.query('SELECT count(*)::int AS count FROM drug_tracker.accounts')).rows[0].count, 2);
  });
  await t.test('cross-instance first-write and subsequent CAS save the whole envelope pair once', async () => {
    for (const expectedRevision of [0,1]) {
      const inputs = [opaque(owner.id, expectedRevision, 41), opaque(owner.id, expectedRevision, 42)];
      const results = await Promise.allSettled([a,b].map((store,i) => store.writeVault(owner.id, ownerSession.tokenHash, inputs[i])));
      const index = results.findIndex(result => result.status === 'fulfilled');
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.find(result => result.status === 'rejected').reason.currentRevision, expectedRevision + 1);
      const saved = await c.readVault(owner.id, ownerSession.tokenHash);
      assert.deepEqual(saved.dataEnvelope, inputs[index].dataEnvelope); assert.deepEqual(saved.keyEnvelope, inputs[index].keyEnvelope);
    }
  });
  await t.test('real encrypted browser payload survives store restart; database has no plaintext health or encryption password', async () => {
    const key = await createVaultKey(), keyEnvelope = await wrapVaultKey(key, vaultPassword, owner.id);
    const data = { profile: null, doses: [{ id: 'synthetic-dose', note: healthNote }], scenarios: [], favorites: [], checkins: [], inventory: [] };
    const dataEnvelope = await encryptVault(data, key, owner.id);
    await a.writeVault(owner.id, ownerSession.tokenHash, { expectedRevision: 2, dataEnvelope, keyEnvelope });
    const reopened = await openCloudPostgres(options); stores.push(reopened);
    const stored = await reopened.readVault(owner.id, ownerSession.tokenHash);
    const unwrapped = await unwrapVaultKey(stored.keyEnvelope, vaultPassword, owner.id);
    assert.deepEqual(await decryptVault(stored.dataEnvelope, unwrapped, owner.id), data);
    await assert.rejects(unwrapVaultKey(stored.keyEnvelope, accountPassword, owner.id));
    const raw = JSON.stringify((await control.query('SELECT * FROM drug_tracker.vaults')).rows);
    for (const secret of [healthNote,vaultPassword,accountPassword]) assert.ok(!raw.includes(secret));
  });
  await t.test('invalid/foreign envelopes cannot replace old data or key, and account selection stays explicit', async () => {
    const before = await a.readVault(owner.id, ownerSession.tokenHash);
    const bad = opaque(owner.id, 3); bad.keyEnvelope.kdf.iterations = 1;
    await assert.rejects(async () => a.writeVault(owner.id, ownerSession.tokenHash, bad), error => error.status === 400);
    await assert.rejects(async () => a.writeVault(owner.id, ownerSession.tokenHash, opaque('another-owner',3)), error => error.status === 403);
    await assert.rejects(a.readVault('another-owner', ownerSession.tokenHash), error => error.status === 401);
    assert.deepEqual(await b.readVault(owner.id, ownerSession.tokenHash), before);
  });
  await t.test('a write holds its session lock until commit; logout waits and every later write is rejected', async () => {
    const blocker = await control.connect(); await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM drug_tracker.accounts WHERE id=$1 FOR UPDATE', [owner.id]);
    const write = a.writeVault(owner.id, ownerSession.tokenHash, opaque(owner.id,3));
    await waitUntilBlocked(control, 'SELECT id FROM drug_tracker.accounts');
    let logoutFinished = false;
    const logout = b.logout(ownerSession.tokenHash, owner.id).then(() => { logoutFinished = true; });
    await waitUntilBlocked(control, 'FOR UPDATE OF s');
    assert.equal(logoutFinished, false);
    await blocker.query('COMMIT'); blocker.release();
    assert.equal((await write).revision, 4); await logout;
    await assert.rejects(c.writeVault(owner.id, ownerSession.tokenHash, opaque(owner.id,4)), error => error.status === 401);
    assert.equal(await c.session(ownerSession.tokenHash), null);
  });
  await t.test('account password changes cannot issue stale sessions; shared attempt budgets survive reopening', async () => {
    const freshSession = session();
    await control.query('UPDATE drug_tracker.accounts SET password_hash=$1 WHERE id=$2', ['changed-hash',owner.id]);
    await assert.rejects(a.login(owner,freshSession), error => error.status === 401);
    assert.equal(await b.session(freshSession.tokenHash), null);
    const results = await Promise.allSettled([a,b,c].map(store => store.consumeRateLimit('login',2,60_000)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length,2);
    assert.equal(results.find(result => result.status === 'rejected').reason.status,429);
    const reopened = await openCloudPostgres(options); stores.push(reopened);
    await assert.rejects(reopened.consumeRateLimit('login',2,60_000), error => error.status===429);
    await reopened.consumeRateLimit('register',2,60_000);
    await control.query('DELETE FROM drug_tracker.rate_limits');
  });
  await t.test('two HTTP instances share secure login and encrypted saves, and enforce exact origin/owner/proxy', async () => {
    for (let i=0;i<2;i++) {
      const instance = await createCloudServer({ ...options, origin, proxyMode:'heroku' }); instances.push(instance);
      await new Promise(resolve => instance.server.listen(0,'127.0.0.1',resolve));
    }
    const registered = await request(instances[0],'/auth/register',{method:'POST',body:{username:'http_synthetic',password:accountPassword}});
    assert.equal(registered.status,201);
    assert.match(registered.headers['set-cookie'][0], /Secure/);
    const signed = { cookie:registered.cookie,owner:registered.data.user.id };
    assert.deepEqual((await request(instances[1],'/session',signed)).data,{user:registered.data.user});
    assert.equal((await request(instances[1],'/vault',{...signed,method:'PUT',body:opaque(signed.owner)})).status,200);
    assert.equal((await request(instances[0],'/vault',signed)).data.vault.revision,1);
    for (const headers of [{'X-Forwarded-Proto':'http'},{'X-Forwarded-Proto':'https,http'},{Host:'evil.test','X-Forwarded-Host':new URL(origin).host},{Origin:'https://evil.test'}])
      assert.equal((await request(instances[1],'/vault',{...signed,headers})).status,403);
    assert.equal((await request(instances[1],'/vault',{...signed,owner:'wrong-owner'})).status,401);
    assert.equal((await request(instances[0],'/auth/logout',{...signed,method:'POST',body:{}})).status,200);
    assert.equal((await request(instances[1],'/vault',signed)).status,401);
    assert.equal((await request(instances[1],'/auth/login',{method:'POST',body:{username:'http_synthetic',password:accountPassword}})).status,200);
  });
});
