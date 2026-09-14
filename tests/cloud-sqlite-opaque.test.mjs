import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { openCloudSqlite } from '../server/cloud-sqlite.mjs';
import { openVaultStore } from '../server/vault-store.mjs';

// Synthetic opaque byte strings test repository transactions, not PAKE validity.
const b64=(size,marker=1)=>Buffer.alloc(size,marker).toString('base64url');
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const fails=status=>error=>error.status===status;
const session=(id=randomUUID())=>({tokenHash:hash(id),expiresAt:Date.now()+3_600_000});
function envelope(owner,expectedRevision=0,marker=1,version=3){
  const common={protocol:'dose-timeline-vault',version:1,ownerId:owner,cipher:'AES-256-GCM',iv:b64(12,marker)};
  return {expectedRevision,dataEnvelope:{...common,kind:'data',ciphertext:b64(17,marker)},keyEnvelope:{...common,version,kind:'wrapped-key',ciphertext:b64(48,marker),kdf:version===3?{name:'OPAQUE-export',hash:'SHA-256',context:'drug-tracker:opaque:v1',salt:b64(16,marker)}:{name:'PBKDF2',hash:'SHA-256',iterations:600_000,salt:b64(16,marker)}}};
}
function challenge(id,patch={}){return {idHash:hash(id),kind:'login',ownerId:null,username:'synthetic-user',sourceHash:hash('source'),authVersion:null,sessionHash:null,expiresAt:Date.now()+120_000,payload:{sample:'synthetic'},...patch};}
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'drug-opaque-sqlite-')),dbPath=join(dir,'cloud.sqlite'),stores=[];
  const open=()=>{const store=openCloudSqlite(dbPath);stores.push(store);return store;};
  t.after(async()=>{for(const store of stores)store.close();await rm(dir,{recursive:true,force:true});});
  return {dbPath,open,store:open()};
}
function registration(store,id='owner',token=session(id)){
  store.getOrCreateOpaqueSetup(b64(128));
  const result=store.registerOpaque({challenge:challenge(id,{kind:'register',ownerId:id,username:`user-${id}`,payload:{name:`Name ${id}`}}),registrationRecord:b64(192),recoveryAuthHash:hash(`recovery-${id}`),vaultInput:envelope(id)},token);
  return {...result,token};
}
function commitInput(user,vault,token,kind='change',marker=2){
  const input=envelope(user.id,vault.revision,marker);
  if(kind==='change')input.dataEnvelope=structuredClone(vault.dataEnvelope);
  return {kind,ownerId:user.id,authVersion:user.auth_version,sessionHash:token.tokenHash,registrationRecord:b64(192,marker),vaultInput:input,...(kind!=='change'?{recoveryAuthHash:hash(`new-recovery-${marker}`)}:{})};
}

test('v1 and v2 migration preserve synthetic legacy identities, sessions and exact vault bytes; concurrent setup has one durable winner',async t=>{
  for(const version of [1,2]){
    const dir=await mkdtemp(join(tmpdir(),'drug-opaque-migration-')),path=join(dir,'cloud.sqlite');
    t.after(()=>rm(dir,{recursive:true,force:true}));
    const db=new DatabaseSync(path),token=session(`legacy-${version}`),created=new Date().toISOString();
    db.exec(`CREATE TABLE cloud_meta(singleton INTEGER PRIMARY KEY,edition TEXT,version INTEGER);
      INSERT INTO cloud_meta VALUES(1,'drug-cloud-encrypted',${version});
      CREATE TABLE cloud_accounts(${version===1?'singleton INTEGER PRIMARY KEY,':''} id TEXT ${version===1?'UNIQUE':'PRIMARY KEY'},username TEXT UNIQUE,password_hash TEXT NOT NULL,name TEXT,created_at TEXT);
      CREATE TABLE cloud_sessions(token_hash TEXT PRIMARY KEY,owner_id TEXT REFERENCES cloud_accounts(id),expires_at INTEGER,created_at TEXT);`);
    db.prepare(`INSERT INTO cloud_accounts VALUES(${version===1?'1,':''}?,?,?,?,?)`).run('legacy','legacy-user','legacy-scrypt-hash','Name',created);
    db.prepare('INSERT INTO cloud_sessions VALUES(?,?,?,?)').run(token.tokenHash,'legacy',token.expiresAt,created);db.close();
    const vaultStore=openVaultStore({dbPath:path}),original=vaultStore.write('legacy',envelope('legacy',0,1,1));vaultStore.close();
    const moduleUrl=new URL('../server/cloud-sqlite.mjs',import.meta.url).href;
    const workers=[1,2,3].map(marker=>new Worker(`const {parentPort,workerData}=require('node:worker_threads');import(workerData.moduleUrl).then(({openCloudSqlite})=>{const store=openCloudSqlite(workerData.path);try{parentPort.postMessage({setup:store.getOrCreateOpaqueSetup(Buffer.alloc(128,workerData.marker).toString('base64url'))});}finally{store.close();}}).catch(error=>parentPort.postMessage({error:error.message}));`,{eval:true,workerData:{moduleUrl,path,marker}}));
    t.after(()=>Promise.all(workers.map(worker=>worker.terminate())));
    const setups=await Promise.all(workers.map(worker=>new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('message',value=>value.error?reject(new Error(value.error)):resolve(value.setup));})));
    assert.equal(new Set(setups).size,1);
    const store=openCloudSqlite(path);t.after(()=>store.close());
    const account=store.session(token.tokenHash);assert.equal(account.id,'legacy');assert.equal(account.password_hash,'legacy-scrypt-hash');assert.equal(account.auth_mode,'legacy-scrypt');assert.equal(account.auth_version,1);
    assert.deepEqual(store.readVault('legacy',token.tokenHash),original);
    const inspected=new DatabaseSync(path);assert.equal(inspected.prepare('SELECT version FROM cloud_meta').get().version,3);assert.deepEqual(inspected.prepare('PRAGMA foreign_key_check').all(),[]);inspected.close();
  }
});

