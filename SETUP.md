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

The failure mode to know about: genuinely concurrent offline edits on two
devices. Whichever syncs second wins, and the other's changes are gone.
Settings → Export JSON is the escape hatch.

Free tier is 50k reads and 20k writes a day. Realistic use here is a few dozen.

## Turning it off

Blank out the `apiKey` value in `index.html`. The Firebase SDK then never
loads at all and the app runs local-only, exactly as it did before.
