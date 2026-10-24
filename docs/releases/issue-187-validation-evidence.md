# Automatic recovery validation evidence

This record separates validation repairs from application repairs for issue187.
Automatic recovery is implemented in main commit
`7de2910b79ebb0996b97f1a2abd0776c505b29de`. It opens a validated working board
and protects recovery sources, accepted board decisions and newer edits.
The follow-up changes only tests, their risk map and their rationale records.
Application, rules, FAQ and installed-shell files remain unchanged.

## Original release check

[The main check](https://github.com/emerald-pham/funsidething/actions/runs/39928740237)
failed the dark390 historical recovery-status observation. The follow-up repairs
own both fixture seed saves, bound each complete observation by one absolute
deadline, and use the correct native WebKit focus input. Existing source,
authority, durability and response-budget assertions remain protected. Their
observed RED/GREEN records and exact test changes remain in
`TEST_CHANGE_RATIONALES.json`. These are validation repairs; they do not establish
a new application fix.

## Later intermittent outcomes

The pristine `db5a30c3a9a545365465a11878c1760b4dd3abc9` source failed its
first-Add persistence assertion in both original CI runs. The same immutable
source then passed
[the original full push job at attempt2](https://github.com/emerald-pham/funsidething/actions/runs/39964800218/attempts/2).
This control included the ordinary concurrent tooling workers and used the
original Ubuntu image20261012.334.1 and Node22.23.3. It passed2,898 tests with
61 existing classified skips and no failures. Separate rules24/24 and
compatibility15/15 had zero skips. Both native installed-client artifacts passed
source, preservation, offline and cleanup checks. The first-Add scenario passed
with zero additional unchanged-source SDK reads. This establishes intermittent
results, not a cause or identical hardware load.

For `94300cf1b3ca85f00ed4f3c4c8954ac51b460f80`,
[the PR check](https://github.com/emerald-pham/funsidething/actions/runs/39991398110)
passed the full suite, rules, compatibility and both native cases.
[The original push](https://github.com/emerald-pham/funsidething/actions/runs/39991387451/attempts/1)
failed only the existing three-Yes response budget:1,010ms against the unchanged
1,000ms limit. The later pristine-source full control measured
`[237,267,260]ms`, totaling764ms. That control is not an exact-J timing result.
An additional original-J failed-job control was requested at
[attempt2](https://github.com/emerald-pham/funsidething/actions/runs/39991387451/attempts/2);
its result remains separate release evidence.

The first128 app-test parents of pristine `db5a30c` also passed333/333 TAP
outcomes on Linuxx64, with zero skips or cancellations. This finite prefix
excluded concurrent separate tooling files and used a newer runner image.
It is diagnostic evidence, not release qualification. The separate
`diagnose/187-linux-consumers` carrier must not be merged into the release.

## Release boundary

No assertion, board size, timeout or response budget was weakened to obtain
these results. No cause is assigned to the intermittent save refusal or timing
overrun. Current exact-candidate CI and independent release reviews remain
required, including the normal rules, compatibility, native installed-client,
rendered and FAQ checks. Exact-main deployment checks and ordinary Stable/Beta
bytes and gameplay must pass before shipment is reported. Historical failures
and their limits remain part of the evidence.

Passing synthetic, emulator or native desktop checks does not prove recovery
of the affected private account or a physical iPhone/iPad. The original issue
and completed child issues remain closed; this record does not manufacture
that private acceptance. Private source selection, reset, data deletion and
protected-source cleanup are outside this release.
