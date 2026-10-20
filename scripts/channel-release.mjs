#!/usr/bin/env node
// This command stages committed bytes. It never invokes Firebase or publishes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyReleaseEvidence } from './release-evidence.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { maxBuffer: 32 * 1024 * 1024 });
const args = process.argv.slice(3);
if (process.argv[2] !== 'prepare-beta') throw new Error('Command: prepare-beta (local staging only).');
const required = ['--source', '--tree', '--output', '--deployed-at', '--notice-starts-at'];
const values = new Map();
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  if (values.has(name)) throw new Error('Duplicate option: ' + name);
  if (name === '--preview') values.set(name, true);
  else {
    if (!required.includes(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Unknown option or missing value: ' + name);
    values.set(name, args[++i]);
  }
}
for (const name of required) if (!values.has(name)) throw new Error('Required option: ' + name);
const option = name => values.get(name);
for (const name of ['--deployed-at', '--notice-starts-at']) {
  const value = option(name);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('Explicit canonical ISO timestamp required: ' + name);
  }
}
if (Date.parse(option('--notice-starts-at')) < Date.parse(option('--deployed-at'))) {
  throw new Error('Notice startsAt must be at or after deployedAt.');
}
const output = option('--output');
if (!path.isAbsolute(output) || path.resolve(output) !== output || fs.realpathSync(path.dirname(output)) !== path.dirname(output)) {
  throw new Error('Output requires an absolute canonical parent without symlink or traversal aliases.');
}
const source = option('--source');
const tree = option('--tree');
const preview = args.includes('--preview');
if (!/^[a-f0-9]{40}$/.test(source || '') || !/^[a-f0-9]{40}$/.test(tree || '') ||
    git('rev-parse', source + '^{commit}').toString().trim() !== source ||
    git('rev-parse', source + '^{tree}').toString().trim() !== tree) {
  throw new Error('Exact source tree must match the committed candidate.');
}
const tracked = git('ls-tree', '-rz', '--full-tree', source).toString().split('\0').filter(Boolean);
for (const entry of tracked) {
  const separator = entry.indexOf('\t');
  const header = entry.slice(0, separator);
  const file = entry.slice(separator + 1);
  if (!/^100(?:644|755) blob [a-f0-9]{40}$/.test(header) || !file || file.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f\\]/.test(file)) {
    throw new Error('Only safe regular committed files are allowed; symlinks and special nodes are refused.');
  }
  if (file === 'channel-release.json' || file.startsWith('channel-release.json/')) throw new Error('Committed channel-release.json collision.');
}
let releaseEvidence = null;
if (!preview) {
  const evidence = verifyReleaseEvidence(process.cwd(), source);
  if (!evidence.ok) throw new Error('Exact-source release evidence required: ' + evidence.errors.join('; '));
  releaseEvidence = { candidate: evidence.receipt.candidate, receiptSha256: hash(fs.readFileSync(evidence.receiptPath)) };
}
const sw = git('show', source + ':sw.js').toString();
const list = sw.match(/\.addAll\(\[([\s\S]*?)\]\s*\.map/);
if (!list) throw new Error('Committed worker shell inventory is unavailable.');
const assets = [...new Set([...list[1].matchAll(/"([^"]+)"/g)].map(m => m[1] === './' ? 'index.html' : m[1].replace(/^\.\//, '')).concat('sw.js'))].sort();
for (const file of assets) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe shell asset path.');
}
const shellHash = createHash('sha256');
const productHash = createHash('sha256');
for (const file of assets) {
  let bytes = git('show', source + ':' + file);
  if (file !== 'sw.js') shellHash.update(file + '\0').update(bytes).update('\0');
  if (file === 'index.html') bytes = Buffer.from(bytes.toString().replace(/<!-- changelog:start -->[\s\S]*?<!-- changelog:end -->/, '<!-- changelog -->'));
  if (file === 'sw.js') bytes = Buffer.from(bytes.toString().replace(/chain-scanner-shell-[a-f0-9]+/, 'chain-scanner-shell-HASH'));
  productHash.update(file + '\0').update(bytes).update('\0');
}
const appFingerprint = productHash.digest('hex');
if (sw.match(/const CACHE_NAME = "([^"]+)"/)?.[1] !== 'chain-scanner-shell-' + shellHash.digest('hex') ||
    git('show', source + ':index.html').toString().match(/data-app-fingerprint="([a-f0-9]{64})"/)?.[1] !== appFingerprint) {
  throw new Error('Committed product fingerprint or worker shell identity is stale.');
}
fs.mkdirSync(output, { mode: 0o700 });
const reservation = fs.lstatSync(output);
let staging;
let complete = false;
try {
  staging = fs.mkdtempSync(path.join(path.dirname(output), '.' + path.basename(output) + '.staging-'));
  const publicDir = path.join(staging, 'public');
  fs.mkdirSync(publicDir);
  const archive = git('archive', '--format=tar', source, '--', ...assets);
  execFileSync('tar', ['-x', '-C', publicDir], { input: archive });
  const files = {};
  for (const file of assets) {
    const bytes = fs.readFileSync(path.join(publicDir, file));
    if (!bytes.equals(git('show', source + ':' + file))) throw new Error('Archive changed committed asset bytes: ' + file);
    files[file] = { sha256: hash(bytes), bytes: bytes.length };
  }
  const envelope = { schemaVersion: 1, channel: 'beta', origin: 'https://chain-scanner.web.app', basePath: '/',
    product: { sourceRevision: source, tree, appFingerprint },
    deployedAt: option('--deployed-at'), notices: { 'sync-stability-2026-10': { startsAt: option('--notice-starts-at') } } };
  const metadata = Buffer.from(JSON.stringify(envelope, null, 2) + '\n');
  fs.writeFileSync(path.join(publicDir, 'channel-release.json'), metadata, { flag: 'wx' });
  files['channel-release.json'] = { sha256: hash(metadata), bytes: metadata.length };
  const config = { hosting: { site: 'chain-scanner', public: 'public', ignore: ['**/.*'], headers: [
    { source: '/channel-release.json', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }] },
    { source: '/', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
  ] } };
  const configBytes = Buffer.from(JSON.stringify(config, null, 2) + '\n');
  fs.writeFileSync(path.join(staging, 'firebase.json'), configBytes, { flag: 'wx' });
  const artifact = { schemaVersion: 1, mode: preview ? 'preview' : 'reviewed', publishable: !preview,
    status: preview ? 'UNREVIEWED - NOT FOR PUBLICATION' : 'EXACT SOURCE REVIEWED - PUBLICATION NOT ATTEMPTED',
    publication: 'not-attempted', product: envelope.product, releaseEvidence, files, firebaseConfigSha256: hash(configBytes) };
  artifact.artifactSha256 = hash(JSON.stringify(artifact));
  fs.writeFileSync(path.join(staging, 'artifact.json'), JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' });
  const current = fs.lstatSync(output);
  if (!current.isDirectory() || current.dev !== reservation.dev || current.ino !== reservation.ino || fs.readdirSync(output).length) throw new Error('Staging destination reservation changed.');
  // Replace only our exclusively reserved empty directory, atomically on one filesystem.
  fs.renameSync(staging, output);
  complete = true;
  if (preview) process.stderr.write(artifact.status + '\n');
  process.stdout.write(JSON.stringify({ output, ...artifact }) + '\n');
} finally {
  if (!complete) {
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
    try {
      const current = fs.lstatSync(output);
      if (current.dev === reservation.dev && current.ino === reservation.ino && current.isDirectory()) fs.rmdirSync(output);
    } catch { /* A changed or populated reservation belongs to its writer; preserve it. */ }
  }
}
