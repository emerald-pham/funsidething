#!/usr/bin/env node

// Answers "is this test failure ours, or already on the base?" for one test
// file and name pattern (#2494). It runs the pattern N times on the current
// checkout and N times on a base commit in a temporary worktree, P runs at a
// time, and prints each side's pass, fail and not-run counts with every
// distinct failure message. Five agents in the #2490 slice each built this by
// hand: a detached worktree at main, six parallel `node --test` processes and
// greps over TAP files.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT_VARIABLES, applyPreparedPorts } from './worktree-ports.mjs';

const worktreeReady = fileURLToPath(new URL('./worktree-ready.mjs', import.meta.url));
const recordRun = fileURLToPath(new URL('./record-run.mjs', import.meta.url));
const self = fileURLToPath(import.meta.url);
const MESSAGE_LIMIT = 200;
const KILL_GRACE_MS = 750;
const USAGE = `usage: head-vs-base.mjs --file <test file> --pattern <test name pattern>
  [--runs <n per side, default 6>] [--parallel <p, default 6>] [--base <ref, default origin/main>]
  [--node-option <option>]... [--json] [--evidence-dir <dir> --purpose <recorder purpose>]`;

class UsageError extends Error {}

function parseArguments(argv) {
  const options = { runs: 6, parallel: 6, base: 'origin/main', nodeOptions: [], json: false, comparisonArgs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const start = index;
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new UsageError(`${name} needs a value`);
      index += 1;
      return next;
    };
    if (name === '--file') options.file = value();
    else if (name === '--pattern') options.pattern = value();
    else if (name === '--runs') options.runs = positiveInteger(name, value());
    else if (name === '--parallel') options.parallel = positiveInteger(name, value());
    else if (name === '--base') options.base = value();
    else if (name === '--node-option') options.nodeOptions.push(value());
    else if (name === '--json') options.json = true;
    else if (name === '--evidence-dir') options.evidenceDir = value();
    else if (name === '--purpose') options.purpose = value();
    else throw new UsageError(`unknown option ${name}`);
    if (name !== '--evidence-dir' && name !== '--purpose') options.comparisonArgs.push(...argv.slice(start, index + 1));
  }
  if ((options.evidenceDir === undefined) !== (options.purpose === undefined)) throw new UsageError('--evidence-dir and --purpose go together');
  if (!options.file) throw new UsageError('--file is required');
  if (options.pattern === undefined) throw new UsageError('--pattern is required');
  return options;
}

function positiveInteger(name, text) {
  const number = Number(text);
  if (!Number.isInteger(number) || number < 1) throw new UsageError(`${name} must be a whole number of at least 1`);
  return number;
}

// Test runs in flight, each the leader of its own process group, and the
// signal that interrupted the comparison, if one did. Each run's process id is
// also kept as a file in the base's run directory, for the janitor.
const testRuns = new Set();
let interruption;
let runDirectory;

// Stops every test run with everything it started, then forces any left after
// a grace period, so no run outlives an interrupted comparison.
function interrupt(signal) {
  if (interruption) return;
  interruption = signal;
  const signalGroups = (name) => {
    for (const child of testRuns) {
      try {
        process.kill(-child.pid, name);
      } catch {
        // The run already ended.
      }
    }
  };
  signalGroups('SIGTERM');
  setTimeout(() => signalGroups('SIGKILL'), KILL_GRACE_MS).unref();
}

// Every child is collected asynchronously, so a signal reaches this process's
// handlers while children run.
function run(command, args, { cwd, env = process.env, testRun = false } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: testRun });
    if (testRun && child.pid) {
      testRuns.add(child);
      const marker = join(runDirectory, String(child.pid));
      writeFileSync(marker, '');
      child.on('close', () => {
        testRuns.delete(child);
        rmSync(marker, { force: true });
      });
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolvePromise({ status: null, signal: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (status, signal) => resolvePromise({ status, signal, stdout, stderr }));
  });
}

