# Isolated test groups

`npm test` remains the complete local suite:

```sh
npm test
```

## Test files

Tests live in per-area files under `tests/`, one per group plus the
repository-process tooling tests: `core.test.js`, `scenery.test.js`,
`persistence-recovery.test.js`, `native-process.test.js` and
`repository-process.test.js`. Shared fixtures and helpers live in
`tests/shared.js`; area files import what they use from it. Add a test to the
file of its group: a plain-string `test('…', …)` registered at the start of a
line takes that file's group from `fileGroups` in
`scripts/test-group-assignments.json` (#2232). Add a `rootAssignments` row to
override that group, and for every title the runner's scanner cannot read: a
computed title (`registration: "dynamic"`), a registration that does not start
at column 0 (indented, for example inside an `if`), a title with an escape such
as `\'` or written `\u2192` for `→`, or a registration after a regular
expression literal the tokenizer reads as division (for example the one after
the `/Couldn't…/` regex at `tests/core.test.js` 26028). Such a root without a
row fails the core registration guard rather than running unclassified. A file
with no `fileGroups` entry places nothing, so its new roots still need rows.
Tests
that read or spawn their own file use `fileURLToPath(import.meta.url)`.
`npm test` runs two files at a time, because the long core file's 5 s fixture
deadlines expire when every file runs at once.

A branch that still edits the old single `tests.js` ports by moving each new or
changed test into the area file of its group, adding any new helper to
`tests/shared.js` with an export, prefixing relative dynamic imports and
`new URL(..., import.meta.url)` paths with `../`, and pointing its catalog rows
at the new file. A recreated `tests.js` cannot merge: the test-first gate rejects
a diff that adds or changes it, and `npm test` and the group
runner no longer run it.

The additional `test:group` entry point runs one explicitly classified group in
its own Node process. Group identifiers are stable: `core`, `scenery`,
`persistence-recovery`, and `native-process`. Each process runs its selected
roots serially. A group that needs more than Node's default heap declares
`nodeMaxOldSpaceSizeMb` (512 to 12288 MB; each group runs alone on a 16 GB
runner), and the runner starts its test process, and so every per-file child,
with that `--max-old-space-size` (#2232). Raise the group's heap rather than
moving roots out of it. `scenery` and `persistence-recovery` run with 8192 MB:
`persistence-recovery` ran out of Node's default heap on CI in PR #2222, which
is why 19 heavy recovery roots were moved to `scenery`, where they stay. The
8192 MB figure is about twice the 4144 MB default observed locally and has not
been measured against the groups' actual peak; check it on the first CI run. Keep each output directory empty and unique, outside the
checkout, and allocate separate native ports or other shared resources when
groups run concurrently.

Selections use repeated Node `--test-name-pattern` options, each capped at 64
KiB, so long root inventories stay below Linux's per-argument limit while the
whole group still runs in one isolated process. Node 22 supports repeated test
name patterns; the process contract checks that every selected root executes.

Pass the validation context explicitly. This Actions example shows all
required provenance inputs; set `TEST_COMPARISON_BASE` to the exact base commit
for the event being validated:

```sh
npm run test:group -- \
  --group native-process \
  --output-dir "$RUNNER_TEMP/test-groups/native-process" \
  --repository "$GITHUB_REPOSITORY" \
  --event-policy "$GITHUB_EVENT_NAME" \
  --run-id "$GITHUB_RUN_ID" \
  --run-attempt "$GITHUB_RUN_ATTEMPT" \
  --source-sha "$CHAIN_TEST_SOURCE_SHA" \
  --comparison-base "$TEST_COMPARISON_BASE"
```

For a pull request, set `CHAIN_TEST_SOURCE_SHA` to
`${{ github.event.pull_request.head.sha }}`; the default `GITHUB_SHA` identifies
the synthetic merge checkout. For push events, use `GITHUB_SHA` as the source
SHA.

For local evidence, use a unique run ID and the full source and comparison-base
commit SHAs:

```sh
npm run test:group -- \
  --group core \
  --output-dir "/tmp/funsidething-test-groups/core-<unique-run-id>" \
  --repository emerald-pham/funsidething \
  --event-policy local \
  --run-id "<unique-run-id>" \
  --run-attempt 1 \
  --source-sha "$(git rev-parse HEAD)" \
  --comparison-base "$(git merge-base HEAD origin/main)"
```

The command may obtain repository, event policy, run ID, attempt, and source
SHA from their corresponding GitHub Actions environment variables. For PRs,
set `CHAIN_TEST_SOURCE_SHA` to the event's head SHA; the comparison base remains
explicit unless `CHAIN_TEST_COMPARISON_BASE` is set.
The source SHA/tree identify the event's source head. The checkout SHA/tree
identify the commit actually tested, which can be a synthetic PR merge. Native
installed-client children receive the actual checkout SHA/tree.

Every successful invocation writes a `result.json` plus TAP and stderr logs to
the requested directory. `resultIdentity` binds repository, event policy, run
and attempt, source and checkout identities, comparison base, stable expected
groups, selected group, inventory and assignment file hashes, and
`cohortDigestSha256`. The digest covers the complete mapped required case IDs,
group list, root-to-file/group assignments, root replacements, and controlled
process registrations. Case outcomes, accepted skips, native registration
checks, artifact hashes, and process exit status are recorded in the same
result. Missing required cases, unclassified roots, overlapping assignments,
empty groups, unregistered native children, additional skips, or process
failures return nonzero. Every mode, `--describe` included, also fails when a
declared required root resolves to zero tests in its file; a
`registration: "dynamic"` row has no literal title to find, so only its group
run checks that it executes.

The independently captured inventory is rooted at Data safety run
`40150306422` (source and checkout `d224107e5e56e5455a16e670dad6bdbc951940b5`):
2,997 cases, 2,936 passed and 61 accepted environment-dependent skips. The
inventory retains the earlier 2,997-case PR262 same-tree run and the original
2,960-case main run, including exact case identities and skip reconciliation.
Assignments retain each baseline root's measured duration. Those sums are for
balancing only; they are not a substitute for observed per-group runtime or a
full-versus-grouped result reconciliation.

This command supplements `npm test`; it does not change the full-suite
boundary. Run the affected focused process tests during development, and use the
repository's required full suite and CI gates for final qualification.

## Loaded runs

Add `--cpu-load <busy-processes>` (1 to 64) to a group run to reproduce a slow
machine locally. It is for timer, debounce and race work: a change that orders
asynchronous steps, or a failure that appears only on slower hosts. Skip it
elsewhere. Nothing requires it and CI never sets it.

Check `status` in the [host coordination](host-coordination.md) ledger first and
do not starve another owner's active work. The busy processes run only while the
group's test process runs, and they end with the run on pass, failure, interrupt
or the runner's death. A count near the host's core count (or above it) is the
useful range.

A loaded result records `cpuLoad.workers` and passes as `passed-under-load`, so
the aggregate, the CI consumer and input-pass reuse all refuse it. It is never
release or canonical evidence.

## Which groups a diff needs

CI runs every group on any diff, because it keys each group on the complete
checkout tree. No changed file narrows the list, and a documentation-only diff
needs the same groups as a scenery change.

## Reading a failed group

A failed group's log gives each failed test's first assertion line, capped at 200
characters. Compared values on later assertion lines stay in the `test.tap`
artifact, because job logs are public.

## Nightly cross-engine cohort

`scripts/test-group-assignments.json` lists cross-engine native roots under
`nightlyRoots` (root title, source file, reason). They belong to no required
group: `--describe`, the four group runs, the unclassified-root guard and
`--aggregate` neither run nor require them. A nightly root cannot also be a
required root or process control, and the Chromium installed-client cases
(the owner root and its signed-out and reconcile-held children) can never be
declared nightly. To move a case to nightly, add a `nightlyRoots` row (and
remove any `rootAssignments` override); a nightly root never takes its file's
group; a baseline root cannot move because the baseline
must stay fully assigned.

The `Nightly` workflow runs them with Chromium and WebKit installed:

```sh
npm run test:group -- --group nightly-cross-engine --output-dir <new-empty-dir> \
  --repository <owner/name> --event-policy <policy> --run-id <id> --run-attempt <n> \
  --source-sha <sha> --comparison-base <sha>
```

A row whose test has not landed declares its owning PR as `pendingOn: "#<number>"`
and is pending; every other row is active. The run executes the active roots.
With none it succeeds without starting a test process, records status
`no_active_roots`, and annotates that 0 cross-engine cases ran, naming the
pending roots. A nightly run that passes preflight records `crossEngine` in
`result.json`, with the case count and the active and pending roots. A preflight
failure records none.

The run fails when no nightly root is declared at all, when an active root is
not registered exactly once in its file (resolves to zero tests), when a pending
root's test is registered (remove its `pendingOn` to move it to active), or when
any nightly case fails, is skipped or is missing. Active and pending rows read a
title the same way: a direct `test(...)` title written plainly, with escapes or
as a template with no substitutions, or else any string in the file's code that
spells the title, such as a constant or a table it registers from. A title built
at run time by concatenation or substitution cannot be read statically, so a
pending root with such a title stays pending after its test lands; write each
nightly root's title as one whole literal.

Neither `--describe` nor the `core` group checks whether nightly roots are
registered; `core` only pins that the list is valid. Required CI therefore stays
green when a pending root lands and only the nightly run is red. The nightly run writes `result.json` and TAP like a group run, but it is not
a required group and cannot be described, covered or aggregated. When and how
releases depend on it is in
[release and review](release-and-review.md#nightly-cross-engine-native-checks).

## Parallel Actions aggregation

Data safety describes the required cohort before routing with the same runner's
`--describe` mode. It validates the inventory and assignments and writes
`descriptor.json` without executing test bodies. This is a description of
required coverage, not a test pass.

The four `regression-*` jobs run independently with serial tests inside each
process. `core` first runs one bounded private registration guard per full-suite
file, skipping only roots assigned to that file. Its public Node reporter must
return exactly one successful per-file summary with zero tests, suites,
top-level outcomes, failures, skips and cancellations. This catches data-driven
new roots even when no literal registration line changed, including names
assigned in another file and names identical to file wrappers. Raw TAP, stderr
and summaries are retained separately from cohort outcomes. Descendants inherit
their assigned parent's group and execute in the ordinary group process.
An explicitly classified dynamic top-level root may declare
`registration: "dynamic"`; the normal group must still execute that root.

`scanner-tests` remains the required aggregate. Its `--aggregate` invocation
reads actual predecessor job results, all four same-run result directories,
raw TAP/stderr, complete native/recovery file inventories and hashes, accepted
case/skip identities and controlled native registrations. The two installed
native reports must pass for the actual checkout and close their owned context,
browser and server. Missing, empty, skipped, canceled, duplicate, mismatched or
unreadable evidence fails. Only successful reconciliation and report upload
permit the final full-producer completion marker.

For a verified canonical producer, all four jobs instead use `--covered` with
the routing proof. Their records explicitly contain no current cases, native
artifacts or child execution. They retain the original producer run, attempt,
merge checkout/tree, base and aggregate report digest. The aggregate re-observes
that producer immediately before accepting all four references; a changed or
missing proof fails. A covered run cannot become a new full producer.

The test-first diff gate always runs for the actual event checkout and comparison
base. Pages still requires both `scanner-tests` and `release-evidence`.

## Reusing successful CI inputs

Each regression group, Firestore rules and compatibility uses the enforcing
`scripts/agent-tools/ci-pass-reuse.mjs` consumer. A verified original pass for
identical inputs must be reused, including on main and workflow retries. CI
admission runs the actual workflow consumer regressions before expensive jobs;
direct suite/group execution bypassing this consumer fails that contract.

Keys bind the repository, complete committed checkout tree, exact comparison
base, gate, Node version, platform, architecture and hosted runner image. The
tree includes application code, tests, dependencies, workflow and cohort
definitions. Commit metadata and event names do not invalidate identical tested
inputs. Each consuming job selects its actual runner inputs before dependency
installation. A different or unknown image executes that job's required gates;
aggregation can accept that fresh execution alongside earlier coverage.
Changes to any keyed input require execution. This is deliberately
conservative: unrelated tracked changes also invalidate the key.

The router observes up to 16 recent workflow runs and eight earlier attempts per
run, within a 96-request API budget. Subset retries retain their earlier immutable
validation context and contribute later failures even when that dependency is
not repeated. It accepts repository-local
push/PR jobs only, independently verifies their Git checkout/tree/base, and pins
the original run, attempt, job and result digest. A unique successful execution
admission and completion marker are required. The marker follows result upload;
covered work cannot publish an original-execution marker. Execution timestamps,
rather than run creation IDs, establish retry order. A later failed or ambiguously
overlapping gate invalidates its older pass. A completed successful gate remains usable when a
different gate failed. Missing, cancelled, skipped, ambiguous, expired or
unobservable original proof requires execution at routing time. These bounds
and GitHub evidence retention can cause safe cache misses. The router verifies
the original attempt's unique unexpired upload, its creation within the original
job, archive digest, exact result bytes/identity, raw output and referenced native
artifacts. Unreadable, missing or changed members require execution. Archives are
inspected without extracting their paths into the checkout.

Reused group records claim zero current cases, artifacts or test-child execution.
The aggregate accepts a mixture of original coverage and actual current groups,
reobserves original proof immediately before acceptance, and counts only current
execution as current cases. Changed or missing final proof fails the aggregate.
Actual emulator consumer outcomes decide whether retained emulator proof is still
needed after a runtime fallback. Each covered emulator consumer fingerprints its complete original reference;
the final recheck must match that exact original, including its run/attempt/job,
result and retained archive. A different successful producer cannot replace it.
The observer keeps its existing `full`/`reuse`
attestation protocol; the report separately retains precise group modes and
original emulator references. Only an entirely executed cohort can publish the
original full-producer marker.
The hosted workflow requires these input passes; legacy completion markers alone
cannot bypass retained-proof checks. The legacy command API retains its existing
complete canonical-producer validation for compatibility.
Only a fully executed run can publish the legacy full-cohort producer marker.

The router and aggregate have read-only Actions access for original-job
observations. Tokens are not written to evidence. Local `npm test`, exact review
receipts, the current diff gate, deployment verification and Pages checks retain
their existing boundaries. Original native reports retain their original commit
identity; reuse does not claim another native execution for the consumer SHA.
