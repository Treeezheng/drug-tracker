import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrapCloudAccount, createCloudServer, CloudError } from '../server/cloud.mjs';
import { openVaultStore } from '../server/vault-store.mjs';
import { createVaultKey, encryptVault, decryptVault, wrapVaultKey, unwrapVaultKey } from '../src/lib/vault-crypto.ts';

const ORIGIN = 'https://treeezh.com';
const USERNAME = 'synthetic-admin';
const PASSWORD = 'SYNTHETIC ACCOUNT PASSWORD 8352';
const VAULT_PASSPHRASE = 'SYNTHETIC INDEPENDENT VAULT PASSPHRASE 8352';
const NOTE = 'SYNTHETIC PRIVATE HEALTH NOTE 8352';
const credentials = { username: USERNAME, password: PASSWORD };
const cloudHtml = '<!doctype html><html><head><meta name="drug-edition" content="cloud"></head><body>Cloud fixture</body></html>';
const fail = status => error => error instanceof CloudError && error.status === status;
const b64 = n => Buffer.alloc(n, 63).toString('base64url');
function opaque(ownerId, expectedRevision = 0) {
  const common = { protocol: 'dose-timeline-vault', version: 1, ownerId, cipher: 'AES-256-GCM', iv: b64(12) };
  return {
    expectedRevision,
    dataEnvelope: { ...common, kind: 'data', ciphertext: b64(17) },
    keyEnvelope: { ...common, kind: 'wrapped-key', ciphertext: b64(48), kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt: b64(16) } },
  };
}
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'drug-cloud-api-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function fixture(t, options = {}) {
  const { prepareDatabase, skipBootstrap, ...serverOptions } = options;
  const dir = await mkdtemp(join(tmpdir(), 'drug-cloud-api-')), dbPath = join(dir, 'cloud-only.sqlite');
  const setup = prepareDatabase ? await prepareDatabase(dbPath) : skipBootstrap ? { user: null } : await bootstrapCloudAccount({ dbPath, ...credentials });
  if (setup.user) setup.user = { ...setup.user, username: credentials.username, authMode: 'legacy-scrypt' };
  let instance;
  const origin = serverOptions.origin ?? ORIGIN;
  const start = async () => {
    instance = await createCloudServer({ dbPath, origin, allowLegacyRegistration: true, ...serverOptions });
    await new Promise((accept, reject) => { instance.server.once('error', reject); instance.server.listen(0, '127.0.0.1', accept); });
  };
  const stop = async () => {
    if (instance) { await new Promise(accept => { instance.server.close(accept); instance.server.closeIdleConnections(); }); instance = null; }
  };
  await start();
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  const request = async (path, { method = 'GET', body, rawBody, cookie, owner, headers = {}, noOrigin = false } = {}) => {
    // Node fetch discards a custom Host; node:http models a same-machine TLS proxy faithfully.
    const encoded = body !== undefined || rawBody !== undefined ? rawBody ?? JSON.stringify(body) : undefined;
    return new Promise((accept, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: instance.server.address().port, path: path === '/' || path.startsWith('/?') || path.startsWith('/drug') || path.startsWith('/api') ? path : `/drug/api${path}`,
        method, headers: {
        Host: new URL(origin).host,
        ...(!['GET', 'HEAD'].includes(method) && !noOrigin ? { Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...(owner ? { 'X-Dose-Owner': owner } : {}),
        ...(encoded !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}), ...headers,
      } }, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.once('end', () => {
          let data; try { data = JSON.parse(text); } catch { data = text; }
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) responseHeaders.append(key, item);
          }
          accept({ status: response.statusCode, headers: responseHeaders, data, cookie: responseHeaders.get('set-cookie')?.split(';')[0] });
        });
        response.once('error', reject);
      });
      req.once('error', error => { error.message += ` (${method} ${path})`; reject(error); });
      req.end(encoded);
    });
  };
  return { dir, dbPath, user: setup.user, request, start, stop, get server() { return instance.server; } };
}
const login = f => f.request('/auth/login', { method: 'POST', body: credentials });

test('cloud root GET and HEAD redirect only after exact host, origin and Heroku HTTPS checks', async t => {
  const f = await fixture(t, { proxyMode: 'heroku', skipBootstrap: true });
  const secureHeaders = { 'X-Forwarded-Proto': 'https' };
  for (const method of ['GET', 'HEAD']) {
    for (const path of ['/', '/?next=https://evil.test']) {
      const response = await f.request(path, { method, headers: secureHeaders });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/drug/');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.data, '');
    }
    for (const headers of [
      { ...secureHeaders, Host: 'evil.test', 'X-Forwarded-Host': new URL(ORIGIN).host },
      { ...secureHeaders, Origin: 'https://evil.test' },
      { 'X-Forwarded-Proto': 'http' }, {},
    ]) {
      const response = await f.request('/', { method, headers });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('location'), null);
    }
  }
  assert.equal((await f.request('/', { method: 'POST', headers: secureHeaders, body: {} })).status, 404);
});

test('cloud configuration and bootstrap require an explicit separate database and create exactly one durable account', async t => {
  const dir = await directory(t), dbPath = join(dir, 'new-cloud.sqlite');
  for (const options of [
    {}, { dbPath }, { dbPath: 'relative.sqlite', origin: ORIGIN },
    { dbPath, origin: 'http://treeezh.com', allowInsecureLoopback: true },
    { dbPath, origin: 'http://127.0.0.1:4312' }, { dbPath, origin: `${ORIGIN}/drug` },
    { dbPath, origin: `${ORIGIN}/` }, { dbPath, origin: 'https://user:secret@treeezh.com' },
  ]) await assert.rejects(createCloudServer(options), fail(400));
  const emptyServer = await createCloudServer({ dbPath, origin: ORIGIN });
  emptyServer.closeStorage();
  const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => bootstrapCloudAccount({ dbPath, ...credentials })));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(attempts.filter(result => result.status === 'rejected').every(result => fail(409)(result.reason)));
  await assert.rejects(bootstrapCloudAccount({ dbPath, username: 'another-admin', password: 'another-synthetic-password' }), fail(409));
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cloud_accounts').get().n, 1);
  assert.match(db.prepare('SELECT password_hash FROM cloud_accounts').get().password_hash, /^scrypt\$32768\$8\$1\$/);
  db.close();
  assert.ok(!(await readFile(dbPath)).includes(Buffer.from(PASSWORD)));
});

