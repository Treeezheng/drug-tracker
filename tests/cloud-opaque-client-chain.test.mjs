import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCloudServer } from '../server/cloud.mjs';
import { createCloudClient } from '../src/lib/cloud-client.ts';
import { decryptVault, readSecureRecoveryKey } from '../src/lib/vault-crypto.ts';
import { freshGuestWorkspace } from '../src/lib/guest-workspace.ts';
import { prepareGuestTransfer } from '../src/lib/guest-transfer.ts';
import { newDose } from '../src/components/DoseEditor.tsx';

const ORIGIN='https://synthetic-opaque-client.test';
const MASTER='Synthetic obsidian! meadow comet 5831';
const NEXT='Synthetic copper! glacier atlas 9147';
const RECOVERED='Synthetic saffron! kestrel marble 6249';
const LEGACY='Synthetic old account! orbit 6192';
const LEGACY_VAULT='Synthetic old encrypted! acacia 4813';
const profile={name:'SYNTHETIC OPAQUE HEALTH RECORD 7391',timeZone:'UTC',timeFormat:'24h',timeIncrementMinutes:5,sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
const status=expected=>error=>error.status===expected;

test('OPAQUE real API: guest transfer remains encrypted and commit-before-lock retries do not duplicate simulated rows',async t=>{
  const f=await fixture(t),a=f.device(),b=f.device();await a.client.registerSecure('guest-transfer-owner',MASTER);
  const owner=a.client.getState().user.id;await a.client.request('/profile','PUT',profile);
  const workspace=freshGuestWorkspace('UTC');workspace.date='2026-09-13';
  workspace.drafts=[{...newDose('ritalin','7.5'),timeZone:'UTC',date:'2026-09-13',time:'15:03',administeredAt:'2026-09-13T15:03:00Z',note:'SYNTHETIC guest transfer health note 61934'}];
  workspace.favorites=[{id:'guest-favorite',productId:'ritalin',strength:'7.5',packageStrength:'7.5',quantity:'1'}];
  const transfer=prepareGuestTransfer(workspace),before=await a.snapshot(owner);
  const admitted=a.delay('/vault','PUT'),upload=a.client.request('/guest-import','POST',transfer,owner);
  await admitted;a.client.lock();a.release();await assert.rejects(upload,status(401));
  assert.equal((await a.snapshot(owner)).revision,before.revision+1);
  await a.client.loginSecure('guest-transfer-owner',MASTER);
  assert.deepEqual(await a.client.request('/guest-import','POST',transfer,owner),{ok:true});
  await b.client.loginSecure('guest-transfer-owner',MASTER);
  const data=(await b.client.request('/export')).data;
  assert.equal(data.scenarios.length,1);assert.equal(data.scenarios[0].doses.length,1);
  assert.equal(data.profile.name,profile.name);assert.deepEqual(data.doses,[]);assert.equal(data.scenarios[0].doses[0].status,'simulated');
  assert.equal(data.scenarios[0].doses[0].note,workspace.drafts[0].note);assert.equal(data.favorites[0].packageStrength,'7.5');
  const wire=JSON.stringify(f.requests);assert.equal(wire.includes(workspace.drafts[0].note),false);assert.equal(wire.includes('/guest-import'),false);
  for(const file of [f.dbPath,`${f.dbPath}-wal`]){let bytes;try{bytes=await readFile(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}assert.equal(bytes.includes(Buffer.from(workspace.drafts[0].note)),false);}
  assert.equal(workspace.drafts.length,1);assert.equal(transfer.workspace.drafts.length,1);
});

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'drug-opaque-client-')),dbPath=join(dir,'synthetic.sqlite');
  const app=await createCloudServer({dbPath,origin:ORIGIN,loginAttemptLimit:500,registrationAttemptLimit:100,allowLegacyRegistration:true});
  try{await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});}
  catch(error){await app.closeStorage();await rm(dir,{recursive:true,force:true});throw error;}
  t.after(async()=>{await new Promise(resolve=>{app.server.close(resolve);app.server.closeIdleConnections();});await rm(dir,{recursive:true,force:true});});
  const requests=[];
  function device(options={}){
    let cookie='',dropPath='',dropAuth=false,failReconciliation=false,beforeCommit=false,delayPath='',delayMethod='',release,admitted;
    const fetcher=async(url,init={})=>{
      const path=String(url),method=init.method??'GET',body=init.body===undefined?undefined:String(init.body);
      requests.push({path,method,body});
      if(dropAuth&&path.endsWith('/auth/opaque/config')){dropAuth=false;throw new TypeError('Synthetic lost auth reconciliation');}
      if(beforeCommit&&dropPath&&path.endsWith(dropPath)){beforeCommit=false;dropPath='';dropAuth=failReconciliation;throw new TypeError('Synthetic connection failure before request');}
      const response=await new Promise((resolve,reject)=>{
        const request=httpRequest({hostname:'127.0.0.1',port:app.server.address().port,path,method,headers:{...Object.fromEntries(new Headers(init.headers)),Host:new URL(ORIGIN).host,...(!['GET','HEAD'].includes(method)?{Origin:ORIGIN}:{}),...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Length':Buffer.byteLength(body)})}},res=>{
          const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.once('error',reject);res.once('end',()=>{
            const headers=new Headers();for(const [name,value]of Object.entries(res.headers))for(const item of Array.isArray(value)?value:[value])if(item!==undefined)headers.append(name,item);
            const setCookie=headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));
          });
        });request.once('error',reject);request.end(body);
      });
      if(delayPath&&path.endsWith(delayPath)&&(!delayMethod||delayMethod===method)&&response.ok){delayPath='';admitted?.();await new Promise(resolve=>{release=resolve;});}
      if(dropPath&&path.endsWith(dropPath)&&response.ok){dropPath='';dropAuth=failReconciliation;throw new TypeError('Synthetic lost committed acknowledgement');}
      return response;
    };
    return {client:createCloudClient({...options,fetch:fetcher}),fetcher,
      drop(path,{reconciliation=false,before=false}={}){dropPath=path;beforeCommit=before;failReconciliation=reconciliation;},
      delay(path,method=''){delayPath=path;delayMethod=method;return new Promise(resolve=>{admitted=resolve;});},release(){release?.();},
      async snapshot(ownerId){const response=await fetcher('/drug/api/vault',{method:'GET',headers:{'X-Dose-Owner':ownerId}});assert.equal(response.status,200);return(await response.json()).vault;}
    };
  }
  return{device,requests,dbPath};
}

