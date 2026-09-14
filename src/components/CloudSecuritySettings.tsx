import RecoveryKeyPanel from './RecoveryKeyPanel';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import Modal from './Modal';
import SettingHelp from './SettingHelp';
import type { AutoUnlockPreference } from '../lib/device-unlock';

type Action='account'|'recovery'|'sessions'|'device';
const titles:Record<Action,string>={account:'Change password',recovery:'Replace recovery key',sessions:'Sign out all devices',device:'Automatically unlock this device'};
export default function CloudSecuritySettings({ownerId}:{ownerId:string}){
  const [action,setAction]=useState<Action|null>(null),[recoveryKey,setRecoveryKey]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const inFlight=useRef(false);
  const [preference,setPreference]=useState<AutoUnlockPreference>({enabled:false,expiresAt:null}),[loadingPreference,setLoadingPreference]=useState(true);
  useEffect(()=>{let active=true;setLoadingPreference(true);void api<AutoUnlockPreference>('/device-unlock','GET',undefined,ownerId).then(value=>{if(active)setPreference(value);}).catch(()=>{if(active)setError('Could not read this device’s automatic unlock setting.');}).finally(()=>{if(active)setLoadingPreference(false);});return()=>{active=false;};},[ownerId]);
  async function disableAutoUnlock(){
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{setPreference(await api<AutoUnlockPreference>('/device-unlock','POST',{enabled:false},ownerId));setNotice('Automatic unlocking is off. Your currently open records stay visible.');}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not disable automatic unlocking.');}
    finally{inFlight.current=false;setBusy(false);}
  }
  function close(){if(inFlight.current)return;setAction(null);setRecoveryKey('');setError('');setNotice('');}
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!action||inFlight.current)return;
    const form=event.currentTarget,fields=new FormData(form);
    const currentPassword=String(fields.get('current-password')??''),newPassword=String(fields.get('new-password')??''),confirmation=String(fields.get('confirm-password')??'');
    if(action==='account'&&newPassword!==confirmation){setError('The new passwords do not match.');return;}
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      if(action==='device'){setPreference(await api<AutoUnlockPreference>('/device-unlock','POST',{enabled:true,password:currentPassword},ownerId));setNotice('Automatic unlocking is enabled on this device for up to 7 days.');}
      else if(action==='sessions')await api('/auth/logout-all','POST',{password:currentPassword},ownerId);
      else if(action==='account'){await api('/auth/change-password','POST',{currentPassword,newPassword},ownerId);setNotice('Password changed. Your recovery key still works. Other sessions have been signed out.');}
      else {
        const result=await api<{recoveryKey:string}>('/vault/rotate-key','POST',{password:currentPassword},ownerId);
        setRecoveryKey(result.recoveryKey);
      }
      if(action==='account'||action==='recovery')setPreference(await api<AutoUnlockPreference>('/device-unlock','GET',undefined,ownerId));
      form.reset();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not update security settings.');}
    finally{inFlight.current=false;setBusy(false);}
  }
  return <><details className="privacy-details security-settings"><summary>Security</summary><p className="muted">Sign-in and unlocking last up to 7 days. Hide or sign out to require your password sooner.</p><div className="setting-with-help"><label className="check-line"><input type="checkbox" checked={preference.enabled} disabled={loadingPreference||busy} onChange={event=>{setError('');setNotice('');if(event.target.checked)setAction('device');else void disableAutoUnlock();}}/>Auto-unlock on this device</label><SettingHelp label="automatic unlocking">Keeps an encrypted unlocking key only in this browser for up to 7 days. Anyone who can use this browser can open your records during that time. Visiting again does not extend the deadline. Hide, sign out, or turn this off to remove the saved unlocking key.</SettingHelp></div>{preference.enabled&&preference.expiresAt&&<p className="field-hint">Until {new Date(preference.expiresAt).toLocaleString()}. Your password is not stored.</p>}{!action&&error&&<p className="inline-error" role="alert">{error}</p>}{!action&&notice&&<p className="field-hint" role="status">{notice}</p>}<div className="security-actions">{(['account','recovery','sessions'] as Action[]).map(value=><button className="button secondary small" key={value} onClick={()=>{setNotice('');setError('');setAction(value);}}>{titles[value]}</button>)}</div></details>
    {action&&<Modal title={recoveryKey?'Save your new recovery key':titles[action]} onClose={close} closeDisabled={Boolean(recoveryKey)}>{recoveryKey?<RecoveryKeyPanel recoveryKey={recoveryKey} rotated onDone={close}/>:notice?<><p role="status">{notice}</p><button className="button primary" onClick={close}>Done</button></>:<form key={action} name={`security-${action}`} method="post" className="auth-form" onSubmit={submit}>
      {action==='device'&&<p className="muted">Confirm your password to allow automatic unlocking in this browser for up to 7 days. Turn this off on shared devices.</p>}
      {action==='recovery'&&<p className="muted">Re-encrypt all current records with a new key and replace the recovery key. Use this if a recovery key may have been exposed. Earlier copies cannot be revoked.</p>}
      {action==='sessions'&&<p className="muted">Signs out every device, including this one. This device locks immediately. Other open pages lock when they next check their session or reach the inactivity limit.</p>}
      <label className="field"><span>Current password</span><input id="security-current-password" name="current-password" type="password" autoComplete="current-password" required maxLength={512} disabled={busy}/></label>
      {action==='account'&&<><label className="field"><span>New password</span><input id="security-new-password" name="new-password" type="password" autoComplete="new-password" required minLength={15} maxLength={512} disabled={busy}/></label><p className="field-hint">Use a unique password from a password manager, or a long passphrase with unrelated words. Common and predictable passwords are rejected.</p><label className="field"><span>Confirm new password</span><input id="security-confirm-password" name="confirm-password" type="password" autoComplete="new-password" required maxLength={512} disabled={busy}/></label></>}
      {error&&<p className="inline-error" role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={busy}>{busy?'Updating…':action==='sessions'?'Sign out all devices':'Save change'}</button></div>
    </form>}</Modal>}
  </>;
}
