import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, chmodSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedupeFavorites, favoriteKey } from '../src/lib/favorites.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scryptAsync = promisify(scrypt);
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const BODY_LIMIT = 1024 * 1024;
const IMPORT_LIMIT = 16 * 1024 * 1024;
const COOKIE = 'dose_session';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const publicUser = (user) => ({ id: user.id, email: user.email, name: user.name });
const SYMPTOM_IDS = ['headache', 'low-appetite', 'nausea', 'dry-mouth', 'sleep-trouble', 'anxiety', 'palpitations', 'other', 'none'];

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const bad = (message) => { throw new ApiError(400, message); };

function textField(value, field, max = 200, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) bad(`Invalid ${field}.`);
  return value;
}

function decimal(value, field) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,9})?$/.test(value) || Number(value) <= 0) {
    bad(`${field} must be a positive decimal string with an explicit unit.`);
  }
  return value;
}

function validatePackageStrength(value, first) {
  textField(value, 'package strength', 100);
  const components = value.split('/');
  if (components.length > 10) bad('Too many package strength components.');
  for (const component of components) decimal(component, 'Package strength component');
  if (favoriteKey({ productId: 'package', strength: components[0] }) !== favoriteKey({ productId: 'package', strength: first })) bad('Package strength must match its first strength component.');
}

function zone(value) {
  textField(value, 'time zone', 80);
  if (/^[+-]/.test(value)) bad('Use an IANA time zone.');
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); }
  catch { bad('Use a valid IANA time zone.'); }
  return value;
}

