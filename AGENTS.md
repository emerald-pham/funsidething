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

## Exact-final release reviews

For every release, require two independent checks of the exact final commit
before pushing, merging, or deploying it: a code/behavior review and a
memory/cloud/sync review. Give both reviewers the full candidate SHA. The
code/behavior reviewer inspects the full diff, relevant tests, and
user-visible or data-safety effects. The memory/cloud/sync reviewer checks
current memory sources against repository behavior and explicitly assesses
memory, cloud-data, and synchronization impact. Each domain records a concrete
rationale; affected domains cite focused tests, while a pure UI or copy change
may record a justified no-impact decision without unrelated cloud testing.
Keep the owner, memory reviewer/auditor, and code reviewer task identities
distinct. Fix actionable findings and recheck changed areas before release.
A review of an earlier draft is not a review of the final commit.
