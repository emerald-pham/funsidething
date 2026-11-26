#!/usr/bin/env node

// Answers "is this test failure ours, or already on the base?" for one test
// file and name pattern (#2494). It runs the pattern N times on the current
// checkout and N times on a base commit in a temporary worktree, P runs at a
// time, and prints each side's pass, fail and not-run counts with every
// distinct failure message. Five agents in the #2490 slice each built this by
// hand: a detached worktree at main, six parallel `node --test` processes and
// greps over TAP files.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const worktreeReady = fileURLToPath(new URL('./worktree-ready.mjs', import.meta.url));
const MESSAGE_LIMIT = 200;
const USAGE = `usage: head-vs-base.mjs --file <test file> --pattern <test name pattern>
  [--runs <n per side, default 6>] [--parallel <p, default 6>] [--base <ref, default origin/main>]
  [--node-option <option>]... [--json]`;

class UsageError extends Error {}

function parseArguments(argv) {
  const options = { runs: 6, parallel: 6, base: 'origin/main', nodeOptions: [], json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
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
    else throw new UsageError(`unknown option ${name}`);
  }
  if (!options.file) throw new UsageError('--file is required');
  if (options.pattern === undefined) throw new UsageError('--pattern is required');
  return options;
}

function positiveInteger(name, text) {
  const number = Number(text);
  if (!Number.isInteger(number) || number < 1) throw new UsageError(`${name} must be a whole number of at least 1`);
  return number;
}

// Every child is collected asynchronously, so a signal reaches this process's
// handlers while children run.
function run(command, args, { cwd, env = process.env } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

async function prepareBase(headRoot, baseSha) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'chain-head-vs-base-')));
  const worktree = join(parent, 'base');
  await git(headRoot, 'worktree', 'add', '--quiet', '--detach', worktree, baseSha);
  // The existing worktree flow gives the base its own dependencies and ports.
  const ready = await run(process.execPath, [worktreeReady, 'prepare'], { cwd: worktree });
  process.stderr.write(`${ready.stdout}${ready.stderr}`);
  return { parent, worktree };
}

async function removeBase(headRoot, base) {
  if (!base) return;
  await run('git', ['worktree', 'remove', '--force', base.worktree], { cwd: headRoot });
  rmSync(base.parent, { recursive: true, force: true });
  await run('git', ['worktree', 'prune'], { cwd: headRoot });
  const pruned = await run(process.execPath, [worktreeReady, 'prune'], { cwd: headRoot });
  process.stderr.write(`${pruned.stdout}${pruned.stderr}`);
}

// A comparison started from inside a Node test run inherits its
// NODE_TEST_CONTEXT, which makes each child `node --test` report to that run
// instead of printing TAP.
function testEnvironment() {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

async function runSides(options, sides) {
  const jobs = [];
  for (let index = 0; index < options.runs; index += 1) for (const side of sides) jobs.push(side);
  const results = new Map(sides.map((side) => [side, []]));
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const side = jobs[next];
      next += 1;
      const file = resolve(side.root, options.file);
      const output = await run(process.execPath, [
        ...options.nodeOptions, '--test', '--test-reporter=tap', `--test-name-pattern=${options.pattern}`, file,
      ], { cwd: side.root, env: testEnvironment() });
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

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const headRoot = realpathSync(await git(process.cwd(), 'rev-parse', '--show-toplevel'));
  const headSha = await git(headRoot, 'rev-parse', 'HEAD');
  const dirty = (await git(headRoot, 'status', '--porcelain')) !== '';
  const baseSha = await git(headRoot, 'rev-parse', '--verify', '--end-of-options', `${options.base}^{commit}`);
  let base;
  try {
    base = await prepareBase(headRoot, baseSha);
    const head = { root: headRoot };
    const baseSide = { root: base.worktree };
    const results = await runSides(options, [head, baseSide]);
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
    await removeBase(headRoot, base);
  }
}

main().catch((error) => {
  console.error(`head-vs-base: ${error.message}`);
  if (error instanceof UsageError) console.error(USAGE);
  process.exitCode = 2;
});
