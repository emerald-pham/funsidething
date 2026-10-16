# Chain Scanner TDD and regression gates

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
red output with task or release evidence, then run focused tests and the
risk-selected regression cohort after the fix. Distinguish contemporaneous RED
from retrospective base-versus-fixed validation; the latter does not establish
test-first chronology. Treat the rationale as a review aid, not proof of chronology.

Only pure prose, comments and nonfunctional housekeeping are exempt from a
functional RED/GREEN loop. Configuration, dependencies and code deletion need
the same test-first evidence whenever they change functionality. Keep focused
cohorts; do not expand into blanket account matrices without a changed risk.

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

