import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { recordReleaseEvidence } from '../release-evidence.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const command = path.join(repo, 'scripts/channel-release.mjs');
const instant = '2026-10-19T16:00:00.000Z';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chain-beta-package-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = '01b95ef42414d6ba7817ff9c5ebac6e3be3d6350';
  const tree = git(repo, 'rev-parse', source + '^{tree}');
  return { root, source, tree, output: path.join(root, 'artifact') };
}

function prepare(f, extra = [], preview = true) {
  return spawnSync(process.execPath, [command, 'prepare-beta', '--source', f.source,
    '--tree', f.tree, '--output', f.output, '--deployed-at', f.deployedAt ?? instant,
    '--notice-starts-at', f.startsAt ?? instant, ...(preview ? ['--preview'] : []), ...extra], { cwd: f.repository || repo, encoding: 'utf8' });
}

function editableFixture(t, edit) {
  const f = fixture(t);
  const repository = path.join(f.root, 'source');
  fs.mkdirSync(repository);
  execFileSync('tar', ['-x', '-C', repository], { input: execFileSync('git', ['archive', f.source], { cwd: repo, maxBuffer: 32 * 1024 * 1024 }) });
  git(repository, 'init', '-b', 'fixture');
  git(repository, 'config', 'user.email', 'beta-fixture@example.invalid');
  git(repository, 'config', 'user.name', 'Beta fixture');
  edit(repository);
  git(repository, 'add', '.');
  git(repository, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'isolated packaging fixture');
  const source = git(repository, 'rev-parse', 'HEAD');
  return { ...f, repository, source, tree: git(repository, 'rev-parse', source + '^{tree}') };
}

function reviewedFixture(t) {
  const f = editableFixture(t, () => {});
  const base = f.source;
  fs.writeFileSync(path.join(f.repository, 'fixture-doc.md'), 'Documentation-only disposable release receipt fixture.\n');
  git(f.repository, 'add', 'fixture-doc.md');
  git(f.repository, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture docs');
  f.source = git(f.repository, 'rev-parse', 'HEAD');
  f.tree = git(f.repository, 'rev-parse', 'HEAD^{tree}');
  const report = path.join(f.root, 'fixture-review.md');
  fs.writeFileSync(report, 'Disposable fixture report for the real receipt verifier; not product release approval.\n');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  recordReleaseEvidence(f.repository, { schemaVersion: 2,
    candidate: { commitSha: f.source, treeSha: f.tree, baseSha: base },
    ownerReview: { task: '/fixture/beta-owner', outcome: 'approved', reviewedSha: f.source, completedAt: '2026-10-19T15:00:00.000Z',
      summary: 'Disposable documentation-only fixture exercises the existing receipt verifier.',
      scope: { fullDiff: true, rationale: 'This isolated source adds only documentation and preserves every product byte.' },
      evidencePath: report, evidenceSha256: digest(fs.readFileSync(report)) } });
  return f;
}

test('Beta packaging command preserves committed product bytes and binds additive preview identity', t => {
  const f = fixture(t);
  const result = prepare(f);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(path.join(f.output, 'public/index.html')),
    execFileSync('git', ['show', f.source + ':index.html'], { cwd: repo }), 'real archive retains committed bytes');
  const metadata = path.join(f.output, 'public/channel-release.json');
  assert.equal(fs.existsSync(metadata), true, 'staged Beta must include channel identity beside unchanged product bytes');
  const envelope = JSON.parse(fs.readFileSync(metadata));
  assert.deepEqual(envelope, { schemaVersion: 1, channel: 'beta', origin: 'https://chain-scanner.web.app', basePath: '/',
    product: { sourceRevision: f.source, tree: f.tree, appFingerprint: 'd5fd2ab1996908745bcc8d745b5a292fe7029e9c3c71ce8d2f0d0d4b81ced483' },
    deployedAt: instant, notices: { 'sync-stability-2026-10': { startsAt: instant } } });
});

