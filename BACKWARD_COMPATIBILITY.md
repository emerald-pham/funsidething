# Backward compatibility release gate

`npm run test:compatibility` is a mandatory step inside the existing required
`scanner-tests` job. Pages depends on that job. The Firestore `predeploy` hook
also invokes it for CLI rule deployments and aborts deployment on failure.
The gate fails if the emulator,
full historical sources, a supported baseline, or an expected test family is
missing; it also rejects skipped, empty, cancelled, and failed selected runs.
It never connects to production or authenticates a real Google account.

## Supported boundary

The support floor is the released sync-recovery version
`7b9c92a41999a44a12f92b7d6d1c8d02758c635e`. It is pinned permanently rather than
tracking HEAD. The exact release comparison base is tested too. Source comes
from immutable Git objects, including each version's actual inline Firebase
backend, cloud generation codec, device codec, and Firestore rules. SDK loading
and Google authentication are adapted to the emulator; wire payloads,
transactions, revision checks, status handling, and cleanup are real app code.
This is protocol compatibility coverage, not a real Google popup/browser test.

For every baseline, both directions must work:

- Old client with new rules, including the new client writing between old edits.
- New client with old rules, including the old client writing between new edits.

Each case migrates a legacy single-document board without losing its exact
payload, preserves history and unknown fields, reads/writes a multi-megabyte
Unicode board, rejects stale revision writes without changing the board, and
denies cross-account/guest reads, foreign writes, and root deletion. Current
first-sign-in, permanent-denial, conflict-loop, and safe-reload tests run in the
same gate. A successful read followed by a rejected write is a failed roundtrip.

## Historical negative control

The pre-September-23 client `cd170750f12a60b077cf6fd498f8075f6759539e`
omits the server timestamp. It remains deliberately unsupported for writes by
the rules already deployed before this gate. The matrix confirms its read can
succeed, its real transaction receives `permission-denied`, and the roundtrip
checker rejects it. This is a sensitivity test for the original failure, not
permission to reject a supported client or a claim that historical JavaScript
has been repaired. Such already-running old pages still need to refresh.

Never replace a supported baseline with the candidate to get a green result.
Schema/rule changes must stay compatible in both deployment orders, or first
ship an explicit staged migration reviewed for old-tab recovery and data safety.
Changes to support policy, this runner, or workflow enforcement need process
tests, red evidence, and the applicable independent exact-commit reviews.

## Running and limits

Use Node 22 and Java 21, install dependencies with `npm ci`, and run
`COMPATIBILITY_BASE_SHA=<full released commit SHA> npm run test:compatibility`.
Without an explicit base it uses `origin/main`. The base must descend from the
pinned release and be an ancestor of the checked-out candidate. CI fetches full
Git history; missing history fails instead of silently selecting another client.

The full suite and `npm run test:rules` remain separately required. This gate
does not replace browser, offline, or ordinary live-path verification. It gates
GitHub merges and Pages deployments through the required scanner job, and
Firestore CLI deployments through the configured predeploy hook. Console/API
edits or deliberately bypassing the checked-in configuration are outside these
repository gates. Intentional changes to the supported floor need
an explicit migration/support decision and renewed review, not a routine pin bump.
