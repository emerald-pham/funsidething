# 02: Centralize walking presentation across motion and resize

**What to build:** Walking visits finish painting when the complete party has left the current scene geometry. Reduced motion shows the correct bounded still scene, switching motion resumes underway visits at their current age, and resizing produces consistent presentation without changing shared arrivals. Concentrate these presentation decisions with the walking visit owner.

**Blocked by:** 01: Centralize walking recipes and complete visit lifetimes.

**Status:** complete — integrated, reviewed, deployed and accepted on the ordinary production path.

- [x] Settle the presentation interface against the established walking recipe owner before implementation. Production callers and behavioral tests use the same coherent walking seam, without callers coordinating lifetime selection and pose ordering. Reuse the agreed scene/motion controls and composed painter consumers; resolve any materially new test seam before tests at it.
- [x] Select locally relevant visits before substituting reduced-motion poses and before downstream body, shadow or reflection work. Expired walking tails cannot reappear through representative-pose substitution.
- [x] In normal motion, retire only local painting after the complete party, companions, held props and relevant residue have cleared the viewport. The immutable shared recipe remains available for other geometry and motion choices.
- [x] Reduced motion uses the current shared admission set and retains bounded still scenery. Switching back through the real motion controls resumes any still-underway visit at its current UTC age without replay, discarded recipes or changed admission.
- [x] Narrow/wide resizing and repeated resize histories yield the same logical visits and deterministic presentation for the resulting geometry. Cached local completion decisions do not outlive the geometry that justified them.
- [x] Preserve approved approach, activity, departure, gait, terrain contact, palette, scale and props across seasons. Preserve scene depth, receivers, shadows and reflection ordering, along with lazy recipes and bounded caches; do not introduce a general scene framework or new designs.
- [x] Keep the baseline evidence and every meaningful passing regression. The user approved the scoped GREEN/refactor/GREEN path because the behavior already passed; the deliberate negative control is recorded as sensitivity evidence, not feature RED. Actual behavior regressions still require observed RED before repair.
- [x] Verify production reconstruction and motion through the established consumer seams, narrow/wide/enlarged geometry history, cache behavior, and local painted bounds. Recording-canvas and deterministic checks are not claimed as composed rendering or physical-device proof. Ticket 07 owns final integrated rendering and packaging evidence.

Focused evidence and complete logs: `/private/tmp/chain-architecture-evidence-20261016/02/implementation.md`.

## Integrated release acceptance — 2026-10-16

Complete in [product PR132](https://github.com/emerald-pham/funsidething/pull/132), reviewed candidate `5ae84fdefb209127e90537e25ab3b166b8e9320b`, deployed main `7fcc49f2565694f44ccf1ab2376aed22f489aa06`. The integrated tree is `1a79407ea6cf263f7ac435d8f3d871b89b70e827`. Ticket 07 records the common validation, independent reviews, live acceptance and playable checks; its acceptance supersedes earlier local-only handback notes. The original baseline, real RED/GREEN and approved refactor chronology remain retained.