test('Beta packaging rejects an inconsistent notice window before reserving a publishable artifact', t => {
  const f = reviewedFixture(t),startsAt='2026-10-19T15:59:59.999Z';
  const result = prepare({ ...f, deployedAt: instant, startsAt }, [], false);
  const artifactPath = path.join(f.output, 'artifact.json');
  const artifact = fs.existsSync(artifactPath) ? JSON.parse(fs.readFileSync(artifactPath, 'utf8')) : null;
  assert.notEqual(result.status, 0,
    `startsAt before deployedAt must be rejected (status=${result.status}, publishable=${artifact?.publishable}, outputReserved=${fs.existsSync(f.output)})`);
  assert.match(result.stderr, /notice start.*deployment|notice.*deployedAt/i);
  assert.equal(fs.existsSync(f.output), false, 'invalid notice order is rejected before output reservation');
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['fixture-review.md','source'], 'the receipt report remains while no candidate output is created');
});

test('Beta packaging accepts equal and later notice starts for a reviewed artifact', t => {
  const f = reviewedFixture(t);
  for (const [name,startsAt] of [['equal',instant],['later','2026-10-19T16:01:00.000Z']]) {
    const output = path.join(f.root, name),result = prepare({ ...f, output, deployedAt: instant, startsAt }, [], false);
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(fs.readFileSync(path.join(output, 'public/channel-release.json'), 'utf8'));
    const artifact = JSON.parse(fs.readFileSync(path.join(output, 'artifact.json'), 'utf8'));
    assert.equal(envelope.deployedAt, instant);
    assert.equal(envelope.notices['sync-stability-2026-10'].startsAt, startsAt);
    assert.equal(artifact.publishable, true);
  }
});

test('Beta packaging rejects mismatched source tree before creating an artifact', t => {
  const f = fixture(t);
  const result = prepare({ ...f, tree: '0'.repeat(40) });
  assert.notEqual(result.status, 0, 'a changed candidate tree must be refused');
  assert.match(result.stderr, /source tree/i);
  assert.equal(fs.existsSync(f.output), false, 'failed staging leaves no candidate artifact');
  assert.deepEqual(fs.readdirSync(f.root), [], 'neighbor directory is untouched');
});

test('Beta packaging refuses an existing output without changing it or neighbors', t => {
  const f = fixture(t);
  fs.mkdirSync(f.output);
  fs.writeFileSync(path.join(f.output, 'protected'), 'keep existing artifact');
  fs.writeFileSync(path.join(f.root, 'neighbor'), 'keep neighbor');
  const result = prepare(f);
  assert.notEqual(result.status, 0, 'existing staging destination must never be reused');
  assert.match(result.stderr, /exist/i);
  assert.deepEqual(fs.readdirSync(f.output), ['protected']);
  assert.equal(fs.readFileSync(path.join(f.output, 'protected'), 'utf8'), 'keep existing artifact');
  assert.equal(fs.readFileSync(path.join(f.root, 'neighbor'), 'utf8'), 'keep neighbor');
});

test('Beta packaging requires existing exact-source release evidence unless explicitly previewing', t => {
  const f = fixture(t);
  const result = prepare(f, [], false);
  assert.notEqual(result.status, 0, 'default preparation must refuse an unreviewed exact source');
  assert.match(result.stderr, /release receipt|release evidence/i);
  assert.equal(fs.existsSync(f.output), false);
});

test('Beta packaging labels preview nonpublishable and stages Hosting-only configuration with an explicit asset inventory', t => {
  const f = fixture(t);
  const result = prepare(f);
  assert.equal(result.status, 0, result.stderr);
  const manifestPath = path.join(f.output, 'artifact.json');
  assert.equal(fs.existsSync(manifestPath), true, 'preview must carry a machine-readable nonpublishable artifact manifest');
  const artifact = JSON.parse(fs.readFileSync(manifestPath));
  assert.equal(artifact.mode, 'preview');
  assert.equal(artifact.publishable, false);
  assert.match(artifact.status, /UNREVIEWED.*NOT FOR PUBLICATION/);
  assert.deepEqual(artifact.product, JSON.parse(fs.readFileSync(path.join(f.output, 'public/channel-release.json'))).product);
  assert.ok(artifact.files['index.html'].sha256.match(/^[a-f0-9]{64}$/));
  assert.equal(fs.existsSync(path.join(f.output, 'public/tests.js')), false);
  assert.equal(fs.existsSync(path.join(f.output, 'public/scripts')), false);
  const config = JSON.parse(fs.readFileSync(path.join(f.output, 'firebase.json')));
  assert.deepEqual(Object.keys(config), ['hosting']);
  assert.equal(config.hosting.site, 'chain-scanner');
  assert.equal(config.hosting.public, 'public');
  assert.deepEqual(config.hosting.headers.find(h => h.source === '/channel-release.json').headers,
    [{ key: 'Cache-Control', value: 'no-store, max-age=0' }]);
  assert.match(result.stderr, /UNREVIEWED.*NOT FOR PUBLICATION/);
});

