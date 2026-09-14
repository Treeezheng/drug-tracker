import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DoseEditor, { currentDoseTime, doseTimeForDate, doseInputError, newDose, quantityStep, steppedQuantity, shiftDoseTime, updateDose, updatePatchRemoval } from '../src/components/DoseEditor.tsx';
import { blankAssumptions, concentration } from '../src/lib/model.ts';
import { instantToLocal } from '../src/lib/time.ts';
import type { Dose, Profile } from '../src/lib/types.ts';
import { stockBalances } from '../src/lib/inventory.ts';

const zone='America/Los_Angeles';
const profile:Profile={name:'',timeZone:zone,timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:'',timeIncrementMinutes:5};
function blank():Dose{return {...newDose(),productId:'',productName:'',formulation:'',strength:'',packageStrength:'',amountMg:'',ingredients:[],administeredAt:'',date:'',time:''};}
function render(dose:Dose,productIds?:string[],increment:NonNullable<Profile['timeIncrementMinutes']>=5){return renderToStaticMarkup(createElement(DoseEditor,{dose,index:0,profile:{...profile,timeIncrementMinutes:increment},productIds,onChange:()=>{}}));}
function freeze(dose:Dose):Dose{for(const item of dose.ingredients||[])Object.freeze(item);if(dose.ingredients)Object.freeze(dose.ingredients);if(dose.assumptions)Object.freeze(dose.assumptions);return Object.freeze(dose);}

test('a blank row can receive a precise time before medication without inventing a product or amount',()=>{
  const original=freeze(blank());
  const dated=updateDose(updateDose(original,{date:'2026-09-13'},zone),{time:'08:03'},zone);
  assert.equal(dated.productId,'');assert.equal(dated.amountMg,'');assert.equal(dated.administeredAt,'2026-09-13T15:03:00Z');
  assert.match(doseInputError(dated),/Choose a medication/);assert.equal(original.administeredAt,'');
  const html=render(dated,['adderall-ir']);
  assert.match(html,/<option value="" selected="">Choose medication/);assert.match(html,/<option value="adderall-ir">Mixed amphetamine salts IR<\/option>/);assert.doesNotMatch(html,/<option value="ritalin"/);
});

test('favorites narrow the selector but preserve the current known or historical medication',()=>{
  const known=render(newDose('ritalin','5'),['adderall-ir']);
  assert.match(known,/<option value="ritalin" selected="">Methylphenidate IR<\/option>/);assert.match(known,/<option value="adderall-ir">Mixed amphetamine salts IR<\/option>/);assert.doesNotMatch(known,/Concerta/);
  const historical={...newDose('ritalin','5'),productId:'old-product',productName:'Recorded medicine',formulation:'Recorded form',packageStrength:'5',manufacturer:'Recorded manufacturer'};
  const html=render(historical,[]);
  assert.match(html,/Recorded medicine/);assert.match(html,/Recorded form/);assert.doesNotMatch(html,/Recorded manufacturer/);assert.doesNotMatch(html,/Historical · D/);
  assert.match(html,/<select aria-label="Dose 1 strength" disabled=""/);
});

test('choosing a new formulation replaces old package and model assumptions, then accepts its preferred strength',()=>{
  const original=freeze({...newDose('xelstrym','18'),assumptions:{...blankAssumptions(),accepted:true},removalAt:'2026-09-13T23:00:00Z',unusual:true});
  const changed=updateDose(original,{productId:'metformin-er'},zone);
  assert.equal(changed.strength,'500');assert.equal(changed.unit,'tablet');assert.equal(changed.strengthUnit,'mg');assert.equal(changed.amountBasis,'labeled ingredient');
  assert.equal(changed.assumptions,undefined);assert.equal(changed.removalAt,undefined);assert.equal(changed.unusual,false);assert.equal(changed.id,original.id);
  const preferred=updateDose(changed,{packageStrength:'750',quantity:'2'},zone);
  assert.equal(preferred.amountMg,'1500');assert.equal(preferred.ingredients?.[0].amountMg,'1500');
  const custom=updateDose(changed,{packageStrength:'1000'},zone);
  assert.equal(custom.packageStrength,'1000');assert.equal(custom.amountMg,'1000');
  assert.throws(()=>updateDose(changed,{packageStrength:'1e3'},zone),/positive decimal/);
  assert.throws(()=>newDose('missing-product'),/Unknown/);
});

