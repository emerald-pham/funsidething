## Parent

[Preserve nonconflicting board decisions across cloud sync — #141](https://github.com/emerald-pham/funsidething/issues/141)

## What to build

Keep deliberate No decisions effective after offline saving, reopening, and
syncing a second device's independent progress. Starting from one board, five
No decisions on the phone and one nonconflicting change on the Mac must survive
in the visible board, learned ratings, saved device state, and final cloud board.

Deliver the first complete path from a normal scanner action through durable
device storage, conditional cloud publication, reconciliation, and the visible
result. Establish only the durable decision identity, original decision time,
account ownership, common-base or pending-decision evidence, and reconciliation
boundary needed for this behavior. Preserve the existing learned board as the
upgrade baseline; do not reconstruct missing historical comparisons.

This is a verifiable slice of one integrated repair. Return focused, green
implementation commits; the final integration ticket owns the combined CI
candidate and release. Do not publish a separate partial feature release.

## Acceptance criteria

- [ ] Through normal scanner actions, make five No decisions on one device and an independent change on the other; retain all six actions and their effects after either publication order.
- [ ] Repeat with a full offline save and reopen before reconciliation through the production durable-store path. Exercise a supported fallback store when that boundary is affected.
- [ ] Preserve stable identity and original decision time across save, retry, reopen, and acknowledgement. Distinct deliberate No comparisons remain distinct useful evidence; repeated delivery of one recorded action affects learning once.
- [ ] A newer snapshot must not remove the retained No marks, reset their effective learned ratings, or silently turn saved progress into a new scan pass.
- [ ] Existing saved boards retain their learned ratings, task data, observations, settings, and recovery copies. Old observations already reflected in the baseline are not trained again.
- [ ] Decision evidence remains account-bound and durable before cloud publication. Failed local saves or unknown cloud outcomes retain pending evidence and do not present a completed sync.
- [ ] Existing immutable publication, revision compare-and-swap, read-before-write, recovery, and same-tab write serialization protections remain intact.
- [ ] Use the approved complete-app two-device test boundary, observe meaningful behavioral RED before the repair, then demonstrate GREEN. Record what this first slice does and does not yet cover.

## Blocked by

None — can start immediately.
