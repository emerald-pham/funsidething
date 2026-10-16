# Guidance migration — 2026-10-16

Base: `0adb54670c863c36be4faf11833d71c951c4147e`. Installed source: `mattpocock-skills` v1.3.1, read directly from
its installed setup, TDD (including tests/mocking), writing-for-agents, implement,
implement-spec, diagnosing-bugs, code-review, to-spec and PR guidance.

This is a repository-guidance migration, not application implementation or a
claim of historical TDD compliance. Existing evidence/release records remain.
The user requested relevant installed skills while retaining strict TDD. Explicit
user/repository safety and acceptance gates take precedence over generic defaults.

## Setup completed — 2026-10-16

The user approved GitHub Issues and the five default triage labels after
reviewing the concrete setup and ticket breakdown. Issues are enabled for
`emerald-pham/funsidething`; missing labels were created and the existing
`wontfix` label retained. Tracker operations are defined in
[issue-tracker.md](issue-tracker.md), and label mappings in
[triage-labels.md](triage-labels.md). The tracker/triage setup is complete.

Existing local planning documents remain in place. Direct authorized work can
still proceed from its task brief without manufacturing tickets.

Domain consumer rules are in `domain.md`; there is no monorepo configuration.
See `workflow.md` for relevant-skill routing and strict TDD integration.

## Requirement provenance

Former `CLAUDE.md` TDD enforcement/test-protection detail → `tdd-and-regression.md`;
compatibility/review/typography → `release-and-review.md`; context edge cases →
`context-regressions.md`. Former `AGENTS.md` cleanup → `cleanup.md`; exact-review
and FAQ identities → `release-and-review.md`. Live maintenance, release permission,
model restrictions, FAQ/changelog exception and approval holds stay in `AGENTS.md`.
Root `CLAUDE.md` keeps the visual-policy assertions consumed by existing tests.
`RELEASE_GATES.md`, executable gates and all tests are unchanged. The old bulk-test
wording is replaced by vertical TDD slices; the scope/regression obligations remain.
