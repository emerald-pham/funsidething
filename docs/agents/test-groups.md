# Isolated test groups

`npm test` remains the complete local suite:

```sh
npm test
```

The additional `test:group` entry point runs one explicitly classified group in
its own Node process. Group identifiers are stable: `core`, `scenery`,
`persistence-recovery`, and `native-process`. Each process runs its selected
roots serially. Keep each output directory empty and unique, outside the
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
failures return nonzero.

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
inputs. Changes to any keyed input require execution. This is deliberately
conservative: unrelated tracked changes also invalidate the key.

The router observes up to 16 recent workflow runs and eight earlier attempts of
the current run, within its existing API budget. It accepts repository-local
push/PR jobs only, independently verifies their Git checkout/tree/base, and pins
the original run, attempt, job and result digest. A unique successful execution
admission and completion marker are required. The marker follows result upload;
covered work cannot publish an original-execution marker. A newer failed gate
invalidates its older pass. A completed successful gate remains usable when a
different gate failed. Missing, cancelled, skipped, ambiguous, expired or
unobservable original proof requires execution at routing time. These bounds
and GitHub evidence retention can cause safe cache misses.

Reused group records claim zero current cases, artifacts or test-child execution.
The aggregate accepts a mixture of original coverage and actual current groups,
reobserves original proof immediately before acceptance, and counts only current
execution as current cases. Changed or missing final proof fails the aggregate.
Legacy complete canonical-producer coverage retains its existing validation.
Only a fully executed run can publish the legacy full-cohort producer marker.

The router and aggregate have read-only Actions access for original-job
observations. Tokens are not written to evidence. Local `npm test`, exact review
receipts, the current diff gate, deployment verification and Pages checks retain
their existing boundaries. Original native reports retain their original commit
identity; reuse does not claim another native execution for the consumer SHA.
