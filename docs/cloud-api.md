# Cloud edition API

Implemented and tested locally on 13 September 2026. The separate entry point is `server/cloud.mjs`. It never imports `server/index.mjs`, exposes none of the local plaintext record endpoints, and refuses databases containing the local edition's tables. There has been no public deployment or independent security audit in this verification.

## Process and database boundary

`bootstrapCloudAccount({ dbPath, username, password, name? })` is an optional operator-only function for creating the first account in an empty database. The service can start with an empty database and accept public registration. A bootstrapped account has the same permissions as a registered account; it is not a special administrator. Bootstrap creates the account, hashes the password with scrypt (`N=32768`, `r=8`, `p=1`, 16-byte random salt, 64-byte derived hash), and returns `{ user: { id, name } }`. The username is normalized to lowercase and accepts 3–64 ASCII letters, numbers, dots, underscores, and hyphens, starting with a letter or number. The bootstrap password accepts 10–256 characters. Concurrent bootstraps have one winner; subsequent attempts fail with 409 and cannot replace or merge an existing account.

The CLI accepts `bootstrap` or `start`, never password arguments. One-time bootstrap reads `CLOUD_ADMIN_USERNAME`, `CLOUD_ADMIN_PASSWORD`, and optionally `CLOUD_ADMIN_NAME` from the environment. The account password must not be the browser's independent vault passphrase. Remove the bootstrap password from the operator environment afterward; service startup rejects it if still present. Public registration is available through the separate route below. There is no self-service account-reset, account-deletion, local-setup, or account-recovery endpoint.

`CLOUD_DB_PATH` must explicitly name an absolute, separate database path. There is no implicit default and no use of `DOSE_DB_PATH`. New files use mode 0600, and newly created parent directories use 0700. Unknown schema tables are rejected before changing existing database contents or enabling journals. Cloud account/session metadata and encrypted vaults share this dedicated database; no plaintext medication entities or history tables are created. Schema version 2 supports multiple accounts, with stable account IDs as primary keys and unique normalized usernames. Version 1 migrates transactionally: existing account IDs, password hashes, sessions and owner-bound vaults are retained. Failed migrations roll back. No real user database was migrated during these tests.

`createCloudServer({ dbPath, origin, allowInsecureLoopback?, distDir? })` returns `{ server, closeStorage, edition: 'cloud' }`. It does not listen until the caller explicitly starts it. The CLI binds only `127.0.0.1`, using `CLOUD_PORT` or **4312**. It requires the exact configured `CLOUD_ORIGIN`, normally `https://treeezh.com`. HTTP requires the explicit `CLOUD_ALLOW_INSECURE_LOOPBACK=1` development flag and an exact localhost/loopback origin; that flag cannot permit HTTP for a public hostname. Forwarded headers never relax host, origin, or rate-limit checks.

The CLI serves `CLOUD_DIST_PATH` or `dist/` under `/drug/`. Startup requires exactly one `<meta name="drug-edition" content="cloud">` marker in the frontend entry HTML. Local builds, commented markers, and ambiguous duplicate edition markers are rejected. The edition-checked entry HTML and an optional `privacy.html` are read into startup snapshots. Other HTML files are not served. The privacy snapshot has scripts disabled by CSP. Symlinks escaping the build directory and missing assets fail with 404. The programmatic factory can omit `distDir` for API-only tests; the CLI always validates a build.

## HTTP contract

All API paths start with `/drug/api`. GET requests may omit `Origin`; if supplied it must exactly match the configured origin. Every mutation, including login and logout, requires that exact origin. `Host` must exactly match the configured host and port. Cross-site Fetch Metadata requests fail with 403. JSON requests use `application/json`; compressed bodies are rejected.

| Request | Response |
| --- | --- |
| `GET /edition` | `{ edition: 'cloud' }`. |
| `GET /session` | `{ user: null }` or `{ user: { id, name } }`; no password, recovery secret, or session token is returned. The display name may equal the username. |
| `POST /auth/register` with `{ username, password, name? }` | 201 `{ user: { id, name } }` and a new session cookie. Creates only an account and session; no vault or health records are seeded. |
| `POST /auth/login` with `{ username, password }` | `{ user: { id, name } }` and a new session cookie. Invalid credentials receive a generic 401. |
| `POST /auth/logout` with `{}` | `{ ok: true }` and a cleared cookie. Revokes the selected session; another device's independent session remains valid. |
| `GET /vault` with `X-Dose-Owner: <session user id>` | `{ vault: null }` or `{ vault: { ownerId, revision, dataEnvelope, keyEnvelope, createdAt, updatedAt } }`. |
| `PUT /vault` with the same owner header and `{ expectedRevision, dataEnvelope, keyEnvelope }` | `{ vault: <saved snapshot> }`; both encrypted envelopes are replaced atomically. |

