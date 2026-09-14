import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudClient } from '../src/lib/cloud-client';
import type { CloudUser, CloudVaultSnapshot } from '../src/lib/cloud-client';
import { createDeviceUnlock, DEVICE_UNLOCK_LIFETIME_MS, vaultKeyFingerprint } from '../src/lib/device-unlock';
import type { DeviceUnlockRecord, DeviceUnlockStore } from '../src/lib/device-unlock';
import { createVaultKey, encryptVault, wrapVaultKeyOpaque, exportRecoveryKey, wrapVaultKey } from '../src/lib/vault-crypto';
import type { AppData } from '../src/lib/types';

const scope = '/drug/api', start = Date.parse('2026-09-14T00:00:00Z');
const password = 'Synthetic cedar! orbital cinnamon 9814';
const privateName = 'SYNTHETIC PRIVATE RECORD 7219';
const data = (): AppData => ({ profile: { name: privateName, timeZone: 'UTC', timeFormat: '24h', timeIncrementMinutes: 5, sleepEnabled: false, bedtime: '', wakeTime: '', weekendEnabled: false, weekendBedtime: '', weekendWakeTime: '' }, doses: [], scenarios: [], favorites: [], checkins: [], inventory: [] });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
class MemoryStore implements DeviceUnlockStore {
  marker = 'initial'; record: DeviceUnlockRecord | null = null; unavailable = false; failRevocation = false;
  beforeSave: (() => Promise<void>) | null = null;
  epoch() { if (this.unavailable) throw new Error('Synthetic storage denied'); return this.marker; }
  async read() { this.epoch(); return structuredClone(this.record); }
  async save(record: DeviceUnlockRecord, expected: string) {
    if (this.beforeSave) await this.beforeSave();
    if (this.epoch() !== expected) return false;
    this.record = structuredClone(record); return true;
  }
  async revoke() {
    if (this.failRevocation) throw new Error('Synthetic durable revocation denied');
    this.marker = crypto.randomUUID(); this.record = null;
  }
}
async function fixture({ legacy = false } = {}) {
  let clock = start, authenticated = true, user: CloudUser = { id: 'owner1', username: 'synthetic.owner', name: 'Synthetic owner', authMode: legacy ? 'legacy-scrypt' : 'opaque-v1' };
  const store = new MemoryStore(), key = await createVaultKey(), recoveryKey = await exportRecoveryKey(key);
  const keyEnvelope = legacy ? await wrapVaultKey(key, password, user.id)
    : await wrapVaultKeyOpaque(key, Buffer.alloc(64, 39).toString('base64url'), user.id);
  let vault: CloudVaultSnapshot = { ownerId: user.id, revision: 1, keyEnvelope, dataEnvelope: await encryptVault(data(), key, user.id), createdAt: new Date(start).toISOString(), updatedAt: new Date(start).toISOString() };
  let beforeVault: (() => Promise<void>) | null = null, beforeSession: (() => void) | null = null, nextVaultFailure = 0;
  const requests: { path: string; method: string; body: unknown }[] = [];
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const fetcher = (async (url, init = {}) => {
    const path = String(url).replace(scope, ''), method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path, method, body });
    if (path === '/session') { beforeSession?.(); return reply({ user: authenticated ? user : null }); }
    if (path === '/auth/login') { authenticated = true; return reply({ user }); }
    if (path === '/auth/logout') { authenticated = false; return reply({ ok: true }); }
    if (!authenticated) return reply({ error: 'Session expired.' }, 401);
    assert.equal(new Headers(init.headers).get('X-Dose-Owner'), user.id);
    if (path === '/auth/verify-password') return reply(body.password === password ? { ok: true } : { error: 'Wrong password' }, body.password === password ? 200 : 403);
    if (path === '/auth/logout-all') { authenticated = false; return reply({ ok: true }); }
    if (path === '/auth/change-password') return reply({ user });
    if (path === '/account') { authenticated = false; return reply({ ok: true }); }
    if (path === '/vault' && method === 'GET') { const failure = nextVaultFailure; nextVaultFailure = 0; if (beforeVault) { const hold = beforeVault; beforeVault = null; await hold(); } return failure ? reply({ error: 'Delayed expired session.' }, failure) : reply({ vault }); }
    if (path === '/vault' && method === 'PUT') { vault = { ...vault, ...body, revision: body.expectedRevision + 1 }; return reply({ vault }); }
    return reply({ error: 'Unknown route' }, 404);
  }) as typeof fetch;
  const controller = () => createDeviceUnlock({ scope, store, now: () => clock });
  return {
    store, key, recoveryKey, keyEnvelope, requests, controller,
    client: () => createCloudClient({ fetch: fetcher, deviceUnlockStore: store, now: () => clock }),
    seed: () => controller().enable(key, user.id, vault.keyEnvelope, clock, () => {}),
    now: () => clock, advance(ms: number) { clock += ms; }, expire() { authenticated = false; },
    setUser(next: CloudUser) { user = next; }, setVault(next: CloudVaultSnapshot) { vault = next; }, getVault() { return structuredClone(vault); },
    holdVault() { const started = deferred(), finish = deferred(); beforeVault = async () => { started.resolve(); await finish.promise; }; return { started, finish }; },
    onSession(callback: () => void) { beforeSession = callback; },
    failNextVault(status: number) { nextVaultFailure = status; },
  };
}

