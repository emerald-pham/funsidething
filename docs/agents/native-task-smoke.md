# Native task smoke

`native-task-smoke.mjs` promotes the reviewed release-driver controls for the
actual Chain Scanner task actions. It can verify an approved public deployment,
or run the explicitly named local fixture mode against exact Git-source bytes.
Both use a fresh signed-out browser profile and synthetic task names.

The command requires an explicit full commit SHA and tree SHA, an absolute new
JSON output path, an engine, and a mode:

```sh
node scripts/agent-tools/native-task-smoke.mjs \
  "$PWD" "$SOURCE_SHA" "$SOURCE_TREE" \
  "http://127.0.0.1:$ALLOCATED_PORT" "$OUTPUT_JSON" chromium local-fixture
```

Before using `local-fixture`, claim the exact `loopback:127.0.0.1:<port>` in the
shared host coordination ledger. The origin must be the literal
`http://127.0.0.1:<port>` address with an explicit port, no credentials, path,
query, or fragment. The tool binds only to that address and port, serves the
selected Git source, and closes its listener and browser profile on completion.
It blocks requests outside the loopback origin and fails if the signed-out
synthetic SDK receives a cloud RPC. This local fixture is useful for checking
the native browser path; it does not establish public deployment or account
behavior.

The existing `npm test` and `test:agent-tools` cohorts require one actual local
Chromium driver case. They fail for an omitted, skipped or failed case, absent or
wrong-source report, and incomplete cleanup. Local runs reuse the explicit
`CHAIN_NATIVE_CANDIDATE_SHA`, `CHAIN_NATIVE_CANDIDATE_TREE` and durable
`CHAIN_NATIVE_OUTPUT` directory from installed-client validation. Allocate and
set `CHAIN_NATIVE_SMOKE_PORT` separately from `CHAIN_NATIVE_PORT`, because the
two cohorts can run concurrently. Missing source, port, Chromium or output
configuration fails the case; it never skips it.

Only an isolated runner with `CI=true` may request literal `http://127.0.0.1:0`.
The fixture binds the OS-selected port itself and retains that listener, avoiding
a reserve-and-close port race. Its report records the requested origin and the
actual listener origin/port, and all browser and transport checks use the actual
origin. Ordinary local execution continues to require the allocated nonzero port.
CI uses synthetic local fixtures; approved public checks remain postdeployment.

Local mode checks 12 Add actions, ten Yes choices, ten Done completions, and
Undo. It records trusted browser click events, including one real detail-2
double-click control that the app must reject after the preceding detail-1
completion. The accepted 20 decision facts must match the durable device head
within the existing 15-second allowance, survive reload, and remain available
after Chromium takes the local page offline and reopens it from the service
worker. The online and offline transport probes use separate uncached paths
while the local listener stays open.

Public checks retain the existing exact-origin allowlist:

```sh
node scripts/agent-tools/native-task-smoke.mjs \
  "$PWD" "$SOURCE_SHA" "$SOURCE_TREE" \
  "https://emerald-pham.github.io/funsidething/" "$OUTPUT_JSON" chromium online
```

Use `offline` only with Chromium. Public execution verifies the returned
`index.html` against the selected Git source; local mode also serves and
fingerprints the complete service-worker shell. Public deployment and offline
checks are post-deployment evidence and remain distinct from local-fixture
results. Neither mode proves physical touch hardware, iOS, standalone behavior,
or a private authenticated account.

The driver uses the existing `browser-fixture-setup.mjs` first-run helper and
`installed-client-fixture.mjs` synthetic SDK modules. It does not alter app
guards, save data through a rescue path, retry user actions, or synthesize
click-detail values. Store each new report and screenshot in the task's durable
evidence directory; do not reuse an output path.
