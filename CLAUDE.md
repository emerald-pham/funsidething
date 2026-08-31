# Chain Scanner

A ranked FVP task scanner. One self-contained `index.html`; all tests in `tests.js`,
run with `node --test tests.js`.

## Test-first, without exception

No implementation code goes into `index.html` until a test for that behavior exists
in `tests.js`, has been run, and has been **seen to fail for the right reason**. A test
written after the code is a test that has never been observed to catch anything.

The loop, every time: pin down the behavior → enumerate the cases (happy path,
boundaries, invalid input, failure modes, ordering effects) → show the case list and
wait → write the tests → run them and show the red output → minimum implementation →
run and show the green output.

Watch for a new test that passes *before* the implementation exists. That test is
broken, not finished — strengthen it until it discriminates, then continue.

A `PreToolUse` hook (`.claude/hooks/test-first-guard.sh`) enforces the ordering: an edit
to `index.html` is refused while `tests.js` has no uncommitted changes. Treat the block
as correct and go write the test — do not work around it.

Exceptions, and only these: config, dependency manifests, pure documentation
(`README.md`, `SETUP.md`), and deleting code. Everything else — bug fixes, "trivial"
glue, one-line changes — gets a test first.

## Conventions

- Comments in this codebase explain *why*, especially where a past bug drove the design
  (see the cloud-sync block). Match that density and voice; a fix without its reasoning
  invites the same bug back.
- Cloud sync orders writes by a revision counter, never by wall-clock timestamps.
- Run the full suite after every change, not just the tests you added.
