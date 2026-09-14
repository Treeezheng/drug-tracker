# Independent review, round 2 — server and restoration

Date: 2026-09-14. Baseline: `f6c01e75c29a24a758c4399f1df114aff7dd4045`, branch `codex/independent-security-review`, plus the pending server/configuration changes reviewed below. This is a fresh source-first assessment by a second reviewer. All server source was read before inspecting the pending diffs; earlier audit reports were not used as the basis for the findings.

## Result

No new high- or medium-severity cloud defect was confirmed in this pass. The selected synthetic tests passed **44/44, with no skips**, and an isolated PostgreSQL 18.6 dump/restore drill preserved a genuinely encrypted OPAQUE vault and its ability to be decrypted by the proper client credentials. This evidence is bounded: it is not a security guarantee or evidence that a production Heroku restoration has been performed.

Two low-severity local-edition issues were identified and fixed after the coordinating reviewer authorized the changes: a conditional session-validation ordering gap, and a reproduced simultaneous-startup journal-mode failure. The final affected local regressions passed 51/51, including seven new transaction-boundary cases. This reviewer made no Git, deployment, production-account, or production-database changes.

## Coverage and verified properties

Read in full: `server/index.mjs`, both `server/migrations/*.sql`, `server/cloud.mjs`, `cloud-opaque.mjs`, `cloud-opaque-postgres.mjs`, `cloud-postgres.mjs`, `cloud-sqlite.mjs`, `cloud-limits.mjs`, `cloud-session.mjs`, `cloud-errors.mjs`, `vault-store.mjs`, and `heroku.mjs`. Also inspected `Procfile`, `package.json`, `scripts/heroku-build.mjs`, `scripts/dev.mjs`, `deploy/Caddyfile`, both deployment environment examples, the systemd unit, and `.github/workflows/ci.yml`. The supporting client encryption and PAKE functions were used in the restoration drill; the separate client reviewer owns full client/UI coverage.

- **Cloud confidentiality:** OPAQUE routes do not accept a master password, export key or data-encryption key. The disabled legacy migration route is the explicit exception for old synthetic fixtures. The server receives ciphertext, an opaque wrapped key, OPAQUE records, and a recovery-authentication verifier; account identifiers, display names, timestamps and session metadata remain server-visible. Raw recovery authorization uses a separate random authentication component, not the vault key. Unexpected secret fields are rejected. Cloud errors do not echo request bodies or database details. No request logger was found in cloud handlers.
- **Ownership and CAS:** cloud HTTP vault access requires both an authenticated cookie and the exact selected owner. Both repository implementations repeat the session check inside the protected transaction. Vault envelopes must match that owner and preserve an exact revision; data/key envelopes are committed together. Ordinary OPAQUE saves cannot replace the wrapped key. Account changes check the current authentication version, appropriate session or recovery verifier, and vault revision. Password changes preserve the current data ciphertext.
- **Proof and session lifecycle:** challenges are random, stored by digest, source- and purpose-bound, expire after two minutes, and are consumed once. A stale proof cannot mint a session after an authentication-version change. PostgreSQL operations lock the account before the session where both are required. Sensitive changes atomically replace credentials, delete old sessions/challenges and, where appropriate, create one replacement session. Session cookies are scoped, HttpOnly, Secure in HTTPS mode, SameSite=Strict, and capped at 24 hours in cloud storage and cookie settings. Restore/restart does not renew creation-based lifetime.
- **Admission and memory:** a separate single-operation gate now limits unverified large authentication uploads; these do not reserve the protected vault slot before proof validation. The protected slot covers authenticated reads/writes and all OPAQUE responses carrying a vault, including successful login and recovery authorization. Gates remain reserved until both handler work and response finish/close. The parser rejects unsupported compression and enforces byte limits. Source-request quotas run before OPAQUE body reads, while valid-account budgets remain distinct. Unknown OPAQUE paths are rejected before admission/body handling. No live load or slow-request traffic was used to assess these paths.
- **Expired-session cleanup:** the PostgreSQL cleanup is bounded to 1,000 expired rows and uses `SKIP LOCKED`; it runs outside account/session transactions for ordinary registration and login, including OPAQUE. This avoids the previous account-lock/global-cleanup ordering hazard. Expired sessions are denied independently of whether their physical rows have been pruned. Cleanup is opportunistic, so old rows can remain during inactivity.
- **Static content:** cloud startup captures a bounded allowlist snapshot, requires the cloud edition marker, rejects symbolic-link leaves and non-regular/oversized files, validates the same open descriptor it reads, and does not consult request-derived filesystem paths afterward. Cloud API responses and HTML remain no-store; only public fingerprinted assets get immutable caching/compression. The trusted build directory and its ancestors must remain protected while startup walks it.
- **Deployments:** Heroku startup requires PostgreSQL and the router port, rejects local/insecure/alternate-proxy settings, and does not fall back to SQLite. PostgreSQL configuration strips URL TLS overrides, retains certificate/hostname verification, and sets bounded pool/query/lock timeouts. The Caddy template overwrites its dedicated source-IP header, preserves Host/Origin and `/drug`, and pairs with a loopback-only backend. The systemd template restricts filesystem writes and runs as a dedicated user. The CI workflow uses read-only default permissions, pinned action revisions and an isolated database service.
- **Local edition:** local source remains a separate plaintext SQLite application. Reviewed entity ownership, CAS, import validation, revision/tombstone retention, cookie checks, password/recovery races and local host/origin restrictions. It is not covered by the cloud ciphertext privacy claim.

