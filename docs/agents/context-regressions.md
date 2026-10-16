# Context data and rendering regression boundaries


Context UI reviews must distinguish assigned task IDs, main scanner inclusion,
and All Tasks filters. Compare representative legacy string-array assignments
(including unknown and empty IDs) through actual Save, Cancel, completion and
Undo consumers, serialization and reload. Preserve unavailable references on
unrelated single-task edits; test explicit bulk replacement and Clear separately.
Inspect the visible editor context row after scrolling, including native checked
state and rendered feedback. When hiding native indicators behind newer CSS
selectors, retain a usable native fallback and isolate unsupported selectors
from ordinary chip rules. Synthetic fixtures cannot establish the state of a
user’s board; restore only verified scoped differences from identified backups.
