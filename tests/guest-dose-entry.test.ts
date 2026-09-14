import test from 'node:test';
import assert from 'node:assert/strict';
import { newDose, updateDose } from '../src/components/DoseEditor.tsx';
import { submitGuestDose } from '../src/lib/guest-dose-entry.ts';
import type { Dose } from '../src/lib/types.ts';

const zone='America/Los_Angeles';
function simulation():Dose{return updateDose(newDose('ritalin','10'),{date:'2026-09-13',time:'08:03',quantity:'1.5',status:'simulated'},zone);}

test('guest Add collapses only its own row without changing or recording the dose',()=>{
  const dose=simulation(),before=structuredClone(dose),submitted=new Set(['other-row']);
  const next=submitGuestDose(dose,submitted);
  assert.deepEqual([...next],['other-row',dose.id]);assert.deepEqual([...submitted],['other-row']);
  assert.deepEqual(dose,before);assert.equal(dose.status,'simulated');assert.equal(dose.amountMg,'15');
  assert.equal(submitGuestDose(dose,next).size,2);
  const duplicate={...dose,id:'duplicate'};
  assert.equal(next.has(duplicate.id),false);assert.equal(duplicate.status,'simulated');
});

test('guest Add rejects incomplete, invalid and non-simulated rows without losing previously collapsed IDs',()=>{
  const dose=simulation(),submitted=new Set(['other-row']);
  for(const patch of [{productId:''},{quantity:'0'},{amountMg:''},{administeredAt:''},{administeredAt:'2026-02-30T15:03:00Z'},{status:'actual'},{status:'planned'}] as Partial<Dose>[]){
    assert.throws(()=>submitGuestDose({...dose,...patch},submitted));
    assert.deepEqual([...submitted],['other-row']);
  }
});

test('valid past and future guest rows remain simulations and exact liquid/combination snapshots survive Add',()=>{
  for(const [id,strength,quantity,date] of [['onyda-xr','0.1','0.3','2020-01-01'],['adderall-ir','5','1.5','2030-01-01']]){
    const dose=updateDose(newDose(id,strength),{date,time:'08:03',quantity,status:'simulated'},zone),before=structuredClone(dose);
    assert.ok(submitGuestDose(dose,new Set()).has(dose.id));assert.deepEqual(dose,before);
  }
});
