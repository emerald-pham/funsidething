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

**Lossless recovery**:
Recovery that retains every accepted board decision, unfinished draft and
newer edit. A validated older source can provide a local working board while
unexamined cloud changes remain protected and cloud confirmation stays pending.
The verified saved working board and an automatic pending confirmation can resume
after reopening without another source-selection exercise.
_Avoid_: Loading any readable backup

**Cloud acknowledgement**:
Confirmation that the current saved board reached the person's cloud account,
separate from device-local saving or reading a cloud copy. It does not establish
that unavailable historical changes have been recovered.
_Avoid_: Synced badge


**History basis memo**:
One exact serialized numeric-input/result pair reused between matching History observations. Inputs are rebuilt before every lookup; their combined retained strings stay within256Ki UTF-16 units. It retains no task, board or validation graph and grants no cloud authority.

**Saved-draw fingerprint reuse**:
A bounded mapping from exact primitive input strings to results of the original
hash calculator. Squared scores and display read current weights and other
inputs each time. Retention is at most 2,048 keys and 256 Ki UTF-16 input units;
changed calculators, Math or string methods, accessors, nonprimitive and
oversized inputs use the ordinary calculation. It retains no saved object or
source-validation result.

- **Confirmed device cloud owner**: one process-local backend, account, identity and revision binding established by an accepted cloud read or acknowledgement. Device CAS repair may retain a higher confirmed revision only with current reconciliation authority, the same exact decision-base payload and unchanged owner. Sign-out or suspension invalidates the binding; a replacement backend needs a fresh accepted read. The binding retains no board graph or extra payload. Shared edits still require their own cloud confirmation.

- **Push response authority**: the captured backend, account, UID and current process-local owner binding for a conditional write. Storage preparation and the returned acknowledgement must still belong to that exact connection and reconciliation lifetime. An obsolete reply leaves work pending and requires a fresh current-owner read; it cannot mint a witness for the replacement connection.
