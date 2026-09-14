import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TimelineChart from '../src/components/TimelineChart.tsx';
import { newDose } from '../src/components/DoseEditor.tsx';
import { groupedTotals } from '../src/lib/model.ts';
import { timelineReading } from '../src/lib/timeline-data.ts';
import { scopeTimeline } from '../src/lib/timeline-scope.ts';
import { sources } from '../src/lib/catalog.ts';
import type { Dose, Profile } from '../src/lib/types.ts';

const start=Date.parse('2026-09-13T00:00:00Z'),hour=3_600_000;
const profile:Profile={name:'',timeZone:'UTC',timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
const dose=(productId:string,strength:string):Dose=>({...newDose(productId,strength),administeredAt:new Date(start).toISOString(),status:'actual'});
const render=(doses:Dose[],days=3,publishedOnly=false,onSources?:()=>void)=>renderToStaticMarkup(createElement(TimelineChart,{doses,date:'2026-09-13',days,profile,publishedOnly,onProfile:()=>{},onSources}));
function plottedPath(html:string,className:string){
  const tag=html.match(new RegExp(`<path\\b[^>]*class="${className}"[^>]*>`))?.[0]??'';
  const data=tag.match(/\bd="([^"]*)"/)?.[1]??'';
  const points=[...data.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(match=>[Number(match[1]),Number(match[2])]);
  return {tag,data,points};
}

test('a 72-hour Concerta chart retains a solid observed body and only a dashed estimated tail',()=>{
  const html=render([dose('concerta','18')]),solid=plottedPath(html,'total-reference-path'),tail=plottedPath(html,'total-estimated-path');
  assert.ok(solid.points.length>2);assert.ok(tail.points.length>2);
  assert.doesNotMatch(solid.tag,/stroke-dasharray/);assert.match(tail.tag,/stroke-dasharray="7 4"/);
  assert.equal(solid.points[0][0],40);assert.equal(tail.points.at(-1)![0],776);
  // The split is at the observation boundary (~30 h of 72 h), not at the chart's start.
  assert.ok(solid.points.at(-1)![0]>340&&solid.points.at(-1)![0]<350);
  assert.deepEqual(tail.points[0],solid.points.at(-1));
  assert.ok(Math.min(...solid.points.map(point=>point[1]))<150,'The solid body includes the reference peak.');
  assert.match(html,/Dashed tail: no observed data; estimated continuation/);
  assert.doesNotMatch(html,/class="chart-no-data"|reference-overlay-path/);
});

test('published-only mode still stops the Concerta trace without drawing an unobserved continuation',()=>{
  const html=render([dose('concerta','18')],3,true),solid=plottedPath(html,'total-reference-path');
  assert.ok(solid.points.length>2);assert.ok(solid.points.at(-1)![0]<350);
  assert.equal(plottedPath(html,'total-estimated-path').data,'');
  assert.match(html,/\* No data/);assert.doesNotMatch(html,/Dashed tail: no observed data/);
});

test('generic-only reference is dashed and labelled while its actual reading and total remain unknown',()=>{
  const generic=dose('methylphenidate-ir','10'),before=structuredClone(generic),html=render([generic],1);
  const overlay=plottedPath(html,'reference-overlay-path');
  assert.ok(overlay.points.length>2);assert.match(overlay.tag,/stroke-dasharray="7 4"/);
  assert.equal(plottedPath(html,'total-reference-path').data,'');assert.equal(plottedPath(html,'total-estimated-path').data,'');
  assert.match(html,/No direct data for this product/);assert.match(html,/Ritalin 10 mg reference only; excluded from the total/);
  assert.match(html,/Reference illustration\*/);assert.match(html,/<strong>—<\/strong> <small>ng\/mL<\/small>/);
  const total=groupedTotals([generic],start+2*hour,false).Methylphenidate;
  assert.equal(total.complete,false);assert.equal(timelineReading(total,start+2*hour),'—');
  assert.deepEqual(generic,before);
});

test('a reference overlay never completes or adds to a mixed product total',()=>{
  const generic=dose('methylphenidate-ir','10'),brand=dose('ritalin','10');
  const total=groupedTotals([generic,brand],start+2*hour,false).Methylphenidate;
  assert.equal(total.value,4.3);assert.equal(total.complete,false);assert.equal(timelineReading(total,start+2*hour),'4.30*');
  const html=render([generic,brand],1);
  assert.ok(plottedPath(html,'reference-overlay-path').points.length>2);
  assert.equal(plottedPath(html,'total-reference-path').data,'');assert.ok(plottedPath(html,'total-estimated-path').points.length>2);
  assert.match(html,/Known contributions\*/);assert.match(html,/excluded from the total/);
});

test('wholly unmodeled medication has dose timing but no invented concentration or reference path',()=>{
  for(const item of [dose('metformin-ir','500'),dose('amphetamine-salts-ir','10'),dose('methylphenidate-ir','5')]){
    const html=render([item],1);
    assert.match(html,/aria-label="Dose times"/);assert.match(html,/\* No data/);
    assert.doesNotMatch(html,/reference-overlay-path|total-reference-path|total-estimated-path|ng\/mL|class="reading-control"/);
  }
});

test('displayed generic overlay includes both reference sources and a visible Sources & methods action',()=>{
  const generic=dose('methylphenidate-ir','10'),scope=scopeTimeline({actual:[generic],drafts:[],start,end:start+24*hour});
  assert.deepEqual(scope.sourceIds,['S2','S3']);
  assert.ok(scope.sourceIds.every(id=>sources.some(source=>source.id===id&&source.url.startsWith('https://'))));
  assert.match(render(scope.doses,1,false,()=>{}),/<button[^>]*>Sources &amp; methods<\/button>/);
  const pending={...generic,administeredAt:'',status:'simulated' as const};
  assert.deepEqual(scopeTimeline({actual:[],drafts:[pending],start,end:start+24*hour}).sourceIds,['S2']);
  const hidden={...generic,administeredAt:'2026-07-01T00:00:00Z'};
  const remote=scopeTimeline({actual:[hidden],drafts:[],start,end:start+24*hour});
  assert.deepEqual(remote.sourceIds,[]);assert.equal(remote.omittedUnknownHistoryCount,1);
});
