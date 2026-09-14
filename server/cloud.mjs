import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { constants, openSync, closeSync, fstatSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VaultStoreError } from './vault-store.mjs';
import { CloudError } from './cloud-errors.mjs';
import { openCloudDatabase, openCloudSqlite } from './cloud-sqlite.mjs';
import { operationGate, rateSource } from './cloud-limits.mjs';
import { SESSION_SECONDS } from './cloud-session.mjs';
import { createOpaqueService } from './cloud-opaque.mjs';
import { accountPasswordError } from '../src/lib/password-policy.mjs';
export { CloudError } from './cloud-errors.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = '/drug/api';
const VAULT_BODY_LIMIT = Math.ceil(16_000_016 * 4 / 3) + 4096;
const scryptAsync = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const publicUser = value => ({ id: value.id, name: value.name, username: value.username, authMode: value.auth_mode ?? 'legacy-scrypt' });

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
  if (typeof value !== 'string' || !value.length || value.length > 256
    || (creating && ([...value].length < 15 || !value.isWellFormed()))) invalid(creating ? 'Use an account password of 15–256 characters and valid Unicode.' : 'Enter your account password.');
  return value;
}
async function newAccountPassword(value, loginName) {
  password(value, true);
  const error = await accountPasswordError(value, loginName);
  if (error) invalid(error);
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
function configuration({ dbPath, databaseUrl, origin, allowInsecureLoopback = false, proxyMode } = {}) {
  if (databaseUrl !== undefined && dbPath !== undefined) invalid('Choose PostgreSQL or a dedicated SQLite path, not both.');
  if (databaseUrl === undefined && (typeof dbPath !== 'string' || !isAbsolute(dbPath))) invalid('Choose an explicit absolute CLOUD_DB_PATH for the cloud edition.');
  if (proxyMode !== undefined && proxyMode !== 'heroku') invalid('Unsupported cloud proxy mode.');
  if (typeof origin !== 'string') invalid('Configure an exact CLOUD_ORIGIN before starting the cloud edition.');
  let parsed;
  try { parsed = new URL(origin); } catch { invalid('Invalid cloud origin.'); }
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') invalid('Cloud origin must contain only the scheme and exact host.');
  const insecure = parsed.protocol === 'http:';
  if (parsed.protocol !== 'https:' && !(allowInsecureLoopback === true && insecure && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))) invalid('The cloud origin must use HTTPS; HTTP is allowed only by an explicit loopback development flag.');
  if (proxyMode === 'heroku' && insecure) invalid('The Heroku cloud origin must use HTTPS.');
  return { dbPath: dbPath ? resolve(dbPath) : undefined, databaseUrl, origin, host: parsed.host, secure: !insecure, proxyMode };
}

/** Legacy synthetic-fixture helper only. Production accounts register through OPAQUE. */
export async function bootstrapCloudAccount({ dbPath, username: suppliedName, password: suppliedPassword, name = 'Owner' } = {}) {
  if (typeof dbPath !== 'string' || !isAbsolute(dbPath)) invalid('Choose an explicit absolute CLOUD_DB_PATH for the cloud edition.');
  const loginName = username(suppliedName);
  await newAccountPassword(suppliedPassword, loginName);
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

function readStaticFile(path) {
  // Open once, refuse a symbolic-link leaf, and validate/read that same descriptor.
  // O_NONBLOCK prevents a substituted FIFO from blocking before fstat can reject it.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 16 * 1024 * 1024) throw new CloudError(400, 'Invalid or oversized public build file.');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) break;
      offset += count;
    }
    const extra = Buffer.alloc(1), after = fstatSync(fd);
    if (offset !== bytes.length || readSync(fd, extra, 0, 1, null) !== 0 || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new CloudError(400, 'The public build changed while it was being loaded.');
    return bytes;
  } finally { closeSync(fd); }
}

