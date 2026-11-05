# Chain Scanner TDD and regression gates

## Forced risk-based TDD and regression gates

Before editing any scanner, landscape, location, or offline-shell behavior,
write a discriminating test in the matching `tests/` area file, run it, and
keep the red output for the release record. The edit guard covers every app module. The CI diff gate
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
record its actual chronology rather than calling it preimplementation red. The
seven-day suggestion originally tested only Add; Edit's conversion/Save test
never dispatched its Hours → Days change. Keep interaction and serialization
contracts separate and retain both.

Choose cases by failure cost. For persisted task rules, include old saved data,
undo, import or restore, deletion, and cross-device reconciliation when those
paths touch the change. For a visual or motion change, cover the numerical
geometry or paint contract, reduced motion, and relevant phone, tablet, and
short-landscape viewports. For offline changes, check the asset fingerprint and
offline reload. A text or styling fix needs a direct UI assertion that would
have failed before the edit. Run the focused tests and affected regression
cohort; broaden to the full suite when risk or a required release gate warrants
it. Inspect the rendered result when pixels or controls changed. Record test, browser,
offline, CI, and live results separately.

A `PreToolUse` hook (`.claude/hooks/test-first-guard.sh`) enforces the ordering: an edit
to an app, PWA shell, or enforcement file is refused while no file under `tests/` has uncommitted changes.
Treat the block as correct and go write the test — do not work around it.

`RISK_TEST_COVERAGE.md` maps the current high-cost feature contracts to their
named tests. Add or rename its entry whenever a `RISK` test is added, removed,
or renamed; a test in `tests/repository-process.test.js` checks that the map stays complete. Changes to
the diff gate, edit hook, or CI workflow also need a new process-focused
`RISK` test, named under the test-first gate, regression gate, test inventory,
or repository process boundary. An unrelated feature risk test cannot satisfy
that process requirement.

The hook and CI gate enforce structural requirements: tests appear in the app
diff, a new risk case is named where required, and removed or weakened tests
carry a rationale with red command/failure evidence. They cannot independently
prove that the command ran before implementation or that the recorded failure
was observed, so the rationale is a review aid, not proof of chronology. Keep
RED evidence and chronology as [workflow](workflow.md#strict-tdd-at-agreed-seams)
requires, which also defines the prose-only exemption, then run focused tests
and the risk-selected regression cohort after the fix.

For agent-tool command changes, use [agent evidence tools](agent-evidence.md) to
select the focused and aggregate test entry points.

## Installed-client regression

The required process RISK in `tests/native-process.test.js` runs the two named installed-client
native cases through a narrow Node child of the existing `npm test` command.
It requires one completed successful outcome per case and rejects missing,
duplicate, skipped, cancelled or failed outcomes. The runner-only child marker
registers native cases in that child; it is unrelated to application behavior.
Ordinary CI runs these cases once, alongside the existing Node and agent-tool
cohorts. Sensitivity variants are explicit owner evidence, not another broad
suite or a set of skipped required cases.

Local execution needs an explicit full `CHAIN_NATIVE_CANDIDATE_SHA` and
`CHAIN_NATIVE_CANDIDATE_TREE`, a durable `CHAIN_NATIVE_OUTPUT`, and an allocated
`CHAIN_NATIVE_PORT`. Use the recorder and shared host allocation before launching
the process RISK. CI binds each group's exact checkout and installs the pinned Playwright
package's matching Chromium in the regression jobs. The scanner-tests aggregate
verifies the native reports and their actual checkout identities. Missing source,
browser or runtime support is a failure to investigate, not an empty pass.
For an expensive local full-suite qualification, invoke the recorder with its
opt-in `--qualification-readiness` flag as shown in
[test-run provenance](test-run-provenance.md#local-qualification-readiness).
That gate also requires a distinct explicitly allocated `CHAIN_NATIVE_SMOKE_PORT`
owned by the same active worktree. It rejects `CI=true` because native smoke
would switch to ephemeral port 0 and ignore that allocation.
Focused behavioral RED/GREEN recorder runs omit the flag.

Serve immutable old and candidate Git assets. A dirty runner may exercise an
explicit committed app only after asset equality checks, recording runner
provenance and that limited scope separately. Final release acceptance uses the
actual coherent committed candidate; follow
[release and review](release-and-review.md#installed-client-delivery-evidence).

## Protect existing features when changing tests

Existing passing behavior tests are feature contracts. Preserve their assertions
unless a user explicitly changes the behavior or concrete bug evidence shows the
old expectation is wrong. Never weaken, delete, skip, or replace a regression
test merely to make an implementation pass. Fix the implementation first.

A rationale entry in `TEST_CHANGE_RATIONALES.json` is required only when the
test diff (every file under `tests/`) removes or renames an existing test, or
deletes, changes or weakens one of its lines. Adding a new test or extending an
existing one with more assertions needs no entry. The entry carries the exact
protected-test-change fingerprint of the whole test diff (each line bound to its
file, so a record cannot move to another file), the specific reason,
previous and intended behavior, named replacement or new tests, remaining
feature boundaries, and the command plus observed failure from the red run.
Write and observe that failure before implementing the change. Keep unrelated
protections intact. Update the entry if the test diff changes.

`scripts/test-first-gate.mjs` runs in required CI and rejects removed or
weakened tests without this record, including test-only changes and deletion of
a test file. A pure insertion still counts as weakening when it can stop existing
assertions from running: a bare `return;`, `if(false)`/`if(0)`, a block-comment
delimiter at the start or end of a line, `process.exit`/`process.exitCode`, or
a `.skip(`/`.todo(` call. Blank lines and single-line `//` comments are
ignored. The insertion check is a heuristic without a JavaScript parser; an
insertion that suppresses assertions some other way is left to review. The
record is evidence for review, not an automatic permission to regress: the
independent reviewer must judge the reason, replacement coverage, and actual
user-visible result on the final commit. CI
checks the record and diff; it cannot itself prove that a command ran earlier.
