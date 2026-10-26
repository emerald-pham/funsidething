# Quiet startup validation — WIP, held 2026-10-26

## Scope and inspected seams

The user clarified that this occurs in the installed iPhone app with a broken
board. Work is held. No reproducer or test has been run, so there is no confirmed
cause, fix, or physical-device result. No private board source was provided.

The following existing consumers were inspected as possible starting points
for a future, explicitly resumed investigation. The task brief authorized
existing saved-view cold-start/UI and actual storage-failure consumers, but the
current evidence does not establish that any of them reproduces the installed
iPhone broken-board case.

- `tests.js` — `RISK device connection startup: one internal server failure
  recovers the authoritative offline board within a bounded attempt`. It boots
  the actual app with a saved IndexedDB head, injects one transient IndexedDB
  open failure, and checks that the same saved board is recovered. It does not
  by itself cover the reported broken-board case or installed iPhone behavior.
- `tests.js` — `RISK saved view startup: delayed local board reads do not expose
  an empty default shell`. This existing rendered consumer delays the actual
  app storage read, checks the shell before a valid saved board is available,
  then verifies the populated board appears. It currently does not inspect the
  cloud status label and is not evidence about the reported broken board.
- `tests.js` — `RISK AUTH RESTORE: remembered boards show syncing in header and
  Settings while restoration is pending`. It covers existing pending-auth and
  terminal-auth-error behavior, but not the reported installed iPhone case.

No RED/GREEN evidence, exact reproduction, review, or rendered-runtime evidence
has been collected. Any future synthetic fixture will establish only its
consumer behavior; it cannot establish a repair on the installed iPhone,
authenticated live account, or production board.
