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


## Full-board acceptance added before release

The user then required the full familiar board through broken-board opening,
including when no optional appearance cache survives. Candidate `912218e` and
its earlier warning/header approvals do not satisfy this later acceptance.
Its full run `0a970cf7-dffc-4c46-961a-f9e988698335` was interrupted and
superseded; it is not a full-suite pass or shipment evidence.

The real Chromium cold-start consumer retained 66 supported tasks in two
identical browser copies, removed the appearance and presentation hints, and
held the first actual IndexedDB open plus all three configured Firebase imports.
With authoritative state null and the device read pending, no populated board
was visible. This preimplementation RED is
`full-board-visibility/2026-10-27T00-47-13-770Z-c2852999-f4f6-4a0c-855f-5e919a990b89.json`.
A later long-title control exposed the cache's 1600-character text limit being
incorrectly applied to complete supported task content (`61860686-75f0-46af-84d1-111e2e936ade`).

An exploratory temporary-state renderer was discarded. Its apparent GREEN is
not accepted evidence: live rendering mutates selection closures and schedules
work even if state is restored. The retained `unsafe-renderer-spike.patch`
records that abandoned path. The final path never assigns provisional global
state. It factors narrow shared context, chain/card, task-row and History markup
and gives the opening renderer an explicitly validated detached board. Live
bindings, timers, ranking, focus and save owners remain in the live renderer.
The pure markup parity consumer compares actual output against Stable base
`6c67fb0c9988d3e578579c7bb23a8ed0731aac3f`.

Complete identical browser copies are parsed once. Each source's validation
failure is isolated, so an unreadable protected copy cannot hide a separate
supported source. Divergent supported copies are not arbitrarily chosen.
Saved filter, panel and scroll hints are retained when safe; the saved-query
fixture displays all 65 matching tasks out of 66, while the no-hint fixture
shows all 66. Persistent appearance limits are unchanged. Complete supported
text is escaped through the shared formatter and stripped of live bindings,
links and IDs, without imposing cache text/window bounds on the board itself.

The tracked SavedAppearance lifecycle owns the complete inert display and its
account/identity/storage masking. State remains null, liveBoardAccepted false
and data-app-ready false until normal acceptance. Nine controls cover malformed
or unsupported alternate copies, divergent and absent valid sources, and early
or late account/identity and storage changes; they observe zero saved-board or
backup writes, zero cloud pushes and exact original source bytes. The display
never selects a recovery source or provides editing authority.

The preview is removed immediately before the live render in the same
non-yielding turn. Animation-frame traces check populated display from the
actual durable-read boundary through accepted handoff and at most one connected
full board DOM. Initial network/parser frames are retained separately and are
not claimed to be populated before the main app script is available. An 8s
fixture hold exceeded the unchanged 5s startup deadline and entered normal
recovery; failed attempts `aa7a914b` and `9a9aa220` are setup limitations, not
product REDs. The accepted-handoff fixture uses a 4s hold. A WebKit screenshot
font-readiness wait while imports were deliberately held (`ae353774`) uses the
same bounded capture workaround as the existing status matrix; it does not
change app deadlines or pretend fonts finished loading.

The account-mask fixture's missing CloudSync.pull was independently reproduced
against immutable `912218e` in later-baseline-sensitivity record
`7be36656-2985-48ad-8f2b-2a171999482a`. The fixture now supplies a non-writing
failed-read stub; all masking/source-preservation assertions remain.

Named limits remain: without a complete agreeing same-owner local source, this
projection cannot invent or choose a board. External storage providers and the
user's private iPhone source were not available for this proof. Deferred rank,
chance and sparkline values refresh after accepted hydration; source selection,
cloud confirmation and genuine post-hydration warnings retain their existing
owners. This is not faster hydration, physical-iPhone recovery, or crash proof.
Final exact-candidate qualification, independent affected reviews, CI, Stable
deployment and live verification remain separate gates; Beta remains paused.


## Bounded independent-review repair

