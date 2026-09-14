import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CloudError } from './cloud-errors.mjs';
import { openVaultStore, validateVaultWrite, VaultStoreError } from './vault-store.mjs';

export function openCloudDatabase(dbPath) {
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

/** Async-compatible cloud repository; the local edition never imports this. */
export function openCloudSqlite(dbPath) {
  const db = openCloudDatabase(dbPath);
  try { openVaultStore({ dbPath }).close(); } catch (error) { db.close(); throw error; }
  let closed = false;
  const transaction = operation => {
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
  return {
    accountByUsername: name => db.prepare('SELECT * FROM cloud_accounts WHERE username=?').get(name) ?? null,
    session,
    register(account, value) {
      return transaction(() => {
        if (db.prepare('SELECT id FROM cloud_accounts WHERE username=?').get(account.username)) throw new CloudError(409, 'Username is unavailable.');
        db.prepare('INSERT INTO cloud_accounts VALUES (?,?,?,?,?)').run(account.id, account.username, account.password_hash, account.name, new Date().toISOString());
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
    readVault(owner, tokenHash) {
      return transaction(() => { requireSession(owner, tokenHash); return read(owner); });
    },
    writeVault(owner, tokenHash, input) {
      const accepted = validateVaultWrite(owner, input);
      return transaction(() => {
        requireSession(owner, tokenHash);
        const current = db.prepare('SELECT revision,created_at FROM encrypted_vaults WHERE owner_id=?').get(owner);
        const revision = current?.revision ?? 0;
        if (revision !== accepted.expectedRevision) throw new VaultStoreError(409, 'This encrypted vault changed. Reload before saving.', { currentRevision: revision });
        if (revision >= Number.MAX_SAFE_INTEGER) throw new VaultStoreError(409, 'The encrypted vault revision limit was reached.');
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO encrypted_vaults VALUES (?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET
          revision=excluded.revision,data_envelope=excluded.data_envelope,key_envelope=excluded.key_envelope,updated_at=excluded.updated_at`)
          .run(owner, revision + 1, accepted.data, accepted.key, current?.created_at ?? now, now);
        return read(owner);
      });
    },
    close() { if (!closed) { closed = true; db.close(); } },
  };
}
