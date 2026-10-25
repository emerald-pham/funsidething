# Recovery device connection failure, October 25, 2026

The follow-up report runs the previously released memory repair. The user confirms that Review stayed open with a device-read error; the report does not establish a new crash. Storage failed during the review, then opened successfully after the dialog closed. The cloud response also returned zero of eight declared current chunks and eight previous chunks, without completed validation. Those counts do not prove a safe source to apply.

## Confirmed defect and repair

The consumer retried asynchronous UnknownError and InvalidStateError reads while retaining the same database connection. A handle that remained unusable until reopened exhausted that safe retry even when a new handle could read the existing data. Synchronous transaction-creation failures and browser close events already had reconnect handling, so the earlier transient-request tests missed this interval.

Retire only the current failed readonly handle, after its transaction settles. The existing caller owns the one recheck and its original deadline. The next read opens the existing database through the existing guarded path. No write is retried, no database is cleared or substituted, and a late failure from an older connection cannot close its replacement. Source, draft, account, pending, hold and consent checks remain unchanged.

## Evidence

The existing Sync -> Review consumer runs against real app/storage modules and an isolated IndexedDB boundary. Each of the pending, hold and head reads receives both transient error types; the failing handle remains unavailable until reopened. Review must finish unselected, reject unchosen Apply, retain every raw source, cloud record and draft, and retain the failed attempt in diagnostics.

Original preimplementation RED a4fed341 failed at that actual action with the reported modal. Initial fix run46aab97b remained red because the older optional fault proxy did not preserve native transaction.db identity. Connection consumers now opt into unwrapped handles; other fixture fault behavior remains intact. Corrected fixed run e7955101 passes. Correction-linked later baseline sensitivity57d04a4e fails at the same consumer assertion and is not represented as original chronology. Copy RED739a23e5 precedes FAQ/changelog edits. Node22 focused GREEN a3f67110 includes retries, cancellation, changed authority, permanent failures, the prior memory regression and deliberate source-choice durability.

Existing tests retain every assertion while exercising actual handle identity. Evidence records live outside Git at the owner's task-artifacts/recovery-device-reconnect-20261025/runs. Required independent review, compatibility, CI, delivery and live evidence are recorded separately for the final candidate.

## Limits

No affected private database or OS termination report was supplied. The failure is confirmed under the modeled native boundary, not proven to be the unique cause on this iPhone. No claim is made that missing current cloud chunks were restored. Opening the review never chooses a copy; unknown sources remain unknown. Beta mirroring remains paused.
