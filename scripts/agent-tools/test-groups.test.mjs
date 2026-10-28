import assert from 'node:assert/strict';
import {derivePolicyProseImpact,deriveReleaseReviewPlan} from '../release-evidence.mjs';
import {createHash} from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseTap } from '../test-groups.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runner = path.join(repository, 'scripts/test-groups.mjs');
const recorder = path.join(repository, 'scripts/agent-tools/record-run.mjs');
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

function alternateNodeRuntime() {
  const candidates=[process.env.CHAIN_RUNTIME_DRIFT_NODE,'/opt/homebrew/bin/node','/opt/local/bin/node','/usr/local/bin/node','/usr/bin/node','node'].filter(Boolean);
  for(const executable of [...new Set(candidates)]){
    if(path.isAbsolute(executable)&&!fs.existsSync(executable))continue;
    const result=spawnSync(executable,['--version'],{encoding:'utf8',timeout:5000});
    const version=(result.stdout||'').trim().replace(/^v/,'');
    if(result.status===0&&/^\d+\.\d+\.\d+$/.test(version)&&version!==process.versions.node)return{executable,version};
  }
  return null;
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
  fs.copyFileSync(path.join(repository,'scripts/release-evidence.mjs'),path.join(root,'scripts/release-evidence.mjs'));
  fs.copyFileSync(path.join(repository,'scripts/agent-tools/workflow-validator.mjs'),path.join(root,'scripts/agent-tools/workflow-validator.mjs'));
  fs.copyFileSync(path.join(repository,'scripts/agent-tools/checkpoint-progress.mjs'),path.join(root,'scripts/agent-tools/checkpoint-progress.mjs'));
  if(options.policy)fs.writeFileSync(path.join(root,'AGENTS.md'),'Read [release guide](docs/release.md) before release.\n');
  if(options.early){fs.mkdirSync(path.join(root,'.github/workflows'),{recursive:true});fs.writeFileSync(path.join(root,'.github/workflows/data-safety.yml'),'jobs:\n  early-startup:\n    runs-on: controlled-fixture\n');for(const name of ['early-ci.mjs','scenery-source-fixture.mjs','mobile-source-profile.mjs','button-safety-mobile-contract.mjs','button-safety-inventory.json','button-safety-contract.mjs','button-safety-ci-policy.mjs'])fs.copyFileSync(path.join(repository,'scripts',name),path.join(root,'scripts',name));writeJson(path.join(root,'scripts/early-ci-harness-source.json'),{schemaVersion:1,files:[],testExcerpts:[],limits:['Controlled parser fixture, not imported source or actual hosted evidence.']});}
  fs.copyFileSync(path.join(repository,'scripts/agent-tools/ci-pass-reuse.mjs'),path.join(root,'scripts/agent-tools/ci-pass-reuse.mjs'));
  const coreTitle = options.coreTitle || fixtureRoots.core;
  writeJson(path.join(root, 'package.json'), {
    type: 'module',
    scripts: { 'test:group': 'node scripts/test-groups.mjs', test: 'node --test tests.js scripts/agent-tools/*.test.mjs' },
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
  let sourceSha = comparisonBase;
  if(options.earlyTransfer){
    const titles=['RISK repository process: Playwright waitForFunction predicates are synchronous','RISK repository process: scenery consumers use allocated fallback ports and preserve early native failures','RISK repository process: native scene-time bursts cannot activate controls behind a refused top-layer release','RISK scenery backdrop cache: first unchanged lighting timer reuses actual pixels while changed slots and loaded copy still paint','RISK scenery text loading: delayed bank reuses identical backdrop while current copy visitors and changed scenes refresh'];
    const added=titles.map(title=>{
      const nested=title.includes('scenery consumers')?`const env={...process.env};delete env.NODE_TEST_CONTEXT;const child=earlySpawn(process.execPath,['--test','--test-name-pattern=^RISK scenery backdrop cache:|^RISK scenery text loading:','tests.js'],{cwd:process.cwd(),env,encoding:'utf8'});assert.equal(child.status,0,child.stdout+child.stderr);const dir=path.join(process.env.CHAIN_NATIVE_OUTPUT,'fixture-port-consumer');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'no-port.tap'),child.stdout+child.stderr);`:'';
      return `test(${JSON.stringify(title)},()=>{if(process.env.EARLY_ROOT_JOURNAL)fs.appendFileSync(process.env.EARLY_ROOT_JOURNAL,${JSON.stringify(title+'\n')});${nested}});`;
    }).join('\n');
    fs.appendFileSync(path.join(root,'tests.js'),"\nimport {spawnSync as earlySpawn} from 'node:child_process';\n"+added+'\n');
    groupAssignments.rootAssignments.push(...titles.map((title,index)=>({root:title,group:index===0?'core':'native-process',file:'tests.js',executionStage:'early-startup'})));
    writeJson(path.join(root,'scripts/test-group-assignments.json'),groupAssignments);
    fs.writeFileSync(path.join(root,'scripts/button-safety-mobile-memory.mjs'),"import fs from 'node:fs';const args=process.argv.slice(2);fs.cpSync(process.env.EARLY_TRANSFER_SEED,args[args.indexOf('--output-dir')+1],{recursive:true});\n");
    if(options.profiledStress){
      const profilePath='scripts/mobile-source-profile.json',profile=JSON.parse(fs.readFileSync(path.join(repository,profilePath)));
      for(const file of Object.keys(profile.applicationAssets)){const to=path.join(root,file);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(repository,file),to);}
      fs.copyFileSync(path.join(repository,profilePath),path.join(root,profilePath));
      let source=fs.readFileSync(path.join(root,'tests.js'),'utf8');for(const title of titles)source=source.replace('test('+JSON.stringify(title),"test('"+title+"'");fs.writeFileSync(path.join(root,'tests.js'),source);
      const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
      writeJson(path.join(root,'scripts/early-ci-harness-source.json'),{schemaVersion:1,files:[],testExcerpts:titles.map(name=>{const start=source.indexOf("test('"+name+"'"),next=source.slice(start+1).search(/^test\(/m),end=next<0?source.length:start+1+next;return{name,sha256:hash(source.slice(start,end).trimEnd()+'\n')};}),canonicalLimitedProfile:{path:profilePath,sha256:hash(fs.readFileSync(path.join(root,profilePath)))},limits:['Controlled raw stress/accounting parser composition; no actual engine, cgroup or hosted acceptance.']});
    }
    git(root,'add','.');git(root,'commit','-qm','Declare exact early consumers in the existing catalog');sourceSha=git(root,'rev-parse','HEAD');
  }
  const outputs = [];
  t.after(() => {
    for (const output of outputs) fs.rmSync(output, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, baselineSha, comparisonBase, sourceSha, outputs, coreTitle, groupAssignments };
}

function addNestedRecorderConsumerCases(fixture) {
  const ordinaryChild = 'token nested ordinary case';
  const failingChild = 'token controlled nested failure';
  const sourcePath = path.join(fixture.root, 'tests.js');
  let source = fs.readFileSync(sourcePath, 'utf8');
  const anchor = "  await t.test('fixture accepted environment skip', { skip: 'baseline skip' }, () => {});";
  assert.ok(source.includes(anchor), 'the descriptor fixture keeps its required accepted-skip case');
  source = source.replace(anchor, `${anchor}\n  await t.test(${JSON.stringify(ordinaryChild)}, () => {});\n  await t.test(${JSON.stringify(failingChild)}, () => {\n    if (process.env.CHAIN_GROUP_FIXTURE_FAILURE === '1') assert.fail('controlled nested assertion');\n  });`);
  fs.writeFileSync(sourcePath, source);
  const inventoryPath = path.join(fixture.root, 'scripts/test-group-inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  inventory.requiredCases.push(
    { id: `${fixture.coreTitle} > ${ordinaryChild}`, root: fixture.coreTitle },
    { id: `${fixture.coreTitle} > ${failingChild}`, root: fixture.coreTitle },
  );
  inventory.baseline.caseCount += 2;
  inventory.baseline.passed += 2;
  writeJson(inventoryPath, inventory);
  git(fixture.root, 'add', 'tests.js', 'scripts/test-group-inventory.json');
  git(fixture.root, 'commit', '-qm', 'add nested descriptor consumer controls');
  fixture.sourceSha = git(fixture.root, 'rev-parse', 'HEAD');
  return { ordinaryChild, failingChild };
}

function makeRecorderConsumerBoundary(fixture, mode, { redactPattern } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-recorder-consumer-boundary-'));
  fixture.outputs.push(root);
  const hook = path.join(root, 'process-boundary.mjs');
  const recorderEvidence = path.join(root, 'recorder-evidence');
  const source = `import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
const childProcess = createRequire(import.meta.url)('node:child_process');
const originalSpawn = childProcess.spawn;
childProcess.spawn = function (file, args, options) {
  const isGroupRunner = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(process.env.CHAIN_GROUP_RECORDER_BOUNDARY_RUNNER);
  const isAssignedSuite = file === process.execPath && Array.isArray(args) && args.includes('--test') &&
    args.some(argument => argument.startsWith('--test-name-pattern='));
  if (isGroupRunner && isAssignedSuite) {
    const mode = process.env.CHAIN_GROUP_RECORDER_BOUNDARY_MODE;
    let childCommand = file;
    let childArgs = args;
    if (mode === 'totals-only') {
      childCommand = process.execPath;
      childArgs = ['-e', "process.stdout.write('TAP version 13\\\\n1..1\\\\n# tests 1\\\\n# pass 1\\\\n# fail 0\\\\n# cancelled 0\\\\n# skipped 0\\\\n# todo 0\\\\n')"];
    } else if (mode === 'invalid-tap') {
      childCommand = process.execPath;
      childArgs = ['-e', "process.stdout.write('TAP version invalid\\\\n# tests 1\\\\n# pass 1\\\\n# fail 0\\\\n')"];
    }
    const recorderArgs = [${JSON.stringify(recorder)}, '--repo', path.resolve(options?.cwd || process.cwd()),
      '--evidence-dir', process.env.CHAIN_GROUP_RECORDER_BOUNDARY_EVIDENCE, '--purpose', 'green',
      ...(process.env.CHAIN_GROUP_RECORDER_REDACT_PATTERN ? ['--redact-pattern', process.env.CHAIN_GROUP_RECORDER_REDACT_PATTERN] : []),
      '--', childCommand, ...childArgs];
    return originalSpawn.call(childProcess, process.execPath, recorderArgs, options);
  }
  return originalSpawn.call(childProcess, file, args, options);
};
syncBuiltinESMExports();
`;
  fs.writeFileSync(hook, source);
  return {
    root,
    hook,
    recorderEvidence,
    env: {
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${hook}`.trim(),
      CHAIN_GROUP_RECORDER_BOUNDARY_RUNNER: path.join(fixture.root, 'scripts/test-groups.mjs'),
      CHAIN_GROUP_RECORDER_BOUNDARY_MODE: mode,
      CHAIN_GROUP_RECORDER_BOUNDARY_EVIDENCE: recorderEvidence,
      ...(redactPattern ? { CHAIN_GROUP_RECORDER_REDACT_PATTERN: redactPattern } : {}),
    },
  };
}

function runPublicDescriptor(fixture, outputDir, evidenceDir) {
  const args = ['scripts/test-groups.mjs', '--group', 'core', '--output-dir', outputDir,
    '--repository', 'example/fixture', '--event-policy', 'local', '--run-id', 'fixture-run-1',
    '--run-attempt', '1', '--source-sha', fixture.sourceSha, '--comparison-base', fixture.comparisonBase, '--describe'];
  const result = run(process.execPath, [recorder, '--repo', fixture.root, '--evidence-dir', evidenceDir,
    '--purpose', 'green', '--', process.execPath, ...args], fixture.root);
  assert.equal(result.status, 0, `public --describe recorder: ${result.stdout}\n${result.stderr}`);
  return { ...result, outputDir, evidenceDir, descriptorPath: path.join(outputDir, 'descriptor.json') };
}

function preserveRecorderConsumerEvidence(label, { descriptor, boundary, groupResult, fixture }) {
  const destinationRoot = process.env.CHAIN_RECORDER_CONSUMER_TEST_EVIDENCE_DIR;
  if (!destinationRoot) return;
  const destination = path.join(path.resolve(destinationRoot), label);
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(descriptor.outputDir, path.join(destination, 'descriptor-producer'), { recursive: true });
  fs.cpSync(descriptor.evidenceDir, path.join(destination, 'descriptor-recorder'), { recursive: true });
  fs.cpSync(groupResult.outputDir, path.join(destination, 'group-consumer'), { recursive: true });
  fs.cpSync(fixture.root, path.join(destination, 'fixture'), { recursive: true });
  if (fs.existsSync(boundary.recorderEvidence)) {
    fs.cpSync(boundary.recorderEvidence, path.join(destination, 'recorder-child'), { recursive: true });
  } else fs.mkdirSync(path.join(destination, 'recorder-child'));
  fs.copyFileSync(boundary.hook, path.join(destination, 'process-boundary.mjs'));
  fs.writeFileSync(path.join(destination, 'boundary-env.json'), `${JSON.stringify(boundary.env, null, 2)}\n`);
  fs.writeFileSync(path.join(destination, 'result.json'), `${JSON.stringify({
    groupExitCode: groupResult.status,
    groupStatus: groupResult.evidence?.status,
    groupIssues: groupResult.evidence?.issues || [],
    descriptorResultIdentity: JSON.parse(fs.readFileSync(descriptor.descriptorPath, 'utf8')).resultIdentity,
  }, null, 2)}\n`);
}

test('public group qualification consumes sanitized recorder TAP against its described required identities', async t => {
  const fixture = createFixture(t, { coreTitle: 'token results keep their full nonsecret identity' });
  addNestedRecorderConsumerCases(fixture);
  const retainedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-recorder-consumer-public-describe-'));
  fixture.outputs.push(retainedRoot);
  const descriptor = runPublicDescriptor(fixture,
    path.join(retainedRoot, 'descriptor-output'), path.join(retainedRoot, 'descriptor-recorder'));
  const described = JSON.parse(fs.readFileSync(descriptor.descriptorPath, 'utf8'));
  const core = described.groups.find(group => group.id === 'core');
  assert.ok(core, 'the actual public descriptor declares the core group');
  assert.equal(core.roots.length, 1);
  assert.match(core.roots[0], /token/);
  assert.equal(core.requiredCaseIds.length, 4, 'the descriptor includes the root, accepted skip and two nested controls');
  assert.equal(new Set(core.requiredCaseIds).size, core.requiredCaseIds.length);
  const failureId = core.requiredCaseIds.find(id => id.includes('controlled nested failure'));
  const ordinaryNestedId = core.requiredCaseIds.find(id => id.includes('nested ordinary case'));
  assert.ok(failureId && ordinaryNestedId, 'nested identities come from the persisted descriptor');
  assert.ok(core.acceptedSkipCaseIds.every(id => core.requiredCaseIds.includes(id)));

  const execute = (mode, { redactPattern, env = {} } = {}) => {
    const boundary = makeRecorderConsumerBoundary(fixture, mode, { redactPattern });
    const result = invoke(fixture, {
      group: 'core',
      publicCli: true,
      env: { ...boundary.env, CHAIN_GROUP_FIXTURE_FAILURE: '0', ...env },
    });
    preserveRecorderConsumerEvidence(mode, { descriptor, boundary, groupResult: result, fixture });
    const recorderFiles = fs.existsSync(boundary.recorderEvidence)
      ? fs.readdirSync(boundary.recorderEvidence).filter(file => file.endsWith('.json'))
      : [];
    assert.equal(recorderFiles.length, 1, `${mode}: the assigned real child passed through the actual recorder; group=${result.status} stdout=${result.stdout}\nstderr=${result.stderr}\nevidence=${result.outputDir}`);
    const record = JSON.parse(fs.readFileSync(path.join(boundary.recorderEvidence, recorderFiles[0]), 'utf8'));
    const tapPath = path.join(result.outputDir, 'test.tap');
    const tap = fs.readFileSync(tapPath, 'utf8');
    assert.equal(tap, record.execution.output.stdout, `${mode}: the group consumer reads the recorder's persisted sanitized stream`);
    let cases = null;
    let parseError = null;
    try { cases = parseTap(tap).map(({ id, root, status, skipReason }) => ({ id, root, status, skipReason })); }
    catch (error) { parseError = error.message; }
    return { boundary, result, record, tap, cases, parseError };
  };

  const passed = execute('actual-pass');
  assert.equal(passed.result.status, 0, `${passed.result.stdout}\n${passed.result.stderr}`);
  assert.equal(passed.result.evidence.status, 'passed');
  assert.deepEqual(passed.result.evidence.resultIdentity, { ...described.resultIdentity, selectedGroup: 'core' });
  assert.deepEqual(passed.result.evidence.cases.map(item => item.id).sort(), [...core.requiredCaseIds].sort());
  assert.deepEqual(passed.cases.map(item => ({ id: item.id, status: item.status })).sort((a, b) => a.id.localeCompare(b.id)),
    core.requiredCaseIds.map(id => ({ id, status: core.acceptedSkipCaseIds.includes(id) ? 'skipped' : 'passed' }))
      .sort((a, b) => a.id.localeCompare(b.id)));
  assert.match(passed.tap, /^# tests 4$/m);
  assert.match(passed.tap, /^# pass 3$/m);
  assert.match(passed.tap, /^# fail 0$/m);
  assert.equal(passed.record.execution.exitCode, 0);
  assert.equal(passed.record.execution.outcome, 'passed');

  const failed = execute('nested-failure', { env: { CHAIN_GROUP_FIXTURE_FAILURE: '1' } });
  assert.equal(failed.result.status, 1, 'the public consumer rejects the recorded nested failure');
  assert.equal(failed.result.evidence.status, 'failed');
  assert.equal(failed.result.evidence.process.exitCode, 1);
  assert.equal(failed.record.execution.outcome, 'assertion-failure');
  assert.equal(failed.cases.find(item => item.id === failureId)?.status, 'failed');
  assert.equal(failed.cases.find(item => item.id === core.roots[0])?.status, 'failed');
  assert.ok(failed.result.evidence.issues.some(issue => issue.includes(failureId) && issue.includes('failed')));
  assert.match(failed.tap, /^# tests 4$/m);
  assert.match(failed.tap, /^# fail 2$/m);

  const totalsOnly = execute('totals-only');
  assert.equal(totalsOnly.record.execution.outcome, 'passed');
  assert.equal(totalsOnly.record.execution.exitCode, 0);
  assert.match(totalsOnly.tap, /^# pass 1$/m, 'the controlled child reports a passing Node summary');
  assert.deepEqual(totalsOnly.cases, [], 'a passing total without case lines yields no case identities');
  assert.equal(totalsOnly.result.status, 1, 'the public group consumer must not reconstruct missing cases from totals');
  assert.equal(totalsOnly.result.evidence.process.exitCode, 0, 'the child itself passed despite missing required proof');
  assert.ok(totalsOnly.result.evidence.issues.some(issue => issue.includes('Required baseline case') && issue.includes('missing')));

  const unparseable = execute('invalid-tap');
  assert.equal(unparseable.record.execution.outcome, 'passed');
  assert.equal(unparseable.record.execution.exitCode, 0);
  assert.match(unparseable.parseError || '', /did not produce a TAP stream/);
  assert.equal(unparseable.result.status, 1);
  assert.ok(unparseable.result.evidence.issues.some(issue => issue.includes('did not produce a TAP stream')),
    'the public consumer reports unparseable required proof explicitly');

  const redacted = execute('redacted-required-identity', { redactPattern: 'token' });
  assert.equal(redacted.record.execution.outcome, 'passed');
  assert.equal(redacted.record.execution.exitCode, 0);
  assert.match(redacted.tap, /^# pass 3$/m, 'the child summary remains fully passing after safe identity redaction');
  assert.equal(redacted.tap.includes('token'), false, 'the configured sensitive segment is absent from recorder output');
  assert.ok(redacted.tap.includes('[REDACTED]'));
  assert.equal(redacted.result.status, 1, 'the public consumer rejects a redacted required identity even when totals pass');
  assert.ok(redacted.result.evidence.issues.some(issue => issue.includes('did not execute') && issue.includes(core.roots[0])));
  assert.ok(redacted.result.evidence.issues.some(issue => issue.includes('Required baseline case') && issue.includes('missing')));
  assert.ok(!redacted.result.evidence.cases.some(item => core.requiredCaseIds.includes(item.id)),
    'neither the placeholder nor matching totals restore the required descriptor identity');
});

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

function invoke(fixture, { group = 'core', env = {}, repository = 'example/fixture', outputDir: requestedOutputDir, args = [], consumer = false, preserveNodeTestContext = false, publicCli = false } = {}) {
  const outputDir = requestedOutputDir || path.join(os.tmpdir(), `chain-test-group-output-${process.pid}-${++outputSerial}`);
  fixture.outputs.push(outputDir);
  const childEnv = { ...process.env, PATH: path.dirname(process.execPath)+path.delimiter+process.env.PATH, ...env };
  if (!preserveNodeTestContext) delete childEnv.NODE_TEST_CONTEXT;
  for(const key of ['GITHUB_EVENT_NAME','GITHUB_EVENT_PATH','GITHUB_REF'])if(!Object.hasOwn(env,key))delete childEnv[key];
  const selectedArgs = ['--group', group, '--output-dir', outputDir,
    '--repository', repository, '--event-policy', 'local', '--run-id', 'fixture-run-1', '--run-attempt', '1',
    '--source-sha', fixture.sourceSha, '--comparison-base', fixture.comparisonBase, ...args];
  const result = consumer ? run(process.execPath,['scripts/agent-tools/ci-pass-reuse.mjs','run-group',...selectedArgs],fixture.root,childEnv)
    : publicCli ? run(process.execPath,['scripts/test-groups.mjs',...selectedArgs],fixture.root,childEnv)
      : run('npm',['run','test:group','--',...selectedArgs],fixture.root,childEnv);
  return { ...result, outputDir, evidencePath: path.join(outputDir, 'result.json'), evidence: readEvidence(outputDir) };
}

function addBrowserRuntimeRootFixture(t, fixture, root, mode = 'pass', includeChromium = true) {
  const declaration = mode === 'skip'
    ? `test(${JSON.stringify(root)},{skip:'fixture setup absent'},()=>{});`
    : `test(${JSON.stringify(root)},()=>{});`;
  const copies = mode === 'duplicate' ? `${declaration}\n${declaration}` : declaration;
  const registrationFile = mode === 'missing' ? 'scripts/agent-tools/unselected.test.mjs' : 'tests.js';
  if (mode === 'missing') fs.writeFileSync(path.join(fixture.root, registrationFile), `import { test } from 'node:test';\n${copies}\n`);
  else fs.appendFileSync(path.join(fixture.root, registrationFile), `\n${copies}\n`);
  const assignmentFile = mode === 'missing' ? 'scripts/agent-tools/fixture.test.mjs' : 'tests.js';
  fixture.groupAssignments.rootAssignments.push({ root, group: 'persistence-recovery', file: assignmentFile, browserRuntime: 'ci-chromium' });
  writeJson(path.join(fixture.root, 'scripts/test-group-assignments.json'), fixture.groupAssignments);
  writeJson(path.join(fixture.root, 'package.json'), {
    type: 'module',
    scripts: { 'test:group': 'node scripts/test-groups.mjs', test: 'node --test tests.js scripts/agent-tools/*.test.mjs' },
    devDependencies: { playwright: '1.62.1' },
  });
  writeJson(path.join(fixture.root, 'package-lock.json'), {
    name: 'chain-test-group-fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'chain-test-group-fixture', version: '1.0.0', devDependencies: { playwright: '1.62.1' } },
      'node_modules/playwright': { version: '1.62.1' },
    },
  });
  const playwrightPackage = path.join(fixture.root, 'node_modules/playwright');
  fs.mkdirSync(playwrightPackage, { recursive: true });
  writeJson(path.join(playwrightPackage, 'package.json'), { name: 'playwright', version: '1.62.1', type: 'module', exports: './index.mjs' });
  fs.writeFileSync(path.join(playwrightPackage, 'index.mjs'), `
import fs from 'node:fs';import path from 'node:path';
const executable=(engine)=>path.join(process.env.PLAYWRIGHT_BROWSERS_PATH,engine,engine==='chromium'?'chrome':'pw_run.sh');
const chromium={executablePath:()=>executable('chromium'),launch:async()=>{if(!fs.existsSync(executable('chromium')))throw Error('Chromium executable does not exist at '+executable('chromium'));return{version:()=> 'fixture-chromium-151',close:async()=>{}};}};
const webkit={executablePath:()=>executable('webkit'),launch:async()=>{if(!fs.existsSync(executable('webkit')))throw Error('WebKit executable does not exist at '+executable('webkit'));return{version:()=> 'fixture-webkit',close:async()=>{}};}};
export {chromium,webkit};
`);
  const browserFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-browser-runtime-fixture-'));
  fixture.outputs.push(browserFixture);
  const browserPath = path.join(browserFixture, 'browser-install');
  fs.mkdirSync(path.join(browserPath, 'chromium'), { recursive: true });
  if (includeChromium) {
    const executable = path.join(browserPath, 'chromium/chrome');
    fs.writeFileSync(executable, 'fixture chromium executable\n');
    fs.chmodSync(executable, 0o755);
  }
  git(fixture.root, 'add', registrationFile, 'scripts/test-group-assignments.json', 'package.json', 'package-lock.json');
  git(fixture.root, 'add', '-f', 'node_modules/playwright/package.json', 'node_modules/playwright/index.mjs');
  git(fixture.root, 'commit', '-qm', 'add required fixture browser root');
  fixture.sourceSha = git(fixture.root, 'rev-parse', 'HEAD');
  return browserPath;
}

test('test group browser runtime preflight runs exactly the newly assigned roots in a scrubbed child', t => {
  const fixture = createFixture(t);
  const roots = [
    'RISK saved view broken-board startup: prior appearance stays inert until the recovered board opens',
    'RISK saved view broken-board visibility: the complete saved board is readable while durable startup waits',
    'RISK saved view full-board filters: opening preserves saved membership controls and cheap task facts',
    'RISK saved view full-board safety: supported copies and identity masks never grant authority',
    'RISK saved view broken-board startup: configured Firebase leaves the prior warning neutral until its first event',
    'RISK saved view broken-board status: configured cloud changes remain visible in the saved appearance and after recovery',
  ];
  const snapshotExpression = JSON.stringify({
    browserUrl: 'LANDSCAPE_BROWSER_URL', browserChannel: 'LANDSCAPE_BROWSER_CHANNEL', landscapePlaywright: 'LANDSCAPE_PLAYWRIGHT',
    playwrightModule: 'PLAYWRIGHT_MODULE', artifactDirectory: 'SAVED_VIEW_ARTIFACT_DIR', nodeTestContext: 'NODE_TEST_CONTEXT',
    home: 'HOME', browserPath: 'PLAYWRIGHT_BROWSERS_PATH', nativePort: 'CHAIN_NATIVE_PORT', ci: 'CI',
  });
  // These roots inspect the actual child environment while retaining the six
  // source names from the accepted startup-browser consumer set.
  const declarations = roots.map(root => `test(${JSON.stringify(root)},()=>{fs.writeFileSync(path.join(process.env.CHAIN_GROUP_OUTPUT_DIR,'browser-child-env.json'),JSON.stringify(Object.fromEntries(Object.entries(${snapshotExpression}).map(([key,name])=>[name,process.env[name]??null]))));});`).join('\n');
  fs.appendFileSync(path.join(fixture.root, 'tests.js'), `\n${declarations}\n`);
  fixture.groupAssignments.rootAssignments.push(...roots.map(root => ({ root, group: 'persistence-recovery', file: 'tests.js', browserRuntime: 'ci-chromium' })));
  writeJson(path.join(fixture.root, 'scripts/test-group-assignments.json'), fixture.groupAssignments);

  const browserFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-browser-runtime-fixture-'));
  fixture.outputs.push(browserFixture);
  const explicitBrowsers = path.join(browserFixture, 'explicit-browser-install');
  const hiddenBrowsers = path.join(browserFixture, 'hidden-browser-install');
  for (const [directory, engines] of [[explicitBrowsers, ['chromium']], [hiddenBrowsers, ['chromium', 'webkit']]]) {
    for (const engine of engines) {
      const executable = path.join(directory, engine, engine === 'chromium' ? 'chrome' : 'pw_run.sh');
      fs.mkdirSync(path.dirname(executable), { recursive: true });
      fs.writeFileSync(executable, 'fixture browser executable\n');
      fs.chmodSync(executable, 0o755);
    }
  }
  const playwrightPackage = path.join(fixture.root, 'node_modules/playwright');
  fs.mkdirSync(playwrightPackage, { recursive: true });
  writeJson(path.join(playwrightPackage, 'package.json'), { name: 'playwright', version: '1.62.1', type: 'module', exports: './index.mjs' });
  fs.writeFileSync(path.join(playwrightPackage, 'index.mjs'), `
import fs from 'node:fs';import path from 'node:path';
const executable=(engine)=>path.join(process.env.PLAYWRIGHT_BROWSERS_PATH,engine,engine==='chromium'?'chrome':'pw_run.sh');
const chromium={executablePath:()=>executable('chromium'),launch:async()=>{if(!fs.existsSync(executable('chromium')))throw Error('Chromium executable does not exist');return{version:()=> 'fixture-chromium-151',close:async()=>{}};}};
const webkit={executablePath:()=>executable('webkit'),launch:async()=>{if(!fs.existsSync(executable('webkit')))throw Error('WebKit executable does not exist at '+executable('webkit'));return{version:()=> 'fixture-webkit',close:async()=>{}};}};
export {chromium,webkit};
`);
  writeJson(path.join(fixture.root, 'package.json'), {
    type: 'module',
    scripts: { 'test:group': 'node scripts/test-groups.mjs', test: 'node --test tests.js scripts/agent-tools/*.test.mjs' },
    devDependencies: { playwright: '1.62.1' },
  });
  writeJson(path.join(fixture.root, 'package-lock.json'), {
    name: 'chain-test-group-fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'chain-test-group-fixture', version: '1.0.0', devDependencies: { playwright: '1.62.1' } },
      'node_modules/playwright': { version: '1.62.1' },
    },
  });
  git(fixture.root, 'add', 'tests.js', 'scripts/test-group-assignments.json', 'package.json', 'package-lock.json');
  git(fixture.root, 'add', '-f', 'node_modules/playwright/package.json', 'node_modules/playwright/index.mjs');
  git(fixture.root, 'commit', '-qm', 'add six required fixture browser consumers');
  fixture.sourceSha = git(fixture.root, 'rev-parse', 'HEAD');

  const result = invoke(fixture, {
    group: 'persistence-recovery',
    preserveNodeTestContext: true,
    env: {
      CI: 'true',
      NODE_TEST_CONTEXT: 'foreign-parent-context',
      LANDSCAPE_BROWSER_URL: 'http://127.0.0.1:1/local-preview',
      LANDSCAPE_BROWSER_CHANNEL: 'chrome',
      LANDSCAPE_PLAYWRIGHT: '/foreign/playwright.mjs',
      PLAYWRIGHT_MODULE: '/foreign/playwright.mjs',
      SAVED_VIEW_ARTIFACT_DIR: '/foreign/browser-artifacts',
      PLAYWRIGHT_BROWSERS_PATH: hiddenBrowsers,
      HOME: '/foreign/personal-profile',
    },
    args: ['--browser-runtime-preflight', '--browser-path', explicitBrowsers],
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.evidence.status, 'passed');
  const proof = result.evidence.browserRuntime;
  assert.equal(proof.status, 'passed');
  assert.deepEqual(proof.selectedRoots, [...roots].sort());
  assert.equal(proof.runtime.chromium.available, true);
  assert.equal(proof.runtime.chromium.version, 'fixture-chromium-151');
  assert.equal(proof.runtime.webkit.available, false, 'a hidden WebKit installation outside the explicit path cannot satisfy the control');
  assert.equal(proof.runtime.browserPath, fs.realpathSync(explicitBrowsers));
  const actualRoots = proof.outcomes.filter(item => item.id === item.root);
  assert.deepEqual(actualRoots.map(item => item.id).sort(), [...roots].sort());
  assert.ok(actualRoots.every(item => item.status === 'passed'));
  assert.equal(new Set(actualRoots.map(item => item.id)).size, roots.length);
  const childEnvironment = JSON.parse(fs.readFileSync(path.join(result.outputDir, 'browser-child-env.json'), 'utf8'));
  for (const key of ['LANDSCAPE_BROWSER_URL', 'LANDSCAPE_BROWSER_CHANNEL', 'LANDSCAPE_PLAYWRIGHT', 'PLAYWRIGHT_MODULE']) {
    assert.equal(childEnvironment[key], null, `${key} is not inherited by the browser child`);
  }
  assert.notEqual(childEnvironment.NODE_TEST_CONTEXT, 'foreign-parent-context', 'Node may install its own test marker, but the invoking parent marker is cleared');
  assert.equal(childEnvironment.HOME, path.join(result.outputDir, 'runtime-home'));
  assert.equal(childEnvironment.PLAYWRIGHT_BROWSERS_PATH, fs.realpathSync(explicitBrowsers));
  assert.equal(childEnvironment.CHAIN_NATIVE_PORT, null);
  assert.equal(childEnvironment.CI, 'true');
  assert.equal(childEnvironment.SAVED_VIEW_ARTIFACT_DIR, path.join(result.outputDir, 'browser-artifacts'));
  assert.equal(fs.existsSync(path.join(result.outputDir, 'runtime-tmp')), false);
  assert.equal(fs.existsSync(path.join(result.outputDir, 'runtime-home')), false);

  const missingReceipt = invoke(fixture, { group: 'persistence-recovery' });
  assert.notEqual(missingReceipt.status, 0, 'ordinary group execution must require the newly assigned browser cohort receipt');
  assert.match(missingReceipt.evidence?.issues?.join('\n') || '', /Required browser runtime receipt is missing/);
  const ordinaryGroup = invoke(fixture, {
    group: 'persistence-recovery',
    env: { CI: 'true' },
    args: ['--browser-runtime-receipt', result.evidencePath],
  });
  assert.equal(ordinaryGroup.status, 0, `${ordinaryGroup.stdout}\n${ordinaryGroup.stderr}`);
  assert.equal(ordinaryGroup.evidence.status, 'passed');
  assert.equal(ordinaryGroup.evidence.browserRuntimeReceipt.path, 'browser-runtime-preflight/receipt.json');
  assert.equal(fs.existsSync(path.join(ordinaryGroup.outputDir, 'browser-runtime-preflight/browser-runtime.tap')), true);
  const ordinaryBrowserRoots=ordinaryGroup.evidence.cases.filter(item=>roots.includes(item.root));
  assert.deepEqual(ordinaryBrowserRoots.map(item=>({root:item.root,status:item.status})).sort((a,b)=>a.root.localeCompare(b.root)),roots.map(root=>({root,status:'passed'})).sort((a,b)=>a.root.localeCompare(b.root)), 'the regular full group still executes and accounts for all six preflight roots');
  assert.equal(ordinaryGroup.evidence.inventory.requiredRootsForGroup,fixture.groupAssignments.rootAssignments.filter(item=>item.group==='persistence-recovery').length,'the preflight does not remove roots from ordinary full-group accounting');
});

test('test group browser runtime preflight records an explicit no-change cohort without launching an engine', t => {
  const fixture = createFixture(t);
  const result = invoke(fixture, {
    group: 'persistence-recovery',
    env: { CI: 'true' },
    args: ['--browser-runtime-preflight'],
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.evidence.status, 'no_change');
  assert.deepEqual(result.evidence.browserRuntime.selectedRoots, []);
  assert.equal(result.evidence.browserRuntime.runtime, null);
  assert.equal(fs.existsSync(path.join(result.outputDir, 'browser-runtime.tap')), false);
  const ordinaryGroup = invoke(fixture, {
    group: 'persistence-recovery',
    env: { CI: 'true' },
    args: ['--browser-runtime-receipt', result.evidencePath],
  });
  assert.equal(ordinaryGroup.status, 0, `${ordinaryGroup.stdout}\n${ordinaryGroup.stderr}`);
  assert.equal(ordinaryGroup.evidence.status, 'passed');
  assert.equal(ordinaryGroup.evidence.browserRuntimeReceipt.path, 'browser-runtime-preflight/receipt.json');
  assert.equal(fs.existsSync(path.join(ordinaryGroup.outputDir, 'browser-runtime-preflight/browser-runtime.tap')), false);
});

test('test group browser runtime preflight fails closed for skipped, duplicated, and missing-engine outcomes', t => {
  for (const [mode, includeChromium, expectedIssue] of [
    ['skip', true, /unexpectedly skipped/],
    ['duplicate', true, /executed more than once|duplicated/],
    ['missing', true, /did not execute/],
    ['pass', false, /Chromium is missing from the explicit browser installation/],
  ]) {
    const fixture = createFixture(t);
    const root = `RISK browser runtime fixture: ${mode} outcome fails closed`;
    const browserPath = addBrowserRuntimeRootFixture(t, fixture, root, mode, includeChromium);
    const result = invoke(fixture, {
      group: 'persistence-recovery',
      env: { CI: 'true' },
      args: ['--browser-runtime-preflight', '--browser-path', browserPath],
    });
    assert.notEqual(result.status, 0, `${mode} browser outcome must fail closed`);
    assert.equal(result.evidence.status, 'failed');
    assert.match(result.evidence.browserRuntime.issues.join('\n'), expectedIssue);
  }
});

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


function aggregateFixture(t,options={}) {
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

async function earlyProcessFixture(t) {
  const fixture=createFixture(t,{early:true,earlyTransfer:true,nativeTitle:'RISK repository process: required installed-client native outcomes and artifacts execute exactly once',nativeReports:true});
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-early-runtime-proof-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const description=invoke(fixture,{args:['--describe']});assert.equal(description.status,0,description.stderr);
  const descriptor=path.join(description.outputDir,'descriptor.json'),id=JSON.parse(fs.readFileSync(descriptor)).resultIdentity;
  const {createMobileBundle}=await import('./mobile-memory-fixture.mjs');
  const nativeIdentity={candidateCommit:id.checkoutSha,candidateTree:id.checkoutTree,sourceSha:id.sourceSha,repository:id.repository,runId:id.runId,runAttempt:id.runAttempt,eventPolicy:id.eventPolicy};
  const seed=createMobileBundle(path.join(directory,'seed'),nativeIdentity),stress=createMobileBundle(path.join(directory,'stress'),nativeIdentity,'stress-512mb');
  const journal=path.join(directory,'early-roots.jsonl'),early=path.join(directory,'early');
  const env={GITHUB_REPOSITORY:id.repository,CHAIN_TEST_SOURCE_SHA:id.sourceSha,CHAIN_TEST_EVENT_POLICY:id.eventPolicy,GITHUB_RUN_ID:id.runId,GITHUB_RUN_ATTEMPT:String(id.runAttempt),GITHUB_EVENT_NAME:undefined,GITHUB_REF:undefined,EARLY_TRANSFER_SEED:seed.directory,EARLY_ROOT_JOURNAL:journal,ImageOS:'fixture-os-A',ImageVersion:'fixture-image-A'};
  const producerEnv={...process.env,...env};delete producerEnv.NODE_TEST_CONTEXT;
  const produced=run(process.execPath,['scripts/early-ci.mjs','--run','--descriptor',descriptor,'--output-dir',early],fixture.root,producerEnv);
  assert.equal(produced.status,0,'The real early command must produce complete controlled evidence: '+produced.stderr);
  const receipt=path.join(early,'receipt.json'),first=fs.readFileSync(journal,'utf8');assert.equal(first.trim().split('\n').length,5);
  return {fixture,directory,descriptor,id,stress,env,journal,first,receipt};
}

async function producerPlannerConsumerChain(t,{eventName='push',eventRef='refs/heads/fixture',eventAction=null}={}){
  const fixture=createFixture(t,{early:true,earlyTransfer:true,nativeTitle:'RISK repository process: required installed-client native outcomes and artifacts execute exactly once',nativeReports:true});
  const evidenceName=eventName==='pull_request'?`pull-request-${eventAction}`:eventRef==='refs/heads/main'?'exact-main-push':'ordinary-branch-push';
  const evidence=fs.mkdtempSync(path.join(os.tmpdir(),'chain-produced-event-identity-'));t.after(()=>{
    if(process.env.CHAIN_METADATA_EVIDENCE){const retained=path.join(process.env.CHAIN_METADATA_EVIDENCE,evidenceName);fs.mkdirSync(path.dirname(retained),{recursive:true});fs.cpSync(evidence,retained,{recursive:true});}
    fs.rmSync(evidence,{recursive:true,force:true});
  });
  const descriptorDir=path.join(evidence,'descriptor'),descriptor=path.join(descriptorDir,'descriptor.json'),eventPath=path.join(evidence,'event.json');
  let sourceSha=fixture.sourceSha,checkout=git(fixture.root,'rev-parse','HEAD');
  if(eventName==='pull_request'){
    git(fixture.root,'checkout','-qb','fixture-pr-head');
    fs.writeFileSync(path.join(fixture.root,'pr-head-only.txt'),'distinct PR source tree\n');git(fixture.root,'add','pr-head-only.txt');git(fixture.root,'commit','-qm','Synthetic PR head source');sourceSha=git(fixture.root,'rev-parse','HEAD');
    git(fixture.root,'checkout','--detach',fixture.comparisonBase);git(fixture.root,'merge','--no-ff','--no-commit',sourceSha);
    fs.writeFileSync(path.join(fixture.root,'merge-checkout-only.txt'),'distinct actual merge checkout tree\n');git(fixture.root,'add','merge-checkout-only.txt');git(fixture.root,'commit','-qm','Synthetic actual PR merge checkout');checkout=git(fixture.root,'rev-parse','HEAD');
    fixture.sourceSha=sourceSha;
  }
  fs.writeFileSync(eventPath,JSON.stringify(eventName==='pull_request'?{
    action:eventAction,number:42,repository:{full_name:'example/fixture'},pull_request:{head:{sha:sourceSha,ref:'fixture-pr-head'}},
  }:{after:sourceSha,before:fixture.comparisonBase,repository:{full_name:'example/fixture'}}));
  const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,
    GITHUB_REPOSITORY:'example/fixture',GITHUB_EVENT_NAME:eventName,GITHUB_EVENT_PATH:eventPath,GITHUB_REF:eventRef,GITHUB_SHA:checkout,
    GITHUB_RUN_ID:'505001',GITHUB_RUN_ATTEMPT:'1',CHAIN_TEST_SOURCE_SHA:sourceSha,CHAIN_TEST_COMPARISON_BASE:fixture.comparisonBase,
    ImageOS:'fixture-os-A',ImageVersion:'fixture-image-A'};
  delete env.NODE_TEST_CONTEXT;
  const produced=run('npm',['run','test:group','--','--describe','--group','core','--output-dir',descriptorDir,
    '--repository','example/fixture','--event-policy',eventName,'--run-id','505001','--run-attempt','1','--source-sha',sourceSha,
    '--comparison-base',fixture.comparisonBase],fixture.root,env);
  assert.equal(produced.status,0,produced.stdout+produced.stderr);
  const actualDescriptor=JSON.parse(fs.readFileSync(descriptor));
  const planned=run(process.execPath,[path.join(repository,'scripts/agent-tools/ci-routing.mjs'),'--plan-only','1','--descriptor',descriptor,
    '--comparison-base',fixture.comparisonBase,'--evidence-dir',path.join(evidence,'routing')],fixture.root,env);
  assert.equal(planned.status,0,planned.stdout+planned.stderr);
  const route=JSON.parse(fs.readFileSync(path.join(evidence,'routing','routing.json')));
  const negativeControls=[];
  let runtimeDriftSelection=null;
  if(eventName==='push'&&eventRef==='refs/heads/fixture'){
    const bindingMutations=[
      ['eventPolicy','canonical-pr-merge-v1'],['eventName','pull_request'],['eventRef','refs/heads/other'],['eventAction','edited'],
      ['sourceSha','0'.repeat(40)],['sourceTree','1'.repeat(40)],['checkoutSha','2'.repeat(40)],['checkoutTree','3'.repeat(40)],
      ['comparisonBase','4'.repeat(40)],['runId','505002'],['runAttempt',2],
    ];
    for(const [field,value] of bindingMutations){
      const tampered=structuredClone(actualDescriptor);tampered.resultIdentity[field]=value;
      const tamperedFile=path.join(evidence,`tampered-${field}.json`);writeJson(tamperedFile,tampered);
      const planner=run(process.execPath,[path.join(repository,'scripts/agent-tools/ci-routing.mjs'),'--plan-only','1','--descriptor',tamperedFile,
        '--comparison-base',fixture.comparisonBase,'--evidence-dir',path.join(evidence,`routing-tampered-${field}`)],fixture.root,env);
      assert.notEqual(planner.status,0,`The actual planner must refuse a producer descriptor whose ${field} binding changed.`);
      const sentinel=path.join(evidence,`tampered-child-${field}`),output=path.join(evidence,`tampered-group-${field}`);
      const group=run('npm',['run','test:group','--','--group','core','--output-dir',output,'--repository','example/fixture',
        '--event-policy',route.validationContext.eventPolicy,'--run-id','505001','--run-attempt','1','--source-sha',sourceSha,
        '--comparison-base',fixture.comparisonBase,'--descriptor',tamperedFile],fixture.root,{...env,CHAIN_TEST_EVENT_POLICY:route.validationContext.eventPolicy,CHAIN_DESCRIPTOR_SENTINEL:sentinel});
      assert.notEqual(group.status,0,`The actual group consumer must refuse a producer descriptor whose ${field} binding changed: ${group.stdout}${group.stderr}`);
      assert.equal(fs.existsSync(sentinel),false,`${field} descriptor tampering must stop before any required workload child starts`);
      negativeControls.push({field,plannerStatus:planner.status,plannerError:(planner.stderr||'').trim(),groupStatus:group.status,groupError:(group.stderr||'').trim(),workloadStarted:fs.existsSync(sentinel)});
    }
  }
  if(eventName==='pull_request'){
    const prMutations=[['sourceSha',actualDescriptor.resultIdentity.checkoutSha],['sourceTree',actualDescriptor.resultIdentity.checkoutTree],
      ['checkoutSha',actualDescriptor.resultIdentity.sourceSha],['checkoutTree',actualDescriptor.resultIdentity.sourceTree]],prControls=[];
    for(const [field,value]of prMutations){
      const tampered=structuredClone(actualDescriptor);tampered.resultIdentity[field]=value;
      const tamperedFile=path.join(evidence,`pr-tampered-${field}.json`);writeJson(tamperedFile,tampered);
      const planner=run(process.execPath,[path.join(repository,'scripts/agent-tools/ci-routing.mjs'),'--plan-only','1','--descriptor',tamperedFile,
        '--comparison-base',fixture.comparisonBase,'--evidence-dir',path.join(evidence,`pr-routing-tampered-${field}`)],fixture.root,env);
      assert.notEqual(planner.status,0,`The PR planner must refuse a merge-checkout/source substitution in ${field}.`);
      const sentinel=path.join(evidence,`pr-tampered-child-${field}`),output=path.join(evidence,`pr-tampered-group-${field}`);
      const group=run('npm',['run','test:group','--','--group','core','--output-dir',output,'--repository','example/fixture',
        '--event-policy',route.validationContext.eventPolicy,'--run-id','505001','--run-attempt','1','--source-sha',sourceSha,
        '--comparison-base',fixture.comparisonBase,'--descriptor',tamperedFile],fixture.root,{...env,CHAIN_TEST_EVENT_POLICY:route.validationContext.eventPolicy,CHAIN_DESCRIPTOR_SENTINEL:sentinel});
      assert.notEqual(group.status,0,`The actual PR group consumer must reject ${field} source/merge substitution: ${group.stdout}${group.stderr}`);
      assert.equal(fs.existsSync(sentinel),false,`${field} PR binding disagreement must stop before workload execution`);
      prControls.push({field,plannerStatus:planner.status,plannerError:(planner.stderr||'').trim(),groupStatus:group.status,groupError:(group.stderr||'').trim(),workloadStarted:fs.existsSync(sentinel)});
    }
    fs.writeFileSync(path.join(evidence,'pr-source-checkout-controls.json'),JSON.stringify(prControls,null,2)+'\n');
  }
  if(eventRef==='refs/heads/main'){
    const wrongRef=run(process.execPath,[path.join(repository,'scripts/agent-tools/ci-routing.mjs'),'--plan-only','1','--descriptor',descriptor,
      '--comparison-base',fixture.comparisonBase,'--evidence-dir',path.join(evidence,'routing-wrong-main-ref')],fixture.root,{...env,GITHUB_REF:'refs/heads/fixture'});
    assert.notEqual(wrongRef.status,0,'An exact-main descriptor cannot acquire main authority after the raw ref changes.');
    const wrongPolicyOutput=path.join(evidence,'group-wrong-main-policy'),wrongPolicySentinel=path.join(evidence,'wrong-main-policy-child');
    const wrongPolicy=run('npm',['run','test:group','--','--group','core','--output-dir',wrongPolicyOutput,'--repository','example/fixture',
      '--event-policy','exact-main-push-v1','--run-id','505001','--run-attempt','1','--source-sha',sourceSha,
      '--comparison-base',fixture.comparisonBase,'--descriptor',descriptor],fixture.root,
      {...env,CHAIN_TEST_EVENT_POLICY:'outgoing-branch-push-v1',CHAIN_DESCRIPTOR_SENTINEL:wrongPolicySentinel});
    assert.notEqual(wrongPolicy.status,0,'A caller-supplied branch policy cannot relabel an exact-main raw event.');
    assert.equal(fs.existsSync(wrongPolicySentinel),false,'Wrong exact-main policy must be refused before the group workload.');
    negativeControls.push({field:'exact-main wrong ref/policy',plannerStatus:wrongRef.status,plannerError:wrongRef.stderr.trim(),groupStatus:wrongPolicy.status,groupError:wrongPolicy.stderr.trim(),workloadStarted:fs.existsSync(wrongPolicySentinel)});
  }
  if(negativeControls.length){
    fs.writeFileSync(path.join(evidence,'descriptor-negative-controls.json'),JSON.stringify(negativeControls,null,2)+'\n');
    assert.equal(negativeControls.some(row=>row.workloadStarted),false);
  }

  if(eventName==='push'&&eventRef==='refs/heads/fixture'){
  const routeEquivalent=run(process.execPath,[path.join(repository,'scripts/agent-tools/ci-routing.mjs'),'--plan-only','1','--descriptor',descriptor,
    '--comparison-base',fixture.comparisonBase,'--evidence-dir',path.join(evidence,'routing-equivalent')],fixture.root,env);
  assert.equal(routeEquivalent.status,0,routeEquivalent.stdout+routeEquivalent.stderr);
  const equivalent=JSON.parse(fs.readFileSync(path.join(evidence,'routing-equivalent','routing.json')));
  assert.deepEqual(equivalent.inputKeys,route.inputKeys,'An actually equivalent same-runtime plan preserves complete input keys.');
  const alternateNode=alternateNodeRuntime();
  if(!alternateNode)t.diagnostic('A second actual Node runtime is unavailable here; the real runner-image drift path remains active, and local runtime drift is separately recorded when a second binary is installed.');
  let nodeDrift=null;
  if(alternateNode){
    const routeNodeDrift=run(alternateNode.executable,[path.join(repository,'scripts/agent-tools/ci-routing.mjs'),'--plan-only','1','--descriptor',descriptor,
      '--comparison-base',fixture.comparisonBase,'--evidence-dir',path.join(evidence,'routing-node-drift')],fixture.root,env);
    assert.equal(routeNodeDrift.status,0,routeNodeDrift.stdout+routeNodeDrift.stderr);
    nodeDrift=JSON.parse(fs.readFileSync(path.join(evidence,'routing-node-drift','routing.json')));
    assert.equal(nodeDrift.validationContext.sourceSha,route.validationContext.sourceSha);assert.equal(nodeDrift.validationContext.checkoutSha,route.validationContext.checkoutSha);
    assert.deepEqual([nodeDrift.eventName,nodeDrift.eventRef,nodeDrift.eventAction,nodeDrift.validationContext.eventPolicy],
      [route.eventName,route.eventRef,route.eventAction,route.validationContext.eventPolicy],'Actual runtime drift preserves raw and canonical workflow authority.');
    assert.notDeepEqual(nodeDrift.inputKeys,route.inputKeys,'The changed actual Node runtime invalidates every affected gate input key.');
    assert.equal(nodeDrift.decision,'full');assert.deepEqual(nodeDrift.inputPasses,{});
    assert.equal(nodeDrift.inputContext.runtime.node,alternateNode.version,'Runtime values come from actual Node processes.');
  }
  const routeImageDrift=run(process.execPath,[path.join(repository,'scripts/agent-tools/ci-routing.mjs'),'--plan-only','1','--descriptor',descriptor,
    '--comparison-base',fixture.comparisonBase,'--evidence-dir',path.join(evidence,'routing-image-drift')],fixture.root,{...env,ImageVersion:'fixture-image-B'});
  assert.equal(routeImageDrift.status,0,routeImageDrift.stdout+routeImageDrift.stderr);
  const imageDrift=JSON.parse(fs.readFileSync(path.join(evidence,'routing-image-drift','routing.json')));
  assert.notDeepEqual(imageDrift.inputKeys,route.inputKeys,'A changed runner image also invalidates affected gate input keys.');
  assert.equal(imageDrift.decision,'full');assert.deepEqual(imageDrift.inputPasses,{});
  let selected=null;
  if(alternateNode){
    const selectedNodeDrift=run(alternateNode.executable,[path.join(repository,'scripts/agent-tools/ci-pass-reuse.mjs'),'select','--proof',path.join(evidence,'routing','routing.json'),
      '--output-file',path.join(evidence,'selected-node-drift.json')],fixture.root,env);
    assert.equal(selectedNodeDrift.status,0,selectedNodeDrift.stdout+selectedNodeDrift.stderr);
    selected=JSON.parse(fs.readFileSync(path.join(evidence,'selected-node-drift.json')));
    assert.equal(selected.decision,'full');assert.deepEqual(selected.inputPasses,{});assert.notDeepEqual(selected.inputKeys,route.inputKeys);
    runtimeDriftSelection=selected;
  }
  fs.writeFileSync(path.join(evidence,'runtime-drift-controls.json'),JSON.stringify({
    equivalent:{node:route.inputContext.runtime.node,imageOS:route.inputContext.runtime.imageOS,imageVersion:route.inputContext.runtime.imageVersion,inputKeys:route.inputKeys},
    nodeDrift:nodeDrift?{executable:alternateNode.executable,node:nodeDrift.inputContext.runtime.node,imageOS:nodeDrift.inputContext.runtime.imageOS,imageVersion:nodeDrift.inputContext.runtime.imageVersion,inputKeys:nodeDrift.inputKeys,decision:nodeDrift.decision,inputPasses:nodeDrift.inputPasses}:null,
    imageDrift:{node:imageDrift.inputContext.runtime.node,imageOS:imageDrift.inputContext.runtime.imageOS,imageVersion:imageDrift.inputContext.runtime.imageVersion,inputKeys:imageDrift.inputKeys,decision:imageDrift.decision,inputPasses:imageDrift.inputPasses},
    consumingRuntimeSelection:selected?{node:selected.inputContext.runtime.node,inputKeys:selected.inputKeys,decision:selected.decision,inputPasses:selected.inputPasses}:null,
  },null,2)+'\n');
  }
  const {createMobileBundle,refreshMobileBundle}=await import('./mobile-memory-fixture.mjs');
  const seed=createMobileBundle(path.join(evidence,'seed'),{candidateCommit:actualDescriptor.resultIdentity.checkoutSha,
    candidateTree:actualDescriptor.resultIdentity.checkoutTree,sourceSha:actualDescriptor.resultIdentity.sourceSha,repository:'example/fixture',runId:'505001',runAttempt:1,
    eventPolicy:route.validationContext.eventPolicy});
  const hostedPolicy={eventPolicy:route.validationContext.eventPolicy,eventName,eventRef};
  const bindHostedPolicy=bundle=>{bundle.report.hostedPolicy=hostedPolicy;for(const row of [bundle.report.negativeControl,...bundle.report.cases]){row.hostedPolicy=hostedPolicy;row.server.hostedPolicy=hostedPolicy;}for(const native of Object.values(bundle.native))native.hostedPolicy=hostedPolicy;refreshMobileBundle(bundle);};
  bindHostedPolicy(seed);
  const journal=path.join(evidence,'early-roots.jsonl'),early=path.join(evidence,'early');
  const consumerEnv={...env,CHAIN_TEST_EVENT_POLICY:route.validationContext.eventPolicy,EARLY_TRANSFER_SEED:seed.directory,EARLY_ROOT_JOURNAL:journal};
  const earlyRun=run(process.execPath,['scripts/early-ci.mjs','--run','--descriptor',descriptor,'--output-dir',early],fixture.root,consumerEnv);
  t.diagnostic(JSON.stringify({producer:{status:produced.status,identity:actualDescriptor.resultIdentity},planner:{status:planned.status,identity:route.validationContext},early:{status:earlyRun.status,stdout:earlyRun.stdout,stderr:earlyRun.stderr,journalExists:fs.existsSync(journal)}}));
  assert.equal(earlyRun.status,0,'Actual producer descriptor and planner context must reach the real early consumer: '+earlyRun.stdout+earlyRun.stderr);

  const receipt=path.join(early,'receipt.json'),stress=createMobileBundle(path.join(evidence,'stress'),{
    candidateCommit:actualDescriptor.resultIdentity.checkoutSha,candidateTree:actualDescriptor.resultIdentity.checkoutTree,
    sourceSha:actualDescriptor.resultIdentity.sourceSha,repository:'example/fixture',runId:'505001',runAttempt:1,eventPolicy:route.validationContext.eventPolicy},'stress-512mb');
  bindHostedPolicy(stress);
  const collected=path.join(evidence,'groups');fs.mkdirSync(collected);
  for(const group of groups){
    const output=path.join(evidence,`group-${group}`),args=['run-group','--group',group,'--output-dir',output,'--repository','example/fixture',
      '--event-policy',route.validationContext.eventPolicy,'--run-id','505001','--run-attempt','1','--source-sha',sourceSha,
      '--comparison-base',fixture.comparisonBase,'--descriptor',descriptor,'--proof',path.join(evidence,'routing','routing.json'),'--early-receipt',receipt];
    const driftedConsumer=group==='core'&&runtimeDriftSelection;
    const groupOutput=driftedConsumer?path.join(evidence,'runtime-consumer-core.env'):null;
    const result=run(driftedConsumer?'/opt/homebrew/bin/node':process.execPath,['scripts/agent-tools/ci-pass-reuse.mjs',...args],fixture.root,
      {...consumerEnv,...(groupOutput?{GITHUB_OUTPUT:groupOutput}:{})});
    assert.equal(result.status,0,`The actual ${group} consumer must use the persisted descriptor: ${result.stdout}${result.stderr}`);
    if(driftedConsumer){
      const emitted=fs.readFileSync(groupOutput,'utf8'),key=emitted.match(/^key=([a-f0-9]{64})$/m)?.[1];
      const groupReport=JSON.parse(fs.readFileSync(path.join(output,'result.json'))),producerReceipt=JSON.parse(fs.readFileSync(receipt));
      assert.equal(key,runtimeDriftSelection.inputKeys.core,'The fresh group job emits its actual consuming-runtime key.');
      assert.notEqual(key,route.inputKeys.core,'The fresh runtime-drift job cannot reuse the original runtime input.');
      assert.equal(groupReport.status,'passed');assert.equal(groupReport.earlyStageMode,'full');
      assert.equal(producerReceipt.identity.runtime.node,route.inputContext.runtime.node,'Retained early receipt keeps its actual producer runtime.');
      assert.notEqual(runtimeDriftSelection.inputContext.runtime.node,producerReceipt.identity.runtime.node,'Fresh group consuming runtime remains distinct from its saved early producer runtime.');
      fs.writeFileSync(path.join(evidence,'mixed-runtime-consumer.json'),JSON.stringify({
        earlyProducerRuntime:producerReceipt.identity.runtime,groupConsumerRuntime:runtimeDriftSelection.inputContext.runtime,
        plannedNode22Key:route.inputKeys.core,consumingNode23Key:key,groupStatus:groupReport.status,earlyStageMode:groupReport.earlyStageMode,
        earlyReceipt:groupReport.earlyReceiptRef,
      },null,2)+'\n');
    }
    fs.cpSync(output,path.join(collected,group),{recursive:true});
  }
  const needs=path.join(evidence,'needs.json');writeJson(needs,{
    'validation-context':{result:'success'},'event-gates':{result:'success',outputs:{rules:'executed',compatibility:'executed'}},
    'cohort-routing':{result:'success',outputs:{decision:'full',reused:'[]'}},'early-startup':{result:'success',outputs:{decision:'full'}},
    'mobile-stress':{result:'success'},regression:{result:'success'},
  });
  const aggregate=run('npm',['run','test:group','--','--aggregate','--group','core','--output-dir',path.join(evidence,'aggregate'),
    '--results-dir',collected,'--needs-json',needs,'--early-receipt',receipt,'--mobile-stress-report',path.join(stress.directory,'report.json'),
    '--proof',path.join(evidence,'routing','routing.json'),'--descriptor',descriptor,'--repository','example/fixture',
    '--event-policy',route.validationContext.eventPolicy,'--run-id','505001','--run-attempt','1','--source-sha',sourceSha,
    '--comparison-base',fixture.comparisonBase],fixture.root,consumerEnv);
  assert.equal(aggregate.status,0,aggregate.stdout+aggregate.stderr);
  const report=JSON.parse(fs.readFileSync(path.join(evidence,'aggregate','aggregate.json')));
  assert.equal(report.status,'passed');assert.equal(report.mode,'full');
  const receiptObject=JSON.parse(fs.readFileSync(receipt));
  assert.deepEqual(receiptObject.identity.descriptor,actualDescriptor.resultIdentity,'Early receipt retains the producer-owned descriptor exactly');
  assert.equal(receiptObject.identity.eventName,eventName);assert.equal(receiptObject.identity.eventRef,eventRef);assert.equal(receiptObject.identity.eventAction,eventAction);
  for(const file of [path.join(early,'required/report.json'),path.join(stress.directory,'report.json')]){
    const mobile=JSON.parse(fs.readFileSync(file));assert.equal(mobile.eventPolicy,route.validationContext.eventPolicy);assert.deepEqual(mobile.hostedPolicy,hostedPolicy);
    assert.equal(mobile.repository,'example/fixture');assert.equal(mobile.sourceSha,sourceSha);assert.equal(mobile.candidateCommit,checkout);
    assert.equal(mobile.candidateTree,git(fixture.root,'rev-parse','HEAD^{tree}'));assert.equal(mobile.runId,'505001');assert.equal(mobile.runAttempt,1);
  }
  for(const group of groups){const result=JSON.parse(fs.readFileSync(path.join(collected,group,'result.json')));assert.equal(result.status,'passed');
    for(const [key,value]of Object.entries({repository:'example/fixture',sourceSha,sourceTree:git(fixture.root,'rev-parse',`${sourceSha}^{tree}`),checkoutSha:checkout,
      checkoutTree:git(fixture.root,'rev-parse','HEAD^{tree}'),comparisonBase:fixture.comparisonBase,runId:'505001',runAttempt:1,eventName,eventRef,eventAction,eventPolicy:route.validationContext.eventPolicy}))assert.equal(result.resultIdentity[key],value,`${group} report identity ${key}`);
  }
  for(const artifact of [actualDescriptor.resultIdentity,report.resultIdentity]){
    assert.equal(artifact.repository,'example/fixture');assert.equal(artifact.sourceSha,sourceSha);assert.equal(artifact.sourceTree,git(fixture.root,'rev-parse',`${sourceSha}^{tree}`));
    assert.equal(artifact.checkoutSha,checkout);assert.equal(artifact.checkoutTree,git(fixture.root,'rev-parse','HEAD^{tree}'));assert.equal(artifact.comparisonBase,fixture.comparisonBase);
    assert.equal(artifact.runId,'505001');assert.equal(artifact.runAttempt,1);assert.equal(artifact.eventPolicy,route.validationContext.eventPolicy);
    assert.equal(artifact.eventName,eventName);assert.equal(artifact.eventRef,eventRef);assert.equal(artifact.eventAction,eventAction);
  }
  assert.equal(route.validationContext.eventPolicy,actualDescriptor.resultIdentity.eventPolicy);assert.equal(route.eventName,eventName);assert.equal(route.eventRef,eventRef);assert.equal(route.eventAction,eventAction);
  fs.writeFileSync(path.join(evidence,'coverage-limits.json'),JSON.stringify({
    evidenceBoundary:'Local public command/process fixtures with controlled workload children; no GitHub API, hosted runner, external provider, actual mobile runtime, or native device was invoked.',
    controlledChildren:'Prove identity propagation and current process/evidence accounting only; they do not qualify hosted, native, or deployed behavior.',
    actualInputRuntimeDrift:Boolean(runtimeDriftSelection),
  },null,2)+'\n');
  if(eventName==='pull_request'){
    assert.notEqual(sourceSha,checkout,'PR head source and actual merge checkout remain distinct commits');
    assert.notEqual(git(fixture.root,'rev-parse',`${sourceSha}^{tree}`),git(fixture.root,'rev-parse','HEAD^{tree}'),'PR head source and merge checkout retain distinct trees');
    assert.equal(actualDescriptor.resultIdentity.eventPolicy,'canonical-pr-merge-v1');assert.equal(actualDescriptor.resultIdentity.eventAction,'synchronize');
  }
}

test('test group fresh runtimes consume an intact original early predecessor',async t=>{
  const {fixture,directory,descriptor,id,stress,env,journal,first,receipt}=await earlyProcessFixture(t);
  const {file,proof}=inputCoverage(fixture);
  proof.inputContext.runtime.imageOS=env.ImageOS;proof.inputContext.runtime.imageVersion=env.ImageVersion;
  proof.inputPasses.core.inputKey=createHash('sha256').update(JSON.stringify({...proof.inputContext,gate:'core'})).digest('hex');writeJson(file,proof);
  const freshEnv={...env,ImageOS:'fixture-os-B',ImageVersion:'fixture-image-B'};
  const sentinel=path.join(directory,'fresh-core-executed');fixture.originals=new Map();
  for(const group of groups){
    const result=invoke(fixture,{group,consumer:true,args:['--proof',file,'--early-receipt',receipt],env:{...freshEnv,CHAIN_DESCRIPTOR_SENTINEL:sentinel}});
    assert.equal(result.status,0,'Fresh '+group+' on runtime B must accept the verified early producer on runtime A: '+result.stdout+result.stderr);
    assert.equal(result.evidence.status,'passed','A changed consumer runtime must execute instead of using the A group pass');fixture.originals.set(group,result.outputDir);
    if(group==='core'||group==='native-process')assert.equal(fs.readFileSync(path.join(result.outputDir,result.evidence.earlyReceiptRef.path),'utf8'),fs.readFileSync(receipt,'utf8'),'Transferred predecessor bytes retain their producer identity');
  }
  assert.equal(fs.existsSync(sentinel),true,'The real uncovered core child must run after runtime selection');
  assert.equal(fs.readFileSync(journal,'utf8'),first,'Fresh readers must not repeat any of the five early roots');
  const outputs=path.join(directory,'aggregate-outputs');
  const aggregate=()=>aggregateCopy(t,fixture,(_root,needs)=>{
    const value=JSON.parse(fs.readFileSync(needs));value['cohort-routing'].outputs={decision:'full',reused:'["core"]'};value['event-gates'].outputs={rules:'executed',compatibility:'executed'};value['early-startup']={result:'success',outputs:{decision:'full'}};value['mobile-stress']={result:'success'};writeJson(needs,value);
  },['--proof',file,'--early-receipt',receipt,'--mobile-stress-report',path.join(stress.directory,'report.json')],{...freshEnv,GITHUB_OUTPUT:outputs});
  const accepted=aggregate();assert.equal(accepted.status,0,'Runtime B aggregate must verify the intact runtime A predecessor: '+accepted.stdout+accepted.stderr);
  const report=JSON.parse(fs.readFileSync(path.join(accepted.outputDir,'aggregate.json')));assert.equal(report.mode,'full');assert.equal(report.caseCount,11);assert.equal(report.earlyEvidence.mode,'full');
  assert.match(fs.readFileSync(outputs,'utf8'),/^original=true$/m);
  const consumerEnv={...process.env,...freshEnv};delete consumerEnv.NODE_TEST_CONTEXT;
  const verify=()=>run(process.execPath,['scripts/early-ci.mjs','--verify','--descriptor',descriptor,'--receipt',receipt],fixture.root,consumerEnv);
  assert.equal(verify().status,0,'The independent public verifier must use the retained producer runtime');
  const original=fs.readFileSync(receipt);fs.rmSync(sentinel);
  for(const [name,mutate]of [
    ['changed producer image',value=>value.identity.runtime.imageVersion='mutated-image'],
    ['changed producer Node',value=>value.identity.runtime.node='0.0.0'],
    ['missing producer runtime',value=>delete value.identity.runtime],
    ['incomplete producer runtime',value=>delete value.identity.runtime.arch],
    ['unknown producer image',value=>value.identity.runtime.imageOS=''],
    ['changed producer source',value=>value.identity.descriptor.sourceSha='0'.repeat(40)],
    ['changed workflow source',value=>value.identity.workflowBlob='0'.repeat(40)],
  ])await t.test(name,()=>{
    const value=JSON.parse(original);mutate(value);writeJson(receipt,value);
    assert.notEqual(verify().status,0,'Runtime-independent verification must still reject '+name);
    const refused=invoke(fixture,{consumer:true,args:['--proof',file,'--early-receipt',receipt],env:{...freshEnv,CHAIN_DESCRIPTOR_SENTINEL:sentinel}});
    assert.notEqual(refused.status,0,'The public group must reject '+name);assert.equal(fs.existsSync(sentinel),false,'Invalid predecessor proof must stop before the workload child');
    assert.notEqual(aggregate().status,0,'The public aggregate must reject '+name);fs.writeFileSync(receipt,original);
  });
  const producerFile=path.join(path.dirname(receipt),'producer-inputs.json'),producerBytes=fs.readFileSync(producerFile);
  for(const [name,mutate]of [
    ['missing retained producer inputs',()=>fs.unlinkSync(producerFile)],
    ['changed producer runtime proof',value=>value.inputs.runtime.imageVersion='mutated-image'],
    ['changed producer source inputs',value=>value.inputs.checkoutTree='0'.repeat(40)],
    ['changed producer input key',value=>value.inputKey='0'.repeat(64)],
  ])await t.test(name,()=>{
    const producer=JSON.parse(producerBytes);mutate(producer);
    if(fs.existsSync(producerFile)){
      writeJson(producerFile,producer);
      // Keep the byte inventory coherent so semantic checks, rather than a
      // generic hash mismatch, must refuse a changed complete-input proof.
      const value=JSON.parse(original),artifact=value.artifacts.find(row=>row.path==='producer-inputs.json'),bytes=fs.readFileSync(producerFile);
      artifact.bytes=bytes.length;artifact.sha256=createHash('sha256').update(bytes).digest('hex');writeJson(receipt,value);
    }
    assert.notEqual(verify().status,0,'The public verifier must reject '+name);
    const refused=invoke(fixture,{consumer:true,args:['--proof',file,'--early-receipt',receipt],env:{...freshEnv,CHAIN_DESCRIPTOR_SENTINEL:sentinel}});
    assert.notEqual(refused.status,0,'The public group must reject '+name);assert.equal(fs.existsSync(sentinel),false);
    assert.notEqual(aggregate().status,0,'The public aggregate must reject '+name);fs.writeFileSync(producerFile,producerBytes);fs.writeFileSync(receipt,original);
  });
  assert.equal(fs.readFileSync(journal,'utf8'),first,'Refused readers launch no early children');
  t.diagnostic(JSON.stringify({scope:'Controlled public early/group/aggregate OS processes; synthetic runner labels, no engine/cgroup/hosted proof',producerRuntime:JSON.parse(original).identity.runtime,readerImage:{ImageOS:freshEnv.ImageOS,ImageVersion:freshEnv.ImageVersion},actualGroups:report.groups.map(row=>({group:row.group,cases:row.cases,earlyCases:row.earlyCases})),caseCount:report.caseCount,sourceSha:id.sourceSha}));
});

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
    if(accepted){const text=fs.readFileSync(outputs,'utf8');assert.match(text,new RegExp('^attestation-mode='+mode+'$','m'),'the existing observer must receive a truthful full/reuse attestation');assert.match(text,new RegExp('^original='+(mode==='full')+'$','m'),'only entirely executed cohorts can publish the original full producer marker');const report=JSON.parse(fs.readFileSync(path.join(result.outputDir,'aggregate.json')));assert.ok(report.groups.every(group=>group.mode!=='covered'),'The emulator-only control must retain four actually executed groups');assert.equal(report.mode,mode==='reuse'?'mixed':'full','Durable aggregate mode must include inherited emulator evidence even with four fresh groups');assert.match(text,new RegExp('^mode='+report.mode+'$','m'));}
  });
});

test('test group aggregate classifies early-only inheritance across every required source',async t=>{
  const {fixture,directory,descriptor,id,env,receipt}=await earlyProcessFixture(t);
  const {file,proof}=inputCoverage(fixture);proof.inputPasses={};
  const inputs={...proof.inputContext,runtime:{...proof.inputContext.runtime,imageOS:env.ImageOS,imageVersion:env.ImageVersion}};proof.inputContext=inputs;
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const earlyArtifact={artifactId:'902',artifactName:'original-early',artifactSha256:'3'.repeat(64),artifactExpiresAt:'2030-01-01T00:00:00Z',reportSha256:hash(fs.readFileSync(receipt))};
  proof.earlyCoverage={kind:'ci-early-execution-v1',inputs,inputKey:hash(JSON.stringify({...inputs,gate:'early-startup'})),coveredBy:{runId:'71',runAttempt:'2',earlyJobId:'703',stressJobId:'704',sourceSha:id.sourceSha,checkoutSha:id.checkoutSha,checkoutTree:id.checkoutTree,comparisonBase:id.comparisonBase,earlyReportSha256:earlyArtifact.reportSha256,earlyArtifact,stressArtifact:{...earlyArtifact,artifactId:'903',artifactName:'original-stress'}}};writeJson(file,proof);
  const early=path.join(directory,'covered-early'),childEnv={...process.env,...env};delete childEnv.NODE_TEST_CONTEXT;
  const coveredEarly=run(process.execPath,['scripts/early-ci.mjs','--covered','--descriptor',descriptor,'--proof',file,'--output-dir',early],fixture.root,childEnv);assert.equal(coveredEarly.status,0,coveredEarly.stderr);
  const inheritedReceipt=path.join(early,'receipt.json');assert.deepEqual(JSON.parse(fs.readFileSync(inheritedReceipt)).children,[],'Inherited early execution contributes no current workload');
  fixture.originals=new Map();
  for(const group of groups){const result=invoke(fixture,{group,consumer:true,args:['--proof',file,'--early-receipt',inheritedReceipt],env});assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.evidence.status,'passed');fixture.originals.set(group,result.outputDir);}
  const freshGroups=new Map(fixture.originals);
  const aggregate=({reused=[],emulators={rules:'executed',compatibility:'executed'},mutate=()=>{}}={})=>{
    const output=path.join(directory,'aggregate-outputs-'+(++outputSerial));
    const result=aggregateCopy(t,fixture,(_root,needs)=>{
      const value=JSON.parse(fs.readFileSync(needs));value['cohort-routing'].outputs={decision:'full',reused:JSON.stringify(reused)};value['event-gates'].outputs=emulators;value['early-startup']={result:'success',outputs:{decision:'reuse'}};value['mobile-stress']={result:'success'};mutate(value);writeJson(needs,value);
    },['--proof',file,'--early-receipt',inheritedReceipt],{...env,GITHUB_OUTPUT:output});
    return{...result,outputs:fs.existsSync(output)?fs.readFileSync(output,'utf8'):''};
  };
  const accepted=aggregate();assert.equal(accepted.status,0,accepted.stdout+accepted.stderr);
  const report=JSON.parse(fs.readFileSync(path.join(accepted.outputDir,'aggregate.json')));
  assert.equal(report.mode,'mixed','Four fresh groups plus inherited early execution must never claim a full aggregate');
  assert.ok(report.groups.every(group=>group.mode!=='covered'));assert.equal(report.earlyEvidence.mode,'covered');assert.equal(report.stressEvidence,null);assert.equal(report.caseCount,11);
  assert.match(accepted.outputs,/^mode=mixed$/m);assert.match(accepted.outputs,/^attestation-mode=reuse$/m);assert.match(accepted.outputs,/^original=false$/m);
  const originalProof=structuredClone(proof);
  for(const [name,mutate]of [
    ['missing original early proof',value=>delete value.earlyCoverage],
    ['changed original early report',value=>{value.earlyCoverage.coveredBy.earlyReportSha256='0'.repeat(64);value.earlyCoverage.coveredBy.earlyArtifact.reportSha256='0'.repeat(64);}],
    ['changed producing runtime proof',value=>value.earlyCoverage.inputs.runtime.imageVersion='mutated-image'],
    ['changed original early source',value=>value.earlyCoverage.coveredBy.checkoutTree='0'.repeat(40)],
  ])await t.test(name,()=>{
    const changed=structuredClone(originalProof);mutate(changed);writeJson(file,changed);const refused=aggregate();assert.notEqual(refused.status,0,'Inherited early evidence must reject '+name);assert.doesNotMatch(refused.outputs,/^original=true$/m);writeJson(file,originalProof);
  });
  const passFor=gate=>({kind:'ci-input-pass-v1',gate,inputs,inputKey:hash(JSON.stringify({...inputs,gate})),coveredBy:{runId:'71',runAttempt:'2',jobId:'701',sourceSha:id.sourceSha,checkoutSha:id.checkoutSha,checkoutTree:id.checkoutTree,comparisonBase:id.comparisonBase,resultSha256:'1'.repeat(64),artifactId:'901',artifactName:'original-'+gate,artifactSha256:'2'.repeat(64),artifactExpiresAt:'2030-01-01T00:00:00Z'}});
  proof.inputPasses=Object.fromEntries([...groups,'rules','compatibility'].map(gate=>[gate,passFor(gate)]));writeJson(file,proof);
  fixture.originals=new Map();for(const group of groups){const result=invoke(fixture,{group,consumer:true,args:['--proof',file,'--early-receipt',inheritedReceipt],env});assert.equal(result.status,0,result.stderr);assert.equal(result.evidence.status,'covered');assert.equal(result.evidence.process,null);fixture.originals.set(group,result.outputDir);}
  await t.test('all groups inherited with fresh emulators remains mixed',()=>{
    const result=aggregate({reused:groups});assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(result.outputDir,'aggregate.json'))).mode,'mixed','Fresh emulator executions keep an otherwise inherited cohort mixed');assert.match(result.outputs,/^original=false$/m);
  });
  await t.test('all required sources inherited reports covered',()=>{
    const emulators={rules:'covered',compatibility:'covered',...Object.fromEntries(['rules','compatibility'].map(gate=>[gate+'-coverage',hash(JSON.stringify(proof.inputPasses[gate]))]))};
    const result=aggregate({reused:[...groups,'rules','compatibility'],emulators});assert.equal(result.status,0,result.stdout+result.stderr);const report=JSON.parse(fs.readFileSync(path.join(result.outputDir,'aggregate.json')));assert.equal(report.mode,'covered');assert.equal(report.caseCount,0);assert.match(result.outputs,/^attestation-mode=reuse$/m);assert.match(result.outputs,/^original=false$/m);
  });
  fixture.originals=freshGroups;
  t.diagnostic('Public aggregate controls retain early-only mixed, partially executed mixed and entirely inherited covered modes; no synthetic evidence becomes an original full producer.');
});

test('test group workflow consumer forbids duplicate execution for a verified input pass', async t => {
  const fixture=createFixture(t),{file,proof}=inputCoverage(fixture);
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'chain-workflow-reuse-'));fixture.outputs.push(temporary);
  fs.mkdirSync(path.join(temporary,'ci-routing'));writeJson(path.join(temporary,'ci-routing/routing.json'),proof);
  const descriptorDestination=path.join(temporary,'validation/descriptor/descriptor.json');fs.mkdirSync(path.dirname(descriptorDestination),{recursive:true});fs.copyFileSync(path.join(path.dirname(file), 'descriptor.json'),descriptorDestination);
  const sentinel=path.join(temporary,'test-child-executed');
  const workflow=fs.readFileSync(path.join(repository,'.github/workflows/data-safety.yml'),'utf8');
  const commands=[...workflow.matchAll(/      - name: Execute complete assigned group\n[\s\S]*?        run: \|\n((?:          [^\n]*\n|\n)*)/g)].map(match=>match[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n'));
  const selection=[...workflow.matchAll(/^\s+run: (node scripts\/agent-tools\/ci-pass-reuse\.mjs select .+)$/gm)][0]?.[1];assert.ok(selection,'the workflow must select consumer inputs before dependency setup');
  assert.equal(commands.length,1,'the workflow must use the enforcing consumer exactly once');
  const command=selection+'\n'+commands[0].replaceAll('${{ matrix.group }}','core');
  const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,ImageOS:'ubuntu24',ImageVersion:'20261022.1.0',RUNNER_TEMP:temporary,GITHUB_REPOSITORY:'example/fixture',CHAIN_TEST_EVENT_POLICY:'local',GITHUB_RUN_ID:'fixture-run-1',GITHUB_RUN_ATTEMPT:'1',CHAIN_TEST_SOURCE_SHA:fixture.sourceSha,CHAIN_TEST_COMPARISON_BASE:fixture.comparisonBase,CHAIN_DESCRIPTOR_SENTINEL:sentinel};delete env.NODE_TEST_CONTEXT;
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
  await producerPlannerConsumerChain(t);
  await producerPlannerConsumerChain(t,{eventRef:'refs/heads/main'});
  await producerPlannerConsumerChain(t,{eventName:'pull_request',eventRef:'refs/pull/42/merge',eventAction:'synchronize'});
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


test('policy prose covered groups rederive unchanged product inheritance and aggregate honest references',async parent=>{
 const fixture=createFixture(parent,{policy:true});
 fs.writeFileSync(path.join(fixture.root,'AGENTS.md'),'Consult [release guidance](docs/release.md)\nbefore release.\n');git(fixture.root,'add','.');git(fixture.root,'commit','-qm','Policy instruction reflow');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
 const {file,proof}=fixtureCoverage(fixture),base=fixture.comparisonBase,baseTree=git(fixture.root,'rev-parse',base+'^{tree}');
 proof.decision='policy-reuse';proof.policyImpact=derivePolicyProseImpact(fixture.root,fixture.sourceSha,base);
 Object.assign(proof.cohortContext,{sourceSha:base,sourceTree:baseTree,checkoutSha:base,checkoutTree:baseTree,comparisonBase:git(fixture.root,'rev-parse',base+'^')});
 proof.contextSha256=createHash('sha256').update(JSON.stringify(proof.cohortContext)).digest('hex');
 Object.assign(proof.coveredBy,{checkoutSha:base,checkoutTree:baseTree,comparisonBase:proof.cohortContext.comparisonBase});
 const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
 const plan=deriveReleaseReviewPlan(fixture.root,fixture.sourceSha,base),prefix=createHash('sha256').update(canonical(plan)).digest('hex').slice(0,12);
 proof.policyReview={sourceSha:fixture.sourceSha,baseSha:base,receiptSha256:'7'.repeat(64),reviewPlanPrefix:prefix};
 proof.policyStatuses=['funsidething/memory-audit','funsidething/independent-review','funsidething/specialist-review'].map(context=>({context,state:'success',created_at:new Date().toISOString(),description:`r=${'7'.repeat(64)};b=${base};p=${prefix};c=0;s=1;v=4`}));writeJson(file,proof);
 fixture.originals=new Map();
 for(const group of groups){const result=invoke(fixture,{group,args:['--covered','--proof',file]});assert.equal(result.status,0,'policy inheritance public covered command must accept proven unchanged inventory:\n'+result.stdout+result.stderr);assert.equal(result.evidence.cases.length,0);fixture.originals.set(group,result.outputDir);}
 const aggregate=aggregateCopy(parent,fixture,(_root,needs)=>{const x=JSON.parse(fs.readFileSync(needs));x['cohort-routing'].outputs={decision:'policy-reuse'};writeJson(needs,x);},['--proof',file]);
 assert.equal(aggregate.status,0,aggregate.stdout+aggregate.stderr);const report=JSON.parse(fs.readFileSync(path.join(aggregate.outputDir,'aggregate.json')));assert.equal(report.mode,'policy-covered');assert.equal(report.caseCount,0);
 for(const [name,mutate]of [['wrong inventory',x=>{x.policyImpact.frozenInventorySha256='0'.repeat(64);}],['stale review',x=>{x.policyStatuses[0].state='failure';}],['wrong producer source',x=>{x.cohortContext.sourceSha=fixture.sourceSha;x.contextSha256=createHash('sha256').update(JSON.stringify(x.cohortContext)).digest('hex');}]])await parent.test(name,()=>{const x=structuredClone(proof);mutate(x);writeJson(file,x);const result=invoke(fixture,{args:['--covered','--proof',file]});assert.notEqual(result.status,0,name+' must retain full execution requirements');});
});

test('reconciled policy covered consumers retain the directly reviewed full-product origin',async t=>{
 const f=createFixture(t,{policy:true});fs.writeFileSync(path.join(f.root,'AGENTS.md'),'Read [release guide](docs/release.md) before release.\nIndependent FAQ coverage review is required for every product release.\n');fs.writeFileSync(path.join(f.root,'app.js'),'export const originalProductBehavior = true;\n');git(f.root,'add','app.js','AGENTS.md');git(f.root,'commit','-qm','Original full-product main tree');f.comparisonBase=git(f.root,'rev-parse','HEAD');fs.writeFileSync(path.join(f.root,'AGENTS.md'),'Consult [release guidance](docs/release.md)\nbefore release.\nIndependent FAQ coverage review is required for every product release.\n');git(f.root,'add','.');git(f.root,'commit','-qm','Instruction-preserving policy change');f.sourceSha=git(f.root,'rev-parse','HEAD');
 const {file,proof}=fixtureCoverage(f),base=f.comparisonBase,baseTree=git(f.root,'rev-parse',base+'^{tree}'),originBase=git(f.root,'rev-parse',base+'^'),head=git(f.root,'commit-tree',baseTree,'-p',originBase,'-m','Original reviewed product head');
 proof.decision='policy-reuse';proof.policyImpact=derivePolicyProseImpact(f.root,f.sourceSha,base);Object.assign(proof.cohortContext,{sourceSha:head,sourceTree:baseTree,checkoutSha:head,checkoutTree:baseTree,comparisonBase:originBase});proof.contextSha256=createHash('sha256').update(JSON.stringify(proof.cohortContext)).digest('hex');Object.assign(proof.coveredBy,{checkoutSha:head,checkoutTree:baseTree,comparisonBase:originBase,aggregateArtifact:{artifactId:'902',artifactName:'scanner-aggregate-71-2',artifactSha256:'2'.repeat(64),artifactExpiresAt:'2030-01-01T00:00:00Z',reportSha256:proof.coveredBy.reportSha256}});
 const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value),prefix=plan=>createHash('sha256').update(canonical(plan)).digest('hex').slice(0,12),policyPlan=deriveReleaseReviewPlan(f.root,f.sourceSha,base),originPlan=deriveReleaseReviewPlan(f.root,head,originBase);
 proof.policyReview={sourceSha:f.sourceSha,baseSha:base,receiptSha256:'7'.repeat(64),reviewPlanPrefix:prefix(policyPlan)};proof.policyStatuses=['funsidething/memory-audit','funsidething/independent-review','funsidething/specialist-review'].map(context=>({context,state:'success',created_at:new Date().toISOString(),description:`r=${'7'.repeat(64)};b=${base};p=${prefix(policyPlan)};c=0;s=1;v=4`}));
 proof.policyOriginReview={ok:true,deployedSha:base,reviewedSha:head,treeSha:baseTree,baseSha:originBase,receiptSha256:'5'.repeat(64),mergedPullRequest:19};proof.policyOriginStatuses=proof.policyStatuses.map(status=>({...status,description:`r=${'5'.repeat(64)};b=${originBase};p=${prefix(originPlan)};c=${originPlan.requiresCodeReview?1:0};s=${originPlan.requiresSpecialistReview?1:0};v=3`}));
 const inputs={policy:'complete-ci-inputs-v1',repository:proof.cohortContext.repository,checkoutTree:baseTree,comparisonBase:originBase,runtime:{node:process.versions.node,platform:process.platform,arch:process.arch,imageOS:'fixture-os',imageVersion:'fixture-image'}};
 proof.policyInputPasses=Object.fromEntries([...groups,'rules','compatibility'].map(gate=>[gate,{kind:'ci-input-pass-v1',gate,inputs,inputKey:createHash('sha256').update(JSON.stringify({...inputs,gate})).digest('hex'),coveredBy:{runId:'71',runAttempt:'2',jobId:'701',sourceSha:head,checkoutSha:head,checkoutTree:baseTree,comparisonBase:originBase,resultSha256:'1'.repeat(64),artifactId:'901',artifactName:'original-'+gate,artifactSha256:'2'.repeat(64),artifactExpiresAt:'2030-01-01T00:00:00Z'}}]));writeJson(file,proof);
 f.originals=new Map();for(const group of groups){const result=invoke(f,{group,consumer:true,args:['--proof',file]});assert.equal(result.status,0,'The workflow consumer must preserve directly reviewed full-product authority: '+result.stderr);assert.deepEqual(result.evidence.cases,[]);assert.equal(result.evidence.process,null);f.originals.set(group,result.outputDir);}
 const aggregate=aggregateCopy(t,f,(_root,needs)=>{const x=JSON.parse(fs.readFileSync(needs));x['cohort-routing'].outputs={decision:'policy-reuse'};writeJson(needs,x);},['--proof',file]);assert.equal(aggregate.status,0,aggregate.stdout+aggregate.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(aggregate.outputDir,'aggregate.json'))).mode,'policy-covered');
 for(const [name,mutate]of [['policy receipt',x=>{x.policyOriginStatuses[0].description=x.policyOriginStatuses[0].description.replace('v=3','v=4');}],['changed original',x=>{x.policyInputPasses.core.coveredBy.runId='72';}],['changed aggregate',x=>{x.coveredBy.aggregateArtifact.reportSha256='0'.repeat(64);}]])await t.test(name,()=>{const changed=structuredClone(proof);mutate(changed);writeJson(file,changed);assert.notEqual(invoke(f,{consumer:true,args:['--proof',file]}).status,0,'Invalid direct original coverage must fail: '+name);});
});


test('test group aggregate cannot accept a full cohort without required early predecessor evidence',t=>{
 const fixture=aggregateFixture(t,{early:true}),result=aggregateCopy(t,fixture);
 assert.notEqual(result.status,0,'A complete later cohort cannot hide missing early execution');
 assert.match(result.stdout+result.stderr,/early|startup/i);
});

test('test group aggregate binds successful early execution and separate failed application stress integrity',async t=>{
 const {createMobileBundle}=await import('./mobile-memory-fixture.mjs');
 const fixture=aggregateFixture(t,{early:true});
 const id={...JSON.parse(fs.readFileSync(path.join(fixture.originals.get('core'),'result.json'))).resultIdentity,selectedGroup:null};
 const evidence=fs.mkdtempSync(path.join(os.tmpdir(),'chain-early-aggregate-proof-'));t.after(()=>fs.rmSync(evidence,{recursive:true,force:true}));
 const early=path.join(evidence,'early');fs.mkdirSync(early);const identity={candidateCommit:id.checkoutSha,candidateTree:id.checkoutTree,sourceSha:id.sourceSha,repository:id.repository,runId:id.runId,runAttempt:id.runAttempt,eventPolicy:id.eventPolicy};
 createMobileBundle(path.join(early,'required'),identity);
 const {refreshMobileBundle}=await import('./mobile-memory-fixture.mjs'),stress=createMobileBundle(path.join(evidence,'stress'),identity,'stress-512mb');stress.report.status='failed';stress.report.cases[0].appOutcome='app-runtime-failure';stress.native.normal.status='failed';stress.native.normal.errors=['page-crash'];stress.native.normal.failure='page.goto: Page crashed';refreshMobileBundle(stress);
 const names=['RISK repository process: Playwright waitForFunction predicates are synchronous','RISK repository process: scenery consumers use allocated fallback ports and preserve early native failures','RISK repository process: native scene-time bursts cannot activate controls behind a refused top-layer release'];
 fs.writeFileSync(path.join(early,'harness.stdout'),'TAP version 13\n'+names.map((name,index)=>`# Subtest: ${name}\nok ${index+1} - ${name}\n`).join(''));
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),artifacts=[];const visit=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())visit(file);else{const bytes=fs.readFileSync(file);artifacts.push({path:path.relative(early,file).split(path.sep).join('/'),bytes:bytes.length,sha256:hash(bytes)});}}};visit(early);
 const receipt={schemaVersion:1,status:'passed',mode:'full',identity:{descriptor:id,workflowBlob:git(fixture.root,'rev-parse','HEAD:.github/workflows/data-safety.yml'),harnessSourceSha256:hash(fs.readFileSync(path.join(fixture.root,'scripts/early-ci-harness-source.json'))),eventName:null,eventRef:null,eventAction:null},children:['harness','required-1gb'].map(kind=>({kind,exitCode:0,signal:null,error:null})),harnessCaseCount:3,artifacts:artifacts.sort((a,b)=>a.path.localeCompare(b.path))};writeJson(path.join(early,'receipt.json'),receipt);
 const collected=path.join(evidence,'groups');for(const [group,output]of fixture.originals)fs.cpSync(output,path.join(collected,group),{recursive:true});const needs=path.join(evidence,'needs.json');writeJson(needs,Object.fromEntries(['validation-context','event-gates','cohort-routing','regression','early-startup','mobile-stress'].map(name=>[name,{result:'success'}])));
 const env={GITHUB_REPOSITORY:id.repository,CHAIN_TEST_SOURCE_SHA:id.sourceSha,CHAIN_TEST_EVENT_POLICY:id.eventPolicy,GITHUB_RUN_ID:id.runId,GITHUB_RUN_ATTEMPT:String(id.runAttempt),GITHUB_EVENT_NAME:undefined,GITHUB_REF:undefined};
 const args=['--aggregate','--results-dir',collected,'--needs-json',needs,'--early-receipt',path.join(early,'receipt.json'),'--mobile-stress-report',path.join(stress.directory,'report.json')];
 const result=invoke(fixture,{env,args});assert.equal(result.status,0,result.stdout+result.stderr);const report=JSON.parse(fs.readFileSync(path.join(result.outputDir,'aggregate.json')));assert.equal(report.earlyEvidence.children,2);assert.equal(report.stressEvidence.status,'failed','Measured application stress remains reported without failing complete integrity');assert.equal(report.caseCount,6,'Only original actual group outcomes count as current coverage');
 fs.unlinkSync(path.join(stress.directory,stress.report.cases[0].nativeReportPath));const broken=invoke(fixture,{env,args});assert.notEqual(broken.status,0,'Missing stress integrity blocks aggregate even when application stress is nonblocking');
});

