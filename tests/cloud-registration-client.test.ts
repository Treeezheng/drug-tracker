import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudClient, type CloudVaultSnapshot } from '../src/lib/cloud-client';
import { decryptVault, importRecoveryKey } from '../src/lib/vault-crypto';
import type { AppData } from '../src/lib/types';
import { ApiError } from '../src/lib/api';

function server(){
  let owner='previous-owner',vault:CloudVaultSnapshot|null=null,fail=false;
  let release:(()=>void)|null=null,started:(()=>void)|null=null;
  const calls:{path:string;body:any;headers:Headers}[]=[];
  const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  const fetcher=(async(url:RequestInfo|URL,init:RequestInit={})=>{
    const path=String(url).replace('/drug/api',''),body=init.body?JSON.parse(String(init.body)):undefined;
    calls.push({path,body,headers:new Headers(init.headers)});
    if(path==='/session')return reply({user:{id:owner,name:owner}});
    if(path==='/auth/register'){
      if(started){started();await new Promise<void>(r=>{release=r;});}
      if(fail)return reply({error:'Username is unavailable.'},409);
      owner='new-owner';vault=null;return reply({user:{id:owner,name:body.name||body.username}},201);
    }
    assert.equal(new Headers(init.headers).get('X-Dose-Owner'),owner);
    if(path==='/vault'&&init.method==='GET')return reply({vault});
    if(path==='/vault'&&init.method==='PUT'){vault={ownerId:owner,revision:1,createdAt:'2026-09-13T00:00:00Z',updatedAt:'2026-09-13T00:00:00Z',dataEnvelope:body.dataEnvelope,keyEnvelope:body.keyEnvelope};return reply({vault});}
    return reply({error:'Missing'},404);
  }) as typeof fetch;
  return {fetcher,calls,get vault(){return vault;},fail(){fail=true;},hold(){return new Promise<void>(r=>{started=r;});},release(){release?.();}};
}
const original:AppData={profile:null,doses:[],scenarios:[],favorites:[{id:'old-favorite',productId:'ritalin',strength:'10',quantity:'1'}],checkins:[],inventory:[]};

test('registration posts only authentication fields and begins an empty, independent encrypted account',async()=>{
  const remote=server(),client=createCloudClient({fetch:remote.fetcher});await client.session();await client.setupVault('old unique encryption password',original);
  const before=remote.calls.length;
  assert.deepEqual(await client.register('NewUser','account-passphrase','Visible name'),{id:'new-owner',name:'Visible name'});
  assert.deepEqual(remote.calls[before].body,{username:'NewUser',password:'account-passphrase',name:'Visible name'});
  assert.equal(remote.calls[before].headers.has('X-Dose-Owner'),false);
  assert.equal(client.getState().locked,true);assert.equal(client.getState().revision,0);
  await assert.rejects(client.request('/export'),/Unlock/);
  assert.deepEqual(await client.loadVault(),{exists:false,revision:0});
  const created=await client.setupVault('new independent encryption password');
  const empty={profile:null,doses:[],scenarios:[],favorites:[],checkins:[],inventory:[]};
  assert.deepEqual(created.data,empty);
  assert.deepEqual(await decryptVault(remote.vault!.dataEnvelope,await importRecoveryKey(created.recoveryKey),'new-owner'),empty);
  const writes=JSON.stringify(remote.calls.slice(before));
  for(const privateValue of ['old-favorite','ritalin','new independent encryption password',created.recoveryKey])assert.equal(writes.includes(privateValue),false);
});
test('default registration omits optional name and duplicate failure retains neither the previous key nor new user',async()=>{
  const remote=server(),client=createCloudClient({fetch:remote.fetcher});await client.session();await client.setupVault('old unique encryption password',original);remote.fail();
  await assert.rejects(client.register('unavailable','ten characters'),error=>error instanceof ApiError&&error.status===409&&error.message==='Username is unavailable.');
  assert.deepEqual(remote.calls.at(-1)!.body,{username:'unavailable',password:'ten characters'});
  assert.deepEqual(client.getState(),{user:null,locked:true,vaultExists:null,revision:0});
  await assert.rejects(client.request('/export'),/Sign in/);
});
test('closing registration while the server responds cannot restore an account or keys',async()=>{
  const remote=server(),client=createCloudClient({fetch:remote.fetcher}),started=remote.hold();
  const registering=client.register('new_user','account password');await started;client.lock();remote.release();
  await assert.rejects(registering,error=>error instanceof ApiError&&error.status===401);
  assert.equal(client.getState().user,null);assert.equal(client.getState().locked,true);
  assert.equal(remote.calls.length,1);assert.equal(remote.calls[0].path,'/auth/register');
});

