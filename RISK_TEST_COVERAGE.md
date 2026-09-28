# Risk-based test coverage inventory

This map records the current named RISK contracts in tests.js. It lets reviewers see which costly feature boundaries already have explicit protection before changing nearby behavior. Related non-RISK regression tests remain part of the contract too; the focused companions below call those out where they matter.

The named-contract test in tests.js checks that every top-level test whose title starts with RISK appears in this inventory. Add or rename the inventory entry in the same test-first change. If a future feature adds a new risk area, add a heading and place its concrete test names under it.

## Task state, eligibility, and scanner controls

- RISK rating drift: Done and Worked on it stay neutral on every completion route and recurrence type
- RISK false preference evidence: All Tasks Dot compares only with the current benchmark and a first dot stays neutral
- RISK lost scheduling metadata: both Add routes save and clear Start and Due together
- RISK recurrence-default loss: quick Add preserves 18-hour and 2 AM defaults across single and pasted tasks
- RISK unreachable Undo and lost preference: floating header defaults off, saves on toggle, and survives close and reload
- RISK prerequisites: completion, evergreen Done, restore, and deletion govern scan eligibility by ID
- RISK prerequisites: invalid links and cycles are rejected; missing imported references are eligible
- RISK prerequisites: Add and each task editor expose stable selectors and removal
- RISK evergreen hours or days: stored hours survive conversion, UI save, and 2 AM reset suggestion
- RISK evergreen countdown: idle foreground timer repaints at the next displayed hour and minute
- RISK prerequisites: editing after deletion retains the missing task link until explicitly removed
- RISK custom hourly quotes: saved quotes still play after Settings controls are removed
- RISK Settings slim controls: pass reset and bulk import stay out of Settings

## Local backups, cloud adoption, and recovery

- RISK CLOUD BACKUP: an exact stable recovery copy satisfies adoption when duplicate writes hit quota
- RISK CLOUD BACKUP: an unreadable backup row is never discarded to make room
- RISK CLOUD ADOPTION: failed safety backup leaves the local revision and board unchanged
- RISK CLOUD ADOPTION: iOS-style cold open keeps the merged board after backup quota and reload
- RISK CLOUD ADOPTION: a later edit during union push cannot borrow the saved adoption proof
- RISK CLOUD ADOPTION: held newer read cannot release a pending write from an earlier reconcile
- RISK CLOUD ADOPTION: a board-store quota failure restores both browser keys and holds the cloud
- RISK CLOUD ADOPTION: failed write rollback preserves another tab newer browser bytes
- RISK LOCAL BACKUPS: deleting one visible copy preserves hidden unreadable recovery bytes
- RISK LOCAL BACKUPS: unreadable old copy is visible with exact raw recovery and targeted removal
- RISK LOCAL BACKUPS: duplicate IDs and malformed root never permit ambiguous deletion
- RISK LOCAL BACKUPS: a stale Settings click cannot delete a row rewritten by another tab
- RISK LOCAL BACKUPS: quota retires the oldest automatic copy while keeping recent, manual, and account recovery
- RISK LOCAL BACKUPS: automatic history has a byte budget before browser quota
- RISK LOCAL BACKUPS: a single stable new copy fits when its duplicate latest does not
- RISK LOCAL BACKUPS: the non-actionable backup-full warning is absent from save UI
- RISK LOCAL BACKUPS: Settings explains automatic early retirement while preserving chosen copies
- RISK LOCAL BACKUPS: exhausted quota leaves the original index and unsaved board untouched
- RISK LOCAL BACKUPS: parseable but unrestorable history cannot be retired for quota
- RISK LOCAL BACKUPS: an unreadable index explains the paused save without claiming quota
- RISK CLOUD BACKUP: quota retirement keeps the exact prior board needed for adoption
- RISK CLOUD BACKUP: an overwritten local edit survives later quota rotation
- RISK CLOUD BACKUP: an offline edit reopened before conflict remains protected
- RISK LOCAL BACKUPS: cold older-tab repair keeps a pinned recovery copy
- RISK LOCAL BACKUPS: stale-tab adoption carries pinned recovery IDs durably
- RISK LOCAL BACKUPS: failed stale-tab marker write leaves both browser keys intact
- RISK LOCAL BACKUPS: cold older-tab bytes carry their recovery IDs into the head
- RISK LOCAL BACKUPS: concurrent older-tab write survives the stale-tab repair tail
- RISK LOCAL BACKUPS: primary save holds when another tab commits during its backup
- RISK LOCAL BACKUPS: single-device Undo frees old automatic history for its primary save
- RISK LOCAL BACKUPS: primary quota rotation keeps the newest stable recovery copy
- RISK LOCAL BACKUPS: quota during Restore keeps the immediate pre-restore board
- RISK LOCAL BACKUPS: a changed board before backup announces the unsaved draft
- RISK LOCAL BACKUPS: cold head initialization holds a concurrent shared-key edit
- RISK LOCAL BACKUPS: paired save holds an older-shell write between its two keys
- RISK LOCAL BACKUPS: concurrent manual copy survives an automatic index write
- RISK LOCAL BACKUPS: concurrent backup append survives a confirmed manual delete
- RISK CLOUD BACKUP: an exact chosen copy avoids duplicate displaced-edit storage
- RISK LOCAL BACKUPS: aged stale-tab and other-browser recovery stays available
- RISK LOCAL BACKUPS: unknown legacy kinds do not expire during rotation