test('group process refuses missing early predecessor before launching any deferred root',t=>{
 const fixture=createFixture(t,{early:true,earlyTransfer:true}),journal=path.join(os.tmpdir(),'early-transfer-roots-'+process.pid+'-'+(++outputSerial));t.after(()=>fs.rmSync(journal,{force:true}));
 const result=invoke(fixture,{group:'native-process',env:{EARLY_ROOT_JOURNAL:journal}});
 assert.notEqual(result.status,0,'Catalog-declared early consumers need durable predecessor proof before any group child');
 assert.equal(fs.existsSync(journal),false,'Missing predecessor must dispatch no deferred root');
});

test('reconciled covered group verifies current early evidence without repeating any root',async t=>{
 const f=createFixture(t,{early:true,earlyTransfer:true});
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'chain-reconciled-covered-'));t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
 const described=invoke(f,{args:['--describe']});assert.equal(described.status,0,described.stderr);
 const descriptor=path.join(described.outputDir,'descriptor.json'),id=JSON.parse(fs.readFileSync(descriptor)).resultIdentity;
 const {createMobileBundle}=await import('./mobile-memory-fixture.mjs');const seed=createMobileBundle(path.join(out,'seed'),{candidateCommit:id.checkoutSha,candidateTree:id.checkoutTree,sourceSha:id.sourceSha,repository:id.repository,runId:id.runId,runAttempt:id.runAttempt,eventPolicy:id.eventPolicy});
 const journal=path.join(out,'executions.jsonl'),env={GITHUB_REPOSITORY:id.repository,CHAIN_TEST_SOURCE_SHA:id.sourceSha,CHAIN_TEST_EVENT_POLICY:id.eventPolicy,GITHUB_RUN_ID:id.runId,GITHUB_RUN_ATTEMPT:String(id.runAttempt),EARLY_TRANSFER_SEED:seed.directory,EARLY_ROOT_JOURNAL:journal,GITHUB_EVENT_NAME:undefined,GITHUB_REF:undefined,ImageOS:'fixture-os',ImageVersion:'fixture-image'};
 const early=path.join(out,'early'),childEnv={...process.env,...env};delete childEnv.NODE_TEST_CONTEXT;delete childEnv.GITHUB_EVENT_NAME;delete childEnv.GITHUB_REF;
 const run=spawnSync(process.execPath,['scripts/early-ci.mjs','--run','--descriptor',descriptor,'--output-dir',early],{cwd:f.root,env:childEnv,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 const first=fs.readFileSync(journal,'utf8');assert.equal(first.trim().split('\n').length,5);
 const inputs={policy:'complete-ci-inputs-v1',repository:id.repository,checkoutTree:id.checkoutTree,comparisonBase:id.comparisonBase,runtime:{node:process.versions.node,platform:process.platform,arch:process.arch,imageOS:env.ImageOS,imageVersion:env.ImageVersion}};
 const key=createHash('sha256').update(JSON.stringify({...inputs,gate:'native-process'})).digest('hex');
 const pass={kind:'ci-input-pass-v1',gate:'native-process',inputs,inputKey:key,coveredBy:{runId:'71',runAttempt:'2',jobId:'701',sourceSha:id.sourceSha,checkoutSha:id.checkoutSha,checkoutTree:id.checkoutTree,comparisonBase:id.comparisonBase,resultSha256:'1'.repeat(64),artifactId:'901',artifactName:'original-native',artifactSha256:'2'.repeat(64),artifactExpiresAt:'2030-01-01T00:00:00Z'}};
 const proof=path.join(out,'routing.json');writeJson(proof,{decision:'full',runId:id.runId,runAttempt:id.runAttempt,validationContext:id,inputContext:inputs,inputKeys:{'native-process':key},inputPasses:{'native-process':pass}});
 const result=invoke(f,{group:'native-process',consumer:true,env,args:['--proof',proof,'--browser-path',path.join(out,'absent-engines'),'--early-receipt',path.join(early,'receipt.json')]});
 assert.equal(result.status,0,'The covered group must accept the independently executed current early stage: '+result.stdout+result.stderr);
 assert.equal(result.evidence.status,'covered');assert.deepEqual(result.evidence.cases,[]);assert.equal(result.evidence.process,null);assert.deepEqual(result.evidence.artifacts,[]);
 assert.equal(fs.readFileSync(journal,'utf8'),first,'Covered gate must launch zero additional early or ordinary roots');
 const fresh=invoke(f,{group:'core',env,args:['--early-receipt',path.join(early,'receipt.json')]});assert.equal(fresh.status,0,fresh.stderr);
 assert.equal(fresh.evidence.earlyReceiptRef?.path,'early-startup-evidence/receipt.json','An original group must retain the raw early proof it transfers');
 assert.equal(fs.readFileSync(path.join(fresh.outputDir,fresh.evidence.earlyReceiptRef.path),'utf8'),fs.readFileSync(path.join(early,'receipt.json'),'utf8'));
 const earlyArtifact={artifactId:'902',artifactName:'early-original',artifactSha256:'3'.repeat(64),artifactExpiresAt:'2030-01-01T00:00:00Z',reportSha256:createHash('sha256').update(fs.readFileSync(path.join(early,'receipt.json'))).digest('hex')};
 const earlyPass={kind:'ci-early-execution-v1',inputs,inputKey:createHash('sha256').update(JSON.stringify({...inputs,gate:'early-startup'})).digest('hex'),coveredBy:{runId:'71',runAttempt:'2',earlyJobId:'703',stressJobId:'704',sourceSha:id.sourceSha,checkoutSha:id.checkoutSha,checkoutTree:id.checkoutTree,comparisonBase:id.comparisonBase,earlyReportSha256:earlyArtifact.reportSha256,earlyArtifact,stressArtifact:{...earlyArtifact,artifactId:'903',artifactName:'stress-original'}}};
 const routing=JSON.parse(fs.readFileSync(proof));routing.earlyCoverage=earlyPass;writeJson(proof,routing);
 const coveredEarly=path.join(out,'covered-early'),coveredCommand=spawnSync(process.execPath,['scripts/early-ci.mjs','--covered','--descriptor',descriptor,'--proof',proof,'--output-dir',coveredEarly],{cwd:f.root,env:childEnv,encoding:'utf8'});assert.equal(coveredCommand.status,0,coveredCommand.stderr);
 const core=invoke(f,{group:'core',consumer:true,env,args:['--proof',proof,'--early-receipt',path.join(coveredEarly,'receipt.json')]});
 assert.equal(core.status,0,'An uncovered group must execute its complete roots while separately referencing original mobile execution: '+core.stderr);
 assert.equal(core.evidence.earlyCoverage??null,null);assert.equal(core.evidence.cases.filter(row=>row.root==='RISK repository process: Playwright waitForFunction predicates are synchronous').length,1);
 const reused=['scenery','persistence-recovery','native-process','rules','compatibility'];routing.inputPasses={};routing.inputKeys={};
 for(const gate of reused){const inputKey=createHash('sha256').update(JSON.stringify({...inputs,gate})).digest('hex');routing.inputPasses[gate]={...pass,gate,inputKey};routing.inputKeys[gate]=inputKey;}writeJson(proof,routing);
 const collected=path.join(out,'groups');fs.mkdirSync(collected);fs.cpSync(core.outputDir,path.join(collected,'core'),{recursive:true});
 for(const group of ['scenery','persistence-recovery','native-process']){const covered=invoke(f,{group,consumer:true,env,args:['--proof',proof,'--early-receipt',path.join(coveredEarly,'receipt.json')]});assert.equal(covered.status,0,covered.stderr);assert.deepEqual(covered.evidence.cases,[]);assert.equal(covered.evidence.process,null);fs.cpSync(covered.outputDir,path.join(collected,group),{recursive:true});}
 const needs=Object.fromEntries(['validation-context','event-gates','cohort-routing','early-startup','regression','mobile-stress'].map(name=>[name,{result:'success'}]));needs['cohort-routing'].outputs={decision:'full',reused:JSON.stringify(reused)};needs['early-startup'].outputs={decision:'reuse'};needs['event-gates'].outputs={rules:'covered',compatibility:'covered',...Object.fromEntries(['rules','compatibility'].map(gate=>[gate+'-coverage',createHash('sha256').update(JSON.stringify(routing.inputPasses[gate])).digest('hex')]))};
 const needsPath=path.join(out,'needs.json');writeJson(needsPath,needs);
 const aggregate=invoke(f,{env,args:['--aggregate','--results-dir',collected,'--needs-json',needsPath,'--proof',proof,'--early-receipt',path.join(coveredEarly,'receipt.json')]});assert.equal(aggregate.status,0,aggregate.stdout+aggregate.stderr);
 const report=JSON.parse(fs.readFileSync(path.join(aggregate.outputDir,'aggregate.json')));assert.equal(report.mode,'mixed');assert.equal(report.caseCount,core.evidence.cases.length,'Only current complete core execution counts as current cases');assert.equal(report.earlyEvidence.mode,'covered');
});

