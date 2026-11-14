#!/usr/bin/env node

// Prepares a new agent worktree so it can run tests from the start (#2364).
// Claude Code runs `create` as its WorktreeCreate hook and `remove` as its
// WorktreeRemove hook (.claude/settings.json). The hook replaces Claude Code's
// own `git worktree add`, so `create` makes the worktree itself and prints its
// path as the last stdout line; everything else goes to stderr.
//
// Ledger safety: the hook talks to the host ledger only through the installed
// coordination client, and only to the ledger that client discovers. The
// client treats a missing ledger file as empty and would create it on the
// first write, so the hook checks first and never writes to a ledger that does
// not already exist: a second ledger is how ownership got split before
// (docs/agents/host-coordination.md).
//
// Without a usable ledger the hook still makes the worktree, with its
// dependencies, and only skips the ports, warning once on stderr. Refusing
// there blocked every agent worktree on the host, because the Claude app does
// not inherit CODEX_COORDINATION_FILE from a shell profile (#2364 owner
// decision, 2026-11-14).

import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const ENV_FILE = '.chain-worktree.env';
const DEFAULT_PORT_RANGE = [42100, 42999];
const WORKTREE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

class SetupError extends Error {}

function log(message) {
  process.stderr.write(`worktree-setup: ${message}\n`);
}

function run(command, args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new SetupError(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    throw new SetupError(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result;
}

function git(cwd, ...args) {
  return run('git', args, { cwd }).stdout.trim();
}

function readInput() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    throw new SetupError(`The hook input on stdin is not JSON: ${error.message}`);
  }
}

const LEDGER_FIX = 'Export CODEX_COORDINATION_FILE with the host ledger path to the Claude app, for example in the "env" of the untracked .claude/settings.local.json, then create the worktree again (docs/agents/host-coordination.md).';

function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function warn(reason, fix) {
  log(`warning: no ports claimed for this worktree: ${oneLine(reason)} ${oneLine(fix)}`);
}

function ciVariable() {
  return ['CI', 'GITHUB_ACTIONS'].find((variable) => {
    const value = String(process.env[variable] ?? '').trim().toLowerCase();
    return value && value !== 'false' && value !== '0';
  });
}

function runClient(client, args, cwd) {
  return run(process.execPath, [client, ...args], { cwd });
}

// The installed client and the existing ledger it discovers
// (CODEX_COORDINATION_FILE, its legacy alias, or the legacy default), or why
// there is none. Nothing here creates, guesses or falls back to a ledger.
function ledgerAccess(cwd) {
  const variable = ciVariable();
  if (variable) return { reason: `${variable} is set.`, fix: 'Ports are claimed only for local agent worktrees; CI needs none.' };
  const client = join(homedir(), '.local', 'bin', 'chain-coordination.mjs');
  try {
    accessSync(client, constants.X_OK);
  } catch {
    return { reason: `The coordination client is not installed at ${client}.`, fix: `Install it once from a checkout with: node scripts/agent-tools/coordination.mjs install --to "${client}"` };
  }
  const discovered = spawnSync(process.execPath, [client, 'discover'], { cwd, encoding: 'utf8' });
  if (discovered.error || discovered.status !== 0) {
    const reason = discovered.error?.message ?? (discovered.stderr || discovered.stdout || '').trim();
    return { reason: `The coordination client could not select one ledger: ${reason}`, fix: LEDGER_FIX };
  }
  const ledger = discovered.stdout.trim();
  let metadata;
  try {
    metadata = statSync(ledger);
  } catch {
    return { reason: `The coordination ledger ${ledger} does not exist, and setup never creates one.`, fix: LEDGER_FIX };
  }
  if (!metadata.isFile()) return { reason: `The coordination ledger ${ledger} is not a regular file.`, fix: LEDGER_FIX };
  try {
    accessSync(ledger, constants.R_OK | constants.W_OK);
  } catch {
    return { reason: `The coordination ledger ${ledger} is not readable and writable.`, fix: LEDGER_FIX };
  }
  return { client, ledger };
}

function mainCheckout(cwd) {
  const first = git(cwd, 'worktree', 'list', '--porcelain').split('\n')[0] ?? '';
  if (!first.startsWith('worktree ')) throw new SetupError(`Cannot find the main checkout from ${cwd}.`);
  return realpathSync(first.slice('worktree '.length));
}

