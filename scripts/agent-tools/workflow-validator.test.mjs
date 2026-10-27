import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { ACTIONLINT_VERSION, pinnedActionlintAsset, validateWorkflows } from './workflow-validator.mjs';

const repositoryRoot = process.cwd();
const validatorScript = resolve(repositoryRoot, 'scripts/agent-tools/workflow-validator.mjs');

function cachePaths(root) {
  const directory = join(root, 'node_modules', '.cache', 'funsidething', 'actionlint', `v${ACTIONLINT_VERSION}`, `${process.platform}-${process.arch}`);
  return { directory, executable: join(directory, 'actionlint'), manifest: join(directory, 'manifest.json') };
}

function validateInRoot(root, sourceDir) {
  const args = [validatorScript, 'validate'];
  if (sourceDir) args.push('--source-dir', sourceDir);
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
}

test('workflow validator command contracts are pinned and source-bound', async (t) => {
await t.test('workflow validator pin identifies official release archives and rejects unsupported platforms', () => {
  assert.equal(ACTIONLINT_VERSION, '1.7.12');
  assert.deepEqual(pinnedActionlintAsset('darwin', 'arm64'), {
    key: 'darwin-arm64',
    filename: 'actionlint_1.7.12_darwin_arm64.tar.gz',
    url: 'https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_darwin_arm64.tar.gz',
    sha256: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
    binarySha256: '8db11704dc296f096216db4db65d86cd7f0ebfdf4c38453a1da276b137b88388',
  });
  assert.match(pinnedActionlintAsset('linux', 'x64').sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => pinnedActionlintAsset('win32', 'x64'), /Supported platforms are darwin\/linux on x64\/arm64/);
});

await t.test('public workflow command fails closed for missing and corrupt setup, then accepts the restored pin', async (context) => {
  const sourceProbe = await validateWorkflows({ repositoryRoot, sourceDir: join(repositoryRoot, '.github', 'workflows') });
  if (sourceProbe.error?.includes('is not set up in this repository')) {
    context.skip('Run npm run agent:setup-workflow-validator before this pinned-tool integration test.');
    return;
  }
  assert.equal(sourceProbe.ok, true, sourceProbe.error ?? sourceProbe.diagnostics);

  const fixtureRoot = await mkdtemp(join(tmpdir(), 'workflow-validator-setup-test-'));
  try {
    const missingRoot = join(fixtureRoot, 'missing');
    await mkdir(missingRoot);
    const missing = validateInRoot(missingRoot);
    assert.equal(missing.error, undefined, missing.error?.message);
    assert.equal(missing.status, 2, `${missing.stdout}\n${missing.stderr}`);
    assert.match(missing.stderr, /Pinned actionlint v1\.7\.12 is not set up in this repository/);
    assert.match(missing.stderr, /npm run agent:setup-workflow-validator/);
    await assert.rejects(readFile(join(missingRoot, 'node_modules')), { code: 'ENOENT' });

    const corruptRoot = join(fixtureRoot, 'corrupt');
    const original = cachePaths(repositoryRoot);
    const corrupted = cachePaths(corruptRoot);
    await mkdir(corrupted.directory, { recursive: true });
    await Promise.all([
      copyFile(original.executable, corrupted.executable),
      copyFile(original.manifest, corrupted.manifest),
    ]);
    const corruptBytes = await readFile(corrupted.executable);
    corruptBytes[0] ^= 0xff;
    await writeFile(corrupted.executable, corruptBytes);
    const before = createHash('sha256').update(await readFile(corrupted.executable)).digest('hex');
    const corrupt = validateInRoot(corruptRoot);
    assert.equal(corrupt.error, undefined, corrupt.error?.message);
    assert.equal(corrupt.status, 2, `${corrupt.stdout}\n${corrupt.stderr}`);
    assert.match(corrupt.stderr, /setup is missing or invalid/);
    assert.match(corrupt.stderr, /npm run agent:setup-workflow-validator/);
    assert.equal(createHash('sha256').update(await readFile(corrupted.executable)).digest('hex'), before,
      'read-only validation must leave a corrupt cache untouched');

    const restoredRoot = join(fixtureRoot, 'restored');
    const restored = cachePaths(restoredRoot);
    const workflows = join(fixtureRoot, 'valid-workflows');
    await Promise.all([mkdir(restored.directory, { recursive: true }), mkdir(workflows)]);
    await Promise.all([
      copyFile(original.executable, restored.executable),
      copyFile(original.manifest, restored.manifest),
      writeFile(join(workflows, 'valid.yml'), 'name: restored setup\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ready\n'),
    ]);
    await chmod(restored.executable, 0o755);
    const valid = validateInRoot(restoredRoot, workflows);
    assert.equal(valid.error, undefined, valid.error?.message);
    assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);
    assert.match(valid.stdout, /Workflow validation passed: actionlint v1\.7\.12/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

await t.test('an edited manifest cannot authorize an arbitrary same-version executable', async (context) => {
  const sourceProbe = await validateWorkflows({ repositoryRoot, sourceDir: join(repositoryRoot, '.github', 'workflows') });
  if (sourceProbe.error?.includes('is not set up in this repository')) {
    context.skip('Run npm run agent:setup-workflow-validator before this pinned-tool integration test.');
    return;
  }
  assert.equal(sourceProbe.ok, true, sourceProbe.error ?? sourceProbe.diagnostics);

  const fixtureRoot = await mkdtemp(join(tmpdir(), 'workflow-validator-forged-pin-test-'));
  try {
    const cache = cachePaths(fixtureRoot);
    const workflows = join(fixtureRoot, 'workflows');
    await mkdir(cache.directory, { recursive: true });
    await mkdir(workflows);
    const fakeExecutable = Buffer.from('#!/bin/sh\nif [ "$1" = "-version" ]; then echo "actionlint 1.7.12"; exit 0; fi\nexit 0\n');
    await writeFile(cache.executable, fakeExecutable, { mode: 0o755 });
    await chmod(cache.executable, 0o755);
    const pinned = pinnedActionlintAsset();
    await writeFile(cache.manifest, `${JSON.stringify({
      schemaVersion: 1,
      version: ACTIONLINT_VERSION,
      platform: process.platform,
      arch: process.arch,
      archive: pinned.filename,
      archiveUrl: pinned.url,
      archiveSha256: pinned.sha256,
      executableSha256: createHash('sha256').update(fakeExecutable).digest('hex'),
    }, null, 2)}\n`);
    await writeFile(join(workflows, 'valid.yml'), 'name: fake validator\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo fake\n');

    const outcome = validateInRoot(fixtureRoot, workflows);
    assert.equal(outcome.error, undefined, outcome.error?.message);
    assert.equal(outcome.status, 2, `${outcome.stdout}\n${outcome.stderr}`);
    assert.match(outcome.stderr, /setup is missing or invalid/);
    assert.match(outcome.stderr, /repository pin|checksum|identity/i);
    assert.match(outcome.stderr, /npm run agent:setup-workflow-validator/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

await t.test('public workflow command runs pinned actionlint on invalid job and valid step runner contexts', async (context) => {
  const setupProbe = await validateWorkflows({
    repositoryRoot,
    sourceDir: join(repositoryRoot, '.github', 'workflows'),
  });
  if (setupProbe.error?.includes('is not set up in this repository')) {
    context.skip('Run npm run agent:setup-workflow-validator before this pinned-tool integration test.');
    return;
  }
  assert.equal(setupProbe.ok, true, setupProbe.error ?? setupProbe.diagnostics);

  const fixtureRoot = await mkdtemp(join(tmpdir(), 'workflow-validator-test-'));
  try {
    const invalidDirectory = join(fixtureRoot, 'invalid');
    const validDirectory = join(fixtureRoot, 'valid');
    await Promise.all([mkdir(invalidDirectory), mkdir(validDirectory)]);
    const invalidWorkflow = `name: invalid runner context\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    env:\n      PLAYWRIGHT_BROWSERS_PATH: \${{ runner.temp }}/playwright-browsers\n    steps:\n      - run: echo test\n`;
    const validWorkflow = `name: valid runner context\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Select browser cache\n        env:\n          PLAYWRIGHT_BROWSERS_PATH: \${{ runner.temp }}/playwright-browsers\n        run: echo test\n`;
    await Promise.all([
      writeFile(join(invalidDirectory, 'test.yml'), invalidWorkflow),
      writeFile(join(validDirectory, 'test.yml'), validWorkflow),
    ]);

    const invalidReceipt = join(fixtureRoot, 'invalid-receipt.json');
    const invalid = spawnSync(process.execPath, [
      validatorScript,
      'validate',
      '--source-dir', invalidDirectory,
      '--source-label', 'test fixture with job-level runner.temp',
      '--evidence-file', invalidReceipt,
    ], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    assert.equal(invalid.error, undefined, invalid.error?.message);
    assert.equal(invalid.status, 1, `${invalid.stdout}\n${invalid.stderr}`);
    assert.match(invalid.stderr, /context "runner" is not allowed here/);
    assert.match(invalid.stderr, /actionlint v1\.7\.12/);
    const invalidEvidence = JSON.parse(await readFile(invalidReceipt, 'utf8'));
    assert.equal(invalidEvidence.ok, false);
    assert.equal(invalidEvidence.validator.version, ACTIONLINT_VERSION);
    assert.equal(invalidEvidence.source.label, 'test fixture with job-level runner.temp');
    assert.match(invalidEvidence.source.workflowSetSha256, /^[a-f0-9]{64}$/);

    const validReceipt = join(fixtureRoot, 'valid-receipt.json');
    const valid = spawnSync(process.execPath, [
      validatorScript,
      'validate',
      '--source-dir', validDirectory,
      '--source-label', 'test fixture with step-level runner.temp',
      '--evidence-file', validReceipt,
    ], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    assert.equal(valid.error, undefined, valid.error?.message);
    assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);
    assert.match(valid.stdout, /Workflow validation passed: actionlint v1\.7\.12/);
    const validEvidence = JSON.parse(await readFile(validReceipt, 'utf8'));
    assert.equal(validEvidence.ok, true);
    assert.equal(validEvidence.source.label, 'test fixture with step-level runner.temp');
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
});
