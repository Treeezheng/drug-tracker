import test from 'node:test';
import assert from 'node:assert/strict';
import { getProduct } from '../src/lib/catalog.ts';
import { groupMedicationProducts, medicationDisplay } from '../src/lib/medication-display.ts';

test('only the two specific immediate-release tablet entries share a display name', () => {
  assert.deepEqual(medicationDisplay(getProduct('ritalin')), { groupId: 'methylphenidate-ir-display', title: 'Methylphenidate IR', variant: 'Ritalin', label: 'Methylphenidate IR · Ritalin' });
  assert.deepEqual(medicationDisplay(getProduct('methylphenidate-ir')), { groupId: 'methylphenidate-ir-display', title: 'Methylphenidate IR', variant: 'Generic', label: 'Methylphenidate IR · Generic' });
  for (const id of ['ritalin-la', 'concerta', 'methylin-solution', 'methylphenidate-chewable', 'focalin']) {
    const p = getProduct(id); assert.deepEqual(medicationDisplay(p), { groupId: id, title: p.name, label: p.name });
  }
  assert.deepEqual(medicationDisplay({ id: 'unknown-old-brand', name: 'Saved historical name' }), { groupId: 'unknown-old-brand', title: 'Saved historical name', label: 'Saved historical name' });
});

test('grouping preserves first appearance, product objects, identities and independent model evidence', () => {
  const generic = Object.freeze({ ...getProduct('methylphenidate-ir') }), brand = Object.freeze({ ...getProduct('ritalin') }), capsule = Object.freeze({ ...getProduct('ritalin-la') });
  const input = Object.freeze([capsule, generic, brand]), before = JSON.stringify(input);
  const groups = groupMedicationProducts(input);
  assert.deepEqual(groups.map(group => group.id), ['ritalin-la', 'methylphenidate-ir-display']);
  assert.equal(groups[1].products[0], generic); assert.equal(groups[1].products[1], brand);
  assert.equal(groups[1].products[0].model, 'assumption'); assert.equal(groups[1].products[0].evidence, 'D');
  assert.equal(groups[1].products[1].model, 'ritalin'); assert.equal(groups[1].products[1].evidence, 'B');
  assert.equal(JSON.stringify(input), before);
});
