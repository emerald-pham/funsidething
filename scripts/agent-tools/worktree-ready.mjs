#!/usr/bin/env node

// Makes an agent worktree ready to run tests: its own dependencies, and two
// loopback ports registered in the host coordination ledger for
// CHAIN_NATIVE_PORT and CHAIN_NATIVE_SMOKE_PORT (#2364).
//
// An agent runs it; it is not a Claude Code WorktreeCreate hook. A configured
// WorktreeCreate hook replaces Claude Code's own worktree creation with no
// fallback, so a failing hook blocked every agent worktree on 2026-11-14 and
// broke resume. Nothing here can stop a worktree from being created or used:
// every problem is reported on stderr and the command still exits 0.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const coordinationClient = fileURLToPath(new URL('./coordination.mjs', import.meta.url));
const PORT_RANGE = { first: 42100, last: 42999 };
const CLAIM_ATTEMPTS = 20;
const REGISTERED_BY = 'worktree-ready';
const PORTS_FILE = 'chain-worktree-ports.env';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function warn(message) {
  console.error(`worktree-ready: ${message}`);
}

function checkout(cwd) {
  const root = realpathSync(git(cwd, 'rev-parse', '--show-toplevel'));
  const gitDir = realpathSync(resolve(root, git(root, 'rev-parse', '--git-dir')));
  const commonDir = realpathSync(resolve(root, git(root, 'rev-parse', '--git-common-dir')));
  const mainCheckout = realpathSync(git(root, 'worktree', 'list', '--porcelain').split('\n')[0].replace(/^worktree /, ''));
  return { root, portsFile: join(gitDir, PORTS_FILE), isMain: gitDir === commonDir, mainCheckout };
}

