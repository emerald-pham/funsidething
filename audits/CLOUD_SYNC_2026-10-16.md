# Cloud sync audit — October 16, 2026

The current transport protects complete snapshots, revisions, and recovery
copies. The app does not consistently merge the decisions represented by
those snapshots. A later cloud revision can therefore remove nonconflicting
decisions from the active board, even when their history and backup survive.

## Scope and evidence boundary

- Source baseline: `69a9feddf5d6bb8c4973475f7232e363b8646097`, fetched
  `origin/main` at audit start.
- Checkout: `/Users/emeraldpham/.codex/worktrees/cloud-sync-audit/funsidething`;
  branch `audit/cloud-sync-20261016`.
- Inspected the app reconciliation and action owners, IndexedDB persistence,
  cloud generations, Firebase adapter, rules, setup documentation, prior audits,
  and relevant tests. A bounded read-only sidecar inspected the cloud protocol.
- Ran 137 existing focused sync/storage tests: 137 passed, zero failures or
  skips. The initial run lacked `fake-indexeddb` in the new checkout; it was
  rerun after linking the existing installed dependencies. That infrastructure
  failure is not product-regression evidence.
- Ran separate synthetic probes through the existing app fixture and actual
  app source. Both legacy browser storage and the IndexedDB path reproduced
  the reopening failure. No shipped tests or runtime files were edited.
- No personal boards, authenticated production writes, browser/emulator
  runtimes, deployed behavior, or physical devices were exercised. These are
  local reproductions, not proof of the reporter's exact production sequence.

## Behavior established with the user

The user's example is a common starting board, five decisions on the phone,
and one decision on the Mac. The later snapshot must not discard valid phone
progress. The user explicitly settled these requirements:

1. Keep all decisions that do not conflict.
2. For a genuine conflict, a later timestamp may win.
3. Choosing B over A and C over A are nonconflicting, even though both change
   the ranking and dotted chain.
4. The timestamp is when the choice was made. Reconnection, retry, upload,
   and saving must retain that original decision time.
5. Separate deliberate comparisons are valid, useful evidence, including two
   devices comparing the same pair from the same starting state. Keep both
   comparison observations rather than collapsing them into one choice or
   treating their disagreement as a reason to discard either observation.
   Resolving a genuinely incompatible current board choice must not erase the
   comparison evidence. Repeated delivery of the same recorded action remains
   one observation; a separate user comparison remains separate evidence.
6. Undo reverses the action being undone while preserving unrelated decisions
   from the other device. It must not replace the whole earlier board.

The user explicitly corrected the proposed same-comparison deduplication rule:
"both comparisons are technically valid and useful data" and "keep the
comparison but not the conflict." Deduplication must therefore distinguish
delivery of one recorded action from two deliberate comparison actions. The
comparison evidence and any incompatible current board choice have different
roles. This supersedes the earlier proposal that matching answers count once
or that opposite comparison answers make one observation replace the other.

These product boundaries are recorded. After resolving them, the user invoked
the to-spec skill to advance to synthesis and publication on the configured
tracker. That instruction supersedes the earlier pending discussion checkpoint;
it does not request runtime implementation. The spec includes a focused check
of the proposed consumer test boundary before publication.

## How the current system works

The classic app script in `index.html` owns the board, scanner mutations,
reconciliation, and sync badge. Device storage is an IndexedDB head with
immutable snapshot blobs and recovery references. Legacy localStorage bytes
remain recovery/coexistence evidence. Pending cloud upload records contain
the account, generation ID, payload hash, and base revision.

`cloud-store-v2.js` encodes a complete board into hash-verified UTF-8 chunks.
An upload stages a generation, writes and verifies the chunks, seals it, and
publishes a small root manifest in a transaction. The transaction advances
the root only if the caller's base revision still matches. Root revisions
order publication; they do not establish which user decisions a board contains.

The Firebase module uses a server-confirmed root listener as a revision hint.
The app performs a full validated pull before adoption, defers around editors
and active gestures, and retains a durable prior board before replacement.
It also reads on startup, focus, and reconnect. A failed read cannot authorize
seeding an allegedly empty cloud. Account and operation guards reject stale
responses; wake recovery and retries are bounded.

