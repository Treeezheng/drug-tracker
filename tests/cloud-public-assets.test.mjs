import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, rename, symlink, truncate, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createCloudServer } from '../server/cloud.mjs';
import { buildMetadata } from '../scripts/build-metadata.ts';

test('production public assets are compressed/cacheable while HTML, manifests and API responses remain no-store',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'drug-public-assets-')),dist=join(dir,'dist');
  await mkdir(join(dist,'assets'),{recursive:true});
  const source='export const publicExample="'+('static only '.repeat(200))+'";';
  await Promise.all([
    writeFile(join(dist,'index.html'),'<meta name="drug-edition" content="cloud"><title>Test</title>'),
    writeFile(join(dist,'assets/app-AbCdEf12.js'),source),
    writeFile(join(dist,'build-info.json'),'{"test":true}'),
    writeFile(join(dist,'robots.txt'),'User-agent: *\nDisallow: /drug/api/\n'),
    writeFile(join(dist,'llms.txt'),'# Drug Tracker\n[Privacy](/drug/privacy.html)\n'),
  ]);
  const app=await createCloudServer({dbPath:join(dir,'test.sqlite'),distDir:dist,origin:'https://assets.test'});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{await new Promise(resolve=>{app.server.close(resolve);app.server.closeIdleConnections();});await rm(dir,{recursive:true,force:true});});
  const get=(path,encoding='gzip',method='GET')=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:app.server.address().port,path,method,headers:{Host:'assets.test','Accept-Encoding':encoding}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();});
  const compressed=await get('/drug/assets/app-AbCdEf12.js');
  assert.equal(compressed.status,200);assert.equal(compressed.headers['content-encoding'],'gzip');assert.equal(compressed.headers.vary,'Accept-Encoding');
  assert.match(compressed.headers['cache-control'],/immutable/);assert.equal(gunzipSync(compressed.body).toString(),source);
  const plain=await get('/drug/assets/app-AbCdEf12.js','gzip;q=0, identity');assert.equal(plain.headers['content-encoding'],undefined);assert.equal(plain.body.toString(),source);
  const head=await get('/drug/assets/app-AbCdEf12.js','gzip','HEAD');assert.equal(head.body.length,0);assert.equal(head.headers['content-length'],compressed.headers['content-length']);
  for(const path of ['/drug/','/drug/build-info.json','/drug/api/session','/drug/api/auth/opaque/config']){
    const response=await get(path);assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['content-encoding'],undefined);
  }
  for(const path of ['/robots.txt','/llms.txt','/drug/robots.txt','/drug/llms.txt']){
    const response=await get(path);assert.equal(response.status,200);assert.match(response.headers['content-type'],/^text\/plain/);assert.doesNotMatch(response.body.toString(),/<html|<script/);
  }
  assert.equal((await get('/drug/api/vault')).status,401);
  assert.equal((await get('/drug/assets/missing.js')).status,404);
});

test('edition validation skips complete and unfinished comments without constructing tags by removing text',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'drug-edition-comments-')),dist=join(dir,'dist');await mkdir(dist);
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const marker='<meta name="drug-edition" content="cloud">';
  for(const markup of [
    `<!-- hidden ${marker} -->`,
    `<!-- unfinished ${marker}`,
    '<me<!-- removed text -->ta name="drug-edition" content="cloud">',
    '<meta name="drug-ed<!-- removed text -->ition" content="cloud">',
    `<!-- outer <!-- nested ${marker} --> -->`,
    `<meta name="drug-edition" content="local"><!-- ignored -->${marker}`,
  ]){
    await writeFile(join(dist,'index.html'),markup);
    await assert.rejects(createCloudServer({dbPath:join(dir,'test.sqlite'),distDir:dist,origin:'https://assets.test'}),error=>error.status===400);
  }
  await writeFile(join(dist,'index.html'),`<!-- ordinary build comment -->${marker}<!-- trailing comment -->`);
  const app=await createCloudServer({dbPath:join(dir,'test.sqlite'),distDir:dist,origin:'https://assets.test'});await app.closeStorage();
});

