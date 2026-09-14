import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Pool } from 'pg';
import { openCloudPostgres } from '../server/cloud-postgres.mjs';
import { createCloudServer } from '../server/cloud.mjs';
import { createVaultKey, encryptVault, decryptVault, wrapVaultKey, unwrapVaultKey } from '../src/lib/vault-crypto.ts';
import { dropDisconnectedTestDatabase } from './helpers/postgres-cleanup.mjs';

const testUrl = process.env.DRUG_TEST_POSTGRES_URL;
const origin = 'https://drug-tracker-7e9d0c2e62c1.herokuapp.com';
const accountPassword = 'SYNTHETIC ACCOUNT PASSWORD 8352';
const vaultPassword = 'SYNTHETIC SEPARATE ENCRYPTION PASSWORD 8352';
const healthNote = 'SYNTHETIC PRIVATE HEALTH NOTE 8352';
const hash = value => createHash('sha256').update(value).digest('hex');
const session = () => ({ tokenHash: hash(randomBytes(32)), expiresAt: Date.now() + 86_400_000 });
const account = username => ({ id: randomUUID(), username, name: username, password_hash: 'synthetic-test-hash-only' });
function opaque(ownerId, expectedRevision = 0, marker = 63) {
  const binary = n => Buffer.alloc(n, marker).toString('base64url');
  const common = { protocol: 'dose-timeline-vault', version: 1, ownerId, cipher: 'AES-256-GCM', iv: binary(12) };
  return { expectedRevision, dataEnvelope: { ...common, kind: 'data', ciphertext: binary(17) },
    keyEnvelope: { ...common, kind: 'wrapped-key', ciphertext: binary(48), kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt: binary(16) } } };
}
async function request(instance, path, { method = 'GET', body, cookie, owner, headers = {}, capture } = {}) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: instance.server.address().port, path: `/drug/api${path}`, method, headers: {
      Host: new URL(origin).host, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.44', ...(!['GET','HEAD'].includes(method) ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...(owner ? { 'X-Dose-Owner': owner } : {}),
      ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}), ...headers,
    } }, res => {
      let output = ''; res.on('data', chunk => { output += chunk; });
      res.once('end', () => resolve({ status: res.statusCode, data: JSON.parse(output), cookie: res.headers['set-cookie']?.[0].split(';')[0], headers: res.headers }));
    }); req.once('error', reject); capture?.(req); req.end(encoded);
  });
}
async function waitUntilBlocked(pool, queryFragment, blockingPid = null) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query("SELECT pid FROM pg_stat_activity WHERE application_name='drug-tracker-cloud' AND datname=current_database() AND wait_event_type='Lock' AND query LIKE $1 AND ($2::integer IS NULL OR $2=ANY(pg_blocking_pids(pid)))", [`%${queryFragment}%`, blockingPid]);
    if (result.rowCount) return result.rows[0].pid;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected PostgreSQL lock wait was not observed.');
}

