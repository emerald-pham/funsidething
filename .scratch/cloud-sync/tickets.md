# Proposed cloud sync ticket breakdown

Parent spec: [#141 — Preserve nonconflicting board decisions across cloud sync](https://github.com/emerald-pham/funsidething/issues/141).

Status: full ticket bodies drafted locally; breakdown approval pending before
creating child issues. All six tickets belong to one integrated product repair.
The first five return scoped commits and focused evidence; the final ticket owns
the combined candidate, required CI, review, deployment, and live acceptance.

1. **Preserve No decisions after offline reopening.**
   **Blocked by:** None.
   **Delivers:** Five phone No decisions and an independent Mac change survive
   saving, closing, reconnecting, and sync, with effective learning intact.
   [Full draft](issues/01-preserve-no-decisions-after-reopen.md).
2. **Combine independent dotted choices and comparison evidence.**
   **Blocked by:** 1.
   **Delivers:** B-over-A and C-over-A both survive; every distinct comparison
   contributes useful evidence while retransmission of one action counts once.
   [Full draft](issues/02-combine-independent-dot-and-comparison-evidence.md).
3. **Merge current choices by original decision time.**
   **Blocked by:** 1.
   **Delivers:** Compatible task edits and scanner choices combine; genuine
   conflicts use when the choice was made, preserving comparison evidence.
   [Full draft](issues/03-merge-current-choices-by-decision-time.md).
4. **Undo one action without rolling back peer progress.**
   **Blocked by:** 2 and 3.
   **Delivers:** Undo reverses only its action, including its learning effects,
   while preserving unrelated decisions from either device.
   [Full draft](issues/04-undo-one-action-without-rolling-back-peer-progress.md).
5. **Preserve decision authority through legacy and failure recovery.**
   **Blocked by:** 1.
   **Delivers:** Older clients, account changes, storage failures, retries, and
   wake recovery preserve the correct decisions and honest sync status.
   [Full draft](issues/05-preserve-decision-authority-through-legacy-and-failure-recovery.md).
6. **Integrate, verify, and release decision-preserving sync.**
   **Blocked by:** 4 and 5; dependencies 1–3 are already transitive.
   **Delivers:** One complete reviewed deployment with accurate Help, exact
   release evidence, and a short playable phone/Mac acceptance checklist.
   [Full draft](issues/06-integrate-verify-and-release-decision-preserving-sync.md).

## Dependency rationale

Ticket 1 establishes the minimum durable decision contract through a complete
No-decision flow; there is no separate schema-only or refactor-only ticket.
Tickets 2, 3, and 5 each consume that contract and can proceed without waiting
for one another. Ticket 4 needs the implemented comparison and current-choice
semantics it must reverse. Ticket 6 needs Undo and compatibility/recovery; those
edges already cover the earlier implementation transitively.

GitHub supports native blocking relationships and sub-issues on this host.
After the breakdown is approved, create the child issues in dependency order,
apply `ready-for-agent`, and add native blocking edges and parent links.
Preserve the parent issue's body, title, labels, and open state.

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
