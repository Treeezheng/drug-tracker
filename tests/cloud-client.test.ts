import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudClient } from '../src/lib/cloud-client';
import type { CloudVaultSnapshot } from '../src/lib/cloud-client';
import { ApiError } from '../src/lib/api';
import { decryptVault, exportRecoveryKey, importRecoveryKey, unwrapVaultKey } from '../src/lib/vault-crypto';
import { parseBackup } from '../src/lib/reports';
import type { AppData, Checkin, Dose, Profile } from '../src/lib/types';
import { newDose, updateDose } from '../src/components/DoseEditor';
import { freshGuestWorkspace } from '../src/lib/guest-workspace';
import { prepareGuestTransfer } from '../src/lib/guest-transfer';

const passphrase = 'Independent vault phrase 中文';
const profile: Profile = { name: 'Synthetic 中文', timeZone: 'America/Los_Angeles', timeFormat: '12h', timeIncrementMinutes: 5, sleepEnabled: false, bedtime: '', wakeTime: '', weekendEnabled: false, weekendBedtime: '', weekendWakeTime: '' };
const dose = (id: string, patch: Partial<Dose> = {}): Dose => ({ id, productId: 'unknown-historical-medication', productName: 'Historical snapshot', formulation: 'Oral solution', strength: '2', packageStrength: '2/0.5', strengthUnit: 'mg/mL', manufacturer: 'Original maker', amountBasis: 'first listed ingredient', quantity: '1.5', unit: 'mL', amountMg: '3', ingredients: [{ name: 'Ingredient A', amountMg: '3', strengthMg: '2', unit: 'mg/mL' }, { name: 'Ingredient B', amountMg: '0.75', strengthMg: '0.5', unit: 'mg/mL' }], administeredAt: '2026-09-13T15:00:00Z', timeZone: 'America/Los_Angeles', status: 'actual', note: 'Private note 中文\nsecond line', ...patch });
const empty = (): AppData => ({ profile: null, doses: [], scenarios: [], favorites: [], checkins: [], inventory: [] });
const complete = (): AppData => ({ profile: { ...profile }, doses: [dose('dose1', { revision: 2 })],
  scenarios: [{ id: 'scenario1', name: 'Workspace', doses: [dose('plan1', { status: 'simulated', administeredAt: '', date: '', time: '', note: 'untimed retained' })], comparisonDoses: [dose('comparison1', { status: 'simulated' })], modelVersion: 'model-test', baseline: 'recorded', baselineNote: 'Original model note', view: { date: '2026-09-13', days: 2, timeZone: 'UTC', publishedOnly: false } }],
  favorites: [{ id: 'favorite1', productId: 'unknown-historical-medication', strength: '2', packageStrength: '2/0.5', quantity: '1.5', inventory: '50' }],
  checkins: [{ id: 'legacy', date: '2025-01-01', focus: 'calm', sleepQuality: 'fair', note: 'Old note' }, { id: 'tagged', date: '2026-09-13', recordedAt: '2026-09-13T15:00:00Z', timeZone: 'America/Los_Angeles', symptoms: ['headache'], note: 'New note' }],
  inventory: [{ id: 'receipt1', productId: 'unknown-historical-medication', productName: 'Original snapshot', packageStrength: '2/0.5', strengthUnit: 'mg/mL', unit: 'mL', quantity: '100.1', receivedAt: '2026-09-13T14:00:00Z', timeZone: 'America/Los_Angeles', note: 'Stock note' }] });
const archive = (data: AppData) => ({ format: 'dose-timeline-backup', schemaVersion: 1, exportedAt: '2026-09-13T19:00:00Z', scope: 'current-data', data });
function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function server() {
  let vault: CloudVaultSnapshot | null = null;
  let auth = true, mode: 'none' | 'before' | 'after' | 'badAck' = 'none', accountPassword = 'correct-account-password', failReconcile = false, failedReads = 0;
  let hold: { started: ReturnType<typeof deferred>; finish: ReturnType<typeof deferred> } | null = null;
  const requests: { path: string; method: string; init: RequestInit; body?: any }[] = [];
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const fetcher = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(url).replace('/drug/api', ''), method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path, method, init, body });
    if (path === '/session') return reply({ user: auth ? { id: 'owner1', name: 'Account name' } : null });
    if (path === '/auth/login') { auth = true; return reply({ user: { id: 'owner1', name: 'Account name' } }); }
    if (path === '/auth/logout') { auth = false; return reply({ ok: true }); }
    if (!auth) return reply({ error: 'Sign in again.' }, 401);
    assert.equal(new Headers(init.headers).get('X-Dose-Owner'), 'owner1');
    if (path === '/auth/verify-password') return reply(body.password === accountPassword ? {ok:true} : {error:'Incorrect account password.'}, body.password === accountPassword ? 200 : 403);
    if (path === '/auth/change-password') { if(body.currentPassword !== accountPassword)return reply({error:'Incorrect account password.'},403);accountPassword=body.newPassword;return reply({user:{id:'owner1',name:'Account name'},security:{activeSessionCount:1}}); }
    if (path === '/auth/logout-all') { if(body.password!==accountPassword)return reply({error:'Incorrect account password.'},403);auth=false;return reply({ok:true}); }
    if (path === '/security') return reply({security:{activeSessionCount:1,sessionLifetimeHours:168,currentSession:{createdAt:'2026-09-13T00:00:00Z',expiresAt:'2026-09-14T00:00:00Z'}}});
    if (path === '/account' && method === 'DELETE') {
      if (body.password !== 'correct-account-password') return reply({ error: 'Incorrect account password.' }, 403);
      auth = false; vault = null; return reply({ ok: true });
    }
    if (path === '/vault' && method === 'GET') {if(failedReads>0){failedReads--;throw new TypeError('reconciliation offline');}return reply({ vault });}
    if (path === '/vault' && method === 'PUT') {
      if (mode === 'before') { mode = 'none'; throw new TypeError('offline'); }
      if (body.expectedRevision !== (vault?.revision ?? 0)) return reply({ error: 'Vault changed. Refresh and review your unsaved entry.', currentRevision: vault?.revision ?? 0 }, 409);
      vault = { ownerId: 'owner1', revision: body.expectedRevision + 1, dataEnvelope: body.dataEnvelope, keyEnvelope: body.keyEnvelope, createdAt: vault?.createdAt ?? '2026-09-13T19:00:00Z', updatedAt: '2026-09-13T19:00:00Z' };
      if (hold) { const current = hold; hold = null; current.started.resolve(); await current.finish.promise; }
      if (mode === 'after') { mode = 'none'; if(failReconcile){failedReads++;failReconcile=false;}throw new TypeError('dropped acknowledgement'); }
      if (mode === 'badAck') { mode = 'none'; return reply({ vault: { ...vault, revision: vault.revision + 3 } }); }
      return reply({ vault });
    }
    return reply({ error: 'Unknown route' }, 404);
  }) as typeof fetch;
  return { fetcher, requests, get vault() { return vault; }, set vault(value) { vault = value; }, fail(value: typeof mode) { mode = value; }, failAfterAndReconcile(){mode='after';failReconcile=true;}, holdNext() { hold = { started: deferred(), finish: deferred() }; return hold; }, expire() { auth = false; } };
}
async function ready(data = empty()) { const remote = server(), client = createCloudClient({ fetch: remote.fetcher }); await client.session(); await client.loadVault(); const setup = await client.setupVault(passphrase, data); return { remote, client, ...setup }; }
const puts = (remote: ReturnType<typeof server>) => remote.requests.filter(r => r.path === '/vault' && r.method === 'PUT');
const replacementPassphrase = 'SYNTHETIC! glacier orbit fern 8294';
const accountPassword = 'correct-account-password';

