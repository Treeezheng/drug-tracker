import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as opaque from '@serenity-kit/opaque';
import { createOpaqueService } from '../server/cloud-opaque.mjs';
import { openCloudSqlite } from '../server/cloud-sqlite.mjs';
import { rateSource, requireLoopbackProxy } from '../server/cloud-limits.mjs';

const bytes=size=>randomBytes(size).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const password='SYNTHETIC crystal walnut meadow 4318!';
const identifiers={client:'synthetic-admission-owner',server:'drug-tracker:opaque:v1'};
const ksf={'argon2id-custom':{memory:65536,iterations:3,parallelism:1}};
const newSession=()=>{const value=bytes(32);return{value,tokenHash:hash(value),expiresAt:Date.now()+86400000};};
const envelope=ownerId=>{
  const common={protocol:'dose-timeline-vault',ownerId,cipher:'AES-256-GCM',iv:bytes(12)};
  return{dataEnvelope:{...common,version:1,kind:'data',ciphertext:bytes(17)},keyEnvelope:{...common,version:3,kind:'wrapped-key',ciphertext:bytes(48),kdf:{name:'OPAQUE-export',hash:'SHA-256',context:identifiers.server,salt:bytes(16)}}};
};

test('OPAQUE verifies one-time credentials before invoking protected vault work, including login downloads',async t=>{
  await opaque.ready;
  const directory=await mkdtemp(join(tmpdir(),'drug-admission-unit-'));
  const repository=openCloudSqlite(join(directory,'synthetic.sqlite'));
  t.after(async()=>{repository.close();await rm(directory,{recursive:true,force:true});});
  const service=await createOpaqueService({repository,work:operation=>operation(),rateLimit:async()=>{},newSession});
  let vaultAdmissions=0;
  const call=(path,input,extra={})=>service.handle({path,method:'POST',input,source:'192.0.2.21',withVault:async operation=>{vaultAdmissions++;return operation();},...extra});
  const start=opaque.client.startRegistration({password});
  const begun=await call('/register/start',{username:identifiers.client,registrationRequest:start.registrationRequest});
  const registration=opaque.client.finishRegistration({password,clientRegistrationState:start.clientRegistrationState,registrationResponse:begun.body.registrationResponse,identifiers,keyStretching:ksf});
  const input={challengeId:begun.body.challengeId,registrationRecord:registration.registrationRecord,...envelope(begun.body.ownerId),recoveryAuthHash:hash(randomBytes(32))};
  // A stale/missing one-time credential is an ordinary failed retry, never a vault operation.
  await assert.rejects(call('/register/finish',{...input,challengeId:bytes(32)}),error=>error.status===401);
  assert.equal(vaultAdmissions,0);
  const account=await call('/register/finish',input);
  assert.equal(account.status,201);assert.equal(vaultAdmissions,1);
  await assert.rejects(call('/register/finish',input),error=>error.status===401);
  assert.equal(vaultAdmissions,1);
  const login=opaque.client.startLogin({password});
  const challenge=await call('/login/start',{username:identifiers.client,startLoginRequest:login.startLoginRequest});
  const proof=opaque.client.finishLogin({password,clientLoginState:login.clientLoginState,loginResponse:challenge.body.loginResponse,identifiers,keyStretching:ksf});
  const signed=await call('/login/finish',{challengeId:challenge.body.challengeId,finishLoginRequest:proof.finishLoginRequest});
  assert.equal(signed.status,200);assert.ok(signed.body.vault);assert.equal(vaultAdmissions,2);
  const recovery=await call('/recover/start',{ownerId:account.body.user.id,registrationRequest:start.registrationRequest});
  await assert.rejects(call('/recover/authorize',{challengeId:recovery.body.challengeId,recoveryAuthSecret:bytes(32)}),error=>error.status===401);
  assert.equal(vaultAdmissions,2);
});

test('Caddy source attribution requires configured loopback and its overwritten single-IP header',()=>{
  const request=(remoteAddress,headers={})=>({socket:{remoteAddress},headers});
  const first=request('127.0.0.1',{'x-drug-client-ip':'192.0.2.1','x-forwarded-for':'203.0.113.99'});
  const second=request('127.0.0.1',{'x-drug-client-ip':'192.0.2.2','x-forwarded-for':'203.0.113.99'});
  assert.equal(rateSource(first,'caddy-loopback'),'192.0.2.1');
  assert.equal(rateSource(second,'caddy-loopback'),'192.0.2.2');
  assert.equal(rateSource(first), '127.0.0.1');
  assert.equal(rateSource(request('::1',{'x-drug-client-ip':'2001:0db8:0:0:0:0:0:1'}),'caddy-loopback'),'2001:db8::1');
  assert.doesNotThrow(()=>requireLoopbackProxy(request('::ffff:127.0.0.1')));
  assert.throws(()=>rateSource(request('192.0.2.3',first.headers),'caddy-loopback'),error=>error.status===403);
  for(const value of[undefined,'192.0.2.1, 192.0.2.2','invalid',['192.0.2.1']])assert.throws(()=>rateSource(request('127.0.0.1',{'x-drug-client-ip':value}),'caddy-loopback'),error=>error.status===400);
});
