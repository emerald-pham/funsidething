import '../../tests/isolate-git-env.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Every case runs the setup command against a temporary repository and an
// explicit fixture ledger. The live host ledger must never be read or written
// here, so each run overrides both ledger variables (#2364).
const entrypoint = fileURLToPath(new URL('./worktree-setup.mjs', import.meta.url));
const coordinationEntrypoint = fileURLToPath(new URL('./coordination.mjs', import.meta.url));
const repositoryGitignore = fileURLToPath(new URL('../../.gitignore', import.meta.url));
const repositorySettings = fileURLToPath(new URL('../../.claude/settings.json', import.meta.url));
const LOOPBACK = /^loopback:127\.0\.0\.1:(\d+)$/;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function portIsFree(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once('error', () => resolvePort(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolvePort(true)));
  });
}

// A four-port range: two worktrees fill it, so a second worktree only gets
// ports when the first one's ledger claims are honoured, and a third one only
// after a removal released them.
async function freePortRange() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const start = 40000 + Math.floor(Math.random() * 8000);
    const ports = [start, start + 1, start + 2, start + 3];
    if ((await Promise.all(ports.map(portIsFree))).every(Boolean)) return ports;
  }
  throw new Error('No free block of four loopback ports for the fixture.');
}

const LOCKFILE = `${JSON.stringify({
  name: 'worktree-fixture',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'worktree-fixture', dependencies: { 'fixture-dep': 'file:vendor/fixture-dep' } },
    'node_modules/fixture-dep': { resolved: 'vendor/fixture-dep', link: true },
    'vendor/fixture-dep': { name: 'fixture-dep', version: '1.0.0' },
  },
}, null, 2)}\n`;