## Location, scene settings, and cross-device behavior

- RISK Settings status: open scene-time and location labels update with their button states
- RISK scene-time color: live choice stays green while a locked choice is red
- RISK synced scene: location and time choices reach the cloud even on an empty board
- RISK synced scene: newer remote choices replace device mirrors and account switches clear them
- RISK synced scene: a cold reload waits for deferred scene modules before applying the board
- RISK synced scene: delayed boot still gives the early renderer saved hourly quotes
- RISK synced scene: a stale same-browser tab repaints from the protected board copy
- RISK synced scene: another tab adopts a saved scene on the board storage event
- RISK synced scene: an open editor defers another tab scene adoption until it closes
- RISK synced scene: a legacy cloud board adopts existing device choices before publishing
- RISK synced scene: malformed imported coordinates and times are discarded
- RISK synced scene: location mirror and time events have production entry points
- RISK synced scene: adopted time and season paint from memory when browser storage refuses writes
- RISK synced scene: Settings reflects board scene choices when device mirror writes fail
- RISK synced scene: Settings discloses coordinate sync and offline device copies

## Landscape rendering, motion, and responsive presentation

- RISK landscape water: the sky and every floating visitor keep a full-height reflection by day and night
- RISK landscape shadows: grounded objects share the dominant celestial light
- RISK landscape vehicles: lower train shadows lie along its rail under changing light
- RISK landscape metro: electrified cars have no shadow while viaduct supports keep theirs
- RISK landscape viaduct: deck has no continuous shadow band while supports keep contact shade
- RISK landscape water: floating silhouettes and mirrors overlap at their contact row
- RISK landscape water: each craft mirrors from its own painted hull draft
- RISK landscape shadows: each object projects away from the visible Sun or Moon position
- RISK landscape shadows: high Sun draws short near-base shade on phone and landscape screens
- RISK landscape grass: visible far, middle, and near ground keep depth-scaled detail density
- RISK landscape water: the full above-horizon scene and weather can reflect at every scene time
- RISK landscape water: the Moon mirrors at full resolution with no displaced scanline bands
- RISK landscape water: natural ripples move reflected detail mostly vertically without rigid sway
- RISK landscape water: existing glints stay restrained while the reflection supplies the motion
- RISK landscape water: the full-size mirror overdraws the clipped horizon by one device pixel
- RISK landscape water: the reflected sky is captured before lake paint reaches the horizon
- RISK landscape water: reflection opacity meets the skyline before fading into the lake
- RISK landscape transit: the metro paints above the water tint without an unused mirror pass
- RISK landscape road: all trail strokes continue beyond mobile viewport edges
- RISK landscape trains: track deck, supports, and overhead electrical stay visible at night
- RISK landscape trains: the current changelog describes the intact night railway
- RISK landscape shadows: the current changelog describes reflections, celestial shade, and depth-scaled grass
- RISK landscape light and water: the current changelog names per-object projection and coherent reflection motion
- RISK landscape water: full-frame animation reuses its reflection buffers
- RISK Animation audit: water and visitors keep a thirty-fps paint cap while time advances
- RISK Landscape browser: live scenery paints day, dusk, night, and dawn as time advances
- RISK app zoom: pinch and double-tap scaling are blocked while ordinary scrolling works
- RISK footer typography: attribution, controls, and credit share one rendered size on phones and tablets
- RISK narrow decision row: Add actions may wrap but done adding and rank evidence remain grouped
- RISK browser layout matrix: native dates respect pane insets, rank evidence stays aligned, and enabled Undo remains pinned
- RISK iOS native date chrome: WebKit Add and Edit dates keep usable inset borders and accept values
- RISK landscape weather: rainclouds have rounded layered contours and the tint fades without a horizon rule
- RISK landscape weather: reflected clouds remain visible without doubling the lake tint
- RISK landscape weather: organic rain storm and snow clouds darken smoothly with the night sky
- RISK landscape water: lake clip overlaps the horizon contact at fractional pixel densities
- RISK landscape water browser: GPU distortion preserves contact and sharp pixels while patches move independently

