// The one calculation of the two shell identities (#2231, #2380):
//   - the app fingerprint in the current Settings changelog entry, the build id
//     the app and support reports show, and
//   - the service worker's CACHE_NAME, which installed clients use to notice a
//     new shell. A stale key leaves installed workers serving the old UI.
// Neither is committed any more. The checkout carries placeholders, and every
// consumer that serves the shell stamps values computed from the exact files it
// serves: the Pages deploy, local serving, the test harness, the installed-client
// native cases and Beta packaging. They used to be committed by hand after every
// shell edit, which cost a refresh commit and a merge conflict each time (#2380).
//
//   node scripts/shell-fingerprints.mjs [--root <dir>] [--write]
//
// Prints the computed values as JSON. --write stamps them into a published copy
// (the deploy runs it on its site directory); it refuses a Git checkout.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const APP_FINGERPRINT_PLACEHOLDER = 'HASH';
// Exactly what the app fingerprint normalizes the key to, so a placeholder
// worker and a stamped one fingerprint identically.
export const CACHE_NAME_PLACEHOLDER = 'chain-scanner-shell-HASH';
const CURRENT_FINGERPRINT = /(<template id="appChangelogCurrent"><div data-app-fingerprint=")([^"]*)(")/;
const CACHE_NAME_LINE = /(const CACHE_NAME = ")([^"]+)(")/;

// Remote URLs are not part of the shell, the root navigation and index.html are
// one file, and the worker cannot fingerprint itself.
export function shellPaths(worker) {
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
    if (file === 'sw.js') data = Buffer.from(data.toString().replace(/chain-scanner-shell-[a-f0-9]+/, CACHE_NAME_PLACEHOLDER));
    hash.update(file + '\0').update(data).update('\0');
  }
  return hash.digest('hex');
}

// The cache key covers the served shell bytes, including index.html with its
// app fingerprint, so it is computed after that fingerprint is stamped.
function cacheName(read, paths) {
  const hash = createHash('sha256');
  for (const file of paths) hash.update(file).update('\0').update(read(file)).update('\0');
  return 'chain-scanner-shell-' + hash.digest('hex');
}

// Computes both values from a reader of the source files (a checkout, a Git
// commit or a published copy) and returns the two stamped files. A slot must
// hold its placeholder or its exact computed value: a different committed value
// is a stale hand refresh, and serving either one would be ambiguous.
export function computeShell(read) {
  const page = read('index.html').toString();
  const worker = read('sw.js').toString();
  const committedApp = page.match(CURRENT_FINGERPRINT)?.[2];
  const committedCacheName = worker.match(CACHE_NAME_LINE)?.[2];
  if (committedApp === undefined) throw new Error('index.html must carry the current changelog entry\'s data-app-fingerprint.');
  if (committedCacheName === undefined) throw new Error('sw.js must declare a literal CACHE_NAME.');
  const paths = shellPaths(worker);
  const app = appFingerprint(read, paths);
  const servedPage = Buffer.from(page.replace(CURRENT_FINGERPRINT, `$1${app}$3`));
  const key = cacheName(file => file === 'index.html' ? servedPage : read(file), paths);
  if (![APP_FINGERPRINT_PLACEHOLDER, app].includes(committedApp) || ![CACHE_NAME_PLACEHOLDER, key].includes(committedCacheName)) {
    throw new Error('Stale committed shell identity: index.html and sw.js must keep the placeholders ' +
      `data-app-fingerprint="${APP_FINGERPRINT_PLACEHOLDER}" and "${CACHE_NAME_PLACEHOLDER}"; the values are computed when the shell is served.`);
  }
  return {
    paths, appFingerprint: app, cacheName: key,
    files: { 'index.html': servedPage, 'sw.js': Buffer.from(worker.replace(CACHE_NAME_LINE, `$1${key}$3`)) },
  };
}

// Wraps a source reader so it returns what a client is served: the two stamped
// files, and every other file unchanged. Computed once per reader.
export function servedShellReader(read) {
  let shell;
  return file => {
    if (file !== 'index.html' && file !== 'sw.js') return read(file);
    shell ??= computeShell(read);
    return shell.files[file];
  };
}

export function shellFingerprints(root, { write = false } = {}) {
  const shell = computeShell(name => fs.readFileSync(path.join(root, name)));
  if (write) {
    if (fs.existsSync(path.join(root, '.git'))) throw new Error('--write stamps a published copy, never a Git checkout: the checkout keeps its placeholders.');
    for (const [name, bytes] of Object.entries(shell.files)) fs.writeFileSync(path.join(root, name), bytes);
  }
  return { appFingerprint: shell.appFingerprint, cacheName: shell.cacheName, written: write };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = path.resolve(rootIndex >= 0 ? args[rootIndex + 1] ?? '' : process.cwd());
  try {
    process.stdout.write(JSON.stringify(shellFingerprints(root, { write: args.includes('--write') })) + '\n');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 2;
  }
}
