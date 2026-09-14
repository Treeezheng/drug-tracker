import test from 'node:test';
import assert from 'node:assert/strict';
import { newDose, updateDose } from '../src/components/DoseEditor';
import { pkReferenceForDose, plotGroups } from '../src/lib/model';
import { estimateTotals } from '../src/lib/timeline-estimates';
import { describeDoseFormula } from '../src/lib/model-formula';
import { evaluatePkReference, pkProfileForProduct } from '../src/lib/pk-references';
import type { Dose } from '../src/lib/types';

const start=Date.parse('2026-09-14T08:00:00Z');
const dose=(strength='52.3/10.4'):Dose=>({...newDose('azstarys',strength),status:'actual',administeredAt:new Date(start).toISOString()});

test('Azstarys uses whole-package ratios and a single active channel without rewriting its two ingredients',()=>{
  for(const [strength,scale] of [['26.1/5.2',.5],['39.2/7.8',.75],['52.3/10.4',1]] as const){
    const row=dose(strength),before=structuredClone(row);
    assert.equal(pkReferenceForDose(row)?.doseScale,scale);
    const result=estimateTotals([row],start+2*3_600_000)['d-Methylphenidate'];
    assert.equal(result.value,12.3*scale);assert.equal(result.hasReference,true);
    assert.equal(result.directComplete,false);assert.equal(result.complete,true);
    assert.deepEqual(plotGroups(row),['d-Methylphenidate']);
    assert.deepEqual(row,before);
    const two=updateDose(row,{quantity:'2'},'UTC');
    assert.equal(pkReferenceForDose(two)?.doseScale,2*scale);
    assert.match(describeDoseFormula(two).equations[0],/2 capsule\(s\).*52\.3\/10\.4 mg/);
  }
});

test('combination snapshots cannot hide an altered second component, fractional capsule or inconsistent units',()=>{
  const row=dose(),second=row.ingredients![1];
  const badIngredients=[undefined,[],row.ingredients!.slice(0,1),[...row.ingredients!,second],
    [row.ingredients![0],{...second,name:'another ingredient'}],
    [row.ingredients![0],{...second,amountMg:'5.2'}],
    [row.ingredients![0],{...second,amountMg:''}],
    [row.ingredients![0],{...second,strengthMg:'5.2'}],
    [row.ingredients![0],{...second,unit:'mg/mL'}],
    [...row.ingredients!].reverse()];
  for(const ingredients of badIngredients)assert.equal(pkReferenceForDose({...row,ingredients}),null);
  const patches:Partial<Dose>[]=[{packageStrength:'52.3/5.2'},{packageStrength:undefined},{amountMg:'62.7'},
    {unit:'tablet'},{strengthUnit:'mg/mL'},{amountBasis:'labeled ingredient'},{amountBasis:undefined},
    {formulation:'Other capsule'},{unusual:true},{modelVersion:'missing'}];
  for(const patch of patches)assert.equal(pkReferenceForDose({...row,...patch}),null);
  assert.equal(pkReferenceForDose(updateDose(row,{quantity:'0.5'},'UTC')),null);
  const equivalent={...row,packageStrength:'52.30/10.40'};
  assert.equal(pkReferenceForDose(equivalent)?.doseScale,1);
});

test('Azstarys reconstructed exposure agrees with its independent single-dose AUC check',()=>{
  const channel=pkProfileForProduct('azstarys')!.channels[0];
  let area=0,previous=evaluatePkReference(channel,0)!;
  for(let i=1;i<=60_000;i++){
    const current=evaluatePkReference(channel,i*.01)!;
    area+=(current+previous)*.005;previous=current;
  }
  assert.ok(Math.abs(area/186-1)<.04,`AUC ${area}; label 186`);
  assert.equal(channel.halfLifeHours,11.7);
});
