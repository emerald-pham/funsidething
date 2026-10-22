# Reload while opening cloud recovery review

## Agreed report and acceptance

The person reports that the app reloads by itself after opening **Cloud sync
needs attention** and choosing **Review cloud recovery sources**. The review
starts automatically; the reload occurs once its data appears to have loaded.
They did not request Reload app or a browser refresh. The preceding investigation
identifies iPhone 16 Pro on Safari as the affected setup; a different device has
not been reported in this discussion.

The review must remain usable after its sources load, keep the accepted board,
edits and original recovery sources intact, and explain a failure it cannot
safely resolve. Reading the review must neither choose a source nor publish it.
The person's clarification of this exact control and transition is the agreed
consumer boundary. No broader recovery-policy change is requested.

## Consumer seam and evidence limits

Use the existing app action for the sync warning followed by
`review-cloud-source-recovery`, with independently constructed saved boards and
the existing external SDK/storage fixtures. Check completion into a usable
review, cancellation, no unrequested navigation or publication, and durable
preservation after reopening. Existing native recovery consumers exercise the
same controls in an actual browser.

Node consumers can establish data safety and action results. Native browser
consumers can establish rendered responsiveness and unexpected document changes
in their tested runtime. Neither alone establishes why a physical iPhone
terminates a page or proves the affected account has recovered. Preserve those
limits when reporting a reproduction or release.

Baseline: `831b0de128fabb6e5abe5665bee5745e45e26a4e`.

## Observed reproduction attempts

The existing native complete-source consumer passed both its long-scalar and
byte-matched short-value cases in desktop WebKit 26.5 at 390 by 844, using a
1,077,141-byte source. This is an existing positive control, not a reproduction.

A temporary extension then drove the actual warning and review controls with
436 synthetic tasks, 280 History entries and a 2,222,848-byte source. It observed
native navigation, page crashes and page errors while the review loaded, then
checked the same document identity, accepted board, durable head and exact raw
device sources. No reload, crash or page error occurred; no source was selected.
The case passed in approximately 3.2 seconds. Service workers were blocked in
this isolated source-review fixture, so it does not establish installed-client
update behavior or physical iPhone survival.

The first larger-fixture attempt incorrectly waited for the original 64-task
fixture after constructing 436 tasks. Its 30-second timeout is a fixture error,
not behavioral RED. The corrected run passed on unchanged application source.
A rejected recorder correction identifier was a command error, not a test run.
The recorder retains the original and corrected results separately.

Retained local evidence uses the durable task directory
`cloud-review-reload-20261022`, with run records:

- `2026-10-22T09-54-25-368Z-41a28e4c-4e7a-4a55-a140-7650f02848f8`:
  existing native positive controls, three passes including the parent.
- `2026-10-22T09-58-10-344Z-959d835d-93f1-4a53-b13e-f23beb267cc5`:
  larger-fixture setup timeout.
- `2026-10-22T09-59-16-914Z-016181d7-8206-451f-a682-f76a49179927`:
  corrected populated consumer, one pass and no skips.

The temporary consumer diff is retained as `populated-native-repro.patch`
outside the checkout, together with the recorder's exact source/diff provenance.
It is not shipped as a claimed regression for an unreproduced crash.

## Remaining evidence

The reported reload has not been reproduced and its cause is unconfirmed.
No crash fix is justified by these passes. The affected
app's local support report identifies its executing build and retained sync-error
codes, as recorded below. Current source-stage events
are held only in memory and may have disappeared during the reported reload;
a report after reopening therefore cannot establish the lost process's final
stage or an OS termination reason. No production account or saved board was
modified in this investigation.

## Affected-app report received

The person supplied the metadata-only support report captured at
`2026-10-22T10:01:12.344Z`. Its executing main-script SHA-256 is
`ca2f6b421948170b87807078d726fc18f6d95d486af9a2026dc5db217e30696c`,
which matches the unchanged baseline's main inline script exactly. The report
identifies iOS and standalone display mode. Worker identities were unobserved;
this does not establish absence of a worker.

At cloud revision 2346, the selected generation declared eight chunks and
2,057,012 bytes but returned zero chunks. The previous generation declared
eight chunks and 2,014,008 bytes and returned all eight. These reads were marked
unverified: receipt of eight chunks alone does not establish a valid source.
The retained acknowledged copy was available but did not match the selected
generation, and no pending source was observed. The corrupt-generation warning
therefore has a substantiated source-read failure; choosing an older source
automatically would not be a justified repair.

The retained observations do not record an interactive review reaching a final
render, an app-requested reload or an OS termination. They cannot establish the
cause of the reported restart. Preserve that uncertainty when selecting the
next reproduction rather than attributing this current build to an old client.

## Approved unified debug log

The person explicitly approved a temporary local restart record, then expanded
the request to normal-use reloads, one replacement in-app debug log and copy/paste
without requiring a download. The existing report consumer remains the public
boundary; its wire schema stays compatible while the visible debugger becomes
Debug log. The proposed record contains only fixed recovery-stage names,
timestamps, ephemeral document identity, navigation type and an explicit reason
when the app itself requests a reload. It contains no task titles, board values,
account identifiers, payloads or generation identifiers, and is never uploaded.

Retain at most one hour of records within an eight-KiB storage ceiling. A missing,
invalid, full or unavailable store must leave the app usable and report diagnostic
availability honestly. Another tab's observations cannot be presented as this
tab's proved restart, and a missing record cannot establish an OS crash. Records
must never establish source consent, durability or cloud acknowledgement.

The changed consumer seam would be the existing local support report after
reopening: reproduce an interrupted review, then require its bounded metadata to
remain available alongside the new document's observations. Positive controls
cover completed/cancelled review, explicit reload, malformed/expired data,
unavailable storage and separate tabs. This is approved diagnostic work, not a verified crash fix. The original
reload remains unconfirmed in the isolated runtime.


## Implementation and test-first evidence

The unified log retains four recent document records and eight events per
record, bounded to eight KiB and one hour. Fixed action/stage/status names,
random per-document identifiers and timestamps are stored under one dedicated
local diagnostic key. No board, task, account or cloud-generation identifier
is retained. Records from other tabs are explicitly possible; missing events
never establish OS termination. Current save/cloud acknowledgement fields keep
their existing identity guards and are separate from historical observations.

Observed preimplementation assertion failures precede ordinary-action restart
retention, replacement copy UI, failed-write status, physical expiry on access,
and both actual app reload reasons. The recovery-stage case initially also
exposed a fixture clock mismatch: its warm app uses the existing fixed incident
clock, while the first cold fixture booted at real time and correctly expired
those older observations. The corrected cold fixture installs that same time
before script startup and waits for the actual rendered-stage observation.
Its corrected pass is not a new preimplementation RED. The earlier normal-action
retention RED remains the valid first failure for the persistent observer.

The five-case update/storage/privacy cohort and the unchanged existing support,
cloud-authority and PWA controls retain their source-specific run records in the
external task evidence. A focused cohort caught a changed explanatory phrase
that no longer satisfied the established metadata-report/not-a-backup wording;
the runtime copy was restored rather than weakening that assertion.

Rendered, independent code/specialist/FAQ/typography, compatibility, installed
client, CI and deployed results must be bound to the final candidate separately.
The approved diagnostic release does not assert that the original physical
phone reload, affected account or missing cloud chunks have been repaired.
