import test from 'node:test';
import assert from 'node:assert/strict';
import { GUEST_CONSENT_KEY, forgetGuestChoice, readGuestConsent, rememberGuestChoice, saveRememberedGuestWorkspace } from '../src/lib/guest-consent';
import { GUEST_STORAGE_KEY, freshGuestWorkspace, saveGuestWorkspace } from '../src/lib/guest-workspace';

function storage(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
test('fresh and legacy guest storage requires explicit consent; other values cannot grant it',()=>{
  const s=storage();assert.equal(readGuestConsent(s),false);
  saveGuestWorkspace(s,freshGuestWorkspace('UTC'));assert.equal(readGuestConsent(s),false);
  for(const value of ['true','1','adult:plaintext-device-storage:v2']){s.setItem(GUEST_CONSENT_KEY,value);assert.equal(readGuestConsent(s),false);}
  assert.deepEqual(rememberGuestChoice(s),freshGuestWorkspace('UTC'));assert.equal(readGuestConsent(s),true);
  forgetGuestChoice(s);assert.equal(readGuestConsent(s),false);assert.ok(s.getItem(GUEST_STORAGE_KEY));
});
test('unreadable saved simulation is neither overwritten nor silently opted into storage',()=>{
  const s=storage();s.setItem(GUEST_STORAGE_KEY,'malformed');assert.throws(()=>rememberGuestChoice(s));
  assert.equal(s.getItem(GUEST_STORAGE_KEY),'malformed');assert.equal(readGuestConsent(s),false);
});
test('an already-open tab cannot save its old workspace after another tab clears consent',()=>{
  const s=storage(),workspace=freshGuestWorkspace('UTC');rememberGuestChoice(s);
  assert.equal(saveRememberedGuestWorkspace(s,workspace),true);
  s.removeItem(GUEST_STORAGE_KEY);forgetGuestChoice(s);
  assert.equal(saveRememberedGuestWorkspace(s,workspace),false);
  assert.equal(s.getItem(GUEST_STORAGE_KEY),null);
});
