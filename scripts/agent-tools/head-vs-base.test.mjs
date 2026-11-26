import '../../tests/isolate-git-env.js';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Every case compares a temporary repository's checkout with a base commit in
// it. No case reaches the live host ledger or this checkout's worktrees (#2494).
const entrypoint = fileURLToPath(new URL('./head-vs-base.mjs', import.meta.url));

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function commitFile(cwd, name, body, message) {
  writeFileSync(join(cwd, name), body);
  git(cwd, 'add', name);
  git(cwd, 'commit', '--quiet', '-m', message);
}

// A checkout whose `main` branch is the base and whose current branch, `head`,
// carries one more commit. The main checkout has an installed dependency, as
// the host's own checkout has, so a base worktree that worktree-ready prepared
// can load it and one it did not prepare cannot.
function createFixture(prefix, { base, head }) {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const repo = join(fixture, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '--quiet');
  git(repo, 'checkout', '--quiet', '-b', 'main');
  git(repo, 'config', 'user.name', 'Head Versus Base Fixture');
  git(repo, 'config', 'user.email', 'head-vs-base-fixture@example.invalid');
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(repo, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
  writeFileSync(join(repo, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{}}\n');
  git(repo, 'add', '.');
  commitFile(repo, 'probe.test.js', base, 'base probe');
  git(repo, 'checkout', '--quiet', '-b', 'head');
  commitFile(repo, 'probe.test.js', head, 'head probe');
  mkdirSync(join(repo, 'node_modules', 'fixture-dep'), { recursive: true });
  writeFileSync(join(repo, 'node_modules', 'fixture-dep', 'index.js'), 'module.exports = "installed";\n');
  // Stands in for npm where a copy-on-write clone is unavailable (CI's Linux).
  const npm = join(fixture, 'fake-npm.mjs');
  writeFileSync(npm, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
if (process.argv[2] !== 'ci') process.exit(1);
mkdirSync('node_modules/fixture-dep', { recursive: true });
writeFileSync('node_modules/fixture-dep/index.js', 'module.exports = "installed";\\n');
`);
  chmodSync(npm, 0o755);
  return { fixture, repo, npm };
}

function compare(args, { repo, npm }, environment = {}) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '',
      CODEX_COORDINATION_FILE: '',
      DOW_EMULATOR_COORDINATION_FILE: '',
      CHAIN_WORKTREE_READY_NPM: npm,
      // Only a case that sets them gives the head runs ports: a base with no
      // ledger to claim its own from would be an unprepared base (#2498 N1).
      CHAIN_NATIVE_PORT: '',
      CHAIN_NATIVE_SMOKE_PORT: '',
      ...environment,
    },
  });
}

function worktreePaths(repo) {
  return git(repo, 'worktree', 'list', '--porcelain').split('\n')
    .filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length));
}

const PROBE_HEADER = "const test = require('node:test');\nconst assert = require('node:assert/strict');\n";

test('head-vs-base counts a failure that happens on the head only, names its message once with its count, and removes the base worktree it prepared', () => {
  // The base probe loads the main checkout's dependency, so it passes only in
  // a base worktree that worktree-ready gave its own node_modules.
  const setup = createFixture('chain-head-vs-base-one-side-', {
    base: `${PROBE_HEADER}test('save loop probe', () => { assert.equal(require('fixture-dep'), 'installed'); });\n`,
    head: `${PROBE_HEADER}test('save loop probe', () => { assert.equal(1, 2, 'head broke the save loop'); });\n`,
  });
  try {
    const args = ['--file', 'probe.test.js', '--pattern', 'save loop', '--runs', '4', '--parallel', '3', '--base', 'main'];
    const json = compare([...args, '--json'], setup);
    assert.equal(json.status, 1, `a failing run exits 1\n${json.stderr}`);
    const report = JSON.parse(json.stdout);
    assert.deepEqual(
      { passed: report.head.passed, failed: report.head.failed, notRun: report.head.notRun, failures: report.head.failures },
      { passed: 0, failed: 4, notRun: 0, failures: [{ message: 'save loop probe: head broke the save loop', count: 4 }] },
      'every head run fails with the one distinct message',
    );
    assert.deepEqual(
      { passed: report.base.passed, failed: report.base.failed, notRun: report.base.notRun, failures: report.base.failures },
      { passed: 4, failed: 0, notRun: 0, failures: [] },
      'every base run passes in a worktree prepared with its own dependencies',
    );
    assert.equal(report.base.sha, git(setup.repo, 'rev-parse', 'main'), 'the base side ran the base commit');
    assert.equal(report.head.sha, git(setup.repo, 'rev-parse', 'HEAD'), 'the head side ran the current checkout');
    assert.equal(existsSync(report.base.worktree), false, 'the base worktree directory is gone');
    assert.deepEqual(worktreePaths(setup.repo), [setup.repo], 'git lists no base worktree afterwards');

    const text = compare(args, setup);
    assert.equal(text.status, 1, text.stderr);
    assert.match(text.stdout, /^head .*: 0 passed, 4 failed, 0 not run$/m, 'the printed head line counts each outcome');
    assert.match(text.stdout, /^base main .*: 4 passed, 0 failed, 0 not run$/m, 'the printed base line counts each outcome');
    assert.match(text.stdout, /^ {2}4× save loop probe: head broke the save loop$/m, 'the printed failure carries its count');
    assert.deepEqual(worktreePaths(setup.repo), [setup.repo], 'the second comparison removed its base worktree too');
  } finally {
    rmSync(setup.fixture, { recursive: true, force: true });
  }
});

test('head-vs-base reports a skipped test, or a pattern that matches nothing, as not run and never as a pass', () => {
  const probe = `${PROBE_HEADER}test('browser probe', { skip: 'needs LANDSCAPE_BROWSER_URL' }, () => {});\ntest('steady probe', () => {});\n`;
  const setup = createFixture('chain-head-vs-base-not-run-', { base: probe, head: `${probe}// head edit\n` });
  try {
    const compareJson = (pattern) => {
      const result = compare(['--file', 'probe.test.js', '--pattern', pattern, '--runs', '2', '--parallel', '2', '--base', 'main', '--json'], setup);
      assert.equal(result.status, 1, `a run that did not run is not a clean comparison\n${result.stderr}`);
      const report = JSON.parse(result.stdout);
      return [report.head, report.base].map(({ passed, failed, notRun, notRunReasons }) => ({ passed, failed, notRun, notRunReasons }));
    };
    const skipped = { passed: 0, failed: 0, notRun: 2, notRunReasons: [{ reason: 'skipped: browser probe', count: 2 }] };
    assert.deepEqual(compareJson('browser probe'), [skipped, skipped], 'a skipped test never ran on either side');
    assert.deepEqual(compareJson('probe'), [skipped, skipped], 'a run that skipped one selected test is not a pass, though another passed');
    const unmatched = { passed: 0, failed: 0, notRun: 2, notRunReasons: [{ reason: 'no test matched the pattern', count: 2 }] };
    assert.deepEqual(compareJson('no such probe'), [unmatched, unmatched], "Node's passing file-level point for a file with no match is not a pass");
  } finally {
    rmSync(setup.fixture, { recursive: true, force: true });
  }
});

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('an interrupted head-vs-base stops its test runs and still removes the base worktree', async () => {
  // Each run records its process id, then waits far longer than the test.
  const probe = `${PROBE_HEADER}test('slow probe', async () => {
  require('node:fs').writeFileSync(require('node:path').join(process.env.PROBE_PIDS, String(process.pid)), '');
  await new Promise((done) => setTimeout(done, 60000));
});\n`;
  const setup = createFixture('chain-head-vs-base-interrupt-', { base: probe, head: `${probe}// head edit\n` });
  const pids = join(setup.fixture, 'pids');
  mkdirSync(pids);
  try {
    const child = spawn(process.execPath, [entrypoint, '--file', 'probe.test.js', '--pattern', 'slow probe', '--runs', '1', '--parallel', '2', '--base', 'main'], {
      cwd: setup.repo,
      env: { ...process.env, CI: '', CODEX_COORDINATION_FILE: '', DOW_EMULATOR_COORDINATION_FILE: '', CHAIN_WORKTREE_READY_NPM: setup.npm, CHAIN_NATIVE_PORT: '', CHAIN_NATIVE_SMOKE_PORT: '', PROBE_PIDS: pids },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const exited = new Promise((done) => child.on('close', (status, signal) => done({ status, signal })));
    const deadline = Date.now() + 30000;
    while (readdirSync(pids).length < 2) {
      assert.ok(Date.now() < deadline, `both sides' runs start\n${stderr}`);
      await new Promise((done) => setTimeout(done, 50));
    }
    const runs = readdirSync(pids).map(Number);
    const [baseWorktree] = worktreePaths(setup.repo).filter((path) => path !== setup.repo);
    assert.ok(baseWorktree && existsSync(baseWorktree), `the base worktree exists while its run waits\n${stderr}`);
    child.kill('SIGINT');
    const { status } = await exited;
    assert.equal(status, 130, `an interrupt exits 128 plus SIGINT's number\n${stderr}`);
    assert.deepEqual(runs.filter(processAlive), [], 'no test run outlives the interrupted comparison');
    assert.equal(existsSync(baseWorktree), false, 'the interrupted comparison removed the base worktree directory');
    assert.deepEqual(worktreePaths(setup.repo), [setup.repo], 'git lists no base worktree after the interrupt');
  } finally {
    rmSync(setup.fixture, { recursive: true, force: true });
  }
});

// The test-run recorder forwards an interrupt to the comparison's process
// group, then kills that group outright 750 ms later, which can land while the
// comparison is still removing its base worktree.
test('a head-vs-base killed outright during its interrupt cleanup still has its base worktree removed', async () => {
  const probe = `${PROBE_HEADER}test('slow probe', async () => {
  require('node:fs').writeFileSync(require('node:path').join(process.env.PROBE_PIDS, String(process.pid)), '');
  await new Promise((done) => setTimeout(done, 60000));
});\n`;
  const setup = createFixture('chain-head-vs-base-killed-', { base: probe, head: `${probe}// head edit\n` });
  const pids = join(setup.fixture, 'pids');
  mkdirSync(pids);
  try {
    const child = spawn(process.execPath, [entrypoint, '--file', 'probe.test.js', '--pattern', 'slow probe', '--runs', '1', '--parallel', '2', '--base', 'main'], {
      cwd: setup.repo,
      env: { ...process.env, CI: '', CODEX_COORDINATION_FILE: '', DOW_EMULATOR_COORDINATION_FILE: '', CHAIN_WORKTREE_READY_NPM: setup.npm, CHAIN_NATIVE_PORT: '', CHAIN_NATIVE_SMOKE_PORT: '', PROBE_PIDS: pids },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const exited = new Promise((done) => child.on('close', (status, signal) => done({ status, signal })));
    let deadline = Date.now() + 30000;
    while (readdirSync(pids).length < 2) {
      assert.ok(Date.now() < deadline, `both sides' runs start\n${stderr}`);
      await new Promise((done) => setTimeout(done, 50));
    }
    const runs = readdirSync(pids).map(Number);
    const [baseWorktree] = worktreePaths(setup.repo).filter((path) => path !== setup.repo);
    assert.ok(baseWorktree, `the base worktree exists while its run waits\n${stderr}`);
    // No grace at all: the kill can land at any point of the cleanup.
    process.kill(-child.pid, 'SIGINT');
    process.kill(-child.pid, 'SIGKILL');
    assert.equal((await exited).signal, 'SIGKILL', 'the comparison itself was killed');
    deadline = Date.now() + 20000;
    while (worktreePaths(setup.repo).length > 1 || existsSync(baseWorktree)) {
      assert.ok(Date.now() < deadline, `the base worktree is removed after its comparison was killed\n${worktreePaths(setup.repo).join('\n')}`);
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.deepEqual(runs.filter(processAlive), [], 'no test run outlives the killed comparison');
  } finally {
    rmSync(setup.fixture, { recursive: true, force: true });
  }
});

test("head-vs-base gives the base runs the ports worktree-ready claimed for the base, not the caller's, and frees that claim afterwards", () => {
  // The caller's shell exported port 1; a base run that inherited it would
  // share the head runs' servers.
  const probe = `${PROBE_HEADER}test('port probe', () => { assert.notEqual(process.env.CHAIN_NATIVE_PORT, '1', 'inherited the caller port'); assert.match(process.env.CHAIN_NATIVE_PORT, /^\\d+$/); });\n`;
  const setup = createFixture('chain-head-vs-base-ports-', { base: probe, head: `${probe}// head edit\n` });
  const ledger = join(setup.fixture, 'host-ledger.json');
  writeFileSync(ledger, `${JSON.stringify({ version: 1, scope: 'codex-wide', entries: [], reservations: [], configurations: [] }, null, 2)}\n`);
  try {
    const result = compare(['--file', 'probe.test.js', '--pattern', 'port probe', '--runs', '2', '--parallel', '2', '--base', 'main', '--json'], setup, {
      CODEX_COORDINATION_FILE: ledger, CHAIN_NATIVE_PORT: '1', CHAIN_NATIVE_SMOKE_PORT: '2',
    });
    const report = JSON.parse(result.stdout);
    assert.deepEqual([report.head.failed, report.base.passed], [2, 2], `only the head runs keep the caller's port\n${result.stderr}`);
    const entries = JSON.parse(readFileSync(ledger, 'utf8')).entries.filter((entry) => entry.worktree === report.base.worktree);
    assert.equal(entries.length, 1, 'worktree-ready registered the base worktree in the ledger');
    assert.notEqual(entries[0].status, 'active', 'its entry and ports were freed once the base worktree was removed');
  } finally {
    rmSync(setup.fixture, { recursive: true, force: true });
  }
});

test('head-vs-base records its comparison through the test-run recorder when given an evidence directory', () => {
  const setup = createFixture('chain-head-vs-base-record-', {
    base: `${PROBE_HEADER}test('save loop probe', () => {});\n`,
    head: `${PROBE_HEADER}test('save loop probe', () => { assert.equal(1, 2, 'head broke the save loop'); });\n`,
  });
  const evidence = join(setup.fixture, 'evidence');
  try {
    const result = compare(['--file', 'probe.test.js', '--pattern', 'save loop', '--runs', '2', '--parallel', '2', '--base', 'main',
      '--evidence-dir', evidence, '--purpose', 'later-baseline-sensitivity'], setup);
    assert.equal(result.status, 1, `the recorded comparison keeps its exit status\n${result.stderr}`);
    const records = existsSync(evidence) ? readdirSync(evidence).filter((name) => name.endsWith('.json')) : [];
    assert.equal(records.length, 1, `one recorder record is written\n${result.stderr}`);
    const record = JSON.parse(readFileSync(join(evidence, records[0]), 'utf8'));
    assert.equal(record.declaredPurpose, 'later-baseline-sensitivity');
    assert.equal(record.execution.exitCode, 1, 'the record holds the comparison exit');
    assert.match(record.execution.output.stdout, /^head .*: 0 passed, 2 failed, 0 not run$/m, "the record holds the head side's counts");
    assert.match(record.execution.output.stdout, /^base main .*: 2 passed, 0 failed, 0 not run$/m, "the record holds the base side's counts");
    assert.ok(!record.command.args.includes('--evidence-dir'), 'the recorded comparison is the plain command, not a second recording');
  } finally {
    rmSync(setup.fixture, { recursive: true, force: true });
  }
});

// #2498 review B1: an absolute --file once ran the head's file on both sides,
// so the base loaded the head's code and a head-only failure read as one the
// base already had. Agents are told to pass absolute paths.
test("head-vs-base runs the base commit's own copy of a test file given by its absolute path in the checkout, and refuses a file outside the checkout", () => {
  const setup = createFixture('chain-head-vs-base-absolute-', {
    base: `${PROBE_HEADER}test('save loop probe', () => {});\n`,
    head: `${PROBE_HEADER}test('save loop probe', () => { assert.equal(1, 2, 'head broke the save loop'); });\n`,
  });
  try {
    const common = ['--pattern', 'save loop', '--runs', '2', '--parallel', '2', '--base', 'main', '--json'];
    const absolute = compare(['--file', join(setup.repo, 'probe.test.js'), ...common], setup);
    assert.equal(absolute.status, 1, `the head's failure fails the comparison\n${absolute.stderr}`);
    const report = JSON.parse(absolute.stdout);
    assert.deepEqual([report.head.passed, report.head.failed], [0, 2], 'every head run fails');
    assert.deepEqual(
      { passed: report.base.passed, failed: report.base.failed, failures: report.base.failures },
      { passed: 2, failed: 0, failures: [] },
      "the base runs its own probe, not the head's, so the failure is the head's alone",
    );
    assert.equal(report.file, 'probe.test.js', 'the report names the file relative to the checkout');

    const outside = join(setup.fixture, 'outside.test.js');
    writeFileSync(outside, `${PROBE_HEADER}test('save loop probe', () => {});\n`);
    for (const file of [outside, '../outside.test.js']) {
      const refused = compare(['--file', file, ...common], setup);
      assert.equal(refused.status, 2, `a file outside the checkout is refused: ${file}\n${refused.stdout}${refused.stderr}`);
      assert.match(refused.stderr, /outside the checkout/, `the refusal says why: ${file}`);
      assert.equal(refused.stdout, '', `no comparison is reported for ${file}`);
    }
    assert.deepEqual(worktreePaths(setup.repo), [setup.repo], 'no base worktree is left behind');
  } finally {
    rmSync(setup.fixture, { recursive: true, force: true });
  }
});

// #2498 review N1: worktree-ready never fails, so a base it could not give
// dependencies or ports once ran anyway, and its runs failed for that reason
// alone, which read as "already fails on base".
test('head-vs-base reports a base worktree that could not be prepared as an environment failure and runs neither side', () => {
  const probe = `${PROBE_HEADER}test('dependency probe', () => { assert.equal(require('fixture-dep'), 'installed'); });\n`;
  const setup = createFixture('chain-head-vs-base-unprepared-', { base: probe, head: `${probe}// head edit\n` });
  try {
    // The head's lockfile differs from the base's, so worktree-ready cannot
    // clone the main checkout's dependencies for the base, and npm ci fails.
    commitFile(setup.repo, 'package-lock.json', '{"name":"fixture","version":"1.0.1","lockfileVersion":3,"packages":{}}\n', 'head lockfile');
    const failingNpm = join(setup.fixture, 'failing-npm.mjs');
    writeFileSync(failingNpm, '#!/usr/bin/env node\nconsole.error("network is down");\nprocess.exit(1);\n');
    chmodSync(failingNpm, 0o755);
    const withoutDependencies = compare(['--file', 'probe.test.js', '--pattern', 'dependency probe', '--runs', '2', '--parallel', '2', '--base', 'main'],
      { ...setup, npm: failingNpm });
    assert.equal(withoutDependencies.status, 2, `an unprepared base is an environment failure\n${withoutDependencies.stdout}${withoutDependencies.stderr}`);
    assert.match(withoutDependencies.stderr, /environment failure/, 'the failure is named as the environment');
    assert.match(withoutDependencies.stderr, /dependencies/, 'it names the missing dependencies');
    assert.equal(withoutDependencies.stdout, '', 'neither side is reported');
    assert.deepEqual(worktreePaths(setup.repo), [setup.repo], 'the unprepared base worktree is removed');

    // The base now shares the head's lockfile, so it gets dependencies, but the
    // caller's runs have a port and no ledger can give the base its own.
    const portProbe = `${PROBE_HEADER}test('port probe', () => { assert.match(process.env.CHAIN_NATIVE_PORT ?? '', /^\\d+$/); });\n`;
    commitFile(setup.repo, 'probe.test.js', portProbe, 'port probe');
    commitFile(setup.repo, 'probe.test.js', `${portProbe}// head edit\n`, 'head port probe');
    const withoutPorts = compare(['--file', 'probe.test.js', '--pattern', 'port probe', '--runs', '2', '--parallel', '2', '--base', 'HEAD~1'], setup, {
      CHAIN_NATIVE_PORT: '1', CHAIN_NATIVE_SMOKE_PORT: '2',
    });
    assert.equal(withoutPorts.status, 2, `a base without the ports the head runs have is an environment failure\n${withoutPorts.stdout}${withoutPorts.stderr}`);
    assert.match(withoutPorts.stderr, /environment failure/, 'the failure is named as the environment');
    assert.match(withoutPorts.stderr, /CHAIN_NATIVE_PORT/, 'it names the missing port');
    assert.equal(withoutPorts.stdout, '', 'neither side is reported');
    assert.deepEqual(worktreePaths(setup.repo), [setup.repo], 'the unprepared base worktree is removed');
  } finally {
    rmSync(setup.fixture, { recursive: true, force: true });
  }
});

// #2498 specialist review N5: a repository-wide `git worktree prune` once
// deregistered every other worktree whose directory was missing for a moment,
// such as one on an unmounted disk, which host coordination still counts as owned.
test("head-vs-base removes only its own base worktree's registration and leaves another worktree whose directory is missing", () => {
  const probe = `${PROBE_HEADER}test('steady probe', () => {});\n`;
  const setup = createFixture('chain-head-vs-base-prune-', { base: probe, head: `${probe}// head edit\n` });
  try {
    const other = join(setup.fixture, 'other');
    git(setup.repo, 'worktree', 'add', '--quiet', '--detach', other, 'main');
    const away = join(setup.fixture, 'other-away');
    renameSync(other, away);
    const result = compare(['--file', 'probe.test.js', '--pattern', 'steady probe', '--runs', '1', '--parallel', '2', '--base', 'main'], setup);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.deepEqual(worktreePaths(setup.repo), [setup.repo, other], 'the other worktree is still registered, and the base worktree is gone');
    renameSync(away, other);
    assert.equal(git(other, 'rev-parse', 'HEAD'), git(setup.repo, 'rev-parse', 'main'), 'the other worktree works again once its directory is back');
  } finally {
    rmSync(setup.fixture, { recursive: true, force: true });
  }
});
