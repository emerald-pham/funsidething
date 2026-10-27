#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivePolicyProseImpact, validatePolicyProseStatuses } from './release-evidence.mjs';

export const GROUP_IDS = ['core', 'scenery', 'persistence-recovery', 'native-process'];
const TEST_NAME_PATTERN_ARGUMENT_BUDGET = 64 * 1024;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_PATH = path.join(ROOT, 'scripts/test-group-inventory.json');
const ASSIGNMENTS_PATH = path.join(ROOT, 'scripts/test-group-assignments.json');
const sha1Pattern = /^[0-9a-f]{40}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };

function git(args, { encoding = 'utf8' } = {}) {
  return spawnSyncGit(args, encoding);
}

function spawnSyncGit(args, encoding) {
  const result = requireGit(args, encoding);
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  return result.stdout;
}

function requireGit(args, encoding) {
  // Keep git execution shell-free: refs and paths are data, never shell syntax.
  return spawnSync('git', args, { cwd: ROOT, encoding, maxBuffer: 64 * 1024 * 1024 });
}

function parseArgs(argv) {
  const values = {};
  const keyMap = new Map([
    ['--group', 'group'], ['--output-dir', 'outputDir'], ['--repository', 'repository'],
    ['--event-policy', 'eventPolicy'], ['--run-id', 'runId'], ['--run-attempt', 'runAttempt'],
    ['--source-sha', 'sourceSha'], ['--comparison-base', 'comparisonBase'], ['--results-dir','resultsDir'], ['--needs-json','needsJson'], ['--proof','proof'],
  ]);
  for (let index = 0; index < argv.length; index++) {
    if (['--describe','--aggregate','--covered'].includes(argv[index])) { values[argv[index].slice(2)] = true; continue; }
    const key = keyMap.get(argv[index]);
    if (!key) fail(`Unknown argument: ${argv[index]}`);
    if (values[key] !== undefined) fail(`Argument ${argv[index]} was provided more than once.`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) fail(`Argument ${argv[index - 1]} needs a value.`);
    values[key] = value;
  }
  const defaults = {
    repository: process.env.GITHUB_REPOSITORY,
    eventPolicy: process.env.CHAIN_TEST_EVENT_POLICY || process.env.GITHUB_EVENT_NAME,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    sourceSha: process.env.CHAIN_TEST_SOURCE_SHA || process.env.GITHUB_SHA,
    comparisonBase: process.env.CHAIN_TEST_COMPARISON_BASE,
  };
  for (const [key, value] of Object.entries(defaults)) if (values[key] === undefined) values[key] = value;
  return values;
}

function validateOutputDirectory(outputArgument) {
  if (typeof outputArgument !== 'string' || !outputArgument.trim()) fail('Pass a new, empty --output-dir for this group.');
  const outputDir = path.resolve(ROOT, outputArgument);
  const checkoutRealPath = fs.realpathSync(ROOT);
  let existingAncestor = outputDir;
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) fail('Could not find an existing parent for the group output directory.');
    existingAncestor = parent;
  }
  const existingRealPath = fs.realpathSync(existingAncestor);
  const projectedRealPath = path.resolve(existingRealPath, path.relative(existingAncestor, outputDir));
  if (isPathWithin(checkoutRealPath, projectedRealPath)) fail('Group evidence must be outside the checkout so it cannot contaminate another group or its identity.');
  fs.mkdirSync(outputDir, { recursive: true });
  const stat = fs.lstatSync(outputDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('The group output path must be a real directory, not a symlink.');
  if (isPathWithin(checkoutRealPath, fs.realpathSync(outputDir))) fail('Group evidence must be outside the checkout so it cannot contaminate another group or its identity.');
  if (fs.readdirSync(outputDir).length) fail('The group output directory must be empty; refusing to overwrite existing evidence.');
  return outputDir;
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function requiredIdentity(options) {
  for (const key of ['group', 'repository', 'eventPolicy', 'runId', 'runAttempt', 'sourceSha', 'comparisonBase']) {
    if (typeof options[key] !== 'string' || !options[key].trim()) fail(`Missing required group identity field: ${key}.`);
  }
  if (!GROUP_IDS.includes(options.group)) fail(`Unknown group ${JSON.stringify(options.group)}; expected ${GROUP_IDS.join(', ')}.`);
  if (!/^[^/\s]+\/[^/\s]+$/.test(options.repository)) fail('Repository identity must use owner/name form.');
  if (!/^[A-Za-z0-9_.-]+$/.test(options.eventPolicy)) fail('Event policy must be a compact policy/event identifier.');
  if (!/^[A-Za-z0-9_.:-]+$/.test(options.runId)) fail('Run id contains unsupported characters.');
  const runAttempt = Number(options.runAttempt);
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) fail('Run attempt must be a positive integer.');
  if (!sha1Pattern.test(options.sourceSha)) fail('Source SHA must be a full lowercase Git commit SHA.');
  if (!sha1Pattern.test(options.comparisonBase)) fail('Comparison base must be a full lowercase Git commit SHA.');
  return { ...options, runAttempt };
}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`Could not read ${label}: ${error.message}`); }
}

function testFiles() {
  const packageJson = readJson(path.join(ROOT, 'package.json'), 'package.json');
  if (packageJson.scripts?.test !== 'node --test tests.js scripts/agent-tools/*.test.mjs') {
    fail('The full npm test entry point changed; update the group runner contract explicitly before grouping this suite.');
  }
  const scriptFiles = fs.readdirSync(path.join(ROOT, 'scripts/agent-tools'))
    .filter(file => file.endsWith('.test.mjs'))
    .sort()
    .map(file => `scripts/agent-tools/${file}`);
  const files = ['tests.js', ...scriptFiles];
  for (const file of files) if (!fs.statSync(path.join(ROOT, file)).isFile()) fail(`Missing full-suite file ${file}.`);
  return files;
}

function validateInventory(inventory) {
  if (inventory?.schemaVersion !== 1 || !inventory.baseline || !Array.isArray(inventory.rootTests) ||
      !Array.isArray(inventory.requiredCases) || !Array.isArray(inventory.acceptedSkipCaseIds)) {
    fail('The independently captured required-case inventory has an unsupported or incomplete shape.');
  }
  const { caseCount, passed, skipped, failed } = inventory.baseline;
  if (![caseCount, passed, skipped, failed].every(Number.isSafeInteger) ||
      caseCount <= 0 || passed < 0 || skipped < 0 || failed !== 0 || passed + skipped !== caseCount ||
      inventory.requiredCases.length !== caseCount || inventory.acceptedSkipCaseIds.length !== skipped) {
    fail('Baseline case, pass, skip, and failure totals do not reconcile with the independent inventory.');
  }
  const roots = new Set();
  for (const root of inventory.rootTests) {
    if (!root || typeof root.id !== 'string' || !root.id.trim() || roots.has(root.id) ||
        !Number.isFinite(root.durationMs) || root.durationMs < 0) fail('Baseline root identities must be unique and carry measured durations.');
    roots.add(root.id);
  }
  const cases = new Map();
  for (const item of inventory.requiredCases) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.root !== 'string' ||
        !roots.has(item.root) || cases.has(item.id)) fail('Every baseline case must have one unique identity and a known root.');
    if (item.id !== item.root && !item.id.startsWith(`${item.root} > `)) {
      fail(`Baseline case ${JSON.stringify(item.id)} does not belong to its declared root.`);
    }
    cases.set(item.id, item.root);
  }
  if (new Set(inventory.acceptedSkipCaseIds).size !== inventory.acceptedSkipCaseIds.length ||
      inventory.acceptedSkipCaseIds.some(id => !cases.has(id))) {
    fail('Accepted skip identities must be unique members of the independently captured required cohort.');
  }
  for (const key of ['repository', 'runId', 'eventPolicy', 'sourceSha', 'sourceTree', 'checkoutSha', 'checkoutTree', 'comparisonBase']) {
    if (typeof inventory.baseline[key] !== 'string' || !inventory.baseline[key]) fail(`Baseline identity is missing ${key}.`);
  }
  for (const key of ['sourceSha', 'sourceTree', 'checkoutSha', 'checkoutTree', 'comparisonBase']) {
    if (!sha1Pattern.test(inventory.baseline[key])) fail(`Baseline ${key} must be a full lowercase SHA.`);
  }
  return { roots, cases };
}

