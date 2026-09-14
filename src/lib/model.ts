import { products } from './catalog';
import type { Assumptions, Dose, Product } from './types';

export const MODEL_VERSION = '2026-09-13.1';
export const RITALIN_REFERENCE = Object.freeze({amplitude:4.3,peakHours:2,halfLifeHours:3.5,absorptionRate:1.0152449556});
export const CONCERTA_TAIL_HALF_LIFE_HOURS = 3.5;
export const CONCERTA_TRACE = [[0,.024],[.257,.036],[.498,.534],[.995,1.917],[1.493,2.108],[2.007,2.091],[3.002,2.160],[3.998,2.330],[6.005,3.544],[7.996,3.366],[9.987,2.816],[11.994,2.104],[13.984,1.388],[16.987,.781],[19.973,.449],[23.971,.227],[29.976,.073]];
export const blankAssumptions = ():Assumptions => ({peakHours:2,halfLifeHours:3,lagHours:0,referenceDose:10,amplitude:1,onsetHours:.5,durationMinHours:3,durationMaxHours:5,durationOrigin:'from_onset',accepted:false});
export function validIllustrationParameters(a:Assumptions|undefined):a is Assumptions {
  return !!a?.accepted&&[a.peakHours,a.halfLifeHours,a.referenceDose,a.amplitude,a.lagHours].every(Number.isFinite)&&a.peakHours>0&&a.halfLifeHours>0&&a.referenceDose>0&&a.amplitude>=0&&a.lagHours>=0;
}
export interface ModelValue {value:number|null;group:string;unit:string;evidence:string;tail:boolean;reason:string;}
const DECIMAL_SCALE=1_000_000_000n;
function positiveDecimal(value:unknown):bigint|null {
  if(typeof value!=='string'||value.length>30||!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,9})?$/.test(value))return null;
  const [whole,fraction='']=value.split('.');
  const result=BigInt(whole)*DECIMAL_SCALE+BigInt(fraction.padEnd(9,'0'));
  return result>0n?result:null;
}
function eligibleReference(dose:Dose,p:Product):boolean {
  const reference=p.model==='concerta'?18n*DECIMAL_SCALE:p.model==='ritalin'?10n*DECIMAL_SCALE:null;
  if(reference===null||dose.unusual||dose.unit!==p.unit||(dose.strengthUnit!==undefined&&dose.strengthUnit!==p.strengthUnit)
    ||(dose.amountBasis!==undefined&&dose.amountBasis!=='labeled ingredient'))return false;
  const strength=positiveDecimal(dose.strength),labeled=positiveDecimal(dose.packageStrength??dose.strength);
  const quantity=positiveDecimal(dose.quantity),amount=positiveDecimal(dose.amountMg);
  if(strength===null||labeled===null||quantity===null||amount===null||strength!==labeled||amount!==reference)return false;
  // A custom package does not become a studied formulation when its total happens
  // to equal 10/18 mg. Legacy snapshots may omit packageStrength/strengthUnit.
  if(!p.strengths.some(value=>positiveDecimal(value)===labeled))return false;
  // Never infer intact extended release (or a standard reference administration)
  // from fractional tablets, even if a historical unusual flag was absent.
  return quantity%DECIMAL_SCALE===0n&&strength*quantity===amount*DECIMAL_SCALE;
}
export function modelGroup(dose:Dose):{group:string;unit:string;reference:boolean}{
  const p=products.find(p=>p.id===dose.productId);
  if(!p)return {group:`${dose.productName} · unsupported`,unit:'relative units',reference:false};
  const reference=eligibleReference(dose,p);
  return reference ? {group:'Methylphenidate',unit:'ng/mL',reference:true} : {group:`${p.name} · assumptions`,unit:'relative units',reference:false};
}
export function concentration(dose:Dose, at:number, publishedOnly=false):ModelValue {
  const p=products.find(p=>p.id===dose.productId),g=modelGroup(dose);
  if(!p)return {group:g.group,unit:g.unit,evidence:'D',tail:false,value:null,reason:'Historical product model unavailable'};
  const base={group:g.group,unit:g.unit,evidence:g.reference?p.evidence:'D',tail:false,reason:''};
  const admin=Date.parse(dose.administeredAt);
  if(!Number.isFinite(admin)||dose.status==='skipped'||!Number.isFinite(Number(dose.amountMg))||Number(dose.amountMg)<=0) return {...base,value:0,reason:'Pending or excluded'};
  const u=(at-admin)/3600000;
  if(u<0) return {...base,value:0};
  if(dose.modelVersion&&dose.modelVersion!==MODEL_VERSION)return {...base,value:null,reason:'Pinned model version unavailable'};
  if(!g.reference){
    const a=dose.assumptions;
    if(!a?.accepted)return {...base,value:null,reason:'No verified formula is implemented for this entry'};
    if(!validIllustrationParameters(a))return {...base,value:null,reason:'Invalid saved assumptions'};
    const elapsed=u-a.lagHours;
    const v=elapsed<0?0:elapsed<a.peakHours?elapsed/a.peakHours:Math.exp(-Math.LN2*(elapsed-a.peakHours)/a.halfLifeHours);
    const value=v*a.amplitude*Number(dose.amountMg)/a.referenceDose;
    return Number.isFinite(value)?{...base,value,reason:'Assumed shape and proportional scaling; not product-specific PK'}:{...base,value:null,reason:'Assumptions exceed supported numeric precision'};
  }
  if(p.model==='ritalin'){
    const {amplitude,peakHours,halfLifeHours,absorptionRate:ka}=RITALIN_REFERENCE,ke=Math.LN2/halfLifeHours;
    return {...base,value:amplitude*(Math.exp(-ke*u)-Math.exp(-ka*u))/(Math.exp(-ke*peakHours)-Math.exp(-ka*peakHours)),reason:'Constructed first-order reference; adult cross-study parameters'};
  }
  const [lastT,lastC]=CONCERTA_TRACE[CONCERTA_TRACE.length-1];
  if(u>lastT)return publishedOnly?{...base,value:null,reason:'Beyond the observed trace; contribution unknown'}:{...base,value:lastC*Math.exp(-Math.LN2/CONCERTA_TAIL_HALF_LIFE_HOURS*(u-lastT)),tail:true,evidence:'B',reason:'Estimated terminal tail beyond 29.976 h'};
  for(let i=1;i<CONCERTA_TRACE.length;i++){
    const [t,c]=CONCERTA_TRACE[i], [t0,c0]=CONCERTA_TRACE[i-1];
    if(u<=t)return {...base,value:c0+(c-c0)*(u-t0)/(t-t0),reason:'Digitized adult 18 mg group profile; not measured personal level'};
  }
  return {...base,value:null,reason:'Unsupported domain'};
}
export function contributions(doses:Dose[],at:number,publishedOnly=false){
  const seen=new Set<string>();
  return doses.filter(d=>{if(seen.has(d.id)||!d.administeredAt||d.status==='skipped')return false;seen.add(d.id);return true;}).map(dose=>({dose,...concentration(dose,at,publishedOnly)}));
}
export function groupedTotals(doses:Dose[],at:number,publishedOnly=false){
  const groups:Record<string,{value:number;complete:boolean;unit:string;tail:boolean;items:ReturnType<typeof contributions>}>= {};
  for(const c of contributions(doses,at,publishedOnly)){
    const g=groups[c.group]??={value:0,complete:true,unit:c.unit,tail:false,items:[]};
    if(c.value===null)g.complete=false;else g.value+=c.value;
    g.tail||=c.tail;g.items.push(c);
  }
  return groups;
}
export function effectWindow(d:Dose){
  const a=d.assumptions, t=Date.parse(d.administeredAt);
  if(!a?.accepted||!Number.isFinite(t)||d.status==='skipped'||!(Number(d.amountMg)>0)||!Number.isFinite(Number(d.amountMg))||(d.modelVersion&&d.modelVersion!==MODEL_VERSION))return null;
  if(![a.onsetHours,a.durationMinHours,a.durationMaxHours].every(Number.isFinite)||a.onsetHours<0||a.durationMinHours<0||a.durationMaxHours<a.durationMinHours||!['from_onset','from_administration'].includes(a.durationOrigin)||(a.durationOrigin==='from_administration'&&a.durationMinHours<a.onsetHours))return null;
  const start=t+a.onsetHours*3600000, origin=a.durationOrigin==='from_onset'?start:t;
  return {start,minEnd:origin+a.durationMinHours*3600000,maxEnd:origin+a.durationMaxHours*3600000,label:'Assumed effect window'};
}
