# Recovery device-read follow-up, October 25

## Evidence and limit

The 19:06 UTC user report matches Stable build `86d57d5a0a8182432b571cf58d23776133f68b9aa4432b92309af8e18413c154` (PR #281). The protected review failed with `unavailable`, reopened device storage successfully, then reported another unavailable read. The modal stayed usable. Current cloud data returned zero of eight declared chunks; the previous source returned eight, without completed validation. None of this establishes a repaired phone, complete cloud source, quota cause, or crash cause.

Safe probes did not reproduce the remaining failure: existing actual-consumer recovery controls passed; isolated native WebKit review passed with 16 and 64 extra synthetic retained copies (roughly 48 and 192 MiB); overlapping source captures with later injected failures recovered across 18 cases. Those passing probes are not behavioral REDs or physical iPhone proof. Do not keep increasing stress or change recovery authority from this evidence.

## Narrow diagnostic change

The existing metadata-only Debug log now labels device operations (open, connection, transaction, raw snapshot, head, pending upload, recovery hold), fixed exception names/reasons and bounded, ephemeral connection aliases. Error text is classified by exact known messages and is never retained. Unknown messages remain unknown. The observer snapshots fields once, then allows only fixed values. No database names, keys, account IDs, paths, raw errors or board contents are added. Existing event/report limits still apply.

No source choice, recovery retry budget, write replay, cloud publication, storage schema or automatic reload policy changes. The one recheck and all original-source preservation guards remain authoritative. An observed new connection does not prove a readable board. This release improves investigation; the user's remaining failure is unresolved pending a new device report.

## Test chronology

Evidence is retained outside Git under `/Users/emeraldpham/.codex/task-artifacts/recovery-read-followup-20261025/runs`. Actual Review → Copy diagnostic RED `7c3bc6c6` preceded runtime edits and found zero of the two required labeled failures; GREEN `e20599c5` followed. Mounted FAQ RED `0f546b76` preceded copy edits. Two subsequent failed GREEN attempts (`9e376a68`, `50165eec`) exposed a test-fixture mistake: the shared extended FAQ/changelog mounts in Help, not directly in Settings. The corrected fixture retains both mounted FAQ/changelog assertions and the Settings Debug log action; GREEN `1cf82aa0` passed 94 cases.

Malformed changing-getter RED `c9ebbf8a` exposed a privacy gap in the new draft observer before its single-read repair; GREEN `f71bba4d` passed. These REDs establish missing diagnostic distinctions and their privacy boundary, not the phone's root cause. Final candidate review, CI, deployment and physical-device evidence remain separate.
