import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const node = process.execPath;
const recorder = fileURLToPath(new URL('./record-run.mjs', import.meta.url));

async function createCommittedRepository(root) {
  const repo = path.join(root, 'repo');
  await mkdir(path.join(repo, 'src'), { recursive: true });
  const init = spawnSync('git', ['-C', repo, 'init', '--quiet'], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  await writeFile(path.join(repo, 'src', 'app.js'), 'export const value = 1;\n');
  for (const [key, value] of [['user.name', 'Recorder Fixture'], ['user.email', 'recorder@example.test']]) {
    const result = spawnSync('git', ['-C', repo, 'config', key, value], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const add = spawnSync('git', ['-C', repo, 'add', 'src/app.js'], { encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
  const commit = spawnSync('git', ['-C', repo, 'commit', '--quiet', '-m', 'fixture'], { encoding: 'utf8' });
  assert.equal(commit.status, 0, commit.stderr);
  return repo;
}

function invokeRecorder({ repo, evidence, purpose, command, args = [], extraOptions = [], env: overrides = {} }) {
  const env = { ...process.env, ...overrides };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(node, [recorder, '--repo', repo, '--evidence-dir', evidence, '--purpose', purpose, ...extraOptions, '--', command, ...args], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 15000,
    env,
  });
}

async function createQualificationFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'record-run-qualification-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = await createCommittedRepository(root);
  const commit = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const tree = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' });
  assert.equal(commit.status, 0, commit.stderr);
  assert.equal(tree.status, 0, tree.stderr);
  const deliveryPort = 51631;
  const smokePort = 51632;
  const ledger = path.join(root, 'coordination.json');
  const resources = [`loopback:127.0.0.1:${deliveryPort}`, `loopback:127.0.0.1:${smokePort}`];
  await writeFile(ledger, JSON.stringify({ version: 1, scope: 'codex-wide', entries: [{ id: 'fixture-owner', status: 'active', worktree: repo, resources }] }));
  return {
    root,
    repo,
    commit: commit.stdout.trim(),
    tree: tree.stdout.trim(),
    evidence: path.join(root, 'recorder-evidence'),
    nativeOutput: path.join(root, 'native-output'),
    sentinel: path.join(root, 'expensive-child-launched'),
    ledger,
    deliveryPort,
    smokePort,
    env: {
      CI: '',
      CODEX_COORDINATION_FILE: ledger,
      DOW_EMULATOR_COORDINATION_FILE: '',
      CHAIN_NATIVE_CANDIDATE_SHA: commit.stdout.trim(),
      CHAIN_NATIVE_CANDIDATE_TREE: tree.stdout.trim(),
      CHAIN_NATIVE_OUTPUT: path.join(root, 'native-output'),
      CHAIN_NATIVE_PORT: String(deliveryPort),
      CHAIN_NATIVE_SMOKE_PORT: String(smokePort),
      CHAIN_QUALIFICATION_READINESS_SENTINEL: path.join(root, 'expensive-child-launched'),
    },
  };
}

function evidencePathFrom(result) {
  const line = result.stderr.split('\n').find((entry) => entry.startsWith('record-run: evidence='));
  assert.ok(line, `expected a durable evidence path in stderr; got ${result.stderr}`);
  return line.slice('record-run: evidence='.length);
}

function summaryFrom(result) {
  assert.equal(result.stderr, '', `summary mode should not print child streams or setup chatter to stderr: ${result.stderr.slice(0, 300)}`);
  const lines = result.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 1, `expected one JSON summary line, got ${lines.length} lines`);
  return JSON.parse(lines[0]);
}

test('qualification readiness creates evidence destinations and launches the requested child', async (t) => {
  const fixture = await createQualificationFixture(t);
  const result = invokeRecorder({
    repo: fixture.repo,
    evidence: fixture.evidence,
    purpose: 'green',
    command: node,
    args: ['-e', "require('node:fs').writeFileSync(process.env.CHAIN_QUALIFICATION_READINESS_SENTINEL, 'launched')"],
    extraOptions: ['--qualification-readiness', '--summary'],
    env: fixture.env,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = summaryFrom(result);
  assert.equal(summary.status, 'passed');
  assert.equal(await readFile(fixture.sentinel, 'utf8'), 'launched');
  assert.ok((await readdir(fixture.evidence)).length >= 3, 'recorder metadata and child streams are retained');
  assert.ok((await readdir(fixture.nativeOutput)).length === 0, 'readiness probes leave no files in the native evidence destination');
  const record = JSON.parse(await readFile(summary.evidence.metadataPath, 'utf8'));
  assert.equal(record.git.commit, fixture.commit);
});

async function assertQualificationSetupRejected(t, fixture, { env = {}, evidence = fixture.evidence, expectedError }) {
  const result = invokeRecorder({
    repo: fixture.repo,
    evidence,
    purpose: 'green',
    command: node,
    args: ['-e', "require('node:fs').writeFileSync(process.env.CHAIN_QUALIFICATION_READINESS_SENTINEL, 'launched')"],
    extraOptions: ['--qualification-readiness', '--summary'],
    env: { ...fixture.env, ...env },
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = summaryFrom(result);
  assert.equal(result.status, 74);
  assert.equal(summary.status, 'evidence-failure');
  assert.equal(summary.outcome, 'not-started');
  assert.deepEqual(summary.child, { exitCode: null, signal: null });
  assert.match(summary.evidence.errors[0].message, expectedError, `${result.stdout}\n${result.stderr}`);
  await assert.rejects(readFile(fixture.sentinel, 'utf8'), { code: 'ENOENT' }, 'the expensive child never starts on invalid setup');
}

test('qualification readiness rejects missing and stale committed candidate identity before launch', async (t) => {
  const missing = await createQualificationFixture(t);
  await assertQualificationSetupRejected(t, missing, {
    env: { CHAIN_NATIVE_CANDIDATE_SHA: '' },
    expectedError: /CHAIN_NATIVE_CANDIDATE_SHA/,
  });

  const staleSha = await createQualificationFixture(t);
  await assertQualificationSetupRejected(t, staleSha, {
    env: { CHAIN_NATIVE_CANDIDATE_SHA: '0'.repeat(40) },
    expectedError: /CHAIN_NATIVE_CANDIDATE_SHA/,
  });

  const stale = await createQualificationFixture(t);
  await assertQualificationSetupRejected(t, stale, {
    env: { CHAIN_NATIVE_CANDIDATE_TREE: '0'.repeat(40) },
    expectedError: /CHAIN_NATIVE_CANDIDATE_TREE/,
  });
});

test('qualification readiness requires distinct explicit local ports and rejects CI mode', async (t) => {
  const missing = await createQualificationFixture(t);
  await assertQualificationSetupRejected(t, missing, {
    env: { CI: '', CHAIN_NATIVE_PORT: '', CHAIN_NATIVE_SMOKE_PORT: '' },
    expectedError: /CHAIN_NATIVE_PORT/,
  });

  const missingSmoke = await createQualificationFixture(t);
  await assertQualificationSetupRejected(t, missingSmoke, {
    env: { CI: '', CHAIN_NATIVE_SMOKE_PORT: '' },
    expectedError: /CHAIN_NATIVE_SMOKE_PORT must be an explicit locally allocated TCP port/,
  });

  const same = await createQualificationFixture(t);
  await assertQualificationSetupRejected(t, same, {
    env: { CI: '', CHAIN_NATIVE_SMOKE_PORT: String(same.deliveryPort) },
    expectedError: /must be distinct/,
  });

  const ciMode = await createQualificationFixture(t);
  await assertQualificationSetupRejected(t, ciMode, {
    env: { CI: 'true' },
    expectedError: /CI=true.*local qualification/,
  });
});

test('qualification readiness requires live host ownership for both native ports', async (t) => {
  const unowned = await createQualificationFixture(t);
  await writeFile(unowned.ledger, JSON.stringify({ version: 1, scope: 'codex-wide', entries: [{
    id: 'fixture-owner',
    status: 'active', worktree: unowned.repo, resources: [`loopback:127.0.0.1:${unowned.deliveryPort}`],
  }] }));
  await assertQualificationSetupRejected(t, unowned, { expectedError: /CHAIN_NATIVE_SMOKE_PORT.*active worktree/ });

  const conflict = await createQualificationFixture(t);
  await writeFile(conflict.ledger, JSON.stringify({ version: 1, scope: 'codex-wide', entries: [
    { id: 'fixture-owner', status: 'active', worktree: conflict.repo, resources: [`loopback:127.0.0.1:${conflict.deliveryPort}`, `loopback:127.0.0.1:${conflict.smokePort}`] },
    { id: 'other-owner', status: 'parked', worktree: path.join(conflict.root, 'other-repo'), resources: [`loopback:127.0.0.1:${conflict.smokePort}`] },
  ] }));
  await assertQualificationSetupRejected(t, conflict, { expectedError: /already owned by another active or parked worktree/ });
});

test('qualification readiness rejects dirty candidates and unusable evidence destinations before launch', async (t) => {
  const dirty = await createQualificationFixture(t);
  await writeFile(path.join(dirty.repo, 'untracked-test.js'), 'export const dirty = true;\n');
  await assertQualificationSetupRejected(t, dirty, { expectedError: /working tree .*clean/ });

  const unwritable = await createQualificationFixture(t);
  const evidenceFile = path.join(unwritable.root, 'evidence-file');
  await writeFile(evidenceFile, 'not a directory');
  await assertQualificationSetupRejected(t, unwritable, { evidence: evidenceFile, expectedError: /evidence destination.*directory|evidence destination.*writable/i });

  const nativeOutputFile = await createQualificationFixture(t);
  const outputFile = path.join(nativeOutputFile.root, 'native-output-file');
  await writeFile(outputFile, 'not a directory');
  await assertQualificationSetupRejected(t, nativeOutputFile, {
    env: { CHAIN_NATIVE_OUTPUT: outputFile },
    expectedError: /CHAIN_NATIVE_OUTPUT evidence destination.*directory|CHAIN_NATIVE_OUTPUT evidence destination.*writable/i,
  });

  const symlinkedOutput = await createQualificationFixture(t);
  const insideCheckout = path.join(symlinkedOutput.repo, 'qualification-output');
  const outputAlias = path.join(symlinkedOutput.root, 'native-output-alias');
  await symlink(insideCheckout, outputAlias);
  await assertQualificationSetupRejected(t, symlinkedOutput, {
    env: { CHAIN_NATIVE_OUTPUT: outputAlias },
    expectedError: /outside the candidate Git worktree|resolve|writable/,
  });
  await assert.rejects(stat(insideCheckout), { code: 'ENOENT' }, 'a broken output symlink cannot create evidence inside the candidate checkout');

  const overlapping = await createQualificationFixture(t);
  await assertQualificationSetupRejected(t, overlapping, {
    env: { CHAIN_NATIVE_OUTPUT: overlapping.evidence },
    expectedError: /separate, non-overlapping directories/,
  });
});

test('qualification readiness redacts setup failures in summary and default output without launching the child', async (t) => {
  for (const failure of ['recorder-evidence', 'native-output', 'missing-ledger']) {
    for (const summaryMode of [true, false]) {
      await t.test(`${failure} ${summaryMode ? 'summary' : 'default'}`, async (t) => {
        const fixture = await createQualificationFixture(t);
        const secret = 'PRIVATE-READINESS-REVIEW-275';
        const privatePath = path.join(fixture.root, secret);
        const blocker = 'preserve blocking file';
        const env = { ...fixture.env };
        let evidence = fixture.evidence;
        if (failure === 'missing-ledger') env.CODEX_COORDINATION_FILE = path.join(privatePath, 'ledger.json');
        else {
          await writeFile(privatePath, blocker);
          if (failure === 'recorder-evidence') evidence = privatePath;
          else env.CHAIN_NATIVE_OUTPUT = privatePath;
        }
        const result = invokeRecorder({
          repo: fixture.repo,
          evidence,
          purpose: 'green',
          command: node,
          args: ['-e', "require('node:fs').writeFileSync(process.env.CHAIN_QUALIFICATION_READINESS_SENTINEL, 'launched')"],
          extraOptions: ['--qualification-readiness', '--redact-pattern', secret, ...(summaryMode ? ['--summary'] : [])],
          env,
        });

        assert.equal(`${result.stdout}\n${result.stderr}`.includes(secret), false, 'readiness diagnostics must redact caller-configured private paths');
        await assert.rejects(readFile(fixture.sentinel, 'utf8'), { code: 'ENOENT' }, 'readiness failure leaves the expensive child unlaunched');
        if (failure !== 'missing-ledger') assert.equal(await readFile(privatePath, 'utf8'), blocker);
        if (summaryMode) {
          assert.equal(result.status, 74);
          const summary = summaryFrom(result);
          assert.equal(summary.status, 'evidence-failure');
          assert.equal(summary.outcome, 'not-started');
          assert.deepEqual(summary.child, { exitCode: null, signal: null });
          assert.equal(summary.source.commit, fixture.commit);
          assert.equal(summary.evidence.status, 'failed');
          assert.match(summary.evidence.errors[0].message, /\[REDACTED\]/);
          if (failure === 'recorder-evidence') {
            for (const field of ['metadataPath', 'stdoutPath', 'stderrPath']) assert.match(summary.evidence[field], /\[REDACTED\]/);
          }
        } else {
          assert.equal(result.status, 2);
          assert.equal(result.stdout, '');
          assert.match(result.stderr, /^record-run: .*\[REDACTED\]/);
        }
        if (failure !== 'recorder-evidence') {
          const files = await readdir(evidence).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
          assert.deepEqual(files, [], 'a refused qualification leaves no prepared or completed recorder evidence');
        }
      });
    }
  }
});

test('redacts evidence path metadata while retaining real files and child failure status', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-private-path-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const secret = 'PRIVATE-PATH-SECRET-72aa';
  const evidence = path.join(temp, secret, 'evidence');
  const result = invokeRecorder({ repo, evidence, purpose: 'green', command: node,
    args: ['-e', `process.stdout.write('${secret}\\n'); process.stderr.write('complete failure output\\n'); process.exitCode = 7;`],
    extraOptions: ['--summary', '--redact-pattern', secret],
  });
  assert.equal(result.status, 7, result.stderr);
  assert.equal(result.stdout.includes(secret), false, 'summary paths must follow configured redaction');
  const summary = summaryFrom(result);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.child.exitCode, 7);
  assert.equal(summary.evidence.status, 'complete');
  const files = await readdir(evidence);
  assert.equal(files.length, 3, 'all three complete evidence files exist at the actual caller-owned directory');
  const metadataName = files.find(file => file.endsWith('.json'));
  const serialized = await readFile(path.join(evidence, metadataName), 'utf8');
  assert.equal(serialized.includes(secret), false, 'persisted path metadata must also follow configured redaction');
  const record = JSON.parse(serialized);
  assert.deepEqual(record.evidence, summary.evidence);
  for (const field of ['metadataPath', 'stdoutPath', 'stderrPath']) {
    assert.ok(record.evidence[field].includes('[REDACTED]'), field + ' is a sanitized display path');
    assert.ok(record.redaction.locations['evidence.' + field] > 0, field + ' redaction is accounted for');
  }
  assert.equal(record.execution.output.stdout, '[REDACTED]\n');
  assert.equal(record.execution.output.stderr, 'complete failure output\n');
  assert.equal(await readFile(path.join(evidence, `${record.id}.stdout.txt`), 'utf8'), record.execution.output.stdout);
  assert.equal(await readFile(path.join(evidence, `${record.id}.stderr.txt`), 'utf8'), record.execution.output.stderr);

  const blockedEvidence = path.join(temp, secret, 'blocked');
  await writeFile(blockedEvidence, 'preserve blocking file');
  const refused = invokeRecorder({ repo, evidence: blockedEvidence, purpose: 'green', command: node,
    args: ['-e', "process.exitCode = 0"], extraOptions: ['--summary', '--redact-pattern', secret] });
  assert.equal(refused.status, 74);
  assert.equal(refused.stdout.includes(secret), false, 'preparation failures also redact displayed evidence paths');
  assert.equal(summaryFrom(refused).status, 'evidence-failure');
  assert.equal(await readFile(blockedEvidence, 'utf8'), 'preserve blocking file');

  const ordinaryEvidence = path.join(temp, secret, 'ordinary');
  const ordinary = invokeRecorder({ repo, evidence: ordinaryEvidence, purpose: 'green', command: node,
    args: ['-e', "process.stdout.write('ordinary complete output\\n')"], extraOptions: ['--redact-pattern', secret] });
  assert.equal(ordinary.status, 0);
  assert.equal(ordinary.stdout, 'ordinary complete output\n', 'default child output remains unchanged');
  assert.equal(ordinary.stderr.includes(secret), false, 'default evidence path announcements also follow redaction');
  assert.match(evidencePathFrom(ordinary), /\[REDACTED\]/);
  assert.equal((await readdir(ordinaryEvidence)).length, 1, 'ordinary evidence still exists in the actual caller-owned directory');
});

test('summarizes large real child output while preserving complete redacted evidence and source identity', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-summary-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const stdoutSecret = 'SUMMARY-STDOUT-SECRET-72a9';
  const stderrSecret = 'SUMMARY-STDERR-SECRET-18cf';
  // Generate the large streams in the child: a large literal can exceed Linux's
  // per-argument exec limit before the recorder can start.
  const child = `process.stdout.write('O'.repeat(256 * 1024) + ' password=${stdoutSecret}\\n'); process.stderr.write('E'.repeat(128 * 1024) + ' token=${stderrSecret}\\n');`;

  const result = invokeRecorder({
    repo,
    evidence,
    purpose: 'green',
    command: node,
    args: ['-e', child],
    extraOptions: ['--summary'],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) < 2048, 'console output must stay bounded as child output grows');
  assert.equal(result.stdout.includes(stdoutSecret), false);
  assert.equal(result.stdout.includes(stderrSecret), false);
  const summary = summaryFrom(result);
  assert.equal(summary.status, 'passed');
  assert.equal(summary.purpose, 'green');
  assert.deepEqual(summary.child, { exitCode: 0, signal: null });
  assert.equal(summary.source.commit, spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim());
  assert.equal(summary.source.identityStatus, 'complete');
  assert.match(summary.source.diffSha256, /^[a-f0-9]{64}$/);
  assert.equal(summary.evidence.status, 'complete');

  const recordPath = summary.evidence.metadataPath;
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  const stdoutPath = path.join(evidence, `${record.id}.stdout.txt`);
  const stderrPath = path.join(evidence, `${record.id}.stderr.txt`);
  assert.equal(summary.evidence.stdoutPath, stdoutPath);
  assert.equal(summary.evidence.stderrPath, stderrPath);
  assert.equal(record.execution.outcome, 'passed');
  assert.equal(record.execution.exitCode, 0);
  assert.equal(record.workingTree.sourceTestDiffSha256, summary.source.diffSha256);
  assert.equal(record.execution.output.stdout, `${'O'.repeat(256 * 1024)} password=[REDACTED]\n`);
  assert.equal(record.execution.output.stderr, `${'E'.repeat(128 * 1024)} token=[REDACTED]\n`);
  assert.equal(await readFile(stdoutPath, 'utf8'), record.execution.output.stdout);
  assert.equal(await readFile(stderrPath, 'utf8'), record.execution.output.stderr);
  const serialized = await readFile(recordPath, 'utf8');
  assert.equal(serialized.includes(stdoutSecret), false);
  assert.equal(serialized.includes(stderrSecret), false);
  assert.equal((await readFile(stdoutPath, 'utf8')).includes(stdoutSecret), false);
  assert.equal((await readFile(stderrPath, 'utf8')).includes(stderrSecret), false);
});

test('keeps a failed child nonzero and reports its actual exit in the summary', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-summary-failure-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const secret = 'SUMMARY-FAILURE-SECRET-309b';
  const child = `process.stderr.write("AssertionError: expected failure password=${secret}\\n"); process.exitCode = 7;`;

  const result = invokeRecorder({
    repo,
    evidence,
    purpose: 'preimplementation-red',
    command: node,
    args: ['-e', child],
    extraOptions: ['--summary'],
  });

  assert.equal(result.status, 7);
  const summary = summaryFrom(result);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.outcome, 'assertion-failure');
  assert.equal(summary.purpose, 'preimplementation-red');
  assert.deepEqual(summary.child, { exitCode: 7, signal: null });
  assert.equal(summary.wrapperExitCode, 7);
  assert.equal(summary.evidence.status, 'complete');
  const record = JSON.parse(await readFile(summary.evidence.metadataPath, 'utf8'));
  assert.equal(record.execution.output.stderr, `AssertionError: expected failure password=[REDACTED]\n`);
  assert.equal(await readFile(summary.evidence.stderrPath, 'utf8'), record.execution.output.stderr);
  assert.equal((await readFile(summary.evidence.metadataPath, 'utf8')).includes(secret), false);
});

test('reports a child signal as interruption while preserving its incomplete evidence', { skip: process.platform === 'win32' }, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-summary-signal-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const result = invokeRecorder({
    repo,
    evidence,
    purpose: 'green',
    command: node,
    args: ['-e', 'process.stdout.write("before-summary-signal"); process.kill(process.pid, "SIGTERM");'],
    extraOptions: ['--summary'],
  });

  assert.equal(result.status, 143, result.stderr);
  const summary = summaryFrom(result);
  assert.equal(summary.status, 'interrupted');
  assert.equal(summary.outcome, 'interrupted');
  assert.deepEqual(summary.child, { exitCode: null, signal: 'SIGTERM' });
  assert.equal(summary.wrapperExitCode, 143);
  assert.equal(summary.evidence.status, 'complete');
  const record = JSON.parse(await readFile(summary.evidence.metadataPath, 'utf8'));
  assert.equal(record.state, 'incomplete');
  assert.equal(record.interruption.source, 'child-process');
  assert.equal(record.execution.wrapperExitCode, 143);
  assert.equal(await readFile(summary.evidence.stdoutPath, 'utf8'), 'before-summary-signal');
});