function validateAssignments(assignments, inventory, inventoryIndex, files) {
  if (assignments?.schemaVersion !== 1 || !Array.isArray(assignments.groups) ||
      !Array.isArray(assignments.rootAssignments) || !Array.isArray(assignments.processControls)) {
    fail('The explicit group assignment map is malformed.');
  }
  const groupIds = assignments.groups.map(group => group?.id);
  if (JSON.stringify(groupIds) !== JSON.stringify(GROUP_IDS)) fail(`Required groups must appear exactly once in this stable order: ${GROUP_IDS.join(', ')}.`);
  if (typeof assignments.assignmentMethod !== 'string' || assignments.assignmentMethod.trim().length < 20) {
    fail('The measured group assignment method must be documented.');
  }
  for (const group of assignments.groups) {
    if (!group.description || group.resourcePolicy !== 'isolated-process' || group.withinGroupConcurrency !== 1) {
      fail(`Group ${group.id} must declare an isolated process and serial within-group execution.`);
    }
  }
  const groupSet = new Set(groupIds);
  const fileSet = new Set(files);
  const replacementEntries = assignments.rootReplacements || [];
  if (!Array.isArray(replacementEntries)) fail('rootReplacements must be an array when present.');
  const replacementByBaseline = new Map();
  const replacementTargets = new Set();
  for (const replacement of replacementEntries) {
    if (!replacement || typeof replacement.baselineRoot !== 'string' || typeof replacement.currentRoot !== 'string' ||
        !groupSet.has(replacement.group) || replacement.baselineGroup !== replacement.group || !fileSet.has(replacement.file) ||
        typeof replacement.reason !== 'string' || replacement.reason.trim().length < 20 ||
        replacementByBaseline.has(replacement.baselineRoot) || replacementTargets.has(replacement.currentRoot) ||
        replacement.baselineRoot === replacement.currentRoot) {
      fail('Root replacement records must be unique, explicit, justified, and identify a current suite file/group.');
    }
    if (!inventoryIndex.roots.has(replacement.baselineRoot)) fail(`Replacement source ${JSON.stringify(replacement.baselineRoot)} is not a baseline root.`);
    replacementByBaseline.set(replacement.baselineRoot, replacement);
    replacementTargets.add(replacement.currentRoot);
  }

  const assignmentsByRoot = new Map();
  for (const entry of assignments.rootAssignments) {
    if (!entry || typeof entry.root !== 'string' || !groupSet.has(entry.group) || !fileSet.has(entry.file)) {
      fail('Every root assignment must name a known group and full-suite source file.');
    }
    if (entry.registration !== undefined && !['literal','dynamic'].includes(entry.registration)) fail('Unknown root registration policy.');
    if (assignmentsByRoot.has(entry.root)) fail(`Root ${JSON.stringify(entry.root)} has overlapping group assignments.`);
    assignmentsByRoot.set(entry.root, entry);
  }
  const assignedRootIds = new Set(assignmentsByRoot.keys());
  for (const root of inventoryIndex.roots) {
    const replacement = replacementByBaseline.get(root);
    const currentId = replacement?.currentRoot || root;
    const assignment = assignmentsByRoot.get(currentId);
    if (!assignment) fail(`Baseline root ${JSON.stringify(root)} has no assigned current root.`);
    if (replacement && (assignment.group !== replacement.group || assignment.file !== replacement.file)) {
      fail(`Replacement ${JSON.stringify(root)} must remain in its declared historical group and source file.`);
    }
  }
  for (const replacement of replacementEntries) {
    if (!assignedRootIds.has(replacement.currentRoot)) fail(`Replacement target ${JSON.stringify(replacement.currentRoot)} is not assigned exactly once.`);
  }

  const baselineRoots = inventoryIndex.roots;
  for (const root of assignedRootIds) {
    if (baselineRoots.has(root) && replacementTargets.has(root)) fail(`Root ${JSON.stringify(root)} is both historical and a replacement target.`);
  }
  const allReplacedSources = new Set(replacementByBaseline.keys());
  for (const root of assignedRootIds) {
    if (baselineRoots.has(root) || replacementTargets.has(root)) continue;
    if (allReplacedSources.has(root)) fail(`Historical root ${JSON.stringify(root)} must be represented through its replacement target only.`);
  }

  const durationByRoot = new Map(inventory.rootTests.map(item => [item.id, item.durationMs]));
  const currentRootToBaseline = new Map();
  const measuredByGroup = new Map(GROUP_IDS.map(id => [id, { rootCount: 0, durationMs: 0 }]));
  for (const root of assignedRootIds) {
    if (baselineRoots.has(root)) currentRootToBaseline.set(root, root);
  }
  for (const replacement of replacementEntries) currentRootToBaseline.set(replacement.currentRoot, replacement.baselineRoot);
  for (const baselineRoot of baselineRoots) {
    const replacement = replacementByBaseline.get(baselineRoot);
    const currentRoot = replacement?.currentRoot || baselineRoot;
    const assignment = assignmentsByRoot.get(currentRoot);
    const measured = measuredByGroup.get(assignment.group);
    measured.rootCount++;
    measured.durationMs += durationByRoot.get(baselineRoot);
  }
  for (const group of assignments.groups) {
    const measured = measuredByGroup.get(group.id);
    if (group.baselineRootCount !== measured.rootCount || !Number.isFinite(group.baselineEstimatedDurationMs) ||
        Math.abs(group.baselineEstimatedDurationMs - measured.durationMs) > 0.01) {
      fail(`Group ${group.id} measured-root count/duration does not reconcile with the independent baseline.`);
    }
  }
  for (const replacement of replacementEntries) {
    if (!durationByRoot.has(replacement.baselineRoot)) fail('Replacement source must retain its measured historical duration.');
  }

  const rootsPerGroup = new Map(GROUP_IDS.map(id => [id, []]));
  for (const [root, assignment] of assignmentsByRoot) rootsPerGroup.get(assignment.group).push(root);
  for (const [group, roots] of rootsPerGroup) if (!roots.length) fail(`Required group ${group} is empty.`);

  const processControls = assignments.processControls;
  const controlIds = new Set();
  for (const control of processControls) {
    const owner = assignmentsByRoot.get(control?.ownerRoot);
    if (!control || typeof control.id !== 'string' || controlIds.has(control.id) || !owner ||
        !groupSet.has(control.group) || !fileSet.has(control.file) || control.expectedExecutions !== 1 ||
        owner.group !== control.group || owner.file !== control.file) {
      fail('Controlled process children need one source declaration, one assigned owner root, and exactly one execution.');
    }
    controlIds.add(control.id);
  }
  return { assignmentsByRoot, currentRootToBaseline, replacementByBaseline, replacementTargets, rootsPerGroup };
}

