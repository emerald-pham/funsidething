# Risk-based test coverage inventory

This map records the current named RISK contracts in tests.js. It lets reviewers see which costly feature boundaries already have explicit protection before changing nearby behavior. Related non-RISK regression tests remain part of the contract too; the focused companions below call those out where they matter.

- RISK rooftop gardens: daylight hides paired plants while preserving decks and nighttime lights
- RISK skyline light cadence: twice as many opportunities keep single-roof samples and visible-window toggles
- RISK clocktower visit geometry: four staggered visitors stand on both actual roof slopes at every viewport
- RISK clocktower visit scheduler: rare night-only rolls pause expire cancel and never replay a backlog
- RISK clocktower reduced motion: four fixed roof contacts fade gently without flight or posture animation

The named-contract test in tests.js checks that every top-level test whose title starts with RISK appears in this inventory. Add or rename the inventory entry in the same test-first change. If a future feature adds a new risk area, add a heading and place its concrete test names under it.

## Task state, eligibility, and scanner controls

- RISK neutral bootstrap: JSON replacement and Undo deletion cannot be promoted by stale chosen copies

- RISK neutral bootstrap: restoring a deleted automatic task during pending saves keeps backup exclusion

- RISK neutral bootstrap: Settings backup Restore restores causal exclusion and choice in both directions

- RISK neutral bootstrap: automatic oldest stays outside Yes No and Dot comparisons until explicitly chosen
- RISK neutral bootstrap: device cloud codecs Undo and stale concurrent copies preserve exclusion and explicit choice
- RISK neutral bootstrap: unknown evidence concurrent automatic placement completion and restart remain safe
- RISK neutral bootstrap: offline reconnect real cloud glue retains neutral provenance through old copies and Undo
- RISK neutral bootstrap: FAQ explains exclusion explicit choice legacy limits and standalone Dislodge

- RISK All Tasks mobile layout: names and every metadata badge wrap inside the task column without changing saved state
- RISK All Tasks mobile layout FAQ: existing list guidance explains wrapped names and badges
- RISK All Tasks mobile layout browser: WebKit and Chrome keep names badges blockers and taps usable across viewport and text sizes

- RISK quick Add evergreen: untouched hours default to seven days with no reverse reset
- RISK quick Add evergreen: edited durations and custom defaults survive unit changes
- RISK quick Add evergreen: an eighteen-day custom default never becomes the seven-day suggestion
- RISK quick Add evergreen: closing or cancelling preserves the draft and its edit history
- RISK quick Add evergreen: single list and paste capture reset editing for the next draft

- RISK quick Add: retired Add and dot is absent while ordinary Add preserves contexts and the current chain
- RISK quick Add: retired add-dot actions cannot create a task or discard an unsaved draft
- RISK quick Add: help removes the retired shortcut and retains participating editor Dot as a rank decision
- RISK quick Add browser: the retired button stays absent on phone tablet and desktop through chain changes

- RISK evergreen flag changes: completion cancellation survives both merge directions durable replay and cloud

- RISK evergreen Undo: all Done entry points clear a persisted rest period and countdown
- RISK evergreen return: the editor ends rest early durably while keeping History and ratings
- RISK evergreen reconciliation: stale completions cannot reinstate cancelled rest in either merge direction
- RISK evergreen Undo: an older session and unrelated edits survive reversing a later Done
- RISK evergreen return: saving a shorter interval or disabling evergreen still returns the resting task
- RISK evergreen Undo: durable IndexedDB and host storage keep the cancelled completion after reload
- RISK evergreen cloud: Undo and early return publish cleared cooldowns and reject a later stale completion
- RISK evergreen legacy: a saved cooldown without a done mark can return early and deletion Undo preserves it

- RISK DATE DISPLAY: noncurrent years remain visible in task and history labels across New Year
- RISK DATE FORMAT: legacy and corrupt preferences default to System and overrides preserve calendar days
- RISK DATE FORMAT: Settings saves a changed format immediately through close reload Undo and cloud serialization
- RISK DATE FORMAT: task chips history backups and diagnostics share the chosen date order
- RISK DATE FORMAT: the sky-calendar label follows the chosen order without losing the observers timezone
- RISK AUTH RESTORE: configured startup stays syncing until Firebase resolves the actual session
- RISK AUTH RESTORE: remembered boards show syncing in header and Settings while restoration is pending

- RISK IMPORT RENDERING: restored identifiers cannot inject attributes or break task reveal
- RISK rating drift: Done and Worked on it stay neutral on every completion route and recurrence type
- RISK false preference evidence: All Tasks Dot compares only with the current benchmark and a first dot stays neutral
- RISK lost scheduling metadata: ordinary Add saves and clears Start and Due together without dotting
- RISK recurrence-default loss: quick Add preserves 18-hour and 2 AM defaults across single and pasted tasks
- RISK unreachable Undo and lost preference: floating header defaults off, saves on toggle, and survives close and reload
- RISK prerequisites: completion, evergreen Done, restore, and deletion govern scan eligibility by ID
- RISK prerequisites: invalid links are rejected and cycles warn without discarding saved links
- RISK prerequisites: Add and each task editor expose stable selectors and removal
- RISK prerequisites: pasted Add tasks keep the chosen prerequisite
- RISK eligibility filter: Worked on it remains ineligible until its hold clears
- RISK evergreen hours or days: stored hours survive conversion, UI save, and 2 AM reset suggestion
- RISK evergreen countdown: idle foreground timer repaints at the next displayed hour and minute
- RISK prerequisites: editing after deletion retains the missing task link until explicitly removed
- RISK custom hourly quotes: saved quotes still play after Settings controls are removed
- RISK Settings slim controls: pass reset and bulk import stay out of Settings

## Local backups, cloud adoption, and recovery

- RISK CLOUD PAYLOAD: hydration removes only exact duplicate deletion facts and preserves conflicting same-ID evidence
- RISK CLOUD PAYLOAD: Undo and Restore replacement unions stay idempotent while recording new causal deletion facts
- RISK CLOUD PAYLOAD: reconciliation compacts each side and retains distinct records that share an operation ID
- RISK CLOUD PAYLOAD: amplified legacy deletion history is repaired below the Firestore limit without changing other board content
- RISK CLOUD PAYLOAD: a cold duplicated board repairs both primary keys, uploads once, and reaches a clean acknowledgement
- RISK CLOUD PAYLOAD: a duplicated newer remote is rewritten once and later pulls do not loop
- RISK CLOUD PAYLOAD: duplicated legacy Undo and backup Restore sources converge without losing their distinct facts
- RISK CLOUD ADAPTER: malformed revisions fail closed before Firestore writes
- RISK CLOUD DIAGNOSTICS: safe failure stage and code survive backend and UI boundaries
- RISK CLOUD RECOVERY: a durable ordinary save retries and clears its stale cloud error without reload
- RISK CLOUD RECOVERY: Undo retries a failed write, while a failed retry and an account change stay errors
- RISK CLOUD STARTUP: a repaired divergent browser pair resumes the initial cloud read without tapping the badge
- RISK CLOUD STARTUP: a browser repair after the network read restarts reconciliation automatically
- RISK CLOUD STARTUP: failed pair recovery stays blocked and a queued retry cannot cross accounts
- RISK CLOUD STARTUP: unresolved Firebase reads and writes time out with a retryable diagnostic
- RISK CLOUD STARTUP: a late write acknowledgement is bound to the account through timestamp readback
- RISK CLOUD STARTUP: a transient startup timeout retries automatically and only a completed read clears error
- RISK CLOUD STARTUP: a timed-out write reads before its automatic retry and reaches acknowledgement
- RISK CLOUD STARTUP: a late timed-out transaction cannot overwrite the authoritative retry read
- RISK CLOUD STARTUP: repeated unavailable writes keep one bounded retry budget across successful read-before-write checks
- RISK SCALABLE BOARD CODEC: a multi-megabyte Unicode board roundtrips through bounded verified chunks
- RISK DEVICE STORAGE V2: migration and head plus recovery commits are atomic, CAS guarded, and preserve legacy bytes
- RISK DEVICE STORAGE V2: unreferenced immutable snapshots retire while head and recovery references remain exact
- RISK CLOUD V2: a multi-megabyte board publishes only after verified chunks and pulls byte-exactly
- RISK CLOUD V2: crash resume, concurrent revisions, and account cancellation never publish partial data
- RISK CLOUD V2: corrupt active data fails closed, manifest races retry, and garbage collection keeps recovery generations
- RISK CLOUD V2 ADAPTER: production migrates a legacy root to verified chunks and pulls the exact multi-megabyte board
- RISK CLOUD V2 ADAPTER: an interrupted upload stays invisible and resumes its account-bound generation
- RISK CLOUD V2 ADAPTER: production garbage collection retains current and previous complete generations only
- RISK SCALABLE END TO END: a multi-megabyte local board reaches a v2 manifest ACK and clean device badge
- RISK SCALABLE LOCAL BOARD: a multi-megabyte legacy board migrates without rewriting source bytes and survives edit Undo and offline reload
- RISK SCALABLE LOCAL HISTORY: IndexedDB keeps one daily and one latest automatic recovery reference while edits continue
- RISK SCALABLE RECOVERY: cloud replacement awaits an IndexedDB safety copy and old-tab bytes reconcile without becoming blind authority
- RISK SCALABLE RECOVERY: clean cloud adoption releases its IndexedDB proof only after shared legacy conflicts become durable
- RISK SCALABLE RECOVERY: an inaccessible established IndexedDB authority never revives or uploads its stale legacy shell
- RISK SCALABLE RECOVERY: pending cloud uploads are account-bound and a failed mandatory recovery transaction leaves the head unchanged
- RISK SCALABLE DESTRUCTIVE ACTIONS: Restore and Reset await exact IndexedDB recovery proof before replacing a large board
- RISK SCALABLE SETTINGS: one confirmed delete removes only the selected IndexedDB recovery reference
- RISK SCALABLE OFFLINE SHELL: storage and cloud generation modules load before the scanner and are cached together
- RISK SCALABLE CONCURRENCY: a newer edit made during a device commit is the only board marked durable
- RISK SCALABLE CONCURRENCY: CAS repair retains peer work and a third in-tab edit before replacing state
- RISK SCALABLE STARTUP: blocked and nonsettling IndexedDB opens fail closed within a bounded boot
- RISK SCALABLE LEGACY TAB: each divergent v1 primary key is preserved and reconciled after migration
- RISK SCALABLE LEGACY TAB: cold migration preserves both already-divergent valid v1 keys
- RISK SCALABLE LEGACY TAB: first activation preserves a new single legacy copy before marking it seen
- RISK SCALABLE QUOTA: optional IndexedDB history cannot block a primary board that fits
- RISK CLOUD ACCOUNT: signing out and back into the same account requires a fresh read
- RISK CLOUD ACCOUNT: signing in after sign-out opens the Google account chooser
- RISK RECOVERY EXPORT: an unsaved in-memory board remains copyable without device storage
- RISK LOCAL DIAGNOSTICS: ordinary edits and Undo identify the exact device save gate
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
- RISK LOCAL BACKUPS: lossless compaction frees protected archive quota without deleting recovery
- RISK LOCAL BACKUPS: Undo compacts retained recovery before growing the guarded board
- RISK LOCAL BACKUPS: packed archive codec round-trips exact Unicode and rejects corruption
- RISK LOCAL BACKUPS: corrupt or unknown packed recovery stays byte-exact and blocks overwrite
- RISK LOCAL BACKUPS: archive compaction keeps cross-tab CAS and failed writes byte-exact
- RISK LOCAL BACKUPS: packed view download and delete preserve decoded recovery bytes
- RISK LOCAL BACKUPS: packed recovery remains restorable with an exact safety copy
- RISK OFFLINE RECOVERY: packed archive codec is a pinned local shell asset
- RISK CLOUD BACKUP: mandatory adoption backup compacts protected recovery automatically
- RISK LOCAL DIAGNOSTICS: cloud badge cannot say synced while the latest edit is unsaved
- RISK CLOUD BACKUP: quota retirement keeps the exact prior board needed for adoption
- RISK CLOUD BACKUP: an overwritten local edit survives later quota rotation
- RISK CLOUD BACKUP: an offline edit reopened before conflict remains protected
- RISK LOCAL BACKUPS: cold older-tab repair keeps a pinned recovery copy
- RISK LOCAL BACKUPS: stale-tab adoption carries pinned recovery IDs durably
- RISK CLOUD BACKUP: confirmed cloud state releases temporary recovery pins for later device saves
- RISK CLOUD BACKUP: union recovery stays pinned only until its exact Firestore acknowledgement
- RISK CLOUD BACKUP: acknowledgement frees disk pins before saving a larger in-flight draft
- RISK CLOUD BACKUP: a clean adoption releases redundant recovery without waiting for a write
- RISK CLOUD BACKUP: clean adoption frees automatic history for the next ordinary save
- RISK CLOUD BACKUP: clean adoption promotes every conflicting row sharing a recovery ID under a stable fixture clock
- RISK CLOUD BACKUP: overwritten same-task edits outlive equal cloud pulls when a daily row was reused
- RISK CLOUD BACKUP: a legacy ambiguous daily pin becomes durable before equal-cloud release
- RISK CLOUD BACKUP: a tight legacy store releases a user-equivalent daily pin without growing the index
- RISK LOCAL STORAGE: a full iOS store still opens its readable primary board
- RISK LOCAL BACKUPS: failed stale-tab marker write leaves both browser keys intact
- RISK LOCAL BACKUPS: cold older-tab bytes carry their recovery IDs into the head
- RISK LOCAL BACKUPS: concurrent older-tab write survives the stale-tab repair tail
- RISK LOCAL BACKUPS: primary save holds when another tab commits during its backup
- RISK LOCAL BACKUPS: single-device Undo frees old automatic history for its primary save
- RISK LOCAL BACKUPS: primary quota rotation keeps the newest stable recovery copy
- RISK LOCAL BACKUPS: full optional history cannot block an ordinary edit that fits primary storage
- RISK LOCAL BACKUPS: quota during Restore keeps the immediate pre-restore board
- RISK LOCAL BACKUPS: async host Restore rolls back if its safety row disappears
- RISK LOCAL BACKUPS: host rollback restores an unsaved first-session board
- RISK LOCAL BACKUPS: older queued host save cannot clear a newer Restore proof
- RISK LOCAL BACKUPS: a changed board before backup announces the unsaved draft
- RISK LOCAL BACKUPS: cold head initialization holds a concurrent shared-key edit
- RISK LOCAL BACKUPS: paired save holds an older-shell write between its two keys
- RISK LOCAL BACKUPS: concurrent manual copy survives an automatic index write
- RISK LOCAL BACKUPS: concurrent backup append survives a confirmed manual delete
- RISK CLOUD BACKUP: an exact chosen copy avoids duplicate displaced-edit storage
- RISK LOCAL BACKUPS: aged stale-tab and other-browser recovery stays available
- RISK LOCAL BACKUPS: unknown legacy kinds do not expire during rotation
- RISK RESET SAFETY: Reset everything needs a second tap and Cancel leaves every byte unchanged
- RISK RESET SAFETY: the confirmed reset keeps an exact durable pre-reset copy that survives reload and restores
- RISK RESET SAFETY: backup failure aborts reset before state or primary storage changes
- RISK RESET SAFETY: quota compaction makes room for the mandatory copy without deleting retained rows
- RISK RESET SAFETY: failed primary reset preserves Undo and never restores an old account after switching

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

