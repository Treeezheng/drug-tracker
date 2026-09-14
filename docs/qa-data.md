# Data, authentication, and offline QA

Reviewed and executed on 13 September 2026 using Node.js 24.19.0 on this Mac. All server tests use temporary SQLite databases and explicitly synthetic users and health records. They do not read or mutate the app's real database.

## New findings and fixes

1. **Old-password login could survive a concurrent password recovery.** A login read the password hash, awaited scrypt, and issued a session after another request changed the password and revoked old sessions. A new concurrent-request test reproduced a valid old-password session after recovery completed. Login now rechecks the current hash inside a write transaction before issuing its session. The same check handles deletion of the account during verification. Recovery itself already rechecked its one-use code after asynchronous hashing.
2. **Two server launches could apply the same migration twice.** A new three-process startup test first passed alone, then reproduced `table users already exists` when run with the rest of the suite. Migration registration is now checked after obtaining `BEGIN IMMEDIATE`, so another process finishing while this process waits cannot cause duplicate application. The regression test passes after the fix, with two migration entries, no leftover replacement tables, and no foreign-key violations.
3. **An acknowledged online response could recreate a cache cleared after sign-out/account deletion.** Client acknowledgment previously patched IndexedDB unconditionally after receiving the server response. Each owner now has a persisted random cache invalidation marker, read and compared in the same cache/outbox transaction. A response begun before a clear still returns its successful server result, but cannot repopulate the cleared health cache. The marker contains no health data or authentication secret and works across separate client instances. Browser regression tests cover same-client and independent-client clearing; their execution status is below.

## Executed automated checks

| Suite | Result | What it establishes |
| --- | --- | --- |
| `tests/api.test.mjs` and `tests/api-races.test.mjs` together | **32 passed** | Existing authentication, expected-owner isolation, strict quantities/UTC times, revisions, tombstones, retry idempotency, restart persistence, complete backup recovery, atomic failed imports, inventory migration, and new concurrency/privacy cases. |
| New concurrent write/export tests | Passed within the 32 | Eight identical create requests produce revision 1 once; conflicting corrections have one winner and one 409; an export concurrent with deletion remains internally consistent. |
| New recovery/deletion tests | Passed within the 32 | Concurrent use of one recovery code yields one success; recovery revokes old-password concurrent logins; hard deletion leaves no valid session from a concurrent old-password login. |
| Privacy headers and session tests | Passed within the 32 | Private and error responses are no-store, no-referrer, nosniff, frame-denied, with camera/microphone/location disabled and no permissive CORS header. Export has no passwords, password/recovery/token hashes, raw session token, or recovery code. Signing out one browser preserves another browser's independent session. |
| Strict TypeScript check of API, inventory, and reports | Passed | The changed data modules remain type-correct. |
| Inventory/report/backup pure tests from the preceding verification | **28 passed** | Exact decimal stock matching, latest-revision selection, half-tablet and liquid arithmetic, stock timing boundaries, backup validation/legacy compatibility, CSV/report/PDF behavior. Those calculation files were not changed in this follow-up. |

The API suite originally failed the password-reset race and concurrent startup race. Both pass after their fixes. The full final API command was:

```sh
node --test tests/api.test.mjs tests/api-races.test.mjs
```

## Browser outbox harness

`http://127.0.0.1:5173/tests/offline.browser.html` now contains **21 checks**, up from 13. It runs the real IndexedDB implementation with a mocked API; the API's behavior is independently exercised against real temporary servers by the tests above. Each run uses random synthetic owner IDs, and removes its cache, outbox, and synthetic invalidation markers afterward.

Added cases cover connection failure without mutation loss, simultaneous sync callers, preventing credentials/account deletion from entering the health-record outbox, blocking import while pending work exists, clearing only one owner's state, delayed session replies, and delayed online acknowledgments after same-client or independent-client cache clearing.

**Execution status:** the root agent previously verified the original harness. The expanded 21-check harness has been handed to the root agent for execution in its available browser. Do not count the new cases as browser-passed until that result is recorded. This subagent has no available in-app browser; desktop/mobile viewport and real UI interaction testing are owned by the root agent.

The independent-client case loads a second API module instance sharing real IndexedDB; it checks cross-client storage invalidation, but does not claim a separate operating-system device or browser engine. No claim is made here that Safari, Chrome, Firefox, Windows, Android, or iOS were physically tested. A viewport resize is responsive-layout testing, not a different engine or operating system.