function portRange() {
  const configured = String(process.env.CHAIN_WORKTREE_PORT_RANGE ?? '').trim();
  if (!configured) return DEFAULT_PORT_RANGE;
  const match = /^(\d+)-(\d+)$/.exec(configured);
  const range = match ? [Number(match[1]), Number(match[2])] : [];
  if (!match || range[0] < 1024 || range[1] > 65535 || range[0] >= range[1]) {
    throw new SetupError(`CHAIN_WORKTREE_PORT_RANGE must be <start>-<end> within 1024-65535, got ${configured}.`);
  }
  return range;
}

function portIsFree(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once('error', () => resolvePort(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolvePort(true)));
  });
}

function provideDependencies(main, worktree) {
  const worktreeLock = join(worktree, 'package-lock.json');
  if (!existsSync(worktreeLock)) {
    log('no package-lock.json in the worktree; no dependencies to provide.');
    return;
  }
  const mainLock = join(main, 'package-lock.json');
  const mainModules = join(main, 'node_modules');
  const modulesAreInstalled = existsSync(mainModules) && lstatSync(mainModules).isDirectory();
  if (modulesAreInstalled && existsSync(mainLock) && readFileSync(mainLock).equals(readFileSync(worktreeLock))) {
    symlinkSync(mainModules, join(worktree, 'node_modules'), 'dir');
    log(`linked node_modules to ${mainModules}; the lockfiles match.`);
    return;
  }
  log('the main checkout install does not match this lockfile; running npm ci.');
  const installed = run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: worktree });
  log((installed.stdout + installed.stderr).trim());
}

function beginEntry(client, ledger, worktree, name) {
  const began = runClient(client, ['begin', '--file', ledger, '--work-type', 'tooling',
    '--intent', `Claude Code agent worktree ${name}, prepared by scripts/agent-tools/worktree-setup.mjs (#2364).`], worktree);
  return JSON.parse(began.stdout);
}

// Ports any active or parked entry holds. Parked work keeps its claims without
// a heartbeat, so a parked worktree's ports stay taken.
function heldLoopbackPorts(client, ledger, cwd) {
  const { state } = JSON.parse(runClient(client, ['status', '--file', ledger], cwd).stdout);
  const held = new Set();
  for (const entry of state.entries ?? []) {
    if (entry?.status !== 'active' && entry?.status !== 'parked') continue;
    for (const resource of Array.isArray(entry.resources) ? entry.resources : []) {
      const match = /^loopback:127\.0\.0\.1:(\d+)$/i.exec(String(resource).trim());
      if (match) held.add(Number(match[1]));
    }
  }
  return held;
}

// The client's claim checks ownership under the ledger lock, so a worktree
// created at the same moment can still win a port this one chose: pick again.
async function claimPorts(client, ledger, worktree, entryId) {
  const [start, end] = portRange();
  let lastConflict = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const held = heldLoopbackPorts(client, ledger, worktree);
    const chosen = [];
    for (let port = start; port <= end && chosen.length < 2; port += 1) {
      if (!held.has(port) && await portIsFree(port)) chosen.push(port);
    }
    if (chosen.length < 2) throw new SetupError(`No two loopback ports in ${start}-${end} are both free and unclaimed in the host ledger.`);
    const claimed = spawnSync(process.execPath, [client, 'claim', '--file', ledger, '--id', entryId,
      ...chosen.flatMap((port) => ['--resources', `loopback:127.0.0.1:${port}`])], { cwd: worktree, encoding: 'utf8' });
    if (claimed.status === 0) return chosen;
    lastConflict = (claimed.stderr || claimed.stdout || '').trim();
    if (!/^Conflict with /.test(lastConflict)) throw new SetupError(`Claiming loopback ports failed: ${lastConflict}`);
  }
  throw new SetupError(`Claiming loopback ports kept conflicting with other worktrees: ${lastConflict}`);
}

function environmentText(entryId, [nativePort, smokePort]) {
  return [
    '# Written by scripts/agent-tools/worktree-setup.mjs (#2364). These loopback ports',
    `# are claimed for this worktree in the host coordination ledger, entry ${entryId}.`,
    '# Load them in a shell with: set -a; . ./.chain-worktree.env; set +a',
    `CHAIN_NATIVE_PORT=${nativePort}`,
    `CHAIN_NATIVE_SMOKE_PORT=${smokePort}`,
    '',
  ].join('\n');
}

