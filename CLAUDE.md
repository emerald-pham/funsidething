# Chain Scanner

A ranked FVP task scanner with a PWA/offline shell and cloud-synced saved boards.

## Agent skills

Use only relevant installed skills, routed by
[workflow](docs/agents/workflow.md). Read it before functional work, bug diagnosis,
code review, PR writing or guidance edits. It defines strict behavioral RED→GREEN,
seam agreement, honest evidence and user feedback boundaries.

Domain docs: single-context; see [domain rules](docs/agents/domain.md) before exploration.
Before publishing or triaging issues/specs, read the
[GitHub tracker](docs/agents/issue-tracker.md) and
[triage labels](docs/agents/triage-labels.md).
For command-line evidence collection, coordination, audits, or CI/PR automation,
use [agent evidence tools](docs/agents/agent-evidence.md).

## Test-first and regression

Every functional change requires meaningful observed RED before implementation,
then GREEN. Preserve red output and actual chronology. Use risk-based focused
cohorts and the full suite when required. Read [TDD and regression gates](docs/agents/tdd-and-regression.md)
before any runtime, visual, test or enforcement-file edit: its hook, RISK cases,
coverage map and fingerprinted rationales remain mandatory. Existing passing
feature assertions remain protected.

Use one agreed seam/test/minimal implementation per vertical cycle; inventory
cases up front without writing every future test before implementation. A test
that unexpectedly passes needs investigation, not a fabricated RED. Configuration
or dependency changes follow the same behavioral loop when functional.

## Review and release

Read [AGENTS.md](AGENTS.md) for maintenance authorization, FAQ duties and holds.
Before release, read [release and review](docs/agents/release-and-review.md) and
[RELEASE_GATES.md](RELEASE_GATES.md). Preserve independent changed-code/specialist,
FAQ and final rendered typography reviews, exact-candidate evidence, compatibility,
CI, Pages and live-asset/behavior checks. Local GREEN alone is not shipment.

Verify the applied theme attribute, computed color scheme and paint before
accepting each theme capture; theme labels alone do not establish coverage.

Actual visual tests are mandatory for changed controls or layout. Code and
typography reviewers inspect the final rendered visual-test evidence for every
changed control and its established neighboring control. Compare the controls
in the same pane, not a modal reference substituted for a list toolbar. Test
day and night themes, ordinary and enlarged relevant mobile/desktop views,
natural disabled and selected states, native keyboard focus, and top, middle and end
task scrolling. Check row height before/after selection, group spacing, pane
insets, safe-area spacing and unobscured content as well as individual styles.
Screenshots in isolation are not a pass: record executed assertions, exact
artifact and visible changed surfaces together with the named reference and
coverage limits. Missing relevant runtime evidence remains a review gap.

## Context and persistence

For context assignments, filters, editing or context rendering, read
[context regressions](docs/agents/context-regressions.md). For persistence/sync,
exercise old saved data, concurrent clients, offline/reload/reconnect and
completion/Undo as affected. Order cloud writes by revision, never wall clock.
Comments explain why, especially historical cloud-sync safeguards.
