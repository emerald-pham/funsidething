# Focused agent preflight

The repository pins the official actionlint v1.7.12 release. Set it up explicitly
once for this checkout, then run the read-only workflow check:

```sh
npm run agent:setup-workflow-validator
npm run agent:validate-workflows
```

Setup verifies the upstream release archive SHA-256 and stores the executable
and extracted executable SHA-256 values and stores it under the ignored,
checkout-local `node_modules/.cache` directory. Validation never downloads or
installs tools. Its optional external ShellCheck and Pyflakes integrations are
explicitly disabled so their presence on `PATH` cannot change the result. If
the pinned executable is absent or invalid, validation fails with the exact
setup command. To preserve a JSON validation receipt, pass `--evidence-file
<path>` to `agent:validate-workflows`; without that option it prints a bounded
source hash and validator result and writes no files.

From the repository root, run this before shell packaging and the expensive final regression. It first validates the current `.github/workflows` bytes with the pinned actionlint setup, then runs the focused copy checks, current test-group registration checks, and test-first/rationale checks. Missing or invalid actionlint setup stops preflight before any test child starts. The validator prints the sorted workflow content hash and writes no files unless an evidence path is explicitly supplied to its standalone command.

```sh
node scripts/agent-tools/preflight.mjs [--base <ref>]
```

The command runs the existing default-sky wording test and Quick start FAQ brevity test from `tests.js`. When `index.html` differs from any distinct local comparison, it also runs the exact unreadable-device recovery FAQ test that checks the Quick start answer and current Changelog. It then invokes the existing `scripts/test-first-gate.mjs` validator for each distinct comparison commit and the existing read-only test-group registration pipeline. Each selected test runs once. `--help` and invalid arguments launch no children. It prints each selected result and validator summary, names a failing comparison, exits nonzero on a failure, and fails closed if a selected named test is missing, renamed, duplicated, skipped, or fails. The test-group check reuses the group runner's inventory, assignment, and added-registration validators; it does not launch a group or write evidence.

With no `--base`, the command uses the first available merge base from `origin/main`, `main`, or `master`. Pass `--base <ref>` to choose the comparison explicitly.

It also checks the current branch's published upstream tip when configured. Identical resolved comparison commits run only once. A branch with no upstream (or a detached checkout) keeps the selected-base check. An invalid explicit ref, unavailable configured upstream, or real Git error fails clearly.

All comparisons use the existing local ref snapshot. Preflight performs no fetch, write, checkout or branch/configuration change. It does not launch the full suite, group suites, browsers, servers, or emulators. Follow the existing start-of-work `git fetch origin --prune` prerequisite in [cleanup](cleanup.md) before relying on those refs; preflight cannot establish that a remote has not changed since the fetch.

A preflight pass covers only pinned static workflow validation, the selected focused copy checks, current group registration metadata, and test-first/rationale validation. It is focused evidence, not release proof. Continue the required full suite, rules, compatibility, CI, exact-release, deployment, and live checks under the [workflow](workflow.md) and [release gates](release-and-review.md).