test('restart restores only after live session and latest vault checks, with no network key or record exposure', async () => {
  const f = await fixture(); await f.seed();
  const saved = structuredClone(f.store.record!);
  assert.equal(saved.wrappingKey.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('raw', saved.wrappingKey));
  assert.equal(saved.ciphertext.byteLength, 48);
  const serialized = JSON.stringify(saved);
  for (const secret of [password, privateName, f.recoveryKey, Buffer.alloc(64, 39).toString('base64url')]) assert.equal(serialized.includes(secret), false);
  const restarted = f.client(); assert.equal(await restarted.tryAutoUnlock(), true);
  assert.deepEqual((await restarted.request<{ data: AppData }>('/export')).data, data());
  assert.deepEqual(f.requests.map(row => row.path), ['/session', '/vault', '/session', '/vault']);
  assert.equal(f.requests.every(row => row.method === 'GET' && row.body === undefined), true);
  assert.equal(JSON.stringify(f.requests).includes(f.recoveryKey), false);
  assert.equal(JSON.stringify(f.requests).includes(privateName), false);
  assert.deepEqual(await restarted.getAutoUnlockPreference(), { enabled: true, expiresAt: start + DEVICE_UNLOCK_LIFETIME_MS });
});

test('automatic resumes never renew fixed expiry or authorize reenrollment, and expiry cleans the stored key', async () => {
  const f = await fixture(); await f.seed();
  f.advance(DEVICE_UNLOCK_LIFETIME_MS - 1);
  const resumed = f.client(); assert.equal(await resumed.tryAutoUnlock(), true);
  await assert.rejects(resumed.setAutoUnlockPreference(true), /Confirm your password/);
  assert.equal(f.store.record!.expiresAt, start + DEVICE_UNLOCK_LIFETIME_MS);
  resumed.lock({ preserveAutoUnlock: true });
  f.advance(1); const expired = f.client(); assert.equal(await expired.tryAutoUnlock(), false);
  assert.equal(expired.getState().locked, true); assert.equal(f.store.record, null);
});

test('metadata cannot extend expiry, change owner, or change scope without rejecting the locally wrapped key', async () => {
  for (const mutation of [
    (record: DeviceUnlockRecord) => { record.createdAt += 10; record.expiresAt += 10; },
    (record: DeviceUnlockRecord) => { record.ownerId = 'owner2'; },
    (record: DeviceUnlockRecord) => { record.scope = '/different/api'; },
    (record: DeviceUnlockRecord) => { record.expiresAt += 1; },
  ]) {
    const f = await fixture(); await f.seed(); f.advance(100); mutation(f.store.record!);
    assert.equal(await f.client().tryAutoUnlock(), false);
    assert.equal(f.store.record, null);
  }
});

