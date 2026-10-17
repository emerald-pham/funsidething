# Focused agent preflight

From the repository root, run this before shell packaging and the expensive final regression:

```sh
node scripts/agent-tools/preflight.mjs [--base <ref>]
```

The command runs the existing default-sky wording test and Quick start FAQ brevity test from `tests.js`, then invokes the existing `scripts/test-first-gate.mjs` validator. It prints each selected result and the validator output, exits nonzero on a failure, and fails closed if either named test is missing. The validator compares the selected base with `HEAD`; it keeps its current commit-diff behavior.

With no `--base`, the command uses the first available merge base from `origin/main`, `main`, or `master`. Pass `--base <ref>` to choose the comparison explicitly.

A preflight pass covers only those focused copy checks and test-first/rationale validation. Continue the required full suite, rules, compatibility, CI, exact-release, deployment, and live checks under the [workflow](workflow.md) and [release gates](release-and-review.md).
