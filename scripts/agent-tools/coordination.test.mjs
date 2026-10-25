import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { recordReleaseEvidence } from '../release-evidence.mjs';

const entrypoint = fileURLToPath(new URL('./coordination.mjs', import.meta.url));
const releaseEvidenceEntrypoint = fileURLToPath(new URL('../release-evidence.mjs', import.meta.url));

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function createProject(root, branch) {
  mkdirSync(root, { recursive: true });
  git(root, 'init', '--quiet');
  git(root, 'checkout', '--quiet', '-b', 'main');
  git(root, 'config', 'user.name', 'Coordination Fixture');
  git(root, 'config', 'user.email', 'coordination-fixture@example.invalid');
  writeFileSync(join(root, 'README.md'), `${branch} fixture\n`);
  git(root, 'add', 'README.md');
  git(root, 'commit', '--quiet', '-m', 'fixture baseline');
  git(root, 'checkout', '--quiet', '-b', branch);
  return root;
}

function addOrigin(project, fixture) {
  const remote = join(fixture, 'origin.git');
  git(fixture, 'init', '--bare', '--quiet', remote);
  git(project, 'remote', 'add', 'origin', remote);
  git(project, 'push', '--quiet', '--set-upstream', 'origin', 'main');
  git(project, 'fetch', '--quiet', 'origin');
  return remote;
}

function advanceOriginMain(project) {
  git(project, 'push', '--quiet', 'origin', 'main');
  git(project, 'fetch', '--quiet', 'origin');
}

function command(args, cwd, environment = {}) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CODEX_COORDINATION_FILE: '', DOW_EMULATOR_COORDINATION_FILE: '', ...environment },
  });
}

function commandAt(script, args, cwd, environment = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CODEX_COORDINATION_FILE: '', DOW_EMULATOR_COORDINATION_FILE: '', ...environment },
  });
}

function commandAsync(args, cwd, environment = {}) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [entrypoint, ...args], {
      cwd,
      env: { ...process.env, CODEX_COORDINATION_FILE: '', DOW_EMULATOR_COORDINATION_FILE: '', ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectResult);
    child.on('close', (status, signal) => resolveResult({ status, signal, stdout, stderr }));
  });
}

