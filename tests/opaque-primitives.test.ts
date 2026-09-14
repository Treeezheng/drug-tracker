import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as opaque from '@serenity-kit/opaque';
import { opaqueClient, opaqueIdentifiers, OPAQUE_KSF, OPAQUE_SERVER_ID } from '../src/lib/opaque-client.ts';
import { createSecureRecoveryKey, createVaultKey, decryptVault, encryptVault, exportRecoveryKey, readSecureRecoveryKey, unwrapVaultKeyOpaque, wrapVaultKeyOpaque, VaultDecryptionError, VAULT_DECRYPTION_ERROR } from '../src/lib/vault-crypto.ts';
import type { AppData } from '../src/lib/types.ts';

const username='synthetic-opaque-user',owner='synthetic-opaque-owner';
const password='合成 OPAQUE 密码 · orchard maple river 938';
const data:AppData={profile:null,doses:[],favorites:[],scenarios:[],inventory:[],checkins:[{id:'synthetic-checkin',date:'2026-09-13',note:'仅用于测试 🫖'}]};
const b64=(size:number,marker=1)=>Buffer.alloc(size,marker).toString('base64url');
const rejected=(promise:Promise<unknown>)=>assert.rejects(promise,error=>error instanceof VaultDecryptionError&&error.message===VAULT_DECRYPTION_ERROR&&!('cause' in error));

let registration:Promise<Awaited<ReturnType<typeof register>>>|undefined;
async function register(){
  await opaque.ready;
  const setup=opaque.server.createSetup();
  const started=await opaqueClient('startRegistration',{password});
  const response=opaque.server.createRegistrationResponse({serverSetup:setup,userIdentifier:owner,registrationRequest:started.registrationRequest});
  const finished=await opaqueClient('finishRegistration',{password,clientRegistrationState:started.clientRegistrationState,registrationResponse:response.registrationResponse,identifiers:opaqueIdentifiers(username),keyStretching:OPAQUE_KSF});
  return {setup,finished};
}
const registered=()=>registration??=register();
async function login(options:{password?:string;username?:string;owner?:string;server?:string}={}){
  const registeredUser=await registered(),entered=options.password??password;
  const start=await opaqueClient('startLogin',{password:entered});
  const response=opaque.server.startLogin({serverSetup:registeredUser.setup,userIdentifier:options.owner??owner,registrationRecord:registeredUser.finished.registrationRecord,startLoginRequest:start.startLoginRequest,identifiers:opaqueIdentifiers(username)});
  const finished=await opaqueClient('finishLogin',{password:entered,clientLoginState:start.clientLoginState,loginResponse:response.loginResponse,identifiers:{client:options.username??username,server:options.server??OPAQUE_SERVER_ID},keyStretching:OPAQUE_KSF});
  return {finished,response};
}

test('real OPAQUE registration and repeated login recover a stable client export key while session keys remain separate',async()=>{
  const original=await registered();
  assert.equal(original.finished.serverStaticPublicKey,opaque.server.getPublicKey(original.setup));
  assert.equal(Buffer.from(original.finished.registrationRecord,'base64url').byteLength,192);
  for(let index=0;index<2;index++){
    const {finished,response}=await login();assert.ok(finished);
    const server=opaque.server.finishLogin({serverLoginState:response.serverLoginState,finishLoginRequest:finished.finishLoginRequest,identifiers:opaqueIdentifiers(username)});
    assert.equal(finished.exportKey,original.finished.exportKey);assert.equal(finished.sessionKey,server.sessionKey);
    assert.notEqual(finished.exportKey,finished.sessionKey);assert.equal(Buffer.from(finished.exportKey,'base64url').byteLength,64);
    assert.equal(finished.serverStaticPublicKey,original.finished.serverStaticPublicKey);
  }
});

test('v3 key wrapping decrypts the original vault with a later client export key and rejects the server-shared session key',async()=>{
  const original=await registered(),{finished}=await login();assert.ok(finished);
  const dek=await createVaultKey(),encrypted=await encryptVault(data,dek,owner),before=structuredClone(encrypted);
  const wrapped=await wrapVaultKeyOpaque(dek,original.finished.exportKey,owner);
  assert.equal(wrapped.version,3);assert.equal(wrapped.kdf.name,'OPAQUE-export');
  const restored=await unwrapVaultKeyOpaque(wrapped,finished.exportKey,owner);
  assert.equal(await exportRecoveryKey(restored),await exportRecoveryKey(dek));
  assert.deepEqual(await decryptVault(encrypted,restored,owner),data);assert.deepEqual(encrypted,before);
  await rejected(unwrapVaultKeyOpaque(wrapped,finished.sessionKey,owner));
  await rejected(unwrapVaultKeyOpaque(wrapped,finished.exportKey,'other-owner'));
  await rejected(unwrapVaultKeyOpaque({...wrapped,ownerId:'other-owner'},finished.exportKey,'other-owner'));
});

