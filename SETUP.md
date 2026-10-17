# Cloud sync — how it's wired

Already configured and live. This is the record of what's set up and why, for
whenever you next need to touch it.

## What exists

- **Firebase project** `chain-scanner` (Spark / no-cost plan)
- **Cloud Firestore** in `nam5` (US multi-region), created in production mode
- **Google sign-in** enabled; consent screen shows "Chain Scanner"
- **Authorized domain** `emerald-pham.github.io` added, so the sign-in popup
  is allowed to return to the live site
- The web app config lives at the top of `index.html`

The four config values in `index.html` are public by design — they identify the
project, they don't grant access to anything. The security rule is what protects
the data. Its deployable source is `firestore.rules`, referenced by `firebase.json`.

## The security rule

A signed-in account can read and write its own board at `users/{their uid}`
and the board's generation and chunk subcollections. Nobody else's, and nothing
at all while signed out. The root is a small manifest identifying the current
and previous immutable board generations. Publication needs the next revision,
a sealed generation, and a Firestore server timestamp. Old shells may still
read, but blind writes are denied until they reload. Root deletion is denied.
The rules check ownership, envelopes, and generation transitions; they cannot
parse the JSON hidden in chunks, so client validation and recovery copies
remain necessary.

## How syncing behaves

A server-confirmed listener on the root manifest reports newer revisions. A
notification requests a fresh, validated board read; notification data never
replaces the board or acknowledges a write. Startup, focus, visibility, and
reconnect also trigger reconciliation. An open editor or active scanner gesture
defers adoption, and scanner controls remain bound to the tasks they displayed.

- Writes are debounced 2 seconds, so a fast scanning run costs one write, not thirty
- A pull that finds nothing new produces zero writes
- Firestore revisions order copies and prevent concurrent writes from silently
  replacing each other; server dates record when a write landed
- Automatic reconciliation retains unique task IDs, completion dates and
  work-log rows unless a delete or clear marker explicitly removes them
- Adopting a remote state within the same account pushes onto the undo stack —
  `u` takes it back. Account switches use device-local backups instead.
- Device storage is still the offline layer, so the app works offline and
  syncs up next time it can reach the network
- Chosen sky coordinates, their label and time zone, and scene time and season
  travel with the signed-in board. The location dialog never uses a geocoder.

### Server dates and revisions

`state.updatedAt` is stamped with `Date.now()` on whichever device wrote it —
that device's **own clock**. Comparing two devices' timestamps therefore ranks
them by clock offset, not by when the edits happened: a laptop running a few
hours fast wins every reconcile no matter how stale its copy is. That is how a
phone's newer work, task renames included, got replaced by a laptop's older
copy. Wall-clock time cannot order edits made on two machines.

New cloud writes carry `serverUpdatedAt`, assigned by Firestore rather than a
device, as a record of when the write landed. The document also carries `rev`,
an integer that only ever goes up, and each device keeps `state.syncRev` — the
revision its copy is based on.

- **The cloud revision is higher** → adopt the cloud after backing up the
  device copy and merging task and history evidence. A server timestamp cannot
  overturn this ordering, even if clocks disagree.
- **The revisions match** → this device can send its local edits conditionally.
- **The cloud document has no revision** → treat its order as unknown and adopt
  it conservatively, then write the combined board at revision 1. No device
  clock decides which copy is newer.
- Writes are **conditional**: `CS.push()` runs a Firestore transaction that
  refuses if the document has moved past the revision the caller read. Two
  devices pushing at once used to mean the second silently replaced the first;
  now the loser gets `{conflict:true}`, pulls, and reconciles.

Settings ride the payload like everything else, so they sync with the rest of
the state. `hydrateState()` backfills **every** key from `DEFAULT_SETTINGS` and
rejects non-numeric values rather than coercing them — a partial or junk
settings object arriving from an older device used to leave `horizonMin`,
`thresholdPct` and `samples` undefined and quietly turn the scan's arithmetic
into `NaN`. `DEFAULT_SETTINGS` is the single source of truth for both a fresh
install and a backfill, so two devices either side of an upgrade cannot
disagree about a setting neither of them ever set.