test('returns failure when a full output evidence file cannot be written', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-summary-evidence-failure-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const secret = 'SUMMARY-EVIDENCE-SECRET-4c0e';
  const child = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    `const evidence = ${JSON.stringify(evidence)};`,
    'const metadataName = fs.readdirSync(evidence).find((name) => name.endsWith(".json"));',
    'const stdoutPath = path.join(evidence, metadataName.replace(/\\.json$/, ".stdout.txt"));',
    'fs.mkdirSync(stdoutPath);',
    `process.stdout.write("password=${secret}\\n");`,
    'process.stderr.write("child reached evidence collision\\n");',
  ].join('\n');

  const result = invokeRecorder({
    repo,
    evidence,
    purpose: 'green',
    command: node,
    args: ['-e', child],
    extraOptions: ['--summary'],
  });

  assert.equal(result.status, 74, result.stderr);
  const summary = summaryFrom(result);
  assert.equal(summary.status, 'evidence-failure');
  assert.equal(summary.outcome, 'passed');
  assert.deepEqual(summary.child, { exitCode: 0, signal: null });
  assert.equal(summary.wrapperExitCode, 74);
  assert.equal(summary.evidence.status, 'failed');
  assert.deepEqual(summary.evidence.errors.map((entry) => entry.file), ['stdout']);
  const metadata = await readFile(summary.evidence.metadataPath, 'utf8');
  const record = JSON.parse(metadata);
  assert.equal(record.execution.output.stdout, 'password=[REDACTED]\n');
  assert.equal(record.execution.output.stderr, 'child reached evidence collision\n');
  assert.equal(record.execution.wrapperExitCode, 74);
  assert.equal(record.evidence.status, 'failed');
  assert.equal(metadata.includes(secret), false);
  assert.ok((await readFile(summary.evidence.stderrPath, 'utf8')).includes('child reached evidence collision'));
});

