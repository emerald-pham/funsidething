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
- [ ] Reconcile, commit, final checks, merge, push and verify live deployment.

Workflow applies the requested portable owner/review/release practices from the referenced project; game-specific architecture, content and tooling are out of scope.

## Validation evidence

- Initial baseline: 499 existing tests passed.
- New core and browser cases were observed red before their corresponding implementation or repair.
- Independent review confirmed astronomy calculations; fixed pending resize cleanup. Reduced motion intentionally retains nonanimated minute-scale sky/time updates.
- Rendered checks: 320×568, 390×844, 667×320, 768×1024, 1440×1000, 1920×1080, 2560×1080; empty and populated scanner; all four sky periods against both UI themes. No horizontal overflow.
- Headless Chrome on this machine: scene callback p95 approximately 0.2–0.4 ms; this is local CPU timing, not physical-device/GPU capacity evidence.
- Offline reload: new scenery, all 1,289 stars, motion preference, saved task, and Settings focus restoration passed.
- License decision: retain MIT for original code; preserve Astronomy Engine MIT and separate HYG CC BY-SA data attribution/licenses.
