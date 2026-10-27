#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseTap, validateCurrentRegistrations } from '../test-groups.mjs';

const contractIds = ['startup-browser', 'finite-authority', 'workflow-context'];
const assignmentPath = 'scripts/test-group-assignments.json';
const sha1Pattern = /^[0-9a-f]{40}$/;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail(message) {
  throw new Error(message);
}

function git(repo, args, label) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status !== 0) {
    fail(`Could not read ${label}: ${result.error?.message || result.stderr?.trim() || result.signal || `Git exited ${result.status}`}`);
  }
  return result.stdout;
}

function resolveCommit(repo, requested, label) {
  if (typeof requested !== 'string' || !requested.trim()) fail(`${label} is required.`);
  const resolved = git(repo, ['rev-parse', '--verify', `${requested}^{commit}`], label).trim();
  if (!sha1Pattern.test(resolved)) fail(`${label} did not resolve to a full commit SHA.`);
  return resolved;
}

function changedPaths(repo, base, head) {
  const bytes = git(repo, ['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', base, head, '--'], 'comparison paths');
  return [...new Set(bytes.split('\0').filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function validateTriggerPath(value, contractId) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\n') || value.includes('\\') ||
      path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) {
    fail(`Qualification contract ${contractId} has an unsafe trigger path.`);
  }
  return value;
}

function readContractAssignments(repo) {
  const file = path.join(repo, assignmentPath);
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) fail('The test-group assignment authority must be a regular nonsymlink file.');
  const bytes = readFileSync(file);
  let catalog;
  try { catalog = JSON.parse(bytes.toString('utf8')); }
  catch (error) { fail(`Could not read qualification contract assignments: ${error.message}`); }
  if (!Array.isArray(catalog.rootAssignments)) fail('The test-group assignment authority has no rootAssignments list.');
  const byId = new Map();
  const roots = new Set();
  for (const row of catalog.rootAssignments) {
    if (row.qualificationContract === undefined) continue;
    const contract = row.qualificationContract;
    const id = contract?.id;
    if (!contract || typeof contract !== 'object' || Array.isArray(contract) || !contractIds.includes(id)) {
      fail(`Unknown or malformed qualification contract metadata on root ${JSON.stringify(row.root)}.`);
    }
    if (byId.has(id)) fail(`Qualification contract ${id} is assigned more than once.`);
    if (typeof row.root !== 'string' || !row.root.trim() || row.group !== 'native-process' || row.file !== 'tests.js' || row.registration === 'dynamic') {
      fail(`Qualification contract ${id} must bind one literal native-process wrapper in tests.js.`);
    }
    if (roots.has(row.root)) fail(`Qualification contract roots overlap at ${JSON.stringify(row.root)}.`);
    roots.add(row.root);
    if (!Array.isArray(contract.triggerPaths) || !contract.triggerPaths.length) {
      fail(`Qualification contract ${id} must declare at least one changed-source trigger path.`);
    }
    const triggers = contract.triggerPaths.map(item => validateTriggerPath(item, id));
    if (new Set(triggers).size !== triggers.length) fail(`Qualification contract ${id} repeats a trigger path.`);
    byId.set(id, { id, root: row.root, group: row.group, file: row.file, triggerPaths: triggers });
  }
  for (const id of contractIds) {
    if (!byId.has(id)) fail(`Required qualification contract ${id} is missing from the existing root assignment authority.`);
  }
  if (byId.size !== contractIds.length) fail('The qualification contract assignment set is incomplete.');
  return { byId, bytes };
}

function normalizeRequestedIds(requestedIds, contracts) {
  if (requestedIds === undefined) return undefined;
  if (!Array.isArray(requestedIds) || !requestedIds.length) fail('Explicit selection requires at least one --select <contract-id>.');
  const seen = new Set();
  for (const id of requestedIds) {
    if (typeof id !== 'string' || !contracts.has(id)) fail(`Unknown qualification contract selection ${JSON.stringify(id)}.`);
    if (seen.has(id)) fail(`Qualification contract ${id} was selected more than once.`);
    seen.add(id);
  }
  return [...seen];
}