Independent Standards and specialist review of `92cb4e5` found the same saved
filter gap plus missing cheap row facts and uninitialized theme/pass chrome.
They also found that an already known account/UID mismatch could leave an old
optional cached appearance visible when the new full display returned early.
The artifact-only active-scanner consumer requested the old reversed filename.
The exact `92cb4e5` cohort `2ab635bb-5773-4a78-bb90-a41a422b5c3b` passed
33/34 checks, including the full status matrix; its sole failure was that
missing screenshot filename. It is not a completed qualification.

A retained external actual-consumer RED, `34d8cbac-68cf-410e-9cb4-722c61a6b955`,
observed 66 opening rows despite a saved Ineligible query containing only two
chain tasks. It ran against clean `92cb4e5` before repair. The retained program
is `full-board-visibility/filter-red-probe.mjs`, SHA256
`396242732a093f25e88240ed04c368b8a56759d7a3f6174e76377566151affb4`.
The permanent missing-chrome and retained-cache privacy controls failed in
preimplementation record `6f57b656-6a21-4161-a994-9be78fc4963c`: the theme
label was empty and both early foreign-account/identity cases left a preview.

The repaired shared pure list read model accepts an explicit board and view.
It preserves query membership (including a valid 2048-character saved query),
eligibility, context/status tags, selected filter controls, blocked-task titles,
eligibility dimming, skip/hold labels and next-dot markup. Live owner/selection
closures and presentation saving remain with allTasksView. Rank/chance sorting
and sparkline calculations remain deferred until accepted hydration. Membership
is compared as a set across handoff because computed live ranking can reorder
that same set; the first filter fixture comparison incorrectly demanded the
pre-ranking order and is retained as setup evidence (`762bb97a`). Another setup
attempt expected a query after calling the existing clear-on-eligibility action
(`be708083`); the fixture now explicitly saves the intended combined query.

Known mismatch removes any old appearance; early same-email UID fixtures also
bind the cached account to the saved owner so the UID assertion is meaningful.
Chain membership uses Sets. Explicit read-only chrome facts fill the theme label
and pass counter; no theme-storage write or pass update occurs. Actual saved
History appears in the full opening fixture as well. The existing scanner
artifact copy uses its producer's actual filename and keeps all geometry checks.
The new consumer roots retain the original source/authority safeguards.

The strengthened same-email UID cache fixture also fails against immutable
`92cb4e5` in later-baseline-sensitivity `7d4cdd9f-d3a3-4f8e-b006-e4bc2e8d49f6`.
Its exact served app bytes are recorded separately in
`full-board-visibility/baseline-92cb-uid-source-binding.json`; the recorder
identifies the newer producing test source. This later sensitivity is not
claimed as the original preimplementation RED.


## Final full-run fixture boundary

The clean `dbde27a` full qualification completed in record
`final-full-board/full-suite/2026-10-27T01-46-36-467Z-bcd81fd3-b54d-421c-80c6-5974fe108264.json`:
3259 passed, four failed and 67 optional cases skipped. It is a failed full
run, despite both exact installed-client cases passing with complete cleanup.
The four failures share one fake DOM boundary in
`exerciseCompletionEditorBoundaries`: it replaced document.querySelector with
an unconditional object solely to simulate the open modal. The new status
mirror legitimately asks for a saved-preview button; that broad override
invented a non-DOM object, producing missing removeAttribute. The three real
editor/gesture/ack consumers and their five-consumer process controller all
retained their original source, field, native-save and cold-reopen assertions.

The test-only repair delegates every unrelated selector to the original fixture
and simulates only `.mback, dialog[open]`. It explicitly asserts that the modal
exists and no saved-preview status node is invented, then restores the original
selector. All four previously failing roots pass in
`final-full-board/fixture-repair/2026-10-27T02-02-50-415Z-f1eb75fa-14c7-46a2-a31b-41961d21ed56.json`.
This is a fixture contract repair, not a new product RED or runtime fix. App,
styles, service worker and rendered producer helpers remain byte-identical to
`dbde27a`; prior visuals retain their actual producing tests and candidate.
The test-only successor still requires its own clean full/native qualification
and exact renewed review receipts.


## CI group registration repair

