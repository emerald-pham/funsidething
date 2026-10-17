# Saved view on reopen and refresh

Status: approved for implementation, October 16, 2026. The user confirmed the
shared understanding with “sure” and explicitly invoked implement-spec.
Implementation and release track [GitHub #140](https://github.com/emerald-pham/funsidething/issues/140).

## Problem

The user sees boards and task lists jump from an unfilled appearance to a filled
one when opening or refreshing the app, including after a long absence. They
want the opening view to resemble the one they left.

## Agreed behavior

1. Scope is boards and task lists (Q1), rather than the animated landscape.
2. Restore the last board and task-list view, including filters and the person's
   place in the list (Q2).
3. Show the device's saved copy first, then reconcile newer cloud data gently,
   preserving edits made during loading (Q3).
4. Recompute dates, postponements and task availability on reopening. Legitimate
   changes to the current task list are expected (Q4).
5. Remember each device or browser's place separately (Q5).
6. Improve existing functionality using repository precedents. Existing behavior
   answers routine design details; do not turn source-discoverable facts into
   more preference questions (subsequent direct user correction).

The canonical term is **saved view**; see [GLOSSARY.md](../../GLOSSARY.md).
No screenshot, storage mechanism or new source of board truth has been selected.

## Proposed fix and observable acceptance

Extend the established restoration behavior through cold reopen and refresh.
Use the current durable board and existing reconciliation rules as authority;
restore the local presentation alongside them. Implementation should begin by
reproducing the reported visual transition rather than assuming its cause.

1. Start with a saved board, an open task list, nondefault filters and a scrolled
   position. Reopen or refresh: the first visible board/list uses the restored
   populated view, with no intervening empty/default board appearance.
2. Repeat offline and after a long simulated absence. Retain the saved view,
   recompute time-sensitive information, and preserve the current local editing
   behavior.
3. Delay cloud reconciliation, make an edit locally, then allow remote data to
   arrive. Follow the existing merge, unfinished-edit and pressed-control
   protections while retaining the person's list position where applicable.
4. Open another device/browser: it retains its own place. Account changes,
   deleted or missing references and unavailable storage follow safe existing
   fallbacks; a prior account's cached presentation must not bypass account
   boundaries.

No additional preference questionnaire is needed for established behavior.
The shared-understanding confirmation is complete.

## Current implementation evidence

Read-only source inspection used `origin/main` at
`69a9feddf5d6bb8c4973475f7232e363b8646097`. No browser reproduction was performed;
these observations identify possible causes rather than establish which one the
user encountered.

- `index.html` starts with static controls and empty scanner/list containers.
  `init()` awaits `loadState()` before the first board `render()`; it does not
  intentionally render a fresh board before the recovered local board.
- Local reads prefer host storage when present, otherwise the transactional
  IndexedDB device store with legacy/localStorage recovery. An unfilled shell
  can be visible while local loading finishes.
- A pending cloud pull can also adopt and render data after the first local
  render. Local restoration and cloud reconciliation are distinct transitions.
- Section-open flags are already durable. All Tasks search, eligibility/tag
  filters, selection and bulk-edit state are held in the `allTasksView` closure.
  List scroll survives an in-session rebuild, but has no durable reload field.
- The head contains a theme paint hint. Static asset caching in the service
  worker does not preserve the rendered board/list appearance.
- Account switching already has a deliberate boundary: an account without a
  cloud board clears the prior account's active board while retaining backups.
  Any saved-view design must respect that boundary.

## Concrete precedents to reuse

- Local-first restoration and cloud validation: `init()` and `loadState()` in
  `index.html:7262` and `index.html:2553`; tests at `tests.js:11774` and
  `tests.js:11797` retain the local board through malformed/delayed cloud data.
  A cold-reopen/merged-board contract also exists at `tests.js:9684`.
- Early display hints: the tiny device-local theme hint is read in the head
  before first paint (`index.html:14`, `index.html:1466`), with missing, invalid
  and blocked-storage coverage (`tests.js:8059`, `tests.js:8176`). This is a
  precedent for bounded presentation hints, not an existing board snapshot.
- List position during redraw: `renderList()` captures and restores `scrollTop`
  (`index.html:6136`, `index.html:6211`); `tests.js:25074` proves a selection
  redraw preserves a 420px position. Reload restoration extends this behavior.
- Existing filter lifecycle: `allTasksView` holds query/eligibility/tag filters
  (`index.html:5952`, `index.html:6071`). Commit `d2c48cd` explicitly described
  search as UI-only, never saved, synced or undoable. The user's accepted Q2/Q5
  authorizes adding device-local continuity without making filters shared task
  data.
- Section-open fields are already saved with the board and included in cloud
  payloads (`index.html:1400`, `index.html:3341`, `index.html:6807`). Per-device
  presentation continuity must be reconciled deliberately with that existing
  behavior rather than casually changing the board sync format.

Source inspection found no existing pre-first-render visual assertion, durable
filter restoration or reload scroll restoration. Existing boot harnesses wait
for initialization and therefore do not prove the reported initial-paint timing.

Source entry points: `index.html` (`init`, `loadState`, `allTasksView`,
`renderList`, `writeThemeHint`, account-switch and cloud-adoption paths),
`device-store-v2.js`, `landscape.css` and `sw.js`.

## Implementation and verification boundary

Choose the smallest mechanism that meets the confirmed behavior without turning
the saved appearance into an independent authority for tasks, dates or account
access. A large synchronous copy or rendered snapshot has startup, quota and
staleness tradeoffs that still require investigation.

Before runtime edits, agree the consumer-visible seams and exercise meaningful
RED then GREEN through reopen/refresh with isolated data. Relevant cases include
slow local reads, offline cold reopen after a long absence, delayed cloud data,
edits during reconciliation, account switching, missing/removed references and
storage failures. Preserve existing data, sync and draft safety contracts.

The eventual product change requires the repository's FAQ/changelog, review,
rendered startup evidence, compatibility and release gates. This document and
source inspection claim no implementation, tests or deployed behavior.