test('changing encryption password rewraps the original key after both authentications without transmitting encryption secrets', async () => {
  const {client,remote,recoveryKey}=await ready(complete()), old=structuredClone(remote.vault!);
  assert.deepEqual(await client.request('/vault/change-password','POST',{currentSecret:passphrase,useRecovery:false,newPassphrase:replacementPassphrase,accountPassword},'owner1'),{recoveryKeyChanged:false});
  assert.equal(remote.vault!.revision,2);
  assert.deepEqual(remote.vault!.dataEnvelope,old.dataEnvelope);
  assert.equal(remote.vault!.keyEnvelope.version,2);
  assert.equal(await exportRecoveryKey(await unwrapVaultKey(remote.vault!.keyEnvelope,replacementPassphrase,'owner1')),recoveryKey);
  await assert.rejects(unwrapVaultKey(remote.vault!.keyEnvelope,passphrase,'owner1'));
  assert.deepEqual(await decryptVault(remote.vault!.dataEnvelope,await importRecoveryKey(recoveryKey),'owner1'),complete());
  // Old copies remain readable: changing the wrapping password cannot revoke backups.
  assert.deepEqual(await decryptVault(old.dataEnvelope,await unwrapVaultKey(old.keyEnvelope,passphrase,'owner1'),'owner1'),complete());
  const wire=JSON.stringify(remote.requests);
  for(const value of [passphrase,replacementPassphrase,recoveryKey,'Private note'])assert.equal(wire.includes(value),false);
  assert.deepEqual(remote.requests.find(r=>r.path==='/auth/verify-password')!.body,{password:accountPassword});
  assert.equal(remote.requests.some(r=>r.path==='/vault/change-password'),false);
});

test('full key rotation revokes the former recovery key for current and future snapshots while preserving every collection', async () => {
  const {client,remote,recoveryKey}=await ready(complete()), old=structuredClone(remote.vault!);
  const result=await client.request<{recoveryKey:string}>('/vault/rotate-key','POST',{currentSecret:recoveryKey,useRecovery:true,newPassphrase:replacementPassphrase,accountPassword},'owner1');
  assert.notEqual(result.recoveryKey,recoveryKey);
  assert.notEqual(remote.vault!.dataEnvelope.ciphertext,old.dataEnvelope.ciphertext);
  await assert.rejects(decryptVault(remote.vault!.dataEnvelope,await importRecoveryKey(recoveryKey),'owner1'));
  assert.deepEqual(await decryptVault(remote.vault!.dataEnvelope,await importRecoveryKey(result.recoveryKey),'owner1'),complete());
  await client.request('/doses/dose1','PUT',dose('dose1',{revision:2,note:'Future snapshot'}),'owner1');
  await assert.rejects(decryptVault(remote.vault!.dataEnvelope,await importRecoveryKey(recoveryKey),'owner1'));
  assert.equal((await decryptVault(remote.vault!.dataEnvelope,await importRecoveryKey(result.recoveryKey),'owner1')).doses[0].note,'Future snapshot');
  assert.deepEqual(await decryptVault(old.dataEnvelope,await importRecoveryKey(recoveryKey),'owner1'),complete());
  client.lock();
  assert.equal((await client.unlockVault({vaultPassphrase:replacementPassphrase})).doses[0].note,'Future snapshot');
});

test('encryption changes reject bad current secrets, bad account authentication, common passwords and account-password reuse before any vault write', async () => {
  const {client,remote}=await ready(complete()), before=puts(remote).length;
  await assert.rejects(client.changeVaultPassword({vaultPassphrase:'Wrong encryption phrase'},replacementPassphrase,accountPassword));
  await assert.rejects(client.rotateVaultKey({recoveryKey:'A'.repeat(43)},replacementPassphrase,accountPassword));
  await assert.rejects(client.changeVaultPassword({vaultPassphrase:passphrase},replacementPassphrase,'wrong-account-password'),error=>error instanceof ApiError&&error.status===403);
  const authCount=remote.requests.filter(r=>r.path==='/auth/verify-password').length;
  await assert.rejects(client.changeVaultPassword({vaultPassphrase:passphrase},'Password123456!',accountPassword),/stronger password/);
  await assert.rejects(client.changeVaultPassword({vaultPassphrase:passphrase},accountPassword,accountPassword),/different/);
  assert.equal(remote.requests.filter(r=>r.path==='/auth/verify-password').length,authCount);
  assert.equal(puts(remote).length,before);
  assert.deepEqual((await client.request<{data:AppData}>('/export')).data,complete());
});

