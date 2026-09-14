import test from 'node:test';
import assert from 'node:assert/strict';
import { doseIngredientNames, ingredientAmount, exactSumValues, UNRECORDED_INGREDIENT } from '../src/lib/history-amounts.ts';
import type { Dose } from '../src/lib/types.ts';

const base: Dose = {
  id: 'dose', productId: 'adderall-ir', productName: 'Adderall IR', formulation: 'Immediate-release tablet',
  strength: '5', packageStrength: '5', strengthUnit: 'mg', quantity: '1', unit: 'tablet', amountMg: '5',
  amountBasis: 'labeled ingredient', administeredAt: '2026-09-13T08:00:00Z', timeZone: 'UTC', status: 'actual', note: '',
};
const salts = ['dextroamphetamine saccharate', 'amphetamine aspartate monohydrate', 'dextroamphetamine sulfate', 'amphetamine sulfate'];
const current: Dose = { ...base, ingredients: salts.map(name => ({ name, amountMg: '1.25', strengthMg: '1.25', unit: 'mg' })) };

test('mixed current and legacy records never allocate an unknown total to every salt', () => {
  const legacy = { ...base, id: 'legacy' };
  const records = [current, legacy];
  const names = [...new Set(records.flatMap(doseIngredientNames))];
  assert.deepEqual(names, [...salts, UNRECORDED_INGREDIENT]);
  const totals = names.map(name => exactSumValues(records.map(dose => ingredientAmount(dose, name))));
  assert.deepEqual(totals, ['1.25', '1.25', '1.25', '1.25', '5']);
  assert.equal(exactSumValues(totals), '10');
  assert.equal(ingredientAmount(legacy, salts[0]), '0');
});

test('an empty ingredient array has the same explicit unknown bucket as a missing array', () => {
  const empty = { ...base, ingredients: [] };
  assert.deepEqual(doseIngredientNames(empty), [UNRECORDED_INGREDIENT]);
  assert.equal(ingredientAmount(empty, UNRECORDED_INGREDIENT), '5');
  assert.equal(ingredientAmount(empty, 'Adderall IR'), '0');
  assert.equal(ingredientAmount(current, UNRECORDED_INGREDIENT), '0');
});

test('all four named salts retain exact half-tablet amounts and remain separate', () => {
  const half = { ...current, quantity: '0.5', amountMg: '2.5', ingredients: salts.map(name => ({ name, amountMg: '0.625' })) };
  assert.deepEqual(doseIngredientNames(half), salts);
  assert.equal(exactSumValues(salts.map(name => ingredientAmount(half, name))), '2.5');
  assert.equal(ingredientAmount(half, 'amphetamine base'), '0');
});

test('liquid ingredient amounts are summed exactly without substituting mL quantities', () => {
  const liquid = { ...base, productId: 'onyda-xr', productName: 'Onyda XR', formulation: 'Oral suspension', strength: '0.1', packageStrength: '0.1', strengthUnit: 'mg/mL', unit: 'mL' };
  const a = { ...liquid, quantity: '0.3', amountMg: '0.03', ingredients: [{ name: 'clonidine hydrochloride', amountMg: '0.03' }] };
  const b = { ...liquid, quantity: '0.7', amountMg: '0.07', ingredients: [{ name: 'clonidine hydrochloride', amountMg: '0.07' }] };
  assert.equal(exactSumValues([a, b].map(dose => ingredientAmount(dose, 'clonidine hydrochloride'))), '0.1');
  assert.equal(exactSumValues(['0.000000001', '0.000000009', '.5']), '0.50000001');
});

test('legacy first-ingredient and patch amounts are not relabeled as whole-product totals', () => {
  const combination = { ...base, productId: 'azstarys', amountMg: '26.1', amountBasis: 'first listed ingredient' as const };
  const patch = { ...base, productId: 'xelstrym', amountMg: '4.5', unit: 'patch', amountBasis: 'labeled delivery over 9 hours' as const };
  assert.equal(ingredientAmount(combination, UNRECORDED_INGREDIENT), '26.1');
  assert.equal(ingredientAmount(combination, 'dexmethylphenidate'), '0');
  assert.equal(ingredientAmount(patch, UNRECORDED_INGREDIENT), '4.5');
  assert.equal(patch.amountBasis, 'labeled delivery over 9 hours');
});

test('invalid amount strings fail explicitly instead of silently becoming zero', () => {
  for (const value of ['', 'NaN', 'Infinity', '1e-3', '-5', '0.0000000001']) assert.throws(() => exactSumValues([value]));
  assert.equal(exactSumValues([]), '0');
});