- RISK landscape city: clock tower meets the waterline on tablet, phone, and short-landscape viewports
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

## Offline shell and updates

- RISK PWA updates: an already durable board applies a downloaded worker without a redundant quota write
- RISK PWA updates: an unsaved draft visibly defers reload while update checks continue
- RISK PWA module delivery: a fresh installed shell serves every production script while offline
- RISK architecture checkpoint: editor Undo and bulk Undo preserve selection boundaries and immutable history through reload
- RISK PWA updates: a host write in flight must finish before a reverted board reloads

## Test-first enforcement and regression protection

- RISK regression gate: changing existing tests requires a specific reason and replacement coverage
- RISK regression gate: insertions cannot silently disable existing assertions
- RISK test-first gate: future runtime modules are detected without a filename allowlist
- RISK test-first gate: scanner, landscape, time, rules, and offline-shell edits need a new risk case
- RISK test-first gate: changing enforcement code requires process tests and a new risk case
- RISK test-first gate: unrelated risk cases cannot approve enforcement edits
- RISK test-first gate: initial branch pushes cannot skip the diff comparison
- RISK test inventory: every named risk contract maps to a feature boundary

## Release memory/cloud/sync and independent code review

- RISK repository process: review policy derives code and specialist roles from the exact diff
- RISK repository process: a generic role guard requires a security specialist
- RISK repository process: generic state persistence requires a memory specialist
- RISK repository process: persisting generic sessions requires both affected specialists
- RISK repository process: TypeScript tooling directives cannot use comment-only exemption
- RISK repository process: CSS comment removal cannot join selector tokens under owner-only review
- RISK repository process: risk-based receipts require the derived exact-final reviewer roles
- RISK repository process: caller-declared specialist domains can only raise the derived plan
- RISK repository process: caller-declared specialist domains raise and bind the exact review plan
- RISK repository process: caller-declared specialist domains reject unknown values
- RISK repository process: risk-based statuses bind required roles and keep legacy receipts valid
- RISK repository process: exact-SHA receipts bind audit and review evidence outside the git tree
- RISK repository process: memory cloud and sync review scope scales evidence to impact
- RISK repository process: schema-v2 specialist scope accepts unaffected assessments with preservation evidence
- RISK repository process: absent, stale, malformed, or nonindependent receipts fail closed
- RISK repository process: memory receipts require absolute source paths
- RISK repository process: release evidence rejects future and noncanonical audit timestamps
- RISK repository process: pre-push checks every outgoing tip and rejects dirty worktrees
- RISK repository process: status publication needs a valid exact-SHA receipt
- RISK repository process: main deployment requires the merged reviewed head, full tree parity, and latest statuses
- RISK repository process: CI makes verified release evidence a deployment prerequisite
- RISK repository process: shared hook chains prior hooks and blocks a legacy worktree without the validator
- RISK repository process: custom hook paths are compared with the shared git default
- RISK repository process: release hooks reject marker-only or tampered dispatchers
- RISK test-first gate: release evidence scripts receive edit-time process protection

The release gate derives a review plan from the exact candidate diff: the owner reviews every diff, ordinary behavior changes require one independent code reviewer, and high-risk domains require a specialist. It requires both independent roles only when code behavior and specialist risk are materially affected. Ambiguous auth, state-persistence, and session changes fail closed to relevant specialists; callers may add known specialist domains to raise the plan but cannot replace or remove derived domains. Memory/cloud/sync specialist evidence records source fingerprints, per-domain impact, and rationale. Every affected domain lists focused tests; an all-unaffected assessment still includes at least one focused preservation test across the assessed domains. Schema version 1 receipts remain verifiable under their former two-review rule, and their publisher also emits a third specialist-compatibility status bound to the same receipt so current branch protection can accept them without inventing a new reviewer. The local hook checks each outgoing tip; the main deployment job independently verifies the merged PR head, derived status plan, and latest statuses. Statuses bind receipts but cannot prove that a person actually read or reviewed them.

Companion coverage protects the existing local-backup behavior: LOCAL BACKUPS: seven local calendar days, latest save today, and pre-restore safety copy; LOCAL BACKUPS: a manual backup remains restorable after the seven-day window; LOCAL BACKUPS: a failed safety copy blocks restore and leaves the current board untouched; HARD GATE: full backup store blocks browser overwrite and preserves its prior bytes; and HARD GATE: unreadable backup index is preserved instead of overwritten by a save.

## Using the inventory for future work

Start with the failure cost and the user-visible invariant. Persisted task or backup changes need cases for affected old data, undo, import or restore, deletion, and sync paths. Eligibility changes need valid and invalid prerequisites, boundaries, ordering, and recurrence. Location or time changes need invalid-input, saved-state, reload, and cross-device cases. Visual or motion changes need numeric paint or geometry contracts, reduced-motion behavior, and affected phone, tablet, or short-landscape sizes. Offline changes need shell fingerprints and offline reload checks. Keep unrelated established assertions intact.

The editor hook blocks app or enforcement edits while tests.js has no staged or unstaged change. CI checks that relevant tests are in the final diff and that TEST_CHANGE_RATIONALES.json names the exact test diff, purpose, retained boundaries, and red command/failure. These checks do not prove that a test was run before implementation or that a red result was actually observed. Run the new focused risk test against the unmodified implementation, preserve the real red output in task or release evidence, implement the smallest fix, then run the focused test and npm test. Run npm run test:rules for Firestore rule changes and rendered/browser or offline checks when affected behavior needs them.

## Oldest never-done scan anchor

- RISK oldest never done: both modes prefer never-completed tasks and keep worked tasks eligible
- RISK oldest never done: legacy completion and restore evidence survives reload and reconciliation
- RISK oldest never done: all-completed fallback and eligibility boundaries preserve usable scans

## Cloud chunk startup recovery

- RISK CLOUD V2 STARTUP: transport and permission failures retain their code instead of masquerading as corrupt data
- RISK CLOUD V2 STARTUP: a transient chunk read automatically recovers to synced without reloading the board

## TrueSkill probability and rating safety

- RISK TrueSkill probability: answer judgments use the same performance noise as rank updates
- RISK chance forecast: five candidates share one uncertain benchmark draw
- RISK chance forecast: one-candidate marginal and supplied order stay intact
- RISK chance forecast: one candidate matches pBeats across extreme supported uncertainty ratios
- RISK chance forecast: adaptive integration resolves narrow shared-benchmark transitions
- RISK TrueSkill truncation: inverse-Mills tails match references through the former cutoff and extreme upset
- RISK rating bounds: hydration and frozen chance opponents normalize extremes without changing healthy ratings
- RISK Diagnostics download: Settings and save directions retain current-board recovery actions

## Returning-user first upload

- RISK FIRST SIGN IN: an existing clean board cannot restart failed upload retries after each empty cloud read
- RISK FIRST SIGN IN: a differing same-revision board is pending until its exact upload is acknowledged
- RISK FIRST SIGN IN: legacy local tasks stay unsynced on failure and only a confirmed upload clears them
- RISK CLOUD LOOP: a conflict followed by an unusable read cannot release another write
- RISK CLOUD LOOP: a rejected write stays visibly paused through focus reads and edits until explicit retry
- RISK CLOUD RECOVERY UI: reload waits for a durable unchanged board and explicit sign out remains available
- RISK PWA recovery: cloud compatibility failures can request the normal safe update check
- RISK CLOUD LOOP: repeated revision conflicts cannot spin even when every read succeeds

