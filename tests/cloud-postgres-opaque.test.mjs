import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Pool } from 'pg';
import * as opaque from '@serenity-kit/opaque';
import { createCloudServer } from '../server/cloud.mjs';
import { openCloudPostgres } from '../server/cloud-postgres.mjs';
import { createCloudClient } from '../src/lib/cloud-client.ts';
import { opaqueIdentifiers,OPAQUE_KSF } from '../src/lib/opaque-client.ts';
import { decryptVault,readSecureRecoveryKey } from '../src/lib/vault-crypto.ts';
import { dropDisconnectedTestDatabase } from './helpers/postgres-cleanup.mjs';

const origin='https://opaque-synthetic.example',master='SYNTHETIC gentle compass orbit 9483!',next='SYNTHETIC granite river hazel 7482!';
const hash=value=>createHash('sha256').update(value).digest('hex');
const session=()=>({tokenHash:hash(randomBytes(32)),expiresAt:Date.now()+86400000});
const fail=status=>error=>error.status===status;
const testUrl=process.env.DRUG_TEST_POSTGRES_URL;

test('real PostgreSQL OPAQUE transactions and cross-process HTTP authentication', {skip:!testUrl,timeout:60000},async t=>{
  await opaque.ready;
  const url=new URL(testUrl);assert.ok(['127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.search,'');
  const admin=new Pool({connectionString:url.toString(),ssl:false}),database=`drug_opaque_${randomBytes(8).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${database}`);url.pathname='/'+database;
  const options={databaseUrl:url.toString(),allowInsecurePostgresLoopback:true};
  const control=new Pool({connectionString:url.toString(),ssl:false,max:3});
  const repos=await Promise.all([openCloudPostgres(options),openCloudPostgres(options)]);
  const apps=[];const requests=[];
  t.after(async()=>{
    for(const app of apps){await new Promise(resolve=>{app.server.close(resolve);app.server.closeAllConnections();});await app.closeStorage();}
    await Promise.all(repos.map(repo=>repo.close()));await control.end();
    try { await dropDisconnectedTestDatabase(admin,database); }
    finally { await admin.end(); }
  });
  for(let i=0;i<2;i++){const app=await createCloudServer({...options,origin,proxyMode:'heroku',loginAttemptLimit:500,registrationAttemptLimit:100});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));apps.push(app);}
  function device(index=0,source='192.0.2.48'){
    let cookie;
    const fetcher=async(path,init={})=>{
      const method=init.method??'GET',body=init.body===undefined?undefined:String(init.body);requests.push({path,body});
      return new Promise((resolve,reject)=>{
        const req=httpRequest({host:'127.0.0.1',port:apps[index].server.address().port,path:String(path),method,headers:{...Object.fromEntries(new Headers(init.headers)),Host:new URL(origin).host,'X-Forwarded-Proto':'https','X-Forwarded-For':source,...(!['GET','HEAD'].includes(method)?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Length':Buffer.byteLength(body)}:{})}},res=>{
          const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.once('end',()=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];const headers=new Headers();for(const [key,value]of Object.entries(res.headers))for(const item of Array.isArray(value)?value:[value])if(item!==undefined)headers.append(key,item);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));});res.once('error',reject);
        });req.once('error',reject);req.end(body);
      });
    };
    const raw=async(path,body,owner,method=body===undefined?'GET':'POST')=>{const response=await fetcher('/drug/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(owner?{'X-Dose-Owner':owner}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json(),headers:response.headers};};
    return{client:createCloudClient({fetch:fetcher}),raw,get tokenHash(){return hash(cookie.split('=')[1]);}};
  }
  const a=device(),b=device(1),other=device(1,'192.0.2.49');let owner,recovery;
  await t.test('the setup is initialized once and real PAKE opens the same private v3 vault across instances',async()=>{
    assert.deepEqual((await a.raw('/auth/opaque/config')).data,(await b.raw('/auth/opaque/config')).data);
    recovery=await a.client.registerSecure('pg-opaque-owner',master);owner=a.client.getState().user.id;
    const createdSession=(await control.query('SELECT created_at,expires_at FROM drug_tracker.sessions WHERE token_hash=$1',[a.tokenHash])).rows[0];
    const issuedLifetime=Number(createdSession.expires_at)-Date.parse(createdSession.created_at);
    assert.ok(issuedLifetime>604790000&&issuedLifetime<=604800000,'OPAQUE registration creates a fixed seven-day session.');
    const security=await a.raw('/security',undefined,owner);assert.equal(security.status,200);assert.equal(security.data.security.sessionLifetimeHours,168);
    await a.client.request('/profile','PUT',{name:'SYNTHETIC PRIVATE PG PROFILE',timeZone:'UTC',timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''});
    await b.client.loginSecure('pg-opaque-owner',master);
    assert.equal((await b.client.request('/export')).data.profile.name,'SYNTHETIC PRIVATE PG PROFILE');
    await other.client.registerSecure('pg-unrelated-owner',next);
    assert.equal((await other.raw('/vault',undefined,owner)).status,401);
    const raw=JSON.stringify((await control.query('SELECT * FROM drug_tracker.accounts')).rows)+JSON.stringify((await control.query('SELECT * FROM drug_tracker.vaults')).rows);
    for(const secret of [master,next,recovery.recoveryKey,'SYNTHETIC PRIVATE PG PROFILE'])assert.equal(raw.includes(secret),false);
    const row=(await control.query('SELECT auth_mode,password_hash,auth_version FROM drug_tracker.accounts WHERE id=$1',[owner])).rows[0];assert.equal(row.auth_mode,'opaque-v1');assert.equal(row.password_hash,'!opaque-v1');assert.equal(Number(row.auth_version),1);
    await assert.rejects(repos[0].getOrCreateOpaqueSetup(opaque.server.createSetup(),opaque.server.createSetup()),fail(400));
  });
  await t.test('normal OPAQUE logins and registration prune expired sessions while preserving current devices',async()=>{
    const expired=session();
    await repos[0].loginOpaque({ownerId:owner,authVersion:1},expired);
    await control.query('UPDATE drug_tracker.sessions SET expires_at=$1 WHERE token_hash=$2',[Date.now()-1000,expired.tokenHash]);
    assert.equal(await repos[0].session(expired.tokenHash),null);
    await repos[1].loginOpaque({ownerId:owner,authVersion:1},session());
    assert.equal((await control.query('SELECT 1 FROM drug_tracker.sessions WHERE token_hash=$1',[expired.tokenHash])).rowCount,0);
    const anotherExpired=session();
    await repos[0].loginOpaque({ownerId:owner,authVersion:1},anotherExpired);
    await control.query('UPDATE drug_tracker.sessions SET expires_at=$1 WHERE token_hash=$2',[Date.now()-1000,anotherExpired.tokenHash]);
    await device().client.registerSecure('pg-expiry-cleanup-owner',next);
    assert.equal((await control.query('SELECT 1 FROM drug_tracker.sessions WHERE token_hash=$1',[anotherExpired.tokenHash])).rowCount,0);
    for(const current of[a,b,other])assert.ok(await repos[0].session(current.tokenHash));
  });
  await t.test('one-time challenges bind their transport source and purpose and never reveal owner on login start',async()=>{
    const first=opaque.client.startLogin({password:master});
    const start=await a.raw('/auth/opaque/login/start',{username:'pg-opaque-owner',startLoginRequest:first.startLoginRequest});assert.equal(start.status,200);assert.equal(Object.hasOwn(start.data,'ownerId'),false);
    const proof=opaque.client.finishLogin({password:master,clientLoginState:first.clientLoginState,loginResponse:start.data.loginResponse,identifiers:opaqueIdentifiers('pg-opaque-owner'),keyStretching:OPAQUE_KSF});
    const body={challengeId:start.data.challengeId,finishLoginRequest:proof.finishLoginRequest};
    assert.equal((await other.raw('/auth/opaque/login/finish',body)).status,401);
    assert.equal((await a.raw('/auth/opaque/reauth/finish',body,owner)).status,401);
    assert.equal((await b.raw('/auth/opaque/login/finish',body)).status,200);
    assert.equal((await a.raw('/auth/opaque/login/finish',body)).status,401);
    assert.equal((await a.raw('/auth/login',{username:'pg-opaque-owner',password:'not a master password'})).status,410);
    assert.equal((await a.raw('/auth/register',{username:'disabled',password:'not a master password'})).status,410);
  });
  await t.test('a changed password atomically rewraps, invalidates old sessions and preserves ciphertext and recovery',async()=>{
    const before=(await b.raw('/vault',undefined,owner)).data.vault,oldVersion=Number((await repos[0].opaqueAccountById(owner)).auth_version);
    await b.client.request('/auth/change-password','POST',{currentPassword:master,newPassword:next});
    assert.equal(await a.client.session(),null);
    const after=(await b.raw('/vault',undefined,owner)).data.vault;assert.deepEqual(after.dataEnvelope,before.dataEnvelope);assert.notDeepEqual(after.keyEnvelope,before.keyEnvelope);
    await assert.rejects(repos[0].loginOpaque({ownerId:owner,authVersion:oldVersion},session()),fail(401));
    await a.client.loginSecure('pg-opaque-owner',next);
    assert.equal((await decryptVault(after.dataEnvelope,(await readSecureRecoveryKey(recovery.recoveryKey)).key,owner)).profile.name,'SYNTHETIC PRIVATE PG PROFILE');
  });
  await t.test('credential CAS and transaction-end session failure roll back all auth, recovery and encrypted data',async()=>{
    const account=await repos[0].opaqueAccountById(owner),before=await repos[0].readVault(owner,b.tokenHash),unrelated=await repos[1].opaqueAccountById(other.client.getState().user.id);
    const replacementKey={...before.keyEnvelope,iv:randomBytes(12).toString('base64url')};
    const input={kind:'change',ownerId:owner,authVersion:Number(account.auth_version),sessionHash:b.tokenHash,registrationRecord:account.opaque_record,vaultInput:{expectedRevision:before.revision,dataEnvelope:before.dataEnvelope,keyEnvelope:replacementKey}};
    await assert.rejects(repos[0].commitOpaque(input,{tokenHash:other.tokenHash,expiresAt:Date.now()+86400000}),error=>error.code==='23505');
    assert.deepEqual(await repos[1].opaqueAccountById(owner),account);assert.deepEqual(await repos[1].readVault(owner,b.tokenHash),before);
    const bad={...input,vaultInput:{...input.vaultInput,expectedRevision:before.revision-1}};await assert.rejects(repos[1].commitOpaque(bad,session()),fail(409));
    assert.deepEqual(await repos[0].opaqueAccountById(unrelated.id),unrelated);
    await assert.rejects(repos[0].writeVault(owner,b.tokenHash,input.vaultInput),fail(400));
  });
  await t.test('recovery changes both secrets, rejects a stale recovery claim and cannot restore another owner',async()=>{
    const fresh=device(1),account=await repos[0].opaqueAccountById(owner),before=(await b.raw('/vault',undefined,owner)).data.vault;
    const recovered=await fresh.client.recoverSecure('pg-opaque-owner',recovery.recoveryKey,master);
    assert.equal(await b.client.session(),null);assert.equal(await a.client.session(),null);
    const after=(await fresh.raw('/vault',undefined,owner)).data.vault;
    await assert.rejects(decryptVault(after.dataEnvelope,(await readSecureRecoveryKey(recovery.recoveryKey)).key,owner));
    assert.equal((await decryptVault(after.dataEnvelope,(await readSecureRecoveryKey(recovered.recoveryKey)).key,owner)).profile.name,'SYNTHETIC PRIVATE PG PROFILE');
    await assert.rejects(repos[0].commitOpaque({kind:'recover',ownerId:owner,authVersion:Number(account.auth_version),expectedRecoveryHash:account.recovery_auth_hash,registrationRecord:account.opaque_record,vaultInput:{expectedRevision:before.revision,dataEnvelope:before.dataEnvelope,keyEnvelope:before.keyEnvelope},recoveryAuthHash:hash(randomBytes(32))},session()),fail(401));
    assert.equal(other.client.getState().locked,false);assert.equal((await other.client.session()).id,other.client.getState().user.id);
    recovery=recovered;
    await b.client.loginSecure('pg-opaque-owner',master);
  });
  await t.test('logout-all invalidates already-claimed login state, deletes grants and allows only a fresh login',async()=>{
    const account=await repos[0].opaqueAccountById(owner),row={idHash:hash('claimed-synthetic'),kind:'login',ownerId:owner,username:account.username,sourceHash:hash('synthetic-source'),authVersion:Number(account.auth_version),sessionHash:null,expiresAt:Date.now()+120000,payload:{}};
    await repos[0].createOpaqueChallenge(row);assert.deepEqual(await repos[1].takeOpaqueChallenge(row.idHash,'login',row.sourceHash),row);
    await b.client.logoutAll(master);await assert.rejects(repos[1].loginOpaque({ownerId:owner,authVersion:row.authVersion},session()),fail(401));
    assert.equal((await control.query('SELECT count(*)::int AS n FROM drug_tracker.auth_challenges WHERE owner_id=$1',[owner])).rows[0].n,0);
    await b.client.loginSecure('pg-opaque-owner',master);await b.client.deleteAccount(master);
    assert.equal(await repos[0].opaqueAccountById(owner),null);assert.equal((await other.client.session()).id,other.client.getState().user.id);
    const sent=JSON.stringify(requests);for(const secret of [master,next,recovery.recoveryKey,'SYNTHETIC PRIVATE PG PROFILE'])assert.equal(sent.includes(secret),false);
  });
});
