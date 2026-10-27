import assert from 'node:assert/strict';
import {derivePolicyProseImpact,deriveReleaseReviewPlan} from '../release-evidence.mjs';
import {createHash} from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
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
  fs.copyFileSync(path.join(repository,'scripts/agent-tools/checkpoint-progress.mjs'),path.join(root,'scripts/agent-tools/checkpoint-progress.mjs'));
  if(options.policy)fs.writeFileSync(path.join(root,'AGENTS.md'),'Read [release guide](docs/release.md) before release.\n');
  if(options.early){fs.mkdirSync(path.join(root,'.github/workflows'),{recursive:true});fs.writeFileSync(path.join(root,'.github/workflows/data-safety.yml'),'jobs:\n  early-startup:\n    runs-on: controlled-fixture\n');for(const name of ['early-ci.mjs','scenery-source-fixture.mjs','mobile-source-profile.mjs','button-safety-mobile-contract.mjs','button-safety-inventory.json','button-safety-contract.mjs','button-safety-ci-policy.mjs'])fs.copyFileSync(path.join(repository,'scripts',name),path.join(root,'scripts',name));writeJson(path.join(root,'scripts/early-ci-harness-source.json'),{schemaVersion:1,files:[],testExcerpts:[],limits:['Controlled parser fixture, not imported source or actual hosted evidence.']});}
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
    git(root,'add','.');git(root,'commit','-qm','Declare exact early consumers in the existing catalog');sourceSha=git(root,'rev-parse','HEAD');
  }
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

function invoke(fixture, { group = 'core', env = {}, repository = 'example/fixture', outputDir: requestedOutputDir, args = [], preserveNodeTestContext = false } = {}) {
  const outputDir = requestedOutputDir || path.join(os.tmpdir(), `chain-test-group-output-${process.pid}-${++outputSerial}`);
  fixture.outputs.push(outputDir);
  const childEnv = { ...process.env, ...env };
  if (!preserveNodeTestContext) delete childEnv.NODE_TEST_CONTEXT;
  const result = run('npm', ['run', 'test:group', '--', '--group', group, '--output-dir', outputDir,
    '--repository', repository, '--event-policy', 'local', '--run-id', 'fixture-run-1', '--run-attempt', '1',
    '--source-sha', fixture.sourceSha, '--comparison-base', fixture.comparisonBase, ...args], fixture.root,
  childEnv);
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
function aggregateCopy(t,fixture,mutate=()=>{},args=[]) {
  const collected=fs.mkdtempSync(path.join(os.tmpdir(),'chain-group-aggregate-'));t.after(()=>fs.rmSync(collected,{recursive:true,force:true}));
  for(const [id,output]of fixture.originals)fs.cpSync(output,path.join(collected,id),{recursive:true});
  const needs=path.join(collected,'needs.json');writeJson(needs,Object.fromEntries(['validation-context','event-gates','cohort-routing','regression'].map(id=>[id,{result:'success'}])));
  mutate(collected,needs);
  return invoke(fixture,{args:['--aggregate','--results-dir',collected,'--needs-json',needs,...args]});
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
 const receipt={schemaVersion:1,status:'passed',mode:'full',identity:{descriptor:id,workflowBlob:git(fixture.root,'rev-parse','HEAD:.github/workflows/data-safety.yml'),harnessSourceSha256:hash(fs.readFileSync(path.join(fixture.root,'scripts/early-ci-harness-source.json'))),eventName:null,eventRef:null},children:['harness','required-1gb'].map(kind=>({kind,exitCode:0,signal:null,error:null})),harnessCaseCount:3,artifacts:artifacts.sort((a,b)=>a.path.localeCompare(b.path))};writeJson(path.join(early,'receipt.json'),receipt);
 const collected=path.join(evidence,'groups');for(const [group,output]of fixture.originals)fs.cpSync(output,path.join(collected,group),{recursive:true});const needs=path.join(evidence,'needs.json');writeJson(needs,Object.fromEntries(['validation-context','event-gates','cohort-routing','regression','early-startup','mobile-stress'].map(name=>[name,{result:'success'}])));
 const env={GITHUB_REPOSITORY:id.repository,CHAIN_TEST_SOURCE_SHA:id.sourceSha,CHAIN_TEST_EVENT_POLICY:id.eventPolicy,GITHUB_RUN_ID:id.runId,GITHUB_RUN_ATTEMPT:String(id.runAttempt)};
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

test('group and aggregate retain actual early cases once across fresh group processes',async t=>{
 const {createMobileBundle}=await import('./mobile-memory-fixture.mjs');
 const fixture=createFixture(t,{early:true,earlyTransfer:true,nativeTitle:'RISK repository process: required installed-client native outcomes and artifacts execute exactly once',nativeReports:true});
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'chain-early-transfer-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const descriptorRun=invoke(fixture,{args:['--describe']});assert.equal(descriptorRun.status,0,descriptorRun.stderr);const descriptor=path.join(descriptorRun.outputDir,'descriptor.json'),identity=JSON.parse(fs.readFileSync(descriptor)).resultIdentity;
 const nativeIdentity={candidateCommit:identity.checkoutSha,candidateTree:identity.checkoutTree,sourceSha:identity.sourceSha,repository:identity.repository,runId:identity.runId,runAttempt:identity.runAttempt,eventPolicy:identity.eventPolicy};
 const seed=createMobileBundle(path.join(temp,'seed'),nativeIdentity),stress=createMobileBundle(path.join(temp,'stress'),nativeIdentity,'stress-512mb'),journal=path.join(temp,'executions.jsonl');
 const env={...process.env,GITHUB_REPOSITORY:identity.repository,CHAIN_TEST_SOURCE_SHA:identity.sourceSha,CHAIN_TEST_EVENT_POLICY:identity.eventPolicy,GITHUB_RUN_ID:identity.runId,GITHUB_RUN_ATTEMPT:String(identity.runAttempt),EARLY_TRANSFER_SEED:seed.directory,EARLY_ROOT_JOURNAL:journal};delete env.NODE_TEST_CONTEXT;delete env.GITHUB_EVENT_NAME;delete env.GITHUB_REF;
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
 await t.test('changed group transfer reference',()=>{const file=path.join(collected,'native-process/result.json'),original=fs.readFileSync(file),record=JSON.parse(original);record.earlyCoverage.cases.pop();writeJson(file,record);assert.notEqual(invoke(fixture,{env,args}).status,0,'Aggregate must rederive every transferred early outcome');fs.writeFileSync(file,original);});
 await t.test('missing durable predecessor',()=>{fs.unlinkSync(path.join(early,'harness.stdout'));assert.notEqual(invoke(fixture,{group:'native-process',env,args:['--early-receipt',receipt]}).status,0);assert.notEqual(invoke(fixture,{env,args}).status,0);assert.deepEqual(fs.readFileSync(journal,'utf8').trim().split('\n'),first);});
 t.diagnostic(JSON.stringify({scope:'Controlled OS-process transfer only; no native/runtime proof',earlyRootExecutions:first.length,uniqueEarlyRoots:new Set(first).size,ordinaryGroups:groups.length,aggregateCaseCount:report.caseCount}));
});

test('workflow metadata aggregate rejects pending cancelled unresolved and stale successful routing proofs', async parent=>{
 const fixture=createFixture(parent),{file,proof}=fixtureCoverage(fixture),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'chain-metadata-aggregate-'));
 parent.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));fs.mkdirSync(path.join(temporary,'groups'));fs.mkdirSync(path.join(temporary,'final-routing'));
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