## Test-first enforcement and regression protection

- RISK regression gate: changing existing tests requires a specific reason and replacement coverage
- RISK regression gate: insertions cannot silently disable existing assertions
- RISK test-first gate: future runtime modules are detected without a filename allowlist
- RISK test-first gate: scanner, landscape, time, rules, and offline-shell edits need a new risk case
- RISK test-first gate: changing enforcement code requires process tests and a new risk case
- RISK test-first gate: unrelated risk cases cannot approve enforcement edits
- RISK test-first gate: initial branch pushes cannot skip the diff comparison
- RISK test inventory: every named risk contract maps to a feature boundary

Companion coverage protects the existing local-backup behavior: LOCAL BACKUPS: seven local calendar days, latest save today, and pre-restore safety copy; LOCAL BACKUPS: a manual backup remains restorable after the seven-day window; LOCAL BACKUPS: a failed safety copy blocks restore and leaves the current board untouched; HARD GATE: full backup store blocks browser overwrite and preserves its prior bytes; and HARD GATE: unreadable backup index is preserved instead of overwritten by a save.

## Using the inventory for future work

Start with the failure cost and the user-visible invariant. Persisted task or backup changes need cases for affected old data, undo, import or restore, deletion, and sync paths. Eligibility changes need valid and invalid prerequisites, boundaries, ordering, and recurrence. Location or time changes need invalid-input, saved-state, reload, and cross-device cases. Visual or motion changes need numeric paint or geometry contracts, reduced-motion behavior, and affected phone, tablet, or short-landscape sizes. Offline changes need shell fingerprints and offline reload checks. Keep unrelated established assertions intact.

The editor hook blocks app or enforcement edits while tests.js has no staged or unstaged change. CI checks that relevant tests are in the final diff and that TEST_CHANGE_RATIONALES.json names the exact test diff, purpose, retained boundaries, and red command/failure. These checks do not prove that a test was run before implementation or that a red result was actually observed. Run the new focused risk test against the unmodified implementation, preserve the real red output in task or release evidence, implement the smallest fix, then run the focused test and npm test. Run npm run test:rules for Firestore rule changes and rendered/browser or offline checks when affected behavior needs them.
