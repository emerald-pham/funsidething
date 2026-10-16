# 05: Centralize All Tasks filters and selection

**What to build:** All Tasks keeps its existing results, counts and selection behavior as search, tags, eligibility, time and board ownership change. Give filter validity, visible membership and selection transitions one owner so rendering and gestures no longer independently mutate transient selection state.

**Blocked by:** None (can start immediately).

**Status:** local implementation committed; rendered and integrated acceptance remains with ticket 07.

- [x] Settle the view owner's concrete interface before implementation and demonstrate fewer caller ordering rules. Reuse the agreed All Tasks controls and isolated board/account transitions; resolve any materially new testing seam before tests at it. Rendering consumes the owner's result instead of independently pruning selection.
- [x] Combined search, status/context tags and eligibility filters retain the same matching open tasks and counts. Transient view state remains separate from persisted task fields, context assignments and scanner inclusion.
- [x] Existing contexts remain offered as All Tasks filters when inactive, excluded, unused or unmatched. Keep No context distinct, and preserve imported unknown or empty context IDs under existing unrelated-edit rules without synthetic filter values.
- [x] Select all selects only currently visible matching open tasks. Filter, task and ownership transitions prune hidden or unavailable selections before a later edit can affect an unseen task, while selection toggles and rerenders retain their supported behavior.
- [x] When Postponed or another status tag becomes unavailable, clear only that tag. Preserve independent search and eligibility choices and avoid task-data mutation or unrelated filter resets.
- [x] Board/account transitions preserve existing ownership boundaries and do not leak a prior owner's selection or results. Keep current Bulk Edit behavior working while exposing the owner that the draft/result ticket will use.
- [ ] Preserve selection feedback, native keyboard focus, row height, toolbar placement, group spacing, pane insets, safe-area spacing and unobscured scrolling. Compare the actual All Tasks controls with their established neighbors in the same pane, including selected/disabled states, top/middle/end scrolling, both verified themes and relevant narrow/wide and enlarged views.
- [x] Preserve existing filter, context, expiry and toolbar regressions. Record the runnable baseline and resolve already-passing behavior against the repository's test-first requirement before editing; any functional change has observed behavioral RED before implementation and GREEN afterward, with exact identities and output retained.
- [ ] Verify complete filtering-to-selection-to-existing-edit consumer flows using isolated boards and the production view owner. Hand back the locally verified commit and rendered evidence for the integrated checkpoint; introduce no new context semantics or separate product release.

Ticket 05 local focus and account consumers pass. Ticket 07 owns the remaining rendered comparison; this work did not use a browser or emulator.
