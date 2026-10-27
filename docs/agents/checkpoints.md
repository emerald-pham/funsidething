# Compact release checkpoints

Use a checkpoint when a release attempt needs a resumable, source-bound summary of required gates and separate follow-up investigations. The command validates supplied release records and manages durable diagnostic admission. The recorder remains the local child-process launch boundary.

## Record shape

Each version 1 JSON record contains:

- `id`, `revision`, and `source` with the exact 40-character `commit`, `tree`, and ancestor `base` SHAs.
- `requiredGates`, each with an `id`, `status`, short `summary`, and `evidence` pointers. Gate statuses are `pending`, `failed`, `cancelled`, `unresolved`, or `passed`.
- `followUps`, each with an `id`, `status`, short `summary`, and evidence pointers. Follow-up statuses are `unverified`, `in_progress`, or `complete`; an unverified physical or private follow-up remains visible without blocking release completion.
- `status` and `nextAction`. An `open` record has exactly one next action naming an incomplete required gate. A `complete` record has every required gate passed and `nextAction: null`.

Evidence pointers contain a unique `id`, absolute artifact `path`, `sha256`, `sourceCommit`, and `sourceTree`. The command hashes the file and checks its Git source identity. Every passed required gate needs at least one pointer for the record's exact current source commit and tree. Historical failed evidence may point to an earlier source and remains unchanged when a record is resumed.

The checkpoint JSON is limited to 32 KiB, 32 gates and follow-ups each, and 32 evidence pointers total. Evidence files have no byte-size cap: the command hashes each file through a fixed-size buffer, samples its size before reading, rejects growth past that size, and checks the file's size and timestamps again afterward. Pointers are fingerprints, not embedded reports.

## Create, validate, and resume

Create writes a new checkpoint and refuses to replace an existing path:

```sh
node scripts/agent-tools/checkpoint.mjs create \
  --repo "$PWD" \
  --input /absolute/path/checkpoint-input.json \
  --record /absolute/path/checkpoint-v1.json
```

Validate checks an existing record against its local Git objects and evidence files without changing it:

```sh
node scripts/agent-tools/checkpoint.mjs validate \
  --repo "$PWD" \
  --record /absolute/path/checkpoint-v1.json
```

Resume takes a complete next-revision JSON input and writes it to a new path:

```sh
node scripts/agent-tools/checkpoint.mjs resume \
  --repo "$PWD" \
  --previous /absolute/path/checkpoint-v1.json \
  --input /absolute/path/checkpoint-v2-input.json \
  --record /absolute/path/checkpoint-v2.json
```

Resume retains the checkpoint id and source, increments `revision` once, keeps every prior gate and follow-up, and preserves each prior evidence pointer byte-for-byte. It writes the new file through a same-directory temporary file and an atomic no-clobber link, leaving the previous checkpoint intact if validation, writing, or publication fails.

The command verifies caller-declared gate states, exact Git object identities, and evidence-file fingerprints. It cannot attest that a command or review actually ran, authenticate a human approval, or verify a private/physical investigation. Keep those limits visible in the summaries and point to the actual evidence.

## Durable diagnostic authorization

For a diagnostic task, use the same checkpoint family before its supported
launch. `prepare --repo <worktree> --task <issue>` fetches that ticket and its
`## Parent` issue with complete current bodies/comments. It creates a
`.diagnostic-task.json` source manifest and a private signing key under the
common Git directory. Inspect and commit the manifest, then run:

```sh
node scripts/agent-tools/checkpoint.mjs start \
  --repo "$PWD" --task 286 --input /absolute/path/diagnostic-plan.json
node scripts/agent-tools/checkpoint.mjs inspect --repo "$PWD" --task 286
```

The plan supplies an exact ancestor `base`, failed required `gate`, one
`nextAction`, `owner`, `allocation`, `hypothesis`, `observation` with an
`expectedExitCode` and `stdoutIncludes`, finite `allowance` (1–20), tracked
`sourcePaths`, relative public `entrypoints`, and exact `launch` with `command`
and `args`. These inputs choose the diagnostic contract and require owner review;
matching output alone cannot establish that an investigation fixes the product.
The manifest remains diagnostic-only even after a matching successful result.

The common-Git-directory journal retains one current task, immutable revisions,
full starting issue content/fingerprints, exact source/base/tree, attempts,
results and explicit extensions. Other worktrees and renamed branches recover
the same allowance. `inspect` is read-only. A status question grants no attempt.
Unrelated recorder commands retain their ordinary behavior.

Run a supported local probe through the existing recorder with
`--diagnostic-task 286` and an optional stable `--diagnostic-request <id>`.
Registered public entrypoints and the existing WebKit capped `--run` consumer
also require diagnostic authorization when the recorder recognizes them. The
recorder admits under a token-independent directory lock and persists the attempt
before spawning. Repeating the same request observes it. The next distinct
attempt requires consumption of the actual terminal recorder artifact:

