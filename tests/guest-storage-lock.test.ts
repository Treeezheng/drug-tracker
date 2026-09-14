import test from 'node:test';
import assert from 'node:assert/strict';
import { withGuestStorageLock } from '../src/lib/guest-storage-lock.ts';
import { clearTransferredGuest } from '../src/lib/guest-transfer-storage.ts';
import { GUEST_STORAGE_KEY, freshGuestWorkspace, saveGuestWorkspace } from '../src/lib/guest-workspace.ts';
import { readGuestConsent, rememberGuestChoice, saveRememberedGuestWorkspace } from '../src/lib/guest-consent.ts';

const deferred=()=>{let resolve!:()=>void;return {promise:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};};
function storage(){
  const values=new Map<string,string>();
  return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
}
/** Native Web Locks scheduler contract, shared by the synthetic tab callers. */
async function navigatorWith<T>(locks:unknown,action:()=>Promise<T>):Promise<T>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{value:{locks},configurable:true});
  try{return await action();}finally{if(previous)Object.defineProperty(globalThis,'navigator',previous);else Reflect.deleteProperty(globalThis,'navigator');}
}
function scheduler(){
  const names:string[]=[],tails=new Map<string,Promise<unknown>>();
  return {names,request<T>(name:string,action:()=>T|Promise<T>){
    names.push(name);const next=(tails.get(name)??Promise.resolve()).then(action);
    tails.set(name,next.catch(()=>{}));return next;
  }};
}

test('a queued cleanup cannot delete another tab’s completed newer save',async()=>{
  const locks=scheduler();await navigatorWith(locks,async()=>{
    const s=storage(),initial=freshGuestWorkspace('UTC');rememberGuestChoice(s);saveGuestWorkspace(s,initial);
    const expected=s.getItem(GUEST_STORAGE_KEY),newer={...initial,days:3 as const};
    const entered=deferred(),release=deferred();let cleanupStarted=false;
    const writer=withGuestStorageLock(async()=>{entered.resolve();await release.promise;return saveRememberedGuestWorkspace(s,newer);});
    await entered.promise;
    const cleanup=withGuestStorageLock(()=>{cleanupStarted=true;return clearTransferredGuest(s,expected);});
    await Promise.resolve();assert.equal(cleanupStarted,false);
    release.resolve();assert.equal(await writer,true);assert.equal(await cleanup,'changed');
    assert.equal(JSON.parse(s.getItem(GUEST_STORAGE_KEY)!).days,3);assert.equal(readGuestConsent(s),true);
    assert.equal(new Set(locks.names).size,1);
  });
});

test('a queued save rechecks consent after cleanup and cannot resurrect the removed copy',async()=>{
  const locks=scheduler();await navigatorWith(locks,async()=>{
    const s=storage(),workspace=freshGuestWorkspace('UTC');rememberGuestChoice(s);saveGuestWorkspace(s,workspace);
    const expected=s.getItem(GUEST_STORAGE_KEY),entered=deferred(),release=deferred();let writeStarted=false;
    const cleanup=withGuestStorageLock(async()=>{entered.resolve();await release.promise;return clearTransferredGuest(s,expected);});
    await entered.promise;
    const writer=withGuestStorageLock(()=>{writeStarted=true;return saveRememberedGuestWorkspace(s,workspace);});
    await Promise.resolve();assert.equal(writeStarted,false);
    release.resolve();assert.equal(await cleanup,'cleared');assert.equal(await writer,false);
    assert.equal(s.getItem(GUEST_STORAGE_KEY),null);assert.equal(readGuestConsent(s),false);
  });
});

test('a failed locked operation releases the scheduler so an explicit retry can proceed',async()=>{
  const locks=scheduler();await navigatorWith(locks,async()=>{
    const result: string[]=[];
    const failed=withGuestStorageLock(()=>{result.push('attempt');throw new Error('Synthetic storage failure');});
    const retried=withGuestStorageLock(()=>{result.push('retry');return 'saved';});
    await assert.rejects(failed,/Synthetic storage failure/);assert.equal(await retried,'saved');
    assert.deepEqual(result,['attempt','retry']);
  });
});

test('without cooperative browser locking, storage mutations are rejected rather than run unprotected',async()=>{
  await navigatorWith(undefined,async()=>{
    let changed=false;
    await assert.rejects(withGuestStorageLock(()=>{changed=true;}),/Continue in memory/);
    assert.equal(changed,false);
  });
});
