# Release memory and independent-review gate

Every Pages release needs a memory audit and an independent review of the exact candidate commit. A test run, an earlier review, historical release evidence, or a successful build does not replace either receipt.

## Prepare and record evidence

Create the final candidate commit first. Record its full 40-character commit SHA, tree SHA, and the base commit it is intended to release from. The owner, memory auditor, and reviewer must use distinct task identities. The memory audit reads the current memory sources, resolves any conflict with current repository behavior, and records the absolute source paths and SHA-256 fingerprints it actually checked. The reviewer inspects the full final diff, relevant tests, and user-visible or data-safety effects, and names that exact candidate SHA.

Each person writes a concise evidence file outside the checkout. The JSON input to `npm run release:record -- /absolute/path/to/input.json` has this shape:

```json
{
  "schemaVersion": 1,
  "candidate": {
    "commitSha": "<full candidate SHA>",
    "treeSha": "<full candidate tree SHA>",
    "baseSha": "<full intended base SHA>"
  },
  "ownerTask": "<owner task identity>",
  "memoryAudit": {
    "task": "<auditor task identity>",
    "outcome": "pass",
    "completedAt": "<UTC ISO timestamp with milliseconds>",
    "sources": [
      { "path": "/absolute/path/to/memory/source", "sha256": "<64 lowercase hex characters>" }
    ],
    "evidencePath": "/absolute/path/to/memory-audit.md",
    "evidenceSha256": "<64 lowercase hex characters>"
  },
  "independentReview": {
    "task": "<independent reviewer task identity>",
    "outcome": "approved",
    "reviewedSha": "<same full candidate SHA>",
    "completedAt": "<UTC ISO timestamp with milliseconds>",
    "summary": "<specific result of reviewing this candidate>",
    "scope": {
      "fullDiff": true,
      "relevantTests": true,
      "userVisibleAndDataSafety": true
    },
    "evidencePath": "/absolute/path/to/independent-review.md",
    "evidenceSha256": "<64 lowercase hex characters>"
  }
}
```

The recorder checks the candidate and base, verifies source and evidence digests, and copies the evidence with an immutable manifest under the repository's shared Git metadata directory at `funsidething-release-evidence/<candidate-sha>/`. It refuses to replace an existing receipt. Source fingerprints capture what the auditor read at audit time; later unrelated edits to memory sources do not rewrite an already-recorded audit of the same candidate. If a relevant memory instruction changes before the candidate is pushed, refresh the candidate and repeat both checks so the new exact SHA records the current instruction. Any candidate SHA change requires a new audit and review. The receipt remains outside the committed tree and should be retained with release records.

Verify a recorded receipt locally with `npm run release:verify -- <candidate-sha>` before publishing its statuses.

## Local push check and GitHub statuses

Run `npm run release:install-hook` once for a clone. It installs one pre-push dispatcher in the shared Git directory so every worktree uses the same gate, preserves and chains an existing default pre-push hook, and refuses to replace a custom `core.hooksPath`. Every outgoing non-deletion tip must have a valid exact-SHA receipt, and the current worktree must be clean. An older checkout without the validator fails closed.

After recording a receipt, run `npm run release:publish -- <candidate-sha>` while authenticated with `gh`. It publishes `funsidething/memory-audit` and `funsidething/independent-review` success statuses whose descriptions bind the receipt digest and base SHA. The status publisher reads the receipt; it does not create audit or review evidence. A changed candidate needs new evidence and new statuses.

The `main` ruleset must keep its existing required checks and require both status contexts above for pull requests and main updates. Direct pushes to main are blocked by the Pages deployment verifier because they have no merged pull request with matching evidence. Do not remove existing protections or add a PR approval count as a substitute for the independent task review.

## Deployment verification and limits

Before Pages deploys, CI resolves the merged pull request for the pushed commit, checks that its head tree exactly matches the deployed tree and is based on the exact pre-deploy main commit, and requires the latest statuses on that exact reviewed head to succeed with the same receipt digest and base. Missing, stale, mismatched, or failed evidence stops deployment.

GitHub Actions cannot read a developer's local Git metadata receipt. Deployment therefore validates the exact status contexts and their receipt/base binding. A repository writer with permission to publish commit statuses, or an administrator who can bypass repository protections, can forge those statuses. These checks make the required evidence visible and bind it to an immutable candidate; they cannot prove that a person actually read memory or performed the review. Keep the separate task identities and retain the auditor and reviewer reports as the evidence of those human actions.
