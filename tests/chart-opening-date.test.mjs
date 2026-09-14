import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { instantToLocal } from '../src/lib/time.ts';
import { freshGuestWorkspace } from '../src/lib/guest-workspace.ts';

const instant = '2026-09-14T01:00:00Z';
const todayInZone = zone => instantToLocal(instant, zone).date;

// Execute the components' actual initialization/load callbacks in isolation.
// These fixtures have no server, browser storage, medical data or active timers.
function declaration(path, name) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && (node.name.getText(source) === name ||
      (ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.name?.getText(source) === name))) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(found, name);
  return { node: found, source };
}
function evaluate(expression, context) {
  const exports = {};
  const code = ts.transpileModule(`exports.callback = ${expression};`, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  runInNewContext(code, { exports, ...context });
  return exports.callback;
}
const dose = {
  id: 'synthetic-old-dose', productId: 'ritalin', productName: 'Ritalin IR',
  administeredAt: '2020-01-02T16:03:00Z', date: '2020-01-02', time: '08:03',
  timeZone: 'America/Los_Angeles', status: 'simulated', note: 'Synthetic date fixture',
};

test('a fresh guest mount starts today in its restored zone without rewriting stored doses or snapshot', () => {
  const { node, source } = declaration('../src/components/GuestSimulator.tsx', 'workspace');
  assert.equal(node.initializer.expression.getText(source), 'useState');
  assert.ok(ts.isArrowFunction(node.initializer.arguments[0]), 'The opening date is a one-time state initializer.');
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    const workspace = { ...freshGuestWorkspace(zone), date: '2020-01-02', drafts: [structuredClone(dose)], days: 3 };
    const before = structuredClone(workspace);
    const initialize = evaluate(node.initializer.arguments[0].getText(source), { loaded: { workspace }, todayInZone });
    const opened = initialize();
    assert.equal(opened.date, todayInZone(zone));
    assert.equal(opened.days, 3);
    assert.deepEqual(opened.drafts, before.drafts);
    assert.deepEqual(workspace, before, 'Stored snapshot and its conflict-check identity are unchanged.');
  }
});

test('first remembered-storage consent keeps a chosen chart day, otherwise opens today in the restored zone', async () => {
  const path = '../src/components/GuestSimulator.tsx';
  const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'acceptGuestConsent') callback = node;
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(callback);
  for (const chosen of [false, true]) {
    const saved = { ...freshGuestWorkspace('Asia/Tokyo'), date: '2020-01-02', drafts: [structuredClone(dose)] };
    const before = structuredClone(saved), snapshot = { current: null };
    let opened;
    const accept = evaluate(callback.getText(source).replace('async function acceptGuestConsent', 'async function'), {
      adult: true, consentBusy: false, chooseStorage: true, live: { current: true }, window: { localStorage: {} },
      withGuestStorageLock: async operation => operation(), rememberGuestChoice: () => saved,
      date: '2026-08-02', viewDateChosen: { current: chosen }, todayInZone, deviceSnapshot: snapshot,
      setWorkspace: value => { opened = value; },
      ...Object.fromEntries(['setConsentBusy', 'setSettingsEpoch', 'setSubmittedIds', 'setRemember', 'setBlocked', 'setStorageError', 'setConsented', 'setGuestConsent'].map(name => [name, () => {}])),
    });
    await accept();
    assert.equal(opened.date, chosen ? '2026-08-02' : '2026-09-14');
    assert.deepEqual(opened.drafts, before.drafts);
    assert.deepEqual(saved, before);
    assert.equal(snapshot.current, saved, 'The original saved snapshot remains the storage conflict-check baseline.');
  }
});

function accountFixture() {
  const { node, source } = declaration('../src/App.tsx', 'fetchAccount');
  const state = { date: 'browser-initial-date', days: 1 }, account = { current: null }, generation = { current: 0 };
  let incoming = null;
  const setters = Object.fromEntries(['Data', 'Profile', 'User', 'Pending', 'Busy', 'Editing', 'ConfirmingDose', 'ChoosingMoreDose', 'DeletingDose', 'Drafts', 'Days', 'Date'].map(name => [
    `set${name}`, value => { state[name[0].toLowerCase() + name.slice(1)] = value; },
  ]));
  const load = evaluate(node.initializer.arguments[0].getText(source), {
    account, generation, ...setters, todayInZone, localZone: 'UTC', defaultProfile: () => freshGuestWorkspace('UTC').profile,
    api: async () => structuredClone(incoming), cacheData: async (_, data) => data, queueCount: async () => 0,
    dataRef: { current: null }, workspace: { current: null }, pendingWorkspace: { current: null },
    pendingDoseWrites: { current: new Map() }, doseWork: { current: false },
  });
  return { state, async load(user, data, transition = false) { incoming = data; return load(user, transition); } };
}
function accountData(zone = 'Asia/Tokyo') {
  return {
    profile: freshGuestWorkspace(zone).profile, doses: [structuredClone(dose)], favorites: [], checkins: [],
    scenarios: [{ id: 'synthetic-workspace', name: 'Workspace', modelVersion: 'fixture-model', doses: [structuredClone(dose)],
      view: { date: '2020-01-02', days: 3, timeZone: zone, publishedOnly: false } }],
  };
}

test('opening an account selects today in its profile zone and preserves historical dose timestamps', async () => {
  const view = accountFixture(), data = accountData(), before = structuredClone(data);
  await view.load({ id: 'synthetic-owner' }, data, true);
  assert.equal(view.state.date, '2026-09-14');
  assert.equal(view.state.days, 3);
  assert.deepEqual(view.state.data.doses, before.doses);
  assert.equal(view.state.drafts[0].administeredAt, dose.administeredAt);
  assert.equal(view.state.drafts[0].date, dose.date);
  assert.deepEqual(data, before);
});

test('refresh and same-account import retain the chosen date; opening a different account starts today', async () => {
  const view = accountFixture(), user = { id: 'synthetic-owner' }, data = accountData();
  await view.load(user, data, true);
  view.state.date = '2026-08-02';
  await view.load(user, data);
  assert.equal(view.state.date, '2026-08-02');
  await view.load(user, data, true);
  assert.equal(view.state.date, '2026-08-02');
  await view.load({ id: 'synthetic-other-owner' }, accountData('America/Los_Angeles'), true);
  assert.equal(view.state.date, '2026-09-13');
});

test('an account without a saved Workspace still initializes today in its own zone', async () => {
  const view = accountFixture(), data = accountData('America/Los_Angeles');
  data.scenarios = [];
  await view.load({ id: 'synthetic-owner' }, data, true);
  assert.equal(view.state.date, '2026-09-13');
  assert.equal(view.state.drafts.length, 0);
});
