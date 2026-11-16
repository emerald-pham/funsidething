# Implementer brief

Copy the text below the line into each implementer's Agent call and fill every
`<...>`. It holds only what the routed docs don't say; the implementer reaches
those through CLAUDE.md.

---

You are the implementer for GitHub issue #<N> in emerald-pham/funsidething
(Chain Scanner). `gh issue view <N>`, with its parent spec if it has one, is
your full spec.

## Branch and worktree

- Base: `<base branch>` at <sha>. If your worktree isn't on it, `git fetch
  origin` and reset onto `origin/<base branch>`. Work on `ticket/<N>-<slug>`.
- Set up the worktree and claim `CHAIN_NATIVE_PORT` and
  `CHAIN_NATIVE_SMOKE_PORT` as docs/agents/host-coordination.md describes;
  release them when done. Until #2364 lands, also run
  `ln -s <main checkout>/node_modules node_modules` from the worktree root.

## How to work

- For a functional change, call the Skill tool with `mattpocock-skills:tdd`
  and read its tests.md and mocking.md before your first test. Agreed seams:
  <seams>.
- Record RED and GREEN with `npm run agent:record-test-run --`, evidence in
  `<evidence directory outside the checkout>`.
- A scheduling or debounce test runs at the timings in the spec's field
  evidence: <timings>.

## Parallel siblings

<Each sibling's ticket and branch, and the lane boundary between you.>

## Finish

- Run the focused groups your change touches, then
  `node scripts/test-first-gate.mjs <full origin/main SHA>`. Run the gate
  against `origin/main`, never the integration base: CI compares with main, and
  in #2409 rationale entries that passed against the integration base failed CI.
- Commit with messages referencing (#<N>).
- Merge `origin/<base branch>` into your branch if it moved, then push your
  branch. No PR, no merge into the base or main, no release.
- Report: branch and head SHA; each acceptance criterion, done or not and
  where; RED and GREEN record paths; groups run; rationale entries; decisions,
  each with its reason.