async function publicFixture(t,{beforeStart}={}){
  const dir=await mkdtemp(join(tmpdir(),'drug-static-snapshot-')),dist=join(dir,'dist'),outside=join(dir,'outside');
  await mkdir(join(dist,'assets'),{recursive:true});await mkdir(outside);
  await Promise.all([
    writeFile(join(dist,'index.html'),'<meta name="drug-edition" content="cloud"><title>Original index</title>'),
    writeFile(join(dist,'privacy.html'),'<title>Original privacy</title>'),
    writeFile(join(dist,'LICENSE'),'Original public license'),
    writeFile(join(dist,'THIRD_PARTY_NOTICES.txt'),'Original public third-party notices'),
    writeFile(join(dist,'robots.txt'),'Original robots'),
    writeFile(join(dist,'build-info.json'),'{"original":true}'),
    writeFile(join(dist,'assets/app-AbCdEf12.js'),'export const original=true;'),
    writeFile(join(outside,'app-AbCdEf12.js'),'SYNTHETIC PRIVATE CONTENT MUST NEVER BE SENT'),
    writeFile(join(outside,'secret.txt'),'SYNTHETIC PRIVATE CONTENT MUST NEVER BE SENT'),
  ]);
  let app;
  t.after(async()=>{if(app){await new Promise(resolve=>{app.server.close(resolve);app.server.closeIdleConnections();});await app.closeStorage();}await rm(dir,{recursive:true,force:true});});
  await beforeStart?.({dir,dist,outside});
  app=await createCloudServer({dbPath:join(dir,'test.sqlite'),distDir:dist,origin:'https://assets.test'});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  const get=(path,method='GET')=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:app.server.address().port,path,method,headers:{Host:'assets.test'}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const body=Buffer.concat(chunks);resolve({status:res.statusCode,text:body.toString(),body,headers:res.headers});});});req.on('error',reject);req.end();});
  return{dir,dist,outside,app,get};
}

test('public responses use startup snapshots after files and ancestor directories are replaced; unlisted files and symlinks remain unavailable',async t=>{
  const f=await publicFixture(t,{beforeStart:async({dist,outside})=>{
    await symlink(outside,join(dist,'assets','linked-directory'));
    await symlink(join(outside,'secret.txt'),join(dist,'assets','linked-file.js'));
    await writeFile(join(dist,'private.txt'),'SYNTHETIC FILE NOT IN PUBLIC ALLOWLIST');
  }});
  const expected=new Map();
  for(const path of ['/drug/','/drug/privacy.html','/drug/LICENSE','/drug/THIRD_PARTY_NOTICES.txt','/robots.txt','/drug/build-info.json','/drug/assets/app-AbCdEf12.js'])expected.set(path,(await f.get(path)).text);
  for(const name of ['index.html','privacy.html','LICENSE','THIRD_PARTY_NOTICES.txt','robots.txt','build-info.json']){await rename(join(f.dist,name),join(f.dist,`${name}.old`));await symlink(join(f.outside,'secret.txt'),join(f.dist,name));}
  await rename(join(f.dist,'assets'),join(f.dist,'old-assets'));await symlink(f.outside,join(f.dist,'assets'));
  await writeFile(join(f.dist,'new-file.json'),'{"mustNotBecomePublic":true}');
  for(const[path,text]of expected){const response=await f.get(path);assert.equal(response.status,200);assert.equal(response.text,text);assert.doesNotMatch(response.text,/PRIVATE CONTENT/);}
  for(const path of ['/drug/private.txt','/drug/new-file.json','/drug/assets/linked-file.js','/drug/assets/linked-directory/app-AbCdEf12.js','/drug/assets/../private.txt','/drug/assets/%2e%2e%2fprivate.txt','/drug/%2fprivate.txt'])assert.equal((await f.get(path)).status,404);
});

