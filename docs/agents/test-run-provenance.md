# Test-run provenance

Use the recorder for behavioral REDs, GREEN runs, and later sensitivity checks. It runs the child command, writes one JSON record per attempt, and returns the child exit status.

Choose an evidence directory that survives checkout cleanup. In a linked worktree, the common Git directory is outside the worktree:

```sh
GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
EVIDENCE_DIR="$GIT_COMMON_DIR/agent-test-runs/issue-155"
```

Run a test command through the recorder:

```sh
node scripts/agent-tools/record-run.mjs \
  --repo "$PWD" \
  --evidence-dir "$EVIDENCE_DIR" \
  --purpose preimplementation-red \
  -- node --test scripts/agent-tools/record-run.test.mjs
```

### Local qualification readiness

For an expensive local qualification run, opt in to the readiness gate explicitly. It checks that `--repo` is a clean Git worktree root; `CHAIN_NATIVE_CANDIDATE_SHA` and `CHAIN_NATIVE_CANDIDATE_TREE` exactly match its committed `HEAD`; recorder evidence and `CHAIN_NATIVE_OUTPUT` are separate writable directories outside that checkout; and distinct `CHAIN_NATIVE_PORT` and `CHAIN_NATIVE_SMOKE_PORT` values are allocated to this active worktree in the configured host coordination ledger. The resource names are `loopback:127.0.0.1:<CHAIN_NATIVE_PORT>` and `loopback:127.0.0.1:<CHAIN_NATIVE_SMOKE_PORT>`. An allocation held by another active or parked worktree is rejected. The gate rejects `CI=true` for local qualification because the native smoke child switches to ephemeral port 0 and ignores the allocated `CHAIN_NATIVE_SMOKE_PORT`. After readiness succeeds, the recorder automatically runs the standard focused preflight before the requested child. If preflight passes, it selects the existing `startup-browser`, `finite-authority`, and `workflow-context` parent risk wrappers from the assignment registry and executes every wrapper whose source paths changed from the comparison base. A failed, skipped, duplicated, missing, or interrupted selected result stops before the requested child starts.

Allocate both ports to the current active worktree through the host coordination flow first, then set the variables from those resource claims. For example, with the allocated values already exported in the shell:

```sh
GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
EVIDENCE_DIR="$GIT_COMMON_DIR/agent-test-runs/issue-277/recorder"
export CHAIN_NATIVE_CANDIDATE_SHA="$(git rev-parse 'HEAD^{commit}')"
export CHAIN_NATIVE_CANDIDATE_TREE="$(git rev-parse 'HEAD^{tree}')"
export CHAIN_NATIVE_OUTPUT="$GIT_COMMON_DIR/agent-test-runs/issue-277/native"
: "${CHAIN_NATIVE_PORT:?allocate loopback:127.0.0.1:<port> to this worktree first}"
: "${CHAIN_NATIVE_SMOKE_PORT:?allocate a distinct loopback:127.0.0.1:<port> to this worktree first}"
node scripts/agent-tools/record-run.mjs \
  --repo "$PWD" \
  --evidence-dir "$EVIDENCE_DIR" \
  --purpose green \
  --qualification-readiness \
  --summary \
  -- npm test
```

A passing readiness check plus focused preflight is not evidence that the requested child passed or that a native device/runtime recovered. It does not replace the suite's native reports, test-change rationale, review, CI, or release gates. Ordinary behavioral RED/GREEN recording continues to omit `--qualification-readiness` so focused iterations do not require native port allocations.

`--qualification-base <ref>` optionally chooses the comparison for both standard preflight and parent selection; without it, both use the same `origin/main`, `main`, or `master` resolution as preflight. An empty parent selection is recorded as `no_change`: the recorder runs the standard preflight, skips the parent wrappers, and then starts the explicitly requested child. This keeps routine full qualification useful when the candidate did not change a parent contract. The standalone `qualification-contracts.mjs` selector only prints a read-only plan and never launches wrappers or a requested child.

Workflow output, selected parent TAP, and parsed outcomes are saved in a separate private `qualification-preflight/<record-id>/` report. The recorder summary exposes only bounded status, selected contract IDs, comparison identity, and the report path; parent TAP and counts stay out of the requested child's stream and summary. Standard preflight or parent-contract failures return `qualification-failure` (or `interrupted` when signal cleanup ran) with the requested child recorded as not started.

### Local controlled early-group fixture

