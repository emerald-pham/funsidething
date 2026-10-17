import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const preflight = path.join(repositoryRoot, 'scripts/agent-tools/preflight.mjs');

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

async function createAppFixture(t, suffix) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), `chain-preflight-${suffix}-`));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const fixtureFiles = [
    'tests.js', 'index.html', 'location.js', 'vendor/lz-string-1.5.0.min.js',
    'scripts/test-first-gate.mjs',
  ];
  for (const relative of fixtureFiles) {
    const target = path.join(fixtureRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(repositoryRoot, relative), target);
  }
  await writeFile(path.join(fixtureRoot, 'TEST_CHANGE_RATIONALES.json'), '[]\n');
  const testsPath = path.join(fixtureRoot, 'tests.js');
  await writeFile(testsPath, `${await readFile(testsPath, 'utf8')}\ntest('UNSELECTED FULL SUITE SENTINEL', () => { process.stdout.write('PREFLIGHT_FULL_SUITE_CHILD_SENTINEL\\n'); });\n`);
  runGit(fixtureRoot, ['init', '-b', 'main']);
  runGit(fixtureRoot, ['config', 'user.email', 'preflight-fixture@example.invalid']);
  runGit(fixtureRoot, ['config', 'user.name', 'Preflight fixture']);
  runGit(fixtureRoot, ['add', ...fixtureFiles, 'TEST_CHANGE_RATIONALES.json']);
  runGit(fixtureRoot, ['commit', '-m', 'preflight valid fixture']);
  return { fixtureRoot, base: runGit(fixtureRoot, ['rev-parse', 'HEAD']), fixtureFiles: [...fixtureFiles, 'TEST_CHANGE_RATIONALES.json'] };
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
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'chain-preflight-missing-check-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await mkdir(path.join(fixtureRoot, 'scripts'), { recursive: true });
  await copyFile(path.join(repositoryRoot, 'scripts/test-first-gate.mjs'), path.join(fixtureRoot, 'scripts/test-first-gate.mjs'));
  await writeFile(path.join(fixtureRoot, 'TEST_CHANGE_RATIONALES.json'), '[]\n');
  await writeFile(path.join(fixtureRoot, 'tests.js'), `
import { test } from 'node:test';
test('UNSELECTED FULL SUITE SENTINEL', () => { process.stdout.write('PREFLIGHT_FULL_SUITE_CHILD_SENTINEL\\n'); });
`);
  runGit(fixtureRoot, ['init', '-b', 'main']);
  runGit(fixtureRoot, ['config', 'user.email', 'preflight-fixture@example.invalid']);
  runGit(fixtureRoot, ['config', 'user.name', 'Preflight fixture']);
  runGit(fixtureRoot, ['add', 'scripts/test-first-gate.mjs', 'TEST_CHANGE_RATIONALES.json', 'tests.js']);
  runGit(fixtureRoot, ['commit', '-m', 'fixture without focused checks']);
  const base = runGit(fixtureRoot, ['rev-parse', 'HEAD']);

  const result = spawnSync(process.execPath, [preflight, '--base', base], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: childEnvironment(),
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout + result.stderr, /expected 2 named help\/copy checks to run/i);
  assert.doesNotMatch(result.stdout + result.stderr, /PREFLIGHT_FULL_SUITE_CHILD_SENTINEL/);
});

test('preflight passes the existing wording, FAQ, and rationale contracts on a valid isolated repository', async t => {
  const fixture = await createAppFixture(t, 'valid-app');
  const { result, output } = await runPreflight(fixture, 'valid-app');
  assert.equal(result.status, 0, output);
  assert.match(output, /✔ Landscape location: visible default-sky copy does not name Orlando/);
  assert.match(output, /✔ RISK Quick start content: essential steps stay brief and detailed help remains user-facing in existing sections/);
  assert.match(output, /Test-first diff gate passed\./);
  assert.match(output, /Preflight passed: focused help\/copy checks and test-first\/rationale validation/);
  assert.doesNotMatch(output, /PREFLIGHT_FULL_SUITE_CHILD_SENTINEL/);
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
  await writeFile(htmlPath, original.replace(marker, `${marker}${'extra '.repeat(140)}`));
  const { result, output } = await runPreflight(fixture, 'faq-length-failure');
  assert.equal(result.status, 1, output);
  assert.match(output, /✖ RISK Quick start content: essential steps stay brief and detailed help remains user-facing in existing sections/);
  assert.doesNotMatch(output, /PREFLIGHT_FULL_SUITE_CHILD_SENTINEL/);
  assert.doesNotMatch(output, /test-first\/rationale validator/);
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
