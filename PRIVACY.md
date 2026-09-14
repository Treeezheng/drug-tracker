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

## Guest simulator

The cloud build can be used as a guest without registering. Guest medication selections, simulated dose rows (including any notes), simulation settings and chart preferences are stored in this browser's local storage. **Guest data is unencrypted and is not an account record or an encrypted cloud vault.** It remains on the browser after a reload and may be readable by other people using the same browser profile, browser extensions or scripts with access to this origin.

Guest simulation does not upload those values or create Taken history, symptom records or supply receipts in an account. Creating an account or signing in opens a separate account workspace; guest data is not automatically copied into it. The guest workspace may remain available when returning to guest mode. Use Clear simulation to remove it from the active browser storage; this cannot erase browser or machine backups. Loading the website and opening external links still create normal network connections and expose connection metadata.

## Registered cloud accounts

The planned public address is https://treeezh.com/drug. A separate encrypted cloud edition is implemented for deployment on the owner’s server; the public server is not deployed yet. The local edition described above keeps its existing storage behavior.

Users can register a username and account password. Registration does not require an email address and does not verify a person's identity. Each account has a distinct owner identifier and its own encrypted record snapshot. The account password is sent to the server over HTTPS and stored as a password hash; it must be different from the encryption password. Duplicate usernames cannot be registered, and the registration response can reveal whether a username is already in use. There is no self-service account-password reset or email recovery in this release.

For signed-in accounts, the browser encrypts the full record snapshot with a random AES-256-GCM key before upload. A separate encryption password wraps that key in the browser. The server stores encrypted record payloads and the wrapped key. The encryption password and recovery key are not sent to the server. Server sign-in uses an HttpOnly session cookie. Account identifiers, usernames, account display names, password hashes, session hashes, expiry times, vault revisions and timestamps are not end-to-end encrypted.

While an account is unlocked, its record contents and encryption keys are held in browser memory. Signed-in records are not persisted in IndexedDB, local storage or an offline queue; the separate guest workspace described above is different. Saving account records requires a connection. Locking works without a connection. Locking, reloading, detecting an expired session or closing the page can discard unsaved account entries. An idle unlocked page does not automatically learn that its server session has expired. New encrypted vaults start empty and do not automatically copy guest data or local-edition records.

The current cloud vault holds current records only. Corrections replace the current record and deletion removes it from that snapshot; there is no in-app cloud audit archive. Server or machine backups may retain older encrypted snapshots. Downloaded CSV, PDF and Current backup JSON files are unencrypted. A full local backup with correction or deletion history is rejected on cloud import; preserve the original file. Self-service cloud account deletion is not implemented. Account-removal requests and server backup retention require the server operator; deletion from an active database would not automatically erase existing backup copies.

Hosting and network providers can observe connection metadata including IP addresses, request times and ciphertext sizes. HTTPS protects transport. Client-side encryption does not protect an unlocked browser from malicious scripts or a compromised device. The website operator, or someone controlling the server, could serve changed application code that captures secrets on a later visit. This web application therefore depends on trusting the code delivered to your browser. The `/drug` path shares an origin with the rest of treeezh.com; that root website and its scripts must also be trusted. The application includes no analytics, advertising or remote fonts, and does not send records to OpenAI.

The current service does not hold a record decryption key or provide operator recovery. Resetting an account password does not unlock the records. Keep the encryption password and recovery key private and recoverable. Use a strong, independent encryption password: someone who obtains the encrypted database can attempt to guess weak passwords offline. Production deployment, HTTPS and backup/restore verification remain pending; module and local integration tests are not an independent security audit.

## Public source code

Publishing this source repository does not publish the user database. Databases, secrets, browser caches, backups and exports are excluded from version control. Public issues and discussions are visible to others: do not include personal health records, passwords or recovery keys in them.

For implementation details and current limits, see the repository’s README and deployment documentation.
