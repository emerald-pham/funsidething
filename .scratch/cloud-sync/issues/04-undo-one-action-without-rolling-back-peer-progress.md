## Parent

[Preserve nonconflicting board decisions across cloud sync — #141](https://github.com/emerald-pham/funsidething/issues/141)

## What to build

Make ordinary Undo reverse the action being undone against the current
reconciled board while preserving unrelated work from either device. Undoing a
phone comparison or edit must not reload a whole earlier board and erase the
Mac's independent progress.

Preserve the target action's identity and history, reverse its intended effects,
and keep that reversal effective through publication, retransmission, reopening,
and later stale snapshots. Apply the same rule to the comparison learning from
ticket 2 and compatible current choices from ticket 3. Keep the existing Undo
gesture and scope; do not add an arbitrary remote-history Undo interface.

Explicit Import, Restore, and Reset remain their established deliberate
replacement actions with mandatory recovery. Return focused, green commits to
the integrated repair rather than creating a separate release.

## Acceptance criteria

- [ ] Make a local action, receive an unrelated action from the other device, and invoke normal Undo. Only the selected action is reversed; remote progress and unrelated task data remain.
- [ ] Undoing one comparison reverses its effect on effective learning without erasing the other device's comparison observations or their effects.
- [ ] Undoing an edit or current-choice action preserves unrelated peer fields and actions rather than replacing the whole previous snapshot.
- [ ] The reversal has durable target evidence and survives cloud publication, duplicate delivery, offline reopening, and reconciliation with a stale client that still carries the original action.
- [ ] Preserve meaningful history and recovery copies. Do not silently disable established Undo behavior to avoid reconciliation cases.
- [ ] Existing completion and evergreen Undo contracts remain intact; an undone completion must not duplicate work history or later reappear merely because an older snapshot arrives.
- [ ] Existing explicit Import, Restore, and Reset behavior keeps its deliberate replacement, account, deletion-intent, and mandatory-backup safeguards.
- [ ] Verify actual Undo entry points and the final visible, durable, learned, and cloud results through the approved complete-app seam, with observed RED followed by GREEN.
