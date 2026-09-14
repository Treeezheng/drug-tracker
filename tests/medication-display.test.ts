import test from 'node:test';
import assert from 'node:assert/strict';
import { getProduct } from '../src/lib/catalog.ts';
import { groupMedicationProducts, medicationDisplay, medicationVariantGroup } from '../src/lib/medication-display.ts';
import { favoriteSelection, favoriteChanges } from '../src/lib/favorite-selection.ts';
import { selectGroupStrength, groupStrengthSelected } from '../src/lib/grouped-favorite-selection.ts';
import { newDose, selectDoseMedication } from '../src/components/DoseEditor.tsx';
import { modelGroup } from '../src/lib/model.ts';

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

test('explicit Ritalin strength selection creates its exact favorite without rewriting Generic or transferring evidence', () => {
  const group=groupMedicationProducts([getProduct('methylphenidate-ir'),getProduct('ritalin')])[0];
  const existing=[{id:'generic-saved',productId:'methylphenidate-ir',strength:'10',packageStrength:'10',quantity:'1.5',revision:4}];
  const before=structuredClone(existing),selection=favoriteSelection(existing),brand=medicationVariantGroup(group,'ritalin');
  assert.equal(groupStrengthSelected(selection,brand,'10'),false);
  const next=selectGroupStrength(selection,existing,brand,'10',true,()=> 'new-ritalin');
  assert.deepEqual(favoriteChanges(existing,next).map(change=>[change.type,change.favorite.productId]),[['save','ritalin']]);
  const all=[...next.values()],blank={...newDose(),productId:'',strength:'',packageStrength:'',amountMg:''};
  const ritalin=selectDoseMedication(blank,'ritalin',all,'UTC'),generic=selectDoseMedication(blank,'methylphenidate-ir',all,'UTC');
  assert.equal(ritalin.productId,'ritalin');assert.equal(ritalin.amountMg,'10');assert.equal(modelGroup(ritalin).reference,true);
  assert.equal(generic.productId,'methylphenidate-ir');assert.equal(generic.quantity,'1.5');assert.equal(generic.amountMg,'15');assert.equal(modelGroup(generic).reference,false);
  assert.deepEqual(existing,before);assert.equal(group.products.length,2);
  assert.throws(()=>medicationVariantGroup(group,'concerta'),/Choose a product/);
});