test('a lost rotation acknowledgement reconciles exact ciphertext and returns the matching recovery key', async () => {
  const {client,remote}=await ready(complete());remote.fail('after');
  const result=await client.rotateVaultKey({vaultPassphrase:passphrase},replacementPassphrase,accountPassword);
  assert.equal(puts(remote).length,2);
  assert.equal(client.getState().revision,2);
  assert.deepEqual(await decryptVault(remote.vault!.dataEnvelope,await importRecoveryKey(result.recoveryKey),'owner1'),complete());
});

test('unconfirmed rotation blocks ordinary writes; retry recovers the same key without another upload or losing confirmed records', async () => {
  const {client,remote}=await ready(complete());remote.failAfterAndReconcile();
  await assert.rejects(client.rotateVaultKey({vaultPassphrase:passphrase},replacementPassphrase,accountPassword),/unconfirmed/);
  const written=structuredClone(remote.vault!);
  assert.equal(client.getState().revision,1);
  assert.deepEqual((await client.request<{data:AppData}>('/export')).data,complete());
  await assert.rejects(client.request('/doses/new','PUT',dose('new')),/unconfirmed encryption/);
  await assert.rejects(client.rotateVaultKey({vaultPassphrase:passphrase},'Different! asteroid meadow ribbon 8392',accountPassword));
  const result=await client.rotateVaultKey({vaultPassphrase:passphrase},replacementPassphrase,accountPassword);
  assert.equal(puts(remote).length,2);
  assert.deepEqual(remote.vault,written);
  assert.deepEqual(await decryptVault(written.dataEnvelope,await importRecoveryKey(result.recoveryKey),'owner1'),complete());
  assert.equal(client.getState().revision,2);
});

test('a failed pre-upload rotation retries the identical envelope pair and stale device rotation cannot overwrite other-device records', async () => {
  const {client,remote,recoveryKey}=await ready(complete());remote.fail('before');
  await assert.rejects(client.rotateVaultKey({recoveryKey},replacementPassphrase,accountPassword),/unconfirmed/);
  const attempted=puts(remote)[1].body;
  const result=await client.rotateVaultKey({recoveryKey},replacementPassphrase,accountPassword);
  assert.deepEqual(puts(remote)[2].body,attempted);
  const second=createCloudClient({fetch:remote.fetcher});await second.session();await second.unlockVault({recoveryKey:result.recoveryKey});
  await client.request('/doses/dose1','PUT',dose('dose1',{revision:2,note:'Other device correction'}));
  const count=puts(remote).length;
  await assert.rejects(second.rotateVaultKey({recoveryKey:result.recoveryKey},passphrase,accountPassword),/changed elsewhere/);
  assert.equal(puts(remote).length,count);
  assert.equal((await second.request<AppData>('/data')).doses[0].note,'Other device correction');
});

test('lock during a committed rotation clears memory and prevents a late acknowledgement from reopening records; new password unlocks after reload', async () => {
  const {client,remote,recoveryKey}=await ready(complete()), held=remote.holdNext();
  const operation=client.rotateVaultKey({recoveryKey},replacementPassphrase,accountPassword);
  const rejected=assert.rejects(operation,error=>error instanceof ApiError&&error.status===401);
  await held.started.promise;client.lock();held.finish.resolve();await rejected;
  assert.equal(client.getState().locked,true);
  await assert.rejects(client.request('/export'),/Unlock/);
  const reopened=createCloudClient({fetch:remote.fetcher});await reopened.session();
  assert.deepEqual(await reopened.unlockVault({vaultPassphrase:replacementPassphrase}),complete());
  await assert.rejects(decryptVault(remote.vault!.dataEnvelope,await importRecoveryKey(recoveryKey),'owner1'));
});

test('account password change refuses the current encryption password locally, retains an open workspace and all-session logout clears it immediately', async () => {
  const {client,remote}=await ready(complete());
  await assert.rejects(client.request('/auth/change-password','POST',{currentPassword:accountPassword,newPassword:passphrase}),/different/);
  assert.equal(remote.requests.some(r=>r.path==='/auth/change-password'),false);
  await assert.rejects(client.request('/auth/change-password','POST',{currentPassword:'wrong',newPassword:replacementPassphrase}),error=>error instanceof ApiError&&error.status===403);
  assert.equal(client.getState().locked,false);
  await client.request('/auth/change-password','POST',{currentPassword:accountPassword,newPassword:replacementPassphrase});
  assert.deepEqual((await client.request<{data:AppData}>('/export')).data,complete());
  assert.equal(client.getState().user?.id,'owner1');
  assert.equal((await client.request<{security:{sessionLifetimeHours:number}}>('/security')).security.sessionLifetimeHours,168);
  const signingOut=client.request('/auth/logout-all','POST',{password:replacementPassphrase});
  assert.equal(client.getState().locked,true);
  await signingOut;assert.equal(client.getState().user,null);
  assert.equal((await client.session()),null);
});

test('a stale device checks the latest encryption password before transmitting a proposed new account password',async()=>{
  const {client,remote,recoveryKey}=await ready();
  const second=createCloudClient({fetch:remote.fetcher});await second.session();await second.unlockVault({recoveryKey});
  await client.changeVaultPassword({vaultPassphrase:passphrase},replacementPassphrase,accountPassword);
  await assert.rejects(second.request('/auth/change-password','POST',{currentPassword:accountPassword,newPassword:replacementPassphrase}),/different/);
  assert.equal(remote.requests.some(row=>row.path==='/auth/change-password'),false);
});