// The worktree gets a real node_modules of its own. A link to the main install
// let one worktree's `npm ci` empty the main checkout's dependencies (PR #2367 B2).
function prepareDependencies({ root, mainCheckout }) {
  const target = join(root, 'node_modules');
  if (existsSync(target)) return 'dependencies: node_modules already present';
  const source = join(mainCheckout, 'node_modules');
  const sameLockfile = existsSync(source) && existsSync(join(root, 'package-lock.json')) &&
    readFileSync(join(root, 'package-lock.json')).equals(readFileSync(join(mainCheckout, 'package-lock.json')));
  if (sameLockfile && process.platform === 'darwin') {
    // APFS copy-on-write clone: seconds, no network, and no shared files.
    const cloned = spawnSync('cp', ['-cR', source, target], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
    if (cloned.status === 0) return 'dependencies: cloned from the main checkout';
    rmSync(target, { recursive: true, force: true });
  }
  const npm = process.env.CHAIN_WORKTREE_READY_NPM || 'npm';
  const installed = spawnSync(npm, ['ci'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (installed.status === 0) return 'dependencies: installed with npm ci';
  warn(`skipped dependencies: npm ci failed (${(installed.stderr || installed.error?.message || '').trim().split('\n').pop()}). Run npm ci here when the network is back.`);
  return 'dependencies: not available';
}

function coordination(args, cwd) {
  return spawnSync(process.execPath, [coordinationClient, ...args], { cwd, encoding: 'utf8' });
}

// Only a ledger the host has configured and that already exists is used.
// Setup never creates, guesses or falls back to a second ledger.
function usableLedger(root) {
  if (!process.env.CODEX_COORDINATION_FILE?.trim() && !process.env.DOW_EMULATOR_COORDINATION_FILE?.trim()) {
    return { reason: 'no host ledger is configured (CODEX_COORDINATION_FILE is unset)' };
  }
  const discovered = coordination(['discover'], root);
  if (discovered.status !== 0) return { reason: discovered.stderr.trim() };
  const file = discovered.stdout.trim();
  if (!existsSync(file)) return { reason: `the configured ledger ${file} does not exist, and setup never creates one` };
  const status = coordination(['status'], root);
  if (status.status !== 0) return { reason: status.stderr.trim() };
  return { file, state: JSON.parse(status.stdout).state };
}

function loopbackPorts(entry) {
  return (entry?.resources ?? []).flatMap((resource) => {
    const port = /^loopback:127\.0\.0\.1:(\d+)$/.exec(String(resource).toLowerCase())?.[1];
    return port ? [Number(port)] : [];
  });
}

function portIsFree(port) {
  const probe = spawnSync(process.execPath, ['-e', `
    const server = require('node:net').createServer();
    server.once('error', () => process.exit(1));
    server.listen(${port}, '127.0.0.1', () => server.close(() => process.exit(0)));
  `]);
  return probe.status === 0;
}

// Contenders start at random offsets, so simultaneous setups rarely race for
// the same pair (PR #2367 L1); the ledger's own conflict check is the arbiter.
function choosePair(state) {
  const taken = new Set(state.entries
    .filter((entry) => entry.status === 'active' || entry.status === 'parked')
    .flatMap(loopbackPorts));
  const size = PORT_RANGE.last - PORT_RANGE.first + 1;
  const offset = Math.floor(Math.random() * size);
  const pair = [];
  for (let step = 0; step < size && pair.length < 2; step += 1) {
    const port = PORT_RANGE.first + ((offset + step) % size);
    if (!taken.has(port) && portIsFree(port)) pair.push(port);
  }
  return pair.length === 2 ? pair : undefined;
}

function resources(pair) {
  return pair.flatMap((port) => ['--resources', `loopback:127.0.0.1:${port}`]);
}

function claimPorts(root, ledger) {
  let state = ledger.state;
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    const owner = state.entries.find((entry) => entry.worktree === root && (entry.status === 'active' || entry.status === 'parked'));
    if (owner?.status === 'parked') return { reason: `this worktree's ledger entry ${owner.id} is parked; resume it first` };
    const held = loopbackPorts(owner);
    if (held.length >= 2) return { ports: held.slice(0, 2) };
    const pair = choosePair(state);
    if (!pair) return { reason: `no two free ports remain in ${PORT_RANGE.first}-${PORT_RANGE.last}` };
    const result = owner
      ? coordination(['claim', '--id', owner.id, ...resources(pair)], root)
      : coordination(['begin', '--work-type', 'tooling', '--registered-by', REGISTERED_BY,
        '--intent', 'Agent worktree test ports for CHAIN_NATIVE_PORT and CHAIN_NATIVE_SMOKE_PORT (worktree-ready).',
        ...resources(pair)], root);
    if (result.status === 0) return { ports: pair };
    if (!/Conflict with/.test(result.stderr)) return { reason: result.stderr.trim() };
    const status = coordination(['status'], root);
    if (status.status !== 0) return { reason: status.stderr.trim() };
    state = JSON.parse(status.stdout).state;
  }
  return { reason: `ports kept conflicting after ${CLAIM_ATTEMPTS} attempts` };
}

function prepare() {
  if (process.env.CI === 'true') {
    console.log('worktree-ready: CI run; nothing to prepare.');
    return;
  }
  const where = checkout(process.cwd());
  if (where.isMain) {
    console.log('worktree-ready: main checkout; it keeps its own dependencies and claims no ports.');
    return;
  }
  // Ports come first, so the ledger checked here is the one written moments later.
  const ledger = usableLedger(where.root);
  let ports;
  if (ledger.reason) warn(`skipped ports: ${ledger.reason}. Nothing was written to any ledger.`);
  else {
    pruneRemoved(where.root);
    const claimed = claimPorts(where.root, ledger);
    if (claimed.reason) warn(`skipped ports: ${claimed.reason}.`);
    else ports = claimed.ports;
  }
  if (ports) {
    writeFileSync(where.portsFile, `export CHAIN_NATIVE_PORT=${ports[0]}\nexport CHAIN_NATIVE_SMOKE_PORT=${ports[1]}\n`);
    console.log(`worktree-ready: ports: CHAIN_NATIVE_PORT=${ports[0]} CHAIN_NATIVE_SMOKE_PORT=${ports[1]}`);
  } else {
    rmSync(where.portsFile, { force: true });
  }
  console.log(`worktree-ready: ${prepareDependencies(where)}`);
}

// Finishes the entries of removed worktrees so their ports return to the pool.
function pruneRemoved(root) {
  const pruned = coordination(['prune', '--registered-by', REGISTERED_BY], root);
  if (pruned.status !== 0) {
    warn(`skipped prune: ${pruned.stderr.trim()}`);
    return;
  }
  const entries = JSON.parse(pruned.stdout);
  if (entries.length) console.log(`worktree-ready: freed ${entries.length} removed worktree entr${entries.length === 1 ? 'y' : 'ies'}: ${entries.map((entry) => entry.worktree).join(', ')}`);
}

function prune() {
  const { root } = checkout(process.cwd());
  const ledger = usableLedger(root);
  if (ledger.reason) warn(`skipped prune: ${ledger.reason}. Nothing was written to any ledger.`);
  else pruneRemoved(root);
}

function printEnvironment() {
  const { portsFile } = checkout(process.cwd());
  if (existsSync(portsFile)) process.stdout.write(readFileSync(portsFile, 'utf8'));
  else warn('no ports prepared for this worktree; run prepare first.');
}

const [command] = process.argv.slice(2);
try {
  if (command === 'prepare') prepare();
  else if (command === 'env') printEnvironment();
  else if (command === 'prune') prune();
  else {
    console.error('usage: worktree-ready.mjs <prepare|env|prune>');
    process.exitCode = 2;
  }
} catch (error) {
  warn(`stopped: ${error instanceof Error ? error.message : String(error)}`);
}
