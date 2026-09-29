# Repository bug audit — September 28, 2026

Audited base: `a04d5bb4b95cb48244648731ba363d168efe1763`.
The automatic quota-recovery follow-up starts from PR #26's merge,
`d6dd2f1c327bb77bdf62f5f64047580ef4d944ee`.

Scope: the first-party task, eligibility, history, import, date, account,
browser persistence, recovery, cloud reconciliation, Firebase adapter, PWA,
location, and landscape paths. The audit used synthetic boards, controlled
browser-storage failures, mocked Firebase modules, and the Firestore emulator.
It did not inspect a user's tasks or production Firestore documents.

## Confirmed findings and repairs

| Area | Finding | Repair |
| --- | --- | --- |
| Cloud write authority | The Firebase adapter accepted a missing, string, fractional, negative, or unsafe caller revision. A malformed stored revision could also advance because Firestore rules only see the next integer written by the adapter. | Reject malformed caller and stored revisions before `tx.set`; require revision zero to create a missing document and stop at the safe-integer boundary. |
| Cloud diagnostics | Backend catches discarded Firebase error codes, malformed cloud replies returned silently, and an auth-storage failure hid configured cloud recovery. The header could show only a generic error. | Keep only a safe failure stage and code, distinguish adapter and reconciliation failures, leave configured recovery visible, and show the stage/code in the cloud-button title without retaining exception text, payloads, or credentials. |
| Account reauthentication | Signing out and back into the same account left the earlier read authorized, so the next local action could write before checking for changes made while signed out. | Reset reconciliation authority on every identity transition; a returning account must read before writing. |
| Account chooser | Google's default popup could immediately reuse the account that had just signed out, so the cloud button did not actually let the user switch accounts. | Set `prompt: select_account` on every Google sign-in popup. Existing account-switch backup, adoption, and stale-callback gates remain in force. |
| Current-board recovery | Settings had no reachable way to preserve the live in-memory board after a device save failure. | Add view/copy and download actions that serialize the live cloud payload, including unsaved edits and excluding device-only bookkeeping. Bulk import remains absent. |
| Imported identifiers | Restored task and context IDs were interpolated into HTML attributes without escaping. Quotes could create attributes, and a dynamic selector could throw while revealing a task. | Escape every task/context data attribute and locate reveal targets by exact decoded dataset value. |
| Pasted prerequisites | Multiline Add used the selected dates and recurrence options but silently dropped the selected prerequisite. | Resolve the prerequisite once and assign it to each pasted task. |
| Eligibility filter | A task marked Worked on it was excluded from the scanner pool but still appeared under the Eligible list filter. | Treat the active worked hold as Ineligible until Return as candidate or normal expiry clears it. |
| Local failure diagnosis | Ordinary edits and Undo shared an undifferentiated two-copy device-save warning, so aggregate quota, concurrent writes, storage denial, and a missing Restore proof could not be told apart. | Emit a stable `device-save:<stage>/<code>` signature in the warning and Settings. The live board remains untouched and is linked to Current board recovery. A successful retry clears the stale diagnosis. |
| Clean cloud adoption | A newer Firestore board could already contain every local task, become durable and clean without a push, yet leave its redundant safety backup pinned until an acknowledgement that would never arrive. Under aggregate browser quota, that false pin could stop the next ordinary edit with the exact device-save warning. | After the adopted board is durably saved, release the pin only when the board is clean and a complete shared-content comparison proves the prior board is represented. Keep the recovery row as ordinary history. Union writes, same-task conflicts, unknown legacy rows, and failed durable writes remain protected. |
| Retained recovery archive quota | A current iPhone screenshot after PR #26 showed `device-save:primary-write/quota-exhausted` while the cloud badge still said synced. Once manual, displaced, or protected recovery rows consumed the local-storage budget, automatic-history rotation could not make room for either guarded primary key; the same pressure also stopped the mandatory pre-adoption backup with `Cloud copy held`. | On a real quota failure, losslessly compact the recovery index and retry. The versioned archive has a checksum, exact UTF-16 round-trip, legacy plain-JSON reads, compare-and-swap writes, and fail-closed corrupt/unknown handling. Whole-index compaction preserves the exact decoded JSON; appending a required safety row preserves every existing payload byte. Packed targeted deletion retains every remaining row's lexical bytes. The header reports `save error` until a durable retry succeeds. |

The original local diagnostic did not create more browser capacity. The
follow-up quota repair compacts retained recovery data without deleting it and
retries both ordinary primary saves and mandatory cloud-adoption backups. If
the already-compacted archive plus the board itself still exceeds the browser's
site quota, the app continues to fail closed rather than sacrifice a sole copy.

The clean-adoption lifecycle first became bad in `2fe1cfd` on September 28,
2026 (`Keep offline conflict recovery through reload`). The same synthetic
production-path fixture has no pin on `3902a28` or `ce65372`. From `2fe1cfd`
forward, it creates the pin but schedules no push because Firestore already
contains all local content. The September 28 releases then reach the exact
device-save warning when the next larger edit needs to rotate that falsely
protected row. The repair retains the recovery row but removes its temporary
protection after the clean adopted board is durable.