function cohortDigest(inventory, assignments, assignmentIndex) {
  const requiredCaseIds = inventory.requiredCases.map(item => {
    const replacement = assignmentIndex.replacementByBaseline.get(item.root);
    return replacement ? replacementCaseId(item.id, replacement) : item.id;
  }).sort();
  const rootAssignments = [...assignmentIndex.assignmentsByRoot.values()]
    .map(({ root, group, file }) => ({ root, group, file }))
    .sort((left, right) => left.root.localeCompare(right.root));
  const rootReplacements = [...assignmentIndex.replacementByBaseline.values()]
    .map(({ baselineRoot, currentRoot, baselineGroup, group, file }) => ({ baselineRoot, currentRoot, baselineGroup, group, file }))
    .sort((left, right) => left.baselineRoot.localeCompare(right.baselineRoot));
  const processControls = assignments.processControls
    .map(({ id, group, file, ownerRoot, expectedExecutions }) => ({ id, group, file, ownerRoot, expectedExecutions }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return sha256(JSON.stringify({ expectedGroups: GROUP_IDS, requiredCaseIds, rootAssignments, rootReplacements, processControls }));
}

function addedRootRegistrations(comparisonBase, files) {
  const diff = git(['diff', '--no-ext-diff', '--unified=0', comparisonBase, '--', ...files]);
  const names = new Set();
  const capture = line => {
    const match = line.match(/^\s*test\s*\(\s*(['"])(.*?)\1/);
    if (match) names.add(match[2]);
  };
  for (const line of diff.split('\n')) if (line.startsWith('+') && !line.startsWith('+++')) capture(line.slice(1));
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...files]).split('\n').filter(Boolean);
  for (const file of untracked) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const line of source.split('\n')) capture(line);
  }
  return names;
}

function validateAddedRegistrations(assignments, inventoryIndex, index, files, inventorySourceSha) {
  const added = addedRootRegistrations(inventorySourceSha, files);
  const baseline = inventoryIndex.roots;
  const mappedBaseline = new Set(index.replacementByBaseline.keys());
  for (const replacement of index.replacementByBaseline.values()) {
    if (!added.has(replacement.currentRoot)) {
      fail(`Replacement title ${JSON.stringify(replacement.currentRoot)} must appear as an added test registration in the comparison diff.`);
    }
  }
  for (const root of index.assignmentsByRoot.keys()) {
    if (baseline.has(root) || index.replacementTargets.has(root)) continue;
    if (!added.has(root) && index.assignmentsByRoot.get(root).registration !== 'dynamic') fail(`Newly assigned root ${JSON.stringify(root)} has no added test registration in the comparison diff.`);
  }
  for (const title of added) {
    const assignment = index.assignmentsByRoot.get(title);
    const controlled = assignments.processControls.some(control => control.id === title);
    if (!assignment && !controlled) fail(`New top-level test ${JSON.stringify(title)} has no explicit group assignment or process-control declaration.`);
  }
  const addedRootTitles = [...index.assignmentsByRoot.keys()].filter(root => !baseline.has(root)).sort();
  return { addedRootTitles, mappedBaselineRoots: [...mappedBaseline].sort() };
}

function replacementCaseId(id, replacement) {
  if (id === replacement.baselineRoot) return replacement.currentRoot;
  const prefix = `${replacement.baselineRoot} > `;
  if (!id.startsWith(prefix)) fail(`Baseline case ${JSON.stringify(id)} does not belong to replacement source ${JSON.stringify(replacement.baselineRoot)}.`);
  return `${replacement.currentRoot}${id.slice(replacement.baselineRoot.length)}`;
}

function sourceIdentity(options) {
  const checkoutSha = git(['rev-parse', 'HEAD']).trim();
  const checkoutTree = git(['rev-parse', 'HEAD^{tree}']).trim();
  const sourceTree = git(['rev-parse', `${options.sourceSha}^{tree}`]).trim();
  const baseSha = git(['rev-parse', `${options.comparisonBase}^{commit}`]).trim();
  if (checkoutSha !== git(['rev-parse', 'HEAD^{commit}']).trim() || !sha1Pattern.test(checkoutTree) ||
      !sha1Pattern.test(sourceTree) || baseSha !== options.comparisonBase) fail('Git checkout, source, or comparison-base identity is not canonical.');
  const diff = git(['diff', '--binary', 'HEAD', '--']);
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean).sort();
  const untrackedHash = createHash('sha256');
  for (const file of untracked) {
    const absolute = path.join(ROOT, file);
    const stat = fs.lstatSync(absolute);
    untrackedHash.update(file + '\0');
    if (stat.isSymbolicLink()) untrackedHash.update(`symlink:${fs.readlinkSync(absolute)}`);
    else if (stat.isFile()) untrackedHash.update(fs.readFileSync(absolute));
    else untrackedHash.update(`non-file:${stat.mode}`);
    untrackedHash.update('\0');
  }
  return {
    sha: checkoutSha,
    tree: checkoutTree,
    dirty: status.trim().length > 0,
    workingTreeSha256: sha256(`${diff}\0${status}\0${untrackedHash.digest('hex')}`),
    sourceTree,
  };
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function normalizeTapIdentity(value) {
  let normalized = '';
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '\\' && index + 1 < value.length && (value[index + 1] === '\\' || value[index + 1] === '#')) {
      normalized += value[++index];
    } else normalized += value[index];
  }
  return normalized;
}

