# Focused agent preflight

From the repository root, run this before shell packaging and the expensive final regression:

```sh
node scripts/agent-tools/preflight.mjs [--base <ref>]
```

The command runs the existing default-sky wording test and Quick start FAQ brevity test from `tests.js`, then invokes the existing `scripts/test-first-gate.mjs` validator for each distinct comparison commit. Each selected copy check runs once. `--help` and invalid arguments launch no children. It prints each selected result and the validator output, names a failing comparison, exits nonzero on a failure, and fails closed if either named test is missing. The validator keeps its current commit-diff behavior.

With no `--base`, the command uses the first available merge base from `origin/main`, `main`, or `master`. Pass `--base <ref>` to choose the comparison explicitly.

It also checks the current branch's published upstream tip when configured. Identical resolved comparison commits run only once. A branch with no upstream (or a detached checkout) keeps the selected-base check. An invalid explicit ref, unavailable configured upstream, or real Git error fails clearly.

All comparisons use the existing local ref snapshot. Preflight performs no fetch, write, checkout or branch/configuration change. Follow the existing start-of-work `git fetch origin --prune` prerequisite in [cleanup](cleanup.md) before relying on those refs; preflight cannot establish that a remote has not changed since the fetch.

A preflight pass covers only those focused copy checks and test-first/rationale validation. Continue the required full suite, rules, compatibility, CI, exact-release, deployment, and live checks under the [workflow](workflow.md) and [release gates](release-and-review.md).