test('setup stays stable, rejects overrides and fails closed when an existing opaque account loses its setup',async t=>{
  const f=await fixture(t),{store}=f;
  assert.throws(()=>store.getOrCreateOpaqueSetup('invalid'),fails(400));
  const setup=store.getOrCreateOpaqueSetup(b64(128,2));assert.equal(store.getOrCreateOpaqueSetup('ignored'),setup);
  assert.throws(()=>store.getOrCreateOpaqueSetup(b64(128,3),b64(128,3)),fails(400));
  registration(store);
  const db=new DatabaseSync(f.dbPath);db.exec('DELETE FROM cloud_auth_secrets');db.close();
  assert.throws(()=>store.getOrCreateOpaqueSetup(b64(128,4)),fails(503));
});

test('challenges survive restart, are source/kind bound and consume exactly once including expired attempts',async t=>{
  const f=await fixture(t),row=challenge('one');f.store.createOpaqueChallenge(row);const second=f.open();
  assert.throws(()=>second.takeOpaqueChallenge(row.idHash,'register',row.sourceHash),fails(401));
  assert.throws(()=>second.takeOpaqueChallenge(row.idHash,row.kind,hash('wrong-source')),fails(401));
  assert.deepEqual(second.takeOpaqueChallenge(row.idHash,row.kind,row.sourceHash),row);
  assert.throws(()=>f.store.takeOpaqueChallenge(row.idHash,row.kind,row.sourceHash),fails(401));
  f.store.createOpaqueChallenge(challenge('expired'));
  const db=new DatabaseSync(f.dbPath);db.prepare('UPDATE cloud_auth_challenges SET expires_at=? WHERE id_hash=?').run(Date.now()-1,hash('expired'));
  assert.throws(()=>second.takeOpaqueChallenge(hash('expired'),'login',row.sourceHash),fails(401));
  assert.equal(db.prepare('SELECT count(*) AS n FROM cloud_auth_challenges').get().n,0);db.close();
});

test('challenge payload and active username/source/global budgets are enforced in storage',async t=>{
  const f=await fixture(t),s=f.store;
  assert.throws(()=>s.createOpaqueChallenge(challenge('big',{payload:{text:'x'.repeat(16_384)}})),fails(400));
  for(let i=0;i<12;i++)s.createOpaqueChallenge(challenge(`username-${i}`));
  assert.throws(()=>s.createOpaqueChallenge(challenge('username-thirteen')),error=>error.status===429&&error.retryAfter===2);
  for(let i=12;i<40;i++)s.createOpaqueChallenge(challenge(`source-${i}`,{username:`username-${i}`}));
  assert.throws(()=>s.createOpaqueChallenge(challenge('source-41',{username:'another-user'})),fails(429));
  for(let i=40;i<1000;i++)s.createOpaqueChallenge(challenge(`global-${i}`,{username:`username-${i}`,sourceHash:hash(`source-${i}`)}));
  assert.throws(()=>s.createOpaqueChallenge(challenge('global-1001',{username:'last-user',sourceHash:hash('last-source')})),fails(429));
});

