# 03: Centralize rating history for direct task actions

**What to build:** Scanner decisions and direct task actions retain accurate Task history and existing Undo behavior. Make the task action owner responsible for before-observation capture, Undo ordering, action outcome and observation finalization, so callers no longer repeat that protocol.

**Blocked by:** None (can start immediately).

**Status:** implemented-local; awaiting integration

- [x] Settle the action owner's concrete interface before implementation, keeping existing useful modules and in-process responsibilities. Reuse scanner actions, visible Task history, Undo and saved/reloaded boards as the agreed consumer seams. Resolve any materially new testing seam before tests at it; demonstrate reduced caller knowledge rather than a forwarding extraction.
- [x] Yes and No retain the actual before/after rating, uncertainty, likelihood and available Top X values for the affected tasks. Missing historical facts remain unavailable rather than being reconstructed as invented observations.
- [x] Done, Worked, Dislodge, Return as candidate, Dot and existing automatic-dot paths retain their supported effects and provenance. Distinguish own rating changes from relative eligibility or pool changes; automatic exclusions and standalone signals do not become invented comparisons.
- [x] Route direct actions through the owner for capture, existing single-gesture Undo and finalization. Preserve numerical ranking, Chance/Halving behavior, selection odds, benchmark semantics, timestamps and RNG draws.
- [x] Undo retains original immutable observation identities and facts, records meaningful reversals and preserves the latest retained observation head. A later action or return to an earlier value can still produce an honest observation after Undo or a relative pool change.
- [x] Task history viewing and rendering remain read-only. Unchanged observations and sample noise are deduplicated without extra random draws or meaningless history growth.
- [x] Ordinary save/reload and reconciliation preserve supported history, original timestamps, opaque future formats and recovery evidence. Keep the saved format and observation retention unchanged; no history rewrite, migration or destructive reset is introduced.
- [x] Retain runnable baseline evidence and protected comparison/action/Undo/merge/reload assertions. Resolve already-passing behavior against the repository's test-first requirement before editing, and observe behavioral RED before every functional change, then GREEN. Use isolated boards and retain exact commands, identities and output.
- [x] Verify the complete direct-action-to-visible-history-to-Undo/reload path through the production owner. Keep focused preservation evidence for state and sync review, and hand back a locally verified commit for integration with the editor and other behavior groups; do not publish a separate product release.
