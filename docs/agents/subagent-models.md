# Subagent models and effort

This is the Claude counterpart to the GPT delegation paragraph in
[AGENTS.md](../../AGENTS.md). It governs every Claude Code Agent tool call;
the AGENTS.md paragraph still governs GPT routes.

Set `model` and `effort` explicitly on every Agent call. This section is the
explicit instruction to do so. Fable is never authorized, in any version, in
any role, even for escalation. Every effort level is authorized.

Always use the newest available model in each allowed family (Opus, Sonnet,
Haiku). The model names below are the families. Today they mean Opus 5.5,
Sonnet 5.5 and Haiku 5.5. When a newer version of a family becomes
available, switch to it right away, in the same role and at the same effort.
Do not wait for this file or a benchmark to catch up. Never pin an older
model ID when a newer one in the same family exists. The Agent tool's
`model: "opus"`, `"sonnet"` and `"haiku"` aliases already resolve to the
newest version, so prefer them over full IDs.

| Work | Model | Effort |
|---|---|---|
| Coordinator (main session) | Opus | medium |
| Default delegated work: implementation, fixes, tests, reconciliation | Opus | high |
| Hard bounded work (state the reason in the brief) | Opus | max |
| Independent review of security, authorization, data rules, shared state, or deploy/auth infrastructure | Opus | max |
| Routine self-review or second opinion on ordinary changes | Opus | xhigh |
| Toughest problems, replacing Fable (see "Opus max escalation" below) | Opus | max, fresh agents |
| Read-only search, file location, doc lookup (Explore) | Haiku | high |
| Mechanical, low-stakes, read-only lookups | Haiku or Opus | low |

## Opus max escalation (the Fable replacement)

Opus 5.5 (Max) ranks #1 on arena.ai Agent Arena, ahead of Fable 5.1 (Max) at
#5, for about the same cost per task. The top tier is therefore Opus at max,
with the work restructured. Fable is never used.

1. Trigger: an Opus max agent made a substantive diagnosis and an attempted
   repair, both failed, and it has no credible next step. The user can also
   ask for this tier directly.
2. Step 1, fresh attempt: start a new agent (not `subagent_type: "fork"`)
   with `model: "opus"`, `effort: "max"`. Its brief states the goal, what was
   tried, what failed, the observed evidence, and pointers to files and logs.
   Give it the facts, not the earlier hypothesis as a conclusion, so it is
   not anchored on the failed approach.
3. Step 2, only if step 1 fails: run two fresh Opus max agents in parallel,
   each attacking from a different angle. For example, one reasons from
   first principles and the spec, and one builds a minimal reproduction and
   bisects. The coordinator compares their results, or hands them to a third
   Opus max agent to reconcile, then picks one path.
4. Before step 2, tell the user in one line why it is needed and the rough
   cost: about 9 to 13 times a single Opus high task. This is a heads-up, not
   a request for approval.
5. If step 2 also fails, stop and report the evidence and open questions to
   the user. Do not loop, and do not substitute Fable.

## Rules

- Default to `model: "opus"`, `effort: "high"`. Per arena.ai Agent Arena, it
  outscored Sonnet 5.5 at lower median cost per task.
- Use `max` for the high-risk reviews and hard bounded work the table assigns
  it. Routine self-review stays at `xhigh`. Opus 5.5 (Max) ranks #1 on Agent
  Arena at about four times the cost of High, so use it deliberately.
- Work the table starts at max stays at max. Raise a task that started at
  high to max only after a real failure: diagnosis plus an
  attempted repair failed, and there is no credible next step. A failed test
  with an obvious fix is progress, not a reason to escalate. Beyond max, use
  only the Opus max escalation above.
- Haiku never writes code, reviews changes, or makes decisions. Its Agent
  Arena score is not distinguishable from zero.
- Sonnet is not a default. Use it only if the user sets a cost cap that Opus
  High cannot meet.
- Never use `model: "fable"` or any Fable version, however new. Never let
  `subagent_type: "fork"` serve as a route to Fable: forks inherit the parent
  model, so do not fork from a Fable session.
- A fork ignores `model` and `effort` and runs at the coordinator's settings
  (Opus medium). For delegated work that needs Opus high or above, start a
  fresh agent instead of a fork.
- When a newer model ships, adopt it immediately per the rule above. Then
  check https://arena.ai/leaderboard/agent. If the newer model's ranking or
  cost changes which family or effort wins a role, update this table and
  record the snapshot date. Until then, keep each role's current family and
  effort on the newer version.

Benchmark snapshot: arena.ai Agent Arena, 2026-11-04. Opus 5.5 (Max) #1,
20.14%, $6.79/task; Sonnet 5.5 (Max) #3, 15.42%, $3.86; Fable 5.1 (Max) #5,
13.86%, $6.39; Haiku 5.5 (High) #28, 0.62%, $0.08.
