# Compact release checkpoints

Use a checkpoint when a release attempt needs a resumable, source-bound summary of required gates and separate follow-up investigations. The command validates and records supplied state; it never launches tests, reviews, CI, providers, or other gates.

## Record shape

Each version 1 JSON record contains:

- `id`, `revision`, and `source` with the exact 40-character `commit`, `tree`, and ancestor `base` SHAs.
- `requiredGates`, each with an `id`, `status`, short `summary`, and `evidence` pointers. Gate statuses are `pending`, `failed`, `cancelled`, `unresolved`, or `passed`.
- `followUps`, each with an `id`, `status`, short `summary`, and evidence pointers. Follow-up statuses are `unverified`, `in_progress`, or `complete`; an unverified physical or private follow-up remains visible without blocking release completion.
- `status` and `nextAction`. An `open` record has exactly one next action naming an incomplete required gate. A `complete` record has every required gate passed and `nextAction: null`.

Evidence pointers contain a unique `id`, absolute artifact `path`, `sha256`, `sourceCommit`, and `sourceTree`. The command hashes the file and checks its Git source identity. Every passed required gate needs at least one pointer for the record's exact current source commit and tree. Historical failed evidence may point to an earlier source and remains unchanged when a record is resumed.

The checkpoint JSON is limited to 32 KiB, 32 gates and follow-ups each, and 32 evidence pointers total. Evidence files have no byte-size cap: the command hashes each file through a fixed-size buffer, samples its size before reading, rejects growth past that size, and checks the file's size and timestamps again afterward. Pointers are fingerprints, not embedded reports.

## Create, validate, and resume

Create writes a new checkpoint and refuses to replace an existing path:

```sh
node scripts/agent-tools/checkpoint.mjs create \
  --repo "$PWD" \
  --input /absolute/path/checkpoint-input.json \
  --record /absolute/path/checkpoint-v1.json
```

Validate checks an existing record against its local Git objects and evidence files without changing it:

```sh
node scripts/agent-tools/checkpoint.mjs validate \
  --repo "$PWD" \
  --record /absolute/path/checkpoint-v1.json
```

Resume takes a complete next-revision JSON input and writes it to a new path:

```sh
node scripts/agent-tools/checkpoint.mjs resume \
  --repo "$PWD" \
  --previous /absolute/path/checkpoint-v1.json \
  --input /absolute/path/checkpoint-v2-input.json \
  --record /absolute/path/checkpoint-v2.json
```

Resume retains the checkpoint id and source, increments `revision` once, keeps every prior gate and follow-up, and preserves each prior evidence pointer byte-for-byte. It writes the new file through a same-directory temporary file and an atomic no-clobber link, leaving the previous checkpoint intact if validation, writing, or publication fails.

The command verifies caller-declared gate states, exact Git object identities, and evidence-file fingerprints. It cannot attest that a command or review actually ran, authenticate a human approval, or verify a private/physical investigation. Keep those limits visible in the summaries and point to the actual evidence.
