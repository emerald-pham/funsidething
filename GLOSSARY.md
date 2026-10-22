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
_Avoid_: Recovered board

**Lossless recovery**:
Recovery that retains every accepted board decision and newer edit. Choosing
between conflicting sources is a separate decision by the person.
_Avoid_: Loading any readable backup

**Cloud acknowledgement**:
Confirmation that the person's saved board reached their cloud account.
A board saved on one device or read from the cloud is not that confirmation.
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
