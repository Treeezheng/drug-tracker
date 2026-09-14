import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,rm,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as opaque from '@serenity-kit/opaque';
import { createCloudServer } from '../server/cloud.mjs';
const origin='https://opaque-api-synthetic.example',password='SYNTHETIC glade raven cosmos 3293!';
const KSF={'argon2id-custom':{memory:65536,iterations:3,parallelism:1}};
const identity=username=>({client:username,server:'drug-tracker:opaque:v1'});
const hash=value=>createHash('sha256').update(value).digest('hex');
const bytes=(length)=>randomBytes(length).toString('base64url');
function pair(ownerId){const common={protocol:'dose-timeline-vault',version:1,ownerId,cipher:'AES-256-GCM',iv:bytes(12)};return{dataEnvelope:{...common,kind:'data',ciphertext:bytes(17)},keyEnvelope:{...common,version:3,kind:'wrapped-key',ciphertext:bytes(48),kdf:{name:'OPAQUE-export',hash:'SHA-256',context:'drug-tracker:opaque:v1',salt:bytes(16)}}};}
async function fixture(t,options={}){
  await opaque.ready;const directory=await mkdtemp(join(tmpdir(),'drug-opaque-api-')),dbPath=join(directory,'cloud.sqlite');
  const app=await createCloudServer({dbPath,origin,proxyMode:'heroku',...options});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>{app.server.close(resolve);app.server.closeAllConnections();});await app.closeStorage();await rm(directory,{recursive:true,force:true});});
  const request=async(path,body,{cookie,owner,source='198.51.100.4',headers={}}={})=>new Promise((resolve,reject)=>{
    const data=JSON.stringify(body);const req=httpRequest({host:'127.0.0.1',port:app.server.address().port,path:'/drug/api'+path,method:'POST',headers:{Host:new URL(origin).host,Origin:origin,'X-Forwarded-Proto':'https','X-Forwarded-For':source,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),...(cookie?{Cookie:cookie}:{}),...(owner?{'X-Dose-Owner':owner}:{}),...headers}},res=>{let text='';res.on('data',part=>text+=part);res.once('end',()=>resolve({status:res.statusCode,data:JSON.parse(text),cookie:res.headers['set-cookie']?.[0].split(';')[0],headers:res.headers}));});req.once('error',reject);req.end(data);
  });
  async function register(username){const start=opaque.client.startRegistration({password}),a=await request('/auth/opaque/register/start',{username,registrationRequest:start.registrationRequest});assert.equal(a.status,200);const record=opaque.client.finishRegistration({password,clientRegistrationState:start.clientRegistrationState,registrationResponse:a.data.registrationResponse,identifiers:identity(username),keyStretching:KSF});const b=await request('/auth/opaque/register/finish',{challengeId:a.data.challengeId,registrationRecord:record.registrationRecord,...pair(a.data.ownerId),recoveryAuthHash:hash(randomBytes(32))});assert.equal(b.status,201);return b;}
  return{request,register,dbPath};
}

test('unknown recovery starts have the same response shape and never bypass proof or leak account metadata',async t=>{
  const f=await fixture(t),known=await f.register('known-owner'),reg=opaque.client.startRegistration({password});
  const a=await f.request('/auth/opaque/recover/start',{ownerId:known.data.user.id,registrationRequest:reg.registrationRequest});
  const b=await f.request('/auth/opaque/recover/start',{ownerId:randomUUID(),registrationRequest:reg.registrationRequest});
  assert.equal(a.status,200);assert.equal(b.status,200);assert.deepEqual(Object.keys(a.data).sort(),Object.keys(b.data).sort());
  for(const response of[a,b]){assert.equal(Object.hasOwn(response.data,'username'),false);assert.equal(Object.hasOwn(response.data,'vault'),false);const failure=await f.request('/auth/opaque/recover/authorize',{challengeId:response.data.challengeId,recoveryAuthSecret:bytes(32)});assert.equal(failure.status,401);}
});

