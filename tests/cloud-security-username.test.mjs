import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createCloudClient } from '../src/lib/cloud-client.ts';

const source = readFileSync(new URL('../src/components/CloudSecuritySettings.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(value => nodes(value, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
function fixture(user) {
  const states = [], refs = [], effects = [], requests = [];
  let stateIndex = 0, refIndex = 0, mounted = false;
  const jsx = (type, props) => ({ type, props });
  const exported = {};
  runInNewContext(code, { exports: exported, require(name) {
    if (name === 'react') return {
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial }; },
      useEffect(effect) { if (!mounted) effects.push(effect); },
    };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (['./Modal', './SettingHelp', './RecoveryKeyPanel'].includes(name)) return { default: name.slice(2) };
    if (name === '../lib/api') return { api: async (...args) => {
      requests.push(args);
      assert.equal(args[0], '/device-unlock'); assert.equal(args[1], 'GET');
      return { enabled: false, expiresAt: null };
    } };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const render = () => { stateIndex = 0; refIndex = 0; return exported.default({ ownerId: user.id, username: user.username }); };
  render(); mounted = true; effects.forEach(effect => effect());
  const find = predicate => nodes(render(), predicate)[0];
  return { requests, render, find, open() { find(node => node.type === 'button' && node.props.children === 'Check username').props.onClick(); } };
}

async function authenticatedUser(username) {
  const calls = [];
  const metadata = { id: 'synthetic-owner', name: 'Different display name', ...(username === undefined ? {} : { username }) };
  const client = createCloudClient({ fetch: async (path, init) => {
    calls.push({ path, init });
    assert.equal(path, '/drug/api/session');
    return new Response(JSON.stringify({ user: metadata }), { headers: { 'Content-Type': 'application/json' } });
  } });
  const result = await client.request('/session');
  return { user: result.user, calls };
}

test('Check username reveals the authenticated session username without a password form or extra request', async () => {
  const { user, calls } = await authenticatedUser('synthetic.login');
  assert.equal(user.name, 'Different display name');
  const view = fixture(user);
  assert.equal(view.find(node => node.type === 'Modal'), undefined);
  const before = view.requests.length;
  view.open();
  const modal = view.find(node => node.type === 'Modal');
  assert.equal(modal.props.title, 'Check username');
  const input = nodes(modal, node => node.type === 'input')[0];
  assert.equal(input.props.type, 'text');
  assert.equal(input.props.value, 'synthetic.login');
  assert.equal(input.props.readOnly, true);
  assert.equal(nodes(modal, node => node.type === 'form' || node.props.type === 'password').length, 0);
  assert.equal(view.requests.length, before);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.body, undefined);
  view.find(node => node.type === 'button' && node.props.children === 'Done').props.onClick();
  assert.equal(view.find(node => node.type === 'Modal'), undefined);
});

test('a session without username reports it unavailable instead of substituting the display name', async () => {
  const { user } = await authenticatedUser(undefined);
  const view = fixture(user); view.open();
  const modal = view.find(node => node.type === 'Modal');
  assert.equal(nodes(modal, node => node.type === 'input').length, 0);
  assert.ok(nodes(modal, node => node.type === 'p' && node.props.children === 'Your username is unavailable for this session.').length);
  assert.equal(JSON.stringify(modal).includes(user.name), false);
});
