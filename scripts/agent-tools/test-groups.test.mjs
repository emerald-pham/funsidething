import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runner = path.join(repository, 'scripts/test-groups.mjs');
const groups = ['core', 'scenery', 'persistence-recovery', 'native-process'];
const fixtureRoots = {
  core: 'fixture core baseline root',
  scenery: 'fixture scenery baseline root',
  'persistence-recovery': 'fixture persistence baseline root',
  'native-process': 'fixture native baseline root',
};
const fixtureScriptRoot = 'fixture agent-tools baseline root';
let outputSerial = 0;

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.error, undefined, `${command} must start: ${result.error?.message || ''}`);
  return result;
}

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function suiteSource({ coreTitle = fixtureRoots.core, additionalCoreRoots = [], unexpectedSkip = false, failOnRequest = false,
  runtimeCoreTitle = coreTitle, processControl = false, omitNativeControl = false, duplicateNativeControl = false,
  processControlSourceFixture = false } = {}) {
  const skip = unexpectedSkip
    ? "\n  await t.test('new unaccepted skipped case', { skip: 'must fail closed' }, () => {});"
    : '';
  const failingControl = failOnRequest ? `
  if (process.env.CHAIN_GROUP_FIXTURE_FAILURE === '1') {
    fs.writeFileSync(path.join(process.env.TMPDIR, 'owned-process-temp'), 'owned');
    fs.writeFileSync(process.env.CHAIN_GROUP_FOREIGN_SENTINEL, 'foreign owner data');
    assert.fail('intentional fixture process failure');
  }` : '';
  const nativeControl = processControl && !omitNativeControl
    ? `\nif (process.env.CHAIN_GROUP_FIXTURE_CHILD === '1') {\n  test('fixture native controlled child outcome', () => {});${duplicateNativeControl ? " test('fixture native controlled child outcome', () => {});" : ''}\n}\n`
    : '';
  const nativeControlSourceFixture = processControlSourceFixture
    ? `\nconst nativeControlSourceFixture = ${JSON.stringify("test('fixture native controlled child outcome', () => {});")};\n`
    : '';
  return `import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
test(${JSON.stringify(runtimeCoreTitle)}, async t => {
  await t.test('fixture accepted environment skip', { skip: 'baseline skip' }, () => {});${skip}${failingControl}
});
${additionalCoreRoots.map(title => `test(${JSON.stringify(title)}, () => {});`).join('\n')}
test(${JSON.stringify(fixtureRoots.scenery)}, () => {});
test(${JSON.stringify(fixtureRoots['persistence-recovery'])}, () => {});
test(${JSON.stringify(fixtureRoots['native-process'])}, () => {
  if (process.env.CHAIN_NATIVE_OUTPUT) fs.writeFileSync(path.join(process.env.CHAIN_NATIVE_OUTPUT, 'candidate-identity.json'), JSON.stringify({
    sha: process.env.CHAIN_NATIVE_CANDIDATE_SHA,
    tree: process.env.CHAIN_NATIVE_CANDIDATE_TREE,
  }));
});
${nativeControl}${nativeControlSourceFixture}`;
}

function inventory(coreTitle = fixtureRoots.core, additionalCoreRoots = []) {
  const roots = [coreTitle, ...additionalCoreRoots, fixtureRoots.scenery, fixtureRoots['persistence-recovery'], fixtureRoots['native-process'], fixtureScriptRoot];
  const cases = [
    { id: coreTitle, root: coreTitle },
    { id: `${coreTitle} > fixture accepted environment skip`, root: coreTitle },
    ...roots.slice(1).map(root => ({ id: root, root })),
  ];
  return {
    schemaVersion: 1,
    baseline: {
      repository: 'example/fixture', runId: 'historical-run', runAttempt: 1, eventPolicy: 'push',
      sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), checkoutSha: 'c'.repeat(40),
      checkoutTree: 'd'.repeat(40), comparisonBase: 'e'.repeat(40),
      caseCount: 6 + additionalCoreRoots.length, passed: 5 + additionalCoreRoots.length, skipped: 1, failed: 0,
    },
    rootTests: roots.map(id => ({ id, durationMs: 100 })),
    requiredCases: cases,
    acceptedSkipCaseIds: [`${coreTitle} > fixture accepted environment skip`],
  };
}