test('keeps summary corrections in new immutable attempts', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-summary-correction-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const originalResult = invokeRecorder({
    repo,
    evidence,
    purpose: 'preimplementation-red',
    command: node,
    args: ['-e', 'process.stdout.write("original-red"); process.exitCode = 1;'],
    extraOptions: ['--summary'],
  });
  assert.equal(originalResult.status, 1);
  const originalSummary = summaryFrom(originalResult);
  const originalPath = originalSummary.evidence.metadataPath;
  const originalBytes = await readFile(originalPath);
  const original = JSON.parse(originalBytes.toString('utf8'));
  const note = 'This later check corrects the record without changing original RED evidence.';

  const correctionResult = invokeRecorder({
    repo,
    evidence,
    purpose: 'later-baseline-sensitivity',
    command: node,
    args: ['-e', 'process.stdout.write("corrected-attempt");'],
    extraOptions: ['--summary', '--correction-of', original.id, '--correction-note', note],
  });

  assert.equal(correctionResult.status, 0, correctionResult.stderr);
  const correctionSummary = summaryFrom(correctionResult);
  const correctionPath = correctionSummary.evidence.metadataPath;
  const correction = JSON.parse(await readFile(correctionPath, 'utf8'));
  assert.notEqual(correctionPath, originalPath);
  assert.deepEqual(await readFile(originalPath), originalBytes);
  assert.equal(correction.correction.originalRecordId, original.id);
  assert.equal(correction.correction.note, note);
  assert.equal(correction.declaredPurpose, 'later-baseline-sensitivity');
  assert.equal(await readFile(correctionSummary.evidence.stdoutPath, 'utf8'), 'corrected-attempt');
});

