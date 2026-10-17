# Chain Scanner

Language for choices made on a board and shared across devices.

## Language

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
Incompatible answers to the same board decision. A difference between two
whole boards does not by itself establish a decision conflict.
_Avoid_: Any newer board

**Decision time**:
When the person made a board decision, retained when that decision reaches
another device later.
_Avoid_: Upload time, last save time
