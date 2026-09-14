# Cloud edition API

Working-tree contract verified with synthetic local traffic on 13 September 2026. This is not confirmation that the current production release contains these changes. The separate entry point `server/cloud.mjs` never imports the local plaintext server, exposes none of its record endpoints, and rejects databases containing local-edition tables. See the [OPAQUE protocol](./opaque-protocol-v1.md) for every registration, login and recovery message, and the [dated server review](./security-review-server-2026-09-13.md) for evidence and limits.

## Account and storage boundary

New accounts use one password through pinned `@serenity-kit/opaque` 1.1.0. Neither that password nor the client OPAQUE export key appears in a server request. Registration atomically creates the account, initial encrypted vault, recovery verifier and session. The server stores an OPAQUE password file, not a raw password or a scrypt hash of the new master password. The shared OPAQUE session key is not the browser's data-encryption or wrapping key.

The service starts with an empty database and accepts secure registration. Usernames normalize to lowercase and use 3–64 ASCII letters, numbers, dots, underscores or hyphens, beginning with a letter or number. Optional display names are trimmed, nonempty and at most 100 characters. Registration needs no email or identity verification. Duplicate usernames return 409, so username existence is not secret. The client applies its strength policy locally; a server that never receives the password cannot independently score it.

Production raw `/auth/register`, `/auth/login`, legacy password-confirmation routes and migration routes are disabled. Legacy sessions are not accepted in production. The programmatic `allowLegacyRegistration: true` option exists only for explicit synthetic compatibility tests; there is no environment flag. Legacy bootstrap helpers do not create a usable primary OPAQUE account and are not deployment setup instructions. Stored old accounts and ciphertext are not automatically deleted or merged.

SQLite needs an explicit absolute `CLOUD_DB_PATH`, separate from `DOSE_DB_PATH`; new files use mode 0600 and new parent directories 0700. Heroku uses PostgreSQL only, without fallback to SQLite. Schema version 3 preserves legacy IDs, credentials, sessions and encrypted bytes while adding OPAQUE mode/version, recovery verifiers, shared challenges and a singleton setup secret. Schema migration and setup initialization are transactional. An optional setup override must match the stored value; existing OPAQUE accounts with missing setup fail closed. Setup is authentication material, not a DEK. Theft of the database including setup can enable offline password guessing.

`createCloudServer({ dbPath, origin, allowInsecureLoopback?, distDir? })` returns `{ server, closeStorage, edition: 'cloud' }` without listening. Standalone startup binds `127.0.0.1`, port `CLOUD_PORT` or 4312, and requires an exact `CLOUD_ORIGIN`, normally `https://treeezh.com`. HTTP needs an explicit development flag with a loopback origin. Heroku uses its platform port and strictly verified PostgreSQL TLS. Forwarded headers cannot relax host/origin checks.

The CLI serves a cloud build under `/drug/`. Startup requires exactly one real cloud-edition HTML marker and snapshots entry HTML and optional `privacy.html`/`terms.html`; legal pages disable scripts. Other HTML, traversal and escaping symlinks fail closed. Public fingerprinted assets may be compressed/cached; API and entry/legal HTML responses remain `no-store`. API-only tests may omit `distDir`.

## HTTP contract

All paths begin `/drug/api`. Mutations require exact Origin; a supplied GET Origin must also match. Host must match the configured host and port. Cross-site Fetch Metadata is rejected. Bodies use uncompressed `application/json`.

| Request | Response |
| --- | --- |
| `GET /edition` | `{ edition: 'cloud' }`. |
| `GET /session` | `{ user: null }` or `{ user: { id, name, username, authMode: 'opaque-v1' } }`; no token or secret. A cookie alone does not unlock browser records. |
| `GET /security` with owner header | Current session creation/expiry, active-session count and `sessionLifetimeHours: 24`; no IP, fingerprint or health activity. |
| `/auth/opaque/*` | Exact two-phase registration/login, purpose-bound reauthentication, password replacement and recovery messages in the [protocol](./opaque-protocol-v1.md). |
| `POST /auth/logout` with `{}` | `{ ok: true }`, clears the cookie and revokes only that session. A supplied owner header must match. |
| `POST /auth/logout-all` with `{ reauthGrant }` and owner header | `{ ok: true }`, clears the cookie, revokes all owner sessions and increments its authentication version. Needs fresh proof for `logout-all`. |
| `DELETE /account` with `{ reauthGrant }` and owner header | `{ ok: true }`, clears the cookie and atomically deletes the account, vault, sessions and challenges. Needs fresh proof for `delete-account`. |
| `GET /vault` with owner header | `{ vault: { ownerId, revision, dataEnvelope, keyEnvelope, createdAt, updatedAt } }`. Primary registration creates a vault; generic storage also represents `null`. |
| `PUT /vault` with owner header and `{ expectedRevision, dataEnvelope, keyEnvelope }` | The saved snapshot after atomic revision CAS. For OPAQUE, the existing key envelope must remain identical. |