test('reconciled fresh group consumes the explicit browser preflight before its cohort', t=>{
 const f=createFixture(t),directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-reconciled-browser-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const described=invoke(f,{args:['--describe']});assert.equal(described.status,0,described.stderr);const id=JSON.parse(fs.readFileSync(path.join(described.outputDir,'descriptor.json'))).resultIdentity;
 const proof=path.join(directory,'routing.json');writeJson(proof,{decision:'full',validationContext:id,runId:id.runId,runAttempt:id.runAttempt,inputPasses:{}});
 const result=invoke(f,{group:'persistence-recovery',consumer:true,args:['--proof',proof,'--browser-path',path.join(directory,'absent-engines')]});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(result.evidence.browserRuntimeReceipt?.path,'browser-runtime-preflight/receipt.json','The actual workflow consumer must retain an explicit preflight result before the group');
 const receipt=JSON.parse(fs.readFileSync(path.join(result.outputDir,result.evidence.browserRuntimeReceipt.path)));
 assert.equal(receipt.status,'no_change');assert.equal(receipt.process,null,'No selected new roots launches zero browser children');
});

test('group and aggregate retain actual early cases once across fresh group processes',async t=>{
 const {runButtonSafety}=await import('../button-safety-native.mjs'),playwright=await import('playwright');
 const proofBase=process.env.CHAIN_NATIVE_OUTPUT||os.tmpdir();fs.mkdirSync(proofBase,{recursive:true});const proof=fs.mkdtempSync(path.join(proofBase,'failed-accounting-'));if(!process.env.CHAIN_NATIVE_OUTPUT)t.after(()=>fs.rmSync(proof,{recursive:true,force:true}));
 const configuredPort=process.env.CHAIN_NATIVE_PORT;let port;
 if(configuredPort!==undefined){assert.match(configuredPort,/^[1-9]\d{0,4}$/,'CHAIN_NATIVE_PORT must be a valid explicit loopback port');port=Number(configuredPort);assert.ok(port<=65535,'CHAIN_NATIVE_PORT must be between 1 and 65535');}
 else{const portServer=net.createServer();await new Promise((resolve,reject)=>{portServer.once('error',reject);portServer.listen(0,'127.0.0.1',resolve);});port=portServer.address().port;await new Promise((resolve,reject)=>portServer.close(error=>error?reject(error):resolve()));}
 assert.ok(port>0,'Mock-launch consumer requires a locally allocated loopback port');if(configuredPort!==undefined)assert.equal(port,Number(configuredPort),'The group fixture must observe the exact validated host-ledger listener port');
 const ledger=path.join(proof,'ledger.json'),prior=process.env.CODEX_COORDINATION_FILE,launch=playwright.chromium.launch;
 writeJson(ledger,{entries:[{status:'active',worktree:repository,lease:{state:'healthy',expiresAt:new Date(Date.now()+60000).toISOString()},resources:['browser-runtime:playwright-chromium','loopback:127.0.0.1:'+port]}]});process.env.CODEX_COORDINATION_FILE=ledger;
 const stopped=Error('page.goto: Page crashed'),bindings=new Map(),events=new Map(),listenerObservations=[];
 // External browser boundary only: deliver two observed IDs, then a page-crash
 // signal and primary error before any action executes. No engine is launched.
 const page={setDefaultTimeout(){},on(name,fn){events.set(name,fn);},async exposeBinding(name,fn){bindings.set(name,fn);},async addInitScript(){},async goto(url){const response=await fetch(url),html=await response.text(),observation={port:Number(new URL(url).port),httpStatus:response.status,reachable:response.ok,htmlDocument:/^\s*<!doctype html>/i.test(html)};listenerObservations.push(observation);assert.equal(observation.httpStatus,200,'Mock browser must reach the actual child-owned HTTP listener');assert.equal(observation.htmlDocument,true,'The actual listener must serve its HTML fixture');bindings.get('__buttonObserved')({},['act:download-backup','act:scene-time-settings']);events.get('crash')();throw stopped;},async evaluate(){throw stopped;}};
 const context={async exposeBinding(){},async addInitScript(){},async route(){},async newPage(){return page;},async close(){}};
 playwright.chromium.launch=async()=>({on(){},version:()=> 'external-mock-no-engine',async newContext(){return context;},async close(){}});
 try{await assert.rejects(runButtonSafety({repo:repository,engine:'chromium',port,outputDir:proof,scenarioFilter:'rapid scene time presets, lock, live time, and close'}),error=>error===stopped);}finally{playwright.chromium.launch=launch;if(prior===undefined)delete process.env.CODEX_COORDINATION_FILE;else process.env.CODEX_COORDINATION_FILE=prior;}
 assert.ok(listenerObservations.length>=1,'The controlled consumer must observe a live listener response');assert.ok(listenerObservations.every(row=>row.port===port&&row.httpStatus===200&&row.reachable&&row.htmlDocument),'Every observed HTTP response must come from the selected live local listener');
 const produced=JSON.parse(fs.readFileSync(path.join(proof,fs.readdirSync(proof).find(file=>/^button-safety-chromium-.*\.json$/.test(file)))));
 assert.deepEqual(produced.observedActions,['act:download-backup','act:scene-time-settings'],'Failed producer must retain the actual offered IDs delivered before the crash');
 assert.deepEqual(produced.actionObservation,{recognizedOffered:['act:download-backup','act:scene-time-settings'],executed:[],coverage:'Offered IDs are recognized, not credited as executed; limited consumer only'},'Failed attempt must finalize honest offered versus completed action accounting');
 assert.deepEqual(produced.outcomes,[]);assert.deepEqual(produced.rapidOutcomes,[]);assert.deepEqual(produced.errors,['page-crash']);assert.equal(produced.status,'failed');for(const key of ['contextClosed','browserClosed','serverClosed'])assert.equal(produced.cleanup[key],true);
 const {createMobileBundle,refreshMobileBundle}=await import('./mobile-memory-fixture.mjs');
 const fixture=createFixture(t,{early:true,earlyTransfer:true,profiledStress:true,nativeTitle:'RISK repository process: required installed-client native outcomes and artifacts execute exactly once',nativeReports:true});
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'chain-early-transfer-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const descriptorRun=invoke(fixture,{args:['--describe']});assert.equal(descriptorRun.status,0,descriptorRun.stderr);const descriptor=path.join(descriptorRun.outputDir,'descriptor.json'),identity=JSON.parse(fs.readFileSync(descriptor)).resultIdentity;
 const nativeIdentity={candidateCommit:identity.checkoutSha,candidateTree:identity.checkoutTree,sourceSha:identity.sourceSha,repository:identity.repository,runId:identity.runId,runAttempt:identity.runAttempt,eventPolicy:identity.eventPolicy};
 const seed=createMobileBundle(path.join(temp,'seed'),nativeIdentity),stress=createMobileBundle(path.join(temp,'stress'),nativeIdentity,'stress-512mb'),journal=path.join(temp,'executions.jsonl');
 const {currentApplication,checkProfile}=await import('../mobile-source-profile.mjs'),application=currentApplication(fixture.root),coverage='Offered IDs are recognized, not credited as executed; limited consumer only';
 for(const bundle of [seed,stress])for(const [motion,native]of Object.entries(bundle.native)){
  native.assets=application.assets;native.sourceProfile=checkProfile({repo:fixture.root,source:application.source,assets:native.assets,engine:'webkit',motion,scenario:'rapid scanner candidate actions with 400 active tasks'});native.observedActions=['act:yes'];native.outcomes=[];for(const row of native.rapidOutcomes)row.status='passed';native.actionObservation={recognizedOffered:['act:yes'],executed:['act:yes'],coverage};
 }
 const failed=stress.native.normal;failed.status='failed';failed.errors=produced.errors;failed.failure='page.goto: Page crashed';failed.scenarios=[];failed.presses=[];failed.clicks=[];delete failed.mobileStory;
 for(const key of ['observedActions','outcomes','rapidOutcomes','actionObservation'])failed[key]=structuredClone(produced[key]);
 stress.report.status='failed';stress.report.cases[0].appOutcome='app-runtime-failure';
 writeJson(path.join(seed.directory,'modal-parser-only.json'),{kind:'button-diagnostic',engine:'chromium',candidateCommit:identity.checkoutSha,candidateTree:identity.checkoutTree,status:'passed',assets:application.assets,sourceProfile:checkProfile({repo:fixture.root,source:application.source,assets:application.assets,engine:'chromium',motion:null,scenario:'rapid scene time presets, lock, live time, and close'}),observedActions:[],outcomes:[],rapidOutcomes:[],actionObservation:{recognizedOffered:[],executed:[],coverage},scenarios:[{name:'rapid scene time presets, lock, live time, and close'}]});
 refreshMobileBundle(seed);refreshMobileBundle(stress);
 const {verifyMobileStressReport}=await import('../button-safety-mobile-contract.mjs');assert.equal(verifyMobileStressReport(stress.report,{artifactRoot:stress.directory}).cases[0].appOutcome,'app-runtime-failure','Synthetic raw stress classifier accepts the attributable failed app before profile/aggregate composition');
 const env={...process.env,GITHUB_REPOSITORY:identity.repository,CHAIN_TEST_SOURCE_SHA:identity.sourceSha,CHAIN_TEST_EVENT_POLICY:identity.eventPolicy,GITHUB_RUN_ID:identity.runId,GITHUB_RUN_ATTEMPT:String(identity.runAttempt),EARLY_TRANSFER_SEED:seed.directory,EARLY_ROOT_JOURNAL:journal,PLAYWRIGHT_BROWSERS_PATH:path.join(temp,'absent-ci-engines')};delete env.NODE_TEST_CONTEXT;env.GITHUB_EVENT_NAME=undefined;env.GITHUB_REF=undefined;
 const workflow=fs.readFileSync(path.join(repository,'.github/workflows/data-safety.yml'),'utf8');
 const earlyStep=workflow.match(/      - name: Required saved harness and populated mobile startup\n[\s\S]*?        run: ([^\n]+)/);assert.ok(earlyStep);
 const descriptorCopy=path.join(temp,'validation/descriptor');fs.mkdirSync(descriptorCopy,{recursive:true});fs.copyFileSync(descriptor,path.join(descriptorCopy,'descriptor.json'));
 const early=path.join(temp,'early'),run=spawnSync('bash',['-euo','pipefail','-c',earlyStep[1]],{cwd:fixture.root,env:{...env,RUNNER_TEMP:temp},encoding:'utf8',timeout:15000});assert.equal(run.status,0,run.stdout+run.stderr);
 const receipt=path.join(early,'receipt.json'),first=fs.readFileSync(journal,'utf8').trim().split('\n');assert.equal(first.length,5,'All five fixture early roots really ran once, including the actual no-port child stream');assert.equal(new Set(first).size,5);
 fixture.originals=new Map();
 const actualStep=workflow.match(/      - name: Execute complete assigned group\n[\s\S]*?        run: \|\n((?:          [^\n]*\n|\n)*)/);assert.ok(actualStep,'Existing workflow group command required');
 const actualCommand=actualStep[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 for(const group of groups){
  const runnerTemp=path.join(temp,'job-'+group);fs.mkdirSync(runnerTemp);fs.cpSync(early,path.join(runnerTemp,'early'),{recursive:true});
  const jobDescriptor=path.join(runnerTemp,'validation/descriptor');fs.mkdirSync(jobDescriptor,{recursive:true});fs.copyFileSync(descriptor,path.join(jobDescriptor,'descriptor.json'));
  fs.mkdirSync(path.join(runnerTemp,'selected-routing'));writeJson(path.join(runnerTemp,'selected-routing/routing.json'),{decision:'full',validationContext:identity,runId:identity.runId,runAttempt:identity.runAttempt,inputPasses:{}});
  if(group==='persistence-recovery'){
   const preflight=invoke(fixture,{group,env,outputDir:path.join(runnerTemp,'browser-runtime-preflight'),args:['--browser-runtime-preflight','--early-receipt',path.join(runnerTemp,'early/receipt.json')]});
   assert.equal(preflight.status,0,preflight.stdout+preflight.stderr);assert.equal(preflight.evidence.status,'no_change','The matrix fixture still runs an explicit no-change preflight receipt.');
  }
  const command=actualCommand.replaceAll('${{ matrix.group }}',group),result=spawnSync('bash',['-euo','pipefail','-c',command],{cwd:fixture.root,env:{...env,RUNNER_TEMP:runnerTemp,CHAIN_TEST_COMPARISON_BASE:fixture.comparisonBase},encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stdout+result.stderr);const outputDir=path.join(runnerTemp,'group'),record=JSON.parse(fs.readFileSync(path.join(outputDir,'result.json')));fixture.originals.set(group,outputDir);
  if(group==='core'||group==='native-process'){const count=group==='core'?1:4;assert.equal(record.earlyCoverage.roots.length,count);assert.equal(record.earlyCoverage.cases.length,count);assert.ok(record.cases.every(row=>!first.includes(row.root)),'Actual workflow group TAP cannot repeat early outcomes');}else assert.equal(record.earlyCoverage??null,null);
 }
 assert.deepEqual(fs.readFileSync(journal,'utf8').trim().split('\n'),first,'Fresh complete groups reuse actual durable early execution without repeating those roots');
 const collected=path.join(temp,'groups');for(const [group,output]of fixture.originals)fs.cpSync(output,path.join(collected,group),{recursive:true});const needs=path.join(temp,'needs.json');writeJson(needs,Object.fromEntries(['validation-context','event-gates','cohort-routing','early-startup','regression','mobile-stress'].map(name=>[name,{result:'success'}])));
 const args=['--aggregate','--results-dir',collected,'--needs-json',needs,'--early-receipt',receipt,'--mobile-stress-report',path.join(stress.directory,'report.json')];
 const aggregateStep=workflow.match(/      - name: Verify complete required cohort\n[\s\S]*?        run: \|\n((?:          [^\n]*\n|\n)*)/);assert.ok(aggregateStep);
 const aggregateCommand=aggregateStep[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const aggregate=spawnSync('bash',['-euo','pipefail','-c',aggregateCommand],{cwd:fixture.root,env:{...env,RUNNER_TEMP:temp,CHAIN_TEST_COMPARISON_BASE:fixture.comparisonBase},encoding:'utf8',timeout:15000});assert.equal(aggregate.status,0,aggregate.stdout+aggregate.stderr);const report=JSON.parse(fs.readFileSync(path.join(temp,'aggregate/aggregate.json')));assert.equal(report.caseCount,11,'Six actual ordinary fixture cases plus five actual early cases count exactly once');assert.equal(report.groups.find(row=>row.group==='core').earlyCases,1);assert.equal(report.groups.find(row=>row.group==='native-process').earlyCases,4);
 assert.equal(report.stressEvidence.status,'failed','Actual aggregate must retain the nonblocking failed app status after strict profile accounting');
 const originalFailed=structuredClone(failed);
 await t.test('known completed partial action remains accounted without full coverage credit',()=>{const next=structuredClone(originalFailed);next.outcomes=[{action:'act:scene-time-settings',status:'passed'}];next.actionObservation.executed=['act:scene-time-settings'];stress.native.normal=next;refreshMobileBundle(stress);const result=invoke(fixture,{env,args});assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(result.outputDir,'aggregate.json'))).stressEvidence.status,'failed');stress.native.normal=structuredClone(originalFailed);refreshMobileBundle(stress);});
 for(const [name,mutate]of [
  ['missing accounting',n=>delete n.actionObservation],
  ['unknown offered ID',n=>{n.observedActions.push('act:gate-new-untested');n.actionObservation.recognizedOffered.push('act:gate-new-untested');}],
  ['unknown executed ID',n=>{n.outcomes.push({action:'act:gate-new-untested',status:'passed'});n.actionObservation.executed.push('act:gate-new-untested');}],
  ['profile tamper',n=>n.sourceProfile.profileSha256='0'.repeat(64)],
  ['source tamper',n=>n.assets['index.html']='0'.repeat(64)],
  ['transport failure',n=>n.errors.push('driver disconnected')],
  ['instrumentation failure',n=>n.failure='TypeError: observer binding failed'],
  ['cleanup failure',n=>n.cleanup.contextClosed=false],
 ])await t.test('failed stress still refuses '+name,()=>{const next=structuredClone(originalFailed);mutate(next);stress.native.normal=next;refreshMobileBundle(stress);const result=invoke(fixture,{env,args});assert.notEqual(result.status,0,name+' cannot be promoted to nonblocking app stress');stress.native.normal=structuredClone(originalFailed);refreshMobileBundle(stress);});
 t.diagnostic('Actual failed native producer accounting survives strict public stress and literal aggregate composition; known offered IDs are retained without execution credit. External mocked browser and synthetic cgroup/transport records only; no engine or512MB claim. Producer artifact: '+proof);
 await t.test('changed group transfer reference',()=>{const file=path.join(collected,'native-process/result.json'),original=fs.readFileSync(file),record=JSON.parse(original);record.earlyCoverage.cases.pop();writeJson(file,record);assert.notEqual(invoke(fixture,{env,args}).status,0,'Aggregate must rederive every transferred early outcome');fs.writeFileSync(file,original);});
 await t.test('missing durable predecessor',()=>{fs.unlinkSync(path.join(early,'harness.stdout'));assert.notEqual(invoke(fixture,{group:'native-process',env,args:['--early-receipt',receipt]}).status,0);assert.notEqual(invoke(fixture,{env,args}).status,0);assert.deepEqual(fs.readFileSync(journal,'utf8').trim().split('\n'),first);});
 t.diagnostic(JSON.stringify({scope:'Controlled OS-process transfer only; no native/runtime proof',earlyRootExecutions:first.length,uniqueEarlyRoots:new Set(first).size,ordinaryGroups:groups.length,aggregateCaseCount:report.caseCount,liveListenerObservations:listenerObservations}));
});

