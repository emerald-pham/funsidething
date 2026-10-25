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

Test-first, Firestore rules and compatibility gates always run for the actual
event checkout and comparison base, including covered branch pushes. Main
always executes its own full cohort. Pages still requires both `scanner-tests`
and `release-evidence`; same-run artifact reads add no token permissions.

## Required native button gate

The `native-process` group executes the full app through real Chromium and WebKit
DOM clicks. `npm run test:buttons` selects its complete two-engine root locally;
allocate both named browser runtimes and `CHAIN_NATIVE_PORT` in the canonical host
ledger first, and put `CHAIN_NATIVE_OUTPUT` outside the checkout. The runner checks
healthy, unexpired ownership before launch. CI uses the explicit isolated grouped
push or pull-request fixture policy. A missing engine is a failure.

`scripts/button-safety-inventory.json` is the reviewed action and named state
scenario inventory. It also retains opening button/summary and owned action/role consumer template counts from
all committed app JavaScript and HTML. A new or repeated template requires review;
observed unknown controls fail even when their template was already dynamic. Add
an actual supported scenario with an independent expected result when adding a
control or route. Do not regenerate the inventory to bypass missing coverage.
`dormantHandlers` explains old command aliases without pretending to click a
control that no longer renders. Inert, aria-hidden Saved appearance replicas earn
no action coverage.

Each step starts a continuous frame heartbeat before the trusted click, uses an
external transport/deadline watchdog, awaits a strictly true postcondition, and
rejects a maximum frame gap of 1,000 ms. Input of the large copied archive is also
monitored. Unexpected crash, close, reload, navigation, page error, rejected async
work, or browser disconnection fails. The one deliberate Sync reload must visit
the same app route exactly once and reach a new usable document. Sensitivity
controls mount real failures on the Settings click, including Chromium renderer
crash and WebKit throw, rejection and 1,300 ms stall; no physical-device claim is
made from a desktop engine.

The full reports must contain exactly the required successful action outcomes
and state scenarios, with real events, assertions, responsiveness and closed owned
resources. Probe and focused diagnostic reports cannot qualify complete coverage.
`scanner-tests` requires two distinct engine reports, hashes their artifact bytes,
and binds their candidate SHA/tree and inventory hash to the reconciled checkout.
The regular four-group cohort, existing installed-client artifacts and accepted
historical skips remain independently enforced. Synthetic SDK, clipboard, location
and isolated storage boundaries establish repeatable regression evidence only;
they do not establish physical iPhone behavior or recovery of private saved data.

The required workload stories are: “Buttons work with 400 saved tasks without
crashing” and “Buttons work when pressed ten times within two seconds.” Both run
in Chromium and WebKit and block the same required aggregate. Each scenario first
reads back exactly 400 tasks from the real isolated durable device head and its
current board, recording the saved hash and active count. Ordinary Add, editor,
list, Settings, scene, cloud and export/import flows use 400 active tasks. Only
explicitly named sole/final or exhausted scenarios use documented completed or
ineligible padding; that exception cannot stand in for the ordinary active load.

Every reviewed action family also needs a successful rapid outcome. Each burst
records ten real native pointer presses, browser-trusted receipt timestamps, its
wall-clock window of at most 2,000 ms, and exact accepted-click, refused and
disappeared counts. Persistent controls must produce their independently expected
tenth effect, such as even toggle parity, a retained explicit choice, ten identical
copies or ten real downloads. A closing, replaced, disabled or obscured control
can accept fewer clicks. Attempts against an absent or obscured original control
release outside the viewport so they cannot accidentally activate a different
control; those attempts remain explicitly classified and do not earn accepted
click credit. The expected state and exact originals are asserted afterward.
Missing task readback, hidden ordinary load, missing/skipped rapid families,
untrusted or incomplete counts, a slower burst, or unreconciled outcomes fails.
