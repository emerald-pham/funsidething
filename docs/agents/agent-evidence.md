# Agent evidence tools

Use the tool that matches the evidence task. Each linked guide owns its inputs,
procedure, output and limits; package script names are the command entry points.

| Task | Command | Guide |
| --- | --- | --- |
| Measure rendered typography, zoom, theme and capture evidence | `npm run agent:rendered-evidence --` | [Rendered evidence](rendered-evidence.md) |
| Record a command's test and source provenance | `npm run agent:record-test-run --` | [Test-run provenance](test-run-provenance.md) |
| Validate a compact checkpoint with distinct required gates and follow-ups | `npm run agent:checkpoint --` | [Checkpoints](checkpoints.md) |
| Check native task actions and durable readback in an isolated profile | `npm run agent:native-task-smoke --` | [Native task smoke](native-task-smoke.md) |
| Inspect or manage the shared host ledger and parked work | `npm run agent:host-coordination --` | [Host coordination](host-coordination.md) |
| Run focused copy and rationale checks | `npm run agent:preflight --` | [Preflight](preflight.md) |
| Run an isolated browser audit and preserve partial results | `npm run agent:browser-audit --` | [Browser audits](browser-audits.md) |
| Validate a committed topic revision and hand it to remote CI | `npm run agent:ci-handoff --` | [Local CI handoff](ci-handoff.md) |
| Follow one exact CI run and commit | `npm run agent:ci-monitor --` | [CI monitor](ci-monitor.md) |
| Run an independently accounted scanner test group | `npm run test:group --` | [Test groups](test-groups.md) |
| Update an authorized PR body from UTF-8 text | `npm run agent:pr-body-update --` | [PR body update](pr-body-update.md) |

Pass tool arguments after `--`. Read the linked guide before invoking its
command; this page routes to the procedure without duplicating tool rules.

At startup, follow [host coordination](host-coordination.md) when the checkout
may be parked or behind the authoritative main branch. Run the [focused
preflight](preflight.md) at its documented shell-packaging and final-regression
boundary.

`npm test` runs the repository tests and every `scripts/agent-tools/*.test.mjs`
cohort. Use `npm run test:agent-tools` for the focused agent-tool cohort. A
focused pass does not replace the repository's required full suite or release
checks. The isolated `test:group` command uses the separately maintained
inventory and assignments described in [Test groups](test-groups.md).
