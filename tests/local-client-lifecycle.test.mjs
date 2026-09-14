import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const empty = () => ({ profile: null, doses: [], scenarios: [], favorites: [], checkins: [] });
const owner = 'synthetic-local-lifecycle';
const health = () => ({ ...empty(), doses: [{ id: 'synthetic-dose', note: 'SYNTHETIC PRIVATE RECORD' }] });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}

// Run the actual App callbacks with failed storage and delayed operations. UI
// setters are observed; no browser, real account, or server is involved.
function logoutView({ pending = 0, cleanup = async () => {}, logout = async () => {} } = {}) {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = []; let deleteCallback;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ['signOut', 'resetAccount'].includes(node.name?.text)) declarations.push(node.getText(file));
    if (ts.isJsxAttribute(node) && node.name.text === 'onDelete' && node.initializer && ts.isJsxExpression(node.initializer)) deleteCallback = node.initializer.expression?.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file); assert.equal(declarations.length, 2);
  const effects = [], original = health();
  const context = {
    user: { id: owner }, queueCount: async () => pending, cloud: () => false,
    api: async path => { await logout(); effects.push(path === '/account' ? 'server-delete' : 'server-logout'); },
    clearCache: async (id, discardPending) => { effects.push('device-cleanup'); context.cleanupArgs = { id, discardPending }; await cleanup(); },
    emptyData: empty, defaultProfile: () => ({}), focusNewDose() {},
    generation: { current: 0 }, account: { current: owner }, workspace: { current: {} },
    pendingWorkspace: { current: {} }, pendingDoseWrites: { current: new Map() },
    doseWork: { current: false }, dataRef: { current: original },
    notify: message => effects.push(message), setError: message => effects.push(message),
    setData: data => { context.visible = data; effects.push('hide-records'); },
    setUser: user => { context.user = user; }, visible: original,
  };
  for (const name of ['setBusy', 'setProfile', 'setDrafts', 'setEditing', 'setConfirmingDose', 'setDeletingDose', 'setChoosingFirstDose', 'setChoosingMoreDose', 'setPending']) context[name] = () => {};
  assert.ok(deleteCallback);
  runInNewContext(compile(`${declarations.join('\n')}\nglobalThis.signOut = signOut;\nglobalThis.deleteAccount = (${deleteCallback});`), context);
  return { context, effects, signOut: context.signOut, deleteAccount: context.deleteAccount };
}

test('confirmed logout immediately clears visible records and retained plaintext when IndexedDB cleanup fails', async () => {
  const view = logoutView({ cleanup: async () => { throw new Error('Synthetic storage unavailable'); } });
  await view.signOut();
  assert.equal(view.context.user, null);
  assert.equal(view.context.account.current, null);
  assert.deepEqual(view.context.visible, empty());
  assert.deepEqual(view.context.dataRef.current, empty());
  assert.ok(view.effects.indexOf('hide-records') < view.effects.indexOf('device-cleanup'));
  assert.match(view.effects.at(-1), /Signed out.*pending changes may remain/);
});

test('logout keeps pending work intact and does not claim server logout if preflight or server request fails', async () => {
  for (const options of [{ pending: 1 }, { logout: async () => { throw new Error('Synthetic disconnected local server'); } }]) {
    const view = logoutView(options); await view.signOut();
    assert.equal(view.context.user.id, owner);
    assert.deepEqual(view.context.visible, health());
    assert.equal(view.effects.includes('device-cleanup'), false);
    assert.equal(view.effects.includes('server-logout'), false);
  }
});

test('plaintext is hidden while device cleanup is still pending after successful logout', async () => {
  const cleanup = deferred(), started = deferred();
  const view = logoutView({ cleanup: async () => { started.resolve(); await cleanup.promise; } });
  const operation = view.signOut(); await started.promise;
  assert.equal(view.context.user, null);
  assert.deepEqual(view.context.dataRef.current, empty());
  cleanup.resolve(); await operation;
  assert.equal(view.effects.at(-1), 'Signed out.');
});