test('records the real child command, exit, output and source identity at the command boundary', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-core-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const baseRepo = await createCommittedRepository(temp);
  const repo = path.join(temp, 'disposable-worktree');
  const addWorktree = spawnSync('git', ['-C', baseRepo, 'worktree', 'add', '--quiet', '-b', 'agent-record-run-fixture', repo, 'HEAD'], { encoding: 'utf8' });
  assert.equal(addWorktree.status, 0, addWorktree.stderr);
  const evidence = path.join(baseRepo, '.git', 'agent-evidence');
  const child = 'process.stdout.write("child-output"); process.stderr.write("child-warning");';

  const result = invokeRecorder({ repo, evidence, purpose: 'green', command: node, args: ['-e', child] });
  assert.equal(result.status, 0, result.stderr);
  const recordPath = evidencePathFrom(result);
  const record = JSON.parse(await readFile(recordPath, 'utf8'));

  assert.equal(record.declaredPurpose, 'green');
  assert.equal(record.execution.exitCode, 0);
  assert.equal(record.execution.wrapperExitCode, 0);
  assert.equal(record.execution.outcome, 'passed');
  assert.equal(record.execution.output.stdout, 'child-output');
  assert.equal(record.execution.output.stderr, 'child-warning');
  assert.deepEqual(record.command, { executable: node, args: ['-e', child] });
  assert.equal(record.workingDirectory, repo);
  assert.equal(record.git.commit, spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim());
  assert.match(record.preparedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.match(record.startedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.match(record.finishedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.ok(Date.parse(record.startedAt) >= Date.parse(record.preparedAt));
  assert.ok(Date.parse(record.finishedAt) >= Date.parse(record.startedAt));
  assert.match(record.execution.outputSha256, /^[a-f0-9]{64}$/);
  assert.equal(record.execution.outputSha256, createHash('sha256').update(JSON.stringify(record.execution.output)).digest('hex'));
  assert.match(record.workingTree.sourceTestDiffSha256, /^[a-f0-9]{64}$/);
  const removeWorktree = spawnSync('git', ['-C', baseRepo, 'worktree', 'remove', repo], { encoding: 'utf8' });
  assert.equal(removeWorktree.status, 0, removeWorktree.stderr);
  assert.equal(JSON.parse(await readFile(recordPath, 'utf8')).id, record.id);
});

test('captures dirty tracked and untracked source/test content with secrets redacted before persistence', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-dirty-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const trackedSecret = 'tracked-password-value-71d2';
  const untrackedSecret = 'untracked-token-value-38af';
  const outputSecret = 'runtime-access-token-value-44bc';
  await writeFile(path.join(repo, 'src', 'app.js'), `export const password = "${trackedSecret}";\n`);
  await mkdir(path.join(repo, 'tests'), { recursive: true });
  await writeFile(path.join(repo, 'tests', 'fixture.test.mjs'), `export const GITHUB_TOKEN = "${untrackedSecret}";\n`);

  const child = `process.stdout.write("access_token=${outputSecret}")`;
  const result = invokeRecorder({ repo, evidence, purpose: 'later-baseline-sensitivity', command: node, args: ['-e', child] });
  assert.equal(result.status, 0, result.stderr);
  const recordPath = evidencePathFrom(result);
  const serialized = await readFile(recordPath, 'utf8');
  const record = JSON.parse(serialized);

  assert.ok(Array.isArray(record.workingTree?.sourceTestFiles), 'expected dirty source/test content in the durable record');
  const tracked = record.workingTree.sourceTestFiles.find((file) => file.path === 'src/app.js');
  const untracked = record.workingTree.sourceTestFiles.find((file) => file.path === 'tests/fixture.test.mjs');
  assert.equal(tracked.status, 'modified');
  assert.equal(untracked.status, 'untracked');
  assert.match(tracked.sha256, /^[a-f0-9]{64}$/);
  assert.match(untracked.sha256, /^[a-f0-9]{64}$/);
  assert.match(tracked.content, /password = \[REDACTED\]/);
  assert.match(untracked.content, /GITHUB_TOKEN = \[REDACTED\]/);
  assert.match(record.execution.output.stdout, /^access_token=\[REDACTED\]$/);
  assert.ok(record.redaction.applied);
  for (const secret of [trackedSecret, untrackedSecret, outputSecret]) assert.equal(serialized.includes(secret), false);
});

test('applies caller redaction patterns and removes complete quoted and separate-argument secrets', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-redaction-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const customSecret = 'PRIVATE-SOURCE-93A1';
  const quotedSecret = 'quoted credential phrase 72cc';
  const separateArgumentSecret = 'separate credential phrase 6ad0';
  await writeFile(path.join(repo, 'src', 'custom.js'), `export const value = "${customSecret}";\n`);
  const child = `process.stdout.write("password=\\\"${quotedSecret}\\\"; PRIVATE-OUTPUT-42F8")`;
  const result = invokeRecorder({
    repo,
    evidence,
    purpose: 'green',
    command: node,
    args: ['-e', child, '--', '--token', separateArgumentSecret],
    extraOptions: ['--redact-pattern', 'PRIVATE-[A-Z0-9-]+'],
  });
  assert.equal(result.status, 0, result.stderr);
  const serialized = await readFile(evidencePathFrom(result), 'utf8');
  const record = JSON.parse(serialized);

  assert.equal(serialized.includes(customSecret), false);
  assert.equal(serialized.includes('PRIVATE-OUTPUT-42F8'), false);
  assert.equal(serialized.includes(quotedSecret), false);
  assert.equal(serialized.includes(separateArgumentSecret), false);
  assert.equal(record.command.args.at(-2), '--token');
  assert.equal(record.command.args.at(-1), '[REDACTED]');
  assert.ok(record.redaction.applied);
  assert.ok(record.redaction.locations['command.args[4]'] > 0);
});

