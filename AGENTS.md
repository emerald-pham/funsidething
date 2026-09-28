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

## Final commit review

For every future code change in this repository, assign an independent reviewer
to the exact final commit before pushing, merging, or deploying it. Give the
reviewer the commit SHA and ask them to inspect the full diff, relevant tests,
and user-visible or data-safety effects. The change owner fixes actionable
findings and has the changed areas rechecked before release. Record the review
result with the release evidence; a review of an earlier draft is not a review
of the final commit.
