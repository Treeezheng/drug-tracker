import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DoseEditor, { doseStrengthChoices, doseStrengthOptions, newDose, updateDose, selectDoseStrength, selectDoseMedication } from '../src/components/DoseEditor.tsx';
import { modelGroup } from '../src/lib/model.ts';
import type { Dose, Favorite, Profile } from '../src/lib/types.ts';

const profile:Profile={name:'',timeZone:'UTC',timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
const favorite=(productId:string,packageStrength:string):Favorite=>({id:`${productId}-${packageStrength}`,productId,packageStrength,strength:packageStrength.split('/')[0],quantity:'1'});
const render=(dose:Dose,favorites?:Favorite[])=>renderToStaticMarkup(createElement(DoseEditor,{dose,index:0,profile,favorites,onMoreMedications:()=>{},onChange:()=>{throw Error('Rendering cannot change a dose.');}}));
const strengthSelect=(html:string)=>html.match(/<select aria-label="Dose 1 strength"[\s\S]*?<\/select>/)?.[0]??'';

test('the strength menu lists selected favorites, not the entire medication catalog',()=>{
  const dose=newDose('concerta','36'),favorites=[favorite('concerta','36'),favorite('metformin-ir','500')];
  assert.deepEqual(doseStrengthOptions(dose,favorites),['36']);
  const html=strengthSelect(render(dose,favorites));
  assert.match(html,/<option value="36" selected="">36<\/option>/);
  for(const strength of ['18','27','54','500'])assert.ok(!html.includes(`<option value="${strength}"`));
  assert.match(html,/<option value="__more__">More…<\/option>/);
});

test('multiple favorites retain custom, combination and decimal strengths without duplicates',()=>{
  const ritalin=newDose('ritalin','10');
  assert.deepEqual(doseStrengthOptions(ritalin,[favorite('ritalin','10.00'),favorite('ritalin','20'),favorite('ritalin','7.500'),favorite('ritalin','10')]),['10','20','7.5']);
  const combo=newDose('azstarys','26.1/5.2');
  assert.deepEqual(doseStrengthOptions(combo,[{...favorite('azstarys','26.1'),packageStrength:undefined},favorite('azstarys','39.2/7.8')]),['26.1/5.2','39.2/7.8']);
  const liquid=newDose('onyda-xr','0.125');
  assert.deepEqual(doseStrengthOptions(liquid,[favorite('onyda-xr','0.125')]),['0.125']);
  const html=render(liquid,[favorite('onyda-xr','0.125')]);
  assert.match(strengthSelect(html),/<option value="0.125" selected="">0.125<\/option>/);
  assert.match(html,/Strength · mg\/mL/);
});

test('a record retains its original package after favorites change, including custom and unavailable products',()=>{
  const old={...newDose('ritalin','20'),status:'actual' as const,revision:8,manufacturer:'Original package',note:'Original note'};
  const before=structuredClone(old);
  assert.deepEqual(doseStrengthOptions(old,[favorite('ritalin','5')]),['5','20']);
  assert.match(strengthSelect(render(old,[favorite('ritalin','5')])),/<option value="20" selected="">20<\/option>/);
  assert.deepEqual(old,before);
  const corrected=updateDose(old,{time:'08:00',date:'2026-09-13'},'UTC');
  for(const field of ['id','productId','revision','manufacturer','note','packageStrength','ingredients'] as const)assert.deepEqual(corrected[field],old[field]);
  const custom=newDose('ritalin','7.25');
  const customHtml=render(custom,[favorite('ritalin','10')]);
  assert.match(strengthSelect(customHtml),/<option value="7.25" selected="">7.25<\/option>/);
  assert.doesNotMatch(customHtml,/aria-label="Dose 1 custom strength/);
  const unknown={...old,productId:'old-product',productName:'Old medicine',packageStrength:'17.25',strength:'17.25'};
  assert.match(strengthSelect(render(unknown,[])),/<option value="17.25" selected="">17.25<\/option>/);
  assert.equal(unknown.productId,'old-product');
});

test('variant-specific favorites expose only that product’s strengths and the original saved package',()=>{
  const dose=newDose('ritalin','10');
  const favorites=[favorite('methylphenidate-ir','5'),favorite('ritalin','20'),favorite('concerta','36')];
  assert.deepEqual(doseStrengthChoices(dose,favorites),[
    {productId:'ritalin',packageStrength:'20'},
    {productId:'ritalin',packageStrength:'10'},
  ]);
  assert.equal(dose.productId,'ritalin');
  const generic=newDose('methylphenidate-ir','5');
  assert.deepEqual(doseStrengthOptions(generic,favorites),['5']);
});

test('a grouped strength selection explicitly changes product snapshots without rounding quantity or transferring reference evidence',()=>{
  const favorites=[favorite('ritalin','10'),favorite('methylphenidate-ir','5')];
  const original={...newDose('ritalin','10'),revision:4,note:'Keep original note',administeredAt:'2026-09-13T08:00:00Z'};
  const before=structuredClone(original);
  const genericChoice={productId:'methylphenidate-ir',packageStrength:'5'};
  assert.ok(!doseStrengthChoices(original,favorites).some(choice=>choice.productId===genericChoice.productId));
  const generic=selectDoseStrength(original,genericChoice,'UTC');
  assert.equal(generic.productId,'methylphenidate-ir');assert.equal(generic.packageStrength,'5');assert.equal(generic.amountMg,'5');
  assert.equal(generic.id,original.id);assert.equal(generic.revision,4);assert.equal(generic.note,original.note);assert.equal(generic.administeredAt,original.administeredAt);
  assert.equal(modelGroup(generic).reference,false);assert.equal(modelGroup({...generic,quantity:'2',amountMg:'10'}).reference,false);
  const returned=selectDoseMedication(generic,'ritalin',favorites,'UTC');
  assert.equal(returned.productId,'ritalin');assert.equal(returned.amountMg,'10');assert.equal(modelGroup(returned).reference,true);
  const fractional=selectDoseStrength({...original,quantity:'1.5'},genericChoice,'UTC');
  assert.equal(fractional.quantity,'1.5');assert.equal(fractional.amountMg,'7.5');
  assert.deepEqual(original,before);
});

test('equal grouped strengths appear once and keep the current record’s original identity',()=>{
  const favorites=[favorite('ritalin','10.00'),favorite('methylphenidate-ir','10')];
  const generic=newDose('methylphenidate-ir','10'),brand=newDose('ritalin','10');
  assert.deepEqual(doseStrengthChoices(generic,favorites),[{productId:'methylphenidate-ir',packageStrength:'10'}]);
  assert.deepEqual(doseStrengthChoices(brand,favorites),[{productId:'ritalin',packageStrength:'10'}]);
  const html=strengthSelect(render(generic,favorites));
  assert.equal((html.match(/<option value="10"/g)||[]).length,1);
  assert.equal(generic.productId,'methylphenidate-ir');
});

test('explicit Generic and Ritalin selections apply their own favorite even when the other product appears first',()=>{
  const favorites=[{...favorite('ritalin','10'),quantity:'1.5'},favorite('methylphenidate-ir','5'),favorite('methylphenidate-ir','20')];
  const blank={...newDose(),productId:'',productName:'',strength:'',packageStrength:'',amountMg:'',quantity:'',ingredients:[]};
  const initial=selectDoseMedication(blank,'methylphenidate-ir',favorites,'UTC');
  assert.equal(initial.productId,'methylphenidate-ir');assert.equal(initial.packageStrength,'5');assert.equal(initial.quantity,'1');assert.equal(initial.amountMg,'5');
  const changed=selectDoseStrength(initial,doseStrengthChoices(initial,favorites).find(choice=>choice.packageStrength==='20')!,'UTC');
  assert.equal(changed.productId,'methylphenidate-ir');assert.equal(changed.packageStrength,'20');assert.equal(changed.quantity,'1');assert.equal(changed.amountMg,'20');
  const brand=selectDoseMedication(changed,'ritalin',favorites,'UTC');
  assert.equal(brand.productId,'ritalin');assert.equal(brand.packageStrength,'10');assert.equal(brand.quantity,'1.5');assert.equal(brand.amountMg,'15');
  assert.equal(selectDoseMedication(initial,'',favorites,'UTC').productId,'');
});

test('unspecified favorites preserve standalone guest choices; an explicit empty list keeps only the current record',()=>{
  const dose=newDose('ritalin','10');
  assert.deepEqual(doseStrengthOptions(dose),['5','10','20']);
  assert.deepEqual(doseStrengthOptions(dose,[]),['10']);
  const blank={...dose,productId:'',productName:'',strength:'',packageStrength:'',amountMg:'',ingredients:[]};
  assert.deepEqual(doseStrengthOptions(blank,[]),[]);
  assert.match(render(blank,[]),/<option value="" selected="">Choose medication<\/option>/);
});

test('the dose number has no model status placeholder while Formula remains available',()=>{
  for(const dose of [newDose('concerta','18'),newDose('ritalin','10'),newDose('metformin-ir','500'),{...newDose('ritalin','10'),productId:'unavailable'}]){
    const html=render({...dose,administeredAt:'2026-09-13T08:00:00Z'});
    const number=html.match(/<div class="dose-number">([\s\S]*?)<\/div>/)?.[1]??'';
    assert.match(number,/<span>Dose 1<\/span>/);assert.doesNotMatch(number,/<small/);
    assert.doesNotMatch(number,/Published profile|Parameter estimate|Historical · D|Saved illustration|>No curve</);
    assert.match(html,/aria-label="Dose 1 formula"/);
  }
});

test('managing favorite strengths does not modify or duplicate the current dose',()=>{
  const current={...newDose('ritalin','7.25'),id:'kept-row',quantity:'1.5',amountMg:'10.875',note:'Kept note',revision:3};
  const before=structuredClone(current),initial=[favorite('ritalin','10')];
  assert.deepEqual(doseStrengthOptions(current,initial),['10','7.25']);
  const saved=[...initial,favorite('ritalin','12.5')];
  assert.deepEqual(doseStrengthOptions(current,saved),['10','12.5','7.25']);
  assert.deepEqual(current,before);
  const chosen=selectDoseStrength(current,doseStrengthChoices(current,saved).find(choice=>choice.packageStrength==='12.5')!,'UTC');
  assert.equal(chosen.id,current.id);assert.equal(chosen.quantity,'1.5');assert.equal(chosen.note,current.note);assert.equal(chosen.amountMg,'18.75');
});
