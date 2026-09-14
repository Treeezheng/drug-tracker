import { products } from './catalog';
import type { Assumptions, Dose, Product } from './types';
import { evaluatePkReference, pkProfileForProduct } from './pk-references';

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
/** A blank simulated editor row is pending. Saved invalid records are never omitted. */
export function includeTimelineDose(dose:Dose):boolean {
  return dose.status!=='skipped'&&(dose.status!=='simulated'||
    !!(dose.productId&&dose.administeredAt&&dose.strength&&dose.quantity&&dose.amountMg));
}
/** Saved administration instants use the same exact UTC format as backup validation. */
export function doseTimestamp(dose:Dose):number {
  const value=dose.administeredAt;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return NaN;
  const parsed=Date.parse(value);
  return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,19)===value.slice(0,19)?parsed:NaN;
}
/** Validate the recorded scalar basis without converting salts, liquids or patches. */
function modelInputError(dose:Dose):string|null {
  const admin=doseTimestamp(dose);
  if(!Number.isFinite(admin))return 'Administration time unavailable or invalid';
  const strength=positiveDecimal(dose.strength),quantity=positiveDecimal(dose.quantity),amount=positiveDecimal(dose.amountMg);
  if(strength===null||quantity===null||amount===null)return 'Strength, quantity or amount unavailable or invalid';
  if(strength*quantity!==amount*DECIMAL_SCALE)return 'Recorded strength, quantity and amount are inconsistent';
  if(dose.packageStrength!==undefined){
    if(typeof dose.packageStrength!=='string'||dose.packageStrength.length>100)return 'Package strength unavailable or invalid';
    const parts=dose.packageStrength.split('/').map(positiveDecimal);
    if(parts.length>10||parts.some(value=>value===null)||parts[0]!==strength)return 'Package strength is inconsistent with the recorded strength';
  }
  return null;
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
/** Analyte identity is independent of dose/formulation model eligibility. */
export function concentrationAnalyte(dose:Dose):{group:string;unit:string}|null {
  return concentrationAnalytes(dose)[0]??null;
}
export function concentrationAnalytes(dose:Dose):{group:string;unit:string}[] {
  const product=products.find(item=>item.id===dose.productId);
  const profile=pkProfileForProduct(dose.productId);
  if(profile)return profile.channels.map(channel=>({group:channel.group,unit:'ng/mL'}));
  const groups=product?.family==='Methylphenidate'?['Methylphenidate']:
    product?.family==='Dexmethylphenidate'?['d-Methylphenidate']:
    product?.family==='Amphetamine'?['d-Amphetamine','l-Amphetamine']:
    product?.family==='Dextroamphetamine'||product?.family==='Lisdexamfetamine'?['d-Amphetamine']:[];
  return groups.map(group=>({group,unit:'ng/mL'}));
}
export function modelGroup(dose:Dose):{group:string;unit:string;reference:boolean}{
  const p=products.find(p=>p.id===dose.productId);
  if(!p)return {group:`${dose.productName} · unsupported`,unit:'relative units',reference:false};
  const reference=eligibleReference(dose,p);
  const analyte=concentrationAnalyte(dose);
  if(reference)return {group:'Methylphenidate',unit:'ng/mL',reference:true};
  if(analyte&&!dose.assumptions?.accepted)return {...analyte,reference:false};
  return {group:`${p.name} · assumptions`,unit:'relative units',reference:false};
}

export function contributesToGroup(dose:Dose,group:string):boolean {
  return modelGroup(dose).group===group||concentrationAnalytes(dose).some(analyte=>analyte.group===group);
}

/** A pinned population reference never overwrites the actual product snapshot. */
export function pkReferenceForDose(dose:Dose) {
  const profile=pkProfileForProduct(dose.productId),product=products.find(item=>item.id===dose.productId);
  if(!profile||!product||dose.status==='skipped'||dose.assumptions?.accepted||modelInputError(dose)
    ||(dose.modelVersion&&dose.modelVersion!==MODEL_VERSION)||dose.formulation!==product.formulation
    ||dose.unit!==profile.unit||(dose.strengthUnit!==undefined&&dose.strengthUnit!==profile.strengthUnit)
    ||dose.unusual)return null;
  const strength=positiveDecimal(dose.strength),quantity=positiveDecimal(dose.quantity);
  if(profile.packageReference){
    if(strength===null||quantity===null||quantity%DECIMAL_SCALE!==0n||dose.amountBasis!=='first listed ingredient'
      ||!dose.packageStrength||!Array.isArray(dose.ingredients)||dose.ingredients.length!==product.ingredients?.length)return null;
    const parts=dose.packageStrength.split('/').map(positiveDecimal);
    const canonical=product.strengths.find(value=>{
      const expected=value.split('/').map(positiveDecimal);
      return expected.length===parts.length&&expected.every((part,i)=>part!==null&&part===parts[i]);
    });
    const scale=canonical===undefined?undefined:profile.packageReference.scales[canonical];
    if(scale===undefined||!Number.isFinite(scale)||scale<=0||parts.length!==dose.ingredients.length)return null;
    if(dose.ingredients.some((ingredient,i)=>{
      const amount=positiveDecimal(ingredient?.amountMg),part=parts[i];
      return !ingredient||ingredient.name!==product.ingredients![i].name||ingredient.unit!==profile.strengthUnit
        ||part===null||amount===null||positiveDecimal(ingredient.strengthMg)!==part||amount*DECIMAL_SCALE!==part*quantity;
    }))return null;
    return {...profile,doseScale:scale*Number(dose.quantity)};
  }
  if(dose.amountBasis!==undefined&&dose.amountBasis!=='labeled ingredient')return null;
  if(strength===null||quantity===null||positiveDecimal(dose.packageStrength??dose.strength)!==strength
    ||!product.strengths.some(value=>positiveDecimal(value)===strength))return null;
  if(profile.unit!=='mL'&&quantity%DECIMAL_SCALE!==0n
    &&!(profile.unit==='tablet'&&(profile.fractionalTablets||profile.fractionalStrengths?.some(value=>positiveDecimal(value)===strength))&&quantity%(DECIMAL_SCALE/2n)===0n))return null;
  return {...profile,doseScale:Number(dose.amountMg)/profile.referenceDoseMg};
}

/** A view may prepare a validated reference once; no health data is globally cached. */
export function preparePkReferenceContribution(dose:Dose,group:string,publishedOnly=false) {
  const profile=pkReferenceForDose(dose),channel=profile?.channels.find(item=>item.group===group);
  if(!profile||!channel)return null;
  const admin=doseTimestamp(dose),last=channel.points?.at(-1);
  const scaleDescription=profile.packageReference
    ?`${dose.packageStrength} mg package × ${dose.quantity} capsule(s); whole-package reference scale = ${profile.doseScale}.`
    :`Dose/reference = ${dose.amountMg}/${profile.referenceDoseMg} mg.`;
  const reason=`${profile.label}; ${profile.population}. ${profile.note} ${scaleDescription} Proportional scaling is an estimate, not a measured personal concentration.`;
  return (at:number)=>{
    if(!Number.isFinite(at))return null;
    const hours=(at-admin)/3_600_000,tail=!!last&&hours>last[0];
    const value=tail&&publishedOnly?null:evaluatePkReference(channel,hours);
    const scaled=value===null?null:value*profile.doseScale;
    return {value:scaled!==null&&Number.isFinite(scaled)?scaled:null,tail,reason};
  };
}
export function pkReferenceContribution(dose:Dose,at:number,group:string,publishedOnly=false) {
  return preparePkReferenceContribution(dose,group,publishedOnly)?.(at)??null;
}

/** Only groups with an implemented or explicitly saved curve get concentration plots. */
export function plotGroups(dose:Dose):string[] {
  const g=modelGroup(dose);
  if(g.reference||dose.assumptions?.accepted||referenceForDose(dose))return [g.group];
  return pkReferenceForDose(dose)?.channels.map(channel=>channel.group)??[];
}
export function concentration(dose:Dose, at:number, publishedOnly=false):ModelValue {
  const p=products.find(p=>p.id===dose.productId),g=modelGroup(dose);
  if(!p)return {group:g.group,unit:g.unit,evidence:'D',tail:false,value:null,reason:'Historical product model unavailable'};
  const base={group:g.group,unit:g.unit,evidence:g.reference?p.evidence:'D',tail:false,reason:''};
  if(dose.status==='skipped')return {...base,value:0,reason:'Excluded: skipped administration'};
  const invalid=modelInputError(dose);
  if(invalid||!Number.isFinite(at))return {...base,value:null,reason:invalid??'Evaluation time invalid'};
  const admin=doseTimestamp(dose);
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

export interface ReferenceOverlayInfo {
  originalProductId:string;referenceProductId:string;referenceLabel:string;
  sourceIds:string[];unit:'ng/mL';referenceEvidence:'A'|'B';referenceDoseMg:number;doseScale:number;reason:string;
}
/** A separately labelled source illustration, never the recorded product's concentration.
 * Dose scaling is an explicit unvalidated illustration, not clinical equivalence. */
export function referenceForDose(dose:Dose):ReferenceOverlayInfo|null {
  if(!['methylphenidate-ir','ritalin','concerta'].includes(dose.productId)||dose.status==='skipped'||dose.assumptions?.accepted||modelInputError(dose)
    ||(dose.modelVersion&&dose.modelVersion!==MODEL_VERSION))return null;
  const original=products.find(product=>product.id===dose.productId),reference=products.find(product=>product.id===(dose.productId==='concerta'?'concerta':'ritalin'));
  if(!original||!reference||modelGroup(dose).reference||dose.formulation!==original.formulation||dose.unusual
    ||dose.unit!=='tablet'||(dose.strengthUnit!==undefined&&dose.strengthUnit!=='mg')
    ||(dose.amountBasis!==undefined&&dose.amountBasis!=='labeled ingredient'))return null;
  const strength=positiveDecimal(dose.strength),quantity=positiveDecimal(dose.quantity);
  const allowedFraction=original.id!=='concerta'&&quantity!==null&&quantity%(DECIMAL_SCALE/2n)===0n;
  if(strength===null||quantity===null||(quantity%DECIMAL_SCALE!==0n&&!allowedFraction)
    ||positiveDecimal(dose.packageStrength??dose.strength)!==strength
    ||!original.strengths.some(value=>positiveDecimal(value)===strength))return null;
  const referenceDoseMg=reference.id==='concerta'?18:10,doseScale=Number(dose.amountMg)/referenceDoseMg;
  const referenceLabel=reference.id==='concerta'?'Concerta 18 mg':'Ritalin 10 mg';
  return {originalProductId:dose.productId,referenceProductId:reference.id,referenceLabel,sourceIds:[...reference.sourceIds],unit:'ng/mL',referenceEvidence:reference.id==='concerta'?'A':'B',referenceDoseMg,doseScale,
    reason:doseScale===1?`${referenceLabel} reference simulation; no direct measurements for this product or administration.`
      :`${referenceLabel} reference × ${doseScale} (${dose.amountMg} mg / ${referenceDoseMg} mg). Proportional scaling is unvalidated; not a measured or individual drug level.`};
}
export function referenceOverlay(dose:Dose,at:number,publishedOnly=true):(ReferenceOverlayInfo&{value:number|null;tail:boolean})|null {
  const reference=referenceForDose(dose);
  if(!reference)return null;
  // The synthetic reference exists only for evaluating the source curve. Never
  // persist it, return it as a dose, or include it in contributions/groupedTotals.
  const strength=String(reference.referenceDoseMg);
  const value=concentration({...dose,productId:reference.referenceProductId,strength,packageStrength:strength,quantity:'1',amountMg:strength},at,publishedOnly);
  const scaled=value.value===null?null:value.value*reference.doseScale;
  return {...reference,value:scaled!==null&&Number.isFinite(scaled)?scaled:null,tail:value.tail};
}
export function contributions(doses:Dose[],at:number,publishedOnly=false){
  const seen=new Set<string>();
  return doses.filter(d=>{if(seen.has(d.id)||!includeTimelineDose(d))return false;seen.add(d.id);return true;}).map(dose=>({dose,...concentration(dose,at,publishedOnly)}));
}

/** A saved relative illustration never supplies a physical concentration value. */
export function contributionForGroup(dose:Dose,at:number,group:string,publishedOnly=false):ModelValue|undefined {
  const value=concentration(dose,at,publishedOnly);
  if(value.group===group)return value;
  const analyte=concentrationAnalytes(dose).find(item=>item.group===group);
  if(!analyte)return undefined;
  const admin=doseTimestamp(dose);
  const knownZero=dose.status==='skipped'||(!modelInputError(dose)&&Number.isFinite(at)&&at<admin);
  return {...analyte,value:knownZero?0:null,tail:false,evidence:'D',reason:dose.assumptions?.accepted?'Concentration unavailable; saved illustration uses relative units':'No direct concentration model for this analyte'};
}
export function groupedTotals(doses:Dose[],at:number,publishedOnly=false){
  const groups:Record<string,{value:number;complete:boolean;unit:string;tail:boolean;items:ReturnType<typeof contributions>}>= {};
  const add=(c:ReturnType<typeof contributions>[number])=>{
    const g=groups[c.group]??={value:0,complete:true,unit:c.unit,tail:false,items:[]};
    if(c.value===null)g.complete=false;else g.value+=c.value;
    g.tail||=c.tail;g.items.push(c);
  };
  for(const c of contributions(doses,at,publishedOnly)){
    add(c);
    for(const analyte of concentrationAnalytes(c.dose))if(analyte.group!==c.group)add({dose:c.dose,...contributionForGroup(c.dose,at,analyte.group,publishedOnly)!});
  }
  return groups;
}
export function effectWindow(d:Dose){
  const a=d.assumptions, t=doseTimestamp(d);
  if(!a?.accepted||modelInputError(d)||d.status==='skipped'||(d.modelVersion&&d.modelVersion!==MODEL_VERSION))return null;
  if(![a.onsetHours,a.durationMinHours,a.durationMaxHours].every(Number.isFinite)||a.onsetHours<0||a.durationMinHours<0||a.durationMaxHours<a.durationMinHours||!['from_onset','from_administration'].includes(a.durationOrigin)||(a.durationOrigin==='from_administration'&&a.durationMinHours<a.onsetHours))return null;
  const start=t+a.onsetHours*3600000, origin=a.durationOrigin==='from_onset'?start:t;
  return {start,minEnd:origin+a.durationMinHours*3600000,maxEnd:origin+a.durationMaxHours*3600000,label:'Assumed effect window'};
}
