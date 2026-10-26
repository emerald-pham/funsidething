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

The rendered saved-appearance consumer exposed a second related issue. It first
created a real saved recovery-pending appearance from a completed protected
local recovery, then held a new malformed-head startup with a separate,
supported local board and two independently readable browser copies. Before any
manually dispatched cloud event, the opening badge naturally became disabled
`☁ syncing`; the projection stayed visible and inert, and the actual board was
not hydrated. When a later synthetic CloudSync initialization error arrived
through the real `cloudsync` event, the live header changed to `☁ error` but the
cached appearance still said `☁ syncing`. The inert projection had no live
status update. After the supported board opened, the new genuine recovery hold
remained visible.

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
3. **Cached appearance status follows the live header — rejected in the first
   rendered check.** A real app event changed the live header to `☁ error`, but
   the visible saved appearance remained `☁ syncing`.
4. **Enlarged busy text fits the existing fixed width — rejected.** The
   measured 18px label overflowed the control by 9px in the observed narrow
   render.

## Change and focused evidence

Before hydration, configured cloud status now remains disabled `☁ syncing`
unless CloudSync reports an actual error. Its title says that the saved board
is still opening and cloud status is not confirmed. Once a board is hydrated,
a genuine recovery hold continues to show `☁ recovery pending`; actual errors
keep their normal error presentation.

The inert saved appearance now mirrors the live badge's class, text, disabled
state, visibility, title, and accessible label after each `renderSync()` path.
The preview remains `inert` and `aria-hidden`; this does not make its board
authoritative or actionable. The busy badge uses an automatic width with an
88px minimum so enlarged syncing text fits without overlapping Settings.

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
- **Help/changelog RED:**
  `2026-10-26T23-33-23-531Z-10561260-d608-433a-b16a-48a189094e84.json` failed
  because the existing Help text did not distinguish opening status from cloud
  confirmation or explain that real recovery warnings remain visible.
- **Help/changelog GREEN:**
  `2026-10-26T23-33-50-039Z-35bd60fe-bc71-427a-ab93-b0218bcf6091.json` passed
  the new rendered Help and current Changelog contract.
- Recorder metadata and full stdout/stderr are kept under the common Git
  directory at `.git/agent-test-runs/quiet-board-startup/`.

The synthetic fixture creates a previous genuine recovery hold, safely clears
that hold only inside its isolated test database before starting a second
recovery, and retains independently validated local sources. It checks both a
populated prior appearance and the no-appearance fallback. No production board,
account, or phone storage is used.

Full-suite and compatibility checks, independent Standards/Spec and
FAQ/typography reviews, exact-candidate release qualification, CI, and Stable
live verification remain release gates. Beta mirroring remains paused.
