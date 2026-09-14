import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrapCloudAccount, createCloudServer, CloudError } from '../server/cloud.mjs';
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
  const dir = await mkdtemp(join(tmpdir(), 'drug-cloud-api-')), dbPath = join(dir, 'cloud-only.sqlite');
  const setup = await bootstrapCloudAccount({ dbPath, ...credentials });
  let instance;
  const origin = options.origin ?? ORIGIN;
  const start = async () => {
    instance = await createCloudServer({ dbPath, origin, ...options });
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
      const req = httpRequest({ hostname: '127.0.0.1', port: instance.server.address().port, path: path.startsWith('/drug') || path.startsWith('/api') ? path : `/drug/api${path}`,
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

test('cloud configuration and bootstrap require an explicit separate database and create exactly one durable account', async t => {
  const dir = await directory(t), dbPath = join(dir, 'new-cloud.sqlite');
  for (const options of [
    {}, { dbPath }, { dbPath: 'relative.sqlite', origin: ORIGIN },
    { dbPath, origin: 'http://treeezh.com', allowInsecureLoopback: true },
    { dbPath, origin: 'http://127.0.0.1:4312' }, { dbPath, origin: `${ORIGIN}/drug` },
    { dbPath, origin: `${ORIGIN}/` }, { dbPath, origin: 'https://user:secret@treeezh.com' },
  ]) await assert.rejects(createCloudServer(options), fail(400));
  await assert.rejects(createCloudServer({ dbPath, origin: ORIGIN }), fail(503));
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

test('production authentication has scoped Secure cookies, private responses and no public signup or plaintext routes', async t => {
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
    ['/auth/register', 'POST'], ['/auth/recover', 'POST'], ['/auth/local-setup', 'POST'], ['/auth/local-state', 'GET'],
    ['/data', 'GET'], ['/export', 'GET'], ['/import', 'POST'], ['/profile', 'PUT'], ['/doses/record', 'PUT'],
    ['/checkins/record', 'PUT'], ['/inventory/record', 'PUT'], ['/account', 'DELETE'], ['/api/session', 'GET'],
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
    assert.equal((await f.request('/vault', { cookie: signed.cookie, owner: selectedOwner })).status, 409);
    assert.equal((await f.request('/vault', { method: 'PUT', cookie: signed.cookie, owner: selectedOwner, body: opaque(f.user.id) })).status, 409);
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
  assert.equal((await f.request('/auth/logout', { method: 'POST', cookie: first.cookie, owner: 'wrong-owner', body: {} })).status, 409);
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
  for (const path of ['/drug/assets/missing.js', '/drug/private.txt', '/drug/local.html', '/drug/%2e%2e/private.txt', '/drug/api/no-such-route']) assert.equal((await f.request(path)).status, 404);
  await writeFile(join(distDir, 'index.html'), '<meta name="drug-edition" content="local">');
  await writeFile(join(distDir, 'privacy.html'), '<p>A replaced document must not replace the verified startup snapshot.</p>');
  assert.equal((await f.request('/drug/')).data, cloudHtml, 'The server must keep serving its edition-checked HTML snapshot.');
  assert.equal((await f.request('/drug/privacy.html')).data, disclosure.data);
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
