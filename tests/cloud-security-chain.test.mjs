import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCloudServer } from '../server/cloud.mjs';
import { createCloudClient } from '../src/lib/cloud-client.ts';
import { decryptVault, importRecoveryKey } from '../src/lib/vault-crypto.ts';
import { ApiError } from '../src/lib/api.ts';

const ORIGIN='https://synthetic-drug-security.test';
const ACCOUNT='SYNTHETIC! account orbit maple 5831';
const INITIAL='SYNTHETIC! independent vault glacier 9451';
const REWRAPPED='SYNTHETIC! replacement vault meadow 3792';
const ROTATED='SYNTHETIC! rotated vault cobalt 8124';
const SECOND_ROTATION='SYNTHETIC! further vault cedar 6128';
const NEW_ACCOUNT='SYNTHETIC! new account comet 4761';
const profile={name:'SYNTHETIC HEALTH PROFILE 9173',timeZone:'UTC',timeFormat:'24h',timeIncrementMinutes:5,sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
const original=()=>({profile:{...profile},doses:[],scenarios:[],favorites:[],checkins:[],inventory:[]});
const denied=status=>error=>error instanceof ApiError&&error.status===status;

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'drug-security-chain-')),dbPath=join(dir,'only-synthetic.sqlite');
  const app=await createCloudServer({dbPath,origin:ORIGIN,allowLegacyRegistration:true});
  try{await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});}
  catch(error){app.closeStorage();await rm(dir,{recursive:true,force:true});throw error;}
  t.after(async()=>{await new Promise(resolve=>{app.server.close(resolve);app.server.closeIdleConnections();});await rm(dir,{recursive:true,force:true});});
  const requests=[];
  function device(){
    let cookie='',dropWrite=false,dropRead=false,dropNextRead=false;
    const fetcher=async(url,init={})=>{
      const path=String(url),method=init.method??'GET',body=init.body===undefined?undefined:String(init.body);
      requests.push({path,method,body});
      if(path.endsWith('/vault')&&method==='GET'&&dropNextRead){dropNextRead=false;throw new TypeError('Synthetic dropped reconciliation response');}
      const response=await new Promise((resolve,reject)=>{
        const request=httpRequest({hostname:'127.0.0.1',port:app.server.address().port,path,method,headers:{...Object.fromEntries(new Headers(init.headers)),Host:new URL(ORIGIN).host,...(!['GET','HEAD'].includes(method)?{Origin:ORIGIN}:{}),...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Length':Buffer.byteLength(body)})}},res=>{
          const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.once('error',reject);
          res.once('end',()=>{
            const headers=new Headers();for(const [name,value] of Object.entries(res.headers))for(const item of Array.isArray(value)?value:[value])if(item!==undefined)headers.append(name,item);
            const setCookie=headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
            resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));
          });
        });request.once('error',reject);request.end(body);
      });
      // Drop only after a genuine successful API response: the real server has committed.
      if(dropWrite&&path.endsWith('/vault')&&method==='PUT'&&response.ok){dropWrite=false;dropNextRead=dropRead;throw new TypeError('Synthetic lost committed acknowledgement');}
      return response;
    };
    return {client:createCloudClient({fetch:fetcher}),dropAcknowledgement(andReconciliation=false){dropWrite=true;dropRead=andReconciliation;},async snapshot(ownerId){const response=await fetcher('/drug/api/vault',{method:'GET',headers:{'X-Dose-Owner':ownerId}});assert.equal(response.status,200);return (await response.json()).vault;}};
  }
  return {device,requests,dbPath};
}