async function git(cwd, ...args) {
  const result = await run('git', args, { cwd });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

// Node's TAP reporter: a test point, then an indented YAML block ending in `...`.
const TEST_POINT = /^(\s*)(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/;

function firstErrorLine(block) {
  const index = block.findIndex((line) => /^\s*error:/.test(line));
  if (index === -1) return '';
  const inline = block[index].replace(/^\s*error:\s*/, '');
  let text;
  if (/^[|>]/.test(inline)) text = block.slice(index + 1).map((line) => line.trim()).find(Boolean) ?? '';
  else if (/^'.*'$/.test(inline)) text = inline.slice(1, -1).replace(/''/g, "'");
  else if (/^".*"$/.test(inline)) text = inline.slice(1, -1);
  else text = inline;
  return text.trim().slice(0, MESSAGE_LIMIT);
}

// Reads one run's TAP into an outcome. When a file has no test matching the
// pattern, Node still reports the file itself as one passing test, so the
// file's own test point never counts as a pass. A run that skipped any
// selected test did not run all of them, so it is not a pass either.
function readRun({ status, signal, stdout, stderr }, fileNames) {
  const lines = stdout.split('\n');
  let passes = 0;
  const failures = [];
  const skipped = [];
  for (let index = 0; index < lines.length; index += 1) {
    const point = TEST_POINT.exec(lines[index]);
    if (!point) continue;
    const [, indent, result, rawName, directive] = point;
    const name = rawName.replace(/\\#/g, '#');
    const block = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next].trim() === '...' && lines[next].startsWith(`${indent}  `)) break;
      if (!lines[next].startsWith(`${indent}  `)) break;
      block.push(lines[next]);
    }
    if (directive === 'TODO') continue;
    // A skipped test never ran, so it is never a pass (#2494).
    if (directive === 'SKIP') {
      skipped.push(name);
      continue;
    }
    if (result === 'ok') {
      if (!fileNames.has(name)) passes += 1;
      continue;
    }
    // A parent that failed only because a subtest did names nothing new.
    if (block.some((line) => /^\s*failureType: 'subtestsFailed'/.test(line))) continue;
    failures.push(`${name}: ${firstErrorLine(block)}`);
  }
  if (failures.length || status !== 0) {
    if (!failures.length) {
      const last = stderr.trim().split('\n').pop() ?? '';
      failures.push(`process ${signal ? `ended by ${signal}` : `exited with code ${status}`}${last ? `: ${last.slice(0, MESSAGE_LIMIT)}` : ''}`);
    }
    return { outcome: 'failed', failures };
  }
  if (skipped.length) return { outcome: 'not-run', reason: `skipped: ${skipped.join(', ')}` };
  return passes > 0 ? { outcome: 'passed' } : { outcome: 'not-run', reason: 'no test matched the pattern' };
}

function tally(results) {
  const side = { passed: 0, failed: 0, notRun: 0, failures: [], notRunReasons: [] };
  const count = (list, key, field) => {
    const found = list.find((item) => item[field] === key);
    if (found) found.count += 1;
    else list.push({ [field]: key, count: 1 });
  };
  for (const result of results) {
    if (result.outcome === 'passed') side.passed += 1;
    else if (result.outcome === 'failed') {
      side.failed += 1;
      for (const message of new Set(result.failures)) count(side.failures, message, 'message');
    } else {
      side.notRun += 1;
      count(side.notRunReasons, result.reason, 'reason');
    }
  }
  side.failures.sort((left, right) => right.count - left.count);
  return side;
}

// The base worktree lives at <parent>/base and its runs' process ids under
// <parent>/runs. A janitor process, in its own process group, waits for this
// comparison to end and then stops any run left and removes whatever of the
// base is left. The test-run recorder kills an interrupted comparison's process
// group outright after 750 ms, which can land in the middle of removing a base
// worktree; the janitor finishes that removal (#2494).
async function prepareBase(headRoot, baseSha) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'chain-head-vs-base-')));
  runDirectory = join(parent, 'runs');
  mkdirSync(runDirectory);
  const janitor = spawn(process.execPath, [self, '--janitor', String(process.pid), headRoot, parent], { detached: true, stdio: 'ignore' });
  janitor.on('error', (error) => console.error(`head-vs-base: the cleanup janitor did not start: ${error.message}`));
  janitor.unref();
  const base = { parent, worktree: join(parent, 'base'), janitor };
  await git(headRoot, 'worktree', 'add', '--quiet', '--detach', base.worktree, baseSha);
  // The existing worktree flow gives the base its own dependencies and ports.
  const ready = await run(process.execPath, [worktreeReady, 'prepare'], { cwd: base.worktree });
  process.stderr.write(`${ready.stdout}${ready.stderr}`);
  return base;
}

