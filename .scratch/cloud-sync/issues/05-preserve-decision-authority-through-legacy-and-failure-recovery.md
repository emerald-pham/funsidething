## Parent

[Preserve nonconflicting board decisions across cloud sync — #141](https://github.com/emerald-pham/funsidething/issues/141)

## What to build

Keep the new durable decision evidence safe when an older client writes, an
account changes, storage fails, or an upload has an uncertain outcome. Use the
complete No-decision flow from ticket 1 as the first executable consumer of
this safety contract, so the work can proceed before every later action type
is implemented. The final integration ticket applies the same guarantees to
the complete repair.

Upgrade existing boards without losing their learned baseline or recovery
data. A metadata-unaware writer must not silently erase acknowledged decisions;
preserve compatible operation or hold an unsupported writer through the
established safe compatible-client recovery path. Keep identity, decision time,
ownership, and unknown evidence intact through each failure and retry.

This is an end-to-end recovery behavior slice, not an open-ended infrastructure
rewrite. Return focused, green commits; leave the one combined CI candidate and
release to the final integration ticket.

## Acceptance criteria

- [ ] Load real-shape legacy board fixtures with learned ratings, observational history, unknown fields, and existing backups. Preserve their baseline and recovery bytes without inventing missing actions or retraining already-learned observations.
- [ ] An older or metadata-unaware snapshot cannot silently delete acknowledged action evidence or interpret omission as an Undo. Compatible reads and supported writes continue; unsupported publication is held safely with the existing recovery behavior.
- [ ] Account switch, sign-out/sign-in, delayed replies, pending publication, and queued retries cannot transfer a decision, base, Undo authority, or recovery reference into another account.
- [ ] Failed mandatory local recovery or device saves retain protected data and hold publication. Do not require destructive reset, backup deletion, or manual export as the normal repair path.
- [ ] An unavailable or malformed cloud read never becomes permission to seed an empty cloud. A successful read alone does not acknowledge an unmerged or rejected write.
- [ ] Interrupted and timed-out uploads retain stable action identity and original decision time. If the server committed before acknowledgement was lost, readback confirms the exact result without duplicate learning or a blind overwrite.
- [ ] Wake, visibility, focus, reconnect, and explicit retry remain bounded and recover after an earlier never-settling operation. Late acknowledgements or old-account callbacks cannot rewind current authority.
- [ ] Synced requires the exact coherent retained-decision board to be durable and acknowledged. Unsaved local work, missing decision effects, held adoption, and failed writes remain visibly pending or failed through existing status behavior.
- [ ] Open drafts and active gestures remain protected, and safe PWA updates do not force-refresh unsaved work.
- [ ] Complete the relevant historical-client and rules checks if protocol or authority changes require them. Preserve existing owner isolation and immutable-generation safety; observe new behavioral RED before repairs and focused GREEN afterward.

## Blocked by

- Ticket 1 — Preserve No decisions after offline reopening. The durable representation and first complete action flow must exist before its mixed-client and failure recovery can be qualified.
