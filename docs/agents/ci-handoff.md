# Local validation and CI handoff

Use `npm run agent:ci-handoff --` when a clean committed topic revision should
complete local CI and then advance that exact revision to an explicit remote
topic branch. The command makes one ordinary non-force Git push after a complete
qualifying cohort. Existing pre-push hooks and release receipts still apply;
prepare the exact outgoing revision's required reviews and receipt first.

Before invoking it, allocate the native/browser and emulator resources under
[host coordination](host-coordination.md). Select Node 22 on the task-local PATH
and Java 21. Supply an allocated native port and a durable evidence directory
outside the checkout:

```sh
npm run agent:ci-handoff -- \
  --repo "$PWD" --remote origin --branch ci/my-topic \
  --base <full-comparison-commit-sha> \
  --evidence-dir /absolute/path/to/task-evidence/ci-handoff \
  --native-port <allocated-port>
```

For an existing destination branch, the comparison base is its current remote
tip. For a new branch, use the merge base of the candidate and the actual remote
`main`; fetch beforehand so that commit exists locally. A destination/base change
during validation rejects handoff. This entry point accepts only a named remote
and topic destination; it does not merge or deploy.

The supported cohort follows the pinned Data safety workflow: dependency setup,
matching Chromium installation, test-first diff gate, Node/agent-tool tests,
Firestore rules and backward compatibility. On Linux, Chromium setup includes
its platform dependencies. macOS executes the applicable same tests locally;
Ubuntu CI remains independently required. A workflow or required-script change
fails closed until this command's mapping is reviewed and updated.

Each attempt writes a private `summary.json` and one output log per command,
binding the captured commit/tree, comparison base, complete command plan,
configuration and runner fingerprints, toolchain/platform and native identity.
Effective npm lifecycle/dependency controls and project root must retain their
ordinary defaults; environment, user/global or project npm configuration cannot
narrow or replace the cohort. Only the approved nonsecret setting keys/values
are recorded; registry/authentication configuration is never dumped.
Only explicitly source-declared, currently non-applicable environment cases can
be skipped in the main test command. The existing required native process
contract must complete exactly once; its own validator retains both case and
artifact checks. Required rules and compatibility outcomes remain mandatory.
Dirty state, revision/configuration changes, incomplete/nonzero/cancelled output,
missing required results and GitHub skip-CI messages reject qualification.

A published revision is not remote CI success. `remoteCi` remains `unobserved`;
use [CI monitoring](ci-monitor.md) with the actual remote run identity afterward.
An already published revision causes no second local cohort or inferred new run.
A denied, failed or interrupted push is unresolved and is never automatically
retried. Preserve its successful local logs; inspect the remote and resolve the
push safeguard before deciding on an explicit ordinary publication. There is no
evidence-import/replay option that could turn stale or edited records into a
qualifying pass. `prepared`, `validating` or `publishing` left by a crash is
incomplete or uncertain, never a success. Generated evidence is inspectable
provenance, not tamper-proof attestation.

Focused regression: `node --test scripts/agent-tools/ci-handoff.test.mjs`.
These disposable-repository tests simulate external test/tool boundaries and
exercise real Git publication/hooks. They establish orchestration behavior, not
a completed application, browser, emulator or remote CI run. `npm test` already
includes this file through its agent-tool glob.
