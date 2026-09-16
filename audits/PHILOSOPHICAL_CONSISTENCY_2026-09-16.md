# Philosophical consistency audit — September 16, 2026

Audited application commit: `1ae4d5058b7efc8a3480823be845ee7d64cd12d8`.
Repair branch: `fix/consistency-findings`.

Status: all seven findings below have been repaired and independently reviewed. Source line numbers describe the audited commit above, before the repairs. Existing unrelated changes to README.md, CLAUDE.md, the test-first hook, and untracked AGENTS.md remain separate. The earlier scan-mode routing fix shipped as `1c80cef`; closing Settings without Save was subsequently covered by immediate dropdown persistence. No real accounts were used in the audit or its regression tests.

## Governing principles

1. Only a deliberate Yes/No comparison teaches the preference model. Completion, urgency, elapsed time, and maintenance are different events.
2. Eligibility answers whether a task may appear; TrueSkill and scan mode answer which eligible task appears next. Returning to eligibility does not guarantee the next slot.
3. A chance pass has a stable order but live ratings. Only explicit new-pass/day boundaries justify retaining a new draw across Undo.
4. A local list belongs to an account. Device identity and sync revision survive replacing task content.
5. A background operation must not silently make an unfinished user edit unusable.
6. Equivalent ways of starting work must establish equivalent lifecycle state. Timers must wake when their eligibility predicates change.
7. Help, estimates, and code should describe the same selection procedure. Approximate probabilities should still refer to the tasks actually ahead.

## Findings, in repair order

### F1 — P1: remote adoption loses the account boundary

**Source:** `index.html:1078` (raw state replacement), `index.html:1000` (account-switch detection), `index.html:1003` (empty-account branch).

`cloudPayload()` correctly excludes the device-local `syncAccount`. But the remote-wins path assigns `state = st`, then restores only the revision. The account binding set just before adoption disappears. If the user then switches to a different account whose cloud document is empty, `switchedAccount` is false and that account is seeded with the previous account's adopted tasks.

**Confirmed:** in a mock cloud, adopt account A's newer revision, change the mock identity to B with no document, pull and push. B receives A's task titles. No real accounts were accessed and this is not evidence that a real cross-account upload has occurred.

**Implemented:** remote adoption now uses the device-preserving replacement boundary. Pull responses are bound to the account that requested them; an account change discards the old result and reconciles the current identity. Late push acknowledgements cannot update another account’s revision. Regression tests cover adoption followed by switching, switching during a pull, and an old-account push completing afterward. The existing H9 equal-revision case alone did not cover these paths.

### F2 — P2: Undo treats any different seed as a new scan boundary

**Source:** `index.html:1125`, `index.html:2616`.

Import and remote adoption both promise Undo. However, the chance protection checks seed inequality, not why the seed changed. Import a backup with seed B over a same-day pass with seed A, then Undo: original tasks and ratings return, but B's weights and ordering remain. Import was neither a fresh scan nor a day marker.

**Confirmed:** the import/Undo probe restores the original title while retaining `imported-seed` instead of the original pass seed.

**Implemented:** Undo snapshots carry local scan-generation provenance. Deliberate scan/day boundaries advance it; refreshing an imported or remote replacement does not. Tests cover same-day and old-backup imports, repeated Undo across a true fresh pass, and the existing divergent-decision/day-boundary cases.

### F3 — P2: cloud replacement can strand an in-progress edit

**Source:** `index.html:1078`, `index.html:2526`; compare the stronger PWA editor guard at `index.html:2752`.

The updater waits until editing ends, but cloud adoption on focus replaces the underlying task list immediately. If the remote revision deleted the task being edited, the modal remains open and Save silently does nothing because the task no longer exists. A DOM-only draft does not increment `updatedAt`, so the existing saved-edit warning does not reliably cover it.

**Confirmed:** open a draft, adopt a mock remote deletion, press Save; the modal remains and no task contains the draft.

**Implemented:** cloud reconciliation and the updater share an editor guard, checked again after asynchronous reads. Deferred reconciliation blocks outgoing writes until it finishes, then retries after closing or leaving the editor. A newer remote revision can still win after Save, but the saved local draft is retained in the Undo snapshot and the replacement is announced. The deletion regression verifies deferral, blocked stale push, eventual adoption, and recovery of the saved title through Undo.

### F4 — P2: Add & dot bypasses the daily reset clock

**Source:** `index.html:1774`; compare `startScan()` at `index.html:1381` and `dotTask()` at `index.html:1591`.

On a fresh list, Add & dot creates the first chain entry and immediately starts offering candidates, but leaves `passStartedAt` at zero. In descending mode there is no chance timestamp to rescue the daily check. No marks clear at 2 AM, including on later days; the task can remain excluded until a manual reset or another path initializes the pass.

