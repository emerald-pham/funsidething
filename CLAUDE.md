# Chain Scanner

A ranked FVP task scanner. The app is centered in `index.html`, with its installable
PWA shell in `manifest.webmanifest`, `sw.js`, and the local icon assets. All tests
live in `tests.js`, run with `node --test tests.js`.

## Test-first, without exception

No implementation code goes into `index.html`, `sw.js`, `manifest.webmanifest`, or
the PWA icon assets until a test for that behavior exists in `tests.js`, has been run,
and has been **seen to fail for the right reason**. A test written after the code is
a test that has never been observed to catch anything.

The loop, every time: pin down the behavior → enumerate the cases (happy path,
boundaries, invalid input, failure modes, ordering effects) → write the tests →
run them and show the red output → minimum implementation →
run and show the green output.

For controls shared by Add, Edit, or Settings, enumerate the actual surfaces
and state transitions before assuming a passing test covers them all. Exercise
the registered interaction handler with controls from the rendered surface;
directly assigning a final value and calling Save proves serialization, not the
unit-change behavior. For defaults, distinguish an untouched draft from typed
values and saved custom values, then check repeated toggles and Save/reopen or
Cancel. The seven-day evergreen suggestion originally tested only Add; Edit's
conversion/Save test never dispatched its Hours → Days change. Keep those
interaction and storage contracts separate and retain both.

Watch for a new test that passes *before* the implementation exists. That test is
broken, not finished — strengthen it until it discriminates, then continue.

## Forced risk-based TDD and regression gates

Before editing any scanner, landscape, location, or offline-shell behavior,
write a discriminating test in `tests.js`, run it, and keep the red output for
the release record. The edit guard covers every app module. The CI diff gate
also rejects app changes without changed tests. Browser/runtime JavaScript,
HTML, the web manifest, Firestore rules, and the test-first gate, hook, or
workflow require a new `RISK` test in the same diff. Runtime paths are matched
by file type, so a newly added module cannot avoid the gate by using a new
filename. CSS and static image edits still need a direct test in the same diff;
they use a `RISK` case when the failure cost warrants one.

For behavior-changing controls, begin with the prior state and exercise the
transition through the actual consumer: the change/click handler, command, or
import path. A helper test or fixture already set to the final value cannot
prove that the control reaches the rule. Check equivalent entry points where
they should share that rule (for example, Add and Edit Hours → Days, or a scan
preference change and Save settings). Cover only the relevant transitions and
saved-data consequences for the change; do not expand this into a blanket
matrix or introduce another test framework. For Add and Edit Hours → Days,
assert the displayed draft before saving and the persisted result afterward;
retain custom-duration and return-to-default cases when prior edits matter.
Use an isolated board. When closing a gap in established
behavior, verify that an isolated broken-handler negative control fails and
record its actual chronology rather than calling it preimplementation red.

Choose cases by failure cost. For persisted task rules, include old saved data,
undo, import or restore, deletion, and cross-device reconciliation when those
paths touch the change. For a visual or motion change, cover the numerical
geometry or paint contract, reduced motion, and relevant phone, tablet, and
short-landscape viewports. For offline changes, check the asset fingerprint and
offline reload. A text or styling fix needs a direct UI assertion that would
have failed before the edit. Run the full suite after the change, then inspect
the rendered result when pixels or controls changed. Record test, browser,
offline, CI, and live results separately.

A `PreToolUse` hook (`.claude/hooks/test-first-guard.sh`) enforces the ordering: an edit
to an app, PWA shell, or enforcement file is refused while `tests.js` has no uncommitted changes.
Treat the block as correct and go write the test — do not work around it.

`RISK_TEST_COVERAGE.md` maps the current high-cost feature contracts to their
named tests. Add or rename its entry whenever a `RISK` test is added, removed,
or renamed; a test in `tests.js` checks that the map stays complete. Changes to
the diff gate, edit hook, or CI workflow also need a new process-focused
`RISK` test, named under the test-first gate, regression gate, test inventory,
or repository process boundary. An unrelated feature risk test cannot satisfy
that process requirement.

The hook and CI gate enforce structural requirements: tests appear in the app
diff, a new risk case is named, and test changes carry a rationale with red
command/failure evidence. They cannot independently prove that the command ran
before implementation or that the recorded failure was observed. Keep the real
red output with task or release evidence, then run the focused test and the full
suite after the fix. Treat the rationale as a review aid, not proof of chronology.

Exceptions, and only these: config, dependency manifests, pure documentation
(`README.md`, `SETUP.md`), and deleting code. Everything else — bug fixes, "trivial"
glue, one-line changes — gets a test first.

## Conventions

- Comments in this codebase explain *why*, especially where a past bug drove the design
  (see the cloud-sync block). Match that density and voice; a fix without its reasoning
  invites the same bug back.
- Cloud sync orders writes by a revision counter, never by wall-clock timestamps.
- Run the full suite after every change, not just the tests you added.

## Backward compatibility before release

Run `npm run test:compatibility` before release. The required `scanner-tests`
CI job runs it for every PR, push, and Pages deployment. It requires the
Firestore emulator, available Git history, and zero skipped compatibility cases.
It executes real released client backends and codecs against candidate rules,
and candidate clients against released rules, then runs the bounded sync-error
and safe reload contracts. Read success alone is never evidence of sync success.

