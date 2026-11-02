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

The oversized Copy → Import → Paste scenario delivers the full archive through
an explicit `ClipboardEvent`/`DataTransfer` fixture (`trusted: false`) to the real
paste consumer. This avoids conflating simulated typing with native paste and
keeps CI independent of the host clipboard. Its monitored input must leave a
bounded text field, protect the complete source bytes, survive Preview → Cancel
→ Preview, and preserve the exact current head and sixteen saved originals.
Actual host Clipboard API and trusted Paste evidence remains a separate native
acceptance artifact; the fixture does not claim that proof.

The full reports must contain exactly the required successful action outcomes
and state scenarios, with real events, assertions, responsiveness and closed owned
resources. Probe and focused diagnostic reports cannot qualify complete coverage.
`scanner-tests` requires two distinct engine reports, hashes their artifact bytes,
and binds their candidate SHA/tree and inventory hash to the reconciled checkout.
The regular four-group cohort, existing installed-client artifacts and accepted
historical skips remain independently enforced. Synthetic SDK, clipboard, location
and isolated storage boundaries establish repeatable regression evidence only;
they do not establish physical iPhone behavior or recovery of private saved data.

The seven extra workload roots are optional diagnostics, separate from the four
required groups. The Data safety `workflow_dispatch` input
`optional_mobile_diagnostics` defaults to false; selecting it explicitly runs the
workload and capped mobile diagnostics. They never supply required group cases or
change the mandatory verdict.

When selected, the workload diagnostics retain the original 400-task story
“Buttons work with 400 saved tasks without crashing” and rapid-action story
“Buttons work when pressed ten times within two seconds.” Desktop workload
scenarios run in Chromium and WebKit; the capped mobile Yes path runs in mobile
WebKit. Each 400-task scenario first reads back exactly 400 tasks from the real
isolated durable device head and its current board, recording the saved hash and
active count. Ordinary Add, editor, list, Settings, scene, cloud and export/import
flows use 400 active tasks. Only explicitly named sole/final or exhausted
scenarios use documented completed or ineligible padding; that exception cannot
stand in for the ordinary active load.

Every reviewed action family also needs a successful rapid outcome. Each burst
records ten real native pointer presses, browser-trusted receipt timestamps, its
wall-clock window of at most 2,000 ms, and exact accepted-click, refused and
disappeared counts. Persistent controls must produce their independently expected
tenth effect, such as even toggle parity, a retained explicit choice, ten identical
copies or ten real downloads. A closing, replaced, disabled or obscured control
can accept fewer clicks. Attempts against an absent or obscured original control
record a trusted down at its former point, then release in a separate neutral
harness document so they cannot accidentally activate a different app control;
those attempts remain explicitly classified and do not earn accepted
click credit. Any accepted click on a different app action fails immediately.
The expected state and exact originals are asserted afterward.
Missing task readback, hidden ordinary load, missing/skipped rapid families,
untrusted or incomplete counts, a slower burst, or unreconciled outcomes fails
the selected diagnostic report. It does not add a mandatory coverage case.

## Optional capped mobile Yes diagnostic

The `mobile-memory` job runs only when the workflow-dispatch
`optional_mobile_diagnostics` input is explicitly selected; its default is false.
The immutable `required-1gb` profile name identifies a retained diagnostic
profile and does not make this job a mandatory release gate. The aggregate
records selected versus unselected separately from the diagnostic status:
`not-run`, `unavailable`, `invalid`, `pass`, `app-failed` or `failed`. None
supplies ordinary group coverage or changes the mandatory verdict.

When selected, the job runs the existing rapid scanner Yes path in mobile WebKit
with 400 saved tasks. Normal/full motion and Reduced motion each use a fresh
container, an explicit 390 × 844 viewport/screen, scale factor 3, iPhone user
agent and real trusted touch input. Each case must accept ten distinct actually
offered task IDs within two seconds, retain the expected durable chain and all
400 tasks, protect unknown fields and retained sources, and finish without
lifecycle, frame, transport or cleanup failures. Native `maxTouchPoints` is
recorded without overriding it; actual trusted touch receipts establish the
input used. This is an emulated mobile WebKit client, not physical iPhone or
private-board proof.

