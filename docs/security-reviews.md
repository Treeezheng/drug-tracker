# Security review history

This record describes work performed and the evidence available. AI review is not a security certification, clinical validation, legal opinion, or an endorsement by the companies that provide the models. No independent professional penetration test has been completed.

| Review | Scope | Evidence and status |
| --- | --- | --- |
| Claude, 2026-09-13 | User-supplied read-only code review and production HTTP inspection | [Original report](reviews/claude-2026-09-13.md), preserved as received. It identified issues; it did **not** approve the site or execute the test suite. |
| OpenAI Codex (GPT-6), 2026-09-13 | Code review, changes, synthetic-data regression tests, responsive UI and deployment verification | [Client review](security-review-client-2026-09-13.md), [server review](security-review-server-2026-09-13.md), [privacy/legal assessment](privacy-legal-review-2026-09-13.md), and the release follow-up report. This is implementation-side review, not independent assurance. |
| OpenAI Codex (GPT-6), 2026-09-13, single-password candidate | OPAQUE primitives, storage/credential boundaries, recovery presentation and documentation consistency | [OPAQUE candidate review](opaque-release-review-2026-09-13.md). Source, artifact and production verification are tracked separately. Earlier two-password checks are historical evidence, not proof of this replacement flow. |

No other reviewing organization is claimed here without its identifiable report, date, tested version, scope, and result.

The current public account flow uses one password and one recovery code; it does not offer a two-password setup or a legacy migration screen. Historical reports remain available in their original context. A local-development Lighthouse score measures its stated performance/accessibility checks, not OPAQUE security or production penetration resistance.

## Reading the original report

The original review separated production, a Git commit, and a changing working tree. Some references mix those snapshots: Terms/age-consent work was in the worktree, not necessarily the commit described as HEAD. Absence of an internal symbol in a minified JavaScript file alone does not prove source-version mismatch. Findings must be reproduced against an explicit source commit and deployed asset hash. Legal applicability statements in the original are the reviewer's assessments, not established legal determinations.

## Verification and limitations

- [CI](../.github/workflows/ci.yml) checks code and disposable SQLite/PostgreSQL databases. Tests do not use real health records or production credentials.
- [GitHub protection settings](github-verification.md) record repository controls separately from application encryption.
- [Build metadata](https://treeezh.com/drug/build-info.json) lists a public source commit, toolchain, lockfile digest, and SHA-256 digests for the frontend files. Compare these with a verified GitHub Actions artifact, not merely a server-provided commit label.
- A signed GitHub build-manifest attestation proves which workflow produced that manifest. It does not attest medical correctness or guarantee that every response from a web operator is unchanged.
- Browser encryption depends on authentic delivered JavaScript and a trustworthy unlocked device. OPAQUE keeps the normal flow’s password and client export key off the wire, but server authentication records and setup secrets still need protection; compromise can permit offline guesses. Strong passwords, idle locking and key rotation do not remove this trust boundary or revoke old copies. A saved-key acknowledgment is not proof of a durable recovery copy.
- Provider retention, incident response, account recovery and legal obligations are described in the [Privacy Policy](../PRIVACY.md), [retention review](heroku-retention-review-2026-09-13.md), and [incident runbook](incident-response-runbook.md). Operational duties still require a person to carry them out.

Please use [private vulnerability reporting](../SECURITY.md) for new security findings. Do not publish credentials, recovery keys, health records or exploit details affecting an unpatched live service.