The Google chooser gap is longstanding: cloud sign-in first entered the
repository in `42b251f`, and no committed adapter requested
`prompt: select_account`. That explains the reported same-account return but
does not explain a new September 28 device-save regression. The user reports a
guaranteed working September 26 build. A deliberately irreducible manual and
protected-backup quota fixture also fails on the September 24 baseline, so it
cannot identify the first bad release by itself.

## Red-first and green evidence

Each changed behavior has a named regression in `tests.js` that was observed
failing before its implementation:

- Cloud revision validation wrote with an undefined base revision.
- Cloud diagnostics exposed no failure stage or code; malformed payloads left
  no reconciliation error.
- Same-account sign-out/sign-in called push before pull.
- Google sign-in provided no `select_account` parameter.
- Settings had no Current board recovery control.
- Imported quote-bearing IDs appeared as live attributes and could enter an
  invalid reveal selector.
- Pasted tasks lost their selected prerequisite.
- A worked task appeared beside a ready task under Eligible.
- A local-only Undo under aggregate quota reached the generic warning with no
  callable stage/code diagnosis.
- A clean cloud adoption kept its redundant recovery ID protected even though
  it was durable, clean, fully represented in Firestore, and scheduled no push.
- A protected recovery archive at a fixed aggregate quota reproduced the
  phone's exact primary-save signature; the same storage state held the cloud
  at its mandatory pre-adoption backup. The cloud button remained falsely green.

The focused repaired matrix passes cloud adapter, cloud diagnostics,
account, resource-exhausted retry, recovery export, imported-ID rendering,
pasted prerequisite, Worked eligibility, Restore-proof diagnosis, and the
existing local-backup/cloud-adoption cases. The cloud-adoption cluster covers
clean no-push adoption, the next ordinary save under a fixed total quota,
union acknowledgement, a larger concurrent draft, same-task displacement,
legacy ambiguous recovery, and a zero-headroom user-equivalent row. The final
local full suite passes 965 of 978 tests with 13 expected browser skips and no
failures. The Firestore emulator rule case passes 1 of 1. Cache-fingerprint,
changelog, risk-inventory, and test-change rationale checks pass inside that
suite; exact-commit validation remains a release gate after the commit is
frozen.

The quota follow-up additionally covers byte-exact Unicode and lone-surrogate
codec round-trips, corrupt and unknown envelopes, cross-tab compare-and-swap,
failed encoded writes, compressed cold reload, raw view/download/delete,
ordinary primary recovery, mandatory adoption recovery, and an irreducible
already-compacted store that still refuses without deleting protected rows.

## Scope checked without a new finding

A separate read-only pass on `a04d5bb` ran 54 focused cases with 54 passing
and one WebGL browser-render case skipped. It covered location permission
failure, time zones, DST and polar boundaries; 568 by 320 landscape geometry,
device-pixel ratios, reduced motion, reflections and shadows; and service
worker cache and update retry behavior. No additional first-party defect was
confirmed in those paths.

Existing tests also continue to cover local two-key interleavings, stale tabs,
Restore proof renewal, automatic-backup rotation, held cloud adoption, account
switches, revision conflicts, history reconciliation, imported dates,
evergreen boundaries, and offline-shell updates.

## Evidence limits and remaining design boundaries

- The affected iPhone screenshot after PR #26 proves the current build reached
  `device-save:primary-write/quota-exhausted` and simultaneously rendered a
  false green synced badge. The phone's private backup contents were not
  inspected. Post-deployment ordinary edit and Undo recovery on that phone
  remain unverified until the user naturally receives this follow-up release.
- Firebase CLI authentication was unavailable. Production rules, SDK traffic,
  account documents, and server responses were not inspected. Emulator rules
  accepted valid next revisions and denied stale revisions, bad timestamps,
  other users, unauthenticated reads, and deletes.
- The whole shared board remains one Firestore document, so the 1 MiB document
  limit remains. A modeled `resource-exhausted` write keeps the local draft
  dirty, preserves its browser copy, reports the cloud error, and retries; no
  data-schema migration was justified by this audit.
- No real-browser offline reload or new public rendered UI check has happened
  for this candidate. Public HTTPS rendering and deployed-byte checks remain
  release gates. Local-file browser access is intentionally outside the test
  environment.
- Same-task cross-device conflicts still require human choice. The active
  revision wins, while the displaced board remains a durable local recovery
  copy.

## Release memory sources

The candidate's required memory audit must include these current corrections:

- `/Users/emeraldpham/.codex/memories/extensions/ad_hoc/notes/2026-09-28T235000Z-funsidething-save-root-cause.md`
- `/Users/emeraldpham/.codex/memories/extensions/ad_hoc/notes/2026-09-29T002257Z-funsidething-save-still-unresolved.md`
- `/Users/emeraldpham/.codex/memories/extensions/ad_hoc/notes/2026-09-29T010141Z-funsidething-confirmed-phone-quota.md`
