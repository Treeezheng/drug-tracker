# Standalone encrypted-vault storage

Status on 13 September 2026: implemented first as an independent storage primitive, then connected only to the separate `server/cloud.mjs` service. The original local `server/index.mjs` does not import this module. Its SQLite records, browser cache/outbox, and ordinary JSON/CSV/PDF exports remain plaintext. See [the cloud API contract and actual test status](./cloud-api.md); adding this module does not establish that a public deployment has been verified.

## Contract

`openVaultStore({ dbPath })` from `server/vault-store.mjs` opens an explicitly chosen SQLite database. It has no default path and never selects the application's existing database implicitly. New database files use mode 0600; newly created parent directories use 0700. `:memory:` is available for tests.

The returned store provides:

| Method | Result |
| --- | --- |
| `read(ownerId)` | `null`, or `{ ownerId, revision, dataEnvelope, keyEnvelope, createdAt, updatedAt }`. |
| `write(ownerId, { expectedRevision, dataEnvelope, keyEnvelope })` | The complete saved snapshot. Revision 0 means no existing vault; a successful write increments the revision by 1. |
| `export(ownerId)` | `{ format: 'dose-timeline-encrypted-backup', version: 1, exportedAt, vault }`; the vault contains encrypted envelopes and public metadata only. Missing vaults return a 404 error. |
| `close()` | Closes the connection; repeat calls are harmless. Subsequent operations fail with 503. |

The caller **must derive `ownerId` from a trusted authenticated session**, separately from the request body. This primitive has no authentication layer. The owner must be an explicit 1–128-character identifier using ASCII letters, numbers, `_`, or `-`. Read, update, and export queries always bind that owner. Both submitted envelopes must identify the same owner; an envelope mismatch fails with 403.

`VaultStoreError` exposes `status` and `message`. A stale write fails with 409 and `currentRevision`; a malformed envelope or revision fails with 400. Stale writes are never silently merged or applied. Retrying an acknowledged write with its previous revision produces a conflict, so an eventual client must reconcile its result rather than assuming HTTP-style idempotency.

Only the latest encrypted snapshot is retained per owner. Data and wrapped key are replaced together under `BEGIN IMMEDIATE`, after a compare-and-swap revision check. Validation occurs before the transaction. Any write failure rolls back both envelopes. Concurrent processes cannot each create revision 1 for the same owner. The revision is a positive JavaScript-safe integer; it is never reset by this module. No deletion or backup-import endpoint is provided here.

## Accepted envelopes

The protocol matches `src/lib/vault-crypto.ts`. Every layer uses exact fields; extra properties, accessors, non-plain objects, plaintext health objects, passwords, and raw recovery-key fields are rejected.

Common fields are `protocol: 'dose-timeline-vault'`, `version`, `ownerId`, `cipher: 'AES-256-GCM'`, `iv`, and `ciphertext`. Data envelopes keep `version: 1` and `kind: 'data'`. Wrapped-key envelopes use `kind: 'wrapped-key'` and one of the following exact profiles:

- Legacy version 1: `kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt }`, with integer iterations from 600,000 through 2,000,000.
- Version 2: `kdf: { name: 'Argon2id', version: 19, memoryKiB: 65536, iterations: 3, parallelism: 1, salt }`. Every numeric parameter is fixed, including the Argon2 version. There is no caller-selected memory, work factor, parallelism or algorithm.
- Version 3: `kdf: { name: 'OPAQUE-export', hash: 'SHA-256', context: 'drug-tracker:opaque:v1', salt }`. The browser uses HKDF-SHA256 over its client-only OPAQUE export key. The server receives neither this export key nor the data key.

A version-1 data envelope pairs with a version-1, 2 or 3 wrapped key. This generic storage primitive validates shape only. The cloud authentication repository imposes an additional rule: ordinary OPAQUE-account PUT must retain the exact v3 wrapper; only specialized atomic credential/recovery operations can change it. Legacy fixtures can still exercise v1/v2. No partial key-only write is exposed.

Binary fields must use canonical, unpadded base64url. The IV decodes to exactly 12 bytes, the salt to 16 bytes, and wrapped-key ciphertext to 48 bytes. Data ciphertext must be 17–16,000,016 bytes, including its 16-byte authentication tag. PBKDF2 iterations must be an integer from 600,000 through 2,000,000. Unknown protocol versions, algorithms, and envelope fields fail closed.

These are **structural checks**, not proof of encryption or authenticity. The server cannot detect a well-formed, tampered ciphertext, validate its medication contents, or establish that a wrapped key decrypts the data. The browser's authenticated decryption must verify those properties and then validate the application domain schema before restoring data. Public metadata such as owner ID, timestamps, envelope sizes, and KDF parameters remain visible.

Passwords, raw data keys and complete recovery codes stay in the client. New cloud accounts use the single-password OPAQUE protocol; only its independently random recovery-auth half reaches the dedicated recovery service, never this storage primitive. The separate cloud API supplies authenticated ownership and atomic account/key coupling. Browser key lifecycle, conflict/recovery behavior, validation after decryption and deployment require their own integration checks.

## Executed verification

`node --test tests/vault-store.test.mjs` passes **9 tests** using Node.js 24 and temporary synthetic databases on this Mac:

- Real browser-compatible Web Crypto envelopes persist across reopen, decrypt to the original synthetic AppData, and export without plaintext health values, passphrases, or raw recovery keys. The same synthetic secrets are absent from the database and its journal files.
- Independent SQLite connections observe revisions and atomically replace the data/key pair; owners remain isolated.
- Four concurrent workers initialize one database and attempt the first write; exactly one succeeds and three receive revision conflicts.
- Invalid plaintext/extra fields, owner mismatches, bad versions, and malformed wrapped keys preserve the previous snapshot and revision.
- Encoding, maximum data size, IV/key lengths, and KDF limits match the client protocol. Mixed data-v1/key-v2 updates are accepted atomically; malformed Argon2 versions, algorithms, memory, work, parallelism, salts and extra fields preserve both previous envelopes. Legacy PBKDF2 remains accepted.
- Data-v1/key-v3 pairs accept only the exact OPAQUE-export/SHA-256 context. Wrong context, work fields, raw export-key fields, invalid salt and data-v3 downgrade-shaped objects leave both saved envelopes unchanged.
- Structurally valid ciphertext tampering and relabeled owner metadata are stored opaquely, then rejected by actual client authenticated decryption.
- Missing owners, accessors, inherited fields, and closed-store operations are rejected; rejected accessors are never executed.

These are storage/crypto integration tests, not a deployed HTTP test, a browser-engine matrix, or an independent security audit.