function writePackage(directory, value) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ name: 'fixture-dep', version: '1.0.0', type: 'module', main: 'index.js' })}\n`);
  writeFileSync(join(directory, 'index.js'), `export const value = ${JSON.stringify(value)};\n`);
}

async function createFixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'chain-worktree-setup-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const client = join(home, '.local', 'bin', 'chain-coordination.mjs');
  const installed = spawnSync(process.execPath, [coordinationEntrypoint, 'install', '--to', client], { cwd: root, encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stderr);
  const ledger = join(root, 'host', 'coordination.json');
  mkdirSync(join(root, 'host'));
  writeFileSync(ledger, `${JSON.stringify({ version: 1, scope: 'codex-wide', entries: [], reservations: [], configurations: [] }, null, 2)}\n`);

  const origin = join(root, 'origin.git');
  git(root, 'init', '--bare', '--quiet', origin);
  const main = join(root, 'project');
  mkdirSync(main);
  git(main, 'init', '--quiet');
  git(main, 'checkout', '--quiet', '-b', 'main');
  git(main, 'config', 'user.name', 'Worktree Fixture');
  git(main, 'config', 'user.email', 'worktree-fixture@example.invalid');
  copyFileSync(repositoryGitignore, join(main, '.gitignore'));
  writeFileSync(join(main, 'package.json'), `${JSON.stringify({ name: 'worktree-fixture', private: true, dependencies: { 'fixture-dep': 'file:vendor/fixture-dep' } }, null, 2)}\n`);
  writeFileSync(join(main, 'package-lock.json'), LOCKFILE);
  writePackage(join(main, 'vendor', 'fixture-dep'), 'installed-in-worktree');
  git(main, 'add', '.');
  git(main, 'commit', '--quiet', '-m', 'fixture baseline');
  git(main, 'remote', 'add', 'origin', origin);
  git(main, 'push', '--quiet', '--set-upstream', 'origin', 'main');
  // The main checkout's installed dependencies, which a matching worktree links.
  writePackage(join(main, 'node_modules', 'fixture-dep'), 'linked-from-main');
  const ports = await freePortRange();
  return { root, home, client, ledger, main, ports };
}

function hookEnvironment(fixture, extra = {}) {
  return {
    ...process.env,
    HOME: fixture.home,
    CODEX_COORDINATION_FILE: fixture.ledger,
    DOW_EMULATOR_COORDINATION_FILE: '',
    CI: '',
    GITHUB_ACTIONS: '',
    CLAUDE_ENV_FILE: '',
    CHAIN_WORKTREE_PORT_RANGE: `${fixture.ports[0]}-${fixture.ports[3]}`,
    npm_config_offline: 'true',
    ...extra,
  };
}

function runHook(fixture, command, input, { cwd = fixture.main, env = {} } = {}) {
  return spawnSync(process.execPath, [entrypoint, command], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: hookEnvironment(fixture, env),
  });
}

function createWorktree(fixture, name) {
  const result = runHook(fixture, 'create', { session_id: 'fixture', hook_event_name: 'WorktreeCreate', cwd: fixture.main, name });
  assert.equal(result.status, 0, `create ${name} failed: ${result.stderr}`);
  const lines = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.at(-1);
}

function ledgerEntry(fixture, worktree) {
  const state = JSON.parse(readFileSync(fixture.ledger, 'utf8'));
  const entries = state.entries.filter((entry) => entry.worktree === worktree);
  assert.equal(entries.length, 1, `exactly one ledger entry for ${worktree}`);
  return entries[0];
}

function claimedPorts(entry) {
  return (entry.resources ?? []).flatMap((resource) => LOOPBACK.exec(resource) ? [Number(LOOPBACK.exec(resource)[1])] : []);
}

function shellPorts(directory) {
  const result = spawnSync('bash', ['-c', 'set -a; . ./.chain-worktree.env; printf "%s %s" "$CHAIN_NATIVE_PORT" "$CHAIN_NATIVE_SMOKE_PORT"'], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split(' ').map(Number);
}

test('worktree setup creates a test-ready worktree with linked dependencies and two claimed, exported ports', async (t) => {
  const fixture = await createFixture(t);
  const worktree = createWorktree(fixture, 'alpha');

  assert.equal(worktree, join(fixture.main, '.claude', 'worktrees', 'alpha'), 'the hook prints the new worktree path last');
  assert.equal(git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), 'worktree-alpha');
  assert.equal(git(worktree, 'rev-parse', '--show-toplevel'), worktree);

  const dependency = spawnSync(process.execPath, ['--input-type=module', '-e', "const m = await import('fixture-dep'); process.stdout.write(m.value);"], { cwd: worktree, encoding: 'utf8' });
  assert.equal(dependency.status, 0, dependency.stderr);
  assert.equal(dependency.stdout, 'linked-from-main', 'a matching lockfile links the main checkout dependencies');

  const entry = ledgerEntry(fixture, worktree);
  assert.equal(entry.status, 'active');
  assert.equal(entry.branchName, 'worktree-alpha');
  const ports = claimedPorts(entry);
  assert.equal(ports.length, 2, 'two loopback resources are claimed');
  assert.notEqual(ports[0], ports[1], 'the two ports are distinct');
  for (const port of ports) assert.ok(fixture.ports.includes(port), `port ${port} comes from the configured range`);

  assert.deepEqual(shellPorts(worktree), ports, 'CHAIN_NATIVE_PORT and CHAIN_NATIVE_SMOKE_PORT export the claimed ports');
  assert.equal(git(worktree, 'status', '--porcelain', '--untracked-files=all'), '', 'setup leaves the new worktree clean');
});

test('worktree setup gives a second worktree ports that no other worktree holds', async (t) => {
  const fixture = await createFixture(t);
  const first = createWorktree(fixture, 'alpha');
  const second = createWorktree(fixture, 'beta');

  const firstPorts = claimedPorts(ledgerEntry(fixture, first));
  const secondPorts = claimedPorts(ledgerEntry(fixture, second));
  assert.equal(secondPorts.length, 2);
  assert.notEqual(secondPorts[0], secondPorts[1]);
  assert.deepEqual([...firstPorts, ...secondPorts].sort(), [...fixture.ports].sort(),
    'the second worktree takes the two ports of the range the first does not hold');
  assert.deepEqual(shellPorts(second), secondPorts);
});

test('removing a worktree releases its ports, finishes its entry and keeps the main checkout dependencies', async (t) => {
  const fixture = await createFixture(t);
  const first = createWorktree(fixture, 'alpha');
  const second = createWorktree(fixture, 'beta');
  const firstPorts = claimedPorts(ledgerEntry(fixture, first));
  const secondPorts = claimedPorts(ledgerEntry(fixture, second));

  const removed = runHook(fixture, 'remove', { session_id: 'fixture', hook_event_name: 'WorktreeRemove', cwd: fixture.main, worktree_path: first });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(existsSync(first), false, 'the worktree directory is gone');
  assert.equal(git(fixture.main, 'branch', '--list', 'worktree-alpha'), '', 'a branch with no new commits is deleted with its worktree');
  assert.equal(readFileSync(join(fixture.main, 'node_modules', 'fixture-dep', 'index.js'), 'utf8'), 'export const value = "linked-from-main";\n',
    'removing the linked worktree leaves the main checkout install intact');

  const released = ledgerEntry(fixture, first);
  assert.deepEqual(claimedPorts(released), [], 'the removed worktree holds no loopback ports');
  assert.equal(released.status, 'complete', 'the removed worktree no longer owns a ledger entry');
  assert.deepEqual(claimedPorts(ledgerEntry(fixture, second)), secondPorts, 'the other worktree keeps its ports');

  const third = createWorktree(fixture, 'gamma');
  assert.deepEqual(claimedPorts(ledgerEntry(fixture, third)).sort(), [...firstPorts].sort(), 'a new worktree can take the released ports');
});

test('worktree setup installs dependencies when the main checkout lockfile differs', async (t) => {
  const fixture = await createFixture(t);
  // The main checkout's install no longer matches the committed lockfile the
  // new worktree checks out, so linking it would hand over the wrong tree.
  writeFileSync(join(fixture.main, 'package-lock.json'), `${LOCKFILE}\n`);
  const worktree = createWorktree(fixture, 'alpha');

  const dependency = spawnSync(process.execPath, ['--input-type=module', '-e', "const m = await import('fixture-dep'); process.stdout.write(m.value);"], { cwd: worktree, encoding: 'utf8' });
  assert.equal(dependency.status, 0, dependency.stderr);
  assert.equal(dependency.stdout, 'installed-in-worktree', 'the worktree installs from its own lockfile');
  assert.equal(lstatSync(join(worktree, 'node_modules')).isSymbolicLink(), false, 'node_modules is the worktree\'s own install');
  assert.equal(git(worktree, 'status', '--porcelain', '--untracked-files=all'), '', 'the install leaves the worktree clean');
  assert.equal(claimedPorts(ledgerEntry(fixture, worktree)).length, 2);
});

test('a worktree setup that cannot claim ports keeps the worktree without ports, closes its entry and keeps other claims', async (t) => {
  const fixture = await createFixture(t);
  const first = createWorktree(fixture, 'alpha');
  const second = createWorktree(fixture, 'beta');
  const held = [...claimedPorts(ledgerEntry(fixture, first)), ...claimedPorts(ledgerEntry(fixture, second))].sort();

  // The range is full. Setup still always makes the worktree (#2364 owner
  // decision, 2026-11-14); only the ports are skipped.
  const result = runHook(fixture, 'create', { cwd: fixture.main, name: 'gamma' });
  const gamma = join(fixture.main, '.claude', 'worktrees', 'gamma');
  assert.equal(result.status, 0, `create succeeds: ${result.stderr}`);
  assert.equal(result.stdout.trim().split('\n').at(-1), gamma, 'the worktree path is the last stdout line');
  assert.equal(git(gamma, 'rev-parse', '--abbrev-ref', 'HEAD'), 'worktree-gamma');
  const warnings = warningLines(result.stderr);
  assert.equal(warnings.length, 1, `exactly one warning line: ${result.stderr}`);
  assert.match(warnings[0], /no ports claimed.*No two loopback ports/, 'the warning names the reason');
  assert.equal(existsSync(join(gamma, '.chain-worktree.env')), false, 'no env file without claimed ports');
  const state = JSON.parse(readFileSync(fixture.ledger, 'utf8'));
  assert.deepEqual(state.entries.filter((entry) => entry.worktree === gamma && entry.status !== 'complete'), [], 'the partial entry no longer owns anything');
  assert.deepEqual([...claimedPorts(ledgerEntry(fixture, first)), ...claimedPorts(ledgerEntry(fixture, second))].sort(), held, 'existing claims are untouched');
});

// The ways the hook can find no usable ledger. Each still gets a worktree
// (#2364 owner decision, 2026-11-14): the Claude app does not inherit
// CODEX_COORDINATION_FILE from a shell profile, and refusing there blocked
// every agent worktree on the host. `unset ledger` is that incident: no ledger
// variable, so the client discovers the legacy temporary default, which TMPDIR
// keeps inside the fixture.
function unusableLedgerCases(fixture) {
  const missing = join(fixture.root, 'host', 'missing-coordination.json');
  const other = join(fixture.root, 'other-host', 'coordination.json');
  const temporary = join(fixture.root, 'tmp');
  mkdirSync(temporary, { recursive: true });
  const ledgerFix = /CODEX_COORDINATION_FILE.*\.claude\/settings\.local\.json/;
  return {
    secondLedgers: [missing, other, join(temporary, 'den-of-wolves-new-eden-coordination.json')],
    cases: [
      { label: 'unset ledger', env: { CODEX_COORDINATION_FILE: '', TMPDIR: temporary }, reason: /den-of-wolves-new-eden-coordination\.json does not exist/, fix: ledgerFix },
      { label: 'missing ledger', env: { CODEX_COORDINATION_FILE: missing }, reason: /missing-coordination\.json does not exist/, fix: ledgerFix },
      { label: 'conflicting ledger', env: { DOW_EMULATOR_COORDINATION_FILE: other }, reason: /Conflicting coordination paths/, fix: ledgerFix },
      { label: 'missing client', env: { HOME: join(fixture.root, 'empty-home') }, reason: /coordination client is not installed/, fix: /coordination\.mjs install/ },
      { label: 'CI', env: { CI: 'true' }, reason: /CI is set/, fix: /local agent worktrees/ },
    ],
  };
}

function warningLines(stderr) {
  return stderr.split('\n').filter((line) => /^worktree-setup: warning:/.test(line));
}

test('worktree setup without a usable ledger still creates a test-ready worktree, warns once and claims nothing', async (t) => {
  const fixture = await createFixture(t);
  const { cases, secondLedgers } = unusableLedgerCases(fixture);
  const ledgerBefore = readFileSync(fixture.ledger, 'utf8');
  const sessionEnvironment = join(fixture.root, 'claude-session-env.sh');
  writeFileSync(sessionEnvironment, '');
  for (const { label, env, reason, fix } of cases) {
    const name = `portless-${label.replaceAll(' ', '-').toLowerCase()}`;
    const expected = join(fixture.main, '.claude', 'worktrees', name);
    const result = runHook(fixture, 'create', { cwd: fixture.main, name }, { env });
    assert.equal(result.status, 0, `${label}: create succeeds: ${result.stderr}`);
    assert.equal(result.stdout.trim().split('\n').at(-1), expected, `${label}: the worktree path is the last stdout line`);
    assert.equal(git(expected, 'rev-parse', '--abbrev-ref', 'HEAD'), `worktree-${name}`, `${label}: the worktree is on its new branch`);

    const dependency = spawnSync(process.execPath, ['--input-type=module', '-e', "const m = await import('fixture-dep'); process.stdout.write(m.value);"], { cwd: expected, encoding: 'utf8' });
    assert.equal(dependency.status, 0, `${label}: ${dependency.stderr}`);
    assert.equal(dependency.stdout, 'linked-from-main', `${label}: dependencies are available`);

    const warnings = warningLines(result.stderr);
    assert.equal(warnings.length, 1, `${label}: exactly one warning line: ${result.stderr}`);
    assert.match(warnings[0], reason, `${label}: the warning names the reason`);
    assert.match(warnings[0], fix, `${label}: the warning names the fix`);
    assert.match(warnings[0], /no ports/i, `${label}: the warning says no ports were claimed`);

    assert.equal(existsSync(join(expected, '.chain-worktree.env')), false, `${label}: no env file without claimed ports`);
    assert.equal(git(expected, 'status', '--porcelain', '--untracked-files=all'), '', `${label}: the worktree is clean`);
    assert.equal(readFileSync(fixture.ledger, 'utf8'), ledgerBefore, `${label}: the fixture ledger is unchanged`);
    for (const second of secondLedgers) assert.equal(existsSync(second), false, `${label}: no other ledger is created at ${second}`);

    // SessionStart touches no ledger, and its loader exports nothing where
    // there is no env file.
    const started = runHook(fixture, 'session-start', { hook_event_name: 'SessionStart', cwd: expected, source: 'startup' },
      { env: { ...env, CLAUDE_ENV_FILE: sessionEnvironment } });
    assert.equal(started.status, 0, `${label}: session-start succeeds: ${started.stderr}`);
    const shell = spawnSync('bash', ['-c', '. "$SESSION_ENV"; printf "%s|%s" "$CHAIN_NATIVE_PORT" "$CHAIN_NATIVE_SMOKE_PORT"'],
      { cwd: expected, encoding: 'utf8', env: { ...process.env, SESSION_ENV: sessionEnvironment, CHAIN_NATIVE_PORT: '', CHAIN_NATIVE_SMOKE_PORT: '' } });
    assert.equal(shell.status, 0, `${label}: a shell command in the portless worktree runs: ${shell.stderr}`);
    assert.equal(shell.stdout, '|', `${label}: the loader exports no ports there`);
  }
});

test('removing a worktree without a usable ledger still removes the checkout, keeps unlanded work and leaves the ledger alone', async (t) => {
  const fixture = await createFixture(t);
  const { cases, secondLedgers } = unusableLedgerCases(fixture);
  // A worktree that claimed ports while the ledger was usable, with a commit
  // that exists only on its branch.
  const claimed = createWorktree(fixture, 'alpha');
  writeFileSync(join(claimed, 'work.txt'), 'unlanded\n');
  git(claimed, 'add', 'work.txt');
  git(claimed, 'commit', '--quiet', '-m', 'unlanded work');
  const unlanded = git(claimed, 'rev-parse', 'HEAD');
  for (const { label, env } of cases) runHook(fixture, 'create', { cwd: fixture.main, name: `portless-${label.replaceAll(' ', '-').toLowerCase()}` }, { env });
  const ledgerBefore = readFileSync(fixture.ledger, 'utf8');

  for (const { label, env, reason } of cases) {
    const worktree = join(fixture.main, '.claude', 'worktrees', `portless-${label.replaceAll(' ', '-').toLowerCase()}`);
    assert.equal(existsSync(worktree), true, `${label}: the fixture worktree exists`);
    const result = runHook(fixture, 'remove', { cwd: fixture.main, worktree_path: worktree }, { env });
    assert.equal(result.status, 0, `${label}: remove succeeds: ${result.stderr}`);
    assert.equal(existsSync(worktree), false, `${label}: the checkout is removed`);
    const warnings = warningLines(result.stderr);
    assert.equal(warnings.length, 1, `${label}: exactly one warning line: ${result.stderr}`);
    assert.match(warnings[0], reason, `${label}: the warning names the reason`);
    assert.match(warnings[0], /no claims released/i, `${label}: the warning says nothing was released`);
    assert.equal(readFileSync(fixture.ledger, 'utf8'), ledgerBefore, `${label}: the fixture ledger is unchanged`);
    for (const second of secondLedgers) assert.equal(existsSync(second), false, `${label}: no other ledger is created at ${second}`);
  }

  const { env } = cases.find(({ label }) => label === 'missing ledger');
  const result = runHook(fixture, 'remove', { cwd: fixture.main, worktree_path: claimed }, { env });
  assert.equal(result.status, 0, `removing a worktree with claims succeeds without the ledger: ${result.stderr}`);
  assert.equal(existsSync(claimed), false, 'its checkout is removed');
  assert.equal(git(fixture.main, 'rev-parse', 'refs/heads/worktree-alpha'), unlanded, 'its branch keeps the unlanded commit');
  assert.match(warningLines(result.stderr).join('\n'), /release them by hand/, 'the warning says how to free claims it may still hold');
  assert.equal(readFileSync(fixture.ledger, 'utf8'), ledgerBefore, 'its claims stay in the ledger until released by hand');
  assert.equal(claimedPorts(ledgerEntry(fixture, claimed)).length, 2);
});

test('the project settings run worktree setup as the Claude Code worktree hooks', async (t) => {
  const fixture = await createFixture(t);
  // The configured commands resolve the script through CLAUDE_PROJECT_DIR, so
  // the fixture project carries a copy and the real checkout is never touched.
  mkdirSync(join(fixture.main, 'scripts', 'agent-tools'), { recursive: true });
  copyFileSync(entrypoint, join(fixture.main, 'scripts', 'agent-tools', 'worktree-setup.mjs'));
  const settings = JSON.parse(readFileSync(repositorySettings, 'utf8'));
  const configured = (event) => {
    const commands = (settings.hooks?.[event] ?? []).flatMap((group) => group.hooks ?? []).filter((hook) => hook.type === 'command');
    assert.equal(commands.length, 1, `${event} has one command hook`);
    return commands[0].command;
  };
  const runConfigured = (event, input) => spawnSync('bash', ['-c', configured(event)], {
    cwd: fixture.main, input: JSON.stringify({ hook_event_name: event, ...input }), encoding: 'utf8',
    env: hookEnvironment(fixture, { CLAUDE_PROJECT_DIR: fixture.main }),
  });

  const created = runConfigured('WorktreeCreate', { cwd: fixture.main, name: 'alpha' });
  assert.equal(created.status, 0, created.stderr);
  const worktree = created.stdout.trim().split('\n').at(-1);
  assert.equal(worktree, join(fixture.main, '.claude', 'worktrees', 'alpha'));
  assert.equal(claimedPorts(ledgerEntry(fixture, worktree)).length, 2);

  const removed = runConfigured('WorktreeRemove', { cwd: fixture.main, worktree_path: worktree });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(existsSync(worktree), false);
  assert.deepEqual(claimedPorts(ledgerEntry(fixture, worktree)), []);

  const sessionEnvironment = join(fixture.root, 'claude-session-env.sh');
  const started = spawnSync('bash', ['-c', configured('SessionStart')], {
    cwd: fixture.main, input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }), encoding: 'utf8',
    env: hookEnvironment(fixture, { CLAUDE_PROJECT_DIR: fixture.main, CLAUDE_ENV_FILE: sessionEnvironment }),
  });
  assert.equal(started.status, 0, started.stderr);
  assert.match(readFileSync(sessionEnvironment, 'utf8'), /\.chain-worktree\.env/, 'SessionStart adds the port loader');
});

test('the session-start loader exports the worktree ports to every shell command run inside it', async (t) => {
  const fixture = await createFixture(t);
  const worktree = createWorktree(fixture, 'alpha');
  const ports = claimedPorts(ledgerEntry(fixture, worktree));
  const sessionEnvironment = join(fixture.root, 'claude-session-env.sh');
  writeFileSync(sessionEnvironment, '');
  const started = runHook(fixture, 'session-start', { hook_event_name: 'SessionStart', cwd: fixture.main, source: 'startup' },
    { env: { CLAUDE_ENV_FILE: sessionEnvironment } });
  assert.equal(started.status, 0, started.stderr);

  // Claude Code runs the session environment file before each Bash command,
  // in that command's working directory.
  const shellCommand = (cwd) => spawnSync('bash', ['-c', '. "$SESSION_ENV"; printf "%s %s" "$CHAIN_NATIVE_PORT" "$CHAIN_NATIVE_SMOKE_PORT"'],
    { cwd, encoding: 'utf8', env: { ...process.env, SESSION_ENV: sessionEnvironment, CHAIN_NATIVE_PORT: '', CHAIN_NATIVE_SMOKE_PORT: '' } });
  const inWorktree = shellCommand(join(worktree, 'vendor'));
  assert.equal(inWorktree.status, 0, inWorktree.stderr);
  assert.deepEqual(inWorktree.stdout.split(' ').map(Number), ports, 'a command in a worktree subdirectory gets the worktree ports');
  const inMain = shellCommand(fixture.main);
  assert.equal(inMain.status, 0, inMain.stderr);
  assert.equal(inMain.stdout, ' ', 'a command in the main checkout gets no worktree ports');

  // The loader reads port numbers only; it never runs the file as shell code.
  const marker = join(fixture.root, 'executed');
  const envFile = join(worktree, '.chain-worktree.env');
  writeFileSync(envFile, `${readFileSync(envFile, 'utf8')}CHAIN_NATIVE_PORT=$(touch ${marker})\ntouch ${marker}\n`);
  const guarded = shellCommand(worktree);
  assert.equal(guarded.status, 0, guarded.stderr);
  assert.equal(existsSync(marker), false, 'nothing in the worktree env file is executed');
  assert.deepEqual(guarded.stdout.split(' ').map(Number), ports);
});
