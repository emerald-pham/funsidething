# Chain Scanner

Language for saved boards, device views and choices shared across devices.

## Language

**Saved view**:
A person's last-used board, task-list view, filters and position in the list,
remembered separately by each device or browser.
_Avoid_: Cached screenshot

**Board decision**:
A person's choice about a task or a scan, such as preferring one task over
another. Saving or reopening a board is not a new decision.
_Avoid_: Newest board

**Nonconflicting decisions**:
Choices that can both be honored, including choosing B over A on one device
and C over A on another. Their effects on shared rankings or the dotted chain
do not by themselves make the choices conflict.
_Avoid_: Competing snapshots

**Decision conflict**:
Incompatible requested outcomes for the same current board choice. Differences
between whole boards or separate comparison observations do not by themselves
establish a decision conflict.
_Avoid_: Any newer board

**Comparison observation**:
A person's deliberate comparison of two tasks. Separate observations remain
useful evidence even when they concern the same pair or give different answers;
receiving the same recorded observation again is not another comparison.
_Avoid_: Duplicate choice, comparison conflict

**Decision time**:
When the person made a board decision, retained when that decision reaches
another device later.
_Avoid_: Upload time, last save time

**Undo**:
The reversal of the action being undone while preserving unrelated decisions,
including those made on another device.
_Avoid_: Restoring the whole earlier board

**Recovery source**:
A retained copy of a board or its saved decisions that may help recover work.
Keeping a source does not establish that it is complete or safe to apply.
Shared originals retained by automatic recovery remain protected across devices,
including after they leave the current cloud slots; this cannot recreate missing bytes.
A generation seen with zero chunks has nothing to retain: it gets no protection,
stops being consulted and is retired once the root has moved past it.
_Avoid_: Recovered board

**Cloud recovery review**:
A protected check of separately retained device and cloud sources that can
support automatic compatible reconciliation. Explicit manual File or Paste
Restore remains a deliberate replacement; opening a review does not approve it.
_Avoid_: Automatic restore

**Automatic recovery default**:
A reversible choice between compatible values whose order cannot be established,
using the accepted device value when available or a fixed source order otherwise.
The alternatives remain protected, and later acknowledged work becomes the basis
for subsequent reconciliation.
_Avoid_: Newest snapshot, invented decision

**Recovery wait**:
The automatic recovery default holding off because rebuilding the board from an
older cloud copy could need more memory than a phone allows. The board stays
open and saves on this device, every readable recovery source stays protected
and nothing is confirmed by cloud until a deliberate run or a newer cloud save.
On any recovery route, a cloud copy proved unusable with zero chunks received
gets no protection and is retired once the root has moved past it; a copy with
any chunks left stays protected, though it is not used.
_Avoid_: Failed recovery, paused sync

**Deliberate run**:
A recovery the person starts on purpose, with Retry sync or by signing in again,
that goes ahead even when the automatic recovery default would wait. Opening,
returning to or reconnecting the app never starts one. A contained board adoption
is retried by itself at each opening until the app has been closed during it
three times; after that only a deliberate run tries it again. Only the app closing
uses a try: a run that ends with an outcome it saw, such as a timeout, neither
uses one nor gives one back. A deliberate run that ends without
adopting a board, on its deadline or an error, returns to the recovery wait.
_Avoid_: Forced recovery, automatic retry

**Lossless recovery**:
Recovery that retains every accepted board decision, unfinished draft and
newer edit. A validated older source can provide a local working board while
unexamined cloud changes remain protected and cloud confirmation stays pending.
The verified saved working board and an automatic pending confirmation can resume
after reopening without another source-selection exercise.
_Avoid_: Loading any readable backup

**Cloud acknowledgement**:
Confirmation that the current saved board reached the person's cloud account,
separate from device-local saving or reading a cloud copy. The board has reached
it when the active full copy plus this device's accepted change records hold
it. It does not establish that unavailable historical changes have been
recovered.
_Avoid_: Synced badge