test('registration is atomic and duplicate usernames or session insertion failures preserve existing owners',async t=>{
  const {store:s}=await fixture(t),first=registration(s);
  assert.equal(first.user.auth_mode,'opaque-v1');assert.equal(first.user.password_hash,'!opaque-v1');assert.equal(first.vault.revision,1);
  const input={challenge:challenge('failed',{kind:'register',ownerId:'failed',username:'user-failed'}),registrationRecord:b64(192),recoveryAuthHash:hash('recovery-failed'),vaultInput:envelope('failed')};
  assert.throws(()=>s.registerOpaque(input,first.token));assert.equal(s.opaqueAccountById('failed'),null);
  const successful=s.registerOpaque(input,session());assert.equal(successful.vault.revision,1);
  assert.throws(()=>s.registerOpaque({...input,challenge:{...input.challenge,ownerId:'other'},vaultInput:envelope('other')},session()),fails(409));
  assert.deepEqual(s.readVault('owner',first.token.tokenHash),first.vault);
});

test('normal opaque writes preserve the wrapped key despite JSON key ordering and use exact CAS',async t=>{
  const {store:s}=await fixture(t),{user,vault,token}=registration(s);
  const update=envelope(user.id,1,2);update.keyEnvelope=Object.fromEntries(Object.entries(vault.keyEnvelope).reverse());
  update.keyEnvelope.kdf=Object.fromEntries(Object.entries(vault.keyEnvelope.kdf).reverse());
  const saved=s.writeVault(user.id,token.tokenHash,update);assert.equal(saved.revision,2);
  assert.throws(()=>s.writeVault(user.id,token.tokenHash,update),error=>error.status===409&&error.currentRevision===2);
  assert.throws(()=>s.writeVault(user.id,token.tokenHash,envelope(user.id,2,3)),fails(400));
  const legacy={id:'legacy',username:'legacy',password_hash:'synthetic-hash',name:'Legacy'},legacySession=session();s.register(legacy,legacySession);
  assert.throws(()=>s.writeVault('legacy',legacySession.tokenHash,envelope('legacy')),fails(400));
  assert.equal(s.writeVault('legacy',legacySession.tokenHash,envelope('legacy',0,1,1)).revision,1);
});

test('password changes preserve ciphertext and recovery while atomically revoking old sessions and stale grants',async t=>{
  const {store:s}=await fixture(t),initial=registration(s),second=session();s.loginOpaque({ownerId:'owner',authVersion:1},second);
  s.createOpaqueChallenge(challenge('pending',{ownerId:'owner',authVersion:1}));
  const input=commitInput(initial.user,initial.vault,initial.token),replacement=session();
  const bad={...input,vaultInput:envelope('owner',1,4)};
  assert.throws(()=>s.commitOpaque(bad,replacement),fails(400));assert.ok(s.session(initial.token.tokenHash));
  const result=s.commitOpaque(input,replacement);assert.equal(result.user.auth_version,2);assert.equal(result.user.recovery_auth_hash,initial.user.recovery_auth_hash);
  assert.deepEqual(result.vault.dataEnvelope,initial.vault.dataEnvelope);assert.equal(result.vault.revision,2);
  assert.equal(s.session(initial.token.tokenHash),null);assert.equal(s.session(second.tokenHash),null);assert.ok(s.session(replacement.tokenHash));
  assert.throws(()=>s.loginOpaque({ownerId:'owner',authVersion:1},session()),fails(401));
  assert.throws(()=>s.takeOpaqueChallenge(hash('pending'),'login',hash('source')),fails(401));
});

test('recovery binds the old verifier and auth version, rotates credentials and fails atomically on a stale vault',async t=>{
  const {store:s}=await fixture(t),initial=registration(s),input=commitInput(initial.user,initial.vault,initial.token,'recover');
  delete input.sessionHash;input.expectedRecoveryHash=initial.user.recovery_auth_hash;
  assert.deepEqual(s.recoveryVault('owner',1,initial.user.recovery_auth_hash),initial.vault);
  assert.throws(()=>s.recoveryVault('owner',1,hash('wrong')),fails(401));
  assert.throws(()=>s.commitOpaque({...input,expectedRecoveryHash:hash('wrong')},session()),fails(401));
  assert.throws(()=>s.commitOpaque({...input,vaultInput:{...input.vaultInput,expectedRevision:0}},session()),fails(409));
  assert.ok(s.session(initial.token.tokenHash));assert.equal(s.opaqueAccountById('owner').auth_version,1);
  const replacement=session(),result=s.commitOpaque(input,replacement);
  assert.equal(result.user.auth_version,2);assert.equal(result.user.recovery_auth_hash,input.recoveryAuthHash);
  assert.throws(()=>s.recoveryVault('owner',1,initial.user.recovery_auth_hash),fails(401));
  assert.equal(s.session(initial.token.tokenHash),null);assert.equal(s.readVault('owner',replacement.tokenHash).revision,2);
});

