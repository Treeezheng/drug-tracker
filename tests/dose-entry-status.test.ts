import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doseEntryStatus, doseEntryLabel, prepareDoseEntry, prepareDoseCorrection, confirmPlannedDose, partitionDoseEntries, doseEntriesInWindow, consumeWorkspaceDrafts } from '../src/lib/dose-entry-status';
import { newDose, updateDose } from '../src/components/DoseEditor';
import { localToInstant } from '../src/lib/time';
import { stockBalances } from '../src/lib/inventory';
import { filterDoses, parseBackup } from '../src/lib/reports';
import { summarizeSymptoms } from '../src/lib/symptoms';
import { scopeTimeline } from '../src/lib/timeline-scope';
import { createCloudClient } from '../src/lib/cloud-client';
import { openVaultStore } from '../server/vault-store.mjs';
import type { AppData, Dose, InventoryReceipt, Scenario } from '../src/lib/types';

const at=Date.parse('2026-09-13T12:00:00Z');
const entry=():Dose=>({...updateDose(newDose('ritalin','10'),{quantity:'1.5'},'UTC'),id:'synthetic-entry',administeredAt:'2026-09-13T12:01:00Z',timeZone:'UTC',date:'2026-09-13',time:'12:01',note:'Synthetic planned dose'});
const empty=():AppData=>({profile:null,doses:[],scenarios:[],favorites:[],checkins:[],inventory:[]});

test('Add has a strict future boundary, rejects incomplete instants and compares the selected time zone as an instant',()=>{
  assert.equal(doseEntryStatus('2026-09-13T12:00:00.001Z',at),'planned');
  assert.equal(doseEntryStatus('2026-09-13T12:00:00Z',at),'actual');
  assert.equal(doseEntryStatus('2026-09-13T11:59:59.999Z',at),'actual');
  assert.equal(doseEntryStatus('2026-09-13T05:00:00-07:00',at),'actual');
  for(const value of ['', '2026-09-13', '2026-02-30T12:00:00Z', '2026-09-13T12:00:00', 'invalid'])assert.equal(doseEntryStatus(value,at),null);
  assert.equal(doseEntryLabel('',at),'New dose');assert.equal(doseEntryLabel(entry().administeredAt,at),'Planned');
  const early=localToInstant('2026-11-01','01:30','America/Los_Angeles','earlier'),late=localToInstant('2026-11-01','01:30','America/Los_Angeles','later');
  assert.equal(doseEntryStatus(early,Date.parse('2026-11-01T09:00:00Z')),'actual');
  assert.equal(doseEntryStatus(late,Date.parse('2026-11-01T09:00:00Z')),'planned');
});

test('a frozen Add attempt retains the same ID, payload and Planned status across retry after its selected time',()=>{
  const original={...entry(),revision:12};const before=structuredClone(original);
  const attempt=prepareDoseEntry(original,at),copy=structuredClone(attempt);
  assert.equal(attempt.status,'planned');assert.equal(attempt.id,original.id);assert.equal(attempt.revision,undefined);
  assert.equal(doseEntryLabel(original.administeredAt,at+120000),'Taken');
  assert.deepEqual(attempt,copy);assert.deepEqual(original,before);
  original.note='Later form edit';assert.equal(attempt.note,'Synthetic planned dose');
});

test('saved plans never become actual on reload or ordinary edit; explicit confirmation preserves ID and revision',()=>{
  const planned={...prepareDoseEntry(entry(),at),revision:3};const original=structuredClone(planned);
  const edited=prepareDoseCorrection({...planned,note:'Changed note'},'planned',at+86400000);
  assert.equal(edited.status,'planned');assert.equal(edited.revision,3);
  assert.equal(partitionDoseEntries([planned],[]).actual.length,0);
  assert.throws(()=>confirmPlannedDose(planned,at),/future/);
  const actual=confirmPlannedDose(planned,at+120000);
  assert.equal(actual.status,'actual');assert.equal(actual.id,planned.id);assert.equal(actual.revision,3);
  assert.throws(()=>confirmPlannedDose(actual,at+120000),/no longer planned/);
  assert.throws(()=>prepareDoseCorrection({...actual,administeredAt:'2026-09-14T12:00:00Z'},'actual',at),/future/);
  assert.deepEqual(planned,original);
});

test('saved planned doses appear in simulation but remain outside history, supply use and symptom medication grouping until confirmed',()=>{
  const planned={...prepareDoseEntry(entry(),at),revision:1};
  const receipt:InventoryReceipt={id:'synthetic-supply',productId:planned.productId,productName:planned.productName,packageStrength:'10',strengthUnit:'mg',unit:'tablet',quantity:'20',receivedAt:'2026-09-01T00:00:00Z',timeZone:'UTC',note:''};
  const checkin={id:'synthetic-checkin',date:'2026-09-13',recordedAt:'2026-09-13T13:00:00Z',timeZone:'UTC',symptoms:['headache']};
  const draft={...planned,status:'simulated' as const};
  const parts=partitionDoseEntries([planned],[draft]);
  assert.deepEqual(parts.drafts,[]);assert.deepEqual(parts.actual,[]);
  const timeline=scopeTimeline({actual:parts.actual,drafts:[...parts.planned,...parts.drafts],start:at-3600000,end:at+86400000});
  assert.deepEqual(timeline.doses,[planned]);assert.equal(timeline.doses[0].status,'planned');
  assert.deepEqual(filterDoses([planned],'2026-09-13','2026-09-13','UTC'),[]);
  assert.equal(stockBalances([receipt],[planned],at+86400000)[0].used,'0');
  assert.deepEqual(summarizeSymptoms([checkin],[planned],'2026-09-13','2026-09-13','UTC').medications,[]);
  const confirmed={...confirmPlannedDose(planned,at+120000),revision:2};
  assert.deepEqual(filterDoses([confirmed],'2026-09-13','2026-09-13','UTC'),[confirmed]);
  assert.equal(stockBalances([receipt],[confirmed],at+86400000)[0].used,'1.5');
  assert.equal(summarizeSymptoms([checkin],[confirmed],'2026-09-13','2026-09-13','UTC').medications.length,1);
});

