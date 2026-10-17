# Host coordination

Use the one host-wide v1 coordination ledger for every repository. The ledger owns task entries, leases, parked checkpoints, declared claims, resource identifiers, emulator reservations and configurations. Repository instructions still govern validation, review and release. This command does not allocate emulator slots; the existing slot client remains responsible for its reservation operations.

At startup, read the current [workflow](workflow.md), check the host ledger, and inspect any existing entry for this worktree before editing. If the checkout is parked, preserve its branch and files and follow its recorded checkpoint and next action. Do not create a duplicate entry, take over a lease, release another worktree's resource or reset the checkout.

The supported entry point is self-contained. From this checkout, install a stable copy at an explicit path, then evaluate its output in the current shell to select the canonical ledger:

```sh
node scripts/agent-tools/coordination.mjs install --to "$HOME/.local/bin/chain-coordination.mjs"
eval "$("$HOME/.local/bin/chain-coordination.mjs" export-env)"
```

`install` creates only the named executable. It leaves an identical existing copy alone and refuses to replace different content. `export-env` prints a shell assignment; it does not edit shell profiles. With no existing setting, discovery uses the same legacy default location. Set `CODEX_COORDINATION_FILE` to the same absolute path in each participating shell, tool and project. The older `DOW_EMULATOR_COORDINATION_FILE` remains a compatibility alias. If the explicit `--file` value, canonical setting and legacy alias disagree, the command stops and identifies the conflict instead of choosing another ledger.

Use `discover` to see the selected path and `status` to inspect the current v1 state. `begin` records an attached non-main task branch and its scopes, claims and resources. `heartbeat` renews only the active entry owned by the current worktree. `claim` adds ownership to that entry; `release-claim` removes only the named ownership and requires the same worktree. These commands retain the v1 identifiers, lease fields, unknown metadata, reservations and configurations under the existing token lock.

`park` requires a clean checkout and the exact current commit SHA. `resume` requires the same worktree, branch and checkpoint. Parked entries keep their claims and resources without a heartbeat. Use `finish --adapter chain-scanner` to record completion. A landed result requires a clean task branch, the exact task commit contained in local `main`, the actual `origin` main ref matching local `main`, and a valid receipt from Chain Scanner's `scripts/release-evidence.mjs` for that exact SHA. The adapter checks the remote directly instead of trusting a possibly stale local `origin/main` tracking ref. It records the receipt and candidate identity with the completed entry. It does not infer release evidence from another application's package version or changelog. Preserved work also requires `--preserve-ref remote/branch`; discarded work requires `--reason`.

Tests and examples use an explicit fixture ledger. Never point tests at the live host ledger, and never create a repository-local coordination file for convenience. If the stable copy cannot load or the configured paths conflict, report that state rather than falling back to a second ledger.
