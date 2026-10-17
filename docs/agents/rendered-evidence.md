# Rendered evidence cases

Use `scripts/agent-tools/rendered-evidence.mjs` to capture one isolated FAQ typography case against the local app. Each invocation creates `case.json`, an ordinary-size reference PNG, and the requested capture PNG in a new case directory. Keep the JSON beside its images; the hashes and paths bind those files to the measured case.

The caller supplies the local app URL, a fresh output directory, an absolute path to an installed Playwright module that exports `chromium.launch()`, and the exact source or artifact identity being served. The command does not start a server or discover a commit from an arbitrary URL. Run it only against a local unauthenticated app and a browser runtime allocated to this task. It rejects non-loopback URLs, gives Chromium a fresh in-memory context with no storage state, blocks external requests and service workers, and adds two synthetic tasks using the app’s Add control. It chooses normal motion only when the first-run motion choice is visible, sets the requested theme through the native theme button, verifies that the other theme changes computed paint, restores the requested theme, then opens and expands FAQs through the app’s existing controls. It does not read or write a personal browser profile or saved board.

Example for a single 390 × 844 light-theme diagnostic case:

```sh
node scripts/agent-tools/rendered-evidence.mjs \
  --url http://127.0.0.1:8000/ \
  --output /tmp/rendered-evidence/light-narrow \
  --playwright-module /absolute/path/to/playwright/index.mjs \
  --source-id 659aac18ad6bae310f8d6f50be2201abf1791eb8 \
  --mechanism diagnostic-css \
  --theme light \
  --width 390 \
  --height 844 \
  --scale 1.5
```

The command accepts `diagnostic-css`, `native-page-zoom`, or `pinch-zoom`; `light` or `dark`; widths and heights from 320 to 3840 CSS pixels; scales greater than 1 through 4; `--timeout-ms` from 1000 through 120000; optional `--headless false`; and an optional `--browser-executable` path. A Playwright package path and a local app URL must be available before capture. Use a distinct, initially empty case directory for every invocation. Existing `case.json` or matching screenshot files are never replaced.

Run both themes at the relevant narrow and wide sizes by making four invocations per mechanism under review. The narrow default is 390 × 844 CSS pixels; use a wide desktop viewport such as 1280 × 800. These are separate cases, not a claim that a single invocation validates the matrix. Pass the same exact `--source-id` for cases served from the same candidate. The report records the supplied identity and hashes the served document and same-origin scripts, stylesheets and fonts, but it cannot verify that the identity argument names the bytes being served.

The mechanisms have different acceptance rules:

- `diagnostic-css` applies an absolute pixel-size CSS rule to each measured element on seven named FAQ text surfaces: title, section summaries, question terms, answers, list items, paragraphs and non-summary subheadings (including grouped changelog headings). Each target is calculated from that element’s own measured baseline font size, so headings with an existing relative size cannot remain at normal size or be under-scaled. Every matched text element on every surface must increase its computed font size and either computed line height or measured element height. A missing surface, changed element count, unchanged text, or partial scale fails metrics. This is a diagnostic CSS perturbation, not evidence that browser zoom works.
- `native-page-zoom` presses the platform browser shortcut (`Control+Shift+Equal`, or `Meta+Shift+Equal` on macOS). It passes metrics only when the observed CSS viewport shrinks, the observed device-pixel ratio reaches the requested scale, and a shortcut was attempted. CSS font sizes can remain unchanged; their before/after values are still recorded as observations.
- `pinch-zoom` asks Chromium’s DevTools Protocol to synthesize a touch pinch in a mobile-emulated context. It passes metrics only when `visualViewport.scale` and the measured visual viewport show the requested increase. If the runtime cannot perform this gesture, its result is unverified.

The case JSON keeps `metricsStatus`, `captureIntegrity`, `visualStatus` and `overallStatus` separate. Each screenshot is checked for valid PNG structure and checksums, a supported pixel format, nonblank pixels and dimensions matching the requested or measured viewport. A blank, corrupt, missing or dimensionally inconsistent screenshot fails capture integrity; an unsupported PNG format remains unverified. A metrics pass never becomes visual acceptance automatically: `visualStatus` remains `unverified` until an independent reviewer checks readability, wrapping, contrast, clipping and the match between the screenshot and its named reference. A failed screenshot sets visual status to `fail`. `overallStatus` therefore cannot claim a complete visual pass.

Exit status is `0` when the measured mechanism and screenshot integrity pass, `1` when an enforced metric or capture-integrity check fails, and `2` when the browser cannot verify the mechanism or pixel format. Exit `0` is not visual approval. The report includes requested/alternate/restored computed theme paints and their round-trip comparison, requested and observed conditions, Chromium and Node versions, host platform, theme attribute and computed root/body/modal paint, viewport and DPR, visual viewport, CSS font declarations, actual platform-resolved fonts when Chromium supports them, every sampled surface measurement, operation details, screenshot hashes, runtime errors, intentionally blocked external requests, and coverage limits.

Platform font samples use Chromium’s DevTools Protocol where available and are capped at 20 elements per surface. If font resolution is unsupported, the report records that gap. Screenshots show the current requested viewport, while surface measurements cover every expanded matching FAQ element, including content below the visible fold. The command does not claim that a single viewport screenshot visually covers below-fold content; inspect the actual app at the needed scroll positions during the independent typography review.

All cases are local, unauthenticated browser evidence. They do not establish deployed behavior, authenticated production behavior, physical-device behavior, zero network activity outside the browser request boundary, or human-readable typography. Preserve the repository’s existing independent visual review and release gates.
