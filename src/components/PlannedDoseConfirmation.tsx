import type { Dose, Profile } from '../lib/types';
import { doseEntryStatus } from '../lib/dose-entry-status';
import { formatInstant, instantToLocal, localToInstant } from '../lib/time';
import { doseInputError, updateDose } from './DoseEditor';
import MedicationName from './MedicationName';
import MobileTimePicker from './MobileTimePicker';

export default function PlannedDoseConfirmation({dose,scheduledAt,profile,now,busy=false,pending=false,error='',onChange,onCancel,onConfirm}:{dose:Dose;scheduledAt:string;profile:Profile;now:number;busy?:boolean;pending?:boolean;error?:string;onChange:(dose:Dose)=>void;onCancel:()=>void;onConfirm:()=>void}){
  let local={date:dose.date||'',time:dose.time||''},issue='';
  if(dose.administeredAt){try{local=instantToLocal(dose.administeredAt,profile.timeZone);}catch{issue='Choose a valid date and time.';}}
  else if(local.date&&local.time){try{localToInstant(local.date,local.time,profile.timeZone,dose.disambiguation);}catch(cause){issue=(cause as Error).message;}}
  if(!issue)issue=doseInputError(dose);
  if(!issue&&doseEntryStatus(dose.administeredAt,now)!=='actual')issue=dose.administeredAt?'A taken dose cannot be in the future.':'Choose a complete date and time.';
  const issueId=`confirm-dose-time-${dose.id}`,disabled=busy||pending;
  const change=(patch:Partial<Dose>)=>onChange(updateDose(dose,patch,profile.timeZone));
  return <form className="planned-confirmation" onSubmit={event=>{event.preventDefault();if(!busy&&!issue)onConfirm();}}>
    <p className="planned-confirmation-product"><MedicationName id={dose.productId} name={dose.productName}/><small>{dose.packageStrength||dose.strength} {dose.strengthUnit||'mg'} · {dose.quantity} {dose.unit}</small></p>
    <p className="muted">Planned for {formatInstant(Date.parse(scheduledAt),profile,true)}. Confirm when you took it.</p>
    <fieldset className="dose-fields" disabled={disabled}><div className="field-pair">
      <label className="field"><span>Actual date</span><input type="date" autoFocus aria-invalid={!!issue||undefined} aria-describedby={issue?issueId:undefined} value={local.date} onInput={event=>change({date:event.currentTarget.value,disambiguation:undefined})}/></label>
      <div className="field"><span>Actual time</span><MobileTimePicker value={local.time} minuteStep={profile.timeIncrementMinutes||5} timeFormat={profile.timeFormat} label="Actual dose time" title="Dose time" invalid={!!issue} describedBy={issue?issueId:undefined} onChange={time=>{if(time!==local.time)change({time,disambiguation:undefined});}}/></div>
    </div>{/occurs twice|ambig|multiple/i.test(issue)&&<label className="field"><span>Clock occurrence</span><select value={dose.disambiguation||''} aria-describedby={issueId} onChange={event=>change({disambiguation:event.target.value as 'earlier'|'later'})}><option value="">Choose an occurrence</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></label>}</fieldset>
    {issue&&<p className="inline-error" role="alert" id={issueId}>{issue}</p>}
    {pending&&<p className="muted">Save unconfirmed. Retry keeps this exact time and dose.</p>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="button primary" disabled={busy||!!issue}>{busy?'Saving…':pending?'Retry confirmation':'Confirm taken'}</button></div>
  </form>;
}
