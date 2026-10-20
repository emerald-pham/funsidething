#!/usr/bin/env node
// This command stages committed bytes. It never invokes Firebase or publishes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { verifyReleaseEvidence } from './release-evidence.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { maxBuffer: 32 * 1024 * 1024 });
const NOTICE_ID = 'sync-stability-2026-10';
const BETA_ORIGIN = 'https://chain-scanner.web.app';
const PUBLIC_ORIGIN = BETA_ORIGIN + '/';
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const isSha1 = value => typeof value === 'string' && SHA1.test(value);
const isSha256 = value => typeof value === 'string' && SHA256.test(value);

function fail(message) {
  throw new Error('Continuation proof: ' + message);
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be an object.');
  return value;
}

function exactKeys(value, keys, label) {
  record(value, label);
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())) fail(label + ' has an invalid shape.');
}

function canonicalTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function requireCanonicalPath(value, label, type) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) fail(label + ' must be an absolute canonical path.');
  const stats = fs.lstatSync(value);
  if (stats.isSymbolicLink() || (type === 'file' && !stats.isFile()) || (type === 'directory' && !stats.isDirectory()) ||
      fs.realpathSync(value) !== value) fail(label + ' must be a regular canonical ' + type + '.');
  return value;
}

function safeJsonFile(file, label) {
  requireCanonicalPath(file, label, 'file');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function safeRelativeFile(file) {
  return typeof file === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(file) &&
    file.split('/').every(part => part && part !== '.' && part !== '..');
}

function publicFiles(directory) {
  const files = [];
  const visit = (current, prefix = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (!safeRelativeFile(relative)) fail('public inventory contains an unsafe path.');
      const absolute = path.join(current, entry.name);
      const stats = fs.lstatSync(absolute);
      if (stats.isSymbolicLink()) fail('public inventory contains a symbolic link.');
      if (entry.isDirectory() && stats.isDirectory()) visit(absolute, relative);
      else if (entry.isFile() && stats.isFile()) files.push(relative);
      else fail('public inventory contains a special node.');
    }
  };
  visit(directory);
  return files.sort();
}

