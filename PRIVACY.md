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

## Cloud edition in development

The planned address is https://treeezh.com/drug. At this stage, independent encryption and ciphertext-storage modules do not provide complete end-to-end encryption for the daily application. Cloud authentication, encrypted browser storage, synchronization, backups and recovery need integration and verification before health records are uploaded.

The intended design keeps the record-decryption key on client devices and stores only encrypted record payloads on the owner’s server. Hosting providers can still observe connection metadata such as IP addresses, request times and encrypted payload sizes. Password recovery must not silently imply recovery of an unavailable encryption key. The final cloud behavior and retention details will be documented before release.

## Public source code

Publishing this source repository does not publish the user database. Databases, secrets, browser caches, backups and exports are excluded from version control. Public issues and discussions are visible to others: do not include personal health records, passwords or recovery keys in them.

For implementation details and current limits, see the repository’s README and deployment documentation.
