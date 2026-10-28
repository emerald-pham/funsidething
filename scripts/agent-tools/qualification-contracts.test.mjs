import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { planQualificationContracts, qualificationTestCommand, verifyQualificationOutcomes } from './qualification-contracts.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const selector = path.join(repository, 'scripts/agent-tools/qualification-contracts.mjs');
const sourceAssignments = JSON.parse(fs.readFileSync(path.join(repository, 'scripts/test-group-assignments.json'), 'utf8'));
const contractRows = sourceAssignments.rootAssignments.filter(row => row.qualificationContract);
const contractRoots = Object.fromEntries(contractRows.map(row => [row.qualificationContract.id, row.root]));
const contractIds = contractRows.map(row => row.qualificationContract.id);
const triggerPathsByContract = Object.fromEntries(contractRows.map(row => [row.qualificationContract.id, row.qualificationContract.triggerPaths]));
const groups = ['core', 'scenery', 'persistence-recovery', 'native-process'];

function uniqueTriggerFor(id) {
  return triggerPathsByContract[id].find(candidate => contractRows.every(row => row.qualificationContract.id === id || !row.qualificationContract.triggerPaths.includes(candidate)));
}

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.error, undefined, `git ${args.join(' ')} must start: ${result.error?.message || ''}`);
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-qualification-contracts-'));
  fs.mkdirSync(path.join(root, 'scripts/agent-tools'), { recursive: true });
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  const baselineRoots = [
    ['fixture core contract baseline', 'core'],
    ['fixture scenery contract baseline', 'scenery'],
    ['fixture persistence contract baseline', 'persistence-recovery'],
    ['fixture native contract baseline', 'native-process'],
  ];
  const allRoots = [...baselineRoots, ...contractRows.map(row => [row.root, row.group, row.qualificationContract])];
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    type: 'module',
    scripts: { test: 'node --test tests.js scripts/agent-tools/*.test.mjs' },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'tests.js'), `import { test } from 'node:test';\n${allRoots.map(([title, , qualificationContract]) => qualificationContract
    ? `test(${JSON.stringify(title)}, t => { if (process.env.CHAIN_QUALIFICATION_FIXTURE_FAILURE === ${JSON.stringify(qualificationContract.id)}) throw new Error('controlled selected failure'); if (process.env.CHAIN_QUALIFICATION_FIXTURE_SKIP === ${JSON.stringify(qualificationContract.id)}) t.skip('controlled selected skip'); if (process.env.CHAIN_QUALIFICATION_FIXTURE_HANG === ${JSON.stringify(qualificationContract.id)}) return new Promise(() => {}); });`
    : `test(${JSON.stringify(title)}, () => {});`).join('\n')}\n`);
  for (const file of new Set(Object.values(triggerPathsByContract).flat())) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, 'fixture source\n');
  }
  for (const file of ['scripts/agent-tools/test-groups.test.mjs', 'scripts/agent-tools/checkpoint-progress.test.mjs']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '');
  }

  const assignments = {
    schemaVersion: 1,
    baselineRunId: 'fixture-baseline',
    assignmentMethod: 'Isolated selector fixture declares every baseline root and each existing wrapper.',
    groups: groups.map(id => {
      const roots = allRoots.filter(([, group]) => group === id);
      return {
        id, description: `Fixture ${id}`, resourcePolicy: 'isolated-process', withinGroupConcurrency: 1,
        baselineRootCount: roots.length, baselineEstimatedDurationMs: roots.length * 100,
      };
    }),
    rootAssignments: allRoots.map(([rootName, group, qualificationContract]) => ({
      root: rootName,
      group,
      file: 'tests.js',
      ...(qualificationContract ? { qualificationContract } : {}),
    })),
    rootReplacements: [],
    processControls: [],
  };
  writeJson(path.join(root, 'scripts/test-group-assignments.json'), assignments);
  const rootNames = allRoots.map(([id]) => id);
  writeJson(path.join(root, 'scripts/test-group-inventory.json'), {
    schemaVersion: 1,
    baseline: {
      repository: 'example/fixture', runId: 'baseline', runAttempt: 1, eventPolicy: 'push',
      sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), checkoutSha: 'c'.repeat(40),
      checkoutTree: 'd'.repeat(40), comparisonBase: 'e'.repeat(40),
      caseCount: rootNames.length, passed: rootNames.length, skipped: 0, failed: 0,
    },
    rootTests: rootNames.map(id => ({ id, durationMs: 100 })),
    requiredCases: rootNames.map(id => ({ id, root: id })),
    acceptedSkipCaseIds: [],
  });

  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixture@example.test');
  git(root, 'config', 'user.name', 'Fixture Runner');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'selector fixture baseline source');
  const seed = git(root, 'rev-parse', 'HEAD');
  const seedTree = git(root, 'rev-parse', 'HEAD^{tree}');
  const inventoryPath = path.join(root, 'scripts/test-group-inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  Object.assign(inventory.baseline, { sourceSha: seed, sourceTree: seedTree, checkoutSha: seed, checkoutTree: seedTree, comparisonBase: seed });
  writeJson(inventoryPath, inventory);
  git(root, 'add', 'scripts/test-group-inventory.json');
  git(root, 'commit', '-qm', 'bind selector fixture inventory to baseline');
  const base = git(root, 'rev-parse', 'HEAD');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, base };
}

