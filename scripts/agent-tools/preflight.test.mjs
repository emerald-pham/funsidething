import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ACTIONLINT_VERSION } from './workflow-validator.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const preflight = path.join(repositoryRoot, 'scripts/agent-tools/preflight.mjs');
const quickStartTest = 'RISK Quick start content: essential steps stay brief and detailed help remains user-facing in existing sections';
const unreadableDeviceFaqTest = 'RISK unreadable device recovery: Quick start and current Changelog explain preserved sources and local pending recovery';
const processControlOwner = 'Preflight fixture: explicit process-control owner';
const processControlChild = 'Preflight fixture: recognized explicit process control';

function fixtureInventory() {
  const roots = [
    { id: 'Landscape location: visible default-sky copy does not name Orlando', group: 'core', file: 'tests.js' },
    { id: quickStartTest, group: 'core', file: 'tests.js' },
    { id: unreadableDeviceFaqTest, group: 'persistence-recovery', file: 'tests.js' },
    { id: 'Preflight fixture: scenery root', group: 'scenery', file: 'tests.js' },
    { id: processControlOwner, group: 'native-process', file: 'scripts/agent-tools/preflight.fixture.test.mjs' },
  ];
  const groupIds = ['core', 'scenery', 'persistence-recovery', 'native-process'];
  const counts = Object.fromEntries(groupIds.map(id => [id, roots.filter(root => root.group === id).length]));
  return {
    schemaVersion: 1,
    baseline: {
      repository: 'emerald-pham/funsidething', runId: 'preflight-fixture', eventPolicy: 'push',
      sourceSha: '0'.repeat(40), sourceTree: '0'.repeat(40), checkoutSha: '0'.repeat(40),
      checkoutTree: '0'.repeat(40), comparisonBase: '0'.repeat(40),
      caseCount: roots.length, passed: roots.length, skipped: 0, failed: 0,
    },
    rootTests: roots.map(({ id }) => ({ id, durationMs: 1 })),
    requiredCases: roots.map(({ id }) => ({ id, root: id })),
    acceptedSkipCaseIds: [],
    fixtureGroups: counts,
  };
}