The app combines missing tasks and selected causal evidence, including
completion/reopening, deletions, history, postponement, and prerequisites.
Ordinary task fields and shared scan fields instead depend on a three-way
comparison with the last cloud board remembered by the current page.

Relevant source: `index.html:1951`, `index.html:2396`, `index.html:2419`,
`index.html:2937`, `index.html:3431`, `index.html:3707`,
`index.html:7451`, `index.html:7519`; `device-store-v2.js:187`,
`device-store-v2.js:293`; `cloud-store-v2.js:29`, `cloud-store-v2.js:79`.

## Findings

### P1 — reopening discards the merge ancestor and can erase five independent decisions

`lastKnownCloudPayload` and its account exist only in page memory
(`index.html:2938`). A higher root revision selects the remote board as the
starting winner (`index.html:3565`). Local field/scan changes are rebased only
when the prior cloud payload is available (`index.html:3707`).
`rebasePendingBoardFields` returns immediately without that ancestor
(`index.html:2420`). The remaining task/history union does not restore the
`considered` map or ordinary rating values.

Reproduction used the actual `decide('no')`, persistence, and `cloudPull()`
entry points. Both devices began at revision 4 with seven tasks. One device
made five No choices; the other changed an unrelated seventh task and
published revision 5. The first device then reconciled, either in the same
page or after reopening its saved board.

| Result | Same page | Reopened page |
| --- | --- | --- |
| No choices on tasks B–F | All five retained | All five removed |
| Benchmark mean | 35.5894 | Reset to 25 |
| Other changed task | Retained | Retained |
| Stored rating observations | 10 | 10 |
| Recovery board | Retained | Retained |
| Final cloud revision / badge | 6 / Synced | 6 / Synced |

The same result occurred with the actual IndexedDB persistence code using
`fake-indexeddb`. This is active decision loss with recoverable evidence,
not a claim that all copies were permanently deleted. The clean badge proves
that the merged snapshot was acknowledged; it does not prove the decisions
were faithfully merged.

### P1 — even with an ancestor, independent dotted choices are treated as an indivisible chain conflict

`rebasePendingBoardFields` treats arrays as indivisible values
(`index.html:2419`). The peer keeps a changed array when the local side also
changed it, rather than merging the decisions that produced it. Task union
does not reconstruct the dotted chain from comparison history.

Reproduction kept the page and its exact cloud ancestor alive. Starting with
chain `[A]`, the phone used the actual Dot action on B and the Mac used Dot on
C. Their chains were `[A,B]` and `[A,C]`; both choices compared against A.
After reconciliation, the active and uploaded chain was `[A,C]`. B was no
longer dotted, although both B and C retained increased means and all four
task observations survived. The badge again said Synced.

The shared benchmark retained one branch's mean, 20.7944. The merged history
contains both comparisons but is observational; it is not replayed to derive
a combined posterior (`index.html:5210`, `index.html:5224`,
`index.html:5269`). Under the user's confirmed rule, these two choices must
both survive. Keeping their rows without keeping their effects is insufficient.

### P2 — conflict resolution has no general per-decision time or identity

The current peer-wins field rebase does not choose between conflicting
decisions by when each was made. Ordinary scanner mutations change board
fields such as `chain`, `considered`, and `mode`; the board's `updatedAt`
changes on save. Rating observations carry action times and IDs, but do not
provide a complete general decision journal or drive all merged state.

This is a gap against the newly confirmed requirement. Replacing the root
revision comparison with a board-wide timestamp comparison would preserve
the same failure: one whole snapshot would still suppress unrelated choices.
Retain revision CAS for publication and use decision time only within a
genuine conflict. Clock skew, equal times, old clients, and older saved boards
need explicit implementation rules and regression cases.

### P2 — chunking still permits a batch above Firestore's request limit

