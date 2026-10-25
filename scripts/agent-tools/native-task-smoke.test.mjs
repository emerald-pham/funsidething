import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { classifyOrigin } from './native-task-smoke.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const requiredCase = 'native smoke actual isolated local-fixture CLI';

if (process.env.CHAIN_NATIVE_SMOKE_CHILD === '1') test(requiredCase, () => {
  const isolatedCI = process.env.CI === 'true';
  const port = isolatedCI ? '0' : process.env.CHAIN_NATIVE_SMOKE_PORT;
  assert.match(port ?? '', /^\d+$/, 'Local native smoke requires an explicitly allocated CHAIN_NATIVE_SMOKE_PORT');
  assert.ok(isolatedCI || (Number(port) > 0 && Number(port) <= 65535), 'Local smoke port must be valid and allocated');
  assert.ok(isolatedCI || Number(port) !== Number(process.env.CHAIN_NATIVE_PORT),
    'Task smoke and concurrent installed-client fixtures require distinct ports');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./native-task-smoke.mjs', import.meta.url)),
    repo, process.env.CHAIN_NATIVE_CANDIDATE_SHA, process.env.CHAIN_NATIVE_CANDIDATE_TREE,
    `http://127.0.0.1:${port}`, process.env.CHAIN_NATIVE_SMOKE_REPORT, 'chromium', 'local-fixture'], {
    cwd: repo, env, encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024,
    detached: process.platform !== 'win32',
  });
  if (child.error && child.pid && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const diagnostic = [child.stdout, child.stderr].filter(Boolean).join('\n');
  assert.equal(child.error, undefined, diagnostic);
  assert.equal(child.signal, null, diagnostic);
  assert.equal(child.status, 0, diagnostic);
});

if (process.env.CHAIN_NATIVE_SMOKE_CHILD !== '1') test('native smoke cohort requires its actual local driver outcome and complete evidence', (t) => {
  const { CHAIN_NATIVE_CANDIDATE_SHA: source, CHAIN_NATIVE_CANDIDATE_TREE: tree,
    CHAIN_NATIVE_OUTPUT: outputDirectory } = process.env;
  assert.match(source ?? '', /^[a-f0-9]{40}$/, 'Explicit native candidate SHA is required');
  assert.match(tree ?? '', /^[a-f0-9]{40}$/, 'Explicit native candidate tree is required');
  assert.ok(outputDirectory && path.isAbsolute(outputDirectory), 'Durable absolute native output directory is required');
  const output = path.join(outputDirectory, `native-task-smoke-${randomUUID()}.json`);
  t.diagnostic('Native smoke evidence: ' + output);
  const env = { ...process.env, CHAIN_NATIVE_SMOKE_CHILD: '1', CHAIN_NATIVE_SMOKE_REPORT: output };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
    '--test-name-pattern=^' + requiredCase + '$', fileURLToPath(import.meta.url)], {
    cwd: repo, env, encoding: 'utf8', timeout: 195000, maxBuffer: 2 * 1024 * 1024,
  });
  const diagnostic = [child.stdout, child.stderr].filter(Boolean).join('\n');
  assert.equal(child.error, undefined, diagnostic);
  assert.equal(child.signal, null, diagnostic);
  assert.equal(child.status, 0, diagnostic);
  const outcomes = child.stdout.split(/\r?\n/).filter(line => /^ok \d+ - /.test(line));
  assert.deepEqual(outcomes, ['ok 1 - ' + requiredCase], 'The actual driver case must execute once, without skip or TODO: ' + diagnostic);
  for (const label of ['cancelled', 'skipped', 'todo']) assert.match(child.stdout, new RegExp('^# ' + label + ' 0$', 'm'));
  assert.match(child.stdout, /^1\.\.1$/m, 'The required native case has one complete outcome');
  assert.ok(fs.existsSync(output), 'The actual driver must retain its report');
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.source, source);
  assert.equal(report.tree, tree);
  assert.equal(report.mode, 'local-fixture');
  assert.equal(report.proofScope, 'local-fixture');
  assert.equal(report.status, 'passed');
  assert.equal(report.engine, 'chromium');
  const requestedPort = process.env.CI === 'true' ? 0 : Number(process.env.CHAIN_NATIVE_SMOKE_PORT);
  assert.equal(report.requestedOrigin, `http://127.0.0.1:${requestedPort}`);
  assert.equal(report.fixture.requestedPort, requestedPort);
  assert.ok(report.fixture.port > 0 && report.fixture.port <= 65535);
  assert.equal(report.origin, `http://127.0.0.1:${report.fixture.port}`);
  for (const [act, count] of [['add', 12], ['yes', 10], ['bench-done', 10], ['undo', 1]]) {
    assert.equal(report.actions.filter(row => row.act === act).length, count, 'Required actual native actions: ' + act);
  }
  assert.equal(report.acceptedGestureFacts, 20);
  assert.ok(fs.existsSync(output.replace(/\.json$/, '.png')), 'The actual driver retains its native capture');
  assert.equal(report.durabilityObservation.all20ExactGestureFactsInHead, true);
  assert.equal(report.durabilityObservation.allowanceMs, 15000);
  assert.deepEqual(report.doubleClickRejection, { detail: 2, trusted: true, extraFacts: 0 });
  assert.equal(report.taskInput.requiresTrusted, true);
  assert.equal(report.taskInput.acceptedRequiresDetail, 1);
  assert.equal(report.taskInput.detail2Accepted, false);
  assert.equal(report.taskInput.silentRetries, false);
  assert.equal(report.taskInput.syntheticDetailForcing, false);
  for (const key of ['ordinaryAutosaveReadback', 'durableReopen', 'offlineReopen', 'localListenerStillOpen',
    'cleanupContextClosed', 'cleanupBrowserClosed', 'cleanupServerClosed']) assert.equal(report[key], true, key);
  assert.equal(report.offlineTransport.failed, true);
  assert.equal(report.offlineTransport.listenerStillOpen, true);
  assert.equal(report.offlineTransport.offlineProbeReachedListener, false);
  assert.deepEqual(report.fixtureRpc, []);
  assert.deepEqual(report.externalRequestsEscaped, []);
});

