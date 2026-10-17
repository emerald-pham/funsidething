## Problem Statement

Working on the same Chain Scanner board on a phone and a Mac can roll back
valid decisions. Starting from one board, the phone may advance five decisions
while the Mac advances one. A later saved snapshot can replace the phone's
progress even when the decisions do not conflict.

The audit reproduced two forms of this problem: reopening loses the remembered
common starting board and can remove five independent No decisions and their
effective ratings; an open session can also lose one of two independent dotted
choices because the dotted chain is treated as an indivisible saved value.
Comparison history and a recovery copy may survive while the active board and
acknowledged cloud board no longer honor those choices. A Synced badge therefore
does not establish that decisions were merged correctly.

## Solution

Merge board decisions according to their meaning. Keep every nonconflicting
decision from both devices, retain every distinct deliberate comparison as
useful learning evidence, and count repeated delivery of one recorded action
only once. Resolve genuinely incompatible current board choices using the time
the person made each decision, preserving the comparison evidence involved.

The resulting board, effective ratings, dotted chain, eligible tasks, and
history must reflect the retained decisions and converge across devices,
regardless of upload order, retry, or reopening. Undo must reverse its action
while preserving unrelated decisions made on either device. Existing saved
boards, account isolation, offline use, recovery safeguards, and conditional
cloud publication remain protected.

## User Stories

1. As a person switching between phone and Mac, I want five decisions on one device and one independent decision on the other to survive sync, so that switching devices does not roll back my progress.
2. As a person using two devices, I want the same decisions retained whichever device uploads first, so that connection timing does not choose which work survives.
3. As an offline user, I want locally saved decisions to survive closing and reopening before reconnecting, so that my progress does not depend on leaving a page running.
4. As a person returning to an older tab, I want its independent new decisions combined with the current board, so that an older starting copy cannot replace newer work wholesale.
5. As a scanner user, I want choosing B over A on my phone and C over A on my Mac to retain both choices, so that both tasks keep their intended place in my work.
6. As a scanner user, I want separate comparisons of the same task pair to remain separate useful observations, so that repeated deliberate judgments contribute their intended evidence.
7. As a scanner user, I want different answers in separate comparisons retained as observations, so that resolving the current board does not erase useful preference evidence.
8. As a person reconnecting after a failed upload, I want a retransmitted comparison counted once, so that retries cannot accidentally strengthen my preference.
9. As a scanner user, I want retained comparisons to affect effective ratings and rankings, so that keeping history alone does not hide a lost decision.
10. As a scanner user, I want the dotted chain derived from retained choices, so that overlapping chain changes do not suppress an independent Dot.
11. As a scanner user, I want candidate, eligibility, and scan mode to remain coherent after merging, so that the next visible action applies to the task I can see.
12. As a person making incompatible current choices on two devices, I want the later decision time to resolve the conflict, so that a delayed upload does not give an earlier choice fresh authority.
13. As an offline user, I want decision times preserved through local saves, reloads, and retries, so that reconnecting does not rewrite when I chose something.
14. As a person making unrelated changes to one task, I want compatible changes retained together, so that an edit to one property does not suppress an independent task action.
15. As a person using Undo, I want only the action being undone reversed, so that unrelated progress from my other device remains intact.
16. As a person undoing a comparison, I want its effect reversed without losing other comparison evidence, so that Undo does not replace the whole earlier board.
17. As a person syncing an Undo, I want its reversal preserved through reconnect and reopening, so that an older copy cannot silently reapply the undone action.
18. As a person completing a task, I want Done and evergreen work history retained through concurrent sync, so that stale copies cannot reopen finished work or duplicate a work session.
19. As a person deliberately reopening or returning a task, I want that action to retain its existing causal meaning, so that a legitimate return is distinguishable from stale open data.
20. As a person deleting or postponing a task, I want existing deletion and deferral safeguards retained, so that merging comparisons does not resurrect or prematurely release it.
21. As a person editing a task, I want my open draft protected while remote decisions arrive, so that sync cannot replace an unfinished form or change the task under a pressed control.
22. As a person using an existing saved board, I want its learned ratings, task data, history, and preferences preserved during upgrade, so that the repair does not restart my scanner.
23. As a person with older backups or clients, I want unsupported or incomplete decision evidence preserved safely, so that compatibility handling cannot invent decisions or discard the only surviving copy.
24. As a person switching Google accounts, I want decisions, pending actions, and Undo authority bound to the correct account, so that another account cannot receive my board's evidence.
25. As a person whose cloud request fails, I want my local actions to remain saved and pending until confirmed, so that a successful read alone cannot acknowledge an unmerged write.
26. As a person waking the installed app, I want interrupted requests reconciled before new publication, so that late acknowledgements and stale replies cannot override the current board.
27. As a person encountering device storage pressure, I want mandatory recovery copies preserved and publication held safely when necessary, so that sync cannot outrun the device's durable copy.
28. As a scanner user, I want existing scan-day resets and temporary hold expiry to remain meaningful, so that retaining decision evidence does not make expired pass state permanent.
29. As a person restoring a backup or resetting the board deliberately, I want those explicit replacement actions to retain their established meaning and recovery safeguards, so that ordinary action-scoped Undo does not redefine them.
30. As a person checking sync status, I want Synced to follow confirmation of the exact reconciled board, so that the badge cannot hide missing retained actions or unsaved local work.
31. As a person updating the app, I want the repair to work through the existing safe update process, so that an unsaved draft is never force-refreshed.
32. As a person reading Help, I want the FAQ and release notes to explain cross-device decision merging and Undo accurately, so that I can understand the resulting behavior without reading implementation details.

