# 04: Route editor gestures through the task-action owner

**What to build:** Saving task edits and performing an action in the same gesture preserves accurate history and takes one Undo step. An edit that makes Dot unavailable records the saved edit without a phantom comparison, and retained observations remain trustworthy through offline work, reload and synchronization.

**Blocked by:** 03: Centralize rating history for direct task actions.

**Status:** implemented in branch; awaiting ticket 07 integrated acceptance

- [x] Settle editor integration with the established task action owner before implementation. Editor callers no longer independently coordinate observation capture, Undo and finalization. Reuse the agreed task-editor actions, Task history, Undo and isolated reload/sync fixtures; resolve only materially new testing seams before tests at them.
- [x] Save, edit-and-Done, edit-and-Worked and edit-and-Dot retain their supported behavior. One Undo reverses each complete gesture's fields and action effects without erasing immutable history facts or adding a second Undo step.
- [x] If saved fields make Dot unavailable, retain the actual saved edit and its observation without a phantom Dot comparison, benchmark replacement or new preference signal.
- [x] Saving unchanged fields does not append sample noise or unchanged observations and does not consume extra random draws. Merely opening the editor or rendering Task history remains read-only.
- [x] Undo, subsequent saves and relative pool changes preserve the latest retained observation head, allowing honest later observations even when values return to an earlier state. Preserve ranking, uncertainty, available Top X facts and original observation provenance.
- [x] Isolated offline/reload, concurrent-client, stale-client, account-switch and failed/retried-publication scenarios preserve observation identities, timestamps, supported facts and owner boundaries as affected. Existing reconciliation and revision ordering remain intact; a successful local save is not treated as proof of cloud reconciliation.
- [x] Legacy and future-format history, exports and sole/protected recovery copies remain preserved. Keep existing automatic recovery, formats and retention without retimestamping history, forcing refresh over an unsaved draft or requiring the user to export/delete backups.
- [x] Retain runnable baseline evidence and meaningful edit/Undo/history/sync regressions. The already-passing behavior used the approved GREEN/refactor/GREEN exception; the deliberate mutant was retained as sensitivity evidence, not feature RED.
- [x] Verify editor gestures, visible history and saved/reloaded isolated boards through the production action owner. Retain focused state/sync preservation evidence and hand back the locally verified commit for the integrated checkpoint, without a separate product release.

Local evidence is recorded in `/private/tmp/chain-architecture-evidence-20261016/04/`. The checks use the production `onAction` and `TaskActionOwner` in isolated VM/fake-indexeddb fixtures. Rendered PWA, authenticated live sync, deployment and physical-device acceptance remain with ticket 07.