test('workflow metadata aggregate rejects pending cancelled unresolved and stale successful routing proofs', async parent=>{
 const fixture=createFixture(parent),{file,proof}=fixtureCoverage(fixture),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'chain-metadata-aggregate-'));
 parent.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));fs.mkdirSync(path.join(temporary,'groups'));fs.mkdirSync(path.join(temporary,'final-routing'));
 fs.mkdirSync(path.join(temporary,'validation/descriptor'),{recursive:true});fs.copyFileSync(path.join(path.dirname(file),'descriptor.json'),path.join(temporary,'validation/descriptor/descriptor.json'));
 const sentinel=path.join(temporary,'unexpected-test-child'),workflow=fs.readFileSync(path.join(repository,'.github/workflows/data-safety.yml'),'utf8');
 const step=workflow.match(/      - name: Verify complete required cohort\n[\s\S]*?        run: \|\n((?:          [^\n]*\n|\n)*)/);assert.ok(step);
 const command=step[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const identity=proof.validationContext,env={...process.env,RUNNER_TEMP:temporary,GITHUB_REPOSITORY:identity.repository,GITHUB_RUN_ID:identity.runId,GITHUB_RUN_ATTEMPT:String(identity.runAttempt),CHAIN_TEST_SOURCE_SHA:identity.sourceSha,CHAIN_TEST_EVENT_POLICY:identity.eventPolicy,CHAIN_TEST_COMPARISON_BASE:identity.comparisonBase,CHAIN_DESCRIPTOR_SENTINEL:sentinel};delete env.NODE_TEST_CONTEXT;
 for(const group of groups){const result=invoke(fixture,{group,args:['--covered','--proof',file],env:{CHAIN_DESCRIPTOR_SENTINEL:sentinel}});assert.equal(result.status,0,result.stdout+result.stderr);fs.cpSync(result.outputDir,path.join(temporary,'groups',group),{recursive:true});}
 for(const decision of ['reuse','pending','cancelled','unresolved','fail','stale-success'])await parent.test(decision,()=>{
  const observed=structuredClone(proof);if(decision==='stale-success')observed.coveredBy.runAttempt='3';else observed.decision=decision;
  writeJson(path.join(temporary,'final-routing/routing.json'),observed);
  writeJson(path.join(temporary,'needs.json'),Object.fromEntries(['validation-context','event-gates','cohort-routing','regression'].map(id=>[id,{result:decision==='reuse'||decision==='stale-success'?'success':id==='cohort-routing'?'failure':'skipped',...(id==='cohort-routing'?{outputs:{decision:'reuse'}}:{})}])));
  fs.rmSync(path.join(temporary,'aggregate'),{recursive:true,force:true});
  const result=spawnSync('bash',['-euo','pipefail','-c',command],{cwd:fixture.root,env,encoding:'utf8',timeout:15000});
  assert.equal(result.status===0,decision==='reuse',decision+': '+result.stdout+result.stderr);
  assert.equal(fs.existsSync(sentinel),false,'Required aggregate and coverage references never execute another test child');
  if(decision==='reuse'){const report=JSON.parse(fs.readFileSync(path.join(temporary,'aggregate/aggregate.json')));assert.equal(report.caseCount,0);assert.equal(report.mode,'covered');assert.equal(report.groups.length,4);}
  if(process.env.CHAIN_METADATA_EVIDENCE){const destination=path.join(process.env.CHAIN_METADATA_EVIDENCE,'aggregate-'+decision);fs.mkdirSync(process.env.CHAIN_METADATA_EVIDENCE,{recursive:true});fs.cpSync(temporary,destination,{recursive:true});fs.writeFileSync(path.join(destination,'consumer.stdout'),result.stdout);fs.writeFileSync(path.join(destination,'consumer.stderr'),result.stderr);}
 });
});


