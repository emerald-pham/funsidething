# Atomic issues

Track repository work as one GitHub issue per **independently shippable
outcome**: a change that can be reviewed, merged and released on its own,
usually one PR. Before starting work, identify its owning issue and confirm the
work is in scope. Use the [GitHub tracker](issue-tracker.md) for publication.

State each issue's outcome, scope, prerequisites and observable acceptance
criteria. Close it when its acceptance is verified.

## Steps are checklist items

Investigation, planning, review, receipts, CI, deployment, live verification
and cleanup are steps toward an outcome. Track them as a checklist in the PR
body, alongside the release gates that apply to the change;
[release and review](release-and-review.md) defines those gates. For example:

```markdown
## Release checklist

- [ ] Behavioral RED observed, then GREEN
- [ ] Owner exact-diff review
- [ ] Independent review
- [ ] Required CI green on the exact head
- [ ] Nightly cross-engine native job dispatched and green on the exact head (Stable releases)
- [ ] Merged and Pages deployment verified
- [ ] Live behavior checked on Stable
- [ ] Branch and worktree cleaned up
```

When work uncovers another step, add it to the checklist. When it uncovers a
separate shippable outcome, create or reuse an issue for that outcome before
working on it.

## Multi-PR specs

Use a parent issue with linked child issues only when a spec needs several PRs
to deliver. Each child is itself one shippable outcome; record its parent link
and blocking dependencies. Close the parent when all required children are
closed.

## Batching

Related outcomes may share one PR, CI run and release, with completion evidence
mapped back to each issue. Batching changes how work is tracked, never which
authorization, holds, test-first, review or release requirements apply.
