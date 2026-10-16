# Guidance migration — 2026-10-16

Base: `0adb54670c863c36be4faf11833d71c951c4147e`. Installed source: `mattpocock-skills` v1.3.1, read directly from
its installed setup, TDD (including tests/mocking), writing-for-agents, implement,
implement-spec, diagnosing-bugs, code-review, to-spec and PR guidance.

This is a repository-guidance migration, not application implementation or a
claim of historical TDD compliance. Existing evidence/release records remain.
The user requested relevant installed skills while retaining strict TDD. Explicit
user/repository safety and acceptance gates take precedence over generic defaults.

## Setup decisions still needed

Tracker selection and triage-label vocabulary are unconfirmed. No tracker was
chosen, no issues/labels created, no external integration configured. Full
`setup-matt-pocock-skills` has NOT been completed. Before using tracker-dependent
workflows, send the parent/user the setup skill's recommended tracker question,
then its triage-label question if applicable, and concrete proposed files for
review. Do not silently default to GitHub or local markdown. Direct authorized
work can continue from its task brief without manufacturing tickets.

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
