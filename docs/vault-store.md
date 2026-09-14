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

Common fields are `protocol: 'dose-timeline-vault'`, `version: 1`, `ownerId`, `cipher: 'AES-256-GCM'`, `iv`, and `ciphertext`. The data envelope has `kind: 'data'`. The wrapped-key envelope has `kind: 'wrapped-key'` and the additional field `kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt }`.

Binary fields must use canonical, unpadded base64url. The IV decodes to exactly 12 bytes, the salt to 16 bytes, and wrapped-key ciphertext to 48 bytes. Data ciphertext must be 17–16,000,016 bytes, including its 16-byte authentication tag. PBKDF2 iterations must be an integer from 600,000 through 2,000,000. Unknown protocol versions, algorithms, and envelope fields fail closed.

These are **structural checks**, not proof of encryption or authenticity. The server cannot detect a well-formed, tampered ciphertext, validate its medication contents, or establish that a wrapped key decrypts the data. The browser's authenticated decryption must verify those properties and then validate the application domain schema before restoring data. Public metadata such as owner ID, timestamps, envelope sizes, and KDF parameters remain visible.

Vault passphrases and raw vault recovery keys must stay in the client. They are separate from the existing server authentication password and server-generated account recovery code. The module accepts neither. The separate cloud API now supplies authenticated owner binding. Browser key lifecycle, conflict/recovery behavior, domain validation after decryption, migration/export UX, and deployment need their own integration verification; this storage module alone cannot establish those properties.

## Executed verification

`node --test tests/vault-store.test.mjs` passes **7 tests** using Node.js 24.19.0 and temporary synthetic databases on this Mac:

- Real browser-compatible Web Crypto envelopes persist across reopen, decrypt to the original synthetic AppData, and export without plaintext health values, passphrases, or raw recovery keys. The same synthetic secrets are absent from the database and its journal files.
- Independent SQLite connections observe revisions and atomically replace the data/key pair; owners remain isolated.
- Four concurrent workers initialize one database and attempt the first write; exactly one succeeds and three receive revision conflicts.
- Invalid plaintext/extra fields, owner mismatches, bad versions, and malformed wrapped keys preserve the previous snapshot and revision.
- Encoding, maximum data size, IV/key lengths, and KDF limits match the client protocol.
- Structurally valid ciphertext tampering and relabeled owner metadata are stored opaquely, then rejected by actual client authenticated decryption.
- Missing owners, accessors, inherited fields, and closed-store operations are rejected; rejected accessors are never executed.

These are storage/crypto integration tests, not a deployed HTTP test, a browser-engine matrix, or an independent security audit.
