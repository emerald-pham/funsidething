import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseTap } from '../test-groups.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runner = path.join(repository, 'scripts/test-groups.mjs');
// Fixtures use the per-area tests/ layout the runner groups (#2213). A legacy
// single tests.js fixture exists only as a pre-split comparison base.
const suiteFile = 'tests/core.test.js';
const suiteCommand = 'node --test --test-concurrency=2 tests/*.test.js scripts/agent-tools/*.test.mjs';
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
  processControlSourceFixture = false, nativeTitle = fixtureRoots['native-process'], nativeReports = false } = {}) {
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
  if(process.env.CHAIN_DESCRIPTOR_SENTINEL) fs.writeFileSync(process.env.CHAIN_DESCRIPTOR_SENTINEL,'executed');
  await t.test('fixture accepted environment skip', { skip: 'baseline skip' }, () => {});${skip}${failingControl}
});
${additionalCoreRoots.map(title => `test(${JSON.stringify(title)}, () => {});`).join('\n')}
test(${JSON.stringify(fixtureRoots.scenery)}, () => {});
test(${JSON.stringify(fixtureRoots['persistence-recovery'])}, () => {});
test(${JSON.stringify(nativeTitle)}, () => {
  if (process.env.CHAIN_NATIVE_OUTPUT) fs.writeFileSync(path.join(process.env.CHAIN_NATIVE_OUTPUT, 'candidate-identity.json'), JSON.stringify({
    sha: process.env.CHAIN_NATIVE_CANDIDATE_SHA,
    tree: process.env.CHAIN_NATIVE_CANDIDATE_TREE,
  }));
  ${nativeReports ? `for(const mode of ['signed-out','reconcile-held'])fs.writeFileSync(path.join(process.env.CHAIN_NATIVE_OUTPUT,mode+'.json'),JSON.stringify({mode,status:'passed',oldCommit:'779defa4e8c3465fdf535fe17dbe2227d2b76ea1',candidateCommit:process.env.CHAIN_NATIVE_CANDIDATE_SHA,candidateTree:process.env.CHAIN_NATIVE_CANDIDATE_TREE,cleanup:{contextClosed:true,browserClosed:true,serverClosed:true}}));` : ''}
});
${nativeControl}${nativeControlSourceFixture}`;
}

function inventory(coreTitle = fixtureRoots.core, additionalCoreRoots = [], nativeTitle = fixtureRoots['native-process']) {
  const roots = [coreTitle, ...additionalCoreRoots, fixtureRoots.scenery, fixtureRoots['persistence-recovery'], nativeTitle, fixtureScriptRoot];
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
  const file = options.legacyLayout ? 'tests.js' : suiteFile;
  const rootAssignments = [
    { root: coreTitle, group: 'core', file },
    ...(options.additionalCoreRoots || []).map(root => ({ root, group: 'core', file })),
    { root: fixtureRoots.scenery, group: 'scenery', file },
    { root: fixtureRoots['persistence-recovery'], group: 'persistence-recovery', file },
    { root: options.nativeTitle || fixtureRoots['native-process'], group: 'native-process', file },
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
      file,
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
  fs.copyFileSync(path.join(repository,'scripts/agent-tools/ci-pass-reuse.mjs'),path.join(root,'scripts/agent-tools/ci-pass-reuse.mjs'));
  const coreTitle = options.coreTitle || fixtureRoots.core;
  writeJson(path.join(root, 'package.json'), {
    type: 'module',
    scripts: { 'test:group': 'node scripts/test-groups.mjs', test: options.legacyLayout ? 'node --test tests.js scripts/agent-tools/*.test.mjs' : suiteCommand },
  });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, options.legacyLayout ? 'tests.js' : suiteFile), suiteSource({ ...options, coreTitle, runtimeCoreTitle: options.runtimeCoreTitle || coreTitle }));
  fs.writeFileSync(path.join(root, 'scripts/agent-tools/fixture.test.mjs'),
    `import { test } from 'node:test';\ntest(${JSON.stringify(fixtureScriptRoot)}, () => {});\n`);
  writeJson(path.join(root, 'scripts/test-group-inventory.json'), inventory(coreTitle, options.additionalCoreRoots || [], options.nativeTitle));
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

function isolatedFixtureNativeOutput(fixture, inheritedEnvironment = process.env) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-group-native-fixture-'));
  fixture.outputs.push(output);
  return {
    output,
    env: {
      ...inheritedEnvironment,
      CHAIN_NATIVE_OUTPUT: output,
      CHAIN_NATIVE_CANDIDATE_SHA: fixture.sourceSha,
      CHAIN_NATIVE_CANDIDATE_TREE: git(fixture.root, 'rev-parse', 'HEAD^{tree}'),
    },
  };
}

function invoke(fixture, { group = 'core', env = {}, repository = 'example/fixture', outputDir: requestedOutputDir, args = [], consumer = false } = {}) {
  const outputDir = requestedOutputDir || path.join(os.tmpdir(), `chain-test-group-output-${process.pid}-${++outputSerial}`);
  fixture.outputs.push(outputDir);
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  const selectedArgs = ['--group', group, '--output-dir', outputDir,
    '--repository', repository, '--event-policy', 'local', '--run-id', 'fixture-run-1', '--run-attempt', '1',
    '--source-sha', fixture.sourceSha, '--comparison-base', fixture.comparisonBase, ...args];
  const result = consumer ? run(process.execPath,['scripts/agent-tools/ci-pass-reuse.mjs','run-group',...selectedArgs],fixture.root,childEnv)
    : run('npm',['run','test:group','--',...selectedArgs],fixture.root,childEnv);
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
  const outerNativeOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-group-outer-native-'));
  fs.rmSync(outerNativeOutput, { recursive: true });
  fixture.outputs.push(outerNativeOutput);
  const fixtureArgs = ['--test', '--test-reporter=tap', suiteFile, 'scripts/agent-tools/fixture.test.mjs'];
  const callerEnv = {
    ...process.env,
    CHAIN_NATIVE_OUTPUT: outerNativeOutput,
    CHAIN_NATIVE_CANDIDATE_SHA: fixture.sourceSha,
    CHAIN_NATIVE_CANDIDATE_TREE: git(fixture.root, 'rev-parse', 'HEAD^{tree}'),
  };
  delete callerEnv.NODE_TEST_CONTEXT;
  const unisolated = run(process.execPath, fixtureArgs, fixture.root, callerEnv);
  const unisolatedOutput = `${unisolated.stdout}\n${unisolated.stderr}`;
  assert.notEqual(unisolated.status, 0, 'the nested fixture proves it writes to its inherited native output without isolation');
  const negativeControlError = unisolatedOutput.split(/\r?\n/).find(line => line.includes('ENOENT') && line.includes('candidate-identity.json'));
  assert.ok(negativeControlError, `expected ENOENT for candidate-identity.json, got:\n${unisolatedOutput}`);
  t.diagnostic(`Nested output negative control: ${negativeControlError}`);
  assert.equal(fs.existsSync(outerNativeOutput), false, 'the missing caller evidence directory is not created implicitly');

  const nativeFixture = isolatedFixtureNativeOutput(fixture, callerEnv);
  const fullEnv = { ...nativeFixture.env };
  assert.notEqual(fullEnv.CHAIN_NATIVE_OUTPUT, callerEnv.CHAIN_NATIVE_OUTPUT, 'the nested fixture gets a separate output directory');
  const full = run(process.execPath, fixtureArgs, fixture.root, fullEnv);
  assert.equal(full.status, 0, `${full.stdout}\n${full.stderr}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(nativeFixture.output, 'candidate-identity.json'), 'utf8')),
    { sha: fixture.sourceSha, tree: fullEnv.CHAIN_NATIVE_CANDIDATE_TREE }, 'the nested full fixture keeps candidate identity in its own output directory');
  assert.equal(fs.existsSync(path.join(outerNativeOutput, 'candidate-identity.json')), false, 'the nested fixture does not write into its caller native output');
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
  fs.writeFileSync(path.join(fixture.root, suiteFile), suiteSource({ coreTitle: newRoot }));
  const groupAssignments = JSON.parse(fs.readFileSync(path.join(fixture.root, 'scripts/test-group-assignments.json'), 'utf8'));
  groupAssignments.rootAssignments = groupAssignments.rootAssignments.filter(item => item.root !== oldRoot);
  groupAssignments.rootAssignments.push({ root: newRoot, group: 'core', file: suiteFile });
  groupAssignments.rootAssignments.sort((a, b) => a.root.localeCompare(b.root));
  groupAssignments.rootReplacements = [{
    baselineRoot: oldRoot,
    currentRoot: newRoot,
    baselineGroup: 'core',
    group: 'core',
    file: suiteFile,
    reason: 'The renamed fixture title preserves its historical child assertions and case identities.',
  }];
  writeJson(path.join(fixture.root, 'scripts/test-group-assignments.json'), groupAssignments);
  git(fixture.root, 'add', suiteFile, 'scripts/test-group-assignments.json');
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
  fs.appendFileSync(path.join(unclassifiedFixture.root, suiteFile), "\ntest('new unclassified root', () => {});\n");
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
  fs.writeFileSync(path.join(missingFixture.root, suiteFile), suiteSource().replace(
    "  await t.test('fixture accepted environment skip', { skip: 'baseline skip' }, () => {});", ''));
  const missing = invoke(missingFixture);
  assert.notEqual(missing.status, 0);
  assert.match(missing.evidence?.issues?.join('\n') || '', /Required baseline case.*missing/);
});

