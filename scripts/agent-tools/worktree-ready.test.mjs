import '../../tests/isolate-git-env.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Every case runs against a temporary repository, its worktrees and an
// explicit fixture ledger. Nothing here may reach the live host ledger.
const entrypoint = fileURLToPath(new URL('./worktree-ready.mjs', import.meta.url));

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

// A main checkout with an installed dependency, as the host's own checkout has.
function createFixture(prefix) {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const main = join(fixture, 'main');
  mkdirSync(main);
  git(main, 'init', '--quiet');
  git(main, 'checkout', '--quiet', '-b', 'main');
  git(main, 'config', 'user.name', 'Worktree Fixture');
  git(main, 'config', 'user.email', 'worktree-fixture@example.invalid');
  writeFileSync(join(main, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(main, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
  writeFileSync(join(main, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{}}\n');
  git(main, 'add', '.');
  git(main, 'commit', '--quiet', '-m', 'fixture baseline');
  mkdirSync(join(main, 'node_modules', 'fixture-dep'), { recursive: true });
  writeFileSync(join(main, 'node_modules', 'fixture-dep', 'index.js'), 'module.exports = "installed";\n');
  // Stands in for npm where a copy-on-write clone is unavailable (CI's Linux).
  const npm = join(fixture, 'fake-npm.mjs');
  writeFileSync(npm, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
if (process.argv[2] !== 'ci') process.exit(1);
mkdirSync('node_modules/fixture-dep', { recursive: true });
writeFileSync('node_modules/fixture-dep/index.js', 'module.exports = "installed";\\n');
`);
  chmodSync(npm, 0o755);
  const ledger = join(fixture, 'host-ledger.json');
  writeFileSync(ledger, `${JSON.stringify({ version: 1, scope: 'codex-wide', entries: [], reservations: [], configurations: [] }, null, 2)}\n`);
  return { fixture, main, npm, ledger };
}

function addWorktree(main, path, detachedAt) {
  if (detachedAt) git(main, 'worktree', 'add', '--quiet', '--detach', path, detachedAt);
  else git(main, 'worktree', 'add', '--quiet', '-b', `agent/${path.split('/').pop()}`, path);
  return path;
}

function run(args, cwd, { ledger, npm, environment = {} }) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '',
      CODEX_COORDINATION_FILE: ledger ?? '',
      DOW_EMULATOR_COORDINATION_FILE: '',
      CHAIN_WORKTREE_READY_NPM: npm,
      ...environment,
    },
  });
}

function loopbackPorts(entry) {
  return (entry?.resources ?? []).map((resource) => /^loopback:127\.0\.0\.1:(\d+)$/.exec(resource)?.[1]).filter(Boolean).map(Number);
}

function exportedPorts(stdout) {
  const value = (name) => Number(new RegExp(`^export ${name}=(\\d+)$`, 'm').exec(stdout)?.[1]);
  return [value('CHAIN_NATIVE_PORT'), value('CHAIN_NATIVE_SMOKE_PORT')];
}

function ownerOf(ledger, worktree) {
  return JSON.parse(readFileSync(ledger, 'utf8')).entries.filter((entry) => entry.worktree === worktree && entry.status === 'active');
}

test('prepare gives a new worktree its own dependencies and two exported ports, and a reviewer\'s detached worktree gets different ones', () => {
  const { fixture, main, npm, ledger } = createFixture('chain-worktree-ready-');
  try {
    const agent = addWorktree(main, join(fixture, 'agent-one'));
    const prepared = run(['prepare'], agent, { ledger, npm });
    assert.equal(prepared.status, 0, prepared.stderr);

    const dependencies = join(agent, 'node_modules');
    assert.equal(existsSync(join(dependencies, 'fixture-dep', 'index.js')), true, 'the worktree has its dependencies');
    assert.equal(lstatSync(dependencies).isSymbolicLink(), false, 'the worktree gets its own node_modules, never a link to the main install');
    assert.equal(readFileSync(join(dependencies, 'fixture-dep', 'index.js'), 'utf8'), 'module.exports = "installed";\n');
    rmSync(dependencies, { recursive: true, force: true });
    assert.equal(existsSync(join(main, 'node_modules', 'fixture-dep', 'index.js')), true, 'emptying the worktree install leaves the main install alone');

    const [owner] = ownerOf(ledger, agent);
    assert.ok(owner, 'the worktree is registered as an active ledger entry');
    const claimed = loopbackPorts(owner);
    assert.equal(claimed.length, 2, 'two loopback ports are claimed');
    assert.notEqual(claimed[0], claimed[1], 'the two ports are distinct');
    const exported = run(['env'], agent, { ledger, npm });
    assert.equal(exported.status, 0, exported.stderr);
    assert.deepEqual(exportedPorts(exported.stdout), claimed, 'CHAIN_NATIVE_PORT and CHAIN_NATIVE_SMOKE_PORT export the claimed ports');

    const reviewer = addWorktree(main, join(fixture, 'reviewer'), git(main, 'rev-parse', 'HEAD'));
    const branches = git(main, 'branch', '--list');
    const reviewed = run(['prepare'], reviewer, { ledger, npm });
    assert.equal(reviewed.status, 0, reviewed.stderr);
    const reviewerPorts = loopbackPorts(ownerOf(ledger, reviewer)[0]);
    assert.equal(reviewerPorts.length, 2, 'the detached reviewer worktree claims its own two ports');
    assert.equal(reviewerPorts.some((port) => claimed.includes(port)), false, 'no port is shared with the first worktree');
    assert.equal(git(main, 'branch', '--list'), branches, 'the reviewer needs no throwaway branch');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
