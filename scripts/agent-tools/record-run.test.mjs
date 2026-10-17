import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

function invokeRecorder({ repo, evidence, purpose, command, args = [], extraOptions = [] }) {
  return spawnSync(node, [recorder, '--repo', repo, '--evidence-dir', evidence, '--purpose', purpose, ...extraOptions, '--', command, ...args], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function evidencePathFrom(result) {
  const line = result.stderr.split('\n').find((entry) => entry.startsWith('record-run: evidence='));
  assert.ok(line, `expected a durable evidence path in stderr; got ${result.stderr}`);
  return line.slice('record-run: evidence='.length);
}

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
