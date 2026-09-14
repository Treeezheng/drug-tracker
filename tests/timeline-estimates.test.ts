import test from 'node:test';
import assert from 'node:assert/strict';
import { newDose } from '../src/components/DoseEditor.tsx';
import { blankAssumptions, concentration, groupedTotals } from '../src/lib/model.ts';
import { estimateContribution, estimateTotals } from '../src/lib/timeline-estimates.ts';
import { hasKnownTotal } from '../src/lib/timeline-data.ts';
import { scopeTimeline } from '../src/lib/timeline-scope.ts';
import type { Dose } from '../src/lib/types.ts';

const start=Date.parse('2026-09-13T08:00:00Z'),hour=3_600_000,peak=start+2*hour;
const dose=(id:string,strength:string):Dose=>({...newDose(id,strength),administeredAt:new Date(start).toISOString(),status:'actual'});

test('display estimates add an identified reference while retaining the original evidence-qualified total',()=>{
  const brand=dose('ritalin','10'),generic=dose('methylphenidate-ir','10'),input=[brand,generic],before=structuredClone(input);
  const total=estimateTotals(input,peak).Methylphenidate;
  assert.equal(total.value,8.6);assert.equal(total.complete,true);assert.equal(total.hasReference,true);
  assert.equal(total.directValue,4.3);assert.equal(total.directComplete,false);
  assert.deepEqual(total.items.map(item=>[item.value,item.directValue,item.hasReference]),[[4.3,4.3,false],[4.3,null,true]]);
  assert.equal(hasKnownTotal(total,peak),true);
  const direct=groupedTotals(input,peak).Methylphenidate;
  assert.equal(direct.value,4.3);assert.equal(direct.complete,false);
  assert.deepEqual(input,before);
  assert.equal(estimateTotals([generic,generic],peak).Methylphenidate.value,4.3,'Duplicate record IDs are not two administrations.');
});

test('scaled estimates expose 5/20 mg IR and 36 mg Concerta numbers, with unvalidated provenance',()=>{
  const five=dose('methylphenidate-ir','5'),twenty=dose('methylphenidate-ir','20');
  assert.equal(estimateTotals([five,twenty],peak).Methylphenidate.value,10.75);
  const concerta=dose('concerta','36'),total=estimateTotals([concerta],peak).Methylphenidate;
  assert.equal(total.value,concentration(dose('concerta','18'),peak).value!*2);
  assert.equal(total.hasReference,true);assert.equal(total.directComplete,false);
  assert.match(total.items[0].reason,/scaling is unvalidated/);
  assert.equal(estimateTotals([concerta],start+72*hour).Methylphenidate.tail,true);
  const limited=estimateTotals([concerta],start+72*hour,true).Methylphenidate;
  assert.equal(limited.complete,false);assert.equal(hasKnownTotal(limited,start+72*hour),false);
});

test('unknown items remain missing and distinct analytes, relative illustrations, salts and liquids never borrow a reference',()=>{
  const generic=dose('methylphenidate-ir','10'),unknown=dose('methylin-solution','1');
  const mixed=estimateTotals([generic,unknown],peak).Methylphenidate;
  assert.equal(mixed.value,4.3);assert.equal(mixed.complete,false);assert.equal(mixed.hasReference,true);
  for(const item of [unknown,dose('amphetamine-salts-ir','10'),dose('dexmethylphenidate-ir','5'),dose('metformin-ir','500')]){
    for(const total of Object.values(estimateTotals([item],peak))){assert.equal(total.hasReference,false);assert.equal(total.complete,false);assert.equal(hasKnownTotal(total,peak),false);assert.equal(total.items[0].value,null);}
  }
  assert.equal(estimateContribution(generic,peak,'Dexmethylphenidate'),undefined);
  const relative={...generic,assumptions:{...blankAssumptions(),accepted:true}};
  const totals=estimateTotals([relative],peak);
  assert.equal(totals.Methylphenidate.items[0].value,null);assert.equal(totals.Methylphenidate.hasReference,false);
  assert.ok(Object.values(totals).some(total=>total.unit==='relative units'&&total.value>0&&!total.hasReference));
});

test('bad input cannot become zero, and a future zero cannot hide an already unknown administration',()=>{
  for(const patch of [{administeredAt:'bad'},{quantity:'0'},{amountMg:'9'},{packageStrength:'7.5'}]){
    const bad={...dose('methylphenidate-ir','10'),...patch},total=estimateTotals([bad],peak).Methylphenidate;
    assert.equal(total.items[0].value,null);assert.equal(total.hasReference,false);assert.equal(hasKnownTotal(total,peak),false);
  }
  const unknown=dose('methylin-solution','1'),future={...dose('methylphenidate-ir','10'),administeredAt:new Date(peak+hour).toISOString()};
  assert.equal(hasKnownTotal(estimateTotals([unknown,future],peak).Methylphenidate,peak),false);
  assert.deepEqual(estimateTotals([{...future,status:'skipped'}],peak),{});
});

test('a meaningful earlier reference remains in scope and supplies its explanation sources',()=>{
  const earlier={...dose('methylphenidate-ir','20'),administeredAt:'2026-09-12T23:00:00Z'};
  const dayStart=Date.parse('2026-09-13T00:00:00Z');
  const scope=scopeTimeline({actual:[earlier],drafts:[],start:dayStart,end:dayStart+24*hour});
  assert.deepEqual(scope.doses,[earlier]);assert.deepEqual(scope.sourceIds,['S2','S3']);
  assert.equal(scope.omittedHistoryCount,0);
});