## Cross-release compatibility gate

- RISK repository process: backward compatibility is a mandatory fail-closed release gate
- RISK repository process: backward compatibility pins released code and rejects broken roundtrips
- RISK repository process: backward compatibility rejects skipped or empty gate runs
- RISK BACKWARD COMPATIBILITY: released clients and candidate interoperate across both rule versions
- RISK repository process: Firestore deployment aborts when backward compatibility fails

## Destructive action and startup races

- RISK DESTRUCTIVE ACTION RACE: Restore and Reset stop if their backed-up board or account changes
- RISK repository process: the app harness awaits slow durable startup instead of returning null state

## Night shows and skyline

- RISK landscape metropolis: no added background housing or foreground metropolis microtrees
- RISK landscape metropolis: patio strings persist while party fixtures stay event-only
- RISK landscape metropolis: rooftop party beams scan vertically and freeze for reduced motion
- RISK landscape metropolis: rare rooftop parties are single, temporary, and reachable on every eligible roof
- RISK landscape metropolis: city silhouettes occlude selected-party spotlights
- RISK landscape metropolis: gardens and patios both skip towers with lightning rods
- RISK landscape city and aircraft: current changelog names the skyline and plane details
- RISK landscape aircraft: the biplane has one centered landing gear set
- RISK landscape aircraft: ordinary planes restore their previous compact profile
- RISK landscape aircraft: scheduled planes retain the compact silhouette with seeded liveries in both directions
- RISK night shows: standalone fireworks recur independently of the rare cooldown and stay bounded
- RISK night shows: festival odds are lower than standalone fireworks with finite visits and rate controls
- RISK night shows: festivals keep a thirty-minute cooldown while fireworks stay independent
- RISK night shows: launches lead to bounded fading bursts and the festival sails fully on and off screen
- RISK festival barge: hull, stage, and crowd follow the cruise-vessel scale
- RISK festival barge: scaled deck fireworks remain visible in the shallow short-screen lake
- RISK festival barge: shell launches follow the moving deck and fireworks have varied ballistic trails
- RISK landscape banners: the longest human airplane prompt fits measured fabric in both directions
- RISK skyline materials: short buildings favor brick while tall towers favor stable modern colors
- RISK skyline lights: only exposed windows can be selected so both on and off are visible
- RISK skyline lights: garden roofs start independently, stay stable, and change slowly at night
- RISK skyline lights: each garden has a one-in-six state through independent resamples
- RISK night shows: festival and standalone sparks enter the shared mirror before foreground hills
- RISK Landscape browser: both night shows reflect actual sparks and exposed windows visibly switch on and off
- RISK fireworks realism: uneven blooms leave ballistic trails and fading embers

## Retained sync diagnostics

- RISK SYNC ERROR LOG: backend failures remain under Settings diagnostics after recovery and reload
- RISK SYNC ERROR LOG: history rejects unsafe or malformed diagnostic fields
- RISK SYNC ERROR LOG: denied diagnostic storage and a throwing recorder cannot interrupt sync or board saves
- RISK SYNC ERROR LOG: reconciliation errors record once and update an open Settings log without replacing drafts
- RISK SYNC ERROR LOG: each code logs once per ten minutes and entries expire at one hour without resetting on repeats

- RISK SYNC ERROR LOG: older tabs retain newer diagnostics and share the ten-minute suppression window

- RISK SYNC ERROR LOG: concurrent tab writes converge without loss or same-code duplicates
- RISK CLOUD LATENCY: ordinary edits retain the two-second debounce and stay dirty until server acknowledgement
- RISK CLOUD LATENCY: confirmed writes do not wait seconds for optional timestamp metadata
- RISK SYNC ERROR LOG: queued storage events retain an error after its originating tab closes
- RISK CLOUD LATENCY: snapshot reads overlap while validation and account cancellation remain mandatory
- RISK CLOUD LATENCY: fresh uploads omit the empty resume query but resumed uploads still verify existing chunks
- RISK SYNC ERROR ICON: the small thundercloud appears only beside a current error

## Installed PWA wake and sync recovery

- RISK PWA SYNC RESUME: sleeping requests cancel promptly and cannot report a stale timeout or acknowledgement
- RISK PWA SYNC RESUME: cloud authority requires server reads and never an offline cache miss
- RISK PWA SYNC RESUME: reopening drains interrupted reads and writes before one fresh reconciliation
- RISK PWA SYNC RESUME: restoration preserves editor drafts and sign-out while asleep
- RISK PWA SYNC RESUME: visibility before pageshow shares one reconnect and genuine reconnect failures stay bounded
- RISK PWA SYNC RESUME: a publication committed during sleep is read back without a duplicate write
- RISK PWA SYNC RESUME: a timed-out reconnect cannot poison later online or wake recovery

## Rain, roof lights, and fireworks depth

- RISK rain intensity: day and night double velocity halve opacity and only night doubles seeded density
- RISK rain density: phone tablet and short screens retain a dense bounded curtain in either motion mode
- RISK fairy lights: unlit patio strings and every daylight bulb are hidden on phone and desktop
- RISK fairy lights: gardens and patios share independent stable one-in-six roof samples
- RISK fireworks duration: each standalone show caps visibility at one minute while retaining its sampled rest schedule
- RISK fireworks duration: repeated bursts fill the capped show with bounded particles and a complete final fade
- RISK fireworks layering: city silhouettes mask random shows while barge shells remain foreground
- RISK scenery browser: phone fairy lights rain and both firework depths match their actual canvas pixels
- RISK rain reflection: removing mirrored rainfall preserves snow and the distant lightning bolt

## Open-device scan updates and tablet editor dates

- RISK live scan sync: candidate Done publishes promptly and reaches another open device without focus
- RISK live scan sync: done adding for now shares the existing work mode and survives reload and reconnect
- RISK live scan sync: revision hints wake canonical reads without trusting foreign duplicate or malformed notifications
- RISK live scan sync: a form draft defers live adoption then receives completion when editing ends
- RISK live scan sync: an in-progress click survives a remote pause and its completion is retained through the conflict
- RISK live scan sync: stale Done comparison and pause controls never act on replacement tasks
- RISK live scan sync: duplicate Done and held keyboard repeats cannot complete another task or duplicate an evergreen session
- RISK live scan sync: evergreen Done Undo propagates once and stale concurrent writes preserve its cancellation
- RISK live scan sync backend: only server-confirmed root revisions notify and listeners follow account and visibility lifetimes
- RISK live scan sync backend: a listener error stays bounded and reopens through ordinary recovery
- RISK live scan sync: an editor opened after a queued revision still drains that revision on close
- RISK live scan sync: the second physical click of one double-click cannot complete the newly rendered candidate
- RISK live scan sync: Settings describes live revision refresh while retaining draft protection

## Open-device scan updates and tablet editor dates

- RISK tablet date fields: empty native editor dates have usable width outside the phone breakpoint
- RISK tablet date fields browser: empty filled and focused dates remain touchable with unclipped neighboring controls

## Multiple dependencies and Chance display

- RISK multiple dependencies: ten links require every prerequisite while completion deletion and Undo retain their rules
- RISK multiple dependencies: old single links migrate and legacy edits preserve the other selected dependencies
- RISK multiple dependencies: concurrent additions removals repeated readds and replacement Undo reconcile causally
- RISK multiple dependencies: concurrent capacity conflicts retain the canonical ten and causal removal evidence
- RISK multiple dependencies: direct indirect and overlapping cycles warn but completed cycles and large acyclic graphs do not
- RISK multiple dependencies: progressive Add and Edit controls cap at ten preserve drafts and reset on cancel or save
- RISK multiple dependencies: pasted tasks retain all selected links and All Tasks names only unresolved blockers safely
- RISK multiple dependencies sync: simultaneous edits converge and offline reload reconnect keeps Done and pause behavior
- RISK overall Chance shares: full eligible weights retain scanned and chained tasks without changing order ratings or seed
- RISK Chance labels: exact numerical fallback and tiny positive candidates stay distinct while excluded tasks show zero
- RISK Chance labels: new task defaults normally draw but extreme TrueSkill tails have no positive guarantee
- RISK multiple dependencies FAQ: extended help explains progressive links saved cycles live sync and scoped Chance labels
- RISK multiple dependencies layout: long blockers wrap within their row and dependency selects keep touchable widths
- RISK multiple dependencies: Undo restores a deleted task link as intent without reviving it from stale copies
- RISK Chance labels: disabled presentation flags retain their hidden summaries and matching FAQ language
- RISK overall Chance shares: the age-first explanation retains its global percentage before and after dotting

## Backup age, night shows, and legacy dependency compatibility

- RISK fairy light poles: only a selected nighttime string paints its supports through day and spawn transitions
- RISK backup age styling: Delete turns destructive strictly after seven elapsed days for either storage source without changing bytes
- RISK fireworks occurrence: standalone sampled starts are exactly four times the original interval while duration odds budgets and festival timing stay intact
- RISK fireworks density and finale: paired regular shells lead to eight visible finale shells within a fixed budget and natural fade
- RISK product FAQ: backup age fireworks and resting remote completions match the shipped controls
- RISK multiple dependencies legacy publications: distinct accepted edits survive an unobserved removal and repeated reads stay idempotent
- RISK multiple dependencies legacy publications: cloud conversion uses the accepted server revision rather than local revision or clocks
- RISK multiple dependencies legacy mirrors: saved self short and long cycles survive actual supported hydrate and unrelated edits
- RISK multiple dependencies legacy mirrors: exposed removals and hidden first-link replacement preserve the other nine selections
- RISK multiple dependencies legacy mirrors: merge replacement Undo Restore and every persistence projection retain causal graph bytes

## Evergreen remote completion and scanner membership

- RISK evergreen scan reconciliation: merged completion removes resting crumbs tails and candidates without losing evidence
- RISK evergreen scan reconciliation: a newer stale cloud chain cannot revive another browsers completed task
- RISK evergreen scan reconciliation: held editor and pointer delay resting chain adoption then stale benchmark controls stay inert
- RISK evergreen scan reconciliation: cooldown expiry day reset and explicit return preserve eligible and unrelated chain membership
- RISK evergreen scan reconciliation: offline cold reload clears legacy resting dots and Undo retains completion history
- RISK evergreen scan reconciliation: a delayed stale read and later revision converge without restoring completed membership

## Backup age, night shows, and legacy dependency compatibility

- RISK Chance labels: an empty-chain preview excludes positive tails that overflow for every possible saved hash

## Backup age, night shows, and legacy dependency compatibility

- RISK multiple dependencies legacy mirrors: repeated identical cycle merges report no recovered data while real removals remain changes
- RISK multiple dependencies legacy mirrors: local and IndexedDB saves retain cycle warnings without false recovery messages

## Overall Chance share presentation

- RISK overall Chance shares: current ratings and genuine eligibility update shares while the saved pass remains frozen
- RISK overall Chance shares: normalizable totals rounding and all-zero or empty eligible sets stay finite and read-only
- RISK overall Chance shares: saved-pass fallback remains explicit when live global ratings differ from frozen weights
- RISK overall Chance shares FAQ: full-pool percentages explain position independence current ratings and deterministic first dots
- RISK overall Chance shares: an empty chain ignores stale pass fallback and keeps the age-first global share
- RISK overall Chance list order: full-pool percentages descend without changing saved pass scan order ratings or filtered scope
- RISK overall Chance list order: equal shares retain existing top-K mean and stable insertion ties
- RISK overall Chance list order: tiny positive shares precede descending fallback then genuine ineligible rows without changing filters
- RISK overall Chance list order FAQ: overall shares explain highest-first rows stable ties fallback and unchanged descending mode

