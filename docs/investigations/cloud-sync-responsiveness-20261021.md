# Populated-board responsiveness and repeated damaged-source reads

The agreed target is iPhone 16 Pro on current iOS Safari, including a session
with little memory headroom. The reported full app restarts remain a separate
acceptance: a Node timing improvement does not establish their cause or a phone
fix. All fixtures below are independently constructed synthetic boards.

Baseline: `c677724ded14b4c4519975c57a81f028283b08ff`.

## Reproduced causes

1. Ordinary task actions repeatedly calculated all task-pair probabilities for
   History and display. A 434-task board with 80 archived Start facts and 40
   retained completion boundaries blocked three real Yes controls for 3,764 ms.
   The source and all three accepted decisions survived actual device-store
   readback and reopening. The existing three-second startup test never exercised
   this repeated-action workload. A CPU profile identified probability calculation
   and rating normalization as the largest costs, ahead of serialization.
2. Done also computed every saved-pass probability when there was no saved draw,
   even though its saved-pass fallback result was necessarily false. Three real
   Done controls initially blocked for 2,957 ms. Completion and Undo preserved
   their intended effects; the missing acceptance was responsiveness.
3. A corrupt eight-chunk generation whose hash differs from the device's last
   acknowledged copy cannot be reconstructed automatically from that copy. Each
   subsequent Add, Start, No and Done nevertheless triggered ten more SDK reads
   of the unchanged current and previous sources. Four local actions caused 40
   extra reads, without advancing the cloud revision or repairing it. The normal
   save-to-push path bypassed the existing finite network retry policy.
4. A supported cold-opened export has no private acknowledgement payload. That
   branch also repeated four SDK reads per edit, even when no exact copy could
   repair the source. When its current bytes did match the published hash, the
   early acknowledgement requirement still refused automatic reconstruction.
   A fresh consumer pair reproduced both gaps after the first candidate passed
   its full suite; independent specialist review identified the missing branch.
5. Even with an exact repair copy, unrepresented or JSON-lossy pending intent
   must refuse rebuilding. Those completed refusals still downloaded 12 SDK
   reads for each ordinary edit. Four actions added 48 reads for each of four
   independently constructed pending shapes, including BigInt and cycles.
   The missing acceptance was finite work after a safe refusal, not permission
   to discard the pending evidence.

## Repairs and preservation

A bounded numeric cache updates only probabilities affected by a few changed,
added or completed tasks. It retains no boards, History or task-pair table. Full
calculation remains the fallback; numerical tails use direct calculation. Saved
scan draws, ranking rules, decision facts and cloud formats remain unchanged.
A source with no frozen draw no longer computes unused saved-pass weights.

After a complete, current check finds no exact acknowledged or current-board
copy of the corrupt generation, ordinary local edits remain pending without
downloading both generations again. A local byte/hash check can recognize a
newly exact current candidate without repeating network work. An unavailable inspection does not establish that
negative result and still permits later exact-copy repair. Explicit Retry,
foreground recovery and a newer server revision still perform fresh guarded
reads. An exact acknowledged-copy repair still uses the existing validated,
source-preserving conditional publication. A supported current board with the
same published UTF-8 length and hash now uses those same protection, identity,
pending-intent and publication guards even without a historical acknowledgement.
A different hash never grants repair authority. Completed pending and immutable
source-validation refusals now hold the same repeated work. Pending holds retain
only bounded pointer scalars and recheck local storage: a new pointer, newly
lossless representation or matching current candidate releases to a fresh guarded
read. Failed local reads remain pending. Other sources require an explicit
choice. No older source is silently adopted and no original source is erased.

Permanent consumer regressions in `tests.js` cover the three-action interaction
budget, History, completion/Undo, actual device readback and cold reopening,
freshly recomputed probability agreement, bounded damaged-source reads, explicit
Retry and a healthy newer server revision. The existing exact-copy recovery,
source-refusal, account, pending-upload and acknowledgement cases stay protected.
A transient exact-source-read positive control initially interfered with the
app-owned pull by polling the backend too early. The corrected test waits for
that operation; the earlier failure is not claimed as preimplementation RED.
The independently observed unchanged-source read-budget RED remains valid.

## Evidence and limits

Contemporaneous REDs were recorded before each repair. The no-acknowledgement
consumer pair first failed to clone synthetic SDK timestamp functions; that
fixture failure was corrected before runtime edits. Its real RED observed
20 reads versus 4 and failure to reach a repaired cloud acknowledgement. The
first repaired positive passed reconstruction but used the wrong clock for
its final cold reopen; the corrected fixture retains full-state assertions at
the same test time. These intermediate failures remain in external evidence. The local candidate cut
three Yes controls to about 0.88 seconds and three Done controls to about 0.85
seconds, and cut the four unchanged-source action batches to zero additional
SDK reads. These are local Node measurements, not calibrated iPhone budgets,
peak WebKit heap measurements, authenticated affected-account recovery or proof
that iOS no longer terminates the app. Exact candidate/native/review/release
results belong to the release evidence rather than this historical snapshot.

The pending hold positive control first used the normal pending writer, which
intentionally normalizes unknown fields; this made that simulated pointer
lossless earlier than intended. The corrected fixture uses raw IDB for the
unknown-preserving peer transition and the normal writer for the later supported
transition. Its original physical pending value remains retained under a separate
fixture row. No application change was needed for that fixture correction.
