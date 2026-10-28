import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
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

function namedWorkflowStep(workflow, name) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `- name: ${name}`);
  if (start < 0) return null;
  const indent = lines[start].length - lines[start].trimStart().length;
  let end = start + 1;
  for (; end < lines.length; end += 1) {
    const leading = lines[end].length - lines[end].trimStart().length;
    if (leading === indent && lines[end].trimStart().startsWith('- ')) break;
  }
  const block = lines.slice(start, end).join('\n');
  const run = block.match(new RegExp(`^ {${indent + 2}}run: (.+)$`, 'm'))?.[1] ?? null;
  return { index: start, block, run };
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

await t.test('public validator entrypoint follows filesystem aliases and imports stay inert', async (context) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'workflow-validator-entry-alias-'));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const alias = join(fixtureRoot, 'validator-alias.mjs');
  await symlink(validatorScript, alias);

  const invoked = spawnSync(process.execPath, [alias, 'validate', '--help'], {
    cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  assert.equal(invoked.error, undefined, invoked.error?.message);
  assert.equal(invoked.status, 0, `${invoked.stdout}\n${invoked.stderr}`);
  assert.match(invoked.stdout, /Usage:[\s\S]*workflow-validator\.mjs validate/,
    'the public command must run its main through a symlinked path');

  const imported = spawnSync(process.execPath, [
    '--input-type=module', '-e', `await import(${JSON.stringify(new URL('./workflow-validator.mjs', import.meta.url).href)});`,
  ], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(imported.error, undefined, imported.error?.message);
  assert.equal(imported.status, 0, `${imported.stdout}\n${imported.stderr}`);
  assert.equal(imported.stdout, '', 'importing the validator must not invoke its CLI');
  assert.equal(imported.stderr, '', 'importing the validator must not write CLI diagnostics');
});

await t.test('public workflow command fails closed for missing and corrupt setup, then accepts the restored pin', async (context) => {
  const sourceProbe = await validateWorkflows({ repositoryRoot, sourceDir: join(repositoryRoot, '.github', 'workflows') });
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

await t.test('CI executes the checkout-bound validator command and retains its result before qualification', async () => {
  const setup = await validateWorkflows({ repositoryRoot });
  assert.equal(setup.ok, true, setup.error ?? setup.diagnostics);
  const workflowPath = join(repositoryRoot, '.github', 'workflows', 'data-safety.yml');
  const workflowBytes = await readFile(workflowPath);
  const workflow = workflowBytes.toString('utf8');
  const jobStart = workflow.indexOf('\n  validation-context:\n');
  const nextJob = workflow.indexOf('\n  event-gates:\n', jobStart);
  assert.notEqual(jobStart, -1, 'the existing validation-context job remains the early source authority');
  assert.notEqual(nextJob, -1, 'the validation-context job remains bounded before event gates');
  const contextJob = workflow.slice(jobStart, nextJob);
  const setupStep = namedWorkflowStep(contextJob, 'Install pinned workflow validator');
  const validateStep = namedWorkflowStep(contextJob, 'Validate pinned workflow checkout');
  const retainStep = namedWorkflowStep(contextJob, 'Preserve workflow validation evidence');
  const cohortStep = namedWorkflowStep(contextJob, 'Describe required cohort');
  assert.ok(setupStep && validateStep && retainStep && cohortStep,
    'CI must set up the pinned validator, invoke it, retain its report, and only then prepare qualification');
  assert.match(setupStep.run ?? '', /^npm run agent:setup-workflow-validator$/);
  assert.match(validateStep.run ?? '', /^npm run agent:validate-workflows/);
  assert.ok(setupStep.index < validateStep.index && validateStep.index < retainStep.index && retainStep.index < cohortStep.index,
    'pinned workflow validation and its report precede the cohort and workload graph');
  assert.match(validateStep.run, /--source-label "GitHub checkout \$\{GITHUB_SHA\}"/);
  assert.match(validateStep.run, /--evidence-file "\$\{RUNNER_TEMP\}\/workflow-validation\.json"/);
  assert.match(retainStep.block, /if: always\(\)/);
  assert.match(retainStep.block, /\$\{\{ runner\.temp \}\}\/workflow-validation\.json/);

  const fixtureRoot = await mkdtemp(join(tmpdir(), 'workflow-validator-ci-step-test-'));
  try {
    const workflowDirectory = join(fixtureRoot, '.github', 'workflows');
    const runnerTemp = join(fixtureRoot, 'runner temp');
    const fixtureCache = cachePaths(fixtureRoot);
    await Promise.all([
      mkdir(workflowDirectory, { recursive: true }),
      mkdir(runnerTemp, { recursive: true }),
      mkdir(fixtureCache.directory, { recursive: true }),
      mkdir(join(fixtureRoot, 'scripts', 'agent-tools'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({
        private: true,
        type: 'module',
        scripts: { 'agent:validate-workflows': 'node scripts/agent-tools/workflow-validator.mjs validate' },
      }, null, 2)),
      copyFile(validatorScript, join(fixtureRoot, 'scripts', 'agent-tools', 'workflow-validator.mjs')),
      copyFile(cachePaths(repositoryRoot).executable, fixtureCache.executable),
      copyFile(cachePaths(repositoryRoot).manifest, fixtureCache.manifest),
      writeFile(join(workflowDirectory, 'data-safety.yml'), workflowBytes),
    ]);
    await chmod(fixtureCache.executable, 0o755);

    const environment = {
      ...process.env,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
      GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
      RUNNER_TEMP: runnerTemp,
    };
    const invokeWorkflowStep = () => spawnSync('bash', [
      '--noprofile', '--norc', '-e', '-u', '-o', 'pipefail', '-c', validateStep.run,
    ], { cwd: fixtureRoot, env: environment, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    const evidencePath = join(runnerTemp, 'workflow-validation.json');
    const expectedWorkflowSha256 = createHash('sha256').update(workflowBytes).digest('hex');

    const invalidBytes = Buffer.from('name: invalid CI runner context\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    env:\n      VALUE: ${{ runner.temp }}\n    steps:\n      - run: echo test\n');
    await writeFile(join(workflowDirectory, 'invalid.yml'), invalidBytes);
    const invalid = invokeWorkflowStep();
    assert.equal(invalid.error, undefined, invalid.error?.message);
    assert.equal(invalid.status, 1, `${invalid.stdout}\n${invalid.stderr}`);
    assert.match(invalid.stderr, /context "runner" is not allowed here/);
    assert.match(invalid.stderr, /source=GitHub checkout 0123456789abcdef0123456789abcdef01234567/);
    const invalidEvidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    assert.equal(invalidEvidence.ok, false);
    assert.equal(invalidEvidence.validator.version, ACTIONLINT_VERSION);
    assert.equal(invalidEvidence.source.label, 'GitHub checkout 0123456789abcdef0123456789abcdef01234567');
    assert.equal(invalidEvidence.source.files.find(file => file.path === 'data-safety.yml')?.sha256, expectedWorkflowSha256,
      'the step evidence binds the exact candidate workflow bytes in its checkout');
    assert.equal(invalidEvidence.source.files.find(file => file.path === 'invalid.yml')?.sha256,
      createHash('sha256').update(invalidBytes).digest('hex'));

    const validBytes = Buffer.from('name: valid CI runner context\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Supported runner scope\n        env:\n          VALUE: ${{ runner.temp }}\n        run: echo test\n');
    await writeFile(join(workflowDirectory, 'invalid.yml'), validBytes);
    const valid = invokeWorkflowStep();
    assert.equal(valid.error, undefined, valid.error?.message);
    assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);
    const validEvidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    assert.equal(validEvidence.ok, true);
    assert.equal(validEvidence.source.files.find(file => file.path === 'invalid.yml')?.sha256,
      createHash('sha256').update(validBytes).digest('hex'));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
});

test('required validator integrations fail actionably without setup and never skip', async (context) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'workflow-validator-required-integrations-'));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const scripts = join(fixtureRoot, 'scripts', 'agent-tools');
  const workflows = join(fixtureRoot, '.github', 'workflows');
  await Promise.all([mkdir(scripts, { recursive: true }), mkdir(workflows, { recursive: true })]);
  await Promise.all([
    copyFile(validatorScript, join(scripts, 'workflow-validator.mjs')),
    copyFile(resolve(repositoryRoot, 'scripts/agent-tools/workflow-validator.test.mjs'), join(scripts, 'workflow-validator.test.mjs')),
    copyFile(join(repositoryRoot, '.github/workflows/data-safety.yml'), join(workflows, 'data-safety.yml')),
  ]);
  const required = [
    'public workflow command fails closed for missing and corrupt setup, then accepts the restored pin',
    'an edited manifest cannot authorize an arbitrary same-version executable',
    'public workflow command runs pinned actionlint on invalid job and valid step runner contexts',
  ];
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const invoke = () => spawnSync(process.execPath, [
    '--test', '--test-reporter=tap', '--test-name-pattern=^workflow validator command contracts are pinned and source-bound$',
    'scripts/agent-tools/workflow-validator.test.mjs',
  ], { cwd: fixtureRoot, env: environment, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  const missing = invoke();
  assert.equal(missing.error, undefined, missing.error?.message);
  assert.notEqual(missing.status, 0, `Missing setup must fail required integration checks.\n${missing.stdout}\n${missing.stderr}`);
  assert.match(missing.stdout, /# skipped 0\b/);
  for (const name of required) assert.ok(missing.stdout.split('\n').some(line => /^\s*not ok \d+ - /.test(line) && line.endsWith(name)), name);
  assert.match(missing.stdout + missing.stderr, /npm run agent:setup-workflow-validator/);

  const original = cachePaths(repositoryRoot), installed = cachePaths(fixtureRoot);
  await mkdir(installed.directory, { recursive: true });
  await Promise.all([copyFile(original.executable, installed.executable), copyFile(original.manifest, installed.manifest)]);
  await chmod(installed.executable, 0o755);
  const present = invoke();
  assert.equal(present.error, undefined, present.error?.message);
  assert.equal(present.status, 0, `${present.stdout}\n${present.stderr}`);
  assert.match(present.stdout, /# skipped 0\b/);
  for (const name of required) assert.ok(present.stdout.split('\n').some(line => /^\s*ok \d+ - /.test(line) && line.endsWith(name)), name);

  await rm(join(fixtureRoot, 'node_modules'), { recursive: true, force: true });
  for (const file of ['tests.js', 'index.html', 'vendor/lz-string-1.5.0.min.js',
    'scripts/install-release-hook.mjs', 'scripts/release-evidence.mjs', 'scripts/agent-tools/checkpoint-progress.mjs']) {
    await mkdir(dirname(join(fixtureRoot, file)), { recursive: true });
    await copyFile(join(repositoryRoot, file), join(fixtureRoot, file));
  }
  const outgoing = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
    '--test-name-pattern=^RISK repository process: managed pre-push validates the exact outgoing workflow commit$', 'tests.js'],
  { cwd: fixtureRoot, env: environment, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  assert.equal(outgoing.error, undefined, outgoing.error?.message);
  assert.notEqual(outgoing.status, 0, `Missing setup cannot skip required outgoing workflow integration.\n${outgoing.stdout}\n${outgoing.stderr}`);
  assert.match(outgoing.stdout, /not ok \d+ - RISK repository process: managed pre-push validates the exact outgoing workflow commit/);
  assert.match(outgoing.stdout, /# skipped 0\b/);
  assert.match(outgoing.stdout + outgoing.stderr, /npm run agent:setup-workflow-validator/);
});