## Shared scenery and independent list presentation

- RISK shared scenery: the same seed and UTC instant select identical events after different open frame and interruption histories
- RISK shared scenery: normalized clouds and bounded schedules survive midnight viewport season and reduced motion changes
- RISK shared scenery: deterministic opportunities preserve rail rare-show refractory periods and finite complete lifetimes
- RISK rain cloud consistency: every drifting cloud uses the shaded rain contour while clear daytime clouds retain their paint
- RISK shared scene time: numeric locks and selected seasons use the synced sky zone rather than the device zone
- RISK shared scenery runtime: every scene owner consumes the UTC snapshot without random frame draws or board writes
- RISK dotted list filter: dot undot Done evergreen and dependencies classify rows without changing scanner eligibility or Chance shares
- RISK dotted list filter: a remote chain update changes visible classification and counts without changing the board
- RISK list metric preference: Top x is the stable default and Settings switches display and ordering without changing scan algorithms
- RISK list metric preference: reload old payload and remote settings reconciliation retain the chosen metric and task data
- RISK scene and list FAQ: shared UTC scenery rain style and independent list presentation explain current behavior
- RISK shared scenery lights: one-minute independent roof samples remain stable between opportunities in normalized space
- RISK shared scenery browser: isolated Chrome and WebKit devices reconstruct UTC objects and rain paint through reload resize and reduced motion
- RISK list presentation browser: Top x default percent toggle dotted filters and reload work on actual phone tablet and desktop controls
- RISK eligibility: boundary
- RISK replacement: preserve feature
- RISK landscape colors: dawn hue stays warm

- RISK list metric preference: supported older clients preserve the unknown choice and offline completion Undo keeps it intact

- RISK shared scenery reduced motion: the ambient timer repaints isolated woodland arrival and expiry at the current UTC instant

## Context exclusions and Settings layout

- RISK context exclusions: real selectors switch included excluded with durable Undo and explicit red precedence
- RISK context exclusions: scan and All Tasks preserve all required contexts dotted classification and full-pool shares
- RISK No context filter: binary synthetic control never becomes an assignment and tracks rename deletion and unknown IDs
- RISK context saved data: absent invalid and released settings preserve assignments exclusions unknown fields and completion Undo
- RISK context sync: concurrent clients offline reload reconnect and remote completion preserve revisioned filters and recovery
- RISK Settings hierarchy: moved Changelog leaves Save settings after every section without changing validation
- RISK context and Settings FAQ: extended guidance explains cycle empty selections synthetic scope sync limitations and bottom save
- RISK context and Settings browser: touch keyboard filter counts disclosure scrolling and saved controls work on Chrome and WebKit
- RISK context offline browser: installed shell reload retains exclusions settings tasks and completion Undo through reconnect
- RISK context rendering: an imported empty context ID retains its real selector state and unknown fields in Settings
- RISK context marker browser: green checks and red exclusions retain readable symbols in both themes
## Task rating observations and preservation

- RISK task rating history: Undo keeps the latest observation head so restored relative values are observed on the next Save


## Scanner lifecycle repairs

Resting completion cannot teach a discarded Dot, first Start uses current eligibility, and adopted Chance repairs save before conditional publication. Both modes retain the neutral oldest never-done first dot and accepted manual Dot signals.

- RISK scan lifecycle: resting evergreen Dot is absent and stale controls cannot mutate ratings edits or Undo
- RISK scan lifecycle: Return before Dot and expired rests retain chosen pair learning manual overrides and one-gesture Undo
- RISK scan lifecycle: interval edits that revive an evergreen rest save once without a discarded Dot comparison
- RISK scan lifecycle: first Start reconciles timed holds at their exact boundary in both modes without teaching rank
- RISK scan lifecycle: first Start sweeps stale day marks and evergreen rest while retaining oldest never-done priority
- RISK scan lifecycle sync: repaired old remote Chance draw is durable across all stores and offline reload
- RISK scan lifecycle sync: concurrent old-pass repairs converge by revision without replaying ratings or Done
- RISK scan lifecycle sync: failed local repair persistence holds adoption and a newer cloud revision cannot be overwritten
- RISK scan lifecycle FAQ: Dot rest boundary current Start eligibility and durable remote refresh are explained

- RISK task rating history: actual comparisons retain timestamped before and after values without backfilling or changing signals
- RISK task action history: scanner comparison stays visible through Undo and saved reload
- RISK task action history: editor gestures keep edits and outcomes within one Undo
- RISK task rating history: editor observations distinguish relative movement and never write on open render or resampling
- RISK task rating history: No Dot Dislodge completion and Undo retain honest rating versus pool changes
- RISK task rating history: concurrent offline and older missing-field copies union immutable facts idempotently without retimestamping
- RISK task rating history: legacy import restore export deletion and unknown future facts preserve recorded evidence
- RISK task rating history: device reload and chunked Unicode exports retain all observations without silent retention limits
- RISK task rating history: Edit shows accessible timestamped observations and honest metric and retention explanations

- RISK task rating history: malformed and future records remain recoverable without blocking actions or injecting markup
- RISK task rating history: real cloud glue preserves offline concurrent events replay old writes and completion Undo across reload

- RISK task rating history browser: phone tablet and desktop disclosures pagination drafts and offline Undo preserve actual observations

- RISK task rating history: Undo records evergreen interval and day-reset eligibility reversals without changing MMR

- RISK task rating history: a Dot interval edit that renews rest records saved eligibility without inventing a comparison

- RISK task rating history: immutable fact union and observation fingerprints are independent of device locale

- RISK empty-chain explanation: selected Chance and Descending views name only their mode and preserve first-dot age rules

- RISK scenery browser fixture: conditional reloads retain executable probes and late sky refresh cannot change the controlled background
- RISK scenery rain preservation fixture: one accepted backdrop survives exact weather comparisons and detects a mutated backdrop
- RISK scenery reload diagnostics: missing probes retain navigation errors delivery and bootstrap state without replacing the original timeout and capture actual browser events

## Migrated backup deletion safety

- RISK backup mirror deletion: one confirmation removes exact migrated mirrors with reordered metadata and packed legacy neighbors
- RISK backup mirror identity: divergent payload kinds dates and unknown metadata remain separate and fail closed
- RISK backup mirror duplicates: identical same-source IDs stay ambiguous rather than coalescing into a deletable row
- RISK backup mirror confirmation: cancel stale Settings and confirmation-time rewrites preserve both copies
- RISK backup mirror concurrent deletion: fresh durable metadata and concurrent legacy appends are rechecked inside the delete transaction
- RISK backup mirror storage failure: quota rejection and IndexedDB abort preserve recoverability and allow an explicit retry
- RISK device backup final guard: rejected throwing and asynchronous guards abort before deleting a verified reference
- RISK backup mirror FAQ: confirmed matching-copy deletion and ambiguous recovery preserve the seven-day age cue

- `RISK fireworks pair delay: seeded second launches span zero to three hundred milliseconds without shifting first shells or finale` — deterministic per-pair stagger and responsive ignition preservation.
- `RISK fireworks frequency again: released scale two becomes four in live UTC scheduling and legacy advancement` — repeat frequency reduction and midnight reservations.
- `RISK fireworks ascent paint: only the launch trail glows while explosion particle paint stays identical` — trail-only ascent and unchanged bloom tip rendering.

## Automatic legacy backup expiry

- RISK legacy automatic expiry: a successful save rotates both active stores by seven local calendar days and preserves exact neighbor bytes
- RISK legacy automatic expiry safety: manual recovery unknown unreadable malformed ambiguous and pinned copies survive rotation
- RISK legacy automatic expiry races: peer index appends and a newer pinned durable head defer cleanup until a fresh successful save
- RISK legacy automatic expiry failures: failed primary commits and quota-refused cleanup keep recovery bytes and a later save retries
- RISK legacy automatic expiry guard: final transaction abort compensates only unchanged index bytes and never replaces a peer append
- RISK device current-head guard: stale heads non-synchronous approvals and queued peers cannot authorize legacy retirement
- RISK legacy automatic expiry lifecycle: a draft arriving during cleanup is saved and completion Undo manual restore and offline reload retain facts
- RISK legacy automatic expiry FAQ: save rotation permanently removes expired upgrade copies while safety exceptions and Settings age cues remain clear

## Squared Weighting

- `RISK Squared Weighting: exact percentage math full precision and frozen quadratic ordering` — quadratic math, saved mode and preserved eligibility/data contracts.
- `RISK Squared Weighting saved mode: settings hydration reload eligibility and first dot retain existing protections` — quadratic math, saved mode and preserved eligibility/data contracts.
- `RISK fresh Halving default: new clients use Halving while legacy normalization and saved choices survive` — quadratic math, saved mode and preserved eligibility/data contracts.
- `RISK Squared Weighting migration: old default moves once nondefault and later explicit Chance survive reload import and sync payload` — quadratic math, saved mode and preserved eligibility/data contracts.
- `RISK Squared Weighting numerical pools: tiny weights normalize without all-zero underflow and ineligible tasks stay zero` — quadratic math, saved mode and preserved eligibility/data contracts.
- `RISK Squared Weighting migration durability: old default is marked for device/cloud repair and later Chance is not` — quadratic math, saved mode and preserved eligibility/data contracts.
- `RISK Squared Weighting preserves original Chance: frozen ordering and recorded model likelihood stay proportional to raw weights` — quadratic math, saved mode and preserved eligibility/data contracts.
- `RISK Squared Weighting sync: explicit old mode survives concurrent clients offline reload reconnect completion and Undo` — quadratic math, saved mode and preserved eligibility/data contracts.
- `RISK Squared Weighting joins: newly eligible tasks share one frozen scale regardless of input ordering` — joined tasks use one common scale and rendering remains read-only.

- `RISK Squared Weighting consumer transitions: actual Settings change and Save clicks switch modes without changing ratings or pass marks` — real consumer transitions, equivalent controls, preservation and isolated negative controls.
- `RISK Squared Weighting consumer buttons: rendered Start and Resume modes reach the click dispatcher and preserve resumed seeds` — real consumer transitions, equivalent controls, preservation and isolated negative controls.
- `RISK Squared Weighting consumer import: actual JSON import click migrates old default once and preserves later explicit Chance` — real consumer transitions, equivalent controls, preservation and isolated negative controls.

- RISK held decision keys: Yes No and Cant repeats cannot judge or skip replacement candidates while fresh presses still work
- RISK held decision keys FAQ: keyboard guidance names one fresh keypress per Yes No or Cant decision

- RISK Squared Weighting held keys: real keyboard repeats preserve the newly dealt candidate while fresh presses and Undo still work
- `RISK context editor visibility: real contexts govern requirements and filters without mutating assignments` — empty/one/multiple/deleted contexts; creation entrypoint and sentinel preservation.
- `RISK task edit section dividers: semantic rules separate requirements ratings and actions` — semantic separators and responsive theme color/spacing contract.

- `RISK Edit evergreen unit default: mounted Hours to Days suggests seven then saves and reopens weekly` — registered change handler, repeated toggles, draft isolation and save/reopen.
- `RISK Edit evergreen unit preservation: explicit drafts custom intervals and Cancel keep their values` — explicit values, eighteen-day custom interval and canceled draft protection.