test('Beta packaging revalidates root and named document and worker routes for reviewed and preview artifacts', async t => {
  for (const preview of [true, false]) await t.test(preview ? 'preview' : 'reviewed', t => {
    const f = preview ? fixture(t) : reviewedFixture(t);
    const result = prepare(f, [], preview);
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(fs.readFileSync(path.join(f.output, 'firebase.json')));
    for (const source of ['/', '/index.html', '/sw.js']) {
      const headers = config.hosting.headers.find(h => h.source === source)?.headers;
      assert.deepEqual(headers, [{ key: 'Cache-Control', value: 'no-cache' }],
        source + ' must revalidate at its initial request URL, including the root entry URL');
    }
    assert.deepEqual(config.hosting.headers.find(h => h.source === '/channel-release.json').headers,
      [{ key: 'Cache-Control', value: 'no-store, max-age=0' }], 'metadata keeps its stricter freshness policy');
    assert.deepEqual(fs.readFileSync(path.join(f.output, 'public/index.html')),
      execFileSync('git', ['show', f.source + ':index.html'], { cwd: f.repository || repo }),
      'delivery headers do not alter the exact reviewed product bytes');
  });
});

test('Beta packaging rejects stale product fingerprint before staging changed committed product bytes', t => {
  const f = editableFixture(t, root => fs.appendFileSync(path.join(root, 'index.html'), '\n<!-- changed without refreshed product identity -->\n'));
  const result = prepare(f);
  assert.notEqual(result.status, 0, 'a committed source with stale product fingerprint must be refused');
  assert.match(result.stderr, /fingerprint|shell identity/i);
  assert.equal(fs.existsSync(f.output), false);
  assert.match(fs.readFileSync(path.join(f.repository, 'index.html'), 'utf8'), /changed without refreshed/);
});

test('Beta packaging rejects committed symlinks before archive extraction and keeps the target untouched', t => {
  const f = editableFixture(t, root => fs.symlinkSync('../protected-neighbor', path.join(root, 'escape')));
  fs.writeFileSync(path.join(f.root, 'protected-neighbor'), 'exact protected bytes');
  const result = prepare(f);
  assert.notEqual(result.status, 0, 'committed symlink must be refused even outside public allowlist');
  assert.match(result.stderr, /symlink|special|regular/i);
  assert.equal(fs.existsSync(f.output), false);
  assert.equal(fs.readFileSync(path.join(f.root, 'protected-neighbor'), 'utf8'), 'exact protected bytes');
});

test('Beta packaging rejects a committed channel-envelope collision instead of masking it', t => {
  const f = editableFixture(t, root => fs.writeFileSync(path.join(root, 'channel-release.json'), '{"channel":"stable"}\n'));
  const result = prepare(f);
  assert.notEqual(result.status, 0, 'pre-existing channel envelope in source must be refused');
  assert.match(result.stderr, /collision|channel-release/i);
  assert.equal(fs.existsSync(f.output), false);
  assert.equal(fs.readFileSync(path.join(f.repository, 'channel-release.json'), 'utf8'), '{"channel":"stable"}\n');
});

test('Beta packaging refuses invalid explicit timestamps and ambiguous arguments without staging', t => {
  const f = fixture(t);
  for (const candidate of [{ ...f, deployedAt: 'yesterday' }, { ...f, startsAt: '2026-02-30T12:00:00.000Z' }]) {
    const result = prepare(candidate);
    assert.notEqual(result.status, 0, 'invalid envelope time must be refused');
    assert.match(result.stderr, /ISO|timestamp/i);
    assert.equal(fs.existsSync(f.output), false);
  }
  const duplicate = prepare(f, ['--source', f.source]);
  assert.notEqual(duplicate.status, 0, 'duplicate option cannot silently select a different candidate');
  assert.match(duplicate.stderr, /duplicate/i);
  assert.equal(fs.existsSync(f.output), false);
});

