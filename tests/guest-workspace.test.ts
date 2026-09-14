import test from 'node:test';
import assert from 'node:assert/strict';
import { GUEST_STORAGE_KEY, freshGuestWorkspace, parseGuestWorkspace, readGuestWorkspace, saveGuestWorkspace, clearGuestWorkspace, validGuestDate, type GuestStorage } from '../src/lib/guest-workspace';
import { newDose, updateDose } from '../src/components/DoseEditor';

function fixture(){const value=freshGuestWorkspace('America/Los_Angeles');value.date='2026-09-13';value.favorites=[{id:'favorite',productId:'ritalin',strength:'7.5',packageStrength:'7.5',quantity:'1.5'}];value.drafts=[{...updateDose(newDose('ritalin','7.5'),{quantity:'1.5'},value.profile.timeZone),id:'dose',status:'simulated' as const,date:'2026-09-13',time:'08:03',administeredAt:'2026-09-13T15:03:00Z'}];return value;}
function storage(){const map=new Map<string,string>([['unrelated-key','retain me']]);const access:GuestStorage={getItem:key=>map.get(key)??null,setItem:(key,value)=>{map.set(key,value);},removeItem:key=>{map.delete(key);}};return {map,access};}

test('only the versioned guest key is read, saved and cleared; custom exact simulation survives reload',()=>{
  const {map,access}=storage(),original=fixture(),copy=structuredClone(original);
  assert.equal(readGuestWorkspace(access),null);saveGuestWorkspace(access,original);
  assert.deepEqual(original,copy);assert.deepEqual(readGuestWorkspace(access),original);
  assert.equal(readGuestWorkspace(access)!.drafts[0].amountMg,'11.25');
  assert.deepEqual([...map.keys()],['unrelated-key',GUEST_STORAGE_KEY]);
  clearGuestWorkspace(access);assert.equal(readGuestWorkspace(access),null);assert.equal(map.get('unrelated-key'),'retain me');
});
test('formal statuses and account/history/stock/symptom data cannot enter guest storage',()=>{
  for(const status of ['actual','planned','skipped']){const value=fixture();(value.drafts[0] as any).status=status;assert.throws(()=>parseGuestWorkspace(JSON.stringify(value)),/Only simulated/);}
  for(const field of ['user','ownerId','doses','checkins','inventory','scenarios','session','recoveryKey','vaultPassphrase','password','outbox'])assert.throws(()=>parseGuestWorkspace(JSON.stringify({...fixture(),[field]:'private'})),/Unsupported/);
  for(const field of ['revision','ownerId','createdAt']){const value=fixture();(value.drafts[0] as any)[field]=1;assert.throws(()=>parseGuestWorkspace(JSON.stringify(value)),/Unsupported/);}
  const named=fixture();named.profile.name='Account name';assert.throws(()=>parseGuestWorkspace(JSON.stringify(named)),/profile name/);
  const revised=fixture();revised.favorites[0].revision=2;assert.throws(()=>parseGuestWorkspace(JSON.stringify(revised)),/Unsupported/);
});
test('incomplete form input is preserved as simulated without being promoted to an actual record',()=>{
  const value=fixture();value.drafts=[{...value.drafts[0],productId:'',productName:'',formulation:'',strength:'',packageStrength:'',quantity:'0.',amountMg:'',ingredients:[],administeredAt:'',date:'',time:''}];
  const result=parseGuestWorkspace(JSON.stringify(value));assert.deepEqual(result.drafts,value.drafts);assert.equal(result.drafts[0].status,'simulated');
});
test('untrusted storage rejects unknown schema, malformed nested fields, duplicates and oversize before replacing saved data',()=>{
  const {access,map}=storage();saveGuestWorkspace(access,fixture());const saved=map.get(GUEST_STORAGE_KEY);
  for(const input of [{...fixture(),version:2},{...fixture(),days:4},{...fixture(),date:'2026-02-30'},{...fixture(),publishedOnly:'false'}, {...fixture(),drafts:[fixture().drafts[0],fixture().drafts[0]]}])assert.throws(()=>saveGuestWorkspace(access,input as any));
  const nested=fixture();(nested.drafts[0] as any).ingredients=[{name:'a',amountMg:'1',ownerId:'secret'}];assert.throws(()=>saveGuestWorkspace(access,nested));
  assert.throws(()=>parseGuestWorkspace(' '.repeat(500_001)),/too large/);assert.throws(()=>parseGuestWorkspace('{"__proto__":{}}'),/Unsupported/);
  assert.equal(map.get(GUEST_STORAGE_KEY),saved);
});
test('invalid or skipped local dates and unsupported time zones do not reach chart rendering',()=>{
  for(const date of ['0000-01-01','9999-01-01','2026-02-29','2026-09-13x'])assert.equal(validGuestDate(date),false);
  assert.equal(validGuestDate('2024-02-29'),true);
  const skipped=fixture();skipped.date='2011-12-30';skipped.profile.timeZone='Pacific/Apia';assert.throws(()=>parseGuestWorkspace(JSON.stringify(skipped)),/does not exist/);
  skipped.date='2011-12-29';skipped.days=2;assert.throws(()=>parseGuestWorkspace(JSON.stringify(skipped)),/does not exist/);
  const zone=fixture();zone.profile.timeZone='Not/A_Zone';assert.throws(()=>parseGuestWorkspace(JSON.stringify(zone)));
});
test('storage denial and malformed saved content are reported and never silently erased',()=>{
  const denied:GuestStorage={getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('quota');},removeItem:()=>{throw new Error('denied');}};
  assert.throws(()=>readGuestWorkspace(denied),/denied/);assert.throws(()=>saveGuestWorkspace(denied,fixture()),/quota/);assert.throws(()=>clearGuestWorkspace(denied),/denied/);
  const {map,access}=storage();map.set(GUEST_STORAGE_KEY,'not json');assert.throws(()=>readGuestWorkspace(access));assert.equal(map.get(GUEST_STORAGE_KEY),'not json');
});

test('guest preferences default to five minutes and persist 1/5/10 without changing simulated timestamps',()=>{
  assert.equal(freshGuestWorkspace('UTC').profile.timeIncrementMinutes,5);
  const {access,map}=storage(),original=fixture();
  for(const timeIncrementMinutes of [1,5,10] as const){
    const next={...original,profile:{...original.profile,timeIncrementMinutes}};
    saveGuestWorkspace(access,next);
    assert.deepEqual(readGuestWorkspace(access),next);
    assert.deepEqual(readGuestWorkspace(access)!.drafts,original.drafts);
  }
  const saved=map.get(GUEST_STORAGE_KEY);
  for(const timeIncrementMinutes of [-1,0,2,15,1.5,'1',null]){
    assert.throws(()=>saveGuestWorkspace(access,{...original,profile:{...original.profile,timeIncrementMinutes}} as never),/time increment/);
    assert.equal(map.get(GUEST_STORAGE_KEY),saved);
  }
  const legacy=structuredClone(original);delete legacy.profile.timeIncrementMinutes;
  saveGuestWorkspace(access,legacy);assert.equal(readGuestWorkspace(access)!.profile.timeIncrementMinutes,undefined);
});
