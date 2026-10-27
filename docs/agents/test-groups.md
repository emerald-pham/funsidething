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

Ordinary full and same-source covered runs retain actual event-checkout
test-first, Firestore rules and compatibility execution. Main executes its own
full cohort unless the narrow policy-prose inheritance path below is proven.
Pages still requires both `scanner-tests` and `release-evidence`; same-run
artifact reads add no token permissions.

For instruction-preserving policy prose, `policy-reuse` keeps the current
source/base/tree and review evidence separate from the exact base's original
full execution. All four `--covered` records have zero current cases,
artifacts or child execution. The aggregate rederives the frozen inventory,
validates current policy statuses, re-observes the full producer, and reports
`policy-covered` with zero current case count. Rules and compatibility are
inherited only after their original successful execution steps are verified;
the current test-first diff gate still runs. A policy-covered run cannot become
a full producer. Uncertain classification or evidence retains the full current
cohort. The [release procedure](../../RELEASE_GATES.md#policy-prose-inheritance)
owns product/FAQ/rendered receipt inheritance and its limits.

## Early populated startup admission

The product workflow runs `scripts/early-ci.mjs` before event gates and all four
regression groups. It verifies the saved synchronous-predicate, allocated-port,
primary-error and real modal-release consumers, then the original required
400-task mobile WebKit story in both motion modes. Its imported contract retains
the exact 1,000,000,000-byte browser scope, zero swap, ten distinct trusted Yes
acceptances within two seconds, and original startup/source/durability/frame
checks. `scripts/early-ci-harness-source.json` binds the harness-only import from
`9b5bc1c9d5a87fed022a17706bbb0e69e94757b1` (directly after `b176026`). It advances
no product source or immutable full button inventory. A separately reviewed
canonical profile admits only the required mobile story and the named confirmed
Chromium modal-release harness. The saved native consumer remains preserved as a
source snapshot; its effective profile hook is separately hashed. Five confirmed
harness regressions remain executable. Three newly imported full PR285 product
cases remain exact unexecuted source snapshots rather than becoming prerequisites
for unrelated current-main application routes. Every preexisting main regression
remains applicable and unchanged.

The early job preserves raw children and artifacts in `early-startup-RUN-ATTEMPT`.
The aggregate independently verifies that receipt and the separate 512 MB stress
bundle. Measured application stress failure remains nonblocking; missing,
corrupt, cancelled, skipped, unbound or incomplete execution fails closed. Blocked
groups contribute no executed outcomes. Same-source and policy-prose coverage
require the original full producer's successful early/stress jobs and exact early
receipt attestation; current covered records launch no native children.

Local process fixtures prove ordering and accounting only. A source mismatch or
failed startup story remains a failed release gate. See the bounded
[issue 290 handoff](../releases/issue-290-early-ci.md) for hosted demonstration and
source limits; previous local harness evidence supplies no hosted qualification.

The five confirmed roots retain their existing `native-process` assignments with
`executionStage: early-startup`. Early TAP plus the original saved no-port child
stream establish their actual cases. Each real group command verifies that durable
receipt before launching a child; its ordinary TAP excludes only those cataloged
early roots. The aggregate rederives and counts their cases once from the original
raw streams. Covered records still claim zero current execution. This uses the
existing groups/catalog and adds no accepted skips or competing inventory.

Both matching engines are installed for the early stage. Its inherited TAP reporter
keeps the unchanged saved nested source assertions observable. The long regression
jobs retain their ordinary Chromium setup after early-only WebKit consumers have
finished; local execution still requires the repository's actual runtime/resource
allocation, and process fixtures supply no native proof.
