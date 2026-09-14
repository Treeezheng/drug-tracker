# Privacy

Updated 13 September 2026.

Drug Tracker is an open-source personal project based on Abraham Zheng’s requirements. Its original application code was generated and implemented by OpenAI Codex (GPT-6). Repository: https://github.com/Treeezheng/drug-tracker. Planned website: https://treeezh.com/drug.

## Current local edition

Medication records, quantities, dates, symptom tags, optional notes, profile settings, favorites and supply records are stored in a SQLite database on the machine running the service. Cached records and pending changes may also be stored in the browser’s IndexedDB. The service is restricted to the local machine by default.

The password is verified using a password hash; session and recovery tokens are stored as hashes on the server. The local password provides access control. **The record database, browser cache, pending queue and downloaded exports are not end-to-end encrypted.** Anyone with access to those files or the running browser may be able to read the record contents.

The application includes no analytics or advertising services, and fonts are served locally. Normal use does not send health records to OpenAI or an external health service. External links — medical sources, GitHub and the planned website — contact their respective providers when opened. Those providers have their own policies.

## Corrections, deletion and copies

A correction or soft deletion may retain earlier record content in revision history. A full JSON backup includes that history, including some deleted-record content. CSV, medication PDF and JSON downloads are readable files and are not automatically protected by the account password.

Deleting a local account removes its application records, revision rows and sessions from the active database and requests clearing the app’s browser cache. It does not erase files you downloaded, other copies, machine backups or previously exported data. Logical deletion is not a guarantee of forensic erasure from storage hardware.

## Cloud edition

The planned public address is https://treeezh.com/drug. A separate encrypted cloud edition is implemented for deployment on the owner’s server; the public server is not deployed yet. The local edition described above keeps its existing storage behavior.

In the cloud edition, the browser encrypts the full record snapshot with a random AES-256-GCM key before upload. A separate encryption password wraps that key in the browser. The server stores encrypted record payloads and the wrapped key. The encryption password and recovery key are not sent to the server. Server sign-in uses a different account password, verified against a password hash, and an HttpOnly session cookie. Account identifiers, the configured owner name, password hash, session hashes, expiry times, vault revision and timestamps are not end-to-end encrypted.

While unlocked, record contents and encryption keys are held in browser memory. This edition does not persist records in IndexedDB, local storage or an offline queue. Saving requires a connection. Locking works without a connection. Locking, reloading, session expiry or closing the page can discard unsaved entries. Cloud creation starts empty and does not automatically copy local records.

The current cloud vault holds current records only. Corrections replace the current record and deletion removes it from that snapshot; there is no in-app cloud audit archive. Server or machine backups may retain older encrypted snapshots. Downloaded CSV, PDF and Current backup JSON files are unencrypted. A full local backup with correction or deletion history is rejected on cloud import; preserve the original file. Account removal and backup retention are managed by the server operator in this initial single-owner edition.

Hosting and network providers can observe connection metadata including IP addresses, request times and ciphertext sizes. HTTPS protects transport. Client-side encryption does not protect an unlocked browser from malicious scripts, a compromised device, or a compromised server that serves changed application code. The `/drug` path shares an origin with the rest of treeezh.com; that root website and its scripts must also be trusted. The application includes no analytics, advertising or remote fonts, and does not send records to OpenAI.

Resetting a server account password does not recover the record encryption key. If both the encryption password and recovery key are lost, the operator cannot decrypt the records. Production deployment, HTTPS and backup/restore verification remain pending; module and local integration tests are not an independent security audit.

## Public source code

Publishing this source repository does not publish the user database. Databases, secrets, browser caches, backups and exports are excluded from version control. Public issues and discussions are visible to others: do not include personal health records, passwords or recovery keys in them.

For implementation details and current limits, see the repository’s README and deployment documentation.
