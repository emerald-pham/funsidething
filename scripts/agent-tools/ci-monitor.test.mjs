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
  const required=['validation-context','event-gates','cohort-routing','regression-core','regression-scenery','regression-persistence-recovery','regression-native-process','scanner-tests'];
  const scenarios=[
    ['complete full cohort',()=>{},0,'success'],
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

// #2217 weekly velocity report. The fake gh answers only the read and alert
// commands the report is expected to use, so an unexpected GitHub write (or a
// search over the wrong window) fails the run instead of passing silently.
const velocityRepo = 'emerald-pham/funsidething';
const velocityNow = '2026-11-04T12:00:00Z';
const velocityWindowStart = '2026-10-28T12:00:00Z';
const minutesAfter = (start, minutes) => new Date(Date.parse(start) + minutes * 60000).toISOString().replace('.000Z', 'Z');
const velocityRun = (id, startedAt, minutes, conclusion = 'success', status = 'completed') => ({ databaseId: id, createdAt: startedAt, startedAt, updatedAt: minutesAfter(startedAt, minutes), status, conclusion, event: 'pull_request' });
function velocityData(overrides = {}) {
  return {
    merged: [
      { number: 900, title: 'Keep the board usable before scenery paints', mergedAt: '2026-11-03T09:00:00Z' },
      { number: 899, title: 'Recover an unreadable cloud generation', mergedAt: '2026-11-01T09:00:00Z' },
      { number: 898, title: 'Tidy the settings changelog', mergedAt: '2026-10-30T09:00:00Z' },
      // Merged 8 days before the report: outside the weekly window.
      { number: 850, title: 'Older merge outside the window', mergedAt: '2026-10-27T09:00:00Z' },
    ],
    open: [
      { number: 606, title: 'Enforce qualification guardrails', createdAt: '2026-10-28T12:00:00Z', isDraft: false, baseRefName: 'main' },
      { number: 285, title: 'Fix WebKit transfer stalls', createdAt: '2026-10-26T12:00:00Z', isDraft: false, baseRefName: 'main' },
    ],
    issuesOpened: 40,
    // Finished Data safety runs of 4, 8, 12, 30 and 60 minutes: median 12, nearest-rank p90 60.
    // The cancelled run, the unfinished run and the run before the window must not count.
    runs: [
      velocityRun(1, '2026-10-29T10:00:00Z', 4),
      velocityRun(2, '2026-10-30T10:00:00Z', 8, 'failure'),
      velocityRun(3, '2026-10-31T10:00:00Z', 12),
      velocityRun(4, '2026-11-01T10:00:00Z', 30, 'failure'),
      velocityRun(5, '2026-11-02T10:00:00Z', 60),
      velocityRun(6, '2026-11-03T10:00:00Z', 2, 'cancelled'),
      velocityRun(7, '2026-11-04T11:00:00Z', 1, null, 'in_progress'),
      velocityRun(8, '2026-10-20T10:00:00Z', 1),
    ],
    alertIssues: [],
    ...overrides,
  };
}
async function createVelocityFixture(root, data) {
  const bin = path.join(root, 'bin');
  await mkdir(bin, { recursive: true });
  const fixturePath = path.join(root, 'velocity-fixture.json');
  await writeFile(fixturePath, JSON.stringify({ ...data, calls: [] }), 'utf8');
  await writeFile(path.join(bin, 'gh'), `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const fixturePath = process.env.VELOCITY_GH_FIXTURE;
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const args = process.argv.slice(2);
fixture.calls.push(args);
const value = name => args[args.indexOf(name) + 1];
const has = (...words) => words.every(word => args.includes(word));
let out = null, error = null;
if (has('pr', 'list') && value('--state') === 'merged') out = fixture.merged;
else if (has('pr', 'list') && value('--state') === 'open') out = fixture.open;
else if (has('run', 'list')) out = fixture.runs;
else if (args[0] === 'api' && args.some(arg => arg.startsWith('search/issues'))) {
  const query = args.find(arg => arg.startsWith('q=')) || '';
  if (!query.includes('repo:${velocityRepo}') || !query.includes('is:issue') || !query.includes('created:>=${velocityWindowStart}')) error = 'unexpected issue search ' + query;
  else out = { total_count: fixture.issuesOpened, incomplete_results: false, items: [] };
}
// Like GitHub, a --label filter returns only issues carrying that label.
else if (has('issue', 'list')) out = fixture.alertIssues.filter(issue => !args.includes('--label') || (issue.labels || []).includes(value('--label'))).map(({ labels, ...issue }) => issue);
else if (has('issue', 'create')) out = 'https://github.com/${velocityRepo}/issues/901';
else if (has('issue', 'comment')) out = 'https://github.com/${velocityRepo}/issues/' + args[2] + '#issuecomment-1';
else error = 'unexpected gh call ' + JSON.stringify(args);
writeFileSync(fixturePath, JSON.stringify(fixture));
if (error) { process.stderr.write(error); process.exitCode = 1; }
else process.stdout.write(typeof out === 'string' ? out + '\\n' : JSON.stringify(out));
`, { mode: 0o755 });
  await chmod(path.join(bin, 'gh'), 0o755);
  return { bin, fixturePath };
}
async function invokeVelocity(t, data, args = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ci-monitor-velocity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { bin, fixturePath } = await createVelocityFixture(root, data);
  const summaryPath = path.join(root, 'step-summary.md');
  const result = spawnSync(node, [monitor, 'velocity-report', '--repo', velocityRepo, '--now', velocityNow, ...args], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, VELOCITY_GH_FIXTURE: fixturePath, GITHUB_STEP_SUMMARY: summaryPath },
    encoding: 'utf8',
    timeout: 10000,
  });
  const summary = await readFile(summaryPath, 'utf8').catch(() => '');
  const calls = JSON.parse(await readFile(fixturePath, 'utf8')).calls;
  const issueWrites = calls.filter(call => call[0] === 'issue' && ['create', 'comment', 'edit', 'close'].includes(call[1]));
  return { result, summary, calls, issueWrites };
}

