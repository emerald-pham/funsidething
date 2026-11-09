#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInputPass } from './agent-tools/ci-pass-reuse.mjs';

export const GROUP_IDS = ['core', 'scenery', 'persistence-recovery', 'native-process'];
// Not a required group: the scheduled/dispatched nightly job runs it alone.
export const NIGHTLY_GROUP_ID = 'nightly-cross-engine';
const TEST_NAME_PATTERN_ARGUMENT_BUDGET = 64 * 1024;
const FAILURE_REASON_MAX_CHARS = 200;
const MIN_GROUP_HEAP_MB = 512;
const MAX_GROUP_HEAP_MB = 12288;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The one definition of a registered test file (#2213): a *.test.js file in the
// top-level tests/ directory; tests/shared.js holds helpers, not tests. The
// runner, preflight and the compatibility gate all list tests this way. The
// test-first gate and edit hook deliberately use the wider test surface
// (anything under tests/), since a helper edit is still a test edit.
export const isTestFile = file => /^tests\/[^/]+\.test\.js$/.test(file);
export function listTestFiles(root = ROOT) {
  return fs.readdirSync(path.join(root, 'tests')).map(file => `tests/${file}`).filter(isTestFile).sort();
}
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
    if (['--describe','--aggregate','--covered','--changed-groups'].includes(argv[index])) { values[argv[index].slice(2)] = true; continue; }
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
  if (options.group === NIGHTLY_GROUP_ID) {
    if (options.aggregate || options.describe || options.covered) fail(`The ${NIGHTLY_GROUP_ID} cohort is not part of the required cohort; it cannot be described, covered or aggregated.`);
  } else if (!GROUP_IDS.includes(options.group)) fail(`Unknown group ${JSON.stringify(options.group)}; expected ${GROUP_IDS.join(', ')} or ${NIGHTLY_GROUP_ID}.`);
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

// The full suite is the per-area test directory (#2213); nothing runs a root
// tests.js any more, so its old command is not accepted.
// tests/shared.js holds helpers, not tests, so only *.test.js files count.
// npm test runs two files at a time: with every area file in parallel, timer
// deadlines in the long core file expired under load (5 s fixture deadlines),
// which never happened while tests.js ran as one serial process.
const FULL_SUITE_COMMANDS = new Map([
  ['node --test --test-concurrency=2 tests/*.test.js scripts/agent-tools/*.test.mjs', () => listTestFiles()],
]);

function testFiles() {
  const packageJson = readJson(path.join(ROOT, 'package.json'), 'package.json');
  const suiteFiles = FULL_SUITE_COMMANDS.get(packageJson.scripts?.test);
  if (!suiteFiles) {
    fail('The full npm test entry point changed; update the group runner contract explicitly before grouping this suite.');
  }
  const scriptFiles = fs.readdirSync(path.join(ROOT, 'scripts/agent-tools'))
    .filter(file => file.endsWith('.test.mjs'))
    .sort()
    .map(file => `scripts/agent-tools/${file}`);
  const files = [...suiteFiles(), ...scriptFiles];
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
    // A group that outgrows Node's default heap declares its own (#2232) instead
    // of having roots moved out of it. Each group runs alone in its own job on a
    // 16 GB ubuntu-latest runner, so the old space stays well below that.
    const heap = group.nodeMaxOldSpaceSizeMb;
    if (heap !== undefined && (!Number.isSafeInteger(heap) || heap < MIN_GROUP_HEAP_MB || heap > MAX_GROUP_HEAP_MB)) {
      fail(`Group ${group.id} nodeMaxOldSpaceSizeMb must be a whole number of MB from ${MIN_GROUP_HEAP_MB} to ${MAX_GROUP_HEAP_MB} (Node heap).`);
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
  addFileDefaultAssignments(assignments, assignmentsByRoot, groupSet, files);
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
  // An added root whose registration is gated on an environment variable
  // (for example the env-gated browser tests) skips wherever that variable is
  // absent, as CI groups are. The baseline's own environment skips live in
  // the independent inventory; an added one is accepted only through an
  // explicit, justified declaration that names the variable its registration
  // actually skips on (#2194 CI, PR #2222).
  const environmentSkips = new Map();
  if (assignments.environmentSkips !== undefined && !Array.isArray(assignments.environmentSkips)) fail('environmentSkips must be an array when present.');
  for (const entry of assignments.environmentSkips || []) {
    const label = JSON.stringify(entry?.root);
    if (!entry || typeof entry.root !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(entry.environment || '') ||
        typeof entry.reason !== 'string' || entry.reason.trim().length < 20 || environmentSkips.has(entry.root)) {
      fail(`Environment skip ${label} needs one unique root, an environment variable name and a reason.`);
    }
    if (inventoryIndex.roots.has(entry.root) || replacementTargets.has(entry.root)) fail(`Environment skip ${label} must name an added root; baseline skips belong to the independent inventory.`);
    const assignment = assignmentsByRoot.get(entry.root);
    if (!assignment) fail(`Environment skip ${label} has no group assignment.`);
    const escaped = entry.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const registration = new RegExp(`^\\s*test\\(\\s*(['"])${escaped}\\1\\s*,\\s*\\{\\s*skip\\s*:\\s*!process\\.env\\.${entry.environment}\\s*\\}`, 'm');
    if (!registration.test(fs.readFileSync(path.join(ROOT, assignment.file), 'utf8'))) {
      fail(`Environment skip ${label} is not registered with {skip:!process.env.${entry.environment}} in ${assignment.file}.`);
    }
    environmentSkips.set(entry.root, entry);
  }
  const nightlyRoots = validateNightlyRoots(assignments, fileSet, assignmentsByRoot);
  return { assignmentsByRoot, currentRootToBaseline, replacementByBaseline, replacementTargets, rootsPerGroup, environmentSkips, nightlyRoots };
}

// fileGroups maps a full-suite file, or a pattern with one * inside a file name,
// to the group its unrowed roots join (#2232). An exact file wins over a
// pattern. A row overrides the file default; a file with no default places
// nothing, so its new roots still need rows.
function fileGroupResolver(assignments, groupSet, files) {
  const entries = assignments.fileGroups === undefined ? {} : assignments.fileGroups;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) fail('fileGroups must map files to groups when present.');
  const exact = new Map(), patterns = [];
  for (const [key, group] of Object.entries(entries)) {
    if (!groupSet.has(group)) fail(`fileGroups ${JSON.stringify(key)} names unknown group ${JSON.stringify(group)}.`);
    const stars = key.split('*').length - 1;
    if (stars === 0) {
      if (!files.includes(key)) fail(`fileGroups ${JSON.stringify(key)} is not a full-suite file.`);
      exact.set(key, group);
    } else {
      if (stars !== 1 || key.slice(key.indexOf('*')).includes('/')) fail(`fileGroups pattern ${JSON.stringify(key)} may hold one * inside the file name only.`);
      const [prefix, suffix] = key.split('*'), matcher = file => file.startsWith(prefix) && file.endsWith(suffix) && !file.slice(prefix.length, file.length - suffix.length).includes('/');
      if (!files.some(matcher)) fail(`fileGroups pattern ${JSON.stringify(key)} matches no full-suite file.`);
      patterns.push([matcher, group]);
    }
  }
  return file => exact.get(file) ?? patterns.find(([matcher]) => matcher(file))?.[1];
}

function addFileDefaultAssignments(assignments, assignmentsByRoot, groupSet, files) {
  const groupFor = fileGroupResolver(assignments, groupSet, files);
  const controlled = new Set(assignments.processControls.map(control => control?.id));
  const nightly = new Set((Array.isArray(assignments.nightlyRoots) ? assignments.nightlyRoots : []).map(entry => entry?.root));
  for (const file of files) {
    const group = groupFor(file);
    if (!group) continue;
    for (const title of fileDefaultRootTitles(fs.readFileSync(path.join(ROOT, file), 'utf8'))) {
      // Rows and catalog roots are TAP identities (# is escaped as \#).
      const root = title.replace(/[\\#]/g, '\\$&');
      if (assignmentsByRoot.has(root) || controlled.has(title) || nightly.has(title)) continue;
      assignmentsByRoot.set(root, { root, group, file, registration: 'file-default' });
    }
  }
}

// Cross-engine native checks run in the scheduled/dispatched nightly job, not
// the per-push required cohort (#2210): one flaky or engine-specific WebKit
// failure blocked unrelated fixes for about an hour per run. Declared nightly
// roots are classified (so the registration guards accept them) but belong to
// no required group, so describe, group runs and the aggregate never need them.
// The Chromium installed-client cases protect installed-client delivery and saved
// boards on every change, so they can never be moved to the nightly job.
const INSTALLED_CLIENT_CASES = new Set([
  'RISK repository process: required installed-client native outcomes and artifacts execute exactly once',
  'RISK native installed-client delivery: signed-out',
  'RISK native installed-client delivery: reconcile-held',
]);
function validateNightlyRoots(assignments, fileSet, assignmentsByRoot) {
  const entries = assignments.nightlyRoots || [];
  if (!Array.isArray(entries)) fail('nightlyRoots must be an array when present.');
  const nightlyRoots = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.root !== 'string' || !entry.root.trim() || !fileSet.has(entry.file)) {
      fail('Every nightly root must name a full-suite source file.');
    }
    if (INSTALLED_CLIENT_CASES.has(entry.root)) fail(`Installed-client case ${JSON.stringify(entry.root)} must stay in the required cohort, not the nightly job.`);
    if (assignmentsByRoot.has(entry.root) || assignments.processControls.some(control => control.id === entry.root)) {
      fail(`Nightly root ${JSON.stringify(entry.root)} is also a required case; move it out of the required cohort instead of declaring it twice.`);
    }
    if (Object.hasOwn(entry, 'pendingOn') && !/^#[1-9]\d*$/.test(entry.pendingOn)) fail(`Pending nightly root ${JSON.stringify(entry.root)} must name its owning PR as #<number>.`);
    if (nightlyRoots.has(entry.root)) fail(`Nightly root ${JSON.stringify(entry.root)} is declared more than once.`);
    nightlyRoots.set(entry.root, entry);
  }
  return nightlyRoots;
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

function decodeStringLiteral(body) {
  const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, escape) => {
    if (escape[0] === 'u' && escape.length > 1) return String.fromCodePoint(parseInt(escape.replace(/[u{}]/g, ''), 16));
    if (escape[0] === 'x' && escape.length === 3) return String.fromCharCode(parseInt(escape.slice(1), 16));
    return simple[escape] ?? escape;
  });
}

// A registration is added when its title is registered more often now than in
// the comparison commit's full-suite files. Comparing titles rather than diff
// lines keeps tests moved between files (#2213: tests.js into tests/*.test.js)
// from counting as new roots; titles compare by value, so \u and \' escapes
// match their assignment.
function registeredTitleCounts(sources) {
  const counts = new Map();
  for (const source of sources) for (const line of source.split('\n')) {
    const match = line.match(/^\s*test\s*\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/);
    if (!match) continue;
    const title = decodeStringLiteral(match[2]);
    counts.set(title, (counts.get(title) || 0) + 1);
  }
  return counts;
}

// A declared required root that its file never registers would only surface
// when its group ran (#2232). Describe checks every literal row up front so a
// dropped or renamed registration fails the whole cohort before any group runs.
// Dynamic rows have no literal title to find; their group run still requires
// them to execute. Nightly roots are checked by the nightly run's own preflight
// (nightlySelection), so required CI does not depend on them.
function validateDeclaredRootsResolve(assignmentIndex) {
  const counts = new Map();
  const registered = file => {
    if (!counts.has(file)) counts.set(file, registeredTitleCounts([fs.readFileSync(path.join(ROOT, file), 'utf8')]));
    return counts.get(file);
  };
  for (const entry of assignmentIndex.assignmentsByRoot.values()) {
    if (entry.registration === 'dynamic') continue;
    if (!registered(entry.file).get(normalizeTapIdentity(entry.root))) fail(`Required root ${JSON.stringify(entry.root)} resolves to zero tests in ${entry.file}.`);
  }
}

function addedRootRegistrations(comparisonBase, files) {
  const current = registeredTitleCounts(files.map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')));
  // A comparison base from before the split (main until #2205 lands) still
  // registers its tests in the root tests.js, so the baseline reads it too.
  const baselineFiles = git(['ls-tree', '-r', '--name-only', comparisonBase, '--', 'tests.js', 'tests', 'scripts/agent-tools'])
    .split('\n').filter(file => file === 'tests.js' || isTestFile(file) || /^scripts\/agent-tools\/[^/]+\.test\.mjs$/.test(file));
  const baseline = registeredTitleCounts(baselineFiles.map(file => git(['show', `${comparisonBase}:${file}`])));
  return new Set([...current].filter(([title, count]) => count > (baseline.get(title) || 0)).map(([title]) => title));
}

function validateAddedRegistrations(assignments, inventoryIndex, index, files, inventorySourceSha) {
  // Source titles are plain strings; catalog roots are TAP identities (# is
  // escaped as \#). Compare both in TAP form.
  const added = new Set([...addedRootRegistrations(inventorySourceSha, files)].map(title => title.replace(/[\\#]/g, '\\$&')));
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
    if (!assignment && !controlled && !index.nightlyRoots.has(title)) fail(`New top-level test ${JSON.stringify(title)} has no explicit group assignment or process-control declaration.`);
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

// One pass collects every direct test(<plain string>, ...) title with its count;
// counting a single title reads from it, so many lookups stay linear.
const literalRegistrationCache = new Map();
function countTestRegistrations(source, testName) {
  return literalTestRegistrations(source).get(testName) || 0;
}
function literalTestRegistrations(source) {
  if (literalRegistrationCache.has(source)) return literalRegistrationCache.get(source);
  const titles = new Map();
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
      if (awaitingTitle && !literal.escaped) titles.set(literal.value, (titles.get(literal.value) || 0) + 1);
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
  literalRegistrationCache.set(source, titles);
  return titles;
}

// A root registered as a plain-string test(...) call at the start of a line
// (column 0, the top level of an area file) is placed by its file's group
// (#2232), including a column-0 environment skip such as
// test('…',{skip:!process.env.X},…). Titles this scanner cannot read keep
// explicit rows: computed titles, indented registrations (for example inside an
// if), titles with escapes, and registrations after a regular expression the
// tokenizer reads as division. The core registration guard rejects any of those
// that run without a row. Both checks must agree, so a quoted fixture that
// merely looks like a registration never becomes a root.
function fileDefaultRootTitles(source) {
  const code = literalTestRegistrations(source), titles = new Set();
  for (const line of source.split('\n')) {
    const match = line.match(/^test\s*\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/);
    if (match && !/\\/.test(match[2]) && code.has(match[2])) titles.add(match[2]);
  }
  return titles;
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

// Job logs are public and assertion text can come from any test, so only the
// first assertion line is kept: later lines carry the compared values. It is
// one line of printable text, capped in length.
function publicFailureReason(text) {
  const characters = Array.from(text.replace(/[\p{C}\p{Zl}\p{Zp}]+/gu, ' ').trim());
  if (!characters.length) return null;
  return characters.length > FAILURE_REASON_MAX_CHARS ? `${characters.slice(0, FAILURE_REASON_MAX_CHARS - 1).join('')}…` : characters.join('');
}

// Why a failed result failed, for the public job log: the error key of that
// result's own YAML diagnostics, read at its exact indentation so assertion
// text that resembles TAP cannot stand in for it.
function tapFailureReason(lines, resultIndex, indentation) {
  const indent = ' '.repeat(indentation + 2);
  if (lines[resultIndex + 1] !== `${indent}---`) return null;
  for (let index = resultIndex + 2; index < lines.length && lines[index] !== `${indent}...`; index++) {
    if (!lines[index].startsWith(`${indent}error: `)) continue;
    const value = lines[index].slice(indent.length + 'error: '.length).trim();
    if (!/^[|>][-+]?$/.test(value)) return publicFailureReason(value.replace(/^(['"`])(.*)\1$/, '$2'));
    const block = `${indent}  `;
    for (let cursor = index + 1; cursor < lines.length && (lines[cursor].startsWith(block) || !lines[cursor].trim()); cursor++) {
      const reason = publicFailureReason(lines[cursor]);
      if (reason) return reason;
    }
    return null;
  }
  return null;
}

const failedCaseLabel = item => `${item.id}${item.failureReason ? `: ${item.failureReason}` : ''}`;

function parseTap(text) {
  if (!/^TAP version \d+/m.test(text)) fail('The test process did not produce a TAP stream.');
  const stack = [];
  const cases = [];
  const resultLine = /^(\s*)(not )?ok \d+ - (.*?)(?: # (SKIP|TODO)(?:\s+(.*))?)?\s*$/;
  const subtestLine = /^(\s*)# Subtest: (.*)$/;
  const lines = text.split(/\r?\n/);
  for (const [lineIndex, line] of lines.entries()) {
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
    const status = directive === 'skip' ? 'skipped' : directive === 'todo' ? 'todo' : result[2] ? 'failed' : 'passed';
    cases.push({
      id: names.join(' > '),
      root: names[0],
      status,
      skipReason: directive === 'skip' ? (result[5] || '').trim() : null,
      line,
      ...(status === 'failed' ? { failureReason: tapFailureReason(lines, lineIndex, indentation) } : {}),
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
  // A declared added root may skip only as a whole and only while its
  // variable is absent here; set, it must run like any other root.
  for (const entry of assignments.environmentSkips?.values() || []) {
    const id = normalizeTapIdentity(entry.root);
    if (selectedRootSet.has(id) && !process.env[entry.environment]) acceptedSkips.add(id);
  }
  for (const item of cases) {
    if (item.status === 'failed') errors.push(`Test case failed: ${failedCaseLabel(item)}`);
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

// The nightly job exists so engine regressions stay visible before a Stable
// release. An empty list, a missing active root, or a skipped or failed nightly
// case therefore fails the run instead of passing quietly. A pending root names
// a test that has not landed (#2293): it runs nothing until its PR lands, and it
// fails here as soon as its test appears so that landed test cannot go unrun.
function nightlySelection(assignmentIndex) {
  const entries = [...assignmentIndex.nightlyRoots.values()];
  if (!entries.length) fail('No nightly cross-engine roots are declared in scripts/test-group-assignments.json.');
  const pending = entries.filter(entry => entry.pendingOn), active = entries.filter(entry => !entry.pendingOn);
  const registrations = entry => countTestRegistrations(fs.readFileSync(path.join(ROOT, entry.file), 'utf8'), entry.root);
  for (const entry of pending) {
    if (registrations(entry)) fail(`Pending nightly cross-engine root ${JSON.stringify(entry.root)} (${entry.pendingOn}) has landed in ${entry.file}; remove its pendingOn to move it to active so it runs.`);
  }
  for (const entry of active) {
    const count = registrations(entry);
    if (count !== 1) fail(`Nightly cross-engine root ${JSON.stringify(entry.root)} is registered ${count} times in ${entry.file}; expected exactly one.`);
  }
  return { files: [...new Set(active.map(entry => entry.file))].sort(), roots: active.map(entry => entry.root).sort(), pending };
}

// A zero must read as a zero (#2293): the result and the run's annotation both
// state how many cases ran and which roots still wait on their owning PR.
function crossEngineReport(nightly, casesRun) {
  return { casesRun, activeRoots: nightly.roots, pendingRoots: nightly.pending.map(({ root, file, pendingOn }) => ({ root, file, pendingOn })) };
}
function crossEngineNotice({ casesRun, pendingRoots }) {
  const pending = pendingRoots.length ? ` Pending, not run: ${pendingRoots.map(entry => `${JSON.stringify(entry.root)} (${entry.pendingOn})`).join('; ')}.` : '';
  return `::notice title=Nightly cross-engine coverage::${casesRun} cross-engine case${casesRun === 1 ? '' : 's'} ran on this head.${casesRun ? '' : ' This run is no cross-engine evidence.'}${pending}\n`;
}

function verifyNightlyResults(cases, roots) {
  const errors = [];
  const rootSet = new Set(roots.map(normalizeTapIdentity));
  const executed = cases.filter(item => item.id === item.root).map(item => item.root);
  for (const root of rootSet) {
    const count = executed.filter(item => item === root).length;
    if (count !== 1) errors.push(`Nightly root ${JSON.stringify(root)} executed ${count} times; expected exactly once.`);
  }
  for (const item of cases) {
    if (!rootSet.has(item.root)) errors.push(`Case ${JSON.stringify(item.id)} is outside the nightly cohort.`);
    if (item.status === 'failed') errors.push(`Nightly case failed: ${failedCaseLabel(item)}`);
    else if (item.status === 'skipped') errors.push(`Nightly case was skipped: ${item.id}`);
    else if (item.status === 'todo') errors.push(`Nightly case was marked TODO: ${item.id}`);
  }
  if (!cases.length) errors.push('The nightly cohort produced no results.');
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

function coverageReference(proof, identity, execution=true) {
  if (proof?.inputPasses?.[identity.selectedGroup]) {
    if (!['full','reuse'].includes(proof.decision) || String(proof.runId)!==String(identity.runId) || String(proof.runAttempt)!==String(identity.runAttempt)) fail('Input coverage requires current-run routing proof.');
    for (const key of ['repository','sourceSha','sourceTree','checkoutSha','checkoutTree','comparisonBase']) if(proof.validationContext?.[key]!==identity[key])fail(`Input coverage validation mismatch: ${key}.`);
    return validateInputPass(proof.inputPasses[identity.selectedGroup],identity,{execution});
  }
  if (proof?.decision!=='reuse' || String(proof.runId)!==String(identity.runId) || String(proof.runAttempt)!==String(identity.runAttempt)) fail('Covered mode requires a verified current-run routing proof.');
  for (const key of ['repository','sourceSha','sourceTree','checkoutSha','checkoutTree','comparisonBase']) if(proof.validationContext?.[key]!==identity[key])fail(`Coverage validation context mismatch: ${key}.`);
  const context=proof.cohortContext,producer=proof.coveredBy;
  for(const key of ['repository','sourceSha','sourceTree'])if(context?.[key]!==identity[key])fail(`Coverage producer source context mismatch: ${key}.`);
  if(identity.checkoutDirty || context?.requiredCohort!=='four-groups-v1' || proof.contextSha256!==sha256(JSON.stringify(context)))fail('Coverage context is incomplete or dirty.');
  for(const key of ['cohortDigestSha256','inventorySha256','assignmentsSha256','expectedGroups'])if(JSON.stringify(context[key])!==JSON.stringify(identity[key]))fail(`Coverage cohort mismatch: ${key}.`);
  if(!/^[1-9][0-9]*$/.test(producer?.runId)||!/^[1-9][0-9]*$/.test(producer?.runAttempt)||!/^[a-f0-9]{64}$/.test(producer?.reportSha256)||!['checkoutSha','checkoutTree','comparisonBase'].every(key=>sha1Pattern.test(producer[key])&&producer[key]===context[key]))fail('Original full producer run/attempt/report identity is missing.');
  return {contextSha256:proof.contextSha256,cohortContext:context,coveredBy:producer};
}

function aggregateResults({options, outputDir, descriptor, inventory, assignmentIndex, assignments, files, source}) {
  if (!options.resultsDir || !options.needsJson) fail('Aggregate requires --results-dir and --needs-json.');
  const needs = readJson(options.needsJson, 'actual workflow predecessor results');
  const issues = [], records = [], allCases = new Set();
  const covered=needs['cohort-routing']?.outputs?.decision==='reuse';
  const reused=JSON.parse(needs['cohort-routing']?.outputs?.reused||'[]');
  if(!Array.isArray(reused)||new Set(reused).size!==reused.length||reused.some(id=>!GROUP_IDS.includes(id)&&!['rules','compatibility'].includes(id)))fail('Invalid reused-gate inventory.');
  const emulatorModes=needs['event-gates']?.outputs;
  if(!emulatorModes&&reused.some(gate=>['rules','compatibility'].includes(gate)))fail('Reused emulator gates require their actual consumer outcomes and original coverage fingerprints.');
  if(emulatorModes&&['rules','compatibility'].some(gate=>!['executed','covered'].includes(emulatorModes[gate])))fail('Required emulator gate outcomes are missing or unknown.');
  const reusedEmulators=emulatorModes?['rules','compatibility'].filter(gate=>emulatorModes[gate]==='covered'):reused.filter(id=>!GROUP_IDS.includes(id));
  if(reusedEmulators.some(gate=>!reused.includes(gate)))fail('Emulator coverage was not admitted by the original routing proof.');
  const freshProof=covered||reused.length?readJson(options.proof,'fresh original-producer proof'):null;
  const freshCoverage=covered?coverageReference(freshProof,descriptor.resultIdentity):null;
  const emulatorCoverage=Object.fromEntries(reusedEmulators.map(gate=>{
    const reference=coverageReference(freshProof,{...descriptor.resultIdentity,selectedGroup:gate},false);
    if(emulatorModes[gate+'-coverage']!==sha256(JSON.stringify(reference)))fail('Emulator original coverage changed after the consumer: '+gate);
    return [gate,reference];
  }));
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
      const inputCovered=!covered&&reused.includes(id)&&record.status==='covered';
      if (record.status !== (covered||inputCovered?'covered':'passed') || record.issues?.length || !Array.isArray(record.issues)) fail(`Required group ${id} did not pass.`);
      const identity = record.resultIdentity;
      for (const [key,value] of Object.entries(descriptor.resultIdentity)) {
        if (key === 'selectedGroup') continue;
        if (JSON.stringify(identity?.[key]) !== JSON.stringify(value)) fail(`Required group ${id} identity mismatch: ${key}.`);
      }
      if (identity?.selectedGroup !== id || identity.checkoutDirty) fail(`Wrong or dirty group identity: ${id}.`);
      if(covered||inputCovered){
        const expectedCoverage=inputCovered?coverageReference(freshProof,{...descriptor.resultIdentity,selectedGroup:id},false):freshCoverage;
        if(record.cases?.length!==0||record.artifacts?.length!==0||record.process!==null||JSON.stringify(record.coverage)!==JSON.stringify(expectedCoverage))fail('Covered records are mixed, incomplete or claim current execution.');
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
  const coveredCount=records.filter(record=>record.mode==='covered').length;
  const original=coveredCount===0&&reusedEmulators.length===0;
  const report = {schemaVersion:1,status:issues.length?'failed':'passed',mode:coveredCount===GROUP_IDS.length?'covered':coveredCount?'mixed':'full',resultIdentity:descriptor.resultIdentity,groups:records,emulatorCoverage,caseCount:allCases.size,issues,finishedAt:new Date().toISOString()};
  atomicWrite(path.join(outputDir,'aggregate.json'),report);
  if (issues.length) fail(issues.join('\n'));
  process.stdout.write(`Complete required cohort verified: ${allCases.size} cases.\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,`report=${sha256(fs.readFileSync(path.join(outputDir,'aggregate.json')))}\nmode=${report.mode}\nattestation-mode=${original?'full':'reuse'}\noriginal=${original}\n`);
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
    // Nightly roots are classified too; the guard must not run them here.
    const roots=[...assignments.assignmentsByRoot.values(),...assignments.nightlyRoots.values()].filter(entry=>entry.file===file).map(entry=>normalizeTapIdentity(entry.root));
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

async function runChild(files, roots, outputDir, options, source, heapMb) {
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
  // The test runner passes this flag on to every per-file child process.
  const heapArguments = heapMb === undefined ? [] : [`--max-old-space-size=${heapMb}`];
  const child = spawn(process.execPath, [...heapArguments, '--test', '--test-reporter=tap', '--test-concurrency=1', ...patternArguments, ...files], {
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

// The groups a diff needs, as CI routes them. Each CI gate is keyed on the
// complete checkout tree, so a changed file of any kind runs every group CI's
// cohort declares; GROUP_IDS is that cohort, handed to the router by --describe.
// A retained pass for identical inputs only reuses a run CI already has.
function listChangedGroups(options) {
  for (const [key, flag] of [['group', '--group'], ['outputDir', '--output-dir'], ['describe', '--describe'], ['aggregate', '--aggregate'], ['covered', '--covered']]) {
    if (options[key] !== undefined) fail(`--changed-groups writes no evidence, so it cannot take ${flag}.`);
  }
  if (!options.comparisonBase) fail('--changed-groups needs --comparison-base <commit> for the diff.');
  if (requireGit(['rev-parse', '--verify', '--quiet', '--end-of-options', `${options.comparisonBase}^{commit}`], 'utf8').status !== 0) {
    fail(`Unknown comparison base ${JSON.stringify(options.comparisonBase)}.`);
  }
  process.stdout.write(`${GROUP_IDS.join('\n')}\n`);
  process.stderr.write('CI keys every group on the complete tree, so no file set narrows this list.\n');
  return 0;
}

async function main() {
  if (process.argv.slice(2).includes('--help')) {
    process.stdout.write('Usage: npm run test:group -- --group <core|scenery|persistence-recovery|native-process|nightly-cross-engine> --output-dir <new-empty-dir> --repository <owner/name> --event-policy <policy> --run-id <id> --run-attempt <n> --source-sha <sha> --comparison-base <sha>\n');
    return 0;
  }
  let outputDir;
  let options;
  const startedAt = new Date().toISOString();
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed['changed-groups']) return listChangedGroups(parsed);
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
    validateDeclaredRootsResolve(assignmentIndex);
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

    const nightly = options.group === NIGHTLY_GROUP_ID ? nightlySelection(assignmentIndex) : null;
    if (nightly && !nightly.roots.length) {
      result.status = 'no_active_roots';
      result.crossEngine = crossEngineReport(nightly, 0);
      result.finishedAt = new Date().toISOString();
      atomicWrite(path.join(outputDir, 'result.json'), result);
      process.stdout.write(crossEngineNotice(result.crossEngine));
      return 0;
    }
    const selectedFiles = nightly ? nightly.files : [...new Set([
      ...files.filter(file => assignmentIndex.rootsPerGroup.get(options.group).some(root => assignmentIndex.assignmentsByRoot.get(root)?.file === file)),
    ])].sort();
    const selectedRoots = nightly ? nightly.roots : assignmentIndex.rootsPerGroup.get(options.group).sort();
    if (!selectedFiles.length || !selectedRoots.length) fail(`Required group ${options.group} is empty.`);

    if (!nightly) result.inventory = {
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
    if (!nightly) result.processControls = assignments.processControls.filter(control => control.group === options.group).map(control => ({
      id: control.id,
      group: control.group,
      file: control.file,
      ownerRoot: control.ownerRoot,
      expectedExecutions: control.expectedExecutions,
      registrationCount: countTestRegistrations(fs.readFileSync(path.join(ROOT, control.file), 'utf8'), control.id),
    }));

    if (options.group === 'core') result.unclassifiedRootGuard = await unclassifiedRootGuard(files,assignmentIndex,outputDir);
    const heapMb = nightly ? undefined : assignments.groups.find(group => group.id === options.group)?.nodeMaxOldSpaceSizeMb;
    const childResult = await runChild(selectedFiles, selectedRoots, outputDir, options, source, heapMb);
    nativeDir = childResult.nativeDir;
    result.process = {
      exitCode: childResult.exit.code,
      signal: childResult.exit.signal,
      spawnError: childResult.exit.error,
      stdout: { path: path.basename(childResult.tapPath), sha256: childResult.tapSha256 },
      stderr: { path: path.basename(childResult.stderrPath), sha256: childResult.stderrSha256 },
      selection: childResult.selection,
      ...(heapMb === undefined ? {} : { nodeMaxOldSpaceSizeMb: heapMb }),
    };
    result.cases = childResult.cases.map(({ id, root, status, skipReason }) => ({ id, root, status, skipReason }));
    result.artifacts = [...artifactInventory(nativeDir), ...artifactInventory(childResult.recoveryDir)];
    result.issues = nightly ? verifyNightlyResults(childResult.cases, selectedRoots) : verifyResults({
      cases: childResult.cases,
      group: options.group,
      inventory,
      assignments: { ...assignmentIndex, processControls: assignments.processControls },
      files: selectedFiles,
      source,
    });
    // Each declared environment skip in this group, with its actual outcome.
    result.environmentSkips = [...assignmentIndex.environmentSkips.values()]
      .filter(entry => assignmentIndex.assignmentsByRoot.get(entry.root)?.group === options.group)
      .map(entry => ({ root: entry.root, environment: entry.environment,
        status: childResult.cases.find(item => item.id === normalizeTapIdentity(entry.root))?.status ?? 'missing' }));
    if (childResult.exit.code !== 0) result.issues.unshift(`Test process exited with ${childResult.exit.code ?? childResult.exit.signal ?? childResult.exit.error}.`);
    if (gitStatus.trim() && !source.dirty) result.issues.push('Checkout dirty state could not be reconciled with its identity.');
    result.status = result.issues.length ? 'failed' : 'passed';
    if (nightly) {
      result.crossEngine = crossEngineReport(nightly, childResult.cases.length);
      process.stdout.write(crossEngineNotice(result.crossEngine));
    }
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
