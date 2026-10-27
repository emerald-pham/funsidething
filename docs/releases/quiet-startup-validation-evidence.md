# Broken-board startup validation

## Scope and limits

The user clarified that this occurs in the installed iPhone app with a broken
board: the startup view first shows “recovery pending” while the board is not
yet shown, then the board appears after about a second. No private board source
or phone capture was provided. The evidence below uses the real app startup,
recovery, status, and saved-appearance consumers with isolated synthetic
storage. It does not establish the cause on the user's iPhone or prove a
physical-device repair.

The focused existing consumers inspected were:

- `RISK unreadable device recovery: raw startup preserves sources and supports
  native File restore`, which checks original preservation and recovery UI.
- `RISK AUTH HYDRATION: a corrupt device-head read protects exact originals
  before supported local recovery releases hydration`, which holds device
  storage while recovery protects its originals.
- `RISK AUTH RESTORE: remembered boards show syncing in header and Settings
  while restoration is pending`, which keeps pending-auth and terminal
  auth-error behavior as positive controls.
- The existing saved-view startup and restoration consumers, which exercise
  saved appearance, delayed local reads, account masking, and safe fallback.

## Observed reproduction and cause

The new `RISK AUTH HYDRATION: a broken device board stays quiet until protected
local recovery is visible` test seeds a malformed durable device head and a
distinct valid local board. It waits for the real `device-source-recovery` hold
to be written and reread, then pauses the existing raw IndexedDB verification
read before hydration. With `state === null` and cloud status syncing, both a
direct `renderSync()` call and the normal `cloudsync` listener showed
`☁ recovery pending`. Releasing that same read hydrated the supported board
while retaining the genuine recovery hold and malformed source. This confirms
the status decision in the synthetic app consumer: the code displayed a durable
recovery hold before a board had hydrated for the opening view.

The configured-module first-paint consumer confirmed the cached-status cause.
It created a prior `☁ recovery pending` appearance through protected local
recovery, then seeded a separate supported board and malformed durable head.
With all three real Firebase module imports held and the first IndexedDB read
still pending, `CloudSync` was configured and syncing, no `cloudsync` event had
fired, but the inert visible projection still painted the cached recovery
warning. This proves the warning can flash before either the first cloud event
or board hydration in the controlled WebKit browser. After pre-paint status
normalization, the same setup showed disabled `☁ syncing`; releasing the held
imports produced the real initialization error event and changed the projection
to `☁ error` while it remained inert and the board was still unopened.

A separate rendered status consumer also exposed stale event mirroring. It held
a broken-board startup and dispatched a real `cloudsync` event for a later
initialization error; the live header changed but the cached appearance did not.
The event mirror now updates the visible status without making the projection
actionable. After the supported board opened, the genuine recovery hold remained
visible.

The same rendered check found that the 18px busy badge clipped its text: its
scroll width was 95px while the fixed-width control exposed only 86px of content.
This occurred next to the Settings control in the narrow viewport. These are
synthetic Chromium/WebKit observations; they are not a report from the user's
phone.

Ranked alternatives and their predictions:

1. **Early hold rendering — confirmed in the synthetic Node consumer.** Direct
   rendering should show the premature hold before cloud event dispatch. It
   did, so event ordering is not required for that behavior.
2. **The broken board is terminally unrecoverable — rejected for the controlled
   fixture only.** Releasing the existing read opened the separate supported
   board and retained the real hold. The private phone board remains unknown.
3. **The saved appearance already reflects current cloud state — rejected.**
   With the real configured module held before its first event, `CloudSync` was
   syncing but the appearance still showed the prior recovery warning. The
   event mirror had a separate gap: a later real `cloudsync` error changed the
   live header while the cached appearance remained `☁ syncing`.
4. **Enlarged busy text fits the existing fixed width — rejected.** The
   measured 18px label overflowed the control by 9px in the observed narrow
   render.

## Change and focused evidence

Before hydration, configured cloud status now remains disabled `☁ syncing`
unless CloudSync reports an actual error. Its title says that the saved board
is still opening and cloud status is not confirmed. Once a board is hydrated,
a genuine recovery hold continues to show `☁ recovery pending`; actual errors
keep their normal error presentation.

Before appending a cached appearance, synchronous cloud configuration now
replaces its old badge with disabled `☁ syncing`, or hides it when cloud sync is
not configured. Once `renderSync()` runs, the inert saved appearance mirrors
the live badge's class, text, disabled state, visibility, title, and accessible
label. The preview remains `inert` and `aria-hidden`; this does not make its
board authoritative or actionable. The busy badge uses an automatic width with
an 88px minimum so enlarged syncing text fits without overlapping Settings.

- **Original Node RED:** recorder record
  `c45a9f5c-04b6-42a1-8afb-e885177a9b01`; direct render and event both showed
  `☁ recovery pending` before hydration. **Focused Node GREEN:**
  `79e1d6b7-4018-4ec7-a841-bb6701f4dc3a`; the same consumer passed with the
  supported board and genuine hold preserved.
- **Later rendered status RED:**
  `2026-10-26T23-24-58-643Z-f8199d26-8906-4779-8277-db009f78a736.json`; after
  the initial status gate but before status mirroring, the real cloud error
  updated only the live header. This is a later-baseline RED for the separate
  saved-appearance synchronization slice, not the original baseline.
- **Enlarged badge RED:**
  `2026-10-26T23-29-18-278Z-514da5b9-27a7-4e49-bc2a-cb83e6219756.json`; 18px
  syncing text measured 95px versus 86px available at 390px width.