test('expired and malformed PAKE proofs consume only their one challenge and cannot create a session',async t=>{
  const f=await fixture(t),account=await f.register('expired-owner'),first=opaque.client.startLogin({password});
  const start=await f.request('/auth/opaque/login/start',{username:account.data.user.username,startLoginRequest:first.startLoginRequest});
  const proof=opaque.client.finishLogin({password,clientLoginState:first.clientLoginState,loginResponse:start.data.loginResponse,identifiers:identity(account.data.user.username),keyStretching:KSF});
  const db=new DatabaseSync(f.dbPath);db.prepare('UPDATE cloud_auth_challenges SET expires_at=0 WHERE id_hash=?').run(hash(start.data.challengeId));
  const finish={challengeId:start.data.challengeId,finishLoginRequest:proof.finishLoginRequest};assert.equal((await f.request('/auth/opaque/login/finish',finish)).status,401);
  assert.equal(db.prepare('SELECT count(*) AS n FROM cloud_auth_challenges WHERE id_hash=?').get(hash(start.data.challengeId)).n,0);
  const second=await f.request('/auth/opaque/login/start',{username:account.data.user.username,startLoginRequest:first.startLoginRequest});
  const failed=await f.request('/auth/opaque/login/finish',{challengeId:second.data.challengeId,finishLoginRequest:bytes(64)});assert.equal(failed.status,401);assert.equal(failed.cookie,undefined);
  assert.equal((await f.request('/auth/opaque/login/finish',{challengeId:second.data.challengeId,finishLoginRequest:bytes(64)})).status,401);
  assert.equal(db.prepare('SELECT count(*) AS n FROM cloud_sessions').get().n,1);db.close();
});

test('cumulative source quota stops rapid consumed handshakes across known usernames; malformed bodies do not spend it',async t=>{
  const f=await fixture(t,{loginAttemptLimit:1,registrationAttemptLimit:100});
  const users=[];for(let i=0;i<5;i++)users.push((await f.register(`source-owner-${i}`)).data.user);
  for(let i=0;i<6;i++)assert.equal((await f.request('/auth/opaque/login/start',{username:'source-owner-0',startLoginRequest:'bad'})).status,400);
  const first=opaque.client.startLogin({password});
  for(let i=0;i<4;i++){
    const started=await f.request('/auth/opaque/login/start',{username:users[i].username,startLoginRequest:first.startLoginRequest});assert.equal(started.status,200);
    assert.equal((await f.request('/auth/opaque/login/finish',{challengeId:started.data.challengeId,finishLoginRequest:bytes(64)})).status,401);
  }
  const rejected=await f.request('/auth/opaque/login/start',{username:users[4].username,startLoginRequest:first.startLoginRequest});assert.equal(rejected.status,429);assert.ok(Number(rejected.headers['retry-after'])>0);
  const other=await f.request('/auth/opaque/login/start',{username:users[4].username,startLoginRequest:first.startLoginRequest},{source:'203.0.113.71'});assert.equal(other.status,200);
});

test('primary endpoints reject raw-password and client-key fields before any account can be created',async t=>{
  const f=await fixture(t),reg=opaque.client.startRegistration({password});
  for(const secretField of['password','masterPassword','exportKey','recoveryKey','DEK'])assert.equal((await f.request('/auth/opaque/register/start',{username:'unused-owner',registrationRequest:reg.registrationRequest,[secretField]:'synthetic forbidden'})).status,400);
  assert.equal((await f.request('/auth/register',{username:'unused-owner',password:'synthetic forbidden'})).status,410);
  assert.equal((await f.request('/auth/login',{username:'unused-owner',password:'synthetic forbidden'})).status,410);
  assert.equal((await f.request('/auth/opaque/migrate/start',{legacyPassword:'synthetic forbidden',registrationRequest:reg.registrationRequest,expectedRevision:0})).status,410);
  const db=new DatabaseSync(f.dbPath);assert.equal(db.prepare('SELECT count(*) AS n FROM cloud_accounts').get().n,0);db.close();
});

test('retired CLI bootstrap refuses before creating a database or displaying a supplied environment secret',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'drug-opaque-cli-')),dbPath=join(directory,'must-not-exist.sqlite');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const secret='SYNTHETIC CLI SECRET MUST NOT BE DISPLAYED';
  await assert.rejects(promisify(execFile)(process.execPath,['server/cloud.mjs','bootstrap'],{
    cwd:new URL('..',import.meta.url),env:{CLOUD_DB_PATH:dbPath,CLOUD_ADMIN_USERNAME:'unused-owner',CLOUD_ADMIN_PASSWORD:secret},timeout:5000,
  }),error=>error.code===1&&/CLI account bootstrap is disabled/.test(error.stderr)&&!error.stderr.includes(secret)&&error.stdout==='');
  await assert.rejects(stat(dbPath),error=>error.code==='ENOENT');
});
