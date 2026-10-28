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

The current event-checkout test-first and registration checks always run.
Rules, compatibility and each group use the per-gate original-pass consumer
described below, including on main. Pages still requires both `scanner-tests`
and `release-evidence`; proof reads add no write permissions.

For instruction-preserving policy prose, `policy-reuse` keeps the current
source/base/tree and review evidence separate from the exact base's original
full execution. All four `--covered` records have zero current cases,
artifacts or child execution. The aggregate rederives the frozen inventory,
validates current policy statuses, re-observes the full producer, and reports
`policy-covered` with zero current case count. Rules and compatibility are
inherited only after all six retained original passes and original execution steps are verified;
the current test-first diff gate still runs. A policy-covered run cannot become
a full producer. Uncertain classification or evidence retains the full current
cohort. The [release procedure](../../RELEASE_GATES.md#policy-prose-inheritance)
owns product/FAQ/rendered receipt inheritance and its limits.

Literal roots that newly require a browser may declare
`browserRuntime: "ci-chromium"` on their existing root-assignment row. Before
the full `persistence-recovery` group, the enforcing `ci-pass-reuse.mjs run-group` consumer runs
`--browser-runtime-preflight` only on its fresh path against only those marked titles whose literal
registrations were added since the same comparison base. An empty intersection
produces a durable `no_change` receipt. Otherwise the command requires the
locked Playwright package, launches Chromium from the explicit isolated browser
path, confirms WebKit is absent from that same installation, and runs only the
selected roots in a fresh serial child with inherited browser URLs, module
overrides, profiles and artifact paths removed. It checks the actual TAP
outcomes, duplicate/missing roots, skips, process exit, and cleanup.

The ordinary group requires that successful receipt whenever the selected set
is nonempty, copies its result, TAP, stderr and emitted artifacts into the group
evidence, and binds it to the same source/tree/base, assignment and inventory
hashes. The aggregate repeats that receipt and child-outcome verification. A
covered group verifies matching retained original evidence and launches no
current browser preflight or test child. Changed complete inputs require fresh
execution. The matching
regression workflow installs Chromium alone under
`$RUNNER_TEMP/playwright-browsers`; the earlier WebKit/mobile job remains a
separate stage.

Local use also requires an active healthy entry in the shared host coordination
ledger claiming `browser-runtime:playwright-chromium` and the exact
`loopback:127.0.0.1:<port>` resource. Pass that leased port with
`--native-port`; the runner checks it is available before the child and released
afterward. Hosted CI omits `--native-port` and lets the source fixture choose an
ephemeral loopback port. The runner does not create or modify host allocations.

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
receipt attestation, together with six retained original input passes on the
hosted path; current covered records launch no native children. Ordinary
per-gate coverage alone cannot supply the new required mobile story. The early
consumer selects its actual runner inputs before conditional setup; a runtime
miss executes the story and its separate stress accounting.

Local process fixtures prove ordering and accounting only. A source mismatch or
failed startup story remains a failed release gate. See the bounded
[issue 290 handoff](../releases/issue-290-early-ci.md) for hosted demonstration and
source limits; previous local harness evidence supplies no hosted qualification.

The five confirmed roots retain their existing `core`/`native-process` assignments with
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

The browser runtime child owns a separate POSIX process group. On SIGINT or SIGTERM, the preflight forwards the signal, waits a bounded 500 ms, escalates against only that owned group, finalizes failed evidence with the interruption and cleanup result, and removes its temporary runtime/profile directories. Its exit is 130 or 143 respectively. The shorter grace period lets the existing recorder finish this nested cleanup before its own 750 ms escalation. Uncatchable termination still cannot guarantee final evidence.

The test-first diff gate always runs for the actual event checkout and comparison
base. Pages still requires both `scanner-tests` and `release-evidence`.

### User-excluded Linux saved-scenery comparison

On 2026-10-28 the user requested skipping the Linux portion of checkpoint #504.
Only the final bank-versus-fresh pixel equality in the saved `b176026` Reduced
pending-scene WebKit case is excluded on Linux. Its cause remains unresolved:
three retained hosted candidate executions differ by one red-channel value at
one pixel. The immutable app/tree, source profile and original regression
snapshot remain fixed. This does not establish that the compared pixels match.

The actual consumer still runs. Its durable `late-copy-observation.json` and
TAP diagnostic name the excluded assertion, platform, motion/case, saved app/tree,
landscape and tooling identities, both PNG hashes and observed equality. All
other original pixel cases/platforms, paint counts, copy/current visitors,
400-task and protected-source preservation, and cleanup assertions stay required.
No accepted skip is added. Current-source Normal/Reduced 1 GB mobile acceptance,
512 MB stress integrity, group/aggregate, review and deployment gates remain.
The public process regression controls external browser/network observations to
verify this narrow scope; it provides no Linux raster or native acceptance.

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

The router and aggregate have read-only Actions access for original-job
observations. Tokens are not written to evidence. Local `npm test`, exact review
receipts, the current diff gate, deployment verification and Pages checks retain
their existing boundaries. Original native reports retain their original commit
identity; reuse does not claim another native execution for the consumer SHA.

The durable `routing.json` records all six `gateDecisions`, their complete
input keys, current validation context and each original run/attempt/job/result
and artifact identity. `checkpoint.mjs record-routing --repo <worktree>
--task <issue> --input <routing.json>` snapshots this observation in the existing
immutable checkpoint journal. Resume reobserves the originals; the stored
observation never replaces an execution pass or renews diagnostic allowance.
See [checkpoints](checkpoints.md) for the explicit issue-source refresh operation,
which preserves original snapshots, failures and the finite remaining allowance.

Metadata observations may reuse an independently retained early execution from
a full or mixed producer. The router verifies that producer's actual early and
stress jobs, source/base/runtime identity, capped outcomes and complete raw
uploads. A covered reference cannot become another early origin. Covered early
work starts no current mobile child; a fresh ordinary group still executes its
own assigned roots. Any inherited group, emulator or early evidence keeps the
aggregate mixed/covered and prevents full-product producer authority.

Policy inheritance requires retained original full-product authority. It may
verify an original full exact-base main execution, or directly verify the full
execution of the uniquely merged, independently reviewed candidate whose whole
tree became that main base. The latter binds the merged PR and full review
receipt, original source/base/runtime, all six keyed original jobs, complete
early/stress uploads and original full aggregate. Current policy source equality,
reviews and exact-main checks remain independent. A mixed/covered main is never
an origin, and the lookup never follows an inheritance chain. Missing, changed
or unobservable original evidence falls back to required execution.
