# Task restoration audit — September 24, 2026

Scope: recent browser and cloud reconciliation, task completion, deletion,
Undo, backup restore, and JSON import. This audit used synthetic local boards
and mocked cloud responses. It did not inspect a user's saved tasks or live
Firestore documents, so it cannot identify which of the reported returning
items were involved.

## Findings and repairs

1. Repeating a restore discarded the earlier restore's operation ID. A later
   delete could then be undone by an older open tab. Repeated task reopenings
   had the same problem: a later completion could be undone by an older open
   copy. Both paths now carry prior operation IDs forward.
2. Merging independently reopened or completed copies kept only one run's
   completion evidence. A stale open copy could therefore return a task to
   All Tasks after both runs were completed. The merge now retains the causal
   lineage of both runs in either direction.
3. Undo and JSON import used shallow object assignment for delete and restore
   evidence. An older snapshot could replace newer operation arrays or a
   stronger delete observation. Replacements now merge that evidence before
   applying the user's chosen task membership. Importing an open backup also
   records an intentional reopening of a completed task.

Each finding has a regression in `tests.js` that failed before its repair.
The full local suite passed: 813 tests passed, 9 environment-dependent tests
skipped. The Firestore rules test passed separately in the emulator. Browser
layout and live production data were outside this audit's evidence.

An ordinary Done task has `done: true` and is excluded from All Tasks. An
Evergreen Done task remains open by design, records a History entry, and may
return to the candidate pool after its configured interval or the local 2 AM
day marker. Without a snapshot of the reported board, the observed group of
returning tasks cannot be attributed to either behavior or the repaired bugs.
