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

## Final full-suite follow-up

The a93 exact full run retained 2,781 passes, 50 explicit environment skips and
three counted failures (two top-level blockers). The strict ACK/sibling-source
consumer still called the old internal helper name; retaining that name fixes
the contract without editing its existing assertions. The three-Yes consumer
also exceeded its unchanged 1,000 ms budget at 1,001 ms. This is a failed gate,
not a pass rounded down.

A source-bound CPU profile and independent call-graph inspection found that
ordinary Yes and Done each sampled and sorted every rank twice: once at the end
of projection, then immediately again before History capture. The first numeric
distribution was discarded. Those action owners now defer the projection refresh
and retain the final refresh. Standalone projection and refused-projection
fallback still refresh through their existing owner. Sample count, probability
formula, History and timing assertions remain unchanged. Exact successor evidence
is required; the failed a93 run and both successful installed cases remain
separate intermediate evidence.

## Slower-runner follow-up

The c3 candidate passed its exact local full run but failed both push and PR
CI. Three Yes controls took 1,127 / 1,345 ms and three Done controls took
1,081 / 1,353 ms against the unchanged 1,000 ms budgets. The push run also
failed the initial no-ACK recovery acknowledgement. Local approval did not
establish a releasable candidate; both failed CI logs remain retained.

The remaining sampling loop repeatedly resolved Gaussian/Math globals. It now
uses the same Box–Muller operations and random order with per-invocation Math
references and a local spare returned to the shared stream. Cold probability
display reuses its already normalized unique rows, preserving the directed
formula and opponent addition order. Its normal CDF receives the current Math
reference instead of resolving it again for each pair. Replacement calculators,
pair functions and Gaussian callers keep their ordinary fallback. Sample counts,
Float64 scores, Float32 distributions, sort order and stopping rules stay intact.
Exact released golden distributions, subsequent Gaussian/random draws and
null/zero/odd/even spare controls were captured before these numeric edits. The
first characterization failure was a nested VM-array comparison in the fixture;
host-normalizing those entries passed on unchanged c3. It is not behavioral RED.
The first numeric repair still exceeded Done's budget (1,077 ms); the source-bound
profile justified the CDF refinement. The refined local focused totals were
about 520 ms for Yes and 310 ms for Done. Final full and CI evidence remains
separate from these intermediate timings.

The recovery failure was isolated without changing application authority or
acceptance deadlines. The 2 MB cold fixture accidentally used the fake backend's
25 ms fault-test deadline, unlike its seed's explicit 5,000 ms positive settings.
A controlled 40 ms transaction interleave reproduced the failure on CI's Node 22.
The verifier then called the status-mutating fake backend while the app waited
for its safe retry, replacing the transient error and suppressing that retry.
Waiting for the actual owner/retry before verifying passed under the original
25 ms limit with the same interleave, within the unchanged five-second ACK/head
window. The fixture now has explicit existing positive backend settings and a
passive owner wait; all original exact source, cloud ACK, durable-head and reopen
assertions remain. Production automatic paths enter the app-owned pull, rather
than this verifier-only direct-pull loop. This was a fixture correction, not
permission to relax recovery evidence or change production deadlines.

## Remaining slow-runner headroom

The exact296 PR CI passed all2,835 tests (2,785 passes/50 environment skips),
rules13/13 and compatibility15/15; threeYes793ms andDone391ms met the original
budgets. Its matching push CI failed only threeYes at1,184ms. This is insufficient
headroom, not permission to retry until a favorable machine passes. The candidate
remains unreleased and both complete logs are retained.

A fresh source-bound profile isolated actual Yes-owner work from expensive
fixture setup:348 self samples included60 in rankStats (34 in its CDF loop) and57
in chanceHash. The CDF resolves Math.min for every matrix cell; History fingerprints
resolve Math.imul for each UTF-16 code unit. These methods are now bound to the
current Math object once per invocation, after sampling for the CDF. The same
score comparator is reused across samples. No sorting, formulas, Float32 writes,
random draws, hash constants, input units, overflow behavior or output IDs change.

