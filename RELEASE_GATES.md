# Risk-based exact-SHA release gate

Every release candidate receives an owner review of its exact diff. The release
validator derives the minimum review plan from the candidate's exact
base-to-commit diff; the input cannot choose a lower-risk plan. An optional
`additionalSpecialistDomains` input may add known domains to raise the review
plan, but it cannot replace or remove any domain derived from the diff, and its
value is bound into the receipt. Ambiguous auth, state-persistence, and
session-persistence changes fail closed to their relevant specialists. Pure
documentation, comments, copy, and repository housekeeping with no executable,
configuration, test, release-gate, data, or product-behavior change need only the
owner's exact-diff review. Ordinary code or behavior needs one independent
code/behavior review. Shared session state, callable or authorization behavior,
Firestore rules, deployment or authentication infrastructure, data migration,
memory, cloud persistence, and synchronization need the relevant specialist
review. When both code behavior and a specialist domain are materially affected,
record both independent reviews. When only one domain is affected, only its
reviewer is required.

Schema version 1 receipts retain their original review policy: both a
memory/cloud/sync audit and a distinct code/behavior review are required. They
also publish a third specialist-compatibility status bound to the same receipt;
that context does not claim an additional human review. New receipts use schema
version 2 and the risk plan derived from the exact diff.

## Prepare and record evidence

Create the final candidate commit first. Record its full 40-character commit
SHA, tree SHA, and intended base SHA. Every schema version 2 input includes an
owner exact-diff review with a specific risk rationale. It includes an
`independentReview` only when `reviewPlan.requiresCodeReview` is true and a
`specialistReview` only when `reviewPlan.requiresSpecialistReview` is true. Add
`additionalSpecialistDomains` only when the owner identifies an ambiguous
high-risk domain the exact-diff classifier did not derive; values must be known
specialist domain names, and they only add to the plan. The validator derives
and stores `reviewPlan`; callers do not provide it. Reviewer task identities
must be distinct from the owner and from each other.

The schema version 2 input has this shape; include only the review objects
required by the derived plan:

```json
{
  "schemaVersion": 2,
  "candidate": {
    "commitSha": "<full candidate SHA>",
    "treeSha": "<full candidate tree SHA>",
    "baseSha": "<full intended base SHA>"
  },
  "additionalSpecialistDomains": ["security-deployment"],
  "ownerReview": {
    "task": "<owner task identity>",
    "outcome": "approved",
    "reviewedSha": "<same full candidate SHA>",
    "completedAt": "<UTC ISO timestamp with milliseconds>",
    "summary": "<specific exact-diff self-review result>",
    "scope": {
      "fullDiff": true,
      "rationale": "<why the owner believes the derived review level fits>"
    },
    "evidencePath": "/absolute/path/to/owner-review.md",
    "evidenceSha256": "<64 lowercase hex characters>"
  },
  "independentReview": {
    "task": "<independent code reviewer task identity>",
    "outcome": "approved",
    "reviewedSha": "<same full candidate SHA>",
    "completedAt": "<UTC ISO timestamp with milliseconds>",
    "summary": "<specific full-diff and relevant-test result>",
    "scope": {
      "fullDiff": true,
      "relevantTests": true,
      "userVisibleAndDataSafety": true
    },
    "evidencePath": "/absolute/path/to/independent-review.md",
    "evidenceSha256": "<64 lowercase hex characters>"
  },
  "specialistReview": {
    "task": "<independent specialist task identity>",
    "outcome": "approved",
    "reviewedSha": "<same full candidate SHA>",
    "completedAt": "<UTC ISO timestamp with milliseconds>",
    "domains": ["<exact domains printed in the derived plan>"],
    "summary": "<specific specialist review result>",
    "scope": {
      "fullDiff": true,
      "relevantTests": true,
      "userVisibleAndDataSafety": true
    },
    "memoryScope": {
      "memory": {
        "affected": false,
        "rationale": "<specific memory impact rationale>",
        "tests": []
      },
      "cloud": {
        "affected": true,
        "rationale": "<specific cloud impact rationale>",
        "tests": ["<focused test name>"]
      },
      "sync": {
        "affected": false,
        "rationale": "<specific synchronization impact rationale>",
        "tests": []
      }
    },
    "sources": [
      { "path": "/absolute/path/to/memory/source", "sha256": "<64 lowercase hex characters>" }
    ],
    "evidencePath": "/absolute/path/to/specialist-review.md",
    "evidenceSha256": "<64 lowercase hex characters>"
  }
}
```

For a memory/cloud/sync specialist domain, include `memoryScope` and absolute
fingerprinted `sources`. Each data domain records an affected decision and
specific rationale; each affected domain lists focused tests. A fully
unaffected assessment is valid when it includes at least one focused
preservation test across the assessed domains. Other specialist domains name
their exact domain list and relevant test evidence in the specialist report.
The owner always reviews the full diff, including when one or two independent
reviews are also required.

