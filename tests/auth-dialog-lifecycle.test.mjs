import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Exercise the component's actual callbacks and cleanup with isolated hooks and
// deferred transport. No browser, database, account or network service is used.
function fixture(onUser = async () => {}) {
  const authentication = deferred(), effects = [], opened = [];
  let stateIndex = 0, closes = 0;
  const source = readFileSync(new URL('../src/components/AuthDialog.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exported = {};
  const jsx = (type, props) => ({ type, props });
  runInNewContext(code, { exports: exported, require(name) {
    if (name === 'react') return {
      useState(initial) {
        const value = stateIndex++ === 0 ? { hasAccount: true, requiresEmail: false }
          : typeof initial === 'function' ? initial() : initial;
        return [value, () => {}];
      },
      useRef(value) { return { current: value }; },
      useEffect(effect) { effects.push(effect); },
    };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (name === './Modal') return { default: 'Modal' };
    if (name === 'lucide-react') return {};
    if (name === '../lib/api') return {
      api: async path => path === '/auth/local-state'
        ? { hasAccount: true, requiresEmail: false } : authentication.promise,
      ApiError: class extends Error {},
    };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const tree = exported.default({ onClose() { closes++; }, async onUser(user) {
    opened.push(user); await onUser(user);
  } });
  const cleanups = effects.map(effect => effect());
  function findForm(node) {
    if (!node) return null;
    if (Array.isArray(node)) return node.map(findForm).find(Boolean);
    if (node.type === 'form') return node;
    return findForm(node.props?.children);
  }
  const form = findForm(tree);
  assert.ok(form);
  return {
    authentication, opened, closes: () => closes,
    submit: () => form.props.onSubmit({ preventDefault() {} }),
    close: () => tree.props.onClose(),
    unmount: () => cleanups.forEach(cleanup => cleanup?.()),
  };
}

const user = { id: 'synthetic-local-user', name: 'Synthetic', email: '' };

test('dismissing a pending local login immediately prevents its late account handoff', async () => {
  const view = fixture(), operation = view.submit();
  view.close(); // Effect cleanup can run later than this event.
  view.authentication.resolve({ user });
  await operation;
  assert.equal(view.closes(), 1);
  assert.deepEqual(view.opened, []);
  view.unmount();
});

test('unmounting a pending local login prevents its late account handoff', async () => {
  const view = fixture(), operation = view.submit();
  view.unmount();
  view.authentication.resolve({ user });
  await operation;
  assert.equal(view.closes(), 0);
  assert.deepEqual(view.opened, []);
});

test('an active local login opens its account once and closes the dialog', async () => {
  const view = fixture(), operation = view.submit();
  view.authentication.resolve({ user });
  await operation;
  assert.deepEqual(view.opened, [user]);
  assert.equal(view.closes(), 1);
  view.unmount();
});

test('once the parent starts loading an account, closing waits for that handoff', async () => {
  const loading = deferred(), started = deferred();
  const view = fixture(async () => { started.resolve(); await loading.promise; });
  const operation = view.submit();
  view.authentication.resolve({ user });
  await started.promise;
  view.close();
  assert.equal(view.closes(), 0);
  loading.resolve();
  await operation;
  assert.equal(view.closes(), 1);
  assert.deepEqual(view.opened, [user]);
  view.unmount();
});
