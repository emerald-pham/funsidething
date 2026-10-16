# Deepen walking visits, task rating history and the All Tasks view

Status: ready-for-agent
Tracker: local Markdown

The user requested all three architecture recommendations in one spec, confirmed the existing consumer testing seams, selected local Markdown and accepted the default triage role strings on 2026-10-16. This specifies future refactoring work; implementation has not started. Concrete module interfaces remain design work within the agreed scope and consumer seams.

## Problem Statement

Chain Scanner users depend on scenery that behaves consistently across devices, trustworthy task history, and task selection that applies only to the intended tasks. Recent changes show that maintaining these behaviors requires callers to coordinate facts spread across several modules or distant parts of the same implementation.

Walking visit callers know shared reservation clocks, full visit lifetimes, viewport-specific completion and motion presentation ordering. Task actions coordinate observation capture, Undo and finalization themselves. All Tasks filters, rendering, selection and Bulk Edit share transient state, and rendering also prunes selection. These are architectural friction findings; the review did not establish a current product defect.

The resulting maintenance risk is that an ordinary change can disturb another part of the same behavior, while some tests must reconstruct private implementation to reach the behavior they protect.

## Solution

Deepen the three existing behavior groups while preserving the released product:

1. Concentrate walking recipe and presentation knowledge in a coherent walking visit module. Keep deterministic shared admission in the timeline and retain the distinction between shared reservations, full visit lifetimes and local paint completion.
2. Give task actions one owner for their rating observation and Undo ordering. Preserve existing ranking signals, original observations and saved formats.
3. Give the All Tasks view one owner for filter validity, visible membership, selection lifetime and draft ownership. Keep assigned contexts, scanner inclusion and list filters as separate concepts.

The work succeeds when the effective interface asks callers to know fewer rules, the implementation owns those rules locally, and production callers and behavioral tests cross the same seam. Moving functions into new files or adding forwarding modules alone does not satisfy this specification.

## User Stories

### Walking visits

1. As a user opening the same scene on two devices, I want shared seeded opportunities and admission decisions to agree at the same UTC instant, so that device size does not choose a different event schedule.
2. As a user returning to a suspended tab, I want visitors reconstructed at their current age, so that missed opportunities do not replay as a burst.
3. As a user watching normal motion, I want a walking party, companions, held props and relevant activity residue to finish leaving the frame, so that visits do not disappear prematurely.
4. As a user on a narrow screen, I want local painting to finish when the complete visit has left my geometry, so that long canonical lifetimes do not keep invisible visitors consuming paint work.
5. As a user choosing reduced motion, I want still scenery drawn from the shared admission set, so that expired walking tails do not reappear merely because a representative pose was substituted.
6. As a user switching back to normal motion, I want a still-underway visit to resume at its current UTC age, so that a local reduced-motion choice does not destroy its shared recipe.
7. As a user resizing the scene, I want the same logical visits and deterministic presentation for the new geometry, so that resize history cannot change admission or leave stale local completion decisions.
8. As a user watching seasonal visitors, I want approach, activity and departure to remain attached and grounded, so that winter and summer presentation retain their approved motion and paint.
9. As a user on a resource-constrained device, I want bounded recipe and gait working sets and lazy lifetime work, so that repeated frames, cold reconstruction and rejected opportunities do not create unnecessary work.
10. As a maintainer, I want walking callers to use one coherent walking seam without interpreting journey internals, so that lifetime and presentation changes have locality.

### Task rating history

11. As a user answering Yes or No, I want history to retain the actual before and after rating, uncertainty, likelihood and available Top X values, so that a record explains the decision that occurred.
12. As a user completing, returning, working on or dotting a task, I want history to distinguish rating changes from changes in relative eligibility or pool membership, so that it does not claim an invented comparison.
13. As a user editing and then completing a task in one gesture, I want one Undo to reverse the gesture's changes, so that saving fields and acting do not require separate reversals.
14. As a user whose editor change makes Dot unavailable, I want the actual saved edit observed without a phantom Dot comparison, so that ratings and the benchmark remain honest.
15. As a user opening or reading Task history, I want viewing and rendering to remain read-only, so that merely looking at a task does not add records or modify the board.
16. As a user saving an unchanged task, I want sample noise and unchanged observations deduplicated without extra random draws, so that history does not grow with meaningless resampling.
17. As a user using Undo, I want original immutable history facts retained and any meaningful reversal recorded, so that reversing work does not erase evidence of what happened.
18. As a user saving after Undo or a relative pool change, I want the latest retained observation head to remain current, so that revisiting an earlier value can still produce an honest later observation.
19. As a user working offline or on several devices, I want observation identity, original timestamps and supported facts preserved through reconciliation and reload, so that synchronization neither loses nor retimestamps history.
20. As a user with legacy or future-format task data, I want unsupported history and recovery evidence preserved, so that a refactor does not silently discard information it cannot interpret.
21. As a maintainer adding or modifying an existing task action, I want observation capture and finalization owned with that action, so that I do not have to reproduce its recording protocol in every caller.

