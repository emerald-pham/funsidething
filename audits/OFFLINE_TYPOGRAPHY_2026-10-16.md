# Offline typography audit — October 16, 2026

Issue [#136](https://github.com/emerald-pham/funsidething/issues/136) asked whether installed Chain Scanner keeps its typography usable with an empty external font cache, and asked for a warm-cache comparison. This was a research-only audit. No application files changed and no feature tests were added.

## Tested conditions

The exact tested revision was **48b9c58aa03b4d2c7006358f70466f590e685543**, descended from the assigned integration baseline. The issue's inspected source revision was **7fcc49f2565694f44ccf1ab2376aed22f489aa06**. SHA-256 comparisons show index.html, sw.js, and manifest.webmanifest were byte-identical at both revisions.

Before handback, the report branch was fast-forwarded through integration commits **c08d08aa7d22cddaebe649d3cab4c7a2c639cad9** and **991c2d1d5329dfb47107b65b485148a12aec3f36**. Those commits update Changelog and help copy and advance the service-worker cache fingerprint. The complete inline style block and Google Fonts links are byte-identical to the tested revision, and the service-worker code is identical after normalizing its cache fingerprint. Results below remain pinned to the exact tested SHA; no post-merge browser run is claimed.

The audit ran on macOS 27.0.1 (Darwin kernel 27.0.0), Apple arm64, Node.js 23.10.0, Playwright 1.62.1, and Google Chrome 155.0.8059.80. It used fresh, task-owned Chrome profiles and a local fixture server on 127.0.0.1:8776; each fixture contained two synthetic tasks and no account or personal board data. Browser-tab and installed-PWA modes were tested at requested 390×844 and 1440×900 CSS viewports, in light and dark themes.

For the cold condition, the Google Fonts stylesheet and font hosts were blocked before the first font request. The service worker held all 34 expected precache assets (35 URLs including the aliases), but no font binaries. For the warm condition, the Google Fonts stylesheet and three WOFF2 files first returned HTTP 200, then Chromium's offline mode blocked external requests. In both conditions, navigator.onLine was false and a unique Google Fonts probe failed with TypeError: Failed to fetch.

Installed mode was a real Chrome-installed PWA in each isolated profile: Chrome DevTools Protocol PWA.install and PWA.launch were used, standalone display mode was set with PWA.changeAppUserSettings, and the launched page reported (display-mode: standalone) true. The procedure follows the [Chrome DevTools Protocol PWA domain](https://chromedevtools.github.io/devtools-protocol/tot/PWA/). Browser-tab results reported standalone mode false.

## Results

CSS.getPlatformFontsForNode reported the faces Chromium actually used on the app title, task title, italic scanner question, and monospaced task count. This distinguishes loaded faces from CSS declarations alone.

| Cache and mode | App and task titles | Italic question | Task count |
| --- | --- | --- | --- |
| Cold, browser tab and installed PWA | .SF NS platform face | Georgia Italic | Menlo |
| Warm, browser tab and installed PWA | Spline Sans | Newsreader 16pt Italic | Spline Sans Mono |

The warm faces remained active in offline browser and installed-PWA measurements. The cold run used platform fallbacks in every sampled surface. Across the matrix, data-theme and computed color-scheme matched the requested light or dark theme. The main panel had a visible painted surface in both themes; the transparent body background allowed the app's landscape to show behind it.

The 12 inspected captures cover both cache conditions in browser tabs, plus cold-cache installed PWA, at phone and desktop sizes in both themes. Task and question text remained readable; phone layouts reflowed, and no clipping was visible in those captures. The fallback and custom faces produced slightly different line wrapping.

There are two limits on the visual matrix. First, Chrome sometimes resized an installed dark-mode window: the cold phone and warm phone measurements were 500 px wide rather than the requested 390 px; the cold dark desktop measured 1442 px rather than 1440 px. The sampled text surfaces themselves reported no overflow at those measured sizes, but those cases do not verify the requested viewport exactly. Second, the first warm installed-window screenshot timed out and produced a blank white image. That failed image is retained separately; the harness skipped the other three warm installed screenshots after the timeout. All four warm installed cases still recorded font, theme, and layout metrics, but they have no usable visual captures.

The browser and standalone documents remained controlled by the service worker after offline reloads. A strict zero-network claim does not follow from this run: the local server request counter rose by one on each offline reload, and /sw.js was the observed standalone request, consistent with a service-worker update check. The external font probe did fail as expected. Future checks that require proving no network activity at all should add an OS-level network block.

## Recommendation

Keep the documented CSS fallback behavior. On this macOS/Chrome sample, cold-cache installed and browser views stayed legible, both themes painted correctly, and reviewed text did not clip. Warm-cache measurements retained the intended typefaces offline. The evidence does not establish a usability defect that would justify shipping bundled fonts. If exact typeface identity becomes a product requirement, evaluate packaging as a separate change with font licensing, transfer size, and cross-platform rendering checks.

This audit covers Chrome on one macOS host only. Phone sizes were emulated CSS viewports, not physical phones. It does not establish behavior on iOS/Safari, Android, Windows, other browsers, production hosting, or authenticated boards. The installed-PWA evidence comes from Chrome's isolated installed-app mode; it is not physical-device or app-store evidence.

## Evidence and verification

The external harness, JSON audit data, first-launch log, screenshot set, failed blank capture, and manual cleanup record are retained under:

/Users/emeraldpham/Documents/GitHub/funsidething/.git/funsidething-task-evidence/arctic-observer-20261016/136/

The 12 inspected images are named cold-browser-*, warm-browser-*, and cold-installed-* under renders/; each set includes phone and desktop sizes and light and dark themes. audit-report.json records all 16 metric results and the seven failed checks: four detected same-origin server requests during offline reloads, and three installed dark-window viewport-size mismatches. No sampled text element overflowed in those three size-mismatch cases. manual-cleanup.log records isolated PWA uninstall and profile cleanup. The audit runner exited with SIGINT before its own final JSON writer ran; the report metadata was finalized manually, and the JSON explicitly marks its full server-request array as incomplete.

The research classification follows the repository's [TDD guidance](../docs/agents/workflow.md#strict-tdd-at-agreed-seams): no application behavior changed, so no feature-test red/green cycle was applicable.
