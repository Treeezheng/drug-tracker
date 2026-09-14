import test from 'node:test';
import assert from 'node:assert/strict';
import { startCloudSessionRestore } from '../src/lib/cloud-session-restore';
import { createCloudClient, type CloudUser } from '../src/lib/cloud-client';

const user: CloudUser = { id: 'synthetic-owner', username: 'synthetic-user', name: 'Synthetic user', authMode: 'opaque-v1' };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function pageshow(events: EventTarget, persisted = true) {
  const event = new Event('pageshow'); Object.defineProperty(event, 'persisted', { value: persisted }); events.dispatchEvent(event);
}
const tick = () => Promise.resolve();

test('restoring an existing cookie requests only session metadata and leaves all encrypted records locked', async () => {
  const calls: { path: string; method: string | undefined; credentials: RequestCredentials | undefined; body: BodyInit | null | undefined }[] = [];
  const client = createCloudClient({ fetch: (async (path, init) => {
    calls.push({ path: String(path), method: init?.method, credentials: init?.credentials, body: init?.body });
    return new Response(JSON.stringify({ user }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch });
  let result: CloudUser | null | undefined, reading!: Promise<CloudUser | null>;
  const lifecycle = startCloudSessionRestore({ events: new EventTarget(), readSession: () => reading = client.session(),
    onLock: () => client.lock(), onSession: value => { result = value; }, onUnavailable: () => assert.fail('Session should be readable.') });
  await reading; await tick();
  assert.deepEqual(result, user);
  assert.deepEqual(client.getState(), { user, locked: true, vaultExists: null, revision: 0 });
  await assert.rejects(client.request('/data'), error => (error as { status: number }).status === 423);
  assert.deepEqual(calls, [{ path: '/drug/api/session', method: 'GET', credentials: 'same-origin', body: undefined }]);
  lifecycle.stop(); client.lock();
});

test('late boot session results cannot replace an explicit register, login or browse choice', async () => {
  for (const choice of ['register', 'login', 'guest']) {
    const pending = deferred<CloudUser | null>(); let stage = 'checking';
    const lifecycle = startCloudSessionRestore({ events: new EventTarget(), readSession: () => pending.promise,
      onLock: () => { stage = 'guest'; }, onSession: value => { stage = value ? 'unlock' : 'guest'; },
      onUnavailable: () => { stage = 'unavailable'; } });
    lifecycle.cancel(); stage = choice; pending.resolve(user); await tick();
    assert.equal(stage, choice);
    lifecycle.stop();
  }
});

test('pagehide immediately locks and bfcache return rechecks expiration without restoring keys', async () => {
  const events = new EventTarget(); let stage = 'checking', locks = 0, requests = 0;
  const values: (CloudUser | null)[] = [user, null];
  const lifecycle = startCloudSessionRestore({ events, readSession: async () => { requests++; return values.shift()!; },
    onLock: () => { locks++; stage = 'guest'; }, onSession: value => { stage = value ? 'unlock' : 'guest'; },
    onUnavailable: () => assert.fail('An expired cookie is a successful null session response.') });
  await tick(); assert.equal(stage, 'unlock');
  pageshow(events, false); await tick(); assert.equal(requests, 1);
  stage = 'open'; events.dispatchEvent(new Event('pagehide'));
  assert.equal(stage, 'guest'); assert.equal(locks, 1);
  pageshow(events); await tick();
  assert.equal(locks, 2); assert.equal(requests, 2); assert.equal(stage, 'guest');
  lifecycle.stop();
});

test('offline checks do not claim sign-out, and canceled or superseded checks remain silent', async () => {
  const events = new EventTarget(), first = deferred<CloudUser | null>(), second = deferred<CloudUser | null>();
  let requests = 0, unavailable = 0, restored = 0, locks = 0;
  const lifecycle = startCloudSessionRestore({ events, readSession: () => ++requests === 1 ? first.promise : second.promise,
    onLock: () => { locks++; }, onSession: () => { restored++; }, onUnavailable: () => { unavailable++; } });
  events.dispatchEvent(new Event('pagehide')); pageshow(events);
  second.reject(new Error('Synthetic network failure')); await tick();
  assert.equal(unavailable, 1); assert.equal(restored, 0); assert.equal(locks, 2);
  first.resolve(user); await tick(); assert.equal(restored, 0);
  lifecycle.stop(); pageshow(events); events.dispatchEvent(new Event('pagehide'));
  assert.equal(requests, 2); assert.equal(locks, 2);

  const stopped = deferred<CloudUser | null>();
  const unmounted = startCloudSessionRestore({ events: new EventTarget(), readSession: () => stopped.promise,
    onLock: () => assert.fail('Unmounted'), onSession: () => assert.fail('Unmounted'), onUnavailable: () => assert.fail('Unmounted') });
  unmounted.stop(); stopped.reject(new Error('Late response after effect cleanup')); await tick();
});
