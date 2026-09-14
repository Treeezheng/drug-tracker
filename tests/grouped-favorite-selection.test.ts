import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { products, getProduct } from '../src/lib/catalog.ts';
import { favoriteChanges, favoriteSelection } from '../src/lib/favorite-selection.ts';
import { groupStrengthSelected, groupStrengths, selectGroupStrength, selectedGroupCount } from '../src/lib/grouped-favorite-selection.ts';
import { groupMedicationProducts, matchesMedicationGroup } from '../src/lib/medication-display.ts';
import { parseCustomStrength } from '../src/lib/package-strength.ts';
import DoseEditor, { newDose } from '../src/components/DoseEditor.tsx';
import type { Favorite, Profile } from '../src/lib/types.ts';
const group=groupMedicationProducts(products).find(g=>g.title==='Methylphenidate IR')!;
const saved:Favorite[]=[
  {id:'brand',productId:'ritalin',packageStrength:'10.00',strength:'10.00',quantity:'1.5',revision:7},
  {id:'generic',productId:'methylphenidate-ir',packageStrength:'10',strength:'10',quantity:'1',revision:4},
  {id:'five',productId:'ritalin',packageStrength:'5',strength:'5',quantity:'1',revision:3},
];
test('one visible strength retains all historical IDs and makes an unchanged save a no-op',()=>{
  const selection=favoriteSelection(saved);
  assert.equal(selectedGroupCount(selection),2);
  assert.deepEqual(groupStrengths(group,saved,selection),['5','10','20']);
  assert.equal(groupStrengthSelected(selection,group,'10'),true);
  assert.deepEqual(favoriteChanges(saved,selection),[]);
  const off=selectGroupStrength(selection,saved,group,'10',false);
  assert.deepEqual(favoriteChanges(saved,off).map(c=>c.favorite.id),['brand','generic']);
  assert.equal(groupStrengthSelected(off,group,'5'),true);
  const restored=selectGroupStrength(off,saved,group,'10.000',true,()=>{throw new Error('Do not replace snapshots');});
  assert.deepEqual(favoriteChanges(saved,restored),[]);
  for(const favorite of saved)assert.ok([...restored.values()].includes(favorite));
});
test('custom choices normalize, remain visible, deduplicate and use generic without changing old stock identities',()=>{
  const strength=parseCustomStrength(group.defaultProduct,' 007.500 ');
  const selection=selectGroupStrength(favoriteSelection(saved),saved,group,strength,true,()=> 'custom');
  const changes=favoriteChanges(saved,selection);
  assert.equal(changes.length,1);assert.equal(changes[0].favorite.productId,'methylphenidate-ir');
  assert.equal(changes[0].favorite.packageStrength,'7.5');
  assert.ok(groupStrengths(group,saved,selection).includes('7.5'));
  assert.equal(selectedGroupCount(selection),3);
  const again=selectGroupStrength(selection,saved,group,'7.5000',true,()=>{throw new Error('Duplicate custom');});
  assert.equal(again,selection);
  const reopened=favoriteSelection([...saved,changes[0].favorite]);
  assert.equal(groupStrengthSelected(reopened,group,'7.5'),true);
  assert.equal(getProduct(changes[0].favorite.productId).model,'assumption');
});
test('brand search keeps the complete group and all generic strengths',()=>{
  for(const query of ['ritalin','METHYLPHENIDATE','immediate-release'])assert.equal(matchesMedicationGroup(group,query),true);
  assert.equal(matchesMedicationGroup(group,'Concerta'),false);
  assert.equal(group.products.length,2);
});
test('dose dropdown offers one entry while preserving the active branded product ID',()=>{
  const profile:Profile={name:'',timeZone:'America/Los_Angeles',timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
  const html=renderToStaticMarkup(createElement(DoseEditor,{dose:newDose('ritalin','10'),index:0,profile,productIds:['ritalin','methylphenidate-ir'],onChange:()=>{}}));
  const select=html.match(/<select aria-label="Dose 1 medication"[\s\S]*?<\/select>/)![0];
  assert.match(select,/<option value="ritalin" selected="">Methylphenidate IR<\/option>/);
  assert.doesNotMatch(select,/value="methylphenidate-ir"/);
});