- `RISK All Tasks duration formatting: rendered Cant badges cross sixty minutes without changing other time rules or saved values` — actual consumer minute boundaries and unchanged Worked/evergreen roundings.
- `RISK All Tasks duration wrapping: badges include their padding in the available column and preserve readable title width` — bounded badge box model and existing title-width contract.
- `RISK All Tasks duration browser: long titles tags and hour-minute badges fit narrow enlarged text columns` — isolated WebKit/Chrome phone/tablet/desktop enlarged text geometry and actual duration rendering.

- `RISK UI batch integration: saved Squared board retains context selector editor defaults duration badges and exact shell delivery` — released-mode offline reopen, Edit draft/All Tasks consumers and integrated PWA fingerprint.

- RISK fireworks minute cap: standalone tails finish within sixty seconds and barge tails follow crossing
- RISK fireworks minute schedule: capped visible events preserve seeded opportunity spacing and UTC late join reload across midnight
- RISK fireworks pair endpoints: zero and maximum seeded samples bound regular pairs without delaying eight finale lanes

- RISK fireworks natural tails: final embers retain their complete formula lifetime
- RISK fireworks reservations: shortening visibility preserves historical visitors and current seeded rail admissions

- RISK fireworks legacy reservations: invisible remainder keeps old festival random draws and admission budgets

- RISK fireworks reduced motion: static blooms stay on the stationary barge throughout its crossing

- RISK fireworks reduced deadline: static scheduler preserves a persistent barge bloom across sixty seconds without animated repaints

- RISK fireworks cached guidance: installed spawn-rate prose matches the bounded display and its exact offline shell

- `RISK Chance fixture wake: actual scheduled scanner callback handles probability fixture schema` — Probability fixtures supply empty context arrays and titles so the real bootstrap-registered scanner wake can render them at the daily boundary. Preserves frozen weight assertions and leaves production timer and Chance algorithms unchanged. RED: `/tmp/chain-ui-runtime/chance-fixture-repair-red.log`; focused cohort: five passed, zero skipped.

- RISK visitor gait: eased arrivals and departures plant terrain feet with connected knees in both directions
- RISK visitor carrying consumer: rendered books and picnic items meet the carrying hand while feet consume the travel pose
- RISK visitor motion guidance: extended scenery FAQ and Settings changelog explain travel cadence and held items
- RISK visitor offline shell: travel pose and carrying renderer changes reach the fingerprinted installed shell
- RISK visitor departure continuity: settled feet and hands do not pop when eased travel starts
- RISK visitor gathering continuity: the actual consumer reaches the grip before a carried item appears
- RISK winter walking: departures consume scaled traveled-distance terrain feet instead of a wall-clock leg wave
- RISK woodland stride: actual scaled animal paint holds stance paws on its clearing in both directions
- RISK walking contact transitions: foot swing meets planted stance with continuous velocity and zero lift slope
- RISK walker anatomy consumer: ordinary and dog walkers use connected knees while keeping mirrored feet and leash attached
- RISK kite grip consumer: gathering and reverse travel keep the string at the actual rendered hand
- RISK motion review harness: frozen actual actor painters reconstruct repeatable before-after sequences across direction viewport and reduced motion
- RISK walking scope guidance: extended FAQ and changelog describe walker winter woodland and held-line improvements
- RISK motion harness controls: nonfinite actual painter commands are rejected and foreground deer use their real travel anchor

- RISK snowangel departing shadow: actual winter painter follows the standing person and preserves the fixed imprint

## Independent date clear controls
- RISK date clear controls: Add and Edit clear independently through actions with cancel save and durable reopen
- RISK date clear accessibility: native labeled buttons accompany all date fields with bounded touch targets
- RISK date clear persistence: pasted Add dates and offline concurrent sync retain the other date and task data
- RISK date clear tablet geometry: Edit wrapper overrides generic date minimum to reserve the Clear target
- RISK date clear rendered geometry: native date segments remain readable beside Clear and long Starts hints at larger text
- RISK changelog dates: direct FAQ notes combine repeated dates in descending order without losing history categories or links
- RISK date clear availability: empty Add and Edit controls disable independently through typing clearing resets and reopening
- RISK date clear programmatic values: direct assignments stay synchronized without events and preserve unrelated drafts
- RISK date clear guidance: Quick start explains disabled empty date controls and retained save semantics

## Stale-tab reconciliation

- RISK cloud No recovery: five scanner decisions survive offline durable reopen beside an independent peer edit
- RISK STALE TAB: CAS repair preserves newer fields and independent edits through an awaiting third action
- RISK STALE TAB: browser rebase keeps disjoint fields but newer conflicts and deletions win
- RISK STALE TAB: cloud adoption does not replace edits made while its safety backup awaits
- RISK STALE TAB: cloud rebase retains independent edits against an observed revision
- RISK STALE TAB: a settings action during CAS repair survives without reviving peer fields
- RISK STALE TAB: failed cloud adoption save keeps an edit arriving during persistence
- RISK STALE TAB: failed matching-cloud revision save cannot roll back a later gesture
- RISK STALE TAB: rating and context actions during CAS repair retain their complete effects
- RISK STALE TAB: legacy coexistence retains independent live fields before durable reconciliation
- RISK STALE TAB: recovery guidance explains independent edits conflicts and unobserved cloud bases
- RISK STALE TAB: rebasing never combines cached Chance data from different passes
- RISK STALE TAB: a conflicting edit during awaited CAS repair retains its exact recovery bytes

## Decision-preserving cloud learning
- RISK comparison replay: independent Yes and Dot evidence survives either cloud publication order and a fresh client
- RISK comparison replay: repeated same-pair Yes and No actions remain distinct and replay once by original action order
- RISK comparison replay: first supported action freezes learned legacy ratings without replaying observational history
- RISK comparison replay: deleting an opponent keeps its frozen rating available without resurrecting the task
- RISK comparison replay: compatible new-task baseline extensions union without freezing branch-local posteriors
- RISK comparison replay: compatible frozen learning survives different legacy pass-context baseline IDs

- `RISK dependency picker search: Add and Edit input filtering preserves hidden selections and excludes completed ordinary choices` — native dependency filtering and retained saved links.

- `RISK dependency picker input identity: search updates choices without replacing the focused search or its composition` — stable native input identity during filtering.

- `RISK Add draft color: all task data controls turn Add green and clearing restores grey without changing validity` — draft appearance across all task-data controls.
- `RISK Add draft color: search navigation repeated keyboard adds sticky contexts and failure retention follow actual handlers` — submission/reset and rejected-action retention.

- `RISK Add draft durable reset: failed device save retains draft and retry does not duplicate accepted tasks` — actual device rejection/retry preserves input and task membership.
- `RISK Add draft durable reset: pending repeated Add and newer edits or reset survive an awaiting save` — submission confirmation remains bound to draft and account.
- `RISK Add draft durable reset: multiline paste preserves failed capture and saves retained tasks on retry` — bulk capture uses the same durable reset gate.

- Dependency search typography uses shared text-input styling; narrow normal/enlarged Add/Edit native rendering and actual Chrome font identity: `RISK dependency search styling: Add and Edit share text input typography borders and spacing`; `RISK dependency search rendered styling: Add and Edit resolved fonts borders spacing and enlarged sizing match text controls`.

- Dependency rendered fixture rejects empty style initialization and verifies the app’s actual theme after startup: `RISK dependency rendered runner: style initialization is nonempty and dark samples apply and verify the real theme`.

## Halving weighting ranking and saved preferences

- RISK Halving weighting distribution: exact finite tails boundaries ties and large pools
- RISK Halving weighting consumer state: selector legacy preference filtering no replacement Undo and reload
- RISK Halving weighting pass: suffixes remain reproducible across input order joins resume and day boundaries
- RISK Halving weighting stale tab: offline mode change survives peer deletion and reload without restoring a deleted task
- RISK Halving weighting displayed likelihood: actual list and editor distinguish underlying Chance shares from positional draws
- RISK Halving weighting concurrent joins: same-pass frozen likelihood ranks survive peer adoption and reload without mixing generations
- RISK Halving weighting likelihood sorting: current underlying shares ignore obsolete Chance pass fallback
- RISK Halving weighting likelihood estimate: uncertainty-sensitive existing Chance scores define frozen positional order
- RISK Halving weighting open Settings: mode transitions refresh the likelihood label and retire the legacy chooser without losing drafts
- RISK Halving weighting enlarged metric: real Settings transition keeps a compact label and wrapping underlying likelihood explanation

## Last task WOOP, dependency filter, and independent FAQ release review

- RISK Last task WOOP: exhausted scan reaches walkthrough through real Start and Dislodge handlers

- RISK Last task WOOP: mounted preference and final paused boundary use unique recorded dislodgements
- RISK Last task WOOP: walkthrough saves escaped outcome obstacle plan to bound task and revisits deletes reloads
- RISK Last task WOOP: cancel empty repeated stale interrupted and peer-plan actions never mutate replacement tasks
- RISK Last task WOOP: atomic stale-tab rebase preserves newer fields peer plans and deletion tombstones
- RISK Last task WOOP: causal plan evidence defeats old-client-carried plans and deliberate Undo records successor
- RISK Last task WOOP: real stale-tab saves preserve newer title plan and deletion plus offline reload
- RISK Last task WOOP: cloud offline failed pull reconnect completion and Undo retain task-owned causal plan
- RISK Last task WOOP: unsupported data survives reload and replacement and interrupted board ownership blocks save
- RISK dependency filter placement: mounted Add and Edit put Filter dependencies after choices and before Evergreen
- RISK repository process: FAQ coverage needs a distinct exact-candidate reviewer and bound evidence
- RISK FAQ sections: mounted Quick start matches Settings groups and covers WOOP lifecycle and dependency filter
- RISK Last task WOOP: future conflicting and cyclic operation evidence is preserved read-only
- RISK Last task WOOP: rendered Delete binding rejects same-ID board replacement and restored head
- RISK repository process: FAQ policy rejects legacy verified receipts and old deployment descriptions
- RISK repository process: Pages FAQ policy reads exact head and base from a full release-evidence checkout
- RISK Last task WOOP: Restore and Undo express deliberate successors without deleting later independent tasks
- RISK Last task WOOP: delayed CAS repair keeps newer peer plan and title plus concurrent local intent
- RISK Last task WOOP: imported long causal chains validate without recursive stack failure
- RISK Last task WOOP browser: mounted controls responsive saved revisit delete and offline reload

- RISK repository process: deployment fetches deleted squash PR head and rejects ref identity mismatch

## Upright walking and carrying

- RISK upright human gait: full cycles extend stance knees with modest swing flexion and preserved terrain contact
- RISK upright gait guidance: scenery FAQ and changelog explain upright support and carrying without changing task controls
- RISK upright torso travel: flat-ground pelvis travels steadily while terrain adaptation stays continuous
- RISK upright pelvis consumer: torso head thighs and carrying arms follow the terrain hip
- RISK upright gait consumer: every human painter consumes upright full cycles in both directions at responsive scales
- RISK upright settled visitors: arrival endpoint rests both feet on terrain before eased departure

- RISK human support balance: rejected steep phone walks keep the vertical torso over a usable planted support

- RISK human terrain cadence: local contact spacing preserves world planting and deterministic arrivals

