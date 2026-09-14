import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as validators from '../src/lib/crypto-worker-messages';
import * as opaque from '@serenity-kit/opaque';

function fixture(file:'opaque'|'vault-kdf',options:{ready?:Promise<void>;wrongGlobal?:boolean}={}){
  const calls:unknown[]=[],replies:Record<string,unknown>[]=[],transfers:unknown[]=[];
  class DedicatedScope {
    onmessage!: (event:MessageEvent)=>Promise<void>;
    closed=false;
    postMessage(value:Record<string,unknown>,transfer?:unknown){replies.push(value);transfers.push(transfer);}
    close(){this.closed=true;}
  }
  const scope=new DedicatedScope();
  const source=readFileSync(new URL(`../src/lib/${file}.worker.ts`,import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  runInNewContext(code,{exports:{},DedicatedWorkerGlobalScope:DedicatedScope,self:options.wrongGlobal?{}:scope,
    require(name:string){
      if(name==='./crypto-worker-messages')return validators;
      if(name==='@serenity-kit/opaque')return {ready:options.ready??Promise.resolve(),client:Object.fromEntries(['startRegistration','finishRegistration','startLogin','finishLogin'].map(operation=>[operation,(params:unknown)=>{calls.push({operation,params});return {ok:true};}]))};
      if(name==='hash-wasm')return {argon2id:async(params:unknown)=>{calls.push(params);return new Uint8Array(32).fill(1);}};
      throw new Error('Unexpected worker dependency.');
    }});
  return {scope,calls,replies,transfers};
}
const message=(data:unknown,patch:Record<string,unknown>={}):MessageEvent=>({data,isTrusted:true,origin:'',source:null,ports:[],...patch}) as unknown as MessageEvent;
const opaqueInput=()=>({operation:'startLogin',params:{password:'Synthetic worker protocol test'}});
const kdfInput=()=>({password:new TextEncoder().encode('Synthetic derivation test'),salt:new Uint8Array(16).fill(17)});

test('all four real OPAQUE payloads pass the worker schema and preserve the registered export key',async()=>{
  await opaque.ready;
  const password='Synthetic protocol compatibility! 5317',owner='synthetic-owner',identifiers={client:'synthetic-user',server:'drug-tracker:opaque:v1'};
  const keyStretching={'argon2id-custom':{memory:65536,iterations:3,parallelism:1}},serverSetup=opaque.server.createSetup();
  const registrationStart={password};validators.readOpaqueWorkerRequest({operation:'startRegistration',params:registrationStart});
  const start=opaque.client.startRegistration(registrationStart);
  const {registrationResponse}=opaque.server.createRegistrationResponse({serverSetup,userIdentifier:owner,registrationRequest:start.registrationRequest});
  const registrationFinish={password,clientRegistrationState:start.clientRegistrationState,registrationResponse,identifiers,keyStretching};
  validators.readOpaqueWorkerRequest({operation:'finishRegistration',params:registrationFinish});
  const registered=opaque.client.finishRegistration(registrationFinish);
  const loginStart={password};validators.readOpaqueWorkerRequest({operation:'startLogin',params:loginStart});
  const login=opaque.client.startLogin(loginStart);
  const serverLogin=opaque.server.startLogin({serverSetup,userIdentifier:owner,registrationRecord:registered.registrationRecord,startLoginRequest:login.startLoginRequest,identifiers});
  const loginFinish={password,clientLoginState:login.clientLoginState,loginResponse:serverLogin.loginResponse,identifiers,keyStretching};
  validators.readOpaqueWorkerRequest({operation:'finishLogin',params:loginFinish});
  const finished=opaque.client.finishLogin(loginFinish)!;
  assert.equal(finished.exportKey,registered.exportKey);
  assert.equal(opaque.server.finishLogin({serverLoginState:serverLogin.serverLoginState,finishLoginRequest:finished.finishLoginRequest,identifiers}).sessionKey,finished.sessionKey);
});

test('workers reject Window globals and accept only browser-trusted private-channel metadata',async()=>{
  for(const file of ['opaque','vault-kdf'] as const){
    assert.throws(()=>fixture(file,{wrongGlobal:true}),/dedicated worker/);
    const {scope,calls,replies}=fixture(file),input=file==='opaque'?opaqueInput():kdfInput();
    for(const patch of [{isTrusted:false},{origin:'https://untrusted.test'},{origin:'null'},{source:{}},{ports:[{}]}])await scope.onmessage(message(input,patch));
    assert.equal(calls.length,0);assert.equal(replies.length,0);
    await scope.onmessage(message(input));assert.equal(calls.length,1);assert.equal(replies.length,1);assert.equal(scope.closed,true);
  }
});

test('a disposable OPAQUE worker cannot start a second operation while WASM readiness is pending',async()=>{
  let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;}),{scope,calls,replies}=fixture('opaque',{ready});
  const first=scope.onmessage(message(opaqueInput()));await scope.onmessage(message(opaqueInput()));
  assert.equal(calls.length,0);release();await first;
  assert.equal(calls.length,1);assert.equal(replies.length,1);assert.equal(scope.closed,true);
});

