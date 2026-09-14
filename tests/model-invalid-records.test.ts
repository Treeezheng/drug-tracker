import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TimelineChart from '../src/components/TimelineChart.tsx';
import { newDose } from '../src/components/DoseEditor.tsx';
import { blankAssumptions, concentration, contributionForGroup, contributions, effectWindow, groupedTotals, includeTimelineDose, modelGroup } from '../src/lib/model.ts';
import { scopeTimeline } from '../src/lib/timeline-scope.ts';
import { hasMissingTimelineData, timelineReading } from '../src/lib/timeline-data.ts';
import type { Dose, Profile } from '../src/lib/types.ts';

const HOUR=3_600_000,start=Date.parse('2026-09-13T00:00:00Z'),end=start+24*HOUR,at=start+12*HOUR;
const profile:Profile={name:'',timeZone:'UTC',timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
const recorded=(patch:Partial<Dose>={}):Dose=>({...newDose('ritalin','10'),status:'actual',administeredAt:new Date(at-2*HOUR).toISOString(),...patch});
const render=(doses:Dose[])=>renderToStaticMarkup(createElement(TimelineChart,{doses,date:'2026-09-13',days:1,profile,publishedOnly:true,onProfile:()=>{}}));

test('invalid saved amounts, quantities and strengths qualify the total instead of becoming zero',()=>{
  const known=recorded();
  for(const patch of [
    ...['','0','-1','NaN','Infinity','1e1',' 10'].map(amountMg=>({amountMg})),
    ...['','0','-1','NaN'].map(quantity=>({quantity})),
    {strength:''},{strength:'0'},{quantity:'2'},{packageStrength:'5'},
  ]){
    const invalid=recorded(patch),snapshot=JSON.stringify(invalid);
    assert.equal(concentration(invalid,at).value,null,JSON.stringify(patch));
    const total=groupedTotals([known,invalid],at).Methylphenidate;
    assert.equal(total.complete,false);assert.equal(timelineReading(total,at),'4.30*');
    assert.equal(timelineReading(groupedTotals([invalid],at).Methylphenidate,at),'—');
    assert.equal(hasMissingTimelineData([invalid],start,end,true),true);
    assert.match(render([known,invalid]),/<sup>\*<\/sup><\/button><strong>4\.30<\/strong>/);
    assert.equal(JSON.stringify(invalid),snapshot);
  }
});

test('missing or malformed saved times survive scope selection without inventing a timestamp',()=>{
  const known=recorded();
  for(const administeredAt of ['','invalid','0','2026-02-30T10:00:00Z']){
    const invalid=recorded({administeredAt}),scoped=scopeTimeline({actual:[known,invalid],drafts:[],start,end,publishedOnly:true});
    assert.deepEqual(scoped.doses,[known,invalid]);assert.equal(scoped.omittedHistoryCount,0);
    assert.equal(concentration(invalid,at).value,null);
    assert.equal(hasMissingTimelineData(scoped.doses,start,end,true),true);
    const html=render(scoped.doses);
    assert.match(html,/<sup>\*<\/sup><\/button><strong>4\.30<\/strong>/);assert.match(html,/Time unavailable/);assert.match(html,/\* No drug data/);
    assert.doesNotMatch(html,/NaN|Infinity/);
  }
});

test('skipped and valid future doses retain zero, and future records remain outside a past scope',()=>{
  const known=recorded(),future=recorded({administeredAt:new Date(end).toISOString()});
  assert.equal(concentration(future,at).value,0);
  assert.equal(concentration({...known,status:'skipped'},at).value,0);
  assert.equal(groupedTotals([known,{...known,id:'skip',status:'skipped'}],at).Methylphenidate.complete,true);
  assert.deepEqual(scopeTimeline({actual:[known,future],drafts:[],start,end}).doses,[known]);
  assert.equal(hasMissingTimelineData([future],start,end,true),false);
});

test('unfinished editor rows remain pending but the identical saved invalid record is unknown',()=>{
  const pending=recorded({status:'simulated',administeredAt:'',amountMg:''});
  assert.equal(includeTimelineDose(pending),false);assert.deepEqual(contributions([pending],at),[]);
  assert.equal(concentration(pending,at).value,null);
  for(const status of ['actual','planned'] as const){
    const saved={...pending,status};assert.equal(includeTimelineDose(saved),true);
    assert.equal(contributions([saved],at).length,1);
    assert.equal(groupedTotals([saved],at).Methylphenidate.complete,false);
  }
});

test('old invalid amounts remain unknown when omitted, and are retained with a current analyte',()=>{
  const old=recorded({amountMg:'0',administeredAt:'2026-01-01T10:00:00Z'});
  const omitted=scopeTimeline({actual:[old],drafts:[],start,end});
  assert.equal(omitted.omittedHistoryCount,1);assert.equal(omitted.omittedUnknownHistoryCount,1);
  const current=recorded(),scoped=scopeTimeline({actual:[old,current],drafts:[],start,end});
  assert.deepEqual(scoped.doses,[old,current]);
  assert.equal(timelineReading(groupedTotals(scoped.doses,at).Methylphenidate,at),'4.30*');
});

test('invalid relative illustrations cannot provide physical zero or an effect interval',()=>{
  for(const patch of [{quantity:'0'},{amountMg:''},{administeredAt:'invalid'}]){
    const invalid=recorded({strength:'5',packageStrength:'5',amountMg:'5',assumptions:{...blankAssumptions(),accepted:true},...patch});
    assert.equal(concentration(invalid,at).value,null);
    assert.equal(contributionForGroup(invalid,at,'Methylphenidate')?.value,null);
    assert.equal(effectWindow(invalid),null);
    assert.equal(groupedTotals([invalid],at)[modelGroup(invalid).group].complete,false);
  }
  assert.equal(concentration(recorded(),NaN).value,null);
  assert.equal(concentration(recorded(),Infinity).value,null);
});

test('valid liquid and compound scalar snapshots remain usable by saved relative illustrations',()=>{
  for(const productId of ['methylin-solution','azstarys','daytrana']){
    const dose={...newDose(productId),status:'actual' as const,administeredAt:new Date(at-2*HOUR).toISOString(),assumptions:{...blankAssumptions(),accepted:true}};
    assert.equal(typeof concentration(dose,at).value,'number');
  }
});
