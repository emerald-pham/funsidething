# Host coordination

Use the one host-wide v1 coordination ledger for every repository. The ledger owns task entries, leases, parked checkpoints, declared claims, resource identifiers, emulator reservations and configurations. Repository instructions still govern validation, review and release. This command does not allocate emulator slots; the existing slot client remains responsible for its reservation operations.

At startup, read the current [workflow](workflow.md), check the host ledger, and inspect any existing entry for this worktree before editing. Fetch `origin` with pruning and compare the checkout SHA with `origin/main`. For an older or parked checkout, use `git show origin/main:CLAUDE.md` and its routed documents to find current instructions without switching branches or resetting files. Consult the live tracker through [GitHub tracker](issue-tracker.md). Preserve a parked branch and its files and follow the recorded checkpoint and next action. Do not create a duplicate entry, take over a lease, release another worktree's resource or reset the checkout.

The supported entry point is self-contained. From this checkout, install a stable copy at an explicit path, then evaluate its output in the current shell to select the canonical ledger:

```sh
node scripts/agent-tools/coordination.mjs install --to "$HOME/.local/bin/chain-coordination.mjs"
eval "$("$HOME/.local/bin/chain-coordination.mjs" export-env)"
```

`install` creates only the named executable. It leaves an identical executable copy alone and refuses different content, symlinks or an existing nonexecutable file. It does not change existing file permissions. `export-env` prints a shell assignment; it does not edit shell profiles. With no existing setting, discovery uses the same legacy default location. Set `CODEX_COORDINATION_FILE` to the same absolute path in each participating shell, tool and project. The older `DOW_EMULATOR_COORDINATION_FILE` remains a compatibility alias. If the explicit `--file` value, canonical setting and legacy alias disagree, the command stops and identifies the conflict instead of choosing another ledger.

Each command accepts only its documented options. Ownership values are repeatable: `begin` accepts `--scope` or `--scopes`, `--claim` or `--claims`, and `--resources`; `claim` and `release-claim` accept the same ownership controls. Singular and plural scope/claim spellings are aliases and are combined when repeated. The remaining options are command-specific:

| Command | Options |
| --- | --- |
| `discover`, `export-env`, `status` | `--file` |
| `begin` | `--file`, `--base-ref`, `--work-type`, `--intent`, `--version-plan`, `--preemptive-changelog`, `--implementation-prompt`, and the ownership controls above |
| `heartbeat` | `--file`, `--id`, `--now` |
| `claim`, `release-claim` | `--file`, `--id`, `--now`, and the ownership controls above; `release-claim` also accepts optional `--expected-lease-sha256` |
| `park` | `--file`, `--id`, `--checkpoint-sha`, `--next-action`, `--now` |
| `resume` | `--file`, `--id`, optional `--checkpoint-sha`, `--now` |
| `finish` | `--file`, `--id`, `--adapter`, `--outcome`, optional `--preserve-ref`, `--reason`, `--result` |
| `install` | `--to` (absolute path) |
| `migrate` | `--file`, `--to`, `--backup-dir`, `--expected-sha256`, `--phase` |

Unknown options, missing values, duplicate single-use options and invalid option combinations fail before the command starts Git or mutates the ledger. The error identifies the rejected option or missing requirement.

Use `discover` to see the selected path and `status` to inspect the current v1 state. `begin` defaults to local `main`, then `origin/main`; select another existing local or remote-tracking branch with `--base-ref master` or `--base-ref origin/master`. The selector must resolve to one branch ref and a commit. Missing refs, tags, revision expressions, option-like values and ambiguous short names are rejected; use `refs/heads/...` or `refs/remotes/...` to name an ambiguous ref explicitly. The command protects `main` and the selected base's corresponding local branch from direct registration. A remote-tracking base must map through exactly one configured remote fetch refspec to a local branch; ambiguous, unmapped or non-local-branch mappings are rejected. Remote and branch names may contain slashes. New entries record `selectedBase.ref` as a fully qualified ref and `selectedBase.sha` as its commit. The legacy `startMainSha` remains the actual main SHA when one is available and is omitted for a master-only repository. Older entries without `selectedBase` retain the main/origin-main default.

Run new `begin` commands at the actual Git worktree root; subdirectory invocation is rejected. Accessible active or parked legacy entries recorded through a subdirectory or symlink still block a duplicate for that same Git root. Their recorded paths and ownership remain unchanged; this check performs no migration or takeover. `heartbeat` renews only the active entry owned by the current worktree. `claim` adds ownership to that entry; `release-claim` removes only the named ownership and requires the same worktree. These commands retain v1 identifiers, lease fields and unknown metadata under the existing token lock. With `--expected-lease-sha256`, `release-claim` also requires the exact SHA-256 of the current lease object, one exact resource, and an active healthy unexpired lease; all checks happen inside the existing lock. A changed lease, inactive/expired owner, or resource no longer held by that lease refuses the release without writing the ledger. Omitting the option retains ordinary `release-claim` behavior. The existing dead-reservation cleanup remains in force. `begin` and `claim` retain configurations backed by an active entry or a surviving reservation; a parked entry alone does not retain an emulator configuration. Missing or offline worktree paths do not waive active ownership.

