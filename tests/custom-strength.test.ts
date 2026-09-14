import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getProduct } from '../src/lib/catalog.ts';
import { parseCustomStrength } from '../src/lib/package-strength.ts';
import DoseEditor, { newDose, updateDose, updateCustomStrength, doseInputError, quantityStep, resolvePackageStrength } from '../src/components/DoseEditor.tsx';
import { modelGroup } from '../src/lib/model.ts';
import type { Profile } from '../src/lib/types.ts';

const zone='America/Los_Angeles';
const profile:Profile={name:'',timeZone:zone,timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};

test('custom package decimals normalize exactly within the shared persisted bounds',()=>{
  const p=getProduct('ritalin');
  for(const [input,expected] of [[' 007.500 ','7.5'],['.5','0.5'],['7.','7'],['0.000000001','0.000000001'],['999999999999.123456789','999999999999.123456789']])assert.equal(parseCustomStrength(p,input),expected);
  for(const value of ['',' ','0','0.000','-2','+2','1e2','NaN','Infinity','7,5','1 2','1000000000000','0.0000000001','5.0000000000','1/2'])assert.throws(()=>parseCustomStrength(p,value),Error,value);
});

test('combination inputs require all ordered components and never infer a new second amount',()=>{
  const p=getProduct('azstarys');
  assert.equal(parseCustomStrength(p,' 007.50 / 01.20 '),'7.5/1.2');
  assert.equal(resolvePackageStrength(p,'26.1'),'26.1/5.2');
  for(const value of ['7.5','7.5/','/1.2','7.5/0','7.5/1.2/1'])assert.throws(()=>newDose('azstarys',value),Error,value);
  const dose=updateDose(newDose('azstarys','7.5/1.2'),{quantity:'0.5'},zone);
  assert.equal(dose.packageStrength,'7.5/1.2');assert.equal(dose.strength,'7.5');assert.equal(dose.amountMg,'3.75');
  assert.deepEqual(dose.ingredients?.map(i=>({name:i.name,strength:i.strengthMg,amount:i.amountMg})),[
    {name:'serdexmethylphenidate',strength:'7.5',amount:'3.75'},
    {name:'dexmethylphenidate',strength:'1.2',amount:'0.6'},
  ]);
  assert.equal(dose.amountBasis,'first listed ingredient');assert.equal(doseInputError(dose),'');
});

test('four-salt medicine keeps scalar package strength and exact labeled ingredient amounts',()=>{
  const p=getProduct('adderall-ir');
  assert.equal(parseCustomStrength(p,'7.25'),'7.25');
  assert.throws(()=>parseCustomStrength(p,'1/2/3/4'),/one package strength/);
  const dose=updateDose(newDose('adderall-ir','7.25'),{quantity:'0.5'},zone);
  assert.equal(dose.amountMg,'3.625');assert.deepEqual(dose.ingredients?.map(i=>i.amountMg),['0.90625','0.90625','0.90625','0.90625']);
  assert.equal(quantityStep(dose),'1');assert.equal(doseInputError(dose),'');
});

test('custom liquid concentration is mg per mL and exact quantity multiplication does not round',()=>{
  const dose=updateDose(newDose('onyda-xr','.125'),{quantity:'0.3'},zone);
  assert.equal(dose.unit,'mL');assert.equal(dose.strengthUnit,'mg/mL');assert.equal(dose.quantity,'0.3');
  assert.equal(dose.amountMg,'0.0375');assert.equal(dose.ingredients?.[0].amountMg,'0.0375');assert.equal(doseInputError(dose),'');
  const tiny=updateDose(newDose('onyda-xr','0.000000001'),{quantity:'0.1'},zone);
  assert.equal(tiny.amountMg,'');assert.match(doseInputError(tiny),/cannot be represented exactly/);
});

test('custom editing preserves identity and quantity but makes incomplete or invalid inputs unsavable',()=>{
  const original={...newDose('ritalin','10'),quantity:'0.5',amountMg:'5',revision:4,administeredAt:'2026-09-13T15:00:00Z',note:'Retain this note'};
  const changed=updateCustomStrength(original,'7.5',zone);
  assert.equal(changed.id,original.id);assert.equal(changed.revision,4);assert.equal(changed.productId,'ritalin');assert.equal(changed.quantity,'0.5');
  assert.equal(changed.administeredAt,original.administeredAt);assert.equal(changed.note,original.note);assert.equal(changed.amountMg,'3.75');assert.equal(original.amountMg,'5');
  for(const value of ['','7e','7/2','0']){
    const incomplete=updateCustomStrength(changed,value,zone);
    assert.equal(incomplete.packageStrength,value);assert.equal(incomplete.amountMg,'');assert.notEqual(doseInputError(incomplete),'');
    const fixed=updateCustomStrength(incomplete,' 8.25 ',zone);
    assert.equal(fixed.packageStrength,'8.25');assert.equal(fixed.amountMg,'4.125');assert.equal(fixed.ingredients?.[0].amountMg,'4.125');assert.equal(doseInputError(fixed),'');
  }
});

test('noncatalog packages never gain a reference model just by matching the total reference amount',()=>{
  for(const [productId,strength,quantity] of [['ritalin','2.5','4'],['concerta','9','2']]){
    const dose=updateDose(newDose(productId,strength),{quantity},zone);
    assert.equal(modelGroup({...dose,unusual:false}).reference,false);assert.equal(quantityStep(dose),'1');
  }
  assert.equal(modelGroup(newDose('ritalin','10')).reference,true);
});

test('only custom packages expose the small input with visible units and explicit combination order',()=>{
  const render=(productId:string,strength:string)=>renderToStaticMarkup(createElement(DoseEditor,{dose:newDose(productId,strength),index:0,profile,onChange:()=>{}}));
  const listed=render('ritalin','10');assert.match(listed,/<option value="custom">Custom<\/option>/);assert.doesNotMatch(listed,/aria-label="Dose 1 custom strength/);
  const custom=render('ritalin','7.5');assert.match(custom,/<option value="custom" selected="">Custom<\/option>/);assert.match(custom,/aria-label="Dose 1 custom strength in mg"/);assert.match(custom,/inputMode="decimal"/);
  const liquid=render('onyda-xr','0.125');assert.match(liquid,/custom strength in mg\/mL/);
  const combo=render('azstarys','7.5/1.2');assert.match(combo,/serdexmethylphenidate \/ dexmethylphenidate/);assert.match(combo,/inputMode="text"/);
});
