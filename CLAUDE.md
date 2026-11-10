# Chain Scanner

A ranked FVP task scanner with a PWA/offline shell and cloud-synced saved boards.

Before starting work, identify its owning issue as defined in
[atomic issues](docs/agents/atomic-issues.md).

## Agent skills

Use only relevant installed skills, routed by
[workflow](docs/agents/workflow.md). Read it before functional work, bug diagnosis,
code review, PR writing or guidance edits. It defines strict behavioral RED→GREEN,
seam agreement, honest evidence and user feedback boundaries.
Before every Claude Agent call, set model and effort per
[subagent models](docs/agents/subagent-models.md); Fable is never used.

Domain docs: single-context; see [domain rules](docs/agents/domain.md) before exploration.
Before publishing or triaging issues/specs, read the
[GitHub tracker](docs/agents/issue-tracker.md) and
[triage labels](docs/agents/triage-labels.md).
For command-line evidence collection, coordination, audits, or CI/PR automation,
use [agent evidence tools](docs/agents/agent-evidence.md).
For app-opening responsiveness, visible action feedback, or optional/background
work, read [responsiveness guidance](docs/agents/responsiveness.md).

## Test-first and regression

Before any runtime, visual, test or enforcement-file edit, read
[TDD and regression gates](docs/agents/tdd-and-regression.md), the single
authority for when tests, `RISK` cases and rationales are required. The
behavioral RED→GREEN loop, with its red output and chronology, is defined in
[workflow](docs/agents/workflow.md#strict-tdd-at-agreed-seams). Run risk-based
focused cohorts during a slice and the full suite when a release gate requires it.

## Review and release

Before browser interaction or rendered web review, follow
[browser choice](docs/agents/workflow.md#browser-choice).

Read [AGENTS.md](AGENTS.md) for maintenance authorization, FAQ duties, holds and
the maintainer approval new process needs; read it before adding any required
gate, reviewer, CI group, receipt field or issue rule.
Before release, read [release and review](docs/agents/release-and-review.md), the
authority for which reviews the exact diff requires, and
[RELEASE_GATES.md](RELEASE_GATES.md) for the evidence they record. Local GREEN
alone is not shipment.

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