- **Rendered GREEN matrix:**
  `2026-10-26T23-31-25-930Z-75d4af21-757d-44c9-b7ae-3fe5b3ca303f.json`; all
  eight combinations passed: Chromium/WebKit, light/dark, and 390×844/1100×900.
  It observes the natural opening status before any injected event, real-error
  visibility before and after hydration, the retained hold, enlarged text fit,
  viewport bounds, and Settings adjacency. Captures and JSON probes are under
  `.git/agent-test-runs/quiet-board-startup/saved-view-rendered/status/`.
- **Configured-module first-paint RED:** recorder record
  `2026-10-26T23-57-24-334Z-b91929bd-d950-4431-af29-af44230e6ab7.json` held all
  three Firebase imports and the initial IndexedDB read. Before the first
  cloud event, the prior cached warning remained visible as
  `☁ recovery pending` instead of disabled `☁ syncing`.
- **Configured-module first-paint GREEN:** recorder record
  `2026-10-26T23-57-57-987Z-5db11780-0d9c-4ad1-8a3a-d00cd0e29313.json` passes
  that WebKit consumer. Its paired JSON captures zero events before release,
  the neutral opening badge, and the actual import-error event afterwards.
- **Help/changelog RED:**
  `2026-10-26T23-33-23-531Z-10561260-d608-433a-b16a-48a189094e84.json` failed
  because the existing Help text did not distinguish opening status from cloud
  confirmation or explain that real recovery warnings remain visible.
- **Help/changelog GREEN:**
  `2026-10-26T23-33-50-039Z-35bd60fe-bc71-427a-ab93-b0218bcf6091.json` passed
  the new rendered Help and current Changelog contract.
- Recorder metadata and full stdout/stderr are kept under the common Git
  directory at `.git/agent-test-runs/quiet-board-startup/`.

The exact-byte focused group passed again after refreshing the app and service
worker fingerprints. Recorder record
`2026-10-27T00-15-32-910Z-784ed453-420b-4dde-82dd-74f4ac93ada7.json` records
four broken-board tests, four passed, zero failed, and zero skipped. Its
rendered matrix captures are in
`.git/agent-test-runs/quiet-board-startup/final-exact-candidate/visual/` (72
PNG screenshots and 70 JSON probes). The matrix covers Chromium and WebKit,
light and dark themes, and 390×844 and 1100×900 viewports. It records actual
root and board-panel paint before and after hydration, the natural disabled
opening badge before any injected cloud event, enlarged status and adjacent
Settings typography and bounds, real error events, the recovered board and
its retained recovery hold, and populated-list top/middle/end scroll bounds.
The Chromium keyboard capture focuses the enabled status button with its
visible 2px outline and 2px offset. In the WebKit run, host-driven Shift+Tab
left focus on `BODY`; this is recorded as a keyboard-navigation limitation,
not a WebKit focus pass. WebKit's rendered theme, status, typography and
geometry evidence remains available in the same matrix.

The earlier broad `npm test` run was interrupted and superseded while review
repairs were being made. Its original output remains preserved; it is not a
full-suite pass. Full-suite, compatibility, native, independent review, exact
candidate release qualification, CI and Stable live verification remain
separate release gates. Desktop WebKit and Chromium observations do not prove
the reported behavior on a physical iPhone.

The synthetic fixture creates a previous genuine recovery hold, safely clears
that hold only inside its isolated test database before starting a second
recovery, and retains independently validated local sources. It checks both a
populated prior appearance and the no-appearance fallback. No production board,
account, or phone storage is used.

Full-suite and compatibility checks, independent Standards/Spec and
FAQ/typography reviews, exact-candidate release qualification, CI, and Stable
live verification remain release gates. Beta mirroring remains paused.

## Existing FAQ regression repair

The first reviewed candidate `5b9a097` and the repaired candidate `d717e140`
both retained stale sentences in the existing unreadable-device FAQ test.
The clean `d717e140` reviewer run
`2026-10-27T00-22-13-456Z-56b2e6ce-da12-4e40-ae14-84ab7377f951.json`
is preserved under task evidence `reviews/standards-d717-existing-faq/`.
The test-only repair checks the latest note for preserved-local-copy opening,
unconfirmed cloud saving, and genuine errors/warnings, and keeps the FAQ's
validated-source requirement and all unrelated restore/archive safeguards.
This repair does not change application or service-worker bytes and does not
create a new product RED claim. The focused repair run
`2026-10-27T00-27-03-732Z-63eea31f-5771-4db4-9b76-728f05e95854.json`
passes the existing FAQ, new guidance, hydration, and inventory roots on the
recorded dirty test delta; final committed qualification remains separate.

Required preflight then found the All Tasks answer above its unchanged
130-word limit (record `1e5c53da-0109-4f33-86eb-18beadee4f06`), followed by
the unreadable-device answer (`b2456ed0-3e8a-472a-933b-15b0cffc2c83`).
Two concise rewrites preserve the complete recovery/confirmation guidance and
all existing FAQ assertions. The unchanged brevity and affected guidance tests
pass in record `1ffbe0a7-1164-4a38-9308-1861774fbb4a`. This later FAQ-only
application delta requires refreshed shell identities and affected FAQ review;
startup runtime, status styling, and the 142 earlier header/scroll artifacts
retain their original producing-test and application identity, with unchanged
behavior rather than a claim that they were reexecuted on the new commit.
