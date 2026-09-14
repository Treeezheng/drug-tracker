import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TimelineChart from '../src/components/TimelineChart.tsx';
import { newDose } from '../src/components/DoseEditor.tsx';
import { blankAssumptions, CONCERTA_TRACE, groupedTotals } from '../src/lib/model.ts';
import { hasKnownTotal, hasMissingTimelineData, timelineReading } from '../src/lib/timeline-data.ts';
import type { Dose, Profile } from '../src/lib/types.ts';

const HOUR=3_600_000,start=Date.parse('2026-09-13T00:00:00Z'),end=start+24*HOUR;
const profile:Profile={name:'',timeZone:'UTC',timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
const dose=(productId:string,at:number):Dose=>({...newDose(productId),administeredAt:new Date(at).toISOString()});
const render=(doses:Dose[],days=1)=>renderToStaticMarkup(createElement(TimelineChart,{doses,date:'2026-09-13',days,profile,publishedOnly:true,onProfile:()=>{}}));

test('the exact Concerta observed boundary stays known; even a short visible gap receives a marker',()=>{
  const row=dose('concerta',start),cutoff=start+CONCERTA_TRACE.at(-1)![0]*HOUR;
  assert.equal(hasMissingTimelineData([row],start,cutoff,true),false);
  assert.equal(hasMissingTimelineData([row],cutoff,cutoff+1,true),true);
  assert.equal(hasMissingTimelineData([row],start,cutoff+1,true),true);
  assert.equal(hasMissingTimelineData([row],cutoff+1,cutoff+HOUR,true),true);
  assert.equal(hasMissingTimelineData([row],start,start+72*HOUR,false),false);
});

test('supported IR and saved illustration profiles retain their modeled data',()=>{
  const ir={...dose('ritalin',start),strength:'10',packageStrength:'10',amountMg:'10'};
  const illustration={...dose('metformin-ir',start),assumptions:{...blankAssumptions(),accepted:true}};
  assert.equal(hasMissingTimelineData([ir],start,start+72*HOUR,true),false);
  assert.equal(hasMissingTimelineData([illustration],start,end,true),false);
  assert.doesNotMatch(render([ir]),/\* No data/);
});

test('missing-data detection is limited to timed contributions in the displayed view',()=>{
  const unmodeled=dose('metformin-ir',start+HOUR);
  assert.equal(hasMissingTimelineData([unmodeled],start,end,true),true);
  assert.equal(hasMissingTimelineData([{...unmodeled,administeredAt:new Date(end).toISOString()}],start,end,true),false);
  assert.equal(hasMissingTimelineData([{...unmodeled,status:'skipped'}],start,end,true),false);
  assert.equal(hasMissingTimelineData([{...unmodeled,administeredAt:''}],start,end,true),false);
  assert.equal(hasMissingTimelineData([{...unmodeled,amountMg:''}],start,end,true),false);
  assert.equal(hasMissingTimelineData([],start,end,true),false);
  assert.equal(hasMissingTimelineData([{...dose('ritalin',start),strength:'10',packageStrength:'10',amountMg:'10',modelVersion:'unavailable-version'}],start,end,true),true);
  assert.equal(hasMissingTimelineData([{...unmodeled,productId:'archived-product'}],start,end,true),true);
});

test('unknown sums show a dash; mixed known contributions have a star and never become a complete total',()=>{
  const old=dose('concerta',start-48*HOUR),at=start+12*HOUR;
  const current={...dose('ritalin',at-2*HOUR),strength:'10',packageStrength:'10',amountMg:'10'};
  const unknown=groupedTotals([old],at,true).Methylphenidate;
  assert.equal(unknown.value,0);assert.equal(unknown.complete,false);
  assert.equal(hasKnownTotal(unknown,at),false);assert.equal(timelineReading(unknown,at),'—');
  const mixed=groupedTotals([old,current],at,true).Methylphenidate;
  assert.equal(mixed.complete,false);assert.equal(timelineReading(mixed,at),'4.30*');
  assert.equal(timelineReading(groupedTotals([current],at,true).Methylphenidate,at),'4.30');
  const beforeCurrent=groupedTotals([old,{...current,administeredAt:new Date(at+HOUR).toISOString()}],at,true).Methylphenidate;
  assert.equal(timelineReading(beforeCurrent,at),'—');
});

test('rendered partial and entirely missing readings have precise per-panel footnotes',()=>{
  const old=dose('concerta',start-48*HOUR),ir={...dose('ritalin',start+10*HOUR),strength:'10',packageStrength:'10',amountMg:'10'};
  const partial=render([old,ir]);
  assert.match(partial,/<strong>4\.30\*<\/strong>/);
  assert.match(partial,/Known contributions only/);
  assert.equal((partial.match(/class="chart-no-data"/g)||[]).length,1);
  const unknown=render([old]);
  assert.match(unknown,/<strong>—<\/strong>/);assert.doesNotMatch(unknown,/<strong>0\.00<\/strong>/);
  assert.match(unknown,/class="chart-no-data"[^>]*>\* No data<\/span>/);
  const separate=render([ir,dose('metformin-ir',start+HOUR)]);
  const panels=separate.split('class="analyte-panel"');
  assert.doesNotMatch(panels[1],/class="chart-no-data"/);
  assert.match(panels[2],/class="chart-no-data"/);
});

test('long views mark missing Concerta tail while empty or future-only unmodeled views do not',()=>{
  const row=dose('concerta',start+8*HOUR);
  assert.doesNotMatch(render([row]),/\* No data/);
  assert.match(render([row],3),/\* No data/);
  assert.doesNotMatch(render([]),/\* No data/);
  assert.doesNotMatch(render([dose('metformin-ir',end+HOUR)]),/\* No data/);
});
