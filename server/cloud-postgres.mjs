import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { CloudError } from './cloud-errors.mjs';
import { validateVaultWrite, VaultStoreError } from './vault-store.mjs';

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
      if (meta && (meta.edition !== 'drug-cloud-encrypted' || meta.version !== 1)) throw new CloudError(400, 'Unsupported PostgreSQL cloud database version.');
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
        CREATE TABLE drug_tracker.rate_limits (kind TEXT PRIMARY KEY CHECK(kind IN ('login','register')), count BIGINT NOT NULL, until_ms BIGINT NOT NULL);
        INSERT INTO drug_tracker.meta VALUES (1,'drug-cloud-encrypted',1);`);
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
  const addSession = async (client, owner, value) => {
    await client.query('INSERT INTO drug_tracker.sessions VALUES ($1,$2,$3,$4)', [value.tokenHash, owner, value.expiresAt, new Date().toISOString()]);
  };
  const snapshot = row => row ? {
    ownerId: row.owner_id, revision: Number(row.revision), dataEnvelope: row.data_envelope,
    keyEnvelope: row.key_envelope, createdAt: row.created_at, updatedAt: row.updated_at,
  } : null;
  const read = async (client, owner) => snapshot((await client.query('SELECT * FROM drug_tracker.vaults WHERE owner_id=$1', [owner])).rows[0]);
  return {
    accountByUsername: async name => (await pool.query('SELECT * FROM drug_tracker.accounts WHERE username=$1', [name])).rows[0] ?? null,
    session: async tokenHash => (await pool.query(sessionQuery, [tokenHash])).rows[0] ?? null,
    async register(account, value) {
      await pool.query('DELETE FROM drug_tracker.sessions WHERE expires_at<=floor(extract(epoch FROM clock_timestamp())*1000)::bigint');
      try {
        return await transaction(async client => {
          await client.query('INSERT INTO drug_tracker.accounts VALUES ($1,$2,$3,$4,$5)', [account.id, account.username, account.password_hash, account.name, new Date().toISOString()]);
          await addSession(client, account.id, value);
          return account;
        });
      } catch (error) { if (error.code === '23505' && error.constraint === 'accounts_username_key') throw new CloudError(409, 'Username is unavailable.'); throw error; }
    },
    async login(account, value) {
      // Expired-session cleanup must finish before holding an account lock (writes lock session first).
      await pool.query('DELETE FROM drug_tracker.sessions WHERE expires_at<=floor(extract(epoch FROM clock_timestamp())*1000)::bigint');
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
    readVault(owner, tokenHash) {
      return transaction(async client => { await requireSession(client, owner, tokenHash); return read(client, owner); });
    },
    writeVault(owner, tokenHash, input) {
      const accepted = validateVaultWrite(owner, input);
      return transaction(async client => {
        await requireSession(client, owner, tokenHash);
        // Lock the existing owner row, including before their first vault exists. No first-write upsert race.
        await client.query('SELECT id FROM drug_tracker.accounts WHERE id=$1 FOR UPDATE', [owner]);
        const current = (await client.query('SELECT revision,created_at FROM drug_tracker.vaults WHERE owner_id=$1', [owner])).rows[0];
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
    async consumeRateLimit(kind, limit, duration) {
      // One fixed-window budget per app/database; forwarded IP headers cannot evade it across dynos.
      const now = 'floor(extract(epoch FROM clock_timestamp())*1000)::bigint';
      const result = await pool.query(`INSERT INTO drug_tracker.rate_limits AS r VALUES ($1,1,${now}+$2)
        ON CONFLICT(kind) DO UPDATE SET count=CASE WHEN r.until_ms<=${now} THEN 1 ELSE LEAST(r.count+1,1000000000) END,
        until_ms=CASE WHEN r.until_ms<=${now} THEN ${now}+$2 ELSE r.until_ms END
        RETURNING count,GREATEST(1,ceil((until_ms-${now})/1000.0)) AS retry_after`, [kind, duration]);
      if (Number(result.rows[0].count) > limit) throw new CloudError(429, 'Too many account attempts. Please wait before trying again.', { retryAfter: Number(result.rows[0].retry_after) });
    },
    async close() { if (!closed) { closed = true; await pool.end(); } },
  };
}
