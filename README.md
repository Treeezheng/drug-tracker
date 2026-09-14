# Drug Tracker

A small medication tracker built around Abraham Zheng’s personal requirements.

**Idea, requirements and design direction: Abraham Zheng. All original application code was generated and implemented by AI — OpenAI Codex (GPT-6).** This is a personal experiment, not a claim that Abraham hand-wrote the application or that the application is clinically validated. Third-party frameworks, libraries and fonts remain credited to their authors.

- Source: [Treeezheng/drug-tracker](https://github.com/Treeezheng/drug-tracker)
- Planned website: [treeezh.com/drug](https://treeezh.com/drug) — deployment is in progress; the local edition works today.
- License: [0BSD](LICENSE), with [third-party notices](THIRD_PARTY_NOTICES.md).

## What it does

Three pages, with English interface text:

- **Dose Simulation:** a reference chart, independent dose rows, and a collapsed Discomfort check-in. Add a medication from favorites, choose its package strength and quantity, then explicitly mark it **Taken**. New entries default to the current local time. Planned doses do not count toward consumption or history.
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

Use **Settings → Account & data → Full backup** for a restorable JSON archive. Backups may contain prior revisions and deleted-record content; CSV, PDF and JSON downloads are unencrypted files. Keep them private. If copying the database directly, stop the service first so that pending SQLite WAL writes are not omitted.

Read the [privacy statement](PRIVACY.md). Local authentication recovery and cloud encryption-key recovery are different mechanisms.

## Medical scope

Catalog coverage is broader than model coverage. Concerta **18 mg** has a reconstruction of a reference group trace; its estimated terminal tail is separately identified. Ritalin IR **10 mg** uses a constructed parameter-based reference estimate. Other products and strengths do not inherit those models automatically.

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

This sets `/drug/` as the asset base and marks the build as cloud. `server/cloud.mjs` rejects local-edition builds and local databases. It listens only on loopback behind an HTTPS proxy. See the [Azure deployment guide](docs/azure-vm-deployment.md) and [deployment templates](deploy/).

An operator creates the server account once. The browser then uses a **separate encryption password** to protect a random vault key. Records are encrypted with AES-256-GCM before upload; the server stores ciphertext and the wrapped key. The recovery key can unlock records after signing in, but cannot replace server authentication. Losing both the encryption password and recovery key loses access to the encrypted records.

This first cloud edition requires an internet connection to save. Decrypted records and keys are held in memory while unlocked; there is no persistent browser record cache or offline outbox. **Lock** clears them without needing a network connection. Reloading, locking or session expiry discards unsaved form entries. Concurrent saves are checked against the vault revision; conflicts do not silently replace another device’s records.

Cloud **Current backup** exports an unencrypted snapshot of current records. It does not contain correction history or deleted records. Full local archives with audit history are rejected on cloud import instead of silently dropping that history; keep the original archive. There is no automatic upload of local records. Server backups can retain older ciphertext; account removal is an operator action in this initial single-owner release.

The domain has been purchased; **the public site is not deployed yet**. Azure student registration, a server, DNS, production HTTPS and production backup/restore verification remain pending. Local integration checks are not a production security audit. The [cloud plan](docs/cloud-and-student-plan.md) uses Azure for Students, subject to Microsoft eligibility verification; the old DigitalOcean GitHub student offer ended in 2026.

## Research and project origin

- [Architecture and official documentation](docs/architecture-research.md)
- [Apple/Google design guidance and design-skill review](docs/design-research.md)
- [Local API](docs/api.md)
- [Project origin and AI attribution · 中文](docs/project-origin.md)

The original brief is retained as context. Later user decisions take precedence: three pages, literal copy, a restrained interface, chart first, optional collapsed discomfort and current-time defaults.
