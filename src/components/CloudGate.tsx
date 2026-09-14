import { useEffect, useRef, useState } from 'react';
import App from '../App';
import { configureCloudTransport, type CloudTransport } from '../lib/api';
import { createCloudClient } from '../lib/cloud-client';
import GuestSimulator from './GuestSimulator';
import Modal from './Modal';

type Stage='guest'|'loading'|'login'|'register'|'setup'|'unlock'|'recovery'|'open';

export default function CloudGate(){
  const [client]=useState(()=>createCloudClient({apiBase:`${import.meta.env.BASE_URL}api`}));
  const [stage,setStage]=useState<Stage>('guest');
  const [username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [secret,setSecret]=useState(''),[confirmation,setConfirmation]=useState('');
  const [useRecovery,setUseRecovery]=useState(false),[recoveryKey,setRecoveryKey]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [reauthenticateSetup,setReauthenticateSetup]=useState(false);
  const inFlight=useRef(false),lastLoginPassword=useRef(''),flow=useRef(0);

  function clearSecrets(){setPassword('');setSecret('');setConfirmation('');setRecoveryKey('');lastLoginPassword.current='';setUseRecovery(false);setReauthenticateSetup(false);}
  function resetFlow(next:Stage,message=''){
    flow.current++;client.lock();configureCloudTransport(null);clearSecrets();inFlight.current=false;setBusy(false);setError('');setNotice(message);setStage(next);
  }
  function browse(){resetFlow('guest');}
  async function readSession(){
    const user=await client.session();
    if(!user)return {stage:'login' as const,reauthenticateSetup:false};
    const vault=await client.loadVault();
    // A resumed cookie cannot establish that the new encryption password differs
    // from the account password. Authenticate again, then compare only in memory.
    return vault.exists?{stage:'unlock' as const,reauthenticateSetup:false}:{stage:'login' as const,reauthenticateSetup:true};
  }
  useEffect(()=>{
    // A page restored from the back/forward cache must not retain an unlocked vault.
    const clear=()=>resetFlow('guest');
    window.addEventListener('pagehide',clear);
    const restore=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
    window.addEventListener('pageshow',restore);
    return()=>{window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restore);client.lock();configureCloudTransport(null);};
  },[client]);

  function openRecords(){
    if(client.getState().locked)throw new Error('Unlock your encrypted records first.');
    const openedFlow=flow.current,openedOwner=client.getState().user!.id;
    const transport:CloudTransport={async request<T>(path:string,method?:string,body?:unknown,ownerId?:string):Promise<T>{
      if(openedFlow!==flow.current)throw new Error('This account workspace is closed.');
      if(path==='/vault/lock'&&method==='POST'){
        resetFlow('unlock');return {ok:true} as T;
      }
      if(path==='/auth/logout'&&method==='POST'){
        const request=client.request<T>(path,method,body,ownerId);
        // Logout clears the client key synchronously. Remove App's plaintext immediately,
        // without invalidating the in-flight sign-out request's generation.
        flow.current++;const closingFlow=flow.current;
        configureCloudTransport(null);clearSecrets();setError('');setStage('guest');
        try{return await request;}
        catch(cause){if(flow.current===closingFlow)setNotice('This device is locked. Server sign out could not be confirmed; its session may still be active.');throw cause;}
      }
      try{
        const result=await client.request<T>(path,method,body,ownerId);
        if(openedFlow===flow.current&&path==='/session'&&(result as {user:{id:string}|null}).user?.id!==openedOwner)resetFlow('guest','Your account session changed. Sign in again.');
        return result;
      }catch(cause){
        if(openedFlow===flow.current&&cause&&typeof cause==='object'&&'status' in cause&&cause.status===401)resetFlow('guest','Your session expired. Sign in again.');
        throw cause;
      }
    }};
    configureCloudTransport(transport);clearSecrets();setError('');setNotice('');setStage('open');
  }
  async function perform(action:(current:()=>boolean)=>Promise<void>,fallback?:Stage){
    if(inFlight.current)return;
    const token=flow.current,current=()=>token===flow.current;
    inFlight.current=true;setBusy(true);setError('');
    try{await action(current);}
    catch(cause){if(current()){setError(cause instanceof Error?cause.message:'Could not continue. Try again.');if(fallback)setStage(fallback);}}
    finally{if(current()){inFlight.current=false;setBusy(false);}}
  }
  function beginSignIn(){
    resetFlow('loading');
    void perform(async current=>{const next=await readSession();if(current()){setReauthenticateSetup(next.reauthenticateSetup);setStage(next.stage);}},'login');
  }
  function beginRegistration(){resetFlow('register');}
  async function submit(event:React.FormEvent){
    event.preventDefault();
    await perform(async current=>{
      if(stage==='login'||stage==='register'){
        if(stage==='register')await client.register(username,password);else await client.login(username,password);
        if(!current())return;
        lastLoginPassword.current=password;setPassword('');
        const vault=await client.loadVault();if(current())setStage(vault.exists?'unlock':'setup');return;
      }
      if(stage==='setup'){
        if(!lastLoginPassword.current){setSecret('');setConfirmation('');setReauthenticateSetup(true);setStage('login');throw new Error('Sign in again before setting your encryption password.');}
        if([...secret].length<12)throw new Error('Use an encryption password of at least 12 characters.');
        if(secret!==confirmation)throw new Error('The encryption passwords do not match.');
        if(secret===lastLoginPassword.current)throw new Error('Use a different password for encryption.');
        // Intentionally no initial data: guest drafts and account records never merge.
        const created=await client.setupVault(secret);
        if(!current())return;
        setRecoveryKey(created.recoveryKey);setSecret('');setConfirmation('');lastLoginPassword.current='';setStage('recovery');return;
      }
      if(stage==='unlock'){
        await client.unlockVault(useRecovery?{recoveryKey:secret}:{vaultPassphrase:secret});if(current())openRecords();
      }
    });
  }
  async function signOut(){
    if(inFlight.current)return;
    const request=client.logout();flow.current++;const token=flow.current;
    configureCloudTransport(null);clearSecrets();setError('');setStage('guest');
    try{await request;}catch{if(token===flow.current)setNotice('This device is locked. Server sign out could not be confirmed; its session may still be active.');}
  }
  if(stage==='open')return <App/>;
  const title=stage==='register'?'Create account':stage==='setup'?'Set encryption password':stage==='unlock'?'Unlock records':stage==='recovery'?'Save recovery key':stage==='loading'?'Connecting…':'Sign in';
  return <><GuestSimulator onSignIn={beginSignIn} onRegister={beginRegistration} notice={notice}/>{stage!=='guest'&&<Modal title={title} onClose={browse}><div className="cloud-auth-dialog" aria-busy={busy||stage==='loading'}>
    {['setup','unlock','recovery'].includes(stage)&&<p className="muted">Account · {client.getState().user?.name}</p>}
    {stage==='loading'?<p className="muted" role="status">Checking your session.</p>:stage==='recovery'?<>
      <p>This key unlocks your records if you forget the encryption password. Store it somewhere private.</p>
      <label className="field"><span>Recovery key</span><textarea className="cloud-recovery-key" readOnly value={recoveryKey} autoComplete="off" spellCheck={false}/></label>
      <p className="muted">Without the encryption password or this key, your records cannot be recovered.</p>
      <button className="button primary full" onClick={()=>{try{openRecords();}catch(cause){setError((cause as Error).message);}}}>I’ve saved my key</button>
    </>:<form className="auth-form" onSubmit={submit}>
      {stage==='login'||stage==='register'?<><p className="muted">{stage==='register'?'Account records are encrypted in this browser before upload. Your guest simulation stays separate.':reauthenticateSetup?'Sign in again before creating your encrypted records. The two passwords will be checked in this browser.':'Sign in to view or log your actual medication records.'}</p><label className="field"><span>Username</span><input autoFocus autoComplete="username" name="username" value={username} onChange={e=>setUsername(e.target.value)} required disabled={busy} minLength={stage==='register'?3:undefined} maxLength={64} pattern={stage==='register'?'[a-zA-Z0-9][a-zA-Z0-9._\\-]{2,63}':undefined} aria-describedby={stage==='register'?'cloud-username-hint':undefined} autoCapitalize="none" spellCheck={false}/></label>{stage==='register'&&<p className="field-hint" id="cloud-username-hint">3–64 letters, numbers, periods, underscores or hyphens.</p>}<label className="field"><span>Account password</span><input type="password" name="password" autoComplete={stage==='register'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} required disabled={busy} minLength={stage==='register'?10:undefined} maxLength={256}/></label>{stage==='register'&&<p className="field-hint">At least 10 characters. You’ll set a separate encryption password next.</p>}</>:<>
        <p className="muted">{stage==='setup'?'Use a password different from your account password. It encrypts your records in this browser. Guest simulations are not uploaded.':'Your encryption password stays in this browser.'}</p>
        <label className="field"><span>{useRecovery&&stage==='unlock'?'Recovery key':'Encryption password'}</span><input type={useRecovery&&stage==='unlock'?'text':'password'} name="vault-secret" autoComplete="off" autoFocus value={secret} onChange={e=>setSecret(e.target.value)} required disabled={busy} minLength={stage==='setup'?12:undefined} maxLength={1024} spellCheck={false}/></label>
        {stage==='setup'&&<label className="field"><span>Confirm encryption password</span><input type="password" autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required disabled={busy} maxLength={1024}/></label>}
      </>}
      {error&&<p className="inline-error" role="alert">{error}</p>}
      <button className="button primary full" disabled={busy}>{busy?'One moment…':stage==='register'?'Create account':stage==='login'?'Sign in':stage==='setup'?'Create encrypted records':'Unlock'}</button>
      {stage==='unlock'&&<button type="button" className="text-button" disabled={busy} onClick={()=>{setUseRecovery(v=>!v);setSecret('');setError('');}}>{useRecovery?'Use encryption password':'Use recovery key'}</button>}
      {(stage==='login'||stage==='register')&&<button type="button" className="text-button" disabled={busy} onClick={()=>{clearSecrets();setError('');setStage(stage==='login'?'register':'login');}}>{stage==='login'?'Create an account':'Already have an account? Sign in'}</button>}
    </form>}
    {stage==='recovery'&&error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="cloud-auth-actions"><button type="button" className="text-button" onClick={browse}>Browse simulator</button>{['setup','unlock','recovery'].includes(stage)&&<button type="button" className="text-button" disabled={busy} onClick={()=>void signOut()}>Sign out</button>}</div>
    <p className="cloud-gate-note">Open source · End-to-end encrypted account records<br/><a href="https://github.com/Treeezheng/drug-tracker" target="_blank" rel="noreferrer">View code on GitHub</a> · <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer">Privacy</a></p>
  </div></Modal>}</>;
}
