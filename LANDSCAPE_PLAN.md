# Living landscape delivery

Owner checkout: `/Users/emeraldpham/Documents/GitHub/funsidething-landscape`

The scene follows the real instant for Orlando (28.5383 N, 81.3792 W). The scanner keeps its independent Light/Dark/System choice, with a subtle scene tint. All sky data and calculations ship locally; there are no runtime scenery APIs or usage charges.

- [x] Inspect app, preserve existing edits, isolate branch; baseline 499 tests pass.
- [x] Agree behavioral cases and observe new landscape tests fail before implementation.
- [x] Bundle licensed astronomy and real naked-eye star data; validate sky fixtures.
- [x] Paint layered hills, city, trails, metro and railway with day/twilight/night colors.
- [x] Add continuous ambient life, varied arrivals, bird nesting/settling and rare visitors.
- [x] Add first-launch motion choice and accessible settings; honor device reduction.
- [x] Inspect narrow phone, tablet, desktop and short landscape; check all sky/theme combinations.
- [x] Validate hidden-tab suspension, bounded work, offline cache and task regressions.
- [x] Review repository license and third-party notices independently.
- [x] Reconcile, commit, final checks, merge, push and verify live deployment.

Workflow applies the requested portable owner/review/release practices from the referenced project; game-specific architecture, content and tooling are out of scope.

## Validation evidence

- Initial baseline: 499 existing tests passed.
- New core and browser cases were observed red before their corresponding implementation or repair.
- Independent review confirmed astronomy calculations; fixed pending resize cleanup. Reduced motion intentionally retains nonanimated minute-scale sky/time updates.
- Rendered checks: 320×568, 390×844, 667×320, 768×1024, 1440×1000, 1920×1080, 2560×1080; empty and populated scanner; all four sky periods against both UI themes. No horizontal overflow.
- Headless Chrome on this machine: scene callback p95 approximately 0.2–0.4 ms; this is local CPU timing, not physical-device/GPU capacity evidence.
- Offline reload: new scenery, all 1,289 stars, motion preference, saved task, and Settings focus restoration passed.
- License decision: retain MIT for original code; preserve Astronomy Engine MIT and separate HYG CC BY-SA data attribution/licenses.

## Release

Feature commit: `09ab3f8c54b899d583dd3298cc473af131ca39e7`, fast-forward merged to `main` and pushed on 2026-09-12. Final validation on that commit: **511 tests passed, 0 skipped, 0 failures**, including the browser lifecycle test (86.1 seconds).

GitHub Pages reported that commit built successfully. Live HTML, scenery code, styles, star catalog, service worker, astronomy bundle and third-party notices matched the committed bytes. A fresh live browser passed first-launch motion selection, scene/return navigation and an installed offline reload (1,289 stars, active service worker, no console exceptions, no overflow).

Live: https://emerald-pham.github.io/funsidething/

This closeout changes only this checklist; the validated application assets are unchanged. Pre-existing user edits in the original checkout were preserved.

## Detail and liveliness follow-up

- [x] Bright day and night palettes with readable action labels.
- [x] Shared terrain geometry, direction-aware cyclist packs, individual rail-car tangents, ground shadows, and explicit terrain occlusion.
- [x] Lake with reflections, wildlife, quieter hill activities, kites and hang gliders.
- [x] Bounded randomized arrivals, speeds, scenic colors, jet trails, banners, and occasional alien visits.
- [x] Responsive park amenities and a short secondary walking loop.
- [x] Device-local location opt-in and caption; no geocoding service or API key.
- [x] Seasonal color accents, local clock hands, and time-specific breathing-room messages.
- [x] Fade to scenery and back, overridden by reduced motion.

### Why the first detail pass missed problems

The initial scene placed moving sprites separately from painted paths. A train
used one height for all its carriages, and all moving objects occupied one layer
above the terrain. Random-only screenshots could miss a backwards cyclist or a
particular occlusion. The negative canvas stacking level also made viewport-edge
painting fragile in Safari.

The renderer now shares pure path geometry with its inhabitants and composites
cached terrain between groups of visitors. Regression checks exercise opposite
travel directions, slope and pack anchors, every event with deterministic inputs,
finite canvas coordinates, bottom corners, fade return and reduced motion. Review
forced event scenes in Chromium and WebKit, including 320px portrait and short
landscape, when editing geometry or layering. Test a normal randomized visit too:
a forced all-event scene is a diagnostic, never the production arrival policy.

The original application code remains MIT. Astronomy Engine and the HYG star
catalog retain their separately documented licenses in THIRD_PARTY_NOTICES.md.


## Waterfront refinement

- [x] Compact cozy intro copy and lightly translucent supporting surfaces.
- [x] Seated picnic poses, branch-mounted nest, and railway tree clearance.
- [x] Pulsing water glints, smaller ducks, and occasional sailboats, yachts, cruise ships and jet skis.
- [x] One banner plane at a time with either travel direction; box-ship invasion removed.
- [x] Clocktower uses the device clock independently of the sky location.
- [x] Cup-and-chain pastel install icon and alltom inspiration credit.
- [x] Rank sparkline behind its summary, with tutorial explanations.

- [x] Seeded balloon currents, inward-folding butterfly wings, and brief night-only shooting stars.
- [x] Location caption shows the saved place without a time readout; default-sky wording is neutral.

- [x] Removed the cottage and its access path, leaving open hillside.