test('encrypted preferences accept 1/5/10 and survive unlock/export; invalid increments never upload or replace them', async () => {
  const {client,remote,recoveryKey}=await ready(complete());
  let current=(await client.request<AppData>('/data')).profile!;
  for(const timeIncrementMinutes of [1,5,10] as const){
    current=await client.request<Profile>('/profile','PUT',{...current,timeIncrementMinutes},'owner1');
    const reopened=createCloudClient({fetch:remote.fetcher});await reopened.session();
    assert.equal((await reopened.unlockVault({recoveryKey})).profile?.timeIncrementMinutes,timeIncrementMinutes);
    const exported=await reopened.request<{data:AppData}>('/export');
    assert.equal(exported.data.profile?.timeIncrementMinutes,timeIncrementMinutes);
    assert.deepEqual(exported.data.doses,complete().doses);
    reopened.lock();
  }
  const before=puts(remote).length,snapshot=structuredClone(remote.vault);
  for(const timeIncrementMinutes of [-1,0,2,15,1.5,'1',null])await assert.rejects(client.request('/profile','PUT',{...current,timeIncrementMinutes},'owner1'),/time increment/);
  assert.equal(puts(remote).length,before);assert.deepEqual(remote.vault,snapshot);
  assert.deepEqual((await client.request<AppData>('/data')).profile,current);
});

test('every current collection and historical snapshot round-trips encrypted; only auth routes receive auth password', async () => {
  const remote = server(), client = createCloudClient({ fetch: remote.fetcher });
  await client.login('Owner', 'auth-password-never-vault');
  const original = complete(), originalCopy = structuredClone(original);
  const setup = await client.setupVault(passphrase, original);
  assert.deepEqual(original, originalCopy);
  assert.deepEqual(setup.data, original);
  const transport = JSON.stringify(puts(remote));
  for (const secret of ['Private note', 'Ingredient A', 'Synthetic', 'auth-password-never-vault', passphrase, setup.recoveryKey]) assert.equal(transport.includes(secret), false);
  assert.deepEqual(await decryptVault(remote.vault!.dataEnvelope, await importRecoveryKey(setup.recoveryKey), 'owner1'), original);
  assert.equal(remote.requests.find(r => r.path === '/auth/login')!.body.password, 'auth-password-never-vault');
  for (const request of remote.requests) { assert.equal(request.init.credentials, 'same-origin'); assert.equal(request.init.cache, 'no-store'); }
  const recovered = createCloudClient({ fetch: remote.fetcher }); await recovered.session();
  assert.deepEqual(await recovered.loadVault(), { exists: true, revision: 1 });
  assert.deepEqual(await recovered.unlockVault({ recoveryKey: setup.recoveryKey }), original);
  recovered.lock();
  assert.deepEqual(await recovered.unlockVault({ vaultPassphrase: passphrase }), original);
  assert.deepEqual(await recovered.request('/session'), { user: { id: 'owner1', name: 'Account name', email: '' } });
});

test('feeling check-ins save, reopen and export encrypted without losing new choices or accepting contradictory selections', async () => {
  const { client, remote, recoveryKey } = await ready();
  const checkin: Checkin = { id: 'feelings', date: '2026-09-13', recordedAt: '2026-09-13T15:00:00Z', timeZone: profile.timeZone, symptoms: ['concentrated', 'high-heart-rate', 'refreshed'], note: '' };
  const saved = await client.request<Checkin>('/checkins/feelings', 'PUT', checkin, 'owner1');
  assert.partialDeepStrictEqual(saved, { ...checkin, revision: 1 });
  const before = puts(remote).length;
  for (const symptoms of [['concentrated', 'none'], ['high-heart-rate', 'none'], ['refreshed', 'refreshed']]) {
    await assert.rejects(client.request('/checkins/feelings', 'PUT', { ...saved, symptoms }, 'owner1'));
  }
  assert.equal(puts(remote).length, before);
  for (const selection of checkin.symptoms!) assert.equal(JSON.stringify(puts(remote)).includes(selection), false);
  const reopened = createCloudClient({ fetch: remote.fetcher });
  await reopened.session();
  assert.deepEqual((await reopened.unlockVault({ recoveryKey })).checkins, [saved]);
  const exported = await reopened.request('/export');
  assert.deepEqual(parseBackup(JSON.stringify(exported)).checkins, [saved]);
});

test('all mutations are serialized and retain independent records, exact quantities and revisions', async () => {
  const { client, remote, recoveryKey } = await ready();
  const rows = await Promise.all(['a', 'b', 'c', 'd'].map(id => client.request<Dose>(`/doses/${id}`, 'PUT', dose(id), 'owner1')));
  assert.deepEqual(rows.map(d => [d.id, d.revision, d.quantity, d.amountMg]), ['a', 'b', 'c', 'd'].map(id => [id, 1, '1.5', '3']));
  assert.deepEqual(puts(remote).map(r => r.body.expectedRevision), [0, 1, 2, 3, 4]);
  const corrected = await client.request<Dose>('/doses/a', 'PUT', { ...rows[0], quantity: '0.1', amountMg: '0.2', note: 'Corrected 中文' }, 'owner1');
  assert.equal(corrected.revision, 2);
  await client.request('/doses/b', 'DELETE', { revision: 1 }, 'owner1');
  const value = await decryptVault(remote.vault!.dataEnvelope, await importRecoveryKey(recoveryKey), 'owner1');
  assert.deepEqual(value.doses.map(d => d.id).sort(), ['a', 'c', 'd']);
  assert.equal(value.doses.find(d => d.id === 'a')!.note, 'Corrected 中文');
  assert.equal(value.doses.find(d => d.id === 'c')!.ingredients![1].amountMg, '0.75');
});