test('expired/revoked sessions, changed owners, and replaced key envelopes cannot resume', async () => {
  for (const reason of ['revoked', 'owner', 'envelope', 'missing', 'auth-downgrade'] as const) {
    const f = await fixture(); await f.seed();
    if (reason === 'revoked') f.expire();
    if (reason === 'owner') f.setUser({ id: 'owner2', username: 'another.owner', name: 'Other', authMode: 'opaque-v1' });
    if (reason === 'auth-downgrade') f.setUser({ id: 'owner1', username: 'synthetic.owner', name: 'Synthetic owner', authMode: 'legacy-scrypt' });
    if (reason === 'envelope') { const vault = f.getVault(); vault.keyEnvelope = { ...vault.keyEnvelope, iv: Buffer.alloc(12, 14).toString('base64url') }; f.setVault(vault); }
    if (reason === 'missing') f.setVault(null as unknown as CloudVaultSnapshot);
    const resumed = f.client(); assert.equal(await resumed.tryAutoUnlock(), false);
    assert.equal(resumed.getState().locked, true); assert.equal(f.store.record, null);
    if (reason === 'revoked') assert.equal(f.requests.some(row => row.path === '/vault'), false);
  }
});

test('ordinary encrypted data updates and reordered wrapper properties retain the same device grant', async () => {
  const f = await fixture(); await f.seed();
  const remote = f.getVault(), changed = data(); changed.profile!.name = 'Updated private record';
  remote.revision++; remote.dataEnvelope = await encryptVault(changed, f.key, remote.ownerId);
  remote.keyEnvelope = Object.fromEntries(Object.entries(remote.keyEnvelope).reverse()) as typeof remote.keyEnvelope;
  remote.keyEnvelope.kdf = Object.fromEntries(Object.entries(remote.keyEnvelope.kdf).reverse()) as typeof remote.keyEnvelope.kdf;
  assert.equal(await vaultKeyFingerprint(remote.keyEnvelope), await vaultKeyFingerprint(f.keyEnvelope));
  f.setVault(remote);
  const resumed = f.client(); assert.equal(await resumed.tryAutoUnlock(), true);
  assert.equal((await resumed.request<{ data: AppData }>('/export')).data.profile!.name, changed.profile!.name);
  assert.equal(f.store.record!.expiresAt, start + DEVICE_UNLOCK_LIFETIME_MS);
});

test('page departure clears memory while preserving opt-in; manual lock, disable, logout, and logout-all revoke it', async () => {
  for (const action of ['hide', 'disable', 'logout', 'logout-all'] as const) {
    const f = await fixture({ legacy: action === 'logout-all' }); await f.seed();
    const client = f.client(); assert.equal(await client.tryAutoUnlock(), true);
    client.lock({ preserveAutoUnlock: true }); assert.equal(client.getState().locked, true);
    assert.equal(await client.tryAutoUnlock(), true);
    if (action === 'hide') client.lock();
    if (action === 'disable') await client.setAutoUnlockPreference(false);
    if (action === 'logout') await client.logout();
    if (action === 'logout-all') await client.logoutAll(password);
    assert.deepEqual(await client.getAutoUnlockPreference(), { enabled: false, expiresAt: null });
    assert.equal(await f.client().tryAutoUnlock(), false);
    assert.equal(client.getState().locked, action !== 'disable');
  }
});

test('storage denial fails closed; disable reports failure when durable revocation fails', async () => {
  const f = await fixture(); await f.seed(); f.store.unavailable = true;
  assert.equal(await f.client().tryAutoUnlock(), false);
  assert.equal((await f.client().getAutoUnlockPreference()).enabled, false);
  f.store.unavailable = false; await f.seed(); f.store.failRevocation = true;
  const client = f.client();
  await assert.rejects(client.setAutoUnlockPreference(false), /could not be removed/);
  client.lock(); assert.equal(client.getState().locked, true);
});

