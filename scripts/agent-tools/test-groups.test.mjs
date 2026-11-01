import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {createMobileBundle,refreshMobileBundle} from './mobile-memory-fixture.mjs';

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
  const rootAssignments = [
    { root: coreTitle, group: 'core', file: 'tests.js' },
    ...(options.additionalCoreRoots || []).map(root => ({ root, group: 'core', file: 'tests.js' })),
    { root: fixtureRoots.scenery, group: 'scenery', file: 'tests.js' },
    { root: fixtureRoots['persistence-recovery'], group: 'persistence-recovery', file: 'tests.js' },
    { root: options.nativeTitle || fixtureRoots['native-process'], group: 'native-process', file: 'tests.js' },
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
  if(options.mobileStory)for(const name of ['button-safety-mobile-contract.mjs','button-safety-ci-policy.mjs'])fs.copyFileSync(path.join(repository,'scripts',name),path.join(root,'scripts',name));
  if(options.mobileStory)writeJson(path.join(root,'scripts/button-safety-inventory.json'),{requiredRuntimeAssets:JSON.parse(fs.readFileSync(path.join(repository,'scripts/button-safety-inventory.json'),'utf8')).requiredRuntimeAssets,requiredMobileStory:{savedTasks:400,yesCount:10,distinctTasks:true,windowMs:2000,memoryBudgetBytes:1000000000,motions:['normal','reduced']}});
  fs.copyFileSync(path.join(repository,'scripts/agent-tools/ci-pass-reuse.mjs'),path.join(root,'scripts/agent-tools/ci-pass-reuse.mjs'));
  const coreTitle = options.coreTitle || fixtureRoots.core;
  writeJson(path.join(root, 'package.json'), {
    type: 'module',
    scripts: { 'test:group': 'node scripts/test-groups.mjs', test: JSON.parse(fs.readFileSync(path.join(repository, 'package.json'), 'utf8')).scripts.test },
  });
  fs.writeFileSync(path.join(root, 'tests.js'), suiteSource({ ...options, coreTitle, runtimeCoreTitle: options.runtimeCoreTitle || coreTitle }));
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

  if(options.nrOptional){
    const {roots,reason,guard}=options.nrOptional;
    const declarations=roots.map((title,index)=>`if(optionalWorkloadDiagnosticsSelected){\n test(${JSON.stringify(title)},()=>{fs.appendFileSync(process.env.CHAIN_NR_JOURNAL,JSON.stringify({root:${JSON.stringify(title)},group:process.env.CHAIN_TEST_GROUP,selected:process.env.CHAIN_OPTIONAL_WORKLOAD_DIAGNOSTICS})+'\\n');fs.writeFileSync(path.join(process.env.CHAIN_NATIVE_OUTPUT,'optional-${index}.json'),JSON.stringify({root:${JSON.stringify(title)},sha:process.env.CHAIN_NATIVE_CANDIDATE_SHA,tree:process.env.CHAIN_NATIVE_CANDIDATE_TREE}));if(process.env.CHAIN_NR_FAIL===${JSON.stringify(title)})assert.fail('retained optional fixture failure');});\n}\n`).join('');
    fs.appendFileSync(path.join(root,'tests.js'),'\nconst optionalWorkloadDiagnosticsSelected='+guard+';\n'+declarations);
    const suiteFile=path.join(root,'tests.js');fs.writeFileSync(suiteFile,fs.readFileSync(suiteFile,'utf8').replace('    tree: process.env.CHAIN_NATIVE_CANDIDATE_TREE,','    tree: process.env.CHAIN_NATIVE_CANDIDATE_TREE,optionalSelected:process.env.CHAIN_OPTIONAL_WORKLOAD_DIAGNOSTICS,group:process.env.CHAIN_TEST_GROUP,'));
    const inv=JSON.parse(fs.readFileSync(path.join(root,'scripts/test-group-inventory.json')));inv.rootTests.push(...roots.map(id=>({id,durationMs:100})));inv.requiredCases.push(...roots.map(id=>({id,root:id})));inv.baseline.caseCount+=roots.length;inv.baseline.passed+=roots.length;writeJson(path.join(root,'scripts/test-group-inventory.json'),inv);
    groupAssignments.rootAssignments.push(...roots.map(root=>({root,file:'tests.js',group:'native-process',admission:'optional-workload-diagnostic',admissionReason:reason})));const native=groupAssignments.groups.find(row=>row.id==='native-process');native.baselineRootCount+=roots.length;native.baselineEstimatedDurationMs+=roots.length*100;writeJson(path.join(root,'scripts/test-group-assignments.json'),groupAssignments);
  }

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

test('test group runner reconciles complete full and grouped fixture cohorts', t => { // Each real test child must support its same-context module imports.
  const fixture = createFixture(t);
  const outerNativeOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-group-outer-native-'));
  fs.rmSync(outerNativeOutput, { recursive: true });
  fixture.outputs.push(outerNativeOutput);
  const fixtureArgs = ['--test', '--test-reporter=tap', 'tests.js', 'scripts/agent-tools/fixture.test.mjs'];
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

  // Use the actual supported commands: the recorder's explicit flag must not
  // conceal an unsupported npm or grouped child process.
  const vmFixture=createFixture(t),journalRoot=fs.mkdtempSync(path.join(os.tmpdir(),'chain-vm-entrypoint-journal-'));
  vmFixture.outputs.push(journalRoot);
  const vmPrelude=[
    "import vm from 'node:vm';",
    "const moduleContext=vm.createContext({});",
    "const moduleDependency=new vm.SyntheticModule(['value'],function(){this.setExport('value',1299);},{context:moduleContext});",
    "const sourceModule=new vm.SourceTextModule(`import {value} from 'chain:fixture-value'; export const ready=value;`,{context:moduleContext});",
    "await sourceModule.link(specifier=>{assert.equal(specifier,'chain:fixture-value');return moduleDependency;});",
    "await sourceModule.evaluate();assert.equal(sourceModule.namespace.ready,1299);",
    "fs.appendFileSync(process.env.CHAIN_VM_ENTRYPOINT_JOURNAL,JSON.stringify({moduleValue:sourceModule.namespace.ready,ambientOptions:process.env.NODE_OPTIONS??null,pid:process.pid})+'\\n');",
  ].join('\n')+'\n';
  fs.writeFileSync(path.join(vmFixture.root,'tests.js'),vmPrelude+fs.readFileSync(path.join(vmFixture.root,'tests.js'),'utf8'));
  git(vmFixture.root,'add','tests.js');git(vmFixture.root,'commit','-qm','require actual same-context VM modules in the existing fixture');vmFixture.sourceSha=git(vmFixture.root,'rev-parse','HEAD');
  let retained=null;
  if(process.env.CHAIN_VM_ENTRYPOINT_EVIDENCE){
    assert.ok(path.isAbsolute(process.env.CHAIN_VM_ENTRYPOINT_EVIDENCE));fs.mkdirSync(process.env.CHAIN_VM_ENTRYPOINT_EVIDENCE,{recursive:true});
    retained=fs.mkdtempSync(path.join(process.env.CHAIN_VM_ENTRYPOINT_EVIDENCE,'whole-consumer-'));fs.cpSync(vmFixture.root,path.join(retained,'source'),{recursive:true});
  }
  const failures=[],witnesses=[];
  for(const [index,entrypoint,group,expectedExecutions] of [[0,'npm test',null,1],[1,'group core and unclassified guard','core',2],[2,'group native-process','native-process',1]]){
    const journal=path.join(journalRoot,'mode-'+index+'.jsonl'),native=isolatedFixtureNativeOutput(vmFixture),environment={...native.env,CHAIN_VM_ENTRYPOINT_JOURNAL:journal};
    for(const key of ['NODE_OPTIONS','NODE_TEST_CONTEXT','CHAIN_TEST_GROUP','CHAIN_GROUP_OUTPUT_DIR'])delete environment[key];
    const child=group?invoke(vmFixture,{group,env:{...environment,NODE_OPTIONS:undefined,NODE_TEST_CONTEXT:undefined,CHAIN_TEST_GROUP:undefined,CHAIN_GROUP_OUTPUT_DIR:undefined}}):run('npm',['test'],vmFixture.root,environment);
    const rows=fs.existsSync(journal)?fs.readFileSync(journal,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
    if(retained){
      const target=path.join(retained,'mode-'+index);fs.mkdirSync(target);writeJson(path.join(target,'process.json'),{entrypoint,status:child.status,signal:child.signal,error:child.error?.message??null,stdout:child.stdout,stderr:child.stderr,rows});
      if(child.outputDir&&fs.existsSync(child.outputDir))fs.cpSync(child.outputDir,path.join(target,'complete-group-output'),{recursive:true});
      if(fs.existsSync(journal))fs.copyFileSync(journal,path.join(target,'actual-child-journal.jsonl'));
      fs.cpSync(native.output,path.join(target,'caller-native-output'),{recursive:true});
    }
    try{
      assert.equal(child.status,0,entrypoint+' must evaluate actual same-context modules: '+child.stdout+'\n'+child.stderr);
      assert.equal(child.signal,null);assert.equal(rows.length,expectedExecutions,entrypoint+' includes each actual VM consumer and guard import exactly once');
      for(const row of rows){assert.equal(row.moduleValue,1299);assert.equal(row.ambientOptions,null);assert.ok(Number.isSafeInteger(row.pid)&&row.pid>0);}
      assert.equal(new Set(rows.map(row=>row.pid)).size,expectedExecutions,'Each import comes from its real isolated test process');
      if(group){assert.equal(child.evidence.status,'passed');assert.equal(child.evidence.process.exitCode,0);if(group==='core'){assert.equal(child.evidence.unclassifiedRootGuard.status,'passed');assert.ok(child.evidence.unclassifiedRootGuard.files.every(row=>row.process.code===0));}}
      else assert.deepEqual(JSON.parse(fs.readFileSync(path.join(native.output,'candidate-identity.json'))),{sha:vmFixture.sourceSha,tree:git(vmFixture.root,'rev-parse','HEAD^{tree}')});
    }catch(error){failures.push({entrypoint,message:error.message});}
    witnesses.push({entrypoint,moduleValues:rows.map(row=>row.moduleValue)});
  }
  t.diagnostic('VM-module supported entrypoint witnesses: '+JSON.stringify(witnesses));
  assert.deepEqual(failures,[],'All supported process entrypoints must execute actual VM modules; retained subprocess failures stay explicit');
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
  const sentinel = path.join(fixture.root, 'contradictory-catalog-body-executed');
  const contradictoryAssignments = {
    ...groupAssignments,
    rootAssignments: [...groupAssignments.rootAssignments, { root: oldRoot, group: 'core', file: 'tests.js' }],
  };
  writeJson(path.join(fixture.root, 'scripts/test-group-assignments.json'), contradictoryAssignments);
  const contradictory = invoke(fixture, { args: ['--describe'], env: { CHAIN_DESCRIPTOR_SENTINEL: sentinel } });
  assert.notEqual(contradictory.status, 0, 'A replaced historical source cannot remain live alongside its explicit current target');
  assert.equal(contradictory.evidence?.status, 'preflight_failed');
  assert.match(contradictory.evidence?.issues?.join('\n') || contradictory.stderr, /Historical root .* must be represented through its replacement target only/);
  assert.equal(fs.existsSync(sentinel), false, 'Contradictory catalogs must fail before any test body executes');
  assert.equal(fs.existsSync(path.join(contradictory.outputDir, 'descriptor.json')), false, 'A contradictory catalog cannot publish a valid descriptor');
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
    const nativeFixture = isolatedFixtureNativeOutput(fixture);
    const fullEnv = { ...nativeFixture.env };
    delete fullEnv.NODE_TEST_CONTEXT;
    const full = run(process.execPath, ['--test', '--test-reporter=tap', 'tests.js'], fixture.root, fullEnv);
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
  const fixture=createFixture(t),file=path.join(fixture.root,'tests.js');
  fs.appendFileSync(file,"\nconst futureDynamicRows=[];for(const title of futureDynamicRows)test(title,()=>{});\n");
  git(fixture.root,'add','tests.js');git(fixture.root,'commit','-qm','existing dynamic registration site');
  fixture.comparisonBase=git(fixture.root,'rev-parse','HEAD');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('futureDynamicRows=[]','futureDynamicRows=["unclassified future dynamic row"]'));
  git(fixture.root,'add','tests.js');git(fixture.root,'commit','-qm','add an unclassified data row');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
  const result=invoke(fixture);
  assert.notEqual(result.status,0,'a passing unknown runtime root must not disappear from the required grouped cohort');
  assert.match(result.stderr,/unclassified.*dynamic|dynamic.*unclassified/i);
});


function aggregateFixture(t, options={}) {
  const fixture=createFixture(t,{nativeTitle:'RISK repository process: required installed-client native outcomes and artifacts execute exactly once',nativeReports:true,...options});
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
test('test group aggregate preserves optional outcomes separately from the required verdict',async t=>{
 const fixture=aggregateFixture(t,{mobileStory:true}),tree=git(fixture.root,'rev-parse','HEAD^{tree}'),source={candidateCommit:fixture.sourceSha,candidateTree:tree,sourceSha:fixture.sourceSha};
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-optional-mobile-aggregate-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const required=createMobileBundle(path.join(directory,'required'),source),stress=createMobileBundle(path.join(directory,'stress'),source,'stress-512mb');
 const invalid=createMobileBundle(path.join(directory,'invalid'),source);invalid.report.candidateTree='0'.repeat(40);refreshMobileBundle(invalid);
 const failedStress=createMobileBundle(path.join(directory,'failed-stress'),source,'stress-512mb');failedStress.report.status='failed';failedStress.report.cases[0].appOutcome='app-runtime-failure';failedStress.native.normal.status='failed';failedStress.native.normal.errors=['page-crash'];failedStress.native.normal.failure='Page crashed';refreshMobileBundle(failedStress);
 const kernelFailedStress=createMobileBundle(path.join(directory,'kernel-failed-stress'),source,'stress-512mb');kernelFailedStress.report.status='failed';kernelFailedStress.report.cases[0].appOutcome='kernel-oom';kernelFailedStress.report.cases[0].after.events={max:1,oom:1,oom_kill:1};kernelFailedStress.report.cases[0].containerOOMKilled=true;kernelFailedStress.report.cases[0].server.status='failed';kernelFailedStress.report.cases[0].server.errors=['Browser budget OOM: oom','Browser budget OOM: oom_kill'];kernelFailedStress.report.cases[0].server.engineExit={exitCode:137,signal:null};kernelFailedStress.native.normal.status='failed';kernelFailedStress.native.normal.errors=['page-crash'];kernelFailedStress.native.normal.failure='page.goto: Page crashed';refreshMobileBundle(kernelFailedStress);
 const reportArgs=(one,two)=>['--mobile-report',path.join(one,'report.json'),'--mobile-stress-report',path.join(two,'report.json')];
 const missingArgs=reportArgs(path.join(directory,'missing-required'),path.join(directory,'missing-stress'));
 const scenarios=[
  {name:'not-run',selected:false,jobResult:'skipped',args:missingArgs,status:'not-run'},
  {name:'unavailable',selected:true,jobResult:'failure',args:missingArgs,status:'unavailable'},
  {name:'invalid',selected:true,jobResult:'success',args:reportArgs(invalid.directory,stress.directory),status:'invalid'},
  {name:'pass',selected:true,jobResult:'success',args:reportArgs(required.directory,stress.directory),status:'pass'},
  {name:'app-failed',selected:true,jobResult:'success',args:reportArgs(required.directory,failedStress.directory),status:'app-failed'},
  {name:'failed',selected:true,jobResult:'success',args:reportArgs(required.directory,kernelFailedStress.directory),status:'failed'},
 ];
 for(const scenario of scenarios)await t.test(scenario.name,sub=>{
  const result=aggregateCopy(sub,fixture,(_,needsFile)=>{const needs=JSON.parse(fs.readFileSync(needsFile,'utf8'));needs['validation-context'].outputs={policy:scenario.selected?'optional-mobile-dispatch-v1':'outgoing-branch-push-v1','mobile-diagnostics':String(scenario.selected)};needs['mobile-memory']={result:scenario.jobResult};writeJson(needsFile,needs);},scenario.args);
  assert.equal(result.status,0,'Optional '+scenario.name+' diagnostics must not fail the required aggregate: '+result.stdout+result.stderr);
  const aggregate=JSON.parse(fs.readFileSync(path.join(result.outputDir,'aggregate.json'),'utf8'));
  assert.equal(aggregate.status,'passed');assert.equal(aggregate.mobileMemory.status,scenario.status);assert.equal(aggregate.mobileMemory.selected,scenario.selected);assert.equal(aggregate.mobileMemory.jobResult,scenario.jobResult);assert.equal(aggregate.mobileMemory.required,false);
  if(scenario.status==='app-failed'){assert.equal(aggregate.mobileMemory.stress.status,'failed');assert.ok(aggregate.mobileMemory.stress.cases.some(row=>row.outcome==='app-runtime-failure'));}
  if(scenario.status==='failed'){assert.equal(aggregate.mobileMemory.stress.status,'failed');assert.ok(aggregate.mobileMemory.stress.cases.some(row=>row.outcome==='kernel-oom'));}
 });
 const integrityRoot=fs.mkdtempSync(path.join(os.tmpdir(),'chain-selected-mobile-integrity-'));t.after(()=>fs.rmSync(integrityRoot,{recursive:true,force:true}));
 const stressIntegrity=createMobileBundle(path.join(integrityRoot,'stress'),source,'stress-512mb');
 const variants=['failed-job','wrong-source','no-oom','unbounded','duplicate-tasks','missing-normal','legacy-scope','external-driver-network','remote-disconnect-only','control-outside-browser'];
 for(const variant of variants)await t.test('selected report '+variant,sub=>{
  const directory=path.join(integrityRoot,variant),required=createMobileBundle(directory,source);
  if(variant==='wrong-source')required.report.candidateTree='0'.repeat(40);
  if(variant==='no-oom')required.report.negativeControl.after.events.oom_kill=0;
  if(variant==='unbounded')required.report.cases[0].after.memoryMaxBytes=1024000000;
  if(variant==='duplicate-tasks')required.native.normal.presses[1].offeredTaskId=required.native.normal.presses[0].offeredTaskId;
  if(variant==='missing-normal')required.report.cases.shift();
  if(variant==='legacy-scope')required.report.schemaVersion=1;
  if(variant==='external-driver-network')required.report.cases[0].driver.networkMode='bridge';
  if(variant==='remote-disconnect-only')required.report.cases[0].server.cleanup.engineExited=false;
  if(variant==='control-outside-browser')required.report.negativeControl.server.control.membership='0::/outside';
  refreshMobileBundle(required);
  const result=aggregateCopy(sub,fixture,(_,needsFile)=>{const needs=JSON.parse(fs.readFileSync(needsFile,'utf8'));needs['validation-context'].outputs={policy:'optional-mobile-dispatch-v1','mobile-diagnostics':'true'};needs['mobile-memory']={result:variant==='failed-job'?'failure':'success'};writeJson(needsFile,needs);},['--mobile-report',path.join(required.directory,'report.json'),'--mobile-stress-report',path.join(stressIntegrity.directory,'report.json')]);
  assert.equal(result.status,0,'Invalid or failed selected diagnostic data cannot fail the mandatory aggregate: '+variant+' '+result.stderr);
  const aggregate=JSON.parse(fs.readFileSync(path.join(result.outputDir,'aggregate.json'),'utf8'));
  assert.equal(aggregate.status,'passed');assert.equal(aggregate.mobileMemory.status,variant==='failed-job'?'unavailable':'invalid');
  assert.ok(aggregate.mobileMemory.observedReports.required.reportSha256,'The actual optional report bytes remain identified.');
  if(variant!=='failed-job')assert.ok(aggregate.mobileMemory.errors.length>0,'The selected report integrity failure must remain visible: '+variant);
 });
});
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

test('test group workflow scanner command rejects missing parallel group evidence', async t => {
  const workflow=fs.readFileSync(path.join(repository,'.github/workflows/data-safety.yml'),'utf8'),lines=workflow.split('\n');
  const jobLines=name=>{const start=lines.findIndex(line=>line===`  ${name}:`),end=lines.findIndex((line,index)=>index>start&&/^  [A-Za-z0-9_-]+:\s*$/.test(line));assert.notEqual(start,-1,'workflow job exists: '+name);return lines.slice(start,end<0?undefined:end);};
  const jobHeader=job=>{const steps=job.indexOf('    steps:');return job.slice(0,steps<0?job.length:steps).join('\n');};
  const jobSteps=job=>{const result=[];let step=null;for(const line of job){if(line.startsWith('      - ')){if(step)result.push(step.join('\n'));step=[line];}else if(step)step.push(line);}if(step)result.push(step.join('\n'));return result;};
  const scanner=jobLines('scanner-tests'),mobile=jobLines('mobile-memory'),scannerHeader=jobHeader(scanner),mobileHeader=jobHeader(mobile),steps=jobSteps(scanner);
  const optionalDownload=steps.find(step=>step.includes('uses: actions/download-artifact@v4')&&step.includes('name: mobile-memory-${{ github.run_id }}-${{ github.run_attempt }}'));
  await t.test('mobile download follows the default-off explicit branch selector',()=>{
    assert.match(workflow,/^  workflow_dispatch:\n    inputs:\n      optional_mobile_diagnostics:\n        description: Run the capped mobile WebKit diagnostic story for this branch\.\n        required: false\n        default: false\n        type: boolean$/m,'The diagnostic selector must stay default-off.');
    assert.match(mobileHeader,/^    if: \$\{\{ github\.event_name == 'workflow_dispatch' && needs\.validation-context\.outputs\.mobile-diagnostics == 'true' \}\}$/m,'Only explicit branch dispatch may run the optional producer.');
    assert.ok(optionalDownload,'scanner-tests must retain the exact run/attempt-bound optional artifact input.');
    assert.match(optionalDownload,/^        if: always\(\) && needs\.validation-context\.outputs\.mobile-diagnostics == 'true'$/m,'The optional download must be skipped when unselected but remain inspectable after selected producer failure.');
    assert.match(optionalDownload,/^          name: mobile-memory-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}$/m);
    assert.match(optionalDownload,/^          path: \$\{\{ runner\.temp \}\}\/mobile-memory$/m);
  });
  await t.test('only optional mobile download failure is contained; mandatory failures still block',()=>{
    assert.ok(optionalDownload,'The exact optional download step must be present.');
    assert.match(optionalDownload,/^        continue-on-error: true$/m,'Only this optional download failure may be nonfatal to scanner-tests.');
    assert.match(scannerHeader,/^    if: always\(\)$/m,'The aggregate consumer must still collect predecessor results.');
    assert.doesNotMatch(scannerHeader,/continue-on-error\s*:/,'Do not make the entire scanner job nonfatal.');
    assert.doesNotMatch(mobileHeader,/continue-on-error\s*:/,'Do not make the optional producer job nonfatal.');
    const tolerated=steps.filter(step=>/^        continue-on-error:\s*true\s*$/m.test(step));
    assert.deepEqual(tolerated,[optionalDownload],'Failure containment must be scoped to the optional download step only.');
    const requiredDownloads=steps.filter(step=>step.includes('uses: actions/download-artifact@v4')&&step!==optionalDownload);
    assert.ok(requiredDownloads.some(step=>step.includes('regression-${{ github.run_id }}-${{ github.run_attempt }}-core')),'A mandatory group artifact control remains present.');
    assert.ok(requiredDownloads.some(step=>step.includes('ci-routing-${{ github.run_id }}-${{ github.run_attempt }}')),'The required routing proof remains present.');
    for(const step of requiredDownloads)assert.doesNotMatch(step,/continue-on-error\s*:/,'Required artifact download must remain fatal.');
    const aggregate=steps.find(step=>step.includes('name: Verify complete required cohort'));
    assert.ok(aggregate,'The existing required aggregate consumer must remain present.');
    assert.doesNotMatch(aggregate,/continue-on-error\s*:/,'The mandatory aggregate result must remain fatal.');
  });
  const fixture=createFixture(t),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'chain-workflow-aggregate-'));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));fs.mkdirSync(path.join(temporary,'groups'));
  for(const group of groups){const result=invoke(fixture,{group});assert.equal(result.status,0,result.stdout+result.stderr);fs.cpSync(result.outputDir,path.join(temporary,'groups',group),{recursive:true});}
  fs.rmSync(path.join(temporary,'groups/scenery/result.json'));
  writeJson(path.join(temporary,'needs.json'),Object.fromEntries(['validation-context','event-gates','cohort-routing','regression'].map(id=>[id,{result:'success'}])));
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
  const scenarios=[['same name assigned in another file',JSON.stringify(fixtureScriptRoot)],['file wrapper title','"tests.js"'],['unknown skipped root','"unclassified skipped root"']];
  for(const [name,title]of scenarios)await parent.test(name,t=>{
    const fixture=createFixture(t),file=path.join(fixture.root,'tests.js');
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
  const fixture=createFixture(t),file=path.join(fixture.root,'tests.js');
  fs.appendFileSync(file,'\nfor(const title of [])test(title,()=>{});\n');git(fixture.root,'add','.');git(fixture.root,'commit','-qm','existing dynamic site');
  fixture.comparisonBase=git(fixture.root,'rev-parse','HEAD');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('of []','of ["explicit future dynamic root"]'));
  const catalog=JSON.parse(fs.readFileSync(path.join(fixture.root,'scripts/test-group-assignments.json')));catalog.rootAssignments.push({root:'explicit future dynamic root',file:'tests.js',group:'scenery',registration:'dynamic'});writeJson(path.join(fixture.root,'scripts/test-group-assignments.json'),catalog);
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
    coveredBy:{runId:'71',runAttempt:'2',jobId:'701',sourceSha:'a'.repeat(40),checkoutSha:'b'.repeat(40),checkoutTree:identity.checkoutTree,comparisonBase:identity.comparisonBase,resultSha256:'8'.repeat(64),artifactId:'901',artifactName:'regression-71-2-'+group,artifactSha256:'7'.repeat(64),artifactExpiresAt:'2030-01-01T00:00:00Z'}};
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

