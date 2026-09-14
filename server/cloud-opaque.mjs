import * as opaque from '@serenity-kit/opaque';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { CloudError } from './cloud-errors.mjs';
import { validateVaultWrite } from './vault-store.mjs';

const SERVER_ID='drug-tracker:opaque:v1', TTL=120_000;
const actions=['delete-account','logout-all','change-password','rotate-recovery'];
const bad=message=>{throw new CloudError(400,message);};
const denied=()=>{throw new CloudError(401,'Authentication could not be verified. Start again.');};
const digest=value=>createHash('sha256').update(value).digest('hex');
const publicUser=user=>({id:user.id,name:user.name,username:user.username,authMode:user.auth_mode??'legacy-scrypt'});
function exact(value,fields,optional=[]) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype
    ||fields.some(field=>!Object.hasOwn(value,field))||Object.keys(value).some(field=>![...fields,...optional].includes(field)))bad('Invalid authentication fields.');
  return value;
}
function binary(value,bytes) {
  if(typeof value!=='string'||value.length!==Math.ceil(bytes*4/3)||!/^[A-Za-z0-9_-]+$/.test(value))bad('Invalid authentication message.');
  const decoded=Buffer.from(value,'base64url');
  if(decoded.length!==bytes||decoded.toString('base64url')!==value)bad('Invalid authentication message.');
  return decoded;
}
function hashValue(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))bad('Invalid recovery verifier.');return value;}
function ownerValue(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value))bad('Invalid account identifier.');return value;}
function username(value){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(value.trim()))bad('Use a username of 3–64 letters, numbers, dots, underscores or hyphens.');return value.trim().toLowerCase();}
function revision(value){if(!Number.isSafeInteger(value)||value<0)bad('An exact vault revision is required.');return value;}
function vaultInput(input,expectedRevision=input.expectedRevision){const result={expectedRevision:revision(expectedRevision),dataEnvelope:input.dataEnvelope,keyEnvelope:input.keyEnvelope};if(result.keyEnvelope?.version!==3)bad('Use the OPAQUE export-key envelope.');return result;}
function accountOpaque(user){if(!user||user.auth_mode!=='opaque-v1')denied();return user;}

/** No master password, export key or DEK is accepted by this service. The sole raw
 * password field is confined to the explicitly chosen legacy migration route. */
