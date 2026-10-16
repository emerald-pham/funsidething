# 06: Centralize Bulk Edit drafts and result scope

**What to build:** Users can edit selected tasks with explicit Apply and Clear intent, and stale drafts reject the entire local batch before changing any task. Give the All Tasks view owner responsibility for draft lifetime and result scope, retaining existing Undo, peer-field reconciliation, recovery and truthful result counts.

**Blocked by:** 05: Centralize All Tasks filters and selection.

**Status:** complete — integrated, reviewed, deployed and accepted on the ordinary production path.

- [x] Settle draft/result responsibilities with the established All Tasks view owner before implementation. Reuse actual selection, Bulk Edit controls, Save/Cancel and isolated board/account transitions as the agreed consumer seams; resolve any materially new testing seam before tests at it. Gesture and paint callers no longer coordinate transient draft/result globals independently.
- [x] Mixed values and unchecked Apply properties remain unchanged. Blank input does not silently clear data; explicit Clear remains distinct. Later typed values supersede draft Clear wherever the released controls support that transition, and Cancel makes no task changes.
- [x] Before any local batch mutation, validate the current board/account owner, selected-task existence and open/visible membership, opted-in field snapshots and relevant context options. A stale owner, task, selected property or option rejects the whole local batch with zero partial local changes.
- [x] Preserve saved unknown/empty context references on unrelated edits and retain existing explicit context Clear behavior. Do not merge task context requirements, scanner inclusion and All Tasks filters.
- [x] A valid batch changes only opted-in fields on the intended tasks and retains existing board-level Undo semantics, including their documented recovery limits. Introduce no new batch-specific Undo or atomic-server-transaction claim.
- [x] Later peer changes preserve unaffected and newer peer fields through existing field-scoped reconciliation. Failed, interrupted and retried cloud publication preserves protected recovery copies and existing retry behavior; local success alone is not reconciliation proof.
- [x] Result counts describe current matching values for the current board/account and selected batch. Owner or field changes cannot retain a misleading prior result or imply server acknowledgement.
- [x] Preserve the released layout, focus, Apply/Clear/Save/Cancel affordances and supported narrow/wide, enlarged and day/night presentation. Record actual rendered checks for affected controls and their established neighbors rather than accepting simulated control paint alone.
- [x] Preserve meaningful stale-draft, explicit-Clear, context, peer-field, failed-publication and ownership regressions. Resolve already-passing behavior against the repository's test-first requirement before editing; every functional change has observed behavioral RED followed by GREEN with exact identities, commands and output. Use isolated fixtures, never a live saved board.
- [x] Verify selection-to-draft-to-Save/Cancel-to-result and reload/reconciliation flows through the production view owner. Retain focused state/sync review evidence and hand back a locally verified commit for the single integrated checkpoint.

## Integrated release acceptance — 2026-10-16

Complete in [product PR132](https://github.com/emerald-pham/funsidething/pull/132), reviewed candidate `5ae84fdefb209127e90537e25ab3b166b8e9320b`, deployed main `7fcc49f2565694f44ccf1ab2376aed22f489aa06`. The integrated tree is `1a79407ea6cf263f7ac435d8f3d871b89b70e827`. Ticket 07 records the common validation, independent reviews, live acceptance and playable checks; its acceptance supersedes earlier local-only handback notes. The original baseline, real RED/GREEN and approved refactor chronology remain retained.