// Removes the base worktree, its temporary directory and git's record of it,
// then lets worktree-ready finish the base's ledger entry and free its ports.
// Each step tolerates an earlier, partial removal. Only the base's own record
// goes: a repository-wide `git worktree prune` also dropped every other
// worktree whose directory was missing for a moment, which host coordination
// still counts as owned (#2498 specialist review N5).
function removeBase(headRoot, parent) {
  const worktree = join(parent, 'base');
  if (existsSync(worktree)) spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: headRoot, stdio: 'ignore' });
  rmSync(parent, { recursive: true, force: true });
  removeWorktreeRecord(headRoot, worktree);
  return spawnSync(process.execPath, [worktreeReady, 'prune'], { cwd: headRoot, encoding: 'utf8' });
}

// git keeps each linked worktree's record in <common dir>/worktrees/<name>,
// whose gitdir file names the worktree's .git file.
function removeWorktreeRecord(headRoot, worktree) {
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: headRoot, encoding: 'utf8' });
  if (common.status !== 0) return;
  const records = join(common.stdout.trim(), 'worktrees');
  let names = [];
  try {
    names = readdirSync(records);
  } catch {
    return;
  }
  for (const name of names) {
    let gitdir = '';
    try {
      gitdir = readFileSync(join(records, name, 'gitdir'), 'utf8').trim();
    } catch {
      continue;
    }
    if (gitdir === join(worktree, '.git')) rmSync(join(records, name), { recursive: true, force: true });
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function janitor([ownerText, headRoot, parent]) {
  const owner = Number(ownerText);
  const timer = setInterval(() => {
    if (processAlive(owner)) return;
    clearInterval(timer);
    let runs = [];
    try {
      runs = readdirSync(join(parent, 'runs')).map(Number);
    } catch {
      // The comparison already removed its base.
    }
    for (const pid of runs) {
      // kill(-1) would signal every process this user owns.
      if (!Number.isInteger(pid) || pid <= 1) continue;
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // That run already ended.
      }
    }
    if (existsSync(parent)) removeBase(headRoot, parent);
  }, 100);
}

// A comparison started from inside a Node test run inherits its
// NODE_TEST_CONTEXT, which makes each child `node --test` report to that run
// instead of printing TAP. The base runs drop the caller's port variables for
// the ports worktree-ready claimed for the base worktree, so the two sides
// never share a server port; the head keeps any the caller exported.
function testEnvironment(root, { ownPorts }) {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  if (ownPorts) for (const name of PORT_VARIABLES) delete environment[name];
  applyPreparedPorts(environment, root);
  return environment;
}

// The checkout-relative path of --file, so each side runs its own commit's
// copy. An absolute path once ran the head's file, and through its relative
// imports the head's code, on the base side too (#2498 review B1).
function checkoutFile(headRoot, file) {
  const absolute = resolve(headRoot, file);
  let real = absolute;
  try {
    real = realpathSync(absolute);
  } catch {
    try {
      real = join(realpathSync(dirname(absolute)), basename(absolute));
    } catch {
      // Neither exists; the runs report the missing file.
    }
  }
  const inside = relative(headRoot, real);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new UsageError(`--file ${file} is outside the checkout ${headRoot}; name a test file inside it, absolute or relative to its root`);
  }
  return inside.split(sep).join('/');
}

// worktree-ready never fails, so it can leave the base without dependencies or
// ports. Its runs would then fail for that reason alone, which reads as
// "already fails on the base" (#2498 review N1). CI runs use ephemeral ports.
function unpreparedBase(head, base) {
  const reasons = [];
  if (existsSync(join(head.root, 'node_modules')) && !existsSync(join(base.root, 'node_modules'))) {
    reasons.push('it has no dependencies (node_modules), though the head checkout does');
  }
  if (process.env.CI !== 'true') {
    for (const name of PORT_VARIABLES) {
      if (head.env[name]?.trim() && !base.env[name]?.trim()) reasons.push(`no ${name} could be claimed for it, though the head runs have one`);
    }
  }
  return reasons;
}

async function runSides(options, sides) {
  const jobs = [];
  for (let index = 0; index < options.runs; index += 1) for (const side of sides) jobs.push(side);
  const results = new Map(sides.map((side) => [side, []]));
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && !interruption) {
      const side = jobs[next];
      next += 1;
      const file = join(side.root, options.file);
      const output = await run(process.execPath, [
        ...options.nodeOptions, '--test', '--test-reporter=tap', `--test-name-pattern=${options.pattern}`, file,
      ], { cwd: side.root, env: side.env, testRun: true });
      results.get(side).push(readRun(output, new Set([file, options.file])));
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.parallel, jobs.length) }, worker));
  return results;
}

