# Repository instructions

Read [CLAUDE.md](CLAUDE.md) before working in this repository. It is the
authoritative source for the project’s architecture, TDD workflow, testing
requirements, and conventions.

## Allowed delegated agents

- Only `gpt-5.6-sol` and `gpt-6-luna` may be delegated as subagents.
- Use `gpt-5.6-sol` with `low`, `medium`, `high`, or `xhigh` reasoning; `max`
  and `ultra` are not allowed for this model.
- Use `gpt-6-luna` at `max` reasoning.
- The coordinator model and reasoning effort remain unchanged.

## Risk-based final-candidate review

Before pushing, merging, or deploying a change, classify its risk from the
exact final commit and record the rationale with the release evidence.

- Pure documentation, comments, copy, or repository housekeeping with no
  executable, configuration, test, release-gate, data, or user-visible behavior
  change needs an exact-diff owner self-review, but no independent reviewer.
- Ordinary code or behavior changes need one independent reviewer of the exact
  final commit, including the full diff, relevant tests, and user-visible or
  data-safety effects.
- Changes to shared session state, callable behavior or authorization,
  Firestore rules, deployment or authentication infrastructure, data migration,
  memory, cloud persistence, or synchronization need the relevant independent
  specialist review. Use separate code/behavior and memory/cloud/sync reviewers
  only when both risk domains are materially affected.

Fix actionable findings and recheck changed areas before release. If the
candidate changes after review, repeat the affected review on the new exact
commit. A review of an earlier draft is not a review of the final commit.

## Branch and worktree hygiene

At the start and end of repository work, fetch and prune `origin`, inspect local
and remote branches plus all worktrees, and check for open pull requests. Delete
only branch tips proven reachable from `origin/main`; preserve branches with
unique commits, dirty or ignored worktree data, an open pull request, or active
coordination ownership. Before deleting a remote branch, capture its exact SHA
and use an exact-SHA force-with-lease. Do not remove another task's worktree or
branch while that task is running or pending. Keep `main` aligned with
`origin/main` when its worktree is clean, and report anything intentionally
retained.
