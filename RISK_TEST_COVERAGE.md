# Risk-based test coverage inventory

This map records the current named RISK contracts in tests.js. It lets reviewers see which costly feature boundaries already have explicit protection before changing nearby behavior. Related non-RISK regression tests remain part of the contract too; the focused companions below call those out where they matter.

The named-contract test in tests.js checks that every top-level test whose title starts with RISK appears in this inventory. Add or rename the inventory entry in the same test-first change. If a future feature adds a new risk area, add a heading and place its concrete test names under it.

## Task state, eligibility, and scanner controls

- RISK IMPORT RENDERING: restored identifiers cannot inject attributes or break task reveal
- RISK rating drift: Done and Worked on it stay neutral on every completion route and recurrence type
- RISK false preference evidence: All Tasks Dot compares only with the current benchmark and a first dot stays neutral
- RISK lost scheduling metadata: both Add routes save and clear Start and Due together
- RISK recurrence-default loss: quick Add preserves 18-hour and 2 AM defaults across single and pasted tasks
- RISK unreachable Undo and lost preference: floating header defaults off, saves on toggle, and survives close and reload
- RISK prerequisites: completion, evergreen Done, restore, and deletion govern scan eligibility by ID
- RISK prerequisites: invalid links and cycles are rejected; missing imported references are eligible
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
- RISK CLOUD BACKUP: clean adoption promotes every conflicting row that shares a recovery ID
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

The release gate derives a review plan from the exact candidate diff: the owner reviews every diff, ordinary behavior changes require one independent code reviewer, and high-risk domains require a specialist. It requires both independent roles only when code behavior and specialist risk are materially affected. Ambiguous auth, state-persistence, and session changes fail closed to relevant specialists; callers may add known specialist domains to raise the plan but cannot replace or remove derived domains. Memory/cloud/sync specialist evidence records source fingerprints, per-domain impact, rationale, and focused tests. Schema version 1 receipts remain verifiable under their former two-review rule, and their publisher also emits a third specialist-compatibility status bound to the same receipt so current branch protection can accept them without inventing a new reviewer. The local hook checks each outgoing tip; the main deployment job independently verifies the merged PR head, derived status plan, and latest statuses. Statuses bind receipts but cannot prove that a person actually read or reviewed them.

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

- RISK night shows: standalone fireworks recur independently of the rare cooldown and stay bounded
- RISK night shows: festival odds are lower than standalone fireworks with finite visits and rate controls
- RISK night shows: launches lead to bounded fading bursts and the festival sails fully on and off screen
- RISK skyline materials: short buildings favor brick while tall towers favor stable modern colors
- RISK skyline lights: only exposed windows can be selected so both on and off are visible
- RISK night shows: festival and standalone sparks enter the shared mirror before foreground hills
- RISK Landscape browser: both night shows reflect actual sparks and exposed windows visibly switch on and off
- RISK festival barge: shell launches follow the moving deck and fireworks have varied ballistic trails
- RISK fireworks realism: uneven blooms leave ballistic trails and fading embers
