import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDoseServer } from '../server/index.mjs';

const PASSWORD = 'synthetic-local-password!';
const NEW_PASSWORD = 'synthetic-new-local-password!';
const DOSE = { id: 'local-history', productId: 'ritalin', productName: 'Synthetic legacy fixture', formulation: 'IR', strength: '10', quantity: '0.5', unit: 'tablet', amountMg: '5', administeredAt: '2026-09-13T08:00:00Z', timeZone: 'UTC', status: 'actual', note: 'Synthetic test only' };

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dose-local-auth-'));
  const { server } = await createDoseServer({ dbPath: join(dir, 'synthetic.sqlite'), port: 0 });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  return async (path, body, cookie, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  };
}

test('empty local setup accepts a password without email and exposes only account-count state', async t => {
  const request = await fixture(t);
  const initial = await request('/auth/local-state');
  assert.deepEqual(initial.data, { hasAccount: false, requiresEmail: false });
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  assert.equal((await request('/auth/local-unlock', { password: PASSWORD })).status, 404);
  assert.equal((await request('/auth/local-recover', { password: NEW_PASSWORD, recoveryCode: 'synthetic-wrong-code' })).status, 404);
  assert.equal((await request('/auth/local-setup', { password: 'short' })).status, 400);
  assert.deepEqual((await request('/auth/local-state')).data, initial.data);
  const setup = await request('/auth/local-setup', { password: PASSWORD, name: ' Synthetic local name ' });
  assert.equal(setup.status, 201);
  assert.equal(setup.data.user.name, 'Synthetic local name');
  assert.match(setup.data.user.email, /^local-[0-9a-f-]+@device\.invalid$/);
  assert.match(setup.data.recoveryCode, /^[A-Za-z0-9_-]{32}$/);
  assert.match(setup.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.deepEqual(Object.keys(setup.data).sort(), ['recoveryCode', 'user']);
  assert.deepEqual(Object.keys(setup.data.user).sort(), ['email', 'id', 'name']);
  assert.deepEqual((await request('/auth/local-state')).data, { hasAccount: true, requiresEmail: false });
  assert.equal((await request('/session', undefined, setup.cookie)).data.user.id, setup.data.user.id);
  const data = (await request('/data', undefined, setup.cookie)).data;
  assert.deepEqual(data, { profile: null, doses: [], scenarios: [], favorites: [], checkins: [], inventory: [] });
  assert.equal((await request('/auth/local-setup', { password: NEW_PASSWORD })).status, 409);
  assert.equal((await request('/auth/local-unlock', { password: 'synthetic-wrong-password' })).status, 401);
  const unlocked = await request('/auth/local-unlock', { password: PASSWORD });
  assert.equal(unlocked.status, 200);
  assert.deepEqual(unlocked.data.user, setup.data.user);
});

test('simultaneous local setup creates exactly one account and recovery code', async t => {
  const request = await fixture(t);
  const setups = await Promise.all(Array.from({ length: 3 }, () => request('/auth/local-setup', { password: PASSWORD })));
  assert.deepEqual(setups.map(result => result.status).sort(), [201, 409, 409]);
  for (const result of setups.filter(result => result.status === 409)) {
    assert.equal(result.cookie, undefined);
    assert.equal(result.data.recoveryCode, undefined);
  }
  const winner = setups.find(result => result.status === 201);
  assert.deepEqual((await request('/auth/local-state')).data, { hasAccount: true, requiresEmail: false });
  assert.equal((await request('/auth/local-unlock', { password: PASSWORD })).data.user.id, winner.data.user.id);
});

test('one existing email account unlocks and recovers locally without changing its ID or health history', async t => {
  const request = await fixture(t);
  const legacy = await request('/auth/register', { email: 'legacy@example.test', password: PASSWORD, name: 'Synthetic legacy user' });
  const saved = await request('/doses/local-history', DOSE, legacy.cookie, 'PUT');
  const before = (await request('/export', undefined, legacy.cookie)).data;
  await request('/auth/logout', {}, legacy.cookie);
  const unlocked = await request('/auth/local-unlock', { password: PASSWORD });
  assert.equal(unlocked.status, 200);
  assert.deepEqual(unlocked.data.user, legacy.data.user);
  assert.deepEqual((await request('/data', undefined, unlocked.cookie)).data.doses, [saved.data]);
  assert.equal((await request('/auth/local-recover', { password: NEW_PASSWORD, recoveryCode: 'synthetic-incorrect-code' })).status, 401);
  const reset = await request('/auth/local-recover', { password: NEW_PASSWORD, recoveryCode: legacy.data.recoveryCode });
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.data.user, legacy.data.user);
  assert.notEqual(reset.data.recoveryCode, legacy.data.recoveryCode);
  assert.equal((await request('/data', undefined, unlocked.cookie)).status, 401);
  assert.equal((await request('/auth/local-unlock', { password: PASSWORD })).status, 401);
  assert.equal((await request('/auth/local-recover', { password: PASSWORD, recoveryCode: legacy.data.recoveryCode })).status, 401);
  const after = (await request('/export', undefined, reset.cookie)).data;
  assert.deepEqual(after.data, before.data);
  assert.deepEqual(after.revisions, before.revisions);
  assert.deepEqual(after.tombstones, before.tombstones);
  const emailLogin = await request('/auth/login', { email: 'legacy@example.test', password: NEW_PASSWORD });
  assert.equal(emailLogin.status, 200);
  assert.equal(emailLogin.data.user.id, legacy.data.user.id);
});

