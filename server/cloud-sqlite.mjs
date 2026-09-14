import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CloudError } from './cloud-errors.mjs';
import { openVaultStore, validateVaultWrite, VaultStoreError } from './vault-store.mjs';
import { cappedSessionExpiry, SESSION_SECONDS } from './cloud-session.mjs';
import { isDeepStrictEqual } from 'node:util';

const OPAQUE_MODE = 'opaque-v1';
const invalid = message => { throw new CloudError(400, message); };
function opaqueBinary(value, bytes) {
  if (typeof value !== 'string' || value.length !== Math.ceil(bytes * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) invalid('Invalid OPAQUE material.');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== bytes || decoded.toString('base64url') !== value) invalid('Invalid OPAQUE material.');
  return value;
}
function digest(value) { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) invalid('Invalid authentication digest.'); return value; }
function ownerId(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid('Invalid authentication owner.'); return value; }
function authVersion(value) { if (!Number.isSafeInteger(value) || value < 1) invalid('Invalid authentication version.'); return value; }
function nextAuthVersion(value) { if (value >= Number.MAX_SAFE_INTEGER) throw new CloudError(409, 'The authentication version limit was reached.'); return value + 1; }

export function openCloudDatabase(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  try {
    // Inspect only schema names before enabling journals or changing an existing file.
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
    const allowed = ['cloud_meta', 'cloud_accounts', 'cloud_sessions', 'encrypted_vaults', 'cloud_auth_secrets', 'cloud_auth_challenges'];
    if (tables.some(name => !allowed.includes(name))) throw new CloudError(400, 'This is not a dedicated cloud database. Choose a new CLOUD_DB_PATH.');
    chmodSync(dbPath, 0o600);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
    try {
      db.exec('CREATE TABLE IF NOT EXISTS cloud_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), edition TEXT NOT NULL, version INTEGER NOT NULL) STRICT');
      const version = db.prepare('SELECT edition, version FROM cloud_meta WHERE singleton=1').get();
      if (version && (version.edition !== 'drug-cloud-encrypted' || ![1, 2, 3].includes(version.version))) throw new CloudError(400, 'Unsupported cloud database version.');
      if (!version) {
        if (tables.some(name => ['cloud_accounts', 'cloud_sessions', 'cloud_auth_secrets', 'cloud_auth_challenges'].includes(name))) throw new CloudError(400, 'The existing cloud account database has no supported version.');
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
      if (!version || version.version < 3) {
        db.exec(`ALTER TABLE cloud_accounts ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'legacy-scrypt' CHECK(auth_mode IN ('legacy-scrypt','opaque-v1'));
          ALTER TABLE cloud_accounts ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version>0 AND auth_version<=9007199254740991);
          ALTER TABLE cloud_accounts ADD COLUMN opaque_record TEXT;
          ALTER TABLE cloud_accounts ADD COLUMN recovery_auth_hash TEXT;
          CREATE TABLE cloud_auth_secrets (singleton INTEGER PRIMARY KEY CHECK(singleton=1), opaque_setup TEXT NOT NULL CHECK(length(opaque_setup)=171)) STRICT;
          CREATE TABLE cloud_auth_challenges (
            id_hash TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, owner_id TEXT,
            username TEXT NOT NULL, source_hash TEXT NOT NULL, auth_version INTEGER,
            session_hash TEXT, expires_at INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))
          ) STRICT;
          CREATE INDEX cloud_auth_challenges_expiry ON cloud_auth_challenges(expires_at);
          CREATE INDEX cloud_auth_challenges_source ON cloud_auth_challenges(source_hash);
          CREATE INDEX cloud_auth_challenges_username ON cloud_auth_challenges(username);
          CREATE INDEX cloud_auth_challenges_owner ON cloud_auth_challenges(owner_id);
          UPDATE cloud_meta SET version=3 WHERE singleton=1;`);
      }
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new CloudError(400, 'Cloud account relationships could not be preserved.');
      for (const row of db.prepare('SELECT token_hash,created_at,expires_at FROM cloud_sessions').all()) {
        const capped = cappedSessionExpiry(row);
        if (capped < row.expires_at) db.prepare('UPDATE cloud_sessions SET expires_at=? WHERE token_hash=?').run(capped, row.token_hash);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return db;
  } catch (error) { db.close(); throw error; }
}

/** Async-compatible cloud repository; the local edition never imports this. */
export function openCloudSqlite(dbPath) {
  const db = openCloudDatabase(dbPath);
  try { openVaultStore({ dbPath }).close(); } catch (error) { db.close(); throw error; }
  let closed = false;
  const transaction = operation => {
    if (closed) throw new CloudError(503, 'The cloud database is closed.');
    db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const session = tokenHash => db.prepare(`SELECT a.* FROM cloud_accounts a JOIN cloud_sessions s ON a.id=s.owner_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash, Date.now()) ?? null;
  const requireSession = (owner, tokenHash) => {
    if (session(tokenHash)?.id !== owner) throw new CloudError(401, 'Sign in to access your encrypted vault.');
  };
  const addSession = (owner, value) => {
    db.prepare('DELETE FROM cloud_sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO cloud_sessions VALUES (?,?,?,?)').run(value.tokenHash, owner, value.expiresAt, new Date().toISOString());
  };
  const snapshot = row => row ? {
    ownerId: row.owner_id, revision: row.revision, dataEnvelope: JSON.parse(row.data_envelope),
    keyEnvelope: JSON.parse(row.key_envelope), createdAt: row.created_at, updatedAt: row.updated_at,
  } : null;
  const read = owner => snapshot(db.prepare('SELECT * FROM encrypted_vaults WHERE owner_id=?').get(owner));
  const account = owner => db.prepare('SELECT * FROM cloud_accounts WHERE id=?').get(owner) ?? null;
  const requireOpaque = (owner, version, tokenHash) => {
    const fresh = account(owner);
    if (!fresh || fresh.auth_mode !== OPAQUE_MODE || fresh.auth_version !== version) throw new CloudError(401, 'The account changed. Sign in again.');
    if (tokenHash !== undefined && tokenHash !== null) requireSession(owner, tokenHash);
    return fresh;
  };
  const putVault = (owner, accepted) => {
    const current = db.prepare('SELECT revision,created_at FROM encrypted_vaults WHERE owner_id=?').get(owner);
    const revision = current?.revision ?? 0;
    if (revision !== accepted.expectedRevision) throw new VaultStoreError(409, 'This encrypted vault changed. Reload before saving.', { currentRevision: revision });
    if (revision >= Number.MAX_SAFE_INTEGER) throw new VaultStoreError(409, 'The encrypted vault revision limit was reached.');
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO encrypted_vaults VALUES (?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET
      revision=excluded.revision,data_envelope=excluded.data_envelope,key_envelope=excluded.key_envelope,updated_at=excluded.updated_at`)
      .run(owner, revision + 1, accepted.data, accepted.key, current?.created_at ?? now, now);
    return read(owner);
  };
  const security = (owner, tokenHash) => {
    const current = db.prepare('SELECT created_at,expires_at FROM cloud_sessions WHERE token_hash=? AND owner_id=?').get(tokenHash, owner);
    return { currentSession: { createdAt: current.created_at, expiresAt: new Date(current.expires_at).toISOString() },
      activeSessionCount: db.prepare('SELECT count(*) AS n FROM cloud_sessions WHERE owner_id=? AND expires_at>?').get(owner, Date.now()).n,
      sessionLifetimeHours: SESSION_SECONDS / 3600 };
  };
  return {
    accountByUsername: name => db.prepare('SELECT * FROM cloud_accounts WHERE username=?').get(name) ?? null,
    opaqueAccountById: account,
    getOrCreateOpaqueSetup(candidate, expectedOverride) {
      return transaction(() => {
        const existing = db.prepare('SELECT opaque_setup FROM cloud_auth_secrets WHERE singleton=1').get();
        if (existing) {
          const setup = opaqueBinary(existing.opaque_setup, 128);
          if (expectedOverride !== undefined && expectedOverride !== setup) invalid('The configured OPAQUE setup does not match this database.');
          return setup;
        }
        if (db.prepare('SELECT id FROM cloud_accounts WHERE auth_mode=? LIMIT 1').get(OPAQUE_MODE)) throw new CloudError(503, 'The OPAQUE setup is missing. Restore the existing setup before signing in.');
        const setup = opaqueBinary(candidate, 128);
        if (expectedOverride !== undefined && expectedOverride !== setup) invalid('The configured OPAQUE setup does not match this database.');
        db.prepare('INSERT INTO cloud_auth_secrets VALUES (1,?)').run(setup);
        return setup;
      });
    },
    createOpaqueChallenge(row) {
      digest(row.idHash); digest(row.sourceHash);
      if (row.ownerId !== null) ownerId(row.ownerId);
      if (row.authVersion !== null) authVersion(row.authVersion);
      if (row.sessionHash !== null) digest(row.sessionHash);
      if (typeof row.kind !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(row.kind)
        || typeof row.username !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(row.username)
        || !Number.isSafeInteger(row.expiresAt) || !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload)) invalid('Invalid authentication challenge.');
      const payload = JSON.stringify(row.payload);
      if (Buffer.byteLength(payload, 'utf8') > 16 * 1024) invalid('Authentication challenge is too large.');
      return transaction(() => {
        const now = Date.now();
        if (row.expiresAt <= now) invalid('Authentication challenge has expired.');
        db.prepare('DELETE FROM cloud_auth_challenges WHERE expires_at<=?').run(now);
        const total = db.prepare('SELECT count(*) AS n FROM cloud_auth_challenges').get().n;
        const source = db.prepare('SELECT count(*) AS n FROM cloud_auth_challenges WHERE source_hash=?').get(row.sourceHash).n;
        const username = db.prepare('SELECT count(*) AS n FROM cloud_auth_challenges WHERE username=?').get(row.username).n;
        if (total >= 1000 || source >= 40 || username >= 12) throw new CloudError(429, 'Too many pending authentication attempts. Try again.', { retryAfter: 2 });
        db.prepare('INSERT INTO cloud_auth_challenges VALUES (?,?,?,?,?,?,?,?,?)').run(row.idHash, row.kind, row.ownerId, row.username, row.sourceHash, row.authVersion, row.sessionHash, row.expiresAt, payload);
      });
    },
    takeOpaqueChallenge(idHash, kind, sourceHash) {
      digest(idHash); digest(sourceHash);
      // Commit consumption even when expired. Throwing inside the transaction would undo DELETE.
      const row = transaction(() => db.prepare('DELETE FROM cloud_auth_challenges WHERE id_hash=? AND kind=? AND source_hash=? RETURNING *').get(idHash, kind, sourceHash));
      if (!row || row.expires_at <= Date.now()) throw new CloudError(401, 'This authentication attempt expired. Start again.');
      return { idHash: row.id_hash, kind: row.kind, ownerId: row.owner_id, username: row.username, sourceHash: row.source_hash,
        authVersion: row.auth_version, sessionHash: row.session_hash, expiresAt: row.expires_at, payload: JSON.parse(row.payload) };
    },
    checkOpaqueOwner(owner, version, tokenHash) { return transaction(() => requireOpaque(owner, version, tokenHash)); },
    recoveryVault(owner, version, expectedRecoveryHash) {
      digest(expectedRecoveryHash);
      return transaction(() => {
        const fresh = requireOpaque(owner, version);
        if (fresh.recovery_auth_hash !== expectedRecoveryHash) throw new CloudError(401, 'The recovery credentials changed. Start again.');
        return read(owner);
      });
    },
    loginOpaque({ ownerId: owner, authVersion: version }, value) {
      return transaction(() => { const fresh = requireOpaque(owner, version); addSession(owner, value); return fresh; });
    },
    registerOpaque({ challenge, registrationRecord, vaultInput, recoveryAuthHash }, value) {
      if (challenge.kind !== 'register') invalid('Invalid registration challenge.');
      const owner = ownerId(challenge.ownerId), record = opaqueBinary(registrationRecord, 192), recoveryHash = digest(recoveryAuthHash);
      const accepted = validateVaultWrite(owner, vaultInput);
      if (accepted.expectedRevision !== 0 || JSON.parse(accepted.key).version !== 3) invalid('A new OPAQUE vault is required.');
      const name = challenge.payload?.name ?? challenge.username;
      if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof challenge.username !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(challenge.username)) invalid('Invalid account details.');
      return transaction(() => {
        if (db.prepare('SELECT id FROM cloud_accounts WHERE username=?').get(challenge.username)) throw new CloudError(409, 'Username is unavailable.');
        db.prepare(`INSERT INTO cloud_accounts (id,username,password_hash,name,created_at,auth_mode,auth_version,opaque_record,recovery_auth_hash)
          VALUES (?,?,?,?,?,?,1,?,?)`).run(owner, challenge.username, '!opaque-v1', name, new Date().toISOString(), OPAQUE_MODE, record, recoveryHash);
        const vault = putVault(owner, accepted); addSession(owner, value);
        return { user: account(owner), vault };
      });
    },
    commitOpaque({ kind, ownerId: owner, authVersion: version, sessionHash, expectedLegacyHash, expectedRecoveryHash, registrationRecord, vaultInput, recoveryAuthHash }, replacement) {
      if (!['migrate', 'recover', 'change', 'rotate-recovery'].includes(kind)) invalid('Unsupported account update.');
      ownerId(owner); authVersion(version);
      const accepted = validateVaultWrite(owner, vaultInput);
      if (JSON.parse(accepted.key).version !== 3) invalid('An OPAQUE wrapped key is required.');
      if (kind !== 'rotate-recovery') opaqueBinary(registrationRecord, 192);
      if (kind !== 'change') digest(recoveryAuthHash);
      return transaction(() => {
        const fresh = account(owner);
        if (!fresh || fresh.auth_version !== version) throw new CloudError(401, 'The account changed. Sign in again.');
        if (kind !== 'recover') requireSession(owner, sessionHash);
        if (kind === 'migrate') {
          if (fresh.auth_mode !== 'legacy-scrypt' || typeof expectedLegacyHash !== 'string' || fresh.password_hash !== expectedLegacyHash) throw new CloudError(401, 'The account changed. Sign in again.');
        } else {
          if (fresh.auth_mode !== OPAQUE_MODE) throw new CloudError(401, 'The account changed. Sign in again.');
          if (kind === 'recover' && (typeof expectedRecoveryHash !== 'string' || fresh.recovery_auth_hash !== expectedRecoveryHash)) throw new CloudError(401, 'The recovery credentials changed. Start again.');
        }
        const previous = read(owner);
        if (!previous && kind !== 'migrate') throw new CloudError(503, 'The encrypted vault is unavailable.');
        if (kind === 'change' && (!isDeepStrictEqual(previous.dataEnvelope, JSON.parse(accepted.data))
          || (recoveryAuthHash !== undefined && recoveryAuthHash !== fresh.recovery_auth_hash))) invalid('A password change must preserve the encrypted records and recovery credentials.');
        if (kind === 'rotate-recovery' && registrationRecord !== undefined && registrationRecord !== fresh.opaque_record) invalid('Recovery rotation must preserve the account registration.');
        const newVersion = nextAuthVersion(fresh.auth_version);
        const record = kind === 'rotate-recovery' ? fresh.opaque_record : registrationRecord;
        const recoveryHash = kind === 'change' ? fresh.recovery_auth_hash : recoveryAuthHash;
        const vault = putVault(owner, accepted);
        db.prepare('UPDATE cloud_accounts SET auth_mode=?,auth_version=?,password_hash=?,opaque_record=?,recovery_auth_hash=? WHERE id=?')
          .run(OPAQUE_MODE, newVersion, '!opaque-v1', record, recoveryHash, owner);
        db.prepare('DELETE FROM cloud_sessions WHERE owner_id=?').run(owner);
        db.prepare('DELETE FROM cloud_auth_challenges WHERE owner_id=?').run(owner);
        addSession(owner, replacement);
        return { user: account(owner), vault };
      });
    },
    sensitiveOpaque({ kind, ownerId: owner, authVersion: version, sessionHash }) {
      if (!['delete-account', 'logout-all'].includes(kind)) invalid('Unsupported account operation.');
      digest(sessionHash);
      return transaction(() => {
        const fresh = requireOpaque(owner, version, sessionHash);
        db.prepare('DELETE FROM cloud_sessions WHERE owner_id=?').run(owner);
        db.prepare('DELETE FROM cloud_auth_challenges WHERE owner_id=?').run(owner);
        if (kind === 'delete-account') {
          db.prepare('DELETE FROM encrypted_vaults WHERE owner_id=?').run(owner);
          db.prepare('DELETE FROM cloud_accounts WHERE id=?').run(owner);
        } else db.prepare('UPDATE cloud_accounts SET auth_version=? WHERE id=?').run(nextAuthVersion(fresh.auth_version), owner);
      });
    },
    session,
    securityInfo(owner, tokenHash) {
      return transaction(() => { requireSession(owner, tokenHash); return security(owner, tokenHash); });
    },
    verifyPassword(owner, tokenHash, expectedPasswordHash) {
      return transaction(() => {
        requireSession(owner, tokenHash);
        const fresh = db.prepare('SELECT password_hash FROM cloud_accounts WHERE id=?').get(owner);
        if (!fresh || fresh.password_hash !== expectedPasswordHash) throw new CloudError(401, 'The account changed. Sign in again.');
      });
    },
    register(account, value) {
      return transaction(() => {
        if (db.prepare('SELECT id FROM cloud_accounts WHERE username=?').get(account.username)) throw new CloudError(409, 'Username is unavailable.');
        db.prepare('INSERT INTO cloud_accounts (id,username,password_hash,name,created_at) VALUES (?,?,?,?,?)').run(account.id, account.username, account.password_hash, account.name, new Date().toISOString());
        addSession(account.id, value);
        return account;
      });
    },
    login(account, value) {
      return transaction(() => {
        const fresh = db.prepare('SELECT * FROM cloud_accounts WHERE id=? AND password_hash=?').get(account.id, account.password_hash);
        if (!fresh) throw new CloudError(401, 'The account changed. Sign in again.');
        addSession(fresh.id, value);
        return fresh;
      });
    },
    logout(tokenHash, expectedOwner) {
      return transaction(() => {
        const user = session(tokenHash);
        if (user && expectedOwner && expectedOwner !== user.id) throw new CloudError(401, 'The selected account changed. Sign in again.');
        db.prepare('DELETE FROM cloud_sessions WHERE token_hash=?').run(tokenHash);
      });
    },
    deleteAccount(owner, tokenHash, expectedPasswordHash) {
      return transaction(() => {
        requireSession(owner, tokenHash);
        const fresh = db.prepare('SELECT password_hash FROM cloud_accounts WHERE id=?').get(owner);
        if (!fresh || fresh.password_hash !== expectedPasswordHash) throw new CloudError(401, 'The account changed. Sign in again.');
        // The standalone vault schema predates accounts and intentionally has no account FK.
        db.prepare('DELETE FROM encrypted_vaults WHERE owner_id=?').run(owner);
        db.prepare('DELETE FROM cloud_sessions WHERE owner_id=?').run(owner);
        db.prepare('DELETE FROM cloud_accounts WHERE id=?').run(owner);
      });
    },
    logoutAll(owner, tokenHash, expectedPasswordHash) {
      return transaction(() => {
        requireSession(owner, tokenHash);
        const fresh = db.prepare('SELECT password_hash FROM cloud_accounts WHERE id=?').get(owner);
        if (!fresh || fresh.password_hash !== expectedPasswordHash) throw new CloudError(401, 'The account changed. Sign in again.');
        db.prepare('DELETE FROM cloud_sessions WHERE owner_id=?').run(owner);
      });
    },
    changePassword(owner, tokenHash, expectedPasswordHash, newPasswordHash, replacement) {
      return transaction(() => {
        requireSession(owner, tokenHash);
        const fresh = db.prepare('SELECT * FROM cloud_accounts WHERE id=?').get(owner);
        if (!fresh || fresh.password_hash !== expectedPasswordHash) throw new CloudError(401, 'The account changed. Sign in again.');
        db.prepare('UPDATE cloud_accounts SET password_hash=? WHERE id=?').run(newPasswordHash, owner);
        db.prepare('DELETE FROM cloud_sessions WHERE owner_id=?').run(owner);
        addSession(owner, replacement);
        return { user: { ...fresh, password_hash: newPasswordHash }, security: security(owner, replacement.tokenHash) };
      });
    },
    readVault(owner, tokenHash) {
      return transaction(() => { requireSession(owner, tokenHash); return read(owner); });
    },
    writeVault(owner, tokenHash, input) {
      const accepted = validateVaultWrite(owner, input);
      return transaction(() => {
        requireSession(owner, tokenHash);
        const fresh = account(owner), current = read(owner);
        if (fresh.auth_mode === OPAQUE_MODE) {
          if (!current || !isDeepStrictEqual(current.keyEnvelope, JSON.parse(accepted.key))) invalid('Use the account security flow to replace encrypted credentials.');
        } else if (JSON.parse(accepted.key).version === 3) invalid('Migrate the account before using an OPAQUE wrapped key.');
        return putVault(owner, accepted);
      });
    },
    close() { if (!closed) { closed = true; db.close(); } },
  };
}