function countTestRegistrations(source, testName) {
  let count = 0;
  let index = 0;
  let pendingTestCall = false;
  let awaitingTitle = false;
  let previousToken = null;
  const expressionPrefixes = new Set(['(', '[', '{', ',', ':', ';', '=', '!', '?', '&&', '||', '??', '=>',
    'return', 'throw', 'case', 'delete', 'void', 'typeof', 'yield', 'await', 'in', 'of', 'instanceof']);
  const regexCanStartAfter = token => token === null || expressionPrefixes.has(token);
  const readQuoted = (start, quote) => {
    let value = '';
    let escaped = false;
    let cursor = start + 1;
    while (cursor < source.length) {
      const character = source[cursor++];
      if (character === quote) return { value, escaped, next: cursor };
      if (character === '\\') {
        escaped = true;
        if (cursor < source.length) value += source[cursor++];
      } else value += character;
    }
    return { value: null, escaped: true, next: cursor };
  };
  const skipRegex = start => {
    let cursor = start + 1;
    let inCharacterClass = false;
    while (cursor < source.length) {
      const character = source[cursor++];
      if (character === '\\') { cursor++; continue; }
      if (character === '[') inCharacterClass = true;
      else if (character === ']') inCharacterClass = false;
      else if (character === '/' && !inCharacterClass) {
        while (/[a-z]/i.test(source[cursor] || '')) cursor++;
        return cursor;
      } else if (character === '\n' || character === '\r') return cursor;
    }
    return cursor;
  };
  const skipTemplate = start => {
    const modes = [{ kind: 'template' }];
    let cursor = start + 1;
    let prior = null;
    while (cursor < source.length && modes.length) {
      const mode = modes.at(-1);
      const character = source[cursor];
      if (mode.kind === 'template') {
        if (character === '\\') { cursor += 2; continue; }
        if (character === '`') { modes.pop(); cursor++; continue; }
        if (character === '$' && source[cursor + 1] === '{') {
          modes.push({ kind: 'expression', depth: 1 });
          cursor += 2;
          prior = null;
          continue;
        }
        cursor++;
        continue;
      }
      if (/\s/.test(character)) { cursor++; continue; }
      if (source.startsWith('//', cursor)) {
        const newline = source.indexOf('\n', cursor + 2);
        cursor = newline < 0 ? source.length : newline + 1;
        continue;
      }
      if (source.startsWith('/*', cursor)) {
        const close = source.indexOf('*/', cursor + 2);
        cursor = close < 0 ? source.length : close + 2;
        continue;
      }
      if (character === "'" || character === '"') {
        cursor = readQuoted(cursor, character).next;
        prior = 'string';
        continue;
      }
      if (character === '`') {
        modes.push({ kind: 'template' });
        cursor++;
        continue;
      }
      if (character === '/' && regexCanStartAfter(prior)) {
        cursor = skipRegex(cursor);
        prior = 'regex';
        continue;
      }
      if (character === '{') mode.depth++;
      else if (character === '}' && --mode.depth === 0) { modes.pop(); cursor++; continue; }
      if (/[A-Za-z_$]/.test(character)) {
        const wordStart = cursor++;
        while (/[\w$]/.test(source[cursor] || '')) cursor++;
        prior = source.slice(wordStart, cursor);
        continue;
      }
      prior = character;
      cursor++;
    }
    return cursor;
  };
  // Count direct test(<plain string>, ...) tokens in code; strings, comments,
  // templates, and regular expressions are opaque, and dynamic titles fail closed.
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) { index++; continue; }
    if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index + 2);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      index = close < 0 ? source.length : close + 2;
      continue;
    }
    if (character === "'" || character === '"') {
      const literal = readQuoted(index, character);
      if (awaitingTitle && !literal.escaped && literal.value === testName) count++;
      awaitingTitle = false;
      pendingTestCall = false;
      previousToken = 'string';
      index = literal.next;
      continue;
    }
    if (character === '`') {
      index = skipTemplate(index);
      awaitingTitle = false;
      pendingTestCall = false;
      previousToken = 'template';
      continue;
    }
    if (character === '/' && regexCanStartAfter(previousToken)) {
      index = skipRegex(index);
      awaitingTitle = false;
      pendingTestCall = false;
      previousToken = 'regex';
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const wordStart = index++;
      while (/[\w$]/.test(source[index] || '')) index++;
      const token = source.slice(wordStart, index);
      if (awaitingTitle) awaitingTitle = false;
      pendingTestCall = token === 'test' && previousToken !== '.' && previousToken !== '?.';
      previousToken = token;
      continue;
    }
    const token = character === '?' && source[index + 1] === '.' ? '?.' : character;
    if (pendingTestCall && token === '(') {
      awaitingTitle = true;
      pendingTestCall = false;
    } else {
      if (awaitingTitle) awaitingTitle = false;
      pendingTestCall = false;
    }
    previousToken = token;
    index += token.length;
  }
  return count;
}

function testNamePatternArguments(roots) {
  const argumentsForPatterns = [];
  let currentRoots = [];
  const makeArgument = selectedRoots => `--test-name-pattern=^(?:${selectedRoots.map(escapeRegExp).join('|')})$`;
  for (const root of roots) {
    const candidate = [...currentRoots, root];
    const candidateArgument = makeArgument(candidate);
    if (Buffer.byteLength(candidateArgument) > TEST_NAME_PATTERN_ARGUMENT_BUDGET) {
      if (!currentRoots.length) fail(`Root title ${JSON.stringify(root)} exceeds the portable Node test pattern argument budget.`);
      argumentsForPatterns.push(makeArgument(currentRoots));
      currentRoots = [root];
      if (Buffer.byteLength(makeArgument(currentRoots)) > TEST_NAME_PATTERN_ARGUMENT_BUDGET) {
        fail(`Root title ${JSON.stringify(root)} exceeds the portable Node test pattern argument budget.`);
      }
    } else currentRoots = candidate;
  }
  if (currentRoots.length) argumentsForPatterns.push(makeArgument(currentRoots));
  if (!argumentsForPatterns.length) fail('The selected group has no test roots to execute.');
  return argumentsForPatterns;
}

function parseTap(text) {
  if (!/^TAP version \d+/m.test(text)) fail('The test process did not produce a TAP stream.');
  const stack = [];
  const cases = [];
  const resultLine = /^(\s*)(not )?ok \d+ - (.*?)(?: # (SKIP|TODO)(?:\s+(.*))?)?\s*$/;
  const subtestLine = /^(\s*)# Subtest: (.*)$/;
  for (const line of text.split(/\r?\n/)) {
    const subtest = line.match(subtestLine);
    if (subtest) {
      const indentation = subtest[1].length;
      while (stack.length && stack.at(-1).indentation >= indentation) stack.pop();
      stack.push({ indentation, name: subtest[2] });
      continue;
    }
    const result = line.match(resultLine);
    if (!result) continue;
    const indentation = result[1].length;
    const active = stack.filter(item => item.indentation <= indentation);
    if (!active.length) fail(`Could not associate TAP result with a test identity: ${line}`);
    const names = active.map(item => normalizeTapIdentity(item.name));
    const directive = result[4]?.toLowerCase();
    cases.push({
      id: names.join(' > '),
      root: names[0],
      status: directive === 'skip' ? 'skipped' : directive === 'todo' ? 'todo' : result[2] ? 'failed' : 'passed',
      skipReason: directive === 'skip' ? (result[5] || '').trim() : null,
      line,
    });
  }
  return cases;
}

function expectedCasesForGroup(inventory, assignments, group) {
  const roots = new Map(assignments.assignmentsByRoot);
  const expected = new Map();
  for (const item of inventory.requiredCases) {
    const replacement = assignments.replacementByBaseline.get(item.root);
    const currentRoot = replacement?.currentRoot || item.root;
    const assignment = roots.get(currentRoot);
    if (assignment?.group === group) {
      const currentId = replacement ? replacementCaseId(item.id, replacement) : item.id;
      expected.set(normalizeTapIdentity(currentId), item.id);
    }
  }
  return expected;
}

function verifyResults({ cases, group, inventory, assignments, files, source }) {
  const errors = [];
  const selectedRoots = [...assignments.assignmentsByRoot.values()]
    .filter(entry => entry.group === group)
    .map(entry => normalizeTapIdentity(entry.root))
    .sort();
  const selectedRootSet = new Set(selectedRoots);
  const actualRoots = cases.filter(item => item.id === item.root).map(item => item.root);
  const seenRoots = new Set();
  for (const root of actualRoots) {
    if (seenRoots.has(root)) errors.push(`Root ${JSON.stringify(root)} executed more than once.`);
    seenRoots.add(root);
  }
  for (const root of selectedRoots) if (!seenRoots.has(root)) errors.push(`Assigned root ${JSON.stringify(root)} did not execute.`);
  for (const root of seenRoots) if (!selectedRootSet.has(root)) errors.push(`Unassigned or wrong-group root ${JSON.stringify(root)} executed.`);

  const expected = expectedCasesForGroup(inventory, assignments, group);
  const actualById = new Map();
  for (const item of cases) {
    if (actualById.has(item.id)) errors.push(`Case ${JSON.stringify(item.id)} executed more than once.`);
    actualById.set(item.id, item);
    if (!selectedRootSet.has(item.root)) errors.push(`Case ${JSON.stringify(item.id)} belongs to a root outside ${group}.`);
  }
  for (const id of expected.keys()) if (!actualById.has(id)) errors.push(`Required baseline case ${JSON.stringify(id)} is missing.`);
  const acceptedSkips = new Set(inventory.acceptedSkipCaseIds.map(id => {
    const root = inventory.requiredCases.find(item => item.id === id)?.root;
    const replacement = assignments.replacementByBaseline.get(root);
    return normalizeTapIdentity(replacement ? replacementCaseId(id, replacement) : id);
  }));
  for (const item of cases) {
    if (item.status === 'failed') errors.push(`Test case failed: ${item.id}`);
    else if (item.status === 'todo') errors.push(`Test case was unexpectedly marked TODO: ${item.id}`);
    else if (item.status === 'skipped' && !acceptedSkips.has(item.id)) errors.push(`Test case was unexpectedly skipped: ${item.id}`);
  }
  const requiredSkipResults = [...acceptedSkips].filter(id => expected.has(id));
  for (const id of requiredSkipResults) if (actualById.get(id)?.status !== 'skipped' && actualById.get(id)?.status !== 'passed') {
    errors.push(`Accepted environment-dependent baseline case ${JSON.stringify(id)} is missing or invalid.`);
  }

  for (const control of assignments.processControls.filter(item => item.group === group)) {
    const sourceText = fs.readFileSync(path.join(ROOT, control.file), 'utf8');
    const registrations = countTestRegistrations(sourceText, control.id);
    if (registrations !== control.expectedExecutions) errors.push(`Controlled child ${JSON.stringify(control.id)} is registered ${registrations} times; expected exactly ${control.expectedExecutions}.`);
    if (!cases.some(item => item.id === normalizeTapIdentity(control.ownerRoot) && item.status === 'passed')) {
      errors.push(`Controlled child owner root ${JSON.stringify(control.ownerRoot)} did not pass exactly once.`);
    }
  }
  if (!cases.length) errors.push('The selected required group produced an empty result cohort.');
  if (!files.length) errors.push(`Required group ${group} has no test source files.`);
  if (!source) errors.push('The source checkout identity was unavailable.');
  return errors;
}

function artifactInventory(nativeDir) {
  const artifacts = [];
  const visit = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) fail(`Native evidence contains an unowned symbolic link: ${absolute}`);
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) artifacts.push({
        path: path.relative(path.dirname(nativeDir), absolute).split(path.sep).join('/'),
        bytes: stat.size,
        sha256: sha256(fs.readFileSync(absolute)),
      });
      else fail(`Native evidence contains a non-regular file: ${absolute}`);
    }
  };
  visit(nativeDir);
  return artifacts;
}

