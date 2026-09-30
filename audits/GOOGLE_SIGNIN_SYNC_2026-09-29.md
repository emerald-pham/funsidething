# Returning-user Google sign-in sync loop

The report described an older browser board cycling between synced, syncing,
and error after Google sign-in. The reporter later confirmed that refreshing
recovered their session.

## Historical cause and evidence

The pre-September-23 backend at `cd17075` writes only `payload`, `updatedAt`,
and `rev`. On September 23, `995c70f` introduced rules requiring
`serverUpdatedAt == request.time`. The old client can still read its own account,
but those writes are deterministically rejected. Its successful read sets the
badge to synced even though its local board has never uploaded. Another focus
read schedules another rejected write. Refresh loads the compatible client.

The actual historical backend was executed against today's repository rules in
the Firestore emulator: three consecutive rounds returned an empty cloud with
status ok, then a failed write with status error. The status event stream was
syncing/ok/syncing/error each time. A server-stamped compatible envelope then
succeeded against the same rules. The synthetic reproduction script/log are kept
with external release evidence.

Read-only production Monitoring for the four hours ending September 30 at
01:50 UTC reported 16 permission-denied Commit responses and 50 successful
Commit responses (the same metrics appear under two resource types; they are
not added together). The denials occurred around 23:42–23:54 UTC. No transient
error series appeared in that window. The authenticated rules API returned
ruleset `930f7cf6-ab24-4b54-8c28-5920292b1816`, byte-identical to repository
`firestore.rules`, SHA-256
`9a638570a6d4dc508d0d365bbb4d356f0665c14846c33709a1ce279d194699e1`.

This establishes a real historical compatibility failure consistent with the
report and refresh recovery. Aggregate metrics do not identify dreev's request
or prove which client they were running. No personal cloud board was modified.

## Current-client repairs

- A failed or invalid read after a write conflict previously released another
  write using stale read authority. The red tests produced 21 writes instead
  of one before their deliberate safety cutoff. Fresh reads now hold write
  authority until a usable, safely adopted response releases it. Prior read
  evidence and pending local work remain available for recovery.
- Repeated conflicts even with successful reads previously looped indefinitely.
  The red test reached its 31-write safety cutoff. One ordinary conflict still
  reconciles immediately; subsequent conflicts share the bounded retry budget
  and delay rather than racing at network speed.
- Permanent rejected writes repeated on focus and local edits (five attempts in
  the red test), while successful reads could hide the error. An account-bound
  hold now prevents automatic resubmission and retains the visible diagnostic.
  Explicit retry or exact cloud-content confirmation can clear it. A rejected
  write checks for an app update through the existing safe worker updater.
- The error badge previously signed users out. It now offers Retry sync,
  Reload app, and explicit Sign out. Reload requires a successfully saved,
  unchanged board and no active editor; failed saves retain the open page.
- First uploads of older boards could carry a false clean marker and replenish
  transient retry budgets. They now remain dirty until confirmed. The original
  red tests recorded 25 and 24 writes instead of five.

The repair does not relax rules or change cloud schema, task content, revision
ordering, account isolation, or backup retention. Already-running historical
JavaScript cannot be retroactively rewritten: those users still need to reload
once. The current client provides safe update/reload recovery and prevents
these failure paths from becoming silent automatic loops in future releases.

## Validation

New risk tests cover all repaired boundaries, including permission, transient,
malformed-payload and invalid-response failures, repeated conflicts, older local
boards, exact acknowledgement, rejected-write focus behavior, safe reload and
explicit sign out. No existing assertions were weakened. Focused and full test
logs, historical emulator reproduction, rules tests, rendered recovery checks,
independent exact-commit reviews, CI, Pages and live fingerprints are retained
separately with release evidence. Synthetic tests do not exercise the reporter's
private Google account.

## Memory audit

Read the current memory registry's cloud-data audit and release-review entries,
the linked September 23 cloud reconciliation summary, and current repository
instructions. Preserve read-before-write, exact recovery copies, account isolation,
revision ordering, and the distinction between tests and ordinary live sign-in.
The current repository requires separate memory/cloud/sync and code reviewers
of the final SHA. No memory files were changed.