Registration uses the same username normalization as bootstrap; the account password requires 10–256 characters. Optional display name must be nonempty after trimming and at most 100 characters; omitted name defaults to the normalized username. Extra fields, including encryption passphrases or recovery keys, are rejected. Duplicate usernames receive 409, so registration can disclose username existence. Registration requires no email address or identity verification.

The owner header is mandatory for both vault methods. The owner comes from the authenticated session, never the body. A missing or mismatched header fails with 401 so the client closes the previous account's decrypted workspace; an envelope's owner mismatch fails with 403. Logout also checks the header when supplied and rejects an account mismatch with 401 without clearing the other account's session. Vault updates recheck the session after receiving the request body so an upload that was still in progress during logout cannot save afterward.

Revision 0 creates a new encrypted vault. A save increments the existing revision by one. Stale writes fail with **409** and `{ error, currentRevision }`. The server performs no implicit merge or overwrite and cannot inspect medication contents. The client must reconcile interrupted acknowledgments before retrying. Envelope fields and limits are defined in [the vault storage contract](./vault-store.md). Authentication bodies are limited to 4,096 bytes; a vault body allows the base64url expansion of the 16 MB plaintext limit plus bounded envelope metadata.

The production cookie is `__Secure-drug_cloud_session`, with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/drug/`, and a 30-day lifetime. Only a SHA-256 hash of a random 32-byte session token is stored. Explicit loopback HTTP development uses a separate `drug_cloud_dev_session` cookie without Secure. Duplicate/ambiguous cookies and expired sessions cannot read a vault. API responses and errors are `no-store`; no permissive CORS header is sent. Same-origin CSP, frame denial, no-referrer, nosniff, and disabled camera/microphone/location policies are set. HTTPS deployments also receive HSTS.

Login attempts are limited globally to 30 per 15 minutes. Registration has a separate global limit of 10 attempts per hour. Both routes share a maximum of two password hashing or verification operations in progress. These are service-wide limits, so other users can exhaust the same limit. This deliberately does not trust a client-supplied forwarded IP. A 429 includes `Retry-After`. These counters are in process memory, so restarting the service resets them; reverse-proxy/network protection is an additional deployment concern. Request bodies, secrets, health values, and ciphertext are not logged by this service. Public reverse-proxy logs and hosting-provider connection metadata have separate retention settings.

## Executed checks

`node --test tests/cloud-api.test.mjs tests/vault-store.test.mjs` passes **22 tests** on this Mac using temporary synthetic databases and loopback ports. The 15 cloud API tests verify:

- Public registration into an empty server, distinct account IDs and isolated vaults, rejected secret/extra fields, duplicate-name races, and registration throttling independent from login.
- Version 1 to version 2 migration retains synthetic account IDs, sessions and encrypted vault bytes; concurrent migrations and a forced relationship failure verify atomicity and rollback.
- Exact configuration, optional one-time bootstrap races, hash-only credentials, and byte-for-byte preservation of a rejected synthetic local database.
- Scoped production cookies, no-store/privacy headers, session discovery, generic failed login, and absence of plaintext health-record and unsupported account-management routes.
- Host/origin/CSRF rejection, ignored spoofed forwarded addresses, mandatory owner binding, and isolation between independently bootstrapped services.
- Real client encryption and wrapping through the HTTP API, restart persistence, and successful client decryption without plaintext health notes or vault passphrases appearing in the database.
- One winner for concurrent revision updates, with matching data/key envelopes and no partial malformed-key update.
- Revocation of one session while preserving another, expiry and duplicate-cookie rejection, and a deliberately stalled upload rejected after logout.
- Login throttling, invalid JSON/content types, and a bounded 413 response for oversized chunked bodies.
- Rejection of local/ambiguous builds, safe `/drug` static routing, startup snapshots for the entry and privacy pages, and rejection of traversal, escaping symlinks, and other HTML.
- Explicit loopback-only HTTP development behavior.

Client integration, browser interaction, responsive layout, and deployment verification are separate checks. This API stores the latest encrypted snapshot; it does not create a correction-history archive, recover a lost vault secret, hide connection metadata, or certify forensic deletion. The original local edition remains separate and its storage/export behavior is unchanged.

## Guest boundary

The frontend guest simulator makes no account or vault requests. Its simulated rows and preferences use a separate versioned, unencrypted browser local-storage key. It cannot create Taken, symptoms or supply records. Opening the sign-in dialog explicitly checks the session; account setup uses a new empty encrypted snapshot and never supplies guest data. Successful unlock replaces the guest view with the account application. Public registration does not by itself encrypt any existing guest data. See [Privacy](../PRIVACY.md) for storage and application-code trust limits.
