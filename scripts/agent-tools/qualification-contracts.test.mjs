import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const selector = path.join(repository, 'scripts/agent-tools/qualification-contracts.mjs');
const contractRoots = {
  'startup-browser': 'RISK repository process: newly registered startup browser roots require an isolated Chromium receipt',
  'finite-authority': 'RISK repository process: diagnostic checkpoints retain finite authority across fresh process and CI boundaries',
  'workflow-context': 'RISK repository process: workflow browser paths resolve only in supported runner contexts',
};
const pathsByContract = {
  'startup-browser': [
    '.github/workflows/data-safety.yml', 'scripts/test-groups.mjs',
    'scripts/agent-tools/test-groups.test.mjs', 'scripts/agent-tools/ci-pass-reuse.mjs',
    'scripts/test-group-assignments.json', 'tests.js',
  ],
  'finite-authority': [
    'scripts/agent-tools/checkpoint-progress.mjs', 'scripts/agent-tools/checkpoint-progress.test.mjs',
    'scripts/test-group-assignments.json', 'tests.js',
  ],
  'workflow-context': [
    '.github/workflows/data-safety.yml', 'scripts/agent-tools/workflow-validator.mjs',
    'scripts/agent-tools/test-groups.test.mjs', 'scripts/agent-tools/ci-pass-reuse.mjs',
    'scripts/test-group-assignments.json', 'tests.js',
  ],
};
const groups = ['core', 'scenery', 'persistence-recovery', 'native-process'];

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
  const allRoots = [...baselineRoots, ...Object.entries(contractRoots).map(([id, title]) => [title, 'native-process', id])];
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    type: 'module',
    scripts: { test: 'node --test tests.js scripts/agent-tools/*.test.mjs' },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'tests.js'), `import { test } from 'node:test';\n${allRoots.map(([title]) => `test(${JSON.stringify(title)}, () => {});`).join('\n')}\n`);
  for (const file of new Set(Object.values(pathsByContract).flat())) {
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
    rootAssignments: allRoots.map(([rootName, group, qualificationId]) => ({
      root: rootName,
      group,
      file: 'tests.js',
      ...(qualificationId ? { qualificationContract: { id: qualificationId, triggerPaths: pathsByContract[qualificationId] } } : {}),
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

test('qualification selector binds exact assigned risk wrappers to source changes and fails closed', async t => {
  for (const [id, trigger] of [
    ['startup-browser', '.github/workflows/data-safety.yml'],
    ['finite-authority', 'scripts/agent-tools/checkpoint-progress.mjs'],
    ['workflow-context', 'scripts/agent-tools/workflow-validator.mjs'],
  ]) await t.test(`${id} selects its exact existing wrapper`, () => {
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

  await t.test('missing and duplicate registry metadata fail closed', () => {
    for (const mutation of ['missing', 'duplicate']) {
      const fixture = makeFixture(t);
      const file = path.join(fixture.root, 'scripts/test-group-assignments.json');
      const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
      const selected = catalog.rootAssignments.find(row => row.qualificationContract?.id === 'startup-browser');
      if (mutation === 'missing') delete selected.qualificationContract;
      else catalog.rootAssignments.find(row => row.root === 'fixture native contract baseline').qualificationContract = selected.qualificationContract;
      writeJson(file, catalog);
      commitChanged(fixture, { 'scripts/agent-tools/checkpoint-progress.mjs': 'changed source\n' });
      const result = invoke(fixture);
      assert.notEqual(result.status, 0, `${mutation} selector metadata must fail closed`);
      assert.match(result.stderr, /qualification|contract|duplicate|exactly once/i);
    }
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
    commitChanged(fixture, { 'scripts/agent-tools/checkpoint-progress.mjs': 'changed source\n' });
    const result = invoke(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /baseline root|replacement|registration|qualification/i);
  });
});
