# Chain Scanner

A ranked FVP (Final Version Perfected) task scanner. Dot, compare, execute.

Live: https://emerald-pham.github.io/funsidething/

One question at a time: would you rather do this than the current benchmark? Every yes/no is a pairwise match, and each task carries a strength posterior rather than a fixed priority. Candidates are dealt by Thompson sampling, sparklines show each task's distribution over rank, and when the odds of finding anything better collapse, the scanner tells you to stop clicking and go work.

Single self-contained HTML file. Tasks live in your browser's local storage, so it works offline and on its own. Sign in from the header and it also syncs across your devices through Firebase — see [SETUP.md](SETUP.md). Use Settings to export or import JSON.

After Mark Forster's Final Version Perfected; rank posteriors after spawelo.
