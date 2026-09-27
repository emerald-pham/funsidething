# Chain Scanner

A ranked FVP task scanner. The app is centered in `index.html`, with its installable
PWA shell in `manifest.webmanifest`, `sw.js`, and the local icon assets. All tests
live in `tests.js`, run with `node --test tests.js`.

## Test-first, without exception

No implementation code goes into `index.html`, `sw.js`, `manifest.webmanifest`, or
the PWA icon assets until a test for that behavior exists in `tests.js`, has been run,
and has been **seen to fail for the right reason**. A test written after the code is
a test that has never been observed to catch anything.

The loop, every time: pin down the behavior → enumerate the cases (happy path,
boundaries, invalid input, failure modes, ordering effects) → write the tests →
run them and show the red output → minimum implementation →
run and show the green output.

Watch for a new test that passes *before* the implementation exists. That test is
broken, not finished — strengthen it until it discriminates, then continue.

## Forced risk-based TDD and regression gates

Before editing any scanner, landscape, location, or offline-shell behavior,
write a discriminating test in `tests.js`, run it, and keep the red output for
the release record. The edit guard covers every app module. The CI diff gate
also rejects app changes without changed tests; state, eligibility, sync,
astronomy, and shell changes require a new `RISK` test in the same diff.

Choose cases by failure cost. For persisted task rules, include old saved data,
undo, import or restore, deletion, and cross-device reconciliation when those
paths touch the change. For a visual or motion change, cover the numerical
geometry or paint contract, reduced motion, and relevant phone, tablet, and
short-landscape viewports. For offline changes, check the asset fingerprint and
offline reload. A text or styling fix needs a direct UI assertion that would
have failed before the edit. Run the full suite after the change, then inspect
the rendered result when pixels or controls changed. Record test, browser,
offline, CI, and live results separately.

A `PreToolUse` hook (`.claude/hooks/test-first-guard.sh`) enforces the ordering: an edit
to an app or PWA shell file is refused while `tests.js` has no uncommitted changes.
Treat the block as correct and go write the test — do not work around it.

Exceptions, and only these: config, dependency manifests, pure documentation
(`README.md`, `SETUP.md`), and deleting code. Everything else — bug fixes, "trivial"
glue, one-line changes — gets a test first.

## Conventions

- Comments in this codebase explain *why*, especially where a past bug drove the design
  (see the cloud-sync block). Match that density and voice; a fix without its reasoning
  invites the same bug back.
- Cloud sync orders writes by a revision counter, never by wall-clock timestamps.
- Run the full suite after every change, not just the tests you added.
