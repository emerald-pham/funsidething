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

### Explicit extensions

`extend --approval <approval.json>` requires an exact current journal digest
(from `inspect`), source, task, repository and bounded `additionalAttempts`
(1–20), `approvedBy`, `reason`, `commentUrl`, and an `authorizationEvidence`
path/SHA-256. The evidence file must contain exactly a repository-owner GitHub
comment body authorizing `task`, `repository`, `priorDigest`, `sourceCommit`,
`additionalAttempts` and `reason` as JSON. The command fetches that comment and
checks its URL, owner identity, association and exact authorized values. Use a
separate existing approval issue so the authorization does not silently change
the bound task/parent authority. Retain both local artifacts; later mutation,
deletion, revocation or replay blocks admission. A caller-authored approval file
without the source comment grants nothing.

### CI and publication boundaries

`admit --input <exact-launch.json> --record <future-result-path>` reserves a CI
launch through the same admission API. `export --attempt <id> --record <bundle>`
signs its unfinished authorization. `verify-ci --input <bundle> --commit <sha>`
independently verifies that bundle in a separate clone against the committed
manifest key, exact task/source/tree/input identities, current issue authority
and first GitHub run attempt. Runtime adapters call
`assertDiagnosticRuntimeAllowed(repo, commit, bundlePath)` before creating a
browser/container. The release adapter calls
`assertDiagnosticPublicationAllowed(repo, commit)` at receipt/publication gates;
it rejects diagnostic-only source even when the caller omits diagnostic flags,
and rejects lost manifests on known diagnostic ancestry/workflows.

The verifier API and process controls are exercised locally. The separately owned,
unlanded WebKit runtime/workflow still needs its preserved integration patch and
hosted execution; this is an explicit remaining acceptance gap. CI transport must
supply the exact signed bundle and keep dispatch/run identity separate from the
actual diagnostic result. A successful dispatch is not a passed required gate.
The verifier alone does not provide a distributed single-use service across
independently dispatched hosted runs.

Local locks/hooks and signed bundles enforce supported paths, not arbitrary
writer/admin actions. A writer can replace Git metadata, keys, manifests or code;
a credential owner can invoke raw commands, replace approval comments or bypass
hooks. Source/release review and independent CI retain that trust boundary.
Neither these controls nor a local process pass establish hosted qualification,
physical-iPhone repair or recovery of a private board.