test('test group browser runtime interruption finalizes and stops only its owned child family',async t=>{
 for(const viaRecorder of [false,true])for(const signal of ['SIGINT','SIGTERM'])await t.test((viaRecorder?'recorder ':'parent ')+signal,async t=>{
  const fixture=createFixture(t),title='fixture browser interrupted owned family';const browserPath=addBrowserRuntimeRootFixture(t,fixture,title);
  const file=path.join(fixture.root,'tests.js');let source=fs.readFileSync(file,'utf8');source=source.replace(`test(${JSON.stringify(title)},()=>{});`,`test(${JSON.stringify(title)},async()=>{
   const {spawn}=await import('node:child_process');
   const descendant=spawn(process.execPath,['-e',"const net=require('node:net');process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});net.createServer().listen(0,'127.0.0.1',function(){process.send({port:this.address().port});});"],{stdio:['ignore','ignore','ignore','ipc']});
   const {port}=await new Promise(resolve=>descendant.once('message',resolve));
   process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});
   fs.writeFileSync(path.join(process.env.TMPDIR,'owned-runtime-file'),'owned');
   fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,'family.json'),JSON.stringify({pid:process.pid,ppid:process.ppid,descendant:descendant.pid,port}));
   await new Promise(()=>{});
  });`);fs.writeFileSync(file,source);git(fixture.root,'add','tests.js');git(fixture.root,'commit','-qm','Observe real owned interruption family');fixture.sourceSha=git(fixture.root,'rev-parse','HEAD');
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'chain-browser-interruption-'));fs.rmdirSync(output);fixture.outputs.push(output);
  const env={...process.env,CI:'true'};delete env.NODE_TEST_CONTEXT;
  const args=['scripts/test-groups.mjs','--group','persistence-recovery','--output-dir',output,'--repository','example/fixture','--event-policy','local','--run-id','fixture-run-1','--run-attempt','1','--source-sha',fixture.sourceSha,'--comparison-base',fixture.comparisonBase,'--browser-runtime-preflight','--browser-path',browserPath];
  const recorderDir=path.join(os.tmpdir(),'chain-browser-recorder-'+process.pid+'-'+(++outputSerial));fixture.outputs.push(recorderDir);
  const command=viaRecorder?[path.join(repository,'scripts/agent-tools/record-run.mjs'),'--repo',fixture.root,'--evidence-dir',recorderDir,'--purpose','green','--summary','--',process.execPath,...args]:args;
  const parent=spawn(process.execPath,command,{cwd:fixture.root,env,stdio:['ignore','pipe','pipe']});
  const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});t.after(()=>unrelated.kill('SIGKILL'));
  let streams='';parent.stdout.on('data',x=>streams+=x);parent.stderr.on('data',x=>streams+=x);const exited=new Promise(resolve=>parent.once('close',(code,signal)=>resolve({code,signal})));
  const live=pid=>{try{process.kill(pid,0);const state=spawnSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'}).stdout.trim();return !!state&&!state.startsWith('Z');}catch(e){if(e.code==='ESRCH')return false;throw e;}};
  let family;t.after(()=>{if(family){for(const pid of [family.ppid,family.pid,family.descendant])try{process.kill(pid,'SIGKILL');}catch{}}try{parent.kill('SIGKILL');}catch{}});
  const deadline=Date.now()+10000,familyPath=path.join(output,'browser-artifacts/family.json');while(!fs.existsSync(familyPath)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(fs.existsSync(familyPath),'Owned browser fixture must reach its actual process/server boundary: '+streams);family=JSON.parse(fs.readFileSync(familyPath));
  parent.kill(signal);const result=await Promise.race([exited,new Promise(resolve=>setTimeout(()=>resolve(null),3000))]);assert.ok(result,'Interrupted public command must finish within its bounded cleanup window');
  const stoppedBy=Date.now()+1500;while([family.ppid,family.pid,family.descendant].some(live)&&Date.now()<stoppedBy)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok([family.ppid,family.pid,family.descendant].every(pid=>!live(pid)),signal+' must stop the actual detached child, test worker and grandchild');
  assert.ok(live(unrelated.pid),'Owned cleanup must leave the unrelated process running');
  assert.equal(result.code,signal==='SIGINT'?130:143,'Public exit preserves received interruption');assert.equal(result.signal,null);
  const evidence=JSON.parse(fs.readFileSync(path.join(output,'result.json')));assert.equal(evidence.status,'failed');assert.equal(evidence.browserRuntime.process.interruption.signal,signal);assert.equal(evidence.browserRuntime.process.interruption.cleanup.completed,true);assert.equal(evidence.browserRuntime.process.interruption.cleanup.escalated,true);
  for(const name of ['runtime-tmp','runtime-home'])assert.equal(fs.existsSync(path.join(output,name)),false,'Owned runtime/profile directories must be removed');
  const net=await import('node:net');await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(family.port,'127.0.0.1',()=>server.close(resolve));});
  t.diagnostic(JSON.stringify({scope:'Controlled browser-provider fixture, actual OS child/grandchild and listener',signal,viaRecorder,exit:result,ownedFamilyStopped:true,unrelatedProcessPreserved:true,portReleased:true}));
 });
});


