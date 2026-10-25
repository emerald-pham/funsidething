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

The current required-job policy comes from
[`data-safety.yml`](../../.github/workflows/data-safety.yml): `scanner-tests`
runs for pushes and pull requests; `release-evidence` and `deploy-pages` run
only for pushes to `main`. Their skips on other workflow events or branches are
expected. A skip of `scanner-tests`, a skipped main-push release job, an
unclassified job, or an unknown workflow policy cannot produce success. Update
the observer and its focused tests when that workflow policy changes.

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
Main and PR events execute their own full cohort. Ambiguous, unavailable or changed
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
