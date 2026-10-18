# Development workflow

Locate the installed `mattpocock-skills` v1.3.1 plugin to invoke skills. Discover its path
at session start; older sessions may need explicit file reads. The current host
installation is `/Users/emeraldpham/.codex/plugins/cache/mattpocock/mattpocock-skills/1.3.1/skills`.
If unavailable, report that limitation and follow the repository gates; never
claim a skill was read when it was not. Load only the skill relevant to the task.

## Choose the next workflow

| Task | Read next | Completion boundary |
| --- | --- | --- |
| Edit agent guidance | `productivity/writing-for-agents/SKILL.md` | Clear trigger pointers, one authority per rule, all existing requirements traced |
| Build a bounded feature or fix | `engineering/implement/SKILL.md`, `engineering/tdd/SKILL.md`, its `tests.md` and `mocking.md` | Agreed behavior, observed behavioral RED, minimal implementation, GREEN, applicable review |
| Diagnose a bug | `engineering/diagnosing-bugs/SKILL.md`, then `engineering/tdd/SKILL.md` | A reproducible signal for the actual symptom, regression RED before fix, GREEN |
| Resolve interface or module design | `engineering/codebase-design/SKILL.md` | Agreed public boundary and responsibilities before implementation |
| Turn agreed discussion into a spec | `engineering/to-spec/SKILL.md` | Preserve agreed scope and seams; publish only to an explicitly authorized tracker |
| Implement an existing spec/task graph | `engineering/implement-spec/SKILL.md` | Use only when the spec, tracker and task graph already exist and delegation is warranted |
| Split an agreed spec into tickets | `engineering/to-tickets/SKILL.md` | Approved vertical slices, preserved parent and blocking edges |
| Review changed code | `engineering/code-review/SKILL.md` | Pin base/candidate; report Standards and Spec separately; preserve independent review |
| Write a PR | `engineering/pr/SKILL.md` | Concise scope, actual evidence, merge danger and unresolved gates |
| Configure engineering skills | `engineering/setup-matt-pocock-skills/SKILL.md` | User decides tracker/labels; review concrete draft before setup writes |
| Produce or manage agent evidence | [Agent evidence tools](agent-evidence.md) | Use the guide for the evidence task and keep each tool's coverage limits visible |

Skill instructions operate within explicit user authorization and repository
restrictions. A skill's recommendation to publish tickets, create labels, call
external services or activate accounts does not grant authorization for it.
Use the current task brief as the spec when it supplies the agreed requirements;
carry genuinely missing product decisions back to the parent/user.

## Strict TDD at agreed seams

Before tests, record the public seams, what each catches and misses, and the
user/task evidence that authorized them. Reuse already agreed seams without
asking the same question again. An existing fixture alone is not evidence of
user agreement. Propose genuinely new or changed seams to the parent/user and
wait for agreement before tests at those seams. Continue independent work while
waiting. Preserve established regression contracts; migrate coverage deliberately
rather than removing tests because a skill recommends a different style.

For each functional slice, write a discriminating behavioral test and actually
observe its assertion fail on the intended baseline BEFORE functional code.
Missing modules, import/compile errors, syntax failures, absent credentials or
broken test infrastructure do not count as feature RED. Establish a runnable
boundary and observe the intended behavioral mismatch first. Then implement the
minimum, observe GREEN, and repeat one vertical slice at a time. Changes to
configuration, dependencies or deletion also require this loop when functional.
Pure prose/nonfunctional housekeeping uses exact-diff and consistency review.

Use real public/consumer entry points, prior-state transitions and expected
results derived independently from the implementation. Mock external system
boundaries, time and randomness when needed. Internal geometry/paint assertions
can preserve bounded existing contracts, but do not replace consumer interaction
or actual rendered acceptance. Flag gaps, vacuous fixtures, tautologies and
implementation-coupled assertions for review without weakening passing contracts.

Keep actual commands, baseline/candidate identity, timestamps and observed RED
and GREEN output with task evidence, redacting secrets and personal data. Label
retrospective mutants/base comparisons honestly: they cannot restore chronology.
Reviewers verify the actual order and assertion quality, not just a rationale or
CI pass. Repair new review findings through their own meaningful RED→GREEN.
Refactor during review with checks green, preserving behavior and evidence.

Risk determines regression breadth and the minimum useful actor/configuration
set; it never waives RED. No blanket 21-actor/account matrix. Complete repository
required full-suite/CI checks even when focused local tests suffice during a slice.

## Browser choice

Prefer the supported ChatGPT/Codex built-in browser (`@Browser`, the in-app
browser) for ordinary localhost/public web-app interaction, screenshots, and
rendered visual, typography and overflow review when available and sufficient.
See the [official Browser documentation](https://learn.chatgpt.com/docs/browser).

Check current tool availability and capabilities before selecting a route; do
not assume the built-in browser supports isolated authenticated contexts or
every required engine. Use another browser or automation route only for a
concrete unmet capability, such as separate authenticated actors, engine-specific
compatibility, unsupported automation, or verified unavailability. Record the
capability gap and reason with the task evidence.

Apply shared resource allocation/ownership, security prompts and denials,
privacy constraints and required acceptance to every route; a browser switch
never waives them. Keep functional, actual rendered and independent review
requirements, including native/device and named-engine checks. Missing coverage
remains a gap. Keep full CDP access and security permissions unchanged; changes
require separate explicit authorization.

## Spec delivery cycle

For an agreed spec and ticket graph, run `/implement-spec`, complete the required
checks and release gates, then run `/retro` for that session or checkpoint. Use
`/to-tickets` for approved follow-ups when useful, then `/implement-spec` for the
next graph. Use fresh focused agent contexts where supported, retaining existing
ownership and coordination.

## Finish and hand off

Review the exact final diff against requirements and standards. Keep independent
changed-code and specialist review required by the repository. For changed UI,
inspect actual final rendered typography, overflow, focus, accessibility and
relevant viewports/states; a source or unit pass cannot close a runtime gap.
Preserve data/privacy/sync safety, FAQ/documentation duties and release gates.
Coordinate shared runtimes before use. Report blocked checks as blocked.
Clean up only your own safely removable work; retain other owners' work and
recovery data. Report exact files, evidence, findings, commit/CI/merge/deployment
state and any remaining user decisions separately.