- RISK local human cadence: recorded phone flat controls do not inherit a distant steep hill stride
- RISK human route isolation: different terrain functions cannot share a sampled-profile contact cache
- RISK human support transfer: recorded steep phone frames avoid the rejected abrupt pelvis bob
- RISK whole human transfer: both ordered rendered phone traversals bound pelvis bob throughout each cycle
- RISK running seek isolation: future route queries cannot revise fast departure contacts
- RISK actual human pose observer: native consumer traces preserve painter commands and returned poses
- RISK carrying locomotion: actual fast departure painters avoid aliased walking cadence and preserve every limb and grip
- RISK terrain locomotion: actual steep phone walkers keep a human contact rhythm without slowing their route
- RISK dense human contact corridor: final blended pelvis and limbs remain feasible at contact and window seams
- RISK human grip endpoints: complete carrying retains its exact hip offset across every cadence

- RISK carrying recovery: rejected actual phone sequence requires strikes opposed swing and a coherent flight arc
- RISK carrying isolation: immutable accepted renderer commands stay exact outside requested walker pace and kite fabric changes

- RISK carrying continuity: stable actor capability preserves resting grip transitions and deterministic departure seeks

- RISK per-edge dependency controls: Add and Edit binary checkbox transitions persist hard and soft without losing search selections
- RISK per-edge dependency semantics: mixed edges intrinsic eligibility deletion Undo and cyclic chains remain bounded
- RISK per-edge dependency sync: explicit modes survive stale clients while Undo Restore and readd express fresh intent
- RISK per-edge dependency eligibility: search pass marks contexts dates and evergreen expiry use the same bounded rule

- RISK per-edge dependency future evidence: untouched editor preserves opaque choices and conflicting identity is deterministic
- RISK per-edge dependency real saves: stale tabs keep peer title explicit mode offline reload and completion Undo
- RISK per-edge dependency opaque map: unsupported top-level mode data is retained by writes and merges

- RISK per-edge dependency recovery: future recovery shape remains safe through merges and unsupported controls

- RISK per-edge dependency rendered controls: phone enlarged tablet desktop labels keyboard search and saved rules fit real browsers

- RISK per-edge dependency released clients: real supported hydration preserves modes and single-link edits retain explicit choices

- RISK per-edge dependency recovery union: mode omission adoption and opaque conflicts retain both clients recovery evidence