Use the dedicated fixed mode to run only `group and aggregate retain actual early cases once across fresh group processes` through the recorder:

```sh
NODE22="/Users/emeraldpham/.codex/task-artifacts/retro-278-20261027/runtime/node-v22.23.3-darwin-arm64/bin/node"
"$NODE22" --version
GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
EVIDENCE_DIR="$GIT_COMMON_DIR/agent-test-runs/issue-504/early-group-aggregate"
export CHAIN_NATIVE_PORT=53124 # choose a free loopback port not reserved by another owner
RESOURCE="loopback:127.0.0.1:$CHAIN_NATIVE_PORT"

# Read status and use this worktree's existing active entry ID.
"$NODE22" scripts/agent-tools/coordination.mjs status --file "$CODEX_COORDINATION_FILE"
"$NODE22" scripts/agent-tools/coordination.mjs claim \
  --file "$CODEX_COORDINATION_FILE" --id "$TASK_ENTRY_ID" --resources "$RESOURCE"

"$NODE22" scripts/agent-tools/record-run.mjs \
  --repo "$PWD" \
  --evidence-dir "$EVIDENCE_DIR" \
  --purpose green \
  --summary \
  --local-fixture early-group-aggregate
```

Set `CODEX_COORDINATION_FILE` to the canonical host-wide ledger before these commands, and replace the port and task-entry ID with the values for the current active worktree. The port must be claimed by that entry and available on loopback. The fixture requires the actual Node 22 runtime; it records `process.version`, executes the fixed child with `process.execPath`, prepends that runtime's bin directory to `PATH`, and rejects other Node majors. It creates private per-attempt `HOME`, temporary and XDG directories, removes inherited CI/runner, Node injection, browser-engine, cloud/service and project-specific `CHAIN_*` overrides, then adds back only the canonical ledger and claimed `CHAIN_NATIVE_PORT`. It computes the candidate SHA/tree from the clean committed worktree. Do not use `CI=true` or a personal browser profile.

This explicit fixture profile reuses `validateQualificationReadiness` for a clean root, exact source identity, separate external evidence paths, one current healthy owner lease and one exact claimed loopback resource. Full `--qualification-readiness` keeps its existing two-port checks and never releases its task allocation. The selected group binds the exact claimed port as a real child-owned HTTP server; its controlled browser boundary fetches and records the live HTTP status and fixture document observation in the private diagnostic. The test replaces Playwright's external browser launch. It proves group/process and aggregate propagation with the original nested outcomes; it does not exercise a browser engine or memory/native qualification. The repository-local Playwright package still needs to be installed from the repository's pinned dependencies before running this command.

Each attempt writes a private summary record and streams plus a unique native-output directory, preserving the child producer and nested group/aggregate outcomes alongside the command and source identity. The record separates `fixture.workloadOutcome` from process-group, listener, allocation and private-runtime cleanup. After success, failure or interruption, the mode closes its owned child family and listener, then releases only the exact claimed resource if the original owner, lease digest and resource still match under the coordination lock. A changed or expired identity leaves the allocation in place and reports unresolved cleanup separately. Every terminal attempt consumes/releases this fixture allocation; explicitly claim the same port again under the same active entry before a fresh invocation. Keep evidence outside the checkout in a private directory.

By default, the recorder prints the JSON record path to stderr before starting the child and prints the sanitized child output when it exits. A normal run returns the child's exit code; an interrupted run returns 128 plus the signal number. Both the child's result and the recorder's wrapper exit code are stored in the record. A missing executable is recorded as a launch failure and returns 127.

Pass `--summary` before `--` to emit one bounded JSON line instead of the child streams. It reports the declared purpose, child exit and signal, source identity, evidence status, and sanitized absolute display paths for metadata, stdout, and stderr. A finalized attempt keeps the complete redacted streams in its metadata record and per-attempt `.stdout.txt` and `.stderr.txt` files when those evidence writes complete. The process keeps the child's exit or interruption status; if evidence writes fail while the child otherwise succeeds, it returns 74 and reports `evidence-failure`.

Keep `--summary` opt-in for callers that need compact console output. Default callers continue to receive the complete sanitized streams, and both modes preserve the child's actual status and complete sanitized streams in the saved record; summary mode also writes the per-stream files.

