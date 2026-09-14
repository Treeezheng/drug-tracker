import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TimelineChart from '../src/components/TimelineChart';
import { newDose } from '../src/components/DoseEditor';
import { selectedTimelineChoice, timelineChoices } from '../src/lib/timeline-choice';
import type { Dose, Profile } from '../src/lib/types';
const dose=(id:string,strength:string):Dose=>({...newDose(id,strength),administeredAt:'2026-09-14T08:00:00Z',status:'actual'});
const profile:Profile={name:'',timeZone:'UTC',timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
const render=(doses:Dose[])=>renderToStaticMarkup(createElement(TimelineChart,{doses,date:'2026-09-14',days:1,profile,publishedOnly:false,onProfile:()=>{}}));

test('medication switching isolates different formulations while retaining every strength and earlier same-medication dose',()=>{
  const ir=dose('amphetamine-salts-ir','7.5'),brand=dose('adderall-ir','10'),old={...dose('amphetamine-salts-ir','5'),administeredAt:'2026-09-13T23:00:00Z'},concerta=dose('concerta','18');
  const before=structuredClone([ir,brand,old,concerta]),choices=timelineChoices([ir,brand,old,concerta]);
  assert.deepEqual(choices.map(c=>c.label),['Adderall IR','Concerta']);
  assert.deepEqual(selectedTimelineChoice(choices,null)?.doses,[ir,brand,old]);
  assert.deepEqual(selectedTimelineChoice(choices,'concerta')?.doses,[concerta]);
  assert.equal(selectedTimelineChoice(choices,'removed')?.id,choices[0].id);
  assert.equal(selectedTimelineChoice([],null),undefined);
  assert.deepEqual([ir,brand,old,concerta],before);
});

test('capsule, chewable and unknown products remain distinguishable, including brand and generic pairs',()=>{
  const choices=timelineChoices([dose('vyvanse-capsule','30'),dose('lisdexamfetamine-capsule','20'),dose('vyvanse-chewable','30'),dose('metformin-ir','500')]);
  assert.deepEqual(choices.map(c=>c.label),['Vyvanse capsule','Vyvanse chewable','Metformin IR (generic)']);
  assert.equal(choices[0].doses.length,2);
  assert.deepEqual(timelineChoices([{...dose('adderall-ir','5'),status:'skipped'},newDose('adderall-ir','5')]),[]);
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
