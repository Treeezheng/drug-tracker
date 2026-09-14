import test from 'node:test';
import assert from 'node:assert/strict';
import { Children, createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TimelineChart, { TimelineEmptyState } from '../src/components/TimelineChart.tsx';
import { newDose } from '../src/components/DoseEditor.tsx';
import { scopeTimeline } from '../src/lib/timeline-scope.ts';
import type { Dose, Profile } from '../src/lib/types.ts';

const start=Date.parse('2026-09-13T00:00:00Z'),end=start+86_400_000;
const profile:Profile={name:'',timeZone:'UTC',timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
const render=(doses:Dose[],extra:Partial<Parameters<typeof TimelineChart>[0]>={})=>renderToStaticMarkup(createElement(TimelineChart,{doses,date:'2026-09-13',days:1,profile,publishedOnly:true,onProfile:()=>{},...extra}));

test('a truly empty chart shows one optional Add dose action without axes or invented readings',()=>{
  let additions=0;const onAddDose=()=>{additions++;};
  const html=render([],{onAddDose});
  assert.match(html,/Add a dose to see your timeline/);
  assert.equal((html.match(/<button\b/g)||[]).length,1);assert.match(html,/>Add dose<\/button>/);
  assert.doesNotMatch(html,/<svg|class="reading-control"|ng\/mL|\* No data/);
  assert.equal(additions,0);
  const tree=TimelineEmptyState({onAddDose});
  const button=Children.toArray(tree.props.children).find(child=>isValidElement(child)&&child.type==='button');
  assert.ok(isValidElement<{onClick:()=>void}>(button));button.props.onClick();assert.equal(additions,1);
  assert.doesNotMatch(render([]),/<button\b/);
});

test('an incomplete dose row invites completion instead of offering another empty row',()=>{
  for(const [rows,extra] of [
    [[{...newDose('ritalin','10'),administeredAt:''}],{}],
    [[{...newDose('ritalin','10'),amountMg:'',administeredAt:new Date(start).toISOString()}],{}],
    [[],{hasPendingDose:true}],
  ] as [Dose[],Partial<Parameters<typeof TimelineChart>[0]>][]){
    const html=render(rows,{...extra,onAddDose:()=>{throw Error('No new row should be added');}});
    assert.match(html,/Complete your dose to see the timeline/);assert.match(html,/dose row below/);
    assert.doesNotMatch(html,/<svg|<button\b|Add a dose to see/);
  }
});

test('valid but unmodeled medication retains the timing plot and its No data marker',()=>{
  for(const productId of ['metformin-ir','methylphenidate-ir','archived-product']){
    const original=newDose(productId==='archived-product'?'ritalin':productId);
    const html=render([{...original,productId,administeredAt:new Date(start+3_600_000).toISOString()}]);
    assert.match(html,/class="chart-svg"/);assert.match(html,/\* No data/);
    assert.doesNotMatch(html,/class="timeline-empty"|Add a dose to see|Complete your dose/);
  }
});

test('omitted old records remain disclosed in the empty view without claiming the record history is empty',()=>{
  for(const productId of ['ritalin','metformin-ir']){
    const old={...newDose(productId,productId==='ritalin'?'10':'500'),administeredAt:'2026-07-01T00:00:00Z',status:'actual' as const};
    const scope=scopeTimeline({actual:[old],drafts:[],start,end,publishedOnly:true});
    assert.equal(scope.doses.length,0);assert.equal(scope.omittedHistoryCount,1);
    const html=render(scope.doses,{omittedHistoryCount:scope.omittedHistoryCount,omittedUnknownHistoryCount:scope.omittedUnknownHistoryCount,onAddDose:()=>{}});
    assert.match(html,/No doses to plot in this view/);assert.match(html,/saved records are still available in History/);
    assert.doesNotMatch(html,/<svg|Add a dose to see your timeline/);
    if(productId==='metformin-ir')assert.match(html,/1 earlier record with unknown contributions is not shown/);
  }
});
