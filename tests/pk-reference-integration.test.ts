import test from 'node:test';
import assert from 'node:assert/strict';
import { newDose, updateDose } from '../src/components/DoseEditor';
import { concentration, groupedTotals, pkReferenceForDose, plotGroups, referenceForDose } from '../src/lib/model';
import { estimateTotals } from '../src/lib/timeline-estimates';
import { scopeTimeline } from '../src/lib/timeline-scope';
import { sampleTimelinePanel, timelinePanelGeometry } from '../src/lib/timeline-series';
import { describeDoseFormula } from '../src/lib/model-formula';
import type { Dose } from '../src/lib/types';

const start=Date.parse('2026-09-14T08:00:00Z'),hour=3_600_000;
const dose=(id:string,strength:string):Dose=>({...newDose(id,strength),status:'actual',administeredAt:new Date(start).toISOString()});
const close=(value:number,expected:number)=>assert.ok(Math.abs(value-expected)<1e-8,`${value} != ${expected}`);

test('the reported 7.5 mg mixed-salts dose reaches separate FDA-based d/l estimates without changing its record',()=>{
  const row=dose('amphetamine-salts-ir','7.5'),before=structuredClone(row);
  const d=estimateTotals([row],start+2.72*hour)['d-Amphetamine'];
  const l=estimateTotals([row],start+2.89*hour)['l-Amphetamine'];
  close(d.value,15.7*.75);close(l.value,5.02*.75);
  assert.equal(d.hasReference,true);assert.equal(d.complete,true);assert.equal(d.directComplete,false);
  assert.equal(l.hasReference,true);assert.equal(l.complete,true);
  assert.equal(concentration(row,start+2.72*hour).value,null);
  assert.deepEqual(plotGroups(row),['d-Amphetamine','l-Amphetamine']);
  assert.equal(estimateTotals([row],start-1)['d-Amphetamine'].value,0);
  assert.deepEqual(row,before);assert.match(describeDoseFormula(row).note,/FDA|study|population|reference/i);
});

test('halves stay exact for permitted IR illustrations; altered records and split ER keep their unknown contribution',()=>{
  const original=dose('amphetamine-salts-ir','10'),half=updateDose(original,{quantity:'0.5'},'UTC');
  assert.equal(half.amountMg,'5');assert.equal(half.unusual,undefined);
  close(estimateTotals([half],start+2.72*hour)['d-Amphetamine'].value,7.85);
  const full=updateDose(half,{quantity:'1'},'UTC');
  close(estimateTotals([full],start+2.72*hour)['d-Amphetamine'].value,15.7);
  assert.equal(pkReferenceForDose({...half,unusual:true}),null);
  assert.equal(updateDose({...half,unusual:true},{quantity:'1'},'UTC').unusual,true);
  for(const row of [updateDose(dose('adderall-xr','10'),{quantity:'0.5'},'UTC'),updateDose(dose('cotempla-xr-odt','25.9'),{quantity:'0.5'},'UTC')]){
    assert.equal(pkReferenceForDose(row),null);
    for(const total of Object.values(estimateTotals([row],start+8*hour)))assert.equal(total.complete,false);
  }
  const irHalf=updateDose(dose('methylphenidate-ir','10'),{quantity:'0.5'},'UTC');
  assert.ok(referenceForDose(irHalf));close(estimateTotals([irHalf],start+2*hour).Methylphenidate.value,2.15);
  assert.equal(referenceForDose(updateDose(dose('concerta','18'),{quantity:'0.5'},'UTC')),null);
});

test('no salt, package, historical version or invalid timestamp can silently enter a new reference',()=>{
  const row=dose('amphetamine-salts-ir','7.5');
  for(const patch of [{unit:'mL'},{strengthUnit:'mg/mL'},{amountMg:'10'},{packageStrength:'10'},{strength:'3.75',packageStrength:'3.75',amountMg:'3.75'},
    {formulation:'Extended-release capsule'},{amountBasis:'first listed ingredient' as const},{administeredAt:'invalid'},
    {modelVersion:'unavailable-version'},{unusual:true},{status:'skipped' as const}])assert.equal(pkReferenceForDose({...row,...patch}),null,JSON.stringify(patch));
  const nan=estimateTotals([row],NaN)['d-Amphetamine'];assert.equal(nan.complete,false);assert.equal(nan.value,0);
});

test('earlier amphetamine estimates survive the next day and draw one history tail per selected analyte',()=>{
  const row=dose('amphetamine-salts-ir','7.5'),next=start+24*hour;
  const scope=scopeTimeline({actual:[row],drafts:[],start:next,end:next+24*hour});
  assert.deepEqual(scope.doses,[row]);assert.ok(scope.sourceIds.includes('A1'));
  const times=Array.from({length:25},(_,i)=>next+i*hour),samples=sampleTimelinePanel([row],'l-Amphetamine',times,false);
  assert.ok(samples.series.every(point=>point.known&&point.value>0));
  const geometry=timelinePanelGeometry(samples,times,800,260,next,next+24*hour);
  assert.ok(geometry.historyPath.startsWith('M'));assert.equal(geometry.hasCurrent,false);
  const two={...row,id:'second',administeredAt:new Date(next).toISOString()};
  const total=estimateTotals([row,two],next+3*hour)['d-Amphetamine'];
  close(total.value,estimateTotals([row],next+3*hour)['d-Amphetamine'].value+estimateTotals([two],next+3*hour)['d-Amphetamine'].value);
  assert.equal(estimateTotals([row,row],next)['d-Amphetamine'].items.length,1);
});

test('unsupported amphetamine and saved relative assumptions cannot make d/l physical totals complete',()=>{
  const known=dose('amphetamine-salts-ir','10'),missing=dose('adzenys-xr-odt','9.4');
  const totals=estimateTotals([known,missing],start+3*hour);
  assert.equal(totals['d-Amphetamine'].complete,false);assert.equal(totals['l-Amphetamine'].complete,false);
  assert.equal(totals['d-Amphetamine'].items[1].value,null);
  assert.equal(groupedTotals([known],start+3*hour)['d-Amphetamine'].complete,false);
  assert.equal(totals.Methylphenidate,undefined);
});