The first push and PR runs on `9306a59` (40438515810 and 40438532304)
failed in validation-context before executing regression groups. Nine new
top-level startup/presentation tests had not been registered in the explicit
CI group map. Local full/native, compatibility and rules results remain passes
for that candidate; they did not exercise the group descriptor. The successor
adds all nine registrations together: two fast presentation/copy contracts in
core and seven storage/startup consumers in persistence-recovery. No inventory
baseline, skip allowance, test assertion or product byte changes. The failed
CI logs remain under the task's external `ci/push` and `ci/pr` evidence.
This is registration repair, not a new product RED. Final grouped descriptor
and regression gates, exact successor review and qualification remain required.


The clean descriptor-only successor `27301a1` was never pushed. Read-only
inspection (also independently found by Standards) showed that its six new
browser roots would skip without an external URL, while the grouped gate
correctly rejects new unaccepted skips. The in-progress full record
`final-ci-candidate/full-suite/2026-10-27T02-30-10-586Z-a76824ec-c3fa-44fb-8bb9-910995027aa9.json`
was safely interrupted as superseded; it is not a pass. The fixture repair
self-hosts an isolated static origin using the allocated native port locally
and an ephemeral port in CI, executes actual bundled Chromium, closes its own
listener and restores the prior environment after each consumer. Explicit
external browser QA retains the original Chromium/WebKit matrix. Six roots
now run by default with every source/privacy/visibility assertion retained;
no new skip is accepted and no baseline inventory or group verifier changes.
Product bytes are unchanged; altered producer tests do not relabel the prior
234 + 82 rendered artifacts as new executions.

Self-hosted focused record
`ci-assignment-repair/self-hosted-focused-corrected/2026-10-27T02-36-03-444Z-e0701c3e-811e-461f-be9c-17856ce383ac.json`
passes all 18 cases with zero skips and no external browser URL. The first
fixture attempt `1b95a84e` passed 17/18 but its final theme summary still
expected an unexecuted WebKit result; the correction checks both themes for
exactly the installed runtime set, retaining all paint assertions.


Independent review found one configured-Firebase caller still unconditionally
requested WebKit in `ef4ae68`. Its local 18/18 pass used host-installed WebKit
and did not prove CI portability. Exact clean runtime-availability RED
`ci-assignment-repair/chromium-only-before/2026-10-27T02-42-21-861Z-5213f96f-de36-46c7-9520-65e1db016049.json`
uses an external module exposing actual Chromium and an unavailable WebKit
launch boundary. After selecting Chromium only for self-hosted execution,
`chromium-only-after/2026-10-27T02-42-31-884Z-46850720-624e-46fa-89e0-4cf907aaa636.json`
passes all 18 cases with zero skips under that same restricted runtime.
Explicit external QA still selects WebKit for this case. This is a test
portability RED, not a new product RED. Superseded ef4 group execution was
stopped and remains failed/incomplete with `group-stop-audit.json`; no group
pass or exact qualification is inherited.

## Resumed #358 acceptance on current main

The human resumed #358 on October28. Main4fe423bf was merged without
dropping either side's protected tests. The100 approved slices #404–#503
continue as one integration candidate and PR294. All prior evidence above
keeps its original source, comparison base and runtime. The prior3d9442c
full/npm-test run was interrupted at the human hold; its two required
installed-client reports never finalized. Its262-case persistence,15-case
compatibility and24-case rules passes do not qualify this resumed source.

Actual held-IndexedDB browser consumers demonstrated three product gaps.
Malformed optional appearance bytes were deleted during unresolved opening
(REDffcce662, GREENd45f5b96). Repeated device-open failures collapsed a safe
full projection to an empty memory workspace (discovery00233d61, explicit
RED7a423d69, GREEN4ee4678c). Installed-worker optional-cache/view events could
erase a still-eligible full projection despite unchanged independently valid
sources (diagnostic74f1ca0e, explicit RED97e4dc3f, accepted offline journey
GREEN3313e9d3). Diagnostic manual renderer calls were removed before the
permanent consumer RED and are not acceptance evidence.

