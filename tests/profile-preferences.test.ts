import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfilePreferences } from '../src/lib/profile-preferences.ts';
import { freshGuestWorkspace, readGuestWorkspace } from '../src/lib/guest-workspace.ts';
import { rememberGuestChoice, saveRememberedGuestWorkspace } from '../src/lib/guest-consent.ts';
import { minuteChoices } from '../src/components/MobileTimePicker.tsx';
import type { Profile } from '../src/lib/types';
const profile=():Profile=>({...freshGuestWorkspace('UTC').profile,revision:1});

test('rapid discrete setting changes save in order with the latest acknowledged profile revision',async()=>{
  const initial=profile(),settings=createProfilePreferences(initial),writes:Profile[]=[];
  let release!:()=>void,admitted!:()=>void;
  const started=new Promise<void>(resolve=>{admitted=resolve;}),blocked=new Promise<void>(resolve=>{release=resolve;});
  const save=async(p:Profile)=>{writes.push({...p});if(writes.length===1){admitted();await blocked;}return {...p,revision:p.revision!+1};};
  const first=settings.apply({timeIncrementMinutes:1},save);await started;
  const second=settings.apply({timeIncrementMinutes:10,timeFormat:'24h'},save);
  assert.equal(writes.length,1);assert.equal(settings.snapshot().draft.timeIncrementMinutes,10);
  release();await Promise.all([first,second]);
  assert.deepEqual(writes.map(p=>[p.revision,p.timeIncrementMinutes]),[[1,1],[2,10]]);
  assert.equal(settings.snapshot().draft.revision,3);assert.equal(settings.snapshot().draft.timeFormat,'24h');
  assert.equal(settings.snapshot().dirty,false);assert.deepEqual(minuteChoices(settings.snapshot().draft.timeIncrementMinutes!,null),[0,10,20,30,40,50]);
  assert.equal(initial.timeIncrementMinutes,5,'Saving preferences never rewrites the original input or dose records.');
});

test('a legal select applies without submitting incomplete time-zone text, which remains an explicit-save draft',async()=>{
  const settings=createProfilePreferences(profile()),writes:Profile[]=[];
  const save=async(p:Profile)=>{writes.push({...p});return {...p,revision:p.revision!+1};};
  settings.edit({timeZone:'America/',bedtime:'22:13'});
  await settings.apply({timeIncrementMinutes:1},save);
  assert.equal(writes[0].timeZone,'UTC');assert.equal(writes[0].bedtime,'23:00');
  assert.equal(settings.snapshot().draft.timeZone,'America/');assert.equal(settings.snapshot().draft.bedtime,'22:13');assert.equal(settings.snapshot().dirty,true);
  await assert.rejects(settings.save(save));assert.equal(writes.length,1);assert.ok(settings.snapshot().error);
  settings.edit({timeZone:'America/Los_Angeles'});await settings.save(save);
  assert.equal(writes[1].revision,2);assert.equal(writes[1].timeIncrementMinutes,1);assert.equal(writes[1].bedtime,'22:13');assert.equal(settings.snapshot().dirty,false);
});

test('failed account saves retain the chosen value and require an explicit retry after refreshed CAS state',async()=>{
  const settings=createProfilePreferences(profile());
  await assert.rejects(settings.apply({timeIncrementMinutes:10},async()=>{throw new Error('This record changed. Refresh first.');}),/Refresh/);
  assert.equal(settings.snapshot().draft.timeIncrementMinutes,10);assert.equal(settings.snapshot().saved,false);
  settings.sync({...profile(),revision:7,timeFormat:'24h'});
  assert.equal(settings.snapshot().draft.timeIncrementMinutes,10);assert.equal(settings.snapshot().draft.timeFormat,'24h');
  let revision:number|undefined;
  await settings.save(async p=>{revision=p.revision;return {...p,revision:8};});
  assert.equal(revision,7);assert.equal(settings.snapshot().error,'');assert.equal(settings.snapshot().dirty,false);
});

test('guest settings remain in memory without consent and round-trip only after the explicit device choice',async()=>{
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  let workspace=freshGuestWorkspace('UTC');
  const originalDoses=workspace.drafts,settings=createProfilePreferences(workspace.profile);
  const save=async(p:Profile)=>{workspace={...workspace,profile:p};saveRememberedGuestWorkspace(storage,workspace);return p;};
  await settings.apply({timeIncrementMinutes:1},save);assert.equal(values.size,0);assert.equal(workspace.profile.timeIncrementMinutes,1);
  rememberGuestChoice(storage);await settings.apply({timeIncrementMinutes:10},save);
  const restored=readGuestWorkspace(storage)!;assert.equal(restored.profile.timeIncrementMinutes,10);assert.deepEqual(restored.drafts,originalDoses);
  assert.deepEqual(minuteChoices(restored.profile.timeIncrementMinutes!,13),[0,10,13,20,30,40,50],'An existing off-step minute remains selectable, without rewriting its saved time.');
});