test('adds an explicit correction as a new attempt while preserving the original record byte-for-byte', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-correction-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const originalRun = invokeRecorder({
    repo,
    evidence,
    purpose: 'preimplementation-red',
    command: node,
    args: ['-e', 'process.stderr.write("not ok 1 - expected failure"); process.exitCode = 1;'],
  });
  assert.equal(originalRun.status, 1, originalRun.stderr);
  const originalPath = evidencePathFrom(originalRun);
  const originalBytes = await readFile(originalPath);
  const original = JSON.parse(originalBytes.toString('utf8'));

  const correctionRun = invokeRecorder({
    repo,
    evidence,
    purpose: 'later-baseline-sensitivity',
    command: node,
    args: ['-e', 'const assert = require("node:assert/strict"); assert.equal(1, 2);'],
    extraOptions: ['--correction-of', original.id, '--correction-note', 'This is a later baseline check; it is not original preimplementation RED evidence.'],
  });
  assert.equal(correctionRun.status, 1, correctionRun.stderr);
  const correctionPath = evidencePathFrom(correctionRun);
  const correction = JSON.parse(await readFile(correctionPath, 'utf8'));

  assert.notEqual(correctionPath, originalPath);
  assert.deepEqual(await readFile(originalPath), originalBytes);
  assert.equal(correction.correction.originalRecordId, original.id);
  assert.equal(correction.correction.note, 'This is a later baseline check; it is not original preimplementation RED evidence.');
  assert.equal(correction.declaredPurpose, 'later-baseline-sensitivity');
  assert.equal(correction.execution.outcome, 'assertion-failure');
  assert.equal((await readdir(evidence)).filter((file) => file.endsWith('.json')).length, 2);
});