function instant(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) bad(`${field} must be an ISO UTC instant.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) bad(`Invalid ${field}.`);
}

function calendarDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) bad(`Invalid ${field}.`);
  instant(`${value}T00:00:00Z`, field);
}

function localDate(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type) => parts.find(item => item.type === type).value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

function jsonShape(value, depth = 0) {
  if (depth > 16) bad('Data is too deeply nested.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { if (value.length > 16000) bad('Text is too long.'); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) bad('Invalid number.'); return; }
  if (Array.isArray(value)) {
    if (value.length > 50000) bad('Too many items.');
    value.forEach((item) => jsonShape(item, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object') bad('Expected JSON data.');
  const entries = Object.entries(value);
  if (entries.length > 1000) bad('Too many fields.');
  for (const [key, child] of entries) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) bad('Invalid field name.');
    jsonShape(child, depth + 1);
  }
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('Expected a JSON object.');
  jsonShape(value);
  return value;
}

function validate(kind, id, data) {
  object(data);
  if (data.id !== undefined && data.id !== id) bad('The record ID cannot change.');
  if (data.revision !== undefined && (!Number.isSafeInteger(data.revision) || data.revision < 0)) bad('Invalid revision.');
  const { revision, createdAt, updatedAt, deleted, ownerId, owner_id, ...payload } = data;
  payload.id = id;
  if (kind === 'profile') {
    if (payload.name !== undefined) textField(payload.name, 'name', 100, false);
    zone(payload.timeZone);
    if (!['12h', '24h'].includes(payload.timeFormat)) bad('Choose a 12h or 24h time format.');
    if (payload.timeIncrementMinutes !== undefined && ![1, 5, 10].includes(payload.timeIncrementMinutes)) bad('Choose a 1, 5 or 10 minute time increment.');
    for (const field of ['sleepEnabled', 'weekendEnabled', 'plannedDoseConfirmation']) {
      if (payload[field] !== undefined && typeof payload[field] !== 'boolean') bad(`Invalid ${field}.`);
    }
    for (const field of ['bedtime', 'wakeTime', 'weekendBedtime', 'weekendWakeTime']) {
      if (payload[field] !== undefined && payload[field] !== '' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(payload[field])) bad(`Invalid ${field}.`);
    }
    if (payload.sleepEnabled && (!payload.bedtime || !payload.wakeTime || payload.bedtime === payload.wakeTime)) {
      bad('Choose distinct bedtime and wake time, or turn off the sleep schedule.');
    }
    if (payload.sleepEnabled && payload.weekendEnabled && (!payload.weekendBedtime || !payload.weekendWakeTime || payload.weekendBedtime === payload.weekendWakeTime)) {
      bad('Choose distinct weekend bedtime and wake time.');
    }
  }
  if (kind === 'doses') {
    for (const field of ['productId', 'productName', 'formulation', 'unit']) textField(payload[field], field, 240);
    decimal(payload.strength, 'Strength');
    decimal(payload.quantity, 'Quantity');
    decimal(payload.amountMg, 'Amount');
    if (payload.packageStrength !== undefined) validatePackageStrength(payload.packageStrength, payload.strength);
    instant(payload.administeredAt, 'Administration time');
    zone(payload.timeZone);
    if (!['actual', 'planned', 'skipped'].includes(payload.status)) bad('Choose actual, planned, or skipped status.');
    if (payload.note !== undefined) textField(payload.note, 'note', 8000, false);
    for (const field of ['removalAt', 'removedAt']) {
      if (!payload[field]) continue;
      instant(payload[field], 'Removal time');
      if (Date.parse(payload[field]) <= Date.parse(payload.administeredAt)) bad('Removal must be after application.');
    }
    if (payload.removalAt && payload.removedAt && Date.parse(payload.removalAt) !== Date.parse(payload.removedAt)) bad('Provide one consistent patch removal time.');
    if (payload.ingredients !== undefined) {
      if (!Array.isArray(payload.ingredients) || payload.ingredients.length > 10) bad('Invalid ingredient amounts.');
      for (const ingredient of payload.ingredients) {
        object(ingredient);
        for (const field of ['amountMg', 'strengthMg', 'amount']) {
          if (ingredient[field] !== undefined) decimal(ingredient[field], `Ingredient ${field}`);
        }
      }
    }
  }
  if (kind === 'scenarios') {
    if (payload.name !== undefined) textField(payload.name, 'scenario name', 150, false);
    const rows = payload.rows ?? payload.doses;
    if (!Array.isArray(rows) || rows.length > 500) bad('Scenarios need a list of up to 500 dose rows.');
    const seen = new Set();
    for (const row of rows) {
      object(row);
      if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id) || seen.has(row.id)) bad('Scenario rows need unique stable IDs.');
      seen.add(row.id);
    }
    if (payload.version !== undefined && typeof payload.version !== 'string' && !Number.isSafeInteger(payload.version)) bad('Invalid scenario version.');
    if (payload.view !== undefined) {
      const view = object(payload.view);
      if (typeof view.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(view.date)) bad('Invalid scenario view date.');
      instant(`${view.date}T00:00:00Z`, 'Scenario view date');
      if (![1, 2, 3].includes(view.days)) bad('Choose 1, 2, or 3 days for the scenario view.');
      zone(view.timeZone);
      if (typeof view.publishedOnly !== 'boolean') bad('Scenario published-only setting must be true or false.');
    }
  }
  if (kind === 'favorites') {
    textField(payload.productId, 'product', 240);
    decimal(payload.strength, 'Strength');
    decimal(payload.quantity, 'Quantity');
    if (payload.packageStrength !== undefined) {
      validatePackageStrength(payload.packageStrength, payload.strength);
    }
  }
  if (kind === 'checkins') {
    if (payload.note !== undefined) textField(payload.note, 'note', 8000, false);
    if (payload.date !== undefined) calendarDate(payload.date, 'check-in date');
    for (const field of ['focus', 'sleepQuality']) if (payload[field] !== undefined) textField(payload[field], field, 80, false);
    if (payload.timeZone !== undefined) zone(payload.timeZone);
    if (payload.recordedAt !== undefined) instant(payload.recordedAt, 'Check-in time');
    if (payload.symptoms !== undefined) {
      if (!Array.isArray(payload.symptoms) || !payload.symptoms.length || payload.symptoms.length > SYMPTOM_IDS.length
        || payload.symptoms.some(id => !SYMPTOM_IDS.includes(id)) || new Set(payload.symptoms).size !== payload.symptoms.length) bad('Choose one or more valid symptom tags without duplicates.');
      if (payload.symptoms.includes('none') && payload.symptoms.length !== 1) bad('No discomfort cannot be combined with a symptom.');
      instant(payload.recordedAt, 'Check-in time');
      zone(payload.timeZone);
      calendarDate(payload.date, 'check-in date');
      if (payload.date !== localDate(payload.recordedAt, payload.timeZone)) bad('The check-in date must match its recorded time and original time zone.');
    }
  }
  if (kind === 'inventory') {
    for (const field of ['productId', 'productName', 'unit', 'strengthUnit']) textField(payload[field], field, 240);
    textField(payload.packageStrength, 'package strength', 100);
    const components = payload.packageStrength.split('/');
    if (components.length > 10) bad('Too many package strength components.');
    for (const component of components) decimal(component, 'Package strength component');
    decimal(payload.quantity, 'Received quantity');
    instant(payload.receivedAt, 'Receipt time');
    zone(payload.timeZone);
    if (payload.note !== undefined) textField(payload.note, 'note', 8000, false);
  }
  return { payload, expectedRevision: revision };
}

// Sorting object keys makes retries independent of JSON property order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt}$${key.toString('hex')}`;
}