test('native smoke permits owned ephemeral loopback only for the isolated CI runner', () => {
  const moduleUrl = new URL('./native-task-smoke.mjs', import.meta.url).href;
  const command = `import { classifyOrigin } from ${JSON.stringify(moduleUrl)}; console.log(classifyOrigin('http://127.0.0.1:0', 'local-fixture').url.port);`;
  const local = spawnSync(process.execPath, ['--input-type=module', '-e', command], {
    encoding: 'utf8', env: { ...process.env, CI: '' },
  });
  assert.notEqual(local.status, 0, 'Unallocated local port 0 must fail closed');
  assert.match(local.stderr, /allocated port/);
  const ci = spawnSync(process.execPath, ['--input-type=module', '-e', command], {
    encoding: 'utf8', env: { ...process.env, CI: 'true' },
  });
  assert.equal(ci.status, 0, ci.stderr);
  assert.equal(ci.stdout, '0\n');
});

test('native smoke keeps approved public origins separate from explicit local fixtures', () => {
  assert.equal(classifyOrigin('https://emerald-pham.github.io/funsidething/', 'online').kind, 'public');
  assert.equal(classifyOrigin('https://chain-scanner.web.app/', 'offline').kind, 'public');
  assert.equal(classifyOrigin('http://127.0.0.1:6063', 'local-fixture').kind, 'local-fixture');
  assert.equal(classifyOrigin('http://127.0.0.1:6063/', 'local-fixture').kind, 'local-fixture');
});

test('native smoke refuses origins outside the exact public and literal loopback boundaries', () => {
  for (const origin of [
    'http://localhost:6063',
    'http://127.0.0.1',
    'http://127.0.0.1:6063/path',
    'http://user@127.0.0.1:6063',
    'http://127.0.0.1:6063?fixture=1',
    'http://127.0.0.1:6063#fixture',
    'http://127.0.0.2:6063',
    'https://127.0.0.1:6063',
    'https://unapproved.example/',
  ]) {
    assert.throws(() => classifyOrigin(origin, 'local-fixture'), undefined, 'refuses ' + origin);
  }
  assert.throws(() => classifyOrigin('http://127.0.0.1:6063', 'online'));
  assert.throws(() => classifyOrigin('https://unapproved.example/', 'offline'));
});
