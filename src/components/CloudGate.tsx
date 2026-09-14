import RecoveryKeyPanel from './RecoveryKeyPanel';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
const App=lazy(()=>import('../App'));
import { configureCloudTransport, type CloudTransport } from '../lib/api';
import { createCloudClient } from '../lib/cloud-client';
import GuestSimulator from './GuestSimulator';
import Modal from './Modal';
import { startIdleLock } from '../lib/idle-lock';
import { GUEST_STORAGE_KEY, parseGuestWorkspace, type GuestWorkspace } from '../lib/guest-workspace';
import { clearTransferredGuest } from '../lib/guest-transfer-storage';
import { withGuestStorageLock } from '../lib/guest-storage-lock';
import { prepareGuestTransfer, type GuestTransfer } from '../lib/guest-transfer';

type Stage='guest'|'login'|'register'|'unlock'|'recover'|'recovery'|'guest-sync'|'open';

export default function CloudGate(){
  const [client]=useState(()=>createCloudClient({apiBase:`${import.meta.env.BASE_URL}api`}));
  const [stage,setStage]=useState<Stage>('guest');
  const [username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [secret,setSecret]=useState(''),[confirmation,setConfirmation]=useState('');
  const [recoveryKey,setRecoveryKey]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [acceptedTerms,setAcceptedTerms]=useState(false);
  const inFlight=useRef(false),flow=useRef(0);
  const guest=useRef<GuestWorkspace|null>(null),transfer=useRef<{workspace:GuestWorkspace;input:GuestTransfer|null;saved:string|null|undefined;uploaded:boolean}|null>(null);
  // Guest retry material contains no account key or decrypted account records.
  const preparedTransfer=useRef<{ownerId:string;snapshot:string;input:GuestTransfer}|null>(null);
  const [transferUploaded,setTransferUploaded]=useState(false);
  const guestConsent=useRef(false);
  const rememberConsent=useCallback((consented:boolean)=>{guestConsent.current=consented;},[]);
  const rememberWorkspace=useCallback((workspace:GuestWorkspace)=>{guest.current=workspace;},[]);

  function clearSecrets(){setPassword('');setSecret('');setConfirmation('');setRecoveryKey('');setAcceptedTerms(false);}
  function resetFlow(next:Stage,message=''){
    flow.current++;client.lock();configureCloudTransport(null);clearSecrets();transfer.current=null;setTransferUploaded(false);inFlight.current=false;setBusy(false);setError('');setNotice(message);setStage(next);
  }
  function browse(){resetFlow('guest');}
  useEffect(()=>{
    // A page restored from the back/forward cache must not retain an unlocked vault.
    const clear=()=>resetFlow('guest');
    window.addEventListener('pagehide',clear);
    const restore=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
    window.addEventListener('pageshow',restore);
    return()=>{window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restore);client.lock();configureCloudTransport(null);};
  },[client]);
  useEffect(()=>{
    if(stage!=='open'&&stage!=='recovery'&&stage!=='guest-sync')return;
    return startIdleLock({onLock:()=>resetFlow('unlock','Locked after 10 minutes of inactivity. Unsaved entries were cleared.')});
  },[stage,client]);
  useEffect(()=>{
    if(stage!=='open')return;
    const token=flow.current,owner=client.getState().user?.id;let checking=false;
    async function checkSession(){if(checking)return;checking=true;try{const user=await client.session();if(token===flow.current&&user?.id!==owner)resetFlow('guest','Your sign-in session ended. Sign in again.');}catch{ /* Offline pages retain only the bounded in-memory session; idle locking still applies. */ }finally{checking=false;}}
    const timer=window.setInterval(()=>void checkSession(),60_000);
    const focus=()=>void checkSession();window.addEventListener('focus',focus);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',focus);};
  },[stage,client]);

  function openRecords(){
    if(client.getState().locked)throw new Error('Unlock your encrypted records first.');
    const openedFlow=flow.current,openedOwner=client.getState().user!.id;
    const transport:CloudTransport={async request<T>(path:string,method?:string,body?:unknown,ownerId?:string):Promise<T>{
      if(openedFlow!==flow.current)throw new Error('This account workspace is closed.');
      if(path==='/vault/lock'&&method==='POST'){
        resetFlow('unlock');return {ok:true} as T;
      }
      if((path==='/auth/logout'||path==='/auth/logout-all')&&method==='POST'){
        const request=client.request<T>(path,method,body,ownerId);
        // Logout clears the client key synchronously. Remove App's plaintext immediately,
        // without invalidating the in-flight sign-out request's generation.
        flow.current++;const closingFlow=flow.current;
        configureCloudTransport(null);clearSecrets();setError('');setStage('guest');
        try{return await request;}
        catch(cause){if(flow.current===closingFlow)setNotice('This device is locked. Server sign out could not be confirmed. Sign in again and retry if you need to revoke server sessions.');throw cause;}
      }
      try{
        const result=await client.request<T>(path,method,body,ownerId);
        if(openedFlow===flow.current&&path==='/account'&&method==='DELETE')resetFlow('guest','Your account and records have been deleted from the active server database.');
        if(openedFlow===flow.current&&path==='/session'&&(result as {user:{id:string}|null}).user?.id!==openedOwner)resetFlow('guest','Your account session changed. Sign in again.');
        return result;
      }catch(cause){
        if(openedFlow===flow.current&&cause&&typeof cause==='object'&&'status' in cause&&cause.status===401)resetFlow('guest','Your session expired. Sign in again.');
        throw cause;
      }
    }};
    configureCloudTransport(transport);clearSecrets();setError('');setNotice('');setStage('open');
  }
  function finishSignIn(){
    const currentGuest=guest.current;
    if(currentGuest&&(currentGuest.drafts.length||currentGuest.favorites.length)){
      let saved:string|null|undefined;
      try{
        const value=window.localStorage.getItem(GUEST_STORAGE_KEY);
        // An unread or separately edited saved workspace is not part of this choice.
        if(value===null||JSON.stringify(parseGuestWorkspace(value))===JSON.stringify(parseGuestWorkspace(JSON.stringify(currentGuest))))saved=value;
      }catch{/* Sync memory data, but do not promise deletion of inaccessible storage. */}
      transfer.current={workspace:structuredClone(currentGuest),input:null,saved,uploaded:false};
      clearSecrets();setTransferUploaded(false);setStage('guest-sync');return;
    }
    openRecords();
  }
  async function syncGuest(){
    await perform(async current=>{
      const attempt=transfer.current;if(!attempt)throw new Error('Reopen sign in to choose a guest simulation.');
      if(!attempt.uploaded){
        const ownerId=client.getState().user!.id,snapshot=JSON.stringify(attempt.workspace);
        if(!attempt.input){
          const cached=preparedTransfer.current;
          attempt.input=cached?.ownerId===ownerId&&cached.snapshot===snapshot?cached.input:prepareGuestTransfer(attempt.workspace);
          preparedTransfer.current={ownerId,snapshot,input:attempt.input};
        }
        try{await client.request('/guest-import','POST',attempt.input,ownerId);}
        catch(cause){
          if(current()&&cause&&typeof cause==='object'&&'status' in cause&&cause.status===401)resetFlow('unlock','Your session expired. Sign in again to retry syncing; your guest copy was kept.');
          throw cause;
        }
        if(!current())return;
        attempt.uploaded=true;setTransferUploaded(true);
      }
      if(attempt.saved===undefined)throw new Error('Encrypted sync succeeded. The saved local copy is different or unavailable, so it was kept. You can clear it in browser settings.');
      if(await withGuestStorageLock(()=>{if(!current())throw new Error('This sync is closed.');return clearTransferredGuest(window.localStorage,attempt.saved!);})==='changed')throw new Error('Encrypted sync succeeded. Another tab changed the local copy, so that newer copy was kept.');
      if(!current())return;
      guest.current=null;guestConsent.current=false;transfer.current=null;preparedTransfer.current=null;openRecords();
    });
  }
  async function perform(action:(current:()=>boolean)=>Promise<void>,fallback?:Stage){
    if(inFlight.current)return;
    const token=flow.current,current=()=>token===flow.current;
    inFlight.current=true;setBusy(true);setError('');
    try{await action(current);}
    catch(cause){if(current()){setError(cause instanceof Error?cause.message:'Could not continue. Try again.');if(fallback)setStage(fallback);}}
    finally{if(current()){inFlight.current=false;setBusy(false);}}
  }
  function beginSignIn(){resetFlow('login');}
  function beginRegistration(){resetFlow('register');}
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    // Read the live form: password managers may autofill without React input events.
    const fields=new FormData(event.currentTarget);
    const submittedUsername=String(fields.get('username')??username);
    const submittedPassword=String(fields.get('password')??password);
    const submittedSecret=String(fields.get('recovery-code')??secret);
    const confirmedPassword=String(fields.get('confirm-password')??confirmation);
    await perform(async current=>{
      if(stage==='login'||stage==='register'){
        if(stage==='register'&&!acceptedTerms)throw new Error('Review the terms and privacy policy before creating an account.');
        if(stage==='register'){
          const result=await client.registerSecure(submittedUsername,submittedPassword);
          if(current()){setUsername(submittedUsername);setRecoveryKey(result.recoveryKey);setPassword('');setStage('recovery');}return;
        }
        await client.loginSecure(submittedUsername,submittedPassword);if(current()){setUsername(submittedUsername);finishSignIn();}return;
      }
      if(stage==='recover'){
        if(submittedPassword!==confirmedPassword)throw new Error('The passwords do not match.');
        const created=await client.recoverSecure(submittedUsername,submittedSecret,submittedPassword);
        if(!current())return;
        setUsername(submittedUsername||username);setRecoveryKey(created.recoveryKey);setPassword('');setSecret('');setConfirmation('');setStage('recovery');return;
      }
      if(stage==='unlock'){await client.loginSecure(submittedUsername,submittedPassword);if(current())finishSignIn();}

    });
  }
  async function signOut(){
    if(inFlight.current)return;
    const request=client.logout();flow.current++;const token=flow.current;
    configureCloudTransport(null);clearSecrets();setError('');setStage('guest');
    try{await request;}catch{if(token===flow.current)setNotice('This device is locked. Server sign out could not be confirmed; its session may still be active.');}
  }
  if(stage==='open')return <Suspense fallback={<p className="app-loading" role="status">Opening your records…</p>}><App/></Suspense>;
  const title=stage==='register'?'Create account':stage==='recover'?'Recover your account':stage==='unlock'?'Unlock records':stage==='recovery'?'Save recovery key':stage==='guest-sync'?'Sync guest simulation?':'Sign in';
  const newPassword=['register','recover'].includes(stage);
  const accountName=username||client.getState().user?.username||'';
  function switchStage(next:Stage){clearSecrets();setError('');setNotice('');setStage(next);}
  return <><GuestSimulator onSignIn={beginSignIn} onRegister={beginRegistration} onWorkspace={rememberWorkspace} initialWorkspace={guest.current??undefined} initialConsent={guestConsent.current} onConsent={rememberConsent} notice={notice}/>{stage!=='guest'&&<Modal title={title} onClose={browse} closeDisabled={stage==='recovery'||(stage==='guest-sync'&&busy)}><div className="cloud-auth-dialog" aria-busy={busy}>
    {['unlock','recovery'].includes(stage)&&<p className="muted">Account · {client.getState().user?.name||accountName}</p>}
    {notice&&<p className="notice" role="status">{notice}</p>}
    {stage==='guest-sync'?<div className="guest-transfer-choice"><p>Move this guest simulation into your encrypted account?</p><p className="muted">{transfer.current?.workspace.drafts.length||0} simulated doses · {transfer.current?.workspace.favorites.length||0} saved medications</p><p>Records stay marked as simulated. After encrypted sync is confirmed, this device’s saved guest copy is removed. If sync fails, it is kept for retry.</p>{error&&<p className="inline-error" role="alert">{error}</p>}<div className="modal-footer"><button className="button secondary" disabled={busy} onClick={()=>{transfer.current=null;openRecords();}}>{transferUploaded?'Continue; keep local copy':'Keep separate'}</button><button className="button primary" disabled={busy} onClick={()=>void syncGuest()}>{busy?'Syncing…':transferUploaded?'Retry local cleanup':'Sync and remove local copy'}</button></div></div>:stage==='recovery'?<RecoveryKeyPanel recoveryKey={recoveryKey} onDone={()=>{try{finishSignIn();}catch(cause){setError((cause as Error).message);}}}/>:<form key={stage} id={`cloud-${stage}-form`} name={`cloud-${stage}`} method="post" className="auth-form" onSubmit={submit}>
      <p className="muted">{stage==='register'?'One password signs you in and unlocks your encrypted records. You will receive a recovery key to save. After sign-in, you can choose whether to sync your guest simulation and remove its local copy.':stage==='recover'?'Use your saved recovery key and choose a new password. Your recovery key will also be replaced.':'Your password unlocks your records in this browser. It is not sent to the server.'}</p>
      {['login','register','recover'].includes(stage)?<><label className="field"><span>Username</span><input id="cloud-account-username" type="text" autoFocus autoComplete="username" name="username" defaultValue={username} onChange={e=>setUsername(e.target.value)} required disabled={busy} minLength={stage==='register'?3:undefined} maxLength={64} pattern={stage==='register'?'[a-zA-Z0-9][a-zA-Z0-9._\\-]{2,63}':undefined} aria-describedby={stage==='register'?'cloud-username-hint':undefined} autoCapitalize="none" spellCheck={false}/></label>{stage==='register'&&<p className="field-hint" id="cloud-username-hint">3–64 letters, numbers, periods, underscores or hyphens.</p>}</>:<input type="hidden" name="username" autoComplete="username" value={accountName}/>}
      {stage==='recover'&&<label className="field"><span>Recovery key</span><input id="cloud-recovery-code" name="recovery-code" type="text" autoComplete="off" defaultValue={secret} onChange={e=>setSecret(e.target.value)} required disabled={busy} maxLength={1024} spellCheck={false} autoCapitalize="none"/></label>}
      <label className="field"><span>{stage==='recover'?'New password':'Password'}</span><input id={newPassword?'cloud-new-password':'cloud-current-password'} type="password" name="password" autoComplete={newPassword?'new-password':'current-password'} defaultValue={password} onChange={e=>setPassword(e.target.value)} autoFocus={stage==='unlock'} required disabled={busy} minLength={newPassword?15:undefined} maxLength={512}/></label>{newPassword&&<p className="field-hint">Use a unique password of at least 15 characters. A password manager can generate and save it. Common or predictable passwords are rejected.</p>}
      {stage==='recover'&&<label className="field"><span>Confirm new password</span><input id="cloud-confirm-password" name="confirm-password" type="password" autoComplete="new-password" defaultValue={confirmation} onChange={e=>setConfirmation(e.target.value)} required disabled={busy} maxLength={512}/></label>}
      {error&&<p className="inline-error" role="alert">{error}</p>}
      {stage==='register'&&<label className="legal-acceptance"><input type="checkbox" required checked={acceptedTerms} onChange={event=>setAcceptedTerms(event.target.checked)} disabled={busy}/><span>I am 18 or older, agree to the <a href={`${import.meta.env.BASE_URL}terms.html`} target="_blank" rel="noreferrer">Terms of Use</a>, and acknowledge the <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer">Privacy Policy</a>.</span></label>}
      <button className="button primary full" disabled={busy||(stage==='register'&&!acceptedTerms)}>{busy?'One moment…':stage==='register'?'Create account':stage==='recover'?'Recover account':stage==='unlock'?'Unlock':'Sign in'}</button>
      {(stage==='login'||stage==='unlock')&&<button type="button" className="text-button" disabled={busy} onClick={()=>switchStage('recover')}>Use recovery key</button>}
      {(stage==='login'||stage==='register'||stage==='recover')&&<button type="button" className="text-button" disabled={busy} onClick={()=>switchStage(stage==='login'?'register':'login')}>{stage==='login'?'Create an account':'Back to sign in'}</button>}
    </form>}
    {stage==='recovery'&&error&&<p className="inline-error" role="alert">{error}</p>}
    {stage!=='recovery'&&stage!=='guest-sync'&&<div className="cloud-auth-actions"><button type="button" className="text-button" onClick={browse}>Browse simulator</button>{client.getState().user&&<button type="button" className="text-button" disabled={busy} onClick={()=>void signOut()}>Sign out</button>}</div>}
    <p className="cloud-gate-note">Account records are encrypted in your browser. This protection depends on the code delivered by this website; a compromised website or device can expose passwords and unlocked records.<br/><a href="https://github.com/Treeezheng/drug-tracker" target="_blank" rel="noreferrer">View code on GitHub</a> · <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer">Privacy & encryption limits</a> · <a href={`${import.meta.env.BASE_URL}terms.html`} target="_blank" rel="noreferrer">Terms</a></p>
  </div></Modal>}</>;
}
