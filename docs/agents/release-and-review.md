# Chain Scanner release and review

## Backward compatibility before release

Run `npm run test:compatibility` before release. The required `scanner-tests`
CI job requires its complete pass for every PR, push, and Pages deployment. It requires the
Firestore emulator, available Git history, and zero skipped compatibility cases.
It executes real released client backends and codecs against candidate rules,
and candidate clients against released rules, then runs the bounded sync-error
and safe reload contracts. Read success alone is never evidence of sync success.

CI reuses an original successful compatibility job only when the complete
committed tree, exact comparison base and runtime inputs match. See
[Reusing successful CI inputs](test-groups.md#reusing-successful-ci-inputs).
Changed or unavailable proof cannot satisfy that gate. The local pre-release
compatibility run and exact review/deployment evidence remain required.

The matrix retains the immutable supported baseline in
`scripts/backward-compatibility.mjs` and also tests the exact comparison base
(`COMPATIBILITY_BASE_SHA` in CI, `origin/main` locally). Do not advance or remove
the pinned baseline to make an incompatible change pass. A new protocol needs
a staged compatible rollout or an explicitly reviewed support/migration change.
See [BACKWARD_COMPATIBILITY.md](../../BACKWARD_COMPATIBILITY.md) for the supported
boundary and the historical negative control. The Firestore `predeploy` hook
also runs this same gate before `firebase deploy --only firestore:rules`, so a
manual CLI rules deployment cannot accidentally omit the compatibility check.

## Installed-client delivery evidence

The existing scanner-tests command requires both signed-out and actual
reconcile-held native installed-client outcomes. Each starts with immutable
old `779defa4e8c3465fdf535fe17dbe2227d2b76ea1` and two controlled old documents,
retains a blurred unfinished draft while the candidate worker waits, and proves
accepted native edits and durable recovery readback before normal last-client
close. Reopening must deliver the exact candidate shell and retain the board,
pending generation, manual/protected backups, opaque archives and unknown fields.
The held remote payload/revision remains exact with zero writes.

The same required command also reads both distinct case artifacts, requiring
their successful modes, exact baseline/candidate/tree and complete owned cleanup.
Missing, duplicate, failed or mismatched reports fail before artifact upload.

Both cases use a populated synthetic board with a large unknown field. The
signed-out case makes predecessor-cache retirement fail through the native
worker storage boundary, verifies the old cache remains, and still requires
the exact candidate on normal reopening. The held case keeps ordinary cleanup
as a positive control. Open-session waiting and draft protection remain required.

Require offline reopening of that same delivered candidate, with an online
transport control followed by failed uncached transport while the origin
listener remains available. Server unavailability and a navigator hint alone
do not prove network-offline acceptance. Record actual runtime, source/tree,
response/cache hashes, preservation results and owned cleanup. Missing/skipped
cases, unsupported runtime and incomplete cleanup remain failures.

Keep actual command omission/duplicate/skip and native wrong-candidate,
stale-byte, unsafe-replacement and source-loss sensitivity evidence distinct
from the original process RED. The reviewers the derived plan requires inspect
these exact results and limits with the retained app-consumer regressions.
This adds no review role or release status. Native ephemeral Chromium evidence
does not imply deployed or physical-device proof; the compatibility, CI and live
gates and the derived review plan still apply.

## Nightly cross-engine native checks

The cross-engine (Chromium + WebKit) native button checks run in the `Nightly`
workflow's `cross-engine-native` job every night on `main` and on manual
dispatch, so an engine-specific failure cannot block unrelated fixes.
[Test groups](test-groups.md#nightly-cross-engine-cohort) defines which cases
are nightly and which stay in the required cohort.

Before a Stable release, dispatch `Nightly` on the release candidate ref
(`gh workflow run nightly.yml --ref <candidate-branch>`) and require its
`cross-engine-native` job to pass on the exact candidate head. Only that job is
a release gate. The workflow's `velocity-report` and `ruleset-drift` jobs are
monitoring: handle their failures as their own sections say, without blocking
the release on them. A failed, skipped or missing `cross-engine-native` job
blocks the release until it is fixed or the maintainer accepts the named
failure. A failing scheduled run fails the workflow and GitHub notifies the
maintainer; treat a `cross-engine-native` failure as a release blocker for the
next Stable release, not as noise.

`cross-engine-native` is expected to be red until PR #285's WebKit product fix
lands as its own change (maintainer decision, 2026-11-04). Until then, the
release owner still dispatches the job on the exact candidate and checks that
its only failures are the known #285 WebKit cases: no other failing case, no
Chromium failure, and nothing skipped or missing. The owner records that run
and the maintainer's acceptance of the named #285 failures in the release
evidence. Any other failure blocks the release as above. Delete this paragraph
when #285 merges.

## Ruleset drift

The `Nightly` workflow's `ruleset-drift` job compares the required status
checks that GitHub applies to `main` with
[`.github/required-status-checks.json`](../../.github/required-status-checks.json)
and fails naming each missing or extra check. Change the ruleset and that file
together in one reviewed change. If the job reports it could not read the
rules, run the `gh api` comparison it prints before the next Stable release.

## Risk-based exact-commit release gates

Every candidate needs an owner review of its exact diff. The release validator
derives the review plan from the exact base-to-candidate diff and records it in
the receipt. Pure documentation, comments, copy, and housekeeping with no
executable, configuration, test, release-gate, data, or product-behavior change
need only the owner's exact-diff review. Ordinary code or behavior needs one
independent code/behavior review. Shared session state, callable or auth
behavior, Firestore rules, deployment/authentication infrastructure, data
migration, memory, cloud persistence, and synchronization need the relevant
specialist review. A code reviewer and a specialist reviewer are both required
only when the exact diff affects both domains.

Risk is derived from changed paths and their exact diff content; callers cannot
lower the required review plan. An optional `additionalSpecialistDomains`
input may add domains from the validator's known-domain list, but cannot replace
or remove any derived domain; that escalation is recorded in the receipt.
Ambiguous auth, state-persistence, and session-persistence changes fail closed
to their relevant specialists. Memory/cloud/sync specialist receipts record
source fingerprints and per-domain impact and rationale. Every affected domain
lists focused tests; an all-unaffected assessment still includes at least one
focused preservation test across the assessed domains. Install the shared pre-push gate with
`npm run release:install-hook`, record evidence with `npm run release:record`,
verify it with `npm run release:verify`, and publish statuses with
`npm run release:publish` before merging. Re-review affected domains whenever
the candidate SHA changes, as [final-candidate timing](#final-candidate-timing)
describes. The main ruleset must retain
`funsidething/memory-audit` and `funsidething/independent-review`, add
`funsidething/specialist-review`, and keep its other required checks. Schema
version 1 receipts retain their original two-review policy and publish a
receipt-bound specialist-compatibility status so all current required contexts
are present; this compatibility status does not claim a third human review. New
schema version 2 receipts follow the derived plan. Pages CI independently
verifies the merged PR head, exact tree, base, receipt digest, and latest status
contexts before deployment. Follow [RELEASE_GATES.md](../../RELEASE_GATES.md) for the
evidence format and release steps. Receipts and statuses record human work but
cannot prove that a person actually performed the review; repository writers
with status permission and protection-bypassing administrators remain inside
the trust boundary.

### Scaled review policy

The validator applies the scaled review policy when the committed AGENTS.md at
both the exact candidate head and its base contains the sentence "Release
reviews scale to the exact diff." A candidate whose base predates that wording,
including the change that introduced it, keeps the earlier policy above and the
FAQ reviewer below. Under the scaled policy the derived plan (plan schema
version 2) requires:

- Documentation-only diffs: the owner exact-diff review only.
- Ordinary code or behavior: the owner review plus one combined independent
  review, using the checklist below.
- A specialist only for memory, cloud persistence and sync, shared session
  state, Firestore rules, callable/auth behavior, deployment or authentication
  infrastructure (including the release receipt verifier, pre-push gate and
  workflows) and data migration. Ambiguous auth, state and session persistence
  still fail closed to the specialist. Process files such as the RISK map, test
  rationales, hooks and guidance keep the code review but no longer derive the
  `release-process` specialist; `additionalSpecialistDomains` can still add it.
- `requiresTypographyReview` is true only when rendered markup or stylesheet
  content changes: CSS, HTML outside inline scripts, or script lines that build
  markup, classes or styles. Tests and tooling never set it.
- `requiresFaqReview` is false. Whenever the plan includes product behavior
  (`requiresOwnerFaqCoverage`), the owner review records the extended-FAQ
  coverage result instead. Product behavior means an app runtime file or the
  Firestore rules; test, tooling and workflow changes never set it.

When the committed AGENTS.md at both head and base also says "Review plans
classify changed code, not prose." (spec #2230), content classification reads
added and removed code lines, the code within three lines of each, and the
function git names in each hunk header:

- Persistence, session, auth and migration patterns read only code: script
  files, inline scripts, and HTML or SVG lines that load or run script (script
  tags, event handlers, `javascript:` URLs). Help and changelog prose, whole-line
  comments and Node's synchronous file and process APIs such as `readFileSync`
  don't count. Short revision names (`remote.rev`, `localRev`) do.
- The changelog block, its app fingerprint and the worker `CACHE_NAME` line
  never derive a specialist or the typography review, unless the diff moves a
  changelog marker or a changelog line runs code.
- Rewording HTML text while keeping every tag and attribute is copy, not
  typography; new or changed markup, inline styles and CSS still derive it.
- Path triggers and the fail-closed handling of ambiguous persistence code are
  unchanged. Earlier candidates keep their earlier classification.

Receipts stay schema version 2 and publish the `v=4` status binding on all
three required contexts. See [RELEASE_GATES.md](../../RELEASE_GATES.md#scaled-review-policy-evidence).

### Combined independent review checklist

One independent reviewer, distinct from the owner, covers in one pass:

1. Code behavior: the full exact base-to-candidate diff, including error paths,
   compatibility with older saved data and clients, and anything the diff removes.
2. Relevant tests: an observed behavioral RED and GREEN for each functional
   change, discriminating assertions with independent expected values, and no
   removed or weakened protection without a recorded rationale.
3. User-visible and data safety: what users see and do, saved boards, backups,
   cloud sync, Undo and offline behavior affected by the change, and the
   extended FAQ where behavior changed.

Record the result as the receipt's `independentReview` with all three scope
flags set.

## Saved-board incident review

For fixes to reported populated-board startup, import or cloud-login adoption,
use the existing memory/cloud/sync specialist review to close each confirmed
defect's coverage gap. Record why prior tests or release proof missed that
trigger and which permanent safe regression now reaches it.

Inspect from-scratch or minimized fixtures through the actual affected
consumer: populated cold startup and save; format-aware current-board or raw
backup file selection and paste import; cloud-login adoption; and failed or
missing required recovery copies. Choose cases for the confirmed defect and
changed risk. Verify usable, noncrashing recovery UI, explicit source/rating
choices where needed, and preservation of original facts, unknown fields and
exact recovery sources. Keep explicit snapshot replacement distinct from
merging current tasks. Require durable local readback and account/revision/
cloud acknowledgement for claimed adoption or sync; retain safe held behavior
when recovery protection cannot be established.

Inspect meaningful behavioral REDs and positive controls, with actual chronology
and baseline/candidate/source identities. Revalidate the authorized original
source after the minimized regression passes, using the existing privacy-safe
isolated route; keep private originals outside Git, CI, browser fixtures and
public environments. Report aggregate preservation and timing, not private
payloads. Missing original-source access or runtime coverage remains a named
gap. Separate measured CPU stalls and supported-format/rating holds from
unconfirmed physical crashes or user quota causes. Earlier full/native or
empty-profile public passes retain their original scope; they do not establish
recovery of a newly reported populated source. This adds no review role or
blanket runtime matrix; existing exact-candidate and release gates still apply.

## Independent typography review

A typography reviewer independent of the implementer is required when the
derived plan sets `requiresTypographyReview`, which happens only when rendered
markup or stylesheet content changes. Candidates under the October 2026 policy,
whose base predates the scaled review policy, keep the owner instruction of
2026-10-08: every final product checkpoint release needs this review. Review
the actual final built candidate, identify its commit and
build artifact, and compare it with the intended typography contract and
previous released build. Automated typography checks do not substitute for this
review. Recheck affected evidence if the reviewed candidate materially changes.

Inspect the actual resolved/rendered font (including platform fallback or font
load failure), computed family, size, weight and line height, readability,
wrapping and overflow. Use representative relevant viewports and states,
including changed controls, dialogs/portals and recovery screens when affected.
Choose the smallest useful configuration set; do not expand into a full actor
or account matrix. For a global font report, sample shared chrome plus distinct
font/inheritance paths across the app, and compare base/candidate CSS and assets.
Record the baseline, exact artifact, platform, states, viewport/window sizes,
findings, evidence and what was not checked. An inaccessible runtime is an
unresolved review gap, not a pass inferred from unit, inference or source tests.
Fix actionable typography findings and obtain the affected independent review
before publication.

For each added or restyled control, identify the established equivalent or
adjacent reference control and the intended match or deliberate difference.
Reuse its component classes and theme tokens. Compare the actual final controls
side by side: font family, size, weight and line height; padding and height;
radius, border, fill, ink and shadow; and hover, focus and disabled treatment
where applicable. Inspect every affected surface, including the active
candidate and paused or sole/final task, in both themes and relevant narrow,
wide and enlarged views. Distinguish naturally disabled states from isolated
paint probes. Record exact-candidate screenshots, computed styles, the reference
and coverage limits. White paint, readable text and passing bounds alone do not
establish a visual match. Unexplained drift is an actionable finding; fix it and
repeat the affected final rendered comparison before approval.

For executed visual assertions, theme verification and neighboring-control/scroll
coverage, follow the mandatory visual policy in [CLAUDE.md](../../CLAUDE.md#review-and-release).

## Final-candidate timing

Push the work branch, open its PR and let CI run first. Request reviews once the candidate is
CI-green and its fingerprints are generated; before merging, classify the exact
final commit under the risk-based plan above and record the rationale with
release evidence.

Reviewers tag each finding blocking (correctness, data safety, accessibility or
a user-visible defect) or non-blocking. Fix blocking findings before release.
After two review passes, file remaining non-blocking findings as follow-up
issues instead of starting another pass.

If the candidate changes after review, the affected reviewers re-review it on
the new exact commit: incrementally, by the same reviewer, against their earlier
report and the delta since the commit they approved (use `git range-diff`
after a rebase, so upstream changes are not mistaken for the delta). Their receipt entry signs
the new SHA with the usual fields, and its evidence says the review was
incremental and cites the earlier report. An earlier draft review alone does not
approve the final commit.

## Independent FAQ coverage release check

This section applies to candidates under the October 2026 policy, whose base
predates the scaled review policy; scaled-policy candidates record FAQ coverage
in the owner review instead.

Independent FAQ coverage review is required for every such product release. The
reviewer must be distinct from the implementation owner, code reviewer, and
state/sync specialist. Review the exact candidate against the Settings-aligned
extended FAQ, including changed controls, defaults, saved-data lifecycle, and
known limitations. Audit existing features for omissions when reorganizing it.
Record the exact-SHA `faqReview` and fingerprinted report in the release receipt.
The release validator requires this evidence for executable candidates under
this policy and binds it into the existing required release statuses.