test('wrong password, client identity, server identity or owner cannot complete the real PAKE login',async()=>{
  for(const options of [{password:`${password} changed`},{username:'different-user'},{server:'different-server'},{owner:'different-owner'}]){
    const {finished}=await login(options);assert.equal(finished,undefined);
  }
});

test('v3 wrapping uses fresh salt and nonce and rejects malformed or modified envelope fields without mutating input',async()=>{
  const {finished}=await registered(),key=await createVaultKey();
  const [one,two]=await Promise.all([wrapVaultKeyOpaque(key,finished.exportKey,owner),wrapVaultKeyOpaque(key,finished.exportKey,owner)]);
  assert.notEqual(one.iv,two.iv);assert.notEqual(one.kdf.salt,two.kdf.salt);assert.notEqual(one.ciphertext,two.ciphertext);
  const original=structuredClone(one);
  for(const bad of [null,{...one,version:4},{...one,extra:'unexpected'},{...one,iv:b64(11)},{...one,iv:`${one.iv}=`},{...one,ciphertext:b64(48,6)},{...one,kdf:{...one.kdf,context:'other-context'}},{...one,kdf:{...one.kdf,hash:'SHA-1'}},{...one,kdf:{...one.kdf,salt:b64(15)}},{...one,kdf:{...one.kdf,iterations:3}}])await rejected(unwrapVaultKeyOpaque(bad,finished.exportKey,owner));
  await rejected(unwrapVaultKeyOpaque(one,b64(32),owner));await rejected(unwrapVaultKeyOpaque(one,`${finished.exportKey}=`,owner));
  assert.deepEqual(one,original);
});

test('one recovery code contains independent 256-bit auth and data secrets with an exact server auth digest',async()=>{
  const dek=await createVaultKey(),encoded=await exportRecoveryKey(dek);
  const first=await createSecureRecoveryKey(dek,owner),second=await createSecureRecoveryKey(dek,owner);
  const parsed=await readSecureRecoveryKey(first.recoveryKey),again=await readSecureRecoveryKey(second.recoveryKey);
  assert.equal(parsed.ownerId,owner);assert.match(parsed.authToken,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(parsed.authToken,'base64url').byteLength,32);assert.notEqual(parsed.authToken,encoded);
  assert.notEqual(parsed.authToken,again.authToken);assert.notEqual(first.recoveryAuthHash,second.recoveryAuthHash);
  assert.match(first.recoveryAuthHash,/^[a-f0-9]{64}$/);
  assert.equal(first.recoveryAuthHash,createHash('sha256').update(Buffer.from(parsed.authToken,'base64url')).digest('hex'));
  assert.equal(await exportRecoveryKey(parsed.key),encoded);assert.equal(await exportRecoveryKey(again.key),encoded);
  const vault=await encryptVault(data,dek,owner);assert.deepEqual(await decryptVault(vault,parsed.key,parsed.ownerId),data);
  const foreign=await readSecureRecoveryKey(first.recoveryKey.replace(`.${owner}.`,'.different-owner.'));
  await rejected(decryptVault(vault,foreign.key,foreign.ownerId));
});

test('malformed recovery codes fail generically; copying outer whitespace keeps the exact two secrets',async()=>{
  const key=await createVaultKey(),{recoveryKey}=await createSecureRecoveryKey(key,owner),parsed=await readSecureRecoveryKey(` ${recoveryKey}\n`);
  assert.equal(await exportRecoveryKey(parsed.key),await exportRecoveryKey(key));
  const parts=recoveryKey.split('.');
  for(const bad of ['',recoveryKey.replace('DTR1','DTR2'),`${recoveryKey}.extra`,`${parts[0]}..${parts[2]}.${parts[3]}`,`${parts[0]}.${parts[1]}.${b64(31)}.${parts[3]}`,`${parts[0]}.${parts[1]}.${parts[2]}=.${parts[3]}`,`${parts[0]}.${parts[1]}.${parts[2]}.${b64(33)}`,'x'.repeat(225)])await rejected(readSecureRecoveryKey(bad));
});

test('a canceled primitive operation cannot return a password state or export key',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(opaqueClient('startRegistration',{password},controller.signal),error=>error instanceof DOMException&&error.name==='AbortError');
});