function ownedEntries(client, ledger, worktree) {
  const { state } = JSON.parse(runClient(client, ['status', '--file', ledger], worktree).stdout);
  return (state.entries ?? []).filter((entry) => entry?.worktree === worktree && (entry.status === 'active' || entry.status === 'parked'));
}

// Frees the loopback ports of the worktree's entries and finishes a still-active
// one as discarded. Returns the entries it found.
function releaseEntries({ client, ledger }, worktree, reason) {
  if (!ledger) return [];
  const entries = ownedEntries(client, ledger, worktree);
  for (const entry of entries) {
    const loopback = (entry.resources ?? []).filter((resource) => /^loopback:127\.0\.0\.1:\d+$/i.test(String(resource).trim()));
    if (loopback.length) {
      runClient(client, ['release-claim', '--file', ledger, '--id', entry.id, ...loopback.flatMap((resource) => ['--resources', resource])], worktree);
      log(`released ${loopback.join(', ')} from ${entry.id}.`);
    }
    if (entry.status !== 'active') continue;
    const finished = spawnSync(process.execPath, [client, 'finish', '--file', ledger, '--id', entry.id, '--adapter', 'chain-scanner',
      '--outcome', 'discarded', '--reason', reason], { cwd: worktree, encoding: 'utf8' });
    if (finished.status === 0) log(`finished ${entry.id} as discarded.`);
    else log(`warning: ${entry.id} stays active without its ports; finish it by hand: ${oneLine(finished.stderr || finished.stdout || '')}`);
  }
  return entries;
}

// Frees what setup claimed and closes the entry when there is a ledger, then
// deletes the checkout. The branch goes too only when it has no commits beyond
// where setup started it, so removal never loses work that exists only on that
// branch.
function tearDown(access, worktree, main, { newBranchStart } = {}) {
  const branch = git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD');
  const tip = git(worktree, 'rev-parse', 'HEAD');
  const entries = releaseEntries(access, worktree, `Claude Code removed worktree ${worktree}; branch ${branch} at ${tip} was not checked for landing.`);
  run('git', ['worktree', 'remove', '--force', worktree], { cwd: main });
  const unchanged = tip === newBranchStart || entries.some((entry) => entry.branchName === branch && entry.startBranchSha === tip);
  if (unchanged && branch !== 'HEAD') {
    run('git', ['branch', '-D', branch], { cwd: main });
    log(`deleted branch ${branch}; it had no new commits.`);
  } else {
    log(`kept branch ${branch} at ${tip}.`);
  }
}

// Registers the worktree and claims its two ports. A failure here, such as a
// full port range, leaves the worktree usable without ports: the partial entry
// is closed and the warning says why.
async function registerPorts(access, worktree, name) {
  const { client, ledger } = access;
  try {
    const entry = beginEntry(client, ledger, worktree, name);
    const ports = await claimPorts(client, ledger, worktree, entry.id);
    writeFileSync(join(worktree, ENV_FILE), environmentText(entry.id, ports));
    log(`claimed CHAIN_NATIVE_PORT=${ports[0]} and CHAIN_NATIVE_SMOKE_PORT=${ports[1]} in ${ledger}.`);
  } catch (error) {
    rmSync(join(worktree, ENV_FILE), { force: true });
    try {
      releaseEntries(access, worktree, `Setup of Claude Code worktree ${worktree} could not claim its ports: ${oneLine(error.message)}`);
    } catch (releaseError) {
      log(`warning: could not close the partial ledger entry of ${worktree}; check it with the coordination client's status: ${oneLine(releaseError.message)}`);
    }
    warn(error.message, `Check the host ledger ${ledger} with the coordination client's status, free stale claims or widen CHAIN_WORKTREE_PORT_RANGE, then create the worktree again.`);
  }
}