test('a local-edition database is rejected without reading or changing its records', async t => {
  const dir = await directory(t), dbPath = join(dir, 'local-fixture.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(id TEXT, private_value TEXT)');
  db.prepare('INSERT INTO users VALUES (?,?)').run('synthetic-local-user', NOTE);
  db.close();
  const before = await readFile(dbPath);
  await assert.rejects(bootstrapCloudAccount({ dbPath, ...credentials }), fail(400));
  await assert.rejects(createCloudServer({ dbPath, origin: ORIGIN }), fail(400));
  assert.deepEqual(await readFile(dbPath), before);
});

test('production authentication has scoped Secure cookies, private responses and no public recovery or plaintext routes', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/edition')).data, { edition: 'cloud' });
  assert.deepEqual((await f.request('/session')).data, { user: null });
  assert.equal((await f.request('/vault', { owner: f.user.id })).status, 401);
  const wrongPassword = await f.request('/auth/login', { method: 'POST', body: { ...credentials, password: 'synthetic-wrong-password' } });
  const wrongName = await f.request('/auth/login', { method: 'POST', body: { ...credentials, username: 'wrong-synthetic-name' } });
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(wrongPassword.data, wrongName.data);
  const signed = await login(f);
  assert.equal(signed.status, 200);
  assert.deepEqual(signed.data, { user: f.user });
  const cookie = signed.headers.get('set-cookie');
  for (const part of ['__Secure-drug_cloud_session=', 'HttpOnly', 'SameSite=Strict', 'Path=/drug/', 'Secure']) assert.ok(cookie.includes(part));
  assert.equal(signed.headers.get('cache-control'), 'no-store');
  assert.equal(signed.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(signed.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(signed.headers.get('access-control-allow-origin'), null);
  assert.ok(signed.headers.get('content-security-policy').includes("connect-src 'self'"));
  assert.ok(signed.headers.get('strict-transport-security'));
  assert.deepEqual((await f.request('/session', { cookie: signed.cookie })).data, { user: f.user });
  for (const [path, method] of [
    ['/auth/recover', 'POST'], ['/auth/local-setup', 'POST'], ['/auth/local-state', 'GET'],
    ['/data', 'GET'], ['/export', 'GET'], ['/import', 'POST'], ['/profile', 'PUT'], ['/doses/record', 'PUT'],
    ['/checkins/record', 'PUT'], ['/inventory/record', 'PUT'], ['/api/session', 'GET'],
  ]) assert.equal((await f.request(path, { method, cookie: signed.cookie, owner: f.user.id, ...(['GET', 'HEAD'].includes(method) ? {} : { body: { note: NOTE } }) })).status, 404, path);
  const db = new DatabaseSync(f.dbPath);
  const session = db.prepare('SELECT * FROM cloud_sessions').get();
  assert.notEqual(session.token_hash, signed.cookie.split('=')[1]);
  assert.match(session.token_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','entities','revisions')").all(), []);
  db.close();
});

test('exact host/origin and owner checks reject CSRF, forwarded-host tricks and account selection mismatches', async t => {
  const f = await fixture(t);
  for (const config of [
    { noOrigin: true }, { headers: { Origin: 'https://evil.test' } }, { headers: { Origin: 'null' } },
    { headers: { Origin: 'https://treeezh.com.evil.test' } }, { headers: { Host: 'evil.test', 'X-Forwarded-Host': 'treeezh.com' } },
    { headers: { Host: '127.0.0.1:4312', 'X-Forwarded-Proto': 'https' } }, { headers: { 'Sec-Fetch-Site': 'cross-site' } },
  ]) assert.equal((await f.request('/auth/login', { method: 'POST', body: credentials, ...config })).status, 403);
  const signed = await login(f);
  for (const selectedOwner of [undefined, 'synthetic-foreign-owner']) {
    assert.equal((await f.request('/vault', { cookie: signed.cookie, owner: selectedOwner })).status, 401);
    assert.equal((await f.request('/vault', { method: 'PUT', cookie: signed.cookie, owner: selectedOwner, body: opaque(f.user.id) })).status, 401);
  }
  assert.equal((await f.request('/vault', { method: 'PUT', cookie: signed.cookie, owner: f.user.id, body: opaque('synthetic-foreign-owner') })).status, 403);
  assert.equal((await f.request('/vault', { method: 'PUT', cookie: signed.cookie, owner: f.user.id, body: opaque(f.user.id), headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.deepEqual((await f.request('/vault', { cookie: signed.cookie, owner: f.user.id })).data, { vault: null });
  const other = await fixture(t);
  assert.deepEqual((await other.request('/session', { cookie: signed.cookie })).data, { user: null });
  assert.equal((await other.request('/vault', { cookie: signed.cookie, owner: f.user.id })).status, 401);
});

test('real encrypted vaults and sessions survive restart and remain decryptable only with the client secret', async t => {
  const f = await fixture(t), signed = await login(f), key = await createVaultKey();
  const data = { profile: null, doses: [{ id: 'synthetic-dose', quantity: '1.5', amountMg: '15', note: NOTE }], scenarios: [], favorites: [], checkins: [], inventory: [] };
  const [dataEnvelope, keyEnvelope] = await Promise.all([encryptVault(data, key, f.user.id), wrapVaultKey(key, VAULT_PASSPHRASE, f.user.id)]);
  const put = await f.request('/vault', { method: 'PUT', cookie: signed.cookie, owner: f.user.id, body: { expectedRevision: 0, dataEnvelope, keyEnvelope } });
  assert.equal(put.status, 200);
  assert.equal(put.data.vault.revision, 1);
  await f.stop();
  assert.ok(!(await readFile(f.dbPath)).includes(Buffer.from(NOTE)));
  assert.ok(!(await readFile(f.dbPath)).includes(Buffer.from(VAULT_PASSPHRASE)));
  await f.start();
  const result = await f.request('/vault', { cookie: signed.cookie, owner: f.user.id });
  assert.deepEqual(result.data, put.data);
  const unwrapped = await unwrapVaultKey(result.data.vault.keyEnvelope, VAULT_PASSPHRASE, f.user.id);
  assert.deepEqual(await decryptVault(result.data.vault.dataEnvelope, unwrapped, f.user.id), data);
  assert.ok(!JSON.stringify(result.data).includes(NOTE));
  const invalid = await f.request('/vault', { method: 'PUT', cookie: signed.cookie, owner: f.user.id, body: { expectedRevision: 1, dataEnvelope, keyEnvelope: { ...keyEnvelope, plaintext: NOTE } } });
  assert.equal(invalid.status, 400);
  assert.deepEqual((await f.request('/vault', { cookie: signed.cookie, owner: f.user.id })).data, put.data);
});

test('concurrent cloud saves have one CAS winner and never mix envelopes from different updates', async t => {
  const f = await fixture(t), signed = await login(f);
  const options = { method: 'PUT', cookie: signed.cookie, owner: f.user.id };
  assert.equal((await f.request('/vault', { ...options, body: opaque(f.user.id) })).status, 200);
  const candidates = [31, 47].map(marker => {
    const input = opaque(f.user.id, 1);
    input.dataEnvelope.ciphertext = Buffer.alloc(30, marker).toString('base64url');
    input.keyEnvelope.iv = Buffer.alloc(12, marker).toString('base64url');
    return input;
  });
  const results = await Promise.all(candidates.map(body => f.request('/vault', { ...options, body })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(results.find(result => result.status === 409).data.currentRevision, 2);
  const index = results.findIndex(result => result.status === 200);
  const current = (await f.request('/vault', { cookie: signed.cookie, owner: f.user.id })).data.vault;
  assert.equal(current.revision, 2);
  assert.deepEqual(current.dataEnvelope, candidates[index].dataEnvelope);
  assert.deepEqual(current.keyEnvelope, candidates[index].keyEnvelope);
});

test('logout revokes one session, a queued request rechecks ownership, and expired or ambiguous cookies cannot read', async t => {
  const f = await fixture(t), first = await login(f), second = await login(f);
  assert.equal((await f.request('/auth/logout', { method: 'POST', cookie: first.cookie, owner: 'wrong-owner', body: {} })).status, 401);
  assert.deepEqual((await f.request('/session', { cookie: first.cookie })).data, { user: f.user });
  const wireBody = JSON.stringify(opaque(f.user.id));
  const entered = new Promise(resolve => {
    const listener = req => { if (req.method === 'PUT') { f.server.off('request', listener); resolve(); } };
    f.server.on('request', listener);
  });
  let upload;
  const completed = new Promise((resolve, reject) => {
    upload = httpRequest({ hostname: '127.0.0.1', port: f.server.address().port, path: '/drug/api/vault', method: 'PUT', headers: {
      Host: 'treeezh.com', Origin: ORIGIN, Cookie: first.cookie, 'X-Dose-Owner': f.user.id, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(wireBody),
    } }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    upload.once('error', reject); upload.write(wireBody.slice(0, 8));
  });
  await entered;
  const signOut = await f.request('/auth/logout', { method: 'POST', cookie: first.cookie, owner: f.user.id, body: {} });
  assert.equal(signOut.status, 200);
  assert.ok(signOut.headers.get('set-cookie').includes('Max-Age=0'));
  upload.end(wireBody.slice(8));
  assert.equal((await completed).status, 401);
  assert.deepEqual((await f.request('/session', { cookie: first.cookie })).data, { user: null });
  assert.deepEqual((await f.request('/vault', { cookie: second.cookie, owner: f.user.id })).data, { vault: null });
  assert.deepEqual((await f.request('/session', { cookie: `${second.cookie}; ${second.cookie}` })).data, { user: null });
  const db = new DatabaseSync(f.dbPath); db.prepare('UPDATE cloud_sessions SET expires_at=0').run(); db.close();
  assert.equal((await f.request('/vault', { cookie: second.cookie, owner: f.user.id })).status, 401);
});

test('login rate limiting ignores spoofed forwarded addresses and malformed or oversized JSON is rejected', async t => {
  const f = await fixture(t, { loginAttemptLimit: 2 });
  for (let index = 0; index < 2; index++) assert.equal((await f.request('/auth/login', { method: 'POST', body: { ...credentials, password: 'synthetic-invalid' }, headers: { 'X-Forwarded-For': `192.0.2.${index}` } })).status, 401);
  const denied = await f.request('/auth/login', { method: 'POST', body: credentials, headers: { 'X-Forwarded-For': '198.51.100.88' } });
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get('retry-after')) >= 1);
  const other = await fixture(t), signed = await login(other);
  assert.equal((await other.request('/vault', { method: 'PUT', cookie: signed.cookie, owner: other.user.id, rawBody: '{"unterminated":' })).status, 400);
  assert.equal((await other.request('/auth/login', { method: 'POST', body: credentials, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await other.request('/auth/login', { method: 'POST', rawBody: JSON.stringify({ username: USERNAME, password: 'x'.repeat(5000) }) })).status, 413);
  assert.deepEqual((await other.request('/vault', { cookie: signed.cookie, owner: other.user.id })).data, { vault: null });
  // A chunked oversized request must receive a bounded error response rather than a reset socket.
  const streamed = await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: other.server.address().port, path: '/drug/api/auth/login', method: 'POST', headers: { Host: 'treeezh.com', Origin: ORIGIN, 'Content-Type': 'application/json' } }, res => {
      res.resume(); res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject); req.write('x'.repeat(3000)); req.end('x'.repeat(3000));
  });
  assert.equal(streamed, 413);
});

test('only an explicit cloud build is served under /drug with no traversal or local build fallback', async t => {
  const dir = await directory(t), distDir = join(dir, 'dist'), dbPath = join(dir, 'cloud.sqlite');
  await mkdir(join(distDir, 'assets'), { recursive: true });
  await bootstrapCloudAccount({ dbPath, ...credentials });
  for (const markup of [
    '<!doctype html><html>Local build</html>',
    '<meta name="drug-edition" content="local">',
    '<!-- <meta name="drug-edition" content="cloud"> -->',
    '<meta name="drug-edition" content="local"><meta name="drug-edition" content="cloud">',
  ]) {
    await writeFile(join(distDir, 'index.html'), markup);
    await assert.rejects(createCloudServer({ dbPath, origin: ORIGIN, distDir }), fail(400));
  }
  await writeFile(join(distDir, 'index.html'), cloudHtml);
  await writeFile(join(distDir, 'privacy.html'), '<!doctype html><title>Privacy fixture</title><p>Static disclosure</p>');
  await writeFile(join(distDir, 'terms.html'), '<!doctype html><title>Terms fixture</title><p>Static terms</p>');
  await writeFile(join(distDir, 'local.html'), '<!doctype html><title>Other HTML must not be served</title>');
  await writeFile(join(distDir, 'assets', 'app.js'), '/* synthetic asset */');
  await writeFile(join(dir, 'private.txt'), NOTE);
  await symlink(join(dir, 'private.txt'), join(distDir, 'private.txt'));
  const f = await fixture(t, { distDir });
  assert.equal((await f.request('/drug')).status, 308);
  assert.equal((await f.request('/drug/')).data, cloudHtml);
  assert.equal((await f.request('/drug/history')).data, cloudHtml);
  assert.equal((await f.request('/drug/assets/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  const disclosure = await f.request('/drug/privacy.html');
  assert.equal(disclosure.status, 200);
  assert.ok(disclosure.data.includes('Static disclosure'));
  assert.ok(disclosure.headers.get('content-security-policy').includes("script-src 'none'"));
  const terms = await f.request('/drug/terms.html');
  assert.equal(terms.status, 200);
  assert.ok(terms.data.includes('Static terms'));
  assert.ok(terms.headers.get('content-security-policy').includes("script-src 'none'"));
  for (const path of ['/drug/assets/missing.js', '/drug/private.txt', '/drug/local.html', '/drug/%2e%2e/private.txt', '/drug/api/no-such-route']) assert.equal((await f.request(path)).status, 404);
  await writeFile(join(distDir, 'index.html'), '<meta name="drug-edition" content="local">');
  await writeFile(join(distDir, 'privacy.html'), '<p>A replaced document must not replace the verified startup snapshot.</p>');
  await writeFile(join(distDir, 'terms.html'), '<p>Changed terms after server startup.</p>');
  assert.equal((await f.request('/drug/')).data, cloudHtml, 'The server must keep serving its edition-checked HTML snapshot.');
  assert.equal((await f.request('/drug/privacy.html')).data, disclosure.data);
  assert.equal((await f.request('/drug/terms.html')).data, terms.data);
});

test('HTTP cookies are available only for explicitly enabled exact loopback development origins', async t => {
  const f = await fixture(t, { origin: 'http://127.0.0.1:4312', allowInsecureLoopback: true });
  const signed = await login(f);
  assert.equal(signed.status, 200);
  const value = signed.headers.get('set-cookie');
  assert.ok(value.startsWith('drug_cloud_dev_session='));
  assert.ok(!value.includes('; Secure'));
  assert.equal(signed.headers.get('strict-transport-security'), null);
  assert.deepEqual((await f.request('/session', { cookie: signed.cookie })).data, { user: f.user });
});

test('public registration creates durable separate accounts and sessions without creating or disclosing a vault', async t => {
  const f = await fixture(t, { skipBootstrap: true });
  assert.deepEqual((await f.request('/session')).data, { user: null });
  const first = await f.request('/auth/register', { method: 'POST', body: { username: 'First_User', password: PASSWORD, name: 'Synthetic first' } });
  assert.equal(first.status, 201);
  const a = first.data.user;
  assert.deepEqual(Object.keys(a).sort(), ['authMode', 'id', 'name', 'username']);
  assert.equal(a.authMode, 'legacy-scrypt');
  assert.equal(a.username, 'first_user');
  assert.equal(a.name, 'Synthetic first');
  for (const part of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/drug/']) assert.ok(first.headers.get('set-cookie').includes(part));
  assert.deepEqual((await f.request('/vault', { cookie: first.cookie, owner: a.id })).data, { vault: null });
  const savedA = await f.request('/vault', { method: 'PUT', cookie: first.cookie, owner: a.id, body: opaque(a.id) });
  assert.equal(savedA.status, 200);
  const secondPassword = 'SYNTHETIC SECOND ACCOUNT PASSWORD 9463';
  const second = await f.request('/auth/register', { method: 'POST', cookie: first.cookie, body: { username: 'second_user', password: secondPassword } });
  assert.equal(second.status, 201);
  const b = second.data.user;
  assert.notEqual(b.id, a.id);
  assert.equal(b.name, 'second_user');
  assert.deepEqual((await f.request('/vault', { cookie: second.cookie, owner: b.id })).data, { vault: null });
  for (const method of ['GET', 'PUT']) assert.equal((await f.request('/vault', {
    method, cookie: second.cookie, owner: a.id, ...(method === 'PUT' ? { body: opaque(a.id, 1) } : {}),
  })).status, 401);
  const staleSignOut = await f.request('/auth/logout', { method: 'POST', cookie: second.cookie, owner: a.id, body: {} });
  assert.equal(staleSignOut.status, 401);
  assert.equal(staleSignOut.headers.get('set-cookie'), null);
  assert.deepEqual((await f.request('/session', { cookie: second.cookie })).data, { user: b });
  assert.equal((await f.request('/vault', { method: 'PUT', cookie: second.cookie, owner: b.id, body: opaque(a.id) })).status, 403);
  const savedB = await f.request('/vault', { method: 'PUT', cookie: second.cookie, owner: b.id, body: opaque(b.id) });
  assert.equal(savedB.status, 200);
  assert.deepEqual((await f.request('/vault', { cookie: first.cookie, owner: a.id })).data, savedA.data);
  await f.stop(); await f.start();
  assert.deepEqual((await f.request('/session', { cookie: first.cookie })).data, { user: a });
  assert.deepEqual((await f.request('/session', { cookie: second.cookie })).data, { user: b });
  assert.deepEqual((await f.request('/vault', { cookie: second.cookie, owner: b.id })).data, savedB.data);
  const relogin = await f.request('/auth/login', { method: 'POST', body: { username: ' FIRST_USER ', password: PASSWORD } });
  assert.deepEqual(relogin.data, { user: a });
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { username: 'first_user', password: secondPassword } })).status, 401);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { username: 'second_user', password: PASSWORD } })).status, 401);
  const db = new DatabaseSync(f.dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cloud_accounts').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM encrypted_vaults').get().n, 2);
  for (const row of db.prepare('SELECT password_hash FROM cloud_accounts').all()) assert.match(row.password_hash, /^scrypt\$32768\$8\$1\$/);
  db.close();
  assert.ok(!(await readFile(f.dbPath)).includes(Buffer.from(PASSWORD)));
  assert.ok(!(await readFile(f.dbPath)).includes(Buffer.from(secondPassword)));
});

test('normalized username collisions have one registration winner without replacing an existing owner', async t => {
  const f = await fixture(t), signed = await login(f);
  const before = await f.request('/vault', { method: 'PUT', cookie: signed.cookie, owner: f.user.id, body: opaque(f.user.id) });
  assert.equal((await f.request('/auth/register', { method: 'POST', body: { username: USERNAME.toUpperCase(), password: 'Another account password 7623' } })).status, 409);
  const attempts = await Promise.all(['Concurrent_User', ' concurrent_user '].map(username => f.request('/auth/register', { method: 'POST', body: { username, password: PASSWORD } })));
  assert.deepEqual(attempts.map(result => result.status).sort(), [201, 409]);
  assert.equal(attempts.find(result => result.status === 409).data.error, 'Username is unavailable.');
  assert.deepEqual((await f.request('/vault', { cookie: signed.cookie, owner: f.user.id })).data, before.data);
  assert.deepEqual((await login(f)).data, { user: f.user });
  const db = new DatabaseSync(f.dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cloud_accounts WHERE username=?').get('concurrent_user').n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cloud_accounts').get().n, 2);
  db.close();
});

