import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as catalog from '../src/lib/catalog.ts';
import * as model from '../src/lib/model.ts';
import * as time from '../src/lib/time.ts';
import * as display from '../src/lib/medication-display.ts';
import * as modelSupport from '../src/lib/medication-model-support.ts';
import * as strength from '../src/lib/package-strength.ts';
import * as favorites from '../src/lib/favorites.ts';

// Exercise the real editor callbacks with synthetic records and isolated hooks.
function fixture(initialFavorites = []) {
  const react = {
    useRef: value => ({ current: value }),
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useEffect() {}, useLayoutEffect() {},
  };
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': {},
    '../lib/catalog': catalog, '../lib/model': model, '../lib/time': time,
    '../lib/medication-display': display, '../lib/package-strength': strength,
    '../lib/medication-model-support': modelSupport,
    '../lib/favorites': favorites, '../lib/scroll-position': { captureScrollPosition: () => () => {} },
    './TimelineChart': { colors: ['#426a95'] }, './MobileTimePicker': { default: 'TimePicker' },
    './DoseFormula': { default: 'DoseFormula' },
  };
  const exported = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/components/DoseEditor.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports: exported, crypto, require(name) { assert.ok(name in modules, name); return modules[name]; } });
  let completion;
  const changes = [];
  const original = { ...exported.newDose('methylphenidate-ir', '10'), id: 'same-row', administeredAt: '2026-09-10T08:35:00Z', note: 'Keep this note' };
  const props = {
    dose: original, index: 0, favorites: initialFavorites, productIds: ['methylphenidate-ir'],
    profile: { timeZone: 'UTC', timeFormat: '24h', timeIncrementMinutes: 5 },
    onMoreMedications: callback => { completion = callback; }, onChange: dose => { changes.push(dose); props.dose = dose; },
  };
  const find = predicate => nodes(exported.default(props), predicate)[0];
  return { original, props, changes, find, complete: selection => completion?.(selection),
    other() {
      const input = { value: '__other__' };
      find(node => node.type === 'select' && node.props['aria-label'] === 'Dose 1 medication').props.onChange({ target: input, currentTarget: input });
      return input.value;
    },
  };
}
function nodes(node, predicate) {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(value => nodes(value, predicate));
  if (typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const favorite = (productId, packageStrength) => ({ id: `${productId}-${packageStrength}`, productId, strength: packageStrength, packageStrength, quantity: '1' });

test('Medication Other waits for picker Save, restores its value, then selects the first new saved strength on the same row', () => {
  const old = favorite('methylphenidate-ir', '10'), view = fixture([old]);
  assert.equal(view.other(), 'methylphenidate-ir');
  assert.equal(view.changes.length, 0, 'Opening or cancelling the picker cannot alter a dose.');
  view.complete([old, favorite('concerta', '27'), favorite('concerta', '36')]);
  assert.equal(view.changes.length, 1);
  assert.equal(view.props.dose.id, 'same-row');
  assert.equal(view.props.dose.productId, 'concerta');
  assert.equal(view.props.dose.packageStrength, '27');
  assert.equal(view.props.dose.administeredAt, view.original.administeredAt);
  assert.equal(view.props.dose.note, view.original.note);
});

test('saving an unchanged picker preserves the dose; a generic tablet plus button records 1.5 exactly', () => {
  const old = favorite('methylphenidate-ir', '10'), view = fixture([old]);
  view.other(); view.complete([{ ...old, packageStrength: '10.00' }]);
  assert.equal(view.changes.length, 0);
  const plus = view.find(node => node.type === 'button' && node.props['aria-label'] === 'Increase Dose 1 quantity by 0.5 tablet');
  assert.ok(plus); plus.props.onClick({ currentTarget: {} });
  assert.equal(view.props.dose.quantity, '1.5');
  assert.equal(view.props.dose.amountMg, '15');
  assert.equal(view.props.dose.unusual, undefined);
});
