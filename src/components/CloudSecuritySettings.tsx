import RecoveryKeyPanel from './RecoveryKeyPanel';
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import Modal from './Modal';

type Action='account'|'recovery'|'sessions';
const titles:Record<Action,string>={account:'Change password',recovery:'Replace recovery key',sessions:'Sign out all devices'};
export default function CloudSecuritySettings({ownerId}:{ownerId:string}){
  const [action,setAction]=useState<Action|null>(null),[recoveryKey,setRecoveryKey]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const inFlight=useRef(false);
  function close(){if(inFlight.current)return;setAction(null);setRecoveryKey('');setError('');setNotice('');}
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!action||inFlight.current)return;
    const form=event.currentTarget,fields=new FormData(form);
    const currentPassword=String(fields.get('current-password')??''),newPassword=String(fields.get('new-password')??''),confirmation=String(fields.get('confirm-password')??'');
    if(action==='account'&&newPassword!==confirmation){setError('The new passwords do not match.');return;}
    inFlight.current=true;setBusy(true);setError('');setNotice('');
    try{
      if(action==='sessions')await api('/auth/logout-all','POST',{password:currentPassword},ownerId);
      else if(action==='account'){await api('/auth/change-password','POST',{currentPassword,newPassword},ownerId);setNotice('Password changed. Your recovery key still works. Other sessions have been signed out.');}
      else {
        const result=await api<{recoveryKey:string}>('/vault/rotate-key','POST',{password:currentPassword},ownerId);
        setRecoveryKey(result.recoveryKey);
      }
      form.reset();
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not update security settings.');}
    finally{inFlight.current=false;setBusy(false);}
  }
  return <><details className="privacy-details security-settings"><summary>Security</summary><p className="muted">Records lock after 10 minutes of inactivity. Sign-in sessions expire after 24 hours. Unsaved entries are cleared when records lock.</p><div className="security-actions">{(Object.keys(titles) as Action[]).map(value=><button className="button secondary small" key={value} onClick={()=>{setNotice('');setAction(value);}}>{titles[value]}</button>)}</div></details>
    {action&&<Modal title={recoveryKey?'Save your new recovery key':titles[action]} onClose={close} closeDisabled={Boolean(recoveryKey)}>{recoveryKey?<RecoveryKeyPanel recoveryKey={recoveryKey} rotated onDone={close}/>:notice?<><p role="status">{notice}</p><button className="button primary" onClick={close}>Done</button></>:<form key={action} name={`security-${action}`} method="post" className="auth-form" onSubmit={submit}>
      {action==='recovery'&&<p className="muted">Re-encrypt all current records with a new key and replace the recovery key. Use this if a recovery key may have been exposed. Earlier copies cannot be revoked.</p>}
      {action==='sessions'&&<p className="muted">Signs out every device, including this one. This device locks immediately. Other open pages lock when they next check their session or reach the inactivity limit.</p>}
      <label className="field"><span>Current password</span><input id="security-current-password" name="current-password" type="password" autoComplete="current-password" required maxLength={512} disabled={busy}/></label>
      {action==='account'&&<><label className="field"><span>New password</span><input id="security-new-password" name="new-password" type="password" autoComplete="new-password" required minLength={15} maxLength={512} disabled={busy}/></label><p className="field-hint">Use a unique password from a password manager, or a long passphrase with unrelated words. Common and predictable passwords are rejected.</p><label className="field"><span>Confirm new password</span><input id="security-confirm-password" name="confirm-password" type="password" autoComplete="new-password" required maxLength={512} disabled={busy}/></label></>}
      {error&&<p className="inline-error" role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={busy}>{busy?'Updating…':action==='sessions'?'Sign out all devices':'Save change'}</button></div>
    </form>}</Modal>}
  </>;
}