test('test group catalog routes real declarations despite matching quoted fixture text', t => {
  const fixture = createFixture(t);
  const titles = [
    'Landscape location: visible default-sky copy does not name Orlando',
    'RISK Quick start content: essential steps stay brief and detailed help remains user-facing in existing sections',
  ];
  const candidateCatalog = JSON.parse(fs.readFileSync(path.join(repository, 'scripts/test-group-assignments.json'), 'utf8'));
  const selected = titles.map(title => {
    const rows = candidateCatalog.rootAssignments.filter(row => row.root === title);
    assert.equal(rows.length, 1, 'each known real case needs exactly one catalog row');
    assert.equal(rows[0].group, 'native-process', 'retain the historical group membership');
    return rows[0];
  });
  const journal = path.join(fixture.root, 'real-case-executions.jsonl');
  const declarations = titles.map(title => `test(${JSON.stringify(title)}, () => { fs.appendFileSync(process.env.CHAIN_REAL_CASE_JOURNAL, ${JSON.stringify(title + '\n')}); });`).join('\n');
  const quoted = `const quotedFixtureSource = ${JSON.stringify(declarations)};\n`;
  fs.appendFileSync(path.join(fixture.root, 'tests.js'), '\n' + quoted + declarations + '\n');
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

test('test group aggregate requires both exact native button safety reports',async t=>{ // Copy the complete real contract module closure before binding fixture identity.
 const fixture=createFixture(t,{mobileStory:true,nativeTitle:'RISK repository process: required native button actions execute in Chromium and WebKit'});fixture.originals=new Map();
 for(const group of groups){const result=invoke(fixture,{group});assert.equal(result.status,0,result.stdout+result.stderr);fixture.originals.set(group,result.outputDir);}
 const absent=aggregateCopy(t,fixture);assert.notEqual(absent.status,0,'scanner-tests must reject a passing native root that omitted both required button engine artifacts');assert.match(absent.stderr,/Both required distinct native button reports must be present/);
 const manifest={schemaVersion:1,requiredRuntimeAssets:JSON.parse(fs.readFileSync(path.join(fixture.root,'scripts/button-safety-inventory.json'),'utf8')).requiredRuntimeAssets,requiredMobileStory:JSON.parse(fs.readFileSync(path.join(fixture.root,'scripts/button-safety-inventory.json'),'utf8')).requiredMobileStory,requiredActions:['act:add'],requiredScenarios:['populated','oversized retained-source'],requiredWorkload:{savedTasks:400,rapidAttempts:10,rapidWindowMs:2000},requiredRapidActions:['act:add']},bytes=Buffer.from(JSON.stringify(manifest));
 for(const name of ['button-safety-contract.mjs','button-safety-startup.mjs','button-safety-timeline-core.mjs'])fs.copyFileSync(path.join(repository,'scripts',name),path.join(fixture.root,'scripts',name));fs.writeFileSync(path.join(fixture.root,'scripts/button-safety-inventory.json'),bytes);
 // Fixture source identity includes the authoritative inventory before producing results.
 git(fixture.root,'add','.');git(fixture.root,'commit','-qm','fixture button inventory');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
 fixture.originals.clear();for(const group of groups){const result=invoke(fixture,{group});assert.equal(result.status,0,result.stdout+result.stderr);fixture.originals.set(group,result.outputDir);}
 const inject=(root,variant)=>{
  const group=path.join(root,'native-process'),file=path.join(group,'result.json'),result=JSON.parse(fs.readFileSync(file));
  for(const engine of ['chromium','webkit']){
   const report={schemaVersion:1,kind:'button-safety',engine,status:'passed',candidateCommit:result.resultIdentity.checkoutSha,candidateTree:result.resultIdentity.checkoutTree,inventorySha256:createHash('sha256').update(bytes).digest('hex'),assets:{...manifest.requiredRuntimeAssets},requiredActions:['act:add'],requiredScenarios:manifest.requiredScenarios,scenarios:manifest.requiredScenarios.map(name=>({name,status:'passed',setup:{currentTasks:400,durableTasks:400,activeTasks:400,durableHash:'e'.repeat(64),fixtureRole:'active'}})),requiredWorkload:manifest.requiredWorkload,requiredRapidActions:manifest.requiredRapidActions,rapidOutcomes:[{action:'act:add',status:'passed',assertions:1,responsive:true,bursts:[{attempts:10,trustedPresses:10,unrelatedClicks:0,windowMs:1500,acceptedClicks:10,refused:0,disappeared:0,semantics:'Ten trusted native Add presses preserve one accepted task and exact source'}]}],observedActions:['act:add'],outcomes:[{action:'act:add',status:'passed',events:['click'],assertions:1,responsive:true}],errors:[],cleanup:{contextClosed:true,browserClosed:true,serverClosed:true}};
   if(engine==='webkit'){
    if(variant==='wrong engine')report.engine='chromium';if(variant==='wrong candidate')report.candidateCommit='f'.repeat(40);if(variant==='skip')report.outcomes[0].status='skipped';if(variant==='new uncovered action')report.observedActions.push('act:new-untested');if(variant==='missing action')report.outcomes=[];if(variant==='lifecycle')report.errors.push('page-crash');if(variant==='missing stress scenario')report.scenarios.pop();if(variant==='skipped stress scenario')report.scenarios[1].status='skipped';if(variant==='missing saved400')delete report.scenarios[0].setup;if(variant==='missing rapid family')report.rapidOutcomes=[];if(variant==='skipped rapid family')report.rapidOutcomes[0].status='skipped';if(variant==='slow rapid presses')report.rapidOutcomes[0].bursts[0].windowMs=2001;if(variant==='unrelated rapid action')report.rapidOutcomes[0].bursts[0].unrelatedClicks=1;
   }
   const relative='native/button-'+engine+'.json',encoded=Buffer.from(JSON.stringify(report));fs.writeFileSync(path.join(group,relative),encoded);result.artifacts.push({path:relative,bytes:encoded.length,sha256:createHash('sha256').update(encoded).digest('hex')});
  }
  writeJson(file,result);
 };
 const identity=JSON.parse(fs.readFileSync(path.join(fixture.originals.get('native-process'),'result.json'),'utf8')).resultIdentity;
 const mobileDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-desktop-mobile-proof-'));t.after(()=>fs.rmSync(mobileDir,{recursive:true,force:true}));
 createMobileBundle(mobileDir,{candidateCommit:identity.checkoutSha,candidateTree:identity.checkoutTree,sourceSha:identity.sourceSha,repository:identity.repository,runId:identity.runId,runAttempt:identity.runAttempt,eventPolicy:identity.eventPolicy});
 const stressDir=mobileDir+'-stress';t.after(()=>fs.rmSync(stressDir,{recursive:true,force:true}));createMobileBundle(stressDir,{candidateCommit:identity.checkoutSha,candidateTree:identity.checkoutTree,sourceSha:identity.sourceSha,repository:identity.repository,runId:identity.runId,runAttempt:identity.runAttempt,eventPolicy:identity.eventPolicy},'stress-512mb');
 const aggregate=(owner,variant)=>aggregateCopy(owner,fixture,(root,needs)=>{inject(root,variant);const value=JSON.parse(fs.readFileSync(needs,'utf8'));value['mobile-memory']={result:'success'};writeJson(needs,value);},['--mobile-report',path.join(mobileDir,'report.json'),'--mobile-stress-report',path.join(stressDir,'report.json')]);
 const good=aggregate(t,null);assert.equal(good.status,0,'complete two-engine button evidence accepted with independently valid mobile proof: '+good.stderr);
 for(const variant of ['wrong engine','wrong candidate','skip','new uncovered action','missing action','lifecycle','missing stress scenario','skipped stress scenario','missing saved400','missing rapid family','skipped rapid family','slow rapid presses','unrelated rapid action'])await t.test(variant,sub=>{const result=aggregate(sub,variant);assert.notEqual(result.status,0,'aggregate must reject '+variant+' even with recomputed valid artifact hashes and valid independent mobile proof');});
});


test('test group aggregate requires independently bound required and reported stress profiles',t=>{
 const fixture=aggregateFixture(t,{mobileStory:true}),source={candidateCommit:fixture.sourceSha,candidateTree:git(fixture.root,'rev-parse','HEAD^{tree}'),sourceSha:fixture.sourceSha};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-budget-pair-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const required=createMobileBundle(path.join(dir,'required'),source),stress=createMobileBundle(path.join(dir,'stress'),source,'stress-512mb');
 const passJob=(_,needs)=>{const j=JSON.parse(fs.readFileSync(needs));j['validation-context'].outputs={policy:'optional-mobile-dispatch-v1','mobile-diagnostics':'true'};j['mobile-memory']={result:'success'};writeJson(needs,j);};
 const args=['--mobile-report',path.join(required.directory,'report.json')];
 const missing=aggregateCopy(t,fixture,passJob,args);assert.equal(missing.status,0,'A missing optional stress input cannot fail the mandatory aggregate: '+missing.stderr);let missingAggregate=JSON.parse(fs.readFileSync(path.join(missing.outputDir,'aggregate.json'),'utf8'));assert.equal(missingAggregate.status,'passed');assert.equal(missingAggregate.mobileMemory.status,'unavailable');assert.deepEqual(missingAggregate.mobileMemory.missingReports,['stress']);
 const pair=[...args,'--mobile-stress-report',path.join(stress.directory,'report.json')];const good=aggregateCopy(t,fixture,passJob,pair);assert.equal(good.status,0,good.stdout+good.stderr);let goodAggregate=JSON.parse(fs.readFileSync(path.join(good.outputDir,'aggregate.json'),'utf8'));assert.equal(goodAggregate.status,'passed');assert.equal(goodAggregate.mobileMemory.status,'pass');
 stress.report.status='failed';stress.report.cases[0].appOutcome='app-runtime-failure';stress.native.normal.status='failed';stress.native.normal.errors=['page-crash'];stress.native.normal.failure='Page crashed';refreshMobileBundle(stress);const failedApp=aggregateCopy(t,fixture,passJob,pair);assert.equal(failedApp.status,0,'An honestly failed stress app remains nonblocking: '+failedApp.stderr);const failedAggregate=JSON.parse(fs.readFileSync(path.join(failedApp.outputDir,'aggregate.json'),'utf8'));assert.equal(failedAggregate.status,'passed');assert.equal(failedAggregate.mobileMemory.status,'app-failed');assert.equal(failedAggregate.mobileMemory.stress.status,'failed');assert.ok(failedAggregate.mobileMemory.stress.cases.some(row=>row.outcome==='app-runtime-failure'),'The optional application failure must remain visible in the aggregate evidence.');
 stress.report.candidateTree='0'.repeat(40);refreshMobileBundle(stress);const wrongSource=aggregateCopy(t,fixture,passJob,pair);assert.equal(wrongSource.status,0,'An invalid optional source cannot fail the mandatory aggregate: '+wrongSource.stderr);const wrongSourceAggregate=JSON.parse(fs.readFileSync(path.join(wrongSource.outputDir,'aggregate.json'),'utf8'));assert.equal(wrongSourceAggregate.status,'passed');assert.equal(wrongSourceAggregate.mobileMemory.status,'invalid');assert.equal(wrongSourceAggregate.mobileMemory.observedReports.stress.candidateTree,'0'.repeat(40));assert.ok(wrongSourceAggregate.mobileMemory.errors.some(error=>/candidateTree/.test(error)),'The exact source-identity defect must remain recorded.');
 const substitute=aggregateCopy(t,fixture,passJob,['--mobile-report',path.join(stress.directory,'report.json'),'--mobile-stress-report',path.join(required.directory,'report.json')]);assert.equal(substitute.status,0,'An invalid profile substitution cannot fail the mandatory aggregate: '+substitute.stderr);const substituteAggregate=JSON.parse(fs.readFileSync(path.join(substitute.outputDir,'aggregate.json'),'utf8'));assert.equal(substituteAggregate.status,'passed');assert.equal(substituteAggregate.mobileMemory.status,'invalid');assert.ok(substituteAggregate.mobileMemory.errors.length>0,'A profile substitution must remain invalid rather than pass.');
});

test('test group optional workload admission partitions exactly seven diagnostic roots without bypassing required execution',async parent=>{
 const optionalRoots=[
 "RISK repository process: rapid native attempts preserve Add and asynchronous dialog outcomes",
 "RISK repository process: mobile WebKit accepts ten distinct offered tasks using real touch",
 "RISK repository process: native rapid cloud selection preserves the two-second input burst",
 "RISK repository process: unavailable native attempts reuse one prepared isolated release document",
 "RISK repository process: native burst preparation survives remounts without waiving missing or late input",
 "RISK repository process: refused native releases avoid drag round trips while preserving ten real attempts",
 "RISK repository process: native scene-time bursts cannot activate controls behind a refused top-layer release"
],guard="process.env.CHAIN_OPTIONAL_WORKLOAD_DIAGNOSTICS==='1'&&process.env.CHAIN_TEST_GROUP==='optional-workload-diagnostics'&&process.execArgv.some(value=>value.startsWith('--test-name-pattern='))",reason="Accepted #1193: strict optional workload diagnostic; preserve its original assertions and all required ordinary, detector and source controls.";
 const options={nrOptional:{roots:optionalRoots,reason,guard}},fixture=createFixture(parent,options),invFile=path.join(fixture.root,'scripts/test-group-inventory.json'),inventoryBytes=fs.readFileSync(invFile);
 const evidenceRoot=process.env.CHAIN_NR_FIXTURE_EVIDENCE;let evidenceSerial=0;
 const retain=(label,result)=>{if(evidenceRoot){const destination=path.join(evidenceRoot,String(++evidenceSerial).padStart(2,'0')+'-'+label);fs.mkdirSync(destination,{recursive:true});if(result.outputDir)fs.cpSync(result.outputDir,path.join(destination,'runner'),{recursive:true});writeJson(path.join(destination,'command.json'),{status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr,outputDir:result.outputDir||null});}return result;};
 const description=retain('required-descriptor',invoke(fixture,{args:['--describe']}));assert.equal(description.status,0,description.stdout+description.stderr);const descriptor=JSON.parse(fs.readFileSync(path.join(description.outputDir,'descriptor.json')));
 assert.deepEqual(descriptor.groups.find(row=>row.id==='native-process').roots,[fixtureRoots['native-process'],fixtureScriptRoot].sort(),'Default required native partition must exclude exactly the seven explicitly classified workload roots');
 assert.deepEqual(descriptor.groups.map(row=>row.id),groups);assert.deepEqual(descriptor.optionalWorkloadDiagnostics,{roots:optionalRoots.map(root=>({root,file:'tests.js',group:'native-process',reason})),baselineCaseIds:optionalRoots.slice().sort()},'The intentional optional baseline partition retains every historical identity and source-bound reason');assert.equal(descriptor.baseline.caseCount,13);assert.equal(description.evidence.kind,'required-test-group');
 const actualSource=fs.readFileSync(path.join(repository,'tests.js'),'utf8');assert.equal(actualSource.split('const optionalWorkloadDiagnosticsSelected='+guard+';').length,2,'Actual default npm registrations share the independently required explicit-selection guard');for(const root of optionalRoots)assert.ok(actualSource.includes("if(optionalWorkloadDiagnosticsSelected){\n test('"+root+"',"),'Each actual literal workload callback has its individual registration guard: '+root);
 const journalDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-nr-journals-'));fixture.outputs.push(journalDirectory);let journalSerial=0;
 const environment=()=>({CHAIN_NR_JOURNAL:path.join(journalDirectory,String(++journalSerial)+'.jsonl'),CHAIN_OPTIONAL_WORKLOAD_DIAGNOSTICS:'1',CHAIN_TEST_GROUP:'optional-workload-diagnostics'});
 const journal=env=>fs.existsSync(env.CHAIN_NR_JOURNAL)?fs.readFileSync(env.CHAIN_NR_JOURNAL,'utf8').trim().split('\n').map(line=>JSON.parse(line)):[];
 await parent.test('required native mode rejects inherited selection without losing mandatory roots',()=>{
  const env=environment(),result=retain('required-polluted',invoke(fixture,{group:'native-process',env}));assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.evidence.kind,'required-test-group');assert.equal(result.evidence.resultIdentity.selectedGroup,'native-process');assert.deepEqual(result.evidence.cases.map(row=>row.id).sort(),[fixtureRoots['native-process'],fixtureScriptRoot].sort());assert.deepEqual(journal(env),[]);const mandatory=JSON.parse(fs.readFileSync(path.join(result.outputDir,'native/candidate-identity.json')));assert.equal(mandatory.optionalSelected,'0','Required child forcibly clears an inherited opt-in flag');assert.equal(mandatory.group,'native-process');assert.equal(result.evidence.inventory.baselineCaseCount,13);assert.equal(fs.existsSync(path.join(result.outputDir,'runtime-tmp')),false);
 });
 await parent.test('plain npm test does not register optional callbacks even with polluted opt-in environment',()=>{
  const env=environment(),isolated=isolatedFixtureNativeOutput(fixture,{...process.env,...env});delete isolated.env.NODE_TEST_CONTEXT;const result=retain('plain-npm-test',run('npm',['test'],fixture.root,isolated.env));assert.equal(result.status,0,result.stdout+result.stderr);for(const root of optionalRoots)assert.ok(!result.stdout.includes(root),'No passing placeholder, skipped registration or workload callback in default npm test');for(const root of[...Object.values(fixtureRoots),fixtureScriptRoot])assert.ok(result.stdout.includes(root));assert.deepEqual(journal(env),[]);
 });
 let optionalResult;
 await parent.test('explicit optional CLI executes seven distinct actual callbacks and retains source TAP artifacts and cleanup',()=>{
  const env=environment(),result=retain('optional-execution',invoke(fixture,{group:'native-process',args:['--optional-workload-diagnostics'],env}));optionalResult=result;assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.evidence.kind,'optional-workload-diagnostics');assert.equal(result.evidence.resultIdentity.selectedGroup,'optional-workload-diagnostics');assert.deepEqual(result.evidence.resultIdentity.expectedGroups,groups);assert.equal(result.evidence.cases.length,7);assert.deepEqual(result.evidence.cases.map(row=>row.id).sort(),optionalRoots.slice().sort());assert.ok(result.evidence.cases.every(row=>row.status==='passed'&&row.id===row.root));const rows=journal(env);assert.equal(rows.length,7);assert.deepEqual(rows.map(row=>row.root).sort(),optionalRoots.slice().sort());assert.ok(rows.every(row=>row.group==='optional-workload-diagnostics'&&row.selected==='1'));assert.equal(result.evidence.artifacts.length,7);for(const artifact of result.evidence.artifacts){const bytes=fs.readFileSync(path.join(result.outputDir,artifact.path));assert.equal(bytes.length,artifact.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);const value=JSON.parse(bytes);assert.ok(optionalRoots.includes(value.root));assert.equal(value.sha,fixture.sourceSha);assert.equal(value.tree,result.evidence.resultIdentity.checkoutTree);}assert.equal(fs.existsSync(path.join(result.outputDir,'runtime-tmp')),false);assert.ok(fs.readFileSync(path.join(result.outputDir,'test.tap'),'utf8').startsWith('TAP version 13'));assert.deepEqual(fs.readFileSync(invFile),inventoryBytes);
 });
 await parent.test('optional application failure remains an actual failed optional result with all seven attempts',()=>{
  const env={...environment(),CHAIN_NR_FAIL:optionalRoots[0]},result=retain('optional-failure',invoke(fixture,{group:'native-process',args:['--optional-workload-diagnostics'],env}));assert.notEqual(result.status,0);assert.equal(result.evidence.kind,'optional-workload-diagnostics');assert.equal(result.evidence.status,'failed');assert.equal(result.evidence.process.exitCode,1);assert.equal(result.evidence.cases.length,7);assert.equal(result.evidence.cases.filter(row=>row.status==='failed').length,1);assert.equal(journal(env).length,7);assert.equal(fs.existsSync(path.join(result.outputDir,'runtime-tmp')),false);
 });
 await parent.test('optional CLI cannot select another required group',()=>{const env=environment(),result=retain('wrong-group',invoke(fixture,{group:'core',args:['--optional-workload-diagnostics'],env}));assert.notEqual(result.status,0);assert.match(result.stderr,/optional.*native-process/i);assert.deepEqual(journal(env),[]);});
 const variants=[
  ['unknown optional identity',f=>{const p=path.join(f.root,'scripts/test-group-assignments.json'),a=JSON.parse(fs.readFileSync(p));a.rootAssignments.push({root:'unapproved optional workload',file:'tests.js',group:'native-process',admission:'optional-workload-diagnostic',admissionReason:reason});writeJson(p,a);},/optional.*(unknown|approved|exact)/i],
  ['pure mandatory root marked optional',f=>{const p=path.join(f.root,'scripts/test-group-assignments.json'),a=JSON.parse(fs.readFileSync(p));Object.assign(a.rootAssignments[0],{admission:'optional-workload-diagnostic',admissionReason:reason});writeJson(p,a);},/optional.*(unknown|approved|exact)/i],
  ['one optional classification omitted',f=>{const p=path.join(f.root,'scripts/test-group-assignments.json'),a=JSON.parse(fs.readFileSync(p));delete a.rootAssignments.find(row=>row.root===optionalRoots[0]).admission;writeJson(p,a);},/optional.*(missing|exact|seven)/i],
  ['duplicate assignment',f=>{const p=path.join(f.root,'scripts/test-group-assignments.json'),a=JSON.parse(fs.readFileSync(p));a.rootAssignments.push({...a.rootAssignments.find(row=>row.root===optionalRoots[0])});writeJson(p,a);},/overlapping/],
  ['missing source-bound reason',f=>{const p=path.join(f.root,'scripts/test-group-assignments.json'),a=JSON.parse(fs.readFileSync(p));delete a.rootAssignments.find(row=>row.root===optionalRoots[0]).admissionReason;writeJson(p,a);},/optional.*reason/i],
  ['changed baseline partition',f=>{const p=path.join(f.root,'scripts/test-group-assignments.json'),a=JSON.parse(fs.readFileSync(p)),row=a.groups.find(row=>row.id==='native-process');row.baselineRootCount--;row.baselineEstimatedDurationMs-=100;writeJson(p,a);},/measured-root.*independent baseline/],
  ['missing executable optional registration',f=>{const p=path.join(f.root,'tests.js');fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('test('+JSON.stringify(optionalRoots[0])+',','void('+JSON.stringify(optionalRoots[0])+','));},/optional.*registered 0/i],
  ['duplicate executable optional registration',f=>{fs.appendFileSync(path.join(f.root,'tests.js'),'\ntest('+JSON.stringify(optionalRoots[0])+',()=>{});\n');},/optional.*registered 2/i],
 ];
 for(const[label,mutate,pattern]of variants)await parent.test(label,sub=>{const f=createFixture(sub,options);mutate(f);const result=retain('reject-'+label.replaceAll(' ','-'),invoke(f,{args:['--describe']}));assert.notEqual(result.status,0);assert.match(result.stderr,pattern);});
 for(const duplicate of[false,true])await parent.test(duplicate?'duplicate actual optional execution is refused':'missing actual optional execution is refused',sub=>{const f=createFixture(sub,options),p=path.join(f.root,'tests.js'),before=fs.readFileSync(p,'utf8'),prefix='if(optionalWorkloadDiagnosticsSelected){\n test('+JSON.stringify(optionalRoots[0])+',';assert.ok(before.includes(prefix));const replacement=(duplicate?'if(optionalWorkloadDiagnosticsSelected){\n for(let repeat=0;repeat<2;repeat++)test(':'if(false&&optionalWorkloadDiagnosticsSelected){\n test(')+JSON.stringify(optionalRoots[0])+',';fs.writeFileSync(p,before.replace(prefix,replacement));const env=environment(),result=retain(duplicate?'duplicate-actual':'missing-actual',invoke(f,{group:'native-process',args:['--optional-workload-diagnostics'],env}));assert.notEqual(result.status,0);assert.equal(result.evidence.kind,'optional-workload-diagnostics');assert.equal(result.evidence.status,'failed');assert.match(result.stderr,duplicate?/more than once/:/did not execute|is missing/);assert.equal(journal(env).length,duplicate?8:6);});
 await parent.test('cohort digest binds the optional source-bound reason and leaves inventory bytes exact',()=>{const p=path.join(fixture.root,'scripts/test-group-assignments.json'),before=fs.readFileSync(p),a=JSON.parse(before);a.rootAssignments.find(row=>row.root===optionalRoots[0]).admissionReason+=' Additional source-bound fixture provenance.';writeJson(p,a);const result=retain('digest-reason',invoke(fixture,{args:['--describe']}));assert.equal(result.status,0,result.stderr);assert.notEqual(result.evidence.resultIdentity.cohortDigestSha256,description.evidence.resultIdentity.cohortDigestSha256);assert.deepEqual(fs.readFileSync(invFile),inventoryBytes);fs.writeFileSync(p,before);});
 await parent.test('optional results cannot replace required native evidence even after forged group identity',sub=>{
  const f=aggregateFixture(sub,options),env=environment(),optional=retain('aggregate-optional',invoke(f,{group:'native-process',args:['--optional-workload-diagnostics'],env}));assert.equal(optional.status,0,optional.stderr);const result=retain('aggregate-refusal',aggregateCopy(sub,f,collected=>{const destination=path.join(collected,'native-process');fs.rmSync(destination,{recursive:true});fs.cpSync(optional.outputDir,destination,{recursive:true});const p=path.join(destination,'result.json'),record=JSON.parse(fs.readFileSync(p));record.resultIdentity.selectedGroup='native-process';writeJson(p,record);}));assert.notEqual(result.status,0);assert.match(result.stderr,/optional|required group native-process/i);
 });
 assert.deepEqual(fs.readFileSync(invFile),inventoryBytes,'Independent historical inventory bytes remain immutable throughout partition/selection');
});

