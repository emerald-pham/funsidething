# Chain Scanner

A ranked FVP (Final Version Perfected) task scanner. Dot, compare, execute.

Live: https://emerald-pham.github.io/funsidething/

One question at a time: would you rather do this than the current benchmark? Every yes/no is a pairwise match, and each task carries a strength posterior rather than a fixed priority. Chance mode is the default for new installations. Descending mode starts with the oldest eligible task and then offers candidates by estimated TrueSkill strength. Chance mode weights each task by its average TrueSkill win probability against the other unfinished tasks, including uncertainty, and keeps the draw fixed through decision undos; a new scan or the 2 AM marker refreshes it. Yes/No updates ratings immediately in either mode. Dislodge records a loss to a fresh default-rated reference, lowering only that task; Undo restores the previous rating. No rating floor or offset is applied; if every eligible chance weight is zero, scanning uses descending likelihood. Sparklines show estimated rank distributions, and approximate stop-scanning guidance considers the candidates actually ahead.

The scanner is an installable PWA: use your browser's install or “Add to Home Screen” action after the first visit. Its app shell is cached for offline launches, and tasks live in browser storage so the local scanner keeps working without a network; sign-in and cross-device sync still need connectivity — see [SETUP.md](SETUP.md). Use Settings to export or import JSON.

After Mark Forster's Final Version Perfected; rank posteriors after spawelo.
