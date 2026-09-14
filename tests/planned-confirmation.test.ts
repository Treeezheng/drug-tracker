import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PlannedDoseConfirmation from '../src/components/PlannedDoseConfirmation.tsx';
import SettingHelp from '../src/components/SettingHelp.tsx';
import { canConfirmPlannedDose, confirmPlannedDose, partitionDoseEntries } from '../src/lib/dose-entry-status.ts';
import { newDose, updateDose } from '../src/components/DoseEditor.tsx';
import { parseBackup } from '../src/lib/reports.ts';
import type { Dose, Profile } from '../src/lib/types.ts';

const profile:Profile={name:'Synthetic',timeZone:'UTC',timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
const now=Date.parse('2026-09-13T12:00:00Z');
function dose():Dose{return {...newDose('ritalin','10'),status:'planned',revision:4,administeredAt:'2026-09-13T11:30:27Z',timeZone:'UTC',date:'2026-09-13',time:'11:30',quantity:'1.5',amountMg:'15',ingredients:[{name:'methylphenidate hydrochloride',amountMg:'15',strengthMg:'10',unit:'mg'}]};}
function render(row:Dose,options:{profile?:Profile;pending?:boolean}={}){return renderToStaticMarkup(createElement(PlannedDoseConfirmation,{dose:row,scheduledAt:dose().administeredAt,profile:options.profile??profile,now,pending:options.pending,onChange:()=>{},onCancel:()=>{},onConfirm:()=>{}}));}

test('confirmation visibility defaults on only for due planned records without changing their stored status',()=>{
  const row=dose(),before=structuredClone(row);
  assert.equal(canConfirmPlannedDose(row,profile,now),true);
  assert.equal(canConfirmPlannedDose(row,{plannedDoseConfirmation:false},now),false);
  assert.equal(canConfirmPlannedDose(row,{plannedDoseConfirmation:true},now),true);
  assert.equal(canConfirmPlannedDose({...row,administeredAt:new Date(now+1).toISOString()},profile,now),false);
  for(const status of ['actual','simulated','skipped'] as const)assert.equal(canConfirmPlannedDose({...row,status},profile,now),false);
  for(const time of ['','invalid','2026-02-30T12:00:00Z'])assert.equal(canConfirmPlannedDose({...row,administeredAt:time},profile,now),false);
  assert.deepEqual(row,before);assert.deepEqual(partitionDoseEntries([row],[]).actual,[]);
});

test('confirming an unchanged plan preserves its precise scheduled instant instead of substituting now',()=>{
  const row=dose(),before=structuredClone(row),saved=confirmPlannedDose(row,now);
  assert.equal(saved.administeredAt,'2026-09-13T11:30:27Z');assert.equal(saved.status,'actual');assert.equal(saved.id,row.id);assert.equal(saved.revision,4);assert.equal(saved.amountMg,'15');
  assert.deepEqual(row,before);
  const html=render(row);assert.match(html,/Planned for/);assert.match(html,/Confirm when you took it/);assert.match(html,/value="11:30"|11:30/);assert.match(html,/Actual date/);assert.match(html,/Actual time/);assert.match(html,/Confirm taken/);
  assert.doesNotMatch(html,/Quantity.*input|Choose medication|Formula/);
});

test('an explicit corrected actual time keeps the same dose and rejects future confirmation',()=>{
  const row=dose(),corrected=updateDose(row,{time:'11:45',disambiguation:undefined},profile.timeZone),saved=confirmPlannedDose(corrected,now);
  assert.equal(saved.administeredAt,'2026-09-13T11:45:00Z');assert.equal(row.administeredAt,'2026-09-13T11:30:27Z');
  assert.equal(saved.id,row.id);assert.deepEqual(saved.ingredients,row.ingredients);
  const future=updateDose(row,{time:'12:01'},profile.timeZone);assert.throws(()=>confirmPlannedDose(future,now),/future/);assert.match(render(future),/A taken dose cannot be in the future/);
});

test('DST gaps and repeated local times stay editable and require an explicit occurrence',()=>{
  const zone='America/Los_Angeles',p={...profile,timeZone:zone};
  const row={...dose(),administeredAt:'2026-03-08T09:30:00Z'};
  const gap=updateDose(row,{time:'02:30',disambiguation:undefined},zone);assert.equal(gap.administeredAt,'');assert.match(render(gap,{profile:p}),/does not exist/);
  const repeated=updateDose(row,{date:'2026-11-01',time:'01:30',disambiguation:undefined},zone);assert.equal(repeated.administeredAt,'');
  const html=render(repeated,{profile:p});assert.match(html,/occurs twice/);assert.match(html,/Clock occurrence/);assert.match(html,/aria-describedby="confirm-dose-time-/);
  const later=updateDose(repeated,{disambiguation:'later'},zone);assert.equal(later.administeredAt,'2026-11-01T09:30:00Z');
});

test('profile opt-out round-trips through backup while old profiles remain valid and non-booleans are rejected',()=>{
  const backup=(p:unknown)=>JSON.stringify({format:'dose-timeline-backup',schemaVersion:1,exportedAt:'2026-09-13T12:00:00Z',data:{profile:p,doses:[],scenarios:[],favorites:[],checkins:[]}});
  for(const value of [true,false])assert.equal(parseBackup(backup({...profile,plannedDoseConfirmation:value})).profile?.plannedDoseConfirmation,value);
  assert.equal(parseBackup(backup(profile)).profile?.plannedDoseConfirmation,undefined);
  for(const value of [null,'false',0,1,[]])assert.throws(()=>parseBackup(backup({...profile,plannedDoseConfirmation:value})),/Planned dose confirmation/);
});

test('an unconfirmed save freezes the form for an exact retry and explanatory controls are keyboard buttons',()=>{
  const html=render(dose(),{pending:true});assert.match(html,/<fieldset[^>]*disabled=""/);assert.match(html,/Retry confirmation/);assert.match(html,/exact time and dose/);
  const help=renderToStaticMarkup(createElement(SettingHelp,{label:'planned dose confirmation',children:'This never records a dose automatically.'}));
  assert.match(help,/<button type="button"[^>]*aria-label="About planned dose confirmation"[^>]*aria-expanded="false"/);assert.match(help,/hidden=""/);
});
