import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const legacyWorkflow='name: Data safety\njobs:\n  scanner-tests:\n  release-evidence:\n  deploy-pages:\n';
const checkoutPrefix=sha=>`scanner-tests\tCheckout\tgit log -1 --format=%H\nscanner-tests\tCheckout\t${sha}\n`;
async function createGhFixture(root, { metadata = [], logs = [], workflow = legacyWorkflow, apiError = null } = {}) {
  const bin = path.join(root, 'bin');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'gh-fixture.json'), JSON.stringify({ metadata:metadata.map(response=>{try{const run=JSON.parse(response.stdout);return run.attempt?response:{...response,stdout:JSON.stringify({...run,attempt:1})};}catch{return response;}}), logs, workflow, apiError, calls: [] }), 'utf8');
  await mkdir(bin, { recursive: true });
  const fakeGh = path.join(bin, 'gh');
  await writeFile(fakeGh, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const fixturePath = process.env.CI_MONITOR_GH_FIXTURE;
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const args = process.argv.slice(2);
fixture.calls.push({ args, godebug: process.env.GODEBUG ?? null });
const isLog = args.includes('--log');
let response;
if(args[0]==='api') {
  const sha=fixture.lastRun?.event==='pull_request'?'d'.repeat(40):fixture.lastRun?.headSha;
  if(fixture.apiError)response={code:1,stderr:fixture.apiError};
  else if(args[1].includes('/git/commits/')) response={stdout:JSON.stringify({sha,tree:{sha:'e'.repeat(40)},parents:fixture.lastRun?.event==='pull_request'?[{sha:'b'.repeat(40)},{sha:fixture.lastRun.headSha}]:[{sha:'b'.repeat(40)}]})};
  else if(args[1].includes('/contents/.github/workflows/data-safety.yml')){const bytes=Buffer.from(fixture.workflow);response={stdout:JSON.stringify({encoding:'base64',content:bytes.toString('base64'),sha:createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\\0'),bytes])).digest('hex')})};}
  else response={code:1,stderr:'unexpected API path'};
} else {
  const queue = isLog ? fixture.logs : fixture.metadata;
  response = queue.length ? queue.shift() : { stdout: '' };
  if(!isLog){try{fixture.lastRun=JSON.parse(response.stdout);}catch{}}
  else if(!response.code){const sha=fixture.lastRun?.event==='pull_request'?'d'.repeat(40):fixture.lastRun?.headSha;response={...response,stdout:'scanner-tests\\tCheckout\\tgit log -1 --format=%H\\nscanner-tests\\tCheckout\\t'+sha+'\\n'+(response.stdout||'')};}
}
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
  assert.equal(fixture.calls.filter(({ args }) => args[0]==='run' && !args.includes('--log')).length, 4);
  assert.ok(fixture.calls.every(({ args }) => args[0] === 'api' || (args[0] === 'run' && args[1] === 'view' && args[2] === requestedRunId)));
});

test('persists the exact metadata response and full raw run logs with the terminal result', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ci-monitor-logs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rawLogs = 'scanner-tests\tResolve comparison base\nscanner-tests\tAssertions passed ✓\n';
  const metadata = `${JSON.stringify({
    attempt: 1,
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
    logs: checkoutPrefix('d'.repeat(40))+rawLogs,
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
    const metadataCalls = fixture.calls.filter(({ args }) => args[0]==='run' && !args.includes('--log'));
    const readOnly = fixture.calls.every(({ args }) => args[0]==='api' || (args[0] === 'run' && args[1] === 'view'));
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
  assert.equal(fixture.calls.filter(({ args }) => args[0]==='run' && !args.includes('--log')).length, 1);
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


test('binds required parallel topology to actual candidate workflow even when new jobs are absent', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'ci-monitor-topology-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const workflow=await readFile(new URL('../../.github/workflows/data-safety.yml',import.meta.url),'utf8');
  const run={databaseId:Number(requestedRunId),headSha:requestedCommit,status:'completed',conclusion:'success',event:'pull_request',headBranch:'feature',workflowName:'Data safety',jobs:[{name:'scanner-tests',status:'completed',conclusion:'success'},{name:'release-evidence',conclusion:'skipped'},{name:'deploy-pages',conclusion:'skipped'}]};
  const {bin,fixturePath}=await createGhFixture(root,{metadata:[{stdout:JSON.stringify(run)}],workflow});
  const result=invokeMonitor({bin,fixturePath,evidence:path.join(root,'evidence')});
  assert.equal(result.status,1,result.stdout+result.stderr);assert.match(result.stdout,/Required job validation-context is missing/);
});

test('parallel workflow observation preserves complete missing skipped canceled and unknown distinctions', async parent => {
  const workflow=await readFile(new URL('../../.github/workflows/data-safety.yml',import.meta.url),'utf8');
  const required=['validation-context','event-gates','cohort-routing','regression-core','regression-scenery','regression-persistence-recovery','regression-native-process','mobile-WebKit-512MB','scanner-tests'];
  const scenarios=[
    ['complete full cohort',()=>{},0,'success'],
    ['absent mobile job',run=>{run.jobs=run.jobs.filter(job=>job.name!=='mobile-WebKit-512MB');},1,'failure'],
    ['failed mobile job',run=>{run.jobs.find(job=>job.name==='mobile-WebKit-512MB').conclusion='failure';},1,'failure'],
    ['skipped mobile job',run=>{run.jobs.find(job=>job.name==='mobile-WebKit-512MB').conclusion='skipped';},1,'failure'],
    ['canceled mobile job',run=>{run.jobs.find(job=>job.name==='mobile-WebKit-512MB').conclusion='cancelled';},1,'canceled'],
    ['timed out mobile job',run=>{run.jobs.find(job=>job.name==='mobile-WebKit-512MB').conclusion='timed_out';},1,'failure'],
    ['unknown mobile outcome',run=>{run.jobs.find(job=>job.name==='mobile-WebKit-512MB').conclusion='unknown';},2,'unresolved'],
    ['older parallel workflow remains supported',run=>{run.jobs=run.jobs.filter(job=>job.name!=='mobile-WebKit-512MB');},0,'success',workflow.replace(/^  mobile-memory:\n[\s\S]*?(?=^  scanner-tests:)/m,'').replace(', regression, mobile-memory]',', regression]')],
    ['renamed unknown mobile job policy',()=>{},2,'unresolved',workflow.replace('name: mobile-WebKit-512MB','name: unknown-mobile-job')],
    ['mobile job absent from scanner dependencies',()=>{},2,'unresolved',workflow.replace(', regression, mobile-memory]',', regression]')],
    ['complete covered cohort',run=>{run.jobs.find(job=>job.name==='scanner-tests').steps=run.jobs.find(job=>job.name==='scanner-tests').steps.filter(step=>!step.name.startsWith('Complete regression')).map(step=>({...step,name:step.name.replace('mode full','mode reuse')}));},0,'success'],
    ['absent verified aggregate marker',run=>{run.jobs.find(job=>job.name==='scanner-tests').steps=[];},1,'failure'],
    ['absent core group',run=>{run.jobs=run.jobs.filter(job=>job.name!=='regression-core');},1,'failure'],
    ['skipped group',run=>{run.jobs[3].conclusion='skipped';},1,'failure'],
    ['canceled group',run=>{run.jobs[4].conclusion='cancelled';},1,'canceled'],
    ['duplicate group',run=>{run.jobs.push({...run.jobs[3]});},2,'unresolved'],
    ['unknown group',run=>{run.jobs.push({name:'regression-other',conclusion:'success'});},2,'unresolved'],
    ['unknown candidate topology',()=>{},2,'unresolved',workflow.replace('four-groups-v1','unrecognized-v2')],
    ['unavailable candidate bytes',()=>{},2,'unresolved',workflow,'controlled public API failure'],
  ];
  for(const [name,mutate,code,outcome,bytes=workflow,apiError=null]of scenarios)await parent.test(name,async t=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'ci-monitor-parallel-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const run={attempt:2,databaseId:Number(requestedRunId),headSha:requestedCommit,event:'pull_request',headBranch:'feature',workflowName:'Data safety',status:'completed',conclusion:'success',jobs:required.map(name=>({name,status:'completed',conclusion:'success'})).concat([{name:'release-evidence',conclusion:'skipped'},{name:'deploy-pages',conclusion:'skipped'}])};
    const context='1'.repeat(64),report='8'.repeat(64),bytesForBlob=Buffer.from(bytes),blob=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytesForBlob.length+'\0'),bytesForBlob])).digest('hex');
    run.jobs[0].steps=[{name:'Actual checkout '+ 'd'.repeat(40)+' tree '+'e'.repeat(40),conclusion:'success'},{name:'Validation source '+requestedCommit+' base '+'b'.repeat(40),conclusion:'success'},{name:'Workflow blob '+blob+' policy four-groups-v1',conclusion:'success'},{name:'Announce regression context '+context,conclusion:'success'}];
    run.jobs.find(job=>job.name==='scanner-tests').steps=[{name:'Verify complete required cohort',conclusion:'success'},{name:'Verified complete cohort '+context+' report '+report+' mode full',conclusion:'success'},{name:'Complete regression context '+context+' report '+report,conclusion:'success'}];
    mutate(run);
    const {bin,fixturePath}=await createGhFixture(root,{metadata:[{stdout:JSON.stringify(run)}],workflow:bytes,apiError});
    const result=invokeMonitor({bin,fixturePath,evidence:path.join(root,'evidence'),args:['--max-retries','0']});
    assert.equal(result.status,code,result.stdout+result.stderr);assert.match(result.stdout,new RegExp('result='+outcome+' '));
    const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
    assert.ok(fixture.calls.filter(call=>call.args.includes('--log')).every(call=>call.args[call.args.indexOf('--attempt')+1]==='2'),'raw logs must be pinned to the observed attempt');
  });
});
