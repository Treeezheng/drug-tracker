# Guest simulator and interface verification

September 13, 2026. All records used for this pass were synthetic. No personal database was changed, uploaded or migrated.

## Automated checks

- 214 TypeScript tests and 64 server tests passed: 278 total, no failures or skips.
- Coverage includes grouped favorites with multiple and custom strengths, exact fractional quantities, reference-model eligibility, formula consistency, repeated-dose legends, guest storage boundaries, registration, account isolation, migration rollback, concurrent encrypted saves and authentication sequencing.
- Final TypeScript check and both local and cloud production builds passed. Vite still reports a main JavaScript chunk above 500 kB before gzip; this is a performance optimization opportunity, not a build failure.
- Separate agents reviewed the medical-model boundary, registration/encryption code and files intended for publication. Documentation was corrected where it overstated username privacy or implied that new illustrative assumptions could still be created.

## Browser checks completed

Tests used the Codex in-app browser and isolated local test services. The production cloud build was served at `/drug/` using a separate temporary database.

- The medication picker presents equivalent brand/generic products as one strength selection group. The brand appears below the title in smaller gray italic text. Selecting multiple strengths remains possible without rewriting existing records.
- Custom `7.500` normalized to `7.5`; zero showed a validation error. A custom strength could be saved directly with Save selection. Reopening the picker retained it.
- `7.5 mg × 1.5 tablets` produced exactly `11.25 mg`. A synthetic cloud account saved that actual record, then recovered it after unlocking again.
- Repeated medication/strength legend entries were combined with stacked color strokes, while independent dose curves remained. The range slider was absent; the larger reading was visible. Keyboard arrows moved the chart reading by the configured increment.
- Desktop, 393 px and 320 px layouts were inspected. The picker and expanded Formula panel had no page-wide horizontal overflow. At both mobile widths the Formula button had identical measured coordinates and dimensions before and after expansion. Text and formula lines wrapped within the card.
- The public simulator worked before sign-in and retained its simulated dose after reload. Taken opened the account flow. Registration displayed encryption and open-source information, then required an independent encryption password and recovery-key acknowledgement.
- A newly registered account started empty; it did not import guest doses or favorites. A wrong encryption password failed. The saved recovery key and the correct encryption password both unlocked the synthetic record. Signing out returned to the original guest simulation without copying the account record into it.

## Remaining verification limits

The old native `window.confirm` used by Lock blocked browser automation: retrieving its dialog returned no handle, and later focus/close operations timed out. Lock now uses the existing in-page confirmation Modal, with Cancel/close preserving records and the final Lock invoking the same tested lock transport. This final presentation change passed TypeScript and independent source review, but its complete browser click sequence could not be accepted in this session because the browser connection remained affected by the old dialog. Do not count that last click sequence as a completed browser test.

Responsive width checks are not physical iPhone, Android, Safari, Firefox or Windows device tests. The public domain, provider enrollment, DNS, production HTTPS, backups and a production security audit remain outside the completed local verification.