export async function createOpaqueService({repository,serverSetupOverride,work,rateLimit,newSession,verifyLegacyPassword}) {
  await opaque.ready;
  if(serverSetupOverride!==undefined)binary(serverSetupOverride,128);
  const setup=await repository.getOrCreateOpaqueSetup(serverSetupOverride??opaque.server.createSetup(),serverSetupOverride);
  binary(setup,128);
  const serverPublicKey=opaque.server.getPublicKey(setup);
  const dummyRecovery=randomBytes(32).toString('hex');
  const identifiers=loginName=>({client:loginName,server:SERVER_ID});
  const fakeOwner=loginName=>createHmac('sha256',setup).update(`fake:${loginName}`).digest('hex');
  const sourceHash=source=>digest(`source:${source}`);
  async function challenge(kind,{ownerId=null,username:loginName,authVersion=null,sessionHash=null,payload={}},source) {
    const value=randomBytes(32).toString('base64url'),expiresAt=Date.now()+TTL;
    await repository.createOpaqueChallenge({idHash:digest(value),kind,ownerId,username:loginName,sourceHash:sourceHash(source),authVersion,sessionHash,expiresAt,payload});
    return {challengeId:value,expiresAt:new Date(expiresAt).toISOString()};
  }
  async function take(value,kind,source){binary(value,32);return repository.takeOpaqueChallenge(digest(value),kind,sourceHash(source));}
  function registrationResponse(request,ownerId){binary(request,32);try{return opaque.server.createRegistrationResponse({serverSetup:setup,userIdentifier:ownerId,registrationRequest:request}).registrationResponse;}catch{bad('Invalid registration request.');}}
  function registrationRecord(value,ownerId,loginName){
    binary(value,192);
    // Parse all cryptographic record fields using the maintained implementation.
    // This synthetic probe is discarded; no account or server session is created.
    try{const probe=opaque.client.startLogin({password:'synthetic record validation only'});opaque.server.startLogin({serverSetup:setup,userIdentifier:ownerId,registrationRecord:value,startLoginRequest:probe.startLoginRequest,identifiers:identifiers(loginName)});}catch{bad('Invalid registration record.');}
    return value;
  }
  function startProof(user,request,loginName){binary(request,96);try{return opaque.server.startLogin({serverSetup:setup,userIdentifier:user?.id??fakeOwner(loginName),registrationRecord:user?.opaque_record??null,startLoginRequest:request,identifiers:identifiers(loginName)});}catch{bad('Invalid sign-in request.');}}
  function finishProof(row,request){binary(request,64);try{opaque.server.finishLogin({serverLoginState:row.payload.serverLoginState,finishLoginRequest:request,identifiers:identifiers(row.username)});}catch{denied();}}
  async function checkBound(row,user,sessionHash){
    if(!user||row.ownerId!==user.id||row.sessionHash!==sessionHash)denied();
    return repository.checkOpaqueOwner(row.ownerId,row.authVersion,sessionHash);
  }
  async function grant(value,action,user,sessionHash,source){
    const row=await take(value,'reauth-grant',source);
    if(row.payload.action!==action)denied();
    await checkBound(row,user,sessionHash);return row;
  }
  async function matchingVault(ownerId,sessionHash,expectedRevision){const vault=await repository.readVault(ownerId,sessionHash);if((vault?.revision??0)!==expectedRevision)throw new CloudError(409,'Records changed. Refresh before changing account security.',{currentRevision:vault?.revision??0});return vault;}
  async function accountResult(result){return{status:200,body:{user:publicUser(result.user),vault:result.vault},session:result.session};}

  async function handle({path,method,input,source,user,sessionHash,withVault=operation=>operation()}) {
    if(path==='/config'&&method==='GET')return{status:200,body:{protocol:'opaque-v1',serverPublicKey,serverIdentifier:SERVER_ID}};
    if(method!=='POST')throw new CloudError(404,'This authentication endpoint does not exist.');
    return work(async()=>{
      if(path==='/register/start'){
        exact(input,['username','registrationRequest'],['name']);const loginName=username(input.username);binary(input.registrationRequest,32);
        const name=input.name===undefined?loginName:input.name;
        if(typeof name!=='string'||!name.trim()||name.length>100)bad('Use a display name of 1–100 characters.');
        await rateLimit('register',`source:${source}`);
        const ownerId=randomUUID(),response=registrationResponse(input.registrationRequest,ownerId);
        const value=await challenge('register',{ownerId,username:loginName,payload:{name:name.trim()}},source);
        return{status:200,body:{...value,ownerId,username:loginName,registrationResponse:response}};
      }
      if(path==='/register/finish'){
        exact(input,['challengeId','registrationRecord','dataEnvelope','keyEnvelope','recoveryAuthHash']);hashValue(input.recoveryAuthHash);
        const row=await take(input.challengeId,'register',source),record=registrationRecord(input.registrationRecord,row.ownerId,row.username),vault=vaultInput(input,0);
        validateVaultWrite(row.ownerId,vault);
        return withVault(async()=>{const session=newSession();
          const result=await repository.registerOpaque({challenge:row,registrationRecord:record,vaultInput:vault,recoveryAuthHash:input.recoveryAuthHash},session);
          return{status:201,body:{user:publicUser(result.user),vault:result.vault},session};});
      }
      if(path==='/login/start'){
        exact(input,['username','startLoginRequest']);const loginName=username(input.username);binary(input.startLoginRequest,96);
        await rateLimit('login',`opaque-source:${source}`,4);
        const account=await repository.accountByUsername(loginName),known=account?.auth_mode==='opaque-v1'?account:null;
        await rateLimit('login',known?`account:${loginName}`:`unknown-source:${source}`);
        const proof=startProof(known,input.startLoginRequest,loginName),value=await challenge('login',{ownerId:known?.id??null,username:loginName,authVersion:known?Number(known.auth_version):null,payload:{serverLoginState:proof.serverLoginState}},source);
        return{status:200,body:{...value,loginResponse:proof.loginResponse}};
      }
      if(path==='/login/finish'){
        exact(input,['challengeId','finishLoginRequest']);const row=await take(input.challengeId,'login',source);finishProof(row,input.finishLoginRequest);
        if(!row.ownerId)denied();
        return withVault(async()=>{const session=newSession();
          const fresh=await repository.loginOpaque({ownerId:row.ownerId,authVersion:row.authVersion},session);
          // A simultaneous revoke may make this read fail; no stale authentication is returned.
          const vault=await repository.readVault(fresh.id,session.tokenHash);
          return{status:200,body:{user:publicUser(fresh),vault},session};});
      }
      if(path==='/reauth/start'){
        exact(input,['action','startLoginRequest']);accountOpaque(user);if(!actions.includes(input.action))bad('Invalid authentication purpose.');binary(input.startLoginRequest,96);
        await rateLimit('login',`account:${user.username}`);const fresh=await repository.checkOpaqueOwner(user.id,Number(user.auth_version),sessionHash);
        const proof=startProof(fresh,input.startLoginRequest,fresh.username);
        const value=await challenge('reauth',{ownerId:fresh.id,username:fresh.username,authVersion:Number(fresh.auth_version),sessionHash,payload:{action:input.action,serverLoginState:proof.serverLoginState}},source);
        return{status:200,body:{...value,loginResponse:proof.loginResponse}};
      }
      if(path==='/reauth/finish'){
        exact(input,['challengeId','finishLoginRequest']);accountOpaque(user);const row=await take(input.challengeId,'reauth',source);finishProof(row,input.finishLoginRequest);await checkBound(row,user,sessionHash);
        const value=await challenge('reauth-grant',{ownerId:row.ownerId,username:row.username,authVersion:row.authVersion,sessionHash,payload:{action:row.payload.action}},source);
        return{status:200,body:{reauthGrant:value.challengeId,action:row.payload.action,expiresAt:value.expiresAt}};
      }
      if(path==='/recover/start'){
        exact(input,['ownerId','registrationRequest']);ownerValue(input.ownerId);binary(input.registrationRequest,32);
        await rateLimit('login',`opaque-source:${source}`,4);
        const existing=await repository.opaqueAccountById(input.ownerId);
        await rateLimit('login',existing?.auth_mode==='opaque-v1'?`account:${existing.username}`:`unknown-source:${source}`);
        const value=await challenge('recover',{ownerId:input.ownerId,username:existing?.username??`unknown-${digest(input.ownerId).slice(0,48)}`,payload:{registrationRequest:input.registrationRequest}},source);
        return{status:200,body:value};
      }
      if(path==='/recover/authorize'){
        exact(input,['challengeId','recoveryAuthSecret']);const authBytes=binary(input.recoveryAuthSecret,32),provided=digest(authBytes);authBytes.fill(0);
        const row=await take(input.challengeId,'recover',source),fresh=await repository.opaqueAccountById(row.ownerId);
        const stored=fresh?.auth_mode==='opaque-v1'&&/^[a-f0-9]{64}$/.test(fresh.recovery_auth_hash??'')?fresh.recovery_auth_hash:dummyRecovery;
        const matches=timingSafeEqual(Buffer.from(stored,'hex'),Buffer.from(provided,'hex'));
        if(!matches||fresh?.auth_mode!=='opaque-v1')denied();
        return withVault(async()=>{
          const vault=await repository.recoveryVault(fresh.id,Number(fresh.auth_version),stored),response=registrationResponse(row.payload.registrationRequest,fresh.id);
          const value=await challenge('recover-commit',{ownerId:fresh.id,username:fresh.username,authVersion:Number(fresh.auth_version),payload:{expectedRecoveryHash:stored,expectedRevision:vault?.revision??0}},source);
          return{status:200,body:{recoveryGrant:value.challengeId,ownerId:fresh.id,username:fresh.username,registrationResponse:response,vault,expiresAt:value.expiresAt}};});
      }
      if(path==='/recover/finish'){
        exact(input,['recoveryGrant','registrationRecord','expectedRevision','dataEnvelope','keyEnvelope','recoveryAuthHash']);hashValue(input.recoveryAuthHash);
        const row=await take(input.recoveryGrant,'recover-commit',source);if(revision(input.expectedRevision)!==row.payload.expectedRevision)bad('Use the authorized recovery snapshot.');
        const record=registrationRecord(input.registrationRecord,row.ownerId,row.username);
        return withVault(async()=>{const session=newSession();
          const result=await repository.commitOpaque({kind:'recover',ownerId:row.ownerId,authVersion:row.authVersion,expectedRecoveryHash:row.payload.expectedRecoveryHash,registrationRecord:record,vaultInput:vaultInput(input),recoveryAuthHash:input.recoveryAuthHash},session);
          return accountResult({...result,session});});
      }
      if(path==='/change/start'){
        exact(input,['reauthGrant','registrationRequest','expectedRevision']);accountOpaque(user);binary(input.registrationRequest,32);revision(input.expectedRevision);
        const row=await grant(input.reauthGrant,'change-password',user,sessionHash,source);await withVault(()=>matchingVault(user.id,sessionHash,input.expectedRevision));
        const response=registrationResponse(input.registrationRequest,user.id),value=await challenge('change',{ownerId:user.id,username:row.username,authVersion:row.authVersion,sessionHash,payload:{expectedRevision:input.expectedRevision}},source);
        return{status:200,body:{...value,ownerId:user.id,username:row.username,registrationResponse:response}};
      }
      if(path==='/change/finish'){
        exact(input,['challengeId','registrationRecord','expectedRevision','dataEnvelope','keyEnvelope']);accountOpaque(user);const row=await take(input.challengeId,'change',source);await checkBound(row,user,sessionHash);
        if(revision(input.expectedRevision)!==row.payload.expectedRevision)bad('Use the authorized account snapshot.');
        const record=registrationRecord(input.registrationRecord,row.ownerId,row.username);
        return withVault(async()=>{const session=newSession();
          const result=await repository.commitOpaque({kind:'change',ownerId:user.id,authVersion:row.authVersion,sessionHash,registrationRecord:record,vaultInput:vaultInput(input)},session);
          return accountResult({...result,session});});
      }
      if(path==='/rotate-recovery'){
        exact(input,['reauthGrant','expectedRevision','dataEnvelope','keyEnvelope','recoveryAuthHash']);accountOpaque(user);hashValue(input.recoveryAuthHash);
        const row=await grant(input.reauthGrant,'rotate-recovery',user,sessionHash,source);
        return withVault(async()=>{const session=newSession();
          const result=await repository.commitOpaque({kind:'rotate-recovery',ownerId:user.id,authVersion:row.authVersion,sessionHash,vaultInput:vaultInput(input),recoveryAuthHash:input.recoveryAuthHash},session);
          return accountResult({...result,session});});
      }
      if(path==='/migrate/start'){
        exact(input,['legacyPassword','registrationRequest','expectedRevision']);if(!user||(user.auth_mode??'legacy-scrypt')!=='legacy-scrypt')denied();
        if(typeof input.legacyPassword!=='string'||!input.legacyPassword||input.legacyPassword.length>256)bad('Enter the old account password.');binary(input.registrationRequest,32);revision(input.expectedRevision);
        await rateLimit('login',`account:${user.username}`);if(!(await verifyLegacyPassword(input.legacyPassword,user.password_hash)))throw new CloudError(403,'The old account password is incorrect.');
        await withVault(()=>matchingVault(user.id,sessionHash,input.expectedRevision));
        const response=registrationResponse(input.registrationRequest,user.id),value=await challenge('migrate',{ownerId:user.id,username:user.username,authVersion:Number(user.auth_version??1),sessionHash,payload:{expectedRevision:input.expectedRevision,expectedLegacyHash:user.password_hash}},source);
        return{status:200,body:{...value,ownerId:user.id,username:user.username,registrationResponse:response}};
      }
      if(path==='/migrate/finish'){
        exact(input,['challengeId','registrationRecord','expectedRevision','dataEnvelope','keyEnvelope','recoveryAuthHash']);hashValue(input.recoveryAuthHash);
        const row=await take(input.challengeId,'migrate',source);if(!user||row.ownerId!==user.id||row.sessionHash!==sessionHash||(user.auth_mode??'legacy-scrypt')!=='legacy-scrypt')denied();
        if(revision(input.expectedRevision)!==row.payload.expectedRevision)bad('Use the authorized migration snapshot.');
        const record=registrationRecord(input.registrationRecord,row.ownerId,row.username);
        return withVault(async()=>{const session=newSession();
          const result=await repository.commitOpaque({kind:'migrate',ownerId:user.id,authVersion:row.authVersion,sessionHash,expectedLegacyHash:row.payload.expectedLegacyHash,registrationRecord:record,vaultInput:vaultInput(input),recoveryAuthHash:input.recoveryAuthHash},session);
          return accountResult({...result,session});});
      }
      throw new CloudError(404,'This authentication endpoint does not exist.');
    });
  }
  async function sensitive({action,input,user,sessionHash,source}){
    exact(input,['reauthGrant']);accountOpaque(user);
    return work(async()=>{const row=await grant(input.reauthGrant,action,user,sessionHash,source);await repository.sensitiveOpaque({kind:action,ownerId:user.id,authVersion:row.authVersion,sessionHash});});
  }
  return{handle,sensitive};
}
