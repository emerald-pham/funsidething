## Parent

[Preserve nonconflicting board decisions across cloud sync — #141](https://github.com/emerald-pham/funsidething/issues/141)

## What to build

Combine compatible task edits and ordinary current board choices from two
devices. Resolve only genuine incompatibilities for the same current choice
using original decision time. A delayed upload of an earlier edit must not
replace a later deliberate choice or suppress unrelated work.

Cover the current task fields, ordinary scanner dispositions and mode choices,
and shared preferences affected by the new reconciliation. Integrate with the
existing causal meanings of Done, worked history, reopening, deletion,
postponement, and prerequisites. Comparison observations are retained evidence,
including when a current board outcome needs resolution.

Use the durable identity, original time, ownership, and observed context
contract from ticket 1. Independent dotted-chain projection and full comparison
learning are owned by ticket 2. Keep these responsibilities composable without
requiring ticket 2 to be finished before this slice starts. Return focused,
green commits to the integrated repair rather than releasing separately.

## Acceptance criteria

- [ ] Edits to different tasks, compatible properties of the same task, and unrelated scanner choices survive together after sync and reopening.
- [ ] Two incompatible supported values for the same current choice resolve using original decision time; uploading the earlier action last cannot give it newer authority.
- [ ] Saves, retries, reconnects, and projection maintenance do not restamp original decision time or manufacture a new user action.
- [ ] Equal supported times use a stable tie-break. Missing or untrusted legacy chronology is handled conservatively without treating a fresh save timestamp as a proven decision time; preserve all recovery evidence.
- [ ] A genuine current-choice conflict does not discard independent choices or separate comparison observations. Do not treat a whole-board or array difference as proof of a conflict.
- [ ] Preserve existing completion and evergreen work semantics, deliberate return/reopening, deletion and deferral intent, and prerequisite rules. Stale data must not manufacture an explicit reversal of these actions.
- [ ] Preserve the original task and scan-pass context, established expiry rules, active editor drafts, and pressed-control task binding. Current choices must remain coherent with the visible task after reconciliation.
- [ ] Cover normal action/edit entry points, delayed upload, both publication orders, and offline reopening through the approved consumer seam, with observed RED followed by GREEN.
