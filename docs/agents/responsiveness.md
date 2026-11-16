# Responsiveness guidance

Use this guidance when evaluating app opening, user actions or optional
background work.

- Aim to show useful opening feedback and a visible acknowledgement or outcome
  for each action within 200 ms. This is an aspirational optimization goal, not
  a minimum delay or a pass/fail threshold. A miss informs optimization; by
  itself it never fails tests, CI or release.
- The goal covers first useful visible feedback, not completion of longer-running
  work. Keep pending, success and error states truthful; do not signal success
  before required work or durability is confirmed.
- Keep the board and input useful while optional work runs. Defer or yield
  nonessential computation, bound foreground work and provide a graceful usable
  fallback when optional work is slow or unavailable. Preserve the existing
  board contents and original user sources through fallback.
- A change to a sync or scanner hot path adds a test that counts the work per
  action on `largeBoardFixture()` (validations per read, replayed rows per
  control), so it fails if that work grows with history or board size. Count
  work rather than time it: only review caught #2376's and #2377's large-board
  slowdowns.
- Treat the 1 GB, 400-task rapid-action story and issue #293's exceptional
  scenarios as optional diagnostic data unless the current approved task
  explicitly requires them. They do not establish universal product gates.
  Report the device, browser, scenario and observed limits accurately.