function coverageReference(proof, identity) {
  if (!['reuse','policy-reuse'].includes(proof?.decision) || String(proof.runId)!==String(identity.runId) || String(proof.runAttempt)!==String(identity.runAttempt)) fail('Covered mode requires a verified current-run routing proof.');
  for (const key of ['repository','sourceSha','sourceTree','checkoutSha','checkoutTree','comparisonBase']) if(proof.validationContext?.[key]!==identity[key])fail(`Coverage validation context mismatch: ${key}.`);
  const context=proof.cohortContext,producer=proof.coveredBy;
  let policyCoverage;
  if (proof.decision === 'policy-reuse') {
    const impact = derivePolicyProseImpact(ROOT, identity.sourceSha, identity.comparisonBase);
    if (!impact || JSON.stringify(impact) !== JSON.stringify(proof.policyImpact) || identity.sourceTree !== impact.sourceTree || identity.checkoutTree !== impact.sourceTree) fail('Policy inheritance inventory does not match the exact current source and checkout.');
    const review = validatePolicyProseStatuses(ROOT, proof.policyReview?.sourceSha, identity.comparisonBase, proof.policyStatuses);
    if (JSON.stringify(review) !== JSON.stringify(proof.policyReview) || git(['rev-parse', `${review.sourceSha}^{tree}`]).trim() !== identity.sourceTree) fail('Policy inheritance current review is stale.');
    if (context?.repository !== identity.repository || context.sourceSha !== identity.comparisonBase || context.sourceTree !== impact.baseTree || context.checkoutSha !== identity.comparisonBase || context.checkoutTree !== impact.baseTree || context.comparisonBase !== git(['rev-parse', `${identity.comparisonBase}^`]).trim()) fail('Policy inheritance producer does not bind the exact unchanged base tree.');
    policyCoverage = {policyImpact:impact, policyReview:review};
  } else for(const key of ['repository','sourceSha','sourceTree'])if(context?.[key]!==identity[key])fail(`Coverage producer source context mismatch: ${key}.`);
  if(identity.checkoutDirty || context?.requiredCohort!=='four-groups-v1' || proof.contextSha256!==sha256(JSON.stringify(context)))fail('Coverage context is incomplete or dirty.');
  for(const key of ['cohortDigestSha256','inventorySha256','assignmentsSha256','expectedGroups'])if(JSON.stringify(context[key])!==JSON.stringify(identity[key]))fail(`Coverage cohort mismatch: ${key}.`);
  if(!/^[1-9][0-9]*$/.test(producer?.runId)||!/^[1-9][0-9]*$/.test(producer?.runAttempt)||!/^[a-f0-9]{64}$/.test(producer?.reportSha256)||!['checkoutSha','checkoutTree','comparisonBase'].every(key=>sha1Pattern.test(producer[key])&&producer[key]===context[key]))fail('Original full producer run/attempt/report identity is missing.');
  return {contextSha256:proof.contextSha256,cohortContext:context,coveredBy:producer,...(policyCoverage || {})};
}

