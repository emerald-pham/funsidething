# Published cloud sync ticket graph

Parent spec: [#141 — Preserve nonconflicting board decisions across cloud sync](https://github.com/emerald-pham/funsidething/issues/141).

Status: user-approved breakdown published as six GitHub sub-issues, each labeled
`ready-for-agent`, with seven verified native blocking relationships.
All six tickets belong to one integrated product repair.
The first five return scoped commits and focused evidence; the final ticket owns
the combined candidate, required CI, review, deployment, and live acceptance.

1. **[#142 — Preserve No decisions after offline reopening](https://github.com/emerald-pham/funsidething/issues/142).**
   **Blocked by:** None.
   **Delivers:** Five phone No decisions and an independent Mac change survive
   saving, closing, reconnecting, and sync, with effective learning intact.
   [Saved issue body](issues/01-preserve-no-decisions-after-reopen.md).
2. **[#143 — Combine independent dotted choices and comparison evidence](https://github.com/emerald-pham/funsidething/issues/143).**
   **Blocked by:** #142.
   **Delivers:** B-over-A and C-over-A both survive; every distinct comparison
   contributes useful evidence while retransmission of one action counts once.
   [Saved issue body](issues/02-combine-independent-dot-and-comparison-evidence.md).
3. **[#144 — Merge current choices by original decision time](https://github.com/emerald-pham/funsidething/issues/144).**
   **Blocked by:** #142.
   **Delivers:** Compatible task edits and scanner choices combine; genuine
   conflicts use when the choice was made, preserving comparison evidence.
   [Saved issue body](issues/03-merge-current-choices-by-decision-time.md).
4. **[#145 — Undo one action without rolling back peer progress](https://github.com/emerald-pham/funsidething/issues/145).**
   **Blocked by:** #143 and #144.
   **Delivers:** Undo reverses only its action, including its learning effects,
   while preserving unrelated decisions from either device.
   [Saved issue body](issues/04-undo-one-action-without-rolling-back-peer-progress.md).
5. **[#146 — Preserve decision authority through legacy and failure recovery](https://github.com/emerald-pham/funsidething/issues/146).**
   **Blocked by:** #142.
   **Delivers:** Older clients, account changes, storage failures, retries, and
   wake recovery preserve the correct decisions and honest sync status.
   [Saved issue body](issues/05-preserve-decision-authority-through-legacy-and-failure-recovery.md).
6. **[#147 — Integrate, verify, and release decision-preserving sync](https://github.com/emerald-pham/funsidething/issues/147).**
   **Blocked by:** #145 and #146; dependencies #142–#144 are already transitive.
   **Delivers:** One complete reviewed deployment with accurate Help, exact
   release evidence, and a short playable phone/Mac acceptance checklist.
   [Saved issue body](issues/06-integrate-verify-and-release-decision-preserving-sync.md).

## Dependency rationale

Ticket 1 establishes the minimum durable decision contract through a complete
No-decision flow; there is no separate schema-only or refactor-only ticket.
Tickets 2, 3, and 5 each consume that contract and can proceed without waiting
for one another. Ticket 4 needs the implemented comparison and current-choice
semantics it must reverse. Ticket 6 needs Undo and compatibility/recovery; those
edges already cover the earlier implementation transitively.

The six issues were created in dependency order, linked natively to the parent,
given their native blockers, and labeled `ready-for-agent`. Readback verified
each exact body, title, label, open state, parent, blockers, and reverse blocking
edges. The parent issue's body, title, labels, and open state were preserved.
The current ready frontier is #142; implementation has not started.

## Spec coverage

| Spec user stories | Owning delivery | Full-checkpoint acceptance |
| --- | --- | --- |
| 1–4, 8, 13 | 1 | 6 |
| 5–11 | 2, with retransmission identity from 1 | 6 |
| 12–14, 18–20, 28 | 3 | 6 |
| 15–17, 29 | 4 | 6 |
| 21–27, 30–31 | 5, with baseline preservation from 1 | 6 |
| 32 | 6 | 6 |

Independent large-upload byte budgeting, cleanup scheduling/pagination, and
unverified audit hypotheses remain excluded, as specified in the parent.