function staticBuild(distDir) {
  if (distDir === undefined || distDir === null) return null;
  const path = realpathSync(resolve(distDir)), files = new Map();
  let total = 0, entries = 0;
  const capture = name => {
    const bytes = readStaticFile(join(path, name));
    total += bytes.length;
    if (total > 64 * 1024 * 1024 || files.size >= 1000) throw new CloudError(400, 'The public build is too large.');
    files.set(name, bytes);
  };
  capture('index.html');
  const index = files.get('index.html').toString('utf8');
  // Recognize comments as whole tokens instead of deleting text and potentially
  // joining fragments into a new tag/comment. An unclosed comment consumes EOF.
  // This validates our generated edition marker; it is not an HTML sanitizer.
  const tokens = index.match(/<!--[\s\S]*?(?:-->|$)|<meta\b[^>]*>/gi) ?? [];
  const editionTags = tokens.filter(tag => !tag.startsWith('<!--') && /\bname\s*=\s*["']drug-edition["']/i.test(tag));
  if (editionTags.length !== 1 || !/^<meta\s+name=["']drug-edition["']\s+content=["']cloud["']\s*\/?>$/i.test(editionTags[0])) throw new CloudError(400, 'The cloud server requires a cloud build of the frontend.');
  const legalPages = new Map();
  for (const name of ['privacy.html', 'terms.html', 'robots.txt', 'llms.txt', 'favicon.svg', 'favicon.ico', 'build-info.json']) {
    try { capture(name); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (name === 'privacy.html' || name === 'terms.html') legalPages.set(name, files.get(name));
  }
  const assetTypes = new Set(['.js', '.css', '.svg', '.png', '.ico', '.woff2', '.woff', '.ttf', '.json', '.wasm', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);
  const walk = (directory, depth) => {
    if (depth > 4) throw new CloudError(400, 'The public build has too many directory levels.');
    for (const entry of readdirSync(join(path, directory), { withFileTypes: true })) {
      if (++entries > 4096) throw new CloudError(400, 'The public build has too many entries.');
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(name, depth + 1);
      else if (entry.isFile() && assetTypes.has(extname(entry.name))) capture(name);
      // Symlink entries are never followed, including directory symlinks.
    }
  };
  const assets = readdirSync(path, { withFileTypes: true }).find(entry => entry.name === 'assets');
  if (assets?.isDirectory()) walk('assets', 0);
  // Deploy from a trusted directory that is not writable by untrusted users while
  // startup runs. After this bounded snapshot, requests never consult filesystem paths.
  return { index: files.get('index.html'), files, legalPages };
}
const MIME = { '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };

/** API-only by default; the CLI always supplies and validates a cloud frontend build. */
export async function createCloudServer(options = {}) {
  const config = configuration(options), build = staticBuild(options.distDir);
  const repository = config.databaseUrl !== undefined
    ? await (await import('./cloud-postgres.mjs')).openCloudPostgres({ ...options, databaseUrl: config.databaseUrl })
    : openCloudSqlite(config.dbPath);
  let dummyHash;
  try { dummyHash = await passwordHash(randomBytes(32).toString('base64url')); }
  catch (error) { await repository.close(); throw error; }
  const cookieName = config.secure ? '__Secure-drug_cloud_session' : 'drug_cloud_dev_session';
  const attemptLimit = options.loginAttemptLimit ?? 30;
  const windowMs = options.loginWindowMs ?? 15 * 60 * 1000;
  const registrationLimit = options.registrationAttemptLimit ?? 10;
  const registrationWindowMs = options.registrationWindowMs ?? 60 * 60 * 1000;
  if ([attemptLimit, windowMs, registrationLimit, registrationWindowMs].some(value => !Number.isSafeInteger(value) || value < 1)) { await repository.close(); invalid('Invalid account rate limit.'); }
  const attempts = new Map();
  const reserveAuth = operationGate(8, 'Account requests are busy. Please retry in a moment.');
  const reserveVault = operationGate(1, 'An encrypted save or download is in progress. Please retry in a moment.');
  let verifying = 0, closed = false;
  async function rateLimit(kind, subject, limitMultiplier = 1) {
    const duration = kind === 'register' ? registrationWindowMs : windowMs;
    const digest = hash(subject);
    if (repository.consumeRateLimit) {
      await repository.consumeRateLimit(kind, digest, (kind === 'register' ? registrationLimit : attemptLimit) * limitMultiplier, duration);
      return;
    }
    const now = Date.now(), key = `${kind}:${digest}`;
    for (const [id, value] of attempts) if (value.until <= now) attempts.delete(id);
    let entry = attempts.get(key);
    if (!entry) {
      if (attempts.size >= 10_000) throw new CloudError(429, 'Account requests are busy. Please retry later.', { retryAfter: 60 });
      entry = { count: 0, until: now + duration }; attempts.set(key, entry);
    }
    if (++entry.count > (kind === 'register' ? registrationLimit : attemptLimit) * limitMultiplier) throw new CloudError(429, 'Too many attempts for this account or connection. Please wait before trying again.', { retryAfter: Math.max(1, Math.ceil((entry.until - now) / 1000)) });
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
  async function currentUser(req) {
    const value = token(req);
    const user = value ? await repository.session(hash(value)) : null;
    return user && (user.auth_mode === 'opaque-v1' || options.allowLegacyRegistration === true) ? user : null;
  }
  async function owner(req) {
    const user = await currentUser(req);
    if (!user) throw new CloudError(401, 'Sign in to access your encrypted vault.');
    if (req.headers['x-dose-owner'] !== user.id) throw new CloudError(401, 'The selected account changed. Sign in again before continuing.');
    return user;
  }
  function cookie(res, value = '') {
    res.setHeader('Set-Cookie', `${cookieName}=${value}; Path=/drug/; HttpOnly; SameSite=Strict; Max-Age=${value ? SESSION_SECONDS : 0}${config.secure ? '; Secure' : ''}`);
  }
  function newSession() {
    const value = randomBytes(32).toString('base64url');
    return { value, tokenHash: hash(value), expiresAt: Date.now() + SESSION_SECONDS * 1000 };
  }
  function guards(req) {
    // Heroku terminates TLS. This transport hint never supplies identity, origin, host or rate-limit keys.
    if (config.proxyMode === 'heroku' && req.headers['x-forwarded-proto'] !== 'https') throw new CloudError(403, 'Use the configured HTTPS address.');
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
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (config.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }
  async function body(req, maximum = 4096) {
    // Authentication may have awaited SQL while this connection was aborted.
    // Do not subscribe after the terminal stream events and wait forever.
    if (req.aborted || req.destroyed) throw new CloudError(400, 'The request was interrupted.');
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
  let opaque;
  try { opaque = await createOpaqueService({ repository, serverSetupOverride: options.opaqueServerSetup, work: hashWork, rateLimit, newSession, verifyLegacyPassword: passwordMatches }); }
  catch (error) { await repository.close(); throw error; }
  const compressedAssets = new Map();
  const server = createServer(async (req, res) => {
    headers(res);
    let completeOperation;
    try {
      guards(req);
      const path = new URL(req.url, config.origin).pathname;
      if (path === '/' && ['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(302, { Location: '/drug/' });
        return res.end();
      }
      if (build && ['/robots.txt', '/llms.txt'].includes(path) && ['GET', 'HEAD'].includes(req.method)) {
        const bytes = build.files.get(path.slice(1));
        if (!bytes) throw new CloudError(404, 'File not found.');
        res.writeHead(200, { 'Content-Type': MIME['.txt'], 'Content-Length': bytes.length });
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      }
      if (path === `${PREFIX}/edition` && req.method === 'GET') return send(res, 200, { edition: 'cloud' });
      if (path === `${PREFIX}/session` && req.method === 'GET') { const user = await currentUser(req); return send(res, 200, { user: user ? publicUser(user) : null }); }
      if (path === `${PREFIX}/security` && req.method === 'GET') {
        const user = await owner(req);
        return send(res, 200, { security: await repository.securityInfo(user.id, hash(token(req))) });
      }
      if (path.startsWith(`${PREFIX}/auth/opaque/`)) {
        const opaquePath = path.slice(`${PREFIX}/auth/opaque`.length);
        const large = ['/register/finish', '/recover/finish', '/change/finish', '/migrate/finish', '/rotate-recovery', '/recover/authorize'].includes(opaquePath);
        completeOperation = (large ? reserveVault : reserveAuth)(req, res);
        if (opaquePath.startsWith('/migrate/') && options.allowLegacyRegistration !== true) throw new CloudError(410, 'Older test accounts are no longer supported. Create a new account.');
        const authenticated = /^\/(reauth|change|migrate)\//.test(opaquePath) || opaquePath === '/rotate-recovery';
        const user = authenticated ? await owner(req) : undefined;
        const input = req.method === 'GET' ? undefined : await body(req, large ? VAULT_BODY_LIMIT : 16_384);
        const result = await opaque.handle({ path: opaquePath, method: req.method, input, source: rateSource(req, config.proxyMode), user, sessionHash: user ? hash(token(req)) : undefined });
        if (result.session) cookie(res, result.session.value);
        return send(res, result.status, result.body);
      }
      if (path === `${PREFIX}/auth/register` && req.method === 'POST') {
        // Only explicit synthetic legacy fixtures may use the former registration API.
        if (options.allowLegacyRegistration !== true) throw new CloudError(410, 'Use the current encrypted account registration.');
        completeOperation = reserveAuth(req, res);
        const input = await body(req);
        exactObject(input, ['username', 'password', ...(input && Object.hasOwn(input, 'name') ? ['name'] : [])]);
        const loginName = username(input.username); password(input.password, true);
        const name = input.name === undefined ? loginName : input.name;
        if (typeof name !== 'string' || !name.trim() || name.length > 100) invalid('Use a display name of 1–100 characters.');
        const source = rateSource(req, config.proxyMode);
        const encoded = await hashWork(async () => {
          await rateLimit('register', `source:${source}`);
          await newAccountPassword(input.password, loginName);
          if (await repository.accountByUsername(loginName)) throw new CloudError(409, 'Username is unavailable.');
          return passwordHash(input.password);
        });
        const user = { id: randomUUID(), name: name.trim() };
        const session = newSession();
        await repository.register({ ...user, username: loginName, password_hash: encoded }, session);
        cookie(res, session.value);
        return send(res, 201, { user: publicUser({ ...user, username: loginName, auth_mode: 'legacy-scrypt' }) });
      }
      if (path === `${PREFIX}/auth/login` && req.method === 'POST') {
        if (options.allowLegacyRegistration !== true) throw new CloudError(410, 'Use encrypted account sign in.');
        completeOperation = reserveAuth(req, res);
        const input = exactObject(await body(req), ['username', 'password']);
        const loginName = username(input.username); password(input.password);
        const account = await repository.accountByUsername(loginName);
        // Unknown names share a source bucket instead of creating unbounded arbitrary username rows.
        const subject = account ? `account:${loginName}` : `unknown-source:${rateSource(req, config.proxyMode)}`;
        const matches = await hashWork(async () => {
          await rateLimit('login', subject);
          return passwordMatches(input.password, account?.auth_mode === 'opaque-v1' ? dummyHash : account?.password_hash ?? dummyHash);
        });
        if (!matches || !account || account.auth_mode === 'opaque-v1') throw new CloudError(401, 'Username or account password is incorrect.');
        const session = newSession();
        const fresh = await repository.login(account, session);
        cookie(res, session.value);
        return send(res, 200, { user: publicUser(fresh) });
      }
      if (path === `${PREFIX}/auth/logout` && req.method === 'POST') {
        completeOperation = reserveAuth(req, res);
        const input = await body(req); exactObject(input, []);
        const user = await currentUser(req);
        if (user && req.headers['x-dose-owner'] && req.headers['x-dose-owner'] !== user.id) throw new CloudError(401, 'The selected account changed. Sign in again.');
        const value = token(req);
        if (value) await repository.logout(hash(value), req.headers['x-dose-owner']);
        cookie(res);
        return send(res, 200, { ok: true });
      }
      if (path === `${PREFIX}/account` && req.method === 'DELETE') {
        completeOperation = reserveAuth(req, res);
        const user = await owner(req);
        const rawInput = await body(req);
        if (user.auth_mode === 'opaque-v1') {
          await opaque.sensitive({ action: 'delete-account', input: rawInput, user, sessionHash: hash(token(req)), source: rateSource(req, config.proxyMode) });
          cookie(res); return send(res, 200, { ok: true });
        }
        if (options.allowLegacyRegistration !== true) throw new CloudError(410, 'Older test accounts are no longer supported.');
        const input = exactObject(rawInput, ['password']); password(input.password);
        const matches = await hashWork(async () => {
          await rateLimit('login', `account:${user.username}`);
          return passwordMatches(input.password, user.password_hash);
        });
        if (!matches) throw new CloudError(403, 'Account password is incorrect. Nothing was deleted.');
        if ((await owner(req)).id !== user.id) throw new CloudError(401, 'The account changed. Sign in again.');
        await repository.deleteAccount(user.id, hash(token(req)), user.password_hash);
        cookie(res);
        return send(res, 200, { ok: true });
      }
      if ([`${PREFIX}/auth/logout-all`, `${PREFIX}/auth/change-password`, `${PREFIX}/auth/verify-password`].includes(path) && req.method === 'POST') {
        completeOperation = reserveAuth(req, res);
        const user = await owner(req), changing = path.endsWith('/change-password');
        const rawInput = await body(req);
        if (user.auth_mode === 'opaque-v1') {
          if (path !== `${PREFIX}/auth/logout-all`) throw new CloudError(400, 'Use encrypted account authentication.');
          await opaque.sensitive({ action: 'logout-all', input: rawInput, user, sessionHash: hash(token(req)), source: rateSource(req, config.proxyMode) });
          cookie(res); return send(res, 200, { ok: true });
        }
        if (options.allowLegacyRegistration !== true) throw new CloudError(410, 'Older test accounts are no longer supported.');
        const input = exactObject(rawInput, changing ? ['currentPassword', 'newPassword'] : ['password']);
        const currentPassword = changing ? input.currentPassword : input.password;
        password(currentPassword);
        if (changing) {
          password(input.newPassword, true);
          if (input.newPassword === currentPassword) invalid('Choose a different new account password.');
        }
        const encoded = await hashWork(async () => {
          await rateLimit('login', `account:${user.username}`);
          if (!(await passwordMatches(currentPassword, user.password_hash))) throw new CloudError(403, 'Account password is incorrect. No account security settings changed.');
          if (changing) await newAccountPassword(input.newPassword, user.username);
          return changing ? passwordHash(input.newPassword) : null;
        });
        if ((await owner(req)).id !== user.id) throw new CloudError(401, 'The account changed. Sign in again.');
        if (path.endsWith('/verify-password')) {
          await repository.verifyPassword(user.id, hash(token(req)), user.password_hash);
          return send(res, 200, { ok: true });
        }
        if (!changing) {
          await repository.logoutAll(user.id, hash(token(req)), user.password_hash);
          cookie(res); return send(res, 200, { ok: true });
        }
        const replacement = newSession();
        const result = await repository.changePassword(user.id, hash(token(req)), user.password_hash, encoded, replacement);
        cookie(res, replacement.value);
        return send(res, 200, { user: publicUser(result.user), security: result.security });
      }
      if (path === `${PREFIX}/vault` && ['GET', 'PUT'].includes(req.method)) {
        const user = await owner(req);
        completeOperation = reserveVault(req, res);
        if (req.method === 'GET') return send(res, 200, { vault: await repository.readVault(user.id, hash(token(req))) });
        const input = await body(req, VAULT_BODY_LIMIT);
        // Recheck after asynchronous body reading; a logout or session expiry may have occurred.
        if ((await owner(req)).id !== user.id) throw new CloudError(401, 'The account changed. Sign in again.');
        return send(res, 200, { vault: await repository.writeVault(user.id, hash(token(req)), input) });
      }
      if (path === PREFIX || path.startsWith(`${PREFIX}/`)) throw new CloudError(404, 'This endpoint does not exist.');
      if (build && ['GET', 'HEAD'].includes(req.method)) {
        if (path === '/drug') { res.writeHead(308, { Location: '/drug/' }); return res.end(); }
        if (path.startsWith('/drug/')) {
          let relative;
          try { relative = decodeURIComponent(path.slice('/drug/'.length)); } catch { throw new CloudError(404, 'File not found.'); }
          if (relative.startsWith('/') || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => part === '.' || part === '..')) throw new CloudError(404, 'File not found.');
          if (build.legalPages.has(relative)) {
            const legalPage = build.legalPages.get(relative);
            res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
            res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': legalPage.length });
            return res.end(req.method === 'HEAD' ? undefined : legalPage);
          }
          let selected = relative || 'index.html';
          if (!build.files.has(selected)) {
            if (extname(relative) || relative.startsWith('assets/')) throw new CloudError(404, 'File not found.');
            selected = 'index.html';
          }
          const bytes = build.files.get(selected);
          // Only the captured edition-checked HTML and dedicated legal pages are served.
          if (extname(selected) === '.html' && selected !== 'index.html') throw new CloudError(404, 'File not found.');
          let payload = bytes;
          const asset = relative.startsWith('assets/') && /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(relative);
          if (asset) {
            // Only public, content-addressed build assets may be cached or compressed.
            // HTML, API responses and encrypted records always retain no-store.
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            const gzip = (req.headers['accept-encoding'] ?? '').split(',').some(value => {
              const [encoding, ...parameters] = value.trim().split(';');
              const quality = parameters.map(part => part.trim()).find(part => part.startsWith('q='));
              return encoding === 'gzip' && (quality === undefined || Number(quality.slice(2)) > 0);
            });
            if (['.js', '.css', '.svg', '.json'].includes(extname(selected))) {
              res.setHeader('Vary', 'Accept-Encoding');
              if (gzip) {
                if (!compressedAssets.has(selected)) compressedAssets.set(selected, gzipSync(bytes));
                payload = compressedAssets.get(selected); res.setHeader('Content-Encoding', 'gzip');
              }
            }
          }
          res.writeHead(200, { 'Content-Type': MIME[extname(selected)] ?? 'application/octet-stream', 'Content-Length': payload.length });
          return res.end(req.method === 'HEAD' ? undefined : payload);
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
    } finally { completeOperation?.(); }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = config.proxyMode === 'heroku' ? 95_000 : 5_000;
  let closing;
  function closeStorage() { if (!closed) { closed = true; closing = Promise.resolve(repository.close()); } return closing; }
  server.on('close', () => { closeStorage().catch(() => {}); });
  return { server, closeStorage, edition: 'cloud' };
}

async function cli() {
  const command = process.argv[2] ?? 'start';
  if (process.argv.length > 3 || command !== 'start') invalid('Use cloud.mjs start, then register securely in the webpage. CLI account bootstrap is disabled; never pass a password as an argument.');
  const dbPath = process.env.CLOUD_DB_PATH;
  if (process.env.CLOUD_ADMIN_PASSWORD) invalid('Remove CLOUD_ADMIN_PASSWORD before starting. Accounts register securely in the webpage.');
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