function aggregateResults({options, outputDir, descriptor, inventory, assignmentIndex, assignments, files, source}) {
  if (!options.resultsDir || !options.needsJson) fail('Aggregate requires --results-dir and --needs-json.');
  const needs = readJson(options.needsJson, 'actual workflow predecessor results');
  const issues = [], records = [], allCases = new Set();
  const policyCovered=needs['cohort-routing']?.outputs?.decision==='policy-reuse';
  const covered=policyCovered || needs['cohort-routing']?.outputs?.decision==='reuse';
  const freshCoverage=covered?coverageReference(readJson(options.proof,'fresh full-producer proof'),descriptor.resultIdentity):null;
  for (const id of ['validation-context','event-gates','cohort-routing','regression']) {
    if (needs[id]?.result !== 'success') issues.push(`Required job ${id} did not succeed: ${needs[id]?.result || 'missing'}.`);
  }
  const directories = fs.readdirSync(options.resultsDir).filter(name => fs.lstatSync(path.join(options.resultsDir,name)).isDirectory());
  if (JSON.stringify([...directories].sort()) !== JSON.stringify([...GROUP_IDS].sort())) issues.push('Required group directories are missing or unknown.');
  const verifiedFile = (root, relative, expected, bytes) => {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '..' || part === '.')) fail('Unsafe artifact path.');
    let current = root;
    for (const part of relative.split('/')) { current = path.join(current,part); if (fs.lstatSync(current).isSymbolicLink()) fail('Artifact symlinks are forbidden.'); }
    const stat = fs.lstatSync(current);
    if (!stat.isFile() || (bytes !== undefined && stat.size !== bytes)) fail(`Artifact missing or wrong size: ${relative}.`);
    const content = fs.readFileSync(current);
    if (sha256(content) !== expected) fail(`Artifact hash mismatch: ${relative}.`);
    return content;
  };
  for (const id of GROUP_IDS) {
    try {
      const root = path.resolve(options.resultsDir,id);
      if (fs.lstatSync(root).isSymbolicLink()) fail('Group evidence must be a real directory.');
      const record = readJson(path.join(root,'result.json'),`required result for ${id}`);
      if (record.status !== (covered?'covered':'passed') || record.issues?.length || !Array.isArray(record.issues)) fail(`Required group ${id} did not pass.`);
      const identity = record.resultIdentity;
      for (const [key,value] of Object.entries(descriptor.resultIdentity)) {
        if (key === 'selectedGroup') continue;
        if (JSON.stringify(identity?.[key]) !== JSON.stringify(value)) fail(`Required group ${id} identity mismatch: ${key}.`);
      }
      if (identity?.selectedGroup !== id || identity.checkoutDirty) fail(`Wrong or dirty group identity: ${id}.`);
      if(covered){
        if(record.cases?.length!==0||record.artifacts?.length!==0||record.process!==null||JSON.stringify(record.coverage)!==JSON.stringify(freshCoverage))fail('Covered records are mixed, incomplete or claim current execution.');
        records.push({group:id,mode:'covered',identity,coverage:record.coverage});continue;
      }
      if (record.process?.exitCode !== 0 || record.process?.signal || record.process?.spawnError) fail(`Required group ${id} process failed or was canceled.`);
      const tap = verifiedFile(root,record.process.stdout.path,record.process.stdout.sha256).toString('utf8');
      verifiedFile(root,record.process.stderr.path,record.process.stderr.sha256);
      const cases = parseTap(tap).map(({id,root,status,skipReason}) => ({id,root,status,skipReason}));
      if (JSON.stringify(cases) !== JSON.stringify(record.cases)) fail(`Required group ${id} case report differs from actual TAP.`);
      const errors = verifyResults({cases,group:id,inventory,assignments:{...assignmentIndex,processControls:assignments.processControls},files,source});
      if (errors.length) fail(errors.join(' '));
      for (const item of cases) { if (allCases.has(item.id)) fail(`Duplicate case across groups: ${item.id}.`); allCases.add(item.id); }
      const artifactPaths = new Set();
      for (const artifact of record.artifacts || []) {
        if (artifactPaths.has(artifact.path)) fail('Duplicate native/recovery artifact path.');
        artifactPaths.add(artifact.path); verifiedFile(root,artifact.path,artifact.sha256,artifact.bytes);
      }
      const actualArtifacts=['native','recovery-ui'].flatMap(name=>fs.existsSync(path.join(root,name))?artifactInventory(path.join(root,name)):[]);
      if(JSON.stringify(actualArtifacts.sort((a,b)=>a.path.localeCompare(b.path)))!==JSON.stringify([...(record.artifacts||[])].sort((a,b)=>a.path.localeCompare(b.path))))fail('Native/recovery artifact inventory is incomplete or inconsistent.');
      if(id==='core'){
        const guard=record.unclassifiedRootGuard;
        if(guard?.status!=='passed'||guard.issues?.length!==0||guard.files?.length!==files.length)fail('Missing successful unclassified-root guard.');
        if(JSON.stringify(guard.files.map(item=>item.file).sort())!==JSON.stringify([...files].sort()))fail('Unclassified-root guard file binding is incomplete.');
        for(const observed of guard.files){
          if(observed.process?.code!==0||observed.process.signal||observed.process.error)fail('Unclassified-root guard child failed.');
          const tap=verifiedFile(root,observed.stdout.path,observed.stdout.sha256).toString('utf8');
          verifyGuardTap(tap,observed.file);
          verifiedFile(root,observed.stderr.path,observed.stderr.sha256);
          verifyGuardSummary(verifiedFile(root,observed.summary.path,observed.summary.sha256).toString('utf8'),observed.file);
        }
      }
      const controls = assignments.processControls.filter(control => control.group === id);
      if (record.processControls?.length !== controls.length) fail('Required process-control records are missing.');
      for (const control of controls) {
        const matches = record.processControls.filter(item => item.id === control.id && item.ownerRoot === control.ownerRoot && item.registrationCount === control.expectedExecutions && item.expectedExecutions === control.expectedExecutions);
        if (matches.length !== 1) fail('Controlled child registration evidence is missing or duplicated.');
      }
      if (descriptor.groups.find(group=>group.id===id).roots.includes('RISK repository process: required installed-client native outcomes and artifacts execute exactly once')) {
        const reports = [];
        for (const artifact of record.artifacts || []) {
          if (!artifact.path.startsWith('native/') || !artifact.path.endsWith('.json')) continue;
          const report = JSON.parse(verifiedFile(root,artifact.path,artifact.sha256,artifact.bytes));
          if (['signed-out','reconcile-held'].includes(report.mode)) reports.push(report);
        }
        if (reports.length !== 2 || new Set(reports.map(report=>report.mode)).size !== 2) fail('Both required distinct native reports must be present.');
        for (const report of reports) {
          if (report.status !== 'passed' || report.oldCommit !== '779defa4e8c3465fdf535fe17dbe2227d2b76ea1' || report.candidateCommit !== identity.checkoutSha || report.candidateTree !== identity.checkoutTree || !['contextClosed','browserClosed','serverClosed'].every(key=>report.cleanup?.[key]===true)) fail('Native report outcome, actual checkout or cleanup mismatch.');
        }
      }
      records.push({group:id,resultSha256:sha256(fs.readFileSync(path.join(root,'result.json'))),cases:cases.length,passed:cases.filter(item=>item.status==='passed').length,skipped:cases.filter(item=>item.status==='skipped').length,artifacts:record.artifacts,identity});
    } catch (error) { issues.push(`${id}: ${error.message}`); }
  }
  const report = {schemaVersion:1,status:issues.length?'failed':'passed',mode:policyCovered?'policy-covered':covered?'covered':'full',resultIdentity:descriptor.resultIdentity,groups:records,caseCount:allCases.size,issues,finishedAt:new Date().toISOString()};
  atomicWrite(path.join(outputDir,'aggregate.json'),report);
  if (issues.length) fail(issues.join('\n'));
  process.stdout.write(`Complete required cohort verified: ${allCases.size} cases.\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,`report=${sha256(fs.readFileSync(path.join(outputDir,'aggregate.json')))}\n`);
  return 0;
}

function atomicWrite(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, file);
}

function verifyGuardTap(raw, file) {
  const cases=parseTap(raw), names=new Set([normalizeTapIdentity(file),normalizeTapIdentity(path.resolve(ROOT,file))]);
  if(!raw.startsWith('TAP version 13\n') || !/^1\.\.1$/m.test(raw) || cases.length!==1 || cases[0].id!==cases[0].root || !names.has(cases[0].root) || cases[0].status!=='passed')fail('Malformed or incomplete zero-root guard TAP.');
}

function verifyGuardSummary(raw, file) {
  const summaries = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const matching = summaries.filter(summary => summary.file === path.resolve(ROOT,file));
  if (matching.length !== 1) fail('Unclassified-root guard has missing or duplicate per-file summaries.');
  const counts = matching[0].counts;
  if (!counts || !['tests','topLevel','suites','passed','failed','cancelled','skipped','todo'].every(key => counts[key] === 0)) fail('Unclassified runtime roots were executed or skipped.');
  if (!matching[0].success) fail('Unclassified-root guard summary did not succeed.');
}

async function unclassifiedRootGuard(files, assignments, outputDir) {
  // Per-file summaries distinguish an empty Node wrapper from an unknown test
  // with exactly that wrapper's title. Names assigned in another file cannot
  // suppress a future root here.
  const reporterPath=path.join(outputDir,'unclassified-reporter.mjs');
  fs.writeFileSync(reporterPath,`export default async function* (events) { for await (const event of events) if(event.type==='test:summary') yield JSON.stringify(event.data)+'\\n'; }\n`,{flag:'wx'});
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const reports=[],errors=[];
  for (const [index,file] of files.entries()) {
    const roots=[...assignments.assignmentsByRoot.values()].filter(entry=>entry.file===file).map(entry=>normalizeTapIdentity(entry.root));
    const patterns=testNamePatternArguments(roots).map(argument=>argument.replace('--test-name-pattern=','--test-skip-pattern='));
    const prefix=`unclassified-${index}`;
    const stdoutPath=path.join(outputDir,prefix+'.tap'),stderrPath=path.join(outputDir,prefix+'.stderr.log'),summaryPath=path.join(outputDir,prefix+'.summary.jsonl');
    const child=spawn(process.execPath,['--test','--test-reporter=tap','--test-reporter-destination=stdout','--test-reporter='+reporterPath,'--test-reporter-destination='+summaryPath,...patterns,file],{cwd:ROOT,env,detached:true,stdio:['ignore','pipe','pipe']});
    const stdout=fs.createWriteStream(stdoutPath,{flags:'wx'}),stderr=fs.createWriteStream(stderrPath,{flags:'wx'});
    child.stdout.pipe(stdout);child.stderr.pipe(stderr);
    let timedOut=false,overLimit=false,bytes=0;
    const stop=()=>{if(!child.pid)return;try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}};
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024){overLimit=true;stop();}});
    const timer=setTimeout(()=>{timedOut=true;stop();},30000);
    const exit=await new Promise(resolve=>{child.once('error',error=>resolve({code:null,error:error.message}));child.once('close',(code,signal)=>resolve({code,signal}));});
    clearTimeout(timer);stop();
    await Promise.all([new Promise(resolve=>stdout.end(resolve)),new Promise(resolve=>stderr.end(resolve))]);
    const evidence=filePath=>({path:path.basename(filePath),sha256:sha256(fs.readFileSync(filePath))});
    let summary=null;
    try {
      if(exit.code!==0||exit.signal||exit.error||timedOut||overLimit)fail('Unclassified-root guard failed or exceeded its owned process/output limit.');
      summary=evidence(summaryPath);verifyGuardSummary(fs.readFileSync(summaryPath,'utf8'),file);
      verifyGuardTap(fs.readFileSync(stdoutPath,'utf8'),file);
    } catch(error){errors.push(`${file}: ${error.message} Observed guard outcomes: ${parseTap(fs.readFileSync(stdoutPath,'utf8')).map(item=>item.id).join(', ')}.`);}
    reports.push({file,process:exit,stdout:evidence(stdoutPath),stderr:evidence(stderrPath),summary});
  }
  const report={status:errors.length?'failed':'passed',files:reports,issues:errors};
  atomicWrite(path.join(outputDir,'unclassified-roots.json'),report);
  if(errors.length)fail(errors.join(' '));
  return report;
}

async function runChild(files, roots, outputDir, options, source) {
  const runtimeTmp = path.join(outputDir, 'runtime-tmp');
  const nativeDir = path.join(outputDir, 'native');
  const recoveryDir = path.join(outputDir, 'recovery-ui');
  fs.mkdirSync(runtimeTmp);
  fs.mkdirSync(nativeDir);
  fs.mkdirSync(recoveryDir);
  const tapPath = path.join(outputDir, 'test.tap');
  const stderrPath = path.join(outputDir, 'test.stderr.log');
  const tap = fs.createWriteStream(tapPath, { flags: 'wx' });
  const stderr = fs.createWriteStream(stderrPath, { flags: 'wx' });
  const patternArguments = testNamePatternArguments(roots.map(normalizeTapIdentity));
  const env = {
    ...process.env,
    TMPDIR: runtimeTmp,
    TMP: runtimeTmp,
    TEMP: runtimeTmp,
    CHAIN_TEST_GROUP: options.group,
    CHAIN_TEST_RUN_ID: options.runId,
    CHAIN_GROUP_OUTPUT_DIR: outputDir,
    CHAIN_NATIVE_OUTPUT: nativeDir,
    CHAIN_NATIVE_CANDIDATE_SHA: source.sha,
    CHAIN_NATIVE_CANDIDATE_TREE: source.tree,
    CHAIN_RECOVERY_UI_OUTPUT: recoveryDir,
  };
  const child = spawn(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...patternArguments, ...files], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(tap);
  child.stderr.pipe(stderr);
  const exit = await new Promise(resolve => {
    child.once('error', error => resolve({ code: null, signal: null, error: error.message }));
    child.once('close', (code, signal) => resolve({ code, signal, error: null }));
  });
  await Promise.all([new Promise(resolve => tap.end(resolve)), new Promise(resolve => stderr.end(resolve))]);
  const tapText = fs.readFileSync(tapPath, 'utf8');
  const stderrText = fs.readFileSync(stderrPath, 'utf8');
  let cases;
  try { cases = tapText.includes('TAP version') ? parseTap(tapText) : []; }
  finally { fs.rmSync(runtimeTmp, { recursive: true, force: true }); }
  return {
    exit, cases, tapPath, stderrPath, tapSha256: sha256(tapText), stderrSha256: sha256(stderrText), nativeDir, recoveryDir,
    selection: { requiredRootCount: roots.length, namePatternArgumentBytes: patternArguments.map(argument => Buffer.byteLength(argument)) },
  };
}

async function main() {
  if (process.argv.slice(2).includes('--help')) {
    process.stdout.write('Usage: npm run test:group -- --group <core|scenery|persistence-recovery|native-process> --output-dir <new-empty-dir> --repository <owner/name> --event-policy <policy> --run-id <id> --run-attempt <n> --source-sha <sha> --comparison-base <sha>\n');
    return 0;
  }
  let outputDir;
  let options;
  const startedAt = new Date().toISOString();
  try {
    const parsed = parseArgs(process.argv.slice(2));
    outputDir = validateOutputDirectory(parsed.outputDir);
    options = requiredIdentity(parsed);
  } catch (error) {
    if (outputDir) {
      atomicWrite(path.join(outputDir, 'result.json'), {
        schemaVersion: 1, status: 'preflight_failed', startedAt, finishedAt: new Date().toISOString(),
        issues: [error.message], resultIdentity: null,
      });
    }
    process.stderr.write(`${error.message}\n`);
    return 2;
  }

  const result = {
    schemaVersion: 1,
    status: 'preflight_failed',
    startedAt,
    resultIdentity: null,
    inventory: null,
    processControls: [],
    cases: [],
    artifacts: [],
    process: null,
    issues: [],
  };
  let nativeDir;
  try {
    const files = testFiles();
    const inventoryBytes = fs.readFileSync(INVENTORY_PATH);
    const assignmentsBytes = fs.readFileSync(ASSIGNMENTS_PATH);
    const inventory = JSON.parse(inventoryBytes.toString('utf8'));
    const assignments = JSON.parse(assignmentsBytes.toString('utf8'));
    const source = sourceIdentity(options);
    const gitStatus = git(['status', '--porcelain=v1', '--untracked-files=all']);
    const changedFiles = git(['diff', '--name-only', options.comparisonBase, '--', ...files]).split('\n').filter(Boolean);
    const untrackedFiles = git(['ls-files', '--others', '--exclude-standard', '--', ...files]).split('\n').filter(Boolean);
    result.resultIdentity = {
      repository: options.repository,
      eventPolicy: options.eventPolicy,
      runId: options.runId,
      runAttempt: options.runAttempt,
      sourceSha: options.sourceSha,
      sourceTree: source.sourceTree,
      checkoutSha: source.sha,
      checkoutTree: source.tree,
      checkoutDirty: source.dirty,
      workingTreeSha256: source.workingTreeSha256,
      comparisonBase: options.comparisonBase,
      expectedGroups: GROUP_IDS,
      selectedGroup: options.group,
      inventorySha256: sha256(inventoryBytes),
      assignmentsSha256: sha256(assignmentsBytes),
      addedRootTitles: [],
      mappedBaselineRoots: [],
      baselineRootRuntimeMap: [],
      sourceDiffFiles: [...new Set([...changedFiles, ...untrackedFiles])].sort(),
    };
    const inventoryIndex = validateInventory(inventory);
    const assignmentIndex = validateAssignments(assignments, inventory, inventoryIndex, files);
    const registrationInfo = validateAddedRegistrations(assignments, inventoryIndex, assignmentIndex, files, inventory.baseline.sourceSha);
    result.resultIdentity.addedRootTitles = registrationInfo.addedRootTitles;
    result.resultIdentity.mappedBaselineRoots = registrationInfo.mappedBaselineRoots;
    result.resultIdentity.baselineRootRuntimeMap = inventory.rootTests.map(({ id }) => {
      const replacement = assignmentIndex.replacementByBaseline.get(id);
      const runtimeRoot = normalizeTapIdentity(replacement?.currentRoot || id);
      return runtimeRoot === id ? null : { baselineRoot: id, runtimeRoot };
    }).filter(Boolean);
    result.resultIdentity.cohortDigestSha256 = cohortDigest(inventory, assignments, assignmentIndex);
    {
      const accepted = new Set(inventory.acceptedSkipCaseIds);
      const descriptor = { schemaVersion: 1, resultIdentity: { ...result.resultIdentity, selectedGroup: null },
        groups: GROUP_IDS.map(id => ({ id,
          roots: assignmentIndex.rootsPerGroup.get(id).map(normalizeTapIdentity).sort(),
          requiredCaseIds: [...expectedCasesForGroup(inventory, assignmentIndex, id).keys()],
          acceptedSkipCaseIds: [...expectedCasesForGroup(inventory, assignmentIndex, id)].filter(([, baselineId]) => accepted.has(baselineId)).map(([runtimeId]) => runtimeId),
          processControls: assignments.processControls.filter(control => control.group === id).map(control => ({ ...control, ownerRoot: normalizeTapIdentity(control.ownerRoot) })),
        })), baseline: inventory.baseline };
      if(options.covered){
        result.coverage=coverageReference(readJson(options.proof,'verified coverage proof'),result.resultIdentity);
        result.status='covered';result.finishedAt=new Date().toISOString();atomicWrite(path.join(outputDir,'result.json'),result);
        process.stdout.write(`${options.group}: covered by full producer ${result.coverage.coveredBy.runId}/${result.coverage.coveredBy.runAttempt}; no test child executed.\n`);return 0;
      }
      if (options.aggregate) return aggregateResults({options, outputDir, descriptor, inventory, assignmentIndex, assignments, files, source});
      if (options.describe) {
        atomicWrite(path.join(outputDir, 'descriptor.json'), descriptor);
        result.status = 'described';
        result.finishedAt = new Date().toISOString();
        atomicWrite(path.join(outputDir, 'result.json'), result);
        process.stdout.write(`Validated complete cohort descriptor: ${path.join(outputDir, 'descriptor.json')}\n`);
        return 0;
      }
    }

    const selectedFiles = [...new Set([
      ...files.filter(file => assignmentIndex.rootsPerGroup.get(options.group).some(root => assignmentIndex.assignmentsByRoot.get(root)?.file === file)),
    ])].sort();
    const selectedRoots = assignmentIndex.rootsPerGroup.get(options.group).sort();
    if (!selectedFiles.length || !selectedRoots.length) fail(`Required group ${options.group} is empty.`);

    result.inventory = {
      baselineRunId: inventory.baseline.runId,
      baselineSourceSha: inventory.baseline.sourceSha,
      baselineCheckoutSha: inventory.baseline.checkoutSha,
      baselineComparisonBase: inventory.baseline.comparisonBase,
      baselineCaseCount: inventory.baseline.caseCount,
      baselinePassed: inventory.baseline.passed,
      baselineAcceptedSkips: inventory.baseline.skipped,
      requiredCasesForGroup: expectedCasesForGroup(inventory, assignmentIndex, options.group).size,
      requiredRootsForGroup: selectedRoots.length,
      baselineEstimatedDurationMs: assignments.groups.find(group => group.id === options.group).baselineEstimatedDurationMs,
      groupAssignmentMethod: assignments.assignmentMethod,
    };
    result.processControls = assignments.processControls.filter(control => control.group === options.group).map(control => ({
      id: control.id,
      group: control.group,
      file: control.file,
      ownerRoot: control.ownerRoot,
      expectedExecutions: control.expectedExecutions,
      registrationCount: countTestRegistrations(fs.readFileSync(path.join(ROOT, control.file), 'utf8'), control.id),
    }));

    if (options.group === 'core') result.unclassifiedRootGuard = await unclassifiedRootGuard(files,assignmentIndex,outputDir);
    const childResult = await runChild(selectedFiles, selectedRoots, outputDir, options, source);
    nativeDir = childResult.nativeDir;
    result.process = {
      exitCode: childResult.exit.code,
      signal: childResult.exit.signal,
      spawnError: childResult.exit.error,
      stdout: { path: path.basename(childResult.tapPath), sha256: childResult.tapSha256 },
      stderr: { path: path.basename(childResult.stderrPath), sha256: childResult.stderrSha256 },
      selection: childResult.selection,
    };
    result.cases = childResult.cases.map(({ id, root, status, skipReason }) => ({ id, root, status, skipReason }));
    result.artifacts = [...artifactInventory(nativeDir), ...artifactInventory(childResult.recoveryDir)];
    result.issues = verifyResults({
      cases: childResult.cases,
      group: options.group,
      inventory,
      assignments: { ...assignmentIndex, processControls: assignments.processControls },
      files: selectedFiles,
      source,
    });
    if (childResult.exit.code !== 0) result.issues.unshift(`Test process exited with ${childResult.exit.code ?? childResult.exit.signal ?? childResult.exit.error}.`);
    if (gitStatus.trim() && !source.dirty) result.issues.push('Checkout dirty state could not be reconciled with its identity.');
    result.status = result.issues.length ? 'failed' : 'passed';
  } catch (error) {
    result.issues.push(error.message);
    result.status = 'preflight_failed';
    if (nativeDir && fs.existsSync(nativeDir)) {
      try { result.artifacts = artifactInventory(nativeDir); } catch (artifactError) { result.issues.push(artifactError.message); }
    }
  }
  result.finishedAt = new Date().toISOString();
  atomicWrite(path.join(outputDir, 'result.json'), result);
  if (result.status !== 'passed') {
    process.stderr.write(`${result.status}: ${result.issues.join('\n')}\n`);
    return 1;
  }
  process.stdout.write(`${options.group}: ${result.cases.length} test cases passed; evidence: ${path.join(outputDir, 'result.json')}\n`);
  return 0;
}

export { parseTap, normalizeTapIdentity };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