test('every current public build file is served byte-for-byte as declared by the generated release manifest',async t=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const f=await publicFixture(t,{beforeStart:async({dist})=>{
    // Use the real public inputs and manifest generator, so adding an unserved
    // root file to a future release fails this HTTP contract test.
    for(const entry of await readdir(join(root,'public'),{withFileTypes:true})){
      assert.equal(entry.isFile(),true,'Public build inputs must remain explicit regular files.');
      await copyFile(join(root,'public',entry.name),join(dist,entry.name));
    }
    const metadata=buildMetadata('cloud');
    metadata.configResolved({root,build:{outDir:dist}});metadata.writeBundle();
  }});
  const manifest=JSON.parse((await f.get('/drug/build-info.json')).text);
  for(const name of ['LICENSE','THIRD_PARTY_NOTICES.txt','apple-touch-icon.png','icon-192.png','icon-512.png','site.webmanifest'])assert.ok(Object.hasOwn(manifest.files,name));
  assert.equal((await f.get('/drug/site.webmanifest')).headers['content-type'],'application/manifest+json');
  for(const [name,expected] of Object.entries(manifest.files)){
    const response=await f.get(`/drug/${name}`);
    assert.equal(response.status,200,name);
    assert.equal(response.body.length,expected.bytes,name);
    assert.equal(createHash('sha256').update(response.body).digest('hex'),expected.sha256,name);
  }
  for(const name of ['LICENSE','THIRD_PARTY_NOTICES.txt']){
    const response=await f.get(`/drug/${name}`);
    assert.match(response.headers['content-type'],/^text\/plain; charset=utf-8$/);
    assert.equal(response.headers['cache-control'],'no-store');
    assert.equal(response.headers['x-content-type-options'],'nosniff');
    const head=await f.get(`/drug/${name}`,'HEAD');
    assert.equal(head.body.length,0);assert.equal(Number(head.headers['content-length']),manifest.files[name].bytes);
  }
});

test('an asset pathname replaced after open cannot change the descriptor that is checked and captured',async t=>{
  let swapped=false;
  const originalOpen=fs.openSync;
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  const f=await publicFixture(t,{beforeStart:async({dist,outside})=>{
    const target=fs.realpathSync(join(dist,'assets/app-AbCdEf12.js'));
    t.mock.method(fs,'openSync',(path,...rest)=>{
      const fd=originalOpen(path,...rest);
      if(path===target&&!swapped){swapped=true;fs.renameSync(target,`${target}.old`);fs.symlinkSync(join(outside,'app-AbCdEf12.js'),target);}
      return fd;
    });
    syncBuiltinESMExports();
  }});
  t.mock.restoreAll();syncBuiltinESMExports();
  assert.equal(swapped,true);
  const response=await f.get('/drug/assets/app-AbCdEf12.js');assert.equal(response.status,200);assert.equal(response.text,'export const original=true;');
});

test('required build files cannot be symlinks and oversized assets fail before becoming public',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'drug-static-reject-')),dist=join(dir,'dist');await mkdir(join(dist,'assets'),{recursive:true});
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const index=join(dist,'index.html'),outside=join(dir,'outside.html');await writeFile(outside,'<meta name="drug-edition" content="cloud">');await symlink(outside,index);
  await assert.rejects(createCloudServer({dbPath:join(dir,'test.sqlite'),distDir:dist,origin:'https://assets.test'}),error=>error.code==='ELOOP');
  await rm(index);await writeFile(index,'<meta name="drug-edition" content="cloud">');
  const large=join(dist,'assets/large-AbCdEf12.js');await writeFile(large,'');await truncate(large,16*1024*1024+1);
  await assert.rejects(createCloudServer({dbPath:join(dir,'test.sqlite'),distDir:dist,origin:'https://assets.test'}),error=>error.status===400&&/oversized/.test(error.message));
});
