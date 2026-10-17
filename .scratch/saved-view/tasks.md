# Saved-view task graph

Spec: [design.md](design.md). User confirmation: October 16, 2026, “sure” followed
by the explicit implement-spec invocation.

| Ticket | Complete deliverable | Blocked by | Owner |
| --- | --- | --- | --- |
| [#140](https://github.com/emerald-pham/funsidething/issues/140) | Reproduce, implement and ship populated startup and device-local saved-view restoration | None | One implementation worker; `/root` owns integration and release |

This graph deliberately keeps the complete restoration behavior together. Local
vertical TDD cycles precede one reconciled release candidate. The reviewed and
merged release PR closes #140 after acceptance and deployment verification.

## Agreed consumer seams

The user approved the observable acceptance in the spec and asked that existing
repository functionality resolve routine details. These are the corresponding
test seams, reusing the app's real consumers:

- App initialization, saved-board reopen and reload: catches visible default or
  empty board before restoration, local-first data and long-absence behavior.
  Node harnesses alone miss actual compositor paint; inspect browser startup
  frames as well.
- All Tasks controls and rendered list: catches filter/view/scroll continuity
  through their real handlers. Isolated consumer tests miss platform typography
  and viewport paint, which need actual rendered verification.
- Existing local persistence, cloud-adoption and account-change consumers:
  catches edit preservation, cache isolation, corrupt/blocked storage and safe
  fallback. Mocked external boundaries do not establish ordinary production or
  physical-device behavior; release evidence must label those limits.

These seams implement the accepted reopen/refresh, local-first, date correctness,
per-device continuity and account-safety checks. They do not add a new product
surface or widen the task into new editing/selection features.