function fixtureAssignments(inventory) {
  const roots = [
    { root: 'Landscape location: visible default-sky copy does not name Orlando', group: 'core', file: 'tests.js' },
    { root: quickStartTest, group: 'core', file: 'tests.js' },
    { root: unreadableDeviceFaqTest, group: 'persistence-recovery', file: 'tests.js' },
    { root: 'Preflight fixture: scenery root', group: 'scenery', file: 'tests.js' },
    { root: processControlOwner, group: 'native-process', file: 'scripts/agent-tools/preflight.fixture.test.mjs' },
  ];
  return {
    schemaVersion: 1,
    assignmentMethod: 'Fixture roots model the validated four-group registration contract.',
    groups: ['core', 'scenery', 'persistence-recovery', 'native-process'].map(id => ({
      id,
      description: `Fixture ${id} registration cohort.`,
      resourcePolicy: 'isolated-process',
      withinGroupConcurrency: 1,
      baselineRootCount: inventory.fixtureGroups[id],
      baselineEstimatedDurationMs: inventory.fixtureGroups[id],
    })),
    rootAssignments: roots,
    rootReplacements: [],
    processControls: [{
      id: processControlChild,
      group: 'native-process',
      file: 'scripts/agent-tools/preflight.fixture.test.mjs',
      ownerRoot: processControlOwner,
      expectedExecutions: 1,
    }],
  };
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function childEnvironment() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

async function seedWorkflowValidation(fixtureRoot) {
  const workflowFile = '.github/workflows/data-safety.yml';
  const helperFile = 'scripts/agent-tools/workflow-validator.mjs';
  for (const file of [workflowFile, helperFile]) {
    const target = path.join(fixtureRoot, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(repositoryRoot, file), target);
  }
  const cacheRelative = path.join('node_modules', '.cache', 'funsidething', 'actionlint', `v${ACTIONLINT_VERSION}`, `${process.platform}-${process.arch}`);
  const fixtureCache = path.join(fixtureRoot, cacheRelative);
  const sourceCache = path.join(repositoryRoot, cacheRelative);
  await mkdir(fixtureCache, { recursive: true });
  await Promise.all([
    copyFile(path.join(sourceCache, 'actionlint'), path.join(fixtureCache, 'actionlint')),
    copyFile(path.join(sourceCache, 'manifest.json'), path.join(fixtureCache, 'manifest.json')),
  ]);
  await chmod(path.join(fixtureCache, 'actionlint'), 0o755);
}

async function createAppFixture(t, suffix) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), `chain-preflight-${suffix}-`));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const fixtureFiles = [
    'tests.js', 'index.html', 'app-release.js', 'location.js', 'vendor/lz-string-1.5.0.min.js',
    'package.json', 'scripts/test-first-gate.mjs', 'scripts/test-groups.mjs',
    'scripts/release-evidence.mjs', 'scripts/test-group-inventory.json', 'scripts/test-group-assignments.json',
    'scripts/agent-tools/preflight.fixture.test.mjs', 'scripts/agent-tools/workflow-validator.mjs',
    '.github/workflows/data-safety.yml',
  ];
  for (const relative of fixtureFiles.filter(file => !['scripts/agent-tools/preflight.fixture.test.mjs', 'scripts/agent-tools/workflow-validator.mjs', '.github/workflows/data-safety.yml'].includes(file))) {
    const target = path.join(fixtureRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(repositoryRoot, relative), target);
  }
  await seedWorkflowValidation(fixtureRoot);
  await writeFile(path.join(fixtureRoot, 'TEST_CHANGE_RATIONALES.json'), '[]\n');
  const testsPath = path.join(fixtureRoot, 'tests.js');
  await writeFile(testsPath, `${await readFile(testsPath, 'utf8')}\ntest('UNSELECTED FULL SUITE SENTINEL', () => { process.stdout.write('PREFLIGHT_FULL_SUITE_CHILD_SENTINEL\\n'); });\n`);
  await writeFile(path.join(fixtureRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node --test tests.js scripts/agent-tools/*.test.mjs' },
  }, null, 2) + '\n');
  const fixtureHelper = path.join(fixtureRoot, 'scripts/agent-tools/preflight.fixture.test.mjs');
  await mkdir(path.dirname(fixtureHelper), { recursive: true });
  await writeFile(fixtureHelper, `import { test } from 'node:test';\ntest(${JSON.stringify(processControlOwner)}, () => {});\n`);
  const inventoryPath = path.join(fixtureRoot, 'scripts/test-group-inventory.json');
  const inventory = fixtureInventory();
  await writeFile(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
  await writeFile(path.join(fixtureRoot, 'scripts/test-group-assignments.json'), JSON.stringify(fixtureAssignments(inventory), null, 2) + '\n');
  runGit(fixtureRoot, ['init', '-b', 'main']);
  runGit(fixtureRoot, ['config', 'user.email', 'preflight-fixture@example.invalid']);
  runGit(fixtureRoot, ['config', 'user.name', 'Preflight fixture']);
  runGit(fixtureRoot, ['add', ...fixtureFiles, 'TEST_CHANGE_RATIONALES.json']);
  runGit(fixtureRoot, ['commit', '-m', 'preflight inventory baseline fixture']);
  const inventoryBase = runGit(fixtureRoot, ['rev-parse', 'HEAD']);
  const inventoryTree = runGit(fixtureRoot, ['rev-parse', 'HEAD^{tree}']);
  inventory.baseline.sourceSha = inventoryBase;
  inventory.baseline.sourceTree = inventoryTree;
  inventory.baseline.checkoutSha = inventoryBase;
  inventory.baseline.checkoutTree = inventoryTree;
  inventory.baseline.comparisonBase = inventoryBase;
  await writeFile(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
  await writeFile(fixtureHelper, `import { test } from 'node:test';\ntest(${JSON.stringify(processControlOwner)}, () => {});\ntest(${JSON.stringify(processControlChild)}, () => {});\n`);
  runGit(fixtureRoot, ['add', 'scripts/test-group-inventory.json', 'scripts/agent-tools/preflight.fixture.test.mjs']);
  runGit(fixtureRoot, ['commit', '-m', 'bind current registration fixture']);
  return { fixtureRoot, base: runGit(fixtureRoot, ['rev-parse', 'HEAD']), fixtureFiles: [...fixtureFiles, 'TEST_CHANGE_RATIONALES.json'] };
}

async function addFixtureRoot(fixture, title, { assigned = false, filename = 'scripts/agent-tools/added.test.mjs' } = {}) {
  const rootPath = path.join(fixture.fixtureRoot, filename);
  await mkdir(path.dirname(rootPath), { recursive: true });
  await writeFile(rootPath, `import { test } from 'node:test';\ntest(${JSON.stringify(title)}, () => {});\n`);
  fixture.fixtureFiles.push(filename);
  if (assigned) {
    const assignmentsPath = path.join(fixture.fixtureRoot, 'scripts/test-group-assignments.json');
    const assignments = JSON.parse(await readFile(assignmentsPath, 'utf8'));
    assignments.rootAssignments.push({ root: title, group: 'native-process', file: filename });
    await writeFile(assignmentsPath, JSON.stringify(assignments, null, 2) + '\n');
  }
}

async function changeUnreadableRecoveryGuidance(fixture) {
  const indexPath = path.join(fixture.fixtureRoot, 'index.html');
  const original = await readFile(indexPath, 'utf8');
  const expected = 'Cloud recovery stays pending';
  assert.ok(original.includes(expected), 'the existing unreadable-device answer contains its pending-cloud contract');
  await writeFile(indexPath, original.replace(expected, 'Cloud recovery can wait'));
}

function removeTopLevelTest(source, title) {
  const marker = `test('${title}',`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `fixture contains ${title}`);
  let end = source.indexOf('\ntest(', start + marker.length);
  if (end === -1) end = source.length;
  return source.slice(0, start) + source.slice(end + 1);
}

async function runPreflight(fixture, evidenceName) {
  const args = [preflight, '--base', fixture.base];
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, args, {
    cwd: fixture.fixtureRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: childEnvironment(),
  });
  const finishedAt = new Date().toISOString();
  const output = result.stdout + result.stderr;
  const evidenceRoot = process.env.PREFLIGHT_TEST_EVIDENCE_DIR;
  if (evidenceRoot) {
    const directory = path.join(evidenceRoot, evidenceName);
    await mkdir(directory, { recursive: true });
    const sources = [];
    for (const relative of fixture.fixtureFiles) {
      const bytes = await readFile(path.join(fixture.fixtureRoot, relative));
      const target = path.join(directory, 'source', relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
      sources.push({ path: relative, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const record = {
      scenario: evidenceName,
      startedAt,
      finishedAt,
      command: [process.execPath, ...args],
      cwd: fixture.fixtureRoot,
      base: fixture.base,
      head: runGit(fixture.fixtureRoot, ['rev-parse', 'HEAD']),
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      sourceFiles: sources,
    };
    await writeFile(path.join(directory, 'run.json'), JSON.stringify(record, null, 2) + '\n');
    await writeFile(path.join(directory, 'run.output.txt'), output);
  }
  return { result, output };
}

test('preflight stops after a failed focused check instead of launching the full test suite', async t => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'chain-preflight-fail-fast-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await seedWorkflowValidation(fixtureRoot);
  await writeFile(path.join(fixtureRoot, 'tests.js'), `
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('Landscape location: visible default-sky copy does not name Orlando', () => {
  process.stdout.write('FIXTURE_SELECTED_COPY_CHECK\\n');
  assert.fail('fixture copy check failure');
});
test('RISK Quick start content: essential steps stay brief and detailed help remains user-facing in existing sections', () => {
  process.stdout.write('FIXTURE_SELECTED_FAQ_CHECK\\n');
});
test('UNSELECTED FULL SUITE SENTINEL', () => {
  process.stdout.write('PREFLIGHT_FULL_SUITE_CHILD_SENTINEL\\n');
});
`);
  const result = spawnSync(process.execPath, [preflight], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: childEnvironment(),
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /FIXTURE_SELECTED_COPY_CHECK/, 'the focused failing check ran');
  assert.doesNotMatch(result.stdout, /PREFLIGHT_FULL_SUITE_CHILD_SENTINEL/, 'the unfiltered full suite must not run after a focused failure');
});

test('preflight reports the existing rationale validator failure after focused checks pass', async t => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'chain-preflight-rationale-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await seedWorkflowValidation(fixtureRoot);
  await mkdir(path.join(fixtureRoot, 'scripts'), { recursive: true });
  await copyFile(path.join(repositoryRoot, 'scripts/test-first-gate.mjs'), path.join(fixtureRoot, 'scripts/test-first-gate.mjs'));
  await writeFile(path.join(fixtureRoot, 'TEST_CHANGE_RATIONALES.json'), '[]\n');
  const selectedTests = `
import { test } from 'node:test';
test('Landscape location: visible default-sky copy does not name Orlando', () => {});
test('RISK Quick start content: essential steps stay brief and detailed help remains user-facing in existing sections', () => {});
test('UNSELECTED FULL SUITE SENTINEL', () => { process.stdout.write('PREFLIGHT_FULL_SUITE_CHILD_SENTINEL\\n'); });
`;
  const testsPath = path.join(fixtureRoot, 'tests.js');
  await writeFile(testsPath, selectedTests);
  runGit(fixtureRoot, ['init', '-b', 'main']);
  runGit(fixtureRoot, ['config', 'user.email', 'preflight-fixture@example.invalid']);
  runGit(fixtureRoot, ['config', 'user.name', 'Preflight fixture']);
  runGit(fixtureRoot, ['add', 'scripts/test-first-gate.mjs', 'TEST_CHANGE_RATIONALES.json', 'tests.js']);
  runGit(fixtureRoot, ['commit', '-m', 'fixture base']);
  const base = runGit(fixtureRoot, ['rev-parse', 'HEAD']);
  await writeFile(testsPath, `${selectedTests}\ntest('added fixture test without rationale', () => {});\n`);
  runGit(fixtureRoot, ['add', 'tests.js']);
  runGit(fixtureRoot, ['commit', '-m', 'fixture protected test change']);

  const result = spawnSync(process.execPath, [preflight, '--base', base], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: childEnvironment(),
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout + result.stderr, /Existing tests were changed or removed without an exact-diff rationale/);
  assert.doesNotMatch(result.stdout, /PREFLIGHT_FULL_SUITE_CHILD_SENTINEL/, 'rationale failure must not launch the full suite');
});

test('preflight fails closed when a selected existing contract is missing', async t => {
  for (const scenario of ['missing', 'renamed', 'skipped', 'duplicated']) await t.test(scenario, async t => {
    const fixture = await createAppFixture(t, 'missing-check-' + scenario);
    const testsPath = path.join(fixture.fixtureRoot, 'tests.js');
    let tests = await readFile(testsPath, 'utf8');
    if (scenario === 'duplicated') {
      const indexPath = path.join(fixture.fixtureRoot, 'index.html');
      await writeFile(indexPath, (await readFile(indexPath, 'utf8')) + '\n<!-- select the recovery FAQ check -->\n');
    } else await changeUnreadableRecoveryGuidance(fixture);
    if (scenario === 'missing') tests = removeTopLevelTest(tests, unreadableDeviceFaqTest);
    if (scenario === 'renamed') tests = tests.replace("test('" + unreadableDeviceFaqTest + "',", "test('" + unreadableDeviceFaqTest + " renamed',");
    if (scenario === 'skipped') tests = tests.replace(
      "test('" + unreadableDeviceFaqTest + "',async()=>",
      "test('" + unreadableDeviceFaqTest + "',{skip:true},async()=>",
    );
    if (scenario === 'duplicated') tests += `\ntest(${JSON.stringify(unreadableDeviceFaqTest)}, () => {});\n`;
    await writeFile(testsPath, tests);
    const { result, output } = await runPreflight(fixture, 'required-check-' + scenario);
    assert.equal(result.status, 1, output);
    assert.match(output, /each selected check must report exactly one passing result/i);
    assert.match(output, /no unique passing result was reported for[\s\S]*Quick start and current Changelog explain preserved sources and local pending recovery/i);
    assert.doesNotMatch(output, /PREFLIGHT_FULL_SUITE_SENTINEL/);
  });
});

test('preflight rejects a workflow expression unavailable at job scope before full qualification', async t => {
  const fixture = await createAppFixture(t, 'invalid-workflow-context');
  await writeFile(path.join(fixture.fixtureRoot, '.github/workflows/data-safety.yml'), `name: Workflow fixture
on: push
jobs:
  regression:
    runs-on: ubuntu-latest
    env:
      PLAYWRIGHT_BROWSERS_PATH: \${{ runner.temp }}/playwright-browsers
    steps:
      - run: echo valid step
`);
  runGit(fixture.fixtureRoot, ['add', '.github/workflows/data-safety.yml']);
  runGit(fixture.fixtureRoot, ['commit', '-m', 'add invalid job-scope runner context']);
  fixture.base = runGit(fixture.fixtureRoot, ['rev-parse', 'HEAD']);

  const { result, output } = await runPreflight(fixture, 'invalid-workflow-context');
  assert.equal(result.status, 1, output);
  assert.match(output, /Preflight: pinned workflow validation/);
  assert.doesNotMatch(output, /Preflight: existing help and copy contracts/);
  assert.match(output, /workflow|actionlint|runner/i);
  assert.doesNotMatch(output, /PREFLIGHT_FULL_SUITE_CHILD_SENTINEL/);

  const missingFixture = await createAppFixture(t, 'missing-workflow-validator-setup');
  await rm(path.join(missingFixture.fixtureRoot, 'node_modules'), { recursive: true, force: true });
  const missingSetup = await runPreflight(missingFixture, 'missing-workflow-validator-setup');
  assert.equal(missingSetup.result.status, 2, missingSetup.output);
  assert.match(missingSetup.output, /Pinned actionlint v1\.7\.12 is not set up in this repository/);
  assert.match(missingSetup.output, /npm run agent:setup-workflow-validator/);
  assert.doesNotMatch(missingSetup.output, /Preflight: existing help and copy contracts|PREFLIGHT_FULL_SUITE_CHILD_SENTINEL/);
});

test('preflight passes the existing wording, FAQ, and rationale contracts on a valid isolated repository', async t => {
  const fixture = await createAppFixture(t, 'valid-app');
  const registeredRoot = 'Preflight fixture: valid newly assigned root';
  await addFixtureRoot(fixture, registeredRoot, { assigned: true });
  const indexPath = path.join(fixture.fixtureRoot, 'index.html');
  await writeFile(indexPath, (await readFile(indexPath, 'utf8')) + '\n<!-- a valid help-source edit selects the recovery FAQ contract -->\n');
  const { result, output } = await runPreflight(fixture, 'valid-app');
  assert.equal(result.status, 0, output);
  assert.match(output, /✔ Landscape location: visible default-sky copy does not name Orlando/);
  assert.ok(output.includes('✔ ' + quickStartTest));
  assert.ok(output.includes('✔ ' + unreadableDeviceFaqTest));
  assert.match(output, /Test-first diff gate passed\./);
  assert.match(output, /Current group registrations passed: \d+ assigned roots, 1 recognized process control, 1 newly assigned root\./);
  assert.match(output, /Preflight passed: pinned workflow, focused help\/copy, group-registration, and test-first\/rationale validation/);
  assert.doesNotMatch(output, /PREFLIGHT_FULL_SUITE_SENTINEL/);
});

test('preflight reports the existing default-location wording failure before full regression', async t => {
  const fixture = await createAppFixture(t, 'default-location');
  const htmlPath = path.join(fixture.fixtureRoot, 'index.html');
  await writeFile(htmlPath, `${await readFile(htmlPath, 'utf8')}\n<!-- Orlando -->\n`);
  const { result, output } = await runPreflight(fixture, 'default-location-failure');
  assert.equal(result.status, 1, output);
  assert.match(output, /✖ Landscape location: visible default-sky copy does not name Orlando/);
  assert.doesNotMatch(output, /PREFLIGHT_FULL_SUITE_CHILD_SENTINEL/);
  assert.doesNotMatch(output, /test-first\/rationale validator/);
});

test('preflight reports the existing FAQ length failure before full regression', async t => {
  const fixture = await createAppFixture(t, 'faq-length');
  const htmlPath = path.join(fixture.fixtureRoot, 'index.html');
  const original = await readFile(htmlPath, 'utf8');
  const marker = '<dt>How do I change the scenery?</dt><dd>';
  assert.ok(original.includes(marker), 'the fixture has the existing rendered scenery FAQ answer');
  await writeFile(htmlPath, original.replace(marker, marker + 'extra '.repeat(140)));
  const { result, output } = await runPreflight(fixture, 'faq-length-failure');
  assert.equal(result.status, 1, output);
  assert.match(output, /✖ RISK Quick start content: essential steps stay brief and detailed help remains user-facing in existing sections/);
  assert.doesNotMatch(output, /PREFLIGHT_FULL_SUITE_SENTINEL/);
  assert.doesNotMatch(output, /test-first\/rationale validator/);

  await t.test('stale unreadable-device FAQ assertion', async t => {
    const staleFixture = await createAppFixture(t, 'stale-unreadable-device-faq');
    await changeUnreadableRecoveryGuidance(staleFixture);
    const stale = await runPreflight(staleFixture, 'stale-unreadable-device-faq');
    assert.equal(stale.result.status, 1, stale.output);
    assert.ok(stale.output.includes('✖ ' + unreadableDeviceFaqTest));
    assert.match(stale.output, /Cloud recovery stays pending/);
    assert.doesNotMatch(stale.output, /PREFLIGHT_FULL_SUITE_SENTINEL/);
    assert.doesNotMatch(stale.output, /test-first\/rationale validator/);
  });

  await t.test('new unassigned root', async t => {
    const unassignedFixture = await createAppFixture(t, 'unassigned-root');
    const rootTitle = 'Preflight fixture: newly added root without an assignment';
    await addFixtureRoot(unassignedFixture, rootTitle);
    const unassigned = await runPreflight(unassignedFixture, 'unassigned-root');
    assert.equal(unassigned.result.status, 1, unassigned.output);
    assert.match(unassigned.output, /test-group registration validation/i);
    assert.ok(unassigned.output.includes(rootTitle));
    assert.match(unassigned.output, /no explicit group assignment or process-control declaration/);
    assert.doesNotMatch(unassigned.output, /Preflight passed|PREFLIGHT_FULL_SUITE_SENTINEL/);
  });
});

test('preflight launches each selected child once and launches none for help or invalid input', async t => {
  const fixture = await createAppFixture(t, 'once');
  for (const [args, expected] of [[['--base', fixture.base], 0], [['--help'], 0], [['--unknown'], 2], [['--base'], 2]]) {
    const result = spawnSync(process.execPath, [preflight, ...args], { cwd: fixture.fixtureRoot, encoding: 'utf8', env: childEnvironment() });
    const output = result.stdout + result.stderr;
    assert.equal(result.status, expected, output);
    const expectedChecks = args[0] === '--base' && args.length === 2 ? 1 : 0;
    assert.equal((output.match(/^✔ Landscape location:/gm) ?? []).length, expectedChecks, 'copy check execution count');
    assert.equal((output.match(/^✔ RISK Quick start content:/gm) ?? []).length, expectedChecks, 'FAQ check execution count');
    assert.equal((output.match(/Test-first diff gate passed\./g) ?? []).length, expectedChecks, 'rationale validator execution count');
    if (!expectedChecks) assert.doesNotMatch(output, /Preflight passed/);
  }

  const alias = path.join(fixture.fixtureRoot, 'preflight-entry-alias.mjs');
  await symlink(preflight, alias);
  const aliasHelp = spawnSync(process.execPath, [alias, '--help'], {
    cwd: fixture.fixtureRoot, encoding: 'utf8', env: childEnvironment(),
  });
  assert.equal(aliasHelp.error, undefined, aliasHelp.error?.message);
  assert.equal(aliasHelp.status, 0, `${aliasHelp.stdout}\n${aliasHelp.stderr}`);
  assert.match(aliasHelp.stdout, /Usage: node scripts\/agent-tools\/preflight\.mjs/,
    'the public preflight command must run its main through a symlinked path');

  const imported = spawnSync(process.execPath, [
    '--input-type=module', '-e', `await import(${JSON.stringify(new URL('./preflight.mjs', import.meta.url).href)});`,
  ], { cwd: fixture.fixtureRoot, encoding: 'utf8', env: childEnvironment() });
  assert.equal(imported.error, undefined, imported.error?.message);
  assert.equal(imported.status, 0, `${imported.stdout}\n${imported.stderr}`);
  assert.equal(imported.stdout, '', 'importing preflight must not invoke its CLI');
  assert.equal(imported.stderr, '', 'importing preflight must not write CLI diagnostics');
});

test('preflight reports real Git errors without treating them as an unpublished branch', async t => {
  const fixture = await createAppFixture(t, 'git-error');
  await writeFile(path.join(fixture.fixtureRoot, '.git/config'), '[broken\n');
  const result = spawnSync(process.execPath, [preflight, '--base', fixture.base], {
    cwd: fixture.fixtureRoot, encoding: 'utf8', env: childEnvironment(),
  });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /bad config line/i, 'the original Git diagnostic remains actionable');
  assert.doesNotMatch(result.stdout, /Preflight passed/);
});

test('preflight checks each distinct local comparison once without fetching its remote', async t => {
  for (const distinct of [false, true]) await t.test(distinct ? 'distinct upstream' : 'duplicate upstream', async t => {
    const fixture = await createAppFixture(t, distinct ? 'distinct' : 'duplicate');
    runGit(fixture.fixtureRoot, ['switch', '-c', 'task']);
    if (distinct) {
      await writeFile(path.join(fixture.fixtureRoot, 'notes.md'), 'published prose\n');
      runGit(fixture.fixtureRoot, ['add', 'notes.md']);
      runGit(fixture.fixtureRoot, ['commit', '-m', 'published prose']);
    }
    const remote = path.join(fixture.fixtureRoot, 'remote.git');
    runGit(fixture.fixtureRoot, ['init', '--bare', remote]);
    runGit(fixture.fixtureRoot, ['remote', 'add', 'origin', remote]);
    runGit(fixture.fixtureRoot, ['push', '-u', 'origin', 'task']);
    await rm(remote, { recursive: true });
    await writeFile(path.join(fixture.fixtureRoot, 'notes.md'), 'candidate prose\n');
    runGit(fixture.fixtureRoot, ['add', 'notes.md']);
    runGit(fixture.fixtureRoot, ['commit', '-m', 'candidate prose']);
    const before = runGit(fixture.fixtureRoot, ['show-ref']);
    const { result, output } = await runPreflight(fixture, distinct ? 'distinct-upstream' : 'duplicate-upstream');
    assert.equal(result.status, 0, output);
    assert.equal((output.match(/Test-first diff gate passed\./g) ?? []).length, distinct ? 2 : 1);
    assert.equal((output.match(/^✔ Landscape location:/gm) ?? []).length, 1);
    assert.equal((output.match(/^✔ RISK Quick start content:/gm) ?? []).length, 1);
    if (distinct) assert.match(output, /published upstream refs\/remotes\/origin\/task/);
    assert.equal(runGit(fixture.fixtureRoot, ['show-ref']), before, 'local refs remain unchanged');
  });
});

test('preflight rejects an invalid explicit comparison with its ref name', async t => {
  const fixture = await createAppFixture(t, 'invalid-ref');
  const result = spawnSync(process.execPath, [preflight, '--base', 'missing-explicit-ref'], {
    cwd: fixture.fixtureRoot, encoding: 'utf8', env: childEnvironment(),
  });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /selected comparison missing-explicit-ref/);
  assert.doesNotMatch(result.stdout, /Test-first diff gate passed|Preflight passed/);
});

test('preflight does not reinterpret an unavailable configured upstream as an unpublished branch', async t => {
  const fixture = await createAppFixture(t, 'missing-upstream');
  const remote = path.join(fixture.fixtureRoot, 'remote.git');
  runGit(fixture.fixtureRoot, ['init', '--bare', remote]);
  runGit(fixture.fixtureRoot, ['remote', 'add', 'origin', remote]);
  runGit(fixture.fixtureRoot, ['push', '-u', 'origin', 'main']);
  runGit(fixture.fixtureRoot, ['update-ref', '-d', 'refs/remotes/origin/main']);
  const { result, output } = await runPreflight(fixture, 'missing-upstream');
  assert.equal(result.status, 2, output);
  assert.match(output, /published upstream comparison refs\/remotes\/origin\/main/);
  assert.doesNotMatch(output, /Preflight passed/);
});

test('preflight keeps the first available default merge base when origin main has unrelated history', async t => {
  const fixture = await createAppFixture(t, 'default-fallback');
  runGit(fixture.fixtureRoot, ['switch', '--orphan', 'unrelated']);
  await writeFile(path.join(fixture.fixtureRoot, 'notes.md'), 'unrelated history\n');
  runGit(fixture.fixtureRoot, ['add', 'notes.md']);
  runGit(fixture.fixtureRoot, ['commit', '-m', 'unrelated root']);
  runGit(fixture.fixtureRoot, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  runGit(fixture.fixtureRoot, ['switch', 'main']);
  const result = spawnSync(process.execPath, [preflight], {
    cwd: fixture.fixtureRoot, encoding: 'utf8', env: childEnvironment(),
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Preflight passed/);
});

test('preflight rejects configured upstreams that Git cannot map to a tracking ref', async t => {
  for (const missing of ['remote', 'fetch mapping']) await t.test(missing, async t => {
    const fixture = await createAppFixture(t, 'unmapped-upstream');
    if (missing === 'fetch mapping') {
      runGit(fixture.fixtureRoot, ['remote', 'add', 'origin', path.join(fixture.fixtureRoot, 'absent-remote.git')]);
      runGit(fixture.fixtureRoot, ['config', '--unset-all', 'remote.origin.fetch']);
    }
    runGit(fixture.fixtureRoot, ['config', 'branch.main.remote', 'origin']);
    runGit(fixture.fixtureRoot, ['config', 'branch.main.merge', 'refs/heads/main']);
    const { result, output } = await runPreflight(fixture, 'unmapped-upstream-' + missing.replace(' ', '-'));
    assert.equal(result.status, 2, output);
    assert.match(output, /configured upstream/i, 'distinguish broken branch configuration from no upstream');
    assert.doesNotMatch(output, /Preflight passed/);
  });
});
