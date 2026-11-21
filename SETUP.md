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
read, but blind writes are denied until they reload. Once a board contains
decision evidence, its root also carries sticky `decisionCapability: 1`;
writers that drop this capability are denied. Plain boards remain readable and
writable by the historical supported clients. Root deletion is denied.

Change records (GLOSSARY) live beside the board, owner-only like it: each
scanner answer is a document in `users/{uid}/changeRecords`, created once in
the same request that moves the counter at `users/{uid}/changeLog/head` on by
one and names it, so every record has its own sequence number and none can be
rewritten. The root may name, as `includedSeq`, the number up to which its full
copy includes them, never past the counter, and only those records may be
deleted. Older clients write roots without `includedSeq`, which lists no
records, so nothing is deleted under their copies.
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
- While every change since the board was last clean went up as a change record
  (below) whose reply the Sync session accepted, the board shows Synced and the
  full copy is only a checkpoint: it waits for 30 seconds without changes, or
  for the app to be hidden (it goes after the read that showing the app again
  starts), instead of each 2-second pause and the 20-second longest wait. Any
  other change, or a record that does not go, puts it back on that schedule.
  A record's reply from an obsolete connection leaves the change pending and
  starts a fresh read, after which the record is sent again under its own id
- Each scanner answer (Yes, No, Can't, Done, Worked on it, Postpone,
  Dislodge) is also saved on the device as a small row and sent at once as a
  change record, numbered by the cloud. Other open devices hear it on a live
  listener and apply it through the same board merge as a full copy holding
  only that change, without downloading the board; a record arriving during a
  scanner gesture or with an editor open waits, as a live pull does. Every
  read applies the records the cloud keeps above the full copy it reads, in
  number order, never by a device clock. A full copy names the records it
  includes and they are removed once that copy is active. Offline answers go
  up on reconnect; a backlog of more than 20 goes as the full copy alone. If
  the deployed rules refuse records, the app syncs by full copies alone and
  shows no error; a refusal that a plain read of the counter does not repeat
  (contention) leaves records on. No record goes that a push would refuse, and
  a received record after which the board could not be pushed is skipped
  whole, reported, and left to its sender's full copy. A full copy names the
  records its board holds, in number order, only up to the first one that
  device skipped or could not read, so the cloud keeps that record until a
  full copy that holds it names it; the skip is the page's own, so a reopened
  app reads the record again. Undo of an answer
  saves its own device row, never sent, so a reopened app keeps the Undo
- A pull that finds nothing new produces zero writes
- Firestore revisions order copies and prevent concurrent writes from silently
  replacing each other; server dates record when a write landed
- Automatic reconciliation retains unique task IDs, completion dates and
  work-log rows unless a delete or clear marker explicitly removes them
- Independent recorded decisions merge by stable action identity. Repeating a
  deliberate comparison produces separate evidence; retrying its existing ID
  does not apply learning twice.
- Ordinary Undo (`Z` or the header button) reverses its local gesture against
  the reconciled board, retaining unrelated peer actions and immutable history.
  Receiving a cloud board does not add a whole-board Undo frame. Import, Restore
  and Reset remain explicit replacements with mandatory durable recovery;
  reversing one uses an exact deliberate replacement receipt. Account switches
  use device-local backups and never transfer Undo across owners.
- Device storage is still the offline layer, so the app works offline and
  syncs up next time it can reach the network
- Chosen sky coordinates, their label and time zone, and scene time and season
  travel with the signed-in board. The location dialog never uses a geocoder.

### Server dates and revisions

`state.updatedAt` records a local save time. It does not make an entire board
win a conflict. A server `rev` orders publications and supplies the compare-and-set
boundary; `serverUpdatedAt` records when that publication landed. A delayed
upload cannot give an earlier decision a new decision time.

Supported decisions retain original action IDs, times, causal observations and
pass/context inputs. Comparisons project from a frozen inherited rating baseline;
old observational history is never invented into missing comparisons or trained
again. Current choices resolve narrowly by property or outcome: observed causal
succession wins, concurrent incompatible choices use original action time, and
equal times use stable IDs. Independent fields, comparisons and task evidence
combine. A wrong device clock cannot reveal true wall-clock order; missing,
unknown or unprojectable authority remains protected and held rather than guessed.

- **The cloud revision is higher** → read and validate the cloud, retain a
  mandatory recovery copy, combine compatible evidence, and derive one coherent
  board before adoption or publication.
- **The revisions match** → this device may publish retained local work
  conditionally, after source validation and durable device save.
- **The cloud document has no revision** → treat publication order as unknown,
  preserve its evidence conservatively and publish only a safe combined board.
- Writes are **conditional**: `CS.push()` runs a Firestore transaction that
  refuses if the document moved past the revision read. The loser pulls and
  reconciles; publication time does not resolve a conflicting user choice.

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
  The revision triggers reconciliation; the local copy is backed up and its
  supported decisions are combined before adoption.

The gate is keyed on the signed-in account, so signing in as someone else
re-arms it. When cloud reception changes the current board, the existing notification and
device-local backup keep that transition visible and recoverable. Ordinary Undo
still targets the last local gesture and keeps unrelated peer progress.

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

