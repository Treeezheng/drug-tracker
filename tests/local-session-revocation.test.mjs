import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDoseServer } from '../server/index.mjs';

const password = 'SYNTHETIC LOCAL REVOCATION ONLY 8352';
const profile = { name: 'Synthetic', timeZone: 'UTC', timeFormat: '24h', sleepEnabled: false, bedtime: '23:00', wakeTime: '07:00', weekendEnabled: false };
test('local logout/reset reject body-delayed profile, record, import and account-delete mutations', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drug-local-revocation-'));
  const { server } = await createDoseServer({ dbPath: join(dir, 'synthetic.sqlite') });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(dir,{recursive:true,force:true}); });
  const port = server.address().port;
  function begin(path,method,body,cookie,owner,paused=false) {
    const encoded=JSON.stringify(body);
    let request;
    const completed = new Promise((resolve,reject) => {
      request=httpRequest({hostname:'127.0.0.1',port,path,method,headers:{Host:`127.0.0.1:${port}`,Origin:`http://127.0.0.1:${port}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(encoded),...(cookie?{Cookie:cookie}:{}),...(owner?{'X-Dose-Owner':owner}:{})}},res=>{
        let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text),cookie:res.headers['set-cookie']?.[0].split(';')[0]}));
      });request.once('error',reject);
      if(paused)request.write(encoded.slice(0,1));else request.end(encoded);
    });
    return { completed, finish:()=>request.end(encoded.slice(1)) };
  }
  const call=(path,method,body,cookie,owner)=>begin(path,method,body,cookie,owner).completed;
  const setup=await call('/api/auth/local-setup','POST',{password});
  const owner=setup.data.user.id;
  const empty={profile:null,doses:[],scenarios:[],favorites:[],checkins:[],inventory:[]};
  const mutations=[
    ['/api/profile','PUT',profile],
    ['/api/favorites/synthetic','PUT',{id:'synthetic',productId:'ritalin',strength:'10'}],
    ['/api/import','POST',{mode:'replace',backup:{format:'dose-timeline-backup',schemaVersion:1,data:empty}}],
    ['/api/account','DELETE',{password}],
  ];
  for(const [path,method,body] of mutations) {
    const login=await call('/api/auth/local-unlock','POST',{password});
    let incoming;server.once('request',req=>incoming=req);
    const delayed=begin(path,method,body,login.cookie,owner,true);
    for(let i=0;i<100&&!incoming?.listenerCount('data');i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.ok(incoming?.listenerCount('data'));
    assert.equal((await call('/api/auth/logout','POST',{},login.cookie,owner)).status,200);
    delayed.finish();assert.equal((await delayed.completed).status,401,path);
    assert.equal((await call('/api/auth/local-unlock','POST',{password})).status,200);
  }
  const logged=await call('/api/auth/local-unlock','POST',{password});
  let incoming;server.once('request',req=>incoming=req);
  const delayed=begin('/api/profile','PUT',profile,logged.cookie,owner,true);
  for(let i=0;i<100&&!incoming?.listenerCount('data');i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(incoming?.listenerCount('data'));
  const recovered=await call('/api/auth/local-recover','POST',{password:'SYNTHETIC NEW PASSWORD 8352',recoveryCode:setup.data.recoveryCode});
  assert.equal(recovered.status,200);
  delayed.finish();assert.equal((await delayed.completed).status,401);
});