- RISK per-edge dependency rendered isolation: fixtures disable production cloud before navigation and constrain external requests
- RISK per-edge dependency rendered controls:"),end=source.indexOf("test(

- RISK binary dependency migration: old links default soft without rewriting identity evidence and recurrence blocks again

- RISK scenery tuning: barge crossing lifetime restores historical finale without standalone cap regression
- RISK scenery tuning: doubled barge odds preserve interval cooldown duration and standalone frequency
- RISK scenery tuning: fairy activation doubles probability with unchanged sampling duration and daylight guard
- RISK scenery tuning: windows switch on half-length UTC ticks with unchanged seeded lit proportion

- RISK frozen header clearance: actual preference transition reserves responsive header geometry through resize and text growth
- RISK frozen header clearance browser: freeze unfreeze and responsive text retain document headroom
- RISK frozen header wrapping: enlarged controls fit without font changes or hiding Settings
## Fireworks sunrise and sunset eligibility

- RISK fireworks twilight: legacy fireworks admits dawn and dusk while excluding full daytime
- RISK fireworks twilight: UTC fireworks opportunities admit both twilight directions and reload exactly
- RISK fireworks twilight: actual fireworks painter keeps sunrise and sunset particles visible below daytime
- RISK fireworks twilight: legacy festival admits dawn and dusk while excluding full daytime
- RISK fireworks twilight: UTC festival opportunities admit both twilight directions and reload exactly
- RISK fireworks twilight: actual festival painter keeps sunrise and sunset particles visible below daytime
- RISK fireworks twilight: actual reduced-motion painter holds its pose across dawn and dusk and expires at the source lifetime

- RISK continuous daylight: the actual observer local day classifies 65.8 N midnight as day
- RISK continuous daylight: both hemispheres use solar events around the former 66 degree cutoff
- RISK continuous daylight consumers: the real timeline and show painters suppress the 65.8 N boundary

- RISK fireworks polar day: real Arctic midnight remains excluded in solar sampling legacy admission and actual painting
- RISK fireworks polar UTC: real Arctic daylight never schedules either source across a complete day

- RISK fireworks twilight barge: actual hull stage and crowd remain visible with their fireworks through both twilight directions

- RISK fireworks twilight barge entry: actual depth-sorted vessel consumer preserves twilight hull and reflection

- RISK Landscape browser: public twilight scenery retains opaque physical barge hull in the final composite
- RISK fireworks physical vessel: twilight hull opacity follows the ordinary crossing pose

- RISK dependency form presentation: Add Edit explanation lives in FAQ and controls keep named protected binary choices
- RISK dependency form presentation: Hard heading follows active rows across selection removal filter reset and Edit reopen

- Quick start user guidance: `RISK Quick start content: essential steps stay brief and detailed help remains user-facing in existing sections`.

- Quick start chapters: `RISK Quick start chapters: mounted help includes Task history with native disclosures and detailed chapters closed`.

- Quick start compact disclosure headings: `RISK Quick start chapter layout: disclosure headings share the native summary line without extra margins`.

- RISK fireworks crescendo: finale emits distinct overlapping volleys and a wider closing crown
- RISK fireworks crescendo FAQ: scenery help explains widening finale and existing motion limits
- RISK continuous daylight FAQ: rendered help and release notes explain show exclusion

- RISK seeded trigger admissions: actual UTC rail consumer admits chance gaps with preserved mean and track capacity
- RISK seeded trigger windows: actual light consumer uses independent state draws and can retain state across opportunities
- RISK seeded trigger lightning: actual storm painter rejects strikes and preserves short bolts snow and reduced motion guards
- RISK seeded trigger skywriters: actual snapshot and painter preserve visibility across reading history and missing private copy
- RISK seeded trigger negative controls: bypassed actual admissions compulsory window parity and periodic bolts are detected
- RISK seeded trigger FAQ: extended help explains shared chance visits and history-independent skywriter visibility without private sync
- RISK seeded trigger precision: rail lifetime rounding cannot overlap at an exact successor millisecond
- RISK seeded trigger precision: chance window states retain the former fifty-percent long-run occupancy
- RISK seeded trigger cold copy: actual current-flight consumer adopts the loaded human bank without rereading or waiting for another event
- RISK seeded trigger reading preservation: actual word replacement and trusted observer do not inherit stale read flags

- RISK changelog editorial: public history omits internal housekeeping and routine frequency tuning

## Postpone deferral

- RISK Postpone: mounted scanner action defers without rating or task edits and expiry restores soft eligibility
- RISK Postpone: Settings validates custom hours preserves old values and final task resumes coherently
- RISK Postpone: causal sync preserves peer edits concurrent deferrals Undo deletion and old clients
- RISK Postpone: revisioned cloud offline reconnect prunes stale dots without losing concurrent editor fields
- RISK Postpone: unknown future deferral evidence is adopted archived and read-only through stale merge and Undo
- RISK Postpone: actual backup Restore completion Undo and pass resets retain deferral intent

- RISK Postpone: scan surfaces match neighboring decision button sizing without changing Edit
- RISK Postpone: day paint stays white and night paint matches Edit on both scanner surfaces

- RISK Postpone layout: mounted duration field uses the bounded numeric Settings width

- RISK Postpone layout: modal height preserves the viewport cap and fits the available backdrop

- RISK Postpone layout: Settings numeric fields contain intrinsic widths in narrow recurrence rows

## Cloud acknowledgement ordering

- RISK cloud self-echo: focus pull during own acknowledgement retains latest task edit without stale rejection

## Pedestrian walking routes

- RISK pedestrian natural exit: ordinary and dog walkers stay opaque until their whole party clears the viewport
- RISK pedestrian half pace: ordinary and dog walking translation uses half the prior local pace
- RISK pedestrian departure pace: carrying and winter people leave at a walking pace without a lifetime sprint
- RISK pedestrian scheduled lifetime: accepted walkers retain admission duration and survive until a full viewport exit
- RISK pedestrian companion pace: walking deer and woodland paws halve translation and distance together while hopping stays unchanged
- RISK pedestrian visual tail preservation: capacity skips only seeded opportunities while retaining their facts and independent scenery
- RISK pedestrian complete parties: scheduled walking routes clear both edges at bounded pace and paint without terminal fade
- RISK pedestrian reduced motion: static production poses keep walkers on screen and winter activities settled

- RISK pedestrian winter tail shadows: retired structures leave no ghost shadow while the walking person remains opaque

- RISK pedestrian production half pace: scheduled ordinary and dog walkers halve the actual prior trajectory at every sampled seed and frame rate
- RISK pedestrian reduced painter consumer: production-shaped static events use the same settled representative as the app

- RISK pedestrian concise help: natural exit guidance has a short adjacent FAQ without lengthening the existing scenery answer

- RISK task rating history: compact record disclosures retain dates and metrics with explanations in the FAQ

- RISK task history: Done stays a plain dated event while recorded metrics and missing prior values remain expandable

- RISK task history: comparison labels preserve initiating action without inventing historical participant roles

- FAQ menu naming: `RISK FAQs menu label: help navigation and named dialog use FAQs while retaining Quick start chapter`.

- `RISK motion safety: explicit local choices expire after seven elapsed days and corrupt records fail closed`
- `RISK motion safety: actual choice handler remembers selection while dismissal never writes consent`

- `RISK motion safety accessibility: enlarged prompt fits the containing viewport and stacks intrinsic choice cards`

- `RISK motion safety resume: foreground and restored pages reread expiry before painting without replacing visitors`

- RISK task history: compact Likelihood labels retain recorded values across metric boundaries

## Fresh-client scan defaults

- `RISK fresh Halving startup: successful empty stores choose Halving and actual Start persists it across reload` — verified-empty startup, legacy recovery, saved preference and cloud adoption boundaries.
- `RISK fresh Halving preservation: saved empty boards missing preferences supported modes and unknown settings are not fresh clients` — verified-empty startup, legacy recovery, saved preference and cloud adoption boundaries.
- `RISK fresh Halving cloud adoption: saved modes at zero newer and legacy revisions win over browser defaults without a settings write` — verified-empty startup, legacy recovery, saved preference and cloud adoption boundaries.
- `RISK fresh Halving copy: Settings and extended FAQ distinguish new-client defaults from saved board modes` — verified-empty startup, legacy recovery, saved preference and cloud adoption boundaries.
- `RISK fresh Halving recovery boundary: retained backup bytes protected heads and unavailable durable stores keep the legacy fallback` — verified-empty startup, legacy recovery, saved preference and cloud adoption boundaries.
- RISK walking rollback: terrain-driven loading preserves the prior upright silhouette and planted contacts

- RISK bulk task editing: displayed selection and opted fields preserve identity and reject stale conflicts
- RISK bulk task editing: blank fields do not delete and explicit clearing survives reload
- RISK bulk task editing: clearing is reversible in the draft and interval changes use the Evergreen reset rule
- RISK bulk task editing: filtered hidden deleted completed and replaced board selections cannot write
- RISK bulk task editing: stale tab save preserves peer fields and durable field conflicts through reload
- RISK bulk task editing: removed context options reject the whole batch rather than saving stale requirements
- RISK bulk task editing: offline two-task cloud conflict preserves fresh peer fields and reconnects without resurrection
- RISK bulk task editing: failed cloud publication retains local batch and retry acknowledges exact payload
- RISK bulk task editing: failed browser pair save retains in-memory batch and retry saves without partial task loss
- RISK bulk task editing: FAQ and editor qualify mixed Apply and later sync recovery limits
- RISK bulk task editing: concurrent recovery keeps backups and existing board Undo boundary explicit
- RISK bulk task editing: current batch result distinguishes partial reconciliation from sync success and offers no batch Undo
- RISK bulk task editing: logical and cloud owner changes reject the whole draft before mutation — Draft Save rejects changed board and signed-in owner before any batch field is written.
- RISK bulk result ownership: same-account Undo keeps the current-value summary across board replacement — Same-owner board replacement retains result scope while counts follow current values.
- RISK bulk account selection guidance: Help and Changelog explain account-switch clearing — Actual Help consumer covers the selection reset introduced by ticket 05.
- RISK bulk task editing: enlarged modal fieldsets shrink and native controls retain available width
- RISK bulk task guidance: bounded answers retain distinct selection property conflict Undo and result instructions
- RISK bulk task guidance: enlarged conflict answer uses breakable task status wording
- RISK bulk task guidance: enlarged FAQs changelog note uses short sync and Undo wording

- Scenery depth and lake capture: `RISK scenery depth: fountain participates in actual ground actor paint order`; `RISK scenery depth: nest bird sky and meadow passes paint each silhouette once`.

- RISK terrain walking cadence: steep production routes slow travel with reachable contacts across human variants
- RISK terrain walking approach: actual carrying arrivals preserve planted contacts on their full offscreen route
- RISK terrain walking guidance: extended FAQ explains terrain pacing capacity and saved-task preservation

- RISK terrain walking planner budget: flat canonical routes retain bounded analytic clock work

- RISK FAQs changelog reflow: actual archived notes retain readable tokens in narrow enlarged release lists

## Conditional binary context controls

- RISK binary context presentation: active filters derive excluded controls on both surfaces without changing saved choices
- RISK binary context interaction: real handlers include displayed exclusions immediately and preserve zero-active AND and No context rules
- RISK binary context saved data: reload and cloud adoption retain neutral choices and derive excluded presentation
- RISK binary context guidance: FAQ explains always two-state controls and unchanged zero-active matching

## Requested keyboard Undo and Edit shortcuts

- RISK Undo Z shortcut: real keyboard dispatch reverses only the latest action and retains durable Undo semantics
- RISK Undo Z guards: U is retired and modified editable modal and scene keypresses leave board and native defaults alone
- RISK Undo Z guidance: header hint tooltip and Quick start name Z while preserving editable native undo guidance
- RISK Edit E shortcut: real keyboard dispatch edits only the offered scanner task without changing the board
- RISK Edit E guards and hints: modifiers editable fields modal and scene focus do not dispatch and only the offered Edit advertises E
- RISK Edit E guidance: Quick start explains the offered task editor and plain shortcut scope
## Cloud cleanup interruption regression

- `RISK CLOUD CLEANUP RESUME: interrupted deleting generation resumes without forbidden transition and preserves acknowledged board`
- `RISK CLOUD CLEANUP GUIDANCE: sync FAQ distinguishes failed attempts from acknowledgement and explains resumable cleanup`

## Pedestrian in-scene entry continuity

- `RISK pedestrian entry: natural carrying and builder visits start opaque outside the frame and walk continuously to activity`
- `RISK pedestrian skier entry: scheduled skier walks in opaque before retaining the downhill run and existing exit`
- `RISK pedestrian skate entry: wide-frame riders do not fade while already visible`
- `RISK pedestrian entry contacts: actual carrying pose stays continuous across offscreen approach and settling boundaries`
- `RISK pedestrian entry guidance: FAQ distinguishes offscreen ongoing entries from current-scene reconstruction`
- `RISK pedestrian entry reconstruction: reload resize and seek retain selected visits without an invented startup delay`
- `RISK pedestrian ski transition: actual painted head moves continuously from carrying approach into the downhill pose`
- `RISK pedestrian builder transition: painted working hands settle continuously after walking arrival`
- `RISK pedestrian ski carry: approach skis intersect the actual carrying hand`
- `RISK pedestrian ski tracks: approach transition introduces track ink continuously without a full-length pop`

- `RISK pedestrian entry capacity: complete visitors retain fourteen admission reservations without eviction or seek-dependent admission`
- `RISK pedestrian capacity planner budget: cached daily scheduling evaluates each immutable proposal lifetime once`
- `RISK pedestrian capacity guidance: FAQ explains skipped crowded opportunities without changing underway visitors or saved tasks`

- `RISK pedestrian capacity liveness: a busy day admits visitors while retaining bounded reservations and complete recipes`
- `RISK pedestrian capacity day boundary: admitted visits finish within their shared day while short late visitors remain possible`
- RISK bulk toolbar: mounted controls stay outside scrolling rows and retain filtered selection through filter changes
- RISK bulk row selection: selected label replaces the existing rank slot and deselection restores its format
- RISK bulk toolbar keyboard: rerender restores the focused toolbar action and row toggle
- RISK All Tasks view ownership: account adoption clears prior selection while same-account Undo retains it
- RISK bulk toolbar guidance: extended FAQ describes frozen controls and rank-slot selection
- RISK repository process boundary: actual visual tests compare every changed control with neighboring controls and scrolled states

- RISK pedestrian ski preparation attachments: hat follows the painted head and poles stay in the painted grips throughout blending

- `RISK pedestrian planner cold work: full capacity skips unnecessary lifetime solving without changing admitted scenes or reseeks`

- `RISK pedestrian planner proposal work: rare admission reuses immutable day draws instead of generating the full day twice`
- `RISK pedestrian planner rare reuse: guard join is unique and complete admitted scenes match prior across rare rates midnight and eviction`

- `RISK pedestrian planner solar work: failed show chance draws do not request unused astronomy and exact scenes remain unchanged`
- `RISK context reconciliation FAQ: actual Help keeps each existing bulk and context question once`

- RISK context Settings reflow: actual manager name fields can shrink beside protected context and delete controls

- RISK always binary No Context: visible green and red dispatch immediately on both surfaces with Undo and zero-context guard
- RISK always binary saved contexts: reload and cloud adoption derive red real and green No Context without migration
- RISK always binary context guidance: FAQ explains context-presence rule and separate green No Context eligibility

- RISK always binary contexts: legacy neutral and all-excluded controls render green or red on both surfaces without saved writes
- RISK always binary context interactions: last-green and all-red clicks stay binary and Undo preserves assignments and AND eligibility

## Explicit overdue scanner WOOP

- RISK overdue WOOP: offered action dots through existing comparison and saves with Last task WOOP off
- RISK overdue WOOP: local due-day boundary stale eligibility and cancel retain the explicit dot
- RISK overdue WOOP: existing and legacy plans show explicit delete without silent replacement
- RISK overdue WOOP: peer plan account and same-ID board replacement invalidate drafts and controls
- RISK overdue WOOP: neutral automatic benchmark stays neutral and Cancel can Undo only the dot
- RISK overdue WOOP: unsupported plans remain read-only and interrupted scan hides the action


- RISK overdue scanner layout: enlarged candidate title chips and decision footer wrap without clipping choices
- RISK overdue scanner layout: chosen-task breadcrumb stays within the enlarged scanner width

- `RISK pedestrian planner timezone work: actual astronomical cold consumer validates a repeated observer zone once without changing its scene`
- `RISK sky observer validation reuse: bounded zone cache never bypasses mutable coordinates invalid zones or changed solar outputs`
- `RISK pedestrian planner hash work: complete cold proposals reuse immutable RNG prefixes while retaining every admitted scene`
- `RISK scenery random prefix reuse: draw sequence matches full public sampling for Unicode signed slots counters and mutable input fallback`
- `RISK FAQs changelog navigation: help dispatch exposes exact combined menu and all release notes without a Settings duplicate` — Combined help navigation, chapter and archive preservation, modal actions, and no saved-board writes.

- `RISK FAQ redundant changelog question: actual help consumer shows release history directly without a self-referential question` — Direct changelog chapter without redundant navigation prose; preserves release entries.

- `RISK Postpone return: mounted editor cancels active deferral with one Undo and preserves other eligibility rules across calendar days` — Early cancellation, eligibility preservation and causal saved hold boundaries.
- `RISK Postpone return: cancellation survives stale sync and reload while unobserved peer holds survive` — Early cancellation, eligibility preservation and causal saved hold boundaries.
- `RISK Postpone return: exact expiry and unknown recovery evidence do not enable postponed-only return` — Early cancellation, eligibility preservation and causal saved hold boundaries.

- `RISK Postponed filter: mounted tag combines search eligibility and filtered Select all without changing board data` — Active hold filtering, combined controls, exact expiry and read-only saved evidence.
- `RISK Postponed filter: scan-clock expiry removes matches at the deadline and clears an unavailable last filter` — Active hold filtering, combined controls, exact expiry and read-only saved evidence.
- `RISK Postponed filter: saved hold semantics preserve legacy opaque evidence and context namespace isolation` — Active hold filtering, combined controls, exact expiry and read-only saved evidence.

- `RISK selected rank geometry browser: enlarged labels stay inside their rank slot without changing selection row height with optional loaded fonts` — Actual full-size selection label containment, native keyboard/pointer actions, stable row geometry and read-only board state across text sizes and rank layouts.
- `RISK task context assignment paint: Add single Edit and Bulk Edit reuse All Tasks chips with native selection feedback` — Shared reference chip paint, native checkbox feedback and keyboard focus across task assignment entry points.
- `RISK task context assignment preservation: mixed bulk choices remain unchanged without Apply and editor opening never writes` — Native draft controls retain mixed/unchanged semantics and never write merely by opening an editor.
- `RISK task context theme paint: both themes retain resolved landscape reference across assignment and context filters` — Actual landscape reference theme pair shared by task context choices, preserving existing list palette and main include/exclude selector.
- `RISK task context contrast: selected small chip labels meet readable contrast in both themes` — Actual cascaded dark selected labels meet the4.5:1 small-text contrast threshold against the retained day/night pale green reference fills.
- `RISK task context wrapping: shared chips constrain long names across Add list and both editors` — Shared min/max width and unbroken-name wrapping prevent task-context overflow in every assignment surface and list filter without truncating names.
- `RISK task context keyboard paint: editor labels match the native focused reference chip shape` — Native checkbox focus paints the same4px radius and outline/offset as focused All Tasks and Add buttons.
- `RISK task context rerender focus: Add and All Tasks retain only their logical active chip during repeated toggles` — Replaced context/adjacent eligibility rows restore the previously active action/ID with scroll preservation, leaving unrelated inputs, bulk controls and deleted options alone.

- `RISK task context landscape cascade: editor labels share resolved All Tasks fill and ink without overriding its palette` — Selected labels and buttons share exact reference tokens and later landscape ink override; no private palette can replace released theme paint.
- `RISK task context imported empty ID: Add restores the existing logical chip without changing saved assignments` — Supported imported empty context IDs retain native Add focus across repeated selection, without modifying saved task requirements.
- `RISK task context wrapped alignment: shared editor and button chips center full captions inside their rounded fill` — Shared centered text prevents native editor wrapped captions from drifting outside the pill reference treatment while retaining full names and width wrapping.
- `RISK task context multiline corners: shared radius preserves the one-line pill and leaves wrapped glyphs inside the fill` — Half-lineheight plus established padding/border caps multiline corners while retaining the ordinary one-line pill silhouette and full captions across all chip surfaces.
- `RISK task context FAQ placement: bounded context-choice answer lives in Contexts without expanding the bulk property answer` — Context appearance/draft/keyboard guidance lives once in the existing chapter while all bulk answers retain independently readable130-word limits and Apply semantics.

- `RISK legacy context completion preservation: editor completion consumers retain unknown references through payload reload and Undo` — Mounted Done, Worked and Dot retain unknown context requirements through cloud payload, fresh offline startup and Undo.
- `RISK legacy context peer deletion: preserved references do not override concurrent known-context deletion during editor rebase` — Peer known-context deletion wins while unknown requirements and independent title edits survive; explicit local context deletion stays effective.

- `RISK legacy context editor preservation: Save keeps unknown references while applying explicit known choices and Undo` — Preserves legacy assignments, explicit edits, scanner-independent filters and usable native feedback.

- `RISK legacy context editor preservation: no available contexts retain saved requirements on unrelated Save` — Preserves legacy assignments, explicit edits, scanner-independent filters and usable native feedback.

- `RISK legacy context bulk Clear: explicit Clear removes unknown references and Undo restores them` — Preserves legacy assignments, explicit edits, scanner-independent filters and usable native feedback.

- `RISK context checkbox fallback: native selection remains visible without relational selector support` — Preserves legacy assignments, explicit edits, scanner-independent filters and usable native feedback.

- `RISK context filter restoration: every existing context remains offered independently of scanner choices and open matches` — Preserves legacy assignments, explicit edits, scanner-independent filters and usable native feedback.

- `RISK context selector fallback isolation: ordinary selected controls do not share a rule with unsupported relational selectors` — Preserves legacy assignments, explicit edits, scanner-independent filters and usable native feedback.

## Patterned active indicators
- `RISK patterned indicators preference: actual checkbox saves immediately survives reload and leaves task state intact`
- `RISK patterned indicators paint: opt-in static dashed diagonal textures retain semantic fills and separate excluded state`
- `RISK patterned indicators FAQ: appearance chapter explains default persistence and separate meanings`
- `RISK patterned indicators benchmark fill: striped overlay retains original chain gradient beneath the texture`
- `RISK patterned indicators full-field cue: selected controls use genuinely dashed stripes across the fill while small glyphs stay clear`
- `RISK patterned indicators sync contrast: status texture uses semantic ink rather than white on the white day surface`
- `RISK patterned indicators light-label protection: candidate and tomorrow badges retain unobstructed night-theme ink`
- `RISK patterned indicators immediate-save FAQ: established settings lifecycle answer lists the new toggle`
- `RISK patterned indicators selector fallback: native editor texture is isolated from ordinary active chips`
- `RISK patterned indicators selected rank contrast: texture has shared green fill and an opaque unchanged-ink label backing`
- `RISK patterned indicators selected caption contrast: motion descriptions share readable selected action ink in both themes`
- `RISK patterned indicators edge geometry: light-label edge cues clip a square dashed tile without vertical compression`
- `RISK patterned context direction cue: contrasting full-control rails leave original check and X glyphs untouched`
- `RISK patterned indicator slope legend: FAQ distinguishes locked selections and unset location from ordinary selected controls` — Covers semantic exceptions in the appearance legend.
- `RISK patterned indicators absent root: both preference states safely defer paint until a document root exists` — Preserves established non-DOM startup and resumed paint behavior.

- RISK transit line livery: actual painter keeps line colors across cars directions reloads and day-night shading
- RISK transit line guidance: extended scenery FAQ explains stable line colors without new settings

- `RISK human profile paint: every hairstyle mirrors face and rear hair for either walking direction` — Actual head paint and world-coordinate walker direction.
- `RISK clocktower human paint: children use shared skin and heads through flight landing and departure` — Shared head geometry, character hats, skin arms, trousers and opacity.

- `RISK human inherited head paint: existing local-transform carriers retain paint while explicit profiles face travel` — Preserve immutable carrying/activity head paint outside explicit world-coordinate walker/clocktower profiles.

- RISK scene color variation: kite panels and passing plane livery use existing seeded accents without new random draws

- RISK scene color FAQ: seeded palettes stay in a compact dedicated answer

- RISK Show Postpone preference: actual Settings checkbox hides both scanner controls and restores them without changing tasks

- RISK Show Postpone initialization: fresh browser and host clients default off while recovery evidence keeps visibility

- RISK Show Postpone local adoption: saved empty legacy boards and explicit choices survive reload with future settings intact

- RISK Show Postpone cloud adoption: missing legacy setting and explicit choices override fresh defaults at all supported revisions

- RISK Show Postpone import: actual JSON consumer treats old settings as existing and preserves explicit choices and holds

- RISK Show Postpone explicit visibility: saved booleans drive positive checkbox and both scanner surfaces

- RISK Show Postpone normalization: explicit positive choices win and draft inverse choices migrate only when absent


- `RISK task history: compact Top X uses recorded snapshots and preserves legacy facts` — Saved cutoff transitions and missing legacy cutoffs, independent of today’s pool.

- `RISK history browser driver: first-run motion uses the supported choice before history fixtures` — Prevent obsolete untimed preference seeding or direct dismissal from returning in the offline history driver.

- RISK blimp schedule: independent seeded opportunities preserve existing scenes and reconstruct across clients
- RISK blimp paint: seeded envelopes retain offscreen margins day-night shading and reduced-motion consumer
- RISK blimp admission: full-budget and later overlapping visits reject complete crossings without eviction

- `RISK visitor shadows: seated height and activity opacity match the visible people` — actual visitor shadow painter follows seated/standing height and visitor alpha without changing travel or schedules.

- RISK crossing shadows: opaque actors and skater departure use the actual paint alpha
- RISK rider shadows: phone scale matches cyclists scooters and hoverboards
- RISK woodland shadows: projected height shrinks with the painted depth scale
- RISK shadow FAQ: mounted guidance explains pose light and scenery-only changes

- RISK human profile selector: historical walker consumer still selects the actual guest painter

## Pedestrian admission/display separation

- `RISK pedestrian slot recovery: departed display recipes cannot suppress an otherwise eligible shared arrival`
- `RISK pedestrian reservation workload: stress admission stays fourteen while complete recipes have a derived finite bound`
- `RISK pedestrian visit recipe consumer: complete lifetime stays separate from admission and reconstructs at current UTC age`
- `RISK pedestrian local paint culling: completed parties stop before pose shadow reflection and actor consumers without altering shared records`
- `RISK pedestrian paint presentation consumer: current motion and viewport choices preserve complete local exits`
- `RISK pedestrian reduced workload: original shared reservations alone select deterministic still representatives`
- `RISK pedestrian paint memo: UTC frame age advances without rebuilding each local completion recipe`
- `RISK pedestrian fireworks isolation: retained walking recipes never enter unrelated show pose work`
- `RISK pedestrian slot guidance: extended FAQ separates arrival budget from complete walks and bounded still scenery`

Protect original shared admission slots separately from finite crossing recipes, pre-pose local retirement, reduced still-scene selection, immutable completion memoization and unrelated show work.

- `RISK pedestrian reduced retirement consumer: shared slot expiry repaints a still scene even when retained IDs do not change`

- `RISK pedestrian deferred recipes: cold admission plans solve only near-midnight and current display lifetimes once`

- `RISK pedestrian maximum lifetime: all canonical walking cohorts fit the proven finite recipe lookback`
- `RISK pedestrian deferred reconstruction: eager recipe reference matches lazy output at lookback midnight and cache eviction`
- `RISK pedestrian motion toggle consumer: real motion-choice handler restores full underway tails without changing shared recipes`
- `RISK pedestrian cull painted bounds: real companions held props and winter residue clear the frame before local retirement`

- `RISK pedestrian gait working set: retained walkers reuse warm clearance windows without changing poses`
- `RISK pedestrian winter route working set: distinct retained profiles reuse bounded contact prefixes`
- `RISK pedestrian gait cache bounds: route prefixes and contact windows have aggregate eviction budgets`
- `RISK native animation fixture: only the identified first-run Quick start panel is resolved`

Protect warm crowd reuse, exact reordered and evicted gait reconstruction, aggregate prefix/window memory bounds, and native fixture handling that rejects unexpected dialogs.

## Wheeled shadow projection and receivers

- `RISK wheeled shadows: project the complete cyclist and scooter silhouette with grounded contacts`
- `RISK ground shadow receivers: mobile shadows paint before every mobile body without screen-y clipping`
- `RISK wheeled projection: wheel contacts retain terrain width while height follows the celestial ray once`
- `RISK wheeled shadow FAQ: guidance describes complete vehicle shade and body occlusion`

Protect full bicycle and scooter silhouettes, fixed tire contacts, shared solar rays, one opacity mask, and mobile bodies above ground shadows.

## Decision authority recovery and mixed-client rollout (#146)

- `RISK decision capability adapter: first decision activates a sticky fence while plain legacy boards remain compatible`
- `RISK decision capability baseline: sole unknown learned authority activates the fence without rewriting bytes`
- `RISK decision recovery: unknown cloud evidence holds adoption and publication without replacing the durable local decision`
- `RISK decision recovery baseline: unsupported sole learning baseline cannot replace a durable local action`
- `RISK decision recovery identity: conflicting bytes for one acknowledged action hold both exact branches`
- `RISK decision recovery shape: malformed known action evidence stays durable and cannot publish`
- `RISK decision recovery ownership: foreign action evidence cannot be published under the current account`
- `RISK decision recovery durability: failed local save holds publication and retry retains one original No`
- `RISK decision recovery uncertain acknowledgement: committed No is read back after cold reopen without another comparison`
- `RISK decision recovery account transition: pending No acknowledgement cannot enter another account and the exact prior board stays recoverable`

Protect conditional decision-capability activation, ordinary pinned-client compatibility, exact unknown/foreign/colliding evidence holds, mandatory local saves, original action identity through uncertain acknowledgement and cold reopen, and account-bound late replies. Firestore rules consumers additionally execute the immutable historical backend and full application, activation CAS, historical safe-update holds, and rules-first rollout.

## Decision inheritance and complete replay safety (#146)

- `RISK decision capability recovery: sole baseline recovery activates the fence without rewriting evidence`
- `RISK decision recovery compatible update: unsupported authority checks the safe app update path and Retry keeps exact work`
- `RISK decision recovery guest sign-in: a saved guest No and later authenticated No retain original facts and learning`
- `RISK decision recovery explicit transfer: consented cross-account Import and Restore preserve original facts and later learning`
- `RISK decision recovery inheritance authority: changed attested facts stay held and ordinary account switches gain no consent`
- `RISK decision recovery inheritance durability: failed replacement recovery keeps both boards and an explicit retry succeeds`
- `RISK decision recovery legacy update: safe reload and Retry hold a sole unrepresented legacy comparison instead of acknowledging lost learning`
- `RISK decision recovery projection: supported but unprojectable authority holds exact cloud and local branches`
- `RISK decision recovery validation order: rejected local evidence stays exact before known-cloud union`

Protect source validation before authority union; missing/cyclic ancestry, baseline recovery and extension conflicts; lossless explicit ownership inheritance and exact-fact attestation; mandatory source/replacement recovery in both stores; and safe update of sole pending legacy learning without invented comparisons.
