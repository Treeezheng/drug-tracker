import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreGuestSession, sameGuestWorkspace } from '../src/lib/guest-session.ts';
import { freshGuestWorkspace, GUEST_STORAGE_KEY, saveGuestWorkspace } from '../src/lib/guest-workspace.ts';
import { rememberGuestChoice, GUEST_CONSENT_KEY } from '../src/lib/guest-consent.ts';
function storage(){const values=new Map<string,string>(),reads:string[]=[];return{values,reads,getItem:(key:string)=>{reads.push(key);return values.get(key)??null;},setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}

test('returning from an account restores parent-held memory and age acknowledgment without consenting to device storage',()=>{
  const s=storage(),memory=freshGuestWorkspace('UTC');memory.profile.timeIncrementMinutes=1;
  const loaded=restoreGuestSession(s,memory,true);
  assert.equal(loaded.workspace.profile.timeIncrementMinutes,1);assert.equal(loaded.consented,true);assert.equal(loaded.remembered,false);assert.equal(s.values.size,0);
  loaded.workspace.profile.timeIncrementMinutes=10;assert.equal(memory.profile.timeIncrementMinutes,1,'The restored workspace is a separate validated snapshot.');
});

test('a newer device workspace is never overwritten or selected by an older parent-held snapshot',()=>{
  const s=storage(),old=freshGuestWorkspace('UTC'),newer=structuredClone(old);newer.profile.timeIncrementMinutes=10;
  saveGuestWorkspace(s,newer);rememberGuestChoice(s);const before=s.values.get(GUEST_STORAGE_KEY);
  const restored=restoreGuestSession(s,old,true);
  assert.equal(restored.workspace.profile.timeIncrementMinutes,5);assert.equal(restored.remembered,false);assert.match(restored.error,/device copy is unchanged/);assert.equal(s.values.get(GUEST_STORAGE_KEY),before);
  const matching=restoreGuestSession(s,newer,true);assert.equal(matching.remembered,true);assert.equal(matching.error,'');
});

test('without current storage consent even an existing device workspace is not read; key order alone is not a conflict',()=>{
  const s=storage(),workspace=freshGuestWorkspace('UTC');saveGuestWorkspace(s,workspace);s.reads.length=0;
  const restored=restoreGuestSession(s,workspace,true);assert.equal(restored.remembered,false);assert.deepEqual(s.reads,[GUEST_CONSENT_KEY]);
  assert.equal(sameGuestWorkspace(workspace,{...workspace,profile:Object.fromEntries(Object.entries(workspace.profile).reverse())} as typeof workspace),true);
  assert.throws(()=>restoreGuestSession(s,{...workspace,profile:{...workspace.profile,timeIncrementMinutes:2}} as never,true),/time increment/);
});