function assignments(coreTitle = fixtureRoots.core, options = {}) {
  const rootAssignments = [
    { root: coreTitle, group: 'core', file: 'tests.js' },
    ...(options.additionalCoreRoots || []).map(root => ({ root, group: 'core', file: 'tests.js' })),
    { root: fixtureRoots.scenery, group: 'scenery', file: 'tests.js' },
    { root: fixtureRoots['persistence-recovery'], group: 'persistence-recovery', file: 'tests.js' },
    { root: fixtureRoots['native-process'], group: 'native-process', file: 'tests.js' },
    { root: fixtureScriptRoot, group: 'native-process', file: 'scripts/agent-tools/fixture.test.mjs' },
  ];
  return {
    schemaVersion: 1,
    baselineRunId: 'historical-run',
    assignmentMethod: 'Fixture roots are explicitly assigned to one stable resource-isolated group each.',
    groups: groups.map(id => ({
      id,
      description: `Fixture ${id} group`,
      resourcePolicy: 'isolated-process',
      withinGroupConcurrency: 1,
      baselineRootCount: rootAssignments.filter(entry => entry.group === id).length,
      baselineEstimatedDurationMs: rootAssignments.filter(entry => entry.group === id).length * 100,
    })),
    rootAssignments,
    rootReplacements: [],
    processControls: options.processControl ? [{
      id: 'fixture native controlled child outcome',
      group: 'native-process',
      file: 'tests.js',
      ownerRoot: fixtureRoots['native-process'],
      expectedExecutions: 1,
    }] : [],
  };
}

function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

function createFixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-group-project-'));
  fs.mkdirSync(path.join(root, 'scripts/agent-tools'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(runner, path.join(root, 'scripts/test-groups.mjs'));
  const coreTitle = options.coreTitle || fixtureRoots.core;
  writeJson(path.join(root, 'package.json'), {
    type: 'module',
    scripts: { 'test:group': 'node scripts/test-groups.mjs', test: 'node --test tests.js scripts/agent-tools/*.test.mjs' },
  });
  fs.writeFileSync(path.join(root, 'tests.js'), suiteSource({ ...options, coreTitle, runtimeCoreTitle: options.runtimeCoreTitle || coreTitle }));
  fs.writeFileSync(path.join(root, 'scripts/agent-tools/fixture.test.mjs'),
    `import { test } from 'node:test';\ntest(${JSON.stringify(fixtureScriptRoot)}, () => {});\n`);
  writeJson(path.join(root, 'scripts/test-group-inventory.json'), inventory(coreTitle, options.additionalCoreRoots || []));
  const groupAssignments = assignments(coreTitle, options);
  if (options.emptyGroup) {
    groupAssignments.rootAssignments.find(entry => entry.root === coreTitle).group = options.emptyGroup === true ? 'scenery' : options.emptyGroup;
  }
  if (options.duplicateAssignment) groupAssignments.rootAssignments.push({ ...groupAssignments.rootAssignments[0] });
  for (const group of groupAssignments.groups) {
    group.baselineRootCount = groupAssignments.rootAssignments.filter(entry => entry.group === group.id).length;
    group.baselineEstimatedDurationMs = group.baselineRootCount * 100;
  }
  writeJson(path.join(root, 'scripts/test-group-assignments.json'), groupAssignments);

  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixture@example.test');
  git(root, 'config', 'user.name', 'Fixture Runner');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture baseline');
  const baselineSha = git(root, 'rev-parse', 'HEAD');
  const baselineTree = git(root, 'rev-parse', 'HEAD^{tree}');
  const baselineInventory = JSON.parse(fs.readFileSync(path.join(root, 'scripts/test-group-inventory.json'), 'utf8'));
  Object.assign(baselineInventory.baseline, {
    sourceSha: baselineSha,
    sourceTree: baselineTree,
    checkoutSha: baselineSha,
    checkoutTree: baselineTree,
    comparisonBase: baselineSha,
  });
  writeJson(path.join(root, 'scripts/test-group-inventory.json'), baselineInventory);
  git(root, 'add', 'scripts/test-group-inventory.json');
  git(root, 'commit', '-qm', 'bind independent fixture inventory to its baseline');
  const comparisonBase = git(root, 'rev-parse', 'HEAD');
  const sourceSha = comparisonBase;
  const outputs = [];
  t.after(() => {
    for (const output of outputs) fs.rmSync(output, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, baselineSha, comparisonBase, sourceSha, outputs, coreTitle, groupAssignments };
}

function invoke(fixture, { group = 'core', env = {}, repository = 'example/fixture', outputDir: requestedOutputDir } = {}) {
  const outputDir = requestedOutputDir || path.join(os.tmpdir(), `chain-test-group-output-${process.pid}-${++outputSerial}`);
  fixture.outputs.push(outputDir);
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = run('npm', ['run', 'test:group', '--', '--group', group, '--output-dir', outputDir,
    '--repository', repository, '--event-policy', 'local', '--run-id', 'fixture-run-1', '--run-attempt', '1',
    '--source-sha', fixture.sourceSha, '--comparison-base', fixture.comparisonBase], fixture.root,
  childEnv);
  return { ...result, outputDir, evidencePath: path.join(outputDir, 'result.json'), evidence: readEvidence(outputDir) };
}

function readEvidence(outputDir) {
  const file = path.join(outputDir, 'result.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// This public-boundary process test intentionally gives every other stable
// group a required root, then moves the core root so the required core group
// is empty while the independent baseline remains otherwise complete.
test('test group runner rejects empty required groups through the public npm process', t => {
  const fixture = createFixture(t, { emptyGroup: true });
  const result = invoke(fixture);
  assert.notEqual(result.status, 0, `empty required group must fail closed\n${result.stdout}\n${result.stderr}`);
  assert.equal(result.evidence?.status, 'preflight_failed');
  assert.match(result.evidence?.issues?.join('\n') || '', /Required group core is empty/);
});

test('test group runner rejects output paths that alias into the checkout', t => {
  const fixture = createFixture(t);
  const aliasParent = path.join(os.tmpdir(), `chain-test-group-output-alias-${process.pid}-${++outputSerial}`);
  fs.symlinkSync(fixture.root, aliasParent, 'dir');
  t.after(() => fs.rmSync(aliasParent, { force: true }));
  const outputDir = path.join(aliasParent, 'group-output');
  const result = invoke(fixture, { outputDir });
  assert.notEqual(result.status, 0, `checkout aliases must be rejected before writing evidence\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Group evidence must be outside the checkout/);
  assert.equal(fs.existsSync(path.join(fixture.root, 'group-output')), false, 'rejected path must not create output in the checkout');
});

test('test group runner executes a complete isolated group with bound identity', t => {
  const fixture = createFixture(t);
  const result = invoke(fixture);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const evidence = result.evidence;
  assert.equal(evidence.status, 'passed');
  assert.deepEqual(evidence.resultIdentity.expectedGroups, groups);
  assert.equal(evidence.resultIdentity.repository, 'example/fixture');
  assert.equal(evidence.resultIdentity.eventPolicy, 'local');
  assert.equal(evidence.resultIdentity.runId, 'fixture-run-1');
  assert.equal(evidence.resultIdentity.runAttempt, 1);
  assert.equal(evidence.resultIdentity.sourceSha, fixture.sourceSha);
  assert.equal(evidence.resultIdentity.checkoutSha, fixture.sourceSha);
  assert.equal(evidence.resultIdentity.comparisonBase, fixture.comparisonBase);
  assert.match(evidence.resultIdentity.checkoutTree, /^[a-f0-9]{40}$/);
  assert.match(evidence.resultIdentity.cohortDigestSha256, /^[a-f0-9]{64}$/);
  assert.match(evidence.resultIdentity.inventorySha256, /^[a-f0-9]{64}$/);
  assert.match(evidence.resultIdentity.assignmentsSha256, /^[a-f0-9]{64}$/);
  assert.equal(evidence.inventory.baselineCaseCount, 6);
  assert.equal(evidence.inventory.requiredCasesForGroup, 2);
  assert.deepEqual(evidence.cases.map(item => item.id).sort(), [
    fixtureRoots.core,
    `${fixtureRoots.core} > fixture accepted environment skip`,
  ].sort());
  assert.equal(evidence.cases.find(item => item.status === 'skipped')?.id, `${fixtureRoots.core} > fixture accepted environment skip`);
  assert.equal(fs.existsSync(path.join(result.outputDir, 'runtime-tmp')), false, 'owned process temp directory is removed');
  assert.ok(fs.existsSync(path.join(result.outputDir, 'test.tap')));
  assert.ok(fs.existsSync(path.join(result.outputDir, 'test.stderr.log')));
});

test('test group runner keeps oversized group selections below the portable argument limit', t => {
  const additionalCoreRoots = Array.from({ length: 850 }, (_, index) =>
    `fixture portable core root ${String(index).padStart(4, '0')} ${'x'.repeat(180)}`);
  const fixture = createFixture(t, { additionalCoreRoots });
  const unchunkedArgumentBytes = Buffer.byteLength(`--test-name-pattern=^(?:${fixture.groupAssignments.rootAssignments
    .filter(item => item.group === 'core').map(item => item.root).join('|')})$`);
  assert.ok(unchunkedArgumentBytes > 128 * 1024, `the fixture must exceed Linux MAX_ARG_STRLEN: ${unchunkedArgumentBytes}`);
  t.diagnostic(JSON.stringify({ unchunkedArgumentBytes, requiredRootCount: additionalCoreRoots.length + 1 }));
  const result = invoke(fixture);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const selection = result.evidence.process.selection;
  assert.equal(selection.requiredRootCount, additionalCoreRoots.length + 1);
  assert.ok(selection.namePatternArgumentBytes.length > 1, 'the long public selection must use repeated Node test-name-pattern options');
  assert.ok(selection.namePatternArgumentBytes.every(bytes => bytes <= 64 * 1024),
    `every pattern argument must stay below the 64 KiB portable budget: ${selection.namePatternArgumentBytes}`);
  assert.equal(result.evidence.cases.length, additionalCoreRoots.length + 2);
  assert.equal(new Set(result.evidence.cases.map(item => item.id)).size, result.evidence.cases.length);
  assert.equal(result.evidence.inventory.requiredRootsForGroup, additionalCoreRoots.length + 1);
  t.diagnostic(JSON.stringify({ unchunkedArgumentBytes, ...selection }));
});

test('test group runner binds native tests to the actual checkout commit and tree', t => {
  const fixture = createFixture(t);
  fs.writeFileSync(path.join(fixture.root, 'synthetic-merge-only.txt'), 'merge checkout identity\n');
  git(fixture.root, 'add', 'synthetic-merge-only.txt');
  git(fixture.root, 'commit', '-qm', 'synthetic merge checkout');
  fixture.checkoutSha = git(fixture.root, 'rev-parse', 'HEAD');
  const result = invoke(fixture, { group: 'native-process' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.evidence.resultIdentity.sourceSha, fixture.sourceSha);
  assert.equal(result.evidence.resultIdentity.checkoutSha, fixture.checkoutSha);
  assert.notEqual(result.evidence.resultIdentity.sourceTree, result.evidence.resultIdentity.checkoutTree);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.outputDir, 'native/candidate-identity.json'), 'utf8')), {
    sha: fixture.checkoutSha,
    tree: result.evidence.resultIdentity.checkoutTree,
  });
});

function parseTapIds(output) {
  const stack = [];
  const ids = [];
  for (const line of output.split(/\r?\n/)) {
    const subtest = line.match(/^(\s*)# Subtest: (.*)$/);
    if (subtest) {
      while (stack.length && stack.at(-1).indent >= subtest[1].length) stack.pop();
      stack.push({ indent: subtest[1].length, name: subtest[2] });
      continue;
    }
    const result = line.match(/^(\s*)(?:not )?ok \d+ - (.*?)(?: # (?:SKIP|TODO)(?:\s+.*)?)?\s*$/);
    if (result) ids.push(stack.filter(item => item.indent <= result[1].length).map(item => item.name).join(' > '));
  }
  return ids;
}

test('test group runner reconciles complete full and grouped fixture cohorts', t => {
  const fixture = createFixture(t);
  const fullEnv = { ...process.env };
  delete fullEnv.NODE_TEST_CONTEXT;
  const full = run(process.execPath, ['--test', '--test-reporter=tap', 'tests.js', 'scripts/agent-tools/fixture.test.mjs'], fixture.root, fullEnv);
  assert.equal(full.status, 0, `${full.stdout}\n${full.stderr}`);
  const fullIds = parseTapIds(full.stdout).sort();
  const groupedIds = [];
  const cohortDigests = [];
  for (const group of groups) {
    const result = invoke(fixture, { group });
    assert.equal(result.status, 0, `${group}: ${result.stdout}\n${result.stderr}`);
    groupedIds.push(...result.evidence.cases.map(item => item.id));
    cohortDigests.push(result.evidence.resultIdentity.cohortDigestSha256);
  }
  assert.equal(new Set(cohortDigests).size, 1, 'all group results bind the same complete required cohort');
  assert.equal(new Set(groupedIds).size, groupedIds.length, 'group partitions must not overlap');
  assert.deepEqual(groupedIds.sort(), fullIds, 'grouped and default full-suite fixture identities must match exactly');
  assert.deepEqual(fullIds.sort(), inventory().requiredCases.map(item => item.id).sort());
});

test('test group runner reconciles a renamed root and preserves baseline case identities', t => {
  const oldRoot = 'fixture core historical title';
  const newRoot = `${oldRoot} with isolated contexts`;
  const fixture = createFixture(t, { coreTitle: oldRoot });
  fs.writeFileSync(path.join(fixture.root, 'tests.js'), suiteSource({ coreTitle: newRoot }));
  const groupAssignments = JSON.parse(fs.readFileSync(path.join(fixture.root, 'scripts/test-group-assignments.json'), 'utf8'));
  groupAssignments.rootAssignments = groupAssignments.rootAssignments.filter(item => item.root !== oldRoot);
  groupAssignments.rootAssignments.push({ root: newRoot, group: 'core', file: 'tests.js' });
  groupAssignments.rootAssignments.sort((a, b) => a.root.localeCompare(b.root));
  groupAssignments.rootReplacements = [{
    baselineRoot: oldRoot,
    currentRoot: newRoot,
    baselineGroup: 'core',
    group: 'core',
    file: 'tests.js',
    reason: 'The renamed fixture title preserves its historical child assertions and case identities.',
  }];
  writeJson(path.join(fixture.root, 'scripts/test-group-assignments.json'), groupAssignments);
  git(fixture.root, 'add', 'tests.js', 'scripts/test-group-assignments.json');
  git(fixture.root, 'commit', '-qm', 'classify a preserved renamed root');
  fixture.sourceSha = git(fixture.root, 'rev-parse', 'HEAD');
  fixture.comparisonBase = fixture.sourceSha;
  const result = invoke(fixture);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(result.evidence.resultIdentity.mappedBaselineRoots.includes(oldRoot));
  assert.ok(result.evidence.resultIdentity.addedRootTitles.includes(newRoot));
  assert.deepEqual(result.evidence.cases.map(item => item.id).sort(), [
    newRoot,
    `${newRoot} > fixture accepted environment skip`,
  ].sort());
});

test('test group runner rejects overlapping and unclassified registrations', t => {
  const overlapFixture = createFixture(t, { duplicateAssignment: true });
  const overlap = invoke(overlapFixture);
  assert.notEqual(overlap.status, 0);
  assert.match(overlap.evidence?.issues?.join('\n') || '', /overlapping group assignments/);

  const unclassifiedFixture = createFixture(t);
  fs.appendFileSync(path.join(unclassifiedFixture.root, 'tests.js'), "\ntest('new unclassified root', () => {});\n");
  const unclassified = invoke(unclassifiedFixture);
  assert.notEqual(unclassified.status, 0);
  assert.match(unclassified.evidence?.issues?.join('\n') || '', /New top-level test.*no explicit group assignment/);
});

test('test group runner rejects unexpected skips and missing required cases', t => {
  const skipFixture = createFixture(t, { unexpectedSkip: true });
  const skipped = invoke(skipFixture);
  assert.notEqual(skipped.status, 0);
  assert.match(skipped.evidence?.issues?.join('\n') || '', /unexpectedly skipped/);

  const missingFixture = createFixture(t);
  fs.writeFileSync(path.join(missingFixture.root, 'tests.js'), suiteSource().replace(
    "  await t.test('fixture accepted environment skip', { skip: 'baseline skip' }, () => {});", ''));
  const missing = invoke(missingFixture);
  assert.notEqual(missing.status, 0);
  assert.match(missing.evidence?.issues?.join('\n') || '', /Required baseline case.*missing/);
});

test('test group runner removes only its process temp files after failure', t => {
  const fixture = createFixture(t, { failOnRequest: true });
  const foreignPath = path.join(fixture.root, 'foreign-owner-data.txt');
  const result = invoke(fixture, { env: {
    CHAIN_GROUP_FIXTURE_FAILURE: '1',
    CHAIN_GROUP_FOREIGN_SENTINEL: foreignPath,
  } });
  assert.notEqual(result.status, 0);
  assert.equal(result.evidence?.status, 'failed');
  assert.equal(result.evidence.process.exitCode, 1);
  assert.match(result.evidence.issues.join('\n'), /Test case failed/);
  assert.equal(fs.existsSync(path.join(result.outputDir, 'runtime-tmp')), false, 'owned process temp directory is removed after a child failure');
  assert.equal(fs.readFileSync(foreignPath, 'utf8'), 'foreign owner data', 'foreign data survives group cleanup');
  assert.ok(fs.existsSync(path.join(result.outputDir, 'test.tap')), 'failure output remains available for diagnosis');
});

test('test group runner fails closed when a required native child registration is missing or duplicated', t => {
  const validFixture = createFixture(t, { processControl: true });
  const valid = invoke(validFixture, { group: 'native-process' });
  assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);
  assert.deepEqual(valid.evidence.processControls.map(control => control.registrationCount), [1]);

  const missingFixture = createFixture(t, { processControl: true, omitNativeControl: true });
  const missing = invoke(missingFixture, { group: 'native-process' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.evidence.issues.join('\n'), /registered 0 times/);

  const duplicateFixture = createFixture(t, { processControl: true, duplicateNativeControl: true });
  const duplicate = invoke(duplicateFixture, { group: 'native-process' });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.evidence.issues.join('\n'), /registered 2 times/);
});

test('RISK test group runner preserves hash identities and counts only executable controlled registrations', async t => {
  await t.test('literal hash titles reconcile against escaped TAP baseline identities', t => {
    const baselineRoot = 'fixture core escaped \\# baseline identity';
    const runtimeRoot = baselineRoot.replace('\\#', '#');
    const fixture = createFixture(t, { coreTitle: baselineRoot, runtimeCoreTitle: runtimeRoot });
    const fullEnv = { ...process.env };
    delete fullEnv.NODE_TEST_CONTEXT;
    const full = run(process.execPath, ['--test', '--test-reporter=tap', 'tests.js'], fixture.root, fullEnv);
    assert.equal(full.status, 0, `${full.stdout}\n${full.stderr}`);
    assert.ok(full.stdout.includes(`Subtest: ${baselineRoot}`), 'the actual Node TAP process escapes the literal hash in its reported title');
    const result = invoke(fixture);
    const tap = fs.readFileSync(path.join(result.outputDir, 'test.tap'), 'utf8');
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${tap}`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.root, 'scripts/test-group-inventory.json'), 'utf8')).rootTests[0].id,
      baselineRoot, 'independent baseline title remains captured in its original TAP-escaped form');
    assert.deepEqual(result.evidence.resultIdentity.baselineRootRuntimeMap, [{ baselineRoot, runtimeRoot }],
      'group evidence links the preserved baseline spelling to its canonical runtime identity');
    assert.deepEqual(result.evidence.cases.map(item => item.id).sort(), [
      runtimeRoot,
      `${runtimeRoot} > fixture accepted environment skip`,
    ].sort(), 'result identity uses the literal runtime title and retains every baseline case');
  });

  await t.test('quoted source fixture text is not a second native registration', t => {
    const fixture = createFixture(t, { processControl: true, processControlSourceFixture: true });
    const result = invoke(fixture, { group: 'native-process' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.evidence?.issues?.join('\n')}`);
    assert.deepEqual(result.evidence.processControls.map(control => control.registrationCount), [1]);
  });

  await t.test('a quoted sentinel cannot hide an omitted native registration', t => {
    const fixture = createFixture(t, { processControl: true, omitNativeControl: true, processControlSourceFixture: true });
    const result = invoke(fixture, { group: 'native-process' });
    assert.notEqual(result.status, 0, 'quoted source fixture text must not satisfy registration presence');
    assert.match(result.evidence.issues.join('\n'), /registered 0 times/);
  });

  await t.test('an actual duplicate native registration still fails closed', t => {
    const fixture = createFixture(t, { processControl: true, duplicateNativeControl: true, processControlSourceFixture: true });
    const result = invoke(fixture, { group: 'native-process' });
    assert.notEqual(result.status, 0, 'duplicate executable declarations must remain rejected');
    assert.match(result.evidence.issues.join('\n'), /registered 2 times/);
  });
});