test('stale record revision and owner mismatch reject before upload', async () => {
  const { client, remote } = await ready(complete()); const before = puts(remote).length;
  await assert.rejects(client.request('/doses/dose1', 'PUT', dose('dose1', { revision: 1 })), error => error instanceof ApiError && error.status === 409);
  await assert.rejects(client.request('/doses/dose1', 'DELETE', { revision: 2 }, 'another-owner'), /owns these records/);
  assert.equal(puts(remote).length, before);
});

test('two devices use whole-vault CAS; conflict never overwrites another device', async () => {
  const { client, remote, recoveryKey } = await ready(complete());
  const second = createCloudClient({ fetch: remote.fetcher }); await second.session(); await second.unlockVault({ recoveryKey });
  await client.request('/doses/dose1', 'PUT', dose('dose1', { revision: 2, note: 'First device correction' }));
  await assert.rejects(second.request('/doses/dose1', 'PUT', dose('dose1', { revision: 2, note: 'Unsaved second correction' })), error => error instanceof ApiError && error.status === 409);
  assert.equal(second.getState().revision, 1);
  const refreshed = await second.request<AppData>('/data');
  assert.equal(refreshed.doses[0].note, 'First device correction');
  await assert.rejects(second.request('/doses/dose1', 'PUT', dose('dose1', { revision: 2, note: 'Still stale' })), error => error instanceof ApiError && error.status === 409);
  assert.equal(remote.vault!.revision, 2);
});

test('an observed vault revision cannot roll backward and restore a deleted record', async () => {
  const { client, remote, recoveryKey } = await ready(complete());
  const old = structuredClone(remote.vault);
  await client.request('/doses/dose1', 'DELETE', { revision: 2 }, 'owner1');
  const latest = structuredClone(remote.vault);
  assert.equal(client.getState().revision, 2);
  remote.vault = old;
  await assert.rejects(client.request('/data'), error => error instanceof ApiError && error.status === 409 && /older record snapshot/.test(error.message));
  assert.equal(client.getState().revision, 2);
  assert.equal((await client.request<{data: AppData}>('/export')).data.doses.length, 0);
  client.lock();
  await assert.rejects(client.unlockVault({ recoveryKey }), /older record snapshot/);
  assert.equal(client.getState().locked, true);
  remote.vault = latest;
  assert.equal((await client.unlockVault({ recoveryKey })).doses.length, 0);
});

test('account deletion sends only the account password, clears keys, and rejects queued work', async () => {
  const { client, remote } = await ready(complete());
  const deletion = client.request('/account', 'DELETE', { password: 'correct-account-password' }, 'owner1');
  const lateSave = assert.rejects(client.request('/profile', 'PUT', { ...profile, name: 'Must not return' }, 'owner1'), error => error instanceof ApiError && error.status === 401);
  assert.deepEqual(await deletion, { ok: true });
  await lateSave;
  const request = remote.requests.find(row => row.path === '/account')!;
  assert.equal(request.method, 'DELETE');
  assert.deepEqual(request.body, { password: 'correct-account-password' });
  assert.equal(client.getState().locked, true);
  assert.equal(client.getState().user, null);
  assert.equal(remote.vault, null);
  await assert.rejects(client.request('/export'), /Sign in/);
  assert.equal(puts(remote).length, 1);
});

test('wrong account password does not destroy an open vault, and invalid deletion bodies never reach the server', async () => {
  const { client, remote } = await ready(complete());
  await assert.rejects(client.request('/account', 'DELETE', { password: 'wrong-password' }, 'owner1'), error => error instanceof ApiError && error.status === 403);
  assert.equal(client.getState().locked, false);
  assert.deepEqual((await client.request<{data: AppData}>('/export')).data, complete());
  const count = remote.requests.length;
  for (const body of [{ password: '' }, { password: 'correct-account-password', vaultPassphrase: passphrase }, { password: 3 }]) await assert.rejects(client.request('/account', 'DELETE', body, 'owner1'));
  await assert.rejects(client.request('/account', 'DELETE', { password: 'correct-account-password' }, 'wrong-owner'), /owns these records/);
  assert.equal(remote.requests.length, count);
});

test('account deletion waits for an earlier save and cannot be followed by a late plaintext restoration', async () => {
  const { client, remote } = await ready(complete()), held = remote.holdNext();
  const saving = client.request('/doses/dose1', 'PUT', dose('dose1', { revision: 2, note: 'Synthetic last save' }));
  await held.started.promise;
  const deletion = client.deleteAccount('correct-account-password');
  const after = assert.rejects(client.request('/data'), error => error instanceof ApiError && error.status === 401);
  assert.equal(remote.requests.some(row => row.path === '/account'), false);
  held.finish.resolve();
  await saving; await deletion; await after;
  assert.equal(client.getState().locked, true);
  assert.equal(remote.vault, null);
});

test('failed upload leaves confirmed data unchanged; exact retry reuses ciphertext safely', async () => {
  const { client, remote } = await ready(); remote.fail('before');
  const incoming = dose('new');
  await assert.rejects(client.request('/doses/new', 'PUT', incoming), error => error instanceof ApiError && error.status === 0 && !(error instanceof TypeError));
  assert.equal(client.getState().revision, 1);
  await assert.rejects(client.request('/data'), /unconfirmed/);
  const saved = await client.request<Dose>('/doses/new', 'PUT', incoming);
  assert.equal(saved.id, 'new'); assert.equal(saved.revision, 1);
  assert.deepEqual(puts(remote)[1].body, puts(remote)[2].body);
  assert.equal((await client.request<AppData>('/data')).doses.length, 1);
});

test('dropped acknowledgement is recognized on retry without a duplicate write', async () => {
  const { client, remote } = await ready(); remote.fail('after');
  await assert.rejects(client.request('/doses/new', 'PUT', dose('new')), error => error instanceof ApiError && error.status === 0);
  assert.equal(remote.vault!.revision, 2); assert.equal(client.getState().revision, 1);
  const saved = await client.request<Dose>('/doses/new', 'PUT', dose('new'));
  assert.equal(saved.revision, 1); assert.equal(puts(remote).length, 2); assert.equal(client.getState().revision, 2);
});

