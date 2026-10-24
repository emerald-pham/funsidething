import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const command = fileURLToPath(new URL('./checkpoint.mjs', import.meta.url));

function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function createSourceFixture(t) {
  const root = path.join(os.tmpdir(), `checkpoint-create-${process.pid}-${Date.now()}`);
  const repo = path.join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(repo, 'init', '--quiet');
  git(repo, 'config', 'user.name', 'Checkpoint Fixture');
  git(repo, 'config', 'user.email', 'checkpoint@example.test');
  writeFileSync(path.join(repo, 'source.txt'), 'release source base\n');
  git(repo, 'add', 'source.txt');
  git(repo, 'commit', '--quiet', '-m', 'fixture base');
  const base = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(path.join(repo, 'source.txt'), 'release source candidate\n');
  git(repo, 'commit', '--quiet', '-am', 'fixture candidate');
  const commit = git(repo, 'rev-parse', 'HEAD');
  const tree = git(repo, 'rev-parse', 'HEAD^{tree}');
  const evidencePath = path.join(root, 'candidate-evidence.json');
  const evidenceBytes = Buffer.from('{"outcome":"passed","source":"fixture"}\n');
  writeFileSync(evidencePath, evidenceBytes);
  const record = {
    schemaVersion: 1,
    id: 'fixture-checkpoint',
    revision: 1,
    source: { commit, tree, base },
    status: 'complete',
    requiredGates: [{
      id: 'release-proof',
      status: 'passed',
      summary: 'The exact candidate release proof is present.',
      evidence: [{
        id: 'release-proof-output',
        path: evidencePath,
        sha256: createHash('sha256').update(evidenceBytes).digest('hex'),
        sourceCommit: commit,
        sourceTree: tree,
      }],
    }],
    followUps: [{
      id: 'physical-230',
      status: 'unverified',
      summary: 'Physical/private follow-up for issue 230 remains unverified.',
      evidence: [],
    }],
    nextAction: null,
  };
  const inputPath = path.join(root, 'checkpoint-input.json');
  writeFileSync(inputPath, `${JSON.stringify(record, null, 2)}\n`);
  return { root, repo, record, inputPath };
}

function invokeCreate(fixture, recordPath = path.join(fixture.root, 'checkpoint.json')) {
  return spawnSync(process.execPath, [
    command, 'create', '--repo', fixture.repo, '--record', recordPath, '--input', fixture.inputPath,
  ], { cwd: fixture.repo, encoding: 'utf8', timeout: 15000 });
}

function invokeResume(fixture, previousPath, recordPath, inputPath) {
  return spawnSync(process.execPath, [
    command, 'resume', '--repo', fixture.repo, '--previous', previousPath, '--record', recordPath, '--input', inputPath,
  ], { cwd: fixture.repo, encoding: 'utf8', timeout: 15000 });
}

function invokeValidate(fixture, recordPath) {
  return spawnSync(process.execPath, [
    command, 'validate', '--repo', fixture.repo, '--record', recordPath,
  ], { cwd: fixture.repo, encoding: 'utf8', timeout: 15000 });
}

test('creates a complete checkpoint while retaining a separately unverified follow-up', (t) => {
  const fixture = createSourceFixture(t);
  const recordPath = path.join(fixture.root, 'checkpoint.json');
  const result = invokeCreate(fixture, recordPath);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(recordPath), 'the command should atomically persist a validated checkpoint record');
  const saved = JSON.parse(readFileSync(recordPath, 'utf8'));
  assert.equal(saved.status, 'complete');
  assert.equal(saved.requiredGates[0].status, 'passed');
  assert.equal(saved.followUps[0].id, 'physical-230');
  assert.equal(saved.followUps[0].status, 'unverified');
  assert.equal(saved.nextAction, null);
  const verified = invokeValidate(fixture, recordPath);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).status, 'complete');
});

