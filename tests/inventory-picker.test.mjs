import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as catalog from '../src/lib/catalog.ts';
import * as favorites from '../src/lib/favorites.ts';
import * as selection from '../src/lib/favorite-selection.ts';
import * as groups from '../src/lib/grouped-favorite-selection.ts';
import * as display from '../src/lib/medication-display.ts';
import * as strength from '../src/lib/package-strength.ts';
import * as inventory from '../src/lib/inventory.ts';
import * as time from '../src/lib/time.ts';

// Render the actual Inventory and FavoritePicker callbacks with isolated React
// hooks. Synthetic records only; no browser, storage, account or network service.
function fixture(initial = [], saveFavorite) {
  let activeHooks, activeIndex;
  const react = {
    useState(initialValue) {
      const hooks = activeHooks, index = activeIndex++;
      if (!(index in hooks)) hooks[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
    },
    useRef(value) { return react.useState(() => ({ current: value }))[0]; },
    useId() { return react.useState(() => `synthetic-${activeIndex}`)[0]; },
    useEffect() {},
  };
  const jsx = (type, props) => ({ type, props });
  function component(path, extra = {}) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const exported = {};
    const modules = {
      react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': {},
      '../lib/catalog': catalog, '../lib/favorites': favorites,
      '../lib/favorite-selection': selection, '../lib/grouped-favorite-selection': groups,
      '../lib/medication-display': display, '../lib/package-strength': strength,
      '../lib/inventory': inventory, '../lib/time': time,
      './MedicationName': { medicationLabel: (_, name) => name }, './Modal': { default: 'Modal' }, ...extra,
    };
    runInNewContext(code, { exports: exported, crypto, require(name) {
      assert.ok(name in modules, `Unexpected dependency: ${name}`);
      return modules[name];
    } });
    return exported.default;
  }
  const Picker = component('../src/components/FavoritePicker.tsx');
  const Inventory = component('../src/components/Inventory.tsx', { './FavoritePicker': { default: Picker } });
  const saved = [], added = [], removed = [];
  const props = {
    receipts: [], doses: [], favorites: initial,
    profile: { timeZone: 'UTC', timeFormat: '24h' },
    async onSave(receipt) { saved.push(receipt); }, async onRemove() {},
    async onFavorite(favorite) {
      added.push(favorite);
      const stored = saveFavorite ? await saveFavorite(favorite) : favorite;
      props.favorites = favorites.upsertFavorite(props.favorites, stored);
    },
    async onRemoveFavorite(favorite) {
      removed.push(favorite);
      props.favorites = props.favorites.filter(value => value.id !== favorite.id);
    },
  };
  const inventoryHooks = [];
  let pickerHooks = [];
  function render(renderComponent, renderProps, hooks) {
    activeHooks = hooks; activeIndex = 0;
    return renderComponent(renderProps);
  }
  const tree = () => render(Inventory, props, inventoryHooks);
  const find = predicate => nodes(tree(), predicate)[0];
  const supplySelect = () => find(node => node.type === 'select');
  function picker() {
    const node = find(node => node.type === Picker);
    return node ? render(Picker, node.props, pickerHooks) : null;
  }
  return {
    saved, added, removed, props, tree, picker, find, supplySelect,
    choose(value) { supplySelect().props.onChange({ target: { value } }); },
    other() { pickerHooks = []; supplySelect().props.onChange({ target: { value: 'other' } }); },
    setDraft() {
      find(node => node.type === 'input' && node.props.type === 'date').props.onInput({ currentTarget: { value: '2026-01-02' } });
      find(node => node.type === 'input' && node.props.type === 'number').props.onChange({ target: { value: '30.5' } });
      find(node => node.type === 'input' && node.props.placeholder === 'Refill or starting stock').props.onChange({ target: { value: 'Synthetic refill note' } });
    },
    toggle(label, checked) {
      const input = nodes(picker(), node => node.type === 'input' && node.props['aria-label'] === label)[0];
      assert.ok(input, label); input.props.onChange({ currentTarget: { checked } });
    },
    async saveSelection() {
      const button = nodes(picker(), node => node.type === 'button' && node.props.children === 'Save selection')[0];
      assert.ok(button); button.props.onClick();
      await new Promise(setImmediate);
    },
    cancel() { nodes(picker(), node => node.type === 'button' && node.props.children === 'Cancel')[0].props.onClick(); },
    submit: () => find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }),
  };
}
function nodes(node, predicate) {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(value => nodes(value, predicate));
  if (typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
function assertDraft(view) {
  assert.equal(view.find(node => node.type === 'input' && node.props.type === 'date').props.value, '2026-01-02');
  assert.equal(view.find(node => node.type === 'input' && node.props.type === 'number').props.value, '30.5');
  assert.equal(view.find(node => node.type === 'input' && node.props.placeholder === 'Refill or starting stock').props.value, 'Synthetic refill note');
}
const existing = { id: 'old-favorite', productId: 'methylphenidate-ir', strength: '10', packageStrength: '10', quantity: '1' };

test('Other opens the full picker with no favorites; saving picks the new medication but does not save supply', async () => {
  const view = fixture();
  view.setDraft();
  assert.ok(nodes(view.supplySelect(), node => node.type === 'option' && node.props.value === 'other').length);
  view.other();
  assert.equal(view.picker().props.title, 'Choose medications');
  view.toggle('Methylphenidate IR 10 mg', true);
  await view.saveSelection();
  assert.equal(view.picker(), null);
  assert.equal(view.added.length, 1);
  assert.equal(view.saved.length, 0);
  assert.equal(view.supplySelect().props.value, favorites.favoriteKey(view.added[0]));
  assertDraft(view);
  await view.submit();
  assert.equal(view.saved.length, 1);
  assert.equal(view.saved[0].productId, 'methylphenidate-ir');
  assert.equal(view.saved[0].packageStrength, '10');
  assert.equal(view.saved[0].quantity, '30.5');
  assert.equal(view.saved[0].receivedAt, '2026-01-02T00:00:00Z');
  assert.equal(view.saved[0].note, 'Synthetic refill note');
});

test('cancel keeps the previous medication and complete supply draft without writing favorites', () => {
  const view = fixture([existing]);
  view.choose(favorites.favoriteKey(existing));
  view.setDraft(); view.other();
  view.toggle('Methylphenidate IR 20 mg', true);
  view.cancel();
  assert.equal(view.picker(), null);
  assert.equal(view.supplySelect().props.value, favorites.favoriteKey(existing));
  assertDraft(view);
  assert.deepEqual(view.added, []);
  assert.deepEqual(view.removed, []);
  assert.deepEqual(view.saved, []);
});

test('new selection resolves the saved canonical favorite despite an assigned ID and decimal spelling', async () => {
  const view = fixture([existing], async favorite => ({ ...favorite, id: 'canonical-new-id', packageStrength: '20.00' }));
  view.choose(favorites.favoriteKey(existing));
  view.setDraft(); view.other();
  view.toggle('Methylphenidate IR 20 mg', true);
  await view.saveSelection();
  assert.notEqual(view.added[0].id, 'canonical-new-id');
  assert.equal(view.supplySelect().props.value, favorites.favoriteKey(view.added[0]));
  assertDraft(view);
  assert.equal(view.saved.length, 0);
  await view.submit();
  assert.equal(view.saved.length, 1);
  assert.equal(view.saved[0].packageStrength, '20.00');
});

test('equivalent favorites appear once; saving unchanged selection creates no duplicates', async () => {
  const alias = { ...existing, id: 'old-alias', packageStrength: '10.00' };
  const view = fixture([existing, alias]);
  view.choose(favorites.favoriteKey(existing)); view.other();
  await view.saveSelection();
  const options = nodes(view.supplySelect(), node => node.type === 'option' && !['', 'other'].includes(node.props.value));
  assert.equal(options.length, 1);
  assert.equal(view.supplySelect().props.value, favorites.favoriteKey(existing));
  assert.deepEqual(view.added, []);
  assert.deepEqual(view.removed, []);
  assert.deepEqual(view.saved, []);
});

test('the full picker can remove the prior favorite and selects the remaining new favorite', async () => {
  const view = fixture([existing]);
  view.choose(favorites.favoriteKey(existing)); view.setDraft(); view.other();
  view.toggle('Methylphenidate IR 10 mg', false);
  view.toggle('Methylphenidate IR 20 mg', true);
  await view.saveSelection();
  assert.equal(view.removed[0].id, existing.id);
  assert.equal(view.props.favorites.length, 1);
  assert.equal(view.supplySelect().props.value, favorites.favoriteKey(view.props.favorites[0]));
  assert.equal(view.saved.length, 0);
  assertDraft(view);
});