test('test group public workflow retains selected workload evidence without admitting it as ordinary proof',async parent=>{ // Copy the complete real contract module closure before binding fixture identity.
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),copy=value=>JSON.parse(JSON.stringify(value));
 const optionalRoots=["RISK repository process: rapid native attempts preserve Add and asynchronous dialog outcomes", "RISK repository process: mobile WebKit accepts ten distinct offered tasks using real touch", "RISK repository process: native rapid cloud selection preserves the two-second input burst", "RISK repository process: unavailable native attempts reuse one prepared isolated release document", "RISK repository process: native burst preparation survives remounts without waiving missing or late input", "RISK repository process: refused native releases avoid drag round trips while preserving ten real attempts", "RISK repository process: native scene-time bursts cannot activate controls behind a refused top-layer release"],guard="process.env.CHAIN_OPTIONAL_WORKLOAD_DIAGNOSTICS==='1'&&process.env.CHAIN_TEST_GROUP==='optional-workload-diagnostics'&&process.execArgv.some(value=>value.startsWith('--test-name-pattern='))",reason='Accepted #1193: strict optional workload diagnostic; preserve its original assertions and all required ordinary, detector and source controls.';
 const workflow=fs.readFileSync(path.join(repository,'.github/workflows/data-safety.yml'),'utf8'),scanner=workflow.split(/^  scanner-tests:\s*$/m)[1].split(/^  [a-z][a-z0-9-]*:\s*$/m)[0],mobile=workflow.split(/^  mobile-memory:\s*$/m)[1].split(/^  [a-z][a-z0-9-]*:\s*$/m)[0];
 const block=scanner.match(/      - name: Verify complete required cohort\n[\s\S]*?        run: \|\n((?:          [^\n]*\n|\n)*)/);assert.ok(block,'Existing whole workflow aggregate command is required');const command=block[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const fixture=createFixture(parent,{mobileStory:true,nativeTitle:'RISK repository process: required native button actions execute in Chromium and WebKit',nrOptional:{roots:optionalRoots,reason,guard}}),manifest=JSON.parse(fs.readFileSync(path.join(repository,'scripts/button-safety-inventory.json'),'utf8'));
 const ordinaryNames=["populated Add contexts settings and list", "editor done-task", "editor worked-task", "editor dot-task", "editor delete-task", "scanner yes", "scanner no", "scanner cant", "scanner postpone", "scanner cand-done", "scanner cand-worked", "scanner bench-done", "scanner bench-cant", "scanner bench-postpone", "scanner dislodge", "scanner worked", "scanner start-working", "intervention continue and skipped fresh pass", "exhausted scanner rescan and new pass", "fresh pass", "overdue WOOP native walkthrough", "recorded history and final WOOP", "manual backup restore delete and reset", "debug log refresh selection and return", "Help original apology and native backdrop dismissal", "native install accepted", "native install dismissed", "both-mode scan and resume descending", "both-mode scan and resume chance", "both-mode scan and resume squared", "theme preference changes through its button", "motion settings open and both choices respond", "scene time presets, lock, live time, and close", "location request, save name, reset, and close", "denied location request leaves the default sky", "scene view enters and returns to the task view", "Help FAQ and changelog disclosures toggle and close", "first-run Quick Start can be acknowledged", "cloud sync signs out and rejects signed-out authentication safely", "cloud retry, reload, and sign out preserve the device board during read failures", "cloud recovery reviews, protects, and applies a source with read and write failures", "Settings decision review offers Light and saves it while protecting failures", "populated comprehensive export", "oversized retained-source export", "accepted unsaved current board export", "clipboard refusal never renders payload or downloads", "download refusal keeps the prepared export usable", "unavailable saved-source export is visibly partial", "guarded file import preview cancel and confirm", "guarded paste import rejects malformed data and retains cancelled draft", "ordinary repeated selected eligibility", "ordinary Undo consumes two saved edit frames", "ordinary overdue WOOP repeated Next retains answers", "ordinary final WOOP repeated Next retains answers", "ordinary repeated cloud source choice", "ordinary repeated saved decision choice", "ordinary two distinct scanner decisions", "ordinary scene choice survives reopen and task Undo", "ordinary pending Copy refuses reentry", "ordinary obsolete Copy cannot alter replacement transfer"],repeatDefinitions=[{"name": "ordinary repeated selected eligibility", "file": "scripts/button-safety-rapid-core.mjs", "actionFamilies": ["act:list-eligibility"], "expected": "Select Eligible, then deliver two repeated native clicks and native Enter; retain mounted rows, selected control, focus and scroll. A genuinely changed filter still refreshes the view.", "minimumAttempts": 2, "assertionId": "selected-row-keeps-focus-and-scroll"}, {"name": "ordinary Undo consumes two saved edit frames", "file": "scripts/button-safety-rapid-core.mjs", "actionFamilies": ["act:undo"], "expected": "Create two real independently saved title edits, deliver two native Undo inputs, and restore the exact current and durable baseline without consuming prior history.", "minimumAttempts": 2, "assertionId": "undo-restores-two-independent-saves"}, {"name": "ordinary overdue WOOP repeated Next retains answers", "file": "scripts/button-safety-rapid-core.mjs", "actionFamilies": ["act:woop-next"], "expected": "Open overdue WOOP through the scanner; two Next attempts with one answer advance exactly one step, retain later answers and save the exact complete plan through durable reopen.", "minimumAttempts": 2, "assertionId": "overdue-woop-advances-one-step-and-reopens"}, {"name": "ordinary final WOOP repeated Next retains answers", "file": "scripts/button-safety-rapid-core.mjs", "actionFamilies": ["act:woop-next"], "expected": "Use the sole-active-task role; repeat Next twice at each answered step, never skip a required answer, then save/delete through actual controls and verify durable state.", "minimumAttempts": 2, "assertionId": "sole-task-woop-retains-required-answers"}, {"name": "ordinary repeated cloud source choice", "file": "scripts/button-safety-cloud.mjs", "actionFamilies": ["act:choose-cloud-recovery-source"], "expected": "Repeat the same eligible source twice and Enter without replacing mounted facts, focus or scroll; alternate source choice still changes selection. Preserve exact protected originals and no adoption before explicit Apply, including read/write refusal.", "minimumAttempts": 2, "assertionId": "same-cloud-source-keeps-review-and-protected-originals"}, {"name": "ordinary repeated saved decision choice", "file": "scripts/button-safety-cloud.mjs", "actionFamilies": ["act:choose-decision-recovery"], "expected": "Repeat the same Light choice twice without losing selection or gaining authority; explicit Apply saves Light, failed acknowledgement remains pending and exact device/cloud source boundaries remain protected.", "minimumAttempts": 2, "assertionId": "same-decision-choice-does-not-gain-authority"}, {"name": "ordinary two distinct scanner decisions", "file": "scripts/button-safety-rapid-core.mjs", "actionFamilies": ["act:yes"], "expected": "Deliver two distinct intentional Yes inputs tied to independently captured offered task IDs, account both accepted decisions, and preserve both in ordered current/durable scanner state without dropping or retargeting input.", "minimumAttempts": 2, "assertionId": "two-yes-inputs-bind-to-two-offered-task-ids"}, {"name": "ordinary scene choice survives reopen and task Undo", "file": "scripts/button-safety-scenes.mjs", "actionFamilies": ["scene-time:lock", "act:undo"], "expected": "Accept a scene lock, reopen and verify its durable identity, perform two distinct task edits and two native Undo inputs, retain the independently chosen scene and exact protected sources. Keep readiness, Normal/Reduced and unchanged-scene repaint checks in existing regression consumers.", "minimumAttempts": 2, "assertionId": "scene-lock-survives-reopen-and-task-undo"}, {"name": "ordinary pending Copy refuses reentry", "file": "scripts/button-safety-rapid.mjs", "actionFamilies": ["act:copy-export"], "expected": "Defer actual clipboard boundary completion, deliver two attempted Copy presses, classify first accepted/second refused, perform a trusted Download with exact prepared bytes before Copy settles, then preserve both truthful outcomes and all saved sources.", "minimumAttempts": 2, "assertionId": "pending-copy-refuses-reentry-and-keeps-download"}, {"name": "ordinary obsolete Copy cannot alter replacement transfer", "file": "scripts/button-safety-rapid.mjs", "actionFamilies": ["act:copy-export"], "expected": "Start Copy, replace/close the prepared transfer and start a newer Copy; settle the old completion while the new operation is busy, proving unchanged new status, busy state, archive identity and protected sources.", "minimumAttempts": 2, "assertionId": "obsolete-copy-cannot-change-new-transfer"}];
 assert.deepEqual(manifest.profiles.ordinary.requiredScenarios,ordinaryNames,'The fixture uses all independently accepted fifty ordinary flows plus ten named semantic cases');assert.deepEqual(manifest.profiles.ordinary.requiredRepeatCases,repeatDefinitions,'The complete six-field normative repeat inventory is frozen independently');assert.equal(manifest.requiredActions.length,114);assert.deepEqual(manifest.profiles.ordinary.fixture,{savedTasks:64,source:'signed-out-installed',authMode:'signed-out'});assert.equal(manifest.profiles['workload-diagnostic'].requiredScenarios.length,90);assert.deepEqual(manifest.profiles['workload-diagnostic'].requiredWorkload,{savedTasks:400,rapidAttempts:10,rapidWindowMs:2000});
 for(const name of ['button-safety-contract.mjs','button-safety-startup.mjs','button-safety-timeline-core.mjs'])fs.copyFileSync(path.join(repository,'scripts',name),path.join(fixture.root,'scripts',name));writeJson(path.join(fixture.root,'scripts/button-safety-inventory.json'),manifest);git(fixture.root,'add','.');git(fixture.root,'commit','-qm','bind complete independent ordinary and workload report inventories');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');fixture.originals=new Map();for(const group of groups){const result=invoke(fixture,{group});assert.equal(result.status,0,result.stdout+result.stderr);fixture.originals.set(group,result.outputDir);}
 const identity=readEvidence(fixture.originals.get('native-process')).resultIdentity,inventoryHash=hash(fs.readFileSync(path.join(fixture.root,'scripts/button-safety-inventory.json'))),journal=fs.mkdtempSync(path.join(os.tmpdir(),'chain-pa-optional-journal-'));fixture.outputs.push(journal);
 const optionalGood=invoke(fixture,{group:'native-process',args:['--optional-workload-diagnostics'],env:{CHAIN_NR_JOURNAL:path.join(journal,'passed.jsonl')}});assert.equal(optionalGood.status,0,optionalGood.stdout+optionalGood.stderr);assert.equal(optionalGood.evidence.kind,'optional-workload-diagnostics');assert.equal(optionalGood.evidence.cases.length,7);
 const optionalFailed=invoke(fixture,{group:'native-process',args:['--optional-workload-diagnostics'],env:{CHAIN_NR_JOURNAL:path.join(journal,'failed.jsonl'),CHAIN_NR_FAIL:optionalRoots[0]}});assert.equal(optionalFailed.status,1);assert.equal(optionalFailed.evidence.status,'failed');assert.equal(optionalFailed.evidence.cases.length,7);assert.equal(optionalFailed.evidence.cases.filter(row=>row.status==='failed').length,1);
 // Synthetic aggregate-parser observations only; this fixture executes no browser.
 const syntheticAuthority=stage=>({stage,mode:'scan',authUser:'observed@example.invalid',account:'board@example.invalid',identity:'observed-owner',revision:17,dirty:false,cloudStatus:'ok'});
 const cloudStages={
  'cloud sync signs out and rejects signed-out authentication safely':['before-sign-out','signed-out','authentication-refused'],
  'Settings decision review offers Light and saves it while protecting failures':['before-settings','baseline-saved','read-refused','reviewed','selected','write-refused','reviewed-retry','selected-retry','applied']
 };
 const nativeReport=(engine,profile='ordinary')=>{
  const definition=manifest.profiles[profile],count=profile==='ordinary'?64:400;
  const report={schemaVersion:1,kind:'button-safety',engine,profile,status:'passed',candidateCommit:identity.checkoutSha,candidateTree:identity.checkoutTree,inventorySha256:inventoryHash,assets:copy(manifest.requiredRuntimeAssets),requiredActions:copy(manifest.requiredActions),requiredScenarios:copy(definition.requiredScenarios),scenarios:definition.requiredScenarios.map(name=>{const fixture=profile==='ordinary'?manifest.profiles.ordinary.scenarioFixtures[name]:null,role=fixture?.fixtureRole||definition.scenarioRoles?.[name]||'active';return{name,status:'passed',setup:{currentTasks:count,durableTasks:count,activeTasks:role==='active'?count:1,durableHash:'e'.repeat(64),fixtureRole:role,...(fixture?{source:fixture.source,authMode:fixture.authMode,observedAuthority:syntheticAuthority('post-bootstrap')}:{})},...(profile==='ordinary'&&cloudStages[name]?{authorityObservations:cloudStages[name].map(stage=>({stage,authority:syntheticAuthority(stage),currentTasks:64,durableTasks:64,currentHash:'d'.repeat(64),durableHash:'e'.repeat(64)}))}:{})};}),observedActions:copy(manifest.requiredActions),outcomes:manifest.requiredActions.map(action=>({action,status:'passed',events:['click'],assertions:1,responsive:true})),errors:[],cleanup:{contextClosed:true,browserClosed:true,serverClosed:true}};
  if(profile==='ordinary')report.repeatOutcomes=repeatDefinitions.map(row=>{const attempts=[0,1].map(index=>({receiptId:engine+':'+row.name+':'+index,actionFamily:row.actionFamilies[index%row.actionFamilies.length],trusted:true,result:'accepted',receiptAtMs:10+index}));return{name:row.name,status:'passed',attempts,accounting:{attempted:2,accepted:2,refused:0,disappeared:0},assertions:[{id:row.assertionId,status:'passed',expected:row.expected,evidence:'Independent public aggregate fixture complete semantic witness'}],sourceIdentity:{candidateCommit:identity.checkoutSha,candidateTree:identity.checkoutTree,inventorySha256:inventoryHash,durableHash:'e'.repeat(64)}};});
  else{report.requiredWorkload=copy(definition.requiredWorkload);report.requiredRapidActions=copy(definition.requiredRapidActions);report.rapidOutcomes=definition.requiredRapidActions.map(action=>({action,status:'passed',assertions:1,responsive:true,bursts:[{attempts:10,trustedPresses:10,unrelatedClicks:0,windowMs:1500,acceptedClicks:1,refused:9,disappeared:0,semantics:'Original diagnostic trusted-attempt accounting remains strict'}]}));}return report;
 };
 let serial=0;const evidenceRoot=process.env.CHAIN_PA_FIXTURE_EVIDENCE;
 const execute=(owner,label,{selected=false,jobResult=selected?'success':'skipped',workload=selected?'passed':'absent',mutateRequired=()=>{},mutateOptional=()=>{},selector=String(selected),policy=selected?'optional-mobile-dispatch-v1':'outgoing-branch-push-v1',mobileAppFailure=false}={})=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-pa-public-workflow-'));owner.after(()=>fs.rmSync(directory,{recursive:true,force:true}));fs.mkdirSync(path.join(directory,'groups'));
  for(const[id,output]of fixture.originals)fs.cpSync(output,path.join(directory,'groups',id),{recursive:true});
  const native=path.join(directory,'groups/native-process'),resultFile=path.join(native,'result.json'),record=JSON.parse(fs.readFileSync(resultFile)),reports=['chromium','webkit'].map(engine=>nativeReport(engine));mutateRequired(reports);
  reports.forEach((report,index)=>{const relative='native/ordinary-button-'+index+'.json',bytes=Buffer.from(JSON.stringify(report));fs.writeFileSync(path.join(native,relative),bytes);record.artifacts.push({path:relative,bytes:bytes.length,sha256:hash(bytes)});});writeJson(resultFile,record);
  if(workload!=='absent'){
   const target=path.join(directory,'mobile-memory/optional-workload');fs.mkdirSync(path.dirname(target),{recursive:true});fs.cpSync((workload==='failed'?optionalFailed:optionalGood).outputDir,target,{recursive:true});const file=path.join(target,'result.json'),raw=JSON.parse(fs.readFileSync(file));mutateOptional(raw,target);writeJson(file,raw);
  }
  if(selected){const required=createMobileBundle(path.join(directory,'mobile-memory/required'),{candidateCommit:identity.checkoutSha,candidateTree:identity.checkoutTree,sourceSha:identity.sourceSha,repository:identity.repository,runId:identity.runId,runAttempt:identity.runAttempt,eventPolicy:identity.eventPolicy}),stress=createMobileBundle(path.join(directory,'mobile-memory/stress'),{candidateCommit:identity.checkoutSha,candidateTree:identity.checkoutTree,sourceSha:identity.sourceSha,repository:identity.repository,runId:identity.runId,runAttempt:identity.runAttempt,eventPolicy:identity.eventPolicy},'stress-512mb');if(mobileAppFailure){stress.report.status='failed';stress.report.cases[0].appOutcome='app-runtime-failure';stress.native.normal.status='failed';stress.native.normal.errors=['page-crash'];stress.native.normal.failure='Page crashed';refreshMobileBundle(stress);}}
  const needs=Object.fromEntries(['validation-context','event-gates','cohort-routing','regression'].map(id=>[id,{result:'success'}]));needs['validation-context'].outputs={policy,'mobile-diagnostics':selector};needs['mobile-memory']={result:jobResult};writeJson(path.join(directory,'needs.json'),needs);
  const env={...process.env,RUNNER_TEMP:directory,GITHUB_REPOSITORY:identity.repository,GITHUB_RUN_ID:String(identity.runId),GITHUB_RUN_ATTEMPT:String(identity.runAttempt),CHAIN_TEST_SOURCE_SHA:identity.sourceSha,CHAIN_TEST_COMPARISON_BASE:identity.comparisonBase,CHAIN_TEST_EVENT_POLICY:identity.eventPolicy};delete env.NODE_TEST_CONTEXT;const child=spawnSync('bash',['-euo','pipefail','-c',command],{cwd:fixture.root,env,encoding:'utf8',timeout:15000,maxBuffer:32*1024*1024});
  if(evidenceRoot){const target=path.join(evidenceRoot,String(++serial).padStart(2,'0')+'-'+label.replaceAll(' ','-'));fs.mkdirSync(target,{recursive:true});fs.cpSync(directory,path.join(target,'complete-workflow-artifacts'),{recursive:true});writeJson(path.join(target,'command.json'),{executable:'bash',argv:['-euo','pipefail','-c',command],cwd:fixture.root,status:child.status,signal:child.signal,error:child.error?.message,stdout:child.stdout,stderr:child.stderr});}
  assert.equal(child.error,undefined,'Actual workflow aggregate must execute: '+label);assert.equal(child.signal,null);const reportFile=path.join(directory,'aggregate/aggregate.json');assert.ok(fs.existsSync(reportFile),'Actual aggregate output retained before assertions: '+child.stdout+child.stderr);return{child,report:JSON.parse(fs.readFileSync(reportFile)),directory};
 };
 await parent.test('existing selected job executes and retains all seven diagnostics without making their producer fatal to ordinary admission',()=>{
  assert.match(workflow,/optional_mobile_diagnostics:[\s\S]*?default: false/);assert.match(mobile,/github\.event_name == 'workflow_dispatch' && needs\.validation-context\.outputs\.mobile-diagnostics == 'true'/);assert.ok(mobile.includes('--optional-workload-diagnostics'),'The selected existing job must execute the exact accepted optional public mode');assert.ok(mobile.includes('--group native-process'));assert.ok(mobile.includes('$RUNNER_TEMP/mobile-memory/optional-workload'));assert.ok(mobile.includes('playwright install --with-deps chromium webkit'));assert.match(mobile,/name: Execute selected optional workload diagnostics\n        if: always\(\)/,'A failed capped diagnostic cannot skip the separately selected workload attempt');assert.ok(command.includes('--optional-workload-result "$RUNNER_TEMP/mobile-memory/optional-workload/result.json"'),'Actual existing aggregate command carries the separately identified optional result');assert.doesNotMatch(mobile,/continue-on-error\s*:/,'Producer failure remains raw failure; only existing optional download is contained');assert.ok(mobile.includes('--profile required-1gb'));assert.ok(mobile.includes('--profile stress-512mb'));
 });
 const optionalCases=[
  ['unselected not-run',{},'not-run'],
  ['selected unavailable',{selected:true,jobResult:'failure',workload:'absent'},'unavailable'],
  ['selected pass',{selected:true},'pass'],
  ['selected failed',{selected:true,jobResult:'failure',workload:'failed'},'failed'],
  ['selected invalid kind',{selected:true,mutateOptional:r=>{r.kind='required-test-group';}},'invalid'],
  ['selected wrong source',{selected:true,mutateOptional:r=>{r.resultIdentity.checkoutTree='0'.repeat(40);}},'invalid'],
  ['selected wrong attempt',{selected:true,mutateOptional:r=>{r.resultIdentity.runAttempt=2;}},'invalid'],
  ['selected missing case',{selected:true,mutateOptional:r=>{r.cases.pop();}},'invalid'],
  ['selected duplicate case',{selected:true,mutateOptional:r=>{r.cases.push(copy(r.cases[0]));}},'invalid'],
  ['selected unknown case',{selected:true,mutateOptional:r=>{r.cases[0].id=r.cases[0].root='unknown optional callback';}},'invalid'],
  ['selected corrupt TAP',{selected:true,mutateOptional:(r,p)=>{fs.appendFileSync(path.join(p,r.process.stdout.path),'corruption');}},'invalid'],
  ['selected corrupt artifact',{selected:true,mutateOptional:(r,p)=>{fs.appendFileSync(path.join(p,r.artifacts[0].path),'corruption');}},'invalid'],
  ['selected missing artifact inventory',{selected:true,mutateOptional:r=>{r.artifacts.pop();}},'invalid'],
  ['selected incomplete cleanup',{selected:true,mutateOptional:(r,p)=>{fs.mkdirSync(path.join(p,'runtime-tmp'));}},'invalid'],
  ['unselected unexpected result',{workload:'passed'},'invalid'],
  ['unknown selector',{selected:true,selector:'1'},'invalid'],
  ['inconsistent selected policy',{selected:true,policy:'outgoing-branch-push-v1'},'invalid'],
  ['selected mobile app-failed remains raw',{selected:true,mobileAppFailure:true},'pass'],
 ];
 for(const[label,options,status]of optionalCases)await parent.test(label,sub=>{
  const{child,report}=execute(sub,label,options);assert.equal(child.status,0,'Optional '+label+' cannot fail complete required ordinary proof: '+child.stderr);assert.equal(report.status,'passed');assert.equal(report.groups.length,4);assert.equal(report.optionalWorkload?.status,status,'Actual aggregate retains the separately selected raw optional outcome: '+label);assert.equal(report.optionalWorkload.required,false);assert.equal(report.optionalWorkload.selected,['unknown selector'].includes(label)?null:Boolean(options.selected));
  if(options.workload!=='absent'&&(options.selected||options.workload==='passed')){assert.match(report.optionalWorkload.observedResult.sha256,/^[a-f0-9]{64}$/);assert.ok(report.optionalWorkload.observedResult.bytes>0);assert.equal(report.optionalWorkload.observedResult.raw.kind,label==='selected invalid kind'?'required-test-group':'optional-workload-diagnostics');}
  if(status==='pass'||status==='failed'){const raw=report.optionalWorkload.observedResult.raw;assert.equal(raw.cases.length,7);assert.deepEqual(raw.cases.map(row=>row.root).sort(),optionalRoots.slice().sort());assert.equal(raw.status,status==='pass'?'passed':'failed');assert.equal(raw.process.exitCode,status==='pass'?0:1);assert.equal(raw.artifacts.length,7);assert.equal(report.optionalWorkload.artifactCount,7);}
  if(status==='invalid')assert.ok(report.optionalWorkload.errors.length>0,'Integrity error stays visible without granting ordinary credit');if(options.mobileAppFailure){assert.equal(report.mobileMemory.status,'app-failed');assert.equal(report.mobileMemory.stress.status,'failed');}
 });
 const mandatoryCases=[
  ['missing Chromium',rows=>rows.splice(0,1)],['missing WebKit',rows=>rows.pop()],['missing both',rows=>rows.splice(0)],['duplicate engine',rows=>{rows[1].engine='chromium';}],
  ['diagnostic substitutes ordinary',rows=>{rows[1]=nativeReport('webkit','workload-diagnostic');}],['forged diagnostic profile',rows=>{rows[1].profile='workload-diagnostic';}],
  ['failed ordinary',rows=>{rows[1].status='failed';}],['wrong ordinary source',rows=>{rows[1].candidateTree='f'.repeat(40);}],['missing action',rows=>{rows[1].outcomes.pop();}],
  ['missing repeat',rows=>{rows[1].repeatOutcomes.pop();}],['untrusted input',rows=>{rows[1].repeatOutcomes[0].attempts[0].trusted=false;}],['wrong accounting',rows=>{rows[1].repeatOutcomes[0].accounting.accepted=1;}],['incomplete ordinary cleanup',rows=>{rows[1].cleanup.contextClosed=false;}],
 ];
 for(const[label,mutateRequired]of mandatoryCases)await parent.test(label,sub=>{const{child,report}=execute(sub,label,{selected:true,mutateRequired});assert.notEqual(child.status,0,'Selected complete optional diagnostics cannot replace '+label);assert.equal(report.status,'failed');assert.ok(report.issues.length>0);});
});
