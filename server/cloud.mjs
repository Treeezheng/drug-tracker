import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openVaultStore, VaultStoreError } from './vault-store.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = '/drug/api';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const VAULT_BODY_LIMIT = Math.ceil(16_000_016 * 4 / 3) + 4096;
const scryptAsync = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const publicUser = value => ({ id: value.id, name: value.name });

export class CloudError extends Error {
  constructor(status, message, details = {}) { super(message); this.name = 'CloudError'; this.status = status; Object.assign(this, details); }
}
const invalid = message => { throw new CloudError(400, message); };
function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) invalid('Invalid request fields.');
  return value;
}
function username(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(value.trim())) invalid('Use a username of 3–64 letters, numbers, dots, underscores or hyphens.');
  return value.trim().toLowerCase();
}
function password(value, creating = false) {
  if (typeof value !== 'string' || value.length < (creating ? 10 : 1) || value.length > 256) invalid(creating ? 'Use an account password of 10–256 characters.' : 'Enter your account password.');
  return value;
}
async function passwordHash(value) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(value, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt}$${key.toString('hex')}`;
}
async function passwordMatches(value, encoded) {
  if (typeof encoded !== 'string' || !/^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded)) throw new CloudError(500, 'Account authentication is unavailable.');
  const fields = encoded.split('$');
  const actual = await scryptAsync(value, fields[4], 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(fields[5], 'hex'));
}
function configuration({ dbPath, origin, allowInsecureLoopback = false } = {}) {
  if (typeof dbPath !== 'string' || !isAbsolute(dbPath)) invalid('Choose an explicit absolute CLOUD_DB_PATH for the cloud edition.');
  if (typeof origin !== 'string') invalid('Configure an exact CLOUD_ORIGIN before starting the cloud edition.');
  let parsed;
  try { parsed = new URL(origin); } catch { invalid('Invalid cloud origin.'); }
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') invalid('Cloud origin must contain only the scheme and exact host.');
  const insecure = parsed.protocol === 'http:';
  if (parsed.protocol !== 'https:' && !(allowInsecureLoopback === true && insecure && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))) invalid('The cloud origin must use HTTPS; HTTP is allowed only by an explicit loopback development flag.');
  return { dbPath: resolve(dbPath), origin, host: parsed.host, secure: !insecure };
}

function openCloudDatabase(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  try {
    // Inspect only schema names before enabling journals or changing an existing file.
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
    const allowed = ['cloud_meta', 'cloud_accounts', 'cloud_sessions', 'encrypted_vaults'];
    if (tables.some(name => !allowed.includes(name))) throw new CloudError(400, 'This is not a dedicated cloud database. Choose a new CLOUD_DB_PATH.');
    chmodSync(dbPath, 0o600);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
    try {
      db.exec('CREATE TABLE IF NOT EXISTS cloud_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), edition TEXT NOT NULL, version INTEGER NOT NULL) STRICT');
      const version = db.prepare('SELECT edition, version FROM cloud_meta WHERE singleton=1').get();
      if (version && (version.edition !== 'drug-cloud-encrypted' || ![1, 2].includes(version.version))) throw new CloudError(400, 'Unsupported cloud database version.');
      if (!version) {
        if (tables.includes('cloud_accounts') || tables.includes('cloud_sessions')) throw new CloudError(400, 'The existing cloud account database has no supported version.');
        db.exec(`CREATE TABLE cloud_accounts (
          id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE cloud_sessions (
          token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
        ) STRICT;`);
        db.prepare('INSERT INTO cloud_meta VALUES (1,?,2)').run('drug-cloud-encrypted');
      } else if (version.version === 1) {
        // Copy accounts and sessions together before dropping the singleton tables.
        // Keeping their IDs preserves every existing vault and authenticated session.
        db.exec(`CREATE TABLE cloud_accounts_v2 (
          id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO cloud_accounts_v2 SELECT id, username, password_hash, name, created_at FROM cloud_accounts;
        CREATE TABLE cloud_sessions_v2 (
          token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES cloud_accounts_v2(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO cloud_sessions_v2 SELECT token_hash, owner_id, expires_at, created_at FROM cloud_sessions;
        DROP TABLE cloud_sessions;
        DROP TABLE cloud_accounts;
        ALTER TABLE cloud_accounts_v2 RENAME TO cloud_accounts;
        ALTER TABLE cloud_sessions_v2 RENAME TO cloud_sessions;
        UPDATE cloud_meta SET version=2 WHERE singleton=1;`);
      }
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new CloudError(400, 'Cloud account relationships could not be preserved.');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return db;
  } catch (error) { db.close(); throw error; }
}

/** One-time operator action. Never call this through an HTTP route. */
export async function bootstrapCloudAccount({ dbPath, username: suppliedName, password: suppliedPassword, name = 'Owner' } = {}) {
  if (typeof dbPath !== 'string' || !isAbsolute(dbPath)) invalid('Choose an explicit absolute CLOUD_DB_PATH for the cloud edition.');
  const loginName = username(suppliedName);
  password(suppliedPassword, true);
  if (typeof name !== 'string' || !name.trim() || name.length > 100) invalid('Use a display name of 1–100 characters.');
  const db = openCloudDatabase(resolve(dbPath));
  try {
    if (db.prepare('SELECT id FROM cloud_accounts').get()) throw new CloudError(409, 'This cloud account is already configured.');
    const encoded = await passwordHash(suppliedPassword);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT id FROM cloud_accounts').get()) throw new CloudError(409, 'This cloud account is already configured.');
      const user = { id: randomUUID(), name: name.trim() };
      db.prepare('INSERT INTO cloud_accounts (id,username,password_hash,name,created_at) VALUES (?,?,?,?,?)').run(user.id, loginName, encoded, user.name, new Date().toISOString());
      db.exec('COMMIT');
      return { user };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}

function staticBuild(distDir) {
  if (distDir === undefined || distDir === null) return null;
  const path = realpathSync(resolve(distDir)), indexPath = join(path, 'index.html');
  const index = readFileSync(indexPath, 'utf8');
  const editionTags = (index.replace(/<!--[\s\S]*?-->/g, '').match(/<meta\b[^>]*>/gi) ?? []).filter(tag => /\bname\s*=\s*["']drug-edition["']/i.test(tag));
  if (editionTags.length !== 1 || !/^<meta\s+name=["']drug-edition["']\s+content=["']cloud["']\s*\/?>$/i.test(editionTags[0])) throw new CloudError(400, 'The cloud server requires a cloud build of the frontend.');
  const privacyPath = join(path, 'privacy.html');
  let privacy = null;
  if (existsSync(privacyPath)) {
    if (!realpathSync(privacyPath).startsWith(path + sep) || !statSync(privacyPath).isFile()) throw new CloudError(400, 'The privacy page must be part of the cloud frontend build.');
    privacy = readFileSync(privacyPath);
  }
  return { path, index: Buffer.from(index), privacy };
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };

/** API-only by default; the CLI always supplies and validates a cloud frontend build. */
export async function createCloudServer(options = {}) {
  const config = configuration(options), build = staticBuild(options.distDir);
  const db = openCloudDatabase(config.dbPath);
  let vaultStore;
  let dummyHash;
  try {
    vaultStore = openVaultStore({ dbPath: config.dbPath });
    dummyHash = await passwordHash(randomBytes(32).toString('base64url'));
  } catch (error) { vaultStore?.close(); db.close(); throw error; }
  const cookieName = config.secure ? '__Secure-drug_cloud_session' : 'drug_cloud_dev_session';
  const attemptLimit = options.loginAttemptLimit ?? 30;
  const windowMs = options.loginWindowMs ?? 15 * 60 * 1000;
  const registrationLimit = options.registrationAttemptLimit ?? 10;
  const registrationWindowMs = options.registrationWindowMs ?? 60 * 60 * 1000;
  if ([attemptLimit, windowMs, registrationLimit, registrationWindowMs].some(value => !Number.isSafeInteger(value) || value < 1)) { vaultStore.close(); db.close(); invalid('Invalid account rate limit.'); }
  const attempts = { login: { count: 0, until: 0 }, register: { count: 0, until: 0 } };
  let verifying = 0, closed = false;
  function rateLimit(kind = 'login') {
    const entry = attempts[kind], duration = kind === 'register' ? registrationWindowMs : windowMs;
    if (Date.now() >= entry.until) { entry.count = 0; entry.until = Date.now() + duration; }
    if (++entry.count > (kind === 'register' ? registrationLimit : attemptLimit) || verifying >= 2) throw new CloudError(429, 'Too many account attempts. Please wait before trying again.', { retryAfter: Math.max(1, Math.ceil((entry.until - Date.now()) / 1000)) });
  }
  async function hashWork(operation) {
    if (verifying >= 2) throw new CloudError(429, 'Too many account attempts. Please wait before trying again.', { retryAfter: 1 });
    verifying++;
    try { return await operation(); } finally { verifying--; }
  }
  function token(req) {
    const matches = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
    if (matches.length !== 1) return null;
    const value = matches[0].slice(cookieName.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  function currentUser(req) {
    const value = token(req);
    if (!value) return null;
    return db.prepare('SELECT a.* FROM cloud_accounts a JOIN cloud_sessions s ON a.id=s.owner_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(value), Date.now()) ?? null;
  }
  function owner(req) {
    const user = currentUser(req);
    if (!user) throw new CloudError(401, 'Sign in to access your encrypted vault.');
    if (req.headers['x-dose-owner'] !== user.id) throw new CloudError(401, 'The selected account changed. Sign in again before continuing.');
    return user;
  }
  function cookie(res, value = '') {
    res.setHeader('Set-Cookie', `${cookieName}=${value}; Path=/drug/; HttpOnly; SameSite=Strict; Max-Age=${value ? SESSION_SECONDS : 0}${config.secure ? '; Secure' : ''}`);
  }
  function issueSession(user) {
    const value = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM cloud_sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO cloud_sessions VALUES (?,?,?,?)').run(hash(value), user.id, Date.now() + SESSION_SECONDS * 1000, new Date().toISOString());
    return value;
  }
  function guards(req) {
    if (req.headers.host !== config.host) throw new CloudError(403, 'Untrusted request host.');
    if (req.headers.origin !== undefined && req.headers.origin !== config.origin) throw new CloudError(403, 'Untrusted request origin.');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new CloudError(403, 'Cross-site requests are not allowed.');
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== config.origin) throw new CloudError(403, 'A same-origin request is required.');
  }
  function headers(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (config.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }
  async function body(req, maximum = 4096) {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) throw new CloudError(415, 'Use an application/json request.');
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new CloudError(415, 'Compressed request bodies are not supported.');
    if (req.headers['content-length'] && Number(req.headers['content-length']) > maximum) { req.resume(); throw new CloudError(413, 'Request body is too large.'); }
    let length = 0;
    const chunks = [];
    await new Promise((accept, reject) => {
      let settled = false;
      req.on('data', chunk => {
        if (settled) return;
        length += chunk.length;
        if (length > maximum) { settled = true; chunks.length = 0; reject(new CloudError(413, 'Request body is too large.')); return; }
        chunks.push(chunk);
      });
      req.once('end', () => { if (!settled) { settled = true; accept(); } });
      req.once('error', () => { if (!settled) { settled = true; reject(new CloudError(400, 'The request was interrupted.')); } });
      req.once('aborted', () => { if (!settled) { settled = true; reject(new CloudError(400, 'The request was interrupted.')); } });
    });
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { invalid('Provide a valid JSON request.'); }
  }
  const server = createServer(async (req, res) => {
    headers(res);
    try {
      guards(req);
      const path = new URL(req.url, config.origin).pathname;
      if (path === `${PREFIX}/edition` && req.method === 'GET') return send(res, 200, { edition: 'cloud' });
      if (path === `${PREFIX}/session` && req.method === 'GET') { const user = currentUser(req); return send(res, 200, { user: user ? publicUser(user) : null }); }
      if (path === `${PREFIX}/auth/register` && req.method === 'POST') {
        rateLimit('register');
        const input = await body(req);
        exactObject(input, ['username', 'password', ...(input && Object.hasOwn(input, 'name') ? ['name'] : [])]);
        const loginName = username(input.username); password(input.password, true);
        const name = input.name === undefined ? loginName : input.name;
        if (typeof name !== 'string' || !name.trim() || name.length > 100) invalid('Use a display name of 1–100 characters.');
        if (db.prepare('SELECT id FROM cloud_accounts WHERE username=?').get(loginName)) throw new CloudError(409, 'Username is unavailable.');
        const encoded = await hashWork(() => passwordHash(input.password));
        const user = { id: randomUUID(), name: name.trim() };
        let value;
        db.exec('BEGIN IMMEDIATE');
        try {
          if (db.prepare('SELECT id FROM cloud_accounts WHERE username=?').get(loginName)) throw new CloudError(409, 'Username is unavailable.');
          db.prepare('INSERT INTO cloud_accounts (id,username,password_hash,name,created_at) VALUES (?,?,?,?,?)').run(user.id, loginName, encoded, user.name, new Date().toISOString());
          value = issueSession(user);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        cookie(res, value);
        return send(res, 201, { user });
      }
      if (path === `${PREFIX}/auth/login` && req.method === 'POST') {
        rateLimit();
        const input = exactObject(await body(req), ['username', 'password']);
        const loginName = username(input.username); password(input.password);
        const account = db.prepare('SELECT * FROM cloud_accounts WHERE username=?').get(loginName);
        const matches = await hashWork(() => passwordMatches(input.password, account?.password_hash ?? dummyHash));
        if (!matches || !account) throw new CloudError(401, 'Username or account password is incorrect.');
        db.exec('BEGIN IMMEDIATE');
        try {
          const fresh = db.prepare('SELECT * FROM cloud_accounts WHERE id=? AND password_hash=?').get(account.id, account.password_hash);
          if (!fresh) throw new CloudError(401, 'The account changed. Sign in again.');
          const value = issueSession(fresh);
          db.exec('COMMIT');
          cookie(res, value);
          return send(res, 200, { user: publicUser(fresh) });
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      if (path === `${PREFIX}/auth/logout` && req.method === 'POST') {
        const input = await body(req); exactObject(input, []);
        const user = currentUser(req);
        if (user && req.headers['x-dose-owner'] && req.headers['x-dose-owner'] !== user.id) throw new CloudError(401, 'The selected account changed. Sign in again.');
        const value = token(req);
        if (value) db.prepare('DELETE FROM cloud_sessions WHERE token_hash=?').run(hash(value));
        cookie(res);
        return send(res, 200, { ok: true });
      }
      if (path === `${PREFIX}/vault` && ['GET', 'PUT'].includes(req.method)) {
        const user = owner(req);
        if (req.method === 'GET') return send(res, 200, { vault: vaultStore.read(user.id) });
        const input = await body(req, VAULT_BODY_LIMIT);
        // Recheck after asynchronous body reading; a logout or session expiry may have occurred.
        if (owner(req).id !== user.id) throw new CloudError(401, 'The account changed. Sign in again.');
        return send(res, 200, { vault: vaultStore.write(user.id, input) });
      }
      if (path === PREFIX || path.startsWith(`${PREFIX}/`)) throw new CloudError(404, 'This endpoint does not exist.');
      if (build && ['GET', 'HEAD'].includes(req.method)) {
        if (path === '/drug') { res.writeHead(308, { Location: '/drug/' }); return res.end(); }
        if (path.startsWith('/drug/')) {
          let relative;
          try { relative = decodeURIComponent(path.slice('/drug/'.length)); } catch { throw new CloudError(404, 'File not found.'); }
          if (relative === 'privacy.html' && build.privacy) {
            res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
            res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': build.privacy.length });
            return res.end(req.method === 'HEAD' ? undefined : build.privacy);
          }
          let selected = resolve(build.path, relative || 'index.html');
          if (!selected.startsWith(build.path + sep) || relative.includes('\0')) throw new CloudError(404, 'File not found.');
          if (!existsSync(selected) || !statSync(selected).isFile()) {
            if (extname(relative) || relative.startsWith('assets/')) throw new CloudError(404, 'File not found.');
            selected = join(build.path, 'index.html');
          }
          if (!realpathSync(selected).startsWith(build.path + sep)) throw new CloudError(404, 'File not found.');
          const bytes = selected === join(build.path, 'index.html') ? build.index : readFileSync(selected);
          // Always serve the edition-checked HTML snapshot, even if the build directory changes.
          if (extname(selected) === '.html' && selected !== join(build.path, 'index.html')) throw new CloudError(404, 'File not found.');
          res.writeHead(200, { 'Content-Type': MIME[extname(selected)] ?? 'application/octet-stream', 'Content-Length': bytes.length });
          return res.end(req.method === 'HEAD' ? undefined : bytes);
        }
      }
      throw new CloudError(404, 'This endpoint does not exist.');
    } catch (error) {
      if (res.headersSent) return res.end();
      if (error instanceof CloudError || error instanceof VaultStoreError) {
        if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
        if (error.status === 413) res.setHeader('Connection', 'close');
        return send(res, error.status, { error: error.message, ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}) });
      }
      // Never log request bodies, credentials, health values, ciphertext, or stack traces.
      return send(res, 500, { error: 'The cloud request could not be completed.' });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  function closeStorage() { if (!closed) { closed = true; vaultStore.close(); db.close(); } }
  server.on('close', closeStorage);
  return { server, closeStorage, edition: 'cloud' };
}

async function cli() {
  const command = process.argv[2] ?? 'start';
  if (process.argv.length > 3 || !['start', 'bootstrap'].includes(command)) invalid('Use cloud.mjs bootstrap or cloud.mjs start. Never pass a password as a command argument.');
  const dbPath = process.env.CLOUD_DB_PATH;
  if (command === 'bootstrap') {
    const suppliedPassword = process.env.CLOUD_ADMIN_PASSWORD;
    delete process.env.CLOUD_ADMIN_PASSWORD;
    await bootstrapCloudAccount({ dbPath, username: process.env.CLOUD_ADMIN_USERNAME, password: suppliedPassword, name: process.env.CLOUD_ADMIN_NAME || 'Owner' });
    process.stdout.write('Drug Tracker cloud account configured. Keep the separate vault passphrase in the client.\n');
    return;
  }
  if (process.env.CLOUD_ADMIN_PASSWORD) invalid('Remove CLOUD_ADMIN_PASSWORD after one-time bootstrap before starting the service.');
  const port = Number(process.env.CLOUD_PORT || 4312);
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalid('Choose a valid CLOUD_PORT.');
  const { server } = await createCloudServer({ dbPath, origin: process.env.CLOUD_ORIGIN, allowInsecureLoopback: process.env.CLOUD_ALLOW_INSECURE_LOOPBACK === '1', distDir: process.env.CLOUD_DIST_PATH || join(ROOT, 'dist') });
  server.listen(port, '127.0.0.1', () => process.stdout.write(`Drug Tracker cloud listening on 127.0.0.1:${port}/drug/\n`));
  server.on('error', () => { process.stderr.write('Drug Tracker cloud could not start.\n'); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(() => { process.exitCode = 0; }); server.closeIdleConnections(); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  cli().catch(error => { process.stderr.write(`${error instanceof CloudError ? error.message : 'Drug Tracker cloud could not start.'}\n`); process.exitCode = 1; });
}
