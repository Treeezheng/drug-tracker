import { useEffect, useRef, useState } from 'react';
import { Pill, Plus, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { sources } from '../lib/catalog';
import { upsertFavorite } from '../lib/favorites';
import { addDays, instantToLocal, sleepIntervals, todayInZone } from '../lib/time';
import { scopeTimeline } from '../lib/timeline-scope';
import { clearGuestWorkspace, freshGuestWorkspace, guestDayWindow, readGuestWorkspace, saveGuestWorkspace, validGuestDate, type GuestWorkspace } from '../lib/guest-workspace';
import type { Dose, Favorite } from '../lib/types';
import DoseEditor, { currentDoseTime, newDose, updateDose } from './DoseEditor';
import TimelineChart from './TimelineChart';
import FavoritePicker from './FavoritePicker';
import MedicalDisclaimer from './MedicalDisclaimer';
import MobileTimePicker from './MobileTimePicker';
import { doseEntryLabel, useDoseEntryClock } from '../lib/dose-entry-status';
import './GuestSimulator.css';

function initial(){
  try{return {workspace:readGuestWorkspace(window.localStorage)??freshGuestWorkspace(),blocked:false,error:''};}
  catch{return {workspace:freshGuestWorkspace(),blocked:true,error:'The saved guest simulation could not be loaded. Clear simulation to start a new saved workspace.'};}
}
export default function GuestSimulator({onSignIn,onRegister,notice=''}:{onSignIn:()=>void;onRegister:()=>void;notice?:string}){
  const entryNow=useDoseEntryClock();
  const [loaded]=useState(initial),[workspace,setWorkspace]=useState<GuestWorkspace>(loaded.workspace);
  const [blocked,setBlocked]=useState(loaded.blocked),[storageError,setStorageError]=useState(loaded.error),[error,setError]=useState('');
  const [page,setPage]=useState<'simulation'|'settings'>('simulation'),[choosing,setChoosing]=useState(false);
  const [preferences,setPreferences]=useState(workspace.profile);
  const skipNextSave=useRef(false);
  const {profile,drafts,favorites,date,days}=workspace;
  const publishedOnly=true;
  useEffect(()=>{if(skipNextSave.current){skipNextSave.current=false;return;}if(blocked)return;try{saveGuestWorkspace(window.localStorage,workspace);setStorageError('');}catch{setStorageError('These changes are only in memory. Browser storage is unavailable or the simulation is too large.');}},[workspace,blocked]);
  useEffect(()=>setPreferences(profile),[profile]);
  function change(patch:Partial<GuestWorkspace>){
    try{guestDayWindow(patch.date??date,patch.days??days,(patch.profile??profile).timeZone);setWorkspace(current=>({...current,...patch}));setError('');}
    catch{setError('This date is unavailable in the selected time zone. Choose another date.');}
  }
  function addDose(favorite?:Favorite){
    if(!favorites.length){setChoosing(true);return;}
    if(drafts.length>=100){setError('This guest workspace supports up to 100 simulated doses.');return;}
    try{
      const row=favorite?updateDose(newDose(favorite.productId,favorite.packageStrength||favorite.strength),{quantity:favorite.quantity},profile.timeZone):{...newDose(),productId:'',productName:'',formulation:'',strength:'',packageStrength:'',strengthUnit:'',unit:'',amountMg:'',ingredients:[]};
      change({drafts:[...drafts,{...row,...currentDoseTime(profile.timeZone,profile.timeIncrementMinutes||5),timeZone:profile.timeZone,status:'simulated'}]});
    }catch{setError('This medication is unavailable in the current catalog. Choose another medication.');}
  }
  function editDose(previous:Dose,next:Dose){
    change({drafts:drafts.map(d=>d.id===previous.id?{...next,status:'simulated'}:d)});
  }
  function clear(){
    try{clearGuestWorkspace(window.localStorage);skipNextSave.current=true;setBlocked(false);setStorageError('');}
    catch{setStorageError('Browser storage could not be cleared. This page has been reset.');setBlocked(true);}
    setWorkspace(freshGuestWorkspace(profile.timeZone));setError('');
  }
  const range=guestDayWindow(date,days,profile.timeZone),scoped=scopeTimeline({actual:[],drafts,start:range.start,end:range.end,publishedOnly});
  return <div className="simple-shell guest-shell"><header className="app-header"><a href="#" className="brand" onClick={event=>{event.preventDefault();setPage('simulation');}}><Pill size={22}/><span>Drug Tracker</span></a><nav className="app-nav" aria-label="Main navigation"><button className={page==='simulation'?'active':''} aria-current={page==='simulation'?'page':undefined} onClick={()=>setPage('simulation')}>Dose Simulation</button><button onClick={onSignIn}>History</button><button className={page==='settings'?'active':''} aria-current={page==='settings'?'page':undefined} onClick={()=>setPage('settings')}>Settings</button></nav><div className="account-control"><button className="text-button" onClick={onSignIn}>Sign in</button><button className="button secondary small" onClick={onRegister}>Create account</button></div></header>
    <main><div className="page-title"><h1>{page==='simulation'?'Dose Simulation':'Simulation settings'}</h1></div><p className="guest-storage-note">Guest simulation · Stored unencrypted in this browser when available. Account records are separate.</p>
      {(notice||error||storageError)&&<p className="notice" role={error||storageError?'alert':'status'}>{error||storageError||notice}</p>}
      {page==='simulation'?<><div className="toolbar simulation-toolbar"><div className="date-nav"><button className="icon-button" aria-label="Previous day" disabled={date==='0001-01-01'} onClick={()=>change({date:addDays(date,-1)})}><ChevronLeft size={18}/></button><label className="selected-date"><CalendarDays size={16}/><input aria-label="Chart date" type="date" value={date} onChange={e=>{if(validGuestDate(e.target.value))change({date:e.target.value});else setError('Enter a valid chart date.');}}/></label><button className="icon-button" aria-label="Next day" disabled={date==='9998-12-31'} onClick={()=>change({date:addDays(date,1)})}><ChevronRight size={18}/></button><button className="text-button" onClick={()=>change({date:todayInZone(profile.timeZone)})}>Today</button></div><button className="button primary mobile-add-dose" onClick={()=>addDose()}><Plus size={16}/>Add dose</button><div className="segmented">{([1,2,3] as const).map(n=><button key={n} className={days===n?'selected':''} aria-pressed={days===n} onClick={()=>change({days:n})}>{n===1?'Day':`${n*24} hours`}</button>)}</div></div>
      <section className="card timeline-card"><TimelineChart doses={scoped.doses} date={date} days={days} profile={profile} publishedOnly={publishedOnly} baseline="empty" onProfile={()=>setPage('settings')} onMove={(id,iso)=>change({drafts:drafts.map(d=>d.id===id?{...d,...instantToLocal(iso,profile.timeZone),administeredAt:iso,timeZone:profile.timeZone,status:'simulated'}:d)})}/><p className="simulation-notice">Reference estimates, not measured drug levels or dose advice.</p></section>
      <section className="card dose-card"><div className="section-heading"><h2>Doses</h2><button className="text-button" onClick={()=>setChoosing(true)}>My medications</button></div>{drafts.map((dose,index)=><div className="planned-row" key={dose.id}><DoseEditor dose={dose} index={index} profile={profile} favorites={favorites.length?favorites:undefined} productIds={favorites.map(f=>f.productId)} onChange={next=>editDose(dose,next)} onRemove={()=>change({drafts:drafts.filter(d=>d.id!==dose.id)})} onDuplicate={()=>{if(drafts.length<100)change({drafts:[...drafts,{...dose,id:crypto.randomUUID(),status:'simulated'}]});else setError('This guest workspace supports up to 100 simulated doses.');}}/><div className="row-state"><span className="muted">{doseEntryLabel(dose.administeredAt,entryNow)}</span><button className="button add-record small" onClick={onSignIn}><Plus size={15}/>Add</button></div></div>)}{!drafts.length&&<div className="empty-state">{favorites.length?'Add a dose to explore its timeline.':'Choose My medications to start a simulation.'}</div>}<div className="dose-actions only-add"><button className="button secondary desktop-add-dose" onClick={()=>addDose()}><Plus size={16}/>Add dose</button></div></section>
      {scoped.sourceIds.length>0&&<details className="page-references"><summary>References</summary>{sources.filter(s=>scoped.sourceIds.includes(s.id)).map(s=><a key={s.id} href={s.url} target="_blank" rel="noreferrer">{s.title}<small>{s.section}</small></a>)}</details>}</>:<><section className="card settings-section"><div className="section-heading"><h2>My medications</h2><button className="button secondary small" onClick={()=>setChoosing(true)}>Choose medications</button></div><p className="muted">These choices are for this browser’s guest simulation.</p></section><form className="card settings-section guest-preferences" onSubmit={event=>{event.preventDefault();try{guestDayWindow(date,days,preferences.timeZone);sleepIntervals(Date.now(),Date.now()+86400000,preferences);change({profile:{...preferences,name:''}});}catch(cause){setError((cause as Error).message);}}}><h2>Time & sleep</h2><div className="settings-grid"><label className="field"><span>Time zone</span><input value={preferences.timeZone} onChange={e=>setPreferences(p=>({...p,timeZone:e.target.value}))} required maxLength={80}/></label><label className="field"><span>Time display</span><select value={preferences.timeFormat} onChange={e=>setPreferences(p=>({...p,timeFormat:e.target.value as '12h'|'24h'}))}><option value="12h">12-hour</option><option value="24h">24-hour</option></select></label><label className="field"><span>Minute increment</span><select value={preferences.timeIncrementMinutes||5} onChange={e=>setPreferences(p=>({...p,timeIncrementMinutes:Number(e.target.value) as 1|5|10}))}><option value="1">1 minute</option><option value="5">5 minutes</option><option value="10">10 minutes</option></select></label></div><label className="check-line"><input type="checkbox" checked={preferences.sleepEnabled} onChange={e=>setPreferences(p=>({...p,sleepEnabled:e.target.checked}))}/>Show a sleep window</label>{preferences.sleepEnabled&&<div className="settings-grid"><div className="field"><span>Bedtime</span><MobileTimePicker label="Bedtime" value={preferences.bedtime} minuteStep={preferences.timeIncrementMinutes||5} timeFormat={preferences.timeFormat} onChange={value=>setPreferences(p=>({...p,bedtime:value}))}/></div><div className="field"><span>Wake time</span><MobileTimePicker label="Wake time" value={preferences.wakeTime} minuteStep={preferences.timeIncrementMinutes||5} timeFormat={preferences.timeFormat} onChange={value=>setPreferences(p=>({...p,wakeTime:value}))}/></div></div>}<button className="button secondary" type="submit">Save simulation settings</button></form></>}
      <div className="guest-bottom"><button className="text-button" onClick={clear}>Clear simulation</button><span>To keep an actual medication log, <button className="text-button" onClick={onRegister}>create an account</button>.</span></div>
    </main><footer className="app-footer"><span>Open source · Built with OpenAI Codex (GPT-6)</span><a href="https://github.com/Treeezheng/drug-tracker" target="_blank" rel="noreferrer">GitHub</a><a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer">Privacy</a><MedicalDisclaimer/></footer>
    {choosing&&<FavoritePicker favorites={favorites} onSave={favorite=>setWorkspace(current=>({...current,favorites:upsertFavorite(current.favorites,favorite)}))} onRemove={favorite=>setWorkspace(current=>({...current,favorites:current.favorites.filter(f=>f.id!==favorite.id)}))} onClose={()=>setChoosing(false)}/>}
  </div>;
}