test('multiple legacy accounts require email and are never merged or selected by password alone', async t => {
  const request = await fixture(t);
  const a = await request('/auth/register', { email: 'a-legacy@example.test', password: PASSWORD });
  const b = await request('/auth/register', { email: 'b-legacy@example.test', password: PASSWORD });
  const savedA = await request('/doses/local-history', DOSE, a.cookie, 'PUT');
  const savedB = await request('/doses/other-history', { ...DOSE, id: 'other-history', quantity: '1', amountMg: '10' }, b.cookie, 'PUT');
  assert.deepEqual((await request('/auth/local-state')).data, { hasAccount: true, requiresEmail: true });
  for (const path of ['/auth/local-setup', '/auth/local-unlock', '/auth/local-recover']) {
    const response = await request(path, { password: PASSWORD, recoveryCode: a.data.recoveryCode });
    assert.equal(response.status, 409);
    assert.equal(response.data.requiresEmail, true);
    assert.equal(response.cookie, undefined);
    assert.equal(response.data.user, undefined);
  }
  const loginA = await request('/auth/login', { email: 'a-legacy@example.test', password: PASSWORD });
  assert.deepEqual((await request('/data', undefined, loginA.cookie)).data.doses, [savedA.data]);
  const resetB = await request('/auth/recover', { email: 'b-legacy@example.test', password: NEW_PASSWORD, recoveryCode: b.data.recoveryCode });
  assert.equal(resetB.status, 200);
  assert.deepEqual((await request('/data', undefined, resetB.cookie)).data.doses, [savedB.data]);
  assert.deepEqual((await request('/data', undefined, loginA.cookie)).data.doses, [savedA.data]);
});

test('local recovery is one-use and revokes concurrent unlocks with the old password', async t => {
  const request = await fixture(t);
  const setup = await request('/auth/local-setup', { password: PASSWORD });
  const results = await Promise.all(Array.from({ length: 3 }, () => request('/auth/local-recover', { password: NEW_PASSWORD, recoveryCode: setup.data.recoveryCode })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401, 401]);
  const reset = results.find(result => result.status === 200);
  const [secondReset, ...unlocks] = await Promise.all([
    request('/auth/local-recover', { password: PASSWORD, recoveryCode: reset.data.recoveryCode }),
    ...Array.from({ length: 3 }, () => request('/auth/local-unlock', { password: NEW_PASSWORD })),
  ]);
  assert.equal(secondReset.status, 200);
  for (const unlock of unlocks) {
    assert.ok([200, 401].includes(unlock.status));
    if (unlock.cookie) assert.equal((await request('/data', undefined, unlock.cookie)).status, 401);
  }
  assert.equal((await request('/data', undefined, reset.cookie)).status, 401);
  assert.equal((await request('/data', undefined, secondReset.cookie)).status, 200);
});

test('explicitly deleting the sole account returns to setup without retaining its history', async t => {
  const request = await fixture(t);
  const setup = await request('/auth/local-setup', { password: PASSWORD });
  await request('/doses/local-history', DOSE, setup.cookie, 'PUT');
  assert.equal((await request('/account', { password: 'synthetic-wrong-password' }, setup.cookie, 'DELETE')).status, 401);
  assert.equal((await request('/auth/local-state')).data.hasAccount, true);
  assert.equal((await request('/account', { password: PASSWORD }, setup.cookie, 'DELETE')).status, 200);
  assert.deepEqual((await request('/auth/local-state')).data, { hasAccount: false, requiresEmail: false });
  assert.equal((await request('/data', undefined, setup.cookie)).status, 401);
  const replacement = await request('/auth/local-setup', { password: NEW_PASSWORD });
  assert.equal(replacement.status, 201);
  assert.notEqual(replacement.data.user.id, setup.data.user.id);
  assert.deepEqual((await request('/data', undefined, replacement.cookie)).data.doses, []);
});
