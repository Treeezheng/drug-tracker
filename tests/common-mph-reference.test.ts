import test from 'node:test';
import assert from 'node:assert/strict';
import { newDose, updateDose } from '../src/components/DoseEditor';
import { pkReferenceForDose, concentration } from '../src/lib/model';
import { evaluatePkReference, pkProfileForProduct } from '../src/lib/pk-references';
import { estimateTotals } from '../src/lib/timeline-estimates';
import type { PkReferenceChannel } from '../src/lib/pk-reference-types';

function area(channel:PkReferenceChannel,start:number,end:number){
  let sum=0;const step=.002;
  for(let t=start;t<end;t+=step){const next=Math.min(end,t+step);sum+=(evaluatePkReference(channel,t)!+evaluatePkReference(channel,next)!)*(next-t)/2;}
  return sum;
}
test('common MPH formulations keep their own peak, delayed release and concentration scale',()=>{
  const facts:[string,string,number,number][]=[['aptensio-xr','40',2,10.25],['metadate-cd','60',5,17.4],['jornay-pm','100',13.5,10.1],['quillichew-er','40',5,11.6],['relexxii','18',6,3.6]];
  for(const [id,strength,hours,expected]of facts){
    const dose={...newDose(id,strength),administeredAt:'2026-09-14T04:00:00Z',status:'actual' as const},before=structuredClone(dose),at=Date.parse(dose.administeredAt)+hours*3_600_000;
    assert.ok(pkReferenceForDose(dose),id);
    assert.equal(concentration(dose,at).value,null,'Source illustrations never become direct personal measurements');
    const total=estimateTotals([dose],at,false).Methylphenidate;
    assert.ok(Math.abs(total.value-expected)<1e-8,id);assert.equal(total.hasReference,true);assert.equal(total.directComplete,false);
    assert.deepEqual(dose,before);
  }
  const jornay=pkProfileForProduct('jornay-pm')!.channels[0];
  assert.equal(evaluatePkReference(jornay,5),0);assert.ok(evaluatePkReference(jornay,14)!>9);
  const aptensio=pkProfileForProduct('aptensio-xr')!.channels[0];
  assert.ok(evaluatePkReference(aptensio,2)!>evaluatePkReference(aptensio,5)!);
  assert.ok(evaluatePkReference(aptensio,7)!>evaluatePkReference(aptensio,5)!);
});

test('Metadate adult total and partial exposures do not use pediatric repeat-dose or d-only comparator values',()=>{
  const profile=pkProfileForProduct('metadate-cd')!,channel=profile.channels[0];
  assert.equal(profile.referenceDoseMg,60);assert.equal(channel.group,'Methylphenidate');
  // Independent transcription of adult comparator Table 3, FDA review p.5.
  // A sanity bound on an illustration, not a bioequivalence/clinical validation claim.
  for(const [from,to,expected]of [[0,3,25.7],[0,5,53.1],[5,24,104.3],[0,200,170]]){
    const estimate=area(channel,from,to);assert.ok(Math.abs(estimate/expected-1)<.1,`${from}–${to}: ${estimate} vs ${expected}`);
  }
  for(const [id,expected]of [['aptensio-xr',258.1],['relexxii',41.8]] as const){
    const estimate=area(pkProfileForProduct(id)!.channels[0],0,200);assert.ok(Math.abs(estimate/expected-1)<.15,`${id}: ${estimate} vs ${expected}`);
  }
});

test('QuilliChew half-tablet reference is limited to the labeled scored package strengths',()=>{
  for(const strength of ['20','30','40']){
    const dose=updateDose({...newDose('quillichew-er',strength),administeredAt:'2026-09-14T08:00:00Z'}, {quantity:'0.5'});
    assert.equal(Boolean(pkReferenceForDose(dose)),strength!=='40');
    assert.equal(pkReferenceForDose(updateDose(dose,{quantity:'0.25'})),null);
  }
});