## Implementation Decisions

1. **Separate decisions from snapshots.** A cloud revision orders publication of a complete board. It does not prove that every decision in that board is newer or more accurate than decisions on another branch. Keep conditional revision publication; do not replace it with a whole-board clock comparison.
2. **Separate comparison evidence from current choices.** Every distinct deliberate comparison remains valid evidence, including comparisons of the same pair with matching or different answers. A current board choice may require conflict resolution without invalidating either comparison observation. Sharing a task, rating, or dotted chain does not by itself make two decisions conflict.
3. **Persist action identity and original context.** Preserve a stable identity, original decision time, account ownership, meaning, affected tasks or choices, and sufficient observed context for every newly supported decision. Repeated delivery uses the same identity; a separate deliberate comparison has its own identity. Local save, retry, upload, and wake recovery must not mint a replacement identity or decision time.
4. **Retain enough durable reconciliation evidence.** Reopening must retain the common base or explicit pending decisions needed to combine branches. A page-memory ancestor alone is insufficient. Keep that evidence until it is represented by a durable reconciled result, and preserve it if a save or acknowledgement fails.
5. **Derive effective state from retained decisions.** The board merge must honor all retained decisions in effective ratings, dotted membership, and other affected scan state. Merely unioning history while accepting one branch's ratings or chain is insufficient. Apply each active comparison observation once, preserve explicit action dependencies, and derive a stable converged result without fabricating comparisons that the user never made.
6. **Resolve genuine current-choice conflicts narrowly.** Compatible task properties and actions merge. Incompatible values for the same current choice use original decision time, rather than snapshot publication or upload time. Use a stable tie-break when supported decision times are equal. Missing or untrusted legacy chronology must not be manufactured from a recent save timestamp; preserve the evidence and use an explicit conservative compatibility rule. Existing completion, deletion, reopening, and deferral protections remain authoritative for their domain intent.
7. **Make Undo target its action.** Reconciliation must preserve the identity and effects of the action being undone. Reverse that action against the current reconciled board while retaining unrelated decisions and useful history. Preserve normal Undo availability and gesture scope; this does not introduce a new interface for undoing arbitrary remote history.
8. **Migrate learned state conservatively.** Preserve existing learned ratings and saved data as a valid baseline. Older observational history must not be guessed into a complete replayable comparison stream or applied again on top of its already-learned ratings. Preserve unknown evidence and exact recovery copies. Newly recorded supported decisions must remain mergeable without requiring destructive resets or manual export/delete recovery.
9. **Protect mixed-client operation.** A stale or metadata-unaware snapshot must not silently erase acknowledged decision evidence or turn omission into an Undo. Preserve compatible reads and supported legacy actions. If a writer cannot preserve the required authority, hold it safely through the existing compatible-client recovery path. Any protocol or rules change must satisfy the repository's backward-compatibility and rollout gates before release.
10. **Keep the established storage and cloud safety boundaries.** Retain durable device saves, immutable verified cloud generations, account-bound pending publication, server-authoritative reads, revision compare-and-swap, protected recovery, editor and gesture deferral, and bounded retries. A failed read is not proof of an empty cloud; an unknown write outcome is not an acknowledgement.
11. **Keep projections and maintenance subordinate to intent.** Ranking recomputation, candidate repair, background saves, revision hints, and reconnects must not become new user decisions. Preserve each decision's original task and pass context, existing scan-day boundaries, and established eligibility rules.
12. **Keep the implementation choice bounded by this contract.** No particular CRDT, event-log product, database replacement, serialized record layout, or new cloud schema number has been selected. The owner must implement the smallest durable representation and reconciliation boundary that satisfies these behaviors. Do not treat the audit's synthetic probes as a preapproved implementation or production-proof harness.
13. **Update guidance with the behavior.** The corresponding extended FAQ, Settings changelog, and setup explanation must describe decision-preserving reconciliation, comparison evidence, conflict timing, scoped Undo, and the current cloud architecture accurately. Preserve unrelated guidance and existing product behavior.

## Testing Decisions

