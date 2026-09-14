import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TimelineChart from '../src/components/TimelineChart.tsx';
import { newDose } from '../src/components/DoseEditor.tsx';
import { groupedTotals } from '../src/lib/model.ts';
import { estimateTotals } from '../src/lib/timeline-estimates.ts';
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

test('a 72-hour Concerta chart retains a solid observed body and a separately identified solid estimated tail',()=>{
  const html=render([dose('concerta','18')]),solid=plottedPath(html,'total-reference-path'),tail=plottedPath(html,'total-estimated-path');
  assert.ok(solid.points.length>2);assert.ok(tail.points.length>2);
  assert.doesNotMatch(solid.tag,/stroke-dasharray/);assert.doesNotMatch(tail.tag,/stroke-dasharray/);
  assert.equal(solid.points[0][0],40);assert.equal(tail.points.at(-1)![0],776);
  // The split is at the observation boundary (~30 h of 72 h), not at the chart's start.
  assert.ok(solid.points.at(-1)![0]>340&&solid.points.at(-1)![0]<350);
  assert.deepEqual(tail.points[0],solid.points.at(-1));
  assert.ok(Math.min(...solid.points.map(point=>point[1]))<150,'The solid body includes the reference peak.');
  assert.match(html,/\* No drug data/);
  assert.match(html,/class="text-button chart-estimate-note"[^>]*>\* No direct data · Estimated<\/button>/);
  assert.match(html,/estimated continuation/);
  assert.doesNotMatch(html,/reference-overlay-path/);
});

test('published-only mode still stops the Concerta trace without drawing an unobserved continuation',()=>{
  const html=render([dose('concerta','18')],3,true),solid=plottedPath(html,'total-reference-path');
  assert.ok(solid.points.length>2);assert.ok(solid.points.at(-1)![0]<350);
  assert.equal(plottedPath(html,'total-estimated-path').data,'');
  assert.match(html,/\* No drug data/);assert.doesNotMatch(html,/Dashed tail: no observed data/);
  assert.match(html,/class="text-button chart-estimate-note"[^>]*>\* No direct data<\/button>/);
  assert.doesNotMatch(html,/No direct data · Estimated/);
});

test('generic reference is solid and included only in the starred display estimate, not direct evidence',()=>{
  const generic=dose('methylphenidate-ir','10'),before=structuredClone(generic),html=render([generic],1);
  const overlay=plottedPath(html,'reference-overlay-path');
  assert.ok(overlay.points.length>2);assert.doesNotMatch(overlay.tag,/stroke-dasharray/);
  assert.equal(plottedPath(html,'total-reference-path').data,'');assert.ok(plottedPath(html,'total-estimated-path').points.length>2);
  assert.match(html,/\* No drug data/);assert.match(html,/Reference estimate/);
  const headingNote=html.match(/class="text-button chart-estimate-note" aria-controls="([^"]+)"[^>]*>\* No direct data · Estimated<\/button>/);
  assert.ok(headingNote,'One header note identifies the reference estimate.');
  assert.equal((html.match(/class="text-button chart-estimate-note"/g)||[]).length,1);
  assert.ok(html.includes(`class="chart-no-data" id="${headingNote[1]}"`),'The header note targets the shared explanation.');
  const legend=html.split('class="chart-legend"')[1].split('class="chart-summary"')[0];
  assert.doesNotMatch(legend,/data-note-link|<sup>\*<\/sup>/);
  assert.match(html,/<span class="reading-number"><button[^>]*><sup>\*<\/sup><\/button><strong>[\d.]+<\/strong><\/span> <small>ng\/mL<\/small>/);
  assert.equal(estimateTotals([generic],start+2*hour).Methylphenidate.value,4.3);
  const total=groupedTotals([generic],start+2*hour,false).Methylphenidate;
  assert.equal(total.complete,false);assert.equal(timelineReading(total,start+2*hour),'—');
  assert.deepEqual(generic,before);
});

test('a display total includes a labeled reference while direct evidence stays incomplete',()=>{
  const generic=dose('methylphenidate-ir','10'),brand=dose('ritalin','10');
  const total=groupedTotals([generic,brand],start+2*hour,false).Methylphenidate;
  assert.equal(total.value,4.3);assert.equal(total.complete,false);assert.equal(timelineReading(total,start+2*hour),'4.30*');
  const html=render([generic,brand],1);
  assert.ok(plottedPath(html,'reference-overlay-path').points.length>2);
  assert.equal(plottedPath(html,'total-reference-path').data,'');assert.ok(plottedPath(html,'total-estimated-path').points.length>2);
  assert.match(html,/Estimated total/);assert.match(html,/Reference estimate/);
  const display=estimateTotals([generic,brand],start+2*hour).Methylphenidate;
  assert.equal(display.value,8.6);assert.equal(display.complete,true);assert.equal(display.directComplete,false);
  assert.match(html,/<sup>\*<\/sup><\/button><strong>/);
});

test('wholly unmodeled medication has dose timing but no invented concentration or reference path',()=>{
  for(const item of [dose('metformin-ir','500'),dose('amphetamine-salts-ir','10')]){
    const html=render([item],1);
    assert.match(html,/aria-label="Dose times"/);assert.match(html,/\* No drug data/);
    assert.doesNotMatch(html,/reference-overlay-path|total-reference-path|total-estimated-path|ng\/mL|class="reading-control"/);
    assert.match(html,/class="text-button chart-estimate-note"[^>]*>\* No direct data<\/button>/);
    assert.doesNotMatch(html,/No direct data · Estimated/);
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


test('a direct-data-only chart still has sources and its formula in the same expandable location',()=>{
  const html=render([dose('concerta','18')],1);
  assert.match(html,/<button[^>]*class="text-button chart-sources-toggle"[^>]*>Sources &amp; methods<\/button>/);
  assert.match(html,/<summary[^>]*>Sources &amp; methods<\/summary>/);
  assert.doesNotMatch(html,/\* No drug data/);
  assert.doesNotMatch(html,/chart-estimate-note/);
  assert.match(html,/formula/i);
  assert.ok(html.includes(sources.find(source=>source.id==='S1')!.url));
  assert.equal((html.match(/Simulation only · Not medical advice/g)||[]).length,1);
});

test('the header identifies an estimated tail anywhere in the plot while the selected reading remains direct',()=>{
  const concerta={...dose('concerta','18'),administeredAt:new Date(start-8*hour).toISOString()};
  const html=render([concerta],1),reading=html.split('class="chart-summary"')[1].split('class="chart-footer"')[0];
  assert.match(html,/class="text-button chart-estimate-note"[^>]*>\* No direct data · Estimated<\/button>/);
  assert.ok(plottedPath(html,'total-estimated-path').points.length>1);
  assert.doesNotMatch(reading,/data-note-link/);
});

test('an entirely unavailable reference and future-only reference do not claim a plotted estimate',()=>{
  const unavailable={...dose('concerta','27'),administeredAt:new Date(start-48*hour).toISOString()};
  const missing=render([unavailable],1,true);
  assert.match(missing,/class="text-button chart-estimate-note"[^>]*>\* No direct data<\/button>/);
  assert.doesNotMatch(missing,/No direct data · Estimated/);
  assert.equal(plottedPath(missing,'total-estimated-path').data,'');
  const future={...dose('methylphenidate-ir','10'),administeredAt:new Date(start+25*hour).toISOString()};
  assert.doesNotMatch(render([future],1),/chart-estimate-note/);
});
