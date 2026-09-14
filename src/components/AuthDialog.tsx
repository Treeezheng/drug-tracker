import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Monitor, Copy, KeyRound } from 'lucide-react';
import Modal from './Modal';
import { api, ApiError } from '../lib/api';
import type { User } from '../lib/types';

type LocalState={hasAccount:boolean;requiresEmail:boolean};
type Mode='setup'|'unlock'|'recover';

export default function AuthDialog({onClose,onUser}:{onClose:()=>void;onUser:(u:User)=>Promise<void>}){
  const [localState,setLocalState]=useState<LocalState|null>(null),[mode,setMode]=useState<Mode>('unlock');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('');
  const [savedCode,setSavedCode]=useState(''),[user,setUser]=useState<User|null>(null),[copied,setCopied]=useState(false);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[openingAccount,setOpeningAccount]=useState(false);
  const inFlight=useRef(false),stateRequest=useRef(0),flow=useRef(0),opening=useRef(false);
  const requiresEmail=localState?.requiresEmail===true;
  function close(){
    // Once App is loading this account, it owns the transition. Do not present a
    // cancel action that cannot cancel the parent's already-running data load.
    if(opening.current)return;
    flow.current++;stateRequest.current++;setPassword('');setCode('');setSavedCode('');setUser(null);onClose();
  }
  async function loadLocalState(){
    const request=++stateRequest.current;
    setError('');setBusy(true);
    try{
      const state=await api<LocalState>('/auth/local-state');
      if(request!==stateRequest.current)return;
      if(typeof state.hasAccount!=='boolean'||typeof state.requiresEmail!=='boolean')throw new Error('The local server needs an update. Restart Drug Tracker, then try again.');
      setLocalState(state);setMode(state.hasAccount?'unlock':'setup');
    }catch(e){if(request===stateRequest.current)setError(e instanceof TypeError?'Could not reach this Mac’s server. Start Drug Tracker, then try again.':e instanceof Error?e.message:'Could not check local access. Please try again.');}
    finally{if(request===stateRequest.current)setBusy(false);}
  }
  useEffect(()=>{void loadLocalState();return()=>{stateRequest.current++;flow.current++;};},[]);
  async function perform(action:(current:()=>boolean)=>Promise<void>){
    if(inFlight.current)return;
    const token=flow.current,current=()=>token===flow.current;
    inFlight.current=true;setError('');setBusy(true);
    try{await action(current);}catch(e){if(current())setError(e instanceof Error?e.message:'The action could not be completed. Please try again.');}
    finally{if(current()){inFlight.current=false;setBusy(false);}}
  }
  async function openAccount(next:User,current:()=>boolean){
    if(!current())return;
    opening.current=true;setOpeningAccount(true);
    try{await onUser(next);if(current()){opening.current=false;close();}}
    finally{opening.current=false;if(current())setOpeningAccount(false);}
  }
  async function submit(e:React.FormEvent){
    e.preventDefault();
    if(!localState)return;
    await perform(async current=>{
      const path=mode==='setup'?'/auth/local-setup':requiresEmail?`/auth/${mode==='recover'?'recover':'login'}`:`/auth/local-${mode==='recover'?'recover':'unlock'}`;
      const body={password,...(requiresEmail?{email}:{}),...(mode==='recover'?{recoveryCode:code}:{})};
      let result:{user:User;recoveryCode?:string};
      try{result=await api(path,'POST',body);}
      catch(e){
        if(!current())return;
        if(!requiresEmail&&e instanceof ApiError&&[404,409].includes(e.status)){await loadLocalState();if(!current())return;setPassword('');setCode('');}
        throw e;
      }
      if(!current())return;
      if(result.recoveryCode){setUser(result.user);setSavedCode(result.recoveryCode);setCopied(false);setPassword('');setCode('');}
      else await openAccount(result.user,current);
    });
  }
  async function copyKey(){
    await perform(async current=>{
      setCopied(false);
      try{await navigator.clipboard.writeText(savedCode);if(current())setCopied(true);}
      catch{throw new Error('Could not copy the key. Select and copy it manually, or try again.');}
    });
  }
  async function finishRecovery(){
    await perform(async current=>{
      if(!user)throw new Error('Could not open your records. Keep this key and try unlocking again.');
      try{await openAccount(user,current);}
      catch{throw new Error('Could not load your records. Keep this key, check that Drug Tracker is running, then try again.');}
    });
  }
  function changeMode(next:Mode){setMode(next);setError('');setPassword('');setCode('');}
  const title=savedCode?'Keep your recovery key':!localState?'Unlock Drug Tracker':mode==='setup'?'Set a password':mode==='recover'?'Reset password':requiresEmail?'Sign in':'Unlock Drug Tracker';
  return <Modal title={title} onClose={close} closeDisabled={openingAccount}>
    {savedCode?<div className="recovery-panel" aria-busy={busy}>
      <KeyRound size={30}/><p>Save this key somewhere private. It lets you reset your password on this Mac; there is no email reset service.</p>
      <code>{savedCode}</code>{error&&<p className="inline-error" role="alert">{error}</p>}
      <button className="button secondary" disabled={busy} onClick={copyKey}><Copy size={16}/>{copied?'Copied':'Copy recovery key'}</button>
      <button className="button primary" disabled={busy} onClick={finishRecovery}>I’ve saved my key <ArrowRight size={16}/></button>
    </div>:!localState?<div aria-busy={busy}>
      {error?<><p className="inline-error" role="alert">{error}</p><button className="button secondary" disabled={busy} onClick={()=>void loadLocalState()}>Try again</button></>:<p className="modal-intro" role="status">Checking local access…</p>}
    </div>:<>
      <p className="modal-intro">{requiresEmail?'This Mac has several existing accounts. Use the email for yours.':mode==='setup'?'Choose a password for your records on this Mac.':mode==='recover'?'Use your recovery key to set a new password.':'Your records stay on this Mac.'}</p>
      <form onSubmit={submit} className="auth-form" aria-busy={busy}>
        {requiresEmail&&<label className="field"><span>Email address</span><input type="email" name="email" disabled={busy} required value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com"/></label>}
        {mode==='recover'&&<label className="field"><span>Recovery key</span><input name="recovery-key" disabled={busy} required value={code} onChange={e=>setCode(e.target.value)} autoComplete="off"/></label>}
        <label className="field"><span>{mode==='recover'?'New password':'Password'}</span><input type="password" name="password" disabled={busy} minLength={mode==='unlock'?undefined:10} maxLength={256} required value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==='unlock'?'current-password':'new-password'} placeholder={mode==='unlock'?'Enter your password':'At least 10 characters'}/></label>
        {error&&<p className="inline-error" role="alert">{error}</p>}
        <button className="button primary full" disabled={busy}>{busy?'One moment…':mode==='setup'?'Set password':mode==='recover'?'Reset password':requiresEmail?'Sign in':'Unlock'}<ArrowRight size={16}/></button>
      </form>
      {mode!=='setup'&&<div className="auth-links">{mode==='recover'?<button className="text-button" disabled={busy} onClick={()=>changeMode('unlock')}>{requiresEmail?'Back to sign in':'Back to unlock'}</button>:<button className="text-button" disabled={busy} onClick={()=>changeMode('recover')}>Use recovery key</button>}</div>}
      <div className="auth-note"><Monitor size={16}/><p>Back up your records in Settings.</p></div>
    </>}
  </Modal>;
}
