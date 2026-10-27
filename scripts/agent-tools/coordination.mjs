#!/usr/bin/env node

import { tmpdir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { link, lstat, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const DEFAULT_VERSION_AGREEMENT = 'Increment the patch version for each completed player-facing fix; roll 0.x.99 over to 0.(x+1).0; do not bump tooling-only work.';
const DEFAULT_COORDINATION_FILE = 'den-of-wolves-new-eden-coordination.json';
const LOCK_RETRY_MS = 50;
const LOCK_ATTEMPTS = 600;
const EMPTY_LOCK_GRACE_MS = 1_000;
const DEFAULT_COORDINATION_LEASE_MS = 90_000;
const RETIRED_LEDGER_PREFIX = '!CODEX_COORDINATION_RETIRED_V1\n';
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
    const contents = await readFile(filePath, 'utf8');
    if (contents.startsWith(RETIRED_LEDGER_PREFIX)) {
      throw new Error(`This coordination ledger is retired. ${contents.slice(RETIRED_LEDGER_PREFIX.length).trim()}`);
    }
    const state = normalizeState(JSON.parse(contents));
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

async function migrationLockSnapshot(lockPath) {
  const metadata = await metadataIfPresent(lockPath);
  if (!metadata) return undefined;
  assertOwnedMetadata(metadata, lockPath);
  const contents = await readFile(lockPath, 'utf8');
  const owner = lockOwner(contents);
  if (!owner) throw new Error(`Migration cannot verify lock ownership at ${lockPath}.`);
  const identity = fileIdentity(metadata);
  await requireMigrationFile(lockPath, identity, sha256(contents));
  return { identity, digest: sha256(contents), owner };
}

async function requireMigrationLockSnapshot(lockPath, snapshot) {
  if (!snapshot) return false;
  if (!(await metadataIfPresent(lockPath))) return false;
  await requireMigrationFile(lockPath, snapshot.identity, snapshot.digest);
  return true;
}

async function lockIsStale(lockPath, migration = false) {
  if (migration) {
    const snapshot = await migrationLockSnapshot(lockPath);
    return !snapshot || !processIsAlive(snapshot.owner.pid);
  }
  try {
    const [contents, metadata] = await Promise.all([readFile(lockPath, 'utf8'), stat(lockPath)]);
    if (!contents.trim()) return Date.now() - metadata.mtimeMs >= EMPTY_LOCK_GRACE_MS;
    const owner = lockOwner(contents);
    return !owner || !processIsAlive(owner.pid);
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

async function releaseOwnedLock(lockPath, token, snapshot) {
  try {
    if (snapshot && !(await requireMigrationLockSnapshot(lockPath, snapshot))) return;
    const owner = lockOwner(await readFile(lockPath, 'utf8'));
    if (owner?.token !== token) return;
    await unlink(lockPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function reclaimStaleRecoveryLock(recoveryPath, migration = false) {
  const snapshot = migration ? await migrationLockSnapshot(recoveryPath) : undefined;
  const stale = () => migration ? snapshot && !processIsAlive(snapshot.owner.pid) : lockIsStale(recoveryPath);
  if (!(await stale())) return false;
  await delay(LOCK_RETRY_MS);
  if (!(await stale())) return false;
  if (migration && !(await requireMigrationLockSnapshot(recoveryPath, snapshot))) return false;
  await unlink(recoveryPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return true;
}

async function reclaimStaleLock(lockPath, migration = false) {
  const recoveryPath = `${lockPath}.recovery`;
  const recoveryToken = randomUUID();
  let recoveryHandle;
  let recoverySnapshot;
  try {
    if (migration) await migrationLockSnapshot(recoveryPath);
    recoveryHandle = await open(recoveryPath, 'wx', 0o600);
    const contents = `${JSON.stringify({ pid: process.pid, token: recoveryToken })}\n`;
    if (migration) recoverySnapshot = { identity: fileIdentity(await recoveryHandle.stat()), digest: sha256(contents) };
    await recoveryHandle.writeFile(contents, 'utf8');
    if (migration) await requireMigrationFile(recoveryPath, recoverySnapshot.identity, recoverySnapshot.digest);
  } catch (error) {
    if (recoveryHandle) await recoveryHandle.close().catch(() => undefined);
    if (error?.code === 'EEXIST') {
      await reclaimStaleRecoveryLock(recoveryPath, migration);
      return false;
    }
    throw error;
  }
  try {
    const snapshot = migration ? await migrationLockSnapshot(lockPath) : undefined;
    const stale = () => migration ? snapshot && !processIsAlive(snapshot.owner.pid) : lockIsStale(lockPath);
    if (!(await stale())) return false;
    await delay(LOCK_RETRY_MS);
    if (!(await stale())) return false;
    if (migration) {
      await requireMigrationFile(recoveryPath, recoverySnapshot.identity, recoverySnapshot.digest);
      if (!(await requireMigrationLockSnapshot(lockPath, snapshot))) return false;
    }
    await unlink(lockPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    return true;
  } finally {
    await recoveryHandle.close();
    await releaseOwnedLock(recoveryPath, recoveryToken, recoverySnapshot);
  }
}

async function withCoordinationLock(filePath, operation, { migration = false } = {}) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const lockPath = `${filePath}.lock`;
  const lockToken = randomUUID();
  let lockHandle;
  let lockSnapshot;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    let candidateHandle;
    let candidateSnapshot;
    try {
      if (migration) {
        await migrationLockSnapshot(lockPath);
        if (await migrationLockSnapshot(`${lockPath}.recovery`)) {
          await reclaimStaleRecoveryLock(`${lockPath}.recovery`, true);
          await delay(LOCK_RETRY_MS);
          continue;
        }
      }
      candidateHandle = await open(lockPath, 'wx', 0o600);
      const contents = `${JSON.stringify({ pid: process.pid, token: lockToken })}\n`;
      if (migration) candidateSnapshot = { identity: fileIdentity(await candidateHandle.stat()), digest: sha256(contents) };
      await candidateHandle.writeFile(contents, 'utf8');
      if (migration) await requireMigrationFile(lockPath, candidateSnapshot.identity, candidateSnapshot.digest);
      lockSnapshot = candidateSnapshot;
      lockHandle = candidateHandle;
      break;
    } catch (error) {
      if (candidateHandle) {
        await candidateHandle.close().catch(() => undefined);
        await releaseOwnedLock(lockPath, lockToken, candidateSnapshot).catch(() => undefined);
      }
      if (error?.code !== 'EEXIST') throw error;
      if (await lockIsStale(lockPath, migration)) await reclaimStaleLock(lockPath, migration);
      else await delay(LOCK_RETRY_MS);
    }
  }
  if (!lockHandle) throw new Error(`Timed out waiting for coordination lock at ${lockPath}.`);
  try {
    return await operation(async () => {
      if (migration && !(await requireMigrationLockSnapshot(lockPath, lockSnapshot))) {
        throw new Error(`Migration lost lock ownership at ${lockPath}.`);
      }
    });
  } finally {
    await lockHandle.close();
    await releaseOwnedLock(lockPath, lockToken, lockSnapshot);
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

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function absoluteMigrationPath(value, option) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value === '/') {
    throw new Error(`Migration requires a normalized absolute ${option} path.`);
  }
  return value;
}

async function metadataIfPresent(path) {
  try { return await lstat(path); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; return undefined; }
}

function assertOwnedMetadata(metadata, path, type = 'file') {
  if (typeof process.getuid !== 'function' || metadata.uid !== process.getuid()
    || metadata.isSymbolicLink() || (type === 'file' ? !metadata.isFile() : !metadata.isDirectory())
    || (metadata.mode & 0o022) !== 0 || (type === 'file' && metadata.nlink !== 1)) {
    throw new Error(`Unverifiable ownership or unsafe ${type} at ${path}; migration refuses symlinks, hardlinks and shared-writable paths.`);
  }
}

// Resolve existing ancestors before creating anything. Source aliases such as
// macOS /var are recorded explicitly; destination/backup ancestors must be literal.
async function migrationParent(path, { allowAlias = false } = {}) {
  let ancestor = dirname(path);
  while (!(await metadataIfPresent(ancestor))) {
    const next = dirname(ancestor);
    if (next === ancestor) throw new Error(`No existing migration ancestor for ${path}.`);
    ancestor = next;
  }
  const metadata = await lstat(ancestor);
  assertOwnedMetadata(metadata, ancestor, 'directory');
  const canonical = await realpath(ancestor);
  // macOS's system /var alias is the existing default source location. Other
  // ancestor aliases can disguise another ledger and require an explicit path.
  const systemVarAlias = allowAlias && (ancestor === '/var' || ancestor.startsWith('/var/'))
    && canonical === `/private${ancestor}`;
  if (canonical !== ancestor && !systemVarAlias) throw new Error(`Ambiguous symlink ancestor at ${ancestor}.`);
  let component = canonical;
  while (true) {
    const owner = await lstat(component);
    const systemTemporary = owner.uid === 0 && (owner.mode & 0o1000) !== 0;
    if (!owner.isDirectory() || owner.isSymbolicLink() || ![0, process.getuid()].includes(owner.uid)
      || ((owner.mode & 0o022) !== 0 && !systemTemporary)) {
      throw new Error(`Unsafe migration ancestor ownership or permissions at ${component}.`);
    }
    const parent = dirname(component);
    if (parent === component) break;
    component = parent;
  }
  return { ancestor, canonical, dev: metadata.dev, ino: metadata.ino };
}

function validateMigrationState(contents) {
  let state;
  try { state = JSON.parse(contents); }
  catch { throw new Error('Migration requires an intact v1 ledger; the source is not valid JSON.'); }
  if (state?.version !== 1 || state?.scope !== 'codex-wide'
    || !['entries', 'reservations', 'configurations'].every((key) => Array.isArray(state[key]))) {
    throw new Error('Migration requires the explicit v1 codex-wide ledger arrays; normalization is forbidden.');
  }
  const ids = new Set();
  const absoluteWorktree = (item) => typeof item?.worktree === 'string' && isAbsolute(item.worktree);
  for (const entry of state.entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || !absoluteWorktree(entry)
      || !['active', 'parked', 'complete'].includes(entry.status)
      || ['claims', 'resources', 'scopes'].some((key) => entry[key] !== undefined
        && (!Array.isArray(entry[key]) || entry[key].some((value) => typeof value !== 'string')))) {
      throw new Error('Migration refuses malformed or ambiguous entry ownership.');
    }
    ids.add(entry.id);
    if (entry.status === 'active') throw new Error(`Migration blocked by active coordination entry ${entry.id}; its owner must park or complete it.`);
    if (entry.status === 'parked' && (typeof entry.branchName !== 'string' || !entry.branchName
      || !/^[0-9a-f]{40}$/i.test(entry.parked?.checkpointSha ?? '')
      || (entry.parked?.worktree !== undefined && entry.parked.worktree !== entry.worktree))) {
      throw new Error(`Migration cannot verify parked ownership for ${entry.id}.`);
    }
  }
  for (const reservation of state.reservations) {
    if (!absoluteWorktree(reservation) || ![reservation?.pid, reservation?.childPid].some((pid) => Number.isInteger(pid) && pid > 0)) {
      throw new Error('Migration cannot verify reservation ownership.');
    }
    if (processIsAlive(reservation.pid) || processIsAlive(reservation.childPid)) {
      throw new Error('Migration blocked by a live reservation; its owner must stop it.');
    }
  }
  if (state.configurations.some((configuration) => !absoluteWorktree(configuration))) {
    throw new Error('Migration cannot verify configuration ownership.');
  }
  return state;
}

async function durableExclusiveFile(path, contents) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(contents); await handle.sync(); }
  finally { await handle.close(); }
}

async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

function fileIdentity(metadata) {
  return { dev: metadata.dev, ino: metadata.ino, uid: metadata.uid, mode: metadata.mode };
}

function sameIdentity(metadata, identity) {
  return metadata && ['dev', 'ino', 'uid', 'mode'].every((key) => metadata[key] === identity?.[key]);
}

async function requireMigrationFile(path, identity, digest, { linkedStage } = {}) {
  const metadata = await lstat(path);
  // Publication may be interrupted between the exclusive link and staging unlink.
  // Accept that single known alias only; arbitrary same-byte hardlinks are unsafe.
  if (linkedStage && metadata.nlink === 2) {
    const stage = await lstat(linkedStage);
    if (!sameIdentity(stage, identity)) throw new Error(`Unexpected publication alias at ${path}.`);
  } else {
    assertOwnedMetadata(metadata, path);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || !sameIdentity(metadata, identity)
    || sha256(await readFile(path)) !== digest || !sameIdentity(await lstat(path), identity)) {
    throw new Error(`Migration identity or bytes changed at ${path}; refusing to overwrite or infer ownership.`);
  }
}

async function assertMigrationAncestor(snapshot) {
  const metadata = await lstat(snapshot.ancestor);
  assertOwnedMetadata(metadata, snapshot.ancestor, 'directory');
  if (metadata.dev !== snapshot.dev || metadata.ino !== snapshot.ino
    || await realpath(snapshot.ancestor) !== snapshot.canonical) {
    throw new Error(`Migration ancestor changed at ${snapshot.ancestor}.`);
  }
}

async function assertAbsent(path) {
  if (await metadataIfPresent(path)) throw new Error(`Migration refuses an existing destination or conflicting state at ${path}.`);
}

function migrationBlocker(receipt) {
  return `${RETIRED_LEDGER_PREFIX}Canonical ledger: ${receipt.target}\nRecovery receipt: ${receipt.backupDirectory}/migration.json\nUse the shared CODEX_COORDINATION_FILE; this retired path is not a ledger.\n`;
}

async function updateMigrationReceipt(receipt) {
  const path = `${receipt.backupDirectory}/migration.json`;
  assertOwnedMetadata(await lstat(path), path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await durableExclusiveFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`);
  await rename(temporary, path);
  await syncDirectory(receipt.backupDirectory);
}

async function removeMigrationArtifact(path, identity, digest) {
  if (!(await metadataIfPresent(path))) return;
  await requireMigrationFile(path, identity, digest);
  await unlink(path);
  await syncDirectory(dirname(path));
}

async function migrate(source, options) {
  if (!options.file) throw new Error('Migration requires an explicit --file source.');
  source = absoluteMigrationPath(options.file, '--file');
  const target = absoluteMigrationPath(options.to, '--to');
  const backupDirectory = absoluteMigrationPath(options['backup-dir'], '--backup-dir');
  const expected = options['expected-sha256'];
  const phase = options.phase ?? 'all';
  if (!/^[0-9a-f]{64}$/.test(expected ?? '')) throw new Error('Migration requires an exact lowercase --expected-sha256 digest from the reviewed source.');
  if (!['prepare', 'block', 'publish', 'all', 'rollback'].includes(phase)) throw new Error('Migration --phase must be prepare, block, publish, all or rollback.');
  if ([source, target].some((path) => backupDirectory === path || backupDirectory.startsWith(`${path}/`))
    || source.startsWith(`${backupDirectory}/`) || target.startsWith(`${backupDirectory}/`)) {
    throw new Error('Migration source, destination and backup directory must be separate paths.');
  }
  const parents = await Promise.all([
    migrationParent(source, { allowAlias: true }), migrationParent(target), migrationParent(backupDirectory),
  ]);
  const canonicalSource = resolve(parents[0].canonical, source.slice(parents[0].ancestor.length + 1));
  const canonicalTarget = resolve(parents[1].canonical, target.slice(parents[1].ancestor.length + 1));
  if (canonicalSource === canonicalTarget || canonicalSource.startsWith(`${canonicalTarget}/`)
    || canonicalTarget.startsWith(`${canonicalSource}/`)) throw new Error('Migration paths alias or overlap.');
  for (const path of [source, target]) {
    for (const suffix of ['.lock', '.lock.recovery']) {
      const lockPath = `${path}${suffix}`;
      const lock = await metadataIfPresent(lockPath);
      if (lock) {
        assertOwnedMetadata(lock, lockPath);
        if (!lockOwner(await readFile(lockPath, 'utf8'))) throw new Error(`Migration cannot verify lock ownership at ${lockPath}.`);
      }
    }
  }
  const locks = [canonicalSource, canonicalTarget].sort();
  const receiptPath = `${backupDirectory}/migration.json`;
  return withCoordinationLock(locks[0], (verifyFirstLock) => withCoordinationLock(locks[1], async (verifySecondLock) => {
    await verifyFirstLock();
    await verifySecondLock();
    await Promise.all(parents.map(assertMigrationAncestor));
    // New parents created by the lock helper must also be literal private paths.
    await Promise.all([migrationParent(source, { allowAlias: true }), migrationParent(target)]);
    let receipt;
    try {
      if (phase === 'all' || phase === 'prepare') {
        await assertAbsent(target);
        await assertAbsent(backupDirectory);
        const metadata = await lstat(source);
        assertOwnedMetadata(metadata, source);
        const contents = await readFile(source);
        if (sha256(contents) !== expected) throw new Error('Migration source SHA-256 changed since review.');
        validateMigrationState(contents);
        const sourceIdentity = fileIdentity(metadata);
        await requireMigrationFile(source, sourceIdentity, expected);
        await mkdir(dirname(backupDirectory), { recursive: true, mode: 0o700 });
        await migrationParent(backupDirectory);
        await mkdir(backupDirectory, { mode: 0o700 });
        const id = randomUUID();
        receipt = {
          kind: 'codex-coordination-migration-v1', id, source, target, backupDirectory,
          canonicalSource, canonicalTarget, sha256: expected, sourceIdentity,
          stagedTarget: `${target}.migration-${id}.staged`,
          blockerTemporary: `${source}.migration-${id}.blocker`,
          status: 'preparing', createdAt: new Date().toISOString(),
          recovery: 'Inspect source/target identities and bytes as well as this receipt: a crash can precede its stage update. Before publication, rollback restores only the verified original or this migration blocker; after publication the target is authoritative.',
        };
        await durableExclusiveFile(`${backupDirectory}/source.json`, contents);
        receipt.backupIdentity = fileIdentity(await lstat(`${backupDirectory}/source.json`));
        await durableExclusiveFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
        await syncDirectory(backupDirectory);
        await syncDirectory(dirname(backupDirectory));
        await durableExclusiveFile(receipt.stagedTarget, contents);
        receipt.stagedIdentity = fileIdentity(await lstat(receipt.stagedTarget));
        await syncDirectory(dirname(target));
        await durableExclusiveFile(receipt.blockerTemporary, migrationBlocker(receipt));
        receipt.blockerIdentity = fileIdentity(await lstat(receipt.blockerTemporary));
        await syncDirectory(dirname(source));
        receipt.status = 'prepared';
        await updateMigrationReceipt(receipt);
      } else {
        assertOwnedMetadata(await lstat(backupDirectory), backupDirectory, 'directory');
        assertOwnedMetadata(await lstat(receiptPath), receiptPath);
        receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
        if (receipt.kind !== 'codex-coordination-migration-v1' || !/^[0-9a-f-]{36}$/.test(receipt.id ?? '')
          || receipt.source !== source || receipt.target !== target || receipt.backupDirectory !== backupDirectory
          || receipt.canonicalSource !== canonicalSource || receipt.canonicalTarget !== canonicalTarget || receipt.sha256 !== expected
          || receipt.stagedTarget !== `${target}.migration-${receipt.id}.staged`
          || receipt.blockerTemporary !== `${source}.migration-${receipt.id}.blocker`
          || !['preparing', 'prepared', 'source-blocked', 'migrated', 'rolled-back'].includes(receipt.status)) {
          throw new Error('Migration receipt does not match the reviewed paths, digest and supported state.');
        }
        await requireMigrationFile(`${backupDirectory}/source.json`, receipt.backupIdentity, expected);
        validateMigrationState(await readFile(`${backupDirectory}/source.json`));
      }
      const markerDigest = sha256(migrationBlocker(receipt));
      if (phase === 'rollback') {
        await assertAbsent(target); // Never roll back after publication, even identical bytes.
        if (receipt.status === 'migrated' || receipt.status === 'rolled-back') throw new Error('Migration is already finalized; rollback is unavailable.');
        // Verify everything rollback would remove before changing the authority.
        // A substituted staging file belongs to someone else, even with equal bytes.
        for (const [path, identity, digest] of [
          [receipt.stagedTarget, receipt.stagedIdentity, expected],
          [receipt.blockerTemporary, receipt.blockerIdentity, markerDigest],
        ]) {
          if (await metadataIfPresent(path)) await requireMigrationFile(path, identity, digest);
        }
        const current = await lstat(source);
        if (sameIdentity(current, receipt.sourceIdentity)) {
          await requireMigrationFile(source, receipt.sourceIdentity, expected);
        } else {
          await requireMigrationFile(source, receipt.blockerIdentity, markerDigest);
          const restore = `${source}.migration-${receipt.id}.restore`;
          await durableExclusiveFile(restore, await readFile(`${backupDirectory}/source.json`));
          await requireMigrationFile(source, receipt.blockerIdentity, markerDigest);
          await assertAbsent(target);
          await rename(restore, source);
          await syncDirectory(dirname(source));
        }
        receipt.status = 'rolled-back';
        receipt.restoredSourceIdentity = fileIdentity(await lstat(source));
        await updateMigrationReceipt(receipt);
        await removeMigrationArtifact(receipt.stagedTarget, receipt.stagedIdentity, expected);
        await removeMigrationArtifact(receipt.blockerTemporary, receipt.blockerIdentity, markerDigest);
      } else {
        if (phase === 'all' || phase === 'block') {
          await assertAbsent(target);
          if (!['prepared', 'source-blocked'].includes(receipt.status)) throw new Error('Migration must be fully prepared before source blocking.');
          const current = await lstat(source);
          if (sameIdentity(current, receipt.blockerIdentity)) {
            await requireMigrationFile(source, receipt.blockerIdentity, markerDigest);
          } else {
            await requireMigrationFile(source, receipt.sourceIdentity, expected);
            validateMigrationState(await readFile(source));
            await requireMigrationFile(receipt.stagedTarget, receipt.stagedIdentity, expected);
            await requireMigrationFile(receipt.blockerTemporary, receipt.blockerIdentity, markerDigest);
            await rename(receipt.blockerTemporary, source);
            await syncDirectory(dirname(source));
          }
          receipt.status = 'source-blocked';
          await updateMigrationReceipt(receipt);
        }
        if (phase === 'all' || phase === 'publish') {
          if (!['prepared', 'source-blocked', 'migrated'].includes(receipt.status)) throw new Error('Migration must be prepared and blocked before publication.');
          await requireMigrationFile(source, receipt.blockerIdentity, markerDigest);
          if (await metadataIfPresent(target)) {
            await requireMigrationFile(target, receipt.stagedIdentity, expected, { linkedStage: receipt.stagedTarget });
          } else {
            await requireMigrationFile(receipt.stagedTarget, receipt.stagedIdentity, expected);
            await link(receipt.stagedTarget, target); // Exclusive publication: rename could clobber a concurrent target.
            await syncDirectory(dirname(target));
          }
          // This unlink also completes an interrupted exclusive-link publication.
          const staged = await metadataIfPresent(receipt.stagedTarget);
          if (staged) {
            if (!sameIdentity(staged, receipt.stagedIdentity)) throw new Error('Migration staging identity changed.');
            await unlink(receipt.stagedTarget);
            await syncDirectory(dirname(target));
          }
          receipt.status = 'migrated';
          receipt.completedAt = new Date().toISOString();
          await updateMigrationReceipt(receipt);
        }
      }
      return { status: receipt.status, source, target, sha256: expected, receiptPath };
    } catch (error) {
      throw new Error(`${error.message} Migration stopped; inspect ${receiptPath} and retained source/target/backup identities before recovery.`, { cause: error });
    }
  }, { migration: true }), { migration: true });
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
  for (const [ref, fullRef] of [['main', 'refs/heads/main'], ['origin/main', 'refs/remotes/origin/main']]) {
    try {
      return { ref, fullRef, sha: await runGit(['rev-parse', '--verify', `${fullRef}^{commit}`], cwd) };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error('Cannot resolve the main branch from main or origin/main.', { cause: lastError });
}

function parseRemoteFetchRefspec(value) {
  if (value.startsWith('^')) {
    const sourcePattern = value.slice(1);
    if (!sourcePattern || sourcePattern.includes(':') || (sourcePattern.match(/\*/g) ?? []).length > 1) {
      throw new Error('invalid negative fetch refspec');
    }
    return { negative: true, sourcePattern };
  }
  const refspec = value.startsWith('+') ? value.slice(1) : value;
  const separator = refspec.indexOf(':');
  if (separator < 0) return { negative: false, sourcePattern: refspec };
  if (refspec.indexOf(':', separator + 1) >= 0) throw new Error('invalid fetch refspec');
  const sourcePattern = refspec.slice(0, separator);
  const destinationPattern = refspec.slice(separator + 1);
  const sourceWildcards = (sourcePattern.match(/\*/g) ?? []).length;
  const destinationWildcards = (destinationPattern.match(/\*/g) ?? []).length;
  if (!sourcePattern || !destinationPattern || sourceWildcards > 1 || destinationWildcards > 1 || sourceWildcards !== destinationWildcards) {
    throw new Error('invalid fetch refspec');
  }
  return { negative: false, sourcePattern, destinationPattern };
}

function refspecMatch(pattern, ref) {
  const wildcard = pattern.indexOf('*');
  if (wildcard < 0) return pattern === ref ? '' : undefined;
  const prefix = pattern.slice(0, wildcard);
  const suffix = pattern.slice(wildcard + 1);
  if (!ref.startsWith(prefix) || !ref.endsWith(suffix) || ref.length < prefix.length + suffix.length) return undefined;
  return ref.slice(prefix.length, ref.length - suffix.length);
}

async function localBranchForTrackingRef(cwd, ref, selector) {
  let output = '';
  try {
    output = await runGit(['config', '--null', '--get-regexp', '^remote\\..*\\.fetch$'], cwd);
  } catch (error) {
    if (error?.code !== 1) {
      throw new Error(`Cannot safely determine the local branch for remote-tracking --base-ref ${JSON.stringify(selector)}.`, { cause: error });
    }
  }

  const remoteFetchSpecs = new Map();
  for (const setting of output.split('\0').filter(Boolean)) {
    const separator = setting.indexOf('\n');
    if (separator < 0) throw new Error(`Cannot safely determine the local branch for remote-tracking --base-ref ${JSON.stringify(selector)}.`);
    const key = setting.slice(0, separator);
    const remote = key.match(/^remote\.(.*)\.fetch$/i)?.[1];
    if (!remote) throw new Error(`Cannot safely determine the local branch for remote-tracking --base-ref ${JSON.stringify(selector)}.`);
    const specs = remoteFetchSpecs.get(remote) ?? [];
    specs.push(setting.slice(separator + 1));
    remoteFetchSpecs.set(remote, specs);
  }

  const mappings = [];
  for (const specs of remoteFetchSpecs.values()) {
    const parsed = specs.map(parseRemoteFetchRefspec);
    const exclusions = parsed.filter((spec) => spec.negative);
    for (const spec of parsed) {
      if (spec.negative || !spec.destinationPattern) continue;
      const capture = refspecMatch(spec.destinationPattern, ref);
      if (capture === undefined) continue;
      const sourceRef = spec.sourcePattern.includes('*')
        ? spec.sourcePattern.replace('*', capture)
        : spec.sourcePattern;
      if (exclusions.some((exclusion) => refspecMatch(exclusion.sourcePattern, sourceRef) !== undefined)) continue;
      mappings.push(sourceRef);
    }
  }

  if (mappings.length !== 1) {
    const reason = mappings.length > 1 ? 'ambiguous configured fetch mappings' : 'no configured fetch mapping to a local branch';
    throw new Error(`Cannot safely determine the local branch for remote-tracking --base-ref ${JSON.stringify(selector)}: ${reason}.`);
  }
  const branchPrefix = 'refs/heads/';
  if (!mappings[0].startsWith(branchPrefix)) {
    throw new Error(`Cannot safely determine the local branch for remote-tracking --base-ref ${JSON.stringify(selector)}: its fetch mapping does not name a local branch.`);
  }
  const localBranchName = mappings[0].slice(branchPrefix.length);
  try {
    await runGit(['check-ref-format', mappings[0]], cwd);
  } catch (error) {
    throw new Error(`Cannot safely determine the local branch for remote-tracking --base-ref ${JSON.stringify(selector)}: its fetch mapping names an invalid branch.`, { cause: error });
  }
  return localBranchName;
}

async function readSelectedBaseRef(cwd, selector) {
  if (selector.trim() !== selector || !selector || selector.startsWith('-') || selector === 'HEAD') {
    throw new Error('--base-ref must name an existing local or remote-tracking branch ref.');
  }
  let candidates;
  if (selector.startsWith('refs/heads/') || selector.startsWith('refs/remotes/')) candidates = [selector];
  else if (selector.startsWith('refs/')) throw new Error('--base-ref must name a local or remote-tracking branch ref.');
  else candidates = [`refs/heads/${selector}`, ...(selector.includes('/') ? [`refs/remotes/${selector}`] : [])];

  for (const ref of candidates) {
    try {
      await runGit(['check-ref-format', ref], cwd);
    } catch (error) {
      throw new Error(`Invalid --base-ref ${JSON.stringify(selector)}; expected a branch ref.`, { cause: error });
    }
  }
  const refs = await runGit(['for-each-ref', '--format=%(refname)%09%(symref)', 'refs/heads', 'refs/remotes'], cwd);
  const available = new Map(refs.split('\n').filter(Boolean).map((line) => {
    const [ref, symbolicTarget = ''] = line.split('\t');
    return [ref, symbolicTarget];
  }));
  const matches = candidates.filter((ref) => available.has(ref));
  if (matches.length > 1) {
    throw new Error(`Ambiguous --base-ref ${JSON.stringify(selector)}; use a fully qualified refs/heads/... or refs/remotes/... name.`);
  }
  if (matches.length === 0) {
    throw new Error(`Cannot resolve --base-ref ${JSON.stringify(selector)} as an existing local or remote-tracking branch.`);
  }
  const ref = matches[0];
  if (available.get(ref)) throw new Error(`Cannot use symbolic --base-ref ${JSON.stringify(selector)}; select an actual branch ref.`);
  let localBranchName;
  if (ref.startsWith('refs/heads/')) localBranchName = ref.slice('refs/heads/'.length);
  else localBranchName = await localBranchForTrackingRef(cwd, ref, selector);
  const sha = await runGit(['rev-parse', '--verify', `${ref}^{commit}`], cwd);
  return { ref, sha, localBranchName };
}

async function readGitStartState(cwd = process.cwd(), baseRefSelector) {
  const [branchName, branchSha, repositoryRoot, repositoryIdentity] = await Promise.all([
    runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    runGit(['rev-parse', 'HEAD'], cwd),
    runGit(['rev-parse', '--show-toplevel'], cwd),
    runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd),
  ]);
  if (branchName === 'HEAD') throw new Error('coordination begin requires an attached branch.');
  let main;
  if (baseRefSelector === undefined) main = await readMainRef(cwd);
  else main = await readMainRef(cwd).catch(() => undefined);
  const selectedBase = baseRefSelector === undefined
    ? { ref: main.fullRef, sha: main.sha, localBranchName: 'main' }
    : await readSelectedBaseRef(cwd, baseRefSelector);
  if (branchName === 'main' || branchName === selectedBase.localBranchName) {
    throw new Error(`coordination begin refuses to register work directly on protected base branch ${branchName}.`);
  }
  return {
    branchName,
    branchSha,
    mainSha: main?.sha,
    selectedBase: { ref: selectedBase.ref, sha: selectedBase.sha },
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
  const { scopes, claims, resources } = normalizeOwnership(options);
  const workType = text(options['work-type'], 'tooling');
  if (!['product', 'tooling', 'documentation', 'investigation'].includes(workType)) {
    throw new Error('coordination begin requires --work-type product|tooling|documentation|investigation.');
  }
  const start = await readGitStartState(process.cwd(), options['base-ref']);
  const worktreeRoot = await realpath(start.repositoryRoot);
  if (await realpath(process.cwd()) !== worktreeRoot) {
    throw new Error(`coordination begin requires the actual Git worktree root: ${worktreeRoot}.`);
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
      ...(start.mainSha ? { startMainSha: start.mainSha } : {}),
      selectedBase: start.selectedBase,
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
    const current = await readGitStartState(process.cwd(), persistedBaseRef(entry));
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
    const current = await readGitStartState(process.cwd(), persistedBaseRef(entry));
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

function persistedBaseRef(entry) {
  const selectedBase = objectRecord(entry?.selectedBase);
  return typeof selectedBase.ref === 'string' && selectedBase.ref ? selectedBase.ref : undefined;
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

const ownershipOptionSchema = {
  scope: { key: 'scope', repeatable: true },
  scopes: { key: 'scope', repeatable: true },
  claim: { key: 'claims', repeatable: true },
  claims: { key: 'claims', repeatable: true },
  resources: { key: 'resources', repeatable: true },
};
const fileOptionSchema = { file: { key: 'file' } };
const COMMAND_OPTION_SCHEMAS = {
  discover: { ...fileOptionSchema },
  'export-env': { ...fileOptionSchema },
  status: { ...fileOptionSchema },
  begin: {
    ...fileOptionSchema,
    ...ownershipOptionSchema,
    'base-ref': { key: 'base-ref' },
    'work-type': { key: 'work-type' },
    intent: { key: 'intent' },
    'version-plan': { key: 'version-plan' },
    'preemptive-changelog': { key: 'preemptive-changelog' },
    'implementation-prompt': { key: 'implementation-prompt' },
  },
  heartbeat: { ...fileOptionSchema, id: { key: 'id' }, now: { key: 'now' } },
  claim: { ...fileOptionSchema, ...ownershipOptionSchema, id: { key: 'id' }, now: { key: 'now' } },
  'release-claim': { ...fileOptionSchema, ...ownershipOptionSchema, id: { key: 'id' }, now: { key: 'now' } },
  park: {
    ...fileOptionSchema,
    id: { key: 'id' },
    'checkpoint-sha': { key: 'checkpoint-sha' },
    'next-action': { key: 'next-action' },
    now: { key: 'now' },
  },
  resume: { ...fileOptionSchema, id: { key: 'id' }, 'checkpoint-sha': { key: 'checkpoint-sha' }, now: { key: 'now' } },
  finish: {
    ...fileOptionSchema,
    id: { key: 'id' },
    adapter: { key: 'adapter' },
    outcome: { key: 'outcome' },
    'preserve-ref': { key: 'preserve-ref' },
    reason: { key: 'reason' },
    result: { key: 'result' },
  },
  install: { to: { key: 'to' } },
  migrate: {
    ...fileOptionSchema,
    to: { key: 'to' },
    'backup-dir': { key: 'backup-dir' },
    'expected-sha256': { key: 'expected-sha256' },
    phase: { key: 'phase' },
  },
};

function parseOptions(command, args) {
  const schema = COMMAND_OPTION_SCHEMAS[command];
  if (!schema) throw new Error(`Unknown coordination command: ${command}.`);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument?.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const name = argument.slice(2);
    const definition = schema[name];
    if (!definition) {
      if (name === 'resource' && Object.hasOwn(schema, 'resources')) {
        throw new Error(`Unknown option --resource for coordination ${command}. Use --resources; it accepts repeated values.`);
      }
      throw new Error(`Unknown option --${name} for coordination ${command}.`);
    }
    const value = args[index + 1];
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
      throw new Error(`Missing value for --${name}.`);
    }
    if (definition.repeatable) {
      options[definition.key] = [...(Array.isArray(options[definition.key]) ? options[definition.key] : []), value];
    } else {
      if (Object.hasOwn(options, definition.key)) throw new Error(`Option --${name} can be provided only once.`);
      options[definition.key] = value;
    }
    index += 1;
  }
  return options;
}

function validateOptionContract(command, options) {
  const requireId = (operation) => {
    if (!options.id) throw new Error(`coordination ${operation} requires --id <entry-id>.`);
  };
  const validateNow = () => {
    if (options.now !== undefined) isoNow(options.now);
  };
  const requireOwnership = (operation) => {
    const ownership = normalizeOwnership(options);
    if (!ownership.scopes.length && !ownership.claims.length && !ownership.resources.length) {
      throw new Error(`coordination ${operation} requires at least one --scope/--scopes, --claim/--claims, or --resources value.`);
    }
    return ownership;
  };

  if (command === 'begin') {
    const workType = text(options['work-type'], 'tooling');
    if (!['product', 'tooling', 'documentation', 'investigation'].includes(workType)) {
      throw new Error('coordination begin requires --work-type product|tooling|documentation|investigation.');
    }
    normalizeOwnership(options);
  } else if (command === 'heartbeat') {
    requireId(command);
    validateNow();
  } else if (command === 'claim' || command === 'release-claim') {
    requireId(command);
    requireOwnership(command);
    validateNow();
  } else if (command === 'park') {
    requireId(command);
    if (!/^[0-9a-f]{40}$/i.test(text(options['checkpoint-sha']))) {
      throw new Error('coordination park requires an exact 40-character --checkpoint-sha value.');
    }
    validateNow();
  } else if (command === 'resume') {
    requireId(command);
    if (options['checkpoint-sha'] !== undefined && !/^[0-9a-f]{40}$/i.test(options['checkpoint-sha'])) {
      throw new Error('coordination resume --checkpoint-sha must be an exact 40-character commit SHA.');
    }
    validateNow();
  } else if (command === 'finish') {
    requireId(command);
    const adapter = text(options.adapter);
    if (!adapter) throw new Error('coordination finish requires an explicit --adapter chain-scanner.');
    if (adapter !== 'chain-scanner') throw new Error(`Unsupported coordination completion adapter: ${adapter}.`);
    const outcome = text(options.outcome, 'landed');
    if (!['landed', 'preserved', 'discarded'].includes(outcome)) {
      throw new Error('coordination finish outcome must be landed, preserved, or discarded.');
    }
    if (outcome === 'preserved') {
      const destination = text(options['preserve-ref']);
      if (!destination) {
        throw new Error(`Cannot preserve coordination entry ${options.id}: --preserve-ref is required.`);
      }
      const separator = destination.indexOf('/');
      if (separator < 1 || separator === destination.length - 1) {
        throw new Error(`Cannot preserve coordination entry ${options.id}: --preserve-ref must be remote/branch.`);
      }
    } else if (options['preserve-ref'] !== undefined) {
      throw new Error('--preserve-ref is only valid when --outcome preserved.');
    }
    if (outcome === 'discarded') {
      if (!text(options.reason)) throw new Error(`Cannot discard coordination entry ${options.id}: --reason is required.`);
    } else if (options.reason !== undefined) {
      throw new Error('--reason is only valid when --outcome discarded.');
    }
  } else if (command === 'install') {
    if (!text(options.to) || !isAbsolute(options.to)) {
      throw new Error('coordination install requires an explicit absolute --to <destination-file>.');
    }
  } else if (command === 'migrate') {
    if (!options.file) throw new Error('Migration requires an explicit --file source.');
    if (!options.to) throw new Error('Migration requires an explicit --to destination.');
    if (!options['backup-dir']) throw new Error('Migration requires an explicit --backup-dir.');
    if (!/^[0-9a-f]{64}$/.test(options['expected-sha256'] ?? '')) {
      throw new Error('Migration requires an exact lowercase --expected-sha256 digest from the reviewed source.');
    }
    if (!['prepare', 'block', 'publish', 'all', 'rollback'].includes(options.phase ?? 'all')) {
      throw new Error('Migration --phase must be prepare, block, publish, all or rollback.');
    }
  }
}

function validatedOptions(command, args) {
  const options = parseOptions(command, args);
  validateOptionContract(command, options);
  return options;
}

const [command, ...args] = process.argv.slice(2);
if (!Object.hasOwn(COMMAND_OPTION_SCHEMAS, command)) {
  console.error('usage: coordination.mjs <discover|export-env|install|migrate|status|begin|heartbeat|claim|release-claim|park|resume|finish> [options]');
  process.exitCode = 2;
} else {
  try {
    const options = validatedOptions(command, args);
    if (command === 'discover') console.log(discover(args));
    else if (command === 'status') {
      const filePath = discover(args);
      console.log(JSON.stringify({ filePath, state: await readState(filePath) }, null, 2));
    } else if (command === 'begin') {
      const entry = await begin(discover(args), options);
      console.log(JSON.stringify(entry, null, 2));
    } else if (command === 'heartbeat') {
      const entry = await heartbeat(discover(args), options);
      console.log(JSON.stringify(entry, null, 2));
    } else if (command === 'park' || command === 'resume') {
      const operation = command === 'park' ? park : resume;
      const entry = await operation(discover(args), options);
      console.log(JSON.stringify(entry, null, 2));
    } else if (command === 'finish') {
      const entry = await finish(discover(args), options);
      console.log(JSON.stringify(entry, null, 2));
    } else if (command === 'export-env') {
      const filePath = discover(args);
      console.log(`export CODEX_COORDINATION_FILE=${shellQuote(filePath)}`);
    } else if (command === 'install') {
      await install(options);
    } else if (command === 'migrate') {
      console.log(JSON.stringify(await migrate(discover(args), options), null, 2));
    } else if (command === 'claim') {
      const entry = await claim(discover(args), options);
      console.log(JSON.stringify(entry, null, 2));
    } else if (command === 'release-claim') {
      const entry = await releaseClaim(discover(args), options);
      console.log(JSON.stringify(entry, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
