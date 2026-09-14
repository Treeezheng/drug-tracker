import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TimelineChart from '../src/components/TimelineChart';
import { newDose } from '../src/components/DoseEditor';
import { selectedTimelineChoice, timelineChoices } from '../src/lib/timeline-choice';
import { blankAssumptions } from '../src/lib/model';
import { estimateTotals } from '../src/lib/timeline-estimates';
import { sampleTimelinePanel } from '../src/lib/timeline-series';
import type { Dose, Profile } from '../src/lib/types';
const dose=(id:string,strength:string):Dose=>({...newDose(id,strength),administeredAt:'2026-09-14T08:00:00Z',status:'actual'});
const profile:Profile={name:'',timeZone:'UTC',timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
const render=(doses:Dose[])=>renderToStaticMarkup(createElement(TimelineChart,{doses,date:'2026-09-14',days:1,profile,publishedOnly:false,onProfile:()=>{}}));

test('medication switching isolates incompatible compounds while retaining every strength and earlier dose',()=>{
  const ir=dose('amphetamine-salts-ir','7.5'),brand=dose('adderall-ir','10'),old={...dose('amphetamine-salts-ir','5'),administeredAt:'2026-09-13T23:00:00Z'},concerta=dose('concerta','18');
  const before=structuredClone([ir,brand,old,concerta]),choices=timelineChoices([ir,brand,old,concerta]);
  assert.deepEqual(choices.map(c=>c.label),['Adderall IR','Concerta']);
  assert.deepEqual(selectedTimelineChoice(choices,null)?.doses,[ir,brand,old]);
  assert.deepEqual(selectedTimelineChoice(choices,choices[1].id)?.doses,[concerta]);
  assert.equal(selectedTimelineChoice(choices,'removed')?.id,choices[0].id);
  assert.equal(selectedTimelineChoice([],null),undefined);
  assert.deepEqual([ir,brand,old,concerta],before);
});

test('compatible capsule and chewable models share a view while unknown products remain separate',()=>{
  const choices=timelineChoices([dose('vyvanse-capsule','30'),dose('lisdexamfetamine-capsule','20'),dose('vyvanse-chewable','30'),dose('metformin-ir','500')]);
  assert.deepEqual(choices.map(c=>c.label),['Vyvanse capsule / Vyvanse chewable','Metformin IR (generic)']);
  assert.equal(choices[0].doses.length,3);
  assert.deepEqual(timelineChoices([{...dose('adderall-ir','5'),status:'skipped'},newDose('adderall-ir','5')]),[]);
});

test('Concerta and Ritalin share their total while keeping formulation curves and earlier contributions',()=>{
  const old={...dose('concerta','18'),administeredAt:'2026-09-13T23:00:00Z'};
  const ir=dose('ritalin','10'),generic=dose('methylphenidate-ir','5');
  const input=[old,ir,generic],before=structuredClone(input),choices=timelineChoices(input);
  assert.equal(choices.length,1);
  assert.equal(choices[0].label,'Concerta / Ritalin');
  assert.deepEqual(choices[0].doses,input);
  const at=Date.parse('2026-09-14T10:00:00Z');
  const combined=estimateTotals(choices[0].doses,at).Methylphenidate;
  const expected=input.reduce((total,row)=>total+estimateTotals([row],at).Methylphenidate.value,0);
  assert.ok(combined.complete);
  assert.ok(combined.value>4.3);
  assert.equal(combined.value,expected);
  assert.equal(combined.items.length,3);
  const samples=sampleTimelinePanel(choices[0].doses,'Methylphenidate',[at],false);
  assert.equal(samples.curves.length,3);
  assert.deepEqual(input,before,'Grouping must not alter dose or formulation snapshots');
  const html=render(input);
  assert.equal((html.match(/class="analyte-panel"/g)??[]).length,1);
  assert.match(html,/From history/);
  assert.match(html,/Ritalin/);
  assert.doesNotMatch(html,/Concentration to display/);
});

test('actual model analytes take priority over a shared therapeutic family',()=>{
  const concerta=dose('concerta','18'),ritalin=dose('ritalin','10');
  const quillivant=dose('quillivant-xr','5'),focalin=dose('focalin','5');
  const choices=timelineChoices([concerta,quillivant,ritalin,focalin]);
  assert.equal(choices.length,2);
  assert.deepEqual(choices[0].doses,[concerta,ritalin]);
  assert.deepEqual(choices[1].doses,[quillivant,focalin]);
});

test('overlapping amphetamine models combine matching components without adding d and l together',()=>{
  const vyvanse=dose('vyvanse-capsule','30'),ir=dose('adderall-ir','10'),xr=dose('adderall-xr','10');
  const choices=timelineChoices([vyvanse,ir,xr]);
  assert.equal(choices.length,1);
  const at=Date.parse('2026-09-14T12:00:00Z'),totals=estimateTotals(choices[0].doses,at);
  assert.deepEqual(Object.keys(totals).sort(),['d-Amphetamine','l-Amphetamine']);
  assert.equal(totals['d-Amphetamine'].items.length,3);
  assert.equal(totals['l-Amphetamine'].items.length,2);
  assert.ok(totals['l-Amphetamine'].items.every(item=>item.dose.id!==vyvanse.id));
  const onlySalts=estimateTotals([ir,xr],at);
  assert.equal(totals['l-Amphetamine'].value,onlySalts['l-Amphetamine'].value);
  assert.equal(totals['d-Amphetamine'].value,estimateTotals([vyvanse],at)['d-Amphetamine'].value+onlySalts['d-Amphetamine'].value);
  assert.equal(timelineChoices([xr,ir,vyvanse])[0].id,choices[0].id,'Selection identity must survive dose reordering');
});

test('missing and relative same-compound contributions cannot silently disappear from physical totals',()=>{
  const concerta=dose('concerta','18'),patch=dose('daytrana','10');
  const relative={...dose('methylphenidate-ir','10'),assumptions:{...blankAssumptions(),accepted:true}};
  const invalid={...dose('ritalin','10'),amountMg:'invalid'};
  const at=Date.parse('2026-09-14T12:00:00Z');
  for(const missing of [patch,relative,invalid]){
    const choices=timelineChoices([concerta,missing]);
    assert.equal(choices.length,1);
    const total=estimateTotals(choices[0].doses,at).Methylphenidate;
    assert.equal(total.complete,false);
    assert.equal(total.items.length,2);
    assert.equal(total.value,estimateTotals([concerta],at).Methylphenidate.value);
  }
  const relativeTotals=estimateTotals(timelineChoices([concerta,relative])[0].doses,at);
  assert.ok(Object.values(relativeTotals).some(total=>total.unit==='relative units'));
  const duplicated=estimateTotals(timelineChoices([concerta,concerta])[0].doses,at).Methylphenidate;
  assert.equal(duplicated.items.length,1);
});

test('the page displays one selected chart and reading rather than two drug panels or a cross-drug total',()=>{
  const ir=dose('amphetamine-salts-ir','7.5'),concerta=dose('concerta','18');
  const html=render([ir,concerta]);
  assert.equal((html.match(/class="analyte-panel"/g)??[]).length,1);
  assert.equal((html.match(/class="chart-svg"/g)??[]).length,1);
  assert.equal((html.match(/class="reading-value"/g)??[]).length,1);
  assert.match(html,/Medication to display/);assert.match(html,/Concentration to display/);
  assert.match(html,/value="d-Amphetamine" selected/);assert.match(html,/value="l-Amphetamine"/);
  assert.match(html,/reference-overlay-path/);assert.match(html,/chart-guide.html/);
  const chart=html.split('class="chart-main"')[1];
  assert.doesNotMatch(chart,/Concerta|<h2>Methylphenidate/);
  const switched=render([concerta,ir]);
  assert.equal((switched.match(/class="analyte-panel"/g)??[]).length,1);
  assert.match(switched,/<h2>Methylphenidate/);
  assert.doesNotMatch(switched.split('class="chart-main"')[1],/Adderall|d-Amphetamine/);
});