async function passwordMatches(password, encoded) {
  const [, N, r, p, salt, stored] = encoded.split('$');
  const key = await scryptAsync(password, salt, 64, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(stored, 'hex');
  return expected.length === key.length && timingSafeEqual(key, expected);
}

function credentials(data, newPassword = false) {
  object(data);
  const email = textField(data.email, 'email', 254).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('Enter a valid email address.');
  textField(data.password, 'password', 256);
  if (newPassword && data.password.length < 10) bad('Use at least 10 characters for your password.');
  return email;
}

function localPassword(data, newPassword = false) {
  object(data);
  textField(data.password, 'password', 256);
  if (newPassword && data.password.length < 10) bad('Use at least 10 characters for your password.');
}

function readJson(req, optional = false, limit = BODY_LIMIT) {
  return new Promise((accept, reject) => {
    const type = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
    if (type !== 'application/json' && !(optional && !req.headers['content-length'] && !req.headers['transfer-encoding'])) {
      req.resume();
      reject(new ApiError(415, 'Send application/json.'));
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > limit) return reject(new ApiError(413, 'Request is too large.'));
      try {
        if (!size && optional) return accept({});
        accept(object(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      } catch (error) { reject(error instanceof ApiError ? error : new ApiError(400, 'Invalid JSON.')); }
    });
    req.on('error', reject);
  });
}

const ENTITY_KINDS = ['profile', 'doses', 'scenarios', 'favorites', 'checkins', 'inventory'];
function importId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) bad('Invalid backup record ID.');
  return value;
}
function importRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) bad('Invalid backup revision.');
  return value;
}

/** Validate the complete archive before touching the database. */
function prepareImport(backup, owner) {
  object(backup);
  if (backup.format !== 'dose-timeline-backup' || backup.schemaVersion !== 1) bad('Unsupported backup format or schema version.');
  instant(backup.exportedAt, 'Backup export time');
  object(backup.data);
  const full = backup.revisions !== undefined || backup.tombstones !== undefined;
  if (full && (!Array.isArray(backup.revisions) || !Array.isArray(backup.tombstones))) bad('A full backup must contain both revision history and deletion tombstones.');
  const manifest = new Map();
  const histories = new Map();
  const keyOf = (kind, id) => `${kind}:${id}`;
  const targetId = (kind, id) => { importId(id); return kind === 'profile' ? owner : id; };
  const kindOf = (value) => { if (!ENTITY_KINDS.includes(value)) bad('Invalid backup record kind.'); return value; };
  const normalize = (kind, id, value) => {
    object(value);
    if (value.id !== undefined && value.id !== id) bad('A backup payload has a different record ID.');
    const target = targetId(kind, id);
    const { payload } = validate(kind, target, { ...value, id: target });
    if (kind === 'favorites') {
      decimal(payload.strength, 'Favorite strength');
      decimal(payload.quantity, 'Favorite quantity');
    }
    if (kind === 'checkins') {
      // Legacy check-ins may store either a calendar date or a timestamp and
      // original zone. Keep those snapshots; do not infer symptom-free days.
      if (payload.date === undefined && (!payload.recordedAt || !payload.timeZone)) bad('A backup check-in needs a date or a recorded time with its original time zone.');
    }
    if (kind === 'doses') {
      const ingredients = new Set();
      for (const ingredient of payload.ingredients || []) {
        textField(ingredient.name, 'ingredient name', 240);
        if (ingredients.has(ingredient.name)) bad('A backup dose lists an ingredient more than once.');
        ingredients.add(ingredient.name);
      }
    }
    return canonical(payload);
  };
  const addLive = (kind, value) => {
    object(value);
    const originalId = kind === 'profile' ? (value.id ?? backup.user?.id ?? owner) : value.id;
    const id = targetId(kind, originalId);
    const key = keyOf(kind, id);
    if (manifest.has(key)) bad('The backup contains duplicate live record IDs.');
    if (value.deleted === true) bad('Deleted records must be represented by tombstones.');
    const payload = normalize(kind, originalId, value);
    const createdAt = value.createdAt ?? backup.exportedAt;
    const updatedAt = value.updatedAt ?? backup.exportedAt;
    instant(createdAt, 'Record creation time');
    instant(updatedAt, 'Record update time');
    const revision = full ? importRevision(value.revision) : 1;
    manifest.set(key, { kind, id, payload, revision, deleted: 0, createdAt, updatedAt, revisions: full ? [] : [{ revision: 1, payload, deleted: 0, recordedAt: updatedAt }] });
  };
  if (backup.data.profile !== null) addLive('profile', backup.data.profile);
  for (const kind of ENTITY_KINDS.filter((kind) => kind !== 'profile')) {
    const rows = kind === 'inventory' ? backup.data.inventory ?? [] : backup.data[kind];
    if (!Array.isArray(rows) || rows.length > 50000) bad(`Invalid backup ${kind} list.`);
    for (const row of rows) addLive(kind, row);
  }
  if (!full) return { records: [...manifest.values()], full: false };
  for (const row of backup.revisions) {
    object(row);
    const kind = kindOf(row.kind);
    const id = targetId(kind, row.id);
    const key = keyOf(kind, id);
    const revision = importRevision(row.revision);
    if (typeof row.deleted !== 'boolean') bad('Invalid revision deletion state.');
    instant(row.recordedAt, 'Revision timestamp');
    const payload = normalize(kind, row.id, row.data);
    const history = histories.get(key) || [];
    if (history.some((item) => item.revision === revision)) bad('The backup contains duplicate revisions.');
    history.push({ revision, payload, deleted: row.deleted ? 1 : 0, recordedAt: row.recordedAt });
    histories.set(key, history);
  }
  for (const tombstone of backup.tombstones) {
    object(tombstone);
    const kind = kindOf(tombstone.kind);
    const id = targetId(kind, tombstone.id);
    const key = keyOf(kind, id);
    if (manifest.has(key)) bad('A backup ID is both live and deleted, or has duplicate tombstones.');
    const revision = importRevision(tombstone.revision);
    instant(tombstone.deletedAt, 'Deletion timestamp');
    const history = histories.get(key);
    if (!history?.length) bad('A tombstone is missing its preserved revision history.');
    const sorted = [...history].sort((a, b) => a.revision - b.revision);
    manifest.set(key, { kind, id, payload: sorted.at(-1).payload, revision, deleted: 1, createdAt: sorted[0].recordedAt, updatedAt: tombstone.deletedAt, revisions: [] });
  }
  for (const [key, history] of histories) {
    const record = manifest.get(key);
    if (!record) bad('Revision history has no corresponding live record or tombstone.');
    history.sort((a, b) => a.revision - b.revision);
    for (let i = 0; i < history.length; i++) {
      if (history[i].revision !== i + 1) bad('A full backup must preserve every revision in sequence.');
      if (i < history.length - 1 && history[i].deleted) bad('A deleted record cannot have later live revisions.');
    }
    const last = history.at(-1);
    if (last.revision !== record.revision || last.deleted !== record.deleted || last.payload !== record.payload || Date.parse(last.recordedAt) !== Date.parse(record.updatedAt)) {
      bad('The latest backup revision does not match its live record or tombstone.');
    }
    record.revisions = history;
  }
  for (const record of manifest.values()) if (!record.revisions.length) bad('A live record is missing its revision history.');
  return { records: [...manifest.values()], full: true };
}

