import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePkReference, pkProfileForProduct } from '../src/lib/pk-references';

const curve=(id:string,group:string)=>{
  const value=pkProfileForProduct(id)?.channels.find(channel=>channel.group===group);
  assert.ok(value,`${id}: ${group}`);return value;
};
function auc(id:string,group:string,from=0,to=240){
  const channel=curve(id,group),step=.005;
  let total=0,previous=evaluatePkReference(channel,from)!;
  for(let i=1;i<=Math.round((to-from)/step);i++){
    const current=evaluatePkReference(channel,from+i*step)!;
    total+=(current+previous)*step/2;previous=current;
  }
  return total;
}
const near=(actual:number,expected:number,tolerance:number)=>assert.ok(Math.abs(actual/expected-1)<tolerance,`${actual}; reported ${expected}`);

test('common stimulant references preserve reported total exposure, including distinct liquid and tablet bases',()=>{
  // Primary-source values F1/F2/F3/F5/F7/F8; calibration bounds are not clinical validation.
  for(const [id,group,reported] of [
    ['focalin','d-Methylphenidate',120.9],['focalin-xr','d-Methylphenidate',119.1],
    ['dyanavel-xr-tablet','d-Amphetamine',1215],['dyanavel-xr-tablet','l-Amphetamine',481],
    ['mydayis','d-Amphetamine',1085],['mydayis','l-Amphetamine',373],
    ['evekeo','d-Amphetamine',493],['evekeo','l-Amphetamine',488],
    ['evekeo-odt','d-Amphetamine',506],['evekeo-odt','l-Amphetamine',505],
    ['dyanavel-xr-liquid','d-Amphetamine',1197.321],['dyanavel-xr-liquid','l-Amphetamine',461.544],
  ] as const)near(auc(id,group),reported,.012);
  assert.equal(pkProfileForProduct('dyanavel-xr-liquid')!.referenceDoseMg,7.5*2.5);
  assert.equal(pkProfileForProduct('dyanavel-xr-liquid')!.strengthUnit,'mg/mL');
  assert.notEqual(pkProfileForProduct('dyanavel-xr-liquid'),pkProfileForProduct('dyanavel-xr-tablet'));
});

test('early exposure and the Focalin XR interpeak valley retain their formulation-specific checks',()=>{
  near(auc('focalin','d-Methylphenidate',0,4)*.5,32.5,.04); // Separate F2 study 2101 IR arm.
  near(auc('focalin-xr','d-Methylphenidate',0,4),36.3,.04);
  near(auc('focalin-xr','d-Methylphenidate',4,10),59.1,.04);
  const xr=curve('focalin-xr','d-Methylphenidate');
  assert.equal(evaluatePkReference(xr,4),7.6);
  assert.ok(evaluatePkReference(xr,1.5)!>7.6&&evaluatePkReference(xr,6.5)!>7.6);
  for(const [group,four,five] of [['d-Amphetamine',143.813,195.695],['l-Amphetamine',45.013,61.642]] as const){
    near(auc('dyanavel-xr-liquid',group,0,4),four,.02);
    near(auc('dyanavel-xr-liquid',group,0,5),five,.02);
  }
});
