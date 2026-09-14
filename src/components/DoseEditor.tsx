import { groupMedicationProducts, medicationDisplay } from '../lib/medication-display';
import { Copy, Trash2, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { products, getProduct } from '../lib/catalog';
import { MODEL_VERSION } from '../lib/model';
import { instantToLocal, localToInstant } from '../lib/time';
import type { Dose, Favorite, Profile, Product, TimeIncrementMinutes } from '../lib/types';
import { colors } from './TimelineChart';
import MobileTimePicker from './MobileTimePicker';
import DoseFormula from './DoseFormula';
import { parseCustomStrength } from '../lib/package-strength';

const DECIMAL_SCALE=1_000_000_000n;
function decimalValue(input:string):bigint|null {
  if(input.length>30||!/^(?:\d+(?:\.\d{0,9})?|\.\d{1,9})$/.test(input))return null;
  const [whole='0',fraction='']=input.split('.');
  return BigInt(whole||'0')*DECIMAL_SCALE+BigInt(fraction.padEnd(9,'0'));
}
function decimalText(value:bigint):string {
  const fraction=(value%DECIMAL_SCALE).toString().padStart(9,'0').replace(/0+$/,'');
  return `${value/DECIMAL_SCALE}${fraction?`.${fraction}`:''}`;
}
// Exact decimal arithmetic: unsupported precision stays invalid rather than rounding a dose.
function multiply(left:string,right:string):string {
  const a=decimalValue(left),b=decimalValue(right);
  if(a===null||b===null||a*b%DECIMAL_SCALE!==0n)return '';
  return decimalText(a*b/DECIMAL_SCALE);
}
function scaleAmount(amount:string,newQuantity:string,oldQuantity:string):string {
  const a=decimalValue(amount),n=decimalValue(newQuantity),o=decimalValue(oldQuantity);
  if(a===null||n===null||o===null||o===0n||a*n%o!==0n)return '';
  return decimalText(a*n/o);
}
export function resolvePackageStrength(p:Product,strength?:string):string {
  const value=strength??p.strengths[0];
  const found=p.strengths.find(s=>s===value||s.split('/')[0]===value);
  // Preserve the original first-component shortcut only for a known package.
  // A new combination strength must explicitly provide every component.
  return found??parseCustomStrength(p,value);
}
function snapshot(p:Product,packageStrength:string):Pick<Dose,'productId'|'productName'|'formulation'|'strength'|'packageStrength'|'strengthUnit'|'manufacturer'|'unit'|'amountBasis'|'ingredients'|'amountMg'> {
  const parts=packageStrength.split('/');
  const ingredients=parts.length>1
    ?parts.map((v,i)=>({name:p.ingredients?.[i]?.name||`Ingredient ${i+1}`,amountMg:v,strengthMg:v,unit:'mg'}))
    :p.ingredients?.length
      ?p.ingredients.map(i=>({name:i.name,amountMg:multiply(parts[0],String(i.ratio)),strengthMg:multiply(parts[0],String(i.ratio)),unit:'mg'}))
      :[{name:p.generic,amountMg:parts[0],strengthMg:parts[0],unit:'mg'}];
  return {productId:p.id,productName:p.name,formulation:p.formulation,strength:parts[0],packageStrength,strengthUnit:p.strengthUnit,manufacturer:p.manufacturer==='Confirm labeler on package'?'':p.manufacturer,unit:p.unit,amountBasis:p.unit==='patch'?'labeled delivery over 9 hours':parts.length>1?'first listed ingredient':'labeled ingredient',ingredients,amountMg:parts[0]};
}
export function newDose(productId=products[0]?.id||'concerta',strength?:string):Dose {
  const p=getProduct(productId),s=resolvePackageStrength(p,strength);
  return {id:crypto.randomUUID(),...snapshot(p,s),quantity:'1',administeredAt:'',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,status:'simulated',note:'',date:'',time:'',modelVersion:MODEL_VERSION};
}

/** Input convenience only: brand/strength-specific label checks, never a dosing recommendation. */
export function quantityStep(dose:Dose):'0.1'|'0.5'|'1' {
  if(dose.unit==='mL')return '0.1';
  const product=products.find(item=>item.id===dose.productId);
  if(!product||dose.unit!=='tablet'||dose.formulation!==product.formulation||(dose.strengthUnit??product.strengthUnit)!=='mg')return '1';
  const strength=decimalValue(dose.packageStrength||dose.strength);
  if(strength===null||strength!==decimalValue(dose.strength))return '1';
  // Reviewed 2026-09-13: S2 §§3/16 (10/20 mg bisection, 5 mg unscored);
  // C11 How Supplied / product characteristics (all listed Adderall IR scored);
  // C7 §2.2 and Medication Guide (20/30 mg halves only); C14 §2.3 (5 mg only).
  // Generic family entries and other unverified packages do not inherit these rules.
  const halfStrengths:Record<string,readonly string[]>={
    'ritalin':['10','20'],
    'adderall-ir':['5','7.5','10','12.5','15','20','30'],
    'quillichew-er':['20','30'],
    'dyanavel-xr-tablet':['5'],
  };
  return halfStrengths[dose.productId]?.some(value=>decimalValue(value)===strength)?'0.5':'1';
}

/** Preserve off-step manual amounts exactly; invalid or nonpositive results stay unchanged. */
export function steppedQuantity(dose:Dose,direction:-1|1):string|null {
  if(!dose.productId||!dose.unit||(direction!==-1&&direction!==1))return null;
  const current=dose.quantity===''?0n:decimalValue(dose.quantity);
  if(current===null)return null;
  const next=current+BigInt(direction)*decimalValue(quantityStep(dose))!;
  if(next<=0n||next>10_000n*DECIMAL_SCALE)return null;
  return decimalText(next);
}

export function doseInputError(dose:Dose):string {
  if(!dose.productId)return 'Choose a medication first.';
  const product=products.find(item=>item.id===dose.productId);
  if(product&&dose.packageStrength!==undefined){try{parseCustomStrength(product,dose.packageStrength);}catch(error){return (error as Error).message;}}
  const q=decimalValue(dose.quantity),s=decimalValue(dose.strength),amount=decimalValue(dose.amountMg);
  if(q===null||q<=0n||s===null||s<=0n)return 'Enter a positive strength and quantity using decimal notation.';
  if(amount===null||amount<=0n||dose.ingredients?.some(i=>{const v=decimalValue(i.amountMg);return v===null||v<=0n;}))return 'This amount cannot be represented exactly with the supported nine decimal places. Review the quantity.';
  if(dose.unit==='patch'&&dose.removalAt){
    if(!Number.isFinite(Date.parse(dose.removalAt)))return 'Enter a valid patch removal time, or clear it if removal has not been recorded.';
    if(dose.administeredAt&&Date.parse(dose.removalAt)<=Date.parse(dose.administeredAt))return 'Patch removal must be after application.';
  }
  return '';
}
export function updateDose(dose:Dose,patch:Partial<Dose>,zone:string):Dose{
  let d={...dose,...patch};
  if('date' in patch||'time' in patch||'disambiguation' in patch){
    // Older records may have only an instant, or local fields from another zone.
    // Derive the unchanged portion from that instant before applying an edit.
    if(dose.administeredAt){try{
      const local=instantToLocal(dose.administeredAt,zone);
      const occurrence='date' in patch&&patch.date!==local.date?undefined:occurrenceAt(dose.administeredAt,zone);
      d={...dose,...local,disambiguation:occurrence,...patch};
    }catch{/* Keep invalid input visible for validation instead of normalizing it. */}}
  }
  const productChanged='productId' in patch&&patch.productId!==dose.productId;
  const strengthChanged='strength' in patch||'packageStrength' in patch;
  const quantityChanged='quantity' in patch;
  const p=products.find(p=>p.id===d.productId);
  if(productChanged){
    if(p){
      const base=snapshot(p,resolvePackageStrength(p));
      d={...d,...base,quantity:'1',assumptions:undefined,unusual:false,removalAt:undefined,modelVersion:MODEL_VERSION};
    }else if(!d.productId){
      d={...d,productName:'',formulation:'',strength:'',packageStrength:'',strengthUnit:'',manufacturer:'',unit:'',amountMg:'',amountBasis:undefined,ingredients:[],assumptions:undefined,unusual:false,removalAt:undefined};
    }else{
      throw new Error('Choose a known medication before replacing a historical product.');
    }
  }else if(strengthChanged&&p){
    const base=snapshot(p,resolvePackageStrength(p,patch.packageStrength??patch.strength));
    d={...d,...base,manufacturer:dose.manufacturer??base.manufacturer,assumptions:undefined};
  }else if(strengthChanged){
    // A missing catalog entry must not replace the saved package snapshot.
    d={...d,strength:dose.strength,packageStrength:dose.packageStrength};
  }
  if(productChanged||(strengthChanged&&p)||quantityChanged){
    const normalized=decimalValue(d.quantity);
    if(normalized!==null)d.quantity=decimalText(normalized);
    d.amountMg=multiply(d.strength,d.quantity);
    if(!d.productId){
      d.amountMg='';d.ingredients=[];
    }else if(p&&(productChanged||strengthChanged)){
      d.ingredients=d.ingredients?.map(i=>({...i,amountMg:multiply(i.strengthMg!,d.quantity)}));
    }else{
      // Existing ingredient identities and strengths are immutable snapshots, not live catalog values.
      d.ingredients=dose.ingredients?.map(i=>{
        // Recover an exact per-unit snapshot before an empty quantity clears the
        // old amount. Legacy backups need not contain strengthMg yet.
        const strengthMg=i.strengthMg||scaleAmount(i.amountMg,'1',dose.quantity);
        return {...i,...(strengthMg?{strengthMg}:{}),amountMg:strengthMg?multiply(strengthMg,d.quantity):scaleAmount(i.amountMg,d.quantity,dose.quantity)};
      });
    }
    if(normalized!==null&&normalized%DECIMAL_SCALE!==0n&&d.unit&&d.unit!=='mL')d.unusual=true;
  }
  if('date' in patch||'time' in patch||'disambiguation' in patch){
    d.administeredAt='';d.timeZone=zone;
    if(d.date&&d.time){try{d.administeredAt=localToInstant(d.date,d.time,zone,d.disambiguation);}catch{/* Invalid local input remains pending. */}}
  }
  return d;
}
/** Keep an incomplete custom field visible and unsavable, never use its previous amount. */
export function updateCustomStrength(dose:Dose,value:string,zone:string):Dose {
  const product=products.find(item=>item.id===dose.productId);
  if(!product)return dose;
  try{return updateDose(dose,{packageStrength:parseCustomStrength(product,value)},zone);}
  catch {
    return {...dose,packageStrength:value,strength:value.split('/')[0].trim(),amountMg:'',ingredients:[],assumptions:undefined};
  }
}
function occurrenceAt(iso:string,zone:string):Dose['disambiguation'] {
  const local=instantToLocal(iso,zone);
  const earlier=localToInstant(local.date,local.time,zone,'earlier');
  const later=localToInstant(local.date,local.time,zone,'later');
  if(earlier===later)return undefined;
  return Math.floor(Date.parse(iso)/60000)===Math.floor(Date.parse(later)/60000)?'later':'earlier';
}
export function currentDoseTime(zone:string,increment:TimeIncrementMinutes,at=Date.now()):{date:string;time:string;administeredAt:string;disambiguation?:Dose['disambiguation']} {
  if(![1,5,10].includes(increment)||!Number.isFinite(at))throw new RangeError('Choose a valid time and a 1, 5 or 10 minute increment.');
  // Round the local clock, not the UTC clock (some zones have 45-minute offsets).
  // If a historical clock jump skipped that rounded time, step backward until
  // a real local boundary is found. A default time must never be in the future.
  for(let minutesBack=0;minutesBack<=increment+1;minutesBack++){
    const probe=new Date(at-minutesBack*60000).toISOString(),local=instantToLocal(probe,zone);
    const minute=Math.floor(Number(local.time.slice(3,5))/increment)*increment;
    const time=`${local.time.slice(0,3)}${String(minute).padStart(2,'0')}`;
    try{
      const administeredAt=localToInstant(local.date,time,zone,occurrenceAt(probe,zone));
      if(Date.parse(administeredAt)<=at)return {date:local.date,time,administeredAt,disambiguation:occurrenceAt(administeredAt,zone)};
    }catch{/* The rounded clock time may not exist on a transition date. */}
  }
  throw new RangeError('The current time could not be rounded in this time zone.');
}

interface PatchRemovalUpdate {dose:Dose;error:string;requiresOccurrence:boolean;}
/** Invalid input never deletes or replaces an existing removal instant. */
export function updatePatchRemoval(dose:Dose,value:string,zone:string,disambiguation?:Dose['disambiguation']):PatchRemovalUpdate {
  if(!value)return {dose:{...dose,removalAt:''},error:'',requiresOccurrence:false};
  let requiresOccurrence=false;
  try{
    const [date,time]=value.split('T');
    let previousInput='',previousOccurrence:Dose['disambiguation'];
    if(dose.removalAt){try{const local=instantToLocal(dose.removalAt,zone);previousInput=`${local.date}T${local.time}`;previousOccurrence=occurrenceAt(dose.removalAt,zone);}catch{/* Invalid historical input requires an explicit correction. */}}
    const choice=disambiguation??(value===previousInput?previousOccurrence:undefined);
    let instant:string;
    try{instant=localToInstant(date,time,zone);}catch(error){
      if(!/occurs twice/.test((error as Error).message))throw error;
      requiresOccurrence=true;
      if(!choice)throw error;
      instant=localToInstant(date,time,zone,choice);
    }
    if(value===previousInput&&(!requiresOccurrence||choice===previousOccurrence))instant=dose.removalAt!;
    if(dose.administeredAt){
      const application=Date.parse(dose.administeredAt);
      if(!Number.isFinite(application))throw new Error('Correct the application time first.');
      if(Date.parse(instant)<=application)throw new Error('Patch removal must be after application.');
    }
    return {dose:instant===dose.removalAt?dose:{...dose,removalAt:instant},error:'',requiresOccurrence};
  }catch(error){return {dose,error:(error as Error).message,requiresOccurrence};}
}
/** Move by elapsed minutes, preserving a real instant across midnight and DST. */
export function shiftDoseTime(dose:Dose,minutes:number,zone:string):Dose {
  if(!Number.isSafeInteger(minutes))return dose;
  try{
    const from=dose.administeredAt||localToInstant(dose.date||'',dose.time||'',zone,dose.disambiguation);
    const shifted=new Date(Date.parse(from)+minutes*60000).toISOString();
    const local=instantToLocal(shifted,zone);
    return {...dose,...local,administeredAt:shifted,timeZone:zone,disambiguation:occurrenceAt(shifted,zone)};
  }catch{return dose;}
}
function amountLabel(dose:Dose):string {
  if(!dose.amountMg)return 'Amount incomplete';
  if(dose.unit==='patch')return `${dose.amountMg} mg nominal / 9 h`;
  if(dose.amountBasis==='first listed ingredient'&&dose.ingredients?.length)return `${dose.ingredients.map(i=>i.amountMg).join(' / ')} mg`;
  return `${dose.amountMg} mg`;
}
export interface DoseStrengthChoice {productId:string;packageStrength:string;}
/** Group favorites for display, retaining the product identity behind every choice. */
export function doseStrengthChoices(dose:Dose,favorites?:readonly Favorite[]):DoseStrengthChoice[] {
  const product=products.find(item=>item.id===dose.productId);
  if(!product)return dose.packageStrength||dose.strength?[{productId:dose.productId,packageStrength:dose.packageStrength||dose.strength}]:[];
  const options=new Map<string,DoseStrengthChoice>(),groupId=medicationDisplay(product).groupId;
  const add=(source:Product,strength:string,replace=false)=>{
    try{
      const resolved=resolvePackageStrength(source,strength),key=parseCustomStrength(source,resolved);
      if(replace||!options.has(key))options.set(key,{productId:source.id,packageStrength:source.strengths.find(value=>parseCustomStrength(source,value)===key)??key});
    }catch{/* An invalid favorite must not silently choose a different package. */}
  };
  if(favorites===undefined)product.strengths.forEach(strength=>add(product,strength));
  else for(const favorite of favorites){
    const source=products.find(item=>item.id===favorite.productId);
    if(source&&medicationDisplay(source).groupId===groupId)add(source,favorite.packageStrength||favorite.strength);
  }
  // A removed favorite may still be the original strength of a record. Unlisted
  // historical/custom values remain visible in the existing Custom input.
  const current=dose.packageStrength??dose.strength;
  try{
    const key=parseCustomStrength(product,resolvePackageStrength(product,current));
    if(options.has(key)||product.strengths.some(value=>parseCustomStrength(product,value)===key))add(product,current,true);
  }catch{/* Keep incomplete custom input visible and unsavable. */}
  return [...options.values()];
}
export function doseStrengthOptions(dose:Dose,favorites?:readonly Favorite[]):string[] {
  return doseStrengthChoices(dose,favorites).map(choice=>choice.packageStrength);
}
/** Changing a grouped strength explicitly selects its saved product, not its model. */
export function selectDoseStrength(dose:Dose,choice:DoseStrengthChoice,zone:string):Dose {
  const next=choice.productId===dose.productId?dose:updateDose(dose,{productId:choice.productId},zone);
  return updateDose(next,{packageStrength:choice.packageStrength,quantity:dose.quantity},zone);
}
/** A new medication group starts with its first saved favorite and default quantity. */
export function selectDoseMedication(dose:Dose,productId:string,favorites:readonly Favorite[]|undefined,zone:string):Dose {
  const product=products.find(item=>item.id===productId);
  const favorite=product&&favorites?.find(item=>{
    const source=products.find(p=>p.id===item.productId);
    return source&&medicationDisplay(source).groupId===medicationDisplay(product).groupId;
  });
  const next=updateDose(dose,{productId:favorite?.productId??productId},zone);
  return favorite?updateDose(next,{packageStrength:favorite.packageStrength||favorite.strength,quantity:favorite.quantity},zone):next;
}
interface Props {dose:Dose;index:number;profile:Profile;onChange:(d:Dose)=>void;onRemove?:()=>void;onDuplicate?:()=>void;actual?:boolean;productIds?:string[];favorites?:readonly Favorite[];}
export default function DoseEditor({dose,index,profile,onChange,onRemove,onDuplicate,productIds,favorites}:Props){
  const [removalDraft,setRemovalDraft]=useState<{value:string;disambiguation?:Dose['disambiguation'];error:string;requiresOccurrence:boolean}|null>(null);
  const [customMode,setCustomMode]=useState(false),[customDraft,setCustomDraft]=useState<string|null>(null);
  useEffect(()=>{setCustomMode(false);setCustomDraft(null);},[dose.id,dose.productId]);
  useEffect(()=>setRemovalDraft(null),[dose.id,dose.productId,profile.timeZone]);
  const p=products.find(p=>p.id===dose.productId);
  const historical=!!dose.productId&&!p;
  let local={date:dose.date||'',time:dose.time||''},timeError='',disambiguation=dose.disambiguation;
  if(dose.administeredAt){try{local=instantToLocal(dose.administeredAt,profile.timeZone);disambiguation=occurrenceAt(dose.administeredAt,profile.timeZone);}catch(e){timeError=(e as Error).message;}}
  // A saved instant is authoritative; a viewing-zone change only changes these labels.
  const date=local.date,time=local.time;
  if(date&&time&&!timeError){try{localToInstant(date,time,profile.timeZone,disambiguation);}catch(e){timeError=(e as Error).message;}}
  const update=(patch:Partial<Dose>)=>onChange(updateDose({...dose,date,time,disambiguation},patch,profile.timeZone));
  const inputError=dose.productId?doseInputError(dose):'';
  const timeErrorId=`dose-time-error-${dose.id}`,inputErrorId=`dose-input-error-${dose.id}`;
  const strengthDescriptionId=`dose-strength-unit-${dose.id}`,quantityDescriptionId=`dose-quantity-unit-${dose.id}`;
  const amountError=!!inputError&&!inputError.toLowerCase().includes('patch removal');
  const quantityIncrement=quantityStep(dose),lowerQuantity=steppedQuantity(dose,-1),higherQuantity=steppedQuantity(dose,1);
  const packageStrength=dose.packageStrength??p?.strengths.find(s=>s.split('/')[0]===dose.strength)??dose.strength;
  const strengthUnit=dose.strengthUnit??p?.strengthUnit??'unit not recorded';
  const strengthChoices=doseStrengthChoices(dose,favorites),strengthOptions=strengthChoices.map(choice=>choice.packageStrength);
  const listedStrength=p&&strengthOptions.find(value=>{try{return parseCustomStrength(p,value)===parseCustomStrength(p,packageStrength);}catch{return false;}});
  const customStrength=!!p&&(customMode||!listedStrength);
  const combination=p?.strengths[0]?.includes('/');
  const options=groupMedicationProducts(products.filter(item=>productIds===undefined||productIds.includes(item.id)||item.id===dose.productId)).map(group=>({group,product:group.products.find(item=>item.id===dose.productId)??group.products.find(item=>item.id===favorites?.find(favorite=>group.products.some(p=>p.id===favorite.productId))?.productId)??group.defaultProduct}));
  const increment=profile.timeIncrementMinutes===1?1:profile.timeIncrementMinutes===10?10:5;
  const useCurrentTime=()=>onChange({...dose,...currentDoseTime(profile.timeZone,increment),timeZone:profile.timeZone});
  let savedRemovalInput='',savedRemovalOccurrence:Dose['disambiguation'];
  if(dose.removalAt){try{const local=instantToLocal(dose.removalAt,profile.timeZone);savedRemovalInput=`${local.date}T${local.time}`;savedRemovalOccurrence=occurrenceAt(dose.removalAt,profile.timeZone);}catch{/* Existing invalid values are reported by doseInputError. */}}
  const removal=removalDraft??{value:savedRemovalInput,disambiguation:savedRemovalOccurrence,error:'',requiresOccurrence:!!savedRemovalOccurrence};
  const removalErrorId=`dose-removal-error-${dose.id}`;
  function changeRemoval(value:string,choice?:Dose['disambiguation']){
    const result=updatePatchRemoval(dose,value,profile.timeZone,choice);
    const selectedChoice=choice??(!result.error&&result.requiresOccurrence&&result.dose.removalAt?occurrenceAt(result.dose.removalAt,profile.timeZone):undefined);
    setRemovalDraft({value,disambiguation:selectedChoice,error:result.error,requiresOccurrence:result.requiresOccurrence});
    if(!result.error&&result.dose!==dose)onChange(result.dose);
  }
  return <div className={`dose-editor ${!dose.administeredAt?'pending':''}`}>
    <div className="dose-row"><div className="dose-number"><i style={{background:colors[index%colors.length]}}/><span>Dose {index+1}</span></div>
    <label className="field medication-field"><span>Medication</span><select aria-label={`Dose ${index+1} medication`} value={dose.productId} onChange={e=>onChange(selectDoseMedication({...dose,date,time,disambiguation},e.target.value,favorites,profile.timeZone))}><option value="">Choose medication</option>{options.map(({group,product})=><option key={group.id} value={product.id}>{group.title}</option>)}{historical&&<option value={dose.productId}>{dose.productName||'Historical medication'} · {dose.formulation||'Formulation not recorded'}</option>}</select></label>
    <div className="field strength-field"><label htmlFor={`dose-strength-${dose.id}`} id={strengthDescriptionId}>{dose.productId?`Strength · ${strengthUnit}`:'Strength'}</label><select aria-label={`Dose ${index+1} strength`} disabled={!p} id={`dose-strength-${dose.id}`} aria-invalid={amountError||undefined} aria-describedby={`${strengthDescriptionId}${amountError?` ${inputErrorId}`:''}`} value={customStrength?'custom':listedStrength??packageStrength} onChange={e=>{setCustomDraft(null);if(e.target.value==='custom'){setCustomMode(true);}else{setCustomMode(false);const choice=strengthChoices.find(item=>item.packageStrength===e.target.value);if(choice)onChange(selectDoseStrength({...dose,date,time,disambiguation},choice,profile.timeZone));}}}>{!packageStrength&&<option value="">—</option>}{p&&strengthOptions.map(s=><option key={s} value={s}>{s}</option>)}{p&&<option value="custom">Custom</option>}{!p&&packageStrength&&<option value={packageStrength}>{packageStrength}</option>}</select>{customStrength&&<div className="dose-custom-strength"><input aria-label={`Dose ${index+1} custom strength in ${strengthUnit}`} aria-invalid={amountError||undefined} aria-describedby={`${strengthDescriptionId}${combination?` dose-strength-order-${dose.id}`:''}${amountError?` ${inputErrorId}`:''}`} type="text" inputMode={combination?'text':'decimal'} maxLength={100} autoComplete="off" spellCheck={false} value={customDraft??packageStrength} onFocus={()=>setCustomDraft(packageStrength)} onBlur={()=>setCustomDraft(null)} onChange={e=>{setCustomDraft(e.target.value);onChange(updateCustomStrength(dose,e.target.value,profile.timeZone));}}/>{combination&&<small id={`dose-strength-order-${dose.id}`}>{p?.ingredients?.map(item=>item.name).join(' / ')||'All ingredient strengths in package order'}</small>}</div>}</div>
    <div className="field quantity-field"><label htmlFor={`dose-quantity-${dose.id}`} id={quantityDescriptionId}>{dose.productId&&dose.unit?`Quantity · ${dose.unit}`:'Quantity'}</label><div className="dose-quantity-stepper"><button type="button" disabled={lowerQuantity===null} aria-label={`Decrease Dose ${index+1} quantity by ${quantityIncrement} ${dose.unit||'unit'}`} onClick={()=>{if(lowerQuantity!==null)update({quantity:lowerQuantity});}}>−</button><input id={`dose-quantity-${dose.id}`} aria-label={`Dose ${index+1} quantity`} aria-invalid={amountError||undefined} aria-describedby={`${quantityDescriptionId}${amountError?` ${inputErrorId}`:''}`} type="number" inputMode="decimal" min="0.000000001" max="10000" step="any" value={dose.quantity} onChange={e=>update({quantity:e.target.value})} onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();const next=event.key==='ArrowUp'?higherQuantity:lowerQuantity;if(next!==null)update({quantity:next});}}}/><button type="button" disabled={higherQuantity===null} aria-label={`Increase Dose ${index+1} quantity by ${quantityIncrement} ${dose.unit||'unit'}`} onClick={()=>{if(higherQuantity!==null)update({quantity:higherQuantity});}}>+</button></div></div>
    <label className="field date-field"><span>Date</span><input aria-label={`Dose ${index+1} date`} aria-invalid={!!timeError||undefined} aria-describedby={timeError?timeErrorId:undefined} type="date" value={date} onInput={e=>update({date:e.currentTarget.value})}/></label>
    <div className="field time-field"><label htmlFor={`dose-time-${dose.id}`}>Time</label><div className="dose-time-inline"><MobileTimePicker triggerId={`dose-time-${dose.id}`} value={time} minuteStep={increment} timeFormat={profile.timeFormat} label={`Dose ${index+1} time`} title="Dose time" invalid={!!timeError} describedBy={timeError?timeErrorId:undefined} onChange={selected=>{if(selected!==time)update({time:selected});}}/><button type="button" className="text-button dose-time-now" aria-label={`Use current time for Dose ${index+1}`} onClick={useCurrentTime}>Now</button></div></div>
    <div className="row-actions">{onDuplicate&&<button type="button" className="icon-button" title={`Duplicate Dose ${index+1}`} aria-label={`Duplicate Dose ${index+1}`} onClick={onDuplicate}><Copy size={16}/></button>}{onRemove&&<button type="button" className="icon-button" title={`Remove Dose ${index+1}`} aria-label={`Remove Dose ${index+1}`} onClick={onRemove}><Trash2 size={16}/></button>}</div></div>
    {timeError&&<div className="inline-error" id={timeErrorId} role="alert">{timeError}{/ambig|twice|multiple/i.test(timeError)&&<label>Clock occurrence <select value={disambiguation||''} onChange={e=>update({disambiguation:e.target.value as 'earlier'|'later'})}><option value="">Choose an occurrence</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></label>}</div>}
    {inputError&&<p className="inline-error" id={inputErrorId} role="alert">{inputError}</p>}
    {dose.productId&&<div className="dose-model-footer">
      <span className="dose-amount">{!dose.amountMg?'Amount incomplete':`${dose.quantity} ${dose.unit} × ${packageStrength} ${strengthUnit} = ${amountLabel(dose)}`}</span>
      <details className="dose-formula-details"><summary aria-label={`Dose ${index+1} formula`}>Formula <ChevronDown size={12}/></summary><DoseFormula dose={dose}/></details>
    {dose.unit==='patch'&&<div className="patch-removal-editor"><label className="field"><span>Patch removal (local date and time)</span><input type="datetime-local" step={increment*60} value={removal.value} aria-invalid={!!removal.error||(!amountError&&!!inputError)||undefined} aria-describedby={removal.error?removalErrorId:!amountError&&inputError?inputErrorId:undefined} onInput={e=>{
      const value=e.currentTarget.value;
      if(!value&&e.currentTarget.validity.badInput){setRemovalDraft({value,error:'Enter a complete removal date and time.',requiresOccurrence:false});return;}
      changeRemoval(value,value===removal.value?removal.disambiguation:undefined);
    }}/></label>{removal.requiresOccurrence&&<label className="field"><span>Removal clock occurrence</span><select value={removal.disambiguation||''} aria-describedby={removal.error?removalErrorId:undefined} onChange={e=>changeRemoval(removal.value,e.target.value as Dose['disambiguation'])}><option value="">Choose an occurrence</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></label>}{removal.error&&<p className="inline-error" id={removalErrorId} role="alert">{removal.error} {dose.removalAt?'The existing removal time is unchanged.':'No removal time has been set.'}</p>}</div>}
      </div>}
  </div>;
}
