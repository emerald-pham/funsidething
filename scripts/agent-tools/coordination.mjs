#!/usr/bin/env node

import { tmpdir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { lstat, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const DEFAULT_VERSION_AGREEMENT = 'Increment the patch version for each completed player-facing fix; roll 0.x.99 over to 0.(x+1).0; do not bump tooling-only work.';
const DEFAULT_COORDINATION_FILE = 'den-of-wolves-new-eden-coordination.json';
const LOCK_RETRY_MS = 50;
const LOCK_ATTEMPTS = 600;
const EMPTY_LOCK_GRACE_MS = 1_000;
const DEFAULT_COORDINATION_LEASE_MS = 90_000;
const execFileAsync = promisify(execFile);

function discover(args, environment = process.env) {
  const fileIndexes = args.flatMap((argument, index) => argument === '--file' ? [index] : []);
  if (fileIndexes.length > 1) throw new Error('Option --file can be provided only once.');
  const fileIndex = fileIndexes[0];
  if (fileIndex !== undefined && (!args[fileIndex + 1] || args[fileIndex + 1].startsWith('--'))) {
    throw new Error('Missing value for --file.');
  }
  const explicit = fileIndex === undefined ? undefined : args[fileIndex + 1];
  const codexPath = environment.CODEX_COORDINATION_FILE?.trim();
  const legacyPath = environment.DOW_EMULATOR_COORDINATION_FILE?.trim();
  const canonical = codexPath ? resolve(codexPath) : undefined;
  const legacy = legacyPath ? resolve(legacyPath) : undefined;
  const requested = explicit?.trim() ? resolve(explicit) : undefined;

  if (canonical && legacy && canonical !== legacy) {
    throw new Error(`Conflicting coordination paths: CODEX_COORDINATION_FILE selects ${canonical}, while DOW_EMULATOR_COORDINATION_FILE selects ${legacy}.`);
  }
  const configured = canonical ?? legacy;
  if (requested && configured && requested !== configured) {
    throw new Error(`Conflicting coordination paths: --file selects ${requested}, while ${canonical ? 'CODEX_COORDINATION_FILE' : 'DOW_EMULATOR_COORDINATION_FILE'} selects ${configured}.`);
  }
  return requested ?? configured ?? resolve(tmpdir(), 'den-of-wolves-new-eden-coordination.json');
}

function objectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeState(value) {
  const source = objectRecord(value);
  return {
    ...source,
    version: 1,
    scope: 'codex-wide',
    versionAgreement: text(source.versionAgreement, DEFAULT_VERSION_AGREEMENT),
    entries: Array.isArray(source.entries) ? source.entries.filter((entry) => objectRecord(entry).id) : [],
    reservations: Array.isArray(source.reservations) ? source.reservations.filter((item) => objectRecord(item).worktree) : [],
    configurations: Array.isArray(source.configurations) ? source.configurations.filter((item) => objectRecord(item).worktree) : [],
  };
}

function emptyState() {
  return normalizeState({});
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function isoNow(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${String(value)}.`);
  return date.toISOString();
}

async function readState(filePath, { pruneReservations = true } = {}) {
  try {
    const state = normalizeState(JSON.parse(await readFile(filePath, 'utf8')));
    if (pruneReservations) {
      state.reservations = state.reservations.filter((reservation) =>
        processIsAlive(reservation.pid) || processIsAlive(reservation.childPid));
    }
    return state;
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyState();
    if (error instanceof SyntaxError) throw new Error(`The shared coordination file is corrupted. ${error.message}`, { cause: error });
    throw error;
  }
}

function lockOwner(content) {
  const trimmed = String(content).trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Number.isInteger(parsed?.pid) && parsed.pid > 0) {
      return { pid: parsed.pid, token: typeof parsed.token === 'string' ? parsed.token : undefined };
    }
  } catch {
    // Legacy lock files stored only a PID.
  }
  const pid = Number.parseInt(trimmed, 10);
  return Number.isInteger(pid) && pid > 0 ? { pid, token: undefined } : undefined;
}

async function lockIsStale(lockPath) {
  try {
    const [contents, metadata] = await Promise.all([readFile(lockPath, 'utf8'), stat(lockPath)]);
    if (!contents.trim()) return Date.now() - metadata.mtimeMs >= EMPTY_LOCK_GRACE_MS;
    const owner = lockOwner(contents);
    return !owner || !processIsAlive(owner.pid);
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

async function releaseOwnedLock(lockPath, token) {
  try {
    const owner = lockOwner(await readFile(lockPath, 'utf8'));
    if (owner?.token !== token) return;
    await unlink(lockPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function reclaimStaleRecoveryLock(recoveryPath) {
  if (!(await lockIsStale(recoveryPath))) return false;
  await delay(LOCK_RETRY_MS);
  if (!(await lockIsStale(recoveryPath))) return false;
  await unlink(recoveryPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return true;
}

async function reclaimStaleLock(lockPath) {
  const recoveryPath = `${lockPath}.recovery`;
  const recoveryToken = randomUUID();
  let recoveryHandle;
  try {
    recoveryHandle = await open(recoveryPath, 'wx', 0o600);
    await recoveryHandle.writeFile(`${JSON.stringify({ pid: process.pid, token: recoveryToken })}\n`, 'utf8');
  } catch (error) {
    if (recoveryHandle) await recoveryHandle.close().catch(() => undefined);
    if (error?.code === 'EEXIST') {
      await reclaimStaleRecoveryLock(recoveryPath);
      return false;
    }
    throw error;
  }
  try {
    if (!(await lockIsStale(lockPath))) return false;
    await delay(LOCK_RETRY_MS);
    if (!(await lockIsStale(lockPath))) return false;
    await unlink(lockPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    return true;
  } finally {
    await recoveryHandle.close();
    await releaseOwnedLock(recoveryPath, recoveryToken);
  }
}

async function withCoordinationLock(filePath, operation) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const lockPath = `${filePath}.lock`;
  const lockToken = randomUUID();
  let lockHandle;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    let candidateHandle;
    try {
      candidateHandle = await open(lockPath, 'wx', 0o600);
      await candidateHandle.writeFile(`${JSON.stringify({ pid: process.pid, token: lockToken })}\n`, 'utf8');
      lockHandle = candidateHandle;
      break;
    } catch (error) {
      if (candidateHandle) {
        await candidateHandle.close().catch(() => undefined);
        await releaseOwnedLock(lockPath, lockToken).catch(() => undefined);
      }
      if (error?.code !== 'EEXIST') throw error;
      if (await lockIsStale(lockPath)) await reclaimStaleLock(lockPath);
      else await delay(LOCK_RETRY_MS);
    }
  }
  if (!lockHandle) throw new Error(`Timed out waiting for coordination lock at ${lockPath}.`);
  try {
    return await operation();
  } finally {
    await lockHandle.close();
    await releaseOwnedLock(lockPath, lockToken);
  }
}

async function writeState(filePath, state) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function parseList(value) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.flatMap((item) => String(item ?? '').split(',').map((part) => part.trim())).filter(Boolean);
}

function normalizePath(value) {
  return text(value).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function normalizeScope(value) {
  const normalized = normalizePath(value);
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Invalid repository-relative scope: ${String(value)}.`);
  }
  return normalized;
}

function normalizeOwnership(options = {}) {
  const scopes = [...new Set(parseList(options.scope ?? options.scopes).map(normalizeScope))];
  const claims = [...new Set(parseList(options.claims ?? options.claim).map((claim) => claim.toLowerCase()))];
  const resources = [...new Set(parseList(options.resources).map((resource) => resource.toLowerCase()))];
  return { scopes, claims, resources };
}

function ownsCoordination(entry) {
  return entry?.status === 'active' || entry?.status === 'parked';
}

function isCrossRepositoryClaim(value) {
  const claim = String(value ?? '').trim().toLowerCase().replaceAll('\\', '/').replace(/^\.\//, '');
  return new Set(['package.json', 'package-lock.json', 'src/changelog.ts']).has(claim) ||
    claim.startsWith('release-') || claim.startsWith('coordination-') ||
    claim.startsWith('emulator-slot-') || claim.startsWith('validation-queue');
}

function ownershipConflict(entries, ownerId, worktree, claims, resources) {
  const requestedClaims = new Set(claims.map((claim) => claim.toLowerCase()));
  const requestedResources = new Set(resources.map((resource) => resource.toLowerCase()));
  for (const entry of entries) {
    if (!ownsCoordination(entry) || entry.id === ownerId || entry.worktree === worktree) continue;
    const entryClaims = parseList(entry.claims).map((claim) => claim.toLowerCase());
    const entryResources = parseList(entry.resources).map((resource) => resource.toLowerCase());
    const claim = entryClaims.find((candidate) => requestedClaims.has(candidate) && isCrossRepositoryClaim(candidate));
    if (claim) return { entry, kind: 'claim', value: claim };
    const resource = entryResources.find((candidate) => requestedResources.has(candidate));
    if (resource) return { entry, kind: 'resource', value: resource };
  }
  return undefined;
}

function formatOwnershipConflict(conflict) {
  return `Conflict with ${conflict.entry.id} at ${conflict.entry.worktree}: ${conflict.kind} "${conflict.value}" is already owned. Wait for the current owner.`;
}

async function runGit(args, cwd = process.cwd()) {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return result.stdout.trim();
}

async function readMainRef(cwd) {
  let lastError;
  for (const ref of ['main', 'origin/main']) {
    try {
      return { ref, sha: await runGit(['rev-parse', '--verify', `${ref}^{commit}`], cwd) };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error('Cannot resolve the main branch from main or origin/main.', { cause: lastError });
}

async function readGitStartState(cwd = process.cwd()) {
  const [branchName, branchSha, main, repositoryRoot, repositoryIdentity] = await Promise.all([
    runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    runGit(['rev-parse', 'HEAD'], cwd),
    readMainRef(cwd),
    runGit(['rev-parse', '--show-toplevel'], cwd),
    runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd),
  ]);
  if (branchName === 'HEAD') throw new Error('coordination begin requires an attached branch.');
  if (branchName === 'main') throw new Error('coordination begin refuses to register work directly on main.');
  return {
    branchName,
    branchSha,
    mainSha: main.sha,
    repositoryRoot: resolve(repositoryRoot),
    repositoryIdentity: resolve(repositoryIdentity),
  };
}

function pruneDeadReservations(state) {
  return {
    ...state,
    reservations: (state.reservations ?? []).filter((reservation) =>
      processIsAlive(reservation.pid) || processIsAlive(reservation.childPid)),
  };
}

function pruneOrphanedConfigurations(state) {
  const active = new Set((state.entries ?? []).filter((entry) => entry.status === 'active').map((entry) => entry.worktree));
  const reserved = new Set((state.reservations ?? []).map((reservation) => reservation.worktree));
  return {
    ...state,
    configurations: (state.configurations ?? []).filter((configuration) =>
      active.has(configuration.worktree) || reserved.has(configuration.worktree)),
  };
}

async function begin(filePath, options) {
  const start = await readGitStartState();
  const worktreeRoot = await realpath(start.repositoryRoot);
  if (await realpath(process.cwd()) !== worktreeRoot) {
    throw new Error(`coordination begin requires the actual Git worktree root: ${worktreeRoot}.`);
  }
  const { scopes, claims, resources } = normalizeOwnership(options);
  const workType = text(options['work-type'], 'tooling');
  if (!['product', 'tooling', 'documentation', 'investigation'].includes(workType)) {
    throw new Error('coordination begin requires --work-type product|tooling|documentation|investigation.');
  }
  return withCoordinationLock(filePath, async () => {
    const state = pruneDeadReservations(await readState(filePath));
    for (const entry of state.entries.filter(ownsCoordination)) {
      let sameWorktree = entry.worktree === process.cwd();
      if (!sameWorktree && typeof entry.worktree === 'string' && isAbsolute(entry.worktree)) {
        try {
          const recordedPath = await realpath(entry.worktree);
          // Resolve only paths within this checkout; a nested independent Git repo
          // remains a distinct owner. Legacy strings are never rewritten.
          if (recordedPath === worktreeRoot || recordedPath.startsWith(`${worktreeRoot}/`)) {
            sameWorktree = await realpath(await runGit(['rev-parse', '--show-toplevel'], recordedPath)) === worktreeRoot;
          }
        } catch { /* Missing/offline owners retain their existing ownership and metadata. */ }
      }
      if (sameWorktree) throw new Error('An active or parked coordination entry already exists for the same Git worktree.');
    }
    const conflict = ownershipConflict(state.entries, undefined, process.cwd(), claims, resources);
    if (conflict) throw new Error(formatOwnershipConflict(conflict));
    const now = new Date().toISOString();
    const implementationPrompt = text(options['implementation-prompt']).toLowerCase();
    const entry = {
      id: `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`,
      worktree: worktreeRoot,
      pid: process.pid,
      startedAt: now,
      heartbeatAt: now,
      status: 'active',
      branchName: start.branchName,
      startBranchSha: start.branchSha,
      startMainSha: start.mainSha,
      repositoryRoot: start.repositoryRoot,
      repositoryIdentity: start.repositoryIdentity,
      intent: text(options.intent, 'Unspecified coordination work.'),
      versionPlan: text(options['version-plan'], 'No application version change.'),
      preemptiveChangelog: text(options['preemptive-changelog'], 'No player-facing change.'),
      workType,
      scopes,
      claims,
      resources,
      requestedScopes: scopes,
      requestedClaims: claims,
      ...(implementationPrompt ? { implementationPrompt } : {}),
    };
    state.entries.push(entry);
    await writeState(filePath, pruneOrphanedConfigurations(state));
    return entry;
  });
}

function refreshLease(entry, { now = new Date(), leaseMs = DEFAULT_COORDINATION_LEASE_MS } = {}) {
  if (entry?.status !== 'active') throw new Error(`Cannot heartbeat coordination entry ${text(entry?.id, 'unknown')}: it is not active.`);
  const heartbeatAt = isoNow(now);
  return {
    ...entry,
    heartbeatAt,
    lease: {
      state: 'healthy',
      ownerConfirmationRequired: false,
      takeoverAllowed: false,
      lastHeartbeatAt: heartbeatAt,
      expiresAt: new Date(Date.parse(heartbeatAt) + leaseMs).toISOString(),
    },
  };
}

async function heartbeat(filePath, options) {
  if (!options.id) throw new Error('coordination heartbeat requires --id <entry-id>.');
  return withCoordinationLock(filePath, async () => {
    const state = pruneDeadReservations(await readState(filePath));
    const entry = state.entries.find((candidate) => candidate.id === options.id);
    if (!entry) throw new Error(`No coordination entry found for ${options.id}.`);
    if (entry.status !== 'active') throw new Error(`Cannot heartbeat coordination entry ${entry.id}: it is not active.`);
    if (entry.worktree !== process.cwd()) throw new Error(`Cannot heartbeat coordination entry ${entry.id} from ${process.cwd()}; it belongs to ${entry.worktree}.`);
    Object.assign(entry, refreshLease(entry, { now: options.now }));
    await writeState(filePath, state);
    return entry;
  });
}

async function park(filePath, options) {
  if (!options.id) throw new Error('coordination park requires --id <entry-id>.');
  const checkpoint = text(options['checkpoint-sha']).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(checkpoint)) throw new Error('coordination park requires an exact 40-character --checkpoint-sha value.');
  return withCoordinationLock(filePath, async () => {
    const state = await readState(filePath, { pruneReservations: false });
    const entry = state.entries.find((candidate) => candidate.id === options.id);
    if (!entry) throw new Error(`No coordination entry found for ${options.id}.`);
    if (entry.status !== 'active') throw new Error(`Coordination entry ${entry.id} is already ${text(entry.status, 'historical')}.`);
    if (entry.worktree !== process.cwd()) throw new Error(`Cannot park coordination entry ${entry.id} from ${process.cwd()}; it belongs to ${entry.worktree}.`);
    const current = await readGitStartState();
    if (current.branchName !== entry.branchName || current.branchSha.toLowerCase() !== checkpoint) {
      throw new Error(`Cannot park coordination entry ${entry.id}: checkpoint or branch does not match the current checkout.`);
    }
    if ((await runGit(['status', '--porcelain', '--untracked-files=all'])).trim()) {
      throw new Error(`Cannot park coordination entry ${entry.id}: the checkout is not clean.`);
    }
    const now = isoNow(options.now);
    entry.status = 'parked';
    entry.parkedAt = now;
    entry.parked = {
      status: 'parked',
      parkedAt: now,
      checkpointSha: checkpoint,
      worktree: process.cwd(),
      branchName: current.branchName,
      nextAction: text(options['next-action'], 'Resume when the blocker clears.'),
    };
    entry.lease = { state: 'parked-no-heartbeat-required', ownerConfirmationRequired: false, takeoverAllowed: false };
    await writeState(filePath, state);
    return entry;
  });
}

async function resume(filePath, options) {
  if (!options.id) throw new Error('coordination resume requires --id <entry-id>.');
  return withCoordinationLock(filePath, async () => {
    const state = await readState(filePath, { pruneReservations: false });
    const entry = state.entries.find((candidate) => candidate.id === options.id);
    if (!entry) throw new Error(`No coordination entry found for ${options.id}.`);
    if (entry.status !== 'parked') throw new Error(`Cannot resume coordination entry ${entry.id}: it is not parked.`);
    if (entry.worktree !== process.cwd()) throw new Error(`Cannot resume coordination entry ${entry.id} from ${process.cwd()}; it belongs to ${entry.worktree}.`);
    const parked = objectRecord(entry.parked);
    const checkpoint = text(options['checkpoint-sha'], text(parked.checkpointSha)).toLowerCase();
    const current = await readGitStartState();
    if (current.branchName !== entry.branchName || current.branchSha.toLowerCase() !== checkpoint) {
      throw new Error(`Cannot resume coordination entry ${entry.id}: parked checkpoint does not match the current checkout.`);
    }
    if ((await runGit(['status', '--porcelain', '--untracked-files=all'])).trim()) {
      throw new Error(`Cannot resume coordination entry ${entry.id}: the checkout is not clean.`);
    }
    const now = isoNow(options.now);
    entry.status = 'active';
    entry.resumedAt = now;
    entry.heartbeatAt = now;
    entry.parked = { ...parked, status: 'resumed', resumedAt: now };
    entry.lease = { state: 'healthy', ownerConfirmationRequired: false, takeoverAllowed: false, lastHeartbeatAt: now };
    await writeState(filePath, state);
    return entry;
  });
}

async function finish(filePath, options) {
  if (!options.id) throw new Error('coordination finish requires --id <entry-id>.');
  const adapter = text(options.adapter);
  if (!adapter) throw new Error('coordination finish requires an explicit --adapter chain-scanner.');
  if (adapter !== 'chain-scanner') throw new Error(`Unsupported coordination completion adapter: ${adapter}.`);
  const outcome = text(options.outcome, 'landed');
  if (!['landed', 'preserved', 'discarded'].includes(outcome)) {
    throw new Error('coordination finish outcome must be landed, preserved, or discarded.');
  }
  return withCoordinationLock(filePath, async () => {
    const state = await readState(filePath, { pruneReservations: false });
    const entry = state.entries.find((candidate) => candidate.id === options.id);
    if (!entry) throw new Error(`No coordination entry found for ${options.id}.`);
    if (entry.status !== 'active') throw new Error(`Coordination entry ${entry.id} is already ${text(entry.status, 'historical')}.`);
    if (entry.worktree !== process.cwd()) throw new Error(`Cannot finish coordination entry ${entry.id} from ${process.cwd()}; it belongs to ${entry.worktree}.`);

    const release = await readChainScannerReleaseState(entry);
    let releaseEvidence;
    if (outcome === 'landed') {
      if (release.mainContainsBranch !== true) {
        throw new Error(`Cannot complete coordination entry ${entry.id}: local main does not contain exact task commit ${release.branchSha}.`);
      }
      if (release.originMainSha !== release.mainSha) {
        throw new Error(`Cannot complete coordination entry ${entry.id}: origin/main (${release.originMainSha}) does not match local main (${release.mainSha}).`);
      }
      const verified = await verifyChainScannerReleaseEvidence(release.repositoryRoot, release.branchSha);
      if (!verified.ok) throw new Error(`Cannot complete coordination entry ${entry.id}: Chain Scanner release evidence failed: ${verified.errors.join(' ')}`);
      releaseEvidence = {
        adapter,
        receiptPath: verified.receiptPath,
        receiptSha256: verified.receipt.receiptSha256,
        candidate: {
          commitSha: verified.receipt.candidate.commitSha,
          treeSha: verified.receipt.candidate.treeSha,
          baseSha: verified.receipt.candidate.baseSha,
        },
        reviewPlan: verified.receipt.reviewPlan,
        verifiedAt: new Date().toISOString(),
      };
    } else if (outcome === 'preserved') {
      const destination = text(options['preserve-ref']);
      if (!destination) throw new Error(`Cannot preserve coordination entry ${entry.id}: --preserve-ref is required.`);
      const separator = destination.indexOf('/');
      if (separator < 1 || separator === destination.length - 1) throw new Error('--preserve-ref must be remote/branch.');
      const ref = `refs/heads/${destination.slice(separator + 1)}`;
      const actual = (await runGit(['ls-remote', '--exit-code', destination.slice(0, separator), ref], release.repositoryRoot)).split(/\s+/)[0];
      if (actual !== release.branchSha) throw new Error(`Preserved ref ${destination} does not contain ${release.branchSha}.`);
      entry.preservation = { destination, commitSha: release.branchSha, verifiedAt: new Date().toISOString() };
    } else {
      const reason = text(options.reason);
      if (!reason) throw new Error(`Cannot discard coordination entry ${entry.id}: --reason is required.`);
      entry.discard = { reason, branchSha: release.branchSha };
    }

    entry.status = 'complete';
    entry.outcome = outcome;
    entry.completedAt = new Date().toISOString();
    if (text(options.result)) entry.result = text(options.result);
    entry.finalBranchName = release.branchName;
    entry.finalBranchSha = release.branchSha;
    entry.mainSha = release.mainSha;
    entry.originMainSha = release.originMainSha;
    entry.pushed = outcome === 'landed' && release.originMainSha === release.mainSha;
    if (releaseEvidence) entry.releaseEvidence = releaseEvidence;
    await writeState(filePath, state);
    return entry;
  });
}

async function readChainScannerReleaseState(entry, cwd = process.cwd()) {
  const [branchName, branchSha, repositoryRoot, main] = await Promise.all([
    runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    runGit(['rev-parse', 'HEAD'], cwd),
    runGit(['rev-parse', '--show-toplevel'], cwd),
    readMainRef(cwd),
  ]);
  const root = resolve(repositoryRoot);
  if (branchName === 'HEAD' || branchName === 'main') throw new Error('Chain Scanner completion requires the task branch, not detached HEAD or main.');
  if (branchName !== entry.branchName) throw new Error(`Cannot finish coordination entry ${entry.id}: checkout branch ${branchName} does not match ${entry.branchName}.`);
  if ((await runGit(['status', '--porcelain', '--untracked-files=all'], cwd)).trim()) {
    throw new Error(`Cannot finish coordination entry ${entry.id}: the checkout is not clean.`);
  }
  if (entry.startBranchSha && !(await gitIsAncestor(entry.startBranchSha, branchSha, cwd))) {
    throw new Error(`Cannot finish coordination entry ${entry.id}: its registered start commit is not an ancestor of the task branch.`);
  }
  let originTrackingMainSha;
  try {
    originTrackingMainSha = await runGit(['rev-parse', '--verify', 'origin/main^{commit}'], cwd);
  } catch (error) {
    throw new Error('Cannot finish Chain Scanner work: the local origin/main tracking ref is unavailable.', { cause: error });
  }
  let originMainLine;
  try {
    originMainLine = await runGit(['ls-remote', '--exit-code', 'origin', 'refs/heads/main'], cwd);
  } catch (error) {
    throw new Error('Cannot finish Chain Scanner work: the remote origin main ref is unavailable.', { cause: error });
  }
  const originMainSha = originMainLine.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(originMainSha)) throw new Error('Cannot finish Chain Scanner work: origin returned an invalid main SHA.');
  const mainContainsBranch = await gitIsAncestor(branchSha, main.sha, cwd);
  return { branchName, branchSha, repositoryRoot: root, mainSha: main.sha, mainRef: main.ref, originTrackingMainSha, originMainSha, mainContainsBranch };
}

async function gitIsAncestor(ancestor, descendant, cwd) {
  try {
    await runGit(['merge-base', '--is-ancestor', ancestor, descendant], cwd);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

async function verifyChainScannerReleaseEvidence(repositoryRoot, commitSha) {
  const modulePath = resolve(repositoryRoot, 'scripts/release-evidence.mjs');
  let releaseEvidenceModule;
  try {
    releaseEvidenceModule = await import(pathToFileURL(modulePath).href);
  } catch (error) {
    throw new Error(`Cannot load Chain Scanner release-evidence adapter at ${modulePath}: ${error.message}`, { cause: error });
  }
  if (typeof releaseEvidenceModule.verifyReleaseEvidence !== 'function') {
    throw new Error(`Chain Scanner release-evidence adapter at ${modulePath} does not export verifyReleaseEvidence().`);
  }
  return releaseEvidenceModule.verifyReleaseEvidence(repositoryRoot, commitSha);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function install(options) {
  const destination = text(options.to);
  if (!destination || !isAbsolute(destination)) {
    throw new Error('coordination install requires an explicit absolute --to <destination-file>.');
  }
  const target = resolve(destination);
  const source = resolve(process.argv[1]);
  const sourceContents = await readFile(source);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  try {
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Refusing to replace non-regular install target ${target}.`);
    const existing = await readFile(target);
    if (!existing.equals(sourceContents)) throw new Error(`Refusing to overwrite a different installed file at ${target}.`);
    if ((metadata.mode & 0o111) === 0) throw new Error(`Existing install target ${target} is not executable; refusing to change its permissions.`);
    console.log(JSON.stringify({ installed: true, unchanged: true, path: target }));
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const handle = await open(target, 'wx', 0o755);
  try {
    await handle.writeFile(sourceContents);
    await handle.chmod(0o755);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(target).catch(() => undefined);
    throw error;
  }
  await handle.close();
  console.log(JSON.stringify({ installed: true, unchanged: false, path: target }));
}

async function claim(filePath, options) {
  if (!options.id) throw new Error('coordination claim requires --id <entry-id>.');
  const { scopes, claims, resources } = normalizeOwnership(options);
  return withCoordinationLock(filePath, async () => {
    const state = pruneDeadReservations(await readState(filePath));
    const entry = state.entries.find((candidate) => candidate.id === options.id);
    if (!entry) throw new Error(`No coordination entry found for ${options.id}.`);
    if (entry.status !== 'active') throw new Error(`Coordination entry ${entry.id} is already ${text(entry.status, 'historical')}.`);
    if (entry.worktree !== process.cwd()) throw new Error(`Cannot claim coordination entry ${entry.id} from ${process.cwd()}; it belongs to ${entry.worktree}.`);
    const conflict = ownershipConflict(state.entries, entry.id, process.cwd(), claims, resources);
    if (conflict) throw new Error(formatOwnershipConflict(conflict));
    entry.scopes = [...new Set([...(entry.scopes ?? []), ...scopes])];
    entry.claims = [...new Set([...(entry.claims ?? []), ...claims])];
    entry.resources = [...new Set([...(entry.resources ?? []), ...resources])];
    entry.amendments = [...(entry.amendments ?? []), { amendedAt: isoNow(options.now), scopes, claims, resources }];
    await writeState(filePath, pruneOrphanedConfigurations(state));
    return entry;
  });
}

async function releaseClaim(filePath, options) {
  if (!options.id) throw new Error('coordination release-claim requires --id <entry-id>.');
  const { scopes, claims, resources } = normalizeOwnership(options);
  if (!scopes.length && !claims.length && !resources.length) {
    throw new Error('coordination release-claim requires ownership or resource values.');
  }
  return withCoordinationLock(filePath, async () => {
    const state = await readState(filePath, { pruneReservations: false });
    const entry = state.entries.find((candidate) => candidate.id === options.id);
    if (!entry) throw new Error(`No coordination entry found for ${options.id}.`);
    if (entry.worktree !== process.cwd()) throw new Error(`Cannot release coordination claim for ${entry.id} from ${process.cwd()}; it belongs to ${entry.worktree}.`);
    const scopeSet = new Set(scopes);
    const claimSet = new Set(claims);
    const resourceSet = new Set(resources);
    entry.scopes = (entry.scopes ?? []).filter((scope) => !scopeSet.has(normalizePath(scope)));
    entry.claims = (entry.claims ?? []).filter((claim) => !claimSet.has(String(claim).toLowerCase()));
    entry.resources = (entry.resources ?? []).filter((resource) => !resourceSet.has(String(resource).toLowerCase()));
    entry.claimReleases = [...(entry.claimReleases ?? []), { releasedAt: isoNow(options.now), scopes, claims, resources }];
    await writeState(filePath, state);
    return entry;
  });
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument?.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const name = argument.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}.`);
    if (['scope', 'claims', 'claim', 'resources'].includes(name)) {
      options[name] = [...(Array.isArray(options[name]) ? options[name] : []), value];
    } else {
      if (Object.hasOwn(options, name)) throw new Error(`Option --${name} can be provided only once.`);
      options[name] = value;
    }
    index += 1;
  }
  return options;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'discover') {
  try {
    console.log(discover(args));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
} else if (command === 'status') {
  try {
    const filePath = discover(args);
    console.log(JSON.stringify({ filePath, state: await readState(filePath) }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
} else if (command === 'begin') {
  try {
    const entry = await begin(discover(args), parseOptions(args));
    console.log(JSON.stringify(entry, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
} else if (command === 'heartbeat') {
  try {
    const entry = await heartbeat(discover(args), parseOptions(args));
    console.log(JSON.stringify(entry, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
} else if (command === 'park' || command === 'resume') {
  try {
    const operation = command === 'park' ? park : resume;
    const entry = await operation(discover(args), parseOptions(args));
    console.log(JSON.stringify(entry, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
} else if (command === 'finish') {
  try {
    const entry = await finish(discover(args), parseOptions(args));
    console.log(JSON.stringify(entry, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
} else if (command === 'export-env') {
  try {
    const filePath = discover(args);
    console.log(`export CODEX_COORDINATION_FILE=${shellQuote(filePath)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
} else if (command === 'install') {
  try {
    await install(parseOptions(args));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
} else if (command === 'claim') {
  try {
    const entry = await claim(discover(args), parseOptions(args));
    console.log(JSON.stringify(entry, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
} else if (command === 'release-claim') {
  try {
    const entry = await releaseClaim(discover(args), parseOptions(args));
    console.log(JSON.stringify(entry, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
} else {
  console.error('usage: coordination.mjs <discover|export-env|install|status|begin|heartbeat|claim|release-claim|park|resume|finish> [options]');
  process.exitCode = 2;
}