The mandatory owner header is `X-Dose-Owner`; ownership comes from the current session, never the body. Missing/stale/mismatched owner headers return 401; an envelope with a different owner returns 403. Invalid fields return 400, stale vault revisions 409 with `currentRevision`. There is no server merge or plaintext schema inspection. Clients reconcile interrupted acknowledgments before repeating writes. Only dedicated security endpoints may rewrap/rotate an OPAQUE key; ordinary PUT cannot downgrade it or separate the password file from its wrapper.

Password change preserves exact data ciphertext and the recovery verifier while atomically replacing the OPAQUE record, wrapper and all sessions with one new session. Recovery and recovery-key rotation replace DEK, ciphertext, wrapper and recovery verifier; all previous sessions are revoked. Commits recheck current session/authentication version and applicable recovery hash/vault revision in the transaction. PostgreSQL owner→session→vault locks serialize operations. A previously claimed login proof cannot recreate a session after all-device logout, rotation or deletion.

Recovery uses `DTR1.<owner>.<independent-auth-secret>.<DEK>`. Only the auth half is sent to `/recover/authorize`; the complete code and DEK stay in the browser. Its stored verifier hashes decoded random auth bytes. Authorization permits a short-lived ciphertext read; final recovery rotates both secrets atomically. Abandoned recovery leaves existing credentials and data intact. This cannot recover records when both password and recovery code are lost, erase downloaded ciphertext, or prove forensic deletion from provider backups.

## Sessions, abuse controls and metadata

The production cookie is `__Secure-drug_cloud_session`: Secure, HttpOnly, SameSite=Strict, Path=/drug/, with 24-hour absolute expiry. Only a SHA-256 digest of its independent random 32-byte token is stored. Startup caps old sessions from original creation time without extending them on restart. Development loopback HTTP uses a separate non-Secure cookie. Ambiguous/duplicate cookies fail closed.

OPAQUE challenges/grants last 120 seconds and are one-use. Stored handle digests bind source, purpose, username, owner, auth version and applicable session/revision. Pending caps are 1,000 global, 40 per source and 12 per username. Login/recovery starts also share a default 120-per-15-minute source budget and 30-per-15-minute account budget; consuming a challenge never resets quotas. Unknown names share a source bucket. Registration allows 10 starts per source per hour. Malformed basic fields do not spend a valid account's quota. SQLite cumulative quotas use bounded process memory; PostgreSQL counters and both repositories' challenges are database-shared. Expiry cleanup runs during subsequent relevant operations, not a dedicated timer.

Standalone quotas use the socket peer. Only the explicit Heroku adapter uses its router-appended final validated IP, ignoring spoofable left entries, rejecting invalid/missing final addresses and canonicalizing IPv6. This is a quota source, not authentication. NAT/proxy users may share quotas. See [Heroku headers](https://devcenter.heroku.com/articles/http-routing#heroku-headers).

Each process allows eight account HTTP operations, two cryptographic operations and one large encrypted operation. Small OPAQUE bodies allow 16,384 bytes; large finish requests allow base64url expansion of 16,000,016 ciphertext bytes plus bounded metadata. Contention returns 429/Retry-After. A large reservation is released only after handler work AND response completion/close, including blocked SQL after disconnect. Requests already aborted before body listeners are installed are rejected. These controls do not establish protection against distributed floods or targeted username-quota exhaustion.

API responses/errors are no-store, with no permissive CORS. CSP, frame denial, no-referrer, nosniff and disabled camera/microphone/location policies apply, plus HSTS on HTTPS. Cloud CSP permits only WebAssembly-specific `wasm-unsafe-eval` for bundled cryptography, not JavaScript `unsafe-eval`; legal pages remain script-free.

Application logs omit bodies, credentials, secrets, health values and ciphertext. Account names, session metadata, ciphertext sizes/timestamps and pseudonymous quota metadata remain visible. Provider logs/backups have separate controls. The operator supplies browser code and could change a later build; published source and authenticated encryption do not remove that trust boundary or independently prevent replay of an old valid snapshot.

## Executed checks

Current focused selections passed **41/41** SQLite/API/legacy-composition tests and **25/25** real PostgreSQL/OPAQUE/configuration tests, zero skips. Temporary synthetic databases and loopback ports were created and removed; no real user or production database was used. These selections overlap earlier results and are not a combined unique count.

Coverage includes atomic initial registration, cross-instance PAKE/ciphertext persistence, schema/setup races, fake unknown-account/recovery response shape, proof/purpose/source/owner rejection, TTL/one-use limits, cumulative source quotas, raw-secret field rejection, production legacy-route disablement, CAS and session-insertion rollback, stale proof/session revocation, recovery rotation, unchanged-ciphertext rewrapping, account isolation/deletion, and actual PostgreSQL lock/disconnect ordering. Client HTTP tests also inspect synthetic wire/database contents for masters, full recovery codes, DEKs and health plaintext. Final full-suite results belong in the [dated review](./security-review-server-2026-09-13.md).

## Guest boundary

Guest simulation makes no account/vault requests and cannot create Taken, symptoms or supply records. Its versioned local-storage key is unencrypted; retention follows the visible guest choice. Secure registration starts with an empty encrypted snapshot and never uploads guest data. See [Privacy](../PRIVACY.md) for browser drafts, decrypted exports and cloud ciphertext.