The opening display now preserves invalid optional bytes until normal accepted
capture, retains the full read-only presentation after exhausted existing reads,
and keeps actual recovery controls reachable without accepting retained data.
Task-changing handlers, shortcuts and Settings edits remain held. No retry or
deadline was extended. Ordinary no-safe-source memory-workspace behavior stays
separate. A terminal same-owner hint leaves that original held view stable;
it does not promise live cross-tab preference updates. Account, UID, source or
view-owner changes still mask the presentation immediately. Terminal hint
REDfe299698, masked-control RED6e3d8c0c and masked-copy RED797c0aa7 preserve
the actual interaction chronology. Focus return passed as an unchanged positive;
it was not a clock repair. Final boundary GREENe5a8c12b passes13/13 with zero
skips, including native recovery-header keyboard navigation, Settings/Paste
Restore/reload, all three held-state masking controls, accepted date change,
native edit/durable readback and actual offline repeated reopening.

The user explicitly clarified #442: preserve the existing filter choices and
test each supported combination. Search plus eligibility plus one context or
status tag is covered through the actual native transition; simultaneous
context/status filtering and a saved-view schema expansion are outside scope.
The original maximum-query fixture already reached2048 characters. Earlier
dbde27a typography evidence included a genuine82-artifact1.5x full-board
supplement; the current permanent consumer strengthens current-source coverage
rather than erasing that valid historical proof. Explicit cached-old-error and
controlled accepted calendar-change cases passed in deddd885 before the final
boundary run. Both new required roots are registered; no inventory/skip or
release-gate budget is weakened.

An external archive event removed the active dirty checkout at10:57:57Z on
October28. Its cause is unconfirmed. Snapshot68c878c571e441c43b0890253fda7ab2e4dc97ba
retained the exact source bytes, matching the last pre-archive recorder.
The same branch/path was restored byte-for-byte and Git-locked under the same
live host entry; no foreign checkout or reservation was changed. The app
declined ownerless attachment, and no ownership bypass was attempted. Original
ignored dependency/debug-log preservation remains unverified; pinned dependencies
were reconstructed. Recovery manifests and the snapshot ref remain retained.

Contemporaneous records and the100-slice acceptance index live outside the
checkout in task-artifacts/issue-358-resume-20261028. This section records focused
acceptance, not final qualification: the clean frozen candidate still needs its
full/npm-test and both installed-client cases, exact-base compatibility/rules,
actual final rendered evidence, independent Standards/Spec-specialist/FAQ and
typography review, corrected PR publication, hosted CI, merge and Stable public
verification. Private original and physical-iPhone recovery remain unverified.
Beta mirroring stays paused until explicit human confirmation that Stable is good.

Independent review of frozen0d7c145 requested two ownership repairs and a
rendered notice backplate. Actual owner-binding RED295d362e reproduces cached-only
initial/later same-email UID disclosure, cached source-change continuity, and
loss of a matching signed-in terminal view. Earlier17187d76 had meaningful
terminal/source failures, but its two UID fixtures were overwritten by the old
pagehide and do not prove that boundary. The corrected fixture restores its
isolated account-only appearance at the actual new-document read. No cache
schema/limit was expanded: a known UID without a validated full source masks
legacy appearance; a matching complete source can rebuild. Terminal ownership
now binds to the shown account. A separate added signed-in hold case proves
same-node header continuity, zero authority/timers, and later UID masking; it
claims no automatic signed-in adoption. All seven earlier retry cases remain.
Backplate RED9dc290d2 observes transparent terminal status paint over scenery;
the repair reuses the adjacent established notice class, border, radius and
insets. Batched GREEN498674c5 passes27/27, zero skips.

Frozen0d7 rendered run7ed80043 passed47/48, with an initial-load
LandscapeVisits page error. Its successful214 artifacts retain only0d7 scope.
Supplement1c4c99fe completed four Chromium terminal/Settings/Help cases, then
failed a producer wait referencing a new-document variable before declaration;
WebKit Help was unverified there. Independent preliminary review requested
visible glyph-bearing font evidence and answer/changelog end captures; the
corrected external producer preserves both limitations and does not alter app
behavior. The exact LandscapeVisits cause remains unconfirmed. Bounded WebKit
diagnostica58e0733, delaying the preparatory SPAWN_RATES fetch, instead exposed
an unrelated fetch page error during fixture navigation. Waiting for those
owned preparatory local reads before seeding/reloading passes both ordinary
and delayed controls in25bbd359. No page error is suppressed and no wait is
added to the actual held reopening interval. Final coherent source still
requires the complete rendered status matrix and all release gates above.
