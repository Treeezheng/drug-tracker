# Security policy

Drug Tracker is an experimental personal tracking and simulation application. The current `main` branch is maintained; there is no security certification or independent professional audit of a release.

## Report a vulnerability privately

Use [GitHub's private vulnerability reporting](https://github.com/Treeezheng/drug-tracker/security/advisories/new), or email **uhenrywksp@icloud.com** (operator: **Treee**).

Include the affected commit, component, a minimal reproduction using synthetic data, and the likely impact. Do not put passwords, recovery keys, database connection strings or real health records in a report. Do not disclose exploitable details in a public issue before coordination. There is no guaranteed response deadline or paid bug bounty.

Please restrict testing to a local instance you control. Do not access another person's account, probe the production service with destructive or high-volume tests, or retain other users' data.

## Scope and limits

Cloud account records are encrypted in the browser before upload. The single-password flow uses OPAQUE: the password, client export key, data decryption key and complete recovery code are not transmitted. Authentication records, recovery-verification hashes, temporary protocol state, account/session metadata, connection metadata and ciphertext sizes remain outside health-record encryption. Recovery transmits only its independent account-authorization secret; the decryption part stays in the browser. Guest storage, the local edition and downloaded exports have different, unencrypted storage behavior. The [Privacy Policy](PRIVACY.md) explains those boundaries.

The recovery code is an alternative credential, not MFA. Users must acknowledge saving each new code, but the app cannot verify the existence of a usable external copy. The operator cannot restore the records when both the password and recovery code are lost. A plaintext recovery download or complete code must be protected like a credential. Rotating a data key does not revoke previously copied ciphertext, keys or plaintext.

A website operator or a compromised release pipeline can change JavaScript delivered to an unlocked browser. Repository scanning, HTTPS, OPAQUE and client-side encryption do not eliminate that threat. OPAQUE authentication records and the server setup secret are sensitive: compromise can enable offline password guessing. Protect GitHub and hosting accounts with strong independent credentials and MFA. Keep hosting, database and OPAQUE setup secrets out of the repository and out of frontend build variables. Do not regenerate an existing database’s setup secret as an ordinary restart or an unplanned repair.

The [review history](docs/security-reviews.md) identifies the user-supplied Claude report and the implementation-side OpenAI Codex review without claiming vendor approval. The [OPAQUE candidate review dated 13 September 2026](docs/opaque-release-review-2026-09-13.md) records the scope and release status checked then; the [OPAQUE protocol](docs/opaque-protocol-v1.md) describes the current source implementation. Earlier [client](docs/security-review-client-2026-09-13.md), [server](docs/security-review-server-2026-09-13.md) and [legal](docs/privacy-legal-review-2026-09-13.md) reviews describe their own checked versions and limits; they are not certifications. A source change does not establish which build is currently deployed.

The [2026-09-14 two-round review](docs/independent-security-review-2026-09-14.md) adds fresh-agent server/client/compliance checks, efficiency repairs and a synthetic PostgreSQL restoration drill. Final source, CI, provenance and production-file verification belong to that release's pull-request evidence; no AI review constitutes a guarantee that all vulnerabilities or legal obligations have been found.