A new preservation control passed before those edits: exact released hashes for
empty, short, surrogate/Unicode and long History inputs, stable-tie CDFs/TopK and
receiver-sensitive Math replacements between invocations. This positive is not
behavioral RED; the unchanged CI1,184ms failure is the symptom evidence. The first
focused successor measured threeYes365ms andDone232ms, with both numeric controls
passing. Final candidate-focused, native, independent review and full exact CI
remain separate release gates. Earlier full runs keep their original identities.


## Protected source restoration after00acffe

Both00acffe CI runs met the unchanged action budgets (pushYes872ms/Done555ms; PRYes842ms/Done535ms), but failed the existing overall-Chance source fingerprint for chanceHash. The focused cohort had omitted that guard; the candidate was not merged or deployed. Both complete failed runs and earlier approvals remain historical evidence. The protected algorithm is restored byte-for-byte from296; its old expected digest and every assertion remain unchanged.

To retain useful headroom without editing that algorithm, History now reuses one exact basis only when freshly rebuilt serialized inputs match. The key still contains all open IDs/raw ratings/current availability and sample count in the original language-independent order. The combined retained input/result strings are limited to256Ki UTF-16 units. Original hash/Math/imul identities guard every hit; replacements and oversized inputs take the ordinary uncached calculation. No task, board, stats or validation graph is retained, and the memo grants no source or publication authority.

The actual counter RED observes624 rather than312 hash operations on a repeated exact input before the memo. Earlier fixture errors called a lexical helper as an exposed function; those are preserved as nonbehavioral setup failures. Controls cover changed ratings/eligibility/IDs/membership/samples, reorder and empty inputs, replacement/restored calculators and Math objects/methods, and exact input-plus-result cap/overflow. Exact forecast goldens and current-receiver controls passed before passing this invocation's Math object through the existing Phi/phi interface. Every integration node, reduction, operation, tolerance and depth remains unchanged.

The profile also identified repeated three-key sorts/joins in frozen-opponent validation. Ordinary exact keys use a membership fast path while all other key counts retain the released sort/join expression. Review found that separator-containing keys plus hidden/inherited values could pass the old expression; an observed later sensitivity failure and the original fallback preserve that edge instead of tightening the accepted boundary. No validation result is cached.

Broad local regression, fresh exact installed/native/private/rendered checks, renewed independent review, full candidate CI and main deployment/live acceptance remain required separately. This diagnosis does not establish physical iPhone OS termination cause, peak heap or authenticated affected-account recovery.

## Main release fixture ownership correction

The reviewed7b89ced candidate passed both full push and PR CI, including the
unchanged action budgets, rules, compatibility and both installed-client cases.
After PR #232 merged asce18245, main run39703012911 cancelled the existing
delayed evergreen stale-read case: its promise remained pending after the event
loop emptied. There was no assertion failure, and Pages did not deploy.

The case assumed that100ms meant the prior completion had published and its
peer read had finished. A duplicate app-owned pull correctly returns while
another read owns the source. Arming a one-shot hook and waiting for that
duplicate to enter it can therefore wait forever. The exact main interleave
was not traced; an isolated real40ms incumbent read reproduced the same
cancellation. Waiting for that actual owner was the sole positive-control
difference and preserved every original completion/title/session assertion.

The permanent fixture now waits for actual idle, clean, matching cloud revision,
payload and durable local bytes before taking the completed source. It awaits
the deliberately occupied owner before installing the stale-read hook, bounds
hook-entry/response waits, then requires durable publication after the newer
revision. The original stale-response/newer-notification ordering and all four
assertions for both clients remain. A new occupied-read case failed by actual
cancellation before this correction, then passed with the original case. Missing
hook entry now fails with a specific bounded error instead of cancelling the
remaining suite. No production read guard, timing budget, protocol, sample,
fingerprint, source-protection or publication authority changes.

The invalid initial recorder purpose was a command error, not behavioral RED.
The valid preimplementation record is2026-10-22T01-28-11-866Z-c59cddb6-80bb-47ea-bfc2-62ee21390986;
the first two-case green is2026-10-22T01-28-45-773Z-cca5584b-5c7f-4011-a6f0-ed66de11485a.
Independent diagnosis and immutable main CI logs remain in the task evidence.
This test-only successor has identical public product bytes to7b89ced. Its
reviews, exact candidate CI and main release gates must pass before publication;
earlier runtime evidence retains its original source identity and limits.