test('separates observed assertion failures from syntax and command-launch failures', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-outcomes-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');

  const assertion = invokeRecorder({
    repo,
    evidence,
    purpose: 'preimplementation-red',
    command: node,
    args: ['-e', 'const assert = require("node:assert/strict"); assert.equal(1, 2);'],
  });
  assert.equal(assertion.status, 1, assertion.stderr);
  const assertionRecord = JSON.parse(await readFile(evidencePathFrom(assertion), 'utf8'));
  assert.equal(assertionRecord.declaredPurpose, 'preimplementation-red');
  assert.equal(assertionRecord.execution.outcome, 'assertion-failure');

  const syntax = invokeRecorder({
    repo,
    evidence,
    purpose: 'green',
    command: node,
    args: ['-e', 'const = 1;'],
  });
  assert.equal(syntax.status, 1, syntax.stderr);
  const syntaxRecord = JSON.parse(await readFile(evidencePathFrom(syntax), 'utf8'));
  assert.equal(syntaxRecord.declaredPurpose, 'green');
  assert.equal(syntaxRecord.execution.outcome, 'infrastructure-failure');

  const missingCommand = path.join(temp, 'missing-command');
  const launch = invokeRecorder({ repo, evidence, purpose: 'green', command: missingCommand });
  assert.equal(launch.status, 127, launch.stderr);
  const launchRecord = JSON.parse(await readFile(evidencePathFrom(launch), 'utf8'));
  assert.equal(launchRecord.execution.outcome, 'launch-failure');
  assert.equal(launchRecord.execution.exitCode, 127);
  assert.equal(launchRecord.execution.wrapperExitCode, 127);
});

test('marks a child terminated by signal incomplete and preserves its signal exit status', { skip: process.platform === 'win32' }, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-child-signal-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const result = invokeRecorder({
    repo,
    evidence,
    purpose: 'green',
    command: node,
    args: ['-e', 'process.stdout.write("before-signal"); process.kill(process.pid, "SIGTERM");'],
  });
  assert.equal(result.status, 143, result.stderr);
  const record = JSON.parse(await readFile(evidencePathFrom(result), 'utf8'));
  assert.equal(record.state, 'incomplete');
  assert.equal(record.execution.outcome, 'interrupted');
  assert.equal(record.execution.signal, 'SIGTERM');
  assert.equal(record.execution.wrapperExitCode, 143);
  assert.equal(record.execution.output.stdout, 'before-signal');
});

test('writes incomplete output and cleans up only the owned child process group after interruption', { skip: process.platform === 'win32' }, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-interrupt-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const pidPath = path.join(temp, 'owned-pids.json');
  const parentSignalMarker = path.join(temp, 'parent-signal.txt');
  const parentReadyMarker = path.join(temp, 'parent-ready.txt');
  const descendantReadyMarker = path.join(temp, 'descendant-ready.txt');
  const descendantSignalMarker = path.join(temp, 'descendant-signal.txt');
  const descendantCode = `const fs = require("node:fs"); process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(descendantSignalMarker)}, "terminated"); process.exit(0); }); fs.writeFileSync(${JSON.stringify(descendantReadyMarker)}, "ready"); setInterval(() => {}, 1000);`;
  const commandCode = [
    'const fs = require("node:fs");',
    'const { spawn } = require("node:child_process");',
    `const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(descendantCode)}], { stdio: "ignore" });`,
    `fs.writeFileSync(${JSON.stringify(pidPath)}, JSON.stringify({ parent: process.pid, descendant: descendant.pid }));`,
    `process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(parentSignalMarker)}, "terminated"); process.exit(0); });`,
    `fs.writeFileSync(${JSON.stringify(parentReadyMarker)}, "ready");`,
    'process.stdout.write("command-started");',
    'setInterval(() => {}, 1000);',
  ].join('\n');
  const runner = spawn(node, [recorder, '--repo', repo, '--evidence-dir', evidence, '--purpose', 'preimplementation-red', '--', node, '-e', commandCode], {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let runnerStderr = '';
  runner.stderr.setEncoding('utf8');
  runner.stderr.on('data', (chunk) => { runnerStderr += chunk; });
  let ownedPids;
  t.after(() => {
    if (ownedPids && process.platform !== 'win32') {
      try { process.kill(-ownedPids.parent, 'SIGKILL'); } catch {}
    }
    if (runner.exitCode === null && runner.signalCode === null) runner.kill('SIGKILL');
  });

  const deadline = Date.now() + 5000;
  let recordPath;
  while (!recordPath && Date.now() < deadline) {
    const match = runnerStderr.match(/record-run: evidence=([^\n]+)/);
    if (match) recordPath = match[1];
    else await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(recordPath, `expected initial durable record path; got ${runnerStderr}`);
  while (!ownedPids && Date.now() < deadline) {
    try { ownedPids = JSON.parse(await readFile(pidPath, 'utf8')); } catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
  }
  assert.ok(ownedPids, 'expected the isolated child process group to start');
  while (Date.now() < deadline) {
    try {
      await readFile(parentReadyMarker, 'utf8');
      await readFile(descendantReadyMarker, 'utf8');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assert.equal(await readFile(parentReadyMarker, 'utf8'), 'ready');
  assert.equal(await readFile(descendantReadyMarker, 'utf8'), 'ready');

  const closed = new Promise((resolve) => runner.once('close', (code, signal) => resolve({ code, signal })));
  runner.kill('SIGTERM');
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('recorder did not finish bounded child cleanup')), 8000);
  });
  const completion = await Promise.race([closed, timeout]);
  clearTimeout(timeoutHandle);
  assert.equal(completion.signal, null);
  assert.equal(completion.code, 143);
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  assert.equal(record.state, 'incomplete');
  assert.equal(record.execution.outcome, 'interrupted');
  assert.equal(record.interruption.signal, 'SIGTERM');
  assert.equal(record.interruption.cleanup.scope, 'owned-process-group');
  assert.equal(record.interruption.cleanup.completed, true);
  assert.equal(record.execution.exitCode, 0);
  assert.equal(record.execution.wrapperExitCode, 143);
  assert.equal(record.execution.output.stdout, 'command-started');
  assert.equal(await readFile(parentSignalMarker, 'utf8'), 'terminated');
  assert.equal(await readFile(descendantSignalMarker, 'utf8'), 'terminated');
});

