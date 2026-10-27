# CI run monitoring

Use `scripts/agent-tools/ci-monitor.mjs` to observe one GitHub Actions run. Supply
the repository, numeric run id, full candidate commit SHA, and a private local
evidence directory:

```sh
node scripts/agent-tools/ci-monitor.mjs \
  --repo emerald-pham/funsidething \
  --run-id 123456789 \
  --commit 0123456789abcdef0123456789abcdef01234567 \
  --evidence-dir /absolute/path/to/task-evidence/ci
```

The observer checks the response's run id and `headSha` against both supplied
identities before accepting a result. It prints progress only when the run or a
job changes, backs off between unchanged reads, retries transient reads within
fixed limits, and returns after the configured wait or poll limit. Defaults are
20 polls, a 90-second wait limit, 5-to-30-second poll delays, two retries with
500-millisecond exponential delay, and a 20-second per-request timeout. Use
`--interval-ms`, `--max-interval-ms`, `--max-polls`, `--max-wait-ms`,
`--max-retries`, `--retry-delay-ms`, `--max-retry-delay-ms`, and
`--request-timeout-ms` to tune those bounds.

Exit code `0` means the bound run and commit succeeded and its raw logs were
saved. Exit code `1` reports a failed or canceled run, or an identity mismatch.
Exit code `2` reports pending, waiting, running, or unresolved observation.

Each invocation creates a private attempt directory beneath the evidence
directory. `summary.json` records the result and limits, `snapshots.jsonl` keeps
the raw run responses, `progress.jsonl` records changed and unchanged polls,
`requests.jsonl` records the exact read commands and retry details, and
`logs.txt` retains the full raw output of `gh run view --log` when available.
An unavailable status read is unresolved. A completed success without saved raw
logs is also unresolved; an observed failure or cancellation keeps that result
when log retrieval is unavailable.

The observer reads the committed `data-safety.yml` at the actual checkout,
independently of the returned job list. It binds that checkout to the persisted
checkout log or explicit checkout stamp, reads its commit/tree and PR parents,
and verifies the workflow blob digest. Raw policy reads and the resolved
`workflow-policy.json` are preserved. Logs are requested for the observed run
attempt. Missing workflow provenance or an unknown topology remains unresolved;
absence of new jobs never implies a legacy policy.

For `four-groups-v1`, required jobs are `validation-context`, `event-gates`,
`cohort-routing`, the four `regression-*` groups and `scanner-tests`. Every one
must succeed, including covered-reference jobs. The observer also checks exact
source/checkout/tree/base/workflow announcements and the successful aggregate
marker; full producers require their separate final completion marker.
`release-evidence` and `deploy-pages` additionally must succeed on main pushes;
their skips on other branches/events are expected. A known missing or skipped
required job is failure, an unknown or duplicate job is unresolved, and a
canceled job remains canceled. The fixed legacy three-job topology is accepted
only when the actual committed workflow independently verifies that policy.

For a branch push with one same-repository PR, routing may use that PR's exact
merge checkout as the complete-cohort producer. The outgoing push still executes
its own source/before test-first, rules and compatibility checks. Its scanner job
stays pending while a producer is pending, fails for a known matching producer
failure or cancellation, and succeeds through reuse only after the exact producer
aggregate completes successfully. A skipped scanner aggregate remains forbidden.
The monitor keeps the same exit-code contract for the automatic handoff; it does
not substitute the producer's run id or source for the requested push run.

`ci-routing/routing.json` and raw public observations bind the outgoing validation
context separately from the cohort's source, actual merge checkout/tree, PR base,
event policy and required cohort. A successful producer's original run and attempt
remain in `coveredBy`; native reports retain that producer's actual candidate SHA.
Exact-main and source/base-changing PR events retain fresh validation. Equivalent
metadata edits use the bound original producer described below. Ambiguous,
unavailable or changed
PR/run observations fall back to the actual outgoing checkout's full cohort.
Routing reads public metadata with existing permissions, caps reads and pending
waits, and rechecks PR merge/base identity after producer completion. Source-head
or tree equality alone cannot authorize reuse. The completion marker is emitted
only after the workflow's full required regression and native-artifact checks.

The GitHub boundary uses `gh run view` for metadata and logs. A local
`GODEBUG=http2client=0` retry is used only after a TLS handshake timeout; it is
passed to that `gh` process and does not change global configuration or install
another CLI version.

A successful monitor result establishes the outcome of this exact Actions run
only. Keep CI batching, required review identities, exact-commit evidence,
compatibility checks, deployment verification, and live behavior checks in
[`release-and-review.md`](release-and-review.md).

Metadata-only PR `edited` events compare the complete canonical context: repository,
source and source tree, actual merge checkout and tree, comparison base, event
policy, committed workflow/configuration and cohort inventory/assignments, and
Node/platform runtime. The existing Data safety workflow serializes PR events by
workflow and PR number with `cancel-in-progress: false`. Branch pushes retain
separate ref keys and exact-main deployment qualification remains required.
GitHub may replace queued runs; a cancelled run remains cancelled evidence.

The validation-context announcement binds identity. The separate successful
`Admit original full producer context ...` step in `cohort-routing` admits only
`decision=full`; failed/interrupted coverage observers cannot impersonate original
execution. Successful reuse also requires the original complete topology,
aggregate/report marker, early startup report and final unchanged PR context.
Policy-only inheritance retains its existing independently reviewed route.

A bound pending producer returns `pending`/exit 2, a known failure returns
`fail`/exit 1, cancellation returns `cancelled`/exit 1, and missing final or
unavailable bound evidence returns `unresolved`/exit 2. None launches another
cohort. Missing admission or changed/unverifiable context uses fresh validation.
Raw API reads and prior failures remain in their attempt directories. Compact
output names one `next` gate and the exact `routing.json` artifact.

Routing saves the producer's run/attempt and complete context before waiting.
After an interrupted observation, retain the record, adjacent `event.json` and
`descriptor.json`, then run in the exact checkout:

```sh
node scripts/agent-tools/ci-routing.mjs \
  --resume /absolute/path/to/original/routing.json \
  --evidence-dir /absolute/path/to/new-attempt
```

The saved nonsecret routing environment, sanitized event identity and descriptor
restore missing invocation inputs in a fresh process without conversation
history. Explicit current workflow inputs still must match the complete context.
Resumption verifies the complete current context and rereads that same producer attempt. A newer success
cannot hide its failure. Keep the original record and observations unchanged.
The command only reads GitHub and never dispatches a workflow. The separate
`ci-monitor` command also observes the explicit run without starting work.
The handoff meanings remain: exit 0 is verified success, 1 is failure/cancellation
or identity mismatch, and 2 requires continued observation or investigation.
