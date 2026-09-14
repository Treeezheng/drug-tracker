import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TimelineChart from '../src/components/TimelineChart.tsx';
import { newDose } from '../src/components/DoseEditor.tsx';
import { blankAssumptions, concentration, concentrationAnalyte, contributionForGroup, groupedTotals, modelGroup } from '../src/lib/model.ts';
import { scopeTimeline } from '../src/lib/timeline-scope.ts';
import { hasMissingTimelineData, timelineReading } from '../src/lib/timeline-data.ts';
import type { Dose, Profile } from '../src/lib/types.ts';

const HOUR=3_600_000,start=Date.parse('2026-09-13T00:00:00Z'),end=start+24*HOUR,at=start+12*HOUR;
const profile:Profile={name:'',timeZone:'UTC',timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
const dose=(productId:string,strength:string,instant=at-2*HOUR):Dose=>({...newDose(productId,strength),administeredAt:new Date(instant).toISOString(),status:'actual'});
const render=(rows:Dose[])=>{
  const scoped=scopeTimeline({actual:rows,drafts:[],start,end,publishedOnly:true});
  return renderToStaticMarkup(createElement(TimelineChart,{doses:scoped.doses,date:'2026-09-13',days:1,profile,publishedOnly:true,omittedUnknownHistoryCount:scoped.omittedUnknownHistoryCount,onProfile:()=>{}}));
};

test('same-day unknown 5 mg shares analyte identity with reference 10 mg without borrowing its curve',()=>{
  const known=dose('ritalin','10'),unknown=dose('ritalin','5');
  assert.equal(modelGroup(known).reference,true);assert.equal(modelGroup(unknown).reference,false);
  assert.deepEqual(concentrationAnalyte(unknown),concentrationAnalyte(known));
  assert.equal(concentration(unknown,at,true).value,null);
  const total=groupedTotals([known,unknown],at,true).Methylphenidate;
  assert.equal(total.complete,false);assert.equal(total.value,4.3);assert.equal(timelineReading(total,at),'4.30*');
  assert.deepEqual(total.items.map(item=>item.dose.id),[known.id,unknown.id]);
  const html=render([known,unknown]);
  assert.match(html,/<strong>4\.30\*<\/strong>/);assert.match(html,/\* No data/);assert.doesNotMatch(html,/>Modeled total</);
  assert.equal((html.match(/class="analyte-panel"/g)||[]).length,1);
});

test('unknown previous-day and remote same-analyte records remain in the displayed reference total',()=>{
  const known=dose('ritalin','10');
  for(const administeredAt of [start-16*HOUR,start-2400*HOUR]){
    const unknown=dose('ritalin','5',administeredAt),before=JSON.stringify([known,unknown]);
    const scoped=scopeTimeline({actual:[unknown,known],drafts:[],start,end,publishedOnly:true});
    assert.deepEqual(scoped.doses,[unknown,known]);assert.equal(scoped.omittedHistoryCount,0);
    assert.equal(timelineReading(groupedTotals(scoped.doses,at,true).Methylphenidate,at),'4.30*');
    assert.equal(hasMissingTimelineData(scoped.doses,start,end,true,'Methylphenidate'),true);
    const html=render([unknown,known]);assert.match(html,/Earlier recorded doses have unknown contributions/);
    assert.match(html,/<strong>4\.30\*<\/strong>/);assert.equal(JSON.stringify([known,unknown]),before);
  }
});

test('generic and other methylphenidate formulations qualify a brand reference sum without inheriting its model',()=>{
  const known=dose('ritalin','10');
  for(const unknown of [dose('methylphenidate-ir','10'),dose('ritalin-la','10',start-HOUR),dose('concerta','27',start-HOUR)]){
    assert.equal(modelGroup(unknown).reference,false);assert.equal(concentration(unknown,at,true).value,null);
    const scoped=scopeTimeline({actual:[unknown,known],drafts:[],start,end,publishedOnly:true});
    assert.ok(scoped.doses.includes(unknown));
    assert.equal(timelineReading(groupedTotals(scoped.doses,at,true).Methylphenidate,at),'4.30*');
  }
});

test('unrelated compounds and enantiomer families do not contaminate the methylphenidate total',()=>{
  const known=dose('ritalin','10');
  for(const unknown of [dose('metformin-ir','500'),dose('adderall-ir','5'),dose('focalin','5'),dose('azstarys','26.1/5.2')]){
    assert.equal(concentrationAnalyte(unknown),null);
    const total=groupedTotals([known,unknown],at,true).Methylphenidate;
    assert.equal(total.complete,true);assert.equal(total.items.length,1);assert.equal(timelineReading(total,at),'4.30');
  }
});

test('saved relative illustrations cannot masquerade as physical concentrations or hide unknown history',()=>{
  const known=dose('ritalin','10'),unknown={...dose('ritalin','5',start-HOUR),assumptions:{...blankAssumptions(),accepted:true,amplitude:1_000_000}};
  const relative=concentration(unknown,at,true);
  assert.equal(relative.unit,'relative units');assert.ok(relative.value!>0);
  const physical=contributionForGroup(unknown,at,'Methylphenidate',true)!;
  assert.equal(physical.value,null);assert.equal(physical.unit,'ng/mL');
  const scoped=scopeTimeline({actual:[unknown,known],drafts:[],start,end,publishedOnly:true});
  assert.ok(scoped.doses.includes(unknown));
  const totals=groupedTotals(scoped.doses,at,true);
  assert.equal(timelineReading(totals.Methylphenidate,at),'4.30*');
  assert.equal(totals[relative.group].value,relative.value);
  const html=render([unknown,known]),panels=html.split('class="analyte-panel"');
  assert.equal(panels.length,3);assert.match(html,/<strong>4\.30\*<\/strong>/);
  const physicalPanel=panels.find(panel=>panel.includes('aria-label="Methylphenidate, ng/mL.'));
  assert.ok(physicalPanel,'The physical methylphenidate plot must remain separately identifiable.');
  assert.match(physicalPanel,/ng\/mL · estimate/);assert.match(physicalPanel,/\* No data/);
});

test('omitted unknown history is disclosed separately from negligible known history and does not become zero',()=>{
  const known=dose('ritalin','10'),oldUnknown=dose('metformin-ir','500',start-2400*HOUR);
  const scoped=scopeTimeline({actual:[known,oldUnknown],drafts:[],start,end,publishedOnly:true});
  assert.deepEqual(scoped.doses,[known]);assert.equal(scoped.omittedHistoryCount,1);assert.equal(scoped.omittedUnknownHistoryCount,1);
  assert.match(render([known,oldUnknown]),/1 earlier record with unknown contributions is not shown/);
  const oldOnly=scopeTimeline({actual:[dose('ritalin','5',start-2400*HOUR)],drafts:[],start,end,publishedOnly:true});
  assert.equal(oldOnly.omittedUnknownHistoryCount,1);
  const tiny=scopeTimeline({actual:[dose('ritalin','10',start-2400*HOUR)],drafts:[],start,end,publishedOnly:true});
  assert.equal(tiny.omittedHistoryCount,1);assert.equal(tiny.omittedUnknownHistoryCount,0);
});

test('future and skipped unknown doses do not mark an already complete reading incomplete before they contribute',()=>{
  const known=dose('ritalin','10'),future=dose('ritalin','5',at+HOUR);
  assert.equal(timelineReading(groupedTotals([known,future],at,true).Methylphenidate,at),'4.30');
  assert.equal(groupedTotals([known,{...future,status:'skipped'}],at+2*HOUR,true).Methylphenidate.complete,true);
});
