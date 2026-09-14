import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDoseServer } from '../server/index.mjs';

const PASSWORD = 'synthetic-password-before-reset!';
const DOSE = { id: 'concurrent-dose', productId: 'ritalin', productName: 'Synthetic fixture', formulation: 'IR', strength: '10', quantity: '1', unit: 'tablet', amountMg: '10', administeredAt: '2026-09-13T08:00:00Z', timeZone: 'UTC', status: 'actual', note: 'Synthetic test only' };

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dose-api-races-'));
  const { server } = await createDoseServer({ dbPath: join(dir, 'synthetic.sqlite'), port: 0 });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const request = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  };
  return request;
}

test('concurrent identical requests are idempotent, competing corrections have one winner, and exports stay consistent', async t => {
  const request = await fixture(t);
  const registered = await request('/auth/register', { method: 'POST', body: { email: 'races@example.test', password: PASSWORD } });
  const cookie = registered.cookie;
  const create = () => request('/doses/concurrent-dose', { method: 'PUT', cookie, body: DOSE });
  const duplicates = await Promise.all(Array.from({ length: 8 }, create));
  assert.ok(duplicates.every(response => response.status === 200 && response.data.revision === 1));
  const corrections = await Promise.all(['0.5', '2'].map(quantity => request('/doses/concurrent-dose', { method: 'PUT', cookie, body: { ...DOSE, quantity, amountMg: String(Number(quantity) * 10), revision: 1 } })));
  assert.deepEqual(corrections.map(response => response.status).sort(), [200, 409]);
  const winner = corrections.find(response => response.status === 200).data;
  const conflict = corrections.find(response => response.status === 409).data;
  assert.equal(conflict.current.revision, 2);
  assert.equal(conflict.current.quantity, winner.quantity);
  const results = await Promise.all([
    request('/export', { cookie }),
    request('/doses/concurrent-dose', { method: 'DELETE', cookie, body: { revision: 2 } }),
    request('/export', { cookie }),
  ]);
  for (const snapshot of [results[0].data, results[2].data]) {
    const live = snapshot.data.doses[0];
    const last = snapshot.revisions.at(-1);
    assert.equal(last.revision, live?.revision ?? snapshot.tombstones[0].revision);
    assert.equal(last.deleted, !live);
    if (live) assert.equal(last.data.quantity, live.quantity);
  }
  const after = (await request('/export', { cookie })).data;
  assert.deepEqual(after.revisions.map(row => row.revision), [1, 2, 3]);
});

test('one recovery code used concurrently produces one new session and revokes every old session', async t => {
  const request = await fixture(t);
  const registered = await request('/auth/register', { method: 'POST', body: { email: 'recovery-race@example.test', password: PASSWORD } });
  const reset = { email: 'recovery-race@example.test', password: 'synthetic-password-after-reset!', recoveryCode: registered.data.recoveryCode };
  const results = await Promise.all(Array.from({ length: 3 }, () => request('/auth/recover', { method: 'POST', body: reset })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401, 401]);
  const winner = results.find(result => result.status === 200);
  assert.equal((await request('/data', { cookie: registered.cookie })).status, 401);
  assert.equal((await request('/data', { cookie: winner.cookie })).status, 200);
  assert.notEqual(winner.data.recoveryCode, reset.recoveryCode);
});

test('password recovery invalidates concurrent login attempts using the old password', async t => {
  const request = await fixture(t);
  const email = 'login-reset-race@example.test';
  const registered = await request('/auth/register', { method: 'POST', body: { email, password: PASSWORD } });
  let password = PASSWORD;
  let recoveryCode = registered.data.recoveryCode;
  for (let round = 0; round < 3; round++) {
    const replacement = `synthetic-password-round-${round}!`;
    const [reset, ...logins] = await Promise.all([
      request('/auth/recover', { method: 'POST', body: { email, password: replacement, recoveryCode } }),
      ...Array.from({ length: 3 }, () => request('/auth/login', { method: 'POST', body: { email, password } })),
    ]);
    assert.equal(reset.status, 200);
    for (const login of logins) {
      assert.ok([200, 401].includes(login.status));
      if (login.cookie) assert.equal((await request('/data', { cookie: login.cookie })).status, 401, 'An old-password login retained a valid session after password recovery completed.');
    }
    password = replacement;
    recoveryCode = reset.data.recoveryCode;
  }
});

test('private and error responses prevent caching and export no authentication secrets', async t => {
  const request = await fixture(t);
  const registered = await request('/auth/register', { method: 'POST', body: { email: 'privacy@example.test', password: PASSWORD } });
  const cookie = registered.cookie;
  const responses = [registered,
    await request('/session', { cookie }), await request('/data', { cookie }), await request('/export', { cookie }),
    await request('/data'), await request('/missing-endpoint', { cookie }),
    await request('/data', { cookie, headers: { Origin: 'https://untrusted.example' } }),
  ];
  for (const response of responses) {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  }
  const backup = JSON.stringify(responses[3].data);
  for (const secret of [PASSWORD, registered.data.recoveryCode, cookie.split('=')[1], 'password_hash', 'recovery_hash', 'token_hash']) assert.equal(backup.includes(secret), false);
  const secondBrowser = await request('/auth/login', { method: 'POST', body: { email: 'privacy@example.test', password: PASSWORD } });
  const logout = await request('/auth/logout', { method: 'POST', cookie, body: {} });
  assert.match(logout.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/; Max-Age=0/);
  assert.equal((await request('/data', { cookie })).status, 401);
  assert.equal((await request('/data', { cookie: secondBrowser.cookie })).status, 200, 'Signing out one browser unexpectedly signed out another browser.');
});

test('hard deletion prevents concurrent old-password logins from creating surviving sessions', async t => {
  const request = await fixture(t);
  const email = 'delete-race@example.test';
  const registered = await request('/auth/register', { method: 'POST', body: { email, password: PASSWORD } });
  const [deleted, ...logins] = await Promise.all([
    request('/account', { method: 'DELETE', cookie: registered.cookie, body: { password: PASSWORD } }),
    ...Array.from({ length: 3 }, () => request('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })),
  ]);
  assert.equal(deleted.status, 200);
  for (const login of logins) {
    assert.ok([200, 401].includes(login.status), `A deleted account login failed as an unexpected ${login.status} server error.`);
    if (login.cookie) assert.equal((await request('/data', { cookie: login.cookie })).status, 401);
  }
  assert.equal((await request('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).status, 401);
});
