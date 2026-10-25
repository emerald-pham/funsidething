import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const node = process.execPath;
const monitor = fileURLToPath(new URL('./ci-monitor.mjs', import.meta.url));
const requestedRunId = '88442211';
const requestedCommit = 'a'.repeat(40);

async function createGhFixture(root, { metadata = [], logs = [] } = {}) {
  const bin = path.join(root, 'bin');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'gh-fixture.json'), JSON.stringify({ metadata, logs, calls: [] }), 'utf8');
  await mkdir(bin, { recursive: true });
  const fakeGh = path.join(bin, 'gh');
  await writeFile(fakeGh, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const fixturePath = process.env.CI_MONITOR_GH_FIXTURE;
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const args = process.argv.slice(2);
fixture.calls.push({ args, godebug: process.env.GODEBUG ?? null });
const isLog = args.includes('--log');
const queue = isLog ? fixture.logs : fixture.metadata;
const response = queue.length ? queue.shift() : { stdout: '' };
writeFileSync(fixturePath, JSON.stringify(fixture));
if (response.delayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, response.delayMs);
if (response.stderr) process.stderr.write(response.stderr);
if (response.stdout !== undefined) process.stdout.write(response.stdout);
process.exitCode = response.code ?? 0;
`, { mode: 0o755 });
  await chmod(fakeGh, 0o755);
  return { bin, fixturePath: path.join(root, 'gh-fixture.json') };
}

function invokeMonitor({ bin, fixturePath, evidence, args = [] }) {
  return spawnSync(node, [monitor, '--repo', 'emerald-pham/funsidething', '--run-id', requestedRunId,
    '--commit', requestedCommit, '--evidence-dir', evidence, '--interval-ms', '1',
    '--max-interval-ms', '1', '--max-polls', '1', ...args], {
    cwd: path.dirname(fixturePath),
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CI_MONITOR_GH_FIXTURE: fixturePath },
    encoding: 'utf8',
    timeout: 5000,
  });
}

test('rejects a different run instead of accepting replacement evidence', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ci-monitor-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidence = path.join(root, 'evidence');
  const { bin, fixturePath } = await createGhFixture(root, {
    metadata: [{ stdout: JSON.stringify({
      databaseId: Number(requestedRunId) + 1,
      headSha: requestedCommit,
      status: 'completed',
      conclusion: 'success',
      event: 'pull_request',
      headBranch: 'change',
      workflowName: 'Data safety',
      jobs: [{ name: 'scanner-tests', status: 'completed', conclusion: 'success' }],
    }) }],
    logs: [{ stdout: 'test log\n' }],
  });

  const result = invokeMonitor({ bin, fixturePath, evidence });
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr + result.stdout, /run identity mismatch|commit identity mismatch/i);
  assert.doesNotMatch(result.stdout, /result=success/i);
});

test('rejects the requested run when its release commit does not match', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ci-monitor-commit-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { bin, fixturePath } = await createGhFixture(root, {
    metadata: [{ stdout: JSON.stringify({
      databaseId: Number(requestedRunId),
      headSha: 'c'.repeat(40),
      status: 'completed',
      conclusion: 'success',
      event: 'pull_request',
      headBranch: 'change',
      workflowName: 'Data safety',
      jobs: [{ name: 'scanner-tests', status: 'completed', conclusion: 'success' }],
    }) }],
  });

  const result = invokeMonitor({ bin, fixturePath, evidence: path.join(root, 'evidence') });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Commit identity mismatch/);
  assert.doesNotMatch(result.stdout, /CI monitor result=success/);
});

test('classifies run outcomes and the workflow-defined expected skipped jobs', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ci-monitor-results-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = [
    { name: 'pending', run: { status: 'queued', conclusion: null, jobs: [{ name: 'scanner-tests', status: 'queued', conclusion: null }] }, expected: 'pending', exitCode: 2 },
    { name: 'waiting', run: { status: 'waiting', conclusion: null, jobs: [{ name: 'scanner-tests', status: 'waiting', conclusion: null }] }, expected: 'waiting', exitCode: 2 },
    { name: 'success', run: { status: 'completed', conclusion: 'success', jobs: [
      { name: 'scanner-tests', status: 'completed', conclusion: 'success' },
      { name: 'release-evidence', status: 'completed', conclusion: 'skipped' },
      { name: 'deploy-pages', status: 'completed', conclusion: 'skipped' },
    ] }, expected: 'success', exitCode: 0, expectedText: 'release-evidence=expected-skipped' },
    { name: 'failure', run: { status: 'completed', conclusion: 'failure', jobs: [{ name: 'scanner-tests', status: 'completed', conclusion: 'failure' }] }, expected: 'failure', exitCode: 1 },
    { name: 'canceled', run: { status: 'completed', conclusion: 'cancelled', jobs: [{ name: 'scanner-tests', status: 'completed', conclusion: 'cancelled' }] }, expected: 'canceled', exitCode: 1 },
    { name: 'unexpected-skip', run: { status: 'completed', conclusion: 'success', jobs: [
      { name: 'scanner-tests', status: 'completed', conclusion: 'skipped' },
      { name: 'release-evidence', status: 'completed', conclusion: 'skipped' },
      { name: 'deploy-pages', status: 'completed', conclusion: 'skipped' },
    ] }, expected: 'failure', exitCode: 1, expectedText: 'release-evidence=expected-skipped' },
    { name: 'main-push-success', run: { event: 'push', headBranch: 'main', status: 'completed', conclusion: 'success', jobs: [
      { name: 'scanner-tests', status: 'completed', conclusion: 'success' },
      { name: 'release-evidence', status: 'completed', conclusion: 'success' },
      { name: 'deploy-pages', status: 'completed', conclusion: 'success' },
    ] }, expected: 'success', exitCode: 0 },
    { name: 'main-push-required-skip', run: { event: 'push', headBranch: 'main', status: 'completed', conclusion: 'success', jobs: [
      { name: 'scanner-tests', status: 'completed', conclusion: 'success' },
      { name: 'release-evidence', status: 'completed', conclusion: 'skipped' },
      { name: 'deploy-pages', status: 'completed', conclusion: 'success' },
    ] }, expected: 'failure', exitCode: 1 },
    { name: 'branch-push-expected-skips', run: { event: 'push', headBranch: 'change', status: 'completed', conclusion: 'success', jobs: [
      { name: 'scanner-tests', status: 'completed', conclusion: 'success' },
      { name: 'release-evidence', status: 'completed', conclusion: 'skipped' },
      { name: 'deploy-pages', status: 'completed', conclusion: 'skipped' },
    ] }, expected: 'success', exitCode: 0, expectedText: 'release-evidence=expected-skipped' },
    { name: 'unknown-skipped-job', run: { status: 'completed', conclusion: 'success', jobs: [
      { name: 'scanner-tests', status: 'completed', conclusion: 'success' },
      { name: 'release-evidence', status: 'completed', conclusion: 'skipped' },
      { name: 'deploy-pages', status: 'completed', conclusion: 'skipped' },
      { name: 'new-gate', status: 'completed', conclusion: 'skipped' },
    ] }, expected: 'unresolved', exitCode: 2, expectedText: 'Unknown required-job policy for new-gate' },
    { name: 'nonrequired-job-failure', run: { status: 'completed', conclusion: 'success', jobs: [
      { name: 'scanner-tests', status: 'completed', conclusion: 'success' },
      { name: 'release-evidence', status: 'completed', conclusion: 'failure' },
      { name: 'deploy-pages', status: 'completed', conclusion: 'skipped' },
    ] }, expected: 'failure', exitCode: 1, expectedText: 'deploy-pages=expected-skipped' },
    { name: 'nonterminal-job', run: { status: 'completed', conclusion: 'success', jobs: [
      { name: 'scanner-tests', status: 'completed', conclusion: 'success' },
      { name: 'release-evidence', status: 'queued', conclusion: null },
      { name: 'deploy-pages', status: 'completed', conclusion: 'skipped' },
    ] }, expected: 'unresolved', exitCode: 2, expectedText: 'deploy-pages=expected-skipped' },
  ];
  const actual = [];

  for (const [index, scenario] of cases.entries()) {
    const scenarioRoot = path.join(root, String(index));
    const run = {
      databaseId: Number(requestedRunId),
      headSha: requestedCommit,
      event: 'pull_request',
      headBranch: 'feature',
      workflowName: 'Data safety',
      ...scenario.run,
    };
    const { bin, fixturePath } = await createGhFixture(scenarioRoot, { metadata: [{ stdout: JSON.stringify(run) }] });
    const result = invokeMonitor({ bin, fixturePath, evidence: path.join(scenarioRoot, 'evidence') });
    const resultLine = result.stdout.split('\n').find((line) => line.startsWith('CI monitor result=')) ?? '';
    actual.push({
      name: scenario.name,
      exitCode: result.status,
      resultLine,
      expectedSkip: Boolean(scenario.expectedText && result.stdout.includes(scenario.expectedText)),
    });
  }

  assert.deepEqual(actual.map(({ name, exitCode, resultLine, expectedSkip }) => ({
    name,
    exitCode,
    result: resultLine.match(/result=([a-z-]+)/)?.[1] ?? null,
    expectedSkip,
  })), cases.map(({ name, expected, exitCode, expectedText }) => ({
    name,
    exitCode,
    result: expected,
    expectedSkip: Boolean(expectedText),
  })));
});

test('observes changed progress without repeating unchanged status lines until the same run completes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ci-monitor-progress-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const snapshot = (status, conclusion, jobStatus, jobConclusion = null) => ({
    databaseId: Number(requestedRunId),
    headSha: requestedCommit,
    status,
    conclusion,
    event: 'pull_request',
    headBranch: 'feature',
    workflowName: 'Data safety',
    jobs: [{ name: 'scanner-tests', status: jobStatus, conclusion: jobConclusion }],
  });
  const { bin, fixturePath } = await createGhFixture(root, {
    metadata: [
      { stdout: JSON.stringify(snapshot('queued', null, 'queued')) },
      { stdout: JSON.stringify(snapshot('in_progress', null, 'in_progress')) },
      { stdout: JSON.stringify(snapshot('in_progress', null, 'in_progress')) },
      { stdout: JSON.stringify({ ...snapshot('completed', 'success', 'completed', 'success'), jobs: [
        { name: 'scanner-tests', status: 'completed', conclusion: 'success' },
        { name: 'release-evidence', status: 'completed', conclusion: 'skipped' },
        { name: 'deploy-pages', status: 'completed', conclusion: 'skipped' },
      ] }) },
    ],
  });

  const result = invokeMonitor({ bin, fixturePath, evidence: path.join(root, 'evidence'), args: ['--max-polls', '4', '--max-interval-ms', '4'] });
  const progress = result.stdout.split('\n').filter((line) => line.startsWith('CI monitor progress='));
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const resultLine = result.stdout.split('\n').find((line) => line.startsWith('CI monitor result=')) ?? '';
  const attempt = resultLine.match(/ evidence=(\S+)$/)?.[1];
  const progressRows = attempt
    ? (await readFile(path.join(attempt, 'progress.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];

  assert.equal(result.status, 0, result.stderr);
  assert.equal(progress.length, 3, result.stdout);
  assert.match(progress[0], /status=queued/);
  assert.match(progress[1], /status=in_progress/);
  assert.match(progress[2], /status=completed/);
  assert.match(result.stdout, /CI monitor result=success/);
  assert.deepEqual(progressRows.map(({ poll, changed, status, nextDelayMs }) => ({ poll, changed, status, nextDelayMs })), [
    { poll: 1, changed: true, status: 'queued', nextDelayMs: 1 },
    { poll: 2, changed: true, status: 'in_progress', nextDelayMs: 1 },
    { poll: 3, changed: false, status: 'in_progress', nextDelayMs: 2 },
    { poll: 4, changed: true, status: 'completed', nextDelayMs: 0 },
  ]);
  assert.equal(fixture.calls.filter(({ args }) => !args.includes('--log')).length, 4);
  assert.ok(fixture.calls.every(({ args }) => args[0] === 'run' && args[1] === 'view' && args[2] === requestedRunId));
});

test('persists the exact metadata response and full raw run logs with the terminal result', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ci-monitor-logs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rawLogs = 'scanner-tests\tResolve comparison base\nscanner-tests\tAssertions passed ✓\n';
  const metadata = `${JSON.stringify({
    databaseId: Number(requestedRunId),
    headSha: requestedCommit,
    status: 'completed',
    conclusion: 'success',
    event: 'pull_request',
    headBranch: 'feature',
    workflowName: 'Data safety',
    jobs: [
      { name: 'scanner-tests', status: 'completed', conclusion: 'success' },
      { name: 'release-evidence', status: 'completed', conclusion: 'skipped' },
      { name: 'deploy-pages', status: 'completed', conclusion: 'skipped' },
    ],
  })}  \n`;
  const { bin, fixturePath } = await createGhFixture(root, {
    metadata: [{ stdout: metadata }],
    logs: [{ stdout: rawLogs }],
  });

  const result = invokeMonitor({ bin, fixturePath, evidence: path.join(root, 'evidence') });
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const resultLine = result.stdout.split('\n').find((line) => line.startsWith('CI monitor result=')) ?? '';
  const attempt = resultLine.match(/ evidence=(\S+)$/)?.[1];
  const persistedLogs = attempt ? await readFile(path.join(attempt, 'logs.txt'), 'utf8').catch(() => null) : null;
  const persistedSnapshot = attempt ? await readFile(path.join(attempt, 'snapshots.jsonl'), 'utf8').catch(() => null) : null;

  assert.deepEqual({
    exitCode: result.status,
    fullLogRequest: fixture.calls.some(({ args }) => args.includes('--log')),
    logs: persistedLogs,
    snapshot: persistedSnapshot ?? null,
  }, {
    exitCode: 0,
    fullLogRequest: true,
    logs: rawLogs,
    snapshot: metadata,
  }, `${result.stdout}\nresolved evidence path: ${attempt ?? '(missing)'}`);
});

test('retries transient reads within a fixed bound and applies the TLS fallback only to local gh calls', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ci-monitor-retries-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const beforeGodebug = process.env.GODEBUG;
  const success = JSON.stringify({
    databaseId: Number(requestedRunId),
    headSha: requestedCommit,
    status: 'completed',
    conclusion: 'success',
    event: 'pull_request',
    headBranch: 'feature',
    workflowName: 'Data safety',
    jobs: [
      { name: 'scanner-tests', status: 'completed', conclusion: 'success' },
      { name: 'release-evidence', status: 'completed', conclusion: 'skipped' },
      { name: 'deploy-pages', status: 'completed', conclusion: 'skipped' },
    ],
  });
  const scenarios = [
    {
      name: 'generic transient',
      metadata: [{ code: 1, stderr: 'connection reset by peer' }, { stdout: success }],
      logs: [{ stdout: 'generic retry logs\n' }],
      expectedResult: 'success',
      expectedExit: 0,
      expectedMetadataCalls: 2,
      fallbackUsed: false,
    },
    {
      name: 'conditional TLS fallback',
      metadata: [{ code: 1, stderr: 'net/http: TLS handshake timeout' }, { stdout: success }],
      logs: [{ stdout: 'TLS retry logs\n' }],
      expectedResult: 'success',
      expectedExit: 0,
      expectedMetadataCalls: 2,
      fallbackUsed: true,
    },
    {
      name: 'bounded exhaustion',
      metadata: [
        { code: 1, stderr: 'connection reset by peer' },
        { code: 1, stderr: 'connection reset by peer' },
        { code: 1, stderr: 'connection reset by peer' },
      ],
      expectedResult: 'unresolved',
      expectedExit: 2,
      expectedMetadataCalls: 3,
      fallbackUsed: false,
    },
  ];
  const actual = [];

  for (const [index, scenario] of scenarios.entries()) {
    const scenarioRoot = path.join(root, String(index));
    const { bin, fixturePath } = await createGhFixture(scenarioRoot, scenario);
    const result = invokeMonitor({ bin, fixturePath, evidence: path.join(scenarioRoot, 'evidence') });
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
    const terminal = result.stdout.split('\n').find((line) => line.startsWith('CI monitor result=')) ?? '';
    const metadataCalls = fixture.calls.filter(({ args }) => !args.includes('--log'));
    const readOnly = fixture.calls.every(({ args }) => args[0] === 'run' && args[1] === 'view');
    const fallbackLocal = scenario.fallbackUsed
      ? !String(metadataCalls[0]?.godebug ?? '').includes('http2client=0')
        && String(metadataCalls[1]?.godebug ?? '').includes('http2client=0')
        && fixture.calls.filter(({ args }) => args.includes('--log')).every(({ godebug }) => String(godebug).includes('http2client=0'))
      : fixture.calls.every(({ godebug }) => !String(godebug ?? '').includes('http2client=0'));
    actual.push({
      name: scenario.name,
      exitCode: result.status,
      result: terminal.match(/result=([a-z-]+)/)?.[1] ?? null,
      metadataCalls: metadataCalls.length,
      readOnly,
      fallbackLocal,
      envUnchanged: process.env.GODEBUG === beforeGodebug,
    });
  }

  assert.deepEqual(actual, scenarios.map((scenario) => ({
    name: scenario.name,
    exitCode: scenario.expectedExit,
    result: scenario.expectedResult,
    metadataCalls: scenario.expectedMetadataCalls,
    readOnly: true,
    fallbackLocal: true,
    envUnchanged: true,
  })));
});

test('honors the interactive wait bound even when gh stalls inside one status request', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ci-monitor-yield-bound-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { bin, fixturePath } = await createGhFixture(root, {
    metadata: [{ delayMs: 1000, stdout: JSON.stringify({
      databaseId: Number(requestedRunId),
      headSha: requestedCommit,
      status: 'completed',
      conclusion: 'success',
      event: 'pull_request',
      headBranch: 'feature',
      workflowName: 'Data safety',
      jobs: [{ name: 'scanner-tests', status: 'completed', conclusion: 'success' }],
    }) }],
  });
  const startedAt = Date.now();
  const result = invokeMonitor({
    bin,
    fixturePath,
    evidence: path.join(root, 'evidence'),
    args: ['--max-wait-ms', '120', '--request-timeout-ms', '1000', '--max-polls', '5', '--interval-ms', '10', '--max-interval-ms', '10'],
  });
  const elapsedMs = Date.now() - startedAt;
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /CI monitor result=unresolved/);
  assert.equal(fixture.calls.filter(({ args }) => !args.includes('--log')).length, 1);
  assert.ok(elapsedMs < 500, `monitor exceeded its 120 ms wait bound: ${elapsedMs} ms`);
});

test('does not accept success when the raw logs cannot be read after bounded retries', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ci-monitor-log-error-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { bin, fixturePath } = await createGhFixture(root, {
    metadata: [{ stdout: JSON.stringify({
      databaseId: Number(requestedRunId),
      headSha: requestedCommit,
      status: 'completed',
      conclusion: 'success',
      event: 'pull_request',
      headBranch: 'feature',
      workflowName: 'Data safety',
      jobs: [{ name: 'scanner-tests', status: 'completed', conclusion: 'success' }],
    }) }],
    logs: [
      { code: 1, stderr: 'connection reset by peer' },
      { code: 1, stderr: 'connection reset by peer' },
      { code: 1, stderr: 'connection reset by peer' },
    ],
  });

  const result = invokeMonitor({
    bin,
    fixturePath,
    evidence: path.join(root, 'evidence'),
    args: ['--retry-delay-ms', '1', '--max-retry-delay-ms', '2'],
  });
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const resultLine = result.stdout.split('\n').find((line) => line.startsWith('CI monitor result=')) ?? '';
  const attempt = resultLine.match(/ evidence=(\S+)$/)?.[1];
  const summary = attempt ? JSON.parse(await readFile(path.join(attempt, 'summary.json'), 'utf8')) : {};
  const logs = attempt ? await readFile(path.join(attempt, 'logs.txt'), 'utf8').catch(() => null) : null;

  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(resultLine, /result=unresolved/);
  assert.doesNotMatch(result.stdout, /CI monitor result=success/);
  assert.equal(summary.logsState, 'unavailable');
  assert.equal(logs, null);
  assert.equal(fixture.calls.filter(({ args }) => args.includes('--log')).length, 3);
  assert.ok(fixture.calls.every(({ args }) => args[0] === 'run' && args[1] === 'view'));
});

test('canonical producer routing retains scanner aggregate and handoff exit distinctions', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ci-monitor-routing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = [
    { name: 'covered push', event: 'push', status: 'completed', conclusion: 'success', scanner: 'success', expected: 'success', code: 0 },
    { name: 'pending producer', event: 'push', status: 'in_progress', conclusion: null, scanner: null, expected: 'running', code: 2 },
    { name: 'failed producer', event: 'push', status: 'completed', conclusion: 'failure', scanner: 'failure', expected: 'failure', code: 1 },
    { name: 'canceled producer', event: 'pull_request', status: 'completed', conclusion: 'cancelled', scanner: 'cancelled', expected: 'canceled', code: 1 },
    { name: 'skipped scanner is forbidden', event: 'push', status: 'completed', conclusion: 'success', scanner: 'skipped', expected: 'failure', code: 1 },
  ];
  for (const [index, scenario] of cases.entries()) {
    const location = path.join(root, String(index));
    const run = { databaseId: Number(requestedRunId), headSha: requestedCommit,
      event: scenario.event, headBranch: 'topic', workflowName: 'Data safety',
      status: scenario.status, conclusion: scenario.conclusion, jobs: [
        { name: 'scanner-tests', status: scenario.scanner ? 'completed' : 'in_progress', conclusion: scenario.scanner,
          steps: [{ name: 'Run complete regression cohort', conclusion: 'skipped' }] },
        { name: 'release-evidence', status: 'completed', conclusion: 'skipped' },
        { name: 'deploy-pages', status: 'completed', conclusion: 'skipped' },
      ] };
    const { bin, fixturePath } = await createGhFixture(location, { metadata: [{ stdout: JSON.stringify(run) }], logs: [{ stdout: `canonical producer evidence for ${scenario.name}\n` }] });
    const result = invokeMonitor({ bin, fixturePath, evidence: path.join(location, 'evidence') });
    assert.equal(result.status, scenario.code, scenario.name + ': ' + result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(`result=${scenario.expected} `), scenario.name);
  }
});