**Saved board**:
What this device holds as the board: its device head together with the
acknowledgement row recorded beside that head, when there is one. When a
push's own device save holds exactly the board it uploads and nothing changes
before the cloud's acknowledgement arrives, the acknowledgement's device-only
bookkeeping (the revision, the decision base and the rest) is recorded as that
row instead of in a second whole-board save. The row names the head it belongs
to, applies to that head only, and goes with the next head this device writes.
Every reader of the saved board, recovery included, reads the head and its row
together through one read, and every write made on condition of the saved board
checks the two together.
_Avoid_: Device head alone, last whole-board save

**Sync session**:
The one owner, while the app is open, of what this device knows about its cloud
copies. Each read of the cloud copy reports what it found to the session,
whoever started the read (a sync, Retry sync, Review saved decisions, a file
restore or a recovery's confirmation), and so does the cloud's own repair. So
once any of them finds the copy this device's acknowledgement names damaged,
no sync treats that copy as unchanged until a healthy read. Reads of earlier
recovery sources and a push's own checks do not report. It also
holds the page's read authority, the exact cloud copy last read or acknowledged
and the Confirmed device cloud owner, and it is the one place a cloud reply is
accepted as a Cloud acknowledgement: only while the reply still belongs to the
connection its push started under, is not older than this device's revision,
and this device has saved the acknowledged board. A change record's reply is
accepted there with the same checks (this device has saved the record); one from
an obsolete connection leaves the change pending and asks for a fresh read. It
starts empty each time the app opens.
_Avoid_: Sync manager, cloud cache

**Change record**:
One scanner answer sent to the cloud on its own, as the parts of the board it
touched, saved on the device first and numbered by the cloud in the order it
took them. Other open devices apply it through the same merge as a full copy
holding only that change, without downloading the board. Full copies stay the
checkpoints: each names the records it includes, a device opening from one
applies the records it does not name, and a record is removed only once the
active full copy includes it. While every change since the board was last
clean went up as a record the Sync session accepted, the board shows Synced and
its next full copy waits for about 30 seconds without changes, or for the app
to be hidden, instead of each 2-second pause.
_Avoid_: Delta, patch, sync event

**Settled (sync)**:
The Sync session's report that no sync step is running (a cloud read or
write, sending or applying a change record, a device save or a recovery flow)
and none is scheduled (an answer's catch-up still queued, a save debounce, a
push waiting on its debounce, its longest wait or a full copy's longer pause
after change records, a live, backup or change
record read, or a retry), so the app will do no more sync work on its own. Work that waits on something outside the app, such as
an open editor, a hidden page or a read still owed, is listed as waiting and
does not count. Only tests read it; nothing in the app or on screen does.
_Avoid_: idle, quiet window


**History basis memo**:
One exact serialized numeric-input/result pair reused between matching History observations. Inputs are rebuilt before every lookup; their combined retained strings stay within256Ki UTF-16 units. It retains no task, board or validation graph and grants no cloud authority.

**Saved-draw fingerprint reuse**:
A bounded mapping from exact primitive input strings to results of the original
hash calculator. Squared scores and display read current weights and other
inputs each time. Retention is at most 2,048 keys and 256 Ki UTF-16 input units;
changed calculators, Math or string methods, accessors, nonprimitive and
oversized inputs use the ordinary calculation. It retains no saved object or
source-validation result.

- **Confirmed device cloud owner**: one process-local backend, account, identity and revision binding established by an accepted cloud read or acknowledgement. An acknowledgement binds it while its board saves on this device, and a refused save withdraws that binding. Device CAS repair may retain a higher confirmed revision only with current reconciliation authority, the same exact decision-base payload and unchanged owner. Sign-out or suspension invalidates the binding; a replacement backend needs a fresh accepted read. The binding retains no board graph or extra payload. Shared edits still require their own cloud confirmation.

- **Push response authority**: the captured backend, account, UID and current process-local owner binding for a conditional write. Storage preparation and the returned acknowledgement must still belong to that exact connection and reconciliation lifetime. An obsolete reply leaves work pending and requires a fresh current-owner read; it cannot mint a witness for the replacement connection.
