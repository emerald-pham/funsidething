# Atomic issues

All repository actions must belong to atomic GitHub issues. Each atomic issue
completes the smallest possible unit of work: one bounded outcome that can be
completed and verified independently.

Before starting an action, identify its owning atomic issue and confirm that
the action is within scope. Apply this to investigation, planning, code, tests,
tooling, documentation, integration, review, validation, delivery and cleanup.
Use the [GitHub tracker](issue-tracker.md) for ticket publication and tracking.

## Split before execution

Break every request or issue containing multiple actionable steps or outcomes
into separate, linked atomic issues before executing those steps. Repeat the
breakdown until no issue contains a step or outcome that can be completed and
verified separately. A checklist inside a broad issue does not replace atomic
issues.

Keep broad specs and parent issues as scope and progress containers. Execute
the atomic leaf issues, recording their parent links and blocking dependencies.
For each leaf, state its single outcome, bounded scope, required inputs and
prerequisites, and observable acceptance criteria. Split again whenever any
part can be completed and accepted independently.

If work uncovers another step or an expanded outcome, create or reuse the
appropriate linked atomic issue before starting that work. Preserve the
original scope, evidence and ownership. Complete a leaf only when its own
acceptance is verified; complete a parent only when all required children are
complete.

## Delivery and existing requirements

Atomic tracking preserves checkpoint batching: related issues may share one
reconciled candidate, PR, CI run and release, with completion evidence mapped
back to each issue. Keep existing authorization, task holds, host coordination,
test-first work, review, release and cleanup requirements in force.