test('late automatic resume cannot reopen after same-tab lock or another tab disables the grant', async () => {
  for (const peer of [false, true]) {
    const f = await fixture(); await f.seed(); const client = f.client(), held = f.holdVault();
    const opening = client.tryAutoUnlock(); await held.started.promise;
    if (peer) await f.client().setAutoUnlockPreference(false); else client.lock();
    held.finish.resolve(); assert.equal(await opening, false);
    assert.equal(client.getState().locked, true); assert.equal(f.store.record, null);
  }
});

test('a server session revoked between vault fetch and final publication cannot reveal records', async () => {
  const f = await fixture(); await f.seed(); let sessions = 0;
  f.onSession(() => { if (++sessions === 2) f.expire(); });
  const client = f.client(); assert.equal(await client.tryAutoUnlock(), false);
  assert.equal(client.getState().locked, true); assert.equal(f.store.record, null);
});

test('a wrapper changed after the first authorized vault fetch cannot resume even when its legacy session remains valid', async () => {
  const f = await fixture({ legacy: true }); await f.seed(); let sessions = 0;
  f.onSession(() => {
    if (++sessions === 2) {
      const updated = f.getVault(); updated.revision++;
      updated.keyEnvelope.iv = Buffer.alloc(12, 55).toString('base64url'); f.setVault(updated);
    }
  });
  const client = f.client(); assert.equal(await client.tryAutoUnlock(), false);
  assert.equal(client.getState().locked, true); assert.equal(f.store.record, null);
});

test('explicit password unlock enables fixed seven-day persistence; recovery-only unlock cannot enroll', async () => {
  const f = await fixture({ legacy: true }), client = f.client(); await client.session();
  await client.unlockVault({ recoveryKey: f.recoveryKey });
  await assert.rejects(client.setAutoUnlockPreference(true), /Confirm your password/);
  client.lock(); await client.unlockVault({ vaultPassphrase: password });
  f.advance(12345); await client.setAutoUnlockPreference(true);
  assert.equal(f.store.record!.createdAt, start); assert.equal(f.store.record!.expiresAt, start + DEVICE_UNLOCK_LIFETIME_MS);
  await client.setAutoUnlockPreference(true); assert.equal(f.store.record!.expiresAt, start + DEVICE_UNLOCK_LIFETIME_MS);
  await client.setAutoUnlockPreference(false); assert.equal(client.getState().locked, false);
  await assert.rejects(client.setAutoUnlockPreference(true), /Confirm your password/);
});

test('storage denial does not prevent password unlocking but cannot grant enrollment after storage returns', async () => {
  const f = await fixture({ legacy: true }), client = f.client();
  f.store.unavailable = true; await client.session(); await client.unlockVault({ vaultPassphrase: password });
  assert.equal(client.getState().locked, false);
  f.store.unavailable = false;
  await assert.rejects(client.setAutoUnlockPreference(true), /Confirm your password/);
  await client.request('/auth/verify-password', 'POST', { password });
  await client.setAutoUnlockPreference(true); assert.ok(f.store.record);
});

