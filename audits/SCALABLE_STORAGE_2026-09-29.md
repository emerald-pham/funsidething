# Scalable board storage audit — September 29, 2026

## Scope

This audit covers the first-party device persistence, recovery, cloud adapter,
Firestore rules, account boundary, offline shell, and cleanup paths used to
move Chain Scanner boards beyond Firestore's one-document limit. It preserves
the existing decoded board contract used by task, History, Undo, Restore,
Reset, import, reconciliation, and account-switch logic.

## Confirmed findings and repairs

- A single `/users/{uid}` document cannot store boards above Firestore's 1 MiB
  document limit. Cloud storage now writes immutable, hash-verified UTF-8 chunk
  generations and publishes one small revisioned manifest only after every
  chunk reads back byte-exactly.
- Browser `localStorage` cannot safely hold growing primary boards and retained
  recovery copies. A verified IndexedDB head and deduplicated snapshot store
  now provide transactional compare-and-swap commits, explicit recovery
  references, account-bound pending uploads, and bounded automatic history.
- Interrupted uploads previously had no resumable durable identity. The device
  records generation ID, payload hash, account, and base revision before
  upload; a reload resumes only an exact match, and an account change cancels
  stale publication.
- Immutable snapshots and published generations could otherwise accumulate.
  Device blobs retire only after their last head/backup reference disappears.
  Cloud cleanup retains the active and previous complete generations, protects
  locally pending uploads, and gives unpublished work a seven-day resume
  window before deletion.
- Retained v1 browser bytes are necessary for rollback and old-shell recovery,
  but become stale after v2 activation. A small authority marker prevents a
  temporarily blocked IndexedDB from reviving or uploading those older bytes.
- Recovery pins can span IndexedDB and legacy backup rows. Release now checks
  every physical same-ID row, promotes conflicting sole-copy data before
  unpinning, and retires only a newly created proof whose exact board is fully
  represented by the durable adopted head and confirmed cloud payload.
- Firestore errors from staged uploads lost their useful safe code behind a
  generic interruption label. The adapter now preserves a sanitized backend
  code such as `unavailable` while keeping payload and credential details out
  of the UI.
- Independent review reproduced four device-authority races: an edit made
  during a commit could be marked durable without being in the head; a CAS
  repair could replace a third in-tab edit; an old shell's shared-key-only
  write could be masked by the unchanged protected key, including when both
  keys already differed at first migration; and a blocked database
  open could stall boot indefinitely. Commits now bind exact bytes and retry a
  newer live union, both legacy keys are inspected independently, and database
  open is bounded and fails closed. Cold migration stores both divergent valid
  byte strings as recovery before marking their combined signature seen. The
  same rule applies when a late old shell writes one new board to both keys
  between an empty boot and the first v2 activation.
- Optional IndexedDB daily/latest history could have made a primary board save
  fail at device quota. The guarded retry atomically retires only unprotected
  automatic references; manual and mandatory recovery evidence remains.

## Safety and compatibility

- Existing v1 cloud documents remain readable and migrate on the next
  successful conditional write. Once a v2 manifest is active, rules reject a
  legacy client write so an old shell cannot replace chunked data.
- Legacy browser heads, protected copies, packed backup archives, and opaque
  unreadable archive bytes remain untouched until v2 authority is verified by
  readback. Unsupported browsers continue on the established localStorage
  path; an already-established but inaccessible v2 authority fails closed.
- Manual, displaced-edit, account-switch, stale-tab, other-browser, Reset, and
  Restore recovery bytes remain explicit. Automatic device history keeps one
  stable daily reference and one latest reference, and replacement actions
  await their mandatory recovery proof.
- Root publication is a transaction that compares the caller's base revision,
  verifies the sealed generation, rechecks account/operation identity, marks
  the generation published, and advances the manifest together.
- Rules keep the existing owner-only access boundary, make chunks immutable,
  require staged/sealed/published/deleting transitions, protect root-referenced
  generations, and deny root deletion.

## Verification evidence

- The repaired final-candidate local suite passed 1,016 tests with 12 browser-only
  skips and 2 emulator-gated skips, with no failures. The Firestore Emulator
  rules suite passed those 2 of 2 cases; its logged
  permission denials were the expected negative owner, lifecycle, immutability,
  and deletion assertions.
- Multi-megabyte Unicode payloads round-trip through data-driven 256 KiB UTF-8
  chunks with per-chunk and whole-payload SHA-256 verification.
- Production adapter tests cover v1 migration, interrupted upload resume,
  manifest compare-and-swap, account cancellation, current/previous retention,
  and orphan-chunk cleanup.
- Production app tests cover multi-megabyte cold migration, ordinary edits,
  Undo, offline reload, cloud adoption, old-tab reconciliation, mandatory
  Restore and Reset proofs, manual deletion, unavailable IndexedDB, cloud ACK,
  and a clean sync badge.
- Firestore Emulator tests cover owner isolation, immutable chunks, seal-before-
  publish, revision progression, previous-generation protection, deleting
  locks, legacy-client denial after v2, and root deletion denial.

## Verification limits and rollout order

Tests and emulator rules do not exercise the user's personal account, physical
iPhone storage implementation, or live Firestore data. The reviewed Firestore
rules must be published and verified before the client is merged or deployed;
otherwise the new generation paths would be rejected. Public HTTPS QA after
deployment should verify automatic update, module availability, Settings and
recovery rendering, and offline reload without mutating personal board data.