async function remove(input) {
  const requested = typeof input.worktree_path === 'string' ? input.worktree_path : '';
  if (!isAbsolute(requested)) throw new SetupError('The WorktreeRemove input needs an absolute worktree_path.');
  if (!existsSync(requested)) throw new SetupError(`${requested} is already gone; any ledger claims it held must be released by hand.`);
  const worktree = realpathSync(requested);
  const top = realpathSync(git(worktree, 'rev-parse', '--show-toplevel'));
  if (top !== worktree) throw new SetupError(`${worktree} is not a worktree root; nothing was removed.`);
  const main = mainCheckout(worktree);
  if (main === worktree) throw new SetupError(`${worktree} is the main checkout; worktree setup never removes it.`);
  // Without a ledger the checkout still goes, but no claim can be released and
  // the branch is kept: only a ledger entry shows where it started.
  const access = ledgerAccess(worktree);
  if (!access.ledger) {
    log(`warning: no claims released for ${worktree}: ${oneLine(access.reason)} Any ports it holds stay claimed in the host ledger; release them by hand with the coordination client's release-claim and finish. ${oneLine(access.fix)}`);
  }
  tearDown(access, worktree, main);
}

async function create(input) {
  const name = String(input.name ?? '').trim();
  if (!WORKTREE_NAME.test(name) || name.includes('..')) throw new SetupError(`Invalid worktree name: ${JSON.stringify(input.name ?? '')}.`);
  const from = resolve(typeof input.cwd === 'string' && isAbsolute(input.cwd) ? input.cwd : process.cwd());
  const top = git(from, 'rev-parse', '--show-toplevel');
  const main = mainCheckout(top);
  const access = ledgerAccess(main);
  const worktree = join(main, '.claude', 'worktrees', name);
  const branch = `worktree-${name}`;
  if (existsSync(worktree)) throw new SetupError(`${worktree} already exists; setup stopped and wrote nothing.`);
  if (run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: top, allowFailure: true }).status === 0) {
    throw new SetupError(`Branch ${branch} already exists; setup stopped and wrote nothing.`);
  }

  const start = git(top, 'rev-parse', 'HEAD');
  log(run('git', ['worktree', 'add', '-b', branch, worktree, start], { cwd: top }).stderr.trim());
  try {
    provideDependencies(main, worktree);
  } catch (error) {
    try {
      tearDown(access, worktree, main, { newBranchStart: start });
    } catch (cleanupError) {
      log(`warning: could not undo the partial setup of ${worktree}: ${cleanupError.message}`);
    }
    throw error;
  }
  if (access.ledger) await registerPorts(access, worktree, name);
  else warn(access.reason, access.fix);
  process.stdout.write(`${worktree}\n`);
}

// WorktreeCreate cannot set a session's environment, and a subagent's shell
// starts in its worktree without sourcing anything there. So a SessionStart
// hook adds this loader to the session's CLAUDE_ENV_FILE, which Claude Code
// runs before every Bash command in that command's directory. It reads only
// the two port names with all-digit values: the file sits in a checkout, so it
// is parsed as data and never run as shell code. POSIX sh, bash and zsh.
const LOADER_MARKER = '# chain-worktree-ports loader (#2364)';
const SESSION_LOADER = `${LOADER_MARKER}
__chain_wt_env="$(git rev-parse --show-toplevel 2>/dev/null)/${ENV_FILE}"
if [ -f "$__chain_wt_env" ]; then
  while IFS='=' read -r __chain_wt_key __chain_wt_value || [ -n "$__chain_wt_key" ]; do
    case "$__chain_wt_key" in
      CHAIN_NATIVE_PORT|CHAIN_NATIVE_SMOKE_PORT)
        case "$__chain_wt_value" in
          ''|*[!0-9]*) ;;
          *) export "$__chain_wt_key=$__chain_wt_value" ;;
        esac ;;
    esac
  done < "$__chain_wt_env"
fi
unset __chain_wt_env __chain_wt_key __chain_wt_value
`;

function sessionStart() {
  const target = String(process.env.CLAUDE_ENV_FILE ?? '').trim();
  if (!target) return;
  const variable = ciVariable();
  if (variable) {
    log(`${variable} is set: no worktree ports exist in CI, so the port loader was not added.`);
    return;
  }
  const existing = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (existing.includes(LOADER_MARKER)) return;
  writeFileSync(target, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${SESSION_LOADER}`);
}

const [command] = process.argv.slice(2);
try {
  if (command === 'create') await create(readInput());
  else if (command === 'remove') await remove(readInput());
  else if (command === 'session-start') sessionStart();
  else throw new SetupError(`usage: worktree-setup.mjs <create|remove|session-start> (${command ?? 'no command'} is not supported)`);
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof SetupError ? 1 : 2;
}
