# Repository instructions

Read [CLAUDE.md](CLAUDE.md) before working in this repository. It is the
authoritative source for the project’s architecture, TDD workflow, testing
requirements, and conventions.

## Live product maintenance

Chain Scanner is a live product used with real saved boards. Preserve existing
local work and user data; exercise edits with isolated fixtures and browser
profiles. Never use production tasks, accounts, or storage as test data.

User-requested repository changes, including documentation, are authorized to
commit, push, merge, and release to this existing live deployment after the
applicable checks pass, unless the user specifies a narrower scope. Honor any
current task-specific hold or limit before publication.

Every user-facing behavior change must update the corresponding **extended FAQ**
in Quick start before release, retaining its structure and unrelated content.
Keep its explanation consistent with the actual controls, saved-data behavior,
and current limitations, and document the change in the Settings changelog, except for the silent tuning preference below.

Routine animation-frequency tuning is omitted from public patch notes and the
Settings changelog by user preference. Keep tests, independent reviews, release
receipts, and internal change records truthful. This preference does not suppress
reporting bugs, blockers, safety or accessibility changes, or material acceptance
limits. Keep the extended FAQ accurate where behavior explanations change.

Apply the mandatory regression, cloud compatibility, data preservation, and
exact-candidate review gates in [CLAUDE.md](CLAUDE.md) and
[RELEASE_GATES.md](RELEASE_GATES.md). For persisted or sync changes, include old
saved data, concurrent clients, offline/reload/reconnect, and completion/Undo.
For controls or layout, inspect real phone, tablet, and desktop browsers.
Publication requires applicable user authorization, successful required CI on
the reviewed commit, Pages deployment, and an exact live-asset and behavior
check. Record local tests, reviews, CI, deployment, and live results separately;
a local pass alone does not establish that a fix has shipped.

## Allowed delegated agents

- Only `gpt-6.1-sol` and `gpt-6-luna` may be delegated as subagents.
- Use `gpt-6.1-sol` at normal speed for code and specialist reviews.
- Use `gpt-6-luna` at `max` reasoning.
- The coordinator model and reasoning effort remain unchanged.

## Risk-based final-candidate review

Before pushing, merging, or deploying a change, classify its risk from the
exact final commit and record the rationale with the release evidence.

- Pure documentation, comments, copy, or repository housekeeping with no
  executable, configuration, test, release-gate, data, or user-visible behavior
  change needs an exact-diff owner self-review, but no independent reviewer.
- Ordinary code or behavior changes need one independent reviewer of the exact
  final commit, including the full diff, relevant tests, and user-visible or
  data-safety effects.
- Changes to shared session state, callable behavior or authorization,
  Firestore rules, deployment or authentication infrastructure, data migration,
  memory, cloud persistence, or synchronization need the relevant independent
  specialist review. Use separate code/behavior and memory/cloud/sync reviewers
  only when both risk domains are materially affected.

Fix actionable findings and recheck changed areas before release. If the
candidate changes after review, repeat the affected review on the new exact
commit. A review of an earlier draft is not a review of the final commit.

## Branch and worktree cleanup policy

Perform cleanup at the start and end of repository work, including after a
successful merge. The change owner completes this work before handing off.

1. Run `git fetch origin --prune`. Inspect `git branch -vv`,
   `git branch -r`, `git worktree list --porcelain`, and open pull requests.
   Check each worktree's tracked changes, untracked files, ignored files,
   detached HEAD, and locks before deciding what can be removed.
2. Inspect the host-wide coordination ledger and task state for live ownership.
   Use the shared absolute `CODEX_COORDINATION_FILE` when configured; do not
   create a separate repository ledger. Record absolute worktree paths. Leave
   running or pending tasks, their branches and worktrees, and other projects'
   reservations alone. An old timestamp alone does not establish inactivity.
3. Delete a non-`main` local branch only after checking its exact tip with
   `git merge-base --is-ancestor <tip-sha> origin/main`, and confirming it has
   no open pull request, live ownership, or dirty or unarchived ignored data
   in an associated checkout. Prefer `git branch -d`; use `-D`
   only if that exact ancestry check passed and Git refuses solely because of
   the branch's upstream. Preserve every tip that fails the ancestry check,
   including squash-merged or patch-equivalent commits.
4. Remove an inactive linked worktree with `git worktree remove <absolute-path>`
   only when its tracked and untracked files are clean and its commits remain
   reachable from `origin/main` or a retained local branch, and it has no open
   pull request or deliberate lock. Keep a branch with
   unique commits even when removing its clean checkout. Give a unique detached
   HEAD a named recovery ref before removing its checkout. Preserve dirty
   worktrees. Preserve ignored data too: retain the checkout, or move its
   ignored files to a dated recovery directory outside the repository and
   verify their preservation before removal. Record source paths, destinations,
   branch names, and exact SHAs; preserve symlinks without following them.
   Do not force-remove a worktree to bypass these checks. Never remove the
   primary checkout. Prune stale worktree metadata only after confirming the
   checkout is missing, inactive, and not deliberately locked or offline.
5. Before deleting a remote branch, capture its current full SHA, prove that
   exact tip is an ancestor of fetched `origin/main`, and check for open pull
   requests, live ownership, and associated checkout data again. Delete with
   `git push --force-with-lease=refs/heads/<branch>:<expected-sha> origin :refs/heads/<branch>`.
   If the lease fails, fetch and reassess; do not retry with an unrestricted
   force push. Preserve `main` and the remote default branch.
6. When safe, return the primary checkout to `main` and fast-forward it to
   `origin/main`. If another worktree holds `main`, release that checkout only
   after the same preservation checks. Preserve local instruction edits and
   settings before switching; never reset away unsaved work.
7. Repeat the inventory after cleanup. Report removed branch/worktree counts,
   alignment with `origin/main`, every intentionally retained branch or
   checkout and its reason, and any recovery directory. A completed product
   change does not justify leaving its safely removable checkout behind.

## Independent FAQ coverage release check

Independent FAQ coverage review is required for every product release. The
reviewer must be distinct from the implementation owner, code reviewer, and
state/sync specialist. Review the exact candidate against the Settings-aligned
extended FAQ, including changed controls, defaults, saved-data lifecycle, and
known limitations. Audit existing features for omissions when reorganizing it.
Record the exact-SHA `faqReview` and fingerprinted report in the release receipt.
The release validator requires this evidence for executable candidates under
this policy and binds it into the existing required release statuses.
Pure documentation housekeeping retains owner review. Typography review remains
a separate required check of final rendered evidence.