Displayed and persisted evidence paths follow built-in and custom redaction, including qualification-readiness failures, summary preparation failures and the default stderr path announcement. A readiness failure starts no requested child and writes no prepared attempt record. With `--summary`, it uses the preparation-error contract: one bounded `evidence-failure` JSON summary with outcome `not-started`, no child exit/signal and wrapper exit 74. Without `--summary`, it prints a sanitized error to stderr and exits 2. A path containing `[REDACTED]` is descriptive and may no longer resolve. The actual files stay in the caller's chosen evidence directory, named by the record ID and the suffixes above; retain that directory privately for retrieval. Raw destination paths are used only for filesystem I/O.

`--repo` names the Git worktree and is also the child's working directory. `--evidence-dir` must be outside any checkout that may be removed. Each attempt gets a unique record file, so reruns do not replace earlier output. The record separates preparation, child start, child finish, and finalization times. It also retains the declared purpose, working directory, commit, sanitized command and arguments, output, output digest, observed outcome, and changed source/test state. Tracked text changes include sanitized diffs and current content; non-ignored untracked source/test files include sanitized content. Display content and display diffs retain sanitized SHA-256 digests. Separately, `actualBytesSha256`, `actualDiffSha256`, `indexDiffSha256` and the combined `sourceTestDiffSha256` identify actual bytes and Git state without persisting raw payloads. Identity covers all Git-reported nonignored changes, including rules, manifests, lockfiles and assets; sensitive, binary and non-source payloads remain omitted. The `identity` status reports capture errors and names scope/exclusions: ignored files, environment and external runtime state are outside it. The environment is not recorded.

Use one of these `--purpose` values:

- `preimplementation-red` for the test run observed before the behavior implementation.
- `green` for a run after the implementation.
- `later-baseline-sensitivity` for a later restored-baseline or negative-control check.

The purpose is caller-declared. The recorder never infers a preimplementation RED from a later checkout or from a failure. If a later run corrects an earlier record, append a new attempt with both options:

```sh
--correction-of <record-id> \
--correction-note "This later baseline check is not the original RED."
```

The original JSON stays byte-for-byte unchanged, and the new record links to its ID. The referenced record must already exist in the same evidence directory.

The observed outcome comes from the actual process result. Exit code 0 is `passed`; discriminating assertion evidence (`AssertionError`, `ERR_ASSERTION` or an explicit assertion-failed message) is `assertion-failure`; a missing executable is `launch-failure`; recognized syntax or import errors are `infrastructure-failure`; other nonzero results remain `nonzero-exit`. A received SIGINT or SIGTERM is `interrupted` and writes a final `incomplete` record after cleanup. Generic TAP `not ok` and failed-count summaries alone remain `nonzero-exit`; recognized infrastructure errors take precedence. These text classifications use output patterns and are evidence labels, not a judgment that a failure is a meaningful RED.

Built-in redaction covers common credential keys, bearer values, and GitHub tokens. Generic key/value separators stay on one line so a credential-like word cannot consume an adjacent TAP control record; quoted JSON keys can still have multiline values, which are redacted through their closing quote. Add repeatable JavaScript regular expressions with `--redact-pattern 'PRIVATE-[A-Z0-9]+'` for project-specific formats. Redaction runs before command arguments, output, source/test text, diffs, source paths, and correction notes are written. The record marks whether redaction occurred and lists per-field counts. Contents and diffs of files with sensitive names (including a sensitive previous rename path), and binary patch/content payloads, are omitted. Sanitized `path` and `previousPath` metadata remain in the record; symbolic links record their sanitized link target without following it.

On SIGINT or SIGTERM, the recorder forwards the signal to its owned process group on POSIX systems, then escalates to SIGKILL after a bounded 750 ms grace period. The record includes the signal, cleanup scope, and result. On Windows, cleanup is limited to the direct child. A child that deliberately starts a detached process is outside the owned process group.

SIGKILL, power loss, or host failure can stop the recorder before it writes a final record or cleans up. The last durable record may still say `prepared` or `running`; treat it as incomplete and do not claim a finalizer ran. The recorder writes the initial record before starting the child, but it cannot guarantee that child output is retained after an uncatchable termination.

Generated records are inspectable provenance, not tamper-proof attestation. A purpose label does not prove test authorship order, and hashes do not prove that a test exercised the intended behavior. The edit hook and rationale gate enforce structural test-change requirements; they do not prove command chronology. Review the actual test, saved RED output, and command order. Keep the existing test-first, rationale, review, and release gates in [TDD and regression gates](tdd-and-regression.md) and [release and review](release-and-review.md).
