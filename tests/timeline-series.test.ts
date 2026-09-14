import test from 'node:test';
import assert from 'node:assert/strict';
import { newDose } from '../src/components/DoseEditor';
import { blankAssumptions, contributesToGroup, concentrationAnalytes, includeTimelineDose, modelGroup } from '../src/lib/model';
import { estimateContribution, estimateTotals } from '../src/lib/timeline-estimates';
import { hasKnownTotal } from '../src/lib/timeline-data';
import { sampleTimelinePanel, timelinePanelGeometry } from '../src/lib/timeline-series';
import type { Dose } from '../src/lib/types';

const start=Date.parse('2026-09-14T00:00:00Z'),hour=3_600_000;
const dose=(id:string,strength:string):Dose=>({...newDose(id,strength),status:'actual',administeredAt:new Date(start).toISOString()});

test('shared chart samples preserve direct, scaled, unknown, future and relative-unit contributions at every boundary',()=>{
  const records=[dose('ritalin','10'),dose('methylphenidate-ir','5'),dose('concerta','18'),dose('concerta','36'),
    dose('metformin-ir','500'),dose('amphetamine-salts-ir','10'),dose('clonidine-er','0.1'),dose('jornay-pm','20'),
    {...dose('concerta','18'),administeredAt:'invalid'},
    {...dose('ritalin','10'),administeredAt:new Date(start+48*hour).toISOString()},
    {...dose('ritalin','10'),status:'skipped' as const},
    {...dose('amphetamine-salts-ir','10'),assumptions:{...blankAssumptions(),accepted:true}}];
  const before=structuredClone(records);
  const groups=new Set(records.flatMap(d=>[modelGroup(d).group,...concentrationAnalytes(d).map(value=>value.group)]));
  const times=[start-1,start,start+2*hour,start+29.976*hour,start+29.976*hour+1,start+32*hour,start+48*hour,start+72*hour];
  for(const publishedOnly of [false,true])for(const group of groups){
    const members=records.filter(d=>includeTimelineDose(d)&&contributesToGroup(d,group));
    const prepared=sampleTimelinePanel(members,group,times,publishedOnly);
    times.forEach((at,i)=>{
      const expected=estimateTotals(members,at,publishedOnly)[group],actual=prepared.series[i];
      assert.equal(actual.value,expected?.value??0);assert.equal(actual.known,hasKnownTotal(expected,at));
      assert.equal(actual.complete,expected?.complete??false);assert.equal(actual.tail,expected?.tail??false);
      assert.equal(actual.hasReference,expected?.hasReference??false);assert.equal(actual.unit,expected?.unit??'');
      for(const curve of prepared.curves)assert.equal(curve.values[i],estimateContribution(curve.dose,at,group,publishedOnly)?.value??null);
    });
  }
  assert.deepEqual(records,before);
});

test('small ng/mL scales stay readable and duplicate IDs do not double the plotted total',()=>{
  const d=dose('clonidine-er','0.1'),duplicate={...d},times=[start,start+6.5*hour,start+24*hour];
  const samples=sampleTimelinePanel([d,duplicate],'Clonidine',times,false);
  assert.ok(Math.abs(samples.series[1].value-.258)<1e-9);
  assert.equal(samples.curves[1].values[1],null);
  const geometry=timelinePanelGeometry(samples,times,393,260,start,start+24*hour);
  assert.equal(geometry.ceiling,.5);
  assert.ok(geometry.ceiling>samples.max&&geometry.ceiling<1);
  const invalid={...d,quantity:'2'};
  const revised=sampleTimelinePanel([invalid],'Clonidine',times,false);
  assert.equal(revised.series[1].known,false);assert.equal(revised.series[1].complete,false);
  assert.equal(revised.curves[0].values[1],null,'A fresh edit must be revalidated, never reuse a previous sample');
});

test('geometry preserves the observed/estimated split, null gaps, and accepts many curves without argument spreading',()=>{
  const times=[start,start+hour,start+2*hour,start+3*hour];
  const sample={value:2,unit:'ng/mL',known:true,complete:true,tail:false,hasReference:false};
  const samples={max:2,series:[sample,sample,{...sample,tail:true},{...sample,known:false}],
    curves:Array.from({length:1000},()=>({dose:dose('ritalin','10'),reference:false,values:[0,null,2,1]}))};
  const plot=timelinePanelGeometry(samples,times,800,260,start,start+3*hour);
  assert.equal(plot.curves.length,1000);assert.equal(plot.ceiling,6);
  assert.equal((plot.curves[0].path.match(/M/g)||[]).length,2);
  assert.match(plot.totalPaths.solid,/M40.00,/);assert.ok(plot.totalPaths.estimated.startsWith(' M285.33,'));
  assert.doesNotMatch(plot.totalPaths.estimated,/776.00/,'Unknown endpoints must not be joined into a total.');
});


test('history aggregation sums only earlier available values and preserves unknown gaps',()=>{
  const times=[start,start+hour,start+2*hour];
  const row={value:0,unit:'ng/mL',known:false,complete:false,tail:false,hasReference:false};
  const samples={max:6,series:[row,row,row],curves:[
    {dose:{...dose('ritalin','10'),administeredAt:new Date(start-hour).toISOString()},reference:false,values:[1,null,2]},
    {dose:{...dose('concerta','18'),administeredAt:new Date(start-2*hour).toISOString()},reference:false,values:[2,null,3]},
    {dose:dose('ritalin','10'),reference:false,values:[0,4,1]},
  ]};
  const chart=timelinePanelGeometry(samples,times,800,260,start,start+2*hour);
  assert.equal(chart.hasCurrent,true);
  assert.equal((chart.historyPath.match(/M/g)||[]).length,2);
  assert.doesNotMatch(chart.historyPath,/L/);
  const allCurrent=timelinePanelGeometry({...samples,curves:samples.curves.slice(2)},times,800,260,start,start+2*hour);
  assert.equal(allCurrent.historyPath,'');
});
