# Local API and storage contract

The first build runs entirely on this Mac. The server binds to `127.0.0.1:4310`; it has no cloud account service or outbound analytics. Email is a local account identifier and is not verified. Opening the same Mac's app in another browser works; another device does not connect to this loopback-only server. A deployment needs a separately reviewed HTTPS and authentication configuration.

Use Node.js 24.19 or a compatible newer version. The implementation uses the official [`node:http`](https://nodejs.org/docs/latest-v24.x/api/http.html), [`node:sqlite`](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), and [`crypto.scrypt`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback) APIs. In Node 24, SQLite remains an experimental built-in API. Migrations live in `server/migrations/` and run once, inside a transaction, before the server accepts connections.

## Run

Run `node server/index.mjs` from the project. `PORT` defaults to `4310`; `DOSE_DB_PATH` defaults to `data/dose-timeline.sqlite`. The server serves the production `dist/` build and `/api` on the same origin. During development, Vite at `http://127.0.0.1:5173` or `http://localhost:5173` should proxy `/api` to `http://127.0.0.1:4310`.

No real or sample health history is seeded. Tests use temporary databases with explicitly synthetic records. Run `node --test tests/api.test.mjs tests/api-races.test.mjs` to verify the API, concurrent authentication, and migration startup.

## Authentication

| Endpoint | Input | Response |
| --- | --- | --- |
| `GET /api/session` | — | `{user: {id,email,name} \| null}` |
| `GET /api/auth/local-state` | — | `{hasAccount:boolean,requiresEmail:boolean}`; no account identifiers or personal values |
| `POST /api/auth/local-setup` | `{password,name?}` | HTTP 201, `{user,recoveryCode}`; only if this Mac has no account |
| `POST /api/auth/local-unlock` | `{password}` | `{user}`; only if this Mac has one account |
| `POST /api/auth/local-recover` | `{password,recoveryCode}` | `{user,recoveryCode}`; one account, no email required |
| `POST /api/auth/register` | `{email,password,name?}` | HTTP 201, `{user,recoveryCode}` |
| `POST /api/auth/login` | `{email,password}` | `{user}` |
| `POST /api/auth/logout` | `{}` or no body | `{ok:true}` |
| `POST /api/auth/recover` | `{email,recoveryCode,password}` | `{user,recoveryCode}` with a new code |
| `DELETE /api/account` | `{password}` | `{ok:true}` |

New passwords need at least 10 characters, with a 256-character maximum. Passwords use asynchronous scrypt with independent random 16-byte salts, N=32768, r=8, p=1, and a 64-byte derived key. Session tokens contain 32 random bytes; only their SHA-256 hashes are stored in SQLite. Sessions last 30 days, and the cookie is `HttpOnly; SameSite=Strict; Path=/`. `Secure` is deliberately absent on the loopback HTTP development origin; remote hosting must add HTTPS and a Secure cookie rather than exposing this server as-is.

Local setup generates an internal random `local-…@device.invalid` address only to retain the existing account schema. Users do not need to enter or remember it. A sole legacy email account unlocks and recovers by password/recovery code using its existing account ID, records, and revisions; there is no data migration or merge. With multiple legacy accounts, local unlock/recovery returns 409 with `requiresEmail:true` and the UI uses the existing email login/recovery endpoints. With zero accounts, local unlock/recovery returns 404. Simultaneous setup requests can create only one account. Both local and email authentication recheck credentials after asynchronous hashing before creating a session.

The registration response displays a random recovery code once. Keep that code privately. Recovery changes the password, invalidates all existing sessions, and rotates the recovery code. Login rechecks the current password hash after asynchronous verification, so a concurrent password reset or account deletion cannot issue a session from obsolete credentials. There is no email delivery or administrator password bypass. There is a local rate limit of 40 account attempts per IP per 15 minutes. Reopening the local server resets this in-memory limiter.

Host validation rejects requests outside the configured loopback port and the two supported Vite origins. Browser origins are checked, cross-site requests are rejected, and mutations require JSON. There is no cross-origin CORS allowance. API responses use `Cache-Control: no-store`. Requests and health values are not logged. The database file is created with mode 0600; its newly created directory uses mode 0700. This is local access control, not database or end-to-end encryption.

## Personal data

`GET /api/data` returns `{profile:null|object,doses:[],scenarios:[],favorites:[],checkins:[],inventory:[]}`. Collections contain live records only. Each stored object returns its stable `id`, positive `revision`, `createdAt`, and `updatedAt` alongside its original fields. These are server-controlled metadata. Database migration 002 adds inventory while preserving all prior records and revisions. The additive JSON backup format remains schema version 1, and older backups may omit inventory.

Profile `timeIncrementMinutes` is optional and accepts only the numbers 5 or 10. Scenario `view` is optional; when present it requires a valid `YYYY-MM-DD` calendar date, numeric `days` of 1, 2, or 3, a named `timeZone`, and a boolean `publishedOnly`. The same checks apply to direct writes, backup preview, and imported live or historical payloads. Older backups may omit these preferences.

| Endpoint | Object fields |
| --- | --- |
| `PUT /api/profile` | `name?`, IANA `timeZone`, `timeFormat: '12h'|'24h'`, `sleepEnabled`, `bedtime`, `wakeTime`, optional `weekendEnabled`, `weekendBedtime`, `weekendWakeTime`, `revision?` |
| `PUT /api/doses/:id` | `id?`, `productId`, `productName`, `formulation`, `strength`, `quantity`, `unit`, `amountMg`, `administeredAt`, `timeZone`, `status`, `note?`, `revision?`, `ingredients?`, optional additional snapshot fields |
| `PUT /api/scenarios/:id` | Bounded scenario object containing `rows` or `doses`, with unique stable row IDs; optional `version`, `modelVersions`, `revision`, and baseline/assumption data |
| `PUT /api/favorites/:id` | `productId`, optional `strength`, `quantity`, exact product snapshot/preferences, `revision?` |
| `PUT /api/checkins/:id` | Bounded check-in object; optional `recordedAt`, `timeZone`, `note`, observations, `revision?` |
| `PUT /api/inventory/:id` | `productId`, `productName`, full `packageStrength`, `strengthUnit`, `unit`, positive decimal-string `quantity`, UTC `receivedAt`, IANA `timeZone`, `note?`, `revision?` |
| `DELETE /api/{doses,scenarios,favorites,checkins,inventory}/:id` | `{revision}` |

IDs use letters, digits, `_`, and `-`, up to 100 characters. A UUID is recommended. A profile ID is always the authenticated user's ID. Every read, write, export, revision, and tombstone is restricted to the authenticated owner. An ID belonging to someone else returns 404; it cannot be attached or overwritten.

Browser clients bind private requests to the visible account using `X-Dose-Owner: <user-id>`. The server checks this against the cookie's authenticated owner and returns 401 on a mismatch. This prevents an old tab or offline outbox from creating a new record in a different account after another tab changes the shared session cookie. The header does not grant access; the cookie must still authenticate the same owner. Local import, profile/record mutations and account deletion revalidate the live session after asynchronous body/password work, so logout or password recovery rejects a delayed write with 401.

Amounts are positive decimal **strings**, preserving original decimal precision, quantity, units, and ingredient conventions. For example, `strength: '10', quantity: '0.5', unit: 'tablet', amountMg: '5'`. This is input validation, not a medically recommended range, and does not approve splitting a product. Additional ingredient amounts retain their names and units. The server does not silently convert salt mass, base mass, or prodrugs. Real unusual administrations remain recordable; whether a standard model applies is handled independently.

Administration timestamps must be valid UTC ISO strings, such as `2026-09-13T15:00:00.000Z`, plus the original IANA zone. UI conversion must resolve daylight-saving ambiguity before sending. `actual`, `planned`, and `skipped` are the only dose-record statuses; simulations belong in scenarios. An optional patch `removalAt` must follow its application instant. `removedAt` is also accepted as a compatibility alias; the two values must agree if both are supplied.

Sleep times use `HH:mm`. An enabled schedule requires distinct bedtime and wake time; a disabled schedule can retain empty times. Overnight schedules are preserved as user preferences for charting. No personal sleep times are invented at account creation.

Inventory receipts record the opening balance or a later supply receipt as a separate durable fact. They preserve full package-strength conventions such as `26.1/5.2`, liquid concentration, quantity unit, and receipt instant. Stock is derived from receipts and actual dose quantities for the matching product/full strength/unit; planned, skipped and simulated rows do not consume stock. Use the reading instant to exclude future receipts and future administrations, and avoid subtracting administrations before the opening balance. Correcting or undoing an actual event recalculates stock without a second persistent deduction. Receipt retries use the same stable ID and do not add supply twice.

## Retry and correction semantics

A first PUT creates revision 1. Use the stable ID across retries. Identical payloads return the existing record without adding a duplicate or a revision, even if their original revision is now stale. For any changed record, supply the most recently acknowledged `revision`; a concurrent change returns 409 with `current` so the UI can show and resolve it. A PUT with no revision cannot overwrite an existing different payload. This applies to Profile, favorites, check-ins, and scenarios as well as doses.

Corrections append immutable snapshots to the revision history. Deletion creates an incremented tombstone; repeating the deletion succeeds. A late PUT to a deleted ID returns 409 rather than resurrecting it. Undoing a deletion requires an explicitly created new ID. Old dose snapshots cannot be changed by editing a favorite. Scenario rows and versions are serialized independently of actual history; unknown row times can stay pending.

The browser's account-scoped IndexedDB outbox commits queued writes transactionally. Cache reads overlay pending PUT/DELETE operations, so refreshing the server snapshot cannot hide an unsynced administration. Replay checks the current session, sends the expected-owner header, and atomically stores the acknowledged server revision while removing only that exact queued request. Concurrent additions remain queued. A second edit of the same pending record must wait for sync; a 400/401/409 response must not be relabeled as an offline success. Cache clearing refuses to discard pending records unless it follows explicit account deletion.

## Backups and deletion

`GET /api/export` returns a consistent owner-only snapshot with `format: 'dose-timeline-backup'`, `schemaVersion:1`, export time, public user fields, live `data`, immutable `revisions`, and `tombstones`. Scenario model version pins and assumptions are preserved exactly. Revision exports include the contents of corrected and tombstoned records; the UI should say this when offering a full backup. Password hashes, recovery hashes, and session tokens are excluded.

The server export cannot include unacknowledged browser outbox changes. Require those changes to sync before calling a server export complete, or provide a separately labeled device snapshot that includes the pending view and its pending count. A current-data browser snapshot does not contain the server's correction history or tombstones.

`POST /api/import` accepts `{backup:<raw exported wrapper>,mode:'merge'|'replace'}` and up to 16 MiB of JSON. It validates the whole archive before applying an atomic transaction. Full archives restore every correction revision and deletion tombstone, preserve event snapshots and timestamps, and rebind the Profile and database ownership to the signed-in account. Merge skips existing owned IDs, including tombstones; replace removes and replaces only that account's entity records. The UI must obtain an explicit replace choice before calling it. Responses contain `{data,imported,skipped,fullHistory}`. Current-data archives start new revision histories at 1 and return `fullHistory:false` because their earlier corrections were never included. Foreign-owned ID collisions reject the entire operation: a backup can recover an absent original account/database, but cannot silently attach another active account's IDs.

The client refuses imports while its owner has pending writes. `pendingChanges(userId)` returns reviewable queue entries with stable queue IDs. After a user explicitly chooses to keep the server version, `discardPendingChange(userId,queueId)` removes only that request and invalidates the cache. Fetch a fresh server snapshot before displaying the account again, then resume the remaining queue. Neither helper automatically drops conflicts.

`clearCache` also rotates a persisted, random per-owner invalidation marker containing no health data. Online acknowledgments compare the marker transactionally before updating their cached snapshot. A request already in flight cannot recreate a cache cleared by sign-out or account deletion in this client or another client sharing the browser's IndexedDB storage.

## Symptom observations and CSV

New feeling/discomfort check-ins use `PUT /api/checkins/:id` with `{id,date,recordedAt,timeZone,symptoms,note?,revision?}`. `recordedAt` is a UTC ISO instant; `date` must match its calendar date in the saved IANA `timeZone`. Tags are stable IDs: `headache`, `low-appetite`, `nausea`, `dry-mouth`, `sleep-trouble`, `anxiety`, `palpitations`, `other`, `concentrated`, `high-heart-rate`, `refreshed`, and `none`. Tags must be nonempty and unique; `none` must appear alone. Multiple check-ins on one date remain distinct IDs. They have the same owner isolation, corrections, retry behavior, tombstones, and full backup preservation as doses.

Legacy date-only focus/sleep-quality observations remain valid, as do legacy timestamp-plus-zone observations without a date. Optional `focus`, `sleepQuality`, and `note` are preserved. Legacy observations do not imply that no symptoms were present.

`csvString(doses,profile,from,to,checkins=[])` and `downloadCsv(...)` export actual doses and independent check-in rows in chronological order. The compact user report has 15 named columns: Date, Time, Time zone, UTC time, Medication, Formulation, Strength, Strength unit, Quantity, Quantity unit, Total mg, Amount details, Status, Feeling / discomfort and Notes. Internal IDs, model/evidence fields, revisions and repeated disclosures are omitted. Combination ingredients and nominal patch delivery keep their meanings in Amount details, rather than becoming an absorbed-mass total. Symptom rows leave medication and amounts blank. Date-only older check-ins keep their original date and explicitly unknown time/zone; existing focus/sleep observations remain in Notes. CSV quoting and formula-prefix neutralization still apply. JSON remains the restorable format. Medication PDF generation is no longer offered.


For a filesystem backup, stop the server before copying the SQLite file, or use a proper SQLite online backup method. Copying only the main file while the server is running can omit writes held in its WAL. Keep backups private. CSV reports are generated by the frontend from authenticated data; they must preserve units and exclude simulations from actual consumption totals.

Account deletion requires the current password and removes that account's rows, revisions, sessions, and tombstones through foreign-key cascades. It does not delete exports or filesystem backups a user previously saved and is not a claim of forensic secure erasure. Another user's records survive.

## Error responses

Errors return `{error: 'Readable explanation', current?: object}`. Input errors are 400; missing or invalid sessions are 401; prohibited origins/hosts are 403; missing or foreign-owned IDs are 404; stale edits or tombstone reuse are 409; payloads over 1 MiB are 413; non-JSON mutations are 415; rate limits are 429. Server errors are 500 with no personal content exposed. Unknown `/api` endpoints never fall through to the frontend.

## Browser regression harness

With Vite running, open `/tests/offline.browser.html`. It performs real IndexedDB checks against fresh, randomly named synthetic account keys while mocking every API call. It verifies concurrent enqueue/replay, refresh overlays, ownership changes, conflict retention, delete behavior, and acknowledged revision caching. It prints a pass/fail result and removes its own test keys. The harness is a development test page and is not included in the production build.