// #2194 CI (PR #2222): an added browser root gated on an environment variable
// skips in CI. It is accepted only through an explicit environmentSkips
// declaration that names the variable its registration actually skips on,
// only for a root the baseline inventory does not already own, and only while
// that variable is absent from the runner's environment.
test('RISK test inventory: the group runner accepts an added environment-gated skip only when declared and its variable is absent', t => {
  const addedRoot = 'fixture added environment-gated browser root';
  const reason = 'Needs a served app plus installed Chromium and WebKit, which CI groups do not provide.';
  const add = (fixture, { declare = true, environment = 'FIXTURE_BROWSER_URL', root = addedRoot } = {}) => {
    fs.appendFileSync(path.join(fixture.root, suiteFile), `\ntest(${JSON.stringify(addedRoot)},{skip:!process.env.FIXTURE_BROWSER_URL},()=>{});\n`);
    const file = path.join(fixture.root, 'scripts/test-group-assignments.json'), value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.rootAssignments.push({ root: addedRoot, group: 'core', file: suiteFile });
    if (declare) value.environmentSkips = [{ root, environment, reason }];
    writeJson(file, value);
  };
  const issues = result => result.evidence?.issues?.join('\n') || `${result.stdout}\n${result.stderr}`;
  const undeclared = createFixture(t); add(undeclared, { declare: false });
  const rejected = invoke(undeclared);
  assert.notEqual(rejected.status, 0);
  assert.match(issues(rejected), /unexpectedly skipped: fixture added environment-gated browser root/);

  const declared = createFixture(t); add(declared);
  const accepted = invoke(declared);
  assert.equal(accepted.status, 0, issues(accepted));
  assert.deepEqual(accepted.evidence?.environmentSkips, [{ root: addedRoot, environment: 'FIXTURE_BROWSER_URL', status: 'skipped' }],
    'the result records the declared environment skip it accepted');

  const running = createFixture(t); add(running);
  const executed = invoke(running, { env: { FIXTURE_BROWSER_URL: 'http://127.0.0.1:1/' } });
  assert.equal(executed.status, 0, issues(executed));
  assert.deepEqual(executed.evidence?.environmentSkips, [{ root: addedRoot, environment: 'FIXTURE_BROWSER_URL', status: 'passed' }],
    'with its variable set the declared root runs and passes');

  const mismatched = createFixture(t); add(mismatched, { environment: 'OTHER_BROWSER_URL' });
  const wrongVariable = invoke(mismatched);
  assert.notEqual(wrongVariable.status, 0);
  assert.match(issues(wrongVariable), /Environment skip .* is not registered with \{skip:!process\.env\.OTHER_BROWSER_URL\}/);

  const baseline = createFixture(t); add(baseline, { root: fixtureRoots.scenery });
  const baselineDeclared = invoke(baseline);
  assert.notEqual(baselineDeclared.status, 0);
  assert.match(issues(baselineDeclared), /Environment skip .* must name an added root/);
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

test('test group runner names why a test failed in the job log', t => {
  const fixture = createFixture(t, { failOnRequest: true });
  const result = invoke(fixture, { env: {
    CHAIN_GROUP_FIXTURE_FAILURE: '1',
    CHAIN_GROUP_FOREIGN_SENTINEL: path.join(fixture.root, 'foreign-owner-data.txt'),
  } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^Test case failed: fixture core baseline root: intentional fixture process failure$/m, 'the failed job log gives the assertion without downloading an artifact');
});

// Roots appended here throw exactly what their source says; the expected log
// text below is written out by hand, not derived from the runner's own parsing.
function failingRootsFixture(t, roots) {
  const fixture = createFixture(t);
  fs.appendFileSync(path.join(fixture.root, suiteFile), roots.map(([title, body]) => `\ntest(${JSON.stringify(title)}, () => { ${body} });\n`).join(''));
  const file = path.join(fixture.root, 'scripts/test-group-assignments.json'), catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  catalog.rootAssignments.push(...roots.map(([root]) => ({ root, group: 'core', file: suiteFile })));
  writeJson(file, catalog);
  git(fixture.root, 'add', '.'); git(fixture.root, 'commit', '-qm', 'failing assertion roots');
  fixture.sourceSha = git(fixture.root, 'rev-parse', 'HEAD');
  return fixture;
}
const failureLine = (stderr, title) => {
  const lines = stderr.split('\n').filter(line => line.startsWith(`Test case failed: ${title}: `));
  assert.equal(lines.length, 1, `exactly one log line names ${title}`);
  return lines[0].slice(`Test case failed: ${title}: `.length);
};

test('test group runner keeps a failed test reason to one capped line of the first assertion', t => {
  const fixture = failingRootsFixture(t, [
    ['fixture long assertion root', 'assert.fail("x".repeat(5000));'],
    ['fixture multi-line assertion root', 'throw new Error("first assertion line\\n\\nboard data stays out of the log\\n");'],
    ['fixture long multi-line assertion root', 'throw new Error("y".repeat(5000) + "\\nsecond line");'],
    ['fixture terminal escape assertion root', 'throw new Error("\\u001b[31mcolored first line\\u001b[0m\\nrest");'],
  ]);
  const result = invoke(fixture);
  assert.notEqual(result.status, 0);
  assert.equal(failureLine(result.stderr, 'fixture multi-line assertion root'), 'first assertion line');
  assert.doesNotMatch(result.stderr, /board data stays out of the log/, 'only the first assertion line reaches the public log');
  for (const [title, character] of [['fixture long assertion root', 'x'], ['fixture long multi-line assertion root', 'y']]) {
    const reason = failureLine(result.stderr, title);
    assert.ok(reason.length <= 200, `${title} stays within the 200 character cap: ${reason.length}`);
    assert.ok(reason.startsWith(character.repeat(150)), `${title} keeps the start of its assertion`);
  }
  assert.doesNotMatch(result.stderr, /second line/);
  const escaped = failureLine(result.stderr, 'fixture terminal escape assertion root');
  assert.doesNotMatch(escaped, /\u001b/, 'terminal control characters do not reach the log');
  assert.match(escaped, /colored first line/);
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
    const nativeFixture = isolatedFixtureNativeOutput(fixture);
    const fullEnv = { ...nativeFixture.env };
    delete fullEnv.NODE_TEST_CONTEXT;
    const full = run(process.execPath, ['--test', '--test-reporter=tap', suiteFile], fixture.root, fullEnv);
    assert.equal(full.status, 0, `${full.stdout}\n${full.stderr}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(nativeFixture.output, 'candidate-identity.json'), 'utf8')),
      { sha: fixture.sourceSha, tree: fullEnv.CHAIN_NATIVE_CANDIDATE_TREE }, 'the nested full fixture writes its own candidate identity');
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


test('test group descriptor validates every group without executing a test child', t => {
  const fixture=createFixture(t),sentinel=path.join(fixture.root,'child-executed');
  const result=invoke(fixture,{args:['--describe'],env:{CHAIN_DESCRIPTOR_SENTINEL:sentinel}});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(fs.existsSync(sentinel),false,'describing required coverage must not execute the selected test cohort');
  const descriptor=JSON.parse(fs.readFileSync(path.join(result.outputDir,'descriptor.json'),'utf8'));
  assert.deepEqual(descriptor.groups.map(group=>group.id),groups);
  assert.deepEqual(descriptor.groups[0].requiredCaseIds,[fixtureRoots.core,fixtureRoots.core+' > fixture accepted environment skip']);
  assert.equal(result.evidence.status,'described');
});


test('test group aggregate rejects a missing result even when every process exits zero', t => {
  const fixture=createFixture(t),collected=fs.mkdtempSync(path.join(os.tmpdir(),'chain-group-aggregate-'));
  t.after(()=>fs.rmSync(collected,{recursive:true,force:true}));
  for(const group of groups){const result=invoke(fixture,{group});assert.equal(result.status,0,result.stdout+result.stderr);fs.cpSync(result.outputDir,path.join(collected,group),{recursive:true});}
  fs.rmSync(path.join(collected,'scenery','result.json'));
  const needs=path.join(collected,'needs.json');writeJson(needs,Object.fromEntries(['validation-context','event-gates','cohort-routing','regression'].map(id=>[id,{result:'success'}])));
  const result=invoke(fixture,{args:['--aggregate','--results-dir',collected,'--needs-json',needs]});
  assert.notEqual(result.status,0,'zero process exits cannot approve an absent required group result');
  assert.match(result.stderr,/missing|required|result/i);
});

test('test group selection executes every uncertain routing scenario under its assigned parent', t => {
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^workflow routing rejects uncertain producer contexts$',path.join(repository,'scripts/agent-tools/ci-routing.test.mjs')],{env,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/# tests 27\b/,'the assigned root must execute all26 uncertain scenarios plus its parent');
});

test('test group preflight rejects a passing dynamic row added at an unchanged registration site', t => {
  const fixture=createFixture(t),file=path.join(fixture.root,suiteFile);
  fs.appendFileSync(file,"\nconst futureDynamicRows=[];for(const title of futureDynamicRows)test(title,()=>{});\n");
  git(fixture.root,'add',suiteFile);git(fixture.root,'commit','-qm','existing dynamic registration site');
  fixture.comparisonBase=git(fixture.root,'rev-parse','HEAD');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('futureDynamicRows=[]','futureDynamicRows=["unclassified future dynamic row"]'));
  git(fixture.root,'add',suiteFile);git(fixture.root,'commit','-qm','add an unclassified data row');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
  const result=invoke(fixture);
  assert.notEqual(result.status,0,'a passing unknown runtime root must not disappear from the required grouped cohort');
  assert.match(result.stderr,/unclassified.*dynamic|dynamic.*unclassified/i);
});


function aggregateFixture(t) {
  const fixture=createFixture(t,{nativeTitle:'RISK repository process: required installed-client native outcomes and artifacts execute exactly once',nativeReports:true});
  fixture.originals=new Map();
  for(const group of groups){const result=invoke(fixture,{group});assert.equal(result.status,0,result.stdout+result.stderr);fixture.originals.set(group,result.outputDir);}
  return fixture;
}
function aggregateCopy(t,fixture,mutate=()=>{},args=[],env={}) {
  const collected=fs.mkdtempSync(path.join(os.tmpdir(),'chain-group-aggregate-'));t.after(()=>fs.rmSync(collected,{recursive:true,force:true}));
  for(const [id,output]of fixture.originals)fs.cpSync(output,path.join(collected,id),{recursive:true});
  const needs=path.join(collected,'needs.json');writeJson(needs,Object.fromEntries(['validation-context','event-gates','cohort-routing','regression'].map(id=>[id,{result:'success'}])));
  mutate(collected,needs);
  return invoke(fixture,{args:['--aggregate','--results-dir',collected,'--needs-json',needs,...args],env});
}
test('test group aggregate verifies the complete actual cohort and native artifacts', t => {
  const fixture=aggregateFixture(t),result=aggregateCopy(t,fixture);
  assert.equal(result.status,0,result.stdout+result.stderr);
  const report=JSON.parse(fs.readFileSync(path.join(result.outputDir,'aggregate.json'),'utf8'));
  assert.equal(report.status,'passed');assert.equal(report.groups.length,4);assert.equal(report.caseCount,6);
});
test('test group aggregate rejects corrupt outcomes identities jobs and native evidence', async parent => {
  const fixture=aggregateFixture(parent);
  const scenarios=[
    ['empty cases',root=>{const f=path.join(root,'core/result.json'),x=JSON.parse(fs.readFileSync(f));x.cases=[];writeJson(f,x);}],
    ['wrong source',root=>{const f=path.join(root,'core/result.json'),x=JSON.parse(fs.readFileSync(f));x.resultIdentity.sourceSha='a'.repeat(40);writeJson(f,x);}],
    ['wrong attempt',root=>{const f=path.join(root,'core/result.json'),x=JSON.parse(fs.readFileSync(f));x.resultIdentity.runAttempt=2;writeJson(f,x);}],
    ['dirty checkout',root=>{const f=path.join(root,'core/result.json'),x=JSON.parse(fs.readFileSync(f));x.resultIdentity.checkoutDirty=true;writeJson(f,x);}],
    ['canceled process',root=>{const f=path.join(root,'core/result.json'),x=JSON.parse(fs.readFileSync(f));x.process.signal='SIGTERM';writeJson(f,x);}],
    ['forbidden skip',root=>{const f=path.join(root,'core/result.json'),x=JSON.parse(fs.readFileSync(f));x.cases.find(item=>item.status==='passed').status='skipped';writeJson(f,x);}],
    ['malformed guard TAP with valid file hash',root=>{const file=path.join(root,'core/result.json'),record=JSON.parse(fs.readFileSync(file)),tap=record.unclassifiedRootGuard.files[0].stdout,absolute=path.join(root,'core',tap.path);fs.writeFileSync(absolute,'TAP version 13\nmalformed incomplete output\n');tap.sha256=createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');writeJson(file,record);}],
    ['missing guard',root=>{const f=path.join(root,'core/result.json'),x=JSON.parse(fs.readFileSync(f));delete x.unclassifiedRootGuard;writeJson(f,x);}],
    ['corrupt TAP',root=>fs.appendFileSync(path.join(root,'core/test.tap'),'corruption')],
    ['unlisted native evidence',root=>fs.writeFileSync(path.join(root,'native-process/native/unlisted.json'),'{}')],
    ['nonempty guard summary with valid file hash',root=>{const file=path.join(root,'core/result.json'),record=JSON.parse(fs.readFileSync(file)),summary=record.unclassifiedRootGuard.files[0].summary,absolute=path.join(root,'core',summary.path),rows=fs.readFileSync(absolute,'utf8').trim().split('\n').map(JSON.parse);rows.find(row=>row.file).counts.tests=1;fs.writeFileSync(absolute,rows.map(JSON.stringify).join('\n')+'\n');summary.sha256=createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');writeJson(file,record);}],
    ['missing native artifact',root=>fs.rmSync(path.join(root,'native-process/native/signed-out.json'))],
    ['duplicate group',root=>fs.cpSync(path.join(root,'core'),path.join(root,'extra-core'),{recursive:true})],
    ['wrong native candidate with valid file hash',root=>{const file=path.join(root,'native-process/native/signed-out.json'),report=JSON.parse(fs.readFileSync(file));report.candidateCommit='a'.repeat(40);writeJson(file,report);const resultFile=path.join(root,'native-process/result.json'),result=JSON.parse(fs.readFileSync(resultFile)),artifact=result.artifacts.find(item=>item.path==='native/signed-out.json'),bytes=fs.readFileSync(file);artifact.bytes=bytes.length;artifact.sha256=createHash('sha256').update(bytes).digest('hex');writeJson(resultFile,result);}],
    ['incomplete native cleanup with valid file hash',root=>{const file=path.join(root,'native-process/native/reconcile-held.json'),report=JSON.parse(fs.readFileSync(file));report.cleanup.serverClosed=false;writeJson(file,report);const resultFile=path.join(root,'native-process/result.json'),result=JSON.parse(fs.readFileSync(resultFile)),artifact=result.artifacts.find(item=>item.path==='native/reconcile-held.json'),bytes=fs.readFileSync(file);artifact.bytes=bytes.length;artifact.sha256=createHash('sha256').update(bytes).digest('hex');writeJson(resultFile,result);}],

    ['failed gate',(_root,file)=>{const needs=JSON.parse(fs.readFileSync(file));needs['event-gates'].result='failure';writeJson(file,needs);}],
    ['canceled group',(_root,file)=>{const needs=JSON.parse(fs.readFileSync(file));needs.regression.result='cancelled';writeJson(file,needs);}],
    ['skipped required job',(_root,file)=>{const needs=JSON.parse(fs.readFileSync(file));needs.regression.result='skipped';writeJson(file,needs);}],
  ];
  for(const [name,mutate]of scenarios)await parent.test(name,t=>{const result=aggregateCopy(t,fixture,mutate);assert.notEqual(result.status,0,'aggregate must reject '+name);});
});

// Cross-engine (Chromium + WebKit) native checks run in the scheduled and
// manually dispatched nightly job instead of the per-push required cohort, so an
// engine-specific failure cannot block unrelated fixes (#2210). A declared
// nightly root stays out of every required group, never executes there, and is
// never needed by the required aggregate.
const installedClientRoot='RISK repository process: required installed-client native outcomes and artifacts execute exactly once';
const nightlyFixtureRoot='fixture cross-engine native button root';
function nightlyFixture(t,{body='()=>{if(process.env.CHAIN_NIGHTLY_SENTINEL)fs.writeFileSync(process.env.CHAIN_NIGHTLY_SENTINEL,"executed");}',nightlyRoots=[{root:nightlyFixtureRoot,file:suiteFile,reason:'Fixture cross-engine case runs in the nightly job only.'}]}={}){
  const fixture=createFixture(t,{nativeTitle:installedClientRoot,nativeReports:true});
  fs.appendFileSync(path.join(fixture.root,suiteFile),`\ntest(${JSON.stringify(nightlyFixtureRoot)},${body});\n`);
  const file=path.join(fixture.root,'scripts/test-group-assignments.json'),catalog=JSON.parse(fs.readFileSync(file,'utf8'));catalog.nightlyRoots=nightlyRoots;writeJson(file,catalog);
  git(fixture.root,'add','.');git(fixture.root,'commit','-qm','nightly cross-engine root');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
  return fixture;
}
test('test group required cohort passes without nightly cross-engine cases and never executes them', t => {
  const fixture=nightlyFixture(t),sentinel=path.join(fixture.root,'nightly-executed');
  const description=invoke(fixture,{args:['--describe']});
  assert.equal(description.status,0,description.stdout+description.stderr);
  const descriptor=JSON.parse(fs.readFileSync(path.join(description.outputDir,'descriptor.json'),'utf8'));
  assert.ok(descriptor.groups.every(group=>!group.roots.includes(nightlyFixtureRoot)&&!group.requiredCaseIds.some(id=>id===nightlyFixtureRoot||id.startsWith(nightlyFixtureRoot+' > '))),'the required cohort must exclude nightly cross-engine cases');
  assert.ok(descriptor.groups.find(group=>group.id==='native-process').roots.includes(installedClientRoot),'the installed-client cases stay in the required cohort');
  fixture.originals=new Map();
  for(const group of groups){const result=invoke(fixture,{group,env:{CHAIN_NIGHTLY_SENTINEL:sentinel}});assert.equal(result.status,0,result.stdout+result.stderr);fixture.originals.set(group,result.outputDir);}
  const result=aggregateCopy(t,fixture);
  assert.equal(result.status,0,'the required aggregate must pass without the nightly cases: '+result.stdout+result.stderr);
  assert.equal(fs.existsSync(sentinel),false,'no required group or registration guard may execute a nightly case');
  const report=JSON.parse(fs.readFileSync(path.join(result.outputDir,'aggregate.json'),'utf8'));
  assert.equal(report.status,'passed');assert.equal(report.groups.length,4);assert.equal(report.caseCount,6);
});
test('test group nightly declarations cannot remove required or installed-client cases from the required cohort', async parent => {
  const nightly=root=>({root,file:suiteFile,reason:'Attempted move of a required case to the nightly job.'});
  const scenarios=[
    ['installed-client owner root',installedClientRoot],
    ['installed-client signed-out case','RISK native installed-client delivery: signed-out'],
    ['installed-client reconcile-held case','RISK native installed-client delivery: reconcile-held'],
    ['required group root',fixtureRoots.scenery],
  ];
  for(const [name,root]of scenarios)await parent.test(name,t=>{
    const fixture=nightlyFixture(t);fixture.originals=new Map();
    for(const group of groups){const result=invoke(fixture,{group});assert.equal(result.status,0,result.stdout+result.stderr);fixture.originals.set(group,result.outputDir);}
    const file=path.join(fixture.root,'scripts/test-group-assignments.json'),catalog=JSON.parse(fs.readFileSync(file,'utf8'));
    catalog.nightlyRoots.push(nightly(root));writeJson(file,catalog);git(fixture.root,'add','.');git(fixture.root,'commit','-qm','declare a required case nightly');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
    const description=invoke(fixture,{args:['--describe']});
    assert.notEqual(description.status,0,'describing the required cohort must refuse a nightly '+name);
    assert.match(description.stderr,/nightly/i);
    const aggregate=aggregateCopy(t,fixture);
    assert.notEqual(aggregate.status,0,'the required aggregate must refuse a nightly '+name);
    assert.match(aggregate.stderr,/nightly/i,'the aggregate must name the nightly declaration, not an unrelated identity mismatch');
  });
});
test('test group aggregate with nightly roots still fails closed on missing duplicate skipped failed groups and installed-client reports', async parent => {
  const fixture=nightlyFixture(parent);fixture.originals=new Map();
  for(const group of groups){const result=invoke(fixture,{group});assert.equal(result.status,0,result.stdout+result.stderr);fixture.originals.set(group,result.outputDir);}
  const scenarios=[
    ['missing required group',root=>fs.rmSync(path.join(root,'native-process'),{recursive:true,force:true})],
    ['duplicate required group',root=>fs.cpSync(path.join(root,'core'),path.join(root,'core-copy'),{recursive:true})],
    ['nightly results offered as a required group',root=>fs.cpSync(path.join(root,'native-process'),path.join(root,'nightly-cross-engine'),{recursive:true})],
    ['skipped required job',(_root,file)=>{const needs=JSON.parse(fs.readFileSync(file));needs.regression.result='skipped';writeJson(file,needs);}],
    ['failed required group',root=>{const f=path.join(root,'scenery/result.json'),x=JSON.parse(fs.readFileSync(f));x.status='failed';writeJson(f,x);}],
    ['missing installed-client signed-out report',root=>fs.rmSync(path.join(root,'native-process/native/signed-out.json'))],
    ['missing installed-client reconcile-held report',root=>fs.rmSync(path.join(root,'native-process/native/reconcile-held.json'))],
  ];
  for(const [name,mutate]of scenarios)await parent.test(name,t=>{const result=aggregateCopy(t,fixture,mutate);assert.notEqual(result.status,0,'aggregate must reject '+name);});
});
test('test group nightly cohort runs only the declared cross-engine cases and fails visibly', async parent => {
  await parent.test('passing nightly case',t=>{
    const fixture=nightlyFixture(t),sentinel=path.join(fixture.root,'nightly-executed');
    const result=invoke(fixture,{group:'nightly-cross-engine',env:{CHAIN_NIGHTLY_SENTINEL:sentinel}});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(result.evidence.status,'passed');
    assert.deepEqual(result.evidence.cases.map(item=>[item.id,item.status]),[[nightlyFixtureRoot,'passed']],'only the declared nightly case executes');
    assert.equal(fs.existsSync(sentinel),true,'the nightly cohort must actually execute its case');
  });
  const failures=[
    ['failing engine case',{body:'()=>{throw new Error("webkit pageerror")}'},/failed/i],
    ['skipped engine case',{body:'{skip:"webkit unavailable"},()=>{}'},/skipped/i],
    ['declared case that is not registered',{nightlyRoots:[{root:nightlyFixtureRoot,file:suiteFile,reason:'Fixture cross-engine case runs in the nightly job only.'},{root:'fixture absent cross-engine root',file:suiteFile,reason:'Declared but missing from the source.'}]},/fixture absent cross-engine root/],
    ['no declared nightly cases',{nightlyRoots:[]},/no nightly cross-engine roots/i],
  ];
  for(const [name,options,message]of failures)await parent.test(name,t=>{
    const fixture=nightlyFixture(t,options);
    if(!options.nightlyRoots?.some(entry=>entry.root===nightlyFixtureRoot)&&options.nightlyRoots){
      // Without a declaration the appended root is unclassified; keep the fixture valid by assigning it to core.
      const file=path.join(fixture.root,'scripts/test-group-assignments.json'),catalog=JSON.parse(fs.readFileSync(file,'utf8'));catalog.rootAssignments.push({root:nightlyFixtureRoot,group:'core',file:suiteFile});writeJson(file,catalog);git(fixture.root,'add','.');git(fixture.root,'commit','-qm','assign root');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
    }
    const result=invoke(fixture,{group:'nightly-cross-engine'});
    assert.notEqual(result.status,0,'a nightly '+name+' must fail the nightly run');
    assert.notEqual(result.evidence?.status,'passed');
    assert.match(result.stderr,message);
  });
});

// #2293: a root whose test has not landed is declared pending with its owning
// PR. The job runs the active roots, and with none it succeeds while saying that
// no cross-engine case ran and naming what it is waiting for.
const pendingNightlyRoot='fixture pending cross-engine root';
const pendingEntry=(root=pendingNightlyRoot)=>({root,file:suiteFile,pendingOn:'#285',reason:'Fixture root whose test has not landed.'});
function pendingNightlyFixture(t,nightlyRoots){
  // nightlyFixture always registers its appended root; assign it to core when the catalog does not declare it.
  const fixture=nightlyFixture(t,{nightlyRoots});
  if(nightlyRoots.some(entry=>entry.root===nightlyFixtureRoot))return fixture;
  const file=path.join(fixture.root,'scripts/test-group-assignments.json'),catalog=JSON.parse(fs.readFileSync(file,'utf8'));
  catalog.rootAssignments.push({root:nightlyFixtureRoot,group:'core',file:suiteFile});
  writeJson(file,catalog);git(fixture.root,'add','.');git(fixture.root,'commit','-qm','pending nightly roots');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
  return fixture;
}
test('test group nightly with only pending roots succeeds, runs nothing and names them', t => {
  const fixture=pendingNightlyFixture(t,[pendingEntry()]),sentinel=path.join(fixture.root,'nightly-executed');
  const result=invoke(fixture,{group:'nightly-cross-engine',env:{CHAIN_NIGHTLY_SENTINEL:sentinel}});
  assert.equal(result.status,0,'only pending roots is not a broken run: '+result.stdout+result.stderr);
  assert.match(result.stdout,/^::notice [^\n]*\b0 cross-engine cases ran\b[^\n]*fixture pending cross-engine root[^\n]*#285/m,'the job must annotate zero cases and name the pending root with its owner');
  assert.equal(fs.existsSync(sentinel),false,'no test may execute when no root is active');
  assert.notEqual(result.evidence.status,'passed','zero cases must never be recorded as a pass');
  assert.deepEqual(result.evidence.cases,[]);
  assert.deepEqual(result.evidence.crossEngine,{casesRun:0,activeRoots:[],pendingRoots:[{root:pendingNightlyRoot,file:suiteFile,pendingOn:'#285'}]});
});
test('test group nightly preflight fails a pending root whose test has landed until it is moved to active', t => {
  const fixture=pendingNightlyFixture(t,[pendingEntry(nightlyFixtureRoot)]),sentinel=path.join(fixture.root,'nightly-executed');
  const description=invoke(fixture,{args:['--describe']});
  assert.equal(description.status,0,'required CI must not depend on the nightly pending state: '+description.stdout+description.stderr);
  const result=invoke(fixture,{group:'nightly-cross-engine',env:{CHAIN_NIGHTLY_SENTINEL:sentinel}});
  assert.notEqual(result.status,0,'a landed test must not go unrun behind a pending row');
  assert.equal(result.evidence.status,'preflight_failed');
  assert.match(result.stderr,/fixture cross-engine native button root.*#285.*active/,'the failure must name the root, its owner and the move to active');
  assert.equal(fs.existsSync(sentinel),false,'preflight stops before any test runs');
});
test('test group nightly runs active roots beside pending ones and states the count', t => {
  const active={root:nightlyFixtureRoot,file:suiteFile,reason:'Fixture active cross-engine root.'};
  const fixture=pendingNightlyFixture(t,[active,pendingEntry()]),sentinel=path.join(fixture.root,'nightly-executed');
  const result=invoke(fixture,{group:'nightly-cross-engine',env:{CHAIN_NIGHTLY_SENTINEL:sentinel}});
  assert.equal(result.status,0,'a pending root must not stop the active ones: '+result.stdout+result.stderr);
  assert.equal(result.evidence.status,'passed');
  assert.deepEqual(result.evidence.cases.map(item=>[item.id,item.status]),[[nightlyFixtureRoot,'passed']]);
  assert.equal(fs.existsSync(sentinel),true,'the active root must actually execute');
  assert.deepEqual(result.evidence.crossEngine,{casesRun:1,activeRoots:[nightlyFixtureRoot],pendingRoots:[{root:pendingNightlyRoot,file:suiteFile,pendingOn:'#285'}]});
  assert.match(result.stdout,/^::notice [^\n]*\b1 cross-engine case ran\b[^\n]*fixture pending cross-engine root[^\n]*#285/m);
});
test('test group nightly preflight still fails a missing active root beside a pending one', t => {
  const missing={root:'fixture misspelled active root',file:suiteFile,reason:'A typo in an active root must stay loud.'};
  const fixture=pendingNightlyFixture(t,[missing,pendingEntry()]);
  const result=invoke(fixture,{group:'nightly-cross-engine'});
  assert.notEqual(result.status,0,'a pending root must not excuse a missing active root');
  assert.equal(result.evidence.status,'preflight_failed');
  assert.match(result.stderr,/fixture misspelled active root.*registered 0 times/);
});
test('test group refuses a pending nightly root that names no owning PR', async parent => {
  for(const [name,pendingOn]of [['free text','soon'],['empty','']])await parent.test(name,t=>{
    const fixture=pendingNightlyFixture(t,[{...pendingEntry(),pendingOn}]);
    const description=invoke(fixture,{args:['--describe']});
    assert.notEqual(description.status,0,'a pending row without an owning PR must not validate');
    assert.match(description.stderr,/fixture pending cross-engine root.*owning PR/);
  });
});

test('test group nightly job log names why a cross-engine case failed', t => {
  const fixture = nightlyFixture(t, { body: '()=>{throw new Error("webkit pageerror")}' });
  const result = invoke(fixture, { group: 'nightly-cross-engine' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^Nightly case failed: fixture cross-engine native button root: webkit pageerror$/m);
});

// CI's answer for a diff, read from the actual router's plan: the descriptor's
// cohort less any verified reuse. --plan-only keeps the router off GitHub.
function ciRoutedGroups(fixture) {
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-group-listing-'));
  fixture.outputs.push(directory);
  const eventPath = path.join(directory, 'event.json');
  writeJson(eventPath, { after: head });
  const env = { ...process.env, GITHUB_REPOSITORY: 'example/fixture', GITHUB_RUN_ID: '41', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: eventPath, GITHUB_SHA: head, GITHUB_REF: 'refs/heads/topic' };
  for (const name of ['NODE_TEST_CONTEXT', 'GITHUB_OUTPUT', 'GITHUB_TOKEN']) delete env[name];
  const described = run('npm', ['run', 'test:group', '--', '--describe', '--group', 'core', '--output-dir', path.join(directory, 'described'),
    '--repository', 'example/fixture', '--event-policy', 'local', '--run-id', '41', '--run-attempt', '1', '--source-sha', head, '--comparison-base', fixture.comparisonBase], fixture.root, env);
  assert.equal(described.status, 0, described.stdout + described.stderr);
  const routed = run(process.execPath, [path.join(repository, 'scripts/agent-tools/ci-routing.mjs'), '--comparison-base', fixture.comparisonBase,
    '--evidence-dir', path.join(directory, 'routing'), '--plan-only', '1', '--descriptor', path.join(directory, 'described/descriptor.json')], fixture.root, env);
  assert.equal(routed.status, 0, routed.stdout + routed.stderr);
  const record = JSON.parse(fs.readFileSync(path.join(directory, 'routing/routing.json'), 'utf8'));
  assert.equal(record.decision, 'full');
  return record.cohortContext.expectedGroups.filter(group => !record.inputPasses[group]);
}
function listChangedGroups(fixture, ...args) {
  const env = { ...process.env };
  for (const name of ['NODE_TEST_CONTEXT', 'CHAIN_TEST_COMPARISON_BASE']) delete env[name];
  return run('npm', ['run', '--silent', 'test:group', '--', '--changed-groups', ...args], fixture.root, env);
}

test('test group listing gives the groups CI routes for a diff and writes nothing', async parent => {
  // A file only scenery tests read, and one no test reads: CI's input keys bind
  // the complete tree, so neither narrows the groups.
  for (const [name, file] of [['a diff touching a file scenery tests read', 'landscape.js'], ['a documentation-only diff', 'docs/note.md']]) await parent.test(name, t => {
    const fixture = createFixture(t);
    fs.mkdirSync(path.dirname(path.join(fixture.root, file)), { recursive: true });
    fs.writeFileSync(path.join(fixture.root, file), 'changed\n');
    // The router binds the workflow blob of the checkout it plans for.
    fs.mkdirSync(path.join(fixture.root, '.github/workflows'), { recursive: true });
    fs.writeFileSync(path.join(fixture.root, '.github/workflows/data-safety.yml'), 'fixture workflow\n');
    git(fixture.root, 'add', '.'); git(fixture.root, 'commit', '-qm', 'candidate diff');
    const listed = listChangedGroups(fixture, '--comparison-base', fixture.comparisonBase);
    assert.deepEqual(listed.stdout.trim().split('\n'), ['core', 'scenery', 'persistence-recovery', 'native-process'], listed.stderr);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stderr, /complete tree/, 'the listing says why no file set narrows it');
    assert.deepEqual(listed.stdout.trim().split('\n'), ciRoutedGroups(fixture), 'the listing and CI routing agree on the same diff');
    assert.equal(git(fixture.root, 'status', '--porcelain', '--untracked-files=all'), '', 'the listing leaves the checkout untouched');
  });
});

test('test group listing needs a known base and takes no evidence options', async parent => {
  const refused = [
    ['no comparison base', () => [], /comparison-base/],
    ['an unknown comparison base', () => ['--comparison-base', 'no-such-base'], /no-such-base/],
    ['an output directory', outputDir => ['--output-dir', outputDir, '--comparison-base', 'HEAD~1'], /--output-dir/],
    ['a group', () => ['--group', 'core', '--comparison-base', 'HEAD~1'], /--group/],
  ];
  for (const [name, args, message] of refused) await parent.test(name, t => {
    const fixture = createFixture(t), outputDir = path.join(os.tmpdir(), `chain-test-group-listing-refused-${process.pid}-${++outputSerial}`);
    fixture.outputs.push(outputDir);
    const listed = listChangedGroups(fixture, ...args(outputDir));
    assert.notEqual(listed.status, 0, `the listing must refuse ${name}: ${listed.stdout}`);
    assert.equal(listed.stdout, '', 'a refused listing names no groups');
    assert.match(listed.stderr, message);
    assert.equal(fs.existsSync(outputDir), false, 'a refused listing creates no output directory');
  });
  await parent.test('a branch or relative revision is accepted as the base', t => {
    const fixture = createFixture(t);
    const listed = listChangedGroups(fixture, '--comparison-base', 'HEAD~1');
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.stdout.trim().split('\n'), ['core', 'scenery', 'persistence-recovery', 'native-process']);
  });
});

// #2232: a declared root that resolves to zero tests must fail visibly. Describe
// checks every required root against its file before any group runs; a declared
// nightly root that resolves to nothing fails the nightly run's own preflight,
// while describe (required CI) stays green, as on main until #2248 lands.
test('test group describe and nightly preflight fail when a declared required or nightly root resolves to zero tests', async parent => {
  const absentNightlyRoot='fixture absent cross-engine root';
  await parent.test('required root removed from its file fails describe and its group run',t=>{
    const fixture=createFixture(t),file=path.join(fixture.root,suiteFile),registration=`test(${JSON.stringify(fixtureRoots.scenery)}, () => {});`;
    assert.ok(fs.readFileSync(file,'utf8').includes(registration),'fixture registers the scenery root');
    fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(registration,''));
    git(fixture.root,'add','.');git(fixture.root,'commit','-qm','drop a required registration');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
    const description=invoke(fixture,{args:['--describe']});
    assert.notEqual(description.status,0,'describe must not validate a required root that resolves to zero tests: '+description.stdout);
    assert.match(description.stderr,/fixture scenery baseline root.*resolves to zero tests/);
    const run=invoke(fixture,{group:'scenery'});
    assert.notEqual(run.status,0,'the group run must fail when its declared root executes nothing');
  });
  await parent.test('only declared nightly root resolves to zero tests',t=>{
    const fixture=nightlyFixture(t,{nightlyRoots:[{root:absentNightlyRoot,file:suiteFile,reason:'Declared but not registered on this branch.'}]});
    const file=path.join(fixture.root,'scripts/test-group-assignments.json'),catalog=JSON.parse(fs.readFileSync(file,'utf8'));
    catalog.rootAssignments.push({root:nightlyFixtureRoot,group:'core',file:suiteFile});writeJson(file,catalog);
    git(fixture.root,'add','.');git(fixture.root,'commit','-qm','assign root');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
    const description=invoke(fixture,{args:['--describe']});
    assert.equal(description.status,0,'required CI must stay green while only a nightly root is unresolved: '+description.stdout+description.stderr);
    const nightly=invoke(fixture,{group:'nightly-cross-engine'});
    assert.notEqual(nightly.status,0,'the nightly run must fail when its declared root resolves to zero tests');
    assert.notEqual(nightly.evidence?.status,'passed');
    assert.match(nightly.stderr,/fixture absent cross-engine root.*registered 0 times/);
  });
});

// #2232: every new root needed a hand-written row. A root with no row now takes
// its file's group from fileGroups; rows remain for overrides, dynamic titles and
// nightly roots. The cohort still binds every root, and a file with no default
// still rejects an unrowed root.
// Rewrites one collected group's TAP and keeps its hash and case report in
// step, as a consistent forgery would.
function rewriteGroupTap(root,group,edit){
  const resultFile=path.join(root,group,'result.json'),record=JSON.parse(fs.readFileSync(resultFile,'utf8'));
  const tapFile=path.join(root,group,record.process.stdout.path),tap=edit(fs.readFileSync(tapFile,'utf8'));
  fs.writeFileSync(tapFile,tap);
  record.process.stdout.sha256=createHash('sha256').update(tap).digest('hex');
  record.cases=parseTap(tap).map(({id,root:caseRoot,status,skipReason})=>({id,root:caseRoot,status,skipReason}));
  writeJson(resultFile,record);
}
function rootBlock(tap,title){
  const lines=tap.split('\n'),start=lines.indexOf('# Subtest: '+title);
  const result=lines.findIndex((line,index)=>index>start&&/^(?:not )?ok \d+ - /.test(line)&&line.endsWith(' - '+title));
  assert.ok(start>=0&&result>start,'the fixture TAP holds the root '+title);
  const end=lines[result+1]==='  ---'?lines.indexOf('  ...',result):result;
  return {lines,start,result,end};
}
const removeRootBlock=(tap,title)=>{const {lines,start,end}=rootBlock(tap,title);lines.splice(start,end-start+1);return lines.join('\n');};
const duplicateRootBlock=(tap,title)=>{const {lines,start,end}=rootBlock(tap,title);lines.splice(end+1,0,...lines.slice(start,end+1));return lines.join('\n');};
const editRootResult=(tap,title,edit)=>{const {lines,result}=rootBlock(tap,title);lines[result]=edit(lines[result]);return lines.join('\n');};
const defaultRoot='fixture root placed by its file',overrideRoot='fixture root overriding its file group';
function defaultByFileFixture(t,{fileGroups={[suiteFile]:'core','scripts/agent-tools/*.test.mjs':'native-process'}}={}){
  const fixture=createFixture(t,{nativeTitle:installedClientRoot,nativeReports:true});
  fs.appendFileSync(path.join(fixture.root,suiteFile),`\ntest(${JSON.stringify(defaultRoot)}, () => {});\ntest(${JSON.stringify(overrideRoot)}, () => {});\n`);
  const file=path.join(fixture.root,'scripts/test-group-assignments.json'),catalog=JSON.parse(fs.readFileSync(file,'utf8'));
  catalog.fileGroups=fileGroups;
  catalog.rootAssignments=catalog.rootAssignments.filter(entry=>entry.root!==fixtureRoots.core&&entry.root!==fixtureScriptRoot);
  catalog.rootAssignments.push({root:overrideRoot,group:'scenery',file:suiteFile});
  writeJson(file,catalog);git(fixture.root,'add','.');git(fixture.root,'commit','-qm','default roots by file');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
  return fixture;
}
test('test group roots without a row take their file group and rows override it', async parent => {
  await parent.test('describe groups and aggregate',t=>{
    const fixture=defaultByFileFixture(t);
    const description=invoke(fixture,{args:['--describe']});
    assert.equal(description.status,0,'unrowed roots must be classified by their file: '+description.stdout+description.stderr);
    const descriptor=JSON.parse(fs.readFileSync(path.join(description.outputDir,'descriptor.json'),'utf8')),roots=id=>descriptor.groups.find(group=>group.id===id).roots;
    assert.deepEqual(roots('core'),[defaultRoot,fixtureRoots.core].sort(),'a root with no row takes its file group');
    assert.ok(roots('scenery').includes(overrideRoot)&&!roots('core').includes(overrideRoot),'a row overrides the file group');
    assert.ok(roots('native-process').includes(fixtureScriptRoot),'a file matched by a pattern takes that group');
    fixture.originals=new Map();
    for(const group of groups){const result=invoke(fixture,{group});assert.equal(result.status,0,group+': '+result.stdout+result.stderr);fixture.originals.set(group,result.outputDir);}
    assert.ok(readEvidence(fixture.originals.get('core')).cases.some(item=>item.id===defaultRoot&&item.status==='passed'),'the defaulted root executes in its file group');
    assert.ok(readEvidence(fixture.originals.get('scenery')).cases.some(item=>item.id===overrideRoot&&item.status==='passed'),'the override executes in its row group');
    const aggregate=aggregateCopy(t,fixture);
    assert.equal(aggregate.status,0,aggregate.stdout+aggregate.stderr);
    // Each forgery keeps the group's TAP, its hash and its case report
    // consistent, so the aggregate must reject it at the named check rather than
    // at an earlier report/TAP mismatch.
    const label=title=>JSON.stringify(title).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    for(const [name,mutate,message] of [
      ['missing defaulted case',root=>rewriteGroupTap(root,'core',tap=>removeRootBlock(tap,defaultRoot)),new RegExp(`Assigned root ${label(defaultRoot)} did not execute`)],
      ['skipped defaulted case',root=>rewriteGroupTap(root,'core',tap=>editRootResult(tap,defaultRoot,line=>line+' # SKIP forged')),new RegExp(`unexpectedly skipped: ${defaultRoot}`)],
      ['failed override case',root=>rewriteGroupTap(root,'scenery',tap=>editRootResult(tap,overrideRoot,line=>'not '+line)),new RegExp(`Test case failed: ${overrideRoot}`)],
      ['duplicate defaulted case',root=>rewriteGroupTap(root,'core',tap=>duplicateRootBlock(tap,defaultRoot)),new RegExp(`Root ${label(defaultRoot)} executed more than once`)],
      ['missing installed-client report',root=>{const f=path.join(root,'native-process/result.json'),x=JSON.parse(fs.readFileSync(f,'utf8'));fs.rmSync(path.join(root,'native-process/native/signed-out.json'));x.artifacts=x.artifacts.filter(item=>item.path!=='native/signed-out.json');writeJson(f,x);},/Both required distinct native reports must be present/],
    ]){
      const rejected=aggregateCopy(t,fixture,mutate);
      assert.notEqual(rejected.status,0,'aggregate must reject '+name);
      assert.match(rejected.stderr,message,'aggregate must reject '+name+' at its own check');
      assert.doesNotMatch(rejected.stderr,/case report differs from actual TAP|Artifact missing or wrong size/,'the forgery for '+name+' must stay internally consistent');
    }
  });
  await parent.test('a root in a file without a default group still needs a row',t=>{
    const fixture=defaultByFileFixture(t,{fileGroups:{[suiteFile]:'core'}});
    const description=invoke(fixture,{args:['--describe']});
    assert.notEqual(description.status,0,'a file without a default group cannot place its roots');
    assert.match(description.stderr,/fixture agent-tools baseline root/);
  });
  await parent.test('an unrowed dynamic title in a defaulted file still fails the registration guard',t=>{
    const fixture=defaultByFileFixture(t),file=path.join(fixture.root,suiteFile);
    fs.appendFileSync(file,'\nfor(const title of ["fixture unrowed dynamic root"])test(title,()=>{});\n');
    git(fixture.root,'add','.');git(fixture.root,'commit','-qm','dynamic root without a row');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
    const result=invoke(fixture);
    assert.notEqual(result.status,0,'a computed title cannot be placed by its file and must not run unclassified');
    assert.match(result.stderr,/fixture unrowed dynamic root/);
  });
});

// #2232: heavy roots were hand-moved between groups to stay under Node's default
// heap. A group may declare its heap instead; the runner passes it to the group's
// Node test process, whose per-file children inherit it.
const heapProbeRoot='fixture heap probe root';
function heapFixture(t,heap){
  const fixture=createFixture(t);
  fs.appendFileSync(path.join(fixture.root,suiteFile),`\ntest(${JSON.stringify(heapProbeRoot)}, async () => { if (process.env.CHAIN_HEAP_PROBE) fs.writeFileSync(process.env.CHAIN_HEAP_PROBE, String((await import('node:v8')).default.getHeapStatistics().heap_size_limit)); });\n`);
  const file=path.join(fixture.root,'scripts/test-group-assignments.json'),catalog=JSON.parse(fs.readFileSync(file,'utf8'));
  catalog.groups.find(group=>group.id==='scenery').nodeMaxOldSpaceSizeMb=heap;
  catalog.rootAssignments.push({root:heapProbeRoot,group:'scenery',file:suiteFile});
  writeJson(file,catalog);git(fixture.root,'add','.');git(fixture.root,'commit','-qm','group heap');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
  return fixture;
}
test('test group runs a group with its declared Node heap and rejects an invalid heap', async parent => {
  await parent.test('declared heap reaches the test process',t=>{
    const fixture=heapFixture(t,1536),probe=path.join(fixture.root,'heap-limit');
    const result=invoke(fixture,{group:'scenery',env:{CHAIN_HEAP_PROBE:probe}});
    assert.equal(result.status,0,result.stdout+result.stderr);
    const limitMb=Number(fs.readFileSync(probe,'utf8'))/1048576;
    assert.ok(Math.abs(limitMb-1536)<128,`the scenery test process must run with its declared 1536 MB old space, observed ${limitMb.toFixed(0)} MB heap limit`);
    assert.equal(result.evidence.process.nodeMaxOldSpaceSizeMb,1536,'the result records the heap the group ran with');
  });
  for(const [name,heap] of [['too small',64],['not a whole number',2048.5],['larger than the runner',65536],['not a number','8192']])await parent.test('invalid heap: '+name,t=>{
    const fixture=heapFixture(t,heap),result=invoke(fixture,{args:['--describe']});
    assert.notEqual(result.status,0,'an invalid group heap must fail closed');
    assert.match(result.stderr,/heap/i);
  });
});

test('test group workflow scanner command rejects missing parallel group evidence', t => {
  const fixture=createFixture(t),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'chain-workflow-aggregate-'));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));fs.mkdirSync(path.join(temporary,'groups'));
  for(const group of groups){const result=invoke(fixture,{group});assert.equal(result.status,0,result.stdout+result.stderr);fs.cpSync(result.outputDir,path.join(temporary,'groups',group),{recursive:true});}
  fs.rmSync(path.join(temporary,'groups/scenery/result.json'));
  writeJson(path.join(temporary,'needs.json'),Object.fromEntries(['validation-context','event-gates','cohort-routing','regression'].map(id=>[id,{result:'success'}])));
  const workflow=fs.readFileSync(path.join(repository,'.github/workflows/data-safety.yml'),'utf8');
  const step=workflow.match(/      - name: Verify complete required cohort\n[\s\S]*?        run: \|\n((?:          [^\n]*\n|\n)*)/);
  const command=step?step[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n'):'npm test';
  const env={...process.env,RUNNER_TEMP:temporary,GITHUB_REPOSITORY:'example/fixture',GITHUB_RUN_ID:'fixture-run-1',GITHUB_RUN_ATTEMPT:'1',CHAIN_TEST_SOURCE_SHA:fixture.sourceSha,CHAIN_TEST_COMPARISON_BASE:fixture.comparisonBase,CHAIN_TEST_EVENT_POLICY:'local'};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync('bash',['-euo','pipefail','-c',command],{cwd:fixture.root,env,encoding:'utf8',timeout:15000});
  assert.notEqual(result.status,0,'the actual workflow scanner command must refuse missing required parallel evidence');
  assert.match(result.stdout+result.stderr,/required result|missing|ENOENT/i);
});


test('test group covered references preserve producer provenance without executing a child', t => {
  const fixture=createFixture(t),description=invoke(fixture,{args:['--describe']});
  assert.equal(description.status,0,description.stdout+description.stderr);
  const descriptor=JSON.parse(fs.readFileSync(path.join(description.outputDir,'descriptor.json'),'utf8')),identity=descriptor.resultIdentity;
  const context={repository:identity.repository,sourceSha:identity.sourceSha,sourceTree:identity.sourceTree,checkoutSha:'b'.repeat(40),checkoutTree:'c'.repeat(40),comparisonBase:fixture.comparisonBase,requiredCohort:'four-groups-v1',cohortDigestSha256:identity.cohortDigestSha256,inventorySha256:identity.inventorySha256,assignmentsSha256:identity.assignmentsSha256,expectedGroups:groups};
  const proof={decision:'reuse',runId:'fixture-run-1',runAttempt:'1',validationContext:identity,cohortContext:context,contextSha256:createHash('sha256').update(JSON.stringify(context)).digest('hex'),coveredBy:{runId:'71',runAttempt:'2',checkoutSha:context.checkoutSha,checkoutTree:context.checkoutTree,comparisonBase:context.comparisonBase,reportSha256:'8'.repeat(64)}};
  const file=path.join(description.outputDir,'coverage-proof.json'),sentinel=path.join(fixture.root,'covered-child-executed');writeJson(file,proof);
  const result=invoke(fixture,{args:['--covered','--proof',file],env:{CHAIN_DESCRIPTOR_SENTINEL:sentinel}});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(fs.existsSync(sentinel),false,'covered mode must not duplicate full execution');
  assert.equal(result.evidence.status,'covered');assert.deepEqual(result.evidence.cases,[]);
  assert.equal(result.evidence.coverage.coveredBy.checkoutSha,context.checkoutSha);
});

test('test group registration guard binds names to files and distinguishes empty wrappers', async parent => {
  const scenarios=[['same name assigned in another file',JSON.stringify(fixtureScriptRoot)],['file wrapper title',JSON.stringify(suiteFile)],['unknown skipped root','"unclassified skipped root"']];
  for(const [name,title]of scenarios)await parent.test(name,t=>{
    const fixture=createFixture(t),file=path.join(fixture.root,suiteFile);
    fs.appendFileSync(file,`\nfor(const title of [])test(title,${name==='unknown skipped root'?"{skip:'unexpected'},":''}()=>{});\n`);
    git(fixture.root,'add','.');git(fixture.root,'commit','-qm','existing dynamic site');fixture.comparisonBase=git(fixture.root,'rev-parse','HEAD');
    fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('of []','of ['+title+']'));
    git(fixture.root,'add','.');git(fixture.root,'commit','-qm','unknown row');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
    const result=invoke(fixture);assert.notEqual(result.status,0,'guard must reject '+name);assert.match(result.stderr,/unclassified/i);
  });
});

test('test group covered mode rejects a different producer source even with a valid context hash', t => {
  const fixture=createFixture(t),description=invoke(fixture,{args:['--describe']});assert.equal(description.status,0,description.stderr);
  const identity=JSON.parse(fs.readFileSync(path.join(description.outputDir,'descriptor.json'))).resultIdentity;
  const context={...identity,sourceSha:'f'.repeat(40),checkoutSha:'b'.repeat(40),checkoutTree:'c'.repeat(40),requiredCohort:'four-groups-v1'};
  const proof={decision:'reuse',runId:identity.runId,runAttempt:identity.runAttempt,validationContext:identity,cohortContext:context,contextSha256:createHash('sha256').update(JSON.stringify(context)).digest('hex'),coveredBy:{runId:'71',runAttempt:'2',checkoutSha:context.checkoutSha,checkoutTree:context.checkoutTree,comparisonBase:context.comparisonBase,reportSha256:'8'.repeat(64)}};
  const file=path.join(description.outputDir,'proof.json');writeJson(file,proof);const result=invoke(fixture,{args:['--covered','--proof',file]});
  assert.notEqual(result.status,0,'a matching checksum cannot bind another source to this producer');assert.match(result.stderr,/source|context/i);
});

test('test group explicitly assigned dynamic roots execute in their declared file and group', t => {
  const fixture=createFixture(t),file=path.join(fixture.root,suiteFile);
  fs.appendFileSync(file,'\nfor(const title of [])test(title,()=>{});\n');git(fixture.root,'add','.');git(fixture.root,'commit','-qm','existing dynamic site');
  fixture.comparisonBase=git(fixture.root,'rev-parse','HEAD');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('of []','of ["explicit future dynamic root"]'));
  const catalog=JSON.parse(fs.readFileSync(path.join(fixture.root,'scripts/test-group-assignments.json')));catalog.rootAssignments.push({root:'explicit future dynamic root',file:suiteFile,group:'scenery',registration:'dynamic'});writeJson(path.join(fixture.root,'scripts/test-group-assignments.json'),catalog);
  git(fixture.root,'add','.');git(fixture.root,'commit','-qm','explicit dynamic assignment');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
  const result=invoke(fixture,{group:'scenery'});assert.equal(result.status,0,result.stdout+result.stderr);assert.ok(result.evidence.cases.some(item=>item.id==='explicit future dynamic root'&&item.status==='passed'));
});

function fixtureCoverage(fixture) {
  const description=invoke(fixture,{args:['--describe']});assert.equal(description.status,0,description.stdout+description.stderr);
  const identity=JSON.parse(fs.readFileSync(path.join(description.outputDir,'descriptor.json'))).resultIdentity;
  const context={repository:identity.repository,sourceSha:identity.sourceSha,sourceTree:identity.sourceTree,checkoutSha:'b'.repeat(40),checkoutTree:'c'.repeat(40),comparisonBase:fixture.comparisonBase,requiredCohort:'four-groups-v1',cohortDigestSha256:identity.cohortDigestSha256,inventorySha256:identity.inventorySha256,assignmentsSha256:identity.assignmentsSha256,expectedGroups:groups};
  const proof={decision:'reuse',runId:identity.runId,runAttempt:identity.runAttempt,validationContext:identity,cohortContext:context,contextSha256:createHash('sha256').update(JSON.stringify(context)).digest('hex'),coveredBy:{runId:'71',runAttempt:'2',checkoutSha:context.checkoutSha,checkoutTree:context.checkoutTree,comparisonBase:context.comparisonBase,reportSha256:'8'.repeat(64)}};
  const file=path.join(description.outputDir,'proof.json');writeJson(file,proof);return {file,proof};
}

function inputCoverage(fixture, group = 'core') {
  const description = invoke(fixture,{args:['--describe']});
  assert.equal(description.status,0,description.stdout+description.stderr);
  const identity = JSON.parse(fs.readFileSync(path.join(description.outputDir,'descriptor.json'))).resultIdentity;
  const inputs = {policy:'complete-ci-inputs-v1',repository:identity.repository,checkoutTree:identity.checkoutTree,comparisonBase:identity.comparisonBase,
    runtime:{node:process.versions.node,platform:process.platform,arch:process.arch,imageOS:'ubuntu24',imageVersion:'20261022.1.0'}};
  const pass = {kind:'ci-input-pass-v1',inputs,gate:group,inputKey:createHash('sha256').update(JSON.stringify({...inputs,gate:group})).digest('hex'),
    coveredBy:{runId:'71',runAttempt:'2',jobId:'701',sourceSha:'a'.repeat(40),checkoutSha:'b'.repeat(40),checkoutTree:identity.checkoutTree,comparisonBase:identity.comparisonBase,resultSha256:'8'.repeat(64),artifactId:'901',artifactName:'regression-71-2-'+group,artifactSha256:'7'.repeat(64),artifactExpiresAt:new Date(Date.now()+90*86400000).toISOString() /* #2232: unexpired on any date */}};
  const proof = {decision:'full',runId:identity.runId,runAttempt:identity.runAttempt,validationContext:identity,inputContext:inputs,inputPasses:{[group]:pass}};
  const file = path.join(description.outputDir,'input-proof.json');writeJson(file,proof);
  return {file,proof};
}

test('test group input coverage reuses a passed group without claiming new execution', t => {
  const fixture=createFixture(t),{file,proof}=inputCoverage(fixture),sentinel=path.join(fixture.root,'duplicate-core-execution');
  const result=invoke(fixture,{args:['--covered','--proof',file],env:{ImageOS:'ubuntu24',ImageVersion:'20261022.1.0',CHAIN_DESCRIPTOR_SENTINEL:sentinel}});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(fs.existsSync(sentinel),false,'a verified same-input pass must not execute the core child again');
  assert.equal(result.evidence.status,'covered');assert.deepEqual(result.evidence.cases,[]);assert.deepEqual(result.evidence.artifacts,[]);assert.equal(result.evidence.process,null);
  assert.deepEqual(result.evidence.coverage,proof.inputPasses.core,'coverage must retain the original report and commit rather than relabel them');
});

test('test group aggregate reconciles reused and executed groups with fresh original proof', t => {
  const fixture=aggregateFixture(t),{file}=inputCoverage(fixture);
  const env={ImageOS:'ubuntu24',ImageVersion:'20261022.1.0'};
  const covered=invoke(fixture,{args:['--covered','--proof',file],env});assert.equal(covered.status,0,covered.stdout+covered.stderr);
  fixture.originals.set('core',covered.outputDir);
  const result=aggregateCopy(t,fixture,(_root,needs)=>{
    const x=JSON.parse(fs.readFileSync(needs));x['cohort-routing'].outputs={decision:'full',reused:'["core"]'};writeJson(needs,x);
  },['--proof',file],env);
  assert.equal(result.status,0,result.stdout+result.stderr);
  const report=JSON.parse(fs.readFileSync(path.join(result.outputDir,'aggregate.json')));
  assert.equal(report.mode,'mixed');assert.equal(report.caseCount,4,'only this run\'s actual cases count as executed');
  assert.equal(report.groups.filter(group=>group.mode==='covered').length,1);
  assert.equal(report.groups.find(group=>group.group==='core').coverage.coveredBy.checkoutSha,'b'.repeat(40));
  assert.equal(report.groups.find(group=>group.group==='native-process').identity.checkoutSha,fixture.sourceSha,'actual native evidence retains its current checkout');
});

test('test group aggregate admits a fresh execution after consumer runtime changes',t=>{
  const fixture=aggregateFixture(t),{file}=inputCoverage(fixture);
  const actual=aggregateCopy(t,fixture,(_root,needs)=>{const x=JSON.parse(fs.readFileSync(needs));x['cohort-routing'].outputs={decision:'full',reused:'["core"]'};writeJson(needs,x);},['--proof',file],{ImageOS:'ubuntu24',ImageVersion:'20261023.2.0'});
  assert.equal(actual.status,0,actual.stdout+actual.stderr);
  const report=JSON.parse(fs.readFileSync(path.join(actual.outputDir,'aggregate.json')));assert.equal(report.mode,'full');assert.ok(report.caseCount>0);assert.ok(report.groups.every(group=>group.mode!=='covered'),'fresh execution keeps its own current cases');
});

test('test group aggregate preserves observer protocol across emulator coverage and fresh fallback',async parent=>{
  const fixture=aggregateFixture(parent);
  const workflow=fs.readFileSync(path.join(repository,'.github/workflows/data-safety.yml'),'utf8');
  assert.match(workflow,/name: Verified complete cohort .* mode \$\{\{ steps\.aggregate\.outputs\.attestation-mode \}\}/,'the actual workflow must publish the observer-compatible aggregate output');
  assert.match(workflow,/if: success\(\) && steps\.aggregate\.outputs\.original == 'true'/,'only actual fully executed cohorts advertise original producer authority');
  for(const [name,rulesMode,hasProof,accepted,mode]of [['retained rules','covered',true,true,'reuse'],['fresh emulator fallback','executed',false,true,'full'],['missing covered proof','covered',false,false,null],['changed consumed original','covered',true,false,null]])await parent.test(name,t=>{
    const {file,proof}=inputCoverage(fixture,'rules'),consumed=createHash('sha256').update(JSON.stringify(proof.inputPasses.rules)).digest('hex');if(!hasProof)proof.inputPasses={};
    if(name==='changed consumed original'){proof.inputPasses.rules.coveredBy.runId='72';proof.inputPasses.rules.coveredBy.runAttempt='1';proof.inputPasses.rules.coveredBy.resultSha256='9'.repeat(64);}
    writeJson(file,proof);
    const outputs=path.join(path.dirname(file),'aggregate-outputs');
    const result=aggregateCopy(t,fixture,(_root,needs)=>{const x=JSON.parse(fs.readFileSync(needs));x['cohort-routing'].outputs={decision:'full',reused:'["rules"]'};x['event-gates'].outputs={rules:rulesMode,compatibility:'executed','rules-coverage':rulesMode==='covered'?consumed:''};writeJson(needs,x);},['--proof',file],{ImageOS:'ubuntu24',ImageVersion:'20261022.1.0',GITHUB_OUTPUT:outputs});
    assert.equal(result.status===0,accepted,result.stdout+result.stderr);
    if(accepted){const text=fs.readFileSync(outputs,'utf8');assert.match(text,new RegExp('^attestation-mode='+mode+'$','m'),'the existing observer must receive a truthful full/reuse attestation');assert.match(text,new RegExp('^original='+(mode==='full')+'$','m'),'only entirely executed cohorts can publish the original full producer marker');}
  });
});

test('test group workflow consumer forbids duplicate execution for a verified input pass', t => {
  const fixture=createFixture(t),{proof}=inputCoverage(fixture);
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'chain-workflow-reuse-'));fixture.outputs.push(temporary);
  fs.mkdirSync(path.join(temporary,'ci-routing'));writeJson(path.join(temporary,'ci-routing/routing.json'),proof);
  const sentinel=path.join(temporary,'test-child-executed');
  const workflow=fs.readFileSync(path.join(repository,'.github/workflows/data-safety.yml'),'utf8');
  const commands=[...workflow.matchAll(/^\s+run: (node scripts\/agent-tools\/ci-pass-reuse\.mjs run-group .+)$/gm)].map(match=>match[1]);
  const selection=[...workflow.matchAll(/^\s+run: (node scripts\/agent-tools\/ci-pass-reuse\.mjs select .+)$/gm)][0]?.[1];assert.ok(selection,'the workflow must select consumer inputs before dependency setup');
  const command=selection+'\n'+(commands[0]||'node scripts/agent-tools/ci-pass-reuse.mjs run-group --proof "$RUNNER_TEMP/selected-routing/routing.json" --group core --output-dir "$RUNNER_TEMP/group" --repository "$GITHUB_REPOSITORY" --event-policy "$CHAIN_TEST_EVENT_POLICY" --run-id "$GITHUB_RUN_ID" --run-attempt "$GITHUB_RUN_ATTEMPT" --source-sha "$CHAIN_TEST_SOURCE_SHA" --comparison-base "$CHAIN_TEST_COMPARISON_BASE"').replaceAll('${{ matrix.group }}','core');
  const env={...process.env,ImageOS:'ubuntu24',ImageVersion:'20261022.1.0',RUNNER_TEMP:temporary,GITHUB_REPOSITORY:'example/fixture',CHAIN_TEST_EVENT_POLICY:'local',GITHUB_RUN_ID:'fixture-run-1',GITHUB_RUN_ATTEMPT:'1',CHAIN_TEST_SOURCE_SHA:fixture.sourceSha,CHAIN_TEST_COMPARISON_BASE:fixture.comparisonBase,CHAIN_DESCRIPTOR_SENTINEL:sentinel};delete env.NODE_TEST_CONTEXT;
  const reused=run('bash',['-euo','pipefail','-c',command],fixture.root,env);
  assert.equal(reused.status,0,reused.stdout+reused.stderr);
  assert.equal(readEvidence(path.join(temporary,'group'))?.status,'covered','the actual workflow dispatch must consume the verified pass');
  assert.equal(fs.existsSync(sentinel),false,'the enforced CI consumer must not launch an already passed test child');
  assert.equal(commands.length,1,'the workflow must use the enforcing consumer exactly once');
  assert.doesNotMatch(workflow,/run: npm (?:test|run test:group -- --group)/,'direct suite/group execution would bypass the mandatory reuse gate');
  assert.match(workflow,/name: Enforce CI reuse contract\n\s+run: node --test --test-name-pattern=/,'admission must enforce this process regression before expensive jobs');
  fs.rmSync(path.join(temporary,'group'),{recursive:true,force:true});fs.rmSync(path.join(temporary,'selected-routing'),{recursive:true,force:true});proof.inputPasses={};writeJson(path.join(temporary,'ci-routing/routing.json'),proof);
  const fresh=run('bash',['-euo','pipefail','-c',command],fixture.root,env);
  assert.equal(fresh.status,0,fresh.stdout+fresh.stderr);
  assert.equal(fs.existsSync(sentinel),true,'the same workflow must execute the real child when coverage is absent');
  assert.equal(readEvidence(path.join(temporary,'group')).status,'passed');
  fs.rmSync(path.join(temporary,'group'),{recursive:true,force:true});fs.rmSync(path.join(temporary,'selected-routing'),{recursive:true,force:true});fs.rmSync(sentinel);
  const original=inputCoverage(fixture).proof;writeJson(path.join(temporary,'ci-routing/routing.json'),original);
  const changedImage=run('bash',['-euo','pipefail','-c',command],fixture.root,{...env,ImageVersion:'20261023.2.0'});
  assert.equal(changedImage.status,0,changedImage.stdout+changedImage.stderr);
  assert.equal(fs.existsSync(sentinel),true,'a different consumer image must execute instead of failing or inheriting coverage');
  assert.equal(readEvidence(path.join(temporary,'group')).status,'passed');
});

test('test group workflow publication attests actual execution and never promotes a reused result', t => {
  const fixture=createFixture(t),{file,proof}=inputCoverage(fixture),original=proof.inputPasses;
  const output=path.join(path.dirname(file),'step-outputs');
  const env={ImageOS:'ubuntu24',ImageVersion:'20261022.1.0',GITHUB_OUTPUT:output};
  proof.inputPasses={};writeJson(file,proof);
  const actual=invoke(fixture,{consumer:true,args:['--proof',file],env});assert.equal(actual.status,0,actual.stdout+actual.stderr);
  const published=fs.existsSync(output)?fs.readFileSync(output,'utf8'):'';
  assert.match(published,/^key=[a-f0-9]{64}$/m,'an executed job must publish its complete-input key');
  assert.match(published,new RegExp('^result='+createHash('sha256').update(fs.readFileSync(actual.evidencePath)).digest('hex')+'$','m'),'publication must fingerprint the actual result bytes');
  assert.match(published,/^mode=executed$/m);
  fs.rmSync(output);proof.inputPasses=original;writeJson(file,proof);
  const covered=invoke(fixture,{consumer:true,args:['--proof',file],env});assert.equal(covered.status,0,covered.stdout+covered.stderr);
  const reused=fs.readFileSync(output,'utf8');assert.match(reused,/^mode=covered$/m);assert.doesNotMatch(reused,/^(key|result)=/m,'covered work cannot become an original producer');
});

test('test group input aggregation rejects stale missing and fabricated coverage', async parent => {
  const fixture=aggregateFixture(parent),{file,proof}=inputCoverage(fixture),env={ImageOS:'ubuntu24',ImageVersion:'20261022.1.0'};
  const covered=invoke(fixture,{args:['--covered','--proof',file],env});assert.equal(covered.status,0,covered.stderr);fixture.originals.set('core',covered.outputDir);
  const scenarios=[
    ['missing fresh gate',(_root,fresh)=>{fresh.inputPasses={};}],
    ['different fresh report',(_root,fresh)=>{fresh.inputPasses.core.coveredBy.resultSha256='9'.repeat(64);}],
    ['different current run',(_root,fresh)=>{fresh.runId='different-run';}],
    ['different runtime',(_root,fresh)=>{fresh.inputPasses.core.inputs.runtime.node='0.0.0';}],
    ['invalid original job',(_root,fresh)=>{fresh.inputPasses.core.coveredBy.jobId='0';}],
    ['fabricated current case',root=>{const p=path.join(root,'core/result.json'),x=JSON.parse(fs.readFileSync(p));x.cases.push({id:'fabricated',status:'passed'});writeJson(p,x);}],
    ['missing reused inventory',(_root,_fresh,needs)=>{const x=JSON.parse(fs.readFileSync(needs));x['cohort-routing'].outputs.reused='[]';writeJson(needs,x);}],
    ['failed required fresh group',root=>{const p=path.join(root,'scenery/result.json'),x=JSON.parse(fs.readFileSync(p));x.status='failed';writeJson(p,x);}],
  ];
  for(const [name,mutate]of scenarios)await parent.test(name,t=>{
    const fresh=structuredClone(proof);
    const result=aggregateCopy(t,fixture,(root,needs)=>{
      const x=JSON.parse(fs.readFileSync(needs));x['cohort-routing'].outputs={decision:'full',reused:'["core"]'};writeJson(needs,x);mutate(root,fresh,needs);writeJson(file,fresh);
    },['--proof',file],env);
    assert.notEqual(result.status,0,name+' must fail the required aggregate');
  });
});
test('test group covered aggregate requires four honest references and fresh original producer proof', async parent => {
  const fixture=createFixture(parent),{file,proof}=fixtureCoverage(fixture);fixture.originals=new Map();
  for(const group of groups){const result=invoke(fixture,{group,args:['--covered','--proof',file]});assert.equal(result.status,0,result.stdout+result.stderr);fixture.originals.set(group,result.outputDir);}
  const scenarios=[['complete references',()=>{},true],['one fabricated current outcome',root=>{const f=path.join(root,'core/result.json'),x=JSON.parse(fs.readFileSync(f));x.cases.push({id:'fabricated',status:'passed'});writeJson(f,x);},false],['mixed producer attempt',root=>{const f=path.join(root,'scenery/result.json'),x=JSON.parse(fs.readFileSync(f));x.coverage.coveredBy.runAttempt='3';writeJson(f,x);},false],['missing group reference',root=>fs.rmSync(path.join(root,'native-process/result.json')),false]];
  await parent.test('missing fresh proof',t=>{
    const result=aggregateCopy(t,fixture,(_root,needs)=>{const x=JSON.parse(fs.readFileSync(needs));x['cohort-routing'].outputs={decision:'reuse'};writeJson(needs,x);});
    assert.notEqual(result.status,0,'covered aggregate must refuse absent fresh proof');
  });
  for(const [name,mutate,passed]of scenarios)await parent.test(name,t=>{
    const actual=aggregateCopy(t,fixture,(root,needs)=>{const x=JSON.parse(fs.readFileSync(needs));x['cohort-routing'].outputs={decision:'reuse'};writeJson(needs,x);mutate(root);},['--proof',file]);
    assert.equal(actual.status===0,passed,actual.stdout+actual.stderr);
    if(passed){const report=JSON.parse(fs.readFileSync(path.join(actual.outputDir,'aggregate.json')));assert.equal(report.mode,'covered');assert.equal(report.caseCount,0);assert.equal(report.groups.length,4);assert.ok(report.groups.every(group=>group.coverage.coveredBy.runId===proof.coveredBy.runId));}
  });
});

// The runner's --describe output for this repository: the effective required
// cohort, with each root placed by its row or its file (#2232).
function describeRepository() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-required-cohort-')), output = path.join(directory, 'describe');
  try {
    const head = git(repository, 'rev-parse', 'HEAD'), env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [runner, '--describe', '--group', 'core', '--output-dir', output, '--repository', 'local/describe', '--event-policy', 'local',
      '--run-id', '1', '--run-attempt', '1', '--source-sha', head, '--comparison-base', head], { cwd: repository, env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, 'the real required cohort must describe: ' + result.stdout + result.stderr);
    return JSON.parse(fs.readFileSync(path.join(output, 'descriptor.json'), 'utf8'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('test group catalog routes real declarations despite matching quoted fixture text', t => {
  const fixture = createFixture(t);
  const titles = [
    'Landscape location: visible default-sky copy does not name Orlando',
    'RISK Quick start content: essential steps stay brief and detailed help remains user-facing in existing sections',
  ];
  const realCohort = describeRepository();
  const selected = titles.map(title => {
    // Rows now hold only overrides (#2232): the runner's descriptor of the real
    // repository is the effective placement, by row or by the case's file.
    const placement = realCohort.groups.filter(group => group.roots.includes(title)).map(group => group.id);
    assert.deepEqual(placement, ['native-process'], 'retain the historical group membership');
    // The real case lives in its own area file (#2213); this fixture appends
    // the declarations below to its one suite file.
    return { root: title, group: 'native-process', file: suiteFile };
  });
  const journal = path.join(fixture.root, 'real-case-executions.jsonl');
  const declarations = titles.map(title => `test(${JSON.stringify(title)}, () => { fs.appendFileSync(process.env.CHAIN_REAL_CASE_JOURNAL, ${JSON.stringify(title + '\n')}); });`).join('\n');
  const quoted = `const quotedFixtureSource = ${JSON.stringify(declarations)};\n`;
  fs.appendFileSync(path.join(fixture.root, suiteFile), '\n' + quoted + declarations + '\n');
  fs.writeFileSync(path.join(fixture.root, 'scripts/agent-tools/preflight.test.mjs'), "import { test } from 'node:test';\n" + quoted + "test('fixture preflight real owner root', () => {});\n");
  const catalog = JSON.parse(fs.readFileSync(path.join(fixture.root, 'scripts/test-group-assignments.json'), 'utf8'));
  catalog.rootAssignments.push(...selected, { root: 'fixture preflight real owner root', group: 'native-process', file: 'scripts/agent-tools/preflight.test.mjs' });
  writeJson(path.join(fixture.root, 'scripts/test-group-assignments.json'), catalog);
  git(fixture.root, 'add', '.');
  git(fixture.root, 'commit', '-qm', 'real declarations with ambiguous quoted fixture copies');
  fixture.sourceSha = git(fixture.root, 'rev-parse', 'HEAD');

  const core = invoke(fixture, { env: { CHAIN_REAL_CASE_JOURNAL: journal } });
  assert.equal(core.status, 0, 'the per-file guard must recognize both real declarations: ' + core.stdout + core.stderr);
  assert.equal(fs.existsSync(journal), false, 'the guard and another group must not execute the assigned native cases');
  const native = invoke(fixture, { group: 'native-process', env: { CHAIN_REAL_CASE_JOURNAL: journal } });
  assert.equal(native.status, 0, native.stdout + native.stderr);
  const executed = fs.readFileSync(journal, 'utf8').trim().split('\n');
  for (const title of titles) {
    assert.equal(executed.filter(item => item === title).length, 1, 'execute each actual declaration exactly once');
    assert.equal(native.evidence.cases.filter(item => item.id === title && item.status === 'passed').length, 1);
  }
});

// #2213 moved tests.js into per-area files under tests/ with one shared helper
// module. The runner must treat that directory as the full suite: every root
// resolves to its split file, groups run across files, and a root registered
// in a second file is still caught.
function convertToSplitLayout(fixture, { duplicateCoreRoot = false } = {}) {
  const source = fs.readFileSync(path.join(fixture.root, 'tests.js'), 'utf8');
  const header = "import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport { test } from 'node:test';\nimport { sharedMarker } from './shared.js';\n";
  const body = source.slice(source.indexOf('test('));
  const sceneryAt = body.indexOf(`test(${JSON.stringify(fixtureRoots.scenery)}`);
  fs.mkdirSync(path.join(fixture.root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(fixture.root, 'tests/shared.js'), "export const sharedMarker = 'shared';\n");
  fs.writeFileSync(path.join(fixture.root, 'tests/core.test.js'), header + "assert.equal(sharedMarker, 'shared');\n" + body.slice(0, sceneryAt));
  fs.writeFileSync(path.join(fixture.root, 'tests/other.test.js'), header + body.slice(sceneryAt) +
    (duplicateCoreRoot ? `\ntest(${JSON.stringify(fixtureRoots.core)}, () => {});\n` : ''));
  fs.rmSync(path.join(fixture.root, 'tests.js'));
  const packagePath = path.join(fixture.root, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageJson.scripts.test = suiteCommand;
  writeJson(packagePath, packageJson);
  const catalogPath = path.join(fixture.root, 'scripts/test-group-assignments.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  for (const row of catalog.rootAssignments) if (row.file === 'tests.js') row.file = row.root === fixtureRoots.core ? 'tests/core.test.js' : 'tests/other.test.js';
  writeJson(catalogPath, catalog);
  git(fixture.root, 'add', '--all');
  git(fixture.root, 'commit', '-qm', 'split tests.js into per-area files');
  fixture.sourceSha = git(fixture.root, 'rev-parse', 'HEAD');
}

// Moving tests into new files makes every registration an added line, so a
// title written with string escapes must match its assignment by value. The
// catalog stores TAP identities, where # is escaped as \#.
test('test group runner matches added root titles written with string escapes', t => {
  const fixture = createFixture(t);
  const titles = ['fixture Settings → Import root', "fixture today's escaped root", 'fixture #hash root'];
  fs.appendFileSync(path.join(fixture.root, suiteFile),
    "\ntest(\"fixture Settings \\u2192 Import root\", () => {});\ntest('fixture today\\'s escaped root', () => {});\ntest('fixture #hash root', () => {});\n");
  const catalogPath = path.join(fixture.root, 'scripts/test-group-assignments.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  catalog.rootAssignments.push(...titles.map(root => ({ root: root.replace('#', '\\#'), group: 'core', file: suiteFile })));
  writeJson(catalogPath, catalog);
  git(fixture.root, 'add', '--all');
  git(fixture.root, 'commit', '-qm', 'add roots with escaped titles');
  fixture.sourceSha = git(fixture.root, 'rev-parse', 'HEAD');
  const described = invoke(fixture, { args: ['--describe'] });
  assert.equal(described.status, 0, described.stdout + described.stderr);
  const core = invoke(fixture);
  assert.equal(core.status, 0, core.stdout + core.stderr);
  for (const title of titles) assert.equal(core.evidence.cases.filter(item => item.id === title && item.status === 'passed').length, 1, title);
});

// A moved registration is not a new root. Env-gated registrations (such as
// the installed-client sensitivity controls) have no group because they never
// register in ordinary runs, and moving them into a split file keeps that.
test('test group runner treats registrations moved into split files as existing', t => {
  const fixture = createFixture(t, { legacyLayout: true });
  fs.appendFileSync(path.join(fixture.root, 'tests.js'), "\nif (process.env.CHAIN_FIXTURE_GATED === '1') {\n  test('fixture env-gated sensitivity root', () => {});\n}\n");
  git(fixture.root, 'add', 'tests.js');
  git(fixture.root, 'commit', '-qm', 'baseline env-gated registration');
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const inventoryPath = path.join(fixture.root, 'scripts/test-group-inventory.json');
  const baselineInventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  Object.assign(baselineInventory.baseline, { sourceSha: head, sourceTree: git(fixture.root, 'rev-parse', 'HEAD^{tree}'), checkoutSha: head, checkoutTree: git(fixture.root, 'rev-parse', 'HEAD^{tree}'), comparisonBase: head });
  writeJson(inventoryPath, baselineInventory);
  git(fixture.root, 'add', 'scripts/test-group-inventory.json');
  git(fixture.root, 'commit', '-qm', 'rebind inventory to the gated baseline');
  fixture.comparisonBase = git(fixture.root, 'rev-parse', 'HEAD');
  convertToSplitLayout(fixture);
  const described = invoke(fixture, { args: ['--describe'] });
  assert.equal(described.status, 0, described.stdout + described.stderr);
  fs.appendFileSync(path.join(fixture.root, 'tests/other.test.js'), "\ntest('fixture genuinely new root', () => {});\n");
  git(fixture.root, 'add', '--all');
  git(fixture.root, 'commit', '-qm', 'add an unassigned root');
  fixture.sourceSha = git(fixture.root, 'rev-parse', 'HEAD');
  const rejected = invoke(fixture, { args: ['--describe'] });
  assert.notEqual(rejected.status, 0, 'a genuinely new root still needs an assignment');
  assert.match(rejected.stderr, /fixture genuinely new root/);
});

test('test group runner resolves every root across split per-area test files', t => {
  const fixture = createFixture(t, { legacyLayout: true });
  convertToSplitLayout(fixture);
  const described = invoke(fixture, { args: ['--describe'] });
  assert.equal(described.status, 0, described.stdout + described.stderr);
  const descriptor = JSON.parse(fs.readFileSync(path.join(described.outputDir, 'descriptor.json'), 'utf8'));
  const describedRoots = descriptor.groups.flatMap(group => group.roots);
  assert.equal(new Set(describedRoots).size, describedRoots.length, 'every root is described once');
  for (const root of [...Object.values(fixtureRoots), fixtureScriptRoot]) assert.ok(describedRoots.includes(root), `${root} resolves after the split`);
  for (const group of groups) {
    const result = invoke(fixture, { group });
    assert.equal(result.status, 0, `${group}: ${result.stdout}\n${result.stderr}`);
    assert.equal(result.evidence.status, 'passed');
  }
  const core = invoke(fixture);
  assert.deepEqual(core.evidence.unclassifiedRootGuard.files.map(item => item.file).sort(),
    ['scripts/agent-tools/fixture.test.mjs', 'tests/core.test.js', 'tests/other.test.js'],
    'the guard covers every split test file and not the shared helper module');

  const duplicate = createFixture(t, { legacyLayout: true });
  convertToSplitLayout(duplicate, { duplicateCoreRoot: true });
  const rejected = invoke(duplicate);
  assert.notEqual(rejected.status, 0, 'a root registered again in another split file must fail closed');
  assert.match(rejected.evidence.issues.join('\n'), /tests\/other\.test\.js/);
});

// Nothing runs a root tests.js since #2213, so a checkout whose npm test still
// names it is not the suite this runner groups.
test('test group runner refuses the retired single tests.js suite command', t => {
  const fixture = createFixture(t, { legacyLayout: true });
  const described = invoke(fixture, { args: ['--describe'] });
  assert.notEqual(described.status, 0, 'the single-file layout must not group: ' + described.stdout + described.stderr);
  assert.match(described.stderr, /full npm test entry point changed/);
});