test('a half 10 mg tablet remains half a tablet with exact labeled 5 mg',()=>{
  const dose=updateDose(newDose('ritalin','10'),{quantity:'.5'},zone);
  assert.equal(dose.quantity,'0.5');assert.equal(dose.strength,'10');assert.equal(dose.amountMg,'5');assert.equal(dose.unusual,true);
  assert.equal(doseInputError(dose),'');assert.match(render(dose),/0.5 tablet × 10 mg = 5 mg/);
  assert.doesNotMatch(render(dose),/Record details|Altered administration/);
});

test('tablet recording buttons consistently step by halves without granting a splitting or concentration model',()=>{
  for(const [id,strength] of [['ritalin','5'],['ritalin','10'],['methylphenidate-ir','10'],['amphetamine-salts-ir','5'],['quillichew-er','40'],['dyanavel-xr-tablet','10'],['concerta','18'],['relexxii','18'],['intuniv','1'],['clonidine-er','0.1'],['metformin-er','500'],['metformin-ir','1000'],['vyvanse-chewable','10']]){
    const original=newDose(id,strength);
    assert.equal(quantityStep(original),'0.5',`${id} ${strength}`);
    const half=updateDose(original,{quantity:steppedQuantity(original,-1)!},zone);
    assert.equal(half.quantity,'0.5');assert.equal(half.unusual,true);
    assert.equal(concentration(half,Date.now()).value,null);
    assert.match(render(half),/>Tablets<\/label>/);
  }
  assert.equal(quantityStep(newDose('ritalin-la','10')),'1');
  assert.equal(quantityStep(newDose('xelstrym','4.5')),'1');
  assert.equal(quantityStep({...newDose('ritalin','10'),productId:'unknown-historical'}),'0.5');
  assert.match(render(newDose('ritalin-la','10')),/>Capsules<\/label>/);
  assert.match(render(newDose('xelstrym','4.5')),/>Patches<\/label>/);
  assert.match(render(newDose('onyda-xr','0.1')),/>Volume · mL<\/label>/);
});

test('one button increment makes a precise 1.5 tablet snapshot and stock deducts 1.5 rather than rounding',()=>{
  const original=freeze({...newDose('ritalin','10'),status:'actual',administeredAt:'2026-09-13T15:00:00Z'});
  const quantity=steppedQuantity(original,1);assert.equal(quantity,'1.5');
  const updated=updateDose(original,{quantity:quantity!},zone);
  assert.equal(updated.id,original.id);assert.equal(updated.quantity,'1.5');assert.equal(updated.amountMg,'15');assert.equal(updated.packageStrength,'10');assert.equal(updated.ingredients?.[0].amountMg,'15');assert.equal(updated.unusual,true);
  assert.equal(steppedQuantity(updated,-1),'1');assert.equal(original.quantity,'1');assert.equal(doseInputError(updated),'');
  const balance=stockBalances([{id:'supply',productId:'ritalin',productName:'Ritalin IR',packageStrength:'10',strengthUnit:'mg',unit:'tablet',quantity:'30',receivedAt:'2026-09-01T00:00:00Z',timeZone:'UTC',note:''}],[updated],Date.parse('2026-09-14T00:00:00Z'))[0];
  assert.equal(balance.used,'1.5');assert.equal(balance.remaining,'28.5');
  assert.match(render(updated),/1.5 tablet × 10 mg = 15 mg/);
});

test('quantity increments retain exact four-salt and liquid amounts and never round off-step manual entries',()=>{
  const salt=newDose('adderall-ir','5');const adjustedSalt=updateDose(salt,{quantity:steppedQuantity(salt,1)!},zone);
  assert.equal(adjustedSalt.amountMg,'7.5');assert.deepEqual(adjustedSalt.ingredients?.map(item=>item.amountMg),['1.875','1.875','1.875','1.875']);
  const liquid=updateDose(newDose('onyda-xr','0.1'),{quantity:'0.3'},zone);
  assert.equal(quantityStep(liquid),'0.1');assert.equal(steppedQuantity(liquid,1),'0.4');assert.equal(steppedQuantity(liquid,-1),'0.2');
  assert.equal(updateDose(liquid,{quantity:steppedQuantity(liquid,1)!},zone).amountMg,'0.04');
  assert.equal(steppedQuantity({...liquid,quantity:'0.123456789'},1),'0.223456789');
  const capsule=updateDose(newDose('ritalin-la','10'),{quantity:'1.5'},zone);
  assert.equal(steppedQuantity(capsule,1),'2.5');assert.equal(steppedQuantity(capsule,-1),'0.5');assert.equal(capsule.unusual,true);
  assert.equal(updateDose(newDose('metformin-er','500'),{quantity:'1.5'},zone).amountMg,'750');
});