The approved primary test seam is the existing complete-application consumer
harness: two independent app instances performing normal scanner, list, editor,
and Undo actions, with isolated device stores and a shared synthetic cloud
backend. Drive reconnect, revision notification, visibility, and reopening
through their existing entry points. Assert the visible board and effective
ratings, retained history, durable saved result, and exact final cloud content.
The user approved this test boundary before publication of the spec.

This seam catches action-to-persistence-to-reconciliation regressions. It does
not establish real browser event timing, live authentication, deployed rules,
or physical-device lifecycle behavior. Add focused checks at the existing
device-store and production cloud-adapter boundaries only when those components
change or when the primary seam cannot demonstrate their guarantees. Browser,
emulator, and production release evidence remain separate requirements.

Prior art includes the existing two-client live scanner sync tests, same-tab
write serialization tests, stale-tab and durable-store recovery tests,
completion and evergreen Undo propagation tests, and sleeping-publication
readback tests. Reuse those established boundaries rather than inventing a
helper-only merge test as the primary acceptance.

Required behavioral coverage:

1. Start both devices from the same board; make five decisions on one and one nonconflicting decision on the other. Retain all six, their effective consequences, and the unrelated board data after either upload order.
2. Repeat that scenario with offline saves and a full reopen before reconciliation, using the production IndexedDB path and supported fallback storage as affected.
3. Choose B over A and C over A on different devices. Preserve both dotted choices and both observations, and converge to one valid board without inventing a B-versus-C judgment.
4. Make two deliberate comparisons of the same pair, including different answers. Preserve both as separate learning evidence and exercise their effects through the existing ranking behavior.
5. Deliver the same recorded comparison repeatedly through retry, delayed acknowledgement, listener hints, and reload. Count it once. Distinguish this from a second deliberate comparison.
6. Make incompatible current-choice changes at different decision times; upload the earlier action last. Select the later decision while retaining comparison evidence and unrelated changes.
7. Exercise equal, missing, and skewed time metadata. Require stable convergence, preserved evidence, and no silent promotion of upload time into decision time; do not claim to recover true wall-clock chronology from inaccurate device clocks.
8. Undo a local action after receiving independent remote progress. Reverse only the target action, preserve the remote progress, and keep that result after publication and reopening.
9. Regress completion, evergreen work history, deliberate reopening, deletion, postponement, prerequisites, explicit Restore/Reset, scan-day expiry, editor drafts, and stale controls wherever the new reconciliation touches them.
10. Preserve old boards' learned ratings and observational history during migration, reject duplicate application of historical learning, retain unknown formats, and exercise supported older clients against the candidate protocol and rules.
11. Exercise account switches, sign-out/sign-in, stale responses, failed local recovery saves, failed cloud reads, uncertain publication, and successful retry. No response or queued decision may cross account authority.
12. Require a meaningful observed behavioral RED before each runtime repair, followed by focused GREEN and the repository's required final regression checks. Existing passing contracts remain protected. The audit probes are reproduction evidence, not substitutes for this chronology.

Before a product release, complete the repository's independent code and
persistence/sync review, independent FAQ coverage review, applicable rendered
review, compatibility checks, exact-candidate CI, and deployment verification.
Use isolated boards and authorized test identities; do not mutate personal
production data for QA. Record local tests, browser/emulator behavior, ordinary
production evidence, and physical-device evidence separately.

## Out of Scope

- Replacing Firebase, moving to a different authentication provider, or introducing a separate collaboration service.
- Redesigning the scanner's ranking algorithm, candidate selection, normal scan-day behavior, or visual interface beyond what is required to honor retained decisions.
- Inventing missing historical comparison actions, timestamps, opponents, or posteriors from older snapshots.
- Adding a remote-history browser, arbitrary cross-device Undo interface, or a user-facing merge-conflict management workflow.
- Redefining explicit Import, Restore, or Reset as ordinary action-scoped Undo; their existing deliberate replacement and recovery contracts remain protected.
- The separate byte-budget defect in large cloud upload batches, cleanup scheduling/pagination work, and unverified diagnostic-code hypotheses from the audit.
- Creating implementation tickets, starting runtime implementation, or treating publication of this spec as evidence of a deployed repair.

## Further Notes

The user explicitly rejected deduplicating separate deliberate comparisons:
both comparisons are valid and useful data. Only repeated delivery of the same
recorded action is a duplicate. This distinction must remain intact when the
spec is split into implementation tickets.

The audit inspected main revision `69a9feddf5d6bb8c4973475f7232e363b8646097`.
Its 137 existing focused sync/storage tests passed. Separate synthetic
complete-app probes reproduced the reopening and independent-Dot failures;
those were local reproductions, without personal production-board or physical
device verification. Refresh the implementation baseline against current main
before starting work and preserve concurrent saved-view changes.

The shared contract is intentionally separate from the eventual ticket graph.
Any later tickets must carry their own acceptance criteria and genuine blocking
edges while referring back to this behavior. This spec requests the documented
repair; it does not claim that implementation, release, or production recovery
has happened.
