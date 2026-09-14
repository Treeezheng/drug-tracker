# Mobile and records follow-up — 2026-09-14

This is an implementation and verification record for PR #8, not an independent security certification. Final commit, CI and live-file verification are recorded on the pull request after deployment.

## Resulting behavior

- A new dose scrolls into view and focuses its medication field after rendering. Editing medication, quantity, strength or time preserves the edited control's visual position. Phone navigation stays at the top; safe-area spacing and Apple standalone metadata are included. No service worker or offline cache was added.
- Matching catalog brand/generic entries share a medication choice. Solid reference estimates use clickable stars and one source/limits section; evidence-qualified values and completeness remain separate. Unsupported products still cannot acquire an invented concentration. See [reference scope](reference-overlay-2026-09-13.md).
- Chart dragging supports horizontal reading selection and vertical page scrolling. The footer, account controls, settings and discomfort disclosures have more compact, aligned layouts. The two History discomfort disclosure labels are centered with 44 px targets.
- Records has one right-aligned Download CSV control. Medication PDF and its dependency were removed. CSV retains times, meaningful medication amounts/status, discomfort and notes; internal identifiers and model metadata are omitted. Exact decimal amounts, combination/patch interpretation and spreadsheet formula-injection protection remain.
- A valid 24-hour server session is recognized after reopening the page. Only account authentication metadata is restored; the user must enter their password to unlock records again. Page exit clears keys, and stale session responses cannot overwrite a newer user action. Passwords, keys and decrypted records are not persisted to implement this feature.
- Hide retains the existing key-clearing behavior. Cloud account opens the Account section. Native username/new-password semantics support password managers, but the site cannot force a password generator to appear on a username field.
- Heroku's daily backup schedule is now enabled without a plan upgrade. See [actual backup evidence and limits](heroku-retention-review-2026-09-13.md).

## Verification before submission

- Complete application/API/PostgreSQL suite: **512 passed, no failures or skips**, using a disposable local PostgreSQL 18 instance. The subsequently added notice-generator suite separately passed **3 tests**; CI must run the combined current suite.
- Type checking and cloud compilation passed. Dependency audit after removing the PDF packages found no known vulnerabilities. The offline notice inventory check passed for 56 installed packages and 83 notice sections.
- Browser checks used synthetic local data. In a real 393 px iframe, quantity 1 → 2 → 1 kept the input at y = 403.8671875 px. Horizontal chart dragging changed the pinned reading. Top Add dose created and focused the new medication selector in view. The header computed as sticky at top 0, and both discomfort summaries centered with 44 px targets.
- In the compiled cloud application, Account navigation focused the Account heading; reload of an authenticated session showed “Unlock records” with the existing synthetic username and a password prompt. These observations do not claim testing every Safari/iPhone version or a third-party password-manager extension.

The privacy, webpage supply-chain, device, recovery-key, model and provider-retention limits in the existing security review still apply. No production health records were added or read for these UI checks.
