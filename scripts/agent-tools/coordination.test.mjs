import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