test('rejects a completed checkpoint with an outstanding required gate', (t) => {
  const fixture = createSourceFixture(t);
  fixture.record.requiredGates[0].status = 'pending';
  fixture.record.requiredGates[0].evidence = [];
  writeFileSync(fixture.inputPath, `${JSON.stringify(fixture.record)}\n`);

  const result = invokeCreate(fixture);
  assert.notEqual(result.status, 0, 'an unpaid required gate must prevent completion');
  assert.match(result.stderr, /status does not match required-gate completion/);
  assert.equal(existsSync(path.join(fixture.root, 'checkpoint.json')), false);
});

test('rejects a passed gate whose evidence belongs to an older source', (t) => {
  const fixture = createSourceFixture(t);
  fixture.record.requiredGates[0].evidence[0].sourceCommit = fixture.record.source.base;
  fixture.record.requiredGates[0].evidence[0].sourceTree = git(fixture.repo, 'rev-parse', `${fixture.record.source.base}^{tree}`);
  writeFileSync(fixture.inputPath, `${JSON.stringify(fixture.record)}\n`);

  const result = invokeCreate(fixture);
  assert.notEqual(result.status, 0, 'stale-source evidence must not pass a current required gate');
  assert.match(result.stderr, /without evidence for the current source commit and tree/);
  assert.equal(existsSync(path.join(fixture.root, 'checkpoint.json')), false);
});

test('refuses a create collision without replacing the existing checkpoint', (t) => {
  const fixture = createSourceFixture(t);
  const recordPath = path.join(fixture.root, 'checkpoint.json');
  const first = invokeCreate(fixture, recordPath);
  assert.equal(first.status, 0, first.stderr);
  const priorBytes = readFileSync(recordPath);

  const second = invokeCreate(fixture, recordPath);
  assert.notEqual(second.status, 0, 'create must never replace a prior checkpoint');
  assert.deepEqual(readFileSync(recordPath), priorBytes);
});

test('rejects an oversized manifest before writing a checkpoint', (t) => {
  const fixture = createSourceFixture(t);
  writeFileSync(fixture.inputPath, `${' '.repeat(32 * 1024)}{}`);
  const recordPath = path.join(fixture.root, 'checkpoint.json');

  const result = invokeCreate(fixture, recordPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exceeds the 32768-byte limit/);
  assert.equal(existsSync(recordPath), false);
});

test('resumes into a new revision while preserving the prior checkpoint and its failed evidence', (t) => {
  const fixture = createSourceFixture(t);
  const gate = fixture.record.requiredGates[0];
  const oldEvidence = gate.evidence[0];
  const oldEvidenceBytes = Buffer.from('{"outcome":"failed","source":"earlier-attempt"}\n');
  writeFileSync(oldEvidence.path, oldEvidenceBytes);
  oldEvidence.sha256 = createHash('sha256').update(oldEvidenceBytes).digest('hex');
  oldEvidence.sourceCommit = fixture.record.source.base;
  oldEvidence.sourceTree = git(fixture.repo, 'rev-parse', `${fixture.record.source.base}^{tree}`);
  gate.status = 'failed';
  fixture.record.status = 'open';
  fixture.record.nextAction = { gateId: gate.id, summary: 'Collect the exact current-source release proof.' };
  writeFileSync(fixture.inputPath, `${JSON.stringify(fixture.record, null, 2)}\n`);
  const previousPath = path.join(fixture.root, 'checkpoint-v1.json');
  const created = invokeCreate(fixture, previousPath);
  assert.equal(created.status, 0, created.stderr);
  const previousBytes = readFileSync(previousPath);

  const resumed = structuredClone(fixture.record);
  resumed.revision = 2;
  resumed.status = 'complete';
  resumed.nextAction = null;
  resumed.requiredGates[0].status = 'passed';
  resumed.requiredGates[0].summary = 'The exact current-source release proof passed.';
  const currentEvidencePath = path.join(fixture.root, 'current-release-proof.json');
  const currentEvidenceBytes = Buffer.from('{"outcome":"passed","source":"current-candidate"}\n');
  writeFileSync(currentEvidencePath, currentEvidenceBytes);
  resumed.requiredGates[0].evidence.push({
    id: 'release-proof-retry',
    path: currentEvidencePath,
    sha256: createHash('sha256').update(currentEvidenceBytes).digest('hex'),
    sourceCommit: resumed.source.commit,
    sourceTree: resumed.source.tree,
  });
  const resumedInputPath = path.join(fixture.root, 'checkpoint-resume-input.json');
  writeFileSync(resumedInputPath, `${JSON.stringify(resumed, null, 2)}\n`);
  const resumedPath = path.join(fixture.root, 'checkpoint-v2.json');

  const result = invokeResume(fixture, previousPath, resumedPath, resumedInputPath);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(previousPath), previousBytes, 'resume must leave the previous checkpoint byte-for-byte intact');
  assert.ok(existsSync(resumedPath));
  const saved = JSON.parse(readFileSync(resumedPath, 'utf8'));
  assert.equal(saved.id, fixture.record.id);
  assert.equal(saved.revision, 2);
  assert.equal(saved.status, 'complete');
  assert.deepEqual(saved.requiredGates[0].evidence[0], oldEvidence, 'the original failed evidence pointer remains unchanged');
  assert.equal(saved.requiredGates[0].evidence[1].id, 'release-proof-retry');
  assert.equal(saved.followUps[0].id, 'physical-230');
  assert.equal(saved.followUps[0].status, 'unverified');
});

