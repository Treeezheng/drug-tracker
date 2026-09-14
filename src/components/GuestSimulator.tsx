import { useEffect, useMemo, useRef, useState } from 'react';
import { Pill, Plus, ChevronLeft, ChevronRight, CalendarDays, Copy, X } from 'lucide-react';
import { sources } from '../lib/catalog';
import { upsertFavorite } from '../lib/favorites';
import { addDays, formatInstant, instantToLocal, todayInZone } from '../lib/time';
import { scopeTimeline } from '../lib/timeline-scope';
import { clearGuestWorkspace, freshGuestWorkspace, guestDayWindow, parseGuestWorkspace, readGuestWorkspace, validGuestDate, type GuestWorkspace } from '../lib/guest-workspace';
import type { Dose, Favorite, Profile } from '../lib/types';
import DoseEditor, { currentDoseTime, newDose, updateDose } from './DoseEditor';
import TimelineChart from './TimelineChart';
import FavoritePicker from './FavoritePicker';
import MedicalDisclaimer from './MedicalDisclaimer';
import MedicationName from './MedicationName';
import MobileTimePicker from './MobileTimePicker';
import Modal from './Modal';
import { GUEST_CONSENT_KEY, forgetGuestChoice, readGuestConsent, rememberGuestChoice, saveRememberedGuestWorkspace } from '../lib/guest-consent';
import { submitGuestDose } from '../lib/guest-dose-entry';
import { useProfilePreferences } from '../hooks/useProfilePreferences';
import { useNewDoseFocus } from '../hooks/useNewDoseFocus';
import { doseRowId } from '../lib/dose-row-focus';
import { restoreGuestSession, sameGuestWorkspace } from '../lib/guest-session';
import { withGuestStorageLock } from '../lib/guest-storage-lock';
import './GuestSimulator.css';

