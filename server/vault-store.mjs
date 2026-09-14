import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Standalone storage primitive. Intentionally not imported by index.mjs and not
// exposed through HTTP. An eventual auth layer must supply the trusted owner.
const PROTOCOL = 'dose-timeline-vault';
const MAX_DATA_BYTES = 16_000_016;
const COMMON_FIELDS = ['protocol', 'version', 'kind', 'ownerId', 'cipher', 'iv', 'ciphertext'];

export class VaultStoreError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.name = 'VaultStoreError';
    this.status = status;
    Object.assign(this, details);
  }
}
const invalid = message => { throw new VaultStoreError(400, message); };

function ownerId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid('An explicit stable vault owner is required.');
  return value;
}

function exactObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected a versioned encrypted envelope.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid('Expected plain envelope fields.');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key)
    || !descriptors[key].enumerable || !('value' in descriptors[key]))) invalid('Unsupported encrypted envelope fields.');
  return value;
}

function binary(value, minimum, maximum) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maximum * 4 / 3)
    || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) invalid('Invalid encrypted binary encoding.');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length < minimum || bytes.length > maximum || bytes.toString('base64url') !== value) invalid('Invalid encrypted binary length or encoding.');
}

function envelope(value, expectedOwner, kind) {
  exactObject(value, [...COMMON_FIELDS, ...(kind === 'wrapped-key' ? ['kdf'] : [])]);
  if (value.ownerId !== expectedOwner) throw new VaultStoreError(403, 'The encrypted envelope does not belong to the selected owner.');
  const supportedVersion = kind === 'data' ? value.version === 1 : value.version === 1 || value.version === 2 || value.version === 3;
  if (value.protocol !== PROTOCOL || !supportedVersion || value.kind !== kind || value.cipher !== 'AES-256-GCM') invalid('Unsupported encrypted envelope version or cipher.');
  binary(value.iv, 12, 12);
  binary(value.ciphertext, kind === 'wrapped-key' ? 48 : 17, kind === 'wrapped-key' ? 48 : MAX_DATA_BYTES);
  if (kind === 'wrapped-key') {
    const kdf = value.version === 1
      ? exactObject(value.kdf, ['name', 'hash', 'iterations', 'salt'])
      : value.version === 2 ? exactObject(value.kdf, ['name', 'version', 'memoryKiB', 'iterations', 'parallelism', 'salt'])
      : exactObject(value.kdf, ['name', 'hash', 'context', 'salt']);
    if (value.version === 1) {
      if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || !Number.isSafeInteger(kdf.iterations)
        || kdf.iterations < 600_000 || kdf.iterations > 2_000_000) invalid('Unsupported key derivation settings.');
    } else if (value.version === 2 && (kdf.name !== 'Argon2id' || kdf.version !== 19 || kdf.memoryKiB !== 65_536 || kdf.iterations !== 3 || kdf.parallelism !== 1)) {
      // Version 2 has one fixed resource profile; untrusted envelopes cannot request arbitrary work.
      invalid('Unsupported key derivation settings.');
    }
    if (value.version === 3 && (kdf.name !== 'OPAQUE-export' || kdf.hash !== 'SHA-256' || kdf.context !== 'drug-tracker:opaque:v1')) invalid('Unsupported export-key wrapping settings.');
    binary(kdf.salt, 16, 16);
  }
  return JSON.stringify(value);
}

/** Validates shape/size only. Authenticity and decryption remain client tasks. */
export function validateVaultWrite(expectedOwnerId, input) {
  ownerId(expectedOwnerId);
  exactObject(input, ['expectedRevision', 'dataEnvelope', 'keyEnvelope']);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) invalid('An exact nonnegative vault revision is required.');
  return {
    expectedRevision: input.expectedRevision,
    data: envelope(input.dataEnvelope, expectedOwnerId, 'data'),
    key: envelope(input.keyEnvelope, expectedOwnerId, 'wrapped-key'),
  };
}

/** No implicit owner, network, authentication password, vault secret, or plaintext health input. */
export function openVaultStore({ dbPath } = {}) {
  if (typeof dbPath !== 'string' || !dbPath) invalid('Choose an explicit encrypted-vault database path.');
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  if (dbPath !== ':memory:') chmodSync(dbPath, 0o600);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS encrypted_vaults (
      owner_id TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0 AND revision <= 9007199254740991),
      data_envelope TEXT NOT NULL CHECK(json_valid(data_envelope)),
      key_envelope TEXT NOT NULL CHECK(json_valid(key_envelope)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;`);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  let closed = false;
  function ready(owner) {
    ownerId(owner);
    if (closed) throw new VaultStoreError(503, 'The encrypted-vault store is closed.');
  }
  function snapshot(row) {
    return row ? {
      ownerId: row.owner_id, revision: row.revision,
      dataEnvelope: JSON.parse(row.data_envelope), keyEnvelope: JSON.parse(row.key_envelope),
      createdAt: row.created_at, updatedAt: row.updated_at,
    } : null;
  }
  function read(owner) {
    ready(owner);
    return snapshot(db.prepare('SELECT * FROM encrypted_vaults WHERE owner_id = ?').get(owner));
  }
  return {
    read,
    write(owner, input) {
      ready(owner);
      const accepted = validateVaultWrite(owner, input);
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = db.prepare('SELECT revision, created_at FROM encrypted_vaults WHERE owner_id = ?').get(owner);
        const revision = current?.revision ?? 0;
        if (revision !== accepted.expectedRevision) throw new VaultStoreError(409, 'This encrypted vault changed. Reload before saving.', { currentRevision: revision });
        if (revision >= Number.MAX_SAFE_INTEGER) throw new VaultStoreError(409, 'The encrypted vault revision limit was reached.');
        const timestamp = new Date().toISOString();
        db.prepare(`INSERT INTO encrypted_vaults VALUES (?,?,?,?,?,?)
          ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision, data_envelope=excluded.data_envelope,
          key_envelope=excluded.key_envelope, updated_at=excluded.updated_at`)
          .run(owner, revision + 1, accepted.data, accepted.key, current?.created_at ?? timestamp, timestamp);
        const saved = snapshot(db.prepare('SELECT * FROM encrypted_vaults WHERE owner_id = ?').get(owner));
        db.exec('COMMIT');
        return saved;
      } catch (error) {
        db.exec('ROLLBACK');
        if (error instanceof VaultStoreError) throw error;
        throw new VaultStoreError(500, 'The encrypted vault could not be saved.');
      }
    },
    export(owner) {
      const vault = read(owner);
      if (!vault) throw new VaultStoreError(404, 'No encrypted vault exists for this owner.');
      return { format: 'dose-timeline-encrypted-backup', version: 1, exportedAt: new Date().toISOString(), vault };
    },
    close() { if (!closed) { db.close(); closed = true; } },
  };
}
