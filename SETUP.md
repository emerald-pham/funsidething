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
- Conflicts resolve last-write-wins on a `updatedAt` timestamp
- Adopting a remote state pushes onto the undo stack — `u` takes it back
- `localStorage` is still the local layer, so the app works offline and
  syncs up next time it can reach the network

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
devices. There is no merge — the device whose copy is older when it finally
reconciles adopts the other's, and its own changes live on the undo stack
rather than in the cloud. Settings → Export JSON is the escape hatch.

Free tier is 50k reads and 20k writes a day. Realistic use here is a few dozen.

## Turning it off

Blank out the `apiKey` value in `index.html`. The Firebase SDK then never
loads at all and the app runs local-only, exactly as it did before.
