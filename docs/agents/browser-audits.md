# Browser audit runs

Use `scripts/agent-tools/browser-audit.mjs` to run a reusable matrix of the existing rendered-evidence FAQ cases. The supported repository layout keeps `scripts/agent-tools/browser-audit.mjs`, `scripts/agent-tools/rendered-evidence.mjs`, and `scripts/browser-fixture-setup.mjs` together in their normal paths. The runner loads the renderer beside itself, and the renderer imports the shared fixture module at `../browser-fixture-setup.mjs`; copying only the two tool files is not portable. Retain the repository checkout, or preserve all three files in this layout. The runner does not import a renderer from a temporary checkout. Supply the local app URL, source identity, output directory, Playwright module, optional browser executable, and allocation IDs explicitly.

The rendered-evidence command still owns browser setup and the product interactions. It uses a fresh in-memory context, no saved storage, blocked service workers and external requests, the app's first-run motion choice when shown, the native Add control for synthetic tasks, the app's theme control, and the existing FAQ controls. It records document/resource hashes and every one of the seven FAQ text surfaces. The audit runner checks that both the requested and observed surface names match the seven-surface contract, while preserving the complete per-case report and its separate metrics, capture-integrity, visual and overall statuses unchanged.

## Supported modes and limits

`desktop-browser` supports `diagnostic-css` and `native-page-zoom`. It records the renderer's `requested.browserContext` settings and requires the context to report `hasTouch: false` and `isMobile: false`. A narrow desktop viewport remains desktop evidence.

`emulated-phone` supports `pinch-zoom` only. The runner reports this mode as configured only when the case records both `hasTouch: true` and `isMobile: true`. That is evidence of the configured Chromium mobile context; it does not establish behavior on a physical phone. If those context settings are absent or disagree, the mode stays unverified and the command exits `2`.

`installed-app`, `authenticated-production` and `physical-device` are retained as separate untested cases with distinct limits. The runner does not launch an installed app, authenticate to production, or claim physical-device evidence. It does not add app hooks or control a user's browser profile.

Visual approval is always independent. A complete case can have passing metrics and capture integrity while its `visualStatus` remains `unverified`. Screenshots show the requested current viewport; surface metrics may include FAQ content below the fold. Review the actual captures at the needed scroll positions. Do not describe the full FAQ as visually approved from a single modal viewport image.

## Run a matrix

Obtain allocation IDs for the local app server and browser runtime through the shared coordination process before running. The runner only records IDs supplied to `--resource`; it does not acquire, renew or release leases, and it does not start or stop the app server. Never reuse another task's allocation.

```sh
node scripts/agent-tools/browser-audit.mjs \
  --mode desktop-browser \
  --url http://127.0.0.1:8000/ \
  --source-id <served-commit-or-artifact-id> \
  --output /tmp/browser-audits/candidate-2026-10-17 \
  --playwright-module /absolute/path/to/playwright/index.mjs \
  --browser-executable /absolute/path/to/chrome \
  --resource app-server=<allocated-server-id> \
  --resource browser-runtime=<allocated-browser-id> \
  --mechanism diagnostic-css \
  --mechanism native-page-zoom \
  --theme light \
  --theme dark \
  --viewport 390x844 \
  --viewport 1280x800 \
  --scale 1.5
```

For phone emulation, use a separate output directory and pass `--mode emulated-phone --mechanism pinch-zoom`. The default matrix is light and dark at 390 × 844 and 1280 × 800; specify repeated `--theme`, `--viewport` and `--mechanism` values to narrow or expand it. Every dimension must be from 320 through 3840 CSS pixels. The local URL must be loopback and must not include credentials.

The source identity is caller-declared. Each underlying rendered case hashes the served document and same-origin scripts, stylesheets and fonts; the command cannot independently verify that the supplied identity names those bytes. Keep the exact identity and served artifact information with the audit.

## Manifest, recovery and cleanup

The runner creates an initially empty output directory and writes a versioned `manifest.json` by writing a same-directory temporary file and renaming it after each state transition. Each matrix case records its planned, attempted, completed, failed or untested status, requested dimensions and mechanism, browser-context configuration, report statuses, resource IDs, artifact/runtime identity, coverage limits and attempt history. For each attempt it records the owned renderer PID, executable, entrypoint, platform and process-group ID where available; cleanup records the signals sent and whether the owned process group exited. A detached browser can belong to another process group. It writes stdout/stderr logs beside every full `case.json`, stores that full JSON in the manifest, and records its SHA-256. Existing output is never overwritten by a new run. A handled renderer or runner failure leaves `runStatus: incomplete`; the runner continues the remaining independent cases and retains their results. `completedAt` is set only when every latest case completes.

Use the same command inputs with `--resume` to recover a partial supported audit. The manifest must be readable, version 1, and have the same source, runtime, resource and matrix inputs. Completed cases are left untouched. If the prior process died while an attempt was recorded as `attempted`, recovery marks that attempt failed with cleanup `unverified`, preserves its failure as a coverage limit, and starts a new numbered attempt. Recovery does not claim that a finalizer ran or infer completion from a partial report. A forced process termination may leave an external child whose owner can no longer be established; the recovery record keeps that cleanup unverified. Never delete an attempt directory to make a resume succeed. The manifest cleanup summary covers all recorded attempts and lists unresolved case/attempt identities. A completed resumed matrix may retain `runStatus: complete` for case coverage while historical cleanup stays `unverified`; the command then exits `2`, even when the latest attempts pass. Older v1 group-only `completed` cleanup without a terminal report is retained verbatim and qualified as unverified in the aggregate, with the reason recorded. Resume never signals a recovered PID from history.

On a handled SIGINT or SIGTERM, the runner records an incomplete manifest and performs bounded cleanup only for its own renderer process tree. It leaves the caller's app server, browser/runtime lease, profiles and unrelated processes with their owners. Cleanup results are recorded per attempt and on the manifest. `processGroupStatus` describes the bounded group shutdown separately from full cleanup. An interrupted renderer, absent terminal report, or renderer finalizer error leaves detached-browser cleanup `unverified` even when the renderer group is empty. The runner does not signal detached or historical PIDs without current safe ownership evidence; unresolved cleanup blocks exit `0`. Do not interpret cleanup of the renderer process tree as server shutdown or lease release.

The runner checks that the measured reference `innerWidth` and `innerHeight` equal the requested viewport. For `diagnostic-css`, it also checks the capture viewport because that mechanism does not change the viewport. It does not require the native-page-zoom or pinch-zoom capture viewport to match the reference: their measured viewport changes are part of those mechanisms. A runner mismatch fails the case while preserving the renderer's own statuses and full report.

Exit `0` means supported runner checks and measured metrics/capture-integrity checks passed; it does not mean visual approval. Exit `1` reports a failed renderer or runner check. Exit `2` means some requested evidence remains untested or unverified, including unsupported modes and unmatched emulated-phone context. Keep local test results, rendered evidence, independent visual review, authenticated production checks and physical-device checks as separate claims.
