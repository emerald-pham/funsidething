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

The recorder prints the JSON record path to stderr before starting the child. It prints the sanitized child output when the child exits. A normal run returns the child's exit code; an interrupted run returns 128 plus the signal number. Both the child's result and the recorder's wrapper exit code are stored in the record. A missing executable is recorded as a launch failure and returns 127.

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

Built-in redaction covers common credential keys, bearer values, and GitHub tokens. Add repeatable JavaScript regular expressions with `--redact-pattern 'PRIVATE-[A-Z0-9]+'` for project-specific formats. Redaction runs before command arguments, output, source/test text, diffs, source paths, and correction notes are written. The record marks whether redaction occurred and lists per-field counts. Contents and diffs of files with sensitive names (including a sensitive previous rename path), and binary patch/content payloads, are omitted. Sanitized `path` and `previousPath` metadata remain in the record; symbolic links record their sanitized link target without following it.

On SIGINT or SIGTERM, the recorder forwards the signal to its owned process group on POSIX systems, then escalates to SIGKILL after a bounded 750 ms grace period. The record includes the signal, cleanup scope, and result. On Windows, cleanup is limited to the direct child. A child that deliberately starts a detached process is outside the owned process group.

SIGKILL, power loss, or host failure can stop the recorder before it writes a final record or cleans up. The last durable record may still say `prepared` or `running`; treat it as incomplete and do not claim a finalizer ran. The recorder writes the initial record before starting the child, but it cannot guarantee that child output is retained after an uncatchable termination.

Generated records are inspectable provenance, not tamper-proof attestation. A purpose label does not prove test authorship order, and hashes do not prove that a test exercised the intended behavior. The edit hook and rationale gate enforce structural test-change requirements; they do not prove command chronology. Review the actual test, saved RED output, and command order. Keep the existing test-first, rationale, review, and release gates in [TDD and regression gates](tdd-and-regression.md) and [release and review](release-and-review.md).