test('quantity buttons cannot create zero, negative, malformed, excessive or unselected-medication amounts',()=>{
  const original=newDose('ritalin','10');
  assert.equal(steppedQuantity({...original,quantity:'0.5'},-1),null);
  assert.equal(steppedQuantity({...original,quantity:'0.1'},-1),null);
  assert.equal(steppedQuantity({...original,quantity:'9999.5'},1),'10000');
  assert.equal(steppedQuantity({...original,quantity:'10000'},1),null);
  for(const value of ['NaN','1e2','-1','abc','0.0000000001'])assert.equal(steppedQuantity({...original,quantity:value},1),null);
  assert.equal(steppedQuantity(blank(),1),null);
  assert.equal(steppedQuantity({...original,quantity:''},-1),null);assert.equal(steppedQuantity({...original,quantity:''},1),'0.5');
  const html=render({...original,quantity:'0.5'});
  assert.match(html,/disabled="" aria-label="Decrease Dose 1 quantity by 0.5 tablet"/);assert.match(html,/aria-label="Increase Dose 1 quantity by 0.5 tablet"/);assert.match(html,/aria-label="Dose 1 quantity"/);assert.match(html,/inputMode="decimal"/);
});

test('liquid concentration times mL stays exact and unsupported precision stays incomplete',()=>{
  const liquid=updateDose(newDose('onyda-xr','0.1'),{quantity:'0.3'},zone);
  assert.equal(liquid.unit,'mL');assert.equal(liquid.strengthUnit,'mg/mL');assert.equal(liquid.amountMg,'0.03');assert.notEqual(liquid.unusual,true);
  assert.equal(liquid.ingredients?.[0].amountMg,'0.03');
  assert.equal(updateDose(newDose('metformin-solution','100'),{quantity:'5'},zone).amountMg,'500');
  const tooPrecise=updateDose(liquid,{quantity:'0.000000001'},zone);
  assert.equal(tooPrecise.amountMg,'');assert.match(doseInputError(tooPrecise),/cannot be represented exactly/);
});

test('a combination preserves both ingredient amounts without summing or converting them',()=>{
  const combination=updateDose(newDose('azstarys','26.1/5.2'),{quantity:'1.5'},zone);
  assert.equal(combination.packageStrength,'26.1/5.2');assert.equal(combination.amountBasis,'first listed ingredient');assert.equal(combination.amountMg,'39.15');
  assert.deepEqual(combination.ingredients?.map(i=>i.amountMg),['39.15','7.8']);
  assert.match(render(combination),/39.15 \/ 7.8 mg/);
});

test('four salt amounts remain exact while the primary line shows the labeled salt amount',()=>{
  const dose=updateDose(newDose('adderall-ir','5'),{quantity:'.5'},zone);
  assert.deepEqual(dose.ingredients?.map(i=>i.amountMg),['0.625','0.625','0.625','0.625']);
  const html=render(dose),primary=html.match(/<span class="dose-amount">([^<]*)/)?.[1];
  assert.equal(primary,'0.5 tablet × 5 mg = 2.5 mg');assert.doesNotMatch(html,/0.625 mg dextroamphetamine saccharate/);
});

