# Drug Tracker

A personal medication tracker and reference simulator operated by Treee.

**Idea, requirements and design direction: Abraham Zheng. All original application code was generated and implemented by AI — OpenAI Codex (GPT-6).** This is a personal experiment, not a claim that Abraham hand-wrote the application or that the application is clinically validated. Third-party frameworks, libraries and fonts remain credited to their authors.

- Source: [Treeezheng/drug-tracker](https://github.com/Treeezheng/drug-tracker)
- Website: [treeezh.com/drug/](https://treeezh.com/drug/) — cloud edition on Heroku; a separate local edition is also available.
- License: [0BSD](LICENSE), with [third-party notices](THIRD_PARTY_NOTICES.md).

## What it does

Three pages, with English interface text:

- **Dose Simulation:** one medication chart at a time, a selector to switch formulations, independent dose rows, and a collapsed Feeling / discomfort check-in. In an account, green **Add** saves future entries as Planned and current or past entries as Taken. A plan stays Planned until explicitly confirmed. Once its time arrives, the optional **Taken** shortcut opens a confirmation of the actual date and time, initially showing the planned time; it never records a dose automatically. Settings can hide that shortcut while keeping Edit. Chart readings follow the current time on opening or returning to the app. Hovering previews another time; moving away returns to **Now** unless a click or tap pins it. **Unpin** resumes the current reading. Guest **Add** only validates and collapses a simulated row, with no account save. New entries default to the current local time. Planned and simulated doses do not count toward consumption or taken-dose history.
- **History:** medication totals and daily bars, selected date ranges, dose corrections, feeling/discomfort counts and CSV export. Symptom comparisons show same-day records, not causation. Download CSV exports selected dose records and separate feeling/discomfort rows. Check-ins include Concentrated, Refreshed, High heart rate and the existing discomfort choices; positive selections use pale green.
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

The application includes no behavioral analytics, advertising pixels or remote font requests. The hosted edition can still produce Heroku infrastructure and Network Error Logging reports, as described in the privacy policy. Opening a reference, repository or website link contacts that external site. Publishing this repository does not upload local health records: databases, exports, backups and secrets are excluded from version control.

Use **Settings → Backup & restore → Full backup** for a restorable JSON archive. Backups may contain prior revisions and deleted-record content; CSV and JSON downloads are unencrypted files. Keep them private. If copying the database directly, stop the service first so that pending SQLite WAL writes are not omitted.

Read the [privacy statement](PRIVACY.md). Local authentication recovery and hosted account-and-data recovery are different mechanisms.

## Medical scope

Catalog coverage is broader than model coverage. Available references now extend beyond Ritalin IR and Concerta:

| Medication family | Examples with reference curves |
| --- | --- |
| Methylphenidate | IR tablets, Methylin oral solution, IR chewable tablets, Concerta, Ritalin LA, Aptensio XR, Metadate CD, Quillivant XR, QuilliChew ER, Cotempla XR-ODT, Jornay PM, and the ER reference included in the Relexxii label |
| Dexmethylphenidate | Focalin IR and Focalin XR references, including their corresponding generic formulation entries |
| Serdexmethylphenidate / dexmethylphenidate combination | Azstarys, using its complete two-ingredient package and one active d-methylphenidate reference curve |
| Amphetamines | Mixed amphetamine salts IR/XR (Adderall references), Mydayis, Evekeo IR/ODT, Dyanavel XR tablets/suspension, dextroamphetamine IR and Dexedrine Spansule, lisdexamfetamine capsules/chewable tablets (Vyvanse references), and Arynta oral solution |
| Nonstimulants | Atomoxetine (Strattera reference), guanfacine ER (Intuniv), clonidine ADHD ER tablets (Kapvay reference), and viloxazine ER (Qelbree) |

These entries use specific study doses and formulations, with estimated scaling where supported by the implementation. They do not cover every medicine, package or way of taking a dose. Atomoxetine uses a studied CYP2D6 extensive-metabolizer population; it does not infer the user's metabolism. A concentration peak is not an immediate therapeutic effect window.

Eight catalog-defined brand/generic formulation pairs share a selector and deduplicated strengths, with the recognizable brand shown below the ingredient/formulation. Saved product and package identities remain intact.

The chart displays **one medication formulation at a time**. The medication selector switches the curve, reading, sources and prior-dose carryover together. Repeated doses of that formulation contribute to its estimated total; different medications are not presented as a combined effect. Separate analytes, including d- and l-amphetamine, have a second selector and are never added into one concentration.

**A star marks a reference estimate, estimated continuation or incomplete total.** Click the chart's star or **Sources & methods / No drug data** disclosure to inspect the evidence. A dash means a supported value is unavailable; it does not mean zero. Dose times remain visible when no concentration curve is supported.

References in [the registry](src/lib/pk-references.ts) use FDA/DailyMed single-dose parameters, rounded published figures or explicitly constructed landmarks. Immediate-, extended- and delayed-release formulations remain distinct. Interpolation, dose scaling, fitted absorption, generic reference transfer and terminal tails are estimates. The original record's evidence is not upgraded just because a reference can be drawn. Concerta 18 mg's reconstructed group trace and Ritalin IR 10 mg's parameter-based curve are also references, not individual measurements. Formula and Sources & methods identify the selected formulation's population, dose basis and numerical limitations.

Read the [chart guide](https://treeezh.com/drug/chart-guide.html), [amphetamine research](docs/amphetamine-pk-reference-research-2026-09-14.md), [MPH research](docs/mph-pk-reference-research-2026-09-14.md), [additional MPH figure review](docs/common-mph-reference-review-2026-09-14.md), [additional stimulant research](docs/common-stimulant-pk-research-2026-09-14.md), [Azstarys combination reference](docs/azstarys-pk-research-2026-09-14.md), and [nonstimulant research](docs/nonstimulant-pk-research-2026-09-14.md). These notes distinguish source facts from constructed curves and document available exposure checks and remaining gaps.

Half-tablet references are enabled only for the appropriate reviewed IR products or explicitly listed scored package strengths. In particular, QuilliChew ER permits halves of 20 and 30 mg tablets, not 40 mg; intact ER capsules, ODTs and other tablets do not inherit this rule.

Each dose has a read-only **Formula** disclosure. Unsupported or custom packages do not gain a reference curve merely by adding up to a reference dose. Previously saved illustrative assumptions remain readable, clearly labeled unvalidated; the interface no longer offers controls to create or accept them. The dose editor omits optional notes, manufacturer and administration-detail controls. Existing metadata remains in saved records and backups; patches retain their removal-time control.

These are not measurements of your drug concentration and do not recommend doses or determine safety. Unknown contributions remain unknown. Different medications, salts, liquids, patches and combination ingredients are not collapsed into a universal drug-effect total. Missing records do not establish that no medication was taken. Symptom reports do not establish that a medication caused a symptom.

Sources, assumptions and limits: [medical review](docs/medical-review.md).

## Verification

```sh
pnpm check
pnpm test
```

The [Verify workflow](.github/workflows/ci.yml) runs on pull requests and main: TypeScript, unit/API tests, a disposable PostgreSQL integration database, both editions, and repeat-build hash comparison. Main requires a pull request and a passing Verify check. CodeQL, Dependabot, secret scanning and push protection are configured; [configuration and verification](docs/github-verification.md) records their scope.

API tests create isolated temporary databases and local test ports. They do not use the personal database. Tests cover exact quantities, inventory, time zones and DST, independent dose identities, favorite deduplication, account isolation, conflicts, backup restoration and symptom exports.

Reference-curve tests check formulation and analyte identity, units, study peaks, selected total/partial exposure benchmarks, delayed release and invalid-input boundaries. Passing these engineering checks does not establish clinical validity or accurate individual predictions. A [bounded privacy/security crosscheck](docs/reference-expansion-security-review-2026-09-14.md) covers the new static references, chart switching, guide delivery and username display.

Browser checks and known limits are recorded in [interface QA](docs/qa-interface-review.md), [data QA](docs/qa-data.md) and [medical QA](docs/qa-medical.md). Responsive browser testing is not a claim of testing every physical phone or operating system.

## Web edition

This source describes the **single-password OPAQUE release candidate**. The [candidate review](docs/opaque-release-review-2026-09-13.md) separates implementation evidence from publication. Exact source, CI, manifest, provenance and live-asset evidence belongs in this change’s final pull-request verification comment; the candidate description alone does not prove which version is live.

The canonical address is **https://treeezh.com/drug/**; the site root redirects there. The cloud edition has a separate server and build:

```sh
DRUG_EDITION=cloud pnpm build
```

This sets `/drug/` as the asset base and marks the build as cloud. `server/cloud.mjs` rejects local-edition builds and local databases. Its standalone mode listens on loopback behind an HTTPS proxy.

For **Heroku → GitHub deployment**, connect this repository and select `main`. The included build script generates the cloud edition automatically; the Procfile starts `server/heroku.mjs` on Heroku's assigned port. It requires PostgreSQL through `DATABASE_URL` and the exact HTTPS `CLOUD_ORIGIN`. See the [Heroku deployment guide](docs/heroku-deployment.md) for configuration, costs and launch checks. The [Azure deployment guide](docs/azure-vm-deployment.md) remains an alternative.

The cloud edition opens a guest simulator without requiring an account. Before first input, users confirm they are 18 or older and choose storage. The default is **memory only**; refreshing clears the simulation. Optional “Remember my simulation on this device” saves it **unencrypted** in browser local storage. That choice is off by default and should stay off on shared devices. Legacy saved guest data is not opened or overwritten without that choice. Use **Clear simulation** to remove saved guest data.

Signing in does not automatically import guest or local-edition records. When guest drafts or favorites exist, **Sync guest simulation?** offers **Keep separate** or **Sync and remove local copy**. The explicit sync preserves existing account data and stores the guest content as an encrypted simulation; doses remain simulated. Only confirmed saves clear current guest memory and its matching saved browser copy. Failed saves retain the guest data for retry; a newer copy from another tab or a failed cleanup is retained with notice rather than silently deleted.

Users register with a username and **one password**. OPAQUE authenticates without sending the password to the server. Its browser-only export key, processed through HKDF-SHA256, protects a random AES-256-GCM data key; the server receives encrypted records and the wrapped key. The shared authentication session key does not wrap the data key. Argon2id stretching runs in the browser as part of OPAQUE. The public flow has no separate encryption password or legacy migration screen.

The app gives users **one recovery key**, containing an independent account-recovery credential and the data key. Only the account-recovery part is sent during recovery; the complete code and data-key part remain in the browser. It can recover account access and records without the old password. Users must acknowledge saving it before continuing; the checkbox cannot verify that a durable copy was saved. The recovery download is plaintext. There is no email verification or operator-held recovery copy. If both credentials are lost, a browser that can still unlock may allow viewing or exporting until access ends; without either credential or such access, records cannot be recovered through the service. A recovery key is an alternative credential, not a second authentication factor.

Saving signed-in records requires an internet connection. Decrypted account records stay in memory; there is no persistent account-record cache or offline outbox. **Auto-unlock on this device for 7 days** is visible and selected by default on password sign-in/registration, and takes effect only after successful submission. It stores a non-extractable AES-256-GCM wrapping key and encrypted data key in a dedicated IndexedDB store; local storage contains only a public revocation marker for this feature. No password or OPAQUE export secret is persisted. Automatic unlocking requires a live server session and a fresh vault matching the owner and key wrapper. Its fixed seven-day deadline begins with explicit password authentication and is never extended by visits. The open page is also limited to its fixed seven-day unlock period, with periodic and focus-time session checks. Cloud sessions expire at most seven days after creation; earlier session expiry or revocation takes precedence.

**Lock**, sign-out and disabling automatic unlocking revoke and request deletion of this browser’s saved key; password/key changes invalidate old copies. Leaving the page clears memory while preserving an enabled key until expiry. Expired entries are cleaned up when read, not by a guaranteed deletion timer. Turning the setting off requires a password again after reload; enabling it from Security settings requires password confirmation. Anyone using this browser profile or scripts on the same origin may use the saved key; it is not a claim of hardware-backed protection. Reloading, locking or detecting expiry discards unsaved account entries. The separate, unencrypted guest workspace can remain in the browser. Concurrent saves are checked against the vault revision; conflicts do not silently replace another device’s records.

Cloud **Current backup** exports an unencrypted snapshot of current records. It does not contain correction history or deleted records. Full local archives with audit history are rejected on cloud import instead of silently dropping that history; keep the original archive. There is no automatic upload of local records. Server backups can retain older ciphertext. Settings → Account supports authenticated account deletion, **Change password**, **Replace recovery key**, and all-device sign-out. Changing the password rewraps the same data key and preserves the recovery key. Recovery-key replacement and password recovery rotate the data key, re-encrypt current records and issue a new recovery key. Password changes, recovery and key replacement revoke old sessions. Old keys can still decrypt ciphertext copied before rotation. The operator cannot bypass the password-and-recovery-key requirement. See [provider retention boundaries](docs/heroku-retention-review-2026-09-13.md).

Encryption does not hide usernames, authentication records, recovery-verification hashes, temporary protocol state, session or connection metadata. A server compromise that exposes the OPAQUE setup secret and authentication records can permit offline password guessing. It also does not protect an unlocked browser from malicious scripts or a hosting operator that changes the JavaScript delivered to it. The application and other pages on the same origin must be trusted; see the [privacy statement](PRIVACY.md).

The custom domain and HTTPS routing have been verified, with strict PostgreSQL TLS validation enabled. The production plan is one Basic web dyno and Essential-0 PostgreSQL. Local tests do not establish provider backup deletion deadlines or constitute a production penetration test. Review [deployment instructions](docs/heroku-deployment.md), [incident response](docs/incident-response-runbook.md), and [review history](docs/security-reviews.md).

## Security review transparency

Claude supplied a read-only security/privacy review dated 2026-09-13. OpenAI Codex (GPT-6) performed the implementation review, fixes, regression tests and deployment checks. These are **AI-assisted reviews**, not an independent professional audit, certification, vendor endorsement, or guarantee of safety. The original report contains findings and limitations; “reviewed” does not mean “passed.”

On 2026-09-14, two fresh sets of agents reviewed security, privacy/compliance and efficiency, followed by a separate crosscheck of the changes. Each reviewer started without the implementation conversation. The [two-round review](docs/independent-security-review-2026-09-14.md) records the confirmed findings, repairs, synthetic restoration drill, performance measurements and remaining limits. This is independent review within the AI workflow, not independent professional assurance.

See [review history and evidence](docs/security-reviews.md), [security reporting](SECURITY.md), and the [public build manifest](https://treeezh.com/drug/build-info.json). The manifest lists source commit, toolchain, lockfile hash and hashes of deployed frontend files. GitHub publishes a signed provenance statement for verified main-build manifests. These checks help compare builds; they cannot prevent an operator from serving malicious JavaScript later.

## Research and project origin

- [Architecture and official documentation](docs/architecture-research.md)
- [Apple/Google design guidance and design-skill review](docs/design-research.md)
- [Local API](docs/api.md)
- [Project origin and AI attribution · 中文](docs/project-origin.md)

The original brief is retained as context. Later user decisions take precedence: three pages, literal copy, a restrained interface, chart first, optional collapsed discomfort and current-time defaults.
