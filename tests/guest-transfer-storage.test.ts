import test from 'node:test';
import assert from 'node:assert/strict';
import { clearTransferredGuest } from '../src/lib/guest-transfer-storage';
import { GUEST_STORAGE_KEY, freshGuestWorkspace, saveGuestWorkspace } from '../src/lib/guest-workspace';
import { GUEST_CONSENT_KEY, readGuestConsent, rememberGuestChoice, saveRememberedGuestWorkspace } from '../src/lib/guest-consent';

function storage(){
  const values=new Map<string,string>(),removed:string[]=[];
  return {values,removed,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{removed.push(key);values.delete(key);}};
}
test('confirmed transfer removes only the matching guest copy and revokes subsequent background saves',()=>{
  const s=storage(),workspace=freshGuestWorkspace('UTC');rememberGuestChoice(s);saveGuestWorkspace(s,workspace);
  s.setItem('unrelated-preference','keep');const snapshot=s.getItem(GUEST_STORAGE_KEY);
  assert.equal(clearTransferredGuest(s,snapshot),'cleared');
  assert.deepEqual(s.removed,[GUEST_CONSENT_KEY,GUEST_STORAGE_KEY]);
  assert.equal(readGuestConsent(s),false);assert.equal(s.getItem(GUEST_STORAGE_KEY),null);
  assert.equal(saveRememberedGuestWorkspace(s,workspace),false);assert.equal(s.getItem('unrelated-preference'),'keep');
});
test('a changed local workspace is retained with its consent and can still be saved',()=>{
  const s=storage();rememberGuestChoice(s);saveGuestWorkspace(s,freshGuestWorkspace('UTC'));const snapshot=s.getItem(GUEST_STORAGE_KEY);
  const newer={...freshGuestWorkspace('UTC'),days:3 as const};saveGuestWorkspace(s,newer);
  assert.equal(clearTransferredGuest(s,snapshot),'changed');assert.deepEqual(s.removed,[]);
  assert.equal(readGuestConsent(s),true);assert.equal(JSON.parse(s.getItem(GUEST_STORAGE_KEY)!).days,3);
});
test('failed device removal keeps the copy and permits cleanup retry without reimporting',()=>{
  const s=storage();rememberGuestChoice(s);saveGuestWorkspace(s,freshGuestWorkspace('UTC'));const snapshot=s.getItem(GUEST_STORAGE_KEY);
  const failing={...s,removeItem(key:string){if(key===GUEST_STORAGE_KEY)throw new Error('Storage blocked');s.removeItem(key);}};
  assert.throws(()=>clearTransferredGuest(failing,snapshot),/Storage blocked/);
  assert.equal(s.getItem(GUEST_STORAGE_KEY),snapshot);assert.equal(readGuestConsent(s),false);
  assert.equal(clearTransferredGuest(s,snapshot),'cleared');assert.equal(s.getItem(GUEST_STORAGE_KEY),null);
});
test('silent storage removal failure is surfaced rather than reported as a successful cleanup',()=>{
  const s=storage();saveGuestWorkspace(s,freshGuestWorkspace('UTC'));const snapshot=s.getItem(GUEST_STORAGE_KEY);
  assert.throws(()=>clearTransferredGuest({...s,removeItem(){}},snapshot),/could not be removed/);
  assert.equal(s.getItem(GUEST_STORAGE_KEY),snapshot);
});