**Confirmed:** Add & dot at 1 AM, answer No, advance to 2 AM and run the clock sweep: `passStartedAt=0`, the No remains.

**Implemented:** Add & dot initializes the pass clock when it creates a chain root and applies a single-mode scan preference. Existing Start scanning and edit-pane Dot initialization are preserved. Tests verify the previously missing path across 2 AM and chance preference without fabricating a rating comparison.

### F5 — P2: the stop-scanning estimate models a different order

**Source:** `index.html:518`, `index.html:1426`.

`chanceBetterSoon()` sorts all remaining tasks by their current probability of beating the benchmark, then examines the best M. Chance mode actually follows a saved weighted order. A strong task later in that order can inflate the reported next-minute opportunity, preventing the configured stop nudge when the next minute's actual candidates are weak. Normal mode sorts by mean rather than this probability, so its ordering can also disagree when uncertainty differs.

**Confirmed:** for a saved sequence `[low, low2, high]` at two decisions per minute, the helper reports **99.9956%**. Applying the same probability approximation to the actual first two yields **0.00877%**. The configured 25% intervention does not activate.

**Implemented:** candidate selection and the forecast share `candidateOrder()`. The forecast consumes the first M entries rather than sorting by a different probability. A regression verifies that the weak upcoming chance candidates trigger the configured intervention and leave the frozen draw unchanged. The independent-event calculation remains an approximation.

### F6 — P2: Starts becomes eligible at midnight, but the timer waits for 2 AM

**Source:** `index.html:1146`, `index.html:1868`.

Starts uses the local calendar date, while `nextScanWakeAt()` considers 2 AM plus evergreen/Can't/worked expiry only. An open idle app can leave a task scheduled for tomorrow unavailable in the displayed scan for up to two hours after its eligibility predicate has become true. Focus or another action conceals the issue by forcing a sweep.

**Confirmed:** at 23:59 the next wake is 02:00, yet at 00:00 the same task's eligibility predicate is true.

**Implemented:** the wake schedule includes the next local midnight, computed with local calendar arithmetic. The clock also repaints when the calendar day changes even if the stored state is unchanged, covering paused scans. Midnight eligibility and 2 AM recycling remain distinct. Tests verify both wake scheduling and paused repaint; this release does not claim a new exhaustive DST matrix.

### F7 — P3: the explanations teach incompatible algorithms

**Source:** `README.md:7`; `index.html:2306` and `index.html:2307`.

README says candidates use Thompson sampling, but neither current mode does. Quick start says the first task is always the oldest and subsequent candidates always descend in likelihood; chance mode draws its first task and follows a frozen weighted order. The later help paragraph explains chance mode correctly, so the same help dialog contradicts itself.

**Implemented:** Quick start and README now distinguish the normal oldest anchor, descending strength order, and frozen weighted chance order. The accepted seven-step help structure remains covered by tests, with mode-aware wording. The pre-existing unrelated README paragraph change is excluded from the staged repair.

## Intentional choices that should remain

- Yes/No updates TrueSkill immediately; the current chance order continues to use captured weights. That is intentional, not stale data.
- Chance weights use TrueSkill mean, with a tiny positive floor. This follows the accepted “40 gets twice the weight of 20” contract; this audit does not silently replace it with a different model.
- Normal mode's oldest initial anchor and descending candidate means are established behavior. Change misleading wording before changing the algorithm without a product decision.
- An evergreen duration is a maximum hold with the day-reset checkbox on, and the full hold with it off. Worked-on and completed-evergreen holds are distinct policies.
- PWA updates wait for editing to end, persist before reloading, and keep the working shell offline. Asynchronous host writes are serialized. Those choices are consistent.
- Scenery time is separate from task time. This audit did not constitute a new exhaustive astronomy or animation review.

## Evidence and release preparation

Before repair, six diagnostic probes reproduced the behavioral findings against the audited commit. They used fake tasks, the repository VM/DOM harness, and a mocked cloud; they made no real account requests. F7 was confirmed by direct comparison of source and documentation.

The maintained acceptance regressions now live in `tests.js`:

```sh
node --test --test-name-pattern='Consistency repair:|Scan preference:' tests.js
node --test tests.js
```

The audit baseline passed 687 tests with 6 skipped despite the reproduced gaps. The immediate routing fix passed 689 tests with 6 skipped. Final combined validation is recorded below once complete.

Independent review cleared the repair diff, including the asynchronous account-switch guard, old-backup Undo provenance, editor protection, and midnight repaint. Final release gates include the full suite, real-browser checks, changelog/cache fingerprints, and exact deployed HTML/service-worker verification. Only intended changes are staged; unrelated working-tree changes stay local.
