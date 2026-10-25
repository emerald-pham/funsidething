# Populated cloud recovery memory — October 25, 2026

The reported symptom is a whole-document restart in an iOS Home Screen app, often when opening Review cloud recovery sources. The supplied metadata-only report identifies the exact current Stable script (`82d9ac147a07a4b6eb7df5a4778bf50cc85b6e39fa661556ef6d5be2136e3c2d`) and document fingerprint. Two earlier documents end during the first device-source capture of automatic recovery. No application-requested reload is retained. A later pull deadline does not establish the cause of a process restart.

## Consumer and evidence boundary

Use the already agreed actual cloudPull and sync → Review cloud recovery sources consumers with isolated synthetic SDK/storage fixtures. The native complete-source test exercises WebKit rendering and input. Neither fake IndexedDB nor desktop WebKit establishes the physical iOS process termination reason. The original database and an OS crash/Jetsam report are unavailable; no private board content enters Git or the fixtures. All saved originals must remain protected, with no reset or cleanup as a remedy.

Initial desktop WebKit controls (including phone-shaped viewport, a 2.3 MiB board and thirteen repeated manual reviews) did not restart. Native sampling exposed a large transient footprint during automatic recovery, but mixed boot/render/transport work prevented causal attribution. Those controls are not a reproduced phone crash.

## Reproduced defect

A populated protected-copy fixture gives the actual automatic fallback sixteen distinct valid manual backups with 2 MiB unknown fields each. Setup succeeds in an isolated 512 MiB Node heap; cloudPull then exhausts that heap. Eight-copy and twelve-copy controls complete. The sixteen-copy failure repeats, and tagged diagnostic instrumentation identifies repeated cloudSourceRecoveryDeviceSources captures with overlapping lifetimes before any new archive is committed. Full raw snapshots, typed encodings and serialized identities remain separate even when exactly identical. The allocation at failure may be backup-key string flattening or later JSON parsing; it is not evidence that those final allocations caused the retained amplification.

Ranked explanations were repeated full captures, recursive new archives, then test-only retention. The trace fails before an archive write, with live capture overlap in production functions. The permanent consumer regression confirms the retained amplification. This is a demonstrated memory-exhaustion defect consistent with the incident stage, not proof of the affected phone's exact termination cause.

## Minimal repair

Each source check still reads and encodes the complete current device source. After exact serialized equality and the same-store check, reuse the bounded attempt's latest raw snapshot, typed encoding and identity string. Changed captures remain separate and all original baseline, account, draft, generation, conditional-write and readback checks still run. Later valid recaptures can share their new exact source; there is no cross-attempt or cross-account cache. The explored targeted head-read change was unnecessary and is absent from the final patch.

The permanent regression finishes the setup Add's actual scheduled save, starts the automatic consumer, requires both complete source-check aggregates, opens manual review, refuses Apply without a source choice, cancels, verifies every protected payload by SHA-256 and proves a subsequent Add is durably saved. The 32 MiB fixture and 512 MiB bound are a repeatable process regression budget, not an iPhone quota or device promise. Prior complete-source tests used a small recovery collection and waited for automatic work to become idle, leaving the overlapping populated-copy case uncovered.

Independent review found that the first fixture could pass the old code on Node 22: its unfinished setup debounce could change the source and stop recovery before the full comparison. Increasing to 24 copies also exhausted the fixed code, so that experiment was rejected. A diagnostic pair did not show the expected old/new footprint separation and prompted inspection of the setup lifetime. The final fixture uses the existing setup-save completion option and asserts both complete aggregates; with the original 16 copies and unchanged heap budget, Node 22 now reproduces the old-code OOM and passes the repaired consumer. This later sensitivity check is separate from the original Node 23 preimplementation RED.

## Chronological evidence

Raw provenance, stdout and stderr are retained outside Git in `/Users/emeraldpham/.codex/task-artifacts/cloud-recovery-crash-20261025/runs/`.

| Record | Result and scope |
| --- | --- |
| 2e7e42b9 / ead52bb8 | 8/12 protected-copy controls complete under the same heap bound. |
| 2d4d265c / cf8b2460 | Repeated 16-copy OOM after actual consumer entry. |
| e04d8df0 | Tagged trace: overlapping production captures; OOM before archive commit. |
| 5e5d33c5 | Permanent tests.js preimplementation RED on daa7576; expected successful child instead exhausts memory. |
| 6cb61bee / 9356acd9 | Head-read-only exploration still fails; not shipped. |
| fd8faa6d | Minimal capture-sharing consumer GREEN with original database reader. |
| 0ebca09a | Mounted FAQ/changelog RED before guidance change. |
| f5ab597f | 187 focused recovery, authority, cancellation, retry and guidance checks pass. |
| b6fd2609 | Both original native WebKit complete-source cases pass. |
| 916f8a93 | Node 22 memory, baseline-refresh, automatic union and resume checks pass. |
| 07e86b3b | Exact f2e7d7e Node 22: 192 focused/source/native/shell checks pass before FAQ qualification. |
| 495b2162 | Independent FAQ finding: new mounted assertion fails before qualifying unproved device crash causation. |
| c92660ba / d6afd86a | Review sensitivity finding: Node 22 baseline passed the earlier fixture; marked preload confirms old index bytes in the child. |
| 1000b5f6 | Rejected 24-copy experiment: repaired Node 22 also exceeds the unchanged heap bound. |
| 2b8d690b / 0d46757c | Diagnostic heap traces for earlier fixture; not final acceptance or physical-device evidence. |
| e942026b / 6c507961 | After completing the actual setup save, Node 22 baseline OOM and repaired consumer pass at original 16-copy/512 MiB boundary. |
| da2ea0ef | Repaired direct consumer reports both first and second automatic aggregates completed before manual review. |
| 13a18a9c / 040b22ff | Final completed-aggregate assertions pass on Node 23 and Node 22 respectively. |

The mistyped native selector in de0e748c ran zero tests; it is not a pass for any native behavior. Final candidate review, CI, deployment and physical-device checks remain distinct from these working-tree results. Stable is the only release destination; Beta remains paused.