test('escalates to SIGKILL when the owned child ignores interruption', { skip: process.platform === 'win32' }, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-escalation-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const readyPath = path.join(temp, 'ready.txt');
  const pidPath = path.join(temp, 'pid.txt');
  const commandCode = `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); require("node:fs").writeFileSync(${JSON.stringify(readyPath)}, "ready"); process.stdout.write("still-running"); setInterval(() => {}, 1000);`;
  const runner = spawn(node, [recorder, '--repo', repo, '--evidence-dir', evidence, '--purpose', 'green', '--', node, '-e', commandCode], {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let runnerStderr = '';
  runner.stderr.setEncoding('utf8');
  runner.stderr.on('data', (chunk) => { runnerStderr += chunk; });
  let recordPath;
  let commandPid;
  let ready;
  t.after(() => {
    if (commandPid && process.platform !== 'win32') {
      try { process.kill(-commandPid, 'SIGKILL'); } catch {}
    }
    if (runner.exitCode === null && runner.signalCode === null) runner.kill('SIGKILL');
  });

  const deadline = Date.now() + 5000;
  while ((!recordPath || !commandPid || !ready) && Date.now() < deadline) {
    const match = runnerStderr.match(/record-run: evidence=([^\n]+)/);
    if (match) recordPath = match[1];
    try { commandPid = Number(await readFile(pidPath, 'utf8')); } catch {}
    try { ready = await readFile(readyPath, 'utf8'); } catch {}
    if (!recordPath || !commandPid || !ready) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(recordPath, `expected initial durable record path; got ${runnerStderr}`);
  assert.equal(ready, 'ready');
  const closed = new Promise((resolve) => runner.once('close', (code, signal) => resolve({ code, signal })));
  runner.kill('SIGTERM');
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('recorder did not escalate within its bounded cleanup window')), 5000);
  });
  const completion = await Promise.race([closed, timeout]);
  clearTimeout(timeoutHandle);
  assert.equal(completion.signal, null);
  assert.equal(completion.code, 143);
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  assert.equal(record.state, 'incomplete');
  assert.equal(record.execution.signal, 'SIGKILL');
  assert.equal(record.interruption.cleanup.escalated, true);
  assert.equal(record.interruption.cleanup.completed, true);
  assert.equal(record.execution.output.stdout, 'still-running');
  assert.throws(() => process.kill(commandPid, 0), { code: 'ESRCH' });
});

test('leaves only the last durable partial record after an uncatchable recorder termination', { skip: process.platform === 'win32' }, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-uncatchable-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const pidPath = path.join(temp, 'owned-command-pid.txt');
  const commandCode = `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); process.stdout.write("started-but-not-finalized"); setInterval(() => {}, 1000);`;
  const runner = spawn(node, [recorder, '--repo', repo, '--evidence-dir', evidence, '--purpose', 'green', '--', node, '-e', commandCode], {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let runnerStderr = '';
  runner.stderr.setEncoding('utf8');
  runner.stderr.on('data', (chunk) => { runnerStderr += chunk; });
  let commandPid;
  t.after(() => {
    if (commandPid) {
      try { process.kill(-commandPid, 'SIGKILL'); } catch {}
    }
    if (runner.exitCode === null && runner.signalCode === null) runner.kill('SIGKILL');
  });

  const deadline = Date.now() + 5000;
  let recordPath;
  while ((!recordPath || !commandPid) && Date.now() < deadline) {
    const match = runnerStderr.match(/record-run: evidence=([^\n]+)/);
    if (match) recordPath = match[1];
    try { commandPid = Number(await readFile(pidPath, 'utf8')); } catch {}
    if (!recordPath || !commandPid) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(recordPath, `expected the partial record to exist before execution; got ${runnerStderr}`);
  assert.ok(commandPid, 'expected the child process to have started');
  const exited = new Promise((resolve) => runner.once('exit', (code, signal) => resolve({ code, signal })));
  runner.kill('SIGKILL');
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('recorder did not terminate after SIGKILL')), 5000);
  });
  const completion = await Promise.race([exited, timeout]);
  clearTimeout(timeoutHandle);
  assert.equal(completion.signal, 'SIGKILL');

  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  assert.equal(record.state, 'running');
  assert.equal(record.finishedAt, null);
  assert.equal(record.finalizedAt, null);
  assert.equal(record.execution.outcome, 'running');
  assert.equal(record.execution.output.stdout, '');
  assert.equal(record.interruption, undefined);
});


test('redacts quoted and escaped JSON credentials in source diff output and code arguments', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-json-secrets-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const credentials = ['synthetic quoted phrase 17af', 'synthetic escaped phrase 29cd'];
  const json = JSON.stringify({ api_key: credentials[0], client_secret: credentials[1] });
  await writeFile(path.join(repo, 'src', 'app.js'), `export const config = ${json};\n`);
  await writeFile(path.join(repo, 'config.json'), json);
  const child = `process.stdout.write(${JSON.stringify(json)}); process.stderr.write(${JSON.stringify(JSON.stringify(json))});`;
  const result = invokeRecorder({ repo, evidence: path.join(temp, 'evidence'), purpose: 'green', command: node, args: ['-e', child] });
  assert.equal(result.status, 0, result.stderr);
  const serialized = await readFile(evidencePathFrom(result), 'utf8');
  for (const credential of credentials) assert.equal(serialized.includes(credential), false, 'quoted credential must not reach a durable field');
  const record = JSON.parse(serialized);
  assert.match(record.execution.output.stdout, /REDACTED/);
  assert.match(record.execution.output.stderr, /REDACTED/);
  assert.match(record.workingTree.sourceTestFiles.find(file => file.path === 'src/app.js').diff, /REDACTED/);
});

