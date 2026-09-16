# Chain Scanner

A ranked FVP (Final Version Perfected) task scanner. Dot, compare, execute.

Live: https://emerald-pham.github.io/funsidething/

One question at a time: would you rather do this than the current benchmark? Every yes/no is a pairwise match, and each task carries a strength posterior rather than a fixed priority. Descending mode starts with the oldest eligible task and then offers candidates by estimated TrueSkill strength. Chance mode draws a weighted order from those strengths and keeps it fixed through decision undos; a new scan or the 2 AM marker refreshes it. Yes/No updates ratings immediately in either mode. Sparklines show estimated rank distributions, and approximate stop-scanning guidance considers the candidates actually ahead.

Single self-contained HTML file. Tasks live in your browser's local storage, so it works offline and on its own. Sign in from the header and it also syncs across your devices through Firebase — see [SETUP.md](SETUP.md). Use Settings to export or import JSON.

After Mark Forster's Final Version Perfected; rank posteriors after spawelo.