test('legacy Workspace cleanup consumes only recorded IDs and preserves old incomplete drafts, comparison rows and view',()=>{
  const d=entry(),remaining={...entry(),id:'other-draft',administeredAt:'',date:'',time:'',note:'Keep this unfinished input'};
  const workspace:Scenario={id:'workspace',name:'Workspace',revision:7,modelVersion:'original-model',baseline:'recorded',baselineNote:'Original baseline',doses:[d,remaining],comparisonDoses:[{...d,id:'comparison'}],view:{date:'2026-09-13',days:3,timeZone:'UTC',publishedOnly:true}};
  const before=structuredClone(workspace),planned=prepareDoseEntry(d,at),cleaned=consumeWorkspaceDrafts(workspace,[planned])!;
  assert.deepEqual(cleaned,{...before,doses:[remaining]});assert.deepEqual(workspace,before);
  assert.equal(consumeWorkspaceDrafts(cleaned,[planned]),null);
  assert.deepEqual(partitionDoseEntries([planned],workspace.doses).drafts,[remaining]);
  assert.deepEqual(partitionDoseEntries([{...planned,status:'skipped'}],workspace.doses).drafts,[remaining]);
});

test('saved plans outside the selected chart window cannot introduce unrelated groups or medical sources',()=>{
  const visible=prepareDoseEntry(entry(),at),future={...newDose('metformin-ir','500'),id:'far-future',status:'planned' as const,administeredAt:'2099-09-13T12:00:00Z'},overdue={...future,id:'past-plan',administeredAt:'2020-09-13T12:00:00Z'};
  const current=doseEntriesInWindow([future,visible,overdue],at,at+86400000);
  assert.deepEqual(current,[visible]);
  const timeline=scopeTimeline({actual:[],drafts:current,start:at,end:at+86400000});
  assert.deepEqual(timeline.doses,[visible]);
  const futureView=doseEntriesInWindow([future,visible,overdue],Date.parse('2099-09-13T00:00:00Z'),Date.parse('2099-09-14T00:00:00Z'));
  assert.deepEqual(futureView,[future]);assert.equal(futureView[0].status,'planned');
});

test('an encrypted planned save with lost acknowledgement retries exactly, survives a new client and backup, then confirms once',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'drug-planned-cloud-')),store=openVaultStore({dbPath:join(dir,'synthetic.sqlite')}),owner='synthetic-plan-owner';
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  let drop=false,writes=0;
  const fetcher=(async(url:RequestInfo|URL,init:RequestInit={})=>{
    const path=String(url).replace('/drug/api','');
    const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    if(path==='/session')return reply({user:{id:owner,name:'Synthetic account'}});
    assert.equal(new Headers(init.headers).get('X-Dose-Owner'),owner);
    if(path==='/vault'&&init.method==='GET')return reply({vault:store.read(owner)});
    if(path==='/vault'&&init.method==='PUT'){
      const vault=store.write(owner,JSON.parse(String(init.body)));writes++;
      if(drop){drop=false;throw new TypeError('Synthetic lost acknowledgement');}
      return reply({vault});
    }
    return reply({error:'Unexpected route'},404);
  }) as typeof fetch;
  const first=createCloudClient({fetch:fetcher});await first.session();await first.setupVault('Synthetic independent planned vault phrase',empty());
  const attempt=prepareDoseEntry(entry(),at);drop=true;
  await assert.rejects(first.request(`/doses/${attempt.id}`,'PUT',attempt,owner),/Connection interrupted/);
  const saved=await first.request<Dose>(`/doses/${attempt.id}`,'PUT',attempt,owner);
  assert.equal(writes,2);assert.equal(saved.revision,1);assert.equal(saved.status,'planned');first.lock();
  const second=createCloudClient({fetch:fetcher});await second.session();await second.unlockVault({vaultPassphrase:'Synthetic independent planned vault phrase'});
  const reloaded=await second.request<AppData>('/data','GET',undefined,owner);
  assert.deepEqual(reloaded.doses,[saved]);assert.deepEqual(partitionDoseEntries(reloaded.doses,[]).actual,[]);
  const backup=await second.request('/export','GET',undefined,owner);assert.deepEqual(parseBackup(JSON.stringify(backup)).doses,[saved]);
  const confirmation=confirmPlannedDose(saved,at+120000);
  const actual=await second.request<Dose>(`/doses/${saved.id}`,'PUT',confirmation,owner);
  assert.equal(actual.revision,2);assert.equal(actual.status,'actual');assert.equal(actual.id,saved.id);
  assert.equal((await second.request<AppData>('/data','GET',undefined,owner)).doses.length,1);
});