test('clearing and re-entering quantity recovers a legacy ingredient snapshot without using the catalog',()=>{
  const legacy=freeze({...newDose('ritalin','5'),productId:'old-product',productName:'Historical snapshot',manufacturer:'Old manufacturer',ingredients:[{name:'Saved ingredient',amountMg:'2.5'}],quantity:'0.5',amountMg:'2.5'});
  const cleared=updateDose(legacy,{quantity:''},zone);
  assert.equal(cleared.amountMg,'');assert.match(doseInputError(cleared),/positive strength and quantity/);
  const restored=updateDose(cleared,{quantity:'1.5'},zone);
  assert.equal(restored.amountMg,'7.5');assert.equal(restored.ingredients?.[0].amountMg,'7.5');assert.equal(restored.ingredients?.[0].strengthMg,'5');
  assert.equal(restored.ingredients?.[0].name,'Saved ingredient');assert.equal(restored.manufacturer,'Old manufacturer');assert.equal(restored.productId,'old-product');
  assert.equal(legacy.ingredients?.[0].amountMg,'2.5');
});

test('notes and time corrections preserve unknown historical package metadata and model remains unknown',()=>{
  const legacy=freeze({...newDose('azstarys','26.1/5.2'),productId:'archived',productName:'Saved name',formulation:'Saved formulation',manufacturer:'Saved maker',status:'actual' as const,administeredAt:'2026-09-13T15:00:00Z',date:'2020-01-01',time:'01:00',revision:4});
  const corrected=updateDose(updateDose(legacy,{note:'Corrected context'},zone),{time:'09:17'},zone);
  assert.equal(corrected.administeredAt,'2026-09-13T16:17:00Z');assert.equal(corrected.productName,'Saved name');assert.equal(corrected.formulation,'Saved formulation');
  assert.equal(corrected.packageStrength,'26.1/5.2');assert.deepEqual(corrected.ingredients,legacy.ingredients);assert.equal(corrected.revision,4);assert.equal(corrected.status,'actual');
  assert.equal(concentration(corrected,Date.parse('2026-09-13T20:00:00Z')).value,null);
});

test('clearing a medication or timestamp removes the previous value without silently refilling it',()=>{
  const initial={...newDose('adderall-ir','5'),administeredAt:'2026-09-13T15:00:00Z'};
  const cleared=updateDose(initial,{productId:''},zone);
  assert.equal(cleared.amountMg,'');assert.equal(cleared.productName,'');assert.deepEqual(cleared.ingredients,[]);
  const noTime=updateDose(initial,{time:''},zone);
  assert.equal(noTime.administeredAt,'');assert.equal(noTime.time,'');assert.equal(noTime.date,'2026-09-13');
  assert.equal(shiftDoseTime(noTime,5,zone),noTime);
});

test('all sizes use one time picker with an inline Now and retain the original off-step time',()=>{
  const d=updateDose(newDose('ritalin','5'),{date:'2026-09-13',time:'08:03'},zone);
  assert.equal(shiftDoseTime(d,5,zone).time,'08:08');assert.equal(shiftDoseTime(d,-10,zone).time,'07:53');
  for(const increment of [1,5,10] as const){
    const html=render(d,undefined,increment);
    assert.match(html,/class="dose-time-inline"/);assert.match(html,/aria-label="Dose 1 time: 08:03"/);
    assert.equal((html.match(/aria-haspopup="dialog"/g)||[]).length,1);
    assert.equal((html.match(/>Now<\/button>/g)||[]).length,1);
    assert.doesNotMatch(html,/type="time"|time-adjustments|dose-time-mobile|dose-time-desktop|minutes earlier|minutes later/);
    assert.match(html,/aria-selected="true">03<\/div>/);
    if(increment===1)assert.equal((html.match(/role="option"/g)||[]).length,84);
  }
  const empty=blank();assert.equal(shiftDoseTime(empty,5,zone),empty);assert.equal(shiftDoseTime(d,Infinity,zone),d);
});

test('minute adjustments cross midnight, year boundaries, leap dates and a fractional-offset zone',()=>{
  const year=shiftDoseTime({...newDose('ritalin','5'),date:'2026-01-01',time:'00:03'},-5,zone);
  assert.deepEqual({date:year.date,time:year.time},{date:'2025-12-31',time:'23:58'});
  const leap=shiftDoseTime({...newDose('ritalin','5'),date:'2024-02-28',time:'23:58'},10,'Asia/Kathmandu');
  assert.deepEqual({date:leap.date,time:leap.time},{date:'2024-02-29',time:'00:08'});
  assert.equal(leap.administeredAt,'2024-02-28T18:23:00.000Z');
});

