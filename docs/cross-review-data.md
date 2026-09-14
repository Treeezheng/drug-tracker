# Independent data and persistence cross-review

Reviewed 13 September 2026. This review examined the original multi-page App, the report/backup parser, and the client/server boundary. The main agent subsequently began the requested three-page redesign; the App findings below are therefore integration checks for that rewrite, rather than claims about its final state.

## Findings and fixes

| Priority | Concrete issue at review time | Resolution or required follow-through |
| --- | --- | --- |
| P1 | Importing a complete JSON backup used only `wrapper.data`, discarding the immutable revisions and tombstones. Reusing an old Profile ID also failed on a new account after preceding rows had already been imported. | Added transactional `POST /api/import` with full archive validation, Profile owner mapping, correction/tombstone preservation, merge/replace modes, and rollback. The UI must submit the raw wrapper rather than the `AppData` returned for preview. |
| P1 | A concurrent-edit conflict remained first in the offline queue. There was no review/discard action, so it blocked all later replay and sign-out indefinitely. | Added `pendingChanges` and `discardPendingChange`. The UI must provide an explicit choice to keep the server version, fetch fresh data after discarding that exact queue ID, and resume remaining requests. |
| P2 | A saved scenario omitted the published-only tail policy and view date/range/zone. Loading it under different current controls could show an estimated tail where the saved scenario originally showed an unknown contribution. | Save and restore scenario view configuration. Scenario-level model pins must also be inherited by rows without their own pin; unavailable pinned versions must remain unknown. The rewritten App owns this integration. |
| P2 | `parseBackup` accepted historical/custom product IDs, while `getProduct` threw on any ID absent from today's catalog. Importing such a record could make the account view fail to render. | Preserve a snapshot-based unknown-product fallback, or reject unsupported IDs during preview before any writes. Do not reinterpret an unknown product as a different known medication. |
| P2 | `loadUser` assigned the account ref when called, allowing a stale refresh continuation to start another old-account load after sign-out. An owner ID alone cannot distinguish two transitions involving the same account. | Use a transition generation and reject stale loads before starting them and before applying their results. The expected-owner HTTP header independently prevents writes under a changed session cookie. |

## Verified data protections

The API validates the expected account against the authenticated cookie, with direct tests showing a changed session cannot replay an earlier account's new record ID. Mutations preserve exact decimal strings, append correction revisions, reject stale edits, and retain deletion tombstones. Repeated identical writes and repeated deletes do not add extra events. Account deletion removes only that owner's records and audit data.

The browser outbox uses real IndexedDB transactions. The root agent ran the original 11 browser checks successfully, covering concurrent writes during replay, pending overlays, owner changes, conflict retention, and cache acknowledgment. Two checks were then added for explicit conflict removal/replay and inventory receipt caching; all 13 need a fresh browser run after these additions.

## Inventory addition

Migration 002 rebuilds the collection constraint inside a transaction and copies all existing records/revisions before replacing the tables. Inventory receipts use the same owner, revision, retry, export, import, and tombstone mechanisms as dose records. A dedicated migration test starts from the pre-inventory schema and verifies the old dose and immutable revision survive unchanged, with no foreign-key violations.

Receipt quantities remain decimal strings, including fractions. Full package strength, quantity unit, UTC receipt instant, original time zone, and notes remain snapshots. The server stores receipts; the App derives stock from applicable receipts minus actual administrations so corrections and Undo recalculate consumption once. Future receipts and administrations must not affect an earlier stock reading, and administrations before the opening balance must not be deducted again.

## Evidence and practical limits

The backend test suite now passes 26 checks, including full restore into a new owner after the original account is absent, exact snapshots and original creation times, profile mapping, preserved revisions/tombstones, malformed-import rollback, receipt retry/isolation/restart, large imports, and schema migration preservation. Full archives retain correction history; current-data archives explicitly start fresh histories because those files do not contain previous corrections.

IDs are global within each collection. A restore that collides with another still-existing account rejects atomically rather than attaching or overwriting its records. Cross-account copying while both accounts remain present would require an explicit ID-remapping feature; this is distinct from backup recovery.

The local service is loopback-only and has no cloud sync. Database and browser files are not end-to-end encrypted. These tests establish storage behavior and calculation implementation behavior; they do not establish clinical validation or a final visual acceptance of the rewritten interface.

## Follow-up: saved preferences and independent stock review

Both direct server writes and import validation now reject unsupported time increments, incomplete scenario views, impossible dates, unsupported day counts, unknown/offset time zones, and non-boolean published-only choices. Profile increments of 5 and 10, each view length of 1–3 days, and older backups omitting both new preferences all pass. Invalid replace imports leave current records and immutable history unchanged. The affected report, backup, and existing stock tests pass 22 checks; the report module also passes isolated strict TypeScript checking.

The following stock findings were reproduced with synthetic inputs against `src/lib/inventory.ts` and then fixed after authorization. No UI files were changed:

| Priority | Reproduction and result | Suggested fix |
| --- | --- | --- |
| P2 | A receipt for `10` mg and one actual tablet recorded as `10.0` mg are both valid exact-decimal inputs, but the old key compared their raw strings. A stock of 10 incorrectly remained 10 rather than 9. The same applied to slash-separated combination strengths. | Fixed: canonicalize each strength decimal only for grouping, retaining original strings in snapshots and display. JSON tuple keys keep product, ordered ingredient strengths, and units separate without delimiter collisions. |
| P2 | Duplicate IDs were deduplicated by first occurrence instead of latest revision. Revision 1 for one tablet followed by revision 2 for half a tablet left 9; reversing the order left 9.5. A revision 2 `skipped` record followed by revision 1 `actual` still deducted one. Receipt corrections had the same order dependence. | Fixed: select the highest revision for each ID before status, date, and stock grouping; reject disagreeing copies of the latest revision while ignoring JSON object property order. Current API data contains one live row per ID, so this was a defensive calculation gap rather than evidence that normal API reads contain duplicate revisions. |

The stock suite now passes 12 tests. Added cases verify scalar and combination decimal matching, preserved snapshot text, unit separation, correction order independence, corrected skipped/planned/simulated statuses, corrected dates before opening stock or after the reading instant, corrected receipt quantity/date, same-revision conflict rejection, and equivalent reordered JSON properties. Stock, backup, and report suites together pass 28 checks, with isolated strict TypeScript checks passing for inventory and reports.
