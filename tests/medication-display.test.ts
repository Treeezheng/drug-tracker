import test from 'node:test';
import assert from 'node:assert/strict';
import { getProduct } from '../src/lib/catalog.ts';
import { groupMedicationProducts, medicationDisplay } from '../src/lib/medication-display.ts';

test('corresponding brand and generic entries share a display name but distinct formulations do not', () => {
  assert.deepEqual(medicationDisplay(getProduct('ritalin')), { groupId: 'methylphenidate-ir-display', title: 'Methylphenidate IR', variant: 'Ritalin', label: 'Methylphenidate IR · Ritalin' });
  assert.deepEqual(medicationDisplay(getProduct('methylphenidate-ir')), { groupId: 'methylphenidate-ir-display', title: 'Methylphenidate IR', variant: 'Generic', label: 'Methylphenidate IR · Generic' });
  for (const id of ['ritalin-la', 'concerta', 'methylin-solution', 'methylphenidate-chewable', 'mydayis']) {
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


test('all eight pairs use one display group and default to an unbranded product snapshot', () => {
  for (const [brandId, genericId] of [['ritalin','methylphenidate-ir'],['focalin','dexmethylphenidate-ir'],['focalin-xr','dexmethylphenidate-er'],['adderall-ir','amphetamine-salts-ir'],['adderall-xr','amphetamine-salts-er'],['zenzedi','dextroamphetamine-ir'],['vyvanse-capsule','lisdexamfetamine-capsule'],['vyvanse-chewable','lisdexamfetamine-chewable']]) {
    const groups = groupMedicationProducts([getProduct(brandId), getProduct(genericId)]);
    assert.equal(groups.length, 1); assert.equal(groups[0].products.length, 2);
    assert.equal(groups[0].defaultProduct.id, genericId); assert.ok(groups[0].brand);
    assert.equal(groups[0].defaultProduct.evidence, 'D');
  }
});