test('spring DST advances by elapsed minutes while manual missing-hour input is rejected',()=>{
  const before={...newDose('ritalin','5'),administeredAt:'2026-03-08T09:58:00Z'};
  const after=shiftDoseTime(before,5,zone);
  assert.equal(after.time,'03:03');assert.equal(after.administeredAt,'2026-03-08T10:03:00.000Z');
  const missing=updateDose(before,{date:'2026-03-08',time:'02:15'},zone);
  assert.equal(missing.administeredAt,'');assert.equal(missing.time,'02:15');assert.match(render(missing),/does not exist/);
});

test('fall DST preserves the selected real instant, including recorded seconds',()=>{
  const before={...newDose('ritalin','5'),status:'actual' as const,administeredAt:'2026-11-01T08:58:42Z'};
  const after=shiftDoseTime(before,5,zone);
  assert.equal(after.time,'01:03');assert.equal(after.disambiguation,'later');assert.equal(after.administeredAt,'2026-11-01T09:03:42.000Z');
  assert.equal(shiftDoseTime(after,-5,zone).administeredAt,'2026-11-01T08:58:42.000Z');assert.doesNotMatch(render(after),/occurs twice/);
  const edited=updateDose(after,{time:'01:17'},zone);assert.equal(edited.administeredAt,'2026-11-01T09:17:00Z');
});

test('new ambiguous local entries require an occurrence and travel uses the saved instant',()=>{
  const ambiguous=updateDose(newDose('ritalin','5'),{date:'2026-11-01',time:'01:30'},zone);
  assert.equal(ambiguous.administeredAt,'');assert.match(render(ambiguous),/occurs twice/);
  assert.equal(updateDose(ambiguous,{disambiguation:'earlier'},zone).administeredAt,'2026-11-01T08:30:00Z');
  assert.equal(updateDose(ambiguous,{disambiguation:'later'},zone).administeredAt,'2026-11-01T09:30:00Z');
  const travel={...newDose('ritalin','5'),administeredAt:'2026-09-13T23:58:00Z',date:'2020-01-01',time:'00:00'};
  const moved=shiftDoseTime(travel,5,'Asia/Tokyo');assert.deepEqual(instantToLocal(moved.administeredAt,'Asia/Tokyo'),{date:'2026-09-14',time:'09:03'});
});

test('time errors and dose units are available through accessible descriptions',()=>{
  const ambiguous=updateDose(newDose('ritalin','5'),{date:'2026-11-01',time:'01:30'},zone);
  const html=render(ambiguous),errorId=`dose-time-error-${ambiguous.id}`;
  assert.match(html,new RegExp(`id="${errorId}" role="alert"`));
  assert.match(html,new RegExp(`aria-label="Dose 1 time: 01:30" aria-invalid="true" aria-describedby="${errorId}"`));
  const liquid=newDose('metformin-solution','100'),liquidHtml=render(liquid);
  assert.match(liquidHtml,new RegExp(`id="dose-quantity-unit-${liquid.id}">Volume · mL`));
  assert.match(liquidHtml,new RegExp(`aria-describedby="dose-quantity-unit-${liquid.id}"`));
  assert.match(liquidHtml,new RegExp(`id="dose-strength-unit-${liquid.id}">Strength · mg/mL`));
});

test('four dose objects remain independent through edits, time moves and displayed renumbering',()=>{
  const rows=['ritalin','adderall-ir','metformin-ir','azstarys'].map(id=>freeze(newDose(id)));
  assert.equal(new Set(rows.map(d=>d.id)).size,4);
  const before=JSON.stringify(rows),changed=updateDose(rows[1],{quantity:'0.5'},zone);
  assert.equal(changed.id,rows[1].id);assert.equal(JSON.stringify(rows),before);
  const survivor=rows[3],html=renderToStaticMarkup(createElement(DoseEditor,{dose:survivor,index:2,profile,onChange:()=>{}}));
  assert.match(html,new RegExp(`id="dose-time-${survivor.id}"`));assert.match(html,/Dose 3 medication/);assert.equal(survivor.id,rows[3].id);
});

