# Risk-based test coverage inventory

This map records the current named RISK contracts in tests.js. It lets reviewers see which costly feature boundaries already have explicit protection before changing nearby behavior. Related non-RISK regression tests remain part of the contract too; the focused companions below call those out where they matter.

- RISK skyline light cadence: twice as many opportunities keep single-roof samples and visible-window toggles
- RISK clocktower visit geometry: four staggered visitors stand on both actual roof slopes at every viewport
- RISK clocktower visit scheduler: rare night-only rolls pause expire cancel and never replay a backlog
- RISK clocktower reduced motion: four fixed roof contacts fade gently without flight or posture animation

The named-contract test in tests.js checks that every top-level test whose title starts with RISK appears in this inventory. Add or rename the inventory entry in the same test-first change. If a future feature adds a new risk area, add a heading and place its concrete test names under it.

## Task state, eligibility, and scanner controls

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
- RISK quick Add: help removes the retired shortcut and retains task-editor Dot as a rank decision
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
- RISK landscape aircraft: scheduled planes restore the compact ivory silhouette in both directions
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
- RISK skyline lights: each garden has a one-in-twelve state through independent resamples
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
- RISK fairy lights: gardens and patios share independent stable one-in-twelve roof samples
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

- RISK context exclusions: real selectors cycle included excluded neutral with durable Undo and explicit red precedence
- RISK context exclusions: scan and All Tasks preserve all required contexts dotted classification and full-pool shares
- RISK No context filter: exclude-only synthetic control never becomes an assignment and tracks rename deletion and unknown IDs
- RISK context saved data: absent invalid and released settings preserve assignments exclusions unknown fields and completion Undo
- RISK context sync: concurrent clients offline reload reconnect and remote completion preserve revisioned filters and recovery
- RISK Settings hierarchy: Changelog uses existing sections and Save settings follows every section without changing validation
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
- RISK scan lifecycle: Return before Dot and expired rests retain pair learning manual overrides and one-gesture Undo
- RISK scan lifecycle: interval edits that revive an evergreen rest save once without a discarded Dot comparison
- RISK scan lifecycle: first Start reconciles timed holds at their exact boundary in both modes without teaching rank
- RISK scan lifecycle: first Start sweeps stale day marks and evergreen rest while retaining oldest never-done priority
- RISK scan lifecycle sync: repaired old remote Chance draw is durable across all stores and offline reload
- RISK scan lifecycle sync: concurrent old-pass repairs converge by revision without replaying ratings or Done
- RISK scan lifecycle sync: failed local repair persistence holds adoption and a newer cloud revision cannot be overwritten
- RISK scan lifecycle FAQ: Dot rest boundary current Start eligibility and durable remote refresh are explained

- RISK task rating history: actual comparisons retain timestamped before and after values without backfilling or changing signals
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
- `RISK Squared Weighting default: fresh missing invalid settings use squared and explicit saved preferences survive` — quadratic math, saved mode and preserved eligibility/data contracts.
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

- RISK fireworks minute cap: complete standalone and barge flight bloom and finale tails finish within sixty seconds
- RISK fireworks minute schedule: capped visible events preserve seeded opportunity spacing and UTC late join reload across midnight
- RISK fireworks pair endpoints: zero and maximum seeded samples bound regular pairs without delaying eight finale lanes

- RISK fireworks natural tails: final embers retain their complete formula lifetime
- RISK fireworks reservations: shortening visibility preserves previously suppressed shows and visitor admissions

- RISK fireworks legacy reservations: invisible remainder keeps old festival random draws and admission budgets

- RISK fireworks reduced motion: capped static blooms stay on the stationary barge only during the real first minute

- RISK fireworks reduced deadline: static scheduler clears a persistent barge bloom at the actual sixty-second boundary without animated repaints

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
- RISK changelog dates: Settings combines repeated dates in descending order without losing history categories or links
- RISK date clear availability: empty Add and Edit controls disable independently through typing clearing resets and reopening
- RISK date clear programmatic values: direct assignments stay synchronized without events and preserve unrelated drafts
- RISK date clear guidance: Quick start explains disabled empty date controls and retained save semantics