`syncRev` is deliberately kept **out of the payload** — it is device-local
bookkeeping. If it rode along, every device would see a difference the instant
it adopted someone else's state and push it straight back.

Older documents without server dates still use revisions. A missing task is
never proof that someone deleted it.

### No writing before reading

A browser left closed for weeks boots holding a stale chain, and last-write-wins
alone does not protect you from it. Three rules keep it honest:

- **A tab may not write to the cloud until it has read it once this session.**
  Dotting a task pushes immediately, with no comparison — so before that first
  read, the write is held and a pull is fired instead. The pull releases it.
- **A read that failed is not an empty cloud.** `CS.pull()` answers with the
  document, or `{empty:true}` when there provably isn't one, or `{error:true}`
  when the read didn't happen. Only `{empty:true}` lets a device seed the cloud.
  Anything unreadable means we know nothing, so we write nothing.
- **An edit during the first read does not make a stale board authoritative.**
  The revision still decides; the local copy is backed up before adoption.

The gate is keyed on the signed-in account, so signing in as someone else
re-arms it. If a newer remote lands on top of edits you'd just made, a toast
says so; `u` takes it back, and a device-local backup keeps the prior board.

Automatic reconciliation combines unique tasks and recorded completion/work
history by stable ID. It keeps explicit task-deletion and history-clear markers
indefinitely so a very old tab cannot resurrect an intentional removal. A
separate dated deletion log retains two months of actions even after clearing
visible History. Settings holds up to seven days of automatic device-local
full-board backups: the first and latest copy of each day, plus pre-restore
and cloud-adoption safety copies. Older automatic copies retire first as new
ones arrive or browser space gets tight; the incoming stable copy and any
active cloud-adoption proof remain. Manual backups, displaced local edits,
stale-tab drafts, other-browser recovery copies, and account-switch copies of unsynced boards
stay until the user deletes them or clears site data. A switch away from a
cloud-confirmed board needs only the ordinary automatic safety copy. Repeated
copies of the same unsynced board are deduplicated.

Tasks are never dropped because of age. Restoring an old backup also keeps
later tasks that have no recorded deletion; the chosen backup restores its scan
and settings state. Restoring a backup from another account asks explicitly
before its tasks can be synced into the current account.

The board is encoded into hash-verified UTF-8 chunks beneath an immutable
generation. Uploads stage and verify all chunks, seal the generation, then
conditionally publish its root manifest. Readers verify the complete generation
and recheck the root before adopting it. A legacy single-document board can be
read and migrated without treating a failed read as an empty cloud. Chunking
removes the single-document board limit; browser, request, and project quotas
still apply. With durable pending storage, interrupted uploads retain a stable
generation identity for retry.
The current and previous published generations are protected during collection;
unpublished uploads have at least seven days to resume before becoming eligible
for cleanup. This is not a promise of scheduled deletion after seven days.

On the device, IndexedDB stores the durable board with immutable snapshots and
recovery references. Supported fallback storage and retained legacy browser
bytes keep their recovery roles. Automatic history rotates before and at the
quota boundary. If mandatory recovery or the primary device save cannot finish,
replacement and cloud publication remain held, and unsaved work is reported.

GitHub Pages uses GitHub Actions as its publishing source. The deployment job
depends on the test-first gate, full tests, Firestore rules tests, historical
client compatibility, and exact-candidate review evidence. Rules and compatibility
tests use the Firestore emulator. `firestore.rules` is deployed separately with
`firebase deploy --only firestore:rules --project chain-scanner`; a passing
emulator run does not update the live rule by itself.

## Turning it off

Blank out the `apiKey` value in `index.html`. The Firebase SDK then never
loads at all and the app runs local-only, exactly as it did before.
