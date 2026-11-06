// Computes, and with --write refreshes, the two shell identities that every
// app-shell change must update together (#2231):
//   - the app fingerprint in the current Settings changelog entry, and
//   - the service worker's CACHE_NAME, which installed clients use to notice a
//     new shell. A stale key leaves installed workers serving the old UI.
// Both used to be hand-computed after every edit. The rules here mirror the
// changelog and CACHE_NAME contract tests, which stay the safety net.
//
//   node scripts/shell-fingerprints.mjs [--root <checkout>] [--write]
//
// Prints a JSON report. Exits 1 when either value is stale and --write was not
// given, so it can also serve as a check.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CURRENT_FINGERPRINT = /(<template id="appChangelogCurrent"><div data-app-fingerprint=")([a-f0-9]{64})(")/;
const CACHE_NAME_LINE = /(const CACHE_NAME = ")([^"]+)(")/;

// Same local-path rules as the shell contract tests: remote URLs are not part
// of the shell, the root navigation and index.html are one file, and the worker
// cannot fingerprint itself.
function shellPaths(worker) {
  const list = worker.match(/\.addAll\(\s*\[([\s\S]*?)\]/);
  if (!list) throw new Error('sw.js must precache a literal app-shell path list.');
  const paths = [...new Set([...list[1].matchAll(/["']([^"']+)["']/g)].flatMap(([, entry]) => {
    if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(entry) || /^[a-z][a-z\d+.-]*:/i.test(entry)) return [];
    const normalized = path.posix.normalize(entry.replace(/^\.\//, ''));
    if (normalized === '.' || normalized === 'index.html') return ['index.html'];
    if (normalized === 'sw.js') return [];
    return [normalized];
  }))].sort();
  for (const file of paths) {
    if (file.startsWith('../') || path.isAbsolute(file)) throw new Error('Precached shell path leaves the checkout: ' + file);
  }
  return paths;
}

// The app fingerprint covers the shell and the worker with the changelog block
// and the cache key normalized, so neither value depends on itself.
function appFingerprint(read, paths) {
  const hash = createHash('sha256');
  for (const file of [...paths, 'sw.js'].sort()) {
    let data = read(file);
    if (file === 'index.html') data = Buffer.from(data.toString().replace(/<!-- changelog:start -->[\s\S]*?<!-- changelog:end -->/, '<!-- changelog -->'));
    if (file === 'sw.js') data = Buffer.from(data.toString().replace(/chain-scanner-shell-[a-f0-9]+/, 'chain-scanner-shell-HASH'));
    hash.update(file + '\0').update(data).update('\0');
  }
  return hash.digest('hex');
}

// The cache key covers the committed shell bytes, including index.html with
// its app fingerprint, so it must be computed after that fingerprint is set.
function cacheName(read, paths) {
  const hash = createHash('sha256');
  for (const file of paths) hash.update(file).update('\0').update(read(file)).update('\0');
  return 'chain-scanner-shell-' + hash.digest('hex');
}

export function shellFingerprints(root, { write = false } = {}) {
  const file = name => path.join(root, name);
  const worker = fs.readFileSync(file('sw.js'), 'utf8');
  const page = fs.readFileSync(file('index.html'), 'utf8');
  const committedApp = page.match(CURRENT_FINGERPRINT)?.[2];
  const committedCacheName = worker.match(CACHE_NAME_LINE)?.[2];
  if (!committedApp) throw new Error('index.html must carry the current changelog entry\'s data-app-fingerprint.');
  if (!committedCacheName) throw new Error('sw.js must declare a literal CACHE_NAME.');

  const paths = shellPaths(worker);
  const expectedApp = appFingerprint(name => fs.readFileSync(file(name)), paths);
  const nextPage = page.replace(CURRENT_FINGERPRINT, `$1${expectedApp}$3`);
  const expectedCacheName = cacheName(name => name === 'index.html' ? Buffer.from(nextPage) : fs.readFileSync(file(name)), paths);
  const stale = committedApp !== expectedApp || committedCacheName !== expectedCacheName;

  if (write && stale) {
    fs.writeFileSync(file('index.html'), nextPage);
    fs.writeFileSync(file('sw.js'), worker.replace(CACHE_NAME_LINE, `$1${expectedCacheName}$3`));
  }
  return {
    appFingerprint: { committed: committedApp, expected: expectedApp },
    cacheName: { committed: committedCacheName, expected: expectedCacheName },
    stale,
    written: write && stale,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = path.resolve(rootIndex >= 0 ? args[rootIndex + 1] ?? '' : process.cwd());
  try {
    const report = shellFingerprints(root, { write: args.includes('--write') });
    process.stdout.write(JSON.stringify(report) + '\n');
    if (report.stale && !report.written) {
      process.stderr.write('Shell fingerprints are stale. Run `npm run fingerprints -- --write`.\n');
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 2;
  }
}
