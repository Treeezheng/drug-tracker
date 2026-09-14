import { useEffect, useRef, useState } from 'react';
import { Pill, LockKeyhole } from 'lucide-react';
import App from '../App';
import { configureCloudTransport, type CloudTransport } from '../lib/api';
import { createCloudClient } from '../lib/cloud-client';

type Stage='loading'|'login'|'setup'|'unlock'|'recovery'|'open';

export default function CloudGate(){
  const [client]=useState(()=>createCloudClient({apiBase:`${import.meta.env.BASE_URL}api`}));
  const [stage,setStage]=useState<Stage>('loading');
  const [username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [secret,setSecret]=useState(''),[confirmation,setConfirmation]=useState('');
  const [useRecovery,setUseRecovery]=useState(false),[recoveryKey,setRecoveryKey]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const inFlight=useRef(false),lastLoginPassword=useRef('');
  const initialization=useRef<Promise<'login'|'setup'|'unlock'>|null>(null);

  function clearSecrets(){setPassword('');setSecret('');setConfirmation('');setRecoveryKey('');lastLoginPassword.current='';}
  function lockToLogin(message=''){
    client.lock();configureCloudTransport(null);clearSecrets();setError(message);setStage('login');
  }
  async function readSession(){
    const user=await client.session();
    if(!user)return 'login' as const;
    const vault=await client.loadVault();
    return vault.exists?'unlock' as const:'setup' as const;
  }
  useEffect(()=>{
    let live=true;
    initialization.current??=readSession();
    initialization.current.then(next=>{if(live)setStage(next);}).catch(()=>{if(live){setError('Could not connect. Try again.');setStage('login');}});
    return()=>{live=false;};
  },[client]);
  useEffect(()=>{
    const clear=()=>{client.lock();configureCloudTransport(null);clearSecrets();setStage('unlock');};
    const restore=(event:PageTransitionEvent)=>{if(event.persisted){clear();void perform(async()=>setStage(await readSession()));}};
    window.addEventListener('pagehide',clear);
    window.addEventListener('pageshow',restore);
    return()=>{window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restore);};
  },[client]);

  function openRecords(){
    const transport:CloudTransport={async request<T>(path:string,method?:string,body?:unknown,ownerId?:string):Promise<T>{
      if(path==='/vault/lock'&&method==='POST'){
        client.lock();configureCloudTransport(null);clearSecrets();setError('');setStage('unlock');return {ok:true} as T;
      }
      if(path==='/auth/logout'&&method==='POST'){
        const request=client.request<T>(path,method,body,ownerId);
        // The client clears its key synchronously; remove App's decrypted copy too.
        configureCloudTransport(null);clearSecrets();setStage('loading');
        try{const result=await request;lockToLogin();return result;}
        catch(cause){lockToLogin('This device is locked. The server session may still be active because sign out could not be confirmed.');throw cause;}
      }
      try{
        const result=await client.request<T>(path,method,body,ownerId);
        if(path==='/auth/logout')lockToLogin();
        if(path==='/session'&&!(result as {user:unknown}).user)lockToLogin('Your session expired. Sign in again.');
        return result;
      }catch(cause){
        if(cause&&typeof cause==='object'&&'status' in cause&&cause.status===401)lockToLogin('Your session expired. Sign in again.');
        throw cause;
      }
    }};
    configureCloudTransport(transport);clearSecrets();setError('');setStage('open');
  }
  async function perform(action:()=>Promise<void>){
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError('');
    try{await action();}catch(cause){setError(cause instanceof Error?cause.message:'Could not continue. Try again.');}
    finally{inFlight.current=false;setBusy(false);}
  }
  async function submit(event:React.FormEvent){
    event.preventDefault();
    await perform(async()=>{
      if(stage==='login'){
        await client.login(username,password);
        lastLoginPassword.current=password;setPassword('');
        const vault=await client.loadVault();setStage(vault.exists?'unlock':'setup');return;
      }
      if(stage==='setup'){
        if([...secret].length<12)throw new Error('Use an encryption password of at least 12 characters.');
        if(secret!==confirmation)throw new Error('The encryption passwords do not match.');
        if(secret===lastLoginPassword.current)throw new Error('Use a different password for encryption.');
        const created=await client.setupVault(secret);
        setRecoveryKey(created.recoveryKey);setSecret('');setConfirmation('');lastLoginPassword.current='';setStage('recovery');return;
      }
      if(stage==='unlock'){
        await client.unlockVault(useRecovery?{recoveryKey:secret}:{vaultPassphrase:secret});openRecords();
      }
    });
  }
  if(stage==='open')return <App/>;
  const title=stage==='setup'?'Set encryption password':stage==='unlock'?'Unlock records':stage==='recovery'?'Save recovery key':stage==='loading'?'Connecting…':'Sign in';
  return <main className="cloud-gate"><a className="brand" href={import.meta.env.BASE_URL}><Pill size={23}/><span>Drug Tracker</span></a><section className="card cloud-login" aria-busy={busy||stage==='loading'}><LockKeyhole size={22}/><h1>{title}</h1>
    {stage==='loading'?<p className="muted" role="status">Checking your session.</p>:stage==='recovery'?<>
      <p>This key unlocks your records if you forget the encryption password. Store it somewhere private.</p>
      <label className="field"><span>Recovery key</span><textarea className="cloud-recovery-key" readOnly value={recoveryKey} autoComplete="off" spellCheck={false}/></label>
      <p className="muted">Without the encryption password or this key, your records cannot be recovered.</p>
      <button className="button primary full" onClick={openRecords}>I’ve saved my key</button>
    </>:<form className="auth-form" onSubmit={submit}>
      {stage==='login'?<><p className="muted">Use the account on your server.</p><label className="field"><span>Username</span><input autoComplete="username" name="username" value={username} onChange={e=>setUsername(e.target.value)} required disabled={busy}/></label><label className="field"><span>Account password</span><input type="password" name="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required disabled={busy} maxLength={256}/></label></>:<>
        <p className="muted">{stage==='setup'?'Use a password different from your account password. It encrypts your records in this browser.':'Your encryption password stays in this browser.'}</p>
        <label className="field"><span>{useRecovery&&stage==='unlock'?'Recovery key':'Encryption password'}</span><input type={useRecovery&&stage==='unlock'?'text':'password'} name="vault-secret" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)} required disabled={busy} minLength={stage==='setup'?12:undefined} maxLength={1024} spellCheck={false}/></label>
        {stage==='setup'&&<label className="field"><span>Confirm encryption password</span><input type="password" autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required disabled={busy}/></label>}
      </>}
      {error&&<p className="inline-error" role="alert">{error}</p>}
      <button className="button primary full" disabled={busy}>{busy?'One moment…':stage==='login'?'Sign in':stage==='setup'?'Create encrypted records':'Unlock'}</button>
      {stage==='unlock'&&<button type="button" className="text-button" disabled={busy} onClick={()=>{setUseRecovery(v=>!v);setSecret('');setError('');}}>{useRecovery?'Use encryption password':'Use recovery key'}</button>}
    </form>}
    {stage!=='login'&&stage!=='loading'&&<button type="button" className="text-button" disabled={busy} onClick={()=>void perform(async()=>{try{await client.logout();lockToLogin();}catch{lockToLogin('This device is locked. The server session may still be active because sign out could not be confirmed.');}})}>Sign out</button>}
    {stage==='recovery'&&error&&<p className="inline-error" role="alert">{error}</p>}
  </section><p className="cloud-gate-note">Open source · Built with OpenAI Codex (GPT-6)<br/><a href="https://github.com/Treeezheng/drug-tracker" target="_blank" rel="noreferrer">GitHub</a> · <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer">Privacy</a></p></main>;
}
