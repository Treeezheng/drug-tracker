# Drug Tracker

A small medication tracker built around Abraham Zheng’s personal requirements.

**Idea, requirements and design direction: Abraham Zheng. All original application code was generated and implemented by AI — OpenAI Codex (GPT-6).** This is a personal experiment, not a claim that Abraham hand-wrote the application or that the application is clinically validated. Third-party frameworks, libraries and fonts remain credited to their authors.

- Source: [Treeezheng/drug-tracker](https://github.com/Treeezheng/drug-tracker)
- Planned website: [treeezh.com/drug](https://treeezh.com/drug) — deployment is in progress; the local edition works today.
- License: [0BSD](LICENSE), with [third-party notices](THIRD_PARTY_NOTICES.md).

## What it does

Three pages, with English interface text:

- **Dose Simulation:** a reference chart, independent dose rows, and a collapsed Discomfort check-in. Add a medication from favorites, choose its package strength and quantity, then press the green **Add** button. Future entries are saved as Planned; current or past entries are saved as Taken. A saved plan stays Planned until explicitly confirmed. New entries default to the current local time. Planned doses do not count toward consumption or history.
- **History:** medication totals and daily bars, selected date ranges, dose corrections, symptom counts and CSV export. Symptom comparisons show same-day records, not causation. Medication PDF exports contain dose records; CSV also includes separate symptom rows.
- **Settings:** categorized favorites with multiple strengths per medication, time zone and clock preferences, supply receipts and estimated stock, account, backup, privacy and project information.

The catalog contains 50 medication/formulation entries, including Ritalin IR 5 mg, Adderall IR 5 mg and metformin. Quantities preserve fractions: 1.5 tablets of a 10 mg package records 15 mg and consumes 1.5 tablets. Half-tablet buttons are limited to reviewed products and strengths; unusual real administrations can still be recorded without applying an unsupported standard curve.

## Run locally

Requires Node.js 24+ and pnpm. From the cloned project directory:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open <http://127.0.0.1:4310>. On macOS, after installing dependencies and building, **Start Drug Tracker.command** starts the local service and opens the page. Keep its Terminal window open; Control-C stops it. The launcher reuses an existing verified instance, and does not stop unrelated programs or install software automatically.

First use: set a local password and save the recovery code. Later, unlock with that password. A single legacy email account keeps its identity and history; only a database with multiple legacy accounts needs email selection.

The server listens on `127.0.0.1`. This is a local edition: it does not become accessible on your phone over the internet simply because it is running on your Mac.

For development:

```sh
pnpm dev
```

Vite runs at <http://127.0.0.1:5173>, with the local API at port 4310. Rebuild after source changes to update the production page.

## Data and privacy

**The current local edition is not end-to-end encrypted.** Password verification controls access; it does not encrypt the SQLite database or browser cache. The server stores account-owned records in `data/dose-timeline.sqlite`; the browser may hold cached records and pending changes. Corrections and soft deletions can retain previous content in revision history.

The application includes no analytics, advertising or remote font requests. Opening a reference, repository or website link contacts that external site. Publishing this repository does not upload local health records: databases, exports, backups and secrets are excluded from version control.

Use **Settings → Backup & restore → Full backup** for a restorable JSON archive. Backups may contain prior revisions and deleted-record content; CSV, PDF and JSON downloads are unencrypted files. Keep them private. If copying the database directly, stop the service first so that pending SQLite WAL writes are not omitted.

Read the [privacy statement](PRIVACY.md). Local authentication recovery and cloud encryption-key recovery are different mechanisms.

## Medical scope

Catalog coverage is broader than model coverage. Concerta **18 mg** has a reconstruction of a reference group trace; the interface stops that curve at the published trace boundary. Missing contributions are marked **\* No data**, unknown readings show a dash, and partial totals carry an asterisk. Ritalin IR **10 mg** uses a constructed parameter-based reference estimate. Other products and strengths do not inherit those models automatically.

Each dose has a read-only **Formula** disclosure. Unsupported or custom packages do not gain a reference curve merely by adding up to a reference dose. Previously saved illustrative assumptions remain readable, clearly labeled unvalidated; the interface no longer offers controls to create or accept them. The dose editor omits optional notes, manufacturer and administration-detail controls. Existing metadata remains in saved records and backups; patches retain their removal-time control.

These are not measurements of your drug concentration and do not recommend doses or determine safety. Unknown contributions remain unknown. Different medications, salts, liquids, patches and combination ingredients are not collapsed into a universal drug-effect total. Missing records do not establish that no medication was taken. Symptom reports do not establish that a medication caused a symptom.

Sources, assumptions and limits: [medical review](docs/medical-review.md).

## Verification

```sh
pnpm check
pnpm test
```

A prepared [GitHub Actions workflow](docs/ci-checks.yml) covers Linux, macOS and Windows. It is not active yet: the current GitHub authorization cannot write workflow files. Local test results are separate from that future CI run.

API tests create isolated temporary databases and local test ports. They do not use the personal database. Tests cover exact quantities, inventory, time zones and DST, independent dose identities, favorite deduplication, account isolation, conflicts, backup restoration and symptom exports.

Browser checks and known limits are recorded in [interface QA](docs/qa-interface-review.md), [data QA](docs/qa-data.md) and [medical QA](docs/qa-medical.md). Responsive browser testing is not a claim of testing every physical phone or operating system.

## Web edition

The target address is **https://treeezh.com/drug**. The cloud edition has a separate server and build:

```sh
DRUG_EDITION=cloud pnpm build
```

This sets `/drug/` as the asset base and marks the build as cloud. `server/cloud.mjs` rejects local-edition builds and local databases. Its standalone mode listens on loopback behind an HTTPS proxy.

For **Heroku → GitHub deployment**, connect this repository and select `main`. The included build script generates the cloud edition automatically; the Procfile starts `server/heroku.mjs` on Heroku's assigned port. It requires PostgreSQL through `DATABASE_URL` and the exact HTTPS `CLOUD_ORIGIN`. See the [Heroku deployment guide](docs/heroku-deployment.md) for configuration, costs and launch checks. The [Azure deployment guide](docs/azure-vm-deployment.md) remains an alternative.

The cloud build opens a guest simulator without requiring an account. Guest medication choices, simulated dose rows and chart preferences stay in this browser's local storage **without encryption**. They are separate from actual medication history and are not uploaded. Use **Clear simulation** to remove the guest workspace on a shared browser. Signing in or creating an account does not automatically import guest or local-edition data.

Users can register with a username and account password. Each account has its own encrypted vault. The browser then uses a **separate encryption password** to protect a random vault key. Account records are encrypted with AES-256-GCM before upload; the server stores ciphertext and the wrapped key. The recovery key can unlock records after signing in, but cannot replace server authentication. There is no email verification or self-service account-password recovery. Losing both the encryption password and recovery key loses access to the encrypted records.

Saving signed-in records requires an internet connection. Decrypted account records and keys are held in memory while unlocked; there is no persistent account-record cache or offline outbox. **Lock** clears them without needing a network connection. Reloading, locking or detecting session expiry discards unsaved account form entries. The separate, unencrypted guest workspace can remain in the browser. Concurrent saves are checked against the vault revision; conflicts do not silently replace another device’s records.

Cloud **Current backup** exports an unencrypted snapshot of current records. It does not contain correction history or deleted records. Full local archives with audit history are rejected on cloud import instead of silently dropping that history; keep the original archive. There is no automatic upload of local records. Server backups can retain older ciphertext. Self-service cloud account deletion and password reset are not implemented; backup retention and any account-removal request require the server operator.

Encryption does not hide usernames, session or connection metadata. It also does not protect an unlocked browser from malicious scripts or a hosting operator that changes the JavaScript delivered to it. The application and other pages on the same origin must be trusted; see the [privacy statement](PRIVACY.md).

The domain has been purchased and a Heroku app has been created. **Public deployment has not yet been verified.** Production routing, custom-domain HTTPS and production backup/restore verification remain pending. Local integration checks are not a production security audit. The [student hosting comparison](docs/student-hosting-options.md) covers Azure, Heroku, Appwrite and Netlify.

## Research and project origin

- [Architecture and official documentation](docs/architecture-research.md)
- [Apple/Google design guidance and design-skill review](docs/design-research.md)
- [Local API](docs/api.md)
- [Project origin and AI attribution · 中文](docs/project-origin.md)

The original brief is retained as context. Later user decisions take precedence: three pages, literal copy, a restrained interface, chart first, optional collapsed discomfort and current-time defaults.