test('test group workflow browser path reaches the installer and enforcing persistence consumer',t=>{
 const fixture=createFixture(t),root='fixture required browser workflow path';
 addBrowserRuntimeRootFixture(t,fixture,root,'pass',false);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'chain-workflow-browser-path-'));fixture.outputs.push(temp);
 const runnerTemp=path.join(temp,'runner temp with spaces'),expected=path.join(runnerTemp,'playwright-browsers'),journal=path.join(temp,'install-journal');fs.mkdirSync(runnerTemp);
 const regression=fs.readFileSync(path.join(repository,'.github/workflows/data-safety.yml'),'utf8').split(/^  regression:/m)[1].split(/^  scanner-tests:/m)[0];
 const job=regression.split(/^    steps:/m)[0],steps=regression.split(/^      - /m).slice(1).map(text=>'      - '+text);
 const install=steps.find(text=>text.startsWith('      - name: Install matching native Chromium\n')),group=steps.find(text=>text.startsWith('      - name: Execute complete assigned group\n'));
 assert.ok(install&&group,'The actual workflow install and enforcing group steps must exist');
 const resolvePath=(text,contexts,inherited)=>{
  const value=text.match(/^\s+PLAYWRIGHT_BROWSERS_PATH: (.+)$/m)?.[1];if(value===undefined)return inherited;
  return value.replace(/\$\{\{\s*([^{}]+?)\s*\}\}/g,(_,expression)=>{
   const [scope,...properties]=expression.split('.');assert.ok(Object.hasOwn(contexts,scope),'Browser environment cannot evaluate unavailable '+scope+' context at this workflow scope');
   return properties.reduce((value,key)=>value?.[key],contexts[scope])??'';
  });
 };
 // GitHub's published context table excludes runner from jobs.<id>.env, while
 // permitting it for steps.env. The independent actionlint control checks the
 // same source semantics; the real shell/consumer below checks path propagation.
 const jobPath=resolvePath(job,{},undefined),installPath=resolvePath(install,{runner:{temp:runnerTemp}},jobPath),groupPath=resolvePath(group,{runner:{temp:runnerTemp}},jobPath);
 assert.equal(installPath,expected,'The installer must resolve the isolated absolute runner-temp path');assert.equal(groupPath,expected,'The enforcing persistence consumer must resolve the same isolated runner-temp path');
 const command=step=>{const value=step.match(/        run: \|\n((?:          [^\n]*\n|\n)*)/);assert.ok(value,'Actual multi-line workflow command required');return value[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n').replaceAll('${{ matrix.group }}','persistence-recovery').replaceAll('${{ steps.selected.outputs.early-decision }}','full');};
 const described=invoke(fixture,{args:['--describe']});assert.equal(described.status,0,described.stderr);const identity=JSON.parse(fs.readFileSync(path.join(described.outputDir,'descriptor.json'))).resultIdentity;
 const descriptorDestination=path.join(runnerTemp,'validation/descriptor/descriptor.json');fs.mkdirSync(path.dirname(descriptorDestination),{recursive:true});fs.copyFileSync(path.join(described.outputDir,'descriptor.json'),descriptorDestination);
 const proof=path.join(runnerTemp,'selected-routing/routing.json');fs.mkdirSync(path.dirname(proof),{recursive:true});writeJson(proof,{decision:'full',runId:identity.runId,runAttempt:identity.runAttempt,validationContext:identity,inputPasses:{}});
 const env={...process.env,CI:'true',RUNNER_TEMP:runnerTemp,GITHUB_REPOSITORY:identity.repository,CHAIN_TEST_SOURCE_SHA:fixture.sourceSha,CHAIN_TEST_COMPARISON_BASE:fixture.comparisonBase,CHAIN_TEST_EVENT_POLICY:identity.eventPolicy,GITHUB_RUN_ID:identity.runId,GITHUB_RUN_ATTEMPT:String(identity.runAttempt),WORKFLOW_INSTALL_JOURNAL:journal};delete env.NODE_TEST_CONTEXT;delete env.PLAYWRIGHT_BROWSERS_PATH;
 const installer='npx(){ printf "%s\\n" "$PLAYWRIGHT_BROWSERS_PATH" "$@" >> "$WORKFLOW_INSTALL_JOURNAL"; mkdir -p "$PLAYWRIGHT_BROWSERS_PATH/chromium"; printf "%s\\n" "controlled external Chromium provider" > "$PLAYWRIGHT_BROWSERS_PATH/chromium/chrome"; chmod +x "$PLAYWRIGHT_BROWSERS_PATH/chromium/chrome"; }\n'+command(install);
 const installed=run('bash',['-euo','pipefail','-c',installer],fixture.root,{...env,PLAYWRIGHT_BROWSERS_PATH:installPath});assert.equal(installed.status,0,installed.stdout+installed.stderr);
 assert.deepEqual(fs.readFileSync(journal,'utf8').trim().split('\n'),[expected,'--no-install','playwright','install','--with-deps','chromium'],'Actual installer invokes external provider exactly once with Chromium and the resolved path');
 const completed=run('bash',['-euo','pipefail','-c',command(group)],fixture.root,{...env,PLAYWRIGHT_BROWSERS_PATH:groupPath});assert.equal(completed.status,0,completed.stdout+completed.stderr);
 const record=readEvidence(path.join(runnerTemp,'group'));assert.equal(record.status,'passed');
 const receipt=JSON.parse(fs.readFileSync(path.join(runnerTemp,'group',record.browserRuntimeReceipt.path)));
 assert.equal(receipt.status,'passed');assert.equal(receipt.browserRuntime.runtime.browserPath,fs.realpathSync(expected));assert.equal(receipt.browserRuntime.runtime.chromium.available,true);assert.equal(receipt.browserRuntime.runtime.webkit.available,false);
 assert.deepEqual(receipt.browserRuntime.selectedRoots,[root]);assert.deepEqual(receipt.browserRuntime.outcomes.map(row=>[row.id,row.status]),[[root,'passed']]);assert.equal(record.cases.filter(row=>row.root===root&&row.status==='passed').length,1,'The complete ordinary group still executes the selected browser root');
 const firstJournal=fs.readFileSync(journal,'utf8');
 for(const [name,value]of [['missing consumer environment',undefined],['literal unexpanded runner variable','$RUNNER_TEMP/playwright-browsers'],['different empty browser installation',path.join(temp,'wrong-engines')]]){
  fs.rmSync(path.join(runnerTemp,'group'),{recursive:true,force:true});const changed={...env};if(value!==undefined)changed.PLAYWRIGHT_BROWSERS_PATH=value;
  const failed=run('bash',['-euo','pipefail','-c',command(group)],fixture.root,changed);assert.notEqual(failed.status,0,name+' must fail through the actual workflow/group consumer');assert.equal(readEvidence(path.join(runnerTemp,'group'))?.status==='passed',false,name+' cannot publish passing group evidence');
 }
 assert.equal(fs.readFileSync(journal,'utf8'),firstJournal,'Consumer probes never repeat the external browser installation');
 t.diagnostic('Actual workflow install and persistence consumer share the same resolved runner-temp path with spaces; controlled external Chromium provider only, WebKit unavailable, retained preflight and full outcomes verified. Three wrong/missing/literal consumer environments fail closed; no real engine or shared port launched.');
});
