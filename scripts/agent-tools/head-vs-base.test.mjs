import '../../tests/isolate-git-env.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
