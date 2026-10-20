# Local Beta artifact preparation

`node scripts/channel-release.mjs prepare-beta` prepares the minimum Beta
identity needed by issues207/208. It never invokes Firebase, changes Auth/rules,
publishes a deployment, promotes Stable, or changes the main-only Pages workflow.
The release owner retains all existing review, FAQ, native installed-client,
compatibility, CI, screenshot, typography, public-byte and live-behavior gates.

Run from the Git repository containing the explicit committed product source:

```sh
node scripts/channel-release.mjs prepare-beta \
  --source <full-40-character-product-commit> \
  --tree <full-40-character-product-tree> \
  --output <new-absolute-canonical-artifact-directory> \
  --deployed-at <explicit-YYYY-MM-DDTHH:mm:ss.sssZ> \
  --notice-starts-at <explicit-YYYY-MM-DDTHH:mm:ss.sssZ>
```

The output parent must already exist and have no symlink/traversal alias. An
existing output is always refused. Default preparation requires the existing
`scripts/release-evidence.mjs` validator's exact-source receipt. No receipt flag,
file, branch label, screenshot acceptance or elapsed time can substitute for it.
The artifact retains the verified receipt file digest and candidate identity.
Preparation is not evidence of publication or authorization to promote Stable.

For a local screenshot/review fixture only, add `--preview`. Its manifest and
stderr say `UNREVIEWED - NOT FOR PUBLICATION`, its mode is `preview`, and
`publishable` is false. Never deploy a preview artifact. After the actual final
candidate passes its required review gates, prepare a fresh reviewed artifact
in a new directory. Do not relabel or mutate a preview into a reviewed artifact.

The explicit timestamps form the staged envelope for the intended Beta delivery;
they do not prove that delivery happened. The release owner chooses the actual
publication window and verifies it against publication evidence. There is no
Stable command or Stable timestamp transition here. Beta preview cannot start,
consume or approve the later Stable notice window.

## Output contract

- `public/` contains the committed worker shell inventory plus `sw.js`, extracted
  through the existing `git archive` consumer and checked against the exact Git
  blobs. Source/tree, product fingerprint and worker cache fingerprint must agree.
  Dirty and untracked local files are excluded. Tests, scripts, agent sessions
  and arbitrary repository documentation are not a second publication inventory.
- `public/channel-release.json` is separate additive deployment metadata with
  schemaVersion1, channel `beta`, origin `https://chain-scanner.web.app`, basePath
  `/`, immutable product commit/tree/fingerprint, explicit `deployedAt`, and
  `notices.sync-stability-2026-10.startsAt`. A committed envelope collision is
  refused rather than overwritten or silently ignored.
- `firebase.json` contains only Hosting configuration for existing site
  `chain-scanner`, public directory `public`, network-fresh envelope headers and
  revalidation for the HTML/worker. It contains no Firestore/Auth settings.
- `artifact.json` records mode, publication-not-attempted status, product identity,
  exact receipt digest when reviewed, public-file SHA-256/size inventory, config
  digest and an artifact digest over the manifest before its own digest field.
  These hashes identify preparation bytes; they are not a tamper-proof signature.
  Preserve the artifact unchanged and recheck its hashes before any later use.

All committed symlinks, special nodes and unsafe paths are refused before
extraction, including paths outside the public inventory. The command reserves a
new empty output exclusively, builds in a private sibling directory, then
atomically replaces its own empty reservation with the complete artifact. An
ordinary failure cleans only its staging directory and unchanged empty
reservation, preserving existing outputs, neighboring files and source work.
An uncatchable process termination may leave a private incomplete staging
folder or an empty reservation; neither is a completed or publishable artifact.

## Isolation and verification limits

Stable remains `https://emerald-pham.github.io/funsidething/`; designated Beta is
`https://chain-scanner.web.app/`. Existing relative manifest id/start_url/scope
and product asset bytes remain unchanged. Their resolved installed identities,
worker scopes and browser storage are origin-qualified. Actual independent
Hosting availability, origin/worker/storage/Auth behavior and shared-backend
bidirectional board parity require the release owner's runtime evidence before
enabling channel navigation. Configuration strings and local preparation alone
do not establish those outcomes. Shared cloud writes remain shared; separate
frontend origins do not isolate backend data.

This minimum command does not implement advanced metadata displays, comparison
counts, elapsed-use accounting, changelog promotion, or issue209's explicit
exact-artifact Stable promotion mechanism.