export async function createDoseServer({ dbPath = process.env.DOSE_DB_PATH || join(ROOT, 'data', 'dose-timeline.sqlite'), port = Number(process.env.PORT || 4310) } = {}) {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  if (dbPath !== ':memory:') chmodSync(dbPath, 0o600);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const deadline = performance.now() + 5000;
    for (;;) {
      try {
        // A later attempt must not receive another full five-second lock wait.
        const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
        db.exec(`PRAGMA busy_timeout = ${remaining}; PRAGMA journal_mode = WAL;`);
        db.exec('PRAGMA busy_timeout = 5000;');
        break;
      }
      catch (error) {
        // Simultaneous openers can receive SQLITE_BUSY during the journal-mode
        // transition even with a busy handler. Retry only this startup step.
        const remaining = deadline - performance.now();
        if (error.errcode !== 5 || remaining <= 0) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(25, remaining)));
      }
    }
  } catch (error) { db.close(); throw error; }
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT');
  const migrationDir = join(ROOT, 'server', 'migrations');
  for (const version of readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      // Another process may finish this migration while we wait for the lock.
      if (!db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version)) {
        db.exec(readFileSync(join(migrationDir, version), 'utf8'));
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(version, now());
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  const dummyHash = await passwordHash(randomBytes(32).toString('hex'));
  const attempts = new Map();
  function rateLimit(req) {
    const key = req.socket.remoteAddress || 'local';
    const time = Date.now();
    let entry = attempts.get(key);
    if (!entry || entry.until < time) { entry = { count: 0, until: time + 15 * 60 * 1000 }; attempts.set(key, entry); }
    entry.count += 1;
    if (entry.count > 40) throw new ApiError(429, 'Too many account attempts. Please wait 15 minutes.');
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function sessionToken(req) {
    return req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  }
  function findUser(req) {
    const token = sessionToken(req);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return db.prepare('SELECT users.* FROM users JOIN sessions ON users.id = sessions.owner_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').get(hash(token), Date.now()) || null;
  }
  function requireUser(req) {
    const user = findUser(req);
    if (!user) throw new ApiError(401, 'Sign in to save and access your records.');
    if (req.headers['x-dose-owner'] && req.headers['x-dose-owner'] !== user.id) {
      throw new ApiError(401, 'The active account changed. Sign in to the account that owns these records before continuing.');
    }
    return user;
  }
  function authenticatedTransaction(req, expectedOwner, operation) {
    return transaction(() => {
      // A different local process may revoke this session while BEGIN waits for
      // its write lock. Preserve the selected owner and check inside the lock.
      if (requireUser(req).id !== expectedOwner) throw new ApiError(401, 'The active account changed. Sign in again before continuing.');
      return operation();
    });
  }
  function cookie(res, token = '') {
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? SESSION_SECONDS : 0}`);
  }
  function startSession(res, user) {
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(hash(token), user.id, Date.now() + SESSION_SECONDS * 1000, now());
    cookie(res, token);
  }
  function localState() {
    const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    return { hasAccount: count > 0, requiresEmail: count > 1 };
  }
  function singleLocalUser() {
    const users = db.prepare('SELECT * FROM users LIMIT 2').all();
    if (!users.length) throw new ApiError(404, 'Set up a password on this Mac first.');
    if (users.length > 1) throw new ApiError(409, 'This Mac has multiple accounts. Use your email and password to choose the correct account.', { requiresEmail: true });
    return users[0];
  }
  async function recoverAccount(user, body, res, local = false) {
    textField(body.recoveryCode, 'recovery code', 100);
    const actual = Buffer.from(hash(body.recoveryCode.trim()), 'hex');
    const expected = Buffer.from(user?.recovery_hash || hash('missing-account'), 'hex');
    if (!timingSafeEqual(actual, expected) || !user) throw new ApiError(401, local ? 'Recovery code is incorrect.' : 'Email or recovery code is incorrect.');
    const encoded = await passwordHash(body.password);
    const recoveryCode = randomBytes(24).toString('base64url');
    transaction(() => {
      // Compare again after asynchronous hashing: the code is one-use, and a
      // newly added legacy account must make password-only selection stop.
      if (local && singleLocalUser().id !== user.id) throw new ApiError(401, 'The local account changed. Try again.');
      const fresh = db.prepare('SELECT recovery_hash FROM users WHERE id = ?').get(user.id);
      if (!fresh || fresh.recovery_hash !== user.recovery_hash) throw new ApiError(401, 'This recovery code has already been used.');
      db.prepare('UPDATE users SET password_hash = ?, recovery_hash = ? WHERE id = ?').run(encoded, hash(recoveryCode), user.id);
      db.prepare('DELETE FROM sessions WHERE owner_id = ?').run(user.id);
      startSession(res, user);
    });
    return { user: publicUser(user), recoveryCode };
  }
  function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  function record(row) {
    return { ...JSON.parse(row.payload), id: row.id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.deleted ? { deleted: true } : {}) };
  }
  function cleanupFavorites(owner, preferredIds = new Set()) {
    const rows = owner
      ? db.prepare("SELECT * FROM entities WHERE kind = 'favorites' AND owner_id = ? AND deleted = 0").all(owner)
      : db.prepare("SELECT * FROM entities WHERE kind = 'favorites' AND deleted = 0").all();
    const owners = new Map();
    for (const row of rows) owners.set(row.owner_id, [...(owners.get(row.owner_id) || []), row]);
    for (const owned of owners.values()) {
      const winners = dedupeFavorites(owned.map(record), preferredIds);
      const ids = new Set(winners.map(item => item.id));
      const byKey = new Map();
      for (const winner of winners) { try { byKey.set(favoriteKey(winner), winner); } catch { /* Keep unresolved legacy records separately. */ } }
      for (const row of owned) {
        if (ids.has(row.id)) continue;
        const target = byKey.get(favoriteKey(record(row)));
        const timestamp = now(), revision = row.revision + 1;
        const payload = canonical({ ...JSON.parse(row.payload), deduplicatedInto: target.id });
        db.prepare('UPDATE entities SET payload = ?, revision = ?, deleted = 1, updated_at = ? WHERE kind = ? AND id = ?').run(payload, revision, timestamp, 'favorites', row.id);
        db.prepare('INSERT INTO entity_revisions VALUES (?,?,?,?,?,1,?)').run('favorites', row.id, row.owner_id, revision, payload, timestamp);
      }
    }
  }
  function dataFor(owner) {
    const result = { profile: null, doses: [], scenarios: [], favorites: [], checkins: [], inventory: [] };
    for (const row of db.prepare('SELECT * FROM entities WHERE owner_id = ? AND deleted = 0 ORDER BY created_at, id').all(owner)) {
      if (row.kind === 'profile') result.profile = record(row);
      else result[row.kind].push(record(row));
    }
    return result;
  }
  function getEntity(kind, id, owner) {
    const row = db.prepare('SELECT * FROM entities WHERE kind = ? AND id = ?').get(kind, id);
    if (row && row.owner_id !== owner) throw new ApiError(404, 'Record not found.');
    return row;
  }
  function putEntity(kind, id, owner, data, req) {
    const { payload, expectedRevision } = validate(kind, id, data);
    const encoded = canonical(payload);
    return authenticatedTransaction(req, owner, () => {
      if (kind === 'favorites') cleanupFavorites(owner);
      const row = getEntity(kind, id, owner);
      if (kind === 'favorites' && row?.deleted) {
        const { deduplicatedInto, ...original } = JSON.parse(row.payload);
        if (deduplicatedInto && canonical(original) === encoded) {
          const target = getEntity('favorites', deduplicatedInto, owner);
          if (target && !target.deleted && favoriteKey(record(target)) === favoriteKey(payload)) return record(target);
        }
      }
      if (row?.deleted) throw new ApiError(409, 'This record was deleted. Create a new record to restore it.', { current: record(row) });
      if (row?.payload === encoded) return record(row);
      if (row && expectedRevision !== row.revision) throw new ApiError(409, 'This record changed. Review the latest version before saving.', { current: record(row) });
      if (!row && expectedRevision !== undefined && expectedRevision !== 0) throw new ApiError(409, 'This record does not exist at the supplied revision.');
      if (kind === 'favorites') {
        const duplicate = db.prepare("SELECT * FROM entities WHERE kind = 'favorites' AND owner_id = ? AND deleted = 0 AND id != ?").all(owner, id)
          .find(existing => { try { return favoriteKey(record(existing)) === favoriteKey(payload); } catch { return false; } });
        if (duplicate) {
          if (row) throw new ApiError(409, 'This medication and strength is already saved. Use the existing favorite.', { current: record(duplicate) });
          // Preserve the request ID as a deleted alias. Its late retries cannot
          // recreate the selection after the canonical favorite is removed.
          const timestamp = now(), alias = canonical({ ...payload, deduplicatedInto: duplicate.id });
          db.prepare('INSERT INTO entities VALUES (?,?,?,?,1,1,?,?)').run('favorites', id, owner, alias, timestamp, timestamp);
          db.prepare('INSERT INTO entity_revisions VALUES (?,?,?,1,?,1,?)').run('favorites', id, owner, alias, timestamp);
          return record(duplicate);
        }
      }
      const timestamp = now();
      const revision = (row?.revision ?? 0) + 1;
      db.prepare('INSERT INTO entities (kind,id,owner_id,payload,revision,deleted,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload, revision=excluded.revision, updated_at=excluded.updated_at').run(kind, id, owner, encoded, revision, row?.created_at ?? timestamp, timestamp);
      db.prepare('INSERT INTO entity_revisions VALUES (?,?,?,?,?,0,?)').run(kind, id, owner, revision, encoded, timestamp);
      return record(getEntity(kind, id, owner));
    });
  }
  function deleteEntity(kind, id, owner, data, req) {
    return authenticatedTransaction(req, owner, () => {
      if (kind === 'favorites') cleanupFavorites(owner);
      const row = getEntity(kind, id, owner);
      if (!row) throw new ApiError(404, 'Record not found.');
      if (row.deleted) return { id, revision: row.revision, deleted: true };
      if (data.revision !== row.revision) throw new ApiError(409, 'This record changed. Review the latest version before deleting.', { current: record(row) });
      const timestamp = now();
      const revision = row.revision + 1;
      db.prepare('UPDATE entities SET revision = ?, deleted = 1, updated_at = ? WHERE kind = ? AND id = ? AND owner_id = ?').run(revision, timestamp, kind, id, owner);
      db.prepare('INSERT INTO entity_revisions VALUES (?,?,?,?,?,1,?)').run(kind, id, owner, revision, row.payload, timestamp);
      return { id, revision, deleted: true };
    });
  }

  transaction(() => cleanupFavorites());

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const livePort = server.address()?.port || port;
      const hosts = new Set([`localhost:${livePort}`, `127.0.0.1:${livePort}`, 'localhost:5173', '127.0.0.1:5173']);
      if (!hosts.has(req.headers.host)) throw new ApiError(403, 'Only the local application can access this server.');
      if (req.headers.origin && ![...hosts].map((host) => `http://${host}`).includes(req.headers.origin)) throw new ApiError(403, 'Untrusted request origin.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'Cross-site requests are not accepted.');
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname === '/drug' ? '/' : url.pathname.startsWith('/drug/') ? url.pathname.slice(5) : url.pathname;
      const method = req.method;
      if (path === '/api/health' && method === 'GET') return send(res, 200, { ok: true, storage: 'local-sqlite', schemaVersion: 2 });
      if (path === '/api/session' && method === 'GET') {
        const user = findUser(req);
        return send(res, 200, { user: user ? publicUser(user) : null });
      }
      if (path === '/api/auth/local-state' && method === 'GET') return send(res, 200, localState());
      if (path === '/api/auth/local-setup' && method === 'POST') {
        rateLimit(req);
        const body = await readJson(req);
        localPassword(body, true);
        const name = body.name === undefined ? '' : textField(body.name, 'name', 100, false).trim();
        if (localState().hasAccount) throw new ApiError(409, 'This Mac already has an account. Unlock it instead.', localState());
        const encoded = await passwordHash(body.password);
        const recoveryCode = randomBytes(24).toString('base64url');
        const user = { id: randomUUID(), email: `local-${randomUUID()}@device.invalid`, name };
        transaction(() => {
          // Do not create a second account if another setup won while hashing.
          const state = localState();
          if (state.hasAccount) throw new ApiError(409, 'This Mac already has an account. Unlock it instead.', state);
          db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(user.id, user.email, name, encoded, hash(recoveryCode), now());
          startSession(res, user);
        });
        return send(res, 201, { user: publicUser(user), recoveryCode });
      }
      if (path === '/api/auth/local-unlock' && method === 'POST') {
        rateLimit(req);
        const body = await readJson(req);
        localPassword(body);
        const user = singleLocalUser();
        if (!(await passwordMatches(body.password, user.password_hash))) throw new ApiError(401, 'Password is incorrect.');
        transaction(() => {
          const fresh = singleLocalUser();
          if (fresh.id !== user.id || fresh.password_hash !== user.password_hash) throw new ApiError(401, 'Password is incorrect.');
          startSession(res, user);
        });
        return send(res, 200, { user: publicUser(user) });
      }
      if (path === '/api/auth/local-recover' && method === 'POST') {
        rateLimit(req);
        const body = await readJson(req);
        localPassword(body, true);
        return send(res, 200, await recoverAccount(singleLocalUser(), body, res, true));
      }
      if (path === '/api/auth/register' && method === 'POST') {
        rateLimit(req);
        const body = await readJson(req);
        const email = credentials(body, true);
        const name = body.name === undefined ? '' : textField(body.name, 'name', 100, false).trim();
        if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new ApiError(409, 'An account with that email already exists on this Mac.');
        const encoded = await passwordHash(body.password);
        const recoveryCode = randomBytes(24).toString('base64url');
        const user = { id: randomUUID(), email, name };
        try { db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(user.id, email, name, encoded, hash(recoveryCode), now()); }
        catch (error) { if (error.code?.startsWith('ERR_SQLITE')) throw new ApiError(409, 'An account with that email already exists on this Mac.'); throw error; }
        startSession(res, user);
        return send(res, 201, { user: publicUser(user), recoveryCode });
      }
      if (path === '/api/auth/login' && method === 'POST') {
        rateLimit(req);
        const body = await readJson(req);
        const email = credentials(body);
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        const matches = await passwordMatches(body.password, user?.password_hash || dummyHash);
        if (!user || !matches) throw new ApiError(401, 'Email or password is incorrect.');
        // Credential verification yields to other requests. A password reset
        // or account deletion must invalidate this earlier password snapshot.
        transaction(() => {
          const fresh = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
          if (!fresh || fresh.password_hash !== user.password_hash) throw new ApiError(401, 'Email or password is incorrect.');
          startSession(res, user);
        });
        return send(res, 200, { user: publicUser(user) });
      }
      if (path === '/api/auth/recover' && method === 'POST') {
        rateLimit(req);
        const body = await readJson(req);
        const email = credentials(body, true);
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        return send(res, 200, await recoverAccount(user, body, res));
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        await readJson(req, true);
        const token = sessionToken(req);
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
        cookie(res);
        return send(res, 200, { ok: true });
      }
      if (path.startsWith('/api/')) {
        const user = requireUser(req);
        if (path === '/api/data' && method === 'GET') return send(res, 200, authenticatedTransaction(req, user.id, () => { cleanupFavorites(user.id); return dataFor(user.id); }));
        if (path === '/api/import' && method === 'POST') {
          const body = await readJson(req, false, IMPORT_LIMIT);
          requireUser(req);
          if (!['merge', 'replace'].includes(body.mode)) bad('Choose merge or replace for the import.');
          const prepared = prepareImport(body.backup, user.id);
          const result = authenticatedTransaction(req, user.id, () => {
            // Check every destination before deleting anything in replace mode.
            // Foreign-owned IDs are never treated as attachable records.
            for (const record of prepared.records) getEntity(record.kind, record.id, user.id);
            const preferredFavorites = new Set(body.mode === 'merge' ? db.prepare("SELECT id FROM entities WHERE kind = 'favorites' AND owner_id = ? AND deleted = 0").all(user.id).map(row => row.id) : []);
            if (body.mode === 'replace') db.prepare('DELETE FROM entities WHERE owner_id = ?').run(user.id);
            let imported = 0;
            let skipped = 0;
            for (const record of prepared.records) {
              if (getEntity(record.kind, record.id, user.id)) { skipped += 1; continue; }
              db.prepare('INSERT INTO entities (kind,id,owner_id,payload,revision,deleted,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(record.kind, record.id, user.id, record.payload, record.revision, record.deleted, record.createdAt, record.updatedAt);
              for (const revision of record.revisions) db.prepare('INSERT INTO entity_revisions VALUES (?,?,?,?,?,?,?)').run(record.kind, record.id, user.id, revision.revision, revision.payload, revision.deleted, revision.recordedAt);
              imported += 1;
            }
            cleanupFavorites(user.id, preferredFavorites);
            return { data: dataFor(user.id), imported, skipped, fullHistory: prepared.full };
          });
          return send(res, 200, result);
        }
        if (path === '/api/export' && method === 'GET') {
          const snapshot = authenticatedTransaction(req, user.id, () => { cleanupFavorites(user.id); return ({
            format: 'dose-timeline-backup', schemaVersion: 1, exportedAt: now(), user: publicUser(user),
            data: dataFor(user.id),
            revisions: db.prepare('SELECT * FROM entity_revisions WHERE owner_id = ? ORDER BY kind,entity_id,revision').all(user.id).map((row) => ({ kind: row.kind, id: row.entity_id, revision: row.revision, data: JSON.parse(row.payload), deleted: Boolean(row.deleted), recordedAt: row.recorded_at })),
            tombstones: db.prepare('SELECT * FROM entities WHERE owner_id = ? AND deleted = 1').all(user.id).map((row) => ({ kind: row.kind, id: row.id, revision: row.revision, deletedAt: row.updated_at })),
            disclosure: 'Local records only. No record does not prove no dose. The backup includes correction history and deleted-record content retained in revisions. Store it privately.',
          }); });
          return send(res, 200, snapshot);
        }
        if (path === '/api/account' && method === 'DELETE') {
          rateLimit(req);
          const body = await readJson(req);
          textField(body.password, 'password', 256);
          if (!(await passwordMatches(body.password, user.password_hash))) throw new ApiError(401, 'Password is incorrect.');
          // A concurrently reset password invalidates confirmation from an old session.
          authenticatedTransaction(req, user.id, () => {
            const fresh = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
            if (!fresh || fresh.password_hash !== user.password_hash) throw new ApiError(401, 'Sign in again before deleting this account.');
            db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
          });
          cookie(res);
          return send(res, 200, { ok: true });
        }
        if (path === '/api/profile' && method === 'PUT') {
          const body = await readJson(req); requireUser(req);
          return send(res, 200, putEntity('profile', user.id, user.id, body, req));
        }
        const match = /^\/api\/(doses|scenarios|favorites|checkins|inventory)\/([A-Za-z0-9_-]{1,100})$/.exec(path);
        if (match && ['PUT', 'DELETE'].includes(method)) {
          const [, kind, id] = match;
          const body = await readJson(req);
          requireUser(req);
          return send(res, 200, method === 'PUT' ? putEntity(kind, id, user.id, body, req) : deleteEntity(kind, id, user.id, body, req));
        }
        throw new ApiError(404, 'Endpoint not found.');
      }
      if (!['GET', 'HEAD'].includes(method)) throw new ApiError(405, 'Method not allowed.');
      const dist = join(ROOT, 'dist');
      let requested;
      try { requested = resolve(dist, `.${decodeURIComponent(path)}`); }
      catch { throw new ApiError(400, 'Invalid path.'); }
      if (!requested.startsWith(`${dist}/`) && requested !== dist) throw new ApiError(404, 'File not found.');
      if (!existsSync(requested) || !statSync(requested).isFile()) {
        // Missing assets must not be served index.html with the wrong content type.
        if (extname(path)) throw new ApiError(404, 'File not found.');
        requested = join(dist, 'index.html');
      }
      if (!existsSync(requested)) throw new ApiError(503, 'Build the app first, or open the Vite development server.');
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      res.writeHead(200, { 'Content-Type': mime[extname(requested)] || 'application/octet-stream', 'Cache-Control': requested.includes(`${dist}/assets/`) ? 'public, max-age=31536000, immutable' : 'no-cache' });
      res.end(method === 'HEAD' ? undefined : readFileSync(requested));
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const status = error instanceof ApiError ? error.status : 500;
      if (status === 500) console.error('Request failed; no personal request data logged.', error.code || error.name);
      send(res, status, { error: status === 500 ? 'The server could not complete this request.' : error.message, ...(error.details || {}) });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => db.close());
  return { server, dbPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const { server } = await createDoseServer({ port });
  server.listen(port, '127.0.0.1', () => console.log(`Drug Tracker is running at http://127.0.0.1:${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