function validateOriginalProduct(repository, manifest, publicDirectory) {
  const product = record(manifest.product, 'original product');
  exactKeys(product, ['sourceRevision', 'tree', 'appFingerprint'], 'original product');
  if (!isSha1(product.sourceRevision) || !isSha1(product.tree) || !isSha256(product.appFingerprint) ||
      git('rev-parse', product.sourceRevision + '^{commit}').toString().trim() !== product.sourceRevision ||
      git('rev-parse', product.sourceRevision + '^{tree}').toString().trim() !== product.tree) {
    fail('original product must name its exact committed source and tree.');
  }

  const entries = git('ls-tree', '-rz', '--full-tree', product.sourceRevision).toString().split('\0').filter(Boolean);
  for (const entry of entries) {
    const separator = entry.indexOf('\t');
    const header = entry.slice(0, separator);
    const file = entry.slice(separator + 1);
    if (!/^100(?:644|755) blob [a-f0-9]{40}$/.test(header) || !file ||
        file.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f\\]/.test(file)) {
      fail('original source contains a special node or unsafe path.');
    }
    if (file === 'channel-release.json' || file.startsWith('channel-release.json/')) fail('original source has a channel metadata collision.');
  }

  const worker = git('show', product.sourceRevision + ':sw.js').toString();
  const shell = worker.match(/\.addAll\(\[([\s\S]*?)\]\s*\.map/);
  if (!shell) fail('original committed worker shell inventory is unavailable.');
  const assets = [...new Set([...shell[1].matchAll(/"([^"]+)"/g)]
    .map(match => match[1] === './' ? 'index.html' : match[1].replace(/^\.\//, '')).concat('sw.js'))].sort();
  if (!isDeepStrictEqual(Object.keys(manifest.files).sort(), [...assets, 'channel-release.json'].sort())) {
    fail('original artifact inventory does not match its committed worker shell and channel metadata.');
  }
  const shellHash = createHash('sha256');
  const productHash = createHash('sha256');
  for (const file of assets) {
    if (!safeRelativeFile(file)) fail('original committed worker inventory contains an unsafe path.');
    const committed = git('show', product.sourceRevision + ':' + file);
    const staged = fs.readFileSync(path.join(publicDirectory, file));
    if (!staged.equals(committed)) fail('original artifact differs from its committed product bytes: ' + file);
    if (file !== 'sw.js') shellHash.update(file + '\0').update(committed).update('\0');
    let bytes = committed;
    if (file === 'index.html') bytes = Buffer.from(bytes.toString().replace(/<!-- changelog:start -->[\s\S]*?<!-- changelog:end -->/, '<!-- changelog -->'));
    if (file === 'sw.js') bytes = Buffer.from(bytes.toString().replace(/chain-scanner-shell-[a-f0-9]+/, 'chain-scanner-shell-HASH'));
    productHash.update(file + '\0').update(bytes).update('\0');
  }
  if (productHash.digest('hex') !== product.appFingerprint ||
      worker.match(/const CACHE_NAME = "([^"]+)"/)?.[1] !== 'chain-scanner-shell-' + shellHash.digest('hex') ||
      git('show', product.sourceRevision + ':index.html').toString().match(/data-app-fingerprint="([a-f0-9]{64})"/)?.[1] !== product.appFingerprint) {
    fail('original product fingerprint or worker shell identity does not match its committed bytes.');
  }
}

function validateContinuation(repository, bundlePath, suppliedStartsAt, currentDeployedAt) {
  requireCanonicalPath(bundlePath, '--continue-notice', 'file');
  const bundle = safeJsonFile(bundlePath, 'bundle');
  exactKeys(bundle, ['artifactDirectory', 'publicationPath', 'publicVerificationPath'], 'bundle');
  const artifactDirectory = requireCanonicalPath(bundle.artifactDirectory, 'artifactDirectory', 'directory');
  const publicationPath = requireCanonicalPath(bundle.publicationPath, 'publicationPath', 'file');
  const publicVerificationPath = requireCanonicalPath(bundle.publicVerificationPath, 'publicVerificationPath', 'file');

  const manifestPath = path.join(artifactDirectory, 'artifact.json');
  requireCanonicalPath(manifestPath, 'artifact manifest', 'file');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  exactKeys(manifest, ['schemaVersion', 'mode', 'publishable', 'status', 'publication', 'product', 'releaseEvidence', 'files', 'firebaseConfigSha256', 'artifactSha256'], 'artifact manifest');
  if (manifest.schemaVersion !== 1 || manifest.mode !== 'reviewed' || manifest.publishable !== true ||
      manifest.status !== 'EXACT SOURCE REVIEWED - PUBLICATION NOT ATTEMPTED' || manifest.publication !== 'not-attempted' ||
      !isSha256(manifest.artifactSha256)) fail('original artifact must be reviewed, publishable, and not previously published.');
  const artifactForDigest = { ...manifest };
  delete artifactForDigest.artifactSha256;
  if (hash(Buffer.from(JSON.stringify(artifactForDigest))) !== manifest.artifactSha256) fail('original artifact digest is invalid.');

  const publicDirectory = path.join(artifactDirectory, 'public');
  requireCanonicalPath(publicDirectory, 'artifact public directory', 'directory');
  const files = record(manifest.files, 'artifact file inventory');
  const listedFiles = Object.keys(files).sort();
  if (!listedFiles.length || !isDeepStrictEqual(publicFiles(publicDirectory), listedFiles)) fail('original public inventory is incomplete or contains unlisted files.');
  for (const file of listedFiles) {
    if (!safeRelativeFile(file)) fail('original artifact inventory contains an unsafe path.');
    exactKeys(files[file], ['sha256', 'bytes'], 'artifact file record');
    const absolute = path.join(publicDirectory, file);
    requireCanonicalPath(absolute, 'artifact public file', 'file');
    const bytes = fs.readFileSync(absolute);
    if (!isSha256(files[file].sha256) || !Number.isSafeInteger(files[file].bytes) || files[file].bytes < 0 ||
        hash(bytes) !== files[file].sha256 || bytes.length !== files[file].bytes) fail('original artifact file digest or size is invalid: ' + file);
  }

  const configPath = path.join(artifactDirectory, 'firebase.json');
  requireCanonicalPath(configPath, 'artifact Hosting config', 'file');
  const configBytes = fs.readFileSync(configPath);
  if (!isSha256(manifest.firebaseConfigSha256) || hash(configBytes) !== manifest.firebaseConfigSha256) fail('original Hosting config digest is invalid.');
  const config = JSON.parse(configBytes.toString('utf8'));
  if (config.hosting?.site !== 'chain-scanner' || config.hosting?.public !== 'public') fail('original Hosting config has the wrong destination.');

  const releaseEvidence = record(manifest.releaseEvidence, 'original release evidence');
  exactKeys(releaseEvidence, ['candidate', 'receiptSha256'], 'original release evidence');
  const evidenceCandidate = record(releaseEvidence.candidate, 'original release candidate');
  exactKeys(evidenceCandidate, ['commitSha', 'treeSha', 'baseSha'], 'original release candidate');
  if (!isSha1(evidenceCandidate.commitSha) || !isSha1(evidenceCandidate.treeSha) || !isSha1(evidenceCandidate.baseSha) ||
      !isSha256(releaseEvidence.receiptSha256)) fail('original exact-source release receipt digest or candidate is invalid.');
  const verified = verifyReleaseEvidence(repository, manifest.product?.sourceRevision);
  if (!verified.ok || !verified.receiptPath || !isDeepStrictEqual(verified.receipt?.candidate, evidenceCandidate) ||
      evidenceCandidate.commitSha !== manifest.product?.sourceRevision || evidenceCandidate.treeSha !== manifest.product?.tree ||
      hash(fs.readFileSync(verified.receiptPath)) !== releaseEvidence.receiptSha256) {
    fail('original exact-source release receipt is missing or mismatched.');
  }

  const envelopePath = path.join(publicDirectory, 'channel-release.json');
  requireCanonicalPath(envelopePath, 'original Beta envelope', 'file');
  const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
  exactKeys(envelope, ['schemaVersion', 'channel', 'origin', 'basePath', 'product', 'deployedAt', 'notices'], 'original Beta envelope');
  if (envelope.schemaVersion !== 1 || envelope.channel !== 'beta' || envelope.origin !== BETA_ORIGIN || envelope.basePath !== '/' ||
      !isDeepStrictEqual(envelope.product, manifest.product) || !canonicalTimestamp(envelope.deployedAt)) {
    fail('original Beta envelope has an invalid identity or publication time.');
  }
  const notices = record(envelope.notices, 'original notices');
  exactKeys(notices, [NOTICE_ID], 'original notices');
  const originalNotice = record(notices[NOTICE_ID], 'original notice');
  exactKeys(originalNotice, ['startsAt'], 'original notice');
  if (!canonicalTimestamp(originalNotice.startsAt) || Date.parse(envelope.deployedAt) > Date.parse(originalNotice.startsAt) ||
      suppliedStartsAt !== originalNotice.startsAt || Date.parse(envelope.deployedAt) > Date.parse(currentDeployedAt)) {
    fail('original notice dates do not continue the supplied Beta start and later deployment.');
  }
  validateOriginalProduct(repository, manifest, publicDirectory);

  const publication = record(safeJsonFile(publicationPath, 'provider release record'), 'provider release record');
  const publicationKeys = ['project', 'site', 'channel', 'channelName', 'url', 'release', 'canonicalProductPublicationTime', 'observedAt'];
  if (Object.keys(publication).some(key => ![...publicationKeys, 'conversion', 'privacy'].includes(key)) ||
      publicationKeys.some(key => !Object.hasOwn(publication, key))) fail('provider release record has an invalid shape.');
  if (publication.project !== 'chain-scanner' || publication.site !== 'chain-scanner' || publication.channel !== 'live' ||
      publication.channelName !== 'projects/chain-scanner/sites/chain-scanner/channels/live' || publication.url !== BETA_ORIGIN) {
    fail('provider release record names the wrong project, channel, or destination.');
  }
  const release = record(publication.release, 'provider release');
  exactKeys(release, ['name', 'versionName', 'type', 'message', 'releaseTime'], 'provider release');
  if (typeof release.name !== 'string' || !/^projects\/chain-scanner\/sites\/chain-scanner\/channels\/live\/releases\/[A-Za-z0-9_-]+$/.test(release.name) ||
      typeof release.versionName !== 'string' || !/^projects\/chain-scanner\/sites\/chain-scanner\/versions\/[A-Za-z0-9_-]+$/.test(release.versionName) ||
      release.type !== 'DEPLOY' || typeof release.message !== 'string' || !release.message.trim() ||
      !canonicalTimestamp(release.releaseTime) || release.releaseTime !== envelope.deployedAt ||
      publication.canonicalProductPublicationTime !== envelope.deployedAt || !canonicalTimestamp(publication.observedAt) ||
      Date.parse(publication.observedAt) < Date.parse(release.releaseTime)) {
    fail('provider release time or resource identity does not match the original product.');
  }

  const publicVerification = safeJsonFile(publicVerificationPath, 'public verification report');
  exactKeys(publicVerification, ['startedAt', 'origin', 'mode', 'manifestSha256', 'product', 'status', 'responses', 'envelope', 'completedAt'], 'public verification report');
  if (publicVerification.origin !== PUBLIC_ORIGIN || publicVerification.mode !== 'final' || publicVerification.status !== 'passed' ||
      publicVerification.manifestSha256 !== hash(manifestBytes) || !isDeepStrictEqual(publicVerification.product, manifest.product) ||
      !isDeepStrictEqual(publicVerification.envelope, envelope) || !canonicalTimestamp(publicVerification.startedAt) ||
      !canonicalTimestamp(publicVerification.completedAt) || Date.parse(publicVerification.startedAt) < Date.parse(envelope.deployedAt) ||
      Date.parse(publicVerification.completedAt) < Date.parse(publicVerification.startedAt) || !Array.isArray(publicVerification.responses)) {
    fail('public verification does not prove the final original artifact.');
  }
  const expectedRows = new Set([...listedFiles, './']);
  if (publicVerification.responses.length !== expectedRows.size) fail('public verification has an incomplete or duplicate root/asset inventory.');
  const seenRows = new Set();
  for (const response of publicVerification.responses) {
    record(response, 'public response');
    const file = response.file;
    if (typeof file !== 'string' || !expectedRows.has(file) || seenRows.has(file)) fail('public verification has an unexpected or duplicate response.');
    seenRows.add(file);
    const expected = file === './' ? files['index.html'] : files[file];
    let url;
    try {
      if (typeof response.url !== 'string') fail('public verification contains an invalid response URL.');
      url = new URL(response.url);
    } catch { fail('public verification contains an invalid response URL.'); }
    const expectedPath = file === './' ? '/' : '/' + file;
    if (response.status !== 200 || !isSha256(response.sha256) || response.sha256 !== expected.sha256 ||
        response.bytes !== expected.bytes || url.origin !== BETA_ORIGIN || url.pathname !== expectedPath ||
        url.username || url.password || url.hash) fail('public response does not match the exact successful original bytes: ' + file);
    const headers = record(response.headers, 'public response headers');
    const cacheControl = headers['cache-control'];
    if (typeof cacheControl !== 'string') fail('public response must retain its observed Cache-Control header.');
    if ((file === './' || file === 'index.html' || file === 'sw.js') && !/(?:^|,)\s*no-cache(?:,|$)/i.test(cacheControl || '')) {
      fail('public root, document, and worker must revalidate.');
    }
    if (file === 'channel-release.json' && !/no-store/i.test(cacheControl || '')) fail('public channel metadata must not be cached.');
  }
  if (!isDeepStrictEqual(seenRows, expectedRows)) fail('public verification is missing a root or asset response.');

  return {
    schemaVersion: 1,
    channel: 'beta',
    origin: BETA_ORIGIN,
    basePath: '/',
    noticeId: NOTICE_ID,
    originalProduct: manifest.product,
    originalDeployedAt: envelope.deployedAt,
    originalStartsAt: originalNotice.startsAt,
    evidence: {
      artifactSha256: manifest.artifactSha256,
      publicationSha256: hash(fs.readFileSync(publicationPath)),
      publicVerificationSha256: hash(fs.readFileSync(publicVerificationPath)),
    },
  };
}

const args = process.argv.slice(3);
if (process.argv[2] !== 'prepare-beta') throw new Error('Command: prepare-beta (local staging only).');
const required = ['--source', '--tree', '--output', '--deployed-at', '--notice-starts-at'];
const values = new Map();
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  if (values.has(name)) throw new Error('Duplicate option: ' + name);
  if (name === '--preview') values.set(name, true);
  else {
    if (![...required, '--continue-notice'].includes(name) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Unknown option or missing value: ' + name);
    values.set(name, args[++i]);
  }
}
for (const name of required) if (!values.has(name)) throw new Error('Required option: ' + name);
const option = name => values.get(name);
for (const name of ['--deployed-at', '--notice-starts-at']) {
  const value = option(name);
  if (!canonicalTimestamp(value)) {
    throw new Error('Explicit canonical ISO timestamp required: ' + name);
  }
}
const continuation = values.has('--continue-notice')
  ? validateContinuation(process.cwd(), option('--continue-notice'), option('--notice-starts-at'), option('--deployed-at'))
  : null;
if (!continuation && Date.parse(option('--notice-starts-at')) < Date.parse(option('--deployed-at'))) {
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
  const notice = { startsAt: option('--notice-starts-at') };
  if (continuation) notice.continuation = continuation;
  const envelope = { schemaVersion: 1, channel: 'beta', origin: BETA_ORIGIN, basePath: '/',
    product: { sourceRevision: source, tree, appFingerprint },
    deployedAt: option('--deployed-at'), notices: { [NOTICE_ID]: notice } };
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