function cookieServer(heldPath:string){
  let cookie='previous-owner',release!:()=>void,started!:()=>void;
  const began=new Promise<void>(r=>{started=r;}),gate=new Promise<void>(r=>{release=r;});
  const calls:string[]=[];
  const fetcher=(async(url:RequestInfo|URL,init:RequestInit={})=>{
    const path=String(url).replace('/drug/api',''),body=init.body?JSON.parse(String(init.body)):{};
    calls.push(path);
    if(path===heldPath&&calls.filter(item=>item===path).length===1){started();await gate;}
    if(path==='/auth/register'||path==='/auth/login')cookie=body.username;
    if(path==='/auth/logout'||path==='/auth/logout-all'||path==='/account')cookie='';
    const value=path==='/auth/logout'||path==='/auth/logout-all'||path==='/account'?{ok:true}:{user:cookie?{id:cookie,name:cookie}:null};
    return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  }) as typeof fetch;
  return {fetcher,calls,began,release:()=>release(),get cookie(){return cookie;}};
}
test('a canceled registration response settles before a newer login can set its session cookie',async()=>{
  const remote=cookieServer('/auth/register'),client=createCloudClient({fetch:remote.fetcher});
  const first=client.register('first-owner','account password');const rejected=assert.rejects(first,error=>error instanceof ApiError&&error.status===401);
  await remote.began;client.lock();const second=client.login('second-owner','another password');
  await Promise.resolve();assert.deepEqual(remote.calls,['/auth/register']);
  remote.release();await rejected;assert.equal((await second).id,'second-owner');assert.equal(remote.cookie,'second-owner');
  assert.deepEqual(remote.calls,['/auth/register','/auth/login']);
});
test('a delayed sign-out clears its cookie before a new account registration; canceled queued auth does not send',async()=>{
  const remote=cookieServer('/auth/logout'),client=createCloudClient({fetch:remote.fetcher});await client.session();
  const logout=client.logout(),old=assert.rejects(logout,error=>error instanceof ApiError&&error.status===401);
  await remote.began;
  const canceled=client.login('canceled-owner','password'),canceledResult=assert.rejects(canceled,error=>error instanceof ApiError&&error.status===401);
  const next=client.register('new-owner','new password');await Promise.resolve();
  assert.deepEqual(remote.calls,['/session','/auth/logout']);remote.release();await Promise.all([old,canceledResult,next]);
  assert.equal(remote.cookie,'new-owner');assert.deepEqual(remote.calls,['/session','/auth/logout','/auth/register']);
});
test('session discovery waits for an earlier pending registration response',async()=>{
  const remote=cookieServer('/auth/register'),client=createCloudClient({fetch:remote.fetcher});
  const registering=client.register('new-owner','account password');await remote.began;
  const session=client.session();await Promise.resolve();assert.deepEqual(remote.calls,['/auth/register']);
  remote.release();await registering;assert.equal((await session)?.id,'new-owner');assert.deepEqual(remote.calls,['/auth/register','/session']);
});

test('a delayed account deletion clears its old cookie before a new login and cannot clear the newer account',async()=>{
  const remote=cookieServer('/account'),client=createCloudClient({fetch:remote.fetcher});await client.session();
  const deleting=client.deleteAccount('account password'),canceled=assert.rejects(deleting,error=>error instanceof ApiError&&error.status===401);
  await remote.began;
  const login=client.login('different-owner','another password');await Promise.resolve();
  assert.deepEqual(remote.calls,['/session','/account']);
  remote.release();await canceled;await login;
  assert.equal(remote.cookie,'different-owner');assert.equal(client.getState().user?.id,'different-owner');
  assert.deepEqual(remote.calls,['/session','/account','/auth/login']);
});

test('all-session logout retains the cookie-changing queue after cancellation, so a late response cannot clear a newer login',async()=>{
  const remote=cookieServer('/auth/logout-all'),client=createCloudClient({fetch:remote.fetcher});await client.session();
  const logout=client.logoutAll('account password'),canceled=assert.rejects(logout,error=>error instanceof ApiError&&error.status===401);
  await remote.began;
  const login=client.login('different-owner','another password');await Promise.resolve();
  assert.deepEqual(remote.calls,['/session','/auth/logout-all']);
  remote.release();await canceled;await login;
  assert.equal(remote.cookie,'different-owner');assert.equal(client.getState().user?.id,'different-owner');
  assert.deepEqual(remote.calls,['/session','/auth/logout-all','/auth/login']);
});