```sh
node scripts/agent-tools/checkpoint.mjs consume \
  --repo "$PWD" --task 286 --attempt <attempt-id>
```

Consumption re-fetches source authority, checks actual recorder source and
immutable result bytes, and derives exit/output observations against the
predeclared observation. A predicted failing probe retains an unresolved required
gate. `change-source --input <next-plan>` records a material tracked-input change,
new hypothesis/observation and next action; it retains failures and remaining
allowance. Observer-only commits, wording changes and new contexts cannot earn
another identical regression. `hold --reason <actual-blocker-or-user-hold>`
records a real stop; it does not complete the task. Interrupted locks and missing
terminal results fail closed for owner investigation.

### Routing observations and authorized issue refreshes

`record-routing --input <routing.json>` records all six current gate decisions,
complete input keys and validation context, plus each retained original
run/attempt/job/result/artifact identity. It checks the current Git source and
complete pass identities, then stores the exact routing bytes as a fingerprinted
immutable journal observation. It neither launches work nor changes the failed
gate, frozen source, attempts or allowance. Resume still reobserves GitHub proof.

When the owner explicitly authorizes an updated issue specification, use
`refresh-authority --input <refresh.json>`. The exact input fields are
`expectedTaskFingerprint`, `expectedSourceFingerprint`, `currentTaskFingerprint`,
`currentSourceFingerprint`, `reason`, and `authorizationEvidence` with an absolute
`path` and `sha256` for the saved owner authorization. The command fetches the
same task and parent with full bodies/comments, verifies both old and current
fingerprints, and snapshots the previous/current authority and authorization.
Consume any admitted observation first. Extra fields, unchanged authority or
mismatched source fail closed. Original snapshots, failures, starting source
fingerprint, frozen inputs and finite remaining allowance remain intact. This
operation grants no diagnostic attempt, launch or extension; extensions retain
the separate owner-comment verification below.

### Explicit extensions

`extend --approval <approval.json>` requires an exact current journal digest
(from `inspect`), source, task, repository and bounded `additionalAttempts`
(1–20), `approvedBy`, `reason`, `commentUrl`, and an `authorizationEvidence`
path/SHA-256. The evidence file must contain exactly a repository-owner GitHub
comment body authorizing `task`, `repository`, `priorDigest`, `sourceCommit`,
`additionalAttempts` and `reason` as JSON. The command fetches that comment and
checks its URL, owner identity, association and exact authorized values. An approval in the bound task or parent is accepted only as one exact appended
verified owner comment; every earlier comment and all other scope fields must
remain unchanged. The journal preserves the prior full source and the authorized
append. A separate existing approval issue also remains supported. Retain both local artifacts; later mutation,
deletion, revocation or replay blocks admission. A caller-authored approval file
without the source comment grants nothing.

### CI and publication boundaries

`admit --input <exact-launch.json> --record <future-result-path>` reserves a CI
launch through the same admission API. `export --attempt <id> --record <bundle>`
signs its unfinished private authorization. For publication use `export-public`
with the same options: it signs only current authority fingerprints, finite
attempt/source identity and verified extension comment references. It excludes
private issue snapshots, local result paths and signing material. `verify-ci --input <bundle> --commit <sha>`
independently verifies that bundle in a separate clone against the committed
manifest key, exact task/source/tree/input identities, current issue authority
and first GitHub run attempt. Runtime adapters call
`assertDiagnosticRuntimeAllowed(repo, commit, bundlePath)` before creating a
browser/container. The release adapter calls
`assertDiagnosticPublicationAllowed(repo, commit)` at receipt/publication gates;
it rejects diagnostic-only source even when the caller omits diagnostic flags,
and rejects lost manifests on known diagnostic ancestry/workflows.

The nonqualifying path in `scripts/release-evidence.mjs` consumes that public
admission through the following existing-command extensions:

- `diagnostic-plan <source> <frozen>` derives exact eligibility. The registered
  `webkit-native-attribution-v1` template fixes reviewed product `b176026825e4f9539780f745fe60e09cf348d288`
  and canonical observer `c899e5e983cd756152c1d0c8057ffe8455e80956`.
  The complete app, dependencies, original authorization, caps, deadlines, input
  and readiness contracts remain byte-identical. Unknown templates or deltas
  require ordinary review/qualification.
- `diagnostic-record <input.json>` binds exact source/base/tree, finite attempt,
  frozen product/FAQ receipt, unchanged rendered artifacts, independent code
  review and memory/security/release-process review. Valid frozen reviews can
  belong to a candidate with failed CI; that failure remains unpaid. The input
  also names `governance.commitSha`: the exact normally reviewed protected
  default-main checkout, with its independently verified merged review/status
  binding, commit/tree/workflow identities. It names one exact outgoing `diagnose/` ref and prior remote SHA. The installed
  pre-push hook permits only that update. All other updates keep their ordinary
  release requirements, and main/tag promotion is refused.
