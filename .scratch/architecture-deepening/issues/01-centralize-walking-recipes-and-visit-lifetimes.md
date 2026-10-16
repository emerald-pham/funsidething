# 01: Centralize walking recipes and complete visit lifetimes

**What to build:** Users see the same shared walking arrivals at the same UTC instant, including after returning to a suspended tab, and complete parties finish their approved visits and departures. Give walking recipes and complete visit lifetimes one coherent owner so callers no longer interpret journey and activity clocks themselves.

**Blocked by:** None (can start immediately).

**Status:** complete — integrated, reviewed, deployed and accepted on the ordinary production path.

- [x] Settle the concrete responsibility and interface before implementation. Reuse the agreed deterministic scene reconstruction and composed painter consumers; resolve any materially new testing seam with the user before tests at it. Demonstrate that production callers know fewer walking rules; a file move or forwarding module alone is insufficient.
- [x] Keep shared seeded opportunity selection and admission in the timeline, independent of viewport and local motion preference. Admission reservation duration, complete canonical display lifetime and local paint completion remain distinct, with immutable shared recipes.
- [x] Cold reconstruction and return from suspension recover visits at their current UTC age with the existing finite lookback, admission limits and midnight behavior, without replaying missed opportunities as a burst.
- [x] Normal-motion parties, companions, held props and relevant activity residue complete approach, activity and departure in both directions. Preserve the existing local paint cutoffs while establishing the recipe owner for the subsequent presentation ticket.
- [x] Preserve approved seasonal motion, terrain contact, gait, scale, palette, group composition, props, shadows, RNG streams and scene composition. Introduce no new designs, animals, umbrellas or frequency changes.
- [x] Preserve lazy lifetime work, gait reuse and bounded recipe/cache working sets. Advancing frame age does not repeatedly rebuild a recipe, and rejected opportunities do not acquire unnecessary lifetime work.
- [x] Record the runnable baseline and preserve existing passing assertions. The user approved the scoped GREEN → behavior-preserving refactor → GREEN path because the requested behavior already passed; the deliberate mutant is recorded as sensitivity evidence, not feature RED. Any actual regression introduced during refactoring was fixed from observed consumer-test failure.
- [x] Verify through isolated deterministic reconstruction, the production walking seam and focused painter-consumer evidence. Migrate the eager/lazy lifecycle comparison to LandscapeVisits without weakening geometry, paint or performance assertions. Saved boards were not used; final rendered integrated acceptance remains assigned to ticket 07. No separate release was performed.

Local implementation commit: `142ae0c876c64629ccebf3e37310919984f9734d`.

Focused evidence and complete logs: `/private/tmp/chain-architecture-evidence-20261016/01/implementation.md`. This ticket adds the recipe/lifetime owner only; `landscape.js` local motion and resize decisions remain for ticket 02, and the final shell cache fingerprint remains for ticket 07.

## Integrated release acceptance — 2026-10-16

Complete in [product PR132](https://github.com/emerald-pham/funsidething/pull/132), reviewed candidate `5ae84fdefb209127e90537e25ab3b166b8e9320b`, deployed main `7fcc49f2565694f44ccf1ab2376aed22f489aa06`. The integrated tree is `1a79407ea6cf263f7ac435d8f3d871b89b70e827`. Ticket 07 records the common validation, independent reviews, live acceptance and playable checks; its acceptance supersedes earlier local-only handback notes. The original baseline, real RED/GREEN and approved refactor chronology remain retained.
