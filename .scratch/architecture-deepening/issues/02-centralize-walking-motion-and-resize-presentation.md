# 02: Centralize walking presentation across motion and resize

**What to build:** Walking visits finish painting when the complete party has left the current scene geometry. Reduced motion shows the correct bounded still scene, switching motion resumes underway visits at their current age, and resizing produces consistent presentation without changing shared arrivals. Concentrate these presentation decisions with the walking visit owner.

**Blocked by:** 01: Centralize walking recipes and complete visit lifetimes.

**Status:** ready-for-agent

- [ ] Settle the presentation interface against the established walking recipe owner before implementation. Production callers and behavioral tests use the same coherent walking seam, without callers coordinating lifetime selection and pose ordering. Reuse the agreed scene/motion controls and composed painter consumers; resolve any materially new test seam before tests at it.
- [ ] Select locally relevant visits before substituting reduced-motion poses and before downstream body, shadow or reflection work. Expired walking tails cannot reappear through representative-pose substitution.
- [ ] In normal motion, retire only local painting after the complete party, companions, held props and relevant residue have cleared the viewport. The immutable shared recipe remains available for other geometry and motion choices.
- [ ] Reduced motion uses the current shared admission set and retains bounded still scenery. Switching back through the real motion controls resumes any still-underway visit at its current UTC age without replay, discarded recipes or changed admission.
- [ ] Narrow/wide resizing and repeated resize histories yield the same logical visits and deterministic presentation for the resulting geometry. Cached local completion decisions do not outlive the geometry that justified them.
- [ ] Preserve approved approach, activity, departure, gait, terrain contact, palette, scale and props across seasons. Preserve scene depth, receivers, shadows and reflection ordering, along with lazy recipes and bounded caches; do not introduce a general scene framework or new designs.
- [ ] Keep the baseline evidence and every meaningful passing regression. Resolve already-passing behavior against the repository's test-first requirement before editing; any functional change has a real observed behavioral RED followed by GREEN. Retain exact candidate identities, commands and output without substituting lexical or import failures for RED.
- [ ] Exercise deterministic time/seed scenarios and actual motion controls with isolated profiles. Verify local culling, full composed exits and composition in relevant day/night, narrow/wide and enlarged scenes. Separate recording-canvas assertions from rendered evidence and physical-device claims. Hand back the locally verified commit for the single integrated release.
