import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getProduct } from '../src/lib/catalog.ts';
import { groupMedicationProducts, medicationDisplay, medicationVariantGroup } from '../src/lib/medication-display.ts';
import { favoriteSelection, favoriteChanges } from '../src/lib/favorite-selection.ts';
import { selectGroupStrength, groupStrengthSelected } from '../src/lib/grouped-favorite-selection.ts';
import DoseEditor, { doseStrengthChoices, newDose, selectDoseMedication } from '../src/components/DoseEditor.tsx';
import { modelGroup } from '../src/lib/model.ts';
import MedicationName from '../src/components/MedicationName.tsx';
import { medicationBrand } from '../src/lib/medication-display.ts';

test('recognizable brand references appear beneath generic names without altering product identity',()=>{
  for(const [id,brand] of [['amphetamine-salts-ir','Adderall IR'],['methylphenidate-ir','Ritalin'],['dexmethylphenidate-ir','Focalin IR'],['atomoxetine','Strattera'],['clonidine-er','Kapvay']]){
    const product=getProduct(id),before=structuredClone(product);
    const html=renderToStaticMarkup(createElement(MedicationName,{id,name:product.name}));
    assert.equal(medicationBrand(id),brand);assert.ok(html.includes(`title="Brand reference">${brand}</small>`));
    assert.deepEqual(product,before);
  }
  assert.equal(medicationBrand('concerta'),undefined,'No duplicate brand under a product already named Concerta.');
});

test('corresponding brand and generic entries share a display name but distinct formulations do not', () => {
  assert.deepEqual(medicationDisplay(getProduct('ritalin')), { groupId: 'methylphenidate-ir-display', title: 'Methylphenidate IR', variant: 'Ritalin', label: 'Methylphenidate IR · Ritalin' });
  assert.deepEqual(medicationDisplay(getProduct('methylphenidate-ir')), { groupId: 'methylphenidate-ir-display', title: 'Methylphenidate IR', variant: 'Generic', label: 'Methylphenidate IR · Generic' });
  for (const id of ['ritalin-la', 'concerta', 'methylin-solution', 'methylphenidate-chewable', 'mydayis']) {
    const p = getProduct(id); assert.deepEqual(medicationDisplay(p), { groupId: id, title: p.name, label: p.name });
  }
  assert.deepEqual(medicationDisplay({ id: 'unknown-old-brand', name: 'Saved historical name' }), { groupId: 'unknown-old-brand', title: 'Saved historical name', label: 'Saved historical name' });
});

test('every paired formulation has one dose entry, keeps old snapshots, and creates new generic favorites without model transfer',()=>{
  const profile={name:'',timeZone:'UTC',timeFormat:'24h' as const,sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
  for(const [brandId,genericId] of [['ritalin','methylphenidate-ir'],['focalin','dexmethylphenidate-ir'],['focalin-xr','dexmethylphenidate-er'],['adderall-ir','amphetamine-salts-ir'],['adderall-xr','amphetamine-salts-er'],['zenzedi','dextroamphetamine-ir'],['vyvanse-capsule','lisdexamfetamine-capsule'],['vyvanse-chewable','lisdexamfetamine-chewable']]){
    const group=groupMedicationProducts([getProduct(brandId),getProduct(genericId)])[0],strength=group.defaultProduct.strengths[0];
    const original={...newDose(brandId,strength),revision:9,manufacturer:'Preserved package label',note:'Original history'};
    const before=structuredClone(original),favorites=[{id:`old-${brandId}`,productId:brandId,strength,packageStrength:strength,quantity:'2',revision:9},{id:`old-${genericId}`,productId:genericId,strength,packageStrength:strength,quantity:'1',revision:4}];
    assert.deepEqual(favoriteChanges(favorites,favoriteSelection(favorites)),[]);
    assert.deepEqual(doseStrengthChoices(original,favorites),[{productId:brandId,packageStrength:strength}]);
    const html=renderToStaticMarkup(createElement(DoseEditor,{dose:original,index:0,profile,favorites,productIds:[brandId,genericId],onChange:()=>{throw Error('Rendering cannot migrate a record');}}));
    const medication=html.match(/<select aria-label="Dose 1 medication"[\s\S]*?<\/select>/)![0];
    assert.equal((medication.match(/<option/g)||[]).length,2,'One placeholder and one formulation, with no brand choice.');
    assert.ok(medication.includes(`value="${brandId}" selected="">${group.title}</option>`));
    assert.deepEqual(original,before);
    const selected=selectGroupStrength(favoriteSelection([]),[],group,strength,true,()=>`new-${genericId}`),favorite=[...selected.values()][0];
    assert.equal(favorite.productId,genericId);
    const blank={...newDose(),productId:'',strength:'',amountMg:''};
    const next=selectDoseMedication(blank,genericId,[favorite],'UTC');
    assert.equal(next.productId,genericId);assert.equal(next.packageStrength,strength);assert.equal(modelGroup(next).reference,false);
  }
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

test('historical brand favorites remain exact while the unified new-dose entry uses the saved formulation choice', () => {
  const group=groupMedicationProducts([getProduct('methylphenidate-ir'),getProduct('ritalin')])[0];
  const existing=[{id:'generic-saved',productId:'methylphenidate-ir',strength:'10',packageStrength:'10',quantity:'1.5',revision:4}];
  const before=structuredClone(existing),selection=favoriteSelection(existing),brand=medicationVariantGroup(group,'ritalin');
  assert.equal(groupStrengthSelected(selection,brand,'10'),false);
  const next=selectGroupStrength(selection,existing,brand,'10',true,()=> 'new-ritalin');
  assert.deepEqual(favoriteChanges(existing,next).map(change=>[change.type,change.favorite.productId]),[['save','ritalin']]);
  const all=[...next.values()],blank={...newDose(),productId:'',strength:'',packageStrength:'',amountMg:''};
  const ritalin=selectDoseMedication(blank,'ritalin',all,'UTC'),generic=selectDoseMedication(blank,'methylphenidate-ir',all,'UTC');
  assert.equal(ritalin.productId,'methylphenidate-ir');assert.equal(ritalin.amountMg,'15');assert.equal(modelGroup(ritalin).reference,false);
  assert.equal(generic.productId,'methylphenidate-ir');assert.equal(generic.quantity,'1.5');assert.equal(generic.amountMg,'15');assert.equal(modelGroup(generic).reference,false);
  assert.deepEqual(existing,before);assert.equal(group.products.length,2);
  assert.throws(()=>medicationVariantGroup(group,'concerta'),/Choose a product/);
});
