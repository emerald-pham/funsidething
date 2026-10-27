import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { ACTIONLINT_VERSION, pinnedActionlintAsset, validateWorkflows } from './workflow-validator.mjs';

const repositoryRoot = process.cwd();
const validatorScript = resolve(repositoryRoot, 'scripts/agent-tools/workflow-validator.mjs');

test('workflow validator pin identifies official release archives and rejects unsupported platforms', () => {
  assert.equal(ACTIONLINT_VERSION, '1.7.12');
  assert.deepEqual(pinnedActionlintAsset('darwin', 'arm64'), {
    key: 'darwin-arm64',
    filename: 'actionlint_1.7.12_darwin_arm64.tar.gz',
    url: 'https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_darwin_arm64.tar.gz',
    sha256: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  });
  assert.match(pinnedActionlintAsset('linux', 'x64').sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => pinnedActionlintAsset('win32', 'x64'), /Supported platforms are darwin\/linux on x64\/arm64/);
});

test('public workflow command runs pinned actionlint on invalid job and valid step runner contexts', async (context) => {
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