The default codec emits 256 KiB chunks (`device-store-v2.js:8`). Upload batches
contain up to 200 chunks by count (`cloud-store-v2.js:22`,
`cloud-store-v2.js:101`), and the Firebase adapter commits the group as one
WriteBatch (`index.html:7505`). Firebase documents a
[10 MiB maximum API request size](https://firebase.google.com/docs/firestore/quotas#writes_and_transactions).
Forty full chunks already reach that size before request overhead.

A synthetic adapter guard confirmed that an 11 MiB payload attempts one
45-chunk, 11,534,366-byte text batch. The guard returned `invalid-argument`,
and no root was published. This proves the local batching calculation; it is
not a live Firestore rejection test. Existing multi-megabyte fixtures and fake
batches do not enforce that service limit. Bound batches by encoded bytes as
well as count. This is separate from the user's reported decision overwrite.

### P3 — setup documentation describes an older sync model

`SETUP.md` says sync is deliberately not realtime and occurs only on load
and focus. It also describes a single per-user board document. The current
client has a server-confirmed root listener and immutable generation/chunk
subcollections. Current Settings text does describe remote-save refresh.
Update setup guidance alongside the eventual repair so future work does not
assume obsolete behavior or storage paths.

## Secondary protocol observations

- Resumable uploads and uncertain acknowledgements use durable generation
  identity when IndexedDB is available. A replay after a successful but
  unacknowledged publication can return a revision conflict; reconciliation
  must recognize the exact already-published content. Existing tests cover
  partial uploads and publication during sleep. Add an exact persisted-ID
  replay case when modifying this boundary.
- Cloud collection runs after successful pushes and swallows cleanup errors.
  Seven days is eligibility for deleting unpublished generations, not a
  scheduled deletion promise. With repeated failed uploads and no subsequent
  successful save, abandoned data can remain longer. Collection queries all
  generation headers without pagination. No production cost incident was
  measured in this audit.
- Rules enforce the owner boundary and generation lifecycle. Snapshot hashes,
  chunk completeness, and decoded board integrity are checked by the client.
  A same-owner direct or buggy writer is not protected by a server-side JSON
  or cryptographic validator. This is an existing trust boundary, not evidence
  of a cross-account exposure.
- A possible prefixed root-error classification issue was not promoted to a
  finding: the observed SDK's actual error spelling was not established.

## Repair direction for the design discussion

Keep the existing local safety, immutable snapshots, hashes, conditional
publication, account isolation, draft protection, and bounded recovery.
Change the merge authority to durable decisions and their observed context.
Snapshots can remain the transport/checkpoint format.

The repair needs to retain a common base or explicit pending decision evidence
across reopening, identify repeated delivery of one recorded action without
collapsing separate comparisons, preserve independent choices despite overlapping
derived fields, and resolve only genuine conflicts using original decision time.
All deliberate comparison observations remain available as evidence, including
separate comparisons of the same pair. A resolved current board choice must not
erase the observations that contributed to it. Rankings and the dotted chain
must be derived from the retained decisions rather than accepted solely because
one snapshot was published later. Undo reverses its action rather than loading
an entire prior board. A durable base by itself fixes the first finding but not
the second; array union by itself would invent ordering and Undo semantics.

Before implementation, use the synthesized spec and agreed consumer seams.
The first regression should cover the user's five-plus-one
branch example through actual actions, both publication orders, offline
reopening, and an acknowledged final cloud board. Add the warm independent-Dot
case, genuine current-state conflicts with delayed upload, two deliberate
comparisons of the same pair, redelivery of one comparison, preservation of
comparison evidence through conflict resolution, and action-scoped Undo.
Keep existing historical safety tests intact.

No ADR chooses an event journal, CRDT, or cloud schema yet. The product rule
is settled; the storage and replay design is still a trade-off to resolve.

## Evidence and coordination

Evidence is retained outside checkout cleanup under
`/Users/emeraldpham/Documents/GitHub/funsidething/.git/funsidething-task-evidence/cloud-sync-audit-20261016/`.
It contains the focused test output, synthetic probe source/output, protocol
sidecar notes, and baseline metadata. Probes use synthetic boards only and
are audit experiments, not shipped regression tests or preimplementation RED.

The primary checkout and all other owners' branches, worktrees, ignored data,
browser allocations, and emulator allocations remain preserved. A concurrent
saved-view task is adding its own glossary terms; later integration must keep
both sets of vocabulary rather than replace that work.

This document and the glossary are local audit/design work. No runtime fix,
CI candidate, merge, or deployment is claimed.