### All Tasks filtering, selection and Bulk Edit

22. As a user combining search, status or context tags and eligibility filters, I want the same open-task results and counts, so that deepening the view module does not change what matches.
23. As a user filtering All Tasks, I want list filtering to leave saved context assignments and scanner inclusion unchanged, so that narrowing a view does not alter my board's requirements.
24. As a user with inactive, excluded, unused or currently unmatched contexts, I want their All Tasks filters to remain offered while those contexts exist, so that an empty result is distinct from a missing filter.
25. As a user with imported unknown or empty context IDs, I want existing preservation rules retained on unrelated edits, so that unavailable requirements are not silently lost or replaced by a synthetic filter value.
26. As a user selecting tasks, I want Select all to select only currently visible matching open tasks and hidden selections pruned when the view changes, so that a later edit cannot affect an unseen task.
27. As a user whose Postponed or other status filter expires, I want only the unavailable tag cleared while independent search and eligibility choices remain, so that time-based view changes do not rewrite task data or reset unrelated filters.
28. As a keyboard or touch user, I want selection feedback, focus, row height and toolbar placement preserved through rerendering, so that selecting tasks remains readable and predictable.
29. As a user opening Bulk Edit with mixed values, I want unchecked Apply fields left unchanged and explicit Clear treated separately from blank input, so that I cannot delete data accidentally.
30. As a user changing a Bulk Edit draft, I want a later typed value to supersede draft Clear where the released controls allow it, so that draft intent stays reversible before Save.
31. As a user whose board, account, selected tasks, selected field values or context options change during Bulk Edit, I want invalid batches rejected before any local task mutation, so that stale drafts cannot write across owners or partially apply locally.
32. As a user whose batch later encounters peer changes or a failed cloud publication, I want unaffected peer fields and recovery copies preserved and retry behavior unchanged, so that a successful local batch is not mistaken for an atomic server transaction.
33. As a user reading a batch result, I want its counts scoped to the current board and account and current matching values, so that it does not claim server acknowledgement or offer a new batch-specific Undo.
34. As a maintainer changing All Tasks, I want filter, membership and selection transitions owned together, so that painting and bulk handlers do not independently coordinate transient globals.

### Shared preservation and delivery

35. As an existing user, I want saved boards, protected recovery copies, exports and cloud compatibility retained, so that architectural changes require no destructive reset or migration.
36. As a user of the installed offline app, I want the final integrated build and its assets to work through the supported PWA update and offline paths, so that new module packaging does not break loading.
37. As a user reviewing the result by playing it, I want a finished checkpoint with short numbered in-app checks and truthful evidence labels, so that I can assess the delivered product without reading code.

## Implementation Decisions

### Scope and architecture

- The user's request adds all three report candidates to one specification. Walking visit ownership is the first recommended slice; rating history recording and All Tasks view ownership remain full required scope, rather than optional follow-ups.
- A module is evaluated by its effective interface, including ordering constraints and invariants. Depth means that callers learn fewer facts while the implementation owns more behavior; it is not a source-line or file-count target.
- Preserve useful existing modules. Apply the deletion test: if removing a module would spread its complexity into callers, retain and deepen it; a shallow forwarding module or a file move provides no acceptance evidence by itself.
- Module responsibility changes are proposed here. Concrete method names, parameter shapes and any new or materially changed interfaces remain undecided until the seam review. The report did not choose them, and this specification does not invent agreement.
- Prefer in-process decisions for all three groups. No new remote dependency, generic framework, universal state module or hypothetical adapter is justified by the evidence. Keep the existing platform drawing and test stand-ins where useful.

### Walking visit ownership

