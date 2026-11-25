# Domain docs

This repository uses a single-context domain layout. Before exploring, read
`GLOSSARY.md` if present and relevant decisions in `docs/adr/`. Use the glossary's
terms in specs, test names and reviews; surface ADR conflicts explicitly.
If these files are absent, proceed without creating placeholders. Record terms
and decisions only when the work resolves them; no domain redesign is implied
by this guidance migration.

## Product rule: automatic over choices

If a step is provably safe, the app does it itself: no button or prompt.
Provably safe means the app's own checks establish, before it acts, that nothing
the person could still read or recover is lost. Without that proof, keep the
safe default. Specs gate the automatic step on the proof instead of adding a
control; reviews flag a needless prompt. For errors, retries, reconnects or
stale reads, [Safe automatic recovery](error-recovery.md) sets the limits and
says when the person must act.

## Searching index.html for a UI label

The changelog sits on two lines of `index.html` of about 87 KB, which mention
nearly every feature name. Drop them from a label search:

```sh
grep -n 'Worked on it' index.html | grep -v '^[0-9]*:<template id="appChangelog'
```
