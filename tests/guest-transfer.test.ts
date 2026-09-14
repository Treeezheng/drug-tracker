import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGuestTransfer, mergeGuestTransfer } from '../src/lib/guest-transfer';
import { freshGuestWorkspace } from '../src/lib/guest-workspace';
import type { AppData, Dose } from '../src/lib/types';

const empty = (): AppData => ({profile:null,doses:[],scenarios:[],favorites:[],checkins:[],inventory:[]});
const draft = (id='original-dose'): Dose => ({id,productId:'ritalin',productName:'Ritalin',formulation:'Immediate-release tablet',strength:'7.5',packageStrength:'7.5',strengthUnit:'mg',quantity:'1.5',unit:'tablet',amountMg:'11.25',administeredAt:'2026-09-13T15:03:00Z',timeZone:'UTC',status:'simulated',note:'SYNTHETIC guest private note',date:'2026-09-13',time:'15:03'});
function guest(){const workspace=freshGuestWorkspace('UTC');workspace.date='2026-09-13';workspace.drafts=[draft()];workspace.favorites=[{id:'original-favorite',productId:'ritalin',strength:'7.5',packageStrength:'7.5',quantity:'1.5'}];return workspace;}

test('preparing detaches a stable transfer and creates only simulated account drafts with exact quantities',()=>{
  const original=guest(),transfer=prepareGuestTransfer(original),copy=structuredClone(transfer);
  original.drafts[0].quantity='5';original.favorites.length=0;
  assert.deepEqual(transfer,copy);
  const merged=mergeGuestTransfer(empty(),transfer);
  assert.equal(merged.profile!.revision,1);assert.equal(merged.profile!.name,'');assert.deepEqual(merged.doses,[]);
  assert.equal(merged.scenarios[0].id,transfer.scenarioId);assert.equal(merged.scenarios[0].name,'Workspace');
  assert.equal(merged.scenarios[0].doses[0].amountMg,'11.25');assert.equal(merged.scenarios[0].doses[0].status,'simulated');
  assert.notEqual(merged.scenarios[0].doses[0].id,transfer.workspace.drafts[0].id);
  assert.deepEqual(merged.scenarios[0].view,{date:'2026-09-13',days:1,timeZone:'UTC',publishedOnly:false});
  assert.deepEqual(mergeGuestTransfer(merged,transfer),merged);
});

test('existing account profile, history, stock, check-ins, comparison and favorite quantity survive an appended Workspace merge',()=>{
  const account:AppData={...empty(),profile:{...guest().profile,name:'Account owner',revision:4},
    doses:[{...draft(),status:'actual',revision:3}],
    favorites:[{id:'account-favorite',productId:'ritalin',strength:'7.50',packageStrength:'7.50',quantity:'2',revision:7}],
    scenarios:[{id:'existing-workspace',name:'Workspace',doses:[draft('existing-draft')],comparisonDoses:[draft('comparison')],modelVersion:'historic-model',baseline:'recorded',baselineNote:'Preserve the account baseline',revision:6,view:{date:'2026-09-12',days:2,timeZone:'America/Los_Angeles',publishedOnly:true}}],
    checkins:[{id:'checkin',date:'2026-09-13',note:'Account symptom note'}],
    inventory:[{id:'receipt',productId:'ritalin',productName:'Ritalin',packageStrength:'7.5',strengthUnit:'mg',unit:'tablet',quantity:'20',receivedAt:'2026-09-12T12:00:00Z',timeZone:'UTC',note:'Account receipt'}]};
  const before=structuredClone(account),transfer=prepareGuestTransfer(guest()),merged=mergeGuestTransfer(account,transfer);
  assert.deepEqual(account,before);
  for(const collection of ['profile','doses','favorites','checkins','inventory'] as const)assert.deepEqual(merged[collection],before[collection]);
  const expected={...before.scenarios[0],revision:7,doses:[...before.scenarios[0].doses,merged.scenarios[0].doses[1]]};
  assert.deepEqual(merged.scenarios[0],expected);assert.notEqual(merged.scenarios[0].doses[1].id,account.doses[0].id);
  assert.deepEqual(mergeGuestTransfer(merged,transfer),merged);
});

test('retry cannot recreate a transferred draft already promoted to a formal account record',()=>{
  const transfer=prepareGuestTransfer(guest()),merged=mergeGuestTransfer(empty(),transfer),taken=merged.scenarios[0].doses.pop()!;
  merged.doses.push({...taken,status:'actual',note:'Edited after recording'});
  assert.deepEqual(mergeGuestTransfer(merged,transfer),merged);
});

test('distinct package strengths stay separate and favorite-only transfer does not manufacture a simulation row',()=>{
  const workspace=guest();workspace.drafts=[];workspace.favorites.push({...workspace.favorites[0],id:'other',strength:'10',packageStrength:'10'});
  const merged=mergeGuestTransfer(empty(),prepareGuestTransfer(workspace));
  assert.deepEqual(merged.favorites.map(row=>row.strength),['7.5','10']);assert.deepEqual(merged.scenarios,[]);
});

test('invalid or incomplete guest input is rejected before account mutation, including accessors and bounded UTF-8',()=>{
  for(const patch of [{productId:''},{quantity:'0.'},{status:'actual'},{administeredAt:'not-an-instant'}]){
    const workspace=guest();Object.assign(workspace.drafts[0],patch);assert.throws(()=>prepareGuestTransfer(workspace));
  }
  const account=empty(),before=structuredClone(account),transfer=prepareGuestTransfer(guest());
  assert.throws(()=>mergeGuestTransfer(account,{...transfer,ownerId:'other'}),/Invalid guest transfer/);
  assert.throws(()=>mergeGuestTransfer(account,{...transfer,scenarioId:'unsafe'}),/Invalid guest transfer/);
  let accessed=false;const unsafe={...transfer};Object.defineProperty(unsafe,'workspace',{get(){accessed=true;return transfer.workspace;},enumerable:true});
  assert.throws(()=>mergeGuestTransfer(account,unsafe));assert.equal(accessed,false);
  const oversized=guest();oversized.drafts[0].note='中'.repeat(170_000);assert.throws(()=>prepareGuestTransfer(oversized),/too large/);
  assert.deepEqual(account,before);
});

test('exceeding the account scenario bound rejects the entire transfer without dropping existing doses',()=>{
  const workspace=guest(),account={...empty(),scenarios:[{id:'full',name:'Workspace',doses:Array.from({length:500},(_,i)=>draft(`existing_${i}`)),modelVersion:'test',baseline:'empty' as const,revision:1}]};
  const before=structuredClone(account);
  assert.throws(()=>mergeGuestTransfer(account,prepareGuestTransfer(workspace)),/at most 500/);assert.deepEqual(account,before);
});