test('velocity report writes a readable weekly summary and raises no alert when neither threshold trips', async parent => {
  await parent.test('ordinary week', async t => {
    const { result, summary, issueWrites } = await invokeVelocity(t, velocityData());
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /^::(?:error|warning)/m, 'a healthy week must not annotate the run');
    assert.deepEqual(issueWrites, [], 'a healthy week must not file or comment on an alert issue');
    assert.match(summary, /Merged PRs[^\n]*\b3\b/i, 'three PRs merged to main inside the window');
    assert.match(summary, /#900/);
    assert.doesNotMatch(summary, /#850/, 'a merge before the window is not part of this week');
    assert.match(summary, /median CI duration[^\n]*\b12(?:\.0)? min/i);
    assert.match(summary, /p90 CI duration[^\n]*\b60(?:\.0)? min/i);
    assert.match(summary, /Issues opened[^\n]*\b40\b/i);
    assert.match(summary, /#606[^\n]*\b7 days\b/, 'open PR ages are reported');
    assert.match(summary, /#285[^\n]*\b9 days\b/);
  });
  await parent.test('no merge but no open PRs is not a stall', async t => {
    const { result, issueWrites } = await invokeVelocity(t, velocityData({ merged: [], open: [] }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /^::error/m);
    assert.deepEqual(issueWrites, []);
  });
  await parent.test('exactly 100 issues is not a spike', async t => {
    const { result, issueWrites } = await invokeVelocity(t, velocityData({ issuesOpened: 100 }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /^::error/m);
    assert.deepEqual(issueWrites, []);
  });
});

const velocityAlertTitle = 'Weekly velocity alert';
const flagValue = (call, name) => call[call.indexOf(name) + 1];

test('velocity report alerts when nothing merged to main in 7 days while PRs are open', async t => {
  const data = velocityData({ merged: velocityData().merged.filter(pr => pr.number === 850) });
  const { result, summary, issueWrites } = await invokeVelocity(t, data);
  assert.equal(result.status, 1, 'a stall must fail the nightly job visibly: ' + result.stdout + result.stderr);
  assert.match(result.stdout, /^::error title=[^:]*::[^\n]*no PR merged to main in 7 days[^\n]*2 open PRs/im, 'the stall must be a workflow error annotation');
  assert.match(summary, /Merged PRs[^\n]*\b0\b/i, 'the summary is still written when the alert trips');
  assert.equal(issueWrites.length, 1, 'exactly one alert issue write');
  const [create] = issueWrites;
  assert.deepEqual(create.slice(0, 2), ['issue', 'create']);
  assert.equal(flagValue(create, '--repo'), velocityRepo);
  assert.equal(flagValue(create, '--title'), velocityAlertTitle);
  assert.equal(flagValue(create, '--label'), 'needs-triage');
  assert.match(flagValue(create, '--body'), /no PR merged to main in 7 days/i);
  assert.match(flagValue(create, '--body'), /#606/, 'the alert carries the weekly summary');
});

test('velocity report counts only ready PRs into main as waiting for a merge', async parent => {
  const draftIntoMain = { number: 610, title: 'Sketch a new board layout', createdAt: '2026-11-01T12:00:00Z', isDraft: true, baseRefName: 'main' };
  const readyIntoBranch = { number: 611, title: 'Ticket work for the integration branch', createdAt: '2026-11-02T12:00:00Z', isDraft: false, baseRefName: 'integration/spec-2205-release-scaling' };
  const readyIntoMain = { number: 612, title: 'Ship the release scaling spec', createdAt: '2026-11-03T12:00:00Z', isDraft: false, baseRefName: 'main' };
  await parent.test('drafts and PRs into other branches are not a stall', async t => {
    const { result, issueWrites } = await invokeVelocity(t, velocityData({ merged: [], open: [draftIntoMain, readyIntoBranch] }));
    assert.equal(result.status, 0, 'nothing is ready to merge to main, so nothing stalled: ' + result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /^::error/m);
    assert.deepEqual(issueWrites, []);
  });
  await parent.test('the stall counts only the ready PR into main', async t => {
    const { result } = await invokeVelocity(t, velocityData({ merged: [], open: [draftIntoMain, readyIntoBranch, readyIntoMain] }));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^::error title=[^:]*::[^\n]*no PR merged to main in 7 days while 1 open PR wait/im);
  });
});

test('velocity report alerts when more than 100 issues are opened in a week', async t => {
  const { result, summary, issueWrites } = await invokeVelocity(t, velocityData({ issuesOpened: 101 }));
  assert.equal(result.status, 1, 'an issue spike must fail the nightly job visibly: ' + result.stdout + result.stderr);
  assert.match(result.stdout, /^::error title=[^:]*::[^\n]*101 issues opened in 7 days/im, 'the spike must be a workflow error annotation');
  assert.doesNotMatch(result.stdout, /no PR merged to main/i, 'merges happened, so only the spike trips');
  assert.match(summary, /Issues opened[^\n]*\b101\b/i);
  assert.equal(issueWrites.length, 1, 'exactly one alert issue write');
  assert.deepEqual(issueWrites[0].slice(0, 2), ['issue', 'create']);
  assert.equal(flagValue(issueWrites[0], '--title'), velocityAlertTitle);
  assert.equal(flagValue(issueWrites[0], '--label'), 'needs-triage');
  assert.match(flagValue(issueWrites[0], '--body'), /101 issues opened in 7 days/i);
});

test('velocity report reuses an existing open alert issue instead of filing a duplicate', async t => {
  const alertIssues = [
    // GitHub title search is fuzzy, so a near-miss title must not be mistaken for
    // the alert, even when it is the older issue.
    { number: 70, title: 'Weekly velocity alert wording follow-up' },
    { number: 77, title: velocityAlertTitle, labels: ['needs-triage'] },
  ];
  const { result, issueWrites, calls } = await invokeVelocity(t, velocityData({ merged: [], issuesOpened: 250, alertIssues }));
  assert.equal(result.status, 1, 'the alert still fails the nightly job: ' + result.stdout + result.stderr);
  assert.match(result.stdout, /^::error title=[^:]*::[^\n]*no PR merged to main in 7 days/im);
  assert.match(result.stdout, /^::error title=[^:]*::[^\n]*250 issues opened in 7 days/im);
  assert.equal(issueWrites.filter(call => call[1] === 'create').length, 0, 'an open alert issue must not be duplicated');
  assert.equal(issueWrites.length, 1, 'exactly one alert issue write');
  const [comment] = issueWrites;
  assert.deepEqual(comment.slice(0, 3), ['issue', 'comment', '77'], 'the existing alert issue is reused');
  assert.equal(flagValue(comment, '--repo'), velocityRepo);
  assert.match(flagValue(comment, '--body'), /no PR merged to main in 7 days/i);
  assert.match(flagValue(comment, '--body'), /250 issues opened in 7 days/i);
  const lookup = calls.find(call => call[0] === 'issue' && call[1] === 'list');
  assert.ok(lookup, 'the open alert issues must be looked up before filing');
  assert.equal(flagValue(lookup, '--state'), 'open', 'a closed alert is not reused');
});

test('velocity report reuses an open alert issue that has already been triaged', async t => {
  // Triage replaces needs-triage with another label; the alert is still the
  // one open alert, so the nightly run must comment on it, not file a second.
  const alertIssues = [{ number: 81, title: velocityAlertTitle, labels: ['ready-for-human'] }];
  const { result, issueWrites } = await invokeVelocity(t, velocityData({ merged: [], alertIssues }));
  assert.equal(result.status, 1, 'the alert still fails the nightly job: ' + result.stdout + result.stderr);
  assert.equal(issueWrites.filter(call => call[1] === 'create').length, 0, 'a triaged open alert issue must not be duplicated');
  assert.equal(issueWrites.length, 1, 'exactly one alert issue write');
  assert.deepEqual(issueWrites[0].slice(0, 3), ['issue', 'comment', '81'], 'the triaged alert issue is reused');
});

test('velocity report dry run reports the alert without writing to GitHub', async t => {
  const { result, issueWrites, calls } = await invokeVelocity(t, velocityData({ merged: [], alertIssues: [{ number: 77, title: velocityAlertTitle, labels: ['needs-triage'] }] }), ['--dry-run']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^::error title=[^:]*::[^\n]*no PR merged to main in 7 days/im);
  assert.deepEqual(issueWrites, [], 'a dry run must never create or comment on an issue');
  assert.match(result.stdout, /dry run[^\n]*would comment on #77/i, 'a dry run says which alert issue it would reuse');
  assert.ok(calls.every(call => !(call[0] === 'api' && call.some(arg => /^-X$|^--method$/.test(arg)) && !call.includes('GET'))), 'no API write either');
});