test('queued or in-flight enrollment cannot override a newer disable or manual lock', async () => {
  for (const action of ['disable', 'lock', 'peer'] as const) {
    const f = await fixture({ legacy: true }), client = f.client(); await client.session(); await client.unlockVault({ vaultPassphrase: password });
    const started = deferred(), finish = deferred(); f.store.beforeSave = async () => { started.resolve(); await finish.promise; };
    const enabling = client.setAutoUnlockPreference(true); const rejected = assert.rejects(enabling);
    await started.promise;
    if (action === 'disable') await client.setAutoUnlockPreference(false);
    if (action === 'lock') client.lock();
    if (action === 'peer') await f.client().setAutoUnlockPreference(false);
    finish.resolve(); await rejected;
    assert.equal(f.store.record, null); assert.equal(await f.client().tryAutoUnlock(), false);
  }
  const f = await fixture({ legacy: true }), client = f.client(); await client.session(); await client.unlockVault({ vaultPassphrase: password });
  const held = f.holdVault(), refresh = client.request('/data'); await held.started.promise;
  const enabling = client.setAutoUnlockPreference(true), rejected = assert.rejects(enabling);
  await client.setAutoUnlockPreference(false); held.finish.resolve(); await refresh; await rejected;
  assert.equal(f.store.record, null);
});

test('a peer disable while enrollment waits for remote validation or an earlier save cannot be overwritten', async () => {
  for (const queued of [false, true]) {
    const f = await fixture({ legacy: true }), client = f.client(); await client.session(); await client.unlockVault({ vaultPassphrase: password });
    const held = f.holdVault();
    const refresh = queued ? client.request('/data') : null;
    if (refresh) await held.started.promise;
    const enabling = client.setAutoUnlockPreference(true), rejected = assert.rejects(enabling);
    if (!refresh) await held.started.promise;
    await f.client().setAutoUnlockPreference(false); held.finish.resolve();
    if (refresh) await refresh;
    await rejected; assert.equal(f.store.record, null);
    assert.equal(await f.client().tryAutoUnlock(), false);
  }
});

test('password verification grants fresh enrollment without resetting records; later security changes revoke it', async () => {
  const f = await fixture({ legacy: true }); await f.seed(); const client = f.client(); assert.equal(await client.tryAutoUnlock(), true);
  f.advance(60000); await assert.rejects(client.request('/auth/verify-password', 'POST', { password: 'wrong' }));
  await assert.rejects(client.setAutoUnlockPreference(true), /Confirm your password/);
  await client.request('/auth/verify-password', 'POST', { password });
  await client.setAutoUnlockPreference(true); assert.equal(f.store.record!.createdAt, f.now());
  assert.deepEqual((await client.request<{ data: AppData }>('/export')).data, data());
  await client.changeVaultPassword({ vaultPassphrase: password }, 'Synthetic amber! orchard glacier 9342', password);
  assert.equal(f.store.record, null); assert.equal(client.getState().locked, false);
});

test('a delayed old-session 401 cannot cancel a newer password login and its queued unlock', async () => {
  const f = await fixture({ legacy: true }), client = f.client(); await client.session(); await client.unlockVault({ vaultPassphrase: password });
  const held = f.holdVault(); f.failNextVault(401);
  const expired = client.request('/data'), rejected = assert.rejects(expired);
  await held.started.promise; client.lock();
  await client.login('synthetic.owner', 'Synthetic legacy account password');
  const unlocking = client.unlockVault({ vaultPassphrase: password });
  held.finish.resolve(); await rejected; await unlocking;
  assert.equal(client.getState().locked, false);
  await client.setAutoUnlockPreference(true); assert.ok(f.store.record);
});

test('peer disable during or immediately after Settings password confirmation invalidates its enrollment entitlement', async () => {
  for (const during of [true, false]) {
    const f = await fixture({ legacy: true }); await f.seed(); const client = f.client(); assert.equal(await client.tryAutoUnlock(), true);
    if (during) {
      const held = f.holdVault(), confirmation = client.request('/auth/verify-password', 'POST', { password });
      const rejected = assert.rejects(confirmation, /disabled while your password/);
      await held.started.promise; await f.client().setAutoUnlockPreference(false); held.finish.resolve(); await rejected;
    } else {
      await client.request('/auth/verify-password', 'POST', { password });
      await f.client().setAutoUnlockPreference(false);
    }
    await assert.rejects(client.setAutoUnlockPreference(true), /Confirm your password/);
    assert.equal(f.store.record, null); assert.equal(client.getState().locked, false);
  }
});