function commitChanged(fixture, paths) {
  for (const [file, contents] of Object.entries(paths)) {
    const target = path.join(fixture.root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    git(fixture.root, 'add', file);
  }
  git(fixture.root, 'commit', '-qm', 'change selected qualification source');
}

function invoke(fixture, ...selectionArgs) {
  return spawnSync(process.execPath, [selector, '--repo', fixture.root, '--base', fixture.base, ...selectionArgs], {
    cwd: fixture.root, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
  });
}

function makeRecorderFixture(t, { sourceChange = true, selectionFailure = false, workflowFailure = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chain-qualification-recorder-')));
  const repo = path.join(root, 'repo');
  const branch = git(repository, 'branch', '--show-current');
  git(root, 'clone', '--shared', '--quiet', '--single-branch', '--branch', branch, repository, repo);
  const sourceHead = git(repo, 'rev-parse', 'HEAD');
  if (!git(repo, 'branch', '--list', 'main')) git(repo, 'branch', 'main', sourceHead);
  git(repo, 'checkout', '--detach', sourceHead);
  const modules = path.join(repository, 'node_modules');
  if (fs.existsSync(modules)) {
    fs.symlinkSync(modules, path.join(repo, 'node_modules'), 'dir');
    fs.appendFileSync(path.join(repo, '.git/info/exclude'), '\n/node_modules\n');
  }
  if (sourceChange) {
    const assignmentFile = path.join(repo, 'scripts/test-group-assignments.json');
    const assignments = JSON.parse(fs.readFileSync(assignmentFile, 'utf8'));
    assignments.assignmentMethod += ' Qualification recorder fixture source-bound trigger.';
    writeJson(assignmentFile, assignments);
    git(repo, 'add', 'scripts/test-group-assignments.json');
    git(repo, 'commit', '-qm', 'qualification recorder fixture source trigger');
  }
  if (selectionFailure) {
    const assignmentFile = path.join(repo, 'scripts/test-group-assignments.json');
    const assignments = JSON.parse(fs.readFileSync(assignmentFile, 'utf8'));
    delete assignments.rootAssignments.find(row => row.qualificationContract?.id === 'startup-browser').qualificationContract;
    writeJson(assignmentFile, assignments);
    git(repo, 'add', 'scripts/test-group-assignments.json');
    git(repo, 'commit', '-qm', 'remove required qualification selector metadata');
  }
  if (workflowFailure) {
    const workflowFile = path.join(repo, '.github/workflows/data-safety.yml');
    fs.appendFileSync(workflowFile, '\ninvalid: [\n');
    git(repo, 'add', '.github/workflows/data-safety.yml');
    git(repo, 'commit', '-qm', 'make focused workflow validation fail');
  }
  const candidate = git(repo, 'rev-parse', 'HEAD');
  const tree = git(repo, 'rev-parse', 'HEAD^{tree}');
  const deliveryPort = 40_000 + (process.pid % 10_000) * 2;
  const smokePort = deliveryPort + 1;
  const evidence = path.join(root, 'evidence');
  const nativeOutput = path.join(root, 'native-output');
  const ledger = path.join(root, 'coordination.json');
  const sentinel = path.join(root, 'long-child-started');
  const preload = path.join(root, 'qualification-child-outcome.cjs');
  fs.writeFileSync(preload, `
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const realSpawn = childProcess.spawn;
const titles = JSON.parse(process.env.CHAIN_QUALIFICATION_FIXTURE_TITLES || '[]');
childProcess.spawn = function (command, args = [], options = {}) {
  const mode = process.env.CHAIN_QUALIFICATION_FIXTURE_OUTCOME || 'actual';
  const pattern = Array.isArray(args) && args.find(argument => argument.startsWith('--test-name-pattern=')) || '';
  const selected = Array.isArray(args) && args.includes('--test-reporter=tap') && args.at(-1) === 'tests.js'
    && titles.length > 0 && titles.every(title => pattern.includes(title));
  if (!selected || mode === 'actual') return realSpawn(command, args, options);
  let rows = titles.map((title, index) => {
    const failed = mode === 'failed' && index === 0;
    const skipped = mode === 'skipped' && index === 0;
    return '# Subtest: ' + title + '\\n' + (failed ? 'not ' : '') + 'ok ' + (index + 1) + ' - ' + title
      + (skipped ? ' # SKIP controlled fixture' : '') + '\\n';
  });
  if (mode === 'missing') rows = [];
  if (mode === 'duplicate') rows.push(rows[0]);
  const output = 'TAP version 13\\n' + rows.join('') + '1..' + rows.length + '\\n';
  const exitCode = mode === 'failed' ? 1 : 0;
  return realSpawn(process.execPath, ['-e', 'process.stdout.write(' + JSON.stringify(output) + '); process.exitCode = ' + exitCode], options);
};
syncBuiltinESMExports();
`);
  writeJson(ledger, { version: 1, scope: 'codex-wide', entries: [{
    id: 'qualification-recorder-fixture', status: 'active', worktree: repo,
    resources: [`loopback:127.0.0.1:${deliveryPort}`, `loopback:127.0.0.1:${smokePort}`],
  }] });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root, repo, candidate, tree, base: sourceHead, evidence, nativeOutput, ledger, sentinel, preload,
    environment: {
      ...process.env,
      CI: '',
      CODEX_COORDINATION_FILE: ledger,
      DOW_EMULATOR_COORDINATION_FILE: '',
      CHAIN_NATIVE_CANDIDATE_SHA: candidate,
      CHAIN_NATIVE_CANDIDATE_TREE: tree,
      CHAIN_NATIVE_OUTPUT: nativeOutput,
      CHAIN_NATIVE_PORT: String(deliveryPort),
      CHAIN_NATIVE_SMOKE_PORT: String(smokePort),
      CHAIN_QUALIFICATION_FIXTURE_SENTINEL: sentinel,
      CHAIN_QUALIFICATION_FIXTURE_TITLES: JSON.stringify(contractRows.map(row => row.root)),
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${preload}`.trim(),
    },
  };
}

function invokeReadyRecorder(fixture, { mode = 'actual', sentinel = fixture.sentinel, comparisonBase = undefined } = {}) {
  const env = {
    ...fixture.environment,
    CHAIN_QUALIFICATION_FIXTURE_OUTCOME: mode,
    CHAIN_QUALIFICATION_FIXTURE_SENTINEL: sentinel,
  };
  delete env.NODE_TEST_CONTEXT;
  const command = "require('node:fs').writeFileSync(process.env.CHAIN_QUALIFICATION_FIXTURE_SENTINEL, 'started'); process.stdout.write('requested long child only\\n')";
  return spawnSync(process.execPath, [
    path.join(repository, 'scripts/agent-tools/record-run.mjs'),
    '--repo', fixture.repo,
    '--evidence-dir', fixture.evidence,
    '--purpose', 'green',
    '--qualification-readiness',
    ...(comparisonBase ? ['--qualification-base', comparisonBase] : []),
    '--summary',
    '--', process.execPath, '-e', command,
  ], { cwd: fixture.repo, encoding: 'utf8', timeout: 240_000, maxBuffer: 8 * 1024 * 1024, env });
}

function readRecorderSummary(result) {
  assert.equal(result.stderr, '', `summary mode should keep qualification TAP private: ${result.stderr.slice(0, 300)}`);
  const lines = result.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 1, `expected one bounded recorder summary line, got ${lines.length}`);
  return JSON.parse(lines[0]);
}

function recorderFailureDetails(result) {
  try {
    const summary = JSON.parse(result.stdout.trim());
    const reportPath = summary.qualificationPreflight?.reportPath;
    if (!reportPath || !fs.existsSync(reportPath)) return '';
    const directory = path.dirname(reportPath);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return JSON.stringify({ report, preflightStdout: fs.readFileSync(path.join(directory, 'preflight.stdout.txt'), 'utf8'), preflightStderr: fs.readFileSync(path.join(directory, 'preflight.stderr.txt'), 'utf8') });
  } catch { return ''; }
}

function recorderRecord(fixture) {
  const records = fs.readdirSync(fixture.evidence).filter(file => file.endsWith('.json'));
  assert.equal(records.length, 1, 'each readiness invocation should leave exactly one durable parent record');
  return JSON.parse(fs.readFileSync(path.join(fixture.evidence, records[0]), 'utf8'));
}

function assertPrivateQualificationReport(fixture, summary, expectedStatus) {
  assert.equal(summary.qualificationPreflight?.status, expectedStatus, 'the summary exposes only bounded qualification status');
  const record = recorderRecord(fixture);
  const reportPath = record.qualificationPreflight?.reportPath;
  assert.equal(typeof reportPath, 'string', 'the recorder record links to a distinct qualification report');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(fs.statSync(path.dirname(reportPath)).mode & 0o777, 0o700, 'qualification report directory is private');
  assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600, 'qualification report is private');
  assert.equal(report.status, expectedStatus);
  return { record, report, reportPath };
}

function executeSelectedFixture(fixture, { environment = {}, timeout = 15_000 } = {}) {
  const plan = planQualificationContracts({ repo: fixture.root, comparisonBase: fixture.base });
  const command = qualificationTestCommand(plan);
  const env = { ...process.env, ...environment };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(command.executable, command.args, { cwd: fixture.root, env, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
  const verified = verifyQualificationOutcomes(plan, {
    exitCode: child.status,
    signal: child.signal,
    launchError: child.error,
    stdout: child.stdout || '',
  });
  return { plan, child, verified };
}

test('qualification selector binds exact assigned risk wrappers to source changes and fails closed', async t => {
  await t.test('public selector entrypoint follows filesystem aliases and imports stay inert', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-qualification-entry-alias-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const alias = path.join(root, 'selector-alias.mjs');
    fs.symlinkSync(selector, alias);
    const invoked = spawnSync(process.execPath, [alias, '--help'], {
      cwd: repository, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
    });
    assert.equal(invoked.error, undefined, invoked.error?.message);
    assert.equal(invoked.status, 0, `${invoked.stdout}\n${invoked.stderr}`);
    assert.match(invoked.stdout, /Usage: node scripts\/agent-tools\/qualification-contracts\.mjs/,
      'the public selector must run its main through a symlinked path');

    const imported = spawnSync(process.execPath, [
      '--input-type=module', '-e', `await import(${JSON.stringify(new URL('./qualification-contracts.mjs', import.meta.url).href)});`,
    ], { cwd: repository, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 });
    assert.equal(imported.error, undefined, imported.error?.message);
    assert.equal(imported.status, 0, `${imported.stdout}\n${imported.stderr}`);
    assert.equal(imported.stdout, '', 'importing the selector must not invoke its CLI');
    assert.equal(imported.stderr, '', 'importing the selector must not write CLI diagnostics');
  });

  for (const id of contractIds) await t.test(`${id} selects its exact existing wrapper`, () => {
    const trigger = uniqueTriggerFor(id);
    assert.ok(trigger, `contract ${id} must have a unique source trigger for the isolated selection check`);
    const fixture = makeFixture(t);
    commitChanged(fixture, { [trigger]: 'changed source\n' });
    const result = invoke(fixture);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.status, 'selected');
    assert.deepEqual(plan.selected.map(row => ({ id: row.id, root: row.root })), [{ id, root: contractRoots[id] }]);
  });

  await t.test('an unrelated change is an explicit empty selection', () => {
    const fixture = makeFixture(t);
    commitChanged(fixture, { 'README.md': 'unrelated\n' });
    const result = invoke(fixture);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.status, 'no_change');
    assert.deepEqual(plan.selected, []);
    assert.deepEqual(plan.changedPaths, ['README.md']);
  });

  await t.test('explicit duplicate and unknown contracts fail with actionable errors', () => {
    const fixture = makeFixture(t);
    commitChanged(fixture, { 'README.md': 'fixture\n' });
    const duplicate = invoke(fixture, '--select', 'startup-browser', '--select', 'startup-browser');
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /duplicate|more than once/i);
    const unknown = invoke(fixture, '--select', 'not-a-contract');
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /unknown|not registered/i);
  });

  await t.test('the exact selected parent process executes once and its raw TAP is verified', () => {
    const fixture = makeFixture(t);
    commitChanged(fixture, { 'scripts/agent-tools/checkpoint-progress.mjs': 'changed source\n' });
    const { plan, child, verified } = executeSelectedFixture(fixture);
    assert.equal(child.error, undefined, child.error?.message || 'selected parent process must start');
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.deepEqual(plan.selected.map(row => row.root), [contractRoots['finite-authority']]);
    assert.deepEqual(verified, {
      status: 'passed', expected: [contractRoots['finite-authority']],
      outcomes: [{ root: contractRoots['finite-authority'], status: 'passed', count: 1, skipReason: null }], issues: [],
    });
  });

  await t.test('failed and skipped selected children do not qualify', () => {
    const failedFixture = makeFixture(t);
    commitChanged(failedFixture, { 'scripts/agent-tools/checkpoint-progress.mjs': 'changed source\n' });
    const failure = executeSelectedFixture(failedFixture, { environment: { CHAIN_QUALIFICATION_FIXTURE_FAILURE: 'finite-authority' } });
    assert.equal(failure.child.status, 1, failure.child.stdout + failure.child.stderr);
    assert.equal(failure.verified.status, 'failed');
    assert.deepEqual(failure.verified.outcomes.map(row => row.status), ['failed']);

    const skippedFixture = makeFixture(t);
    commitChanged(skippedFixture, { 'scripts/agent-tools/checkpoint-progress.mjs': 'changed source\n' });
    const skipped = executeSelectedFixture(skippedFixture, { environment: { CHAIN_QUALIFICATION_FIXTURE_SKIP: 'finite-authority' } });
    assert.equal(skipped.child.status, 0, skipped.child.stdout + skipped.child.stderr);
    assert.equal(skipped.verified.status, 'failed');
    assert.deepEqual(skipped.verified.outcomes.map(row => row.status), ['skipped']);
  });

  await t.test('cancelled, missing, and duplicate child results remain nonqualifying', () => {
    const fixture = makeFixture(t);
    commitChanged(fixture, { 'scripts/agent-tools/checkpoint-progress.mjs': 'changed source\n' });
    const plan = planQualificationContracts({ repo: fixture.root, comparisonBase: fixture.base });
    const command = qualificationTestCommand(plan);
    const env = { ...process.env, CHAIN_QUALIFICATION_FIXTURE_HANG: 'finite-authority' };
    delete env.NODE_TEST_CONTEXT;
    const cancelled = spawnSync(command.executable, command.args, { cwd: fixture.root, env, encoding: 'utf8', timeout: 500, maxBuffer: 1024 * 1024 });
    const cancelledResult = verifyQualificationOutcomes(plan, { exitCode: cancelled.status, signal: cancelled.signal, launchError: cancelled.error, stdout: cancelled.stdout || '' });
    assert.equal(cancelledResult.status, 'failed');
    assert.ok(cancelledResult.issues.some(issue => /interrupted|exited|TAP|exactly one/i.test(issue)));

    const omitted = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { cwd: fixture.root, encoding: 'utf8', timeout: 2_000 });
    const omittedResult = verifyQualificationOutcomes(plan, { exitCode: omitted.status, signal: omitted.signal, stdout: omitted.stdout || '' });
    assert.equal(omittedResult.status, 'failed');
    assert.deepEqual(omittedResult.outcomes.map(row => row.status), ['missing']);

    const root = contractRoots['finite-authority'];
    const duplicateTap = `TAP version 13\n# Subtest: ${root}\nok 1 - ${root}\n# Subtest: ${root}\nok 2 - ${root}\n1..2\n`;
    const duplicateChild = spawnSync(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(duplicateTap)})`], { cwd: fixture.root, encoding: 'utf8', timeout: 2_000 });
    const duplicateResult = verifyQualificationOutcomes(plan, { exitCode: duplicateChild.status, signal: duplicateChild.signal, stdout: duplicateChild.stdout || '' });
    assert.equal(duplicateResult.status, 'failed');
    assert.deepEqual(duplicateResult.outcomes.map(row => row.status), ['duplicate']);
  });

  await t.test('missing and duplicate registry metadata fail closed', () => {
    for (const mutation of ['missing', 'duplicate']) {
      const fixture = makeFixture(t);
      const file = path.join(fixture.root, 'scripts/test-group-assignments.json');
      const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
      const selected = catalog.rootAssignments.find(row => row.qualificationContract?.id === 'startup-browser');
      if (mutation === 'missing') delete selected.qualificationContract;
      else catalog.rootAssignments.find(row => row.root === 'fixture native contract baseline').qualificationContract = selected.qualificationContract;
      writeJson(file, catalog);
      git(fixture.root, 'add', 'scripts/test-group-assignments.json');
      commitChanged(fixture, { 'scripts/agent-tools/checkpoint-progress.mjs': 'changed source\n' });
      const result = invoke(fixture);
      assert.notEqual(result.status, 0, `${mutation} selector metadata must fail closed`);
      assert.match(result.stderr, /qualification|contract|duplicate|exactly once/i);
    }
  });

  await t.test('overlapping root assignments remain rejected by the canonical registration validator', () => {
    const fixture = makeFixture(t);
    const file = path.join(fixture.root, 'scripts/test-group-assignments.json');
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    catalog.rootAssignments.push({ ...catalog.rootAssignments.find(row => row.qualificationContract?.id === 'startup-browser') });
    writeJson(file, catalog);
    git(fixture.root, 'add', 'scripts/test-group-assignments.json');
    commitChanged(fixture, { 'scripts/agent-tools/test-groups.test.mjs': 'changed source\n' });
    const result = invoke(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /overlapping group assignments/i);
  });

  await t.test('renamed exact wrapper identity is rejected by the current registration authority', () => {
    const fixture = makeFixture(t);
    const file = path.join(fixture.root, 'scripts/test-group-assignments.json');
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    const renamed = 'RISK repository process: newly registered startup browser roots require a renamed Chromium receipt';
    catalog.rootAssignments.find(row => row.qualificationContract?.id === 'startup-browser').root = renamed;
    const suite = path.join(fixture.root, 'tests.js');
    const source = fs.readFileSync(suite, 'utf8').replace(contractRoots['startup-browser'], renamed);
    fs.writeFileSync(suite, source);
    writeJson(file, catalog);
    git(fixture.root, 'add', 'tests.js', 'scripts/test-group-assignments.json');
    commitChanged(fixture, { 'scripts/agent-tools/checkpoint-progress.mjs': 'changed source\n' });
    const result = invoke(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /baseline root|replacement|registration|qualification/i);
  });
});

test('qualification readiness gates the recorder child on selected parent contracts and explicit no-change', async t => {
  await t.test('selected existing wrappers pass privately before the requested child starts', () => {
    const fixture = makeRecorderFixture(t);
    const result = invokeReadyRecorder(fixture, { comparisonBase: fixture.base });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${recorderFailureDetails(result)}`);
    assert.equal(fs.readFileSync(fixture.sentinel, 'utf8'), 'started', 'the requested long child starts only after all selected wrappers pass');
    const summary = readRecorderSummary(result);
    assert.equal(summary.status, 'passed');
    assert.equal(summary.qualificationPreflight.status, 'passed');
    assert.deepEqual(summary.qualificationPreflight.selectedContractIds, ['startup-browser', 'finite-authority', 'workflow-context']);
    const { record, report } = assertPrivateQualificationReport(fixture, summary, 'passed');
    assert.equal(report.selection.status, 'selected');
    assert.deepEqual(report.outcomes.outcomes.map(row => row.status), ['passed', 'passed', 'passed']);
    assert.match(report.contracts.stdout, /# tests 3\n/);
    assert.match(record.execution.output.stdout, /requested long child only/);
    assert.doesNotMatch(record.execution.output.stdout, /# Subtest:|startup-browser|finite-authority|workflow-context/);
    assert.doesNotMatch(summary.stdout ?? '', /# Subtest:|# tests 3/);
    const children = fs.readdirSync(path.dirname(record.qualificationPreflight.reportPath));
    assert.ok(children.includes('preflight.stdout.txt'));
    assert.ok(children.includes('preflight.stderr.txt'));
    assert.ok(children.includes('contracts.stdout.tap'));
    assert.ok(children.includes('contracts.stderr.txt'));
    for (const file of children) assert.equal(fs.statSync(path.join(path.dirname(record.qualificationPreflight.reportPath), file)).mode & 0o777, 0o600, `${file} is private`);
  });

  await t.test('workflow preflight failure blocks the requested child', () => {
    const fixture = makeRecorderFixture(t, { workflowFailure: true });
    const result = invokeReadyRecorder(fixture);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr);
    assert.notEqual(result.status, 0, `invalid workflow bytes must stop the child: ${result.stdout}\n${result.stderr}\n${recorderFailureDetails(result)}`);
    assert.equal(fs.existsSync(fixture.sentinel), false, 'workflow validation failure must not launch the requested child');
    const summary = readRecorderSummary(result);
    assert.equal(summary.status, 'qualification-failure');
    assert.equal(summary.qualificationPreflight.stage, 'workflow-preflight');
    const { record, report } = assertPrivateQualificationReport(fixture, summary, 'failed');
    assert.equal(report.selection, null, 'selection does not run after workflow validation fails');
    assert.notEqual(report.workflowPreflight.exitCode, 0);
    assert.equal(record.execution.outcome, 'qualification-failure');
    assert.deepEqual(summary.child, { exitCode: null, signal: null });
  });

  await t.test('invalid selector metadata blocks the requested child after preflight', () => {
    const fixture = makeRecorderFixture(t, { selectionFailure: true });
    const result = invokeReadyRecorder(fixture);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr);
    assert.notEqual(result.status, 0, `missing required selector metadata must stop the child: ${result.stdout}\n${result.stderr}\n${recorderFailureDetails(result)}`);
    assert.equal(fs.existsSync(fixture.sentinel), false, 'invalid contract selection must not launch the requested child');
    const summary = readRecorderSummary(result);
    assert.equal(summary.status, 'qualification-failure');
    assert.equal(summary.qualificationPreflight.stage, 'selection');
    const { record, report } = assertPrivateQualificationReport(fixture, summary, 'failed');
    assert.equal(report.workflowPreflight.exitCode, 0, 'the standard preflight completed before selector validation');
    assert.equal(report.selection, null, 'invalid registry metadata cannot yield a plan');
    assert.match(report.errors.join(' '), /startup-browser.*missing/i);
    assert.equal(record.execution.outcome, 'qualification-failure');
    assert.deepEqual(summary.child, { exitCode: null, signal: null });
  });

  for (const mode of ['failed', 'skipped', 'duplicate', 'missing']) await t.test(`${mode} selected outcomes block the requested child`, () => {
    const fixture = makeRecorderFixture(t);
    const result = invokeReadyRecorder(fixture, { mode });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr);
    assert.notEqual(result.status, 0, `${mode} must fail closed before the requested child: ${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(fixture.sentinel), false, `${mode} must not launch the requested child`);
    const summary = readRecorderSummary(result);
    assert.equal(summary.status, 'qualification-failure', result.stdout);
    assert.equal(summary.qualificationPreflight.status, 'failed');
    const { record, report } = assertPrivateQualificationReport(fixture, summary, 'failed');
    assert.equal(report.outcomes.status, 'failed');
    assert.ok(report.outcomes.outcomes.some(row => row.status === mode), `${mode} is represented as the observed child outcome`);
    assert.equal(record.execution.outcome, 'qualification-failure');
    assert.equal(record.execution.output.stdout, '');
  });

  await t.test('an explicit empty selection skips wrappers and still launches the requested child', () => {
    const fixture = makeRecorderFixture(t, { sourceChange: false });
    const result = invokeReadyRecorder(fixture, { comparisonBase: fixture.base });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.readFileSync(fixture.sentinel, 'utf8'), 'started');
    const summary = readRecorderSummary(result);
    assert.equal(summary.status, 'passed');
    assert.equal(summary.qualificationPreflight.status, 'no_change');
    assert.deepEqual(summary.qualificationPreflight.selectedContractIds, []);
    const { record, report } = assertPrivateQualificationReport(fixture, summary, 'no_change');
    assert.equal(report.selection.status, 'no_change');
    assert.equal(report.outcomes, null, 'no-change records no parent cohort outcome');
    assert.equal(record.execution.outcome, 'passed');
    assert.match(record.execution.output.stdout, /requested long child only/);
  });
});
