import test from 'node:test';
import assert from 'node:assert/strict';
import { newDose } from '../src/components/DoseEditor.tsx';
import { sources } from '../src/lib/catalog.ts';
import { MODEL_VERSION, blankAssumptions, concentration, groupedTotals, referenceForDose, referenceOverlay } from '../src/lib/model.ts';
import type { Dose } from '../src/lib/types.ts';

const instant=Date.parse('2026-09-13T08:00:00Z'),peak=instant+7_200_000;
const dose=(productId='methylphenidate-ir',strength='10'):Dose=>({...newDose(productId,strength),administeredAt:new Date(instant).toISOString(),status:'actual'});

test('generic 10 mg can show an identified Ritalin source illustration while its physical value stays unknown',()=>{
  const original=dose(),before=structuredClone(original),overlay=referenceOverlay(original,peak)!;
  assert.equal(overlay.value,4.3);assert.equal(overlay.unit,'ng/mL');
  assert.equal(overlay.referenceProductId,'ritalin');assert.equal(overlay.originalProductId,'methylphenidate-ir');
  assert.equal(overlay.referenceEvidence,'B');assert.match(overlay.reason,/No direct data.*reference only/);
  assert.deepEqual(overlay.sourceIds,['S2','S3']);assert.ok(overlay.sourceIds.every(id=>sources.some(source=>source.id===id&&source.url.startsWith('https://'))));
  assert.equal(concentration(original,peak).value,null);assert.equal(concentration(original,peak).evidence,'D');
  const alone=groupedTotals([original],peak).Methylphenidate;assert.equal(alone.complete,false);assert.equal(alone.items[0].value,null);
  const mixed=groupedTotals([original,dose('ritalin')],peak).Methylphenidate;assert.equal(mixed.value,4.3);assert.equal(mixed.complete,false);
  assert.deepEqual(original,before);
});

test('source illustration follows the recorded instant across midnight without assigning an unknown time',()=>{
  const original={...dose(),administeredAt:'2026-09-13T23:00:00Z',status:'planned' as const};
  assert.equal(referenceOverlay(original,Date.parse('2026-09-14T01:00:00Z'))?.value,4.3);
  assert.equal(referenceOverlay(original,Date.parse('2026-09-13T22:00:00Z'))?.value,0);
  assert.equal(referenceOverlay(original,NaN)?.value,null);
  for(const administeredAt of ['', '2026-02-30T08:00:00Z','not-a-time'])assert.equal(referenceForDose({...original,administeredAt}),null);
});

test('invalid, fractional, altered, custom and unsupported entries never gain the reference overlay',()=>{
  const original=dose();
  for(const patch of [
    {strength:'5',packageStrength:'5',quantity:'2'},
    {strength:'2.5',packageStrength:'2.5',quantity:'4'},
    {strength:'20',packageStrength:'20',quantity:'.5'},
    {quantity:'1.5',amountMg:'15'},
    {amountMg:'0'},{quantity:''},{strength:'NaN'},
    {packageStrength:'5'},{packageStrength:'10/10'},{strengthUnit:'mg/mL'},
    {unit:'mL'},{unusual:true},{formulation:'Extended-release tablet'},
    {modelVersion:MODEL_VERSION+'-unknown'},{status:'skipped'},
    {assumptions:{...blankAssumptions(),accepted:true}},
  ] as Partial<Dose>[])assert.equal(referenceForDose({...original,...patch}),null,JSON.stringify(patch));
  for(const [productId,strength] of [['ritalin','10'],['concerta','18'],['ritalin-la','10'],['methylin-solution','1'],['focalin','10'],['amphetamine-salts-ir','10'],['metformin-ir','500']])assert.equal(referenceForDose(dose(productId,strength)),null);
  const decimal={...original,strength:'10.00',packageStrength:'10.000',quantity:'1.00',amountMg:'10.00'};
  assert.equal(referenceOverlay(decimal,peak)?.value,4.3);
});
