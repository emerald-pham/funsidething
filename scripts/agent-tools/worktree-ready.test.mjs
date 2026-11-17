import '../../tests/isolate-git-env.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

function activeEntries(ledger) {
  return JSON.parse(readFileSync(ledger, 'utf8')).entries.filter((entry) => entry.status === 'active');
}

function commitFile(cwd, name, body) {
  mkdirSync(dirname(join(cwd, name)), { recursive: true });
  writeFileSync(join(cwd, name), `${body}\n`);
  git(cwd, 'add', name);
  git(cwd, 'commit', '--quiet', '-m', body);
  return git(cwd, 'rev-parse', 'HEAD');
}

const coordinationClient = fileURLToPath(new URL('./coordination.mjs', import.meta.url));

function coordination(args, cwd, ledger) {
  return spawnSync(process.execPath, [coordinationClient, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, CODEX_COORDINATION_FILE: ledger, DOW_EMULATOR_COORDINATION_FILE: '' },
  });
}

// The recorder's opt-in qualification gate, run in a prepared worktree with no
// port variables in the shell, as an agent runs it.
function qualificationReadiness(worktree, ledger, evidenceRoot) {
  const recorder = fileURLToPath(new URL('./record-run.mjs', import.meta.url));
  const env = {
    ...process.env, CI: '', CODEX_COORDINATION_FILE: ledger, DOW_EMULATOR_COORDINATION_FILE: '', CHAIN_NATIVE_PORT: '', CHAIN_NATIVE_SMOKE_PORT: '',
    CHAIN_NATIVE_CANDIDATE_SHA: git(worktree, 'rev-parse', 'HEAD'), CHAIN_NATIVE_CANDIDATE_TREE: git(worktree, 'rev-parse', 'HEAD^{tree}'),
    CHAIN_NATIVE_OUTPUT: join(evidenceRoot, 'native-output'),
  };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [recorder, '--repo', worktree, '--evidence-dir', join(evidenceRoot, 'readiness-evidence'),
    '--purpose', 'green', '--qualification-readiness', '--summary', '--', process.execPath, '-e', '0'], { cwd: worktree, encoding: 'utf8', env });
  const summary = JSON.parse(result.stdout.trim().split('\n').pop() || '{}');
  return { status: result.status, errors: (summary.evidence?.errors ?? []).map((error) => error.message) };
}