### The saved board: the head and its acknowledgement row (#2436)

The board this device has saved is its device head plus, when the cloud
acknowledged exactly that head, an acknowledgement row beside it in the same
meta store (GLOSSARY: Saved board). A push whose own save holds exactly the
board it uploaded records the cloud's acknowledgement as that row, provided
nothing changed the board meanwhile, no device save is running or waiting, the
account is the same, and no recovery hold, save issue or other step a save
carries is outstanding. A push that publishes a recovery, and anything else,
records it with a whole-board save, as before. So does a push whose saved
board already has its row, since a head has one row at most: a tab that forgot
its last push (Retry sync, signing out, hiding the app), or another tab that
has pushed nothing, uploads that unchanged board again. The row counts toward
the cloud save-loop guard once, as that save did; a row that is refused leaves
the count to the whole-board save it falls back to. Each recovery guarantee
holds against the head and its row together:

- **Durable before it counts.** A Cloud acknowledgement counts only once its
  row, or its whole-board save, is written. A row that is refused or fails
  falls back to the whole-board save. A cold reopen opens on the acknowledged
  revision and decision base.
- **One read.** The device store's head read returns the head with its row
  applied: the exact text a whole-board save would have written, made by
  slicing the head's text, so reading it costs no parse or serialization of
  the board. The opening, a save's own checks, a conflict repair, recovery and
  every other reader of the saved board use that read; none applies the row
  by itself. A cloud recovery, which also compares this device's stored rows
  with that board, first writes a saved board with a row as a head of its
  own, the same text in one whole-board save, so the head alone is the saved
  board for each of its comparisons.
- **Compared as one, ordered by revision.** The row is written only while the
  saved board is still the one the push uploaded, in the same transaction as
  that check. The saved board's identity is then the hash of its own text, as
  a head's is, so a later save of the same text keeps it. A write made on
  condition of the saved board (another tab's save, a backup, a change record,
  a recovery step) is refused on the head's old identity and repairs onto the
  saved board, exactly as after a whole-board acknowledgement save. The row
  records the revision the cloud gave; nothing orders by a clock.
- **Replaced, never stale.** The next head this device writes, a save's or a
  recovery's, removes the row in the same transaction, and a row that names
  another head never applies. The device store writes a row only when it fits
  the head's own text, read in the same transaction (slicing only), so it never
  writes one that would make the saved board unreadable. A row that names the
  head but does not fit it, as damaged storage might leave, makes the saved
  board unreadable, as a corrupt head does, and recovery keeps every source.
- **Bookkeeping only.** The row holds only the board's device-only keys
  (revision, account, identity, decision base, change-record position, the
  unsynced flag, server time and protected recovery IDs), never a task,
  decision, History row or setting. It cannot add, drop or reorder a decision,
  and Undo, change records and conflict repair work on the same board as before.
  The device store holds it to that: it refuses a row that sets any other key
  or leaves out any other key of the head, and a stored row that does either
  names no head and never applies.
- **Recovery sources.** Raw captures of device storage (recovery originals,
  recovery archives, the raw data export) hold the row as one more meta row, so
  every byte of the saved board is kept. When the head is unreadable, the
  recovery that opens a local working board from earlier captures reads each
  captured head alone, as an older version does: the board one acknowledged
  revision behind, with every decision. No automatic copy is written for the
  row: the latest copy holds the same board with the bookkeeping from before
  the acknowledgement.
- **Older versions.** An app version from before #2436 reads the head alone,
  the board one acknowledged revision behind; its first cloud read reconciles
  that as a higher cloud revision and keeps every decision. The head it then
  writes stands on its own, since the row names an earlier head. A page whose
  cached device store has no rows records the acknowledgement with a
  whole-board save. No row is recorded while a recovery hold is stored.

Decision capability rules must deploy before the new application shell. Against
old rules the new writer safely holds and preserves its local board until the
compatible rule is available; after activation, old writers cannot erase decision
metadata. Exact candidate emulator tests exercise both orders. A safely updated
older tab may still contain learning or current choices with no recorded action.
The app preserves that exact copy and holds sync; it never fabricates the missing
IDs, original times or comparisons. An update alone cannot reconstruct them.

A coherent device save and an exact server acknowledgement of retained work are
both required for Synced. A successful read, a History row or a matching revision
alone is insufficient. Unknown evidence, failed mandatory recovery, uncertain
publication and drafts retain their normal held/retry/safe-update boundaries.

GitHub Pages uses GitHub Actions as its publishing source. The deployment job
depends on the test-first gate, full tests, Firestore rules tests, historical
client compatibility, and exact-candidate review evidence. Rules and compatibility
tests use the Firestore emulator. `firestore.rules` is deployed separately with
`firebase deploy --only firestore:rules --project chain-scanner`; a passing
emulator run does not update the live rule by itself.

## Turning it off

Blank out the `apiKey` value in `index.html`. The Firebase SDK then never
loads at all and the app runs local-only, exactly as it did before.