test('a different save cannot silently discard an unconfirmed save', async () => {
  const { client, remote } = await ready(); remote.fail('before');
  await assert.rejects(client.request('/doses/first', 'PUT', dose('first')));
  await assert.rejects(client.request('/doses/second', 'PUT', dose('second')), /Retry the previous save/);
  await client.request('/doses/first', 'PUT', dose('first'));
  await client.request('/doses/second', 'PUT', dose('second'));
  assert.deepEqual((await client.request<AppData>('/data')).doses.map(d => d.id), ['first', 'second']);
});

test('lock during a delayed save prevents resolved and queued work from restoring plaintext', async () => {
  const { client, remote } = await ready(); const gate = remote.holdNext();
  const saving = client.request('/doses/first', 'PUT', dose('first'));
  const queued = client.request('/doses/second', 'PUT', dose('second'));
  await gate.started.promise; client.lock(); gate.finish.resolve();
  await assert.rejects(saving, error => error instanceof ApiError && error.status === 401);
  await assert.rejects(queued, error => error instanceof ApiError && error.status === 401);
  assert.equal(client.getState().locked, true); assert.equal(client.getState().revision, 1);
  await assert.rejects(client.request('/export'), /Unlock/);
  assert.equal(puts(remote).length, 2);
});

test('wrong passphrase, ciphertext tampering and wrong owner fail without unlocked state', async () => {
  const { client, remote, recoveryKey } = await ready(complete()); client.lock();
  await assert.rejects(client.unlockVault({ vaultPassphrase: 'Incorrect phrase 中文' }), /Unable to unlock/);
  assert.equal(client.getState().locked, true);
  const original = structuredClone(remote.vault!);
  remote.vault!.dataEnvelope.ciphertext = (remote.vault!.dataEnvelope.ciphertext[0] === 'A' ? 'B' : 'A') + remote.vault!.dataEnvelope.ciphertext.slice(1);
  await assert.rejects(client.unlockVault({ recoveryKey }), /Unable to unlock/);
  remote.vault = { ...original, ownerId: 'other-owner' };
  await assert.rejects(client.unlockVault({ recoveryKey }), /invalid vault/);
  assert.equal(client.getState().locked, true);
});

test('invalid medical schema rejects before encryption or network mutation', async () => {
  const { client, remote } = await ready(); const before = puts(remote).length;
  await assert.rejects(client.request('/doses/bad', 'PUT', dose('bad', { amountMg: 'NaN' })), /decimal string/);
  await assert.rejects(client.request('/checkins/bad', 'PUT', { id: 'bad', date: '2026-09-13', timeZone: 'UTC', recordedAt: '2026-09-14T00:00:00Z', symptoms: ['headache'] }), /date must match/);
  assert.equal(puts(remote).length, before);
  assert.deepEqual((await client.request<AppData>('/data')).doses, []);
});

test('caller mutation and returned mutation cannot alter the private snapshot', async () => {
  const { client } = await ready(); const incoming = dose('isolated');
  const work = client.request<Dose>('/doses/isolated', 'PUT', incoming);
  incoming.note = 'Mutated caller input'; incoming.ingredients![0].amountMg = '999';
  const saved = await work; saved.note = 'Mutated returned value';
  const value = await client.request<AppData>('/data');
  assert.equal(value.doses[0].note, 'Private note 中文\nsecond line'); assert.equal(value.doses[0].ingredients![0].amountMg, '3');
});

test('full snapshot PUT clears old patch fields while an omitted legacy note is preserved', async () => {
  const old = dose('patch', { revision: 1, removalAt: '2026-09-13T20:00:00Z' });
  const { client } = await ready({ ...empty(), doses: [old] });
  const next: any = dose('patch', { revision: 1 }); delete next.ingredients; delete next.note;
  const saved = await client.request<Dose>('/doses/patch', 'PUT', next);
  assert.equal(saved.removalAt, undefined); assert.equal(saved.ingredients, undefined); assert.equal(saved.note, old.note);
});

test('current export restores all present fields, and full history import is rejected explicitly', async () => {
  const { client, remote } = await ready(complete());
  const current = await client.request<any>('/export');
  assert.equal(current.scope, 'current-data'); assert.equal(current.revisions, undefined);
  assert.deepEqual(parseBackup(JSON.stringify(current)), complete());
  const full = { ...current, scope: 'full-server', revisions: [{ id: 'old', data: dose('old') }], tombstones: [] }, before = structuredClone(full), count = puts(remote).length;
  await assert.rejects(client.request('/import', 'POST', { backup: full, mode: 'replace' }), /original full backup is unchanged/);
  assert.deepEqual(full, before); assert.equal(puts(remote).length, count);
  await assert.rejects(client.request('/import', 'POST', { backup: { ...current, tombstones: [{ id: 'deleted' }] }, mode: 'merge' }), /current snapshots only/);
});

test('merge keeps existing IDs and exact notes; replace is explicit and preserves all imported collections', async () => {
  const { client } = await ready({ ...empty(), doses: [dose('dose1', { note: 'Existing wins' })] });
  const imported = complete(); imported.doses.push(dose('additional'));
  const merge = await client.request<any>('/import', 'POST', { backup: archive(imported), mode: 'merge' });
  assert.equal(merge.skipped, 1); assert.equal(merge.fullHistory, false);
  const merged = await client.request<AppData>('/data'); assert.equal(merged.doses[0].note, 'Existing wins'); assert.equal(merged.doses.length, 2);
  await client.request('/import', 'POST', { backup: archive(complete()), mode: 'replace' });
  const replaced = await client.request<AppData>('/data');
  const contentOnly = (value: AppData) => JSON.parse(JSON.stringify(value, (key, item) => ['revision', 'createdAt', 'updatedAt'].includes(key) ? undefined : item));
  assert.deepEqual(contentOnly(replaced), contentOnly(complete()));
  assert.equal(replaced.doses[0].revision, 1);
  assert.equal(replaced.checkins[0].revision, 2);
});

