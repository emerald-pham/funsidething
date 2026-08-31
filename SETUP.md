# Cloud sync — how it's wired

Already configured and live. This is the record of what's set up and why, for
whenever you next need to touch it.

## What exists

- **Firebase project** `chain-scanner` (Spark / no-cost plan)
- **Cloud Firestore** in `nam5` (US multi-region), created in production mode
- **Google sign-in** enabled; consent screen shows "Chain Scanner"
- **Authorized domain** `emerald-pham.github.io` added, so the sign-in popup
  is allowed to return to the live site
- The web app config lives at the top of `index.html`

The four config values in `index.html` are public by design — they identify the
project, they don't grant access to anything. The security rule is what protects
the data.

## The security rule

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

A signed-in account can read and write exactly one document — its own,
at `users/{their uid}`. Nobody else's, and nothing at all while signed out.
There is no path in this rule that grants public access.

## How syncing behaves

Deliberately **not** realtime. A live listener would let a write from your phone
swap the benchmark card out from under you mid-scan. Instead it reconciles at
two moments: when the page loads, and when the tab regains focus.

- Writes are debounced 2 seconds, so a fast scanning run costs one write, not thirty
- A pull that finds nothing new produces zero writes
- Ahead/behind is decided by a revision counter, not by timestamps (below)
- Adopting a remote state pushes onto the undo stack — `u` takes it back
- `localStorage` is still the local layer, so the app works offline and
  syncs up next time it can reach the network

### Revisions, not clocks

`state.updatedAt` is stamped with `Date.now()` on whichever device wrote it —
that device's **own clock**. Comparing two devices' timestamps therefore ranks
them by clock offset, not by when the edits happened: a laptop running a few
hours fast wins every reconcile no matter how stale its copy is. That is how a
phone's newer work, task renames included, got replaced by a laptop's older
copy. Wall-clock time cannot order edits made on two machines.

So the document carries `rev`, an integer that only ever goes up, and each
device keeps `state.syncRev` — the revision its copy is based on.

- **Remote `rev` higher than local `syncRev`** → the cloud holds work this
  device has never seen. Adopt it.
- **Equal** → both sides share a base, so any local difference is genuinely
  this device's to push.
- Writes are **conditional**: `CS.push()` runs a Firestore transaction that
  refuses if the document has moved past the revision the caller read. Two
  devices pushing at once used to mean the second silently replaced the first;
  now the loser gets `{conflict:true}`, pulls, and reconciles.

Settings ride the payload like everything else, so they sync with the rest of
the state. `hydrateState()` backfills **every** key from `DEFAULT_SETTINGS` and
rejects non-numeric values rather than coercing them — a partial or junk
settings object arriving from an older device used to leave `horizonMin`,
`thresholdPct` and `samples` undefined and quietly turn the scan's arithmetic
into `NaN`. `DEFAULT_SETTINGS` is the single source of truth for both a fresh
install and a backfill, so two devices either side of an upgrade cannot
disagree about a setting neither of them ever set.

`syncRev` is deliberately kept **out of the payload** — it is device-local
bookkeeping. If it rode along, every device would see a difference the instant
it adopted someone else's state and push it straight back.

The timestamp comparison survives only as the migration path, for a document
written before revisions existed or a device that has never synced under them.
The first write on either side ends it.

### No writing before reading

A browser left closed for weeks boots holding a stale chain, and last-write-wins
alone does not protect you from it. Three rules keep it honest:

- **A tab may not write to the cloud until it has read it once this session.**
  Dotting a task pushes immediately, with no comparison — so before that first
  read, the write is held and a pull is fired instead. The pull releases it.
- **A read that failed is not an empty cloud.** `CS.pull()` answers with the
  document, or `{empty:true}` when there provably isn't one, or `{error:true}`
  when the read didn't happen. Only `{empty:true}` lets a device seed the cloud.
  Anything unreadable means we know nothing, so we write nothing.
- **The first reconcile judges this device by the timestamp it loaded with**,
  not by the one `save()` re-stamps on every local edit. Otherwise a single
  click puts today's timestamp on month-old content and wins outright.

The gate is keyed on the signed-in account, so signing in as someone else
re-arms it. If a newer remote lands on top of edits you'd just made, a toast
says so and `u` takes it back.

The failure mode that remains: genuinely concurrent offline edits on two
devices. There is no merge — the device on the older revision adopts the
other's when it reconciles, and its own changes live on the undo stack rather
than in the cloud. Nothing is overwritten in the cloud without being read
first, but one side's edits still have to yield. Settings → Export JSON is the
escape hatch.

Free tier is 50k reads and 20k writes a day. Realistic use here is a few dozen.

## Turning it off

Blank out the `apiKey` value in `index.html`. The Firebase SDK then never
loads at all and the app runs local-only, exactly as it did before.
