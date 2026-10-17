## Parent

[Preserve nonconflicting board decisions across cloud sync — #141](https://github.com/emerald-pham/funsidething/issues/141)

## What to build

Deliver the complete decision-preserving cloud sync repair as one reconciled
product checkpoint. Integrate the scoped implementation commits, repair any
interactions between action types and recovery, update user guidance, and carry
the exact candidate through the repository's required review, CI, deployment,
and live verification.

The finished product must keep every nonconflicting phone and Mac decision,
retain useful comparison evidence, resolve genuine current-choice conflicts by
original decision time, and make Undo preserve unrelated progress. Users review
the result by playing the app, so hand over a short numbered set of in-app
checks along with clear evidence and limits.

This ticket owns final integration and release, including repairs for new
findings. Do not weaken tests, skip required gates, or turn the earlier focused
slice checks into separate PR/CI/release cycles. The large-upload batch-budget
finding and other explicitly excluded audit concerns remain outside this repair.

## Acceptance criteria

- [ ] Reconcile all scoped commits with current main, verify exact ancestry, and preserve concurrent saved-view work, existing data, protected recovery, and other owners' changes.
- [ ] Demonstrate the full five-phone-decisions plus one independent Mac decision scenario through actual app actions in both publication orders, including offline save and full reopen before reconciliation.
- [ ] Demonstrate independent B-over-A and C-over-A choices; two deliberate same-pair comparisons; one comparison retransmitted repeatedly; a genuine current-choice conflict uploaded in reverse time order; and scoped Undo after independent peer progress.
- [ ] Verify effective ratings, dotted membership, coherent candidate/eligibility, retained history, durable device state, and exact final cloud content. A history union or green badge alone is insufficient.
- [ ] Exercise the recovery and mixed-client contract across all newly supported action types, not only the first No-decision slice. Preserve completion, evergreen work, deliberate return, deletion, postponement, prerequisites, pass expiry, explicit replacements, drafts, and stale-control protections as affected.
- [ ] Update the corresponding extended FAQ, Settings changelog, and setup explanation. Keep unrelated content and describe comparison evidence, true conflicts, original times, and scoped Undo in plain language.
- [ ] Preserve actual per-repair RED-to-GREEN chronology and complete the required focused and final regression checks. Obtain the repository-required independent changed-code and persistence/sync reviews, independent FAQ review, and relevant rendered evidence for the exact final candidate.
- [ ] Batch the integrated implementation, repairs, current-main reconciliation, and final release metadata into one CI candidate where possible. Rerun only for a concrete gate failure or material candidate/upstream change, without omitting required checks.
- [ ] Complete applicable historical-client compatibility, rules, CI, Pages deployment, and exact deployed-asset checks. Verify representative deployed behavior with isolated authorized identities and boards, preserving all personal production data.
- [ ] Report local automated checks, actual browser and emulator behavior, ordinary production verification, and physical-device evidence separately. Any unavailable proof remains explicit; do not call a merely local repair deployed or physically verified.
- [ ] Hand over a short numbered set of playable in-app checks and finish preservation-first cleanup, retaining unique or live work and recovery evidence. Do not close or rewrite the parent spec merely to finish this ticket.

## Blocked by

- Ticket 4 — Undo one action without rolling back peer progress. Its prerequisites include the independent-choice and current-conflict behavior.
- Ticket 5 — Preserve decision authority through legacy and failure recovery. The complete checkpoint cannot ship before these safety behaviors are qualified.