The matrix retains the immutable supported baseline in
`scripts/backward-compatibility.mjs` and also tests the exact comparison base
(`COMPATIBILITY_BASE_SHA` in CI, `origin/main` locally). Do not advance or remove
the pinned baseline to make an incompatible change pass. A new protocol needs
a staged compatible rollout or an explicitly reviewed support/migration change.
See [BACKWARD_COMPATIBILITY.md](BACKWARD_COMPATIBILITY.md) for the supported
boundary and the historical negative control. The Firestore `predeploy` hook
also runs this same gate before `firebase deploy --only firestore:rules`, so a
manual CLI rules deployment cannot accidentally omit the compatibility check.

## Protect existing features when changing tests

Existing passing behavior tests are feature contracts. Preserve their assertions
unless a user explicitly changes the behavior or concrete bug evidence shows the
old expectation is wrong. Never weaken, delete, skip, or replace a regression
test merely to make an implementation pass. Fix the implementation first.

Every executable change in `tests.js`, including new coverage, needs an entry
in `TEST_CHANGE_RATIONALES.json` with the exact protected-test-change fingerprint,
the specific reason, previous and intended behavior, named replacement or new
tests, remaining feature boundaries, and the command plus observed failure from
the red run. Write and observe that failure before implementing the change. Keep
unrelated protections intact. Update the entry if the test diff changes.

`scripts/test-first-gate.mjs` runs in required CI and rejects test changes without
this record, including test-only changes and deletion of `tests.js`. It protects
all executable additions as well as removals: early returns, comment delimiters,
and appended termination code cannot silently bypass the suite. Blank lines and
single-line `//` comments are ignored; block-comment changes are protected
because they can hide assertions. The record is evidence for review, not an
automatic permission to regress: the independent reviewer must judge the reason,
replacement coverage, and actual user-visible result on the final commit. CI
checks the record and diff; it cannot itself prove that a command ran earlier.

## Risk-based exact-commit release gates

Every candidate needs an owner review of its exact diff. The release validator
derives the review plan from the exact base-to-candidate diff and records it in
the receipt. Pure documentation, comments, copy, and housekeeping with no
executable, configuration, test, release-gate, data, or product-behavior change
need only the owner's exact-diff review. Ordinary code or behavior needs one
independent code/behavior review. Shared session state, callable or auth
behavior, Firestore rules, deployment/authentication infrastructure, data
migration, memory, cloud persistence, and synchronization need the relevant
specialist review. A code reviewer and a specialist reviewer are both required
only when the exact diff affects both domains.

Risk is derived from changed paths and their exact diff content; callers cannot
lower the required review plan. An optional `additionalSpecialistDomains`
input may add domains from the validator's known-domain list, but cannot replace
or remove any derived domain; that escalation is recorded in the receipt.
Ambiguous auth, state-persistence, and session-persistence changes fail closed
to their relevant specialists. Memory/cloud/sync specialist receipts record
source fingerprints and per-domain impact and rationale. Every affected domain
lists focused tests; an all-unaffected assessment still includes at least one
focused preservation test across the assessed domains. Install the shared pre-push gate with
`npm run release:install-hook`, record evidence with `npm run release:record`,
verify it with `npm run release:verify`, and publish statuses with
`npm run release:publish` before merging. Re-review affected domains whenever
the candidate SHA changes. The main ruleset must retain
`funsidething/memory-audit` and `funsidething/independent-review`, add
`funsidething/specialist-review`, and keep its other required checks. Schema
version 1 receipts retain their original two-review policy and publish a
receipt-bound specialist-compatibility status so all current required contexts
are present; this compatibility status does not claim a third human review. New
schema version 2 receipts follow the derived plan. Pages CI independently
verifies the merged PR head, exact tree, base, receipt digest, and latest status
contexts before deployment. Follow [RELEASE_GATES.md](RELEASE_GATES.md) for the
evidence format and release steps. Receipts and statuses record human work but
cannot prove that a person actually performed the review; repository writers
with status permission and protection-bypassing administrators remain inside
the trust boundary.

## Independent typography review for final releases

Owner instruction, 2026-10-08: every final product checkpoint release and
equivalent release requires a typography reviewer independent of the
implementer. Review the actual final built candidate, identify its commit and
build artifact, and compare it with the intended typography contract and
previous released build. Automated typography checks do not substitute for this
review. Recheck affected evidence if the reviewed candidate materially changes.

Inspect the actual resolved/rendered font (including platform fallback or font
load failure), computed family, size, weight and line height, readability,
wrapping and overflow. Use representative relevant viewports and states,
including changed controls, dialogs/portals and recovery screens when affected.
Choose the smallest useful configuration set; do not expand into a full actor
or account matrix. For a global font report, sample shared chrome plus distinct
font/inheritance paths across the app, and compare base/candidate CSS and assets.
Record the baseline, exact artifact, platform, states, viewport/window sizes,
findings, evidence and what was not checked. An inaccessible runtime is an
unresolved review gap, not a pass inferred from unit, inference or source tests.
Fix actionable typography findings and obtain the affected independent review
before publication.
