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
    const ref = spawnSync('git', ['rev-parse', '--verify', '--quiet', candidate + '^{commit}'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    if (!ref.error && !ref.signal && ref.status === 1 && !requestedBase) continue;
    if (ref.error || ref.signal || ref.status !== 0) {
      throw new Error(`Could not resolve the selected comparison ${candidate}: ${ref.error?.message || ref.stderr?.trim() || ref.signal || `Git exited ${ref.status}`}`);
    }
    const result = spawnSync('git', ['merge-base', 'HEAD', ref.stdout.trim()], {
      cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
    if (result.status === 0 && /^[0-9a-f]{40}$/i.test(result.stdout.trim())) return result.stdout.trim();
    if (!result.error && !result.signal && result.status === 1 && !requestedBase) continue;
    throw new Error(`Could not compare HEAD with selected base ${candidate}: ${result.error?.message || result.stderr?.trim() || result.signal || `Git exited ${result.status}`}`);
  }
  const hint = requestedBase ? `from ${requestedBase}` : 'from origin/main, main, or master';
  throw new Error(`Could not resolve the test-first comparison base ${hint}; pass --base <ref>.`);
}

function resolveUpstream() {
  const git = (args, label) => {
    const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (result.error || result.signal || result.status !== 0) {
      throw new Error(`Could not read ${label}: ${result.error?.message || result.stderr?.trim() || result.signal || `Git exited ${result.status}`}`);
    }
    return result.stdout.trim();
  };
  // Detached checkouts have no branch upstream. Other Git failures must remain failures.
  const branch = spawnSync('git', ['symbolic-ref', '--quiet', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' });
  if (!branch.error && !branch.signal && branch.status === 1) return null;
  if (branch.error || branch.signal || branch.status !== 0) {
    throw new Error(`Could not read the current branch: ${branch.error?.message || branch.stderr?.trim() || branch.signal || `Git exited ${branch.status}`}`);
  }
  const ref = branch.stdout.trim();
  const row = git(['for-each-ref', '--format=%(refname) %(upstream)', ref], 'branch upstream')
    .split('\n').find(line => line === ref || line.startsWith(ref + ' '));
  if (row === undefined) throw new Error(`Could not find the current branch ${ref}.`);
  const upstream = row.slice(ref.length + 1).trim();
  if (!upstream) {
    // Git also prints an empty upstream when configured remote/merge keys cannot
    // map to a tracking ref. Only absent configuration means unpublished.
    const configured = spawnSync('git', ['config', '--get-regexp', `^branch\\.${escapeRegExp(ref.slice('refs/heads/'.length))}\\.(remote|merge)$`], {
      cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
    if (!configured.error && !configured.signal && configured.status === 1) return null;
    if (configured.error || configured.signal || configured.status !== 0) {
      throw new Error(`Could not read configured upstream for ${ref}: ${configured.error?.message || configured.stderr?.trim() || configured.signal || `Git exited ${configured.status}`}`);
    }
    throw new Error(`Could not resolve configured upstream for ${ref}; check its remote, merge ref and fetch mapping.`);
  }
  const sha = git(['rev-parse', '--verify', upstream + '^{commit}'], `published upstream comparison ${upstream}`);
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`Invalid published upstream comparison ${upstream}.`);
  return { sha, label: `published upstream ${upstream}` };
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

  let comparisons;
  try {
    const base = resolveBase(options.base);
    const upstream = resolveUpstream();
    comparisons = [{ sha: base, label: 'selected base' }];
    if (upstream && upstream.sha !== base) comparisons.push(upstream);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  for (const comparison of comparisons) {
    const label = `test-first/rationale validator (${comparison.label}, base ${comparison.sha})`;
    process.stdout.write(`\nPreflight: existing ${label}\n`);
    const rationale = runNode(['scripts/test-first-gate.mjs', comparison.sha]);
    const rationaleExit = failForResult(label, rationale);
    if (rationaleExit !== 0) return rationaleExit;
  }

  process.stdout.write('Preflight passed: focused help/copy checks and test-first/rationale validation.\n');
  process.stdout.write('This does not report full-suite, rules, compatibility, CI, release, or live results.\n');
  return 0;
}

process.exitCode = await main();