`park` requires a clean checkout and the exact current commit SHA. `resume` requires the same recorded worktree and branch. Both use the entry's saved `selectedBase` when present; legacy entries without it retain the main/origin-main default. By default resume validates the saved parked checkpoint against the current clean checkout. The inherited v1 `--checkpoint-sha <current-sha>` override instead validates the same owner's explicitly supplied current checkpoint; it does not prove the old saved SHA was verified, rewrite the saved parked checkpoint, or transfer ownership. Parked entries keep their claims and resources without a heartbeat. Use `finish --adapter chain-scanner` to record completion. A landed result requires a clean task branch, the exact task commit contained in local `main`, the actual `origin` main ref matching local `main`, and a valid receipt from Chain Scanner's `scripts/release-evidence.mjs` for that exact SHA. The adapter checks the remote directly instead of trusting a possibly stale local `origin/main` tracking ref. It records the receipt and candidate identity with the completed entry. It does not infer release evidence from another application's package version or changelog. Preserved work also requires `--preserve-ref remote/branch`; discarded work requires `--reason`.

This entry point supports shared lifecycle and ownership plus Chain Scanner completion. Den of Wolves keeps its existing completion client, validation, version and changelog gates. Adoption does not migrate that repository or replace its release contract. Slot allocation and repository-specific validation commands remain with their existing clients on the same ledger.

Tests and examples use an explicit fixture ledger. Never point tests at the live host ledger, and never create a repository-local coordination file for convenience. If the stable copy cannot load or the configured paths conflict, report that state rather than falling back to a second ledger.

## Durable host migration

Use this procedure only for an authorized host location change, after the concrete
paths, environment configuration and recovery plan receive infrastructure review.
Discovery deliberately keeps the legacy temporary default until the owner exports
the persistent `CODEX_COORDINATION_FILE`. Migration does not edit shell profiles,
install or replace executables, change completion checks, or transfer ownership.

1. Inventory every participating project's clients, shells, background guardians
   and launchers. Keep foreign owners in control of their own work. Every active
   entry must be parked or completed by its owner and every live reservation must
   stop before migration; expired leases, dead entry PIDs and missing worktrees
   do not waive active ownership. Pause the migration owner's guardian too.
2. Select one persistent absolute destination and one fresh backup directory
   outside temporary storage and disposable checkouts. Inspect existing environment
   settings and shell startup files, retain exact backups/hashes, and resolve any
   disagreement before proceeding. Keep different installed helpers and unrelated
   shell settings intact. Use the reviewed repository CLI for the cutover.
3. Hash the raw source bytes after owners quiesce, then use the same source,
   destination, backup directory and digest for every phase:

   ```sh
   node scripts/agent-tools/coordination.mjs migrate \
     --file "$SOURCE_LEDGER" --to "$PERSISTENT_LEDGER" \
     --backup-dir "$MIGRATION_BACKUP" --expected-sha256 "$REVIEWED_SHA256" \
     --phase prepare
   ```

   `--phase all` (the default) performs prepare, block and publish under both locks.
   Explicit phases permit inspection or safe recovery at each process boundary:

   | Phase | Authority and completion criterion |
   | --- | --- |
   | `prepare` | Source remains writable. Exact `source.json`, staged destination bytes and `migration.json` are durable; destination is absent. |
   | `block` | Source is atomically replaced with a non-JSON retirement marker. No live ledger is writable until publish; the exact backup and receipt explain recovery. |
   | `publish` | Complete staged bytes are linked exclusively to the destination. Destination is authoritative; repeat publish can complete an interrupted staging unlink/receipt update. |
   | `rollback` | Allowed only while destination is absent. Validated original/blocker identity and saved bytes restore source authority; backup and receipt remain. |

   Migration preserves every raw byte, including parked/foreign ownership,
   reservations, configurations and unknown metadata. It uses the existing token
   locks for both paths, refuses active ownership and malformed v1 state, and
   checks file identity as well as SHA-256 at transitions. Existing destinations
   (even equal bytes), symlinks, unrecognized locks, hardlinks and unsafe ownership
   fail closed. Destination/backup parents must be literal owned directories, with
   trusted user/root ancestors (root-owned sticky temporary ancestors are allowed);
   only the existing macOS system `/var` → `/private/var` source spelling is
   accepted as an ancestor alias and its physical path is recorded.
4. Inspect `migration.json`, the exact backup and both paths after each phase.
   On error or interruption, the receipt may precede the final filesystem change:
   compare recorded inode/device/owner/mode and digest with actual files before
   resuming the same phase. A recognized original, retirement marker or known
   target/staging link has a supported recovery path. Replaced/missing identities
   require owner investigation; never force overwrite, delete a foreign file, or
   infer ownership from equal bytes. After destination publication, use that ledger
   and retain the old marker; rollback is forbidden even before the receipt update.
5. Publish and validate exact before/after bytes and retained ownership, then
   configure one small explicit environment file for all participating launchers.
   `export-env --file "$PERSISTENT_LEDGER"` prints its canonical export without
   editing settings. If a legacy client needs the older variable, derive
   `DOW_EMULATOR_COORDINATION_FILE` from the same canonical value. Have each relevant
   startup file source this file while preserving unrelated bytes; a login-only
   startup file does not configure noninteractive shells. Existing processes must
   restart or receive the same environment explicitly before resuming.
6. From fresh shells in every participating project, verify discovery (and the
   participating legacy/slot client) selects the identical persistent path, read
   the retained state, then resume the same parked entries. Verify restart and
   temporary-directory-loss behavior with disposable fixtures. The old marker is
   deliberately invalid JSON: older v1 parsers stop instead of normalizing a valid
   JSON pointer into an empty ledger. Its atomic file replacement avoids the
   file-to-directory crash gap; symlink/hardlink aliases are unsafe under legacy
   atomic renames. Temporary-directory removal can remove the marker, so canonical
   configuration of every participating launcher is a completion requirement.
