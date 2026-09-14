# Dose entry and encryption verification

13 September 2026. This pass used synthetic records and temporary databases. No personal records were uploaded or migrated.

## Browser checks

The in-app browser was used at desktop, 393 px and 320 px widths. These are responsive checks, not physical iPhone, Android, Safari, Firefox or Windows tests.

- The shared time picker uses five-minute choices by default, with one- and ten-minute settings available. Tapping, scrolling, keyboard arrows, Cancel, Done and the adjacent Now button were exercised. Cancel retained the original time; Done returned focus to its trigger. The final desktop version uses a 320 px anchored popover without a modal backdrop; mobile uses a bottom sheet. The visible dose title is “Dose time”.
- At 320 px, the picker and inline time/Now controls stayed within the viewport. The time trigger and Now button were 44 px tall. The Add button's white text on green has a calculated contrast ratio of 4.79:1.
- Medication legend titles, stacked strokes and strengths shared the same vertical center; the smaller italic brand occupied its own row below. The reading showed a larger time without a visible date; its accessible description retained the date and time zone.
- A future dose saved as Planned. It survived a page reload and appeared on its scheduled day. Editing its date into the past with Save changes kept it Planned. Mark taken then explicitly changed the same entry to Taken. The confirmation action was unavailable while the scheduled time was in the future.
- Record details, the lower time adjustment strip, Save plan and the favorite shortcut chips were absent. Formula, explicit record correction and stock tracking remained.
- A new encrypted account displayed the empty-stock explanation. The account started without importing the existing guest simulation. The stock card and its Add supply control were visually checked at 393 px.
- The medical disclaimer appeared in both the account and guest interfaces. The stock medication name was 18 px, with the brand below it.
- One-minute increments saved successfully through the local API. Bedtime used the same picker and displayed minutes 00 through 59. At 393 px it opened as a bottom sheet without horizontal overflow; at desktop width it was a nonmodal popover.
- A synthetic taken dose was deleted through the confirmation dialog. It disappeared without reopening an editor or adding a draft. Existing drafts stayed unchanged.
- Grouped methylphenidate choices offered only the saved 5 mg, 10 mg and custom 7.5 mg strengths, plus Custom. Selecting 7.5 mg retained its generic product identity.
- The final chart showed time and concentration together in the center. Its right-hand note read “Simulation only · Not medical advice”. A 72-hour Concerta view displayed “* No data” after the published trace ran out; the Simulation options control was absent.
- Stock names and strengths shared a line, with the smaller italic brand below. Sign out used a solid button. Backup & restore was collapsed below the account and sources sections.

## Automated checks

- TypeScript suite: 243 passed, no failures.
- Server suite: 68 passed, no failures; one PostgreSQL integration parent test skipped without its dedicated database URL.
- Separate fresh PostgreSQL 18.6 integration run: 11 passed, no failures or skips. The temporary cluster was cleaned up.
- Type checking, local build, Heroku cloud build and whitespace checks passed. Build output still reports the existing large-bundle warning.

## Encryption flow

- An existing synthetic cloud record unlocked with its independent encryption password.
- Cancel in the in-page Lock dialog retained the unlocked record. Confirming Lock returned to Unlock records. This completes the browser sequence that was previously blocked by the old native confirmation dialog, as recorded in `qa-guest-and-simplification.md`.
- A new registration was interrupted by reloading before vault setup. The resumed session required account authentication again. Reusing the account password for encryption was rejected after that authentication. A different encryption password completed setup.
- Independent code review and 58 focused encryption/storage/client tests found no upload of the encryption password, recovery key or plaintext account record payload. This is an internal review, not an independent security audit.

## Scope

The UI pass used the existing SQLite cloud service with a fixed source copy while Heroku/PostgreSQL integration was developed separately. It is not evidence that production Heroku, custom-domain HTTPS, production backups or PostgreSQL deployment have passed.

The server has no built-in record recovery key. Web-delivered encryption still depends on trusted delivered JavaScript, an independent strong encryption password and a trustworthy device. Guest storage, the local edition and downloaded exports remain unencrypted.
