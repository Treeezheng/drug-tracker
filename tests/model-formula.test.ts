import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DoseFormula from '../src/components/DoseFormula.tsx';
import DoseEditor, { newDose, updateDose } from '../src/components/DoseEditor.tsx';
import { describeDoseFormula } from '../src/lib/model-formula.ts';
import { blankAssumptions, concentration, CONCERTA_TRACE, RITALIN_REFERENCE } from '../src/lib/model.ts';
import type { Dose, Profile } from '../src/lib/types.ts';

const zone='America/Los_Angeles';
const profile:Profile={name:'',timeZone:zone,timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
const timed=(id:string,strength:string):Dose=>({...newDose(id,strength),administeredAt:'2026-09-13T15:00:00Z'});
const at=(dose:Dose,hours:number)=>Date.parse(dose.administeredAt)+hours*3_600_000;

test('the displayed Ritalin reference has the amplitude and rates used by the actual curve',()=>{
  const dose=timed('ritalin','10'),formula=describeDoseFormula(dose),r=RITALIN_REFERENCE;
  assert.equal(formula.kind,'reference');assert.match(formula.title,/Constructed reference · B/);
  assert.ok(formula.equations[0].includes(String(r.amplitude)));assert.ok(formula.parameters[0].includes(String(r.absorptionRate)));
  assert.equal(concentration(dose,at(dose,r.peakHours)).value,r.amplitude);
  const t=6,ke=Math.LN2/r.halfLifeHours;
  const stated=r.amplitude*(Math.exp(-ke*t)-Math.exp(-r.absorptionRate*t))/(Math.exp(-ke*r.peakHours)-Math.exp(-r.absorptionRate*r.peakHours));
  assert.equal(concentration(dose,at(dose,t)).value,stated);assert.match(formula.note,/ng\/mL/);
});

test('Concerta formula explains both the observed boundary and the actual optional continuation',()=>{
  const dose=timed('concerta','18'),formula=describeDoseFormula(dose);
  assert.equal(formula.kind,'reference');assert.match(formula.equations[0],/Cᵢ₊₁/);assert.equal(formula.equations.length,2);
  const [t0,c0]=CONCERTA_TRACE[3],[t1,c1]=CONCERTA_TRACE[4];
  assert.ok(Math.abs(concentration(dose,at(dose,(t0+t1)/2)).value!-(c0+c1)/2)<1e-12);
  const [lastT,lastC]=CONCERTA_TRACE.at(-1)!;
  assert.ok(formula.parameters[0].includes(`0 ≤ t ≤ ${lastT} h.`));
  const continuation=concentration(dose,at(dose,lastT+3.5));
  assert.ok(Math.abs(continuation.value!-lastC/2)<1e-12);assert.equal(continuation.tail,true);
  assert.ok(formula.equations[1].includes(String(lastT)));assert.match(formula.parameters[0],/3.5 h half-life.*starred/);
  assert.ok(Math.abs(concentration(dose,at(dose,lastT),true).value!-lastC)<1e-12);
  assert.equal(concentration(dose,at(dose,lastT)+1,true).value,null);
  const html=renderToStaticMarkup(createElement(DoseFormula,{dose}));
  assert.match(html,/29\.976 h/);assert.match(html,/unobserved estimated continuation/);assert.match(html,/Published-only views omit/);
});

test('unknown products, custom packages and unavailable saved versions do not borrow a formula',()=>{
  const doses=[timed('metformin-ir','500'),
    updateDose(timed('ritalin','2.5'),{quantity:'4'},zone),
    updateDose(timed('concerta','9'),{quantity:'2'},zone),
    {...timed('ritalin','10'),productId:'historical',assumptions:{...blankAssumptions(),accepted:true}},
    {...timed('ritalin','10'),modelVersion:'older-version'}];
  for(const dose of doses){const formula=describeDoseFormula(dose);assert.equal(formula.kind,'unavailable');assert.deepEqual(formula.equations,[]);assert.equal(concentration(dose,at(dose,2)).value,null);}
  assert.match(describeDoseFormula(doses[0]).note,/No verified formula is implemented/);
  assert.match(describeDoseFormula(doses.at(-1)!).note,/saved model version/);
});

test('the separate reference formula explicitly explains dose scaling without claiming direct concentration data',()=>{
  for(const [id,strength] of [['methylphenidate-ir','5'],['methylphenidate-ir','10'],['methylphenidate-ir','20'],['concerta','36']]){
    const dose=timed(id,strength),formula=describeDoseFormula(dose);
    assert.equal(formula.kind,'reference-illustration');assert.match(formula.title,/unvalidated/);
    assert.match(formula.equations[0],/D \/ (10|18) mg/);
    assert.match(formula.note,/not a measured|not a.*personal concentration/);
    assert.equal(concentration(dose,at(dose,2)).value,null);
  }
});

test('saved accepted illustrations remain read-only and retain their relative scale through record edits',()=>{
  const dose=timed('adderall-ir','5');dose.assumptions={...blankAssumptions(),accepted:true,lagHours:1,peakHours:2,halfLifeHours:3,amplitude:4,referenceDose:10};
  Object.freeze(dose.assumptions);Object.freeze(dose);
  const formula=describeDoseFormula(dose);
  assert.equal(formula.kind,'saved-illustration');assert.match(formula.title,/unvalidated/);assert.match(formula.note,/relative units/);
  assert.equal(concentration(dose,at(dose,.5)).value,0);assert.equal(concentration(dose,at(dose,2)).value,1);assert.equal(concentration(dose,at(dose,3)).value,2);assert.equal(concentration(dose,at(dose,6)).value,1);
  const corrected=updateDose(dose,{note:'Preserved note',manufacturer:'Recorded package'},zone);
  assert.equal(corrected.assumptions,dose.assumptions);assert.deepEqual(describeDoseFormula(corrected),formula);
  const html=renderToStaticMarkup(createElement(DoseFormula,{dose}));
  assert.doesNotMatch(html,/<(?:input|select|textarea|button)\b/);assert.doesNotMatch(html,/ng\/mL/);
  assert.equal(describeDoseFormula({...dose,assumptions:{...dose.assumptions!,peakHours:NaN}}).kind,'unavailable');
  assert.equal(describeDoseFormula({...dose,assumptions:{...dose.assumptions!,accepted:false}}).kind,'reference-illustration');
  assert.equal(describeDoseFormula({...dose,amountMg:''}).kind,'unavailable');
});

test('removed details stay in the record while only Formula and the patch-specific removal control remain',()=>{
  const dose={...timed('xelstrym','4.5'),removalAt:'2026-09-13T23:03:42Z',note:'Saved patch note',manufacturer:'Saved maker',unusual:true};
  const before=JSON.stringify(dose);
  const html=renderToStaticMarkup(createElement(DoseEditor,{dose,index:0,profile,onChange:()=>{throw Error('Rendering must not change a record');}}));
  const formula=html.match(/<details class="dose-formula-details">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(formula);assert.match(formula,/aria-label="Dose 1 formula"/);assert.match(formula,/No verified formula/);assert.doesNotMatch(formula,/<(?:input|textarea|select)\b/);
  assert.doesNotMatch(html,/Record details|dose-record-details|Saved patch note|Saved maker|Manufacturer \/ labeler|Altered administration/);
  assert.match(html,/class="patch-removal-editor"/);assert.match(html,/value="2026-09-13T16:03"/);
  const corrected=updateDose(dose,{date:'2026-09-13',time:'08:05'},zone);
  for(const field of ['note','manufacturer','unusual','formulation','ingredients','removalAt'] as const)assert.deepEqual(corrected[field],dose[field]);
  assert.doesNotMatch(html,/Details &amp; assumptions|Use these explicit assumptions|Illustration peak|Effect duration, minimum/);
  assert.doesNotMatch(html,/<details[^>]*\sopen(?:=|>)/);assert.equal(JSON.stringify(dose),before);
});
