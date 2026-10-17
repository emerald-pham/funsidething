#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const focusedChecks = [
  'Landscape location: visible default-sky copy does not name Orlando',
  'RISK Quick start content: essential steps stay brief and detailed help remains user-facing in existing sections',
];
const testNamePattern = `^(?:${focusedChecks.map(escapeRegExp).join('|')})$`;
const repositoryRoot = process.cwd();

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArguments(args) {
  let base = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true, base: null };
    if (argument === '--base') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--base needs a Git ref or commit SHA.');
      base = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { help: false, base };
}

function resolveBase(requestedBase) {
  const candidates = requestedBase ? [requestedBase] : ['origin/main', 'main', 'master'];
  for (const candidate of candidates) {
    const result = spawnSync('git', ['merge-base', 'HEAD', candidate], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    if (result.status === 0 && /^[0-9a-f]{40}$/i.test(result.stdout.trim())) return result.stdout.trim();
  }
  const hint = requestedBase ? `from ${requestedBase}` : 'from origin/main, main, or master';
  throw new Error(`Could not resolve the test-first comparison base ${hint}; pass --base <ref>.`);
}

function printOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function failForResult(label, result) {
  printOutput(result);
  if (result.error) {
    process.stderr.write(`Could not run ${label}: ${result.error.message}\n`);
    return 2;
  }
  if (result.signal) {
    process.stderr.write(`${label} was interrupted by ${result.signal}.\n`);
    return 2;
  }
  if (result.status !== 0) {
    process.stderr.write(`Preflight failed: ${label} exited ${result.status ?? 1}.\n`);
    return result.status ?? 1;
  }
  return 0;
}

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function printUsage() {
  process.stdout.write('Usage: node scripts/agent-tools/preflight.mjs [--base <ref>]\n');
  process.stdout.write('Runs the existing visible default-sky and Quick start FAQ contracts, then scripts/test-first-gate.mjs.\n');
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    printUsage();
    return 2;
  }
  if (options.help) {
    printUsage();
    return 0;
  }

  process.stdout.write('Preflight: existing help and copy contracts\n');
  for (const check of focusedChecks) process.stdout.write(`- ${check}\n`);
  process.stdout.write('Focused checks only; this command never launches the full test suite.\n\n');

  const tests = runNode([
    '--test',
    `--test-name-pattern=${testNamePattern}`,
    '--test-reporter=spec',
    'tests.js',
  ]);
  const testOutput = `${tests.stdout ?? ''}\n${tests.stderr ?? ''}`;
  const missingChecks = focusedChecks.filter(check =>
    !new RegExp(`^[✔✖] ${escapeRegExp(check)} \\(`, 'm').test(testOutput));
  const testExit = failForResult('focused help/copy tests', tests);
  if (missingChecks.length > 0) {
    process.stderr.write(`Preflight failed: expected ${focusedChecks.length} named help/copy checks to run; no result was reported for:\n`);
    for (const check of missingChecks) process.stderr.write(`- ${check}\n`);
    return testExit === 0 ? 1 : testExit;
  }
  if (testExit !== 0) return testExit;

  let base;
  try {
    base = resolveBase(options.base);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  process.stdout.write(`\nPreflight: existing test-first/rationale validator (base ${base})\n`);
  const rationale = runNode(['scripts/test-first-gate.mjs', base]);
  const rationaleExit = failForResult('test-first/rationale validator', rationale);
  if (rationaleExit !== 0) return rationaleExit;

  process.stdout.write('Preflight passed: focused help/copy checks and test-first/rationale validation.\n');
  process.stdout.write('This does not report full-suite, rules, compatibility, CI, release, or live results.\n');
  return 0;
}

process.exitCode = await main();
