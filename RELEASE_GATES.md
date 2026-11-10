# Risk-based exact-SHA release gate

Verify the applied theme attribute, computed color scheme and paint before
accepting each theme capture; theme labels alone do not establish coverage.

Actual visual tests are mandatory for changed controls or layout. Independent
code and typography reviewers compare each changed control with its established
neighboring control in actual final rendered evidence. Use day and night themes,
ordinary and enlarged mobile/desktop views; check natural disabled/selected states,
native keyboard focus, top, middle and end task scrolling, before/after row
heights, group/pane spacing, safe areas and unobscured content. A modal footer
cannot stand in for an All Tasks toolbar. Screenshots in isolation are not a pass:
record executed visual assertions, exact artifact, all visible changed surfaces,
the reference controls and coverage limits. This uses the existing independent
review and typography reports; it adds no receipt schema or approval stage.
For narrow editable layouts, type a representative long value and check the
caret, text and adjacent controls; containment alone does not establish usable
editing. Inspect captures before closing the allocated session so transient
overlays or hidden controls can be corrected within that window.

The release validator derives the review plan from the candidate's exact
base-to-commit diff. Which reviews each plan requires is defined in
[release and review](docs/agents/release-and-review.md#risk-based-exact-commit-release-gates);
this file defines the evidence those reviews record.

Schema version 1 receipts retain their original review policy: both a
memory/cloud/sync audit and a distinct code/behavior review are required. They
also publish a third specialist-compatibility status bound to the same receipt;
that context does not claim an additional human review. New receipts use schema
version 2 and the risk plan derived from the exact diff.

## Prepare and record evidence

Create the final candidate commit first. Print the plan before reviews start:
`npm run release:plan -- <candidate-sha> <base-sha>`.

Put each required report outside the checkout in one directory, named
`owner-review.md`, `independent-review.md` and `specialist-review.md`. Each
report begins with exactly this header; a `Verdict: approved` also attests that
the review covered the full diff, relevant tests and user-visible and data
safety:

```text
Commit: <full candidate SHA>
Verdict: approved
Completed: <UTC ISO timestamp with milliseconds>
```

With the exact candidate checked out, run
`npm run release:prepare -- <candidate-sha> <base-sha> <report-directory> <issue-number>`.
It writes `receipt-input.json` beside the reports, with digests, the plan's
domains and each report's time. It refuses a report that names another commit,
has no approved verdict, or has a missing or future time or one earlier than the
candidate commit. It also refuses one report body used for both the owner and
independent review, an issue that is not a positive whole number, and an existing
`receipt-input.json`. When the plan includes `memory-cloud-sync`, it also writes
source digests of the changed files in that exact commit, and refuses a changed
file that differs on disk or that it cannot read from the commit. Task identities are `owner:<issue>`,
`independent-review:<issue>` and `specialist-review:<issue>`. A person then
fills the fields left empty: every `summary`, the owner `scope.rationale`,
`faqCoverage` and `memoryScope`. `release:record` refuses them while empty. An
`additionalSpecialistDomains` escalation is still added by hand, with the
matching `specialistReview` domains.

The input fields below are what preparation writes. Record the candidate's full
40-character commit SHA, tree SHA, and intended base SHA. Every schema version 2 input includes an
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
refuses to replace a custom `core.hooksPath`. A push to `main` needs a valid
exact-SHA receipt for every outgoing non-deletion tip, and the current worktree
must be clean. Pushes to other refs need neither, so a work branch and its PR
can run CI before review.
An older checkout without the validator fails closed.

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

This section covers candidates whose base predates the scaled review policy
below. Such product candidates also require `faqReview` with the same approved exact-SHA,
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

## Scaled review policy evidence

When the committed AGENTS.md at both the exact head and the base contains
"Release reviews scale to the exact diff.", the validator derives a plan with
`schemaVersion: 2` inside the schema version 2 receipt. The plan adds
`requiresTypographyReview` and `requiresOwnerFaqCoverage`, and sets
`requiresFaqReview` to false; see
[release and review](docs/agents/release-and-review.md#scaled-review-policy)
for what each bit requires and the combined independent review checklist. A
candidate whose base predates the wording keeps the earlier plan and evidence.

Whenever `requiresOwnerFaqCoverage` is true, the owner review carries the FAQ
coverage result; omit it otherwise. Do not include `faqReview`:

```json
"ownerReview": {
  "...": "the owner fields shown above",
  "faqCoverage": {
    "result": "updated",
    "summary": "<which extended FAQ entries changed, or why no user-facing behavior changed>"
  }
}
```

`result` is `updated` or `no-user-facing-change`. Schema version 1 receipts
are rejected for scaled-policy candidates. The publisher sends all three
contexts with the same compact description ending in `v=4`. Local verification
rejects a scaled receipt for an old-policy candidate because its plan no longer
matches the exact diff. Pages accepts `v=4` only when the exact reviewed head
and base derive the scaled policy, and requires `v=4` for those candidates;
`v=2`, `v=3` and schema-1 bindings keep verifying for their own candidates. An
unreadable head cannot claim `v=4`. Deployment still binds the exact reviewed
head, tree, base and receipt digest.