The recorder verifies the candidate tree and base, derives the review plan,
checks reviewer identities and evidence digests, and copies reports with an
immutable manifest under the shared Git metadata directory at
`funsidething-release-evidence/<candidate-sha>/`. It refuses to replace an
existing receipt. Evidence remains outside the committed tree. Source
fingerprints capture what the specialist read at review time; later unrelated
edits do not rewrite a receipt for that exact candidate. Any candidate SHA
change requires a new receipt and affected reviews.

Verify a receipt locally with `npm run release:verify -- <candidate-sha>` before
publishing its statuses.

## Local push check and GitHub statuses

Run `npm run release:install-hook` once per clone. It installs one pre-push
dispatcher in the shared Git directory, chains an existing default hook, and
refuses to replace a custom `core.hooksPath`. Every outgoing non-deletion tip
needs a valid exact-SHA receipt, and the current worktree must be clean. An
older checkout without the validator fails closed.

After recording a receipt, run `npm run release:publish -- <candidate-sha>`
while authenticated with `gh`. Schema version 1 publishes the established
`funsidething/memory-audit` and `funsidething/independent-review` contexts plus
`funsidething/specialist-review` as a compatibility status with the same legacy
receipt/base binding; no extra schema-v1 specialist report is implied. Schema
version 2 publishes all three contexts with compact status descriptions that
bind the full receipt digest, base SHA, a 12-character review-plan digest
prefix, and the code/specialist-required bits. The publisher sends all three
contexts for every schema version 2 receipt so the branch-protection context
set stays stable. A version-2 receipt requires an `independentReview` exactly
when the code bit is set and a `specialistReview` exactly when the specialist
bit is set. The legacy
`memory-audit` context remains a successful compatibility status; it does not
assert a separate memory audit for schema version 2. Status publication occurs
only after the publisher validates the exact receipt and every required review.

The `main` ruleset must keep its existing checks and require all three contexts
for pull requests and main updates:
`funsidething/memory-audit`, `funsidething/independent-review`, and
`funsidething/specialist-review`. Direct pushes to main are blocked by the Pages
deployment verifier because they have no merged pull request with matching
evidence. A PR approval count does not replace the exact-task reviews recorded
in the receipt.

## Deployment verification and limits

Before Pages deploys, CI resolves the merged pull request for the pushed commit,
checks that its head tree exactly matches the deployed tree and is based on the
exact pre-deploy main commit, then requires successful latest statuses on that
exact reviewed head. It accepts the original schema version 1 receipt and
two-review bindings only when all three current contexts are successful, or the
schema version 2 receipt, base, and conditional-review bindings. If a schema-v1
candidate already has a valid receipt but lacks the specialist-compatibility
status, republish statuses for that same exact head before merge/deployment.
Missing, stale, mismatched, or failed evidence stops deployment.

GitHub Actions cannot read a developer's local Git metadata receipt. Deployment
therefore validates status descriptions bound to the immutable receipt digest
and review-plan marker. A repository writer with permission to publish commit
statuses, or an administrator who can bypass repository protections, can forge
those statuses. The validator checks exact diffs and receipts locally, but no
status can prove that a person actually read or reviewed them. Retain owner,
code, and specialist reports as evidence of those human actions.

## FAQ coverage evidence

Product candidates also require `faqReview` with the same approved exact-SHA,
completedAt, summary, scope, external evidencePath and evidenceSha256 shape as
`independentReview`. Use a reviewer task distinct from owner, code, and specialist
reviewers. The immutable receipt copies `faq-review.md`; verification checks its
bytes and exact candidate. The derived plan includes `requiresFaqReview`, which
is bound into the published review-plan digest and deployment status checks.
Review Settings-aligned sections, all changed behavior, and past feature gaps.
Unverified runtime or persisted-data claims must remain qualified.

FAQ-approved schema-version-2 receipts publish compact `v=3` status bindings
within GitHub’s 140-character limit. Earlier schema-version-2 receipts retain
`v=2`; historical pre-policy legacy evidence stays supported. Local verification
and Pages reject older publisher bindings for candidates carrying this FAQ
policy. The policy is read from exact committed AGENTS.md, including the
exact head and base in CI’s full release-evidence checkout; missing review
objects fail closed.

Full main history does not include a squashed PR head after automatic branch
deletion. Deployment verification fetches the associated merged PR's retained
`refs/pull/<number>/head` when that exact object is absent, then requires its SHA
to match GitHub's reviewed head before deriving policy. A missing, invalid, or
moved ref fails closed; fetching does not replace the deployed checkout.
