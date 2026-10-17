# Update an authorized PR body

Use this command when the task explicitly authorizes replacing the complete body of one identified Pull Request. Write the intended body to a UTF-8 file, then pass that file and the exact `owner/repository#number` target:

```sh
node scripts/agent-tools/pr-body-update.mjs \
  --pr emerald-pham/funsidething#160 \
  --body-file /tmp/pr-160-body.md
```

The command reads the file without trimming or changing Unicode and newline characters. It sends one structured REST `PATCH` to `repos/{owner}/{repository}/pulls/{number}` with only the `body` field. The explicit PR identifier and body file describe the authorized action; the command does not infer a target from the current branch or repository context.

The updater uses `gh api` directly. The installed `gh pr edit` route can fail on the deprecated GraphQL `projectCards` field; REST `PATCH` avoids that compatibility path. A successful response is accepted only when it identifies the requested PR and contains the exact replacement body.

If a write response is uncertain, the updater reads the same PR before considering a retry. A matching body is reported as verified and ends the operation without another write. If the body is absent, it retries at most once. If the readback cannot verify the state, it stops without retrying. A detected transport failure may add `http2client=0` to the `GODEBUG` value of only the subsequent `gh api` child process; the caller's environment and global GitHub configuration remain untouched.

The existing [PR-writing workflow](workflow.md#choose-the-next-workflow) and [issue authorization rules](issue-tracker.md) govern when the body may be changed. The existing [review and release policy](release-and-review.md) still governs approvals, required checks and release decisions; updating body text does not replace those steps.
