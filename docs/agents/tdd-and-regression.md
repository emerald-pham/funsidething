# Chain Scanner TDD and regression gates

## Forced risk-based TDD and regression gates

Before editing any scanner, landscape, location, or offline-shell behavior,
write a discriminating test in the matching `tests/` area file, run it through
the recorder [workflow](workflow.md#strict-tdd-at-agreed-seams) names, and
keep the red output for the release record. The edit guard covers every app module. The CI diff gate
also rejects app changes without changed tests. A new `RISK` test is required in
the same diff only where saved data, the offline shell or enforcement can break:
HTML pages, the service worker, the web manifest, release delivery
(`app-release.js`), data modules (any path naming a store, cloud, sync, storage,
persistence, backup, recovery, auth, session, Firestore, account, IndexedDB or
migration), the lz-string archive codec, Firestore rules, and the test-first
gate, hook or workflow. An HTML or worker change that only adds changelog text
and refreshes the app fingerprint or `CACHE_NAME` does not count, unless it moves
a changelog marker or adds markup that loads or runs script. Other app changes,
such as scenery, location and styling, need a direct test and use a `RISK` case
when the failure cost warrants one.

For behavior-changing controls, begin with the prior state and exercise the
transition through the actual consumer: the change/click handler, command, or
import path. A helper test or fixture already set to the final value cannot
prove that the control reaches the rule. Check equivalent entry points where
they should share that rule (for example, Add and Edit Hours → Days, or Restore
from a chosen file and from pasted board data). Cover only the relevant transitions and
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
offline reload. After any app-shell edit, `npm run fingerprints -- --write`
refreshes the changelog app fingerprint and the worker `CACHE_NAME` together. A text or styling fix needs a direct UI assertion that would
have failed before the edit. Run the focused tests and affected regression
cohort; broaden to the full suite when risk or a required release gate warrants
it. Inspect the rendered result when pixels or controls changed. Record test, browser,
offline, CI, and live results separately.

A `PreToolUse` hook (`.claude/hooks/test-first-guard.sh`) enforces the ordering: an edit
to an app, PWA shell, or enforcement file is refused while no file under `tests/` has uncommitted changes.
A file in an agent worktree under `.claude/worktrees/` is judged by its path
inside that checkout, against that worktree's own `tests/` (#2321).
Treat the block as correct and go write the test — do not work around it.
A root `tests.js` is not a test file: nothing runs it, the hook refuses writing
it, and the CI gate rejects a diff that adds or changes one. Port such edits as
[test groups](test-groups.md#test-files) describes.

`RISK_TEST_COVERAGE.md` lists the `RISK` tests by file and is generated from
their names: run `npm run risk-map -- --write` after adding, renaming or
removing one. A test in `tests/repository-process.test.js` checks that the
committed map matches. Changes to
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
test diff (all changes under `tests/`, shared helpers included, plus the
deletion of the old root `tests.js` when the base predates the split) removes
or renames an existing test, or
deletes, changes or weakens one of its lines. Adding a new test or extending an
existing one with more assertions needs no entry. The entry lists the weakened
lines in `weakenedTestLines`, each as `file:-content` for a removed line or
`file:+content` for an inserted suppressor, with no line numbers, so it stays
valid when later commits add or edit other tests or when merging `main` shifts
lines. One entry must cover every weakened line in the diff, listing a repeated
line once per weakening. Entries written
before this rule match by their whole-diff `testChangesSha256`. The entry also
carries the specific reason,
previous and intended behavior, named replacement or new tests, remaining
feature boundaries, and the command plus observed failure from the red run.
Write and observe that failure before implementing the change. Keep unrelated
protections intact. Update the entry only when the diff weakens another line.

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