test('OPAQUE real API: one password opens an empty v3 vault, authenticates later, and never uses raw-password fallback',async t=>{
  const f=await fixture(t),a=f.device(),b=f.device();
  const recovery=await a.client.registerSecure('Synthetic.Owner',MASTER);const user=a.client.getState().user;
  assert.equal(user.username,'synthetic.owner');assert.equal(user.authMode,'opaque-v1');assert.equal(a.client.getState().locked,false);
  assert.deepEqual((await a.client.request('/export')).data,{profile:null,doses:[],scenarios:[],favorites:[],checkins:[],inventory:[]});
  await a.client.request('/profile','PUT',profile);
  await b.client.loginSecure('synthetic.owner',MASTER);assert.equal((await b.client.request('/export')).data.profile.name,profile.name);
  await assert.rejects(b.client.loginSecure('synthetic.owner','wrong password'),status(403));assert.equal(b.client.getState().locked,true);
  await assert.rejects(b.client.loginSecure('unknown-owner',MASTER),status(403));
  await b.client.loginSecure('synthetic.owner',MASTER);
  const wire=JSON.stringify(f.requests);for(const secret of [MASTER,recovery.recoveryKey,recovery.recoveryKey.split('.')[3],profile.name].filter(value=>typeof value==='string'))assert.equal(wire.includes(secret),false);
  assert.equal(f.requests.some(row=>/\/auth\/(login|register)$/.test(row.path)),false);
  const snapshot=await a.snapshot(user.id);assert.equal(snapshot.keyEnvelope.version,3);
  assert.equal((await decryptVault(snapshot.dataEnvelope,(await readSecureRecoveryKey(recovery.recoveryKey)).key,user.id)).profile.name,profile.name);
  for(const file of [f.dbPath,`${f.dbPath}-wal`]){let bytes;try{bytes=await readFile(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}for(const secret of [MASTER,recovery.recoveryKey,profile.name])assert.equal(bytes.includes(Buffer.from(secret)),false);}
});

test('OPAQUE real API: password change rewraps, recovery replaces both secrets, and old sessions and recovery tokens cannot read future records',async t=>{
  const f=await fixture(t),a=f.device(),b=f.device(),c=f.device();
  const initial=await a.client.registerSecure('recovery-owner',MASTER),owner=a.client.getState().user.id;
  await a.client.request('/profile','PUT',profile);await b.client.loginSecure('recovery-owner',MASTER);
  const before=await a.snapshot(owner);
  await assert.rejects(a.client.request('/auth/change-password','POST',{currentPassword:'wrong password',newPassword:NEXT}),status(403));
  await a.client.request('/auth/change-password','POST',{currentPassword:MASTER,newPassword:NEXT});
  assert.equal(await b.client.session(),null);const changed=await a.snapshot(owner);assert.deepEqual(changed.dataEnvelope,before.dataEnvelope);
  await assert.rejects(b.client.loginSecure('recovery-owner',MASTER),status(403));await b.client.loginSecure('recovery-owner',NEXT);
  const corrupt=initial.recoveryKey.split('.');corrupt[3]='A'.repeat(43);
  await assert.rejects(c.client.recoverSecure('recovery-owner',corrupt.join('.'),RECOVERED));
  await assert.rejects(c.client.recoverSecure('other-username',initial.recoveryKey,RECOVERED),status(400));
  const recovered=await c.client.recoverSecure('recovery-owner',initial.recoveryKey,RECOVERED);
  assert.equal((await c.client.request('/export')).data.profile.name,profile.name);assert.equal(await a.client.session(),null);assert.equal(await b.client.session(),null);
  const final=await c.snapshot(owner);await assert.rejects(decryptVault(final.dataEnvelope,(await readSecureRecoveryKey(initial.recoveryKey)).key,owner));
  assert.equal((await decryptVault(before.dataEnvelope,(await readSecureRecoveryKey(initial.recoveryKey)).key,owner)).profile.name,profile.name,'Old copied ciphertext cannot be revoked.');
  await assert.rejects(b.client.recoverSecure('recovery-owner',initial.recoveryKey,MASTER),status(401));
  await b.client.loginSecure('recovery-owner',RECOVERED);
  const rotated=await c.client.request('/vault/rotate-key','POST',{password:RECOVERED});assert.equal(await b.client.session(),null);
  await assert.rejects(b.client.recoverSecure('recovery-owner',recovered.recoveryKey,NEXT),status(401));
  assert.equal((await decryptVault((await c.snapshot(owner)).dataEnvelope,(await readSecureRecoveryKey(rotated.recoveryKey)).key,owner)).profile.name,profile.name);
  const wire=JSON.stringify(f.requests);for(const secret of [MASTER,NEXT,RECOVERED,initial.recoveryKey,recovered.recoveryKey,rotated.recoveryKey,...[initial.recoveryKey,recovered.recoveryKey,rotated.recoveryKey].map(code=>code.split('.')[3]),profile.name])assert.equal(wire.includes(secret),false);
  for(const row of f.requests.filter(row=>row.path.endsWith('/recover/authorize')))assert.deepEqual(Object.keys(JSON.parse(row.body)).sort(),['challengeId','recoveryAuthSecret']);
});

test('OPAQUE real API: lost atomic acknowledgements reconcile without another write, and lock cancels late registration state',async t=>{
  const f=await fixture(t),a=f.device();a.drop('/register/finish');
  const first=await a.client.registerSecure('lost-ack-owner',MASTER);assert.match(first.recoveryKey,/^DTR1\./);assert.equal(a.client.getState().revision,1);
  a.drop('/change/finish');await a.client.request('/auth/change-password','POST',{currentPassword:MASTER,newPassword:NEXT});assert.equal(a.client.getState().revision,2);
  a.drop('/rotate-recovery');const rotated=await a.client.request('/vault/rotate-key','POST',{password:NEXT});assert.match(rotated.recoveryKey,/^DTR1\./);assert.equal(a.client.getState().revision,3);
  const b=f.device(),admitted=b.delay('/register/finish');const creating=b.client.registerSecure('cancel-owner',MASTER);await admitted;b.client.lock();b.release();await assert.rejects(creating,status(401));assert.equal(b.client.getState().locked,true);
  await b.client.loginSecure('cancel-owner',MASTER);assert.equal(b.client.getState().locked,false,'Committed server creation remains recoverable using the new master password.');
});

test('OPAQUE real API: explicit legacy migration preserves records and supports an account without an old vault',async t=>{
  const f=await fixture(t),a=f.device(),b=f.device();const old=await a.client.register('legacy-owner',LEGACY);await a.client.login('legacy-owner',LEGACY);
  await a.client.setupVault(LEGACY_VAULT);await a.client.request('/profile','PUT',profile);
  await assert.rejects(a.client.migrateToSecure(LEGACY,LEGACY),status(400));
  const migration=await a.client.migrateToSecure(MASTER,LEGACY);assert.equal(a.client.getState().user.id,old.id);assert.equal(a.client.getState().user.authMode,'opaque-v1');assert.equal((await a.client.request('/export')).data.profile.name,profile.name);
  await assert.rejects(b.client.login('legacy-owner',LEGACY),status(401));await b.client.loginSecure('legacy-owner',MASTER);
  const c=f.device();const empty=await c.client.register('abandoned-owner',LEGACY);await c.client.login('abandoned-owner',LEGACY);await c.client.loadVault();await c.client.migrateToSecure(NEXT,LEGACY);assert.equal(c.client.getState().user.id,empty.id);assert.equal(c.client.getState().revision,1);assert.equal((await c.client.request('/export')).data.profile,null);
  const wire=JSON.stringify(f.requests);for(const secret of [MASTER,NEXT,LEGACY_VAULT,migration.recoveryKey,profile.name])assert.equal(wire.includes(secret),false);
});

test('OPAQUE real API: unconfirmed commits retain the exact recovery bundle, while pre-commit failures can restart with the same password',async t=>{
  const f=await fixture(t),a=f.device();a.drop('/register/finish',{reconciliation:true});
  await assert.rejects(a.client.registerSecure('uncertain-owner',MASTER),/unconfirmed/);
  await assert.rejects(a.client.registerSecure('uncertain-owner',NEXT),/same password/);
  const finishes=f.requests.filter(row=>row.path.endsWith('/register/finish')).length;
  const recovered=await a.client.registerSecure('uncertain-owner',MASTER);assert.match(recovered.recoveryKey,/^DTR1\./);assert.equal(a.client.getState().revision,1);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/register/finish')).length,finishes);
  a.drop('/rotate-recovery',{reconciliation:true});await assert.rejects(a.client.request('/vault/rotate-key','POST',{password:MASTER}),/unconfirmed/);
  await assert.rejects(a.client.request('/profile','PUT',profile),/unconfirmed encryption/);
  const rotations=f.requests.filter(row=>row.path.endsWith('/rotate-recovery')).length;
  const final=await a.client.request('/vault/rotate-key','POST',{password:MASTER});assert.match(final.recoveryKey,/^DTR1\./);assert.equal(a.client.getState().revision,2);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/rotate-recovery')).length,rotations);
  const b=f.device();b.drop('/register/finish',{before:true,reconciliation:true});await assert.rejects(b.client.registerSecure('before-commit-owner',MASTER),/unconfirmed/);
  const next=await b.client.registerSecure('before-commit-owner',MASTER);assert.match(next.recoveryKey,/^DTR1\./);assert.equal(b.client.getState().revision,1);
});

test('OPAQUE real API: stale security edits do not overwrite another device and legacy encryption methods fail before sending a master password',async t=>{
  const f=await fixture(t),a=f.device(),b=f.device();await a.client.registerSecure('conflict-owner',MASTER);await b.client.loginSecure('conflict-owner',MASTER);
  const saved=await b.client.request('/profile','PUT',profile);
  await assert.rejects(a.client.request('/auth/change-password','POST',{currentPassword:MASTER,newPassword:NEXT}),status(409));
  await assert.rejects(a.client.request('/vault/rotate-key','POST',{password:MASTER}),status(409));
  const count=f.requests.length;
  await assert.rejects(a.client.changeVaultPassword({vaultPassphrase:MASTER},NEXT,MASTER));
  await assert.rejects(a.client.rotateVaultKey({vaultPassphrase:MASTER},NEXT,MASTER));
  await assert.rejects(a.client.setupVault(MASTER));await assert.rejects(a.client.unlockVault({vaultPassphrase:MASTER}));
  assert.equal(f.requests.length,count,'Legacy secret methods reject before any request.');
  assert.equal((await a.client.request('/data')).profile.name,saved.name);
  await a.client.request('/auth/change-password','POST',{currentPassword:MASTER,newPassword:NEXT});assert.equal((await a.client.request('/export')).data.profile.name,saved.name);
});

test('OPAQUE real API: recovery with the same master can retry a pre-commit disconnect without replacing unconfirmed data',async t=>{
  const f=await fixture(t),a=f.device(),b=f.device();
  const original=await a.client.registerSecure('same-master-recovery',MASTER);await a.client.request('/profile','PUT',profile);
  const before=await a.snapshot(a.client.getState().user.id);
  b.drop('/recover/finish',{before:true,reconciliation:true});
  await assert.rejects(b.client.recoverSecure('same-master-recovery',original.recoveryKey,MASTER),/unconfirmed/);
  assert.equal((await a.snapshot(a.client.getState().user.id)).revision,before.revision);
  const recovered=await b.client.recoverSecure('same-master-recovery',original.recoveryKey,MASTER);
  assert.match(recovered.recoveryKey,/^DTR1\./);assert.equal(b.client.getState().revision,before.revision+1);
  assert.equal((await b.client.request('/export')).data.profile.name,profile.name);
  assert.equal(await a.client.session(),null);
});

test('OPAQUE real API: fresh purpose-bound confirmations revoke all sessions and delete the correct account',async t=>{
  const f=await fixture(t),a=f.device(),b=f.device();await a.client.registerSecure('sensitive-owner',MASTER);await b.client.loginSecure('sensitive-owner',MASTER);
  const signingOut=a.client.logoutAll(MASTER);assert.equal(a.client.getState().locked,true);await signingOut;assert.equal(await a.client.session(),null);assert.equal(await b.client.session(),null);
  await a.client.loginSecure('sensitive-owner',MASTER);await b.client.loginSecure('sensitive-owner',MASTER);
  await assert.rejects(a.client.deleteAccount('wrong password'),status(403));assert.equal(a.client.getState().locked,false);
  await a.client.deleteAccount(MASTER);assert.equal(a.client.getState().locked,true);assert.equal(await b.client.session(),null);await assert.rejects(b.client.loginSecure('sensitive-owner',MASTER),status(403));
  const wire=JSON.stringify(f.requests);assert.equal(wire.includes(MASTER),false);
  for(const row of f.requests.filter(row=>row.path.endsWith('/account')||row.path.endsWith('/auth/logout-all')))assert.deepEqual(Object.keys(JSON.parse(row.body)),['reauthGrant']);
});

test('OPAQUE real API: device enrollment and settings confirmation keep master passwords and keys off the network',async t=>{
  const f=await fixture(t);let marker='initial',record=null,clock=Date.now();
  const store={epoch:()=>marker,async read(){return structuredClone(record);},async save(value,expected){if(marker!==expected)return false;record=structuredClone(value);return true;},async revoke(){marker=crypto.randomUUID();record=null;}};
  const options={deviceUnlockStore:store,now:()=>clock},a=f.device(options);
  const recovery=await a.client.registerSecure('device-auto-owner',MASTER);await a.client.request('/profile','PUT',profile);
  await a.client.setAutoUnlockPreference(true);const expiresAt=record.expiresAt;
  a.client.lock({preserveAutoUnlock:true});
  const resumed=createCloudClient({...options,fetch:a.fetcher});
  assert.equal(await resumed.tryAutoUnlock(),true);assert.equal(record.expiresAt,expiresAt);
  await assert.rejects(resumed.setAutoUnlockPreference(true),/Confirm your password/);
  clock+=60_000;
  await assert.rejects(resumed.request('/auth/verify-password','POST',{password:'incorrect password'}),status(403));
  assert.equal((await resumed.request('/export')).data.profile.name,profile.name);
  await resumed.request('/auth/verify-password','POST',{password:MASTER});
  await resumed.setAutoUnlockPreference(true);assert.equal(record.expiresAt,expiresAt+60_000);
  assert.equal((await resumed.request('/export')).data.profile.name,profile.name);
  const serialized=JSON.stringify(f.requests);
  for(const secret of [MASTER,recovery.recoveryKey,recovery.recoveryKey.split('.')[3],profile.name])assert.equal(serialized.includes(secret),false);
  assert.equal(f.requests.some(row=>row.path.endsWith('/auth/verify-password')||row.path.endsWith('/device-unlock')),false);
  await resumed.request('/auth/change-password','POST',{currentPassword:MASTER,newPassword:NEXT});assert.equal(record,null);
  assert.equal((await resumed.request('/export')).data.profile.name,profile.name);
  await resumed.setAutoUnlockPreference(true);assert.ok(record);
  await resumed.request('/vault/rotate-key','POST',{password:NEXT});assert.equal(record,null);
});

test('OPAQUE real API: initial authentication cannot enroll over a later peer revocation',async t=>{
  for(const stage of ['register-start','register-finish','login-finish','recover-start','after-login']){
    const f=await fixture(t);let marker='initial',record=null;
    const store={epoch:()=>marker,async read(){return structuredClone(record);},async save(value,expected){if(marker!==expected)return false;record=structuredClone(value);return true;},async revoke(){marker=crypto.randomUUID();record=null;}};
    const a=f.device({deviceUnlockStore:store}),peer=createCloudClient({deviceUnlockStore:store,fetch:a.fetcher});
    let recovery;
    if(!stage.startsWith('register')){recovery=await a.client.registerSecure('initial-device-owner',MASTER);a.client.lock();}
    if(stage==='after-login'){
      await a.client.loginSecure('initial-device-owner',MASTER);
      await peer.setAutoUnlockPreference(false);
    }else{
      const path=stage==='recover-start'?'/auth/opaque/recover/authorize':`/auth/opaque/${stage.replace('-','/')}`;
      const admitted=a.delay(path);
      const authenticating=stage.startsWith('register')?a.client.registerSecure('initial-device-owner',MASTER)
        :stage==='recover-start'?a.client.recoverSecure('initial-device-owner',recovery.recoveryKey,NEXT)
        :a.client.loginSecure('initial-device-owner',MASTER);
      await admitted;await peer.setAutoUnlockPreference(false);a.release();await authenticating;
    }
    assert.equal(a.client.getState().locked,false,`${stage}: password authentication still opens this page`);
    await assert.rejects(a.client.setAutoUnlockPreference(true),/Confirm your password/,stage);
    assert.equal(record,null,stage);assert.equal(await peer.tryAutoUnlock(),false,stage);
    await a.client.request('/auth/verify-password','POST',{password:stage==='recover-start'?NEXT:MASTER});
    await a.client.setAutoUnlockPreference(true);assert.ok(record,`${stage}: a new explicit confirmation can enroll`);
  }
});