## Main 754 performance and clock follow-up

Both 1fb87ce candidate runs passed all 2,840 tests (2,790 passes and 50 explicit
environment skips), rules 13/13, compatibility 15/15 and both required native
installed-client cases. Three Yes controls took 649/568 ms and Done 393/347 ms.
After PR #236 merged, main run 39708059186 failed the unchanged three-Yes limit
at 1,032 ms [345,341,346] and an older paused-resume assertion. Pages did not
deploy. The candidate passes do not override either main failure.

The resume fixture began at real UTC 01:58:33.735 and resumed two minutes later,
crossing the app's local 02:00 date marker. An independent exact-source UTC
control reproduced the precise expected/actual timestamps; the same instant
under New York stayed on the same pass. Fixed local noon preserves the original
assertion, actions and offsets, while both adjacent true-rollover controls pass.
This corrects a nondeterministic fixture, not the production date-reset rule.

A new source-bound CPU profile of actual Yes owners found repeated saved-draw
fingerprints across before/after observations, squared ordering and rendering.
Packed-array and stable-merge sorting experiments in external copies gave no
useful improvement; the production rank sampler and its sorting remain unchanged.
The permanent work-counter RED through squaredScore observes 138 rather than
69 hash multiplications for two identical inputs (record 02-19-19-045Z-192e326e).

Squared scoring and display now reuse original chanceHash results only for exact
primitive input strings, with at most 2,048 entries and 256 Ki UTF-16 input units.
Every caller still reads its current draw seed, task ID, weight, scale and
eligibility. Hash, Math namespace and data-descriptor method identities guard
reuse; altered methods, accessors, objects and oversized inputs stay uncached.
No draw, task, board, source validation or publication authority is retained.
All nine pinned function source slices, sample counts and 1,000 ms budgets remain.

The first implementation's adjacent helper placement failed the byte-exact hash
slice guard; moving the helper after an unprotected function restores the old
slice without changing the algorithm. A later accessor sensitivity control
observed 2384096672 instead of 3761576854 before data-descriptor guards; that
finding is repaired and retained separately from the original RED. The expanded
14-case focused green includes the source guard, numeric/stream preservation,
fresh caller/eviction/cap/accessor controls and original resume/day controls.
Three Yes controls took 359 ms and Done 244 ms locally. These timings do not
establish CI, deployment, physical iPhone or affected-account acceptance. Fresh
exact candidate full/native/rendered checks, independent review and required
candidate/main CI and live verification remain release gates.


## Diagnostic success-clock correction after 498

Exact 498 PR run 39712795260 passed all 2,842 tests (2,792 passes, 50 explicit
environment skips), rules 13/13, compatibility 15/15 and both installed cases.
Three Yes controls took 566 ms and Done 375 ms. The matching push run
39712765969 passed both action budgets at 981/586 ms and both installed cases,
but failed the 150 ms source-diagnostic success subcase (nested and parent count
as two failures). It was not merged or deployed; the unchanged run was not retried.

That fixture gave the entire real source review a 150 ms wall-clock budget while
asserting successful completion. An independent exact-source causal pair pauses
the first real root read for 200 ms. The ordinary clock reproduces false instead
of true; production correctly reports timeout while diagnostics still records
150 ms. Activating the existing fixture clock at the real review boundary keeps
all three original 150/999999/1 inputs, expected 150/60000/60000 limits and every
original assertion. It passes with the same scheduler pause. This proves a
sufficient clock-premise mechanism; the exact uninstrumented CI stop stage was
not traced and remains inferred.

The permanent 150 ms subcase now includes that bounded pause before the clock
repair's original success assertion. Its owner preimplementation record
2026-10-22T03-13-32-676Z-159c8dda observes the same false/true failure; the corrected
four-case green retains all original assertions. Cleanup disposes the fixture
before stopping its logical clock. Actual expiry, cancellation and production
SDK limits remain unchanged. No application, CSS/font, worker or public product
byte changes accompany this correction. Prior source identities and failed CI
remain retained; fresh exact-candidate reviews and remote release gates are
still required.