test('PostgreSQL fixture cleanup waits for client disconnection after pool.end resolves', { skip: !testUrl, timeout: 10_000 }, async () => {
  const url = new URL(testUrl);
  assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname)); assert.equal(url.search, '');
  const admin = new Pool({ connectionString: url.toString(), ssl: false });
  const database = `drug_test_${randomBytes(8).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${database}`); url.pathname = `/${database}`;
  const pool = new Pool({ connectionString: url.toString(), ssl: false, max: 1 });
  let finishConnection, disconnected;
  try {
    const client = await pool.connect();
    disconnected = new Promise(resolve => client.once('end', resolve));
    const originalEnd = client.end.bind(client);
    // Deterministically hold the real TCP shutdown that pg-pool does not await.
    // This recreates the CI teardown ordering without killing or ignoring errors.
    client.end = (...args) => { finishConnection = () => originalEnd(...args); };
    client.release(); await pool.end();
    assert.equal(typeof finishConnection, 'function');
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1', [database])).rows[0].count, 1);
    let dropped = false;
    const dropping = dropDisconnectedTestDatabase(admin, database).then(() => { dropped = true; });
    try {
      assert.equal((await admin.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1', [database])).rows[0].count, 1);
      assert.equal(dropped, false, 'A completed pool shutdown must not be mistaken for a disconnected client.');
    } finally {
      finishConnection(); finishConnection = undefined;
      await dropping; await disconnected;
    }
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
  } finally {
    finishConnection?.();
    if (!pool.ending) await pool.end();
    if (disconnected) await disconnected;
    try {
      if ((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount) await dropDisconnectedTestDatabase(admin, database);
    } finally { await admin.end(); }
  }
});

test('real PostgreSQL cloud integration (explicit temporary local database only)', { skip: !testUrl, timeout: 60_000 }, async t => {
  const url = new URL(testUrl);
  assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'Integration tests never connect to a remote database.');
  assert.equal(url.search, '', 'Use an explicit unencrypted loopback test URL.');
  const admin = new Pool({ connectionString: url.toString(), ssl: false, max: 2 });
  const database = `drug_test_${randomBytes(8).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${database}`);
  url.pathname = `/${database}`;
  const options = { databaseUrl: url.toString(), allowInsecurePostgresLoopback: true };
  const control = new Pool({ connectionString: url.toString(), ssl: false, max: 3 });
  const stores = [], instances = [];
  t.after(async () => {
    await Promise.all(instances.map(async instance => {
      await new Promise(resolve => { instance.server.close(resolve); instance.server.closeAllConnections(); }); await instance.closeStorage();
    }));
    await Promise.all(stores.map(store => store.close())); await control.end();
    try { await dropDisconnectedTestDatabase(admin, database); }
    finally { await admin.end(); }
  });
  const [a, b, c] = await Promise.all(Array.from({ length: 3 }, () => openCloudPostgres(options)));
  stores.push(a, b, c);
  const owner = account('repo_owner'), ownerSession = session();
  await a.register(owner, ownerSession);

  await t.test('concurrent schema initialization and registration preserve unique accounts and shared sessions', async () => {
    assert.equal((await control.query('SELECT version FROM drug_tracker.meta')).rows[0].version, 3);
    const attempts = await Promise.allSettled([a,b].map(store => store.register(account('same_username'), session())));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(result => result.status === 'rejected').reason.status, 409);
    assert.equal((await c.session(ownerSession.tokenHash)).id, owner.id);
    assert.equal((await control.query('SELECT count(*)::int AS count FROM drug_tracker.accounts')).rows[0].count, 2);
  });
  await t.test('cross-instance first-write and subsequent CAS save the whole envelope pair once', async () => {
    for (const expectedRevision of [0,1]) {
      const inputs = [opaque(owner.id, expectedRevision, 41), opaque(owner.id, expectedRevision, 42)];
      const results = await Promise.allSettled([a,b].map((store,i) => store.writeVault(owner.id, ownerSession.tokenHash, inputs[i])));
      const index = results.findIndex(result => result.status === 'fulfilled');
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.find(result => result.status === 'rejected').reason.currentRevision, expectedRevision + 1);
      const saved = await c.readVault(owner.id, ownerSession.tokenHash);
      assert.deepEqual(saved.dataEnvelope, inputs[index].dataEnvelope); assert.deepEqual(saved.keyEnvelope, inputs[index].keyEnvelope);
    }
  });
  await t.test('real encrypted browser payload survives store restart; database has no plaintext health or encryption password', async () => {
    const key = await createVaultKey(), keyEnvelope = await wrapVaultKey(key, vaultPassword, owner.id);
    const data = { profile: null, doses: [{ id: 'synthetic-dose', note: healthNote }], scenarios: [], favorites: [], checkins: [], inventory: [] };
    const dataEnvelope = await encryptVault(data, key, owner.id);
    await a.writeVault(owner.id, ownerSession.tokenHash, { expectedRevision: 2, dataEnvelope, keyEnvelope });
    const reopened = await openCloudPostgres(options); stores.push(reopened);
    const stored = await reopened.readVault(owner.id, ownerSession.tokenHash);
    const unwrapped = await unwrapVaultKey(stored.keyEnvelope, vaultPassword, owner.id);
    assert.deepEqual(await decryptVault(stored.dataEnvelope, unwrapped, owner.id), data);
    await assert.rejects(unwrapVaultKey(stored.keyEnvelope, accountPassword, owner.id));
    const raw = JSON.stringify((await control.query('SELECT * FROM drug_tracker.vaults')).rows);
    for (const secret of [healthNote,vaultPassword,accountPassword]) assert.ok(!raw.includes(secret));
  });
  await t.test('invalid/foreign envelopes cannot replace old data or key, and account selection stays explicit', async () => {
    const before = await a.readVault(owner.id, ownerSession.tokenHash);
    const bad = opaque(owner.id, 3); bad.keyEnvelope.kdf.iterations = 1;
    await assert.rejects(async () => a.writeVault(owner.id, ownerSession.tokenHash, bad), error => error.status === 400);
    await assert.rejects(async () => a.writeVault(owner.id, ownerSession.tokenHash, opaque('another-owner',3)), error => error.status === 403);
    await assert.rejects(a.readVault('another-owner', ownerSession.tokenHash), error => error.status === 401);
    assert.deepEqual(await b.readVault(owner.id, ownerSession.tokenHash), before);
  });
  await t.test('a write holds its session lock until commit; logout waits and every later write is rejected', async () => {
    const blocker = await control.connect(); await blocker.query('BEGIN');
    await blocker.query('SELECT owner_id FROM drug_tracker.vaults WHERE owner_id=$1 FOR UPDATE', [owner.id]);
    const write = a.writeVault(owner.id, ownerSession.tokenHash, opaque(owner.id,3));
    await waitUntilBlocked(control, 'INSERT INTO drug_tracker.vaults');
    let logoutFinished = false;
    const logout = b.logout(ownerSession.tokenHash, owner.id).then(() => { logoutFinished = true; });
    await waitUntilBlocked(control, 'FOR UPDATE OF s');
    assert.equal(logoutFinished, false);
    await blocker.query('COMMIT'); blocker.release();
    assert.equal((await write).revision, 4); await logout;
    await assert.rejects(c.writeVault(owner.id, ownerSession.tokenHash, opaque(owner.id,4)), error => error.status === 401);
    assert.equal(await c.session(ownerSession.tokenHash), null);
  });
  await t.test('account password changes cannot issue stale sessions; shared attempt budgets survive reopening', async () => {
    const freshSession = session();
    await control.query('UPDATE drug_tracker.accounts SET password_hash=$1 WHERE id=$2', ['changed-hash',owner.id]);
    await assert.rejects(a.login(owner,freshSession), error => error.status === 401);
    assert.equal(await b.session(freshSession.tokenHash), null);
    const results = await Promise.allSettled([a,b,c].map(store => store.consumeRateLimit('login',hash('synthetic-a'),2,60_000)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length,2);
    assert.equal(results.find(result => result.status === 'rejected').reason.status,429);
    const reopened = await openCloudPostgres(options); stores.push(reopened);
    await assert.rejects(reopened.consumeRateLimit('login',hash('synthetic-a'),2,60_000), error => error.status===429);
    await reopened.consumeRateLimit('login',hash('synthetic-b'),2,60_000);
    await reopened.consumeRateLimit('register',hash('synthetic-a'),2,60_000);
    await control.query('DELETE FROM drug_tracker.rate_limits');
  });
  await t.test('two HTTP instances share secure login and encrypted saves, and enforce exact origin/owner/proxy', async () => {
    for (let i=0;i<2;i++) {
      const instance = await createCloudServer({ ...options, origin, proxyMode:'heroku', allowLegacyRegistration:true }); instances.push(instance);
      await new Promise(resolve => instance.server.listen(0,'127.0.0.1',resolve));
    }
    const registered = await request(instances[0],'/auth/register',{method:'POST',body:{username:'http_synthetic',password:accountPassword}});
    assert.equal(registered.status,201);
    assert.match(registered.headers['set-cookie'][0], /Secure/);
    const signed = { cookie:registered.cookie,owner:registered.data.user.id };
    assert.deepEqual((await request(instances[1],'/session',signed)).data,{user:registered.data.user});
    assert.equal((await request(instances[1],'/vault',{...signed,method:'PUT',body:opaque(signed.owner)})).status,200);
    assert.equal((await request(instances[0],'/vault',signed)).data.vault.revision,1);
    for (const headers of [{'X-Forwarded-Proto':'http'},{'X-Forwarded-Proto':'https,http'},{Host:'evil.test','X-Forwarded-Host':new URL(origin).host},{Origin:'https://evil.test'}])
      assert.equal((await request(instances[1],'/vault',{...signed,headers})).status,403);
    assert.equal((await request(instances[1],'/vault',{...signed,owner:'wrong-owner'})).status,401);
    assert.equal((await request(instances[0],'/auth/logout',{...signed,method:'POST',body:{}})).status,200);
    assert.equal((await request(instances[1],'/vault',signed)).status,401);
    assert.equal((await request(instances[1],'/auth/login',{method:'POST',body:{username:'http_synthetic',password:accountPassword}})).status,200);
  });
  await t.test('a connection aborted during its owner lookup cannot leave an unread body reservation stuck', async () => {
    const registered = await request(instances[0],'/auth/register',{method:'POST',body:{username:'aborted_lookup_synthetic',password:accountPassword}});
    assert.equal(registered.status,201);
    const signed = {cookie:registered.cookie,owner:registered.data.user.id};
    const blocker = await control.connect(); await blocker.query('BEGIN');
    try {
      await blocker.query('LOCK TABLE drug_tracker.sessions IN ACCESS EXCLUSIVE MODE');
      let wireRequest;
      // Client-side ECONNRESET does not prove that the server has received the
      // disconnect yet. Keep PostgreSQL blocked until its socket closes too.
      const serverDisconnected = new Promise(resolve => instances[0].server.once('request', req => req.socket.once('close', resolve)));
      const saving = request(instances[0],'/vault',{...signed,method:'PUT',body:opaque(signed.owner),capture:req=>{wireRequest=req;}}).catch(error=>error.code);
      await waitUntilBlocked(control,'SELECT a.* FROM drug_tracker.accounts');
      wireRequest.destroy(); assert.equal(await saving,'ECONNRESET');
      await serverDisconnected;
      await blocker.query('COMMIT');
      // Allow the already-blocked lookup to resume before asserting the next admission.
      for (let i=0;i<100;i++) {
        const still = await control.query("SELECT 1 FROM pg_stat_activity WHERE application_name='drug-tracker-cloud' AND datname=current_database() AND wait_event_type='Lock'");
        if(!still.rowCount)break;await new Promise(resolve=>setTimeout(resolve,5));
      }
      await new Promise(resolve=>setTimeout(resolve,10));
      let read;
      for(let i=0;i<100;i++) { read=await request(instances[0],'/vault',signed);if(read.status!==429)break;await new Promise(resolve=>setTimeout(resolve,5)); }
      assert.equal(read.status,200);assert.equal(read.data.vault,null);
      assert.equal((await request(instances[0],'/vault',{...signed,method:'PUT',body:opaque(signed.owner)})).status,200);
    } finally { await blocker.query('ROLLBACK');blocker.release(); }
  });
  await t.test('disconnecting after an admitted upload does not release its budget while PostgreSQL still holds the payload', async () => {
    const registered = await request(instances[0],'/auth/register',{method:'POST',body:{username:'disconnected_synthetic',password:accountPassword}});
    assert.equal(registered.status,201);
    const signed = {cookie:registered.cookie,owner:registered.data.user.id};
    const blocker = await control.connect(); await blocker.query('BEGIN');
    try {
      await blocker.query('SELECT id FROM drug_tracker.accounts WHERE id=$1 FOR UPDATE',[signed.owner]);
      let wireRequest;
      const saving = request(instances[0],'/vault',{...signed,method:'PUT',body:opaque(signed.owner),capture:req=>{wireRequest=req;}}).catch(error=>error.code);
      await waitUntilBlocked(control,'SELECT * FROM drug_tracker.accounts');
      wireRequest.destroy(); assert.equal(await saving,'ECONNRESET');
      const busy = await request(instances[0],'/vault',signed);
      assert.equal(busy.status,429); assert.equal(busy.headers['retry-after'],'1');
      await blocker.query('COMMIT');
      let read;
      for (let i=0;i<100;i++) { read=await request(instances[0],'/vault',signed); if(read.status!==429)break;await new Promise(resolve=>setTimeout(resolve,5)); }
      assert.equal(read.status,200); assert.equal(read.data.vault.revision,1);
      // Cross-instance deletion revokes this cookie as well as the active database data.
      assert.equal((await request(instances[1],'/account',{...signed,method:'DELETE',body:{password:'synthetic wrong'}})).status,403);
      assert.equal((await request(instances[1],'/account',{...signed,method:'DELETE',body:{password:accountPassword}})).status,200);
      assert.equal((await request(instances[0],'/vault',signed)).status,401);
      assert.deepEqual((await request(instances[1],'/session',signed)).data,{user:null});
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });
  await t.test('deletion waits for an earlier save, revokes every session and rejects queued login without touching another owner', async () => {
    const doomed = account('delete_synthetic'), first = session(), second = session();
    await a.register(doomed, first); await b.login(doomed, second);
    await a.writeVault(doomed.id, first.tokenHash, opaque(doomed.id));
    await assert.rejects(a.deleteAccount(doomed.id, first.tokenHash, 'wrong-hash'), error => error.status === 401);
    await assert.rejects(a.deleteAccount(doomed.id, ownerSession.tokenHash, doomed.password_hash), error => error.status === 401);
    assert.equal((await a.readVault(doomed.id, first.tokenHash)).revision, 1);
    const blocker = await control.connect(), sessionBlocker = await control.connect();
    await blocker.query('BEGIN'); await sessionBlocker.query('BEGIN');
    const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const sessionBlockerPid = (await sessionBlocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    try {
      await blocker.query('SELECT owner_id FROM drug_tracker.vaults WHERE owner_id=$1 FOR UPDATE', [doomed.id]);
      // Permit the deletion's session confirmation, then hold its session DELETE
      // so its account lock is definitely acquired before the late login starts.
      await sessionBlocker.query('SELECT token_hash FROM drug_tracker.sessions WHERE token_hash=$1 FOR SHARE', [second.tokenHash]);
      const saving = a.writeVault(doomed.id, first.tokenHash, opaque(doomed.id, 1));
      const savingPid = await waitUntilBlocked(control, 'INSERT INTO drug_tracker.vaults', blockerPid);
      let removed = false;
      const removing = b.deleteAccount(doomed.id, second.tokenHash, doomed.password_hash).then(() => { removed = true; });
      const removingPid = await waitUntilBlocked(control, 'SELECT * FROM drug_tracker.accounts', savingPid);
      assert.equal(removed, false);
      await blocker.query('COMMIT');
      assert.equal((await saving).revision, 2);
      assert.equal(await waitUntilBlocked(control, 'DELETE FROM drug_tracker.sessions WHERE owner_id=$1', sessionBlockerPid), removingPid);
      // Queue order alone does not establish ownership of PostgreSQL row locks.
      // Observe login waiting behind the deletion transaction's held account lock.
      const lateSession = session();
      const lateLogin = c.login(doomed, lateSession).then(() => 'unexpected login', error => error.status);
      await waitUntilBlocked(control, 'AND password_hash=$2 FOR SHARE', removingPid);
      assert.equal(removed, false);
      await sessionBlocker.query('COMMIT'); await removing;
      assert.equal(await lateLogin, 401);
      assert.equal(await a.session(first.tokenHash), null); assert.equal(await b.session(second.tokenHash), null);
      assert.equal(await c.session(lateSession.tokenHash), null);
      assert.equal(await c.accountByUsername(doomed.username), null);
      await assert.rejects(c.login(doomed, session()), error => error.status === 401);
      await assert.rejects(a.writeVault(doomed.id, first.tokenHash, opaque(doomed.id,2)), error => error.status === 401);
      for (const [table,column] of [['accounts','id'],['sessions','owner_id'],['vaults','owner_id']]) {
        assert.equal((await control.query(`SELECT count(*)::int AS n FROM drug_tracker.${table} WHERE ${column}=$1`, [doomed.id])).rows[0].n, 0);
      }
      assert.equal((await a.accountByUsername(owner.username)).id, owner.id);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await sessionBlocker.query('ROLLBACK'); sessionBlocker.release(); }
  });
  await t.test('password replacement rolls back on session collision, then waits for prior writes and rejects stale login while preserving ciphertext', async () => {
    const secured=account('security_race_owner'),one=session(),two=session();
    const independent=account('security_race_other'),unrelated=session();
    await a.register(secured,one);await b.login(secured,two);await a.register(independent,unrelated);
    await a.writeVault(secured.id,one.tokenHash,opaque(secured.id));
    await assert.rejects(a.changePassword(secured.id,one.tokenHash,secured.password_hash,'new-synthetic-hash',unrelated),error=>error.code==='23505');
    assert.equal((await a.accountByUsername(secured.username)).password_hash,secured.password_hash);
    assert.equal((await a.securityInfo(secured.id,one.tokenHash)).activeSessionCount,2);
    assert.equal((await b.session(unrelated.tokenHash)).id,independent.id);
    const blocker=await control.connect(),sessionBlocker=await control.connect();
    await blocker.query('BEGIN');await sessionBlocker.query('BEGIN');
    const sessionBlockerPid=(await sessionBlocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const replacement=session();
    try {
      await blocker.query('SELECT owner_id FROM drug_tracker.vaults WHERE owner_id=$1 FOR UPDATE',[secured.id]);
      // This second barrier permits confirmation, then holds session deletion. It
      // proves the password transaction owns the account lock before stale work starts.
      await sessionBlocker.query('SELECT token_hash FROM drug_tracker.sessions WHERE token_hash=$1 FOR SHARE',[two.tokenHash]);
      const saving=a.writeVault(secured.id,one.tokenHash,opaque(secured.id,1));
      await waitUntilBlocked(control,'INSERT INTO drug_tracker.vaults');
      const changing=b.changePassword(secured.id,two.tokenHash,secured.password_hash,'new-synthetic-hash',replacement);
      await waitUntilBlocked(control,'SELECT * FROM drug_tracker.accounts');
      await blocker.query('COMMIT');assert.equal((await saving).revision,2);
      const changingPid=await waitUntilBlocked(control,'DELETE FROM drug_tracker.sessions WHERE owner_id=$1',sessionBlockerPid);
      // A request merely queued before another does not establish PostgreSQL row
      // lock order. Observe these waits behind the already-held account lock instead.
      const staleLogin=c.login(secured,session()).then(()=>200,error=>error.status);
      const staleVerification=c.verifyPassword(secured.id,two.tokenHash,secured.password_hash).then(()=>200,error=>error.status);
      await waitUntilBlocked(control,'AND password_hash=$2 FOR SHARE',changingPid);
      await waitUntilBlocked(control,'WHERE id=$1 FOR SHARE');
      await sessionBlocker.query('COMMIT');
      const changed=await changing;assert.equal(changed.security.activeSessionCount,1);assert.equal(changed.security.sessionLifetimeHours,24);
      assert.equal(await staleLogin,401);
      assert.equal(await staleVerification,401);
      assert.equal(await a.session(one.tokenHash),null);assert.equal(await a.session(two.tokenHash),null);
      assert.equal((await a.readVault(secured.id,replacement.tokenHash)).revision,2);
      await assert.rejects(a.logoutAll(secured.id,replacement.tokenHash,secured.password_hash),error=>error.status===401);
      await b.logoutAll(secured.id,replacement.tokenHash,'new-synthetic-hash');
      assert.equal(await a.session(replacement.tokenHash),null);
      assert.equal((await a.session(unrelated.tokenHash)).id,independent.id);
      const relogged=session();await a.login({...secured,password_hash:'new-synthetic-hash'},relogged);
      assert.equal((await a.readVault(secured.id,relogged.tokenHash)).revision,2);
    } finally {await blocker.query('ROLLBACK');blocker.release();await sessionBlocker.query('ROLLBACK');sessionBlocker.release();}
  });
  await t.test('PostgreSQL HTTP security routes rotate 24h cookies and revoke all devices without changing envelopes', async () => {
    const registered=await request(instances[0],'/auth/register',{method:'POST',body:{username:'security_http_owner',password:accountPassword}});
    assert.equal(registered.status,201);assert.match(registered.headers['set-cookie'][0],/Max-Age=86400/);
    const signed={cookie:registered.cookie,owner:registered.data.user.id};
    const input=opaque(signed.owner);
    input.keyEnvelope={...input.keyEnvelope,version:2,kdf:{name:'Argon2id',version:19,memoryKiB:65536,iterations:3,parallelism:1,salt:Buffer.alloc(16,22).toString('base64url')}};
    const saved=await request(instances[1],'/vault',{...signed,method:'PUT',body:input});assert.equal(saved.status,200);
    assert.equal((await request(instances[1],'/security',signed)).data.security.activeSessionCount,1);
    const confirmed=await request(instances[1],'/auth/verify-password',{...signed,method:'POST',body:{password:accountPassword}});
    assert.equal(confirmed.status,200);assert.deepEqual(confirmed.data,{ok:true});assert.equal(confirmed.headers['set-cookie'],undefined);
    const newPassword='SYNTHETIC! glacier orbit fern 8294';
    assert.equal((await request(instances[1],'/auth/change-password',{...signed,method:'POST',body:{currentPassword:'wrong',newPassword}})).status,403);
    const changed=await request(instances[1],'/auth/change-password',{...signed,method:'POST',body:{currentPassword:accountPassword,newPassword}});
    assert.equal(changed.status,200);assert.notEqual(changed.cookie,signed.cookie);assert.equal(changed.data.security.activeSessionCount,1);
    assert.deepEqual((await request(instances[0],'/session',signed)).data,{user:null});
    const replacement={owner:signed.owner,cookie:changed.cookie};
    assert.deepEqual((await request(instances[0],'/vault',replacement)).data,saved.data);
    const invalid={...input,expectedRevision:1,keyEnvelope:{...input.keyEnvelope,kdf:{...input.keyEnvelope.kdf,memoryKiB:2**30}}};
    assert.equal((await request(instances[0],'/vault',{...replacement,method:'PUT',body:invalid})).status,400);
    assert.deepEqual((await request(instances[0],'/vault',replacement)).data,saved.data);
    assert.equal((await request(instances[0],'/auth/logout-all',{...replacement,method:'POST',body:{password:newPassword}})).status,200);
    assert.deepEqual((await request(instances[1],'/session',replacement)).data,{user:null});
    assert.equal((await request(instances[0],'/auth/login',{method:'POST',body:{username:'security_http_owner',password:accountPassword}})).status,401);
    assert.equal((await request(instances[1],'/auth/login',{method:'POST',body:{username:'security_http_owner',password:newPassword}})).status,200);
  });
  await t.test('reopening PostgreSQL caps legacy session expiry at creation plus 24h without extending it on another restart', async () => {
    const old=account('legacy_long_session'),value=session();await a.register(old,value);
    const created=new Date(Date.now()-2*86400_000).toISOString();
    await control.query('UPDATE drug_tracker.sessions SET created_at=$1,expires_at=$2 WHERE token_hash=$3',[created,Date.now()+28*86400_000,value.tokenHash]);
    const reopened=await openCloudPostgres(options);stores.push(reopened);
    assert.equal(await reopened.session(value.tokenHash),null);
    const expected=Date.parse(created)+86400_000;
    assert.equal(Number((await control.query('SELECT expires_at FROM drug_tracker.sessions WHERE token_hash=$1',[value.tokenHash])).rows[0].expires_at),expected);
    const again=await openCloudPostgres(options);stores.push(again);
    assert.equal((await control.query('SELECT expires_at FROM drug_tracker.sessions WHERE token_hash=$1',[value.tokenHash])).rowCount,0);
    assert.equal(await again.session(value.tokenHash),null);
    assert.equal((await again.accountByUsername(old.username)).id,old.id);
  });
  await t.test('global quota migration preserves accounts, sessions and vaults while new digests isolate shared budgets', async () => {
    const before = await control.query('SELECT id,username,password_hash FROM drug_tracker.accounts ORDER BY id');
    const vaults = await control.query('SELECT * FROM drug_tracker.vaults ORDER BY owner_id');
    const sessions = await control.query('SELECT * FROM drug_tracker.sessions ORDER BY token_hash');
    await control.query(`DROP TABLE drug_tracker.auth_challenges; DROP TABLE drug_tracker.auth_secrets;
      ALTER TABLE drug_tracker.accounts DROP COLUMN auth_mode, DROP COLUMN auth_version, DROP COLUMN opaque_record, DROP COLUMN recovery_auth_hash;
      DROP TABLE drug_tracker.rate_limits;
      CREATE TABLE drug_tracker.rate_limits (kind TEXT PRIMARY KEY CHECK(kind IN ('login','register')),count BIGINT NOT NULL,until_ms BIGINT NOT NULL);
      INSERT INTO drug_tracker.rate_limits VALUES ('login',30,9999999999999);
      UPDATE drug_tracker.meta SET version=1;`);
    const updated = await Promise.all([openCloudPostgres(options),openCloudPostgres(options)]); stores.push(...updated);
    assert.deepEqual((await control.query('SELECT id,username,password_hash FROM drug_tracker.accounts ORDER BY id')).rows,before.rows);
    assert.deepEqual((await control.query('SELECT * FROM drug_tracker.vaults ORDER BY owner_id')).rows,vaults.rows);
    assert.deepEqual((await control.query('SELECT * FROM drug_tracker.sessions ORDER BY token_hash')).rows,sessions.rows);
    const identity = hash('synthetic rate-only subject');
    await updated[0].consumeRateLimit('login',identity,1,60_000);
    await assert.rejects(updated[1].consumeRateLimit('login',identity,1,60_000), error => error.status === 429);
    await updated[1].consumeRateLimit('login',hash('different subject'),1,60_000);
    const rows = (await control.query('SELECT * FROM drug_tracker.rate_limits')).rows;
    assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.subject_hash)));
    assert.equal(JSON.stringify(rows).includes('synthetic rate-only subject'),false);
  });

});