test('confirmed account deletion hides plaintext before failed device cleanup and only deletion discards pending work', async () => {
  const view = logoutView({ cleanup: async () => { throw new Error('Synthetic storage unavailable'); } });
  await view.deleteAccount('SYNTHETIC PASSWORD');
  assert.equal(view.context.user, null);
  assert.deepEqual(view.context.visible, empty());
  assert.deepEqual(view.context.dataRef.current, empty());
  assert.ok(view.effects.indexOf('server-delete') < view.effects.indexOf('hide-records'));
  assert.ok(view.effects.indexOf('hide-records') < view.effects.indexOf('device-cleanup'));
  assert.deepEqual(view.context.cleanupArgs, { id: owner, discardPending: true });
  assert.match(view.effects.at(-1), /Local account deleted.*cached records may remain/);
  const logout = logoutView(); await logout.signOut();
  assert.deepEqual(logout.context.cleanupArgs, { id: owner, discardPending: undefined });
});

test('failed account deletion preserves the current account and does not erase its local cache', async () => {
  const view = logoutView({ logout: async () => { throw new Error('Synthetic incorrect password'); } });
  await assert.rejects(view.deleteAccount('SYNTHETIC WRONG PASSWORD'), /incorrect password/);
  assert.equal(view.context.user.id, owner);
  assert.deepEqual(view.context.visible, health());
  assert.equal(view.effects.includes('device-cleanup'), false);
});

// A minimal serial IndexedDB transaction adapter. Each transaction works on its
// own clone and commits or aborts atomically. Two module instances share the
// store to model tabs, while their active-account generations stay independent.
function storageAdapter() {
  let rows = new Map(), queue = Promise.resolve();
  function serial(action) {
    const run = queue.then(action); queue = run.catch(() => {}); return run;
  }
  const store = (_mode, action) => serial(async () => {
    const staged = structuredClone(rows); let reads = 0, aborted = false;
    const transaction = { abort() { aborted = true; queueMicrotask(() => transaction.onabort?.()); } };
    const objectStore = {
      transaction,
      get(key) {
        reads++; const request = {};
        queueMicrotask(() => {
          request.result = structuredClone(staged.get(key)); request.onsuccess?.();
          if (--reads === 0 && !aborted) queueMicrotask(() => { rows = staged; transaction.oncomplete?.(); });
        });
        return request;
      },
      put(value, key) { staged.set(key, structuredClone(value)); },
      delete(key) { staged.delete(key); },
    };
    return action(objectStore);
  });
  return { createStore: () => store, getMany: keys => serial(() => keys.map(key => structuredClone(rows.get(key)))) };
}