test('migration retains parked ownership across temporary-directory loss and blocks legacy writers', () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'chain-coordination-migration-')));
  try {
    const project = createProject(join(fixture, 'project'), 'work/migration');
    const temporaryDirectory = join(fixture, 'legacy-temporary');
    mkdirSync(temporaryDirectory);
    const source = join(temporaryDirectory, 'ledger.json');
    const target = join(fixture, 'persistent', 'coordination.json');
    const backup = join(fixture, 'evidence');
    const began = command(['begin', '--file', source, '--claims', 'foreign:retained'], project);
    assert.equal(began.status, 0, began.stderr);
    const entry = JSON.parse(began.stdout);
    const parked = command(['park', '--file', source, '--id', entry.id,
      '--checkpoint-sha', git(project, 'rev-parse', 'HEAD'), '--next-action', 'Resume after host restart.'], project);
    assert.equal(parked.status, 0, parked.stderr);
    const state = JSON.parse(readFileSync(source, 'utf8'));
    state.unknownHostMetadata = { preserve: ['all', 'bytes'] };
    state.reservations.push({ worktree: join(fixture, 'offline-project'), pid: 2147483647, slot: 8, retained: true });
    state.configurations.push({ worktree: join(fixture, 'offline-project'), slot: 8, retained: true });
    const original = `${JSON.stringify(state, null, 3)}\n`;
    writeFileSync(source, original);
    const digest = createHash('sha256').update(original).digest('hex');

    const migrated = command(['migrate', '--file', source, '--to', target,
      '--backup-dir', backup, '--expected-sha256', digest], project);
    assert.equal(migrated.status, 0, `explicit migration must retain the populated ledger: ${migrated.stderr}`);
    assert.equal(existsSync(target), true, 'migration must publish the populated ledger at the durable path');
    const report = JSON.parse(migrated.stdout);
    assert.equal(report.status, 'migrated');
    assert.equal(report.sha256, digest);
    assert.equal(readFileSync(target, 'utf8'), original, 'migration must not normalize or prune any saved ownership');
    assert.equal(readFileSync(join(backup, 'source.json'), 'utf8'), original, 'rollback keeps exact original bytes');
    assert.equal(JSON.parse(readFileSync(join(backup, 'migration.json'), 'utf8')).status, 'migrated');
    assert.equal(statSync(source).isFile(), true, 'the retired source remains atomically replaceable');
    assert.throws(() => JSON.parse(readFileSync(source, 'utf8')), SyntaxError, 'the blocker must fail old v1 JSON parsers');

    // A bounded real v1 writer: read/ENOENT-as-empty, normalize, then atomic rename.
    // A JSON pointer or symlink would let this client create a second writable ledger.
    const legacy = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { readFile, writeFile, rename } from 'node:fs/promises';
      const file = process.argv[1];
      let state;
      try { state = JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; state = {}; }
      state = { ...state, version: 1, entries: Array.isArray(state.entries) ? state.entries : [] };
      state.entries.push({ id: 'legacy-split', status: 'active' });
      await writeFile(file + '.legacy.tmp', JSON.stringify(state));
      await rename(file + '.legacy.tmp', file);
    `, source], { encoding: 'utf8' });
    assert.notEqual(legacy.status, 0, 'legacy writers must stop at the retired source');
    assert.match(legacy.stderr, /SyntaxError/);
    assert.equal(readFileSync(target, 'utf8'), original);

    const selected = command(['export-env', '--file', target], project);
    assert.equal(selected.status, 0, selected.stderr);
    const environmentFile = join(fixture, 'coordination-env.sh');
    writeFileSync(environmentFile, selected.stdout);
    rmSync(temporaryDirectory, { recursive: true });
    for (const cwd of [project, fixture]) {
      const fresh = spawnSync('/bin/sh', ['-c', '. "$1"; exec "$2" "$3" discover',
        'fixture', environmentFile, process.execPath, entrypoint], {
        cwd, encoding: 'utf8', env: { ...process.env, CODEX_COORDINATION_FILE: '', DOW_EMULATOR_COORDINATION_FILE: '' },
      });
      assert.equal(fresh.status, 0, fresh.stderr);
      assert.equal(fresh.stdout.trim(), target, 'fresh shells in both projects select the same durable path');
    }
    const resumed = command(['resume', '--id', entry.id], project, { CODEX_COORDINATION_FILE: target });
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).id, entry.id, 'parked ownership survives restart at the new canonical path');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function migrationFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'chain-migration-control-')));
  const source = join(root, 'source.json');
  const target = join(root, 'persistent', 'coordination.json');
  const backup = join(root, 'backup');
  const contents = '{"version":1,"scope":"codex-wide","entries":[],"reservations":[],"configurations":[],"unknown":"retain"}\n';
  writeFileSync(source, contents);
  const digest = createHash('sha256').update(contents).digest('hex');
  return { root, source, target, backup, contents, digest,
    args: (phase = 'all') => ['migrate', '--file', source, '--to', target,
      '--backup-dir', backup, '--expected-sha256', digest, '--phase', phase] };
}

test('migration rejects source ancestor symlinks rather than authorizing a path alias', () => {
  const f = migrationFixture();
  try {
    const nested = join(f.root, 'nested');
    mkdirSync(nested);
    const actualSource = join(nested, 'source.json');
    renameSync(f.source, actualSource);
    const alias = join(f.root, 'alias');
    symlinkSync(f.root, alias, 'dir');
    const args = f.args();
    args[2] = join(alias, 'nested', 'source.json');
    const result = command(args, f.root);
    assert.notEqual(result.status, 0, 'a user-created source ancestor alias must fail closed');
    assert.match(result.stderr, /alias|symlink|ambiguous/i);
    assert.equal(readFileSync(actualSource, 'utf8'), f.contents);
    assert.equal(existsSync(f.target), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('migration phases preserve one authority, permit prepublication rollback, and resume interrupted publication', () => {
  for (const stopAfter of ['prepare', 'block', 'link']) {
    const f = migrationFixture();
    try {
      const prepared = command(f.args('prepare'), f.root);
      assert.equal(prepared.status, 0, prepared.stderr);
      assert.equal(JSON.parse(prepared.stdout).status, 'prepared');
      assert.equal(readFileSync(f.source, 'utf8'), f.contents, 'prepare leaves the original ledger authoritative');
      assert.equal(existsSync(f.target), false);
      const early = command(f.args('publish'), f.root);
      assert.notEqual(early.status, 0, 'publication requires verified source retirement');
      if (stopAfter !== 'prepare') {
        const blocked = command(f.args('block'), f.root);
        assert.equal(blocked.status, 0, blocked.stderr);
        const legacyRead = command(['status', '--file', f.source], f.root);
        assert.notEqual(legacyRead.status, 0);
        assert.match(legacyRead.stderr, /retired/);
        assert.match(legacyRead.stderr, /Canonical ledger:/);
        assert.equal(existsSync(f.target), false, 'the explicit blocked phase retains recoverable backup before publication');
      }
      if (stopAfter === 'link') {
        const receipt = JSON.parse(readFileSync(join(f.backup, 'migration.json'), 'utf8'));
        // Real filesystem state after an interrupted link but before staging unlink/receipt update.
        linkSync(receipt.stagedTarget, f.target);
        const rollback = command(f.args('rollback'), f.root);
        assert.notEqual(rollback.status, 0, 'target existence forbids rollback even before the receipt update');
        const published = command(f.args('publish'), f.root);
        assert.equal(published.status, 0, published.stderr);
        assert.equal(JSON.parse(published.stdout).status, 'migrated');
        assert.equal(readFileSync(f.target, 'utf8'), f.contents);
        assert.equal(statSync(f.target).nlink, 1, 'resumed publication removes only its known staging alias');
        const repeated = command(f.args('publish'), f.root);
        assert.equal(repeated.status, 0, repeated.stderr);
        assert.equal(command(f.args('rollback'), f.root).status, 2);
      } else {
        const rollback = command(f.args('rollback'), f.root);
        assert.equal(rollback.status, 0, rollback.stderr);
        assert.equal(JSON.parse(rollback.stdout).status, 'rolled-back');
        assert.equal(readFileSync(f.source, 'utf8'), f.contents);
        assert.equal(existsSync(f.target), false);
        assert.equal(readFileSync(join(f.backup, 'source.json'), 'utf8'), f.contents, 'rollback retains recovery evidence');
        assert.equal(command(f.args('block'), f.root).status, 2, 'a finalized rollback cannot later retire the source');
      }
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('migration refuses active foreign entries, live reservations and malformed ownership without modifying state', () => {
  const controls = [
    { entries: [{ id: 'foreign-active', worktree: '/offline/foreign', status: 'active', pid: 2147483647,
      heartbeatAt: '2000-01-01T00:00:00.000Z', lease: { expiresAt: '2000-01-01T00:00:00.000Z' } }] },
    { reservations: [{ worktree: '/foreign/reservation', pid: process.pid, unknownReservation: true }] },
    { entries: [{ id: 'foreign-unknown', worktree: '/foreign/unknown', status: 'mystery' }] },
    { entries: [{ id: 'parked-missing-checkpoint', worktree: '/foreign/parked', status: 'parked' }] },
    { entries: [{ id: 'same', worktree: '/foreign/a', status: 'complete' }, { id: 'same', worktree: '/foreign/b', status: 'complete' }] },
    { reservations: [{ worktree: '/foreign/unverifiable' }] },
    { configurations: [{ worktree: 'relative/path' }] },
    { entries: 'not-an-array' },
    { version: 2 },
  ];
  for (const control of controls) {
    const f = migrationFixture();
    try {
      const contents = JSON.stringify({ version: 1, scope: 'codex-wide', entries: [], reservations: [], configurations: [], ...control });
      writeFileSync(f.source, contents);
      const args = f.args();
      args[8] = createHash('sha256').update(contents).digest('hex');
      const result = command(args, f.root);
      assert.notEqual(result.status, 0, `unsafe ownership must block migration: ${contents}`);
      assert.match(result.stderr, /active|live|ownership|v1|normalization/);
      assert.equal(readFileSync(f.source, 'utf8'), contents);
      assert.equal(existsSync(f.target), false);
      assert.equal(existsSync(f.backup), false, 'unsafe preconditions cannot create misleading migration evidence');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('migration requires original file identity and refuses same-byte replacements at every transition', () => {
  for (const replacement of ['source', 'blocker', 'backup', 'stage', 'target']) {
    const f = migrationFixture();
    try {
      assert.equal(command(f.args('prepare'), f.root).status, 0);
      if (replacement !== 'source') assert.equal(command(f.args('block'), f.root).status, 0);
      const receipt = JSON.parse(readFileSync(join(f.backup, 'migration.json'), 'utf8'));
      const path = { source: f.source, blocker: f.source, backup: join(f.backup, 'source.json'),
        stage: receipt.stagedTarget, target: f.target }[replacement];
      const original = replacement === 'target' ? f.contents : readFileSync(path);
      writeFileSync(`${path}.replacement`, original);
      renameSync(`${path}.replacement`, path);
      const result = command(f.args(replacement === 'source' ? 'block' : 'publish'), f.root);
      assert.notEqual(result.status, 0, `same bytes cannot prove ownership of a replaced ${replacement}`);
      assert.match(result.stderr, /identity|ownership/);
      assert.deepEqual(readFileSync(path), Buffer.from(original), 'the replacement must be preserved');
      const beforeRollback = readFileSync(f.source);
      assert.equal(command(f.args('rollback'), f.root).status, 2,
        'rollback must verify source and backup and must never run after any target appears');
      assert.deepEqual(readFileSync(f.source), beforeRollback, 'a refused rollback must preserve the current authority and changed artifacts');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('migration rejects an unverifiable lock owner instead of reclaiming it', () => {
  const f = migrationFixture();
  try {
    const unknownLock = '{"owner":"unrecognized-active-client","token":"preserve"}\n';
    writeFileSync(`${f.source}.lock`, unknownLock);
    const result = command(f.args(), f.root);
    assert.notEqual(result.status, 0, 'unknown lock ownership must block host migration');
    assert.match(result.stderr, /lock|ownership/);
    assert.equal(readFileSync(`${f.source}.lock`, 'utf8'), unknownLock);
    assert.equal(readFileSync(f.source, 'utf8'), f.contents);
    assert.equal(existsSync(f.target), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('migration preserves unknown target locks that appear while waiting for source ownership', async (t) => {
  for (const suffix of ['.lock', '.lock.recovery']) await t.test(suffix, async () => {
    const f = migrationFixture();
    const source = join(f.root, 'a-source.json');
    const target = join(f.root, 'z-target.json');
    renameSync(f.source, source);
    const args = f.args();
    args[2] = source;
    args[4] = target;
    const sourceLock = `${source}.lock`;
    const unknownPath = `${target}${suffix}`;
    const unknown = '{"owner":"unrecognized-active-client","token":"preserve"}\n';
    writeFileSync(sourceLock, JSON.stringify({ pid: process.pid, token: 'source-holder' }));
    let settled = false;
    const pending = commandAsync(args, f.root).then(result => { settled = true; return result; });
    try {
      await new Promise(resolveWait => setTimeout(resolveWait, 150));
      assert.equal(settled, false, 'migration is waiting on the recognized live source lock');
      if (suffix === '.lock.recovery') {
        writeFileSync(`${target}.lock`, JSON.stringify({ pid: 2147483647, token: 'recognized-stale' }));
      }
      writeFileSync(unknownPath, unknown);
      rmSync(sourceLock);
      const result = await pending;
      assert.notEqual(result.status, 0, 'a lock appearing after preflight must still block migration');
      assert.match(result.stderr, /lock|ownership/);
      assert.equal(readFileSync(unknownPath, 'utf8'), unknown, 'unrecognized ownership remains untouched');
      assert.equal(readFileSync(source, 'utf8'), f.contents, 'source authority remains unchanged');
      assert.equal(existsSync(target), false, 'target authority is never published');
      assert.equal(existsSync(f.backup), false, 'no migration phase begins without both safe locks');
    } finally {
      rmSync(sourceLock, { force: true });
      await pending;
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});

test('migration preserves a same-byte lock replacement during stale-owner recovery', async () => {
  const f = migrationFixture();
  const stale = JSON.stringify({ pid: 2147483647, token: 'stale-owner' });
  mkdirSync(join(f.root, 'persistent'));
  const lockPath = `${f.target}.lock`;
  writeFileSync(lockPath, stale);
  const pending = commandAsync(f.args(), f.root);
  try {
    const deadline = Date.now() + 2000;
    while (!existsSync(`${lockPath}.recovery`) && Date.now() < deadline) {
      await new Promise(resolveWait => setTimeout(resolveWait, 2));
    }
    assert.ok(existsSync(`${lockPath}.recovery`), 'real migration entered stale-lock recovery');
    await new Promise(resolveWait => setTimeout(resolveWait, 10));
    writeFileSync(`${lockPath}.replacement`, stale);
    renameSync(`${lockPath}.replacement`, lockPath);
    const result = await pending;
    assert.notEqual(result.status, 0, 'equal lock bytes cannot establish recovery ownership of a replacement');
    assert.match(result.stderr, /identity|ownership/);
    assert.equal(readFileSync(lockPath, 'utf8'), stale);
    assert.equal(readFileSync(f.source, 'utf8'), f.contents);
    assert.equal(existsSync(f.target), false);
    assert.equal(existsSync(f.backup), false);
  } finally {
    await pending;
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('ordinary coordination retains legacy unknown-lock reclamation', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-legacy-lock-'));
  try {
    const project = createProject(join(fixture, 'project'), 'work/legacy-lock');
    const ledger = join(fixture, 'ledger.json');
    writeFileSync(`${ledger}.lock`, '{"owner":"old-unrecognized-format"}\n');
    const result = command(['begin', '--file', ledger], project);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(ledger, 'utf8')).entries.length, 1);
    assert.equal(existsSync(`${ledger}.lock`), false);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('migration rejects a shared-writable ancestor hidden above a private destination parent', () => {
  const f = migrationFixture();
  try {
    const shared = join(f.root, 'shared');
    const privateParent = join(shared, 'private');
    mkdirSync(privateParent, { recursive: true, mode: 0o700 });
    chmodSync(shared, 0o777);
    const target = join(privateParent, 'coordination.json');
    const args = f.args();
    args[4] = target;
    const result = command(args, f.root);
    assert.notEqual(result.status, 0, 'a private final parent cannot establish safe ownership through an unsafe ancestor');
    assert.match(result.stderr, /ancestor|ownership|unsafe/);
    assert.equal(readFileSync(f.source, 'utf8'), f.contents);
    assert.equal(existsSync(target), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('migration refuses symlinks, hardlinks, nonregular destinations and stale reviewed bytes', () => {
  for (const conflict of ['source-symlink', 'source-hardlink', 'target-symlink', 'target-file', 'target-directory',
    'target-parent-symlink', 'backup-directory', 'shared-writable-parent', 'changed-bytes', 'lock-symlink']) {
    const f = migrationFixture();
    try {
      mkdirSync(join(f.root, 'persistent'));
      if (conflict === 'source-symlink') {
        renameSync(f.source, `${f.source}.original`);
        symlinkSync(`${f.source}.original`, f.source);
      } else if (conflict === 'source-hardlink') {
        linkSync(f.source, `${f.source}.alias`);
      } else if (conflict === 'target-symlink') {
        symlinkSync(f.source, f.target);
      } else if (conflict === 'target-file') {
        writeFileSync(f.target, f.contents);
      } else if (conflict === 'target-directory') {
        mkdirSync(f.target);
      } else if (conflict === 'target-parent-symlink') {
        rmSync(join(f.root, 'persistent'), { recursive: true });
        mkdirSync(join(f.root, 'other'));
        symlinkSync(join(f.root, 'other'), join(f.root, 'persistent'), 'dir');
      } else if (conflict === 'backup-directory') {
        mkdirSync(f.backup);
        writeFileSync(join(f.backup, 'retained'), 'foreign backup');
      } else if (conflict === 'shared-writable-parent') {
        chmodSync(join(f.root, 'persistent'), 0o777);
      } else if (conflict === 'changed-bytes') {
        writeFileSync(f.source, f.contents.replace('retain', 'newer'));
      } else if (conflict === 'lock-symlink') {
        writeFileSync(join(f.root, 'foreign-lock'), '{"pid":2147483647,"token":"foreign"}');
        symlinkSync(join(f.root, 'foreign-lock'), `${f.source}.lock`);
      }
      const originalSource = readFileSync(f.source, 'utf8');
      const result = command(f.args(), f.root);
      assert.notEqual(result.status, 0, `migration must refuse ${conflict}`);
      assert.equal(readFileSync(f.source, 'utf8'), originalSource);
      assert.match(result.stderr, /ownership|unsafe|symlink|existing|changed|SHA-256/);
      if (conflict === 'target-file') assert.equal(readFileSync(f.target, 'utf8'), f.contents);
      if (conflict === 'backup-directory') assert.equal(readFileSync(join(f.backup, 'retained'), 'utf8'), 'foreign backup');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('migration retains the existing system temporary source spelling while requiring literal durable destinations', () => {
  const f = migrationFixture();
  try {
    const args = f.args();
    args[2] = join(tmpdir(), f.root.split('/').at(-1), 'source.json');
    const result = command(args, f.root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(f.target, 'utf8'), f.contents);
    const receipt = JSON.parse(readFileSync(join(f.backup, 'migration.json'), 'utf8'));
    assert.equal(receipt.canonicalSource, f.source);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('migration waits for both existing token locks before changing ledger authority', async () => {
  for (const selected of ['source', 'target']) {
    const f = migrationFixture();
    let holder;
    try {
      mkdirSync(join(f.root, 'persistent'));
      const lock = `${selected === 'source' ? f.source : f.target}.lock`;
      holder = spawn(process.execPath, ['--input-type=module', '-e', `
        import { open, readFile, unlink } from 'node:fs/promises';
        const path = process.argv[1];
        const token = 'fixture-owned-lock';
        const handle = await open(path, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({pid: process.pid, token}));
        console.log('locked');
        process.stdin.resume();
        await new Promise(resolve => process.stdin.once('end', resolve));
        await handle.close();
        if (JSON.parse(await readFile(path, 'utf8')).token === token) await unlink(path);
      `, lock], { stdio: ['pipe', 'pipe', 'pipe'] });
      const finished = new Promise((resolveResult, rejectResult) => {
        holder.once('error', rejectResult);
        holder.once('close', (status) => resolveResult(status));
      });
      await new Promise((ready, fail) => { holder.stdout.once('data', ready); holder.once('error', fail); });
      let done = false;
      const pending = commandAsync(f.args(), f.root).then((result) => { done = true; return result; });
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      assert.equal(done, false, `migration must respect the ${selected} token lock`);
      assert.equal(readFileSync(f.source, 'utf8'), f.contents);
      assert.equal(existsSync(f.backup), false);
      holder.stdin.end();
      assert.equal(await finished, 0);
      const migrated = await pending;
      assert.equal(migrated.status, 0, migrated.stderr);
      assert.equal(readFileSync(f.target, 'utf8'), f.contents);
    } finally {
      if (holder?.exitCode === null) { holder.stdin.end(); holder.kill(); }
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});

test('discover reports conflicting explicit and environment ledger paths', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-discovery-'));
  try {
    const environmentPath = join(fixture, 'canonical.json');
    const explicitPath = join(fixture, 'other.json');
    const result = spawnSync(process.execPath, [entrypoint, 'discover', '--file', explicitPath], {
      cwd: fixture,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEX_COORDINATION_FILE: environmentPath,
        DOW_EMULATOR_COORDINATION_FILE: '',
      },
    });

    assert.notEqual(result.status, 0, 'the command must reject a second ledger choice');
    assert.match(result.stderr, /conflict/i);
    assert.match(result.stderr, /CODEX_COORDINATION_FILE/);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('discover rejects duplicate explicit ledger arguments instead of selecting the first', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-duplicate-file-'));
  try {
    const first = join(fixture, 'first.json');
    const second = join(fixture, 'second.json');
    const result = spawnSync(process.execPath, [entrypoint, 'discover', '--file', first, '--file', second], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, CODEX_COORDINATION_FILE: '', DOW_EMULATOR_COORDINATION_FILE: '' },
    });
    assert.notEqual(result.status, 0, 'duplicate explicit ledger choices must be visible');
    assert.match(result.stderr, /only once|conflict/i);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('discover honors the legacy alias but rejects disagreement between environment names', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-legacy-discover-'));
  try {
    const legacyPath = join(fixture, 'legacy-canonical.json');
    const legacyOnly = spawnSync(process.execPath, [entrypoint, 'discover'], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, CODEX_COORDINATION_FILE: '', DOW_EMULATOR_COORDINATION_FILE: legacyPath },
    });
    assert.equal(legacyOnly.status, 0, legacyOnly.stderr);
    assert.equal(legacyOnly.stdout.trim(), legacyPath);

    const conflicting = spawnSync(process.execPath, [entrypoint, 'discover'], {
      cwd: fixture,
      encoding: 'utf8',
      env: {
        ...process.env,
        CODEX_COORDINATION_FILE: join(fixture, 'codex.json'),
        DOW_EMULATOR_COORDINATION_FILE: legacyPath,
      },
    });
    assert.notEqual(conflicting.status, 0);
    assert.match(conflicting.stderr, /CODEX_COORDINATION_FILE/);
    assert.match(conflicting.stderr, /DOW_EMULATOR_COORDINATION_FILE/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('status preserves legacy entries, resources, and unknown v1 fields', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-status-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const legacyState = {
      version: 1,
      scope: 'codex-wide',
      versionAgreement: 'Legacy release policy',
      legacyOwnerMetadata: { project: 'another-project', retained: true },
      entries: [{
        id: 'legacy-active-entry',
        status: 'active',
        worktree: join(fixture, 'other-project'),
        branchName: 'feature/other-project',
        heartbeatAt: '2026-10-17T10:00:00.000Z',
        lease: { state: 'healthy', ownerConfirmationRequired: false, takeoverAllowed: false },
        claims: ['release:other-project'],
        resources: ['browser-runtime'],
        legacyEntryMetadata: { preserve: 'this field' },
      }],
      reservations: [{
        id: 'legacy-reservation',
        slot: 6,
        worktree: join(fixture, 'other-project'),
        kind: 'firebase',
        command: 'npm test',
        pid: process.pid,
        ports: [8080, 9099],
        legacyReservationMetadata: 'retain',
      }],
      configurations: [{
        id: 'legacy-configuration',
        slot: 7,
        worktree: join(fixture, 'other-project'),
        configuredAt: '2026-10-17T09:00:00.000Z',
        ports: [8081, 9100],
      }],
    };
    const originalContents = `${JSON.stringify(legacyState, null, 2)}\n`;
    writeFileSync(ledgerPath, originalContents);

    const result = spawnSync(process.execPath, [entrypoint, 'status', '--file', ledgerPath], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, CODEX_COORDINATION_FILE: '', DOW_EMULATOR_COORDINATION_FILE: '' },
    });

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.filePath, ledgerPath);
    assert.deepEqual(report.state, legacyState);
    assert.equal(readFileSync(ledgerPath, 'utf8'), originalContents, 'status must not rewrite the live ledger');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('begin registers an attached task against an explicitly selected local master base', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-master-base-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'project'), 'work/master');
    const mainSha = git(project, 'rev-parse', 'main');
    git(project, 'branch', 'master', 'main');
    git(project, 'checkout', '--quiet', 'master');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs/master-base.md'), 'Selected master base.\n');
    git(project, 'add', 'docs/master-base.md');
    git(project, 'commit', '--quiet', '-m', 'advance master base');
    const masterSha = git(project, 'rev-parse', 'HEAD');
    git(project, 'checkout', '--quiet', 'work/master');
    git(project, 'merge', '--quiet', '--ff-only', 'master');
    writeFileSync(join(project, 'task.md'), 'Task starts from master.\n');
    git(project, 'add', 'task.md');
    git(project, 'commit', '--quiet', '-m', 'add task change');
    const taskSha = git(project, 'rev-parse', 'HEAD');

    const result = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Register from local master',
      '--base-ref', 'master',
    ], project);
    assert.equal(result.status, 0, result.stderr);
    const entry = JSON.parse(result.stdout);
    assert.equal(entry.branchName, 'work/master');
    assert.equal(entry.startBranchSha, taskSha);
    assert.deepEqual(entry.selectedBase, { ref: 'refs/heads/master', sha: masterSha });
    assert.equal(entry.startMainSha, mainSha, 'the legacy field keeps its main-based meaning');
    assert.equal(entry.repositoryRoot, realpathSync(project));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('begin registers against an explicitly selected origin/master tracking ref', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-origin-master-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'project'), 'work/origin-master');
    const origin = addOrigin(project, fixture);
    const mainSha = git(project, 'rev-parse', 'main');
    git(project, 'branch', 'master', 'main');
    git(project, 'checkout', '--quiet', 'master');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs/master-base.md'), 'Published master base.\n');
    git(project, 'add', 'docs/master-base.md');
    git(project, 'commit', '--quiet', '-m', 'advance master base');
    const masterSha = git(project, 'rev-parse', 'HEAD');
    git(project, 'push', '--quiet', origin, 'master');
    git(project, 'fetch', '--quiet', 'origin');
    git(project, 'checkout', '--quiet', 'work/origin-master');
    git(project, 'merge', '--quiet', '--ff-only', 'master');
    writeFileSync(join(project, 'task.md'), 'Task starts from origin/master.\n');
    git(project, 'add', 'task.md');
    git(project, 'commit', '--quiet', '-m', 'add task change');

    const result = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Register from origin/master',
      '--base-ref', 'origin/master',
    ], project);
    assert.equal(result.status, 0, result.stderr);
    const entry = JSON.parse(result.stdout);
    assert.equal(entry.branchName, 'work/origin-master');
    assert.deepEqual(entry.selectedBase, { ref: 'refs/remotes/origin/master', sha: masterSha });
    assert.equal(entry.startMainSha, mainSha, 'the legacy field keeps its actual main-based meaning');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('begin keeps the origin/main default when the local main branch is absent', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-origin-main-default-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'project'), 'work/origin-main-default');
    addOrigin(project, fixture);
    git(project, 'branch', '--delete', 'main');

    const result = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Keep origin/main default',
    ], project);
    assert.equal(result.status, 0, result.stderr);
    const entry = JSON.parse(result.stdout);
    const originMainSha = git(project, 'rev-parse', 'origin/main');
    assert.equal(entry.branchName, 'work/origin-main-default');
    assert.deepEqual(entry.selectedBase, { ref: 'refs/remotes/origin/main', sha: originMainSha });
    assert.equal(entry.startMainSha, originMainSha);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('begin rejects invalid and ambiguous refs without mutation and accepts fully qualified bases', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-invalid-base-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'project'), 'work/selector-validation');
    const origin = addOrigin(project, fixture);
    git(project, 'branch', 'master', 'main');
    git(project, 'checkout', '--quiet', 'master');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs/master-base.md'), 'Selector validation base.\n');
    git(project, 'add', 'docs/master-base.md');
    git(project, 'commit', '--quiet', '-m', 'advance master base');
    git(project, 'push', '--quiet', origin, 'master');
    git(project, 'fetch', '--quiet', 'origin');
    git(project, 'branch', 'origin/master', 'master');
    git(project, 'tag', 'release-marker', 'master');
    git(project, 'checkout', '--quiet', 'work/selector-validation');
    git(project, 'merge', '--quiet', '--ff-only', 'master');
    writeFileSync(join(project, 'task.md'), 'Selector validation task.\n');
    git(project, 'add', 'task.md');
    git(project, 'commit', '--quiet', '-m', 'add task change');

    const foreignWorktree = join(fixture, 'foreign-owner');
    const seededState = {
      version: 1,
      scope: 'codex-wide',
      unknownLedgerData: { preserve: true },
      entries: [{
        id: 'foreign-owner', status: 'active', worktree: foreignWorktree,
        branchName: 'feature/foreign', claims: ['release-foreign'], resources: ['foreign-resource'],
        unknownEntryData: { preserve: ['all', 'bytes'] },
      }],
      reservations: [{ id: 'foreign-reservation', worktree: foreignWorktree, pid: process.pid, ports: [8080] }],
      configurations: [{ id: 'foreign-configuration', worktree: foreignWorktree, slot: 7 }],
    };
    const originalContents = `${JSON.stringify(seededState, null, 2)}\n`;
    writeFileSync(ledgerPath, originalContents);
    const cases = [
      { label: 'missing branch', options: ['--base-ref', 'missing/branch'] },
      { label: 'tag ref', options: ['--base-ref', 'refs/tags/release-marker'] },
      { label: 'revision expression', options: ['--base-ref', 'master~1'] },
      { label: 'option-like value', options: ['--base-ref', '-master'] },
      { label: 'ambiguous short ref', options: ['--base-ref', 'origin/master'] },
      { label: 'missing value', options: ['--base-ref'] },
      { label: 'duplicate value', options: ['--base-ref', 'master', '--base-ref', 'main'] },
    ];
    for (const { label, options } of cases) {
      const result = command([
        'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', `Reject ${label}`,
        ...options,
      ], project);
      assert.notEqual(result.status, 0, `${label} must be rejected`);
      assert.match(result.stderr, /base-ref|missing value|only once/i, `${label} should explain the rejected selector`);
      assert.equal(readFileSync(ledgerPath, 'utf8'), originalContents, `${label} must not mutate unknown or foreign v1 data`);
    }

    const fullLocalLedger = join(fixture, 'full-local-ledger.json');
    const fullLocal = command([
      'begin', '--file', fullLocalLedger, '--work-type', 'tooling', '--intent', 'Select the fully qualified local ref',
      '--base-ref', 'refs/heads/origin/master',
    ], project);
    assert.equal(fullLocal.status, 0, fullLocal.stderr);
    assert.deepEqual(JSON.parse(fullLocal.stdout).selectedBase, {
      ref: 'refs/heads/origin/master', sha: git(project, 'rev-parse', 'master'),
    });

    const fullRemote = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Select the fully qualified remote ref',
      '--base-ref', 'refs/remotes/origin/master',
    ], project);
    assert.equal(fullRemote.status, 0, fullRemote.stderr);
    assert.deepEqual(JSON.parse(fullRemote.stdout).selectedBase, {
      ref: 'refs/remotes/origin/master', sha: git(project, 'rev-parse', 'origin/master'),
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('begin protects a selected tracking base when its configured remote name contains a slash', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-slashed-remote-base-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'project'), 'work/team-upstream-base');
    const remote = join(fixture, 'team-upstream.git');
    git(fixture, 'init', '--bare', '--quiet', remote);
    git(project, 'remote', 'add', 'team/upstream', remote);
    git(project, 'branch', 'master', 'main');
    git(project, 'push', '--quiet', 'team/upstream', 'master');
    git(project, 'fetch', '--quiet', 'team/upstream');
    const selectedSha = git(project, 'rev-parse', 'refs/remotes/team/upstream/master');

    const foreignWorktree = join(fixture, 'foreign-owner');
    const seededState = {
      version: 1,
      scope: 'codex-wide',
      foreignLedgerMetadata: { keep: true },
      entries: [{
        id: 'foreign-owner', status: 'active', worktree: foreignWorktree,
        branchName: 'feature/foreign', claims: ['foreign-claim'], resources: ['foreign-resource'],
        unknownEntryMetadata: { keep: ['all', 'fields'] },
      }],
      reservations: [{ id: 'foreign-reservation', worktree: foreignWorktree, pid: process.pid, ports: [8080] }],
      configurations: [{ id: 'foreign-configuration', worktree: foreignWorktree, slot: 4 }],
    };
    const originalContents = `${JSON.stringify(seededState, null, 2)}\n`;
    writeFileSync(ledgerPath, originalContents);

    git(project, 'checkout', '--quiet', 'master');
    const protectedBase = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Reject direct tracking-base registration',
      '--base-ref', 'team/upstream/master',
    ], project);
    assert.notEqual(protectedBase.status, 0, 'local master must stay protected when selected through a slash-named remote');
    assert.match(protectedBase.stderr, /protected base branch master/i);
    assert.equal(readFileSync(ledgerPath, 'utf8'), originalContents, 'rejection must preserve foreign and unknown ledger bytes');

    git(project, 'checkout', '--quiet', 'work/team-upstream-base');
    writeFileSync(join(project, 'task.md'), 'Task based on the slash-named remote tracking ref.\n');
    git(project, 'add', 'task.md');
    git(project, 'commit', '--quiet', '-m', 'add task change');
    const branchSha = git(project, 'rev-parse', 'HEAD');
    const registered = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Register attached task branch from tracking base',
      '--base-ref', 'team/upstream/master',
    ], project);
    assert.equal(registered.status, 0, registered.stderr);
    const entry = JSON.parse(registered.stdout);
    assert.equal(entry.branchName, 'work/team-upstream-base');
    assert.equal(entry.startBranchSha, branchSha);
    assert.deepEqual(entry.selectedBase, { ref: 'refs/remotes/team/upstream/master', sha: selectedSha });
    const state = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    assert.deepEqual(state.entries[0], seededState.entries[0], 'registering the task must retain the foreign entry');
    assert.deepEqual(state.reservations, seededState.reservations);
    assert.deepEqual(state.configurations, seededState.configurations);
    assert.deepEqual(state.foreignLedgerMetadata, seededState.foreignLedgerMetadata);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('begin protects a slash-named local base through a custom slashed-remote fetch mapping', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-slashed-custom-base-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'project'), 'work/team-upstream-custom');
    const remote = join(fixture, 'team-upstream.git');
    git(fixture, 'init', '--bare', '--quiet', remote);
    git(project, 'remote', 'add', 'team/upstream', remote);
    git(project, 'checkout', '--quiet', '-b', 'release/v1', 'main');
    writeFileSync(join(project, 'base.md'), 'Slash-named custom base.\n');
    git(project, 'add', 'base.md');
    git(project, 'commit', '--quiet', '-m', 'advance release base');
    git(project, 'push', '--quiet', 'team/upstream', 'release/v1');
    git(project, 'config', '--replace-all', 'remote.team/upstream.fetch', '+refs/heads/release/v1:refs/remotes/team/upstream/custom-base');
    git(project, 'fetch', '--quiet', 'team/upstream');
    const selectedSha = git(project, 'rev-parse', 'refs/remotes/team/upstream/custom-base');

    const foreignWorktree = join(fixture, 'foreign-owner');
    const seededState = {
      version: 1,
      scope: 'codex-wide',
      foreignMetadata: { untouched: true },
      entries: [{ id: 'foreign-owner', status: 'active', worktree: foreignWorktree, retained: { owner: true } }],
      reservations: [{ id: 'foreign-reservation', worktree: foreignWorktree, pid: process.pid, ports: [8123] }],
      configurations: [{ id: 'foreign-configuration', worktree: foreignWorktree, slot: 5 }],
    };
    const originalContents = `${JSON.stringify(seededState, null, 2)}\n`;
    writeFileSync(ledgerPath, originalContents);

    const protectedBase = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Reject direct slash-named base registration',
      '--base-ref', 'team/upstream/custom-base',
    ], project);
    assert.notEqual(protectedBase.status, 0, 'release/v1 must be protected through its configured custom tracking mapping');
    assert.match(protectedBase.stderr, /protected base branch release\/v1/i);
    assert.equal(readFileSync(ledgerPath, 'utf8'), originalContents, 'rejection must preserve unknown and foreign ledger bytes');

    git(project, 'checkout', '--quiet', 'work/team-upstream-custom');
    git(project, 'merge', '--quiet', '--ff-only', 'release/v1');
    writeFileSync(join(project, 'task.md'), 'Task based on the slash-named custom tracking ref.\n');
    git(project, 'add', 'task.md');
    git(project, 'commit', '--quiet', '-m', 'add task change');
    const branchSha = git(project, 'rev-parse', 'HEAD');
    const registered = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Register attached slash-base task branch',
      '--base-ref', 'team/upstream/custom-base',
    ], project);
    assert.equal(registered.status, 0, registered.stderr);
    const entry = JSON.parse(registered.stdout);
    assert.equal(entry.branchName, 'work/team-upstream-custom');
    assert.equal(entry.startBranchSha, branchSha);
    assert.deepEqual(entry.selectedBase, { ref: 'refs/remotes/team/upstream/custom-base', sha: selectedSha });
    const state = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    assert.deepEqual(state.entries[0], seededState.entries[0]);
    assert.deepEqual(state.reservations, seededState.reservations);
    assert.deepEqual(state.configurations, seededState.configurations);
    assert.deepEqual(state.foreignMetadata, seededState.foreignMetadata);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('begin rejects ambiguous configured mappings for a tracking base without ledger mutation', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-ambiguous-base-mapping-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'project'), 'work/ambiguous-base-mapping');
    const origin = addOrigin(project, fixture);
    git(project, 'checkout', '--quiet', '-b', 'release/base', 'main');
    git(project, 'push', '--quiet', origin, 'release/base');
    git(project, 'checkout', '--quiet', '-b', 'alternate/base', 'main');
    git(project, 'push', '--quiet', origin, 'alternate/base');
    git(project, 'fetch', '--quiet', 'origin');
    git(project, 'config', '--add', 'remote.origin.fetch', '+refs/heads/alternate/base:refs/remotes/origin/release/base');

    const foreignWorktree = join(fixture, 'foreign-owner');
    const seededState = {
      version: 1,
      scope: 'codex-wide',
      unknownHeader: { preserve: true },
      entries: [{ id: 'foreign-owner', status: 'active', worktree: foreignWorktree, extra: ['retain'] }],
      reservations: [{ id: 'foreign-reservation', worktree: foreignWorktree, pid: process.pid }],
      configurations: [{ id: 'foreign-configuration', worktree: foreignWorktree, slot: 6 }],
    };
    const originalContents = `${JSON.stringify(seededState, null, 2)}\n`;
    writeFileSync(ledgerPath, originalContents);

    const result = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Reject an ambiguous remote base mapping',
      '--base-ref', 'origin/release/base',
    ], project);
    assert.notEqual(result.status, 0, 'an ambiguous tracking ref must not be guessed into a local protected branch');
    assert.match(result.stderr, /ambiguous|mapping|cannot safely determine/i);
    assert.equal(readFileSync(ledgerPath, 'utf8'), originalContents, 'ambiguous mapping rejection must not mutate foreign v1 bytes');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('begin protects main and the selected local base branch, including for origin/master', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-protected-base-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'project'), 'work/protected-base');
    const origin = addOrigin(project, fixture);
    git(project, 'branch', 'master', 'main');
    git(project, 'checkout', '--quiet', 'master');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs/master-base.md'), 'Protected master base.\n');
    git(project, 'add', 'docs/master-base.md');
    git(project, 'commit', '--quiet', '-m', 'advance master base');
    git(project, 'push', '--quiet', origin, 'master');
    git(project, 'fetch', '--quiet', 'origin');
    git(project, 'checkout', '--quiet', 'work/protected-base');
    git(project, 'merge', '--quiet', '--ff-only', 'master');
    writeFileSync(join(project, 'task.md'), 'Protected base task.\n');
    git(project, 'add', 'task.md');
    git(project, 'commit', '--quiet', '-m', 'add task change');

    const foreignWorktree = join(fixture, 'foreign-owner');
    const seededState = {
      version: 1,
      scope: 'codex-wide',
      legacyHeader: { keep: true },
      entries: [{ id: 'foreign-owner', status: 'active', worktree: foreignWorktree, unknown: 'keep' }],
      reservations: [{ id: 'foreign-reservation', worktree: foreignWorktree, pid: process.pid }],
      configurations: [{ id: 'foreign-config', worktree: foreignWorktree, slot: 4 }],
    };
    const originalContents = `${JSON.stringify(seededState, null, 2)}\n`;
    writeFileSync(ledgerPath, originalContents);
    const cases = [
      { branch: 'main', base: 'master', reason: /protected base branch main/i },
      { branch: 'master', base: 'origin/master', reason: /protected base branch master/i },
      { branch: 'master', base: 'master', reason: /protected base branch master/i },
    ];
    for (const { branch, base, reason } of cases) {
      git(project, 'checkout', '--quiet', branch);
      const result = command([
        'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Reject protected branch registration',
        '--base-ref', base,
      ], project);
      assert.notEqual(result.status, 0, `${branch} must not be registered directly`);
      assert.match(result.stderr, reason);
      assert.equal(readFileSync(ledgerPath, 'utf8'), originalContents, `${branch} rejection must not mutate the ledger`);
    }
    git(project, 'checkout', '--detach', '--quiet', 'HEAD');
    const detached = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Reject detached registration',
      '--base-ref', 'master',
    ], project);
    assert.notEqual(detached.status, 0);
    assert.match(detached.stderr, /attached branch/i);
    assert.equal(readFileSync(ledgerPath, 'utf8'), originalContents, 'detached rejection must not mutate the ledger');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('begin registers a master-only repository without inventing a main SHA', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-master-only-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'project'), 'work/master-only');
    git(project, 'branch', 'master', 'main');
    git(project, 'checkout', '--quiet', 'master');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs/master-base.md'), 'Master-only base.\n');
    git(project, 'add', 'docs/master-base.md');
    git(project, 'commit', '--quiet', '-m', 'advance master base');
    const masterSha = git(project, 'rev-parse', 'HEAD');
    git(project, 'checkout', '--quiet', 'work/master-only');
    git(project, 'merge', '--quiet', '--ff-only', 'master');
    git(project, 'branch', '--delete', 'main');
    writeFileSync(join(project, 'task.md'), 'Master-only task.\n');
    git(project, 'add', 'task.md');
    git(project, 'commit', '--quiet', '-m', 'add task change');

    const result = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Register a master-only checkout',
      '--base-ref', 'master',
    ], project);
    assert.equal(result.status, 0, result.stderr);
    const entry = JSON.parse(result.stdout);
    assert.equal(entry.branchName, 'work/master-only');
    assert.equal(entry.repositoryRoot, realpathSync(project));
    assert.deepEqual(entry.selectedBase, { ref: 'refs/heads/master', sha: masterSha });
    assert.equal(Object.hasOwn(entry, 'startMainSha'), false, 'a repository without main has no main SHA to record');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('master-only owner can park and resume with its persisted selected base', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-master-lifecycle-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'project'), 'work/master-lifecycle');
    git(project, 'branch', 'master', 'main');
    git(project, 'checkout', '--quiet', 'master');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs/master-base.md'), 'Master-only lifecycle base.\n');
    git(project, 'add', 'docs/master-base.md');
    git(project, 'commit', '--quiet', '-m', 'advance master base');
    const masterSha = git(project, 'rev-parse', 'HEAD');
    git(project, 'checkout', '--quiet', 'work/master-lifecycle');
    git(project, 'merge', '--quiet', '--ff-only', 'master');
    git(project, 'branch', '--delete', 'main');
    writeFileSync(join(project, 'task.md'), 'Master-only lifecycle task.\n');
    git(project, 'add', 'task.md');
    git(project, 'commit', '--quiet', '-m', 'add task change');

    const began = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Park a master-only owner',
      '--base-ref', 'master', '--resources', 'master-lifecycle-resource',
    ], project);
    assert.equal(began.status, 0, began.stderr);
    const entry = JSON.parse(began.stdout);
    const checkpoint = git(project, 'rev-parse', 'HEAD');
    const claimedResult = command([
      'claim', '--file', ledgerPath, '--id', entry.id, '--scope', 'docs/master-lifecycle.md',
      '--claims', 'master-lifecycle-claim',
    ], project);
    assert.equal(claimedResult.status, 0, claimedResult.stderr);
    const claimed = JSON.parse(claimedResult.stdout);
    assert.deepEqual(claimed.selectedBase, entry.selectedBase);
    const heartbeatResult = command(['heartbeat', '--file', ledgerPath, '--id', entry.id], project);
    assert.equal(heartbeatResult.status, 0, heartbeatResult.stderr);
    const heartbeat = JSON.parse(heartbeatResult.stdout);
    assert.deepEqual(heartbeat.selectedBase, entry.selectedBase);
    const releasedResult = command([
      'release-claim', '--file', ledgerPath, '--id', entry.id, '--scope', 'docs/master-lifecycle.md',
      '--claims', 'master-lifecycle-claim',
    ], project);
    assert.equal(releasedResult.status, 0, releasedResult.stderr);
    const released = JSON.parse(releasedResult.stdout);
    assert.deepEqual(released.selectedBase, entry.selectedBase);
    assert.deepEqual(released.resources, ['master-lifecycle-resource']);
    const parkedResult = command([
      'park', '--file', ledgerPath, '--id', entry.id, '--checkpoint-sha', checkpoint,
      '--next-action', 'Resume the same master-based task.',
    ], project);
    assert.equal(parkedResult.status, 0, parkedResult.stderr);
    const parked = JSON.parse(parkedResult.stdout);
    assert.equal(parked.status, 'parked');
    assert.deepEqual(parked.selectedBase, { ref: 'refs/heads/master', sha: masterSha });
    assert.deepEqual(parked.resources, ['master-lifecycle-resource']);

    const resumedResult = command(['resume', '--file', ledgerPath, '--id', entry.id], project);
    assert.equal(resumedResult.status, 0, resumedResult.stderr);
    const resumed = JSON.parse(resumedResult.stdout);
    assert.equal(resumed.status, 'active');
    assert.deepEqual(resumed.selectedBase, parked.selectedBase);
    assert.deepEqual(resumed.resources, parked.resources);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('begin blocks a second project resource owner and retains both projects in v1 state', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-begin-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const projectA = createProject(join(fixture, 'project-a'), 'work/project-a');
    const projectB = createProject(join(fixture, 'project-b'), 'work/project-b');
    const otherWorktree = join(fixture, 'already-running-project');
    mkdirSync(otherWorktree);
    const legacyEntry = {
      id: 'existing-project-entry',
      status: 'active',
      worktree: otherWorktree,
      branchName: 'feature/other-project',
      startedAt: '2026-10-17T09:00:00.000Z',
      heartbeatAt: '2026-10-17T09:00:00.000Z',
      claims: [],
      resources: ['browser-runtime'],
      extraLegacyEntryData: { retain: true },
    };
    const seededState = {
      version: 1,
      scope: 'codex-wide',
      legacyHeader: { retain: 'other-client metadata' },
      entries: [legacyEntry],
      reservations: [{ id: 'resource-reservation', slot: 6, worktree: otherWorktree, kind: 'firebase', pid: process.pid, ports: [8080] }],
      configurations: [{ id: 'resource-configuration', slot: 7, worktree: otherWorktree, configuredAt: '2026-10-17T09:00:00.000Z', ports: [8081] }],
    };
    writeFileSync(ledgerPath, `${JSON.stringify(seededState, null, 2)}\n`);

    const blocked = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Project A work',
      '--resources', 'browser-runtime',
    ], projectA);
    assert.notEqual(blocked.status, 0, 'a different project cannot claim another active owner resource');
    assert.match(blocked.stderr, /conflict|overlap|owner/i);
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')), seededState, 'a rejected claim must leave every owner record intact');

    const allowed = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Project A work',
      '--scope', 'scripts/agent-tools/a.mjs', '--resources', 'project-a-only',
    ], projectA);
    assert.equal(allowed.status, 0, allowed.stderr);
    const projectAEntry = JSON.parse(allowed.stdout);
    assert.match(projectAEntry.id, /^\d+-\d+-[0-9a-f]{8}$/);
    assert.equal(projectAEntry.status, 'active');
    assert.equal(projectAEntry.worktree, realpathSync(projectA));
    assert.equal(projectAEntry.branchName, 'work/project-a');
    assert.equal(projectAEntry.startBranchSha, git(projectA, 'rev-parse', 'HEAD'));
    assert.equal(projectAEntry.startMainSha, git(projectA, 'rev-parse', 'main'));
    assert.deepEqual(projectAEntry.selectedBase, {
      ref: 'refs/heads/main', sha: git(projectA, 'rev-parse', 'main'),
    });
    assert.deepEqual(projectAEntry.resources, ['project-a-only']);

    const afterFirstBegin = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    assert.deepEqual(afterFirstBegin.legacyHeader, seededState.legacyHeader);
    assert.deepEqual(afterFirstBegin.entries[0], legacyEntry);
    assert.equal(afterFirstBegin.reservations[0].id, 'resource-reservation');
    assert.equal(afterFirstBegin.configurations[0].id, 'resource-configuration');

    const blockedProjectB = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Project B work',
      '--resources', 'project-a-only',
    ], projectB);
    assert.notEqual(blockedProjectB.status, 0, 'the first project entry remains exclusive across worktrees');
    assert.match(blockedProjectB.stderr, /conflict|overlap|owner/i);
    const finalState = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    assert.deepEqual(finalState.entries.map((entry) => entry.id), ['existing-project-entry', projectAEntry.id]);
    assert.equal(finalState.reservations[0].id, 'resource-reservation');
    assert.equal(finalState.configurations[0].id, 'resource-configuration');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('heartbeat updates only the active entry owned by the current worktree', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-heartbeat-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const ownerProject = createProject(join(fixture, 'owner-project'), 'work/owner');
    const otherProject = createProject(join(fixture, 'other-project'), 'work/other');
    const otherWorktree = join(fixture, 'third-project');
    mkdirSync(otherWorktree);
    const ownerEntry = {
      id: 'heartbeat-owner',
      status: 'active',
      worktree: realpathSync(ownerProject),
      branchName: 'work/owner',
      startedAt: '2000-01-01T00:00:00.000Z',
      heartbeatAt: '2000-01-01T00:00:00.000Z',
      resources: ['browser-runtime'],
      claims: [],
      customLeaseContext: { preserve: true },
    };
    const seededState = {
      version: 1,
      scope: 'codex-wide',
      entries: [ownerEntry],
      reservations: [{ id: 'other-resource', worktree: otherWorktree, pid: process.pid, slot: 5, ports: [8080] }],
      configurations: [],
    };
    writeFileSync(ledgerPath, `${JSON.stringify(seededState, null, 2)}\n`);

    const wrongOwner = command(['heartbeat', '--file', ledgerPath, '--id', ownerEntry.id], otherProject);
    assert.notEqual(wrongOwner.status, 0, 'a different worktree cannot heartbeat another project entry');
    assert.match(wrongOwner.stderr, /belongs to|owner|cannot heartbeat/i);
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')), seededState);

    const ownerHeartbeat = command(['heartbeat', '--file', ledgerPath, '--id', ownerEntry.id], ownerProject);
    assert.equal(ownerHeartbeat.status, 0, ownerHeartbeat.stderr);
    const updated = JSON.parse(ownerHeartbeat.stdout);
    assert.equal(updated.id, ownerEntry.id);
    assert.ok(Date.parse(updated.heartbeatAt) > Date.parse(ownerEntry.heartbeatAt));
    assert.deepEqual(updated.lease, {
      state: 'healthy',
      ownerConfirmationRequired: false,
      takeoverAllowed: false,
      lastHeartbeatAt: updated.heartbeatAt,
      expiresAt: new Date(Date.parse(updated.heartbeatAt) + 90_000).toISOString(),
    });
    assert.deepEqual(updated.customLeaseContext, { preserve: true });
    const finalState = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    assert.deepEqual(finalState.entries[0], updated);
    assert.equal(finalState.reservations[0].id, 'other-resource');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('park and resume preserve owner identity, checkpoint, lease, and resource ownership', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-park-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const ownerProject = createProject(join(fixture, 'owner-project'), 'work/owner');
    const otherProject = createProject(join(fixture, 'other-project'), 'work/other');
    const began = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Park lifecycle fixture',
      '--resources', 'parked-resource',
    ], ownerProject);
    assert.equal(began.status, 0, began.stderr);
    const entry = JSON.parse(began.stdout);
    const checkpointSha = git(ownerProject, 'rev-parse', 'HEAD');
    const stateBefore = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    stateBefore.entries[0].customOwnerMetadata = { retained: ['through', 'park', 'resume'] };
    writeFileSync(ledgerPath, `${JSON.stringify(stateBefore, null, 2)}\n`);

    const wrongCheckpoint = command([
      'park', '--file', ledgerPath, '--id', entry.id, '--checkpoint-sha', '0'.repeat(40),
    ], ownerProject);
    assert.notEqual(wrongCheckpoint.status, 0, 'park must bind the current exact commit');
    assert.match(wrongCheckpoint.stderr, /checkpoint|branch/i);
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')), stateBefore);

    const parkedResult = command([
      'park', '--file', ledgerPath, '--id', entry.id, '--checkpoint-sha', checkpointSha,
      '--next-action', 'Resume after the integration handoff.',
    ], ownerProject);
    assert.equal(parkedResult.status, 0, parkedResult.stderr);
    const parked = JSON.parse(parkedResult.stdout);
    assert.equal(parked.status, 'parked');
    assert.equal(parked.parked.status, 'parked');
    assert.equal(parked.parked.checkpointSha, checkpointSha);
    assert.equal(parked.parked.worktree, realpathSync(ownerProject));
    assert.equal(parked.parked.nextAction, 'Resume after the integration handoff.');
    assert.deepEqual(parked.lease, {
      state: 'parked-no-heartbeat-required',
      ownerConfirmationRequired: false,
      takeoverAllowed: false,
    });
    assert.deepEqual(parked.customOwnerMetadata, { retained: ['through', 'park', 'resume'] });

    const parkedHeartbeat = command(['heartbeat', '--file', ledgerPath, '--id', entry.id], ownerProject);
    assert.notEqual(parkedHeartbeat.status, 0, 'parked entries do not accept a live heartbeat');
    const blockedOtherProject = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Competing fixture',
      '--resources', 'parked-resource',
    ], otherProject);
    assert.notEqual(blockedOtherProject.status, 0, 'parked resource ownership remains exclusive');
    assert.match(blockedOtherProject.stderr, /conflict|owner|owned/i);
    const wrongResume = command(['resume', '--file', ledgerPath, '--id', entry.id], otherProject);
    assert.notEqual(wrongResume.status, 0, 'another project cannot resume a parked entry');
    assert.match(wrongResume.stderr, /belongs to|owner|cannot resume/i);

    const resumedResult = command(['resume', '--file', ledgerPath, '--id', entry.id], ownerProject);
    assert.equal(resumedResult.status, 0, resumedResult.stderr);
    const resumed = JSON.parse(resumedResult.stdout);
    assert.equal(resumed.status, 'active');
    assert.equal(resumed.parked.status, 'resumed');
    assert.equal(resumed.parked.checkpointSha, checkpointSha);
    assert.equal(resumed.parked.nextAction, 'Resume after the integration handoff.');
    assert.deepEqual(resumed.lease, {
      state: 'healthy',
      ownerConfirmationRequired: false,
      takeoverAllowed: false,
      lastHeartbeatAt: resumed.heartbeatAt,
    });
    assert.deepEqual(resumed.customOwnerMetadata, { retained: ['through', 'park', 'resume'] });
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')).entries.map((candidate) => candidate.id), [entry.id]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('Chain Scanner finish rejects a landed entry without exact-SHA release evidence', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-finish-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'chain-scanner'), 'work/finish');
    const origin = addOrigin(project, fixture);
    mkdirSync(join(project, 'scripts'), { recursive: true });
    copyFileSync(releaseEvidenceEntrypoint, join(project, 'scripts/release-evidence.mjs'));
    git(project, 'add', 'scripts/release-evidence.mjs');
    git(project, 'commit', '--quiet', '-m', 'install fixture release adapter');
    const began = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Finish evidence fixture',
    ], project);
    assert.equal(began.status, 0, began.stderr);
    const entry = JSON.parse(began.stdout);
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs/fixture-note.md'), 'Synthetic documentation-only change for release evidence.\n');
    git(project, 'add', 'docs/fixture-note.md');
    git(project, 'commit', '--quiet', '-m', 'fixture documented change');
    const candidateSha = git(project, 'rev-parse', 'HEAD');
    const baseSha = entry.startBranchSha;

    const ledgerBeforeFinish = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    const otherWorktree = join(fixture, 'other-project');
    mkdirSync(otherWorktree);
    ledgerBeforeFinish.entries.push({
      id: 'other-project-live-entry', status: 'active', worktree: otherWorktree,
      branchName: 'work/other', resources: ['other-project-browser'], claims: [], extraLegacyData: { keep: true },
    });
    ledgerBeforeFinish.reservations = [{
      id: 'other-project-reservation', worktree: otherWorktree, slot: 4,
      pid: process.pid, ports: [8787], extraLegacyReservationData: 'keep',
    }];
    ledgerBeforeFinish.unknownTopLevel = { retained: true };
    writeFileSync(ledgerPath, `${JSON.stringify(ledgerBeforeFinish, null, 2)}\n`);

    const mainSha = git(project, 'rev-parse', 'main');
    assert.equal(mainSha, entry.startMainSha, 'fixture main starts before the task branch');
    git(project, 'checkout', '--quiet', 'main');
    git(project, 'merge', '--quiet', '--ff-only', entry.branchName);
    const mergedMainSha = git(project, 'rev-parse', 'main');
    assert.equal(mergedMainSha, candidateSha);
    advanceOriginMain(project);
    assert.equal(git(project, 'rev-parse', 'origin/main'), mergedMainSha);
    git(project, 'checkout', '--quiet', entry.branchName);

    const result = command([
      'finish', '--file', ledgerPath, '--id', entry.id, '--outcome', 'landed', '--adapter', 'chain-scanner',
    ], project);

    assert.notEqual(result.status, 0, 'a landed entry without its repository release receipt cannot complete');
    assert.match(result.stderr, /release receipt|release evidence/i);
    const after = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    assert.equal(after.entries[0].status, 'active', 'rejected completion must retain the active owner');
    assert.equal(after.entries[0].id, entry.id);

    const ownerEvidencePath = join(fixture, 'owner-review.md');
    const ownerEvidence = 'Owner reviewed the entire exact candidate and its documentation-only risk.';
    writeFileSync(ownerEvidencePath, `${ownerEvidence}\n`);
    const evidenceSha256 = createHash('sha256').update(`${ownerEvidence}\n`).digest('hex');
    const recorded = recordReleaseEvidence(project, {
      schemaVersion: 2,
      candidate: {
        commitSha: candidateSha,
        treeSha: git(project, 'rev-parse', `${candidateSha}^{tree}`),
        baseSha,
      },
      ownerReview: {
        task: 'owner-review-156-fixture', outcome: 'approved', reviewedSha: candidateSha,
        completedAt: '2026-10-17T11:00:00.000Z',
        summary: ownerEvidence,
        scope: { fullDiff: true, rationale: 'The exact docs-only candidate has no executable or data behavior.' },
        evidencePath: ownerEvidencePath, evidenceSha256,
      },
    });
    const finished = command([
      'finish', '--file', ledgerPath, '--id', entry.id, '--outcome', 'landed', '--adapter', 'chain-scanner',
      '--result', 'Fixture landed with the repository release receipt.',
    ], project);
    assert.equal(finished.status, 0, finished.stderr);
    const completed = JSON.parse(finished.stdout);
    assert.equal(completed.status, 'complete');
    assert.equal(completed.outcome, 'landed');
    assert.equal(completed.finalBranchSha, candidateSha);
    assert.equal(completed.mainSha, candidateSha);
    assert.equal(completed.originMainSha, candidateSha);
    assert.equal(completed.pushed, true);
    assert.equal(completed.releaseEvidence.adapter, 'chain-scanner');
    assert.equal(completed.releaseEvidence.receiptPath, recorded.receiptPath);
    assert.equal(completed.releaseEvidence.receiptSha256, recorded.receipt.receiptSha256);
    assert.equal(completed.releaseEvidence.candidate.commitSha, candidateSha);
    const finalState = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    assert.deepEqual(finalState.unknownTopLevel, { retained: true });
    assert.equal(finalState.entries[1].id, 'other-project-live-entry');
    assert.deepEqual(finalState.entries[1].extraLegacyData, { keep: true });
    assert.deepEqual(finalState.entries[1].resources, ['other-project-browser']);
    assert.equal(finalState.reservations[0].id, 'other-project-reservation');
    assert.deepEqual(finalState.reservations[0].ports, [8787]);
    assert.equal(git(project, '--git-dir', origin, 'rev-parse', 'refs/heads/main'), candidateSha);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('Chain Scanner finish keeps actual main and exact receipt authority after master-base registration', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-master-release-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'chain-scanner'), 'work/master-release');
    git(project, 'checkout', '--quiet', 'main');
    mkdirSync(join(project, 'scripts'), { recursive: true });
    copyFileSync(releaseEvidenceEntrypoint, join(project, 'scripts/release-evidence.mjs'));
    git(project, 'add', 'scripts/release-evidence.mjs');
    git(project, 'commit', '--quiet', '-m', 'install fixture release adapter');
    git(project, 'checkout', '--quiet', 'work/master-release');
    git(project, 'merge', '--quiet', '--ff-only', 'main');
    git(project, 'branch', 'master', 'main');
    git(project, 'checkout', '--quiet', 'master');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs/master-base.md'), 'Master release base.\n');
    git(project, 'add', 'docs/master-base.md');
    git(project, 'commit', '--quiet', '-m', 'advance master release base');
    const masterSha = git(project, 'rev-parse', 'HEAD');
    const origin = addOrigin(project, fixture);
    git(project, 'push', '--quiet', origin, 'master');
    git(project, 'fetch', '--quiet', 'origin');
    git(project, 'checkout', '--quiet', 'work/master-release');
    git(project, 'merge', '--quiet', '--ff-only', 'master');
    const began = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Strict release after master registration',
      '--base-ref', 'master',
    ], project);
    assert.equal(began.status, 0, began.stderr);
    const entry = JSON.parse(began.stdout);
    assert.deepEqual(entry.selectedBase, { ref: 'refs/heads/master', sha: masterSha });
    writeFileSync(join(project, 'docs/task-note.md'), 'Candidate based on master.\n');
    git(project, 'add', 'docs/task-note.md');
    git(project, 'commit', '--quiet', '-m', 'add master-based task change');
    const candidateSha = git(project, 'rev-parse', 'HEAD');

    // Even when local master contains the candidate, Chain Scanner must require actual main.
    git(project, 'checkout', '--quiet', 'master');
    git(project, 'merge', '--quiet', '--ff-only', entry.branchName);
    git(project, 'checkout', '--quiet', entry.branchName);
    const missingFromMain = command([
      'finish', '--file', ledgerPath, '--id', entry.id, '--outcome', 'landed', '--adapter', 'chain-scanner',
    ], project);
    assert.notEqual(missingFromMain.status, 0);
    assert.match(missingFromMain.stderr, /local main does not contain exact task commit/i);
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')).entries[0].selectedBase, entry.selectedBase);

    git(project, 'checkout', '--quiet', 'main');
    git(project, 'merge', '--quiet', '--ff-only', entry.branchName);
    git(project, 'checkout', '--quiet', entry.branchName);
    const staleRemote = command([
      'finish', '--file', ledgerPath, '--id', entry.id, '--outcome', 'landed', '--adapter', 'chain-scanner',
    ], project);
    assert.notEqual(staleRemote.status, 0);
    assert.match(staleRemote.stderr, /origin\/main .* does not match local main/i);

    git(project, 'checkout', '--quiet', 'main');
    git(project, 'push', '--quiet', 'origin', 'main');
    git(project, 'fetch', '--quiet', 'origin');
    git(project, 'checkout', '--quiet', entry.branchName);
    assert.equal(git(project, 'rev-parse', 'origin/main'), candidateSha);
    const missingReceipt = command([
      'finish', '--file', ledgerPath, '--id', entry.id, '--outcome', 'landed', '--adapter', 'chain-scanner',
    ], project);
    assert.notEqual(missingReceipt.status, 0);
    assert.match(missingReceipt.stderr, /release receipt|release evidence/i);
    const finalEntry = JSON.parse(readFileSync(ledgerPath, 'utf8')).entries[0];
    assert.equal(finalEntry.status, 'active');
    assert.deepEqual(finalEntry.selectedBase, entry.selectedBase);
    assert.equal(finalEntry.finalBranchSha, undefined);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('Chain Scanner landed finish rejects a stale remote even when local main refs agree', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-remote-stale-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'chain-scanner'), 'work/remote-stale');
    const origin = addOrigin(project, fixture);
    mkdirSync(join(project, 'scripts'), { recursive: true });
    copyFileSync(releaseEvidenceEntrypoint, join(project, 'scripts/release-evidence.mjs'));
    git(project, 'add', 'scripts/release-evidence.mjs');
    git(project, 'commit', '--quiet', '-m', 'install fixture release adapter');
    const began = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Remote divergence fixture',
    ], project);
    assert.equal(began.status, 0, began.stderr);
    const entry = JSON.parse(began.stdout);
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs/fixture-note.md'), 'Synthetic remote divergence release evidence.\n');
    git(project, 'add', 'docs/fixture-note.md');
    git(project, 'commit', '--quiet', '-m', 'fixture task change');
    const candidateSha = git(project, 'rev-parse', 'HEAD');
    git(project, 'checkout', '--quiet', 'main');
    git(project, 'merge', '--quiet', '--ff-only', entry.branchName);
    git(project, 'push', '--quiet', 'origin', 'main');
    git(project, 'fetch', '--quiet', 'origin');
    git(project, 'checkout', '--quiet', entry.branchName);

    const ownerEvidencePath = join(fixture, 'remote-stale-owner-review.md');
    const ownerEvidence = 'Owner reviewed the full exact documentation candidate in this fixture.';
    writeFileSync(ownerEvidencePath, `${ownerEvidence}\n`);
    recordReleaseEvidence(project, {
      schemaVersion: 2,
      candidate: {
        commitSha: candidateSha,
        treeSha: git(project, 'rev-parse', `${candidateSha}^{tree}`),
        baseSha: entry.startBranchSha,
      },
      ownerReview: {
        task: 'owner-review-156-remote-fixture', outcome: 'approved', reviewedSha: candidateSha,
        completedAt: '2026-10-17T11:00:00.000Z',
        summary: ownerEvidence,
        scope: { fullDiff: true, rationale: 'This fixture only adds a non-policy documentation note.' },
        evidencePath: ownerEvidencePath,
        evidenceSha256: createHash('sha256').update(`${ownerEvidence}\n`).digest('hex'),
      },
    });
    git(project, '--git-dir', origin, 'update-ref', 'refs/heads/main', entry.startMainSha);
    assert.equal(git(project, 'rev-parse', 'main'), candidateSha);
    assert.equal(git(project, 'rev-parse', 'origin/main'), candidateSha, 'the local tracking ref remains stale at candidate');

    const result = command([
      'finish', '--file', ledgerPath, '--id', entry.id, '--outcome', 'landed', '--adapter', 'chain-scanner',
    ], project);

    assert.notEqual(result.status, 0, 'a stale actual remote must block a landed completion');
    assert.match(result.stderr, /remote|origin\/main/i);
    assert.equal(JSON.parse(readFileSync(ledgerPath, 'utf8')).entries[0].status, 'active');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('claim records additional ownership and resources on the active owner entry', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-claim-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'project'), 'work/claim');
    const began = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Ownership claim fixture',
    ], project);
    assert.equal(began.status, 0, began.stderr);
    const entry = JSON.parse(began.stdout);
    const result = command([
      'claim', '--file', ledgerPath, '--id', entry.id,
      '--scope', 'scripts/shared.mjs', '--claims', 'release-coordination', '--resources', 'shared-cache',
    ], project);
    assert.equal(result.status, 0, result.stderr);
    const claimed = JSON.parse(result.stdout);
    assert.deepEqual(claimed.scopes, ['scripts/shared.mjs']);
    assert.deepEqual(claimed.claims, ['release-coordination']);
    assert.deepEqual(claimed.resources, ['shared-cache']);
    assert.equal(claimed.amendments.length, 1);
    assert.deepEqual(claimed.amendments[0].resources, ['shared-cache']);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('release-claim enforces owner identity and only releases the requested ownership', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-release-claim-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const ownerProject = createProject(join(fixture, 'owner-project'), 'work/owner');
    const competingProject = createProject(join(fixture, 'competing-project'), 'work/competing');
    const began = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Release claim fixture',
      '--resources', 'keep-resource',
    ], ownerProject);
    assert.equal(began.status, 0, began.stderr);
    const ownerEntry = JSON.parse(began.stdout);
    const claimed = command([
      'claim', '--file', ledgerPath, '--id', ownerEntry.id,
      '--scope', 'scripts/release-me.mjs', '--claims', 'coordination-release', '--resources', 'release-resource',
    ], ownerProject);
    assert.equal(claimed.status, 0, claimed.stderr);
    const withClaim = JSON.parse(claimed.stdout);
    const beforeWrongOwner = readFileSync(ledgerPath, 'utf8');

    const competingBegin = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Competing resource claim',
      '--resources', 'release-resource',
    ], competingProject);
    assert.notEqual(competingBegin.status, 0);
    assert.match(competingBegin.stderr, /conflict|owner|owned/i);
    const wrongOwnerRelease = command([
      'release-claim', '--file', ledgerPath, '--id', ownerEntry.id, '--resources', 'release-resource',
    ], competingProject);
    assert.notEqual(wrongOwnerRelease.status, 0);
    assert.match(wrongOwnerRelease.stderr, /belongs to|owner|cannot release/i);
    assert.equal(readFileSync(ledgerPath, 'utf8'), beforeWrongOwner, 'foreign release must not alter any ledger byte');

    const released = command([
      'release-claim', '--file', ledgerPath, '--id', ownerEntry.id,
      '--scope', 'scripts/release-me.mjs', '--claims', 'coordination-release', '--resources', 'release-resource',
    ], ownerProject);
    assert.equal(released.status, 0, released.stderr);
    const releasedEntry = JSON.parse(released.stdout);
    assert.deepEqual(releasedEntry.scopes, []);
    assert.deepEqual(releasedEntry.claims, []);
    assert.deepEqual(releasedEntry.resources, ['keep-resource']);
    assert.deepEqual(releasedEntry.claimReleases.at(-1), {
      releasedAt: releasedEntry.claimReleases.at(-1).releasedAt,
      scopes: ['scripts/release-me.mjs'], claims: ['coordination-release'], resources: ['release-resource'],
    });
    assert.deepEqual(withClaim.resources, ['keep-resource', 'release-resource']);

    const competingAfterRelease = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Competing resource after release',
      '--resources', 'release-resource',
    ], competingProject);
    assert.equal(competingAfterRelease.status, 0, competingAfterRelease.stderr);
    assert.deepEqual(JSON.parse(competingAfterRelease.stdout).resources, ['release-resource']);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('explicit install survives checkout removal and exports the canonical ledger safely', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-install-'));
  try {
    const temporaryCheckout = join(fixture, 'temporary-checkout');
    const stableTools = join(fixture, 'stable-tools');
    const temporaryEntrypoint = join(temporaryCheckout, 'coordination.mjs');
    const stableEntrypoint = join(stableTools, 'coordination.mjs');
    const ledgerPath = join(fixture, "host's shared ledger.json");
    mkdirSync(temporaryCheckout, { recursive: true });
    copyFileSync(entrypoint, temporaryEntrypoint);

    const installed = commandAt(temporaryEntrypoint, ['install', '--to', stableEntrypoint], fixture);
    assert.equal(installed.status, 0, installed.stderr);
    assert.deepEqual(JSON.parse(installed.stdout), { installed: true, unchanged: false, path: stableEntrypoint });
    assert.ok((statSync(stableEntrypoint).mode & 0o111) !== 0, 'the supported copy is executable');

    const idempotent = commandAt(temporaryEntrypoint, ['install', '--to', stableEntrypoint], fixture);
    assert.equal(idempotent.status, 0, idempotent.stderr);
    assert.deepEqual(JSON.parse(idempotent.stdout), { installed: true, unchanged: true, path: stableEntrypoint });

    const conflictingDestination = join(stableTools, 'occupied.mjs');
    writeFileSync(conflictingDestination, 'user-owned content\n');
    const refused = commandAt(temporaryEntrypoint, ['install', '--to', conflictingDestination], fixture);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /refusing to overwrite/i);
    assert.equal(readFileSync(conflictingDestination, 'utf8'), 'user-owned content\n');

    rmSync(temporaryCheckout, { recursive: true, force: true });
    const discovered = commandAt(stableEntrypoint, ['discover'], fixture, { CODEX_COORDINATION_FILE: ledgerPath });
    assert.equal(discovered.status, 0, discovered.stderr);
    assert.equal(discovered.stdout.trim(), ledgerPath);
    const exported = commandAt(stableEntrypoint, ['export-env'], fixture, { CODEX_COORDINATION_FILE: ledgerPath });
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal(exported.stdout.trim(), `export CODEX_COORDINATION_FILE='${ledgerPath.replaceAll("'", "'\\''")}'`);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('install refuses an identical nonexecutable target instead of claiming a usable command', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-nonexecutable-install-'));
  try {
    const target = join(fixture, 'existing.mjs');
    copyFileSync(entrypoint, target);
    chmodSync(target, 0o644);
    const contents = readFileSync(target);

    const result = command(['install', '--to', target], fixture);
    assert.notEqual(result.status, 0, 'install cannot claim success for a command the shell cannot execute');
    assert.match(result.stderr, /not executable/i);
    assert.equal(result.stdout, '');
    assert.deepEqual(readFileSync(target), contents, 'existing file content stays intact');
    assert.equal(statSync(target).mode & 0o777, 0o644, 'installation must not alter an existing file permission');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('concurrent project begins serialize on one ledger without losing either entry', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-concurrent-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const projectA = createProject(join(fixture, 'project-a'), 'work/project-a');
    const projectB = createProject(join(fixture, 'project-b'), 'work/project-b');
    const results = await Promise.all([
      commandAsync([
        'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Concurrent project A',
        '--resources', 'runtime-a',
      ], projectA),
      commandAsync([
        'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Concurrent project B',
        '--resources', 'runtime-b',
      ], projectB),
    ]);
    assert.deepEqual(results.map((result) => result.status), [0, 0], results.map((result) => result.stderr).join('\n'));
    const created = results.map((result) => JSON.parse(result.stdout));
    assert.notEqual(created[0].id, created[1].id);
    assert.deepEqual(new Set(created.map((entry) => entry.worktree)), new Set([realpathSync(projectA), realpathSync(projectB)]));
    const state = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    assert.deepEqual(new Set(state.entries.map((entry) => entry.id)), new Set(created.map((entry) => entry.id)));
    assert.deepEqual(new Set(state.entries.flatMap((entry) => entry.resources)), new Set(['runtime-a', 'runtime-b']));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('begin prunes parked-only configurations using the v1 active-owner rule and retains reservations', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-configurations-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const project = createProject(join(fixture, 'new-project'), 'work/configurations');
    const activeWorktree = join(fixture, 'active-project');
    const parkedWorktree = join(fixture, 'parked-project');
    const reservedWorktree = join(fixture, 'reserved-project');
    // Legacy mutations do not infer loss of ownership from a missing/offline worktree.
    for (const worktree of [parkedWorktree, reservedWorktree]) mkdirSync(worktree);
    const activeEntry = { id: 'active-owner', status: 'active', worktree: activeWorktree, resources: ['foreign-runtime'], lease: { state: 'healthy' }, foreignMetadata: { keep: true } };
    const parkedEntry = { id: 'parked-owner', status: 'parked', worktree: parkedWorktree, resources: ['parked-runtime'], parked: { checkpointSha: '1'.repeat(40) }, lease: { state: 'parked-no-heartbeat-required' } };
    const reservation = { id: 'reserved-runtime', worktree: reservedWorktree, pid: process.pid, slot: 5, foreignMetadata: { keep: true } };
    const activeConfiguration = { worktree: activeWorktree, slot: 1, extra: 'active' };
    const reservedConfiguration = { worktree: reservedWorktree, slot: 5, extra: 'reserved' };
    writeFileSync(ledgerPath, JSON.stringify({
      version: 1, scope: 'codex-wide', unknownTopLevel: { keep: true },
      entries: [activeEntry, parkedEntry], reservations: [reservation],
      configurations: [activeConfiguration, { worktree: parkedWorktree, slot: 2 }, reservedConfiguration],
    }));

    const began = command(['begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Configuration compatibility fixture'], project);
    assert.equal(began.status, 0, began.stderr);
    const observed = command(['status', '--file', ledgerPath], project);
    assert.equal(observed.status, 0, observed.stderr);
    const { state } = JSON.parse(observed.stdout);
    assert.deepEqual(state.configurations, [activeConfiguration, reservedConfiguration], 'parked-only configuration is orphaned under the existing v1 rule');
    assert.deepEqual(state.entries.slice(0, 2), [activeEntry, parkedEntry], 'configuration cleanup must preserve foreign owner entries and parked claims');
    assert.deepEqual(state.reservations, [reservation], 'reservation-backed configuration and reservation remain owned');
    assert.deepEqual(state.unknownTopLevel, { keep: true });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('bounded legacy v1 client fixture and current CLI interoperate on one locked ledger', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-legacy-'));
  try {
    const ledgerPath = join(fixture, 'host-ledger.json');
    const legacyClientPath = join(fixture, 'legacy-client-v1.mjs');
    const project = createProject(join(fixture, 'project'), 'work/legacy');
    const began = command([
      'begin', '--file', ledgerPath, '--work-type', 'tooling', '--intent', 'Legacy interoperability fixture',
      '--resources', 'legacy-owned-resource',
    ], project);
    assert.equal(began.status, 0, began.stderr);
    const entry = JSON.parse(began.stdout);

    // Bounded snapshot of the participating v1 client protocol: token lock, v1 JSON read/write, lease refresh, and token-owned unlock.
    writeFileSync(legacyClientPath, `
      import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
      import { randomUUID } from 'node:crypto';
      const [ledgerPath, entryId] = process.argv.slice(2);
      const lockPath = ledgerPath + '.lock';
      const token = randomUUID();
      let handle;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          handle = await open(lockPath, 'wx', 0o600);
          await handle.writeFile(JSON.stringify({ pid: process.pid, token }) + '\\n');
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      if (!handle) throw new Error('legacy fixture lock timed out');
      try {
        const state = JSON.parse(await readFile(ledgerPath, 'utf8'));
        const entry = state.entries.find(value => value.id === entryId);
        if (!entry || entry.status !== 'active') throw new Error('legacy fixture cannot find active v1 owner');
        const heartbeatAt = new Date().toISOString();
        entry.heartbeatAt = heartbeatAt;
        entry.lease = { state: 'healthy', ownerConfirmationRequired: false, takeoverAllowed: false,
          lastHeartbeatAt: heartbeatAt, expiresAt: new Date(Date.parse(heartbeatAt) + 90000).toISOString() };
        entry.legacyFixtureMetadata = { writer: 'bounded-v1-client', retained: true };
        const temporary = ledgerPath + '.' + process.pid + '.' + token + '.tmp';
        await writeFile(temporary, JSON.stringify(state, null, 2) + '\\n', { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, ledgerPath);
      } finally {
        await handle.close();
        const owner = JSON.parse(await readFile(lockPath, 'utf8'));
        if (owner.token === token) await unlink(lockPath);
      }
    `);
    const legacyResult = spawnSync(process.execPath, [legacyClientPath, ledgerPath, entry.id], {
      cwd: project, encoding: 'utf8',
    });
    assert.equal(legacyResult.status, 0, legacyResult.stderr);

    const currentView = command(['status', '--file', ledgerPath], project);
    assert.equal(currentView.status, 0, currentView.stderr);
    const state = JSON.parse(currentView.stdout).state;
    assert.equal(state.version, 1);
    assert.equal(state.entries[0].id, entry.id);
    assert.equal(state.entries[0].status, 'active');
    assert.deepEqual(state.entries[0].resources, ['legacy-owned-resource']);
    assert.deepEqual(state.entries[0].legacyFixtureMetadata, { writer: 'bounded-v1-client', retained: true });
    assert.deepEqual(state.entries[0].lease, {
      state: 'healthy', ownerConfirmationRequired: false, takeoverAllowed: false,
      lastHeartbeatAt: state.entries[0].heartbeatAt,
      expiresAt: new Date(Date.parse(state.entries[0].heartbeatAt) + 90_000).toISOString(),
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('same-owner explicit resume checkpoint preserves inherited override without claiming the saved checkpoint was checked', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-checkpoint-override-'));
  try {
    const project = createProject(join(fixture, 'project'), 'work/checkpoint');
    const ledger = join(fixture, 'ledger.json');
    const begin = command(['begin', '--file', ledger, '--work-type', 'tooling'], project);
    assert.equal(begin.status, 0, begin.stderr);
    const entry = JSON.parse(begin.stdout);
    const saved = git(project, 'rev-parse', 'HEAD');
    const park = command(['park', '--file', ledger, '--id', entry.id, '--checkpoint-sha', saved, '--next-action', 'Retain original next action.'], project);
    assert.equal(park.status, 0, park.stderr);
    const parked = JSON.parse(park.stdout);
    writeFileSync(join(project, 'README.md'), 'advanced owner checkpoint\n');
    git(project, 'add', 'README.md'); git(project, 'commit', '--quiet', '-m', 'owner advanced checkpoint');
    const current = git(project, 'rev-parse', 'HEAD');
    const before = readFileSync(ledger, 'utf8');
    const defaultResume = command(['resume', '--file', ledger, '--id', entry.id], project);
    assert.notEqual(defaultResume.status, 0, 'default resume validates the saved SHA');
    assert.equal(readFileSync(ledger, 'utf8'), before);
    const override = command(['resume', '--file', ledger, '--id', entry.id, '--checkpoint-sha', current], project);
    assert.equal(override.status, 0, override.stderr);
    const resumed = JSON.parse(override.stdout);
    assert.equal(resumed.id, parked.id);
    assert.equal(resumed.worktree, parked.worktree);
    assert.equal(resumed.branchName, parked.branchName);
    assert.equal(resumed.parked.checkpointSha, saved, 'override does not rewrite old checkpoint evidence');
    assert.equal(resumed.parked.nextAction, parked.parked.nextAction);
    assert.equal(resumed.status, 'active');
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('begin uses actual Git worktree identity and preserves legacy active or parked alias owners', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'chain-coordination-worktree-alias-'));
  try {
    const project = createProject(join(fixture, 'project'), 'work/aliases');
    const subdirectory = join(project, 'nested'); mkdirSync(subdirectory);
    const ledger = join(fixture, 'ledger.json');
    const fromSubdirectory = command(['begin', '--file', ledger, '--work-type', 'tooling'], subdirectory);
    assert.notEqual(fromSubdirectory.status, 0, 'new entries must begin at the actual Git worktree root');
    assert.match(fromSubdirectory.stderr, /worktree root/i);
    const began = command(['begin', '--file', ledger, '--work-type', 'tooling'], project);
    assert.equal(began.status, 0, began.stderr);
    const state = JSON.parse(readFileSync(ledger, 'utf8'));
    const alias = join(fixture, 'project-alias'); symlinkSync(project, alias, 'dir');
    for (const ownerPath of [subdirectory, alias]) for (const status of ['active', 'parked']) {
      const seeded = structuredClone(state);
      seeded.entries[0].worktree = ownerPath;
      seeded.entries[0].status = status;
      seeded.entries[0].parked = { checkpointSha: git(project, 'rev-parse', 'HEAD'), nextAction: 'Legacy owner keeps this path.' };
      seeded.entries[0].customLegacyMetadata = { retained: true };
      writeFileSync(ledger, JSON.stringify(seeded));
      const before = readFileSync(ledger, 'utf8');
      const duplicate = command(['begin', '--file', ledger, '--work-type', 'tooling'], project);
      assert.notEqual(duplicate.status, 0, `${status} ${ownerPath}: alias cannot create a duplicate owner`);
      assert.match(duplicate.stderr, /already exists|same.*worktree/i);
      assert.equal(readFileSync(ledger, 'utf8'), before, 'legacy recorded paths and ownership stay byte-for-byte intact');
    }
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