The subsequent favorites fix expands the harness to **23 checks**. The added cases cover deleting a canonical favorite without exposing an older duplicate and resolving both online and queued writes to the server's canonical favorite ID. That expanded version has also been handed to the root agent; this document does not count its new cases as executed without the browser result.

## Privacy defaults reviewed

Source review found one application network request boundary, the relative same-origin `/api` client. The local Node server imports no outbound HTTP client and sends no telemetry. Fonts are installed locally. External medical-source URLs are catalog references, not background requests containing user data. The production document's CSP permits connections and fonts only from its own origin; it prohibits framing, plugins, and external form actions. API request logs do not include request bodies or personal values.

The server binds to `127.0.0.1`, creates its database with mode 0600, and creates its data directory with mode 0700. Credentials use scrypt or random-token hashes rather than plaintext storage. HTTP cookies are HttpOnly and SameSite Strict. The current loopback HTTP cookie intentionally lacks Secure; HTTPS configuration and network/device access remain deployment work. The local database, exports, and browser cache are not encrypted by this app. The deletion tests establish logical removal of owned records and sessions; they do not certify forensic erasure of storage media.

These are observed test results and source-review findings, not a clinical validation, third-party security audit, or proof of every possible concurrency schedule.

## Follow-up: local password access and symptom exports

The subsequent local-auth/symptom run passes **39 API checks** across `api.test.mjs`, `api-races.test.mjs`, and `api-local-auth.test.mjs`. Six local-auth tests establish password-only setup and unlock, private count-only discovery, one winner for simultaneous setup, unmodified single legacy account IDs/history, email fallback for multiple legacy accounts without merging them, recovery-code rotation and concurrent old-password revocation, and fresh setup after explicit account deletion. No actual database migration is needed for the local password flow; the legacy account schema is retained.

The symptom API test covers all six allowed tag IDs, duplicate/unknown/empty/contradictory-tag rejection, original date/time-zone consistency, multiple observations on the same date, account isolation, idempotent corrections, deletion tombstones, preservation of legacy observation shapes, full-history restore, and malformed replace rollback.

The affected report/backup suites pass **23 checks**, including seven new symptom-export checks: independent symptom rows with blank dose amounts, exact existing dose decimal strings, symptom-only dates, cross-midnight report boundaries, correction filtering, retained legacy observations, CSV formula neutralization and multiline quoting, and backup validation. Strict TypeScript checking of the API/report modules passes. PDF output remains explicitly an administration report; symptom export is provided in CSV and JSON. The API's startup text now uses Drug Tracker while internal database/backup identifiers remain compatible.

## Follow-up: favorite identity and encrypted storage preparation

The next API run passes **40 checks** across the same three API suites. The added favorite lifecycle case checks simultaneous duplicate adds, exact numeric-strength identity, canonical IDs and retry aliases, preservation of distinct strengths and other owners, old duplicates after restart, tombstones preventing deleted duplicates from reappearing, full backup restoration, and merge preference preservation. Legitimate repeated doses and planned rows remain separate. The shared favorite helper and related report suites pass **24 checks**, and strict TypeScript checking of the changed favorite/API/report modules passes.

The unconnected `server/vault-store.mjs` passes **7 tests**, including real Web Crypto round trips, restart persistence, owner isolation, revision conflicts across independent connections and four concurrent workers, strict envelope validation without partial writes, and rejection of ciphertext tampering by the client. It has no HTTP route or current-app integration. See [the module contract and limitations](./vault-store.md). Current plaintext storage and ordinary exports have not become encrypted by adding this module.

## Follow-up: separate encrypted cloud service

After the initial storage-only milestone, `server/cloud.mjs` now connects that store through a separate authenticated cloud API. The local server remains unchanged. The combined cloud API and vault-store run passes **17 tests**, including 10 new real HTTP integration checks. Those verify independent database/bootstrap boundaries, exact host/origin and mandatory owner checks, scoped secure cookies, durable encrypted records and sessions, CAS, login throttling, a logout during an unfinished upload, and rejection of the local frontend build. The explicit privacy page is served from a startup snapshot with scripts disabled. Full details and limits are in [the cloud API record](./cloud-api.md). This follow-up was tested only on local synthetic databases; it is not a public deployment or independent security audit.