The proxy assumptions were checked against current primary documentation: [Heroku routing](https://devcenter.heroku.com/articles/http-routing#heroku-headers) documents the router-observed IP appended to the right of X-Forwarded-For and recommends at least 90 seconds for idle keepalives; this supports quota attribution and the configured 95-second keepalive. Forwarded headers are not treated as authentication. [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers) documents header overwrite syntax and its default forwarding of Host and replacement of forwarded protocol information. The actual deployed Caddy configuration, any CDN chain, production Heroku routing and PostgreSQL TLS connection were not exercised.

## New conditional finding

**R2-S1 — Low, fixed: local session validation preceded SQLite transaction acquisition.**

Before the fix, `server/index.mjs` checked the session again after reading request bodies, but `putEntity`/`deleteEntity` started `BEGIN IMMEDIATE` later without validating the session inside it. Import performed its last session check before full archive validation and transaction acquisition. Private data/export reads similarly authenticated before beginning their transaction.

With a second process using the same local database, the first process can finish its session lookup, wait for the write lock, and acquire that lock after the other process has committed a logout or recovery. The saved owner alone does not establish that the session remains active. A session can also expire between prevalidation and acquisition. This is a source-supported ordering gap; **no lock-race exploit or slow-request reproduction was run**. The normal launcher reuses one verified local instance, so this is conditional hardening for multiple writers, not a demonstrated cloud exposure. Cloud repositories already perform their checks inside their transactions.

Authorized fix: `authenticatedTransaction` validates the current session and original selected owner inside the existing transaction, after `BEGIN IMMEDIATE` succeeds. Profile/entity saves, entity deletion, import, account deletion, and private data/export transactions now use it; the latter can also perform favorite cleanup. Existing owner checks, CAS, transactions and rollback semantics remain intact. `tests/local-transaction-auth.test.mjs` sends seven ordinary complete requests and deterministically revokes a synthetic session immediately before transaction acquisition through a database callback. Each returns 401 without changing account credentials, owner identifiers, records or revision history. This validates the boundary behavior without introducing lock contention or reproducing a slow-request attack.

**R2-S2 — Low, fixed: simultaneous local startup could fail while changing SQLite journal mode.**

The broader local regression run reported `database is locked` at the pre-existing `PRAGMA journal_mode=WAL` call, before the server accepted any request. The existing three-process concurrent-startup test reproduced it on an isolated rerun. This is a startup availability issue, separate from the session-hardening change; the test uses a new empty database and ordinary process launches. The authorized fix establishes busy handling before switching journal mode, retries only SQLITE_BUSY within one five-second startup budget, restores the normal five-second busy timeout after success, and closes/rethrows other or exhausted failures. Each retry receives only the remaining lock-wait budget. No migration operation is retried by this loop. The existing concurrent-startup regression passes after the fix, as does the affected local suite.

## Tests actually run

A fresh loopback-only PostgreSQL cluster and disposable temporary SQLite files were used. No production credential, health data, backup, account, host request, or database was accessed. Existing test cases that deliberately hold HTTP bodies or drive admission pressure were excluded from this review run.

| Test file | Coverage exercised |
| --- | --- |
| `tests/cloud-admission.test.mjs` | In-process proof-before-vault ordering, replay rejection and Caddy source parsing |
| `tests/cloud-sqlite-opaque.test.mjs` | SQLite migrations, setup persistence, challenge limits, CAS, atomic rollback and credential/session lifecycle |
| `tests/cloud-postgres-opaque.test.mjs` | Real PostgreSQL and ordinary local HTTP OPAQUE flows across instances, cleanup, password/recovery rotation, rollback and deletion |
| `tests/heroku-config.test.mjs` | Fail-closed Heroku options and PostgreSQL TLS configuration |
| `tests/api-local-auth.test.mjs` | Local setup, account selection, recovery and deletion |
| `tests/api-races.test.mjs` | Ordinary local concurrent saves/login/recovery and response privacy |
| `tests/vault-store.test.mjs` | Envelope limits, owner/CAS, restart durability and authentic client decryption |

Initial selected server result: **44 passed, 0 failed, 0 skipped**, approximately 3.24 seconds. The first broader local validation after the authorized fix passed 50/51 cases, including all seven new transaction-boundary cases; the one failure was R2-S2, also reproduced in a single-test rerun. After both fixes, the affected local suite (`tests/local-transaction-auth.test.mjs`, `tests/api-local-auth.test.mjs`, `tests/api-races.test.mjs`, and `tests/api.test.mjs`) passed **51/51 with no failures or skips**. These runs overlap with the initial selected tests and should not be added as a unique-test total. Final local evidence: `/private/tmp/drug-round2-local-final-tests.log`. Temporary evidence files on this workstation: `/private/tmp/drug-round2-server-tests.log` and `/private/tmp/drug-round2-restore-result.json`. `git diff --check` passed before writing this report.

## Final quota-test adaptation

The coordinator's first complete-suite run passed 554/555 cases. The sole failure was an older protocol-quota fixture that used the same source for five two-request registrations and six malformed login starts. Those 16 setup requests correctly exhausted the new early request budget (`loginAttemptLimit` 1 × 16) before the separate protocol-source assertions ran.

The fixture in `tests/cloud-opaque-api.test.mjs` now registers on a separate synthetic source. Its tested source stays below the early request cap while verifying that four consumed handshakes across different known accounts exhaust the protocol-source budget; malformed inputs leave account/protocol budgets intact. An additional bounded test sends 16 small, complete, sequential malformed requests and verifies that the next request receives 429 before content-type parsing, no challenge/session is created, and the known account remains available from a fresh source. No product quota changed and no test was skipped.

The affected OPAQUE API and in-process admission tests then passed **8/8, with no failures or skips**, approximately 1.82 seconds. Evidence: `/private/tmp/drug-round2-quota-final-tests.log`. This was quota-accounting verification using small ordinary requests, without delayed bodies, concurrent pressure or load generation. The coordinator owns the subsequent whole-suite rerun.

## Isolated restoration drill

The reviewer created two new databases inside a new PostgreSQL 18.6 loopback cluster. A real OPAQUE registration stored an AES-GCM-encrypted synthetic record and a v3 export-key-wrapped data key in the first database. After closing the repository, `pg_dump --format=custom --no-owner --no-acl` created a 13,205-byte synthetic archive; `pg_restore --exit-on-error --no-owner --no-acl` restored it into the second empty database.

Verified after restoration:

1. The existing OPAQUE server setup and public key remained unchanged; startup did not create a replacement setup.
2. A fresh, complete OPAQUE login with the synthetic password succeeded against the restored repository.
3. Owner, revision, ciphertext, both envelopes and timestamps matched the original snapshot exactly.
4. The new login's client export key unwrapped the restored data key and decrypted the expected synthetic record. The proper client recovery bundle also decrypted it. An unrelated export key failed.
5. Stored account/vault rows contained neither the synthetic master password, the complete recovery bundle, nor the synthetic health note.

The checked-in repeatable procedure is `tests/helpers/run-synthetic-postgres-restore.sh`, with its client/protocol checks in `tests/helpers/synthetic-postgres-restore.mjs`. From the repository root, after installing the locked dependencies, run:

```sh
PG_BIN=/absolute/path/to/postgresql/bin \
NODE_BIN=/absolute/path/to/node24 \
  sh tests/helpers/run-synthetic-postgres-restore.sh
```

`PG_BIN` must contain `initdb`, `pg_ctl`, `pg_dump` and `pg_restore`. The wrapper needs Python 3 (`PYTHON_BIN` may override it), creates its own cluster and synthetic test URL, and does not read `DATABASE_URL` or existing backups. It must run as a regular non-root user, with local socket/listen permission. It never restores over an existing database. The generated dump contains synthetic authentication material, so the wrapper deletes it with the entire cluster on exit. The checked-in wrapper itself was rerun successfully against a second fresh PostgreSQL 18.6 cluster; that independently generated synthetic dump was 13,211 bytes, with every listed check passing. Dump bytes vary because the credentials, identifiers and ciphertext are freshly generated.

The temporary cluster, databases and synthetic archive were removed by the drill's cleanup. The drill does **not** prove Heroku backup availability, backup age, provider retention, production restore permissions, a production recovery objective, or safe post-restore deletion/revocation state. A database rollback can resurrect old accounts, authentication records, sessions, recovery verifiers and ciphertext. Before making a restored production copy available, reconciliation of later deletions and security changes, invalidation of restored sessions/challenges, and credential/recovery policy need a separate controlled procedure; a successful decryption check does not establish those properties.

## Remaining limits

No penetration test, DoS/load test, slow-response/body experiment, exhaustive parser fuzzing, independent cryptographic proof, dependency binary audit, live TLS handshake, or production backup/restore was performed. Maximum-payload resident memory and large-account startup/cleanup performance were inspected structurally but not benchmarked. Public static handling still assumes a trusted build directory; the local server assumes a trusted Mac and retains plaintext records/history as documented. PostgreSQL schema scans and owner-session queries can require additional indexing or pagination if deployment scale increases. Final release evidence must come from the final committed tree, complete CI and the authorized publisher's deployment checks.