The pinned official Playwright image and matching package run a minimal Node 22
`launchServer` owner in a browser container. Its Linux cgroup v2 limit is exactly
**1,000,000,000 bytes**, with zero swap allowance and use, before any WebKit process
launches. Every browser descendant plus the minimal protocol-server Node shares
this cap; including that Node is conservative evidence for the browser budget.
The actual workload driver and fixture HTTP server run in a separate container,
independently bounded to 2 GiB with no swap, sharing only the exact browser
container's network-none loopback namespace. Neither container exposes a host port,
Docker socket or writable cgroup mount; both retain nonroot UID, dropped
capabilities, read-only root and private tmpfs/shm.

A fresh pair first proves a real kernel OOM kill of a child committing more than twice its profile limit
**inside the live browser's capped group**. Normal and Reduced each use a new
browser/driver pair and retain the complete 400-task, 1 MiB unknown-field,
two-backup, opaque-source and pending-upload fixture and all original timing and
rendering checks. Successful browser cases must have no OOM events and a peak
within the budget. Owner `BrowserServer.close()` and actual engine/container exit
are required; remote `Browser.close()` alone is only a disconnection.

Schema version 3 records immutable `required-1gb` and `stress-512mb` diagnostic
profiles and `browser-family-plus-minimal-protocol-server`, separate container
roles, actual host cgroup/net namespace identities, observed browser process
start identities and executable hashes, pinned image resolution, raw limits,
kernel OOM proof and durable native results. Complete artifact hashes,
source/tree/run identity and both owned-container removals accompany the report.
Historical version1 whole-container and version2 512MB browser-family failures
remain preserved and cannot be relabeled.

Within a selected diagnostic, the `required-1gb` profile retains its original
functional and cleanup checks. A separately recorded 512,000,000-byte stress
profile also runs a fresh live-WebKit kernel OOM control and attempts both
motions, even if Normal fails. Its original native report keeps any application
crash, observed blocked frame or ten-touch deadline failure as a failed stress
outcome. Such measured app failures are nonblocking diagnostic outcomes; missing
execution, source/profile mismatch, driver, transport, control or cleanup faults
remain invalid outcomes. Before app navigation, the actual mobile context and
durable fixture readbacks bind the scenario, viewport, motion, 400 distinct
active tasks, 1 MiB unknown field, two exact protected backups, opaque bytes and
pending record. A startup crash needs that completed setup even without app-ready
or successful story evidence. Mixed transport or unexpected-navigation errors
remain invalid alongside an application crash; only a measured kernel OOM admits
its corresponding engine disconnect. Passing stress cannot substitute for the
`required-1gb` profile evidence inside the selected diagnostic. Both
independently hashed, exact-source bundles remain part of that diagnostic's
integrity record; no arbitrary budget input or historical report relabeling is
admitted.

`scanner-tests` records this optional diagnostic bundle separately from the four
required groups, including when required group coverage is reused. Missing,
failed, incomplete, wrong-source, uncapped or malformed diagnostic evidence is
reported as its own diagnostic outcome; it neither supplies group coverage nor
blocks the mandatory verdict. Local `npm test` retains the parser,
enforcement-refusal and actual aggregation negative controls. Optional native
workload cases require explicit diagnostic selection, and a local run does not
claim a Linux memory-cap pass. A macOS functional run or RSS sample cannot
establish the selected Linux cap diagnostic. This optional diagnostic is not a
merge or release gate; ordinary required checks still need CI to pass for the
exact candidate. The required ordinary button gate retains 60 scenarios per engine in Chromium
and WebKit. The original 90-scenario workload retains its strict controls when
explicitly selected as optional diagnostics.

Hosted button admission preserves `GITHUB_EVENT_NAME`/`GITHUB_REF` separately from
`CHAIN_TEST_EVENT_POLICY`. Routing emits `canonical-pr-merge-v1`,
`outgoing-branch-push-v1`, `exact-main-push-v1` or, for selected mobile
diagnostics, `optional-mobile-dispatch-v1`; these labels remain in report and
aggregate identity. Native desktop and selected capped mobile consumers share
the explicit event/ref check, and the capped child receives all three values.
Raw `push`/`pull_request` fixture labels remain supported only with matching
hosted context. Invalid, missing or local admission cannot waive resource or
kernel limits. Optional mobile diagnostics cannot stand in for any of the four
required groups or another mandatory gate. Local admission/artifact fixtures
never establish an actual hosted cap diagnostic.