test('patch recording keeps nominal delivery units and rejects invalid removal chronology',()=>{
  const patch={...newDose('xelstrym','4.5'),administeredAt:'2026-09-13T15:00:00Z'};
  assert.equal(patch.strengthUnit,'mg/9 h');assert.equal(patch.amountBasis,'labeled delivery over 9 hours');assert.match(render(patch),/4.5 mg nominal \/ 9 h/);
  assert.match(doseInputError({...patch,removalAt:'not-an-instant'}),/valid patch removal time/);
  assert.match(doseInputError({...patch,removalAt:'2026-09-13T14:59:00Z'}),/after application/);
  assert.equal(doseInputError({...patch,removalAt:'2026-09-14T00:00:00Z'}),'');
});

test('Now rounds down to local one, five or ten minute boundaries and never selects a future instant',()=>{
  const at=Date.parse('2026-09-13T15:09:59.999Z');
  const one=currentDoseTime(zone,1,at),five=currentDoseTime(zone,5,at),ten=currentDoseTime(zone,10,at);
  assert.deepEqual({date:one.date,time:one.time},{date:'2026-09-13',time:'08:09'});
  assert.equal(one.administeredAt,'2026-09-13T15:09:00Z');
  assert.deepEqual({date:five.date,time:five.time},{date:'2026-09-13',time:'08:05'});
  assert.deepEqual({date:ten.date,time:ten.time},{date:'2026-09-13',time:'08:00'});
  assert.equal(five.administeredAt,'2026-09-13T15:05:00Z');assert.equal(ten.administeredAt,'2026-09-13T15:00:00Z');
  for(const value of [one,five,ten])assert.ok(Date.parse(value.administeredAt)<=at);
  const exact=currentDoseTime('UTC',10,Date.parse('2026-01-01T00:00:00Z'));assert.equal(exact.administeredAt,'2026-01-01T00:00:00Z');
  assert.match(render(blank()),/Use current time for Dose 1/);
  assert.throws(()=>currentDoseTime(zone,5,NaN),/valid time/);
  for(const increment of [-1,0,2,15,1.5,'1',null])assert.throws(()=>currentDoseTime(zone,increment as never,at),/minute increment/);
});

test('Now uses the displayed zone and its local minute grid, including a 45-minute offset',()=>{
  const at=Date.parse('2026-01-02T18:22:49Z');
  const nepal=currentDoseTime('Asia/Kathmandu',10,at);
  assert.deepEqual({date:nepal.date,time:nepal.time},{date:'2026-01-03',time:'00:00'});
  assert.equal(nepal.administeredAt,'2026-01-02T18:15:00Z');
  const tokyo=currentDoseTime('Asia/Tokyo',5,at);assert.equal(tokyo.date,'2026-01-03');assert.equal(tokyo.time,'03:20');
  const jump=currentDoseTime('Asia/Kathmandu',10,Date.parse('1985-12-31T18:32:00Z'));
  assert.deepEqual({date:jump.date,time:jump.time},{date:'1985-12-31',time:'23:50'});
  assert.ok(Date.parse(jump.administeredAt)<=Date.parse('1985-12-31T18:32:00Z'));
});

test('Now preserves the earlier or later DST occurrence and does not round across a missing hour',()=>{
  const first=currentDoseTime(zone,10,Date.parse('2026-11-01T08:03:42Z'));
  const second=currentDoseTime(zone,10,Date.parse('2026-11-01T09:03:42Z'));
  assert.equal(first.time,'01:00');assert.equal(first.disambiguation,'earlier');assert.equal(first.administeredAt,'2026-11-01T08:00:00Z');
  assert.equal(second.time,'01:00');assert.equal(second.disambiguation,'later');assert.equal(second.administeredAt,'2026-11-01T09:00:00Z');
  const spring=currentDoseTime(zone,5,Date.parse('2026-03-08T10:02:42Z'));
  assert.equal(spring.time,'03:00');assert.equal(spring.administeredAt,'2026-03-08T10:00:00Z');
});

test('invalid removal input preserves an old patch record instead of silently clearing it',()=>{
  const patch=freeze({...newDose('xelstrym','4.5'),status:'actual' as const,administeredAt:'2026-03-08T08:00:00Z',removalAt:'2026-03-08T20:00:00Z',revision:3,note:'Historical record'});
  for(const occurrence of [undefined,'earlier','later'] as const){
    const gap=updatePatchRemoval(patch,'2026-03-08T02:15',zone,occurrence);
    assert.equal(gap.dose,patch);assert.equal(gap.dose.removalAt,'2026-03-08T20:00:00Z');assert.match(gap.error,/does not exist/);assert.equal(gap.requiresOccurrence,false);
  }
  const corrected=updatePatchRemoval(patch,'2026-03-08T13:45',zone);
  assert.equal(corrected.error,'');assert.equal(corrected.dose.removalAt,'2026-03-08T20:45:00Z');assert.equal(corrected.dose.id,patch.id);assert.equal(corrected.dose.revision,3);
  assert.equal(patch.removalAt,'2026-03-08T20:00:00Z');
});