test("prepare gives a new worktree its own dependencies and two exported ports, and a reviewer's detached worktree gets different ones", () => {
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

// The live host ledger held 452 entries (about 2 MB of status output) on
// 2026-11-16, past a child process's default 1 MB output buffer.
test('prepare claims ports from a host-sized ledger and reuses ports the worktree already holds', () => {
  const { fixture, main, npm, ledger } = createFixture('chain-worktree-ready-large-');
  try {
    const history = Array.from({ length: 3000 }, (_, index) => ({
      id: `history-${index}`, status: 'complete', worktree: join(fixture, `old-${index}`), intent: 'x'.repeat(600),
    }));
    writeFileSync(ledger, `${JSON.stringify({ version: 1, scope: 'codex-wide', entries: history, reservations: [], configurations: [] }, null, 2)}\n`);
    const agent = addWorktree(main, join(fixture, 'agent-large'));
    const prepared = run(['prepare'], agent, { ledger, npm });
    assert.equal(prepared.status, 0, prepared.stderr);
    const claimed = loopbackPorts(ownerOf(ledger, agent)[0]);
    assert.equal(claimed.length, 2, `two ports are claimed: ${prepared.stderr}`);
    const again = run(['prepare'], agent, { ledger, npm });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(ownerOf(ledger, agent).length, 1, 'a second prepare registers no second entry');
    assert.deepEqual(exportedPorts(run(['env'], agent, { ledger, npm }).stdout), claimed, 'it keeps exporting the ports it holds');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// Claude Code starts an agent on its own worktree branch, and the agent then
// works on its ticket branch. An entry left on the first branch let prune judge
// the wrong commit (PR #2413 B1).
test('prepare after a switch to a branch that holds the registration commit moves the same entry and ports to that branch', () => {
  const { fixture, main, npm, ledger } = createFixture('chain-worktree-ready-switch-');
  try {
    const agent = addWorktree(main, join(fixture, 'agent-switch'));
    assert.equal(run(['prepare'], agent, { ledger, npm }).status, 0);
    const [first] = ownerOf(ledger, agent);
    assert.equal(first.branchName, 'agent/agent-switch');
    git(agent, 'checkout', '--quiet', '-b', 'ticket/1-switch');
    writeFileSync(join(agent, 'work.md'), 'Ticket work.\n');
    git(agent, 'add', 'work.md');
    git(agent, 'commit', '--quiet', '-m', 'ticket work');

    const again = run(['prepare'], agent, { ledger, npm });
    assert.equal(again.status, 0, again.stderr);
    const owners = ownerOf(ledger, agent);
    assert.equal(owners.length, 1, 'no second entry is registered');
    assert.equal(owners[0].id, first.id, 'the same entry is kept');
    assert.equal(owners[0].branchName, 'ticket/1-switch', 'the entry now records the work branch');
    assert.equal(owners[0].startBranchSha, first.startBranchSha, 'the registration commit is kept');
    assert.deepEqual(loopbackPorts(owners[0]), loopbackPorts(first), 'the worktree keeps its ports');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// Invariant 1, one live worktree has one active entry (PR #2413 B3 and R2-B1,
// probes R4 and R2-B1): an entry recorded with this checkout's worktree identity
// is its own whatever the checkout's history. Taking it for an earlier
// worktree's when the checkout lacked its start commit registered a second entry
// with two more ports, and qualification readiness there refused.
test("prepare after a reset or a switch to history without the registration commit keeps the worktree's one entry and its ports, and qualification readiness passes", () => {
  const { fixture, main, npm, ledger } = createFixture('chain-worktree-ready-history-');
  try {
    git(main, 'checkout', '--quiet', '-b', 'side');
    commitFile(main, 'side.md', 'A commit main lacks.');
    git(main, 'checkout', '--quiet', 'main');
    const cases = [
      // R4: the work branch is reset below the commit it was registered at.
      { name: 'reset', branch: 'ticket/4-reset', after: 'ticket/4-reset', leave: (agent) => git(agent, 'reset', '--quiet', '--hard', 'HEAD~1') },
      // R2-B1: prepared on Claude Code's branch, then a work branch cut from main.
      { name: 'switch', branch: 'worktree-agent-switch', after: 'ticket/1-switch', leave: (agent) => git(agent, 'checkout', '--quiet', '-b', 'ticket/1-switch', 'main') },
    ];
    for (const { name, branch, after, leave } of cases) {
      const agent = join(fixture, `agent-${name}`);
      git(main, 'worktree', 'add', '--quiet', '-b', branch, agent, 'side');
      assert.equal(run(['prepare'], agent, { ledger, npm }).status, 0);
      const [first] = ownerOf(ledger, agent);
      leave(agent);
      assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', first.startBranchSha, 'HEAD'], { cwd: agent }).status, 1,
        `${name}: the checkout no longer holds the registration commit`);

      const again = run(['prepare'], agent, { ledger, npm });
      assert.equal(again.status, 0, again.stderr);
      const owners = ownerOf(ledger, agent);
      assert.equal(owners.length, 1, `${name}: the live worktree keeps one active entry`);
      assert.equal(owners[0].id, first.id, `${name}: it is the same entry`);
      assert.equal(owners[0].branchName, after, `${name}: on the checkout's branch`);
      assert.deepEqual(loopbackPorts(owners[0]), loopbackPorts(first), `${name}: with the same two ports`);
      const duplicate = coordination(['begin', '--work-type', 'tooling', '--intent', `Duplicate ${name}`], agent, ledger);
      assert.notEqual(duplicate.status, 0, `${name}: begin registers no second entry for the worktree`);
      assert.match(duplicate.stderr, /already exists for the same Git worktree/);
      const readiness = qualificationReadiness(agent, ledger, join(fixture, `evidence-${name}`));
      assert.deepEqual(readiness.errors, [], `${name}: qualification readiness finds the worktree's one entry`);
      assert.equal(readiness.status, 0);
    }
    const active = activeEntries(ledger);
    assert.equal(active.length, 2, 'one active entry per live worktree');
    assert.equal(new Set(active.flatMap(loopbackPorts)).size, 4, 'two ports each, and no more');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// A new worktree at a removed one's path, before any prune ran, took over the
// old entry with its branch and start commit (PR #2413 B1, probe S4).
test("prepare in a new worktree at a removed worktree's path registers its own entry instead of adopting the old one", () => {
  const { fixture, main, npm, ledger } = createFixture('chain-worktree-ready-reuse-');
  try {
    const path = join(fixture, 'agent-reused');
    addWorktree(main, path);
    assert.equal(run(['prepare'], path, { ledger, npm }).status, 0);
    const [old] = ownerOf(ledger, path);
    git(main, 'worktree', 'remove', '--force', path);
    git(main, 'worktree', 'add', '--quiet', '-b', 'agent/second', path, 'main');

    const prepared = run(['prepare'], path, { ledger, npm });
    assert.equal(prepared.status, 0, prepared.stderr);
    const owners = ownerOf(ledger, path);
    assert.equal(owners.length, 1, `one active entry for the path: ${prepared.stderr}`);
    assert.notEqual(owners[0].id, old.id, 'the old entry is not adopted');
    assert.equal(owners[0].branchName, 'agent/second');
    assert.equal(loopbackPorts(owners[0]).length, 2, 'the new worktree gets its own ports');
    const previous = JSON.parse(readFileSync(ledger, 'utf8')).entries.find((entry) => entry.id === old.id);
    assert.equal(previous.status, 'complete', 'the earlier worktree had no work, so its entry is finished');
    assert.equal(previous.outcome, 'discarded');
    assert.equal(previous.finalBranchName, 'agent/agent-reused', 'it keeps its own branch');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// A finished entry's ports go back to the pool, so plain test runs in the
// still-existing worktree must stop reading them (PR #2413 N5).
test('finish in a prepared worktree that still exists removes its prepared ports', () => {
  const { fixture, main, npm, ledger } = createFixture('chain-worktree-ready-finish-');
  try {
    git(fixture, 'init', '--bare', '--quiet', join(fixture, 'origin.git'));
    git(main, 'remote', 'add', 'origin', join(fixture, 'origin.git'));
    // Finish uses the checkout's own ports module, as every Chain Scanner checkout has.
    mkdirSync(join(main, 'scripts', 'agent-tools'), { recursive: true });
    copyFileSync(fileURLToPath(new URL('./worktree-ports.mjs', import.meta.url)), join(main, 'scripts', 'agent-tools', 'worktree-ports.mjs'));
    git(main, 'add', 'scripts');
    git(main, 'commit', '--quiet', '-m', 'install the ports module');
    git(main, 'push', '--quiet', '-u', 'origin', 'main');
    const agent = addWorktree(main, join(fixture, 'agent-finished'));
    assert.equal(run(['prepare'], agent, { ledger, npm }).status, 0);
    assert.match(run(['env'], agent, { ledger, npm }).stdout, /CHAIN_NATIVE_PORT/);
    const [owner] = ownerOf(ledger, agent);

    const coordinationClient = fileURLToPath(new URL('./coordination.mjs', import.meta.url));
    const finished = spawnSync(process.execPath, [coordinationClient, 'finish', '--id', owner.id, '--adapter', 'chain-scanner',
      '--outcome', 'discarded', '--reason', 'Fixture work dropped.'],
    { cwd: agent, encoding: 'utf8', env: { ...process.env, CODEX_COORDINATION_FILE: ledger, DOW_EMULATOR_COORDINATION_FILE: '' } });
    assert.equal(finished.status, 0, finished.stderr);

    const exported = run(['env'], agent, { ledger, npm });
    assert.doesNotMatch(exported.stdout, /CHAIN_NATIVE/, 'no ports are exported after finish');
    assert.equal(existsSync(join(git(agent, 'rev-parse', '--absolute-git-dir'), 'chain-worktree-ports.env')), false, 'the ports file is gone');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('without a usable ledger, prepare still makes dependencies available, warns which step it skipped and writes no ledger', () => {
  const { fixture, main, npm, ledger } = createFixture('chain-worktree-ready-unusable-');
  try {
    const other = join(fixture, 'other-ledger.json');
    writeFileSync(other, readFileSync(ledger));
    const before = readFileSync(ledger, 'utf8');
    const missing = join(fixture, 'missing', 'host-ledger.json');
    const cases = [
      { name: 'unset', ledger: '' },
      { name: 'missing', ledger: missing },
      { name: 'conflicting', ledger, environment: { DOW_EMULATOR_COORDINATION_FILE: other } },
    ];
    for (const { name, ledger: configured, environment } of cases) {
      const agent = addWorktree(main, join(fixture, `agent-${name}`));
      const prepared = run(['prepare'], agent, { ledger: configured, npm, environment });
      assert.equal(prepared.status, 0, `${name}: setup never fails the worktree: ${prepared.stderr}`);
      assert.match(prepared.stderr, /skipped ports/i, `${name}: says it skipped the ports`);
      assert.equal(existsSync(join(agent, 'node_modules', 'fixture-dep', 'index.js')), true, `${name}: dependencies are still available`);
      assert.doesNotMatch(run(['env'], agent, { ledger: configured, npm, environment }).stdout, /CHAIN_NATIVE/, `${name}: no ports are exported`);
    }
    assert.equal(readFileSync(ledger, 'utf8'), before, 'the configured ledger is untouched');
    assert.equal(readFileSync(other, 'utf8'), before, 'the conflicting ledger is untouched');
    assert.equal(existsSync(missing), false, 'no ledger is created where one is missing');

    const inMain = run(['prepare'], main, { ledger, npm });
    assert.equal(inMain.status, 0, inMain.stderr);
    assert.match(inMain.stdout, /main checkout/i, 'the main checkout is skipped cleanly');
    const inCI = run(['prepare'], addWorktree(main, join(fixture, 'agent-ci')), { ledger, npm, environment: { CI: 'true' } });
    assert.equal(inCI.status, 0, inCI.stderr);
    assert.equal(readFileSync(ledger, 'utf8'), before, 'neither the main checkout nor a CI run registers anything');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// Subagent shells keep no environment between commands, so the test-run
// recorder, which every RED and GREEN goes through, reads the prepared ports.
test('a test command run through the recorder in a prepared worktree gets its ports, unless the shell set its own', () => {
  const { fixture, main, npm, ledger } = createFixture('chain-worktree-ready-recorder-');
  try {
    const agent = addWorktree(main, join(fixture, 'agent-recorded'));
    assert.equal(run(['prepare'], agent, { ledger, npm }).status, 0);
    const claimed = loopbackPorts(ownerOf(ledger, agent)[0]);
    const recorder = fileURLToPath(new URL('./record-run.mjs', import.meta.url));
    const record = (environment) => {
      const env = { ...process.env, CI: '', CHAIN_NATIVE_PORT: '', CHAIN_NATIVE_SMOKE_PORT: '', ...environment };
      delete env.NODE_TEST_CONTEXT;
      return spawnSync(process.execPath, [recorder, '--repo', agent, '--evidence-dir', join(fixture, 'evidence'), '--purpose', 'green', '--',
        process.execPath, '-e', 'console.log(`ports ${process.env.CHAIN_NATIVE_PORT} ${process.env.CHAIN_NATIVE_SMOKE_PORT}`)'],
      { cwd: agent, encoding: 'utf8', env });
    };
    const prepared = record({});
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.match(prepared.stdout, new RegExp(`^ports ${claimed[0]} ${claimed[1]}$`, 'm'), 'the child sees the claimed ports');
    const explicit = record({ CHAIN_NATIVE_PORT: '47081', CHAIN_NATIVE_SMOKE_PORT: '47082' });
    assert.match(explicit.stdout, /^ports 47081 47082$/m, 'ports the shell set explicitly win');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// `npm run test:group` and `node --test` don't go through the recorder, and a
// subagent shell has no port variables, so the suite's shared setup reads the
// prepared ports itself under the recorder's rule (#2364, spec a1).
test('a plain test run in a prepared worktree gets its ports from the suite setup, unless the shell set its own or CI is true', () => {
  const { fixture, main, npm, ledger } = createFixture('chain-worktree-ready-suite-');
  try {
    const agent = addWorktree(main, join(fixture, 'agent-suite'));
    assert.equal(run(['prepare'], agent, { ledger, npm }).status, 0);
    const claimed = loopbackPorts(ownerOf(ledger, agent)[0]);
    const suiteSetup = new URL('../../tests/shared.js', import.meta.url).href;
    const plainRun = (environment) => {
      const env = { ...process.env, CI: '', CHAIN_NATIVE_PORT: '', CHAIN_NATIVE_SMOKE_PORT: '', ...environment };
      delete env.NODE_TEST_CONTEXT;
      return spawnSync(process.execPath, ['--input-type=module', '-e',
        `await import(${JSON.stringify(suiteSetup)}); console.log(\`ports \${process.env.CHAIN_NATIVE_PORT} \${process.env.CHAIN_NATIVE_SMOKE_PORT}\`);`],
      { cwd: agent, encoding: 'utf8', env });
    };
    const prepared = plainRun({});
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.match(prepared.stdout, new RegExp(`^ports ${claimed[0]} ${claimed[1]}$`, 'm'), 'the suite sees the claimed ports');
    assert.match(plainRun({ CHAIN_NATIVE_PORT: '47081', CHAIN_NATIVE_SMOKE_PORT: '47082' }).stdout, /^ports 47081 47082$/m,
      'ports the shell set explicitly win');
    assert.match(plainRun({ CI: 'true' }).stdout, /^ports {2}$/m, 'CI never reads prepared ports');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// Claude Code removes an unchanged subagent worktree itself and runs no
// WorktreeRemove hook for it, and the coordinator removes the rest directly.
// So claims are freed by sweeping entries whose worktree is gone (#2368).
test("prune frees the entries and ports of removed worktrees and leaves live, parked, hand-made and other repositories' entries alone", () => {
  const { fixture, main, npm, ledger } = createFixture('chain-worktree-ready-prune-');
  try {
    const removed = addWorktree(main, join(fixture, 'agent-removed'));
    const live = addWorktree(main, join(fixture, 'agent-live'));
    for (const worktree of [removed, live]) assert.equal(run(['prepare'], worktree, { ledger, npm }).status, 0);
    const state = JSON.parse(readFileSync(ledger, 'utf8'));
    const identity = state.entries[0].repositoryIdentity;
    const gone = (name) => join(fixture, name);
    const kept = [
      { id: 'parked-gone', status: 'parked', registeredBy: 'worktree-ready', repositoryIdentity: identity, worktree: gone('parked-gone'), resources: ['loopback:127.0.0.1:42901'] },
      { id: 'other-repository', status: 'active', registeredBy: 'worktree-ready', repositoryIdentity: join(fixture, 'other', '.git'), worktree: gone('other-gone'), resources: ['loopback:127.0.0.1:42902'] },
      { id: 'hand-made', status: 'active', repositoryIdentity: identity, worktree: gone('hand-made-gone'), resources: ['loopback:127.0.0.1:42903'] },
    ];
    state.entries.push(...kept);
    writeFileSync(ledger, `${JSON.stringify(state, null, 2)}\n`);
    const removedPorts = loopbackPorts(ownerOf(ledger, removed)[0]);
    const livePorts = loopbackPorts(ownerOf(ledger, live)[0]);
    git(main, 'worktree', 'remove', '--force', removed);

    const pruned = run(['prune'], main, { ledger, npm });
    assert.equal(pruned.status, 0, pruned.stderr);
    const after = JSON.parse(readFileSync(ledger, 'utf8')).entries;
    const removedEntry = after.find((entry) => entry.worktree === removed);
    assert.equal(removedEntry.status, 'complete', 'the removed worktree\'s entry is finished');
    assert.deepEqual(loopbackPorts(removedEntry), [], 'its ports are released');
    assert.equal(removedPorts.length, 2);
    assert.deepEqual(loopbackPorts(ownerOf(ledger, live)[0]), livePorts, 'a live worktree keeps its entry and ports');
    for (const entry of kept) assert.deepEqual(after.find((candidate) => candidate.id === entry.id), entry, `${entry.id} is untouched`);

    git(main, 'worktree', 'remove', '--force', live);
    assert.equal(run(['prepare'], addWorktree(main, join(fixture, 'agent-next')), { ledger, npm }).status, 0);
    assert.equal(JSON.parse(readFileSync(ledger, 'utf8')).entries.find((entry) => entry.worktree === live).status, 'complete',
      'preparing a new worktree also frees the entries of removed ones');

    const before = readFileSync(ledger, 'utf8');
    const unconfigured = run(['prune'], main, { ledger: '', npm });
    assert.equal(unconfigured.status, 0, unconfigured.stderr);
    assert.match(unconfigured.stderr, /skipped prune/i);
    assert.equal(readFileSync(ledger, 'utf8'), before, 'with no configured ledger nothing is written');

    const missing = join(fixture, 'missing', 'host-ledger.json');
    const other = join(fixture, 'other-ledger.json');
    writeFileSync(other, before);
    git(main, 'worktree', 'remove', '--force', join(fixture, 'agent-next'));
    for (const { name, configured, environment } of [
      { name: 'missing', configured: missing },
      { name: 'conflicting', configured: ledger, environment: { DOW_EMULATOR_COORDINATION_FILE: other } },
    ]) {
      const skipped = run(['prune'], main, { ledger: configured, npm, environment });
      assert.equal(skipped.status, 0, `${name}: ${skipped.stderr}`);
      assert.match(skipped.stderr, /skipped prune/i, `${name}: says it skipped the prune`);
    }
    assert.equal(existsSync(join(fixture, 'missing')), false, 'no ledger, lock or directory is created where the ledger is missing');
    assert.equal(readFileSync(ledger, 'utf8'), before, 'a conflicting configuration writes nothing to the configured ledger');
    assert.equal(readFileSync(other, 'utf8'), before, 'nor to the conflicting one');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