export function planQualificationContracts({ repo, comparisonBase, requestedIds } = {}) {
  if (typeof repo !== 'string' || !repo.trim()) fail('A repository worktree is required.');
  const requestedRoot = path.resolve(repo);
  const repository = realpathSync(requestedRoot);
  const topLevel = realpathSync(git(repository, ['rev-parse', '--show-toplevel'], 'Git worktree root').trim());
  if (topLevel !== repository) fail(`Repository path must be the Git worktree root (${topLevel}).`);
  const status = git(repository, ['status', '--porcelain=v1', '--untracked-files=all'], 'committed source status');
  if (status) fail('Qualification selection requires a clean committed source tree.');
  const sourceSha = resolveCommit(repository, 'HEAD', 'candidate source');
  const sourceTree = git(repository, ['rev-parse', `${sourceSha}^{tree}`], 'candidate tree').trim();
  if (!sha1Pattern.test(sourceTree)) fail('Candidate tree did not resolve to a full tree SHA.');
  const baseSha = resolveCommit(repository, comparisonBase, 'comparison base');
  const ancestor = spawnSync('git', ['-C', repository, 'merge-base', '--is-ancestor', baseSha, sourceSha], { encoding: 'utf8' });
  if (ancestor.error || ancestor.signal || ancestor.status !== 0) fail(`Comparison base ${baseSha} must be an ancestor of candidate ${sourceSha}.`);

  const registration = validateCurrentRegistrations({ root: repository });
  const assignments = readContractAssignments(repository);
  const selectedIds = normalizeRequestedIds(requestedIds, assignments.byId);
  const changed = changedPaths(repository, baseSha, sourceSha);
  const selected = (selectedIds ?? contractIds.filter(id => assignments.byId.get(id).triggerPaths.some(item => changed.includes(item))))
    .map(id => {
      const contract = assignments.byId.get(id);
      const matchingPaths = selectedIds ? [] : contract.triggerPaths.filter(item => changed.includes(item)).sort((left, right) => left.localeCompare(right));
      return {
        id: contract.id,
        root: contract.root,
        group: contract.group,
        file: contract.file,
        matchingPaths,
      };
    });
  const plan = {
    schemaVersion: 1,
    status: selected.length ? 'selected' : 'no_change',
    selectionBasis: selectedIds ? 'explicit-contract-selection' : 'changed-paths-from-comparison-base',
    sourceSha,
    sourceTree,
    comparisonBase: baseSha,
    changedPaths: changed,
    assignmentAuthority: {
      path: assignmentPath,
      sha256: sha256(assignments.bytes),
      validatedRootCount: registration.assignedRootCount,
    },
    selected,
  };
  plan.planSha256 = sha256(JSON.stringify(plan));
  return plan;
}

export function qualificationTestCommand(plan) {
  if (!plan || plan.status !== 'selected' || !Array.isArray(plan.selected) || !plan.selected.length) {
    fail('Only a nonempty selected qualification plan can produce a test command.');
  }
  const roots = plan.selected.map(contract => contract?.root);
  if (roots.some(root => typeof root !== 'string' || !root.trim()) || new Set(roots).size !== roots.length) {
    fail('Selected qualification roots must be unique assigned titles.');
  }
  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    executable: process.execPath,
    args: ['--test', '--test-reporter=tap', `--test-name-pattern=^(?:${roots.map(escapeRegExp).join('|')})$`, 'tests.js'],
  };
}

export function verifyQualificationOutcomes(plan, { exitCode, signal = null, launchError = null, stdout = '' } = {}) {
  if (!plan || plan.status !== 'selected' || !Array.isArray(plan.selected) || !plan.selected.length) {
    fail('Qualification outcomes require a nonempty selected plan.');
  }
  let cases = [];
  let parseError = null;
  try {
    cases = parseTap(stdout).filter(row => row.id === row.root);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  const expected = plan.selected.map(contract => contract.root).sort((a, b) => a.localeCompare(b));
  const outcomes = expected.map(root => {
    const observed = cases.filter(row => row.id === root && row.root === root);
    if (observed.length === 0) return { root, status: 'missing', count: 0 };
    if (observed.length !== 1) return { root, status: 'duplicate', count: observed.length };
    const result = observed[0];
    return { root, status: result.status, count: 1, skipReason: result.skipReason };
  });
  const actual = cases.map(row => row.id).sort((a, b) => a.localeCompare(b));
  const issues = [];
  if (launchError) issues.push(`Selected qualification child could not start: ${launchError.message || launchError}.`);
  if (signal) issues.push(`Selected qualification child was interrupted by ${signal}.`);
  if (exitCode !== 0) issues.push(`Selected qualification child exited ${exitCode ?? 'without an exit code'}.`);
  if (parseError) issues.push(`Selected qualification child did not produce valid TAP: ${parseError}.`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) issues.push('Selected qualification TAP roots do not match the exact selected contracts.');
  if (outcomes.some(item => item.status !== 'passed' || item.count !== 1)) issues.push('Every selected qualification contract must produce exactly one passing, non-skipped result.');
  return { status: issues.length ? 'failed' : 'passed', expected, outcomes, issues };
}

function parseArguments(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const options = { requestedIds: undefined };
  let sawSelect = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--repo', '--base', '--select'].includes(name)) fail(`Unknown argument: ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`${name} requires a value.`);
    if (name === '--select') {
      sawSelect = true;
      (options.requestedIds ??= []).push(value);
    } else {
      const key = name === '--repo' ? 'repo' : 'comparisonBase';
      if (options[key] !== undefined) fail(`${name} may be provided only once.`);
      options[key] = value;
    }
    index += 1;
  }
  if (!options.repo) fail('Required option: --repo <worktree>.');
  if (!options.comparisonBase) fail('Required option: --base <commit>.');
  if (sawSelect && !options.requestedIds?.length) fail('Explicit selection requires at least one --select <contract-id>.');
  return options;
}

function printUsage() {
  process.stdout.write('Usage: node scripts/agent-tools/qualification-contracts.mjs --repo <worktree> --base <commit> [--select <contract-id>]\n');
  process.stdout.write('Prints a source-bound selection plan from current assignment metadata; it never executes selected tests.\n');
}

function main(argv) {
  try {
    const options = parseArguments(argv);
    if (options.help) { printUsage(); return 0; }
    process.stdout.write(`${JSON.stringify(planQualificationContracts(options))}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`qualification-contracts: ${error instanceof Error ? error.message : String(error)}\n`);
    printUsage();
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