test('registration rejects CSRF, extra vault secrets, invalid input and oversized requests; its rate budget cannot lock out login', async t => {
  const f = await fixture(t, { registrationAttemptLimit: 12 });
  const register = { username: 'new_synthetic_user', password: PASSWORD };
  for (const extra of [{ noOrigin: true }, { headers: { Origin: 'https://evil.test' } }, { headers: { Host: 'evil.test', 'X-Forwarded-Host': 'treeezh.com' } }]) {
    assert.equal((await f.request('/auth/register', { method: 'POST', body: register, ...extra })).status, 403);
  }
  for (const change of [
    { password: 'short' }, { username: 'x' }, { username: 'synthetic@example.test' }, { name: '' },
    { vaultPassphrase: VAULT_PASSPHRASE }, { recoveryKey: b64(32) }, { data: { note: NOTE } },
  ]) assert.equal((await f.request('/auth/register', { method: 'POST', body: { ...register, ...change } })).status, 400);
  assert.equal((await f.request('/auth/register', { method: 'POST', rawBody: 'x'.repeat(4097) })).status, 413);
  assert.equal((await f.request('/auth/register', { method: 'POST', body: register, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const db = new DatabaseSync(f.dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cloud_accounts').get().n, 1);
  db.close();
  const limited = await fixture(t, { registrationAttemptLimit: 1 });
  assert.equal((await limited.request('/auth/register', { method: 'POST', body: register, headers: { 'X-Forwarded-For': '192.0.2.1' } })).status, 201);
  const blocked = await limited.request('/auth/register', { method: 'POST', body: { ...register, username: 'another_new_user' }, headers: { 'X-Forwarded-For': '192.0.2.2' } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal((await login(limited)).status, 200);
});

async function legacyDatabase(dbPath, orphan = false) {
  const setup = await bootstrapCloudAccount({ dbPath, ...credentials });
  const db = new DatabaseSync(dbPath);
  const account = db.prepare('SELECT * FROM cloud_accounts').get();
  if (orphan) db.exec('PRAGMA foreign_keys=OFF');
  const token = randomBytes(32).toString('base64url');
  const session = { token_hash: createHash('sha256').update(token).digest('hex'), owner_id: orphan ? 'missing-owner' : account.id, expires_at: Date.now() + 86400_000, created_at: new Date().toISOString() };
  db.exec(`DROP TABLE cloud_auth_challenges; DROP TABLE cloud_auth_secrets; DROP TABLE cloud_sessions; DROP TABLE cloud_accounts;
    CREATE TABLE cloud_accounts (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
    CREATE TABLE cloud_sessions (token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL) STRICT;
    UPDATE cloud_meta SET version=1 WHERE singleton=1;`);
  db.prepare('INSERT INTO cloud_accounts VALUES (1,?,?,?,?,?)').run(account.id, account.username, account.password_hash, account.name, account.created_at);
  db.prepare('INSERT INTO cloud_sessions VALUES (?,?,?,?)').run(session.token_hash, session.owner_id, session.expires_at, session.created_at);
  db.close();
  const store = openVaultStore({ dbPath });
  const vault = store.write(account.id, opaque(account.id));
  store.close();
  return { ...setup, account, session, vault, cookie: `__Secure-drug_cloud_session=${token}` };
}

test('concurrent v1-to-v2 migrations preserve the original owner, hash, session and encrypted vault before permitting new accounts', async t => {
  let original;
  const f = await fixture(t, { prepareDatabase: async dbPath => {
    original = await legacyDatabase(dbPath);
    const moduleUrl = new URL('../server/cloud.mjs', import.meta.url).href;
    const workers = Array.from({ length: 3 }, () => new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      import(workerData.moduleUrl).then(async ({ createCloudServer }) => {
        const instance = await createCloudServer({ dbPath: workerData.dbPath, origin: workerData.origin });
        instance.closeStorage(); parentPort.postMessage({ ok: true });
      }).catch(error => parentPort.postMessage({ error: error.message }));
    `, { eval: true, workerData: { moduleUrl, dbPath, origin: ORIGIN } }));
    t.after(() => Promise.all(workers.map(worker => worker.terminate())));
    await Promise.all(workers.map(worker => new Promise((accept, reject) => {
      worker.once('error', reject); worker.once('message', message => message.ok ? accept() : reject(new Error(message.error)));
    })));
    return original;
  } });
  assert.deepEqual((await f.request('/session', { cookie: original.cookie })).data, { user: original.user });
  assert.deepEqual((await f.request('/vault', { cookie: original.cookie, owner: original.user.id })).data, { vault: original.vault });
  assert.deepEqual((await login(f)).data, { user: original.user });
  const registered = await f.request('/auth/register', { method: 'POST', body: { username: 'new_after_migration', password: PASSWORD } });
  assert.equal(registered.status, 201);
  assert.notEqual(registered.data.user.id, original.user.id);
  const db = new DatabaseSync(f.dbPath);
  assert.equal(db.prepare('SELECT version FROM cloud_meta').get().version, 3);
  assert.deepEqual(db.prepare('SELECT * FROM cloud_accounts WHERE id=?').get(original.user.id), original.account);
  assert.deepEqual(db.prepare('SELECT * FROM cloud_sessions WHERE token_hash=?').get(original.session.token_hash), Object.assign(Object.create(null), original.session));
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_v2'").all(), []);
  db.close();
  await f.stop(); await f.start();
  assert.deepEqual((await f.request('/vault', { cookie: original.cookie, owner: original.user.id })).data, { vault: original.vault });
});

test('a failed legacy migration rolls back all table and version changes instead of dropping an existing account or session', async t => {
  const dir = await directory(t), dbPath = join(dir, 'invalid-legacy.sqlite');
  const original = await legacyDatabase(dbPath, true);
  await assert.rejects(createCloudServer({ dbPath, origin: ORIGIN }));
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare('SELECT version FROM cloud_meta').get().version, 1);
  assert.equal(db.prepare('SELECT singleton FROM cloud_accounts').get().singleton, 1);
  assert.equal(db.prepare('SELECT password_hash FROM cloud_accounts').get().password_hash, original.account.password_hash);
  assert.equal(db.prepare('SELECT owner_id FROM cloud_sessions').get().owner_id, 'missing-owner');
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_v2'").all(), []);
  assert.equal(db.prepare('SELECT revision FROM encrypted_vaults WHERE owner_id=?').get(original.user.id).revision, original.vault.revision);
  db.close();
});

async function pausedVaultWrite(f, signed, input) {
  const data = JSON.stringify(input);
  let incoming;
  f.server.once('request', req => { incoming = req; });
  let request;
  const completed = new Promise((resolve, reject) => {
    request = httpRequest({ hostname: '127.0.0.1', port: f.server.address().port, path: '/drug/api/vault', method: 'PUT', headers: {
      Host: 'treeezh.com', Origin: ORIGIN, Cookie: signed.cookie, 'X-Dose-Owner': signed.owner,
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
    } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
    request.once('error', reject); request.write(data.slice(0, 1));
  });
  for (let i=0; i<100 && !incoming?.listenerCount('data'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(incoming?.listenerCount('data'), 'the body parser has admitted the paused upload');
  return { finish: () => request.end(data.slice(1)), abort: () => request.destroy(), completed };
}

test('malformed auth does not spend valid-account quotas, and exhausting A never locks B', async t => {
  const f = await fixture(t, { loginAttemptLimit: 2 });
  const other = await f.request('/auth/register', { method: 'POST', body: { username: 'synthetic_second', password: PASSWORD } });
  assert.equal(other.status, 201);
  for (let i=0; i<35; i++) assert.equal((await f.request('/auth/login', { method: 'POST', rawBody: '{' })).status, 400);
  for (let i=0; i<2; i++) assert.equal((await f.request('/auth/login', { method: 'POST', body: { ...credentials, password: 'synthetic wrong' } })).status, 401);
  assert.equal((await login(f)).status, 429);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { username: 'SYNTHETIC_SECOND', password: PASSWORD } })).status, 200);
});

test('Heroku registration quotas use only the router-appended final valid IP; missing or invalid sources fail closed', async t => {
  const f = await fixture(t, { proxyMode: 'heroku', registrationAttemptLimit: 1 });
  const register = username => ({ username, password: PASSWORD });
  const headers = address => ({ 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': address });
  assert.equal((await f.request('/auth/register', { method: 'POST', body: register('first_ip'), headers: headers('198.51.100.1, 192.0.2.1') })).status, 201);
  assert.equal((await f.request('/auth/register', { method: 'POST', body: register('spoofed_ip'), headers: headers('198.51.100.2, 192.0.2.1') })).status, 429);
  assert.equal((await f.request('/auth/register', { method: 'POST', body: register('second_ip'), headers: headers('198.51.100.1, 192.0.2.2') })).status, 201);
  for (const hdr of [{ 'X-Forwarded-Proto': 'https' }, headers('192.0.2.9, invalid'), headers('192.0.2.9,')]) {
    assert.equal((await f.request('/auth/register', { method: 'POST', body: register('bad_source'), headers: hdr })).status, 400);
  }
  assert.equal((await f.request('/auth/register', { method: 'POST', body: register('ipv6_first'), headers: headers('2001:0db8:0:0:0:0:0:1') })).status, 201);
  assert.equal((await f.request('/auth/register', { method: 'POST', body: register('ipv6_spelling'), headers: headers('2001:db8::1') })).status, 429);
});

test('vault admission budget rejects parallel uploads then releases after bad JSON and connection abort', async t => {
  const f = await fixture(t), logged = await login(f), signed = { cookie: logged.cookie, owner: f.user.id };
  const paused = await pausedVaultWrite(f, signed, opaque(f.user.id));
  const busy = await f.request('/vault', { ...signed, method: 'PUT', body: opaque(f.user.id) });
  assert.equal(busy.status, 429); assert.equal(busy.headers.get('retry-after'), '1');
  paused.finish(); assert.equal(await paused.completed, 200);
  assert.equal((await f.request('/vault', signed)).status, 200);
  assert.equal((await f.request('/vault', { ...signed, method: 'PUT', rawBody: '{' })).status, 400);
  assert.equal((await f.request('/vault', signed)).status, 200);
  const aborted = await pausedVaultWrite(f, signed, opaque(f.user.id, 1));
  const stopped = aborted.completed.catch(error => error.code);
  aborted.abort(); await stopped;
  let restored;
  for (let i=0; i<100; i++) { restored = await f.request('/vault', signed); if (restored.status !== 429) break; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.equal(restored.status, 200); assert.equal(restored.data.vault.revision, 1);
});

test('cloud deletion needs fresh password and owner, rolls back on storage failure, and revokes all sessions without touching another account', async t => {
  const f = await fixture(t), first = await login(f), second = await login(f), signed = { cookie: first.cookie, owner: f.user.id };
  const other = await f.request('/auth/register', { method: 'POST', body: { username: 'retained_synthetic', password: PASSWORD } });
  const foreign = { cookie: other.cookie, owner: other.data.user.id };
  assert.equal((await f.request('/vault', { ...signed, method: 'PUT', body: opaque(signed.owner) })).status, 200);
  assert.equal((await f.request('/vault', { ...foreign, method: 'PUT', body: opaque(foreign.owner) })).status, 200);
  const deletion = { ...signed, method: 'DELETE', body: { password: PASSWORD } };
  assert.equal((await f.request('/account', { ...deletion, body: { password: 'synthetic wrong' } })).status, 403);
  assert.equal((await f.request('/account', { ...deletion, owner: foreign.owner })).status, 401);
  assert.equal((await f.request('/account', { ...deletion, noOrigin: true })).status, 403);
  assert.equal((await f.request('/account', { ...deletion, body: { password: PASSWORD, owner: foreign.owner } })).status, 400);
  const db = new DatabaseSync(f.dbPath);
  db.exec("CREATE TRIGGER synthetic_abort_delete BEFORE DELETE ON cloud_accounts BEGIN SELECT RAISE(ABORT, 'synthetic rollback only'); END");
  assert.equal((await f.request('/account', deletion)).status, 500);
  assert.equal((await f.request('/vault', signed)).data.vault.revision, 1);
  db.exec('DROP TRIGGER synthetic_abort_delete'); db.close();
  const paused = await pausedVaultWrite(f, signed, opaque(signed.owner, 1));
  const deleted = await f.request('/account', deletion);
  assert.equal(deleted.status, 200); assert.deepEqual(deleted.data, { ok: true });
  assert.ok(deleted.headers.get('set-cookie').includes('Max-Age=0'));
  paused.finish(); assert.equal(await paused.completed, 401);
  for (const cookie of [first.cookie, second.cookie]) {
    assert.deepEqual((await f.request('/session', { cookie })).data, { user: null });
    assert.equal((await f.request('/vault', { cookie, owner: signed.owner })).status, 401);
  }
  assert.equal((await login(f)).status, 401);
  assert.equal((await f.request('/vault', foreign)).data.vault.revision, 1);
  await f.stop(); await f.start();
  assert.equal((await f.request('/vault', foreign)).data.vault.revision, 1);
  const after = new DatabaseSync(f.dbPath);
  for (const [table, column] of [['cloud_accounts','id'], ['cloud_sessions','owner_id'], ['encrypted_vaults','owner_id']]) assert.equal(after.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`).get(signed.owner).n, 0);
  after.close();
});

const NEW_PASSWORD = 'SYNTHETIC! glacier orbit fern 8294';
test('seven-day cloud sessions expose minimal owner-bound metadata and fresh-password changes revoke every old cookie while keeping the vault', async t => {
  const f = await fixture(t), first = await login(f), second = await login(f), signed = {cookie:first.cookie,owner:f.user.id};
  assert.match(first.headers.get('set-cookie'), /Max-Age=604800(?:;|$)/);
  const other = await f.request('/auth/register',{method:'POST',body:{username:'security_other',password:PASSWORD}});
  const foreign = {cookie:other.cookie,owner:other.data.user.id};
  const saved = await f.request('/vault',{...signed,method:'PUT',body:opaque(signed.owner)});
  const details = await f.request('/security',signed);
  assert.equal(details.status,200);
  assert.deepEqual(Object.keys(details.data.security).sort(),['activeSessionCount','currentSession','sessionLifetimeHours']);
  assert.deepEqual(Object.keys(details.data.security.currentSession).sort(),['createdAt','expiresAt']);
  assert.equal(details.data.security.activeSessionCount,2);assert.equal(details.data.security.sessionLifetimeHours,168);
  const lifetime=Date.parse(details.data.security.currentSession.expiresAt)-Date.parse(details.data.security.currentSession.createdAt);
  assert.ok(lifetime>604790_000&&lifetime<=604800_000);
  assert.equal((await f.request('/security',{...signed,owner:foreign.owner})).status,401);
  assert.equal((await f.request('/security',{owner:signed.owner})).status,401);
  const confirmed=await f.request('/auth/verify-password',{...signed,method:'POST',body:{password:PASSWORD}});
  assert.equal(confirmed.status,200);assert.deepEqual(confirmed.data,{ok:true});assert.equal(confirmed.headers.get('set-cookie'),null);
  assert.deepEqual((await f.request('/security',signed)).data,details.data);
  assert.equal((await f.request('/auth/verify-password',{...signed,method:'POST',body:{password:'synthetic wrong'}})).status,403);
  const change={...signed,method:'POST',body:{currentPassword:PASSWORD,newPassword:NEW_PASSWORD}};
  assert.equal((await f.request('/auth/change-password',{...change,body:{...change.body,currentPassword:'synthetic wrong'}})).status,403);
  assert.equal((await f.request('/auth/change-password',{...change,body:{...change.body,newPassword:'password1234567890'}})).status,400);
  assert.equal((await f.request('/auth/change-password',{...change,body:{...change.body,newPassword:PASSWORD}})).status,400);
  assert.equal((await f.request('/auth/change-password',{...change,noOrigin:true})).status,403);
  assert.equal((await f.request('/auth/logout-all',{...signed,method:'POST',body:{password:'synthetic wrong'}})).status,403);
  const db=new DatabaseSync(f.dbPath);
  db.exec("CREATE TRIGGER synthetic_abort_session BEFORE INSERT ON cloud_sessions BEGIN SELECT RAISE(ABORT, 'synthetic rollback only'); END");
  assert.equal((await f.request('/auth/change-password',change)).status,500);
  assert.equal((await f.request('/security',signed)).data.security.activeSessionCount,2);
  db.exec('DROP TRIGGER synthetic_abort_session');db.close();
  const changed=await f.request('/auth/change-password',change);
  assert.equal(changed.status,200);assert.deepEqual(changed.data.user,f.user);
  assert.notEqual(changed.cookie,first.cookie);assert.notEqual(changed.cookie,second.cookie);
  assert.equal(changed.data.security.activeSessionCount,1);
  const fresh={cookie:changed.cookie,owner:signed.owner};
  assert.deepEqual((await f.request('/vault',fresh)).data,saved.data);
  for(const cookie of [first.cookie,second.cookie])assert.deepEqual((await f.request('/session',{cookie})).data,{user:null});
  assert.equal((await login(f)).status,401);
  const another=await f.request('/auth/login',{method:'POST',body:{username:USERNAME,password:NEW_PASSWORD}});
  assert.equal(another.status,200);
  const exited=await f.request('/auth/logout-all',{...fresh,method:'POST',body:{password:NEW_PASSWORD}});
  assert.equal(exited.status,200);assert.deepEqual(exited.data,{ok:true});assert.match(exited.headers.get('set-cookie'),/Max-Age=0/);
  for(const cookie of [changed.cookie,another.cookie])assert.deepEqual((await f.request('/session',{cookie})).data,{user:null});
  assert.deepEqual((await f.request('/session',foreign)).data,{user:other.data.user});
  const reentered=await f.request('/auth/login',{method:'POST',body:{username:USERNAME,password:NEW_PASSWORD}});
  await f.stop();await f.start();
  assert.deepEqual((await f.request('/vault',{cookie:reentered.cookie,owner:signed.owner})).data,saved.data);
});

test('new account security routes share the owner attempt quota and legacy long sessions are capped without rolling extension', async t => {
  const f=await fixture(t,{loginAttemptLimit:2}), first=await login(f), signed={cookie:first.cookie,owner:f.user.id};
  assert.equal((await f.request('/auth/logout-all',{...signed,method:'POST',body:{password:'synthetic wrong'}})).status,403);
  const denied=await f.request('/auth/change-password',{...signed,method:'POST',body:{currentPassword:PASSWORD,newPassword:NEW_PASSWORD}});
  assert.equal(denied.status,429);assert.ok(Number(denied.headers.get('retry-after'))>0);
  const other=await fixture(t), logged=await login(other);
  const sixDaysAgo=new Date(Date.now()-6*86400_000).toISOString(), validExpiry=Date.parse(sixDaysAgo)+7*86400_000;
  const validDb=new DatabaseSync(other.dbPath);
  validDb.prepare('UPDATE cloud_sessions SET created_at=?,expires_at=?').run(sixDaysAgo,validExpiry);validDb.close();
  await other.stop();await other.start();
  assert.equal((await other.request('/session',{cookie:logged.cookie})).data.user.id,other.user.id);
  const validCheck=new DatabaseSync(other.dbPath);
  assert.equal(validCheck.prepare('SELECT expires_at FROM cloud_sessions').get().expires_at,validExpiry);validCheck.close();
  const db=new DatabaseSync(other.dbPath), created=new Date(Date.now()-8*86400_000).toISOString();
  db.prepare('UPDATE cloud_sessions SET created_at=?,expires_at=?').run(created,Date.now()+28*86400_000);db.close();
  await other.stop();await other.start();
  assert.deepEqual((await other.request('/session',{cookie:logged.cookie})).data,{user:null});
  const check=new DatabaseSync(other.dbPath);
  const expires=check.prepare('SELECT expires_at FROM cloud_sessions').get().expires_at;
  assert.equal(expires,Date.parse(created)+7*86400_000);check.close();
  await other.stop();await other.start();
  const again=new DatabaseSync(other.dbPath);assert.equal(again.prepare('SELECT expires_at FROM cloud_sessions').get().expires_at,expires);again.close();
  assert.equal((await login(other)).status,200);
});

test('cloud CSP permits only the WASM compilation needed by Argon2 and security request bodies reject vault secrets', async t => {
  const f=await fixture(t), logged=await login(f), signed={cookie:logged.cookie,owner:f.user.id};
  const csp=logged.headers.get('content-security-policy');
  assert.ok(csp.includes("script-src 'self' 'wasm-unsafe-eval'"));assert.ok(!csp.includes("'unsafe-eval'"));
  for(const path of ['/auth/logout-all','/auth/change-password','/auth/verify-password']) {
    assert.equal((await f.request(path,{...signed,method:'POST',body:{password:PASSWORD,vaultPassphrase:'never accept this'}})).status,400);
    assert.equal((await f.request(path,{...signed,method:'POST',body:{password:PASSWORD},owner:'wrong-owner'})).status,401);
  }
  assert.equal((await f.request('/auth/register',{method:'POST',body:{username:'weak_synthetic',password:'password1234567890'}})).status,400);
});

test('an existing weak legacy account can still sign in, verify and replace its password under the stronger new-password policy', async t => {
  const f=await fixture(t), legacy='password1234', salt='22'.repeat(16);
  const key=scryptSync(legacy,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex');
  const db=new DatabaseSync(f.dbPath);
  db.prepare('UPDATE cloud_accounts SET password_hash=? WHERE id=?').run(`scrypt$32768$8$1$${salt}$${key}`,f.user.id);db.close();
  const signed=await f.request('/auth/login',{method:'POST',body:{username:USERNAME,password:legacy}});
  assert.equal(signed.status,200);
  const owner={cookie:signed.cookie,owner:f.user.id};
  assert.equal((await f.request('/auth/verify-password',{...owner,method:'POST',body:{password:legacy}})).status,200);
  const changed=await f.request('/auth/change-password',{...owner,method:'POST',body:{currentPassword:legacy,newPassword:NEW_PASSWORD}});
  assert.equal(changed.status,200);
  assert.equal((await f.request('/auth/login',{method:'POST',body:{username:USERNAME,password:legacy}})).status,401);
  assert.equal((await f.request('/auth/login',{method:'POST',body:{username:USERNAME,password:NEW_PASSWORD}})).status,200);
});

test('well-formed weak passwords consume source or account quotas before strength evaluation can be repeated', async t => {
  const f=await fixture(t,{registrationAttemptLimit:1,loginAttemptLimit:2});
  const weak={username:'weak_quota_synthetic',password:'password1234567890'};
  assert.equal((await f.request('/auth/register',{method:'POST',body:weak})).status,400);
  assert.equal((await f.request('/auth/register',{method:'POST',body:{...weak,password:PASSWORD}})).status,429);
  const signed=await login(f);assert.equal(signed.status,200);
  const request={cookie:signed.cookie,owner:f.user.id,method:'POST',body:{currentPassword:PASSWORD,newPassword:'password1234567890'}};
  assert.equal((await f.request('/auth/change-password',request)).status,400);
  assert.equal((await f.request('/auth/change-password',{...request,body:{...request.body,newPassword:NEW_PASSWORD}})).status,429);
  assert.deepEqual((await f.request('/session',{cookie:signed.cookie})).data,{user:f.user});
});