- Shared seeded opportunity selection and admission remain the timeline's responsibility and remain independent of viewport and local motion preference.
- Concentrate walking recipe lifetime, local completion selection and walking presentation knowledge so callers need less knowledge of arrival, journey and activity clock internals.
- Preserve the distinction between admission reservation duration, complete canonical display lifetime and viewport-specific paint cutoff. The shared recipe remains immutable while local painting may stop earlier.
- Filter the locally relevant event set before substituting reduced-motion poses or entering downstream body, shadow and reflection work.
- Preserve approved pose, gait, scale, palette, props, group composition, terrain contact, RNG streams, finite reconstruction lookback and bounded cache contracts. Retain lazy work and avoid recomputing recipes as frame age advances.
- Scene composition retains its overall depth, receiver and reflection ordering. This work does not turn the walking module into a general scene framework.

### Task action and observation ownership

- Concentrate the before-observation, single-gesture Undo, edit/action outcome and observation-finalization protocol with the task action owner.
- Preserve the numerical ranking behavior and supported actions. The architecture change must not create a new preference signal, comparison, clock ordering rule or random draw.
- Preserve original immutable observation identities, timestamps and facts, the distinction between own rating and relative observations, and the latest retained history head through Undo.
- Preserve the supported history format, opaque future data, recovery behavior and existing reconciliation. This scope does not introduce a storage schema or rewrite history.

### All Tasks view ownership

- Concentrate transient filter validity, visible membership, selection pruning, draft ownership and result scope in the view module rather than distributing those transitions across paint and gesture callers.
- Keep transient query, tag, eligibility, selection, draft and result state separate from persisted board data. Preserve every existing saved field and compatibility rule.
- Keep assigned task contexts, main scanner inclusion and All Tasks filtering semantically distinct. A shared visual treatment does not justify merging their meanings.
- Validate current ownership, selected-task membership, opted-in field snapshots and relevant context options before mutating a local batch. Preserve the existing whole-local-batch rejection behavior and later field-scoped reconciliation.
- Maintain current board-level Undo and recovery semantics. Current batch counts remain view observations, not cloud save confirmations.

## Testing Decisions

### Agreed existing consumer seams

On 2026-10-16 the user confirmed the following existing consumer seams: scene and motion controls; task actions, Task history and Undo; and All Tasks/Bulk Edit controls, with isolated reload and sync fixtures where needed. This agreement does not approve new test-only interfaces or decide concrete module interfaces.

| Scope | Agreed existing consumer seam | What it catches | What it cannot establish alone |
| --- | --- | --- | --- |
| Walking visits | Existing deterministic scene reconstruction plus the running scene's motion controls and composed painter consumer | Shared reservations, full exits, local selection before pose, motion switches, geometry-sensitive paint and cache behavior | A pure timeline result does not prove visible motion, composition, readable controls or physical-device performance |
| Task rating history | Existing scanner and task-editor actions, visible Task history, Undo and saved/reloaded board | Actual action ordering, recorded facts, no phantom comparison, one-gesture Undo and durable observations | A DOM fixture does not establish actual layout, production authentication or real device storage behavior |
| All Tasks view | Existing All Tasks controls and Bulk Edit through actual selection, filters, Save/Cancel and board/account transitions | Membership, hidden-selection pruning, draft rejection, explicit Clear and result honesty | One tab cannot establish concurrent reconciliation or server acknowledgement; simulated controls cannot establish final rendered focus and geometry |

- Prefer these existing consumers over a new internal seam. Each deepened module should eventually expose the same agreed interface to its production callers and behavioral tests. Exact module interfaces are designed later, only where needed.
- Reuse the existing consumer seam agreement above without asking again. If implementation later needs a materially new seam, resolve that specific change with the user before tests at it; continue independent work while waiting.
- Good tests assert independently derived observable behavior and prior-state transitions. They must survive internal refactoring and must not prove a result by reproducing the same implementation calculation.
- Preserve the named behavior contracts in the current suite: pedestrian reservation reconstruction, local culling before pose, reduced-motion representatives and real motion toggles, complete painted exits, lazy recipes, gait reuse and cache budgets; rating history comparison/edit/Undo/merge/reload consumers; bulk toolbar selection, stale draft rejection, explicit Clear, peer fields, failed publication, context preservation and Postponed filter expiry.
- Current source-sliced renderer and lexical-environment fixtures are evidence of seam friction. Migrate meaningful assertions deliberately through the production seam as it becomes available. Do not delete or weaken a passing regression merely because its setup is implementation-coupled.
- Retain bounded internal geometry and paint contracts where they protect accepted scenery, alongside consumer and rendered acceptance. Keep recording canvas probes and deterministic time, seed, viewport and Sun inputs where useful; they do not replace composed scene inspection.
- Use isolated boards, profiles, clock values and fake/local dependencies. Never use a user's live saved board as a refactor fixture.