test('favorites distinguish strength and reject semantic duplicates under different IDs', async () => {
  const { client, remote } = await ready();
  await client.request('/favorites/f5', 'PUT', { id: 'f5', productId: 'ritalin', strength: '5', quantity: '1' });
  await client.request('/favorites/f10', 'PUT', { id: 'f10', productId: 'ritalin', strength: '10', quantity: '1.5' });
  const count = puts(remote).length;
  await assert.rejects(client.request('/favorites/duplicate', 'PUT', { id: 'duplicate', productId: 'ritalin', strength: '5.0', quantity: '2' }), /already saved/);
  assert.equal(puts(remote).length, count); assert.equal((await client.request<AppData>('/data')).favorites.length, 2);
});

test('logout clears memory; expired authentication rejects without plaintext queue fallback', async () => {
  const { client, remote } = await ready(complete()); remote.expire();
  await assert.rejects(client.request('/doses/new', 'PUT', dose('new')), error => error instanceof ApiError && error.status === 401);
  assert.equal(client.getState().revision, 1);
  await client.logout(); assert.equal(client.getState().locked, true); assert.equal(client.getState().user, null);
  await assert.rejects(client.request('/export'), /Sign in/);
  assert.equal(new Headers(remote.requests.at(-1)!.init.headers).get('X-Dose-Owner'), 'owner1');
});

test('setup recovers a dropped successful acknowledgement without making a second vault', async () => {
  const remote = server(), client = createCloudClient({ fetch: remote.fetcher }); await client.session(); remote.fail('after');
  const setup = await client.setupVault(passphrase, complete());
  assert.equal(setup.recoveryKey.length, 43); assert.equal(client.getState().locked, false); assert.equal(puts(remote).length, 1);
});

test('real DoseEditor patch-to-IR correction clears removal and assumptions without reviving old medicine fields', async () => {
  const patch: Dose = { ...newDose('daytrana', '10'), id: 'patch-record', administeredAt: '2026-09-13T15:00:00Z', date: '2026-09-13', time: '15:00', timeZone: 'UTC', status: 'actual', revision: 1, note: 'Keep original note', removalAt: '2026-09-13T20:00:00Z' };
  const { client } = await ready({ ...empty(), doses: [patch] });
  const changed = updateDose(patch, { productId: 'ritalin' }, 'UTC');
  assert.equal(Object.hasOwn(changed, 'removalAt'), true); assert.equal(changed.removalAt, undefined);
  const saved = await client.request<Dose>('/doses/patch-record', 'PUT', changed);
  assert.equal(saved.removalAt, undefined); assert.equal(saved.assumptions, undefined); assert.equal(saved.unit, 'tablet'); assert.equal(saved.amountBasis, 'labeled ingredient'); assert.equal(saved.note, 'Keep original note');
});

test('setup snapshots its input before asynchronous crypto and lock suppresses its delayed acknowledgement', async () => {
  const remote = server(), client = createCloudClient({ fetch: remote.fetcher }); await client.session();
  const initial = complete(), expected = structuredClone(initial), gate = remote.holdNext();
  const work = client.setupVault(passphrase, initial);
  initial.doses[0].note = 'Caller mutation';
  await gate.started.promise; client.lock(); gate.finish.resolve();
  await assert.rejects(work, error => error instanceof ApiError && error.status === 401);
  assert.equal(client.getState().locked, true);
  assert.deepEqual(await client.unlockVault({ vaultPassphrase: passphrase }), expected);
});

test('recovery-key unlock still rejects malformed or wrong-owner wrapped-key metadata', async () => {
  const { client, remote, recoveryKey } = await ready(); client.lock();
  remote.vault!.keyEnvelope.ownerId = 'different-owner';
  await assert.rejects(client.unlockVault({ recoveryKey }), /invalid encrypted vault/);
  assert.equal(client.getState().locked, true);
});

test('offline logout still clears local keys and data without claiming server session revocation', async () => {
  const remote = server(); let offline = false;
  const client = createCloudClient({ fetch: (async (url, init) => { if (offline && String(url).endsWith('/auth/logout')) throw new TypeError('offline'); return remote.fetcher(url, init); }) as typeof fetch });
  await client.session(); await client.setupVault(passphrase, complete()); offline = true;
  await assert.rejects(client.logout(), /device is locked.*session may still be active/);
  assert.equal(client.getState().locked, true);
  await assert.rejects(client.request('/export'), /Unlock/);
  offline = false; await client.unlockVault({ vaultPassphrase: passphrase });
  assert.equal(client.getState().locked, false);
});

test('setup retries after both lost acknowledgement and failed reconciliation return the original recovery key', async () => {
  const remote = server(); let outage = false;
  const client = createCloudClient({ fetch: (async (url, init) => {
    if (outage && String(url).endsWith('/vault') && init?.method === 'GET') throw new TypeError('still offline');
    return remote.fetcher(url, init);
  }) as typeof fetch });
  await client.session(); remote.fail('after'); outage = true;
  await assert.rejects(client.setupVault(passphrase, complete()), error => error instanceof ApiError && error.status === 0);
  const committed = structuredClone(remote.vault); assert.equal(client.getState().locked, true);
  outage = false;
  await assert.rejects(client.setupVault('A different retry phrase', complete()), /Unable to unlock/);
  const retried = await client.setupVault(passphrase, complete());
  assert.equal(puts(remote).length, 1); assert.deepEqual(remote.vault, committed);
  assert.deepEqual(await decryptVault(remote.vault!.dataEnvelope, await importRecoveryKey(retried.recoveryKey), 'owner1'), complete());
  assert.equal(client.getState().locked, false);
});