test('OPAQUE worker fields are bounded and cannot change method, protocol identifiers or KDF cost',async()=>{
  const finish={operation:'finishLogin',params:{password:'Synthetic protocol password',clientLoginState:'A'.repeat(256),loginResponse:'A'.repeat(427),identifiers:{client:'synthetic-user',server:'drug-tracker:opaque:v1'},keyStretching:{'argon2id-custom':{memory:65536,iterations:3,parallelism:1}}}};
  assert.equal(validators.readOpaqueWorkerRequest(finish).operation,'finishLogin');
  const wrongCost=structuredClone(finish);wrongCost.params.keyStretching['argon2id-custom'].memory=2**30;
  const wrongIdentity=structuredClone(finish);wrongIdentity.params.identifiers.server='another protocol';
  for(const input of [null,[],{operation:'constructor',params:{}},{operation:'startLogin',params:{password:'a'.repeat(513)}},{...opaqueInput(),extra:true},wrongCost,wrongIdentity]){
    const {scope,calls,replies}=fixture('opaque');await scope.onmessage(message(input));assert.equal(calls.length,0);assert.deepEqual(replies.map(reply=>reply.error),['Secure authentication failed.']);assert.equal(scope.closed,true);
  }
  let accessed=false;const input=opaqueInput();Object.defineProperty(input,'operation',{get(){accessed=true;return 'startLogin';},enumerable:true});
  assert.throws(()=>validators.readOpaqueWorkerRequest(input));assert.equal(accessed,false);
});

test('KDF worker rejects malformed and shared inputs without throwing outside its handler and clears accepted buffers',async()=>{
  for(const input of [null,{password:'raw text',salt:new Uint8Array(16)},{password:new Uint8Array(4097),salt:new Uint8Array(16)},{password:new Uint8Array(32),salt:new Uint8Array(15)},{password:new Uint8Array(new SharedArrayBuffer(32)),salt:new Uint8Array(16)}]){
    const {scope,calls,replies}=fixture('vault-kdf');await scope.onmessage(message(input));assert.equal(calls.length,0);assert.deepEqual(replies.map(reply=>reply.error),['Key derivation failed.']);assert.equal(scope.closed,true);
  }
  const input=kdfInput(),{scope,calls,replies,transfers}=fixture('vault-kdf');await scope.onmessage(message(input));
  assert.equal(calls.length,1);assert.equal((replies[0].result as Uint8Array).byteLength,32);assert.ok(transfers[0]);
  assert.equal(input.password.every(byte=>byte===0),true);assert.equal(input.salt.every(byte=>byte===0),true);
  assert.equal(validators.readKdfWorkerRequest({password:new Uint8Array(4096),salt:new Uint8Array(16)}).password.byteLength,4096);
});