### Chronology and regression

- Follow the repository's strict vertical test-first workflow for any functional change: agree the seam, observe a discriminating behavioral assertion fail on the intended runnable baseline, apply the smallest change and observe GREEN before the next slice. Import errors, missing modules and broken infrastructure are not behavioral RED.
- If the desired behavior already passes on the baseline, investigate and retain that evidence; do not manufacture RED from a source-shape assertion or claim missing chronology. Resolve how the next slice satisfies the documented functional workflow before editing it, while preserving every existing passing regression contract.
- Keep original commands, candidate identities, timestamps and assertion output. Retrospective mutants or base comparisons may improve confidence but do not recreate missing chronology.
- Focus local checks on the active behavior group. Preserve required regression breadth, protected assertions, coverage mapping, test-change rationale and full CI/compatibility gates. A green unit or fixture test is not release proof.

### Integrated release acceptance

- Integrate the three behavior groups as one checkpoint candidate, with focused local checks for individual slices. Batch CI-triggering pushes and repeat checks only for a concrete candidate change, failed gate or unresolved finding; never skip required checks to meet a run target.
- Obtain the exact-diff owner review and code/specialist reviews derived by the current release validator. Task state and persisted history changes require appropriate independent state/sync scrutiny; review identities must satisfy current repository policy.
- For a product release, obtain independent FAQ coverage and final rendered typography reviews under existing identity rules. Preserve the extended FAQ and changelog requirements without inventing a player-facing feature when behavior remains unchanged.
- Exercise relevant day/night, normal/reduced motion, narrow/wide and enlarged views; verify applied theme, computed paint, native keyboard focus, selection geometry and scrolling on affected task controls. Compare approved scenery and actual full exits in composed scenes.
- Verify supported old/new client and rules compatibility, candidate asset loading, deployment identity, live assets, supported update behavior and offline reload as affected by final packaging.
- Distinguish inspected source, local tests, rendered candidate evidence, deployed assets/live behavior and physical-device evidence. State any unverified category explicitly.

## Out of Scope

- Implementing or releasing the refactors as part of this specification-writing request.
- New scenery designs, animals, umbrellas, altered spawn frequency, new colors or changed approved motion, geometry and shadows.
- Changing ranking, Chance or Halving behavior, comparison provenance, selection odds, observation retention, task defaults or context semantics.
- A new storage format, destructive cleanup, loss of sole/protected data, a forced refresh over an unsaved draft, or instructions to export/delete backups instead of automatic recovery.
- General splitting of the application, broad test-suite restructuring, dependency/framework replacement, a new measurement system or cleanup of unrelated modules.
- Changing the user-selected local Markdown tracker or default triage role strings, or marking undecided concrete interfaces as settled.

## Further Notes

- Source reviewed: commit 3d87c226519f878ddf4db7fbbdec9bf90376810d. Recheck current source and repository guidance before implementation; the snapshot is provenance rather than a permanent code-location contract.
- The source review considered 120 recent non-merge commits and prioritized scenery and task-control hotspots. The initial HTML report supplied conceptual before/after directions rather than concrete interfaces.
- No domain glossary or ADR collection existed at the reviewed snapshot. Use established product terms, and record only terminology or architectural decisions actually resolved during subsequent design.
- Recommendation strength: walking visit ownership is Strong; task rating history and All Tasks view ownership are Worth exploring. Including all three in the spec preserves those confidence levels and does not turn unmade interface decisions into commitments.
- This local spec captures all three recommendations, their preservation requirements, agreed testing seams and remaining design decisions. Resolve any genuinely new interface or seam needed for the next slice before tests at it; reuse the existing consumer agreement without asking again.
- Product tests have not been executed for this documentation-only specification. The earlier HTML report passed static structure checks; its rendered inspection was blocked by the browser's local-file URL policy.