test('setup retry after an uncommitted offline attempt resends the same encrypted key and payload', async () => {
  const remote = server(), client = createCloudClient({ fetch: remote.fetcher }); await client.session(); remote.fail('before');
  await assert.rejects(client.setupVault(passphrase), error => error instanceof ApiError && error.status === 0);
  assert.equal(remote.vault, null);
  await client.setupVault(passphrase);
  assert.deepEqual(puts(remote)[0].body, puts(remote)[1].body); assert.equal(client.getState().revision, 1);
});

test('replace import never rolls an existing record revision backwards or accepts a stale edit', async () => {
  const current = complete(); current.doses[0].revision = 20;
  const { client } = await ready(current);
  const older = complete(); older.doses[0].revision = 1; older.doses[0].note = 'Restored older contents by choice';
  await client.request('/import', 'POST', { backup: archive(older), mode: 'replace' });
  const restored = await client.request<AppData>('/data');
  assert.equal(restored.doses[0].revision, 21); assert.equal(restored.doses[0].note, older.doses[0].note);
  await assert.rejects(client.request('/doses/dose1', 'PUT', current.doses[0]), error => error instanceof ApiError && error.status === 409);
});

function transferFixture(){
  const workspace=freshGuestWorkspace('UTC');workspace.date='2026-09-13';
  workspace.drafts=[{...newDose('ritalin','7.5'),timeZone:'UTC',date:'2026-09-13',time:'15:03',administeredAt:'2026-09-13T15:03:00Z',note:'SYNTHETIC guest import confidential 91837'}];
  workspace.favorites=[{id:'guest-favorite',productId:'ritalin',strength:'7.5',packageStrength:'7.5',quantity:'1'}];
  return prepareGuestTransfer(workspace);
}
test('guest transfer writes one encrypted snapshot and a lost acknowledgement retry confirms the same simulation once',async()=>{
  const initial=complete(),{client,remote}=await ready(initial),transfer=transferFixture(),original=structuredClone(transfer);
  remote.fail('after');
  await assert.rejects(client.request('/guest-import','POST',transfer,'owner1'),error=>error instanceof ApiError&&error.status===0);
  assert.deepEqual((await client.request<{data:AppData}>('/export')).data,initial);
  const committed=structuredClone(remote.vault);
  assert.deepEqual(await client.request('/guest-import','POST',transfer,'owner1'),{ok:true});
  assert.equal(puts(remote).length,2);assert.deepEqual(remote.vault,committed);assert.deepEqual(transfer,original);
  const merged=(await client.request<{data:AppData}>('/export')).data;
  assert.deepEqual(merged.doses,initial.doses);assert.deepEqual(merged.profile,initial.profile);assert.deepEqual(merged.inventory,initial.inventory);
  assert.equal(merged.scenarios[0].doses.length,2);assert.equal(merged.scenarios[0].doses[1].status,'simulated');
  assert.equal(remote.requests.some(row=>row.path==='/guest-import'),false);
  assert.equal(JSON.stringify(remote.requests).includes('SYNTHETIC guest import confidential 91837'),false);
});
test('guest transfer retries a precommit failure with identical envelopes and merges the latest other-device data',async()=>{
  const {client,remote,recoveryKey}=await ready(complete()),other=createCloudClient({fetch:remote.fetcher});
  await other.session();await other.unlockVault({recoveryKey});
  await other.request('/profile','PUT',{...profile,name:'Newer account preference',revision:0});
  const transfer=transferFixture();remote.fail('before');
  await assert.rejects(client.request('/guest-import','POST',transfer),error=>error instanceof ApiError&&error.status===0);
  const attempted=structuredClone(puts(remote).at(-1)!.body);
  await client.request('/guest-import','POST',transfer);
  assert.deepEqual(puts(remote).at(-1)!.body,attempted);
  const merged=(await client.request<{data:AppData}>('/export')).data;
  assert.equal(merged.profile!.name,'Newer account preference');assert.equal(merged.scenarios[0].doses.length,2);
});
test('locking during guest upload suppresses its acknowledgement and discards the decrypted candidate',async()=>{
  const {client,remote}=await ready(),transfer=transferFixture(),hold=remote.holdNext();
  const work=client.request('/guest-import','POST',transfer);
  await hold.started.promise;client.lock();hold.finish.resolve();
  await assert.rejects(work,error=>error instanceof ApiError&&error.status===401);
  assert.equal(client.getState().locked,true);
  await assert.rejects(client.request('/export'),error=>error instanceof ApiError&&error.status===423);
  assert.equal(transfer.workspace.drafts.length,1);
});
test('guest transfer CAS conflict preserves the other-device write and retry remerges the same frozen transfer',async()=>{
  const {client:other,remote,recoveryKey}=await ready(complete());let race=false;
  const client=createCloudClient({fetch:(async(url,init)=>{
    if(race&&String(url).endsWith('/vault')&&init?.method==='PUT'){
      race=false;await other.request('/profile','PUT',{...profile,name:'Concurrent account change',revision:0});
    }
    return remote.fetcher(url,init);
  }) as typeof fetch});
  await client.session();await client.unlockVault({recoveryKey});const transfer=transferFixture();race=true;
  await assert.rejects(client.request('/guest-import','POST',transfer),error=>error instanceof ApiError&&error.status===409);
  assert.equal((await other.request<{data:AppData}>('/export')).data.scenarios[0].doses.length,1);
  await client.request('/guest-import','POST',transfer);
  const merged=(await client.request<{data:AppData}>('/export')).data;
  assert.equal(merged.profile!.name,'Concurrent account change');assert.equal(merged.scenarios[0].doses.length,2);
  assert.deepEqual(merged.doses,complete().doses);
});
test('invalid guest transfers never upload a vault or change confirmed account records',async()=>{
  const initial=complete(),{client,remote}=await ready(initial),transfer=transferFixture();
  transfer.workspace.drafts[0].quantity='0.';
  await assert.rejects(client.request('/guest-import','POST',transfer),/Complete or remove/);
  assert.equal(puts(remote).length,1);assert.deepEqual((await client.request<{data:AppData}>('/export')).data,initial);
});