function printReport(report) {
  const lines = [`head-vs-base: ${report.file}, pattern ${JSON.stringify(report.pattern)}, ${report.runs} runs per side, ${report.parallel} at a time`];
  for (const side of [report.head, report.base]) {
    const name = side === report.head ? `head ${side.sha.slice(0, 12)}${side.dirty ? ' with uncommitted changes' : ''}` : `base ${side.ref} ${side.sha.slice(0, 12)}`;
    lines.push(`${name}: ${side.passed} passed, ${side.failed} failed, ${side.notRun} not run`);
    for (const failure of side.failures) lines.push(`  ${failure.count}× ${failure.message}`);
    for (const notRun of side.notRunReasons) lines.push(`  ${notRun.count}× not run: ${notRun.reason}`);
  }
  console.log(lines.join('\n'));
}

// The recorder runs the plain comparison as its child and keeps its command,
// output, exit and source identity, as for any other recorded test run.
let recorder;

function recordComparison(headRoot, options) {
  return new Promise((resolvePromise) => {
    recorder = spawn(process.execPath, [
      recordRun, '--repo', headRoot, '--evidence-dir', options.evidenceDir, '--purpose', options.purpose,
      '--', process.execPath, self, ...options.comparisonArgs,
    ], { cwd: headRoot, stdio: 'inherit' });
    recorder.on('error', (error) => {
      console.error(`head-vs-base: the recorder did not start: ${error.message}`);
      resolvePromise(2);
    });
    recorder.on('close', (status, signal) => resolvePromise(status ?? 128 + constants.signals[signal]));
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const headRoot = realpathSync(await git(process.cwd(), 'rev-parse', '--show-toplevel'));
  options.file = checkoutFile(headRoot, options.file);
  if (options.evidenceDir !== undefined) {
    process.exitCode = await recordComparison(headRoot, options);
    return;
  }
  const headSha = await git(headRoot, 'rev-parse', 'HEAD');
  const dirty = (await git(headRoot, 'status', '--porcelain')) !== '';
  const baseSha = await git(headRoot, 'rev-parse', '--verify', '--end-of-options', `${options.base}^{commit}`);
  let base;
  try {
    base = await prepareBase(headRoot, baseSha);
    if (interruption) return;
    const head = { root: headRoot, env: testEnvironment(headRoot, { ownPorts: false }) };
    const baseSide = { root: base.worktree, env: testEnvironment(base.worktree, { ownPorts: true }) };
    const unprepared = unpreparedBase(head, baseSide);
    if (unprepared.length) {
      console.error(`head-vs-base: environment failure: worktree-ready could not prepare the base worktree: ${unprepared.join('; ')}. Neither side ran, and nothing is known about the base; fix what worktree-ready reported above and run again.`);
      process.exitCode = 2;
      return;
    }
    const results = await runSides(options, [head, baseSide]);
    if (interruption) return;
    const report = {
      file: options.file,
      pattern: options.pattern,
      runs: options.runs,
      parallel: options.parallel,
      head: { sha: headSha, dirty, ...tally(results.get(head)) },
      base: { ref: options.base, sha: baseSha, worktree: base.worktree, ...tally(results.get(baseSide)) },
    };
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
    const clean = [report.head, report.base].every((side) => side.failed === 0 && side.notRun === 0);
    process.exitCode = clean ? 0 : 1;
  } finally {
    // Runs even after an interrupt, which only stopped the test runs.
    if (base) {
      const pruned = removeBase(headRoot, base.parent);
      process.stderr.write(`${pruned.stdout ?? ''}${pruned.stderr ?? ''}`);
      base.janitor.kill();
    }
    if (interruption) {
      console.error(`head-vs-base: interrupted by ${interruption}; the base worktree is removed and no result was reported.`);
      process.exitCode = 128 + constants.signals[interruption];
    }
  }
}

if (process.argv[2] === '--janitor') janitor(process.argv.slice(3));
else {
  // Under the recorder, the recorder stops the comparison and records that.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => (recorder ? recorder.kill(signal) : interrupt(signal)));
  }
  main().catch((error) => {
    console.error(`head-vs-base: ${error.message}`);
    if (error instanceof UsageError) console.error(USAGE);
    process.exitCode = 2;
  });
}