test('distinguishes actual redacted binary dependency and staged state without persisting payloads', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-opaque-identity-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const capture = async () => {
    const result = invokeRecorder({ repo, evidence, purpose: 'green', command: node, args: ['-e', ''] });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(await readFile(evidencePathFrom(result), 'utf8'));
  };
  const clean = await capture();
  for (const [file, first, second] of [
    ['src/opaque.js', 'export const token = "synthetic-one";', 'export const token = "synthetic-two";'],
    ['picture.png', Buffer.from([0, 1, 2]), Buffer.from([0, 3, 4])],
    ['credentials.json', '{"secret":"synthetic-one"}', '{"secret":"synthetic-two"}'],
    ['firestore.rules', 'allow read: if false;', 'allow read: if true;'],
    ['manifest.webmanifest', '{"name":"one"}', '{"name":"two"}'],
    ['package-lock.json', '{"lockfileVersion":1}', '{"lockfileVersion":2}'],
  ]) {
    await writeFile(path.join(repo, file), first);
    const a = await capture();
    await writeFile(path.join(repo, file), second);
    const b = await capture();
    assert.notEqual(a.workingTree.sourceTestDiffSha256, b.workingTree.sourceTestDiffSha256, `${file}: actual changed bytes need distinct identities`);
    assert.notEqual(clean.workingTree.sourceTestDiffSha256, a.workingTree.sourceTestDiffSha256);
    assert.equal(b.workingTree.identity.status, 'complete');
    const entry = b.workingTree.sourceTestFiles.find(item => item.path === file);
    assert.match(entry.actualBytesSha256, /^[a-f0-9]{64}$/);
    if (['picture.png', 'credentials.json', 'package-lock.json'].includes(file)) assert.equal(entry.content, null);
    assert.equal(JSON.stringify(b).includes('synthetic-two'), false);
  }
  const app = path.join(repo, 'src/app.js');
  await writeFile(app, 'export const value = 2;\n');
  spawnSync('git', ['-C', repo, 'add', 'src/app.js']);
  await writeFile(app, 'export const value = 3;\n');
  const stagedFirst = await capture();
  spawnSync('git', ['-C', repo, 'add', 'src/app.js']);
  const stagedSecond = await capture();
  assert.notEqual(stagedFirst.workingTree.sourceTestDiffSha256, stagedSecond.workingTree.sourceTestDiffSha256, 'index state remains part of tested identity');
  await writeFile(app, 'export const value = 1;\n');
  spawnSync('git', ['-C', repo, 'add', 'src/app.js']);
  spawnSync('git', ['-C', repo, 'mv', 'src/app.js', 'src/renamed.js']);
  const renamed = await capture();
  const renamedFile = renamed.workingTree.sourceTestFiles.find(item => item.path === 'src/renamed.js');
  assert.equal(renamedFile.previousPath, 'src/app.js');
  assert.match(renamedFile.actualDiffSha256, /^[a-f0-9]{64}$/);
});

test('classifies real TAP syntax and import failures separately from assertions and generic not-ok output', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-real-tap-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  for (const [name, code, expected] of [
    ['syntax', 'const = 1;', 'infrastructure-failure'],
    ['import', 'import "./missing-fixture-module.mjs";', 'infrastructure-failure'],
    ['assertion', 'import {test} from "node:test"; import assert from "node:assert/strict"; test("real assertion",()=>assert.equal(1,2));', 'assertion-failure'],
  ]) {
    const file = `${name}.test.mjs`;
    await writeFile(path.join(repo, file), code);
    const result = invokeRecorder({ repo, evidence, purpose: 'preimplementation-red', command: node, args: ['--test', '--test-reporter=tap', file] });
    assert.equal(result.status, 1, result.stderr);
    const record = JSON.parse(await readFile(evidencePathFrom(result), 'utf8'));
    assert.equal(record.execution.outcome, expected, `${name}: runner failure markers are not assertion evidence`);
    assert.equal(record.declaredPurpose, 'preimplementation-red');
  }
  const result = invokeRecorder({ repo, evidence, purpose: 'green', command: node, args: ['-e', 'console.log("not ok 1 - failed runner\\n# fail 1"); process.exitCode=1;'] });
  assert.equal(JSON.parse(await readFile(evidencePathFrom(result), 'utf8')).execution.outcome, 'nonzero-exit');
});

test('opaque identity never exposes deleted binary or renamed sensitive diff payloads', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-opaque-diffs-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const sensitive = 'synthetic-sensitive-raw-payload-6f91';
  await writeFile(path.join(repo, 'credentials.json'), sensitive);
  await writeFile(path.join(repo, 'src', 'binary.js'), Buffer.from([0, 20, 31, 99]));
  spawnSync('git', ['-C', repo, 'add', '.']);
  spawnSync('git', ['-C', repo, 'commit', '--quiet', '-m', 'opaque fixtures']);
  spawnSync('git', ['-C', repo, 'mv', 'credentials.json', 'config.json']);
  await rm(path.join(repo, 'src', 'binary.js'));
  const result = invokeRecorder({ repo, evidence: path.join(temp, 'evidence'), purpose: 'green', command: node, args: ['-e', ''] });
  assert.equal(result.status, 0, result.stderr);
  const serialized = await readFile(evidencePathFrom(result), 'utf8');
  const record = JSON.parse(serialized);
  assert.equal(serialized.includes(sensitive), false, 'renaming cannot expose a sensitive payload');
  const binary = record.workingTree.sourceTestFiles.find(file => file.path === 'src/binary.js');
  assert.equal(binary.content, null);
  assert.equal(binary.diff, undefined, 'deleted binary patch payload stays opaque');
  assert.match(binary.actualDiffSha256, /^[a-f0-9]{64}$/);
  assert.equal(record.workingTree.sourceTestFiles.find(file => file.path === 'config.json').previousPath, 'credentials.json');
});
