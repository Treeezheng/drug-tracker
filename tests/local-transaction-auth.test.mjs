import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDoseServer } from '../server/index.mjs';

const password = 'synthetic-transaction-password!';
const dose = { id: 'transaction-dose', productId: 'fixture', productName: 'Synthetic fixture', formulation: 'IR', strength: '10', quantity: '1', unit: 'tablet', amountMg: '10', administeredAt: '2026-09-14T08:00:00Z', timeZone: 'UTC', status: 'actual', note: 'Synthetic transaction record' };
const profile = { name: 'Synthetic owner', timeZone: 'UTC', timeFormat: '24h', sleepEnabled: false, bedtime: '', wakeTime: '', weekendEnabled: false };

test('local private transactions reject a session revoked at acquisition and preserve records, history and ownership', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'drug-local-transaction-'));
  const dbPath = join(directory, 'synthetic.sqlite');
  const { server } = await createDoseServer({ dbPath, port: 0 });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const control = new DatabaseSync(dbPath);
  t.after(async () => { control.close(); await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); await rm(directory, { recursive: true, force: true }); });
  let owner, cookie;
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(owner ? { 'X-Dose-Owner': owner } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  };
  const registered = await request('/auth/local-setup', { password });
  assert.equal(registered.status, 201); owner = registered.data.user.id; cookie = registered.cookie;
  assert.equal((await request('/profile', profile, 'PUT')).status, 200);
  assert.equal((await request('/doses/transaction-dose', dose, 'PUT')).status, 200);
  const backup = (await request('/export')).data;
  const snapshot = () => JSON.stringify({
    users: control.prepare('SELECT * FROM users ORDER BY id').all(),
    entities: control.prepare('SELECT * FROM entities ORDER BY kind,id').all(),
    revisions: control.prepare('SELECT * FROM entity_revisions ORDER BY kind,entity_id,revision').all(),
  });
  const before = snapshot();
  const originalExec = DatabaseSync.prototype.exec;
  let revokeOnAcquire;
  t.mock.method(DatabaseSync.prototype, 'exec', function (sql) {
    if (sql === 'BEGIN IMMEDIATE' && revokeOnAcquire) {
      const tokenHash = revokeOnAcquire;
      revokeOnAcquire = undefined;
      // Deterministic in-process transaction-boundary injection. All HTTP bodies
      // are sent in full; no lock contention, delayed request or load is created.
      this.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
    }
    return originalExec.call(this, sql);
  });
  for (const [label, path, body, method] of [
    ['profile update', '/profile', { ...profile, name: 'must not replace', revision: 1 }, 'PUT'],
    ['entity update', '/doses/transaction-dose', { ...dose, note: 'must not replace', revision: 1 }, 'PUT'],
    ['entity deletion', '/doses/transaction-dose', { revision: 1 }, 'DELETE'],
    ['replace import', '/import', { mode: 'replace', backup }, 'POST'],
    ['private data', '/data', undefined, 'GET'],
    ['private export', '/export', undefined, 'GET'],
    ['account deletion', '/account', { password }, 'DELETE'],
  ]) {
    await t.test(label, async () => {
      const signed = await request('/auth/local-unlock', { password });
      assert.equal(signed.status, 200); cookie = signed.cookie;
      const tokenHash = createHash('sha256').update(cookie.split('=')[1]).digest('hex');
      assert.equal(control.prepare('SELECT count(*) AS n FROM sessions WHERE token_hash=?').get(tokenHash).n, 1);
      revokeOnAcquire = tokenHash;
      const response = await request(path, body, method);
      assert.equal(revokeOnAcquire, undefined, 'The request reached transaction acquisition.');
      assert.equal(response.status, 401);
      assert.deepEqual(Object.keys(response.data), ['error']);
      assert.equal(snapshot(), before, 'No records, revisions, account credentials or owner identifiers changed.');
      assert.equal(control.prepare('SELECT count(*) AS n FROM sessions WHERE token_hash=?').get(tokenHash).n, 0);
    });
  }
});
