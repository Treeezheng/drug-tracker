# Seven-day device unlocking and mobile controls review

Date: September 14, 2026. Scope: changes following `ff521c6`.

## Security review

Two independent review passes examined device-key storage, OPAQUE sign-in,
recovery, expiry, revocation and concurrent browser activity. Findings were
corrected and regression-tested before release:

- An older enrollment could overwrite a revocation from another page. Enrollment
  now captures the revocation epoch before asynchronous authentication and checks
  it throughout storage and publication. A later revocation wins.
- A stale unauthorized response could close a newer sign-in. The response is now
  bound to its requesting owner and workspace generation.
- The recovery-key acknowledgement step could restart the in-memory deadline
  when browser storage was unavailable. The deadline now starts at successful
  authentication and survives that step without renewal.

The final security pass reported no remaining actionable findings in this scope.
This is an engineering review, not a security certification or a guarantee that
the application is free of vulnerabilities.

## Device-storage boundary

Automatic unlocking is selected by default and lasts at most seven days from
explicit authentication. Reopening a page does not renew it. A fresh server
session and the current vault envelope are required before records are opened.
Hide, sign-out and disabling the preference revoke the saved device grant.

The browser stores an encrypted vault key and a non-extractable wrapping key in
IndexedDB. It does not store the account password, OPAQUE export secret, or
decrypted records for this feature. Anyone able to use this browser can open
records while the grant and server session remain valid. Compromised same-origin
code or an accessible browser profile remains a risk; a non-extractable key is
not a defense against code allowed to use it. The settings help and privacy
documents describe this convenience/security tradeoff.

## Functional and visual checks

- Full local suite: 600 passed, zero failures/skips. The final history-status and
  medication-menu adjustments subsequently passed their focused regressions;
  release CI reruns the full suite on the committed source.
- Real OPAQUE client/server tests cover enrollment, reopening, changed envelopes,
  expiry, revocation races and stale responses.
- Browser testing with a disposable synthetic account confirmed reopening with
  automatic unlocking and requiring the password after Hide and reload. The
  Security switch also removed the grant and required a password after reload.
- Phone and tablet previews confirmed equal 44-pixel date/time controls with a
  12-pixel gap, including Confirm taken and the inventory receipt form.
- Inventory Other opens the complete picker, adds the selected medication and
  preserves the entered receipt quantity and note. Tablet buttons use 0.5 steps.
- A final functional pass found that removing every guest favorite exposed
  unsaved catalog strengths. The guest editor now receives the empty selection
  explicitly and retains only the current record's strength in that case.
- Explicit saves classify past/current instants as Taken and future instants as
  Planned. Merely passing a planned time never confirms administration.
- Previous actual records are combined into one dashed From history path per
  analyte. Earlier simulated/planned entries are not labelled as recorded history.
  Existing concentration calculations and evidence qualifications are retained.
- Types and the cloud production build pass. Public icon files are explicitly
  allowed by the static server and included in the reproducible build manifest.

Protected branch checks, build provenance and live asset hashes must be verified
for the final merged commit before the release is reported as deployed.
