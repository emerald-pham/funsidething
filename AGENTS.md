# Chain Scanner repository instructions

Read [CLAUDE.md](CLAUDE.md) before work; it is the authoritative workflow router.
Chain Scanner is a live product. Preserve saved boards and other owners' local
work; test with isolated fixtures and profiles rather than production data.

User-requested repository changes, including documentation, are authorized to
commit, push, merge, and release to the existing live deployment after applicable
checks pass. Honor narrower task holds. Umbrella and animal designs require
explicit user approval before shipping; guidance work does not approve them.

Stable is the current release target. Keep Beta mirroring paused until the user
confirms Stable is good. Passing tests, CI, deployment checks or elapsed time
do not establish that confirmation. This supersedes earlier automatic
Stable-to-Beta mirroring guidance.

For every user-facing behavior change, update the corresponding extended FAQ in
Quick start and Settings changelog, retaining unrelated content and structure.
Routine animation-frequency tuning stays out of public patch notes/changelog by
user preference; keep internal evidence truthful and the extended FAQ accurate.
This exception does not suppress bugs, safety/accessibility changes or limits.

Independent FAQ coverage review is required for every product release.
Read [release and review](docs/agents/release-and-review.md) before release for
review identities, exact-candidate regression, compatibility, receipt, CI and
live verification requirements. Documentation housekeeping uses owner review.

At start/end and after merge, follow [cleanup](docs/agents/cleanup.md), retaining
live branches/worktrees, ignored data and other projects' reservations. Inspect
the shared host ledger; do not acquire shared browsers/emulators without allocation.

Delegation permits GPT-6 Luna (`gpt-6-luna`), GPT-6.1 Terra
(`gpt-6.1-terra`) and GPT-6.1 Sol (`gpt-6.1-sol`), using only identifiers
and effort levels exposed by the runtime. Luna is approved only at `max`;
Terra and Sol may use all runtime-supported effort levels. Keep normal speed
for Sol reviews, the coordinator's model/effort, assigned review roles and
security-review floors. This guidance changes no active assignments.

After a task fails, increase effort when a higher supported, permitted level
exists. Repeated or looping failures require bounded diagnosis and model
escalation to a task-appropriate stronger permitted route, recording the actual
supported model/effort selection and reason. Do not assume a Terra/Sol ranking.
At the highest supported, permitted effort, or when no stronger approved route
is available, halt the loop, preserve evidence and report the blocker rather
than claim escalation. Preserve existing halt/retro/fix/resume requirements and
select actors by actual risk.