function localClient(storage, fetcher) {
  const source = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', "({BASE_URL:'/'})");
  const exports = {};
  runInNewContext(compile(source), { exports, structuredClone, crypto: webcrypto, fetch: fetcher, require(name) {
    if (name === 'idb-keyval') return storage;
    if (name === './favorites') return { dedupeFavorites: value => value };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  exports.setActiveAccount(owner); return exports;
}

test('a delayed local GET cannot recreate another tab’s explicitly cleared health cache', async () => {
  const storage = storageAdapter(), requested = deferred(), response = deferred();
  const first = localClient(storage, async () => { requested.resolve(); return response.promise; });
  const second = localClient(storage, async () => { throw new Error('No network expected'); });
  await first.cacheData(owner, health());
  const loading = first.api('/data', 'GET', undefined, owner); await requested.promise;
  await second.clearCache(owner, true);
  response.resolve(new Response(JSON.stringify(health()), { status: 200 }));
  const stale = await loading;
  await assert.rejects(first.cacheData(owner, stale), error => error.status === 401);
  assert.equal(await first.cachedData(owner), undefined);
});

test('a same-tab account transition invalidates fetched data without deleting another account’s pending work', async () => {
  const storage = storageAdapter(), requested = deferred(), response = deferred();
  const client = localClient(storage, async () => { requested.resolve(); return response.promise; });
  const loading = client.api('/data', 'GET', undefined, owner); await requested.promise;
  client.setActiveAccount('synthetic-other-owner');
  await client.queueMutation('synthetic-other-owner', '/doses/pending', { id: 'pending', note: 'SYNTHETIC UNSYNCED' });
  response.resolve(new Response(JSON.stringify(health()), { status: 200 }));
  await assert.rejects(client.cacheData(owner, await loading), error => error.status === 401);
  assert.equal(await client.cachedData(owner), undefined);
  assert.equal(await client.queueCount('synthetic-other-owner'), 1);
});

test('a current local GET caches its snapshot and overlays intact pending changes', async () => {
  const client = localClient(storageAdapter(), async () => new Response(JSON.stringify(health()), { status: 200 }));
  await client.queueMutation(owner, '/doses/pending', { id: 'pending', note: 'SYNTHETIC UNSYNCED' });
  const current = await client.api('/data', 'GET', undefined, owner);
  const visible = await client.cacheData(owner, current);
  assert.deepEqual(visible.doses.map(row => row.id), ['synthetic-dose', 'pending']);
  assert.equal(await client.queueCount(owner), 1);
});

test('an in-flight local plaintext export is canceled after signout or another tab clears the account', async () => {
  for (const otherTab of [false, true]) {
    const storage = storageAdapter(), requested = deferred(), response = deferred();
    const client = localClient(storage, async () => { requested.resolve(); return response.promise; });
    const peer = localClient(storage, async () => { throw new Error('No network expected'); });
    const exporting = client.api('/export', 'GET', undefined, owner); await requested.promise;
    if (otherTab) await peer.clearCache(owner, true);
    else client.setActiveAccount(null);
    response.resolve(new Response(JSON.stringify({ data: health() }), { status: 200 }));
    await assert.rejects(exporting, error => error.status === 401);
  }
});

test('a current authorized local plaintext export still returns the requested records', async () => {
  const client = localClient(storageAdapter(), async () => new Response(JSON.stringify({ data: health() }), { status: 200 }));
  assert.deepEqual((await client.api('/export', 'GET', undefined, owner)).data, health());
});

test('late pending work survives logout while peer exports and snapshots are revoked, and remains syncable', async () => {
  for (const path of ['/export', '/data']) {
    const storage = storageAdapter(), requested = deferred(), response = deferred();
    const client = localClient(storage, async () => { requested.resolve(); return response.promise; });
    const peer = localClient(storage, async (url, options) => {
      const data = url.endsWith('/session') ? { user: { id: owner } }
        : url.endsWith('/doses/late-pending') ? { ...JSON.parse(options.body), revision: 1 } : {};
      return new Response(JSON.stringify(data), { status: 200 });
    });
    await client.cacheData(owner, health());
    assert.equal(await peer.queueCount(owner), 0, 'Logout preflight sees no pending changes.');
    const loading = client.api(path, 'GET', undefined, owner); await requested.promise;
    await client.queueMutation(owner, '/doses/late-pending', { id: 'late-pending', note: 'SYNTHETIC UNSYNCED WORK' });
    const pending = await client.pendingChanges(owner);
    await peer.api('/auth/logout', 'POST', {});
    await assert.rejects(peer.clearCache(owner), /Pending changes remain/);
    assert.deepEqual(await client.pendingChanges(owner), pending, 'Logout must preserve the exact outbox request.');
    assert.deepEqual((await client.cachedData(owner)).doses.map(row => row.id), ['late-pending'], 'Only unsynced work remains, not the saved snapshot.');
    response.resolve(new Response(JSON.stringify(path === '/export' ? { data: health() } : health()), { status: 200 }));
    if (path === '/export') await assert.rejects(loading, error => error.status === 401);
    else await assert.rejects(client.cacheData(owner, await loading), error => error.status === 401);
    peer.setActiveAccount(owner);
    await peer.syncQueue(owner);
    assert.equal(await peer.queueCount(owner), 0);
    const saved = (await peer.cachedData(owner)).doses;
    assert.deepEqual(saved.map(row => [row.id, row.revision]), [['late-pending', 1]]);
  }
});