test('ambiguous removal requires an explicit choice and both real instants stay available',()=>{
  const patch=freeze({...newDose('xelstrym','4.5'),administeredAt:'2026-11-01T07:00:00Z',removalAt:'2026-11-01T15:00:00Z'});
  const unresolved=updatePatchRemoval(patch,'2026-11-01T01:30',zone);
  assert.equal(unresolved.dose,patch);assert.equal(unresolved.requiresOccurrence,true);assert.match(unresolved.error,/occurs twice/);
  const earlier=updatePatchRemoval(patch,'2026-11-01T01:30',zone,'earlier');
  const later=updatePatchRemoval(patch,'2026-11-01T01:30',zone,'later');
  assert.equal(earlier.error,'');assert.equal(earlier.dose.removalAt,'2026-11-01T08:30:00Z');
  assert.equal(later.error,'');assert.equal(later.dose.removalAt,'2026-11-01T09:30:00Z');
  assert.match(render(later.dose),/Removal clock occurrence/);
  assert.match(render(later.dose),/<option value="later" selected="">Later occurrence/);
});

test('removal chronology still permits correcting an invalid earlier occurrence to the later one',()=>{
  const patch=freeze({...newDose('xelstrym','4.5'),administeredAt:'2026-11-01T09:10:00Z',removalAt:'2026-11-01T16:00:00Z'});
  const earlier=updatePatchRemoval(patch,'2026-11-01T01:30',zone,'earlier');
  assert.equal(earlier.dose,patch);assert.equal(earlier.requiresOccurrence,true);assert.match(earlier.error,/after application/);
  const later=updatePatchRemoval(patch,'2026-11-01T01:30',zone,'later');
  assert.equal(later.error,'');assert.equal(later.dose.removalAt,'2026-11-01T09:30:00Z');
});

test('unchanged removal text preserves recorded seconds and explicit clearing is supported',()=>{
  const patch=freeze({...newDose('xelstrym','4.5'),administeredAt:'2026-09-13T15:00:00Z',removalAt:'2026-09-13T23:03:42Z'});
  const untouched=updatePatchRemoval(patch,'2026-09-13T16:03',zone);
  assert.equal(untouched.dose,patch);assert.equal(untouched.dose.removalAt,'2026-09-13T23:03:42Z');
  const cleared=updatePatchRemoval(patch,'',zone);assert.equal(cleared.error,'');assert.equal(cleared.dose.removalAt,'');assert.equal(cleared.dose.administeredAt,patch.administeredAt);
  assert.equal(patch.removalAt,'2026-09-13T23:03:42Z');
});

test('new-dose defaults preserve the selected chart day and local increment without fabricating DST instants',()=>{
  const now=Date.parse('2026-09-14T17:37:00Z');
  assert.deepEqual(doseTimeForDate('2026-09-14','America/Los_Angeles',5,now),currentDoseTime('America/Los_Angeles',5,now));
  const previous=doseTimeForDate('2026-09-10','America/Los_Angeles',5,now);
  assert.equal(previous.date,'2026-09-10');assert.equal(previous.time,'10:35');assert.equal(previous.administeredAt,'2026-09-10T17:35:00Z');
  const gap=doseTimeForDate('2026-03-08','America/Los_Angeles',5,Date.parse('2026-03-09T09:35:00Z'));
  assert.equal(gap.date,'2026-03-08');assert.equal(gap.time,'02:35');assert.equal(gap.administeredAt,'');
  const repeat=doseTimeForDate('2026-11-01','America/Los_Angeles',5,Date.parse('2026-11-02T09:35:00Z'));
  assert.equal(repeat.date,'2026-11-01');assert.equal(repeat.time,'01:35');assert.equal(repeat.administeredAt,'');
});
