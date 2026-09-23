# Cloud data logic audit — September 23, 2026

Audited source: `origin/main` at `11d2dfa6554d814f77cf2e08db82cf2eb6f1cd11`.
Scope: app persistence and reconciliation, account changes, recovery copies,
Firestore write transactions and rules, and the PWA release gate. The audit
used synthetic boards, mocked cloud responses, and the Firestore emulator. It
did not read production accounts or inspect live Firestore documents.

## Repaired findings

| Priority | Gap | Repair |
| --- | --- | --- |
| High | Server dates could overrule a higher revision, or make a same-revision remote copy replace an offline edit. | Use the Firestore revision as the sole ordering authority. Treat an unversioned document as unknown, adopt it safely, then upgrade it to revision 1. |
| High | Switching accounts could replace an unsynced board without a durable recovery copy, and Undo could carry the old account's board into the new one. | Save a device-local copy before switching; stop if that save fails. Clear or reject cross-account Undo and identify the destination account before a cross-account restore. |
| High | Two rapid writes from one tab could race on the same base revision; an old acknowledgement could then lower the revision after a newer pull. | Serialize writes through local persistence and cloud acknowledgement; reject stale acknowledgements. |
| Medium | Remote adoption on the artifact host did not always persist the replaced board through its active storage backend. | Persist through the shared storage abstraction, after making a local safety copy. |
| Medium | A cloud refresh could continue after detecting unreadable browser copies, then overwrite those bytes. | Stop reconciliation when the browser-copy check fails, preserving the original bytes for recovery. |
| Medium | A same-task conflict after the first read could silently replace a local edit. | Keep the prior board in Settings backups and show a conflict warning. The user can Undo or restore it. |
| Medium | Permanent switch copies could grow through duplicate snapshots, with no way to remove one. | Deduplicate exact unsynced snapshots, keep cloud-confirmed switch copies for seven days, and add a Delete action in Settings. |

Each behavior above has a regression that was observed failing before its fix.
The emulator tests exercise owner isolation, required revisions, timestamps,
and denied deletion. An independent review checked the authority and storage
changes and prompted the backup-capacity repair.

Local validation: the full `node --test --test-reporter=dot tests.js` suite,
`npm run test:rules`, and `git diff --check` passed. The Settings backup rows
were also opened in Chrome at a 320 px viewport; Restore and Delete wrapped
inside the dialog without page overflow. These checks do not inspect live
cloud contents or prove that production has the same deployed rules.

## Remaining design limits

1. **One document holds the whole board.** Firestore limits a document to
   [1 MiB](https://firebase.google.com/docs/firestore/quotas). Tasks, History,
   settings, and deletion evidence all count. Large boards eventually need a
   versioned multi-document design and a migration plan.
2. **Two devices editing the same task still need human resolution.** The later
   accepted revision becomes active. The displaced board is backed up and the
   user is warned, but the app does not merge different fields within one task.
   Restoring a full backup is a deliberate whole-board action.
3. **Recovery copies use browser storage.** Its quota and lifetime are set by
   the browser. Full storage stops a safety-sensitive replacement or write;
   clearing site data removes those copies. A future durable recovery service
   would need its own access control and retention policy.
4. **Rules protect the document envelope, not JSON meaning.** Firestore rules
   enforce owner, revision, and server time. Since the board is a JSON string,
   the rules cannot validate task/history semantics or reject a malformed
   write from an authorized but incompatible client. Schema-checked documents
   or a trusted writer would close that boundary.

These limits prevent a claim of zero possible data loss. The repairs protect
the known failure paths without changing the user's task model. No production
data migration or rules deployment was part of this audit.