- `diagnostic-launch <source>` independently rechecks evidence and fresh full
  issue authority before remote side effects. A create-only canonical
  `refs/tags/chain-diagnostics/task-<issue>/attempt-<ordinal>/reservation` ref
  reserves the existing source before any bundle blob/tree/commit is written.
  The immutable `permit` ref contains selected review artifacts and a signed
  public admission. A matching duplicate only observes; a pending reservation
  after a crash remains unresolved and never auto-redispatches or renews budget.
- `diagnostic-ci-run --repo <diagnostic-checkout> <permit-ref> <permit-object> <source> <run-id> 1 <output-dir> prepare-reviewed-native-tools`
  independently verifies the bundle, exact checkout and fresh GitHub workflow
  run. A create-only `claim-reservation` and immutable `claim` bind one actual
  run attempt before the capped runtime starts. A duplicate does not start a
  second child. The generated consumer imports a separate reviewed diagnostic
  policy adapter: ordinary push/PR policy delegates to the original canonical
  policy, while the new governed entrypoint accepts actual `workflow_dispatch`
  only after permit/claim verification. This is a new nonqualifying event policy.
- Collect the same run with the existing `agent:ci-monitor` command. Then
  `diagnostic-consume <source> <input.json>` takes `monitorSummaryPath` and
  `monitorSummarySha256`. It binds saved raw logs, fresh exact run/jobs,
  immutable permit/claim, remote artifact ZIP digest, terminal source/tree/run
  and output/report hashes before attaching and consuming the journal result.
  Missing, stale, ambiguous or tampered evidence stays unresolved. The current
  observer retains native stacks or an explicit unavailable/partial outcome;
  its required gate stays failed even if the child exits zero. No diagnostic result grants product status.

The dispatch runs on protected default `main`, with the actual workflow/run and
artifact head bound to reviewed governance. The diagnostic source is a separate
checkout and explicit permit input. Both checkouts disable persisted credentials.
The parent checks fresh issue authority, protected head, exact normal release
review/status binding and canonical run/attempt before issuing a one-use inherited
channel to a credential-free source host guard. That guard checks signed inputs,
source/run/claim context, expiry, actual parent/child kernel identity and immutable
governance invocation. It consumes/closes the channel once. Environment text alone,
preload/module-path injection, wrong/stale/replayed context and a non-governance
parent cannot authorize a runtime. `verify-ci` always performs its online authority
check. Kernel PID/argv/executable checks do not cryptographically attest JavaScript;
the trust root is the protected workflow executing reviewed governance.

The supported workflow always supplies the literal `prepare-reviewed-native-tools`
mode. After the winning claim it downloads only reviewed Noble amd64 package URLs,
checks package and every selected ELF SHA-256/build ID, and creates a generated tool
artifact outside candidate source and Git metadata. The unchanged browser-family
container mounts it read-only at `/opt/chain-native-tools`. Only perf uses its pinned
loader/library path; WebKit retains its original image/libraries. Profiler processes,
ring buffers and symbolization run inside the original 1,000,000,000-byte browser
cgroup with zero swap, dropped capabilities, read-only root and unchanged deadlines.
No runtime apt, network, privilege or capability relaxation is permitted. Missing
tooling mode produces a durable unavailable result on the used claim, with zero
runtime children and no renewed allowance.

`diagnostic-native-control <empty-external-output>` captures one fixed known native
workload using actual native tools. Linux uses the reviewed reproducible amd64 ELF,
source/build command/toolchain hash/build ID and independently named hot-loop symbol;
macOS uses its actual compiler and `sample`, separately attributed. Retained coverage
and symbolization gaps remain explicit. `diagnostic-native-verify <report>` performs
fresh verification; a missing Linux app source binding cannot qualify attribution.
`diagnostic-native-toolchain-prepare` and `diagnostic-native-toolchain-verify` prepare
or verify only the fixed governance package inventory, without accepting caller URLs
or approvals. These commands do not grant release authority.

The normal reviewed governance release and default-branch workflow registration,
actual Linux known-workload sampling and one bounded WebKit startup capture remain
hosted prerequisites until observed. Local Mac native controls, generated source
patches, package-byte verification and fake-GitHub process tests establish none of
those hosted outcomes or a causal product repair.

Local locks/hooks and signed bundles enforce supported paths, not arbitrary
writer/admin actions. A writer can replace Git metadata, keys, manifests or code;
a credential owner can invoke raw commands, replace approval comments or bypass
hooks. Source/release review and independent CI retain that trust boundary.
Neither these controls nor a local process pass establish hosted qualification,
physical-iPhone repair or recovery of a private board.