test('resume keeps failed evidence attached to its original required gate', (t) => {
  const fixture = createSourceFixture(t);
  const gate = fixture.record.requiredGates[0];
  const historical = gate.evidence[0];
  const historicalBytes = Buffer.from('{"outcome":"failed","source":"earlier-attempt"}\n');
  writeFileSync(historical.path, historicalBytes);
  historical.sha256 = createHash('sha256').update(historicalBytes).digest('hex');
  historical.sourceCommit = fixture.record.source.base;
  historical.sourceTree = git(fixture.repo, 'rev-parse', `${fixture.record.source.base}^{tree}`);
  gate.status = 'failed';
  fixture.record.status = 'open';
  fixture.record.nextAction = { gateId: gate.id, summary: 'Collect the exact current-source release proof.' };
  writeFileSync(fixture.inputPath, `${JSON.stringify(fixture.record, null, 2)}\n`);
  const previousPath = path.join(fixture.root, 'checkpoint-v1.json');
  const created = invokeCreate(fixture, previousPath);
  assert.equal(created.status, 0, created.stderr);
  const previousBytes = readFileSync(previousPath);

  const resumed = structuredClone(fixture.record);
  resumed.revision = 2;
  resumed.status = 'complete';
  resumed.nextAction = null;
  resumed.requiredGates[0].status = 'passed';
  const currentEvidencePath = path.join(fixture.root, 'current-release-proof.json');
  const currentEvidenceBytes = Buffer.from('{"outcome":"passed","source":"current-candidate"}\n');
  writeFileSync(currentEvidencePath, currentEvidenceBytes);
  resumed.requiredGates[0].evidence = [{
    id: 'release-proof-retry',
    path: currentEvidencePath,
    sha256: createHash('sha256').update(currentEvidenceBytes).digest('hex'),
    sourceCommit: resumed.source.commit,
    sourceTree: resumed.source.tree,
  }];
  resumed.followUps[0].evidence = [historical];
  const resumedInputPath = path.join(fixture.root, 'checkpoint-resume-input.json');
  writeFileSync(resumedInputPath, `${JSON.stringify(resumed, null, 2)}\n`);
  const resumedPath = path.join(fixture.root, 'checkpoint-v2.json');

  const result = invokeResume(fixture, previousPath, resumedPath, resumedInputPath);
  assert.notEqual(result.status, 0, 'resume must preserve the gate that owns prior failed evidence');
  assert.match(result.stderr, /keep immutable evidence pointer release-proof-output under its original required gate/);
  assert.equal(existsSync(resumedPath), false);
  assert.deepEqual(readFileSync(previousPath), previousBytes);
});
