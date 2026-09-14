# Final client change crosscheck — 2026-09-14

Fresh, bounded independent crosscheck of the uncommitted client candidate against `f6c01e75`. Earlier review conclusions were not used. This checks repairs after two source-review rounds; it is not a security, medical, legal, or release certification.

## Scope and result

Inspected `src/lib/api.ts`, App account reset/logout/deletion and the keyed Settings subtree, `AuthDialog.tsx`, `TimelineChart.tsx`, `timeline-series.ts`, `history-bars.ts`, and History aggregation. Supporting reads covered their transaction, preference, report, date, and model dependencies. Server changes, production, deployment, and broad compliance were outside this crosscheck.

No new blocking regression was identified in the inspected candidate. The following behavior was verified:

- Confirmed logout/deletion hides the current view and clears `dataRef` before device cleanup; failed deletion and failed logout preflight preserve records. Settings remounts when its owner changes.
- Current private snapshots preserve queued edits. Stale snapshots fail the account-generation/cache-epoch guard inside the atomic write transaction. A delayed acknowledged mutation does not recreate an explicitly cleared cache. In-flight exports reject after same-tab account invalidation or a successfully committed peer cache clear, including when late pending work must remain on the device.
- Closing or disposing a pending local authentication dialog prevents a late parent handoff. Once parent loading begins, closing is disabled until that handoff settles.
- Chart samples are owned by the view. Actual component rerenders reuse them for pointer and width changes, recompute after an immutable same-ID dose edit or policy/time-zone/date change, and remove paths when records clear. Inspected callers replace dose arrays rather than mutating them in place.
- History retains exact decimal ingredient totals, separates unknown ingredient snapshots, includes both report endpoints in the report time zone, and bounds long ranges without dropping the latest periods. Summary cards now describe the selected medication; the medication picker and complete records table remain available.

## Evidence

Node 24 synthetic-only focused run: **72 passed, 0 failed/skipped** across local client/auth lifecycle, timeline series/estimates/data/reference rendering, history bars/amounts, reports, time, and profile preferences.

Additional in-memory probes passed for delayed mutation acknowledgement after cache clear; all six daily/monthly/yearly aggregation thresholds (62/63 days, 1,200/1,201 months, and 1,200/1,201 years); UTC+08:00 month/year boundaries; and the mounted chart rerenders described above. These supplementary probes were executed from standard input without changing application or test files.

## Crosscheck repair and limits

A pre-existing edge case was reproduced and repaired during this crosscheck with the main agent's authorization. When pending work appeared after logout preflight, `clearCache(owner)` previously aborted before advancing the epoch, allowing a peer's already-started export to return. It now atomically clears the saved snapshot and advances the epoch, preserves the outbox, then raises the pending-work warning after commit. The new two-client regression verifies export and snapshot rejection, exact preservation of the queued request, and successful later synchronization. No App edits were required.

Genuine storage I/O failure can still prevent durable cross-tab invalidation. The initiating view hides records and warns about incomplete cleanup; this does not establish that another tab has erased its existing memory.

The transaction tests use a serialized, atomic in-memory storage adapter, and rerender checks use isolated hooks. This crosscheck does not establish browser-engine behavior, exhaustive concurrency safety, immediate erasure of other tabs' existing in-memory records, or protection against a compromised device/site. No production accounts, real health records, network services, Git mutations, or deployments were used.