test('Beta packaging refuses symlinked or traversal staging parents without touching their targets', t => {
  const f = fixture(t);
  const real = path.join(f.root, 'real');
  fs.mkdirSync(real);
  fs.symlinkSync(real, path.join(f.root, 'alias'));
  fs.writeFileSync(path.join(real, 'neighbor'), 'protected neighbor');
  for (const output of [path.join(f.root, 'alias', 'artifact'), real + '/../artifact']) {
    const result = prepare({ ...f, output });
    assert.notEqual(result.status, 0, 'ambiguous staging parent must be refused');
    assert.match(result.stderr, /canonical|symlink|traversal/i);
  }
  assert.deepEqual(fs.readdirSync(real), ['neighbor']);
  assert.equal(fs.readFileSync(path.join(real, 'neighbor'), 'utf8'), 'protected neighbor');
});

test('Beta packaging exposes final public bytes only when the complete artifact is ready', async t => {
  const f = fixture(t);
  const bin = path.join(f.root, 'bin');
  const marker = path.join(f.root, 'archive-started');
  fs.mkdirSync(bin);
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  // Delay only the external Git archive process, then run the real committed archive.
  fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\nimport fs from 'node:fs';import{spawnSync}from'node:child_process';if(process.argv[2]==='archive'){fs.writeFileSync(${JSON.stringify(marker)},'started');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);}const r=spawnSync(${JSON.stringify(realGit)},process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);\n`, { mode: 0o755 });
  const child = spawn(process.execPath, [command, 'prepare-beta', '--source', f.source, '--tree', f.tree,
    '--output', f.output, '--deployed-at', instant, '--notice-starts-at', instant, '--preview'],
    { cwd: repo, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH }, stdio: 'ignore' });
  const finished = new Promise(resolve => child.on('close', resolve));
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  const end = Date.now() + 10000;
  while (!fs.existsSync(marker) && child.exitCode === null && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(fs.existsSync(marker), true, 'real archive consumer reached');
  const publicVisibleDuringArchive = fs.existsSync(path.join(f.output, 'public'));
  const exit = await finished;
  assert.equal(exit, 0);
  assert.equal(publicVisibleDuringArchive, false, 'partial public directory must not appear at the final output path');
  assert.equal(fs.existsSync(path.join(f.output, 'artifact.json')), true);
});

test('Beta packaging binds reviewed preparation to the real existing validator receipt for that exact source', t => {
  const f = editableFixture(t, () => {});
  const base = f.source;
  fs.writeFileSync(path.join(f.repository, 'fixture-doc.md'), 'Documentation-only disposable release receipt fixture.\n');
  git(f.repository, 'add', 'fixture-doc.md');
  git(f.repository, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture docs');
  f.source = git(f.repository, 'rev-parse', 'HEAD');
  f.tree = git(f.repository, 'rev-parse', 'HEAD^{tree}');
  const report = path.join(f.root, 'fixture-review.md');
  fs.writeFileSync(report, 'Disposable fixture report for testing the real validator; not a human review of a product release.\n');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const receipt = recordReleaseEvidence(f.repository, { schemaVersion: 2,
    candidate: { commitSha: f.source, treeSha: f.tree, baseSha: base },
    ownerReview: { task: '/fixture/beta-owner', outcome: 'approved', reviewedSha: f.source, completedAt: '2026-10-19T15:00:00.000Z',
      summary: 'Disposable documentation-only fixture exercises the existing receipt verifier.',
      scope: { fullDiff: true, rationale: 'This disposable fixture changes only documentation and preserves all product bytes.' },
      evidencePath: report, evidenceSha256: digest(fs.readFileSync(report)) } });
  const result = prepare(f, [], false);
  assert.equal(result.status, 0, result.stderr);
  const artifact = JSON.parse(fs.readFileSync(path.join(f.output, 'artifact.json')));
  assert.equal(artifact.mode, 'reviewed');
  assert.equal(artifact.releaseEvidence?.receiptSha256, digest(fs.readFileSync(receipt.receiptPath)), 'reviewed artifact must retain the exact verified receipt digest');
  assert.deepEqual(artifact.releaseEvidence.candidate, { commitSha: f.source, treeSha: f.tree, baseSha: base });
  assert.equal(artifact.publication, 'not-attempted');
});

test('Beta packaging refuses a bare Git tree as a claimed product source revision', t => {
  const f = fixture(t);
  const result = prepare({ ...f, source: f.tree });
  assert.notEqual(result.status, 0, 'product source revision must identify an actual commit');
  assert.equal(fs.existsSync(f.output), false);
});

test('Beta packaging removes its empty destination reservation when staging setup fails', t => {
  const f = fixture(t);
  f.output = path.join(f.root, 'a'.repeat(245));
  const result = prepare(f);
  assert.notEqual(result.status, 0, 'fixture reaches the filesystem staging-name limit');
  assert.equal(fs.existsSync(f.output), false, 'failed private staging setup must remove its own empty reservation');
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('Beta packaging archives committed bytes despite dirty local files and ignores untracked credential-shaped files', t => {
  const f = editableFixture(t, () => {});
  fs.appendFileSync(path.join(f.repository, 'index.html'), '\n<!-- dirty local work must stay local -->\n');
  fs.writeFileSync(path.join(f.repository, 'credentials.json'), '{"synthetic":"not a real credential"}\n');
  const result = prepare(f);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(fs.readFileSync(path.join(f.output, 'public/index.html'), 'utf8'), /dirty local work/);
  assert.equal(fs.existsSync(path.join(f.output, 'public/credentials.json')), false);
  assert.match(fs.readFileSync(path.join(f.repository, 'index.html'), 'utf8'), /dirty local work/);
  assert.equal(fs.existsSync(path.join(f.repository, 'credentials.json')), true);
});

test('Beta packaging cleans incomplete archive failures while retaining source and neighboring files', t => {
  const f = editableFixture(t, root => fs.writeFileSync(path.join(root, '.gitattributes'), 'icon.svg export-ignore\n'));
  fs.writeFileSync(path.join(f.root, 'neighbor'), 'retained');
  const result = prepare(f);
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(f.output), false);
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['neighbor', 'source']);
  assert.equal(fs.readFileSync(path.join(f.root, 'neighbor'), 'utf8'), 'retained');
  assert.equal(fs.existsSync(path.join(f.repository, 'icon.svg')), true);
});

test('Beta packaging refuses traversal in the committed worker inventory before staging', t => {
  const f = editableFixture(t, root => {
    const file = path.join(root, 'sw.js');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"./icon.svg"', '"../protected-neighbor"'));
  });
  const result = prepare(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsafe shell asset path/);
  assert.equal(fs.existsSync(f.output), false);
});

test('Beta packaging refuses unsafe tab-bearing committed paths even outside the public inventory', t => {
  const f = editableFixture(t, root => fs.writeFileSync(path.join(root, 'outside\tunsafe'), 'synthetic source'));
  const result = prepare(f);
  assert.notEqual(result.status, 0, 'tree parsing must inspect the complete committed path');
  assert.match(result.stderr, /safe regular/i);
  assert.equal(fs.existsSync(f.output), false);
});

test('Beta packaging continues the original notice after a later deployment when retained proof is valid', async t => {
  const f = reviewedFixture(t);
  const originalOutput = path.join(f.root, 'original-reviewed');
  const originalDeployedAt = '2026-10-19T16:00:00.000Z';
  const originalStartsAt = '2026-10-19T16:00:00.000Z';
  const original = prepare({ ...f, output: originalOutput, deployedAt: originalDeployedAt, startsAt: originalStartsAt }, [], false);
  assert.equal(original.status, 0, original.stderr);

  const manifestPath = path.join(originalOutput, 'artifact.json');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  const originalEnvelope = JSON.parse(fs.readFileSync(path.join(originalOutput, 'public/channel-release.json'), 'utf8'));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const publicationPath = path.join(f.root, 'provider-release.json');
  const publication = {
    project: 'chain-scanner', site: 'chain-scanner', channel: 'live',
    channelName: 'projects/chain-scanner/sites/chain-scanner/channels/live',
    url: 'https://chain-scanner.web.app',
    release: {
      name: 'projects/chain-scanner/sites/chain-scanner/channels/live/releases/123456',
      versionName: 'projects/chain-scanner/sites/chain-scanner/versions/abcdef0123456789',
      type: 'DEPLOY', message: 'fixture-original-product', releaseTime: originalDeployedAt,
    },
    canonicalProductPublicationTime: originalDeployedAt,
    observedAt: '2026-10-19T16:00:02.000Z',
  };
  fs.writeFileSync(publicationPath, JSON.stringify(publication, null, 2) + '\n');

  const origin = 'https://chain-scanner.web.app/';
  const responses = Object.entries(manifest.files).map(([file, identity]) => {
    const url = new URL(file, origin);
    url.searchParams.set('verify', 'fixture');
    return { file, url: url.href, status: 200, sha256: identity.sha256, bytes: identity.bytes,
      headers: { 'cache-control': file === 'index.html' || file === 'sw.js' ? 'no-cache' :
        file === 'channel-release.json' ? 'no-store, max-age=0' : 'max-age=3600' } };
  });
  const rootUrl = new URL('./', origin);
  rootUrl.searchParams.set('verify', 'fixture');
  const index = manifest.files['index.html'];
  responses.push({ file: './', url: rootUrl.href, status: 200, sha256: index.sha256, bytes: index.bytes,
    headers: { 'cache-control': 'no-cache' } });
  const publicVerificationPath = path.join(f.root, 'public-verification.json');
  const publicVerification = {
    startedAt: '2026-10-19T16:00:03.000Z', origin, mode: 'final',
    manifestSha256: digest(manifestBytes), product: manifest.product, status: 'passed',
    responses, envelope: originalEnvelope, completedAt: '2026-10-19T16:00:04.000Z',
  };
  fs.writeFileSync(publicVerificationPath, JSON.stringify(publicVerification, null, 2) + '\n');

  const proofPath = path.join(f.root, 'continuation-proof.json');
  fs.writeFileSync(proofPath, JSON.stringify({
    artifactDirectory: originalOutput,
    publicationPath,
    publicVerificationPath,
  }, null, 2) + '\n');

  fs.appendFileSync(path.join(f.repository, 'fixture-doc.md'), 'Follow-up candidate after the original notice.\n');
  git(f.repository, 'add', 'fixture-doc.md');
  git(f.repository, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture later product build');
  const source = git(f.repository, 'rev-parse', 'HEAD');
  const tree = git(f.repository, 'rev-parse', 'HEAD^{tree}');
  const deployedAt = '2026-10-20T21:00:00.000Z';
  const output = path.join(f.root, 'continued-preview');
  const result = prepare({ ...f, source, tree, output, deployedAt, startsAt: originalStartsAt }, ['--continue-notice', proofPath]);

  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(fs.readFileSync(path.join(output, 'public/channel-release.json'), 'utf8'));
  const artifact = JSON.parse(fs.readFileSync(path.join(output, 'artifact.json'), 'utf8'));
  assert.equal(envelope.deployedAt, deployedAt, 'the later product publication time belongs to the new build');
  assert.equal(envelope.notices['sync-stability-2026-10'].startsAt, originalStartsAt,
    'a later product build keeps the existing notice start');
  assert.notEqual(envelope.product.sourceRevision, manifest.product.sourceRevision,
    'the continuation is attached to the later source candidate');
  assert.deepEqual(envelope.notices['sync-stability-2026-10'].continuation, {
    schemaVersion: 1, channel: 'beta', origin: 'https://chain-scanner.web.app', basePath: '/',
    noticeId: 'sync-stability-2026-10', originalProduct: manifest.product,
    originalDeployedAt, originalStartsAt,
    evidence: {
      artifactSha256: manifest.artifactSha256,
      publicationSha256: digest(fs.readFileSync(publicationPath)),
      publicVerificationSha256: digest(fs.readFileSync(publicVerificationPath)),
    },
  }, 'public continuation retains the reviewed origin proof without local paths');
  assert.equal(artifact.mode, 'preview');
  assert.equal(artifact.publishable, false, 'proof validation does not turn a preview into a publishable artifact');

  fs.writeFileSync(proofPath, JSON.stringify({
    artifactDirectory: originalOutput,
    publicationPath,
    publicVerificationPath,
    unexpected: true,
  }, null, 2) + '\n');
  const malformedOutput = path.join(f.root, 'malformed-continuation-preview');
  const malformed = prepare({ ...f, source, tree, output: malformedOutput, deployedAt, startsAt: originalStartsAt }, ['--continue-notice', proofPath]);
  assert.notEqual(malformed.status, 0, 'supplied malformed proof must fail closed even though startsAt predates deployedAt');
  assert.match(malformed.stderr, /bundle has an invalid shape/i);
  assert.equal(fs.existsSync(malformedOutput), false, 'malformed proof must fail before reserving output');

  await t.test('rejects mutated retained evidence before output reservation without changing originals or neighbors', t => {
    const envelopePath = path.join(originalOutput, 'public/channel-release.json');
    const configPath = path.join(originalOutput, 'firebase.json');
    const sourceDocumentPath = path.join(f.repository, 'fixture-doc.md');
    const reviewPath = path.join(f.root, 'fixture-review.md');
    const neighborPath = path.join(f.root, 'protected-neighbor.txt');
    fs.writeFileSync(proofPath, JSON.stringify({ artifactDirectory: originalOutput, publicationPath, publicVerificationPath }, null, 2) + '\n');
    fs.writeFileSync(neighborPath, 'protected neighboring bytes\n');

    const snapshotDirectory = directory => {
      const files = new Map();
      const visit = (current, prefix = '') => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const relative = prefix ? prefix + '/' + entry.name : entry.name;
          const absolute = path.join(current, entry.name);
          if (entry.isDirectory()) visit(absolute, relative);
          else {
            assert.equal(entry.isFile(), true, 'fixture snapshots contain only regular files');
            files.set(relative, fs.readFileSync(absolute));
          }
        }
      };
      visit(directory);
      return files;
    };
    const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
    const filePaths = [manifestPath, envelopePath, configPath, publicationPath, publicVerificationPath,
      proofPath, sourceDocumentPath, reviewPath, neighborPath];
    const protectedBytes = new Map(filePaths.map(file => [file, fs.readFileSync(file)]));
    const artifactSnapshot = snapshotDirectory(originalOutput);
    const previewSnapshot = snapshotDirectory(output);
    const rootEntries = fs.readdirSync(f.root).sort();

    const reject = ({ name, mutatedPaths = [], mutate = () => {}, startsAt = originalStartsAt,
      deployedAt: attemptDeployedAt = deployedAt, expected }) => {
      const saved = new Map(mutatedPaths.map(file => [file, fs.readFileSync(file)]));
      const rejectedOutput = path.join(f.root, 'rejected-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
      assert.equal(fs.existsSync(rejectedOutput), false, name + ' output path starts absent');
      let rejected;
      try {
        mutate();
        rejected = prepare({ ...f, source, tree, output: rejectedOutput, deployedAt: attemptDeployedAt, startsAt }, ['--continue-notice', proofPath]);
      } finally {
        for (const [file, bytes] of saved) fs.writeFileSync(file, bytes);
      }
      assert.notEqual(rejected.status, 0, name + ' must be rejected by the real CLI');
      assert.match(rejected.stderr, expected, name + ' must fail at its intended proof guard');
      assert.equal(fs.existsSync(rejectedOutput), false, name + ' must fail before output reservation');
      for (const [file, bytes] of protectedBytes) assert.deepEqual(fs.readFileSync(file), bytes, name + ' leaves ' + path.basename(file) + ' unchanged');
      assert.deepEqual(snapshotDirectory(originalOutput), artifactSnapshot, name + ' leaves the full original artifact unchanged');
      assert.deepEqual(snapshotDirectory(output), previewSnapshot, name + ' leaves the valid preview unchanged');
      assert.deepEqual(fs.readdirSync(f.root).sort(), rootEntries, name + ' leaves neighboring entries unchanged');
    };

    reject({ name: 'artifact-digest', mutatedPaths: [manifestPath], expected: /original artifact digest is invalid/i,
      mutate: () => { const value = JSON.parse(fs.readFileSync(manifestPath)); value.artifactSha256 = '0'.repeat(64); writeJson(manifestPath, value); } });
    reject({ name: 'nonpublishable-artifact', mutatedPaths: [manifestPath], expected: /original artifact must be reviewed, publishable/i,
      mutate: () => {
        const value = JSON.parse(fs.readFileSync(manifestPath));
        value.publishable = false;
        const payload = { ...value };
        delete payload.artifactSha256;
        value.artifactSha256 = digest(Buffer.from(JSON.stringify(payload)));
        writeJson(manifestPath, value);
      } });
    reject({ name: 'provider-project', mutatedPaths: [publicationPath], expected: /provider release record names the wrong project/i,
      mutate: () => { const value = JSON.parse(fs.readFileSync(publicationPath)); value.project = 'wrong-project'; writeJson(publicationPath, value); } });
    reject({ name: 'provider-time', mutatedPaths: [publicationPath], expected: /provider release time or resource identity/i,
      mutate: () => { const value = JSON.parse(fs.readFileSync(publicationPath)); value.release.releaseTime = '2026-10-19T16:00:01.000Z'; writeJson(publicationPath, value); } });
    reject({ name: 'provider-canonical-product-time', mutatedPaths: [publicationPath], expected: /provider release time or resource identity/i,
      mutate: () => { const value = JSON.parse(fs.readFileSync(publicationPath)); value.canonicalProductPublicationTime = '2026-10-19T16:00:01.000Z'; writeJson(publicationPath, value); } });
    reject({ name: 'report-manifest-hash', mutatedPaths: [publicVerificationPath], expected: /public verification does not prove/i,
      mutate: () => { const value = JSON.parse(fs.readFileSync(publicVerificationPath)); value.manifestSha256 = '0'.repeat(64); writeJson(publicVerificationPath, value); } });
    reject({ name: 'report-incomplete-inventory', mutatedPaths: [publicVerificationPath], expected: /incomplete or duplicate root\/asset inventory/i,
      mutate: () => { const value = JSON.parse(fs.readFileSync(publicVerificationPath)); value.responses.pop(); writeJson(publicVerificationPath, value); } });
    reject({ name: 'report-duplicate-inventory', mutatedPaths: [publicVerificationPath], expected: /unexpected or duplicate response/i,
      mutate: () => {
        const value = JSON.parse(fs.readFileSync(publicVerificationPath));
        value.responses[value.responses.length - 1] = { ...value.responses[0] };
        writeJson(publicVerificationPath, value);
      } });
    reject({ name: 'retained-start-mismatch', expected: /original notice dates do not continue/i, startsAt: '2026-10-19T16:00:01.000Z' });
    reject({ name: 'earlier-new-deployment', expected: /original notice dates do not continue/i, deployedAt: '2026-10-19T15:59:00.000Z' });
    reject({ name: 'recursive-original-continuation', mutatedPaths: [manifestPath, envelopePath, publicVerificationPath],
      expected: /original notice has an invalid shape/i,
      mutate: () => {
        const value = JSON.parse(fs.readFileSync(envelopePath));
        value.notices['sync-stability-2026-10'].continuation = {
          schemaVersion: 1, channel: 'beta', origin: 'https://chain-scanner.web.app', basePath: '/',
          noticeId: 'sync-stability-2026-10', originalProduct: manifest.product,
          originalDeployedAt, originalStartsAt,
          evidence: { artifactSha256: manifest.artifactSha256, publicationSha256: digest(fs.readFileSync(publicationPath)),
            publicVerificationSha256: digest(fs.readFileSync(publicVerificationPath)) },
        };
        const envelopeBytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
        fs.writeFileSync(envelopePath, envelopeBytes);
        const changedManifest = JSON.parse(fs.readFileSync(manifestPath));
        changedManifest.files['channel-release.json'] = { sha256: digest(envelopeBytes), bytes: envelopeBytes.length };
        const payload = { ...changedManifest };
        delete payload.artifactSha256;
        changedManifest.artifactSha256 = digest(Buffer.from(JSON.stringify(payload)));
        const manifestBytes = Buffer.from(JSON.stringify(changedManifest, null, 2) + '\n');
        fs.writeFileSync(manifestPath, manifestBytes);
        const report = JSON.parse(fs.readFileSync(publicVerificationPath));
        report.manifestSha256 = digest(manifestBytes);
        report.envelope = value;
        const metadataResponse = report.responses.find(response => response.file === 'channel-release.json');
        metadataResponse.sha256 = changedManifest.files['channel-release.json'].sha256;
        metadataResponse.bytes = changedManifest.files['channel-release.json'].bytes;
        writeJson(publicVerificationPath, report);
      } });
  });
});