test('legacy migration and recovery replacement keep IDs while preserving or rotating the intended credentials',async t=>{
  const {store:s}=await fixture(t),legacy={id:'legacy',username:'legacy-user',password_hash:'synthetic-old-hash',name:'Legacy'},token=session();s.register(legacy,token);
  const input={kind:'migrate',ownerId:'legacy',authVersion:1,sessionHash:token.tokenHash,expectedLegacyHash:legacy.password_hash,registrationRecord:b64(192),vaultInput:envelope('legacy'),recoveryAuthHash:hash('legacy-recovery')};
  assert.throws(()=>s.commitOpaque({...input,expectedLegacyHash:'wrong'},session()),fails(401));
  const replacement=session(),migrated=s.commitOpaque(input,replacement);assert.equal(migrated.user.id,legacy.id);assert.equal(migrated.user.name,legacy.name);assert.equal(migrated.user.auth_version,2);
  const rotatedInput=commitInput(migrated.user,migrated.vault,replacement,'rotate-recovery',3);delete rotatedInput.registrationRecord;
  const rotated=s.commitOpaque(rotatedInput,session());assert.equal(rotated.user.opaque_record,migrated.user.opaque_record);assert.notEqual(rotated.user.recovery_auth_hash,migrated.user.recovery_auth_hash);assert.equal(rotated.user.auth_version,3);
});

test('late session failure rolls back every security change and logout-all invalidates already-consumed login proofs',async t=>{
  const {store:s}=await fixture(t),initial=registration(s),other=registration(s,'other');
  const input=commitInput(initial.user,initial.vault,initial.token);
  assert.throws(()=>s.commitOpaque(input,other.token));
  assert.deepEqual(s.opaqueAccountById('owner'),initial.user);assert.deepEqual(s.readVault('owner',initial.token.tokenHash),initial.vault);
  s.createOpaqueChallenge(challenge('login-grant',{ownerId:'owner',authVersion:1}));
  const taken=s.takeOpaqueChallenge(hash('login-grant'),'login',hash('source'));
  s.sensitiveOpaque({kind:'logout-all',ownerId:'owner',authVersion:1,sessionHash:initial.token.tokenHash});
  assert.equal(s.session(initial.token.tokenHash),null);assert.equal(s.opaqueAccountById('owner').auth_version,2);
  assert.throws(()=>s.loginOpaque({ownerId:'owner',authVersion:taken.authVersion},session()),fails(401));
  const newSession=session();s.loginOpaque({ownerId:'owner',authVersion:2},newSession);
  s.sensitiveOpaque({kind:'delete-account',ownerId:'owner',authVersion:2,sessionHash:newSession.tokenHash});
  assert.equal(s.opaqueAccountById('owner'),null);assert.equal(s.session(newSession.tokenHash),null);assert.deepEqual(s.readVault('other',other.token.tokenHash),other.vault);
});

test('legacy repository login, password confirmation, password change, all-session logout and deletion remain compatible',async t=>{
  const {store:s}=await fixture(t),legacy={id:'legacy',username:'legacy-user',password_hash:'synthetic-hash',name:'Legacy'},one=session(),two=session();
  s.register(legacy,one);s.login(legacy,two);
  const saved=s.writeVault(legacy.id,one.tokenHash,envelope(legacy.id,0,1,1));
  assert.equal(s.securityInfo(legacy.id,two.tokenHash).activeSessionCount,2);
  s.verifyPassword(legacy.id,one.tokenHash,legacy.password_hash);
  assert.throws(()=>s.verifyPassword(legacy.id,one.tokenHash,'stale'),fails(401));
  const replacement=session(),changed=s.changePassword(legacy.id,one.tokenHash,legacy.password_hash,'new-synthetic-hash',replacement);
  assert.equal(changed.user.auth_mode,'legacy-scrypt');assert.equal(changed.security.activeSessionCount,1);
  assert.equal(s.session(one.tokenHash),null);assert.equal(s.session(two.tokenHash),null);
  assert.deepEqual(s.readVault(legacy.id,replacement.tokenHash),saved);
  assert.throws(()=>s.login(legacy,session()),fails(401));
  s.logoutAll(legacy.id,replacement.tokenHash,changed.user.password_hash);assert.equal(s.session(replacement.tokenHash),null);
  const last=session();s.login(changed.user,last);s.deleteAccount(legacy.id,last.tokenHash,changed.user.password_hash);
  assert.equal(s.accountByUsername(legacy.username),null);assert.equal(s.session(last.tokenHash),null);
});
