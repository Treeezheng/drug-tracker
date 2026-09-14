# Privacy policy

Effective 13 September 2026.

Drug Tracker is operated by **Treee** at [treeezh.com/drug](https://treeezh.com/drug/). Contact: [uhenrywksp@icloud.com](mailto:uhenrywksp@icloud.com). This policy covers the hosted website and explains how the separate local edition differs. It describes our practices; it is not authorization to disclose your health information for other purposes.

## Guest simulation

Guest simulations stay **in this page’s memory by default**. Before you enter a simulation, the app asks you to confirm that you are 18 or older. This is your confirmation, not verification of your identity or age. Choosing **Remember my simulation on this device** allows medication choices, simulated doses, any saved notes, and time or chart preferences to be saved **unencrypted in this browser’s local storage**, along with a marker remembering that choice. Remembering is optional and is not selected by default.

Guest values are not uploaded just by signing in or registering. If a guest simulation or medication selection is present, **Sync guest simulation?** offers **Keep separate** or **Sync and remove local copy**. Only the latter choice transfers the simulation into the account after browser encryption; its doses remain simulated, not records that medication was taken. Existing account records are preserved.

The app clears the current page’s guest workspace and matching remembered copy only after the encrypted save is confirmed. Failed saves keep the guest data available for retry. If another tab changed the remembered copy, that newer copy is retained; if cleanup fails, the app offers retry or continuing with that copy kept. Clearing cannot remove browser or device backups.

Previously saved guest data is not opened automatically without the remembered choice. If you enable remembering or keep a guest workspace separate, guest data can remain after leaving or signing out. Use **Clear simulation** to remove it and the remembered choice from this browser’s active storage. People using the same browser profile, privileged extensions or scripts on this site may be able to read remembered data. Avoid remembering on a shared device. Without remembering or an explicitly confirmed account sync, reloading or closing the page discards the simulation.

## Account information and encrypted records

Registration uses a username and **one password** for sign-in and browser decryption; an optional display name may also be supplied. We do not require an email address or date of birth. The browser uses the OPAQUE authentication protocol, which sends protocol messages rather than your password. The server stores an OPAQUE registration record and recovery-verification hash. Usernames, account identifiers, display names, authentication records, temporary authentication challenges, session hashes and expiry times remain server-readable. A registration response can reveal whether a username is already used.

To limit abuse, the service also uses counters associated with usernames or hashed network identifiers. Hashing an identifier does not guarantee anonymity. Authentication challenges contain short-lived protocol state and expire; expired challenges and counters are pruned during later authentication activity. This is not a scheduled forensic erasure process.

Medication records, symptoms, notes, favorites, supply records and profile settings are encrypted together in your browser using a random AES-256-GCM data key before upload. A browser-only key obtained through OPAQUE protects that data key. The server stores the encrypted snapshot and wrapped key, plus its owner identifier, revision and timestamps. The application does not send your password, browser-only export key, data decryption key or complete recovery key to the server. Recovery sends only the separate account-recovery portion described below.

OPAQUE uses Argon2id password stretching in the browser. The browser derives the data-key wrapping key from OPAQUE’s client-only export key using HKDF-SHA256; the authentication session key shared with the server is not used for that purpose. Password-strength checks run locally with bundled dictionaries, not a third-party password-checking service. There is no second encryption password to remember.

We use account and session information to authenticate you, keep accounts separate and operate the service. Encrypted snapshots let you save and retrieve your records. Decrypted account records and keys remain in browser memory while unlocked; the app does not persist them in browser local storage, IndexedDB or an offline queue. The separate guest workspace may still be present.

## Cookies, connections and providers

The hosted service uses an essential, HttpOnly session cookie to keep you signed in. Sessions have a **24-hour maximum lifetime from creation**, without sliding renewal; sign-out, deletion or other session invalidation may end access sooner. Older sessions are capped to that lifetime on server startup. Blocking the cookie prevents account access. The site also uses the optional guest storage described above.

Loading the site exposes normal connection information to hosting and network providers, which may include IP address, request time, requested URL, browser information and transfer size. The application does not intentionally log request bodies, passwords or health record contents. Provider and network logs are separate from the encrypted record snapshot.

**Heroku Network Error Logging (NEL)** can instruct supported browsers to send sampled connection and performance reports to Heroku’s reporting endpoint, including `nel.heroku.com`. Reports concern requests to this site and may include their URLs, timing, status or network errors; Heroku also receives the reporting connection’s IP address. This infrastructure telemetry is separate from the encrypted medication snapshot and does not require an advertising or analytics script in the app. [Heroku’s NEL documentation](https://devcenter.heroku.com/articles/http-routing#network-error-logging).

- **Heroku / Salesforce** provides application hosting and the PostgreSQL database. It processes the account metadata and encrypted payloads needed to host the service, along with infrastructure and connection information. [Salesforce privacy information](https://www.salesforce.com/company/legal/privacy/).
- **Spaceship** provides domain and DNS services, not health-record storage. DNS resolution is separate from the application’s encrypted record traffic. [Spaceship privacy policy](https://www.spaceship.com/legal/privacy-policy/).
- **GitHub** hosts the public source repository. Medical references and other external links contact their providers only when you open them. Public issues or discussions are public. [GitHub privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

If you email us, we receive your address and message through our email provider, Apple iCloud, to respond to your request. Use email for account or privacy questions, and avoid including health records. **Never email your password or recovery key.**

The application has no advertising pixels or behavioral analytics integrations, uses locally served fonts, and does not send records to OpenAI. We do not sell personal information or share it for cross-context behavioral advertising. We do not enable third-party behavioral tracking of visitors over time across different websites. Heroku/Salesforce still receives the infrastructure information described above; its independently operated services and any external sites you open have their own collection practices. We have not independently verified whether a provider associates that information with activity on other services, and do not promise that no third party can do so.

The app does not change its behavior in response to **Do Not Track or Global Privacy Control** signals: it has no sale, behavioral advertising or cross-site tracking feature to switch off. Those signals do not disable essential authentication, optional guest storage that you selected, or Heroku’s infrastructure reporting. Any applicable legal opt-out rights remain available through the contact below.

We may disclose information we actually hold when required by applicable law. This statement does not grant permission for additional health-information uses or disclosures, and does not give us the ability to decrypt your records.

## Saving, exports and retention

Saving account changes requires an internet connection. **Lock** clears the unlocked account workspace without a connection. The app also locks after **10 minutes of inactivity**, clearing unsaved entries. A suspended browser can delay timers; elapsed time is checked again when you return or interact. An open account page attempts periodic server-session checks and checks when it regains focus, but cannot confirm server expiration while offline. Reloading, closing the page, locking or detecting an expired session can discard unsaved changes. Session revocation does not instantly erase data already displayed in another browser.

The cloud vault contains current records. Correcting or deleting a record replaces the current encrypted snapshot; there is no complete cloud revision archive. **CSV and Current backup JSON downloads are unencrypted files.** Local archives containing earlier revisions or deleted-record history are rejected on cloud import rather than silently losing that history.

Account information and the current encrypted snapshot remain in the active service while the account exists. After signing in and unlocking, use **Settings → Account → Delete account** and confirm your password through OPAQUE to delete the account, its encrypted vault and all of its sessions from the active database. The current account workspace is cleared after confirmed deletion. Other already-open browsers may retain unlocked data until they next contact the service or are closed or locked. Deleting an account does not clear the separate guest simulation. If you cannot access the workspace or need help with a request, contact us. We may ask you to demonstrate account control, without asking you to email a password or decryption key.

The hosted database uses **Heroku Postgres Essential 0**. Heroku’s published manual and scheduled backup limits depend on the type of backup; a limit on the number of backups is not a maximum age for every copy. [Heroku backup retention](https://devcenter.heroku.com/articles/heroku-postgres-backups).

Hosting backups may retain older account metadata and encrypted snapshots after records or an account are deleted. Deletion does not erase your downloads, browser or device backups, other copies, or information that must be retained by law. **We have not verified a single maximum retention period covering all provider logs and backup copies.** We cannot promise that all copies disappear immediately or by a specified date, or that logical deletion is forensic erasure. Contact us for the current information before relying on a particular retention period.

## Encryption limits and recovery

The app gives you **one recovery key** containing two independent secret parts: an account-recovery credential and the record decryption key. During recovery, only the account-recovery part is sent over HTTPS for verification; the decryption part stays in your browser. The complete key can restore account access and decrypt records without the old password. Recovery requires a new password, re-encrypts current records with a new data key, supplies a new recovery key and revokes the old sessions. It is an alternative access credential, not two-factor authentication.

**Keeping the recovery key safe is your responsibility.** Before continuing after a new key is shown, you must confirm that you have saved it. This records your acknowledgment; it cannot prove that a copy was successfully saved or remains accessible. A downloaded recovery-key file is unencrypted. Anyone with the complete key may access your account and records. The operator does not keep a usable copy and cannot recover your password or key for you. If you lose both, your encrypted records cannot be recovered through this service; there is no email or customer-support reset that bypasses this requirement.

While signed in and unlocked, **Settings → Account → Security** lets you change your password, replace the recovery key or sign out all devices, after confirming your current password through OPAQUE. **Change password** re-protects the same data key, so the existing recovery key continues to work. **Replace recovery key** creates a new data key, re-encrypts current records and supplies a new recovery key. Password changes and key replacement revoke old sessions and create a new current session; all-device sign-out ends the current session too. These actions do not erase previously copied ciphertext, old key wrappers, downloads or backups. An old key can still unlock a copy made before rotation.

Encryption does not conceal account or connection metadata, protect downloaded files, or protect an unlocked browser from malicious scripts or a compromised device. An operator or attacker controlling the delivered website code could change it to capture passwords, recovery keys or unlocked records. All code served from the same origin must be trusted. OPAQUE does not make weak passwords safe: theft of the server’s authentication records and setup secret can allow offline password guessing. Encryption also does not guarantee availability or prevent a malicious server from returning an older snapshot.

Automated tests and AI-assisted code review have been performed. These are **not an independent professional security audit, security certification or guarantee of legal compliance**.

## The separate local edition

When you run the local edition yourself, records are stored in a SQLite database on that machine. The browser may cache records and pending changes in IndexedDB. Its password controls access; **the local database, browser cache, queue and exports are not end-to-end encrypted**. Running this edition does not automatically upload its records to the hosted service.

Local corrections and soft deletions may retain earlier content; a Full backup can contain that history. Deleting a local account removes its records and sessions from the active local database and requests clearing its app cache, but cannot erase exports, machine backups or other copies. A person hosting a modified copy operates that copy separately from this website.

## Your choices, age and contact

While you can unlock your records, you can review, correct, export and remove individual records in the app. Depending on applicable law, you may also have rights concerning access, correction, deletion or other processing. Contact [uhenrywksp@icloud.com](mailto:uhenrywksp@icloud.com) to ask about these rights or report a privacy concern. We will handle requests according to applicable law; this policy does not limit your statutory rights.

This service is intended for adults **18 and older**, for their own records and simulations. We do not request birth dates or knowingly invite children to create accounts. If you believe a child has provided personal information, contact us without sending additional health information so we can address it.

## Policy changes

We will update the effective date when this policy changes. For material changes, our notification method is a **prominent notice on the website or in the app**, identifying the change, its effective date and this policy. We will post that notice before the change takes effect where practicable and as required by law. We do not collect account email addresses and do not promise an email announcement. A public source-code change alone is not our material-change notice. We will obtain any authorization required by law before making a use or disclosure that requires it; merely accepting this policy is not that authorization.

[Terms of use](https://treeezh.com/drug/terms.html) · [Public source code](https://github.com/Treeezheng/drug-tracker)