function initial(initialWorkspace?:GuestWorkspace,initialConsent=false){
  let fallback=freshGuestWorkspace();
  try{if(initialWorkspace)fallback=parseGuestWorkspace(JSON.stringify(initialWorkspace));}catch{/* Invalid parent memory is never installed as a workspace. */}
  try{return restoreGuestSession(window.localStorage,initialWorkspace,initialConsent);}
  catch{return {workspace:fallback,deviceSnapshot:null,remembered:false,consented:initialConsent,blocked:true,error:'Saved browser data is unavailable. You can continue without saving on this device.'};}
}
export default function GuestSimulator({onSignIn,onRegister,onWorkspace,initialWorkspace,initialConsent=false,onConsent,notice=''}:{onSignIn:()=>void;onRegister:()=>void;onWorkspace?:(workspace:GuestWorkspace)=>void;initialWorkspace?:GuestWorkspace;initialConsent?:boolean;onConsent?:(consented:boolean)=>void;notice?:string}){
  const [loaded]=useState(()=>initial(initialWorkspace,initialConsent)),[workspace,setWorkspace]=useState<GuestWorkspace>(loaded.workspace);
  const [submittedIds,setSubmittedIds]=useState<Set<string>>(()=>new Set());
  const [blocked,setBlocked]=useState(loaded.blocked),[storageError,setStorageError]=useState(loaded.error),[error,setError]=useState('');
  const [page,setPage]=useState<'simulation'|'settings'>('simulation'),[choosing,setChoosing]=useState(false);
  const [settingsEpoch,setSettingsEpoch]=useState(0),[consentBusy,setConsentBusy]=useState(false);
  const live=useRef(true);
  const deviceSnapshot=useRef<GuestWorkspace|null>(loaded.deviceSnapshot);

  const skipNextSave=useRef(false);
  const addAfterChoosing=useRef(false);
  const [consented,setConsented]=useState(loaded.consented),[remember,setRemember]=useState(loaded.remembered);
  const [guestConsent,setGuestConsent]=useState(false),[adult,setAdult]=useState(false),[chooseStorage,setChooseStorage]=useState(false);
  const focusNewDose=useNewDoseFocus(page==='simulation'&&!choosing&&!guestConsent);
  const afterConsent=useRef<null|'dose'|'medications'>(null);
  const {profile,drafts,favorites,date,days}=workspace;
  const settings=useProfilePreferences(profile,`guest-${settingsEpoch}`,async(next:Profile)=>{guestDayWindow(date,days,next.timeZone);const saved={...next,name:''};setWorkspace(current=>({...current,profile:saved}));setError('');return saved;});
  const preferences=settings.draft;
  const publishedOnly=false;
  useEffect(()=>onWorkspace?.(workspace),[workspace,onWorkspace]);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>onConsent?.(consented),[consented,onConsent]);
  useEffect(()=>{
    if(skipNextSave.current){skipNextSave.current=false;return;}if(blocked||!remember||!consented)return;
    let canceled=false;
    void withGuestStorageLock(()=>{
      if(canceled)return null;
      if(!readGuestConsent(window.localStorage))return false;
      if(!sameGuestWorkspace(readGuestWorkspace(window.localStorage),deviceSnapshot.current))return 'conflict';
      const checked=parseGuestWorkspace(JSON.stringify(workspace));
      const saved=saveRememberedGuestWorkspace(window.localStorage,checked);
      if(saved)deviceSnapshot.current=checked;
      return saved;
    }).then(saved=>{
      if(canceled)return;
      if(saved==='conflict'){setRemember(false);setStorageError('Another tab changed the saved simulation. Your edits remain in memory; that device copy is unchanged.');return;}
      if(saved===false)setRemember(false);setStorageError('');
    }).catch(cause=>{if(!canceled){setRemember(false);setStorageError(`These changes are only in memory. ${cause instanceof Error?cause.message:'Device storage is unavailable.'}`);}});
    return()=>{canceled=true;};
  },[workspace,blocked,remember,consented]);
  useEffect(()=>{function syncStorage(event:StorageEvent){if(event.key!==null&&event.key!==GUEST_CONSENT_KEY)return;try{if(!readGuestConsent(window.localStorage))setRemember(false);}catch{setRemember(false);}}window.addEventListener('storage',syncStorage);return()=>window.removeEventListener('storage',syncStorage);},[]);

  useEffect(()=>{if(!consented)return;const action=afterConsent.current;afterConsent.current=null;if(action==='dose')addDoseAfterConsent();else if(action==='medications')setChoosing(true);},[consented]);
  function change(patch:Partial<GuestWorkspace>){
    try{guestDayWindow(patch.date??date,patch.days??days,(patch.profile??profile).timeZone);setWorkspace(current=>({...current,...patch}));setError('');}
    catch{setError('This date is unavailable in the selected time zone. Choose another date.');}
  }
  function addDose(favorite?:Favorite){
    if(!consented){requireConsent('dose');return;}
    addDoseAfterConsent(favorite);
  }
  function requireConsent(action:'dose'|'medications'){afterConsent.current=action;setAdult(false);setChooseStorage(false);setGuestConsent(true);}
  function chooseMedications(){if(!consented){requireConsent('medications');return;}setChoosing(true);}
  function addDoseAfterConsent(favorite?:Favorite){
    if(!favorites.length){addAfterChoosing.current=true;setChoosing(true);return;}
    appendDose(favorite);
  }
  function appendDose(favorite?:Favorite){
    if(drafts.length>=100){setError('This guest workspace supports up to 100 simulated doses.');return;}
    try{
      const row=favorite?updateDose(newDose(favorite.productId,favorite.packageStrength||favorite.strength),{quantity:favorite.quantity},profile.timeZone):{...newDose(),productId:'',productName:'',formulation:'',strength:'',packageStrength:'',strengthUnit:'',unit:'',amountMg:'',ingredients:[]};
      change({drafts:[...drafts,{...row,...currentDoseTime(profile.timeZone,profile.timeIncrementMinutes||5),timeZone:profile.timeZone,status:'simulated'}]});
      focusNewDose(row.id);
    }catch{setError('This medication is unavailable in the current catalog. Choose another medication.');}
  }
  function editDose(previous:Dose,next:Dose){
    change({drafts:drafts.map(d=>d.id===previous.id?{...next,status:'simulated'}:d)});
  }
  function expandDose(id:string){setSubmittedIds(current=>{const next=new Set(current);next.delete(id);return next;});setError('');}
  function removeDose(id:string){change({drafts:drafts.filter(d=>d.id!==id)});expandDose(id);}
  function duplicateDose(dose:Dose){
    if(drafts.length>=100){setError('This guest workspace supports up to 100 simulated doses.');return;}
    const row={...dose,id:crypto.randomUUID(),status:'simulated' as const};
    change({drafts:[...drafts,row]});focusNewDose(row.id);
  }
  function submitDose(dose:Dose){
    try{setSubmittedIds(submitGuestDose(dose,submittedIds));setError('');}
    catch(cause){setError((cause as Error).message);}
  }
  async function clear(){
    focusNewDose(null);setRemember(false);
    try{await withGuestStorageLock(()=>{if(!live.current)return;clearGuestWorkspace(window.localStorage);forgetGuestChoice(window.localStorage);deviceSnapshot.current=null;});if(!live.current)return;skipNextSave.current=true;setBlocked(false);setStorageError('');}
    catch{if(!live.current)return;setStorageError('Device storage could not be cleared. This page has been reset in memory; the saved device copy may remain.');setBlocked(true);}
    setWorkspace(freshGuestWorkspace(profile.timeZone));setSettingsEpoch(value=>value+1);setSubmittedIds(new Set());setError('');
  }
  async function acceptGuestConsent(){
    if(!adult||consentBusy)return;setConsentBusy(true);
    try{
      if(chooseStorage){
        const saved=await withGuestStorageLock(()=>live.current?rememberGuestChoice(window.localStorage):null);
        if(!live.current)return;
        deviceSnapshot.current=saved;
        if(saved){setWorkspace(saved);setSettingsEpoch(value=>value+1);setSubmittedIds(new Set());}
        setRemember(true);setBlocked(false);setStorageError('');
      }
      if(live.current){setConsented(true);setGuestConsent(false);}
    }catch(cause){if(live.current)setStorageError(`Device saving is unavailable. Continue without saving to keep this simulation in memory. ${cause instanceof Error?cause.message:''}`);}
    finally{if(live.current)setConsentBusy(false);}
  }
  const range=useMemo(()=>guestDayWindow(date,days,profile.timeZone),[date,days,profile.timeZone]);
  const scoped=useMemo(()=>scopeTimeline({actual:[],drafts,start:range.start,end:range.end,publishedOnly}),[drafts,range,publishedOnly]);
  return <div className="simple-shell guest-shell"><header className="app-header"><a href="#" className="brand" onClick={event=>{event.preventDefault();setPage('simulation');}}><Pill size={22}/><span>Drug Tracker</span></a><nav className="app-nav" aria-label="Main navigation"><button className={page==='simulation'?'active':''} aria-current={page==='simulation'?'page':undefined} onClick={()=>setPage('simulation')}>Dose Simulation</button><button onClick={onSignIn}>History</button><button className={page==='settings'?'active':''} aria-current={page==='settings'?'page':undefined} onClick={()=>setPage('settings')}>Settings</button></nav><div className="account-control"><button className="text-button" onClick={onSignIn}>Sign in</button><button className="button secondary small" onClick={onRegister}>Create account</button></div></header>
    <main><div className="page-title responsive-page-title"><h1>{page==='simulation'?'Dose Simulation':'Simulation settings'}</h1></div><p className="guest-storage-note">Guest simulation · {remember?'Saved unencrypted on this device.':'In memory only; refreshing clears this simulation.'} Account records are separate.</p>
      {(notice||error||storageError)&&<p className="notice" role={error||storageError?'alert':'status'}>{error||storageError||notice}</p>}
      {page==='simulation'?<><div className="toolbar simulation-toolbar"><div className="date-nav"><button className="icon-button" aria-label="Previous day" disabled={date==='0001-01-01'} onClick={()=>change({date:addDays(date,-1)})}><ChevronLeft size={18}/></button><label className="selected-date"><CalendarDays size={16}/><input aria-label="Chart date" type="date" value={date} onChange={e=>{if(validGuestDate(e.target.value))change({date:e.target.value});else setError('Enter a valid chart date.');}}/></label><button className="icon-button" aria-label="Next day" disabled={date==='9998-12-31'} onClick={()=>change({date:addDays(date,1)})}><ChevronRight size={18}/></button><button className="text-button" onClick={()=>change({date:todayInZone(profile.timeZone)})}>Today</button></div><button className="button primary mobile-add-dose" onClick={()=>addDose()}><Plus size={16}/>Add dose</button><div className="segmented">{([1,2,3] as const).map(n=><button key={n} className={days===n?'selected':''} aria-pressed={days===n} onClick={()=>change({days:n})}>{n===1?'Day':`${n*24} hours`}</button>)}</div></div>
      <section className="card timeline-card"><TimelineChart onAddDose={()=>addDose()} hasPendingDose={drafts.length>0} omittedHistoryCount={scoped.omittedHistoryCount} omittedUnknownHistoryCount={scoped.omittedUnknownHistoryCount} doses={scoped.doses} date={date} days={days} profile={profile} publishedOnly={publishedOnly} baseline="empty" onProfile={()=>setPage('settings')} onMove={(id,iso)=>change({drafts:drafts.map(d=>d.id===id?{...d,...instantToLocal(iso,profile.timeZone),administeredAt:iso,timeZone:profile.timeZone,status:'simulated'}:d)})}/></section>
      <section className="card dose-card">
        <div className="section-heading guest-dose-heading"><h2>Doses</h2><div className="guest-dose-heading-actions"><button className="text-button" onClick={chooseMedications}>My medications</button><span className="guest-store-hint">(To store: please <button className="text-button" onClick={onSignIn}>sign in</button>)</span></div></div>
        {drafts.map((dose,index)=>submittedIds.has(dose.id)?<div className="guest-submitted-row" key={dose.id}>
          <div className="guest-dose-time">{formatInstant(Date.parse(dose.administeredAt),profile,false)}<small>{instantToLocal(dose.administeredAt,profile.timeZone).date}</small></div>
          <div className="guest-dose-product"><strong><MedicationName id={dose.productId} name={dose.productName}/></strong><small>{dose.packageStrength||dose.strength} {dose.strengthUnit||'mg'} · {dose.quantity} {dose.unit}</small></div>
          <span className="tag">Simulated</span><div className="guest-dose-actions"><button className="text-button" onClick={()=>expandDose(dose.id)}>Edit</button><button className="icon-button" aria-label={`Duplicate simulated dose ${index+1}`} onClick={()=>duplicateDose(dose)}><Copy size={15}/></button><button className="icon-button" aria-label={`Remove simulated dose ${index+1}`} onClick={()=>removeDose(dose.id)}><X size={15}/></button></div>
        </div>:<div className="planned-row" id={doseRowId(dose.id)} key={dose.id}>
          <DoseEditor onMoreMedications={()=>{addAfterChoosing.current=false;chooseMedications();}} dose={dose} index={index} profile={profile} favorites={favorites.length?favorites:undefined} productIds={favorites.map(f=>f.productId)} onChange={next=>editDose(dose,next)} onRemove={()=>removeDose(dose.id)} onDuplicate={()=>duplicateDose(dose)}/>
          <div className="row-state"><span className="muted">Simulation</span><button className="button add-record small" onClick={()=>submitDose(dose)}><Plus size={15}/>Add</button></div>
        </div>)}
        {!drafts.length&&<div className="empty-state">{favorites.length?'Add a dose to explore its timeline.':'Choose My medications to start a simulation.'}</div>}
        <div className="dose-actions only-add"><button className="button secondary desktop-add-dose" onClick={()=>addDose()}><Plus size={16}/>Add dose</button></div>
      </section>
      {scoped.sourceIds.length>0&&<details className="page-references"><summary>References</summary>{sources.filter(s=>scoped.sourceIds.includes(s.id)).map(s=><a key={s.id} href={s.url} target="_blank" rel="noreferrer">{s.title}<small>{s.section}</small></a>)}</details>}</>:<><section className="card settings-section"><div className="section-heading"><h2>My medications</h2><button className="button secondary small" onClick={chooseMedications}>Choose medications</button></div><p className="muted">These choices are for this browser’s guest simulation.</p></section><form className="card settings-section guest-preferences" onSubmit={event=>{event.preventDefault();settings.save();}}><h2>Time & sleep</h2><p className="muted">Selections apply automatically. Save to apply time-zone text and sleep-time edits.</p><div className="settings-grid"><label className="field"><span>Time zone</span><input value={preferences.timeZone} onChange={e=>settings.edit({timeZone:e.target.value})} required maxLength={80}/></label><label className="field"><span>Time display</span><select value={preferences.timeFormat} onChange={e=>settings.apply({timeFormat:e.target.value as '12h'|'24h'})}><option value="12h">12-hour</option><option value="24h">24-hour</option></select></label><label className="field"><span>Minute increment</span><select value={preferences.timeIncrementMinutes||5} onChange={e=>settings.apply({timeIncrementMinutes:Number(e.target.value) as 1|5|10})}><option value="1">1 minute</option><option value="5">5 minutes</option><option value="10">10 minutes</option></select></label></div><label className="check-line"><input type="checkbox" checked={preferences.sleepEnabled} onChange={e=>settings.apply({sleepEnabled:e.target.checked})}/>Show a sleep window</label>{preferences.sleepEnabled&&<div className="settings-grid"><div className="field"><span>Bedtime</span><MobileTimePicker label="Bedtime" value={preferences.bedtime} minuteStep={preferences.timeIncrementMinutes||5} timeFormat={preferences.timeFormat} onChange={value=>settings.edit({bedtime:value})}/></div><div className="field"><span>Wake time</span><MobileTimePicker label="Wake time" value={preferences.wakeTime} minuteStep={preferences.timeIncrementMinutes||5} timeFormat={preferences.timeFormat} onChange={value=>settings.edit({wakeTime:value})}/></div></div>}<button className="button secondary" type="submit" disabled={settings.saving}>{settings.saving?'Saving…':'Save simulation settings'}</button>{settings.error?<p className="inline-error" role="alert">{settings.error}</p>:<p className="muted" role="status">{settings.saving?'Applying settings…':settings.dirty?'Text or time changes are not applied yet. Select Save simulation settings.':settings.saved?(remember&&!storageError?'Settings saved on this device.':'Settings applied in memory for this page; device storage is off or unavailable.'):'Time increment changes future time choices; existing dose times are preserved.'}</p>}</form></>}
      <div className="guest-bottom"><button className="text-button" onClick={clear}>Clear simulation</button><span>To keep an actual medication log, <button className="text-button" onClick={onRegister}>create an account</button>.</span></div>
    <footer className="app-footer"><span>Open source · Built with OpenAI Codex (GPT-6)</span><nav className="footer-links" aria-label="Project and legal"><a href="https://github.com/Treeezheng/drug-tracker" target="_blank" rel="noreferrer">GitHub</a><a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer">Privacy</a><a href={`${import.meta.env.BASE_URL}terms.html`} target="_blank" rel="noreferrer">Terms</a></nav><MedicalDisclaimer/></footer></main>
    {guestConsent&&<Modal title="Before you start" closeDisabled={consentBusy} onClose={()=>{afterConsent.current=null;setGuestConsent(false);}}><form onSubmit={event=>{event.preventDefault();void acceptGuestConsent();}}><p>This simulator is for adults 18 and older.</p><p><strong>Results are simulations, not medical advice.</strong></p><p className="muted">By default, this simulation stays in memory and disappears when you refresh or close this page.</p><label className="check-line"><input type="checkbox" required checked={adult} onChange={event=>setAdult(event.target.checked)}/>I am 18 or older</label><label className="check-line"><input type="checkbox" checked={chooseStorage} onChange={event=>setChooseStorage(event.target.checked)}/>Remember my simulation on this device</label><p className="field-hint">Optional device storage is unencrypted. Anyone using this browser profile may see it. Leave this off on shared devices. Existing saved simulations load only if you choose this option.</p><p className="field-hint"><a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer">Privacy details</a></p>{storageError&&<p className="inline-error" role="alert">{storageError}</p>}<div className="modal-footer"><button type="button" className="button secondary" disabled={consentBusy} onClick={()=>{afterConsent.current=null;setGuestConsent(false);}}>Cancel</button><button className="button primary" disabled={!adult||consentBusy}>{consentBusy?'Saving choice…':'Continue'}</button></div></form></Modal>}
    {choosing&&<FavoritePicker favorites={favorites} onSave={favorite=>setWorkspace(current=>({...current,favorites:upsertFavorite(current.favorites,favorite)}))} onRemove={favorite=>setWorkspace(current=>({...current,favorites:current.favorites.filter(f=>f.id!==favorite.id)}))} onComplete={selection=>{if(addAfterChoosing.current&&selection.length){addAfterChoosing.current=false;appendDose(selection.length===1?selection[0]:undefined);setPage('simulation');}}} onClose={()=>{addAfterChoosing.current=false;setChoosing(false);}}/>}
  </div>;
}