test('real cloud API composes fresh auth, rewrap, rotation, CAS, ambiguous-response retry and all-session revocation without exposing record secrets',async t=>{
  const f=await fixture(t),a=f.device(),b=f.device();
  const user=await a.client.register('synthetic_security_owner',ACCOUNT);
  const setup=await a.client.setupVault(INITIAL,original()),before=await a.snapshot(user.id);
  await b.client.login('synthetic_security_owner',ACCOUNT);await b.client.unlockVault({recoveryKey:setup.recoveryKey});
  assert.equal((await a.client.request('/security')).security.activeSessionCount,2);

  await assert.rejects(a.client.changeVaultPassword({vaultPassphrase:INITIAL},REWRAPPED,'wrong-account-password'),denied(403));
  assert.equal((await a.snapshot(user.id)).revision,1);
  await assert.rejects(a.client.changeVaultPassword({vaultPassphrase:'Wrong synthetic encryption password'},REWRAPPED,ACCOUNT));
  assert.equal((await a.snapshot(user.id)).revision,1);
  assert.deepEqual(await a.client.changeVaultPassword({vaultPassphrase:INITIAL},REWRAPPED,ACCOUNT),{recoveryKeyChanged:false});
  const rewrapped=await a.snapshot(user.id);
  assert.deepEqual(rewrapped.dataEnvelope,before.dataEnvelope);
  assert.equal(rewrapped.keyEnvelope.version,2);assert.equal(rewrapped.revision,2);
  b.client.lock();await assert.rejects(b.client.unlockVault({vaultPassphrase:INITIAL}));
  await b.client.unlockVault({recoveryKey:setup.recoveryKey});

  const saved=await b.client.request('/profile','PUT',{...profile,name:'SYNTHETIC second-device correction'});
  await assert.rejects(a.client.rotateVaultKey({vaultPassphrase:REWRAPPED},ROTATED,ACCOUNT),denied(409));
  assert.equal((await a.snapshot(user.id)).revision,3);
  assert.equal((await a.client.request('/data')).profile.name,saved.name);
  a.dropAcknowledgement();
  const rotated=await a.client.rotateVaultKey({vaultPassphrase:REWRAPPED},ROTATED,ACCOUNT);
  const current=await a.snapshot(user.id);assert.equal(current.revision,4);
  await assert.rejects(decryptVault(current.dataEnvelope,await importRecoveryKey(setup.recoveryKey),user.id));
  assert.equal((await decryptVault(current.dataEnvelope,await importRecoveryKey(rotated.recoveryKey),user.id)).profile.name,saved.name);
  await assert.rejects(b.client.request('/profile','PUT',{...saved,name:'SYNTHETIC stale write'}),denied(409));
  assert.equal((await a.snapshot(user.id)).revision,4);
  await a.client.request('/profile','PUT',{...saved,name:'SYNTHETIC future record'});
  await assert.rejects(decryptVault((await a.snapshot(user.id)).dataEnvelope,await importRecoveryKey(setup.recoveryKey),user.id));

  a.dropAcknowledgement(true);
  await assert.rejects(a.client.rotateVaultKey({recoveryKey:rotated.recoveryKey},SECOND_ROTATION,ACCOUNT),/unconfirmed/);
  await assert.rejects(a.client.request('/profile','PUT',{...saved,name:'Must not upload'}),/unconfirmed encryption/);
  const writes=f.requests.filter(row=>row.path.endsWith('/vault')&&row.method==='PUT').length;
  const retry=await a.client.rotateVaultKey({recoveryKey:rotated.recoveryKey},SECOND_ROTATION,ACCOUNT);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/vault')&&row.method==='PUT').length,writes);
  const final=await a.snapshot(user.id);assert.equal(final.revision,6);
  assert.equal((await decryptVault(final.dataEnvelope,await importRecoveryKey(retry.recoveryKey),user.id)).profile.name,'SYNTHETIC future record');
  assert.deepEqual(await decryptVault(before.dataEnvelope,await importRecoveryKey(setup.recoveryKey),user.id),original());

  await a.client.request('/auth/change-password','POST',{currentPassword:ACCOUNT,newPassword:NEW_ACCOUNT},user.id);
  assert.equal(a.client.getState().locked,false);
  assert.equal((await a.client.request('/security')).security.activeSessionCount,1);
  assert.equal(await b.client.session(),null); // Real prior session revoked by the account change.
  await b.client.login('synthetic_security_owner',NEW_ACCOUNT);await b.client.unlockVault({recoveryKey:retry.recoveryKey});
  const signingOut=a.client.request('/auth/logout-all','POST',{password:NEW_ACCOUNT},user.id);
  assert.equal(a.client.getState().locked,true);await signingOut;
  assert.equal(await a.client.session(),null);assert.equal(await b.client.session(),null);
  assert.equal(b.client.getState().locked,true);

  const wire=JSON.stringify(f.requests);
  for(const secret of [INITIAL,REWRAPPED,ROTATED,SECOND_ROTATION,setup.recoveryKey,rotated.recoveryKey,retry.recoveryKey,profile.name,'SYNTHETIC future record'])assert.equal(wire.includes(secret),false);
  for(const file of [f.dbPath,`${f.dbPath}-wal`]){
    let bytes;try{bytes=await readFile(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    for(const secret of [ACCOUNT,NEW_ACCOUNT,INITIAL,REWRAPPED,ROTATED,SECOND_ROTATION,profile.name,setup.recoveryKey,retry.recoveryKey])assert.equal(bytes.includes(Buffer.from(secret)),false);
  }
});
