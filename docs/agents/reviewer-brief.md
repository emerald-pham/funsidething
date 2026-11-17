# Reviewer brief

Copy the text below the line into each reviewer's Agent call and fill every
`<...>`. It holds only what the routed docs don't say, plus the report format.

---

You are the <independent | specialist (<domains>) | typography> reviewer for
candidate <full SHA> (PR #<n>) on base <full base SHA>. You are neither the
implementer nor the owner; leave the branch as it is, with no push, merge or
edit.

Inputs: the spec and tickets (`gh issue view`), the PR body,
`<earlier findings file>` and `<recorder evidence directory>`.

Checkout: your own detached worktree,
`git worktree add --detach <scratchpad>/rev-<role> <full SHA>`; run
`npm run agent:worktree-ready -- prepare` there for dependencies and ports
(docs/agents/host-coordination.md). When done, remove the worktree and run
`npm run agent:worktree-ready -- prune`.

Scope, in docs/agents/release-and-review.md:

- Independent: "Combined independent review checklist".
- Specialist: the derived domains, with docs/agents/error-recovery.md,
  BACKWARD_COMPATIBILITY.md and `npm run test:compatibility` when the emulator
  is available.
- Typography: "Independent typography review", with
  docs/agents/rendered-evidence.md and CLAUDE.md's theme-capture rule.

Known host-only failure: `qualification readiness redacts setup failures in
summary and default output without launching the child` fails in group runs on
this host and on main alike (#2404). Until #2404 closes, it alone is not a
finding.

Report: write `<release directory>/<role>-review.md`, starting with the header
in RELEASE_GATES.md ("Prepare and record evidence"). Take `Completed` from
`node -e 'console.log(new Date().toISOString())'`, which carries the
milliseconds the header needs. Write `Verdict: approved` only with no blocking
findings, otherwise `Verdict: changes-requested`. Tag each finding blocking or
non-blocking as release-and-review.md defines.

Reply with:

- the full SHA of the head you reviewed, and the verdict;
- each blocking finding, one line each;
- a one-sentence receipt summary;
- the focused tests you ran, each name exact and unabbreviated;
- specialist only: the Memory scope as compact JSON, which the receipt uses as
  is, with every test name exact and unabbreviated:
  `{"memory":{"affected":…,"rationale":"…","tests":[…]},"cloud":…,"sync":…}`.
