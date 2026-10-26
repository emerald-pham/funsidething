# Chain Scanner release and review

## Backward compatibility before release

Run `npm run test:compatibility` before release. The required `scanner-tests`
CI job runs it for every PR, push, and Pages deployment. It requires the
Firestore emulator, available Git history, and zero skipped compatibility cases.
It executes real released client backends and codecs against candidate rules,
and candidate clients against released rules, then runs the bounded sync-error
and safe reload contracts. Read success alone is never evidence of sync success.

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
from the original process RED. Existing independent code and relevant
data/sync reviewers inspect these exact results and limits with the retained
app-consumer regressions. This adds no review role or release status. Native
ephemeral Chromium evidence does not imply deployed or physical-device proof;
existing compatibility, FAQ, rendered, CI and live gates still apply.

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
the candidate SHA changes. The main ruleset must retain
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

## Independent typography review for final releases

Owner instruction, 2026-10-08: every final product checkpoint release and
equivalent release requires a typography reviewer independent of the
implementer. Review the actual final built candidate, identify its commit and
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

Before pushing, merging or deploying, classify the exact final commit under the
risk-based plan above and record the rationale with release evidence. Fix all
actionable findings and recheck changed areas before release. If the candidate
changes after review, repeat the affected review on the new exact commit; an
earlier draft review does not approve the final commit.

## Independent FAQ coverage release check

Keep each FAQ answer as short as possible: only the action, outcome or limitation
a user needs to understand. Preserve essential saved-data safety instructions.
Prefer one or two short sentences; require a concrete user need for more. Treat
repetition and avoidable technical detail as review findings. Keep testing,
implementation and release evidence in internal reports.

Independent FAQ coverage review is required for every product release. The
reviewer must be distinct from the implementation owner, code reviewer, and
state/sync specialist. Review the exact candidate against the Settings-aligned
extended FAQ, including changed controls, defaults, saved-data lifecycle, and
known limitations. Audit existing features for omissions when reorganizing it.
Record the exact-SHA `faqReview` and fingerprinted report in the release receipt.
The release validator requires this evidence for executable candidates under
this policy and binds it into the existing required release statuses.
Pure documentation housekeeping retains owner review. Typography review remains
a separate required check of final rendered evidence.
