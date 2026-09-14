import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { CloudError } from './cloud-errors.mjs';
import { validateVaultWrite, VaultStoreError } from './vault-store.mjs';
import { cappedSessionExpiry, SESSION_SECONDS } from './cloud-session.mjs';
import { initializeOpaquePostgres, opaquePostgresMethods, validateOrdinaryVaultKey } from './cloud-opaque-postgres.mjs';

const EXPIRED_SESSION_CLEANUP = `WITH expired AS (
  SELECT token_hash FROM drug_tracker.sessions
  WHERE expires_at<=floor(extract(epoch FROM clock_timestamp())*1000)::bigint
  ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED
) DELETE FROM drug_tracker.sessions s USING expired e WHERE s.token_hash=e.token_hash`;

/** Ignore URL TLS overrides: pg's URL parser otherwise replaces the verified ssl object. */
export function postgresConfiguration({ databaseUrl, databaseCaPath, allowInsecurePostgresLoopback = false, databasePoolSize = 4 } = {}) {
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new CloudError(400, 'Configure a valid PostgreSQL DATABASE_URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username || parsed.pathname.length < 2 || parsed.hash)
    throw new CloudError(400, 'Configure a valid PostgreSQL DATABASE_URL.');
  if (!Number.isSafeInteger(databasePoolSize) || databasePoolSize < 1 || databasePoolSize > 10) throw new CloudError(400, 'Use a database pool size of 1–10.');
  // No connection-string options may replace the endpoint, user, trust roots or TLS policy.
  for (const name of parsed.searchParams.keys()) {
    if (!['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'].includes(name)) throw new CloudError(400, 'Unsupported DATABASE_URL query options.');
  }
  parsed.search = '';
  let ssl;
  if (allowInsecurePostgresLoopback === true) {
    if (!['127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new CloudError(400, 'Unencrypted PostgreSQL is limited to an explicit numeric loopback test connection.');
    ssl = false;
  } else {
    if (databaseCaPath !== undefined && (typeof databaseCaPath !== 'string' || !isAbsolute(databaseCaPath))) throw new CloudError(400, 'Choose an absolute PostgreSQL CA bundle path.');
    ssl = { rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(databaseCaPath ? { ca: readFileSync(databaseCaPath, 'utf8') } : {}) };
  }
  return { connectionString: parsed.toString(), ssl, max: databasePoolSize, connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000, statement_timeout: 10_000, lock_timeout: 5_000, idle_in_transaction_session_timeout: 15_000,
    application_name: 'drug-tracker-cloud' };
}

/** Dedicated schema: account metadata and opaque vault envelopes only. No health plaintext or vault secrets. */
export async function openCloudPostgres(options) {
  const config = postgresConfiguration(options);
  const { Pool } = await import('pg');
  const pool = new Pool(config);
  // A disconnected idle connection must not crash the process or leak connection details to logs.
  pool.on('error', () => {});
  let closed = false;
  const transaction = async operation => {
    if (closed) throw new CloudError(503, 'The cloud database is closed.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  };
  try {
    await transaction(async client => {
      // Serialize bootstrapping across processes before CREATE SCHEMA/TABLE catalog writes.
      await client.query("SELECT pg_advisory_xact_lock(742091, 1)");
      await client.query(`CREATE SCHEMA IF NOT EXISTS drug_tracker;
        CREATE TABLE IF NOT EXISTS drug_tracker.meta (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1), edition TEXT NOT NULL, version INTEGER NOT NULL
        )`);
      const meta = (await client.query('SELECT edition,version FROM drug_tracker.meta WHERE singleton=1')).rows[0];
      if (meta && (meta.edition !== 'drug-cloud-encrypted' || ![1, 2, 3].includes(meta.version))) throw new CloudError(400, 'Unsupported PostgreSQL cloud database version.');
      if (!meta) {
        const existing = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='drug_tracker' AND tablename<>'meta'");
        if (existing.rowCount) throw new CloudError(400, 'The existing PostgreSQL cloud schema has no supported version.');
        await client.query(`CREATE TABLE drug_tracker.accounts (
          id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
          name TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE drug_tracker.sessions (
          token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES drug_tracker.accounts(id) ON DELETE CASCADE,
          expires_at BIGINT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX sessions_expiry ON drug_tracker.sessions(expires_at);
        CREATE TABLE drug_tracker.vaults (
          owner_id TEXT PRIMARY KEY REFERENCES drug_tracker.accounts(id) ON DELETE CASCADE,
          revision BIGINT NOT NULL CHECK(revision>0 AND revision<=9007199254740991),
          data_envelope JSONB NOT NULL, key_envelope JSONB NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        INSERT INTO drug_tracker.meta VALUES (1,'drug-cloud-encrypted',1);`);
      }
      if (!meta || meta.version === 1) {
        // Ephemeral global quotas contain no account data; replace them atomically.
        await client.query(`DROP TABLE IF EXISTS drug_tracker.rate_limits;
          CREATE TABLE drug_tracker.rate_limits (
            kind TEXT NOT NULL CHECK(kind IN ('login','register')),
            subject_hash TEXT NOT NULL CHECK(subject_hash ~ '^[0-9a-f]{64}$'),
            count BIGINT NOT NULL, until_ms BIGINT NOT NULL, PRIMARY KEY(kind,subject_hash)
          );
          CREATE INDEX rate_limits_expiry ON drug_tracker.rate_limits(until_ms);
          UPDATE drug_tracker.meta SET version=2 WHERE singleton=1;`);
      }
      if (!meta || meta.version < 3) await initializeOpaquePostgres(client);
      await client.query(EXPIRED_SESSION_CLEANUP);
      for (const row of (await client.query('SELECT token_hash,created_at,expires_at FROM drug_tracker.sessions WHERE expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint')).rows) {
        const capped = cappedSessionExpiry(row);
        if (capped < Number(row.expires_at)) await client.query('UPDATE drug_tracker.sessions SET expires_at=$1 WHERE token_hash=$2', [capped, row.token_hash]);
      }
    });
  } catch (error) { await pool.end(); throw error; }
  const sessionQuery = `SELECT a.* FROM drug_tracker.accounts a JOIN drug_tracker.sessions s ON a.id=s.owner_id
    WHERE s.token_hash=$1 AND s.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint`;
  const requireSession = async (client, owner, tokenHash) => {
    // Hold the session row until COMMIT. Concurrent logout cannot return before an earlier write finishes.
    const row = (await client.query(`${sessionQuery} FOR SHARE OF s`, [tokenHash])).rows[0];
    if (!row || row.id !== owner) throw new CloudError(401, 'Sign in to access your encrypted vault.');
  };
  const lockOwner = async (client, owner, mode = 'SHARE') => {
    // Lock order is account, then session, then vault everywhere that needs both.
    const row = (await client.query(`SELECT * FROM drug_tracker.accounts WHERE id=$1 FOR ${mode}`, [owner])).rows[0];
    if (!row) throw new CloudError(401, 'The account changed. Sign in again.');
    return row;
  };
  const addSession = async (client, owner, value) => {
    await client.query('INSERT INTO drug_tracker.sessions VALUES ($1,$2,$3,$4)', [value.tokenHash, owner, value.expiresAt, new Date().toISOString()]);
  };
  // Finish global expiry cleanup before account/session locks to preserve lock ordering.
  const cleanupExpiredSessions = () => pool.query(EXPIRED_SESSION_CLEANUP);
  const snapshot = row => row ? {
    ownerId: row.owner_id, revision: Number(row.revision), dataEnvelope: row.data_envelope,
    keyEnvelope: row.key_envelope, createdAt: row.created_at, updatedAt: row.updated_at,
  } : null;
  const read = async (client, owner) => snapshot((await client.query('SELECT * FROM drug_tracker.vaults WHERE owner_id=$1', [owner])).rows[0]);
  const security = async (client, owner, tokenHash) => {
    const current = (await client.query('SELECT created_at,expires_at FROM drug_tracker.sessions WHERE token_hash=$1 AND owner_id=$2', [tokenHash, owner])).rows[0];
    const count = (await client.query('SELECT count(*)::int AS n FROM drug_tracker.sessions WHERE owner_id=$1 AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint', [owner])).rows[0].n;
    return { currentSession: { createdAt: current.created_at, expiresAt: new Date(Number(current.expires_at)).toISOString() }, activeSessionCount: count, sessionLifetimeHours: SESSION_SECONDS / 3600 };
  };
  return {
    ...opaquePostgresMethods({pool,transaction,lockOwner,requireSession,addSession,read,cleanupExpiredSessions}),
    accountByUsername: async name => (await pool.query('SELECT * FROM drug_tracker.accounts WHERE username=$1', [name])).rows[0] ?? null,
    session: async tokenHash => (await pool.query(sessionQuery, [tokenHash])).rows[0] ?? null,
    securityInfo(owner, tokenHash) {
      return transaction(async client => { await lockOwner(client, owner); await requireSession(client, owner, tokenHash); return security(client, owner, tokenHash); });
    },
    verifyPassword(owner, tokenHash, expectedPasswordHash) {
      return transaction(async client => {
        const fresh = await lockOwner(client, owner); await requireSession(client, owner, tokenHash);
        if (fresh.password_hash !== expectedPasswordHash) throw new CloudError(401, 'The account changed. Sign in again.');
      });
    },
    async register(account, value) {
      await cleanupExpiredSessions();
      try {
        return await transaction(async client => {
          await client.query('INSERT INTO drug_tracker.accounts VALUES ($1,$2,$3,$4,$5)', [account.id, account.username, account.password_hash, account.name, new Date().toISOString()]);
          await addSession(client, account.id, value);
          return account;
        });
      } catch (error) { if (error.code === '23505' && error.constraint === 'accounts_username_key') throw new CloudError(409, 'Username is unavailable.'); throw error; }
    },
    async login(account, value) {
      // Expired-session cleanup must finish before holding an account lock (writes lock account, then session).
      await cleanupExpiredSessions();
      return transaction(async client => {
        const fresh = (await client.query('SELECT * FROM drug_tracker.accounts WHERE id=$1 AND password_hash=$2 FOR SHARE', [account.id, account.password_hash])).rows[0];
        if (!fresh) throw new CloudError(401, 'The account changed. Sign in again.');
        await addSession(client, fresh.id, value);
        return fresh;
      });
    },
    logout(tokenHash, expectedOwner) {
      return transaction(async client => {
        const user = (await client.query(`${sessionQuery} FOR UPDATE OF s`, [tokenHash])).rows[0];
        if (user && expectedOwner && expectedOwner !== user.id) throw new CloudError(401, 'The selected account changed. Sign in again.');
        await client.query('DELETE FROM drug_tracker.sessions WHERE token_hash=$1', [tokenHash]);
      });
    },
    deleteAccount(owner, tokenHash, expectedPasswordHash) {
      return transaction(async client => {
        const fresh = await lockOwner(client, owner, 'UPDATE');
        await requireSession(client, owner, tokenHash);
        if (fresh.password_hash !== expectedPasswordHash) throw new CloudError(401, 'The account changed. Sign in again.');
        await client.query('DELETE FROM drug_tracker.vaults WHERE owner_id=$1', [owner]);
        await client.query('DELETE FROM drug_tracker.sessions WHERE owner_id=$1', [owner]);
        await client.query('DELETE FROM drug_tracker.accounts WHERE id=$1', [owner]);
      });
    },
    logoutAll(owner, tokenHash, expectedPasswordHash) {
      return transaction(async client => {
        const fresh = await lockOwner(client, owner, 'UPDATE'); await requireSession(client, owner, tokenHash);
        if (fresh.password_hash !== expectedPasswordHash) throw new CloudError(401, 'The account changed. Sign in again.');
        await client.query('DELETE FROM drug_tracker.sessions WHERE owner_id=$1', [owner]);
      });
    },
    changePassword(owner, tokenHash, expectedPasswordHash, newPasswordHash, replacement) {
      return transaction(async client => {
        const fresh = await lockOwner(client, owner, 'UPDATE'); await requireSession(client, owner, tokenHash);
        if (fresh.password_hash !== expectedPasswordHash) throw new CloudError(401, 'The account changed. Sign in again.');
        await client.query('UPDATE drug_tracker.accounts SET password_hash=$1 WHERE id=$2', [newPasswordHash, owner]);
        await client.query('DELETE FROM drug_tracker.sessions WHERE owner_id=$1', [owner]);
        await addSession(client, owner, replacement);
        return { user: { ...fresh, password_hash: newPasswordHash }, security: await security(client, owner, replacement.tokenHash) };
      });
    },
    readVault(owner, tokenHash) {
      return transaction(async client => { await lockOwner(client, owner); await requireSession(client, owner, tokenHash); return read(client, owner); });
    },
    writeVault(owner, tokenHash, input) {
      const accepted = validateVaultWrite(owner, input);
      return transaction(async client => {
        // Lock the existing owner row, including before their first vault exists. No first-write upsert race.
        const fresh = await lockOwner(client, owner, 'UPDATE');
        await requireSession(client, owner, tokenHash);
        const current = (await client.query('SELECT revision,created_at,key_envelope FROM drug_tracker.vaults WHERE owner_id=$1', [owner])).rows[0];
        validateOrdinaryVaultKey(fresh,current,input.keyEnvelope);
        const revision = Number(current?.revision ?? 0);
        if (revision !== accepted.expectedRevision) throw new VaultStoreError(409, 'This encrypted vault changed. Reload before saving.', { currentRevision: revision });
        if (revision >= Number.MAX_SAFE_INTEGER) throw new VaultStoreError(409, 'The encrypted vault revision limit was reached.');
        const now = new Date().toISOString();
        await client.query(`INSERT INTO drug_tracker.vaults VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6) ON CONFLICT(owner_id) DO UPDATE SET
          revision=EXCLUDED.revision,data_envelope=EXCLUDED.data_envelope,key_envelope=EXCLUDED.key_envelope,updated_at=EXCLUDED.updated_at`,
        [owner, revision + 1, accepted.data, accepted.key, current?.created_at ?? now, now]);
        return read(client, owner);
      });
    },
    async consumeRateLimit(kind, subjectHash, limit, duration) {
      if (!['login', 'register'].includes(kind) || !/^[0-9a-f]{64}$/.test(subjectHash)) throw new CloudError(400, 'Invalid account quota.');
      const now = 'floor(extract(epoch FROM clock_timestamp())*1000)::bigint';
      await pool.query(`DELETE FROM drug_tracker.rate_limits WHERE until_ms<=${now}`);
      const result = await pool.query(`INSERT INTO drug_tracker.rate_limits AS r VALUES ($1,$2,1,${now}+$3)
        ON CONFLICT(kind,subject_hash) DO UPDATE SET count=CASE WHEN r.until_ms<=${now} THEN 1 ELSE LEAST(r.count+1,1000000000) END,
        until_ms=CASE WHEN r.until_ms<=${now} THEN ${now}+$3 ELSE r.until_ms END
        RETURNING count,GREATEST(1,ceil((until_ms-${now})/1000.0)) AS retry_after`, [kind, subjectHash, duration]);
      if (Number(result.rows[0].count) > limit) throw new CloudError(429, 'Too many account attempts. Please wait before trying again.', { retryAfter: Number(result.rows[0].retry_after) });
    },
    async close() { if (!closed) { closed = true; await pool.end(); } },
  };
}
