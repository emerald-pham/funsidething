import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTap } from '../test-groups.mjs';

const node = process.execPath;
const recorder = fileURLToPath(new URL('./record-run.mjs', import.meta.url));
const coordinationEntrypoint = fileURLToPath(new URL('./coordination.mjs', import.meta.url));

function activeLedgerOwner({ id, worktree, resources, now = new Date(), expiresAt = new Date(now.getTime() + 60000), status = 'active' }) {
  const heartbeatAt = now.toISOString();
  return {
    id,
    status,
    worktree,
    heartbeatAt,
    lease: {
      state: 'healthy',
      ownerConfirmationRequired: false,
      takeoverAllowed: false,
      lastHeartbeatAt: heartbeatAt,
      expiresAt: expiresAt.toISOString(),
    },
    resources,
  };
}

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
  const canonicalRepo = await realpath(repo);
  const commit = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const tree = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' });
  assert.equal(commit.status, 0, commit.stderr);
  assert.equal(tree.status, 0, tree.stderr);
  const deliveryPort = 51631;
  const smokePort = 51632;
  const ledger = path.join(root, 'coordination.json');
  const resources = [`loopback:127.0.0.1:${deliveryPort}`, `loopback:127.0.0.1:${smokePort}`];
  const owner = activeLedgerOwner({ id: 'fixture-owner', worktree: canonicalRepo, resources });
  await writeFile(ledger, JSON.stringify({ version: 1, scope: 'codex-wide', entries: [owner] }));
  return {
    root,
    repo,
    canonicalRepo,
    commit: commit.stdout.trim(),
    tree: tree.stdout.trim(),
    evidence: path.join(root, 'recorder-evidence'),
    nativeOutput: path.join(root, 'native-output'),
    sentinel: path.join(root, 'expensive-child-launched'),
    ledger,
    owner,
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

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function invokeLocalFixture({ repo, evidence, env: overrides = {}, extraOptions = [], timeout = 30000 }) {
  const env = { ...process.env, ...overrides };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(node, [recorder, '--repo', repo, '--evidence-dir', evidence, '--purpose', 'green',
    '--summary', '--local-fixture', 'early-group-aggregate', ...extraOptions], {
    cwd: repo,
    encoding: 'utf8',
    timeout,
    env,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function claimLocalFixtureResource(fixture, resource = fixture.resource) {
  return spawnSync(node, [coordinationEntrypoint, 'claim', '--file', fixture.ledger,
    '--id', fixture.owner.id, '--resources', resource], {
    cwd: fixture.canonicalRepo,
    encoding: 'utf8',
    env: { ...process.env, CODEX_COORDINATION_FILE: fixture.ledger, DOW_EMULATOR_COORDINATION_FILE: '' },
  });
}

async function listenAtPort(port) {
  const server = createHttpServer((_request, response) => response.end('foreign-control-live'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

async function assertPortCanBind(port) {
  const server = await listenAtPort(port);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function startLocalFixture(fixture, overrides = {}) {
  const env = { ...process.env, ...fixture.env, ...overrides };
  delete env.NODE_TEST_CONTEXT;
  return spawn(node, [recorder, '--repo', fixture.repo, '--evidence-dir', fixture.evidence,
    '--purpose', 'green', '--summary', '--local-fixture', 'early-group-aggregate'], {
    cwd: fixture.canonicalRepo,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForFixtureFile(fixture, fileName, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const directories = (await readdir(fixture.root)).filter((name) => name.startsWith(path.basename(fixture.nativeOutput)));
    for (const directory of directories) {
      const filePath = path.join(fixture.root, directory, fileName);
      try { await stat(filePath); return filePath; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for local fixture output ' + fileName + '.');
}

async function assertNoFixtureOutput(fixture) {
  const names = await readdir(fixture.root);
  assert.equal(names.some((name) => name.startsWith(path.basename(fixture.nativeOutput))), false,
    'readiness failure cannot launch the fixture or create its output directory');
}

function captureProcess(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function fixtureTestSource(behavior, coordinationScript) {
  return [
    "import assert from 'node:assert/strict';",
    "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';",
    "import { createServer } from 'node:http';",
    "import path from 'node:path';",
    "import { spawnSync } from 'node:child_process';",
    "import test from 'node:test';",
    'const behavior = ' + JSON.stringify(behavior) + ';',
    'const coordinationScript = ' + JSON.stringify(coordinationScript) + ';',
    "test('group and aggregate retain actual early cases once across fresh group processes', async t => {",
    "  assert.equal(process.versions.node.split('.')[0], '22');",
    "  const nested = spawnSync('node', ['-p', 'process.version'], { encoding: 'utf8' });",
    "  assert.equal(nested.status, 0, nested.stderr);",
    "  assert.equal(nested.stdout.trim(), process.version, 'PATH must select the same actual Node runtime as the fixed child');",
    "  for (const key of ['CI', 'CONTINUOUS_INTEGRATION', 'NODE_OPTIONS', 'NODE_PATH', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'PLAYWRIGHT_BROWSERS_PATH', 'FIREBASE_CONFIG', 'AWS_PROFILE', 'DOW_EMULATOR_COORDINATION_FILE', 'CHAIN_NATIVE_SMOKE_PORT']) {",
    "    assert.equal(process.env[key], undefined, key + ' must not cross the controlled local boundary');",
    "  }",
    "  assert.ok(process.env.CODEX_COORDINATION_FILE);",
    "  const output = process.env.CHAIN_NATIVE_OUTPUT;",
    "  mkdirSync(output, { recursive: true });",
    "  appendFileSync(path.join(output, 'fixture-started.txt'), process.pid + '\\n');",
    "  const port = Number(process.env.CHAIN_NATIVE_PORT);",
    "  let listenerObservation;",
    "  const server = createServer((_request, response) => response.end('fixture-listener-live'));",
    "  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });",
    "  writeFileSync(path.join(output, 'fixture-listener-live.txt'), String(port));",
    "  try {",
    "    const response = await fetch('http://127.0.0.1:' + port + '/fixture');",
    "    const body = await response.text();",
    "    listenerObservation = { port, httpStatus: response.status, reachable: response.ok, bodyMatches: body === 'fixture-listener-live' };",
    "    assert.equal(body, 'fixture-listener-live');",
    "    if (behavior === 'interrupt') await new Promise(resolve => setTimeout(resolve, 60000));",
    "    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));",
    "    if (behavior === 'change-lease') { const refreshed = spawnSync(process.execPath, [coordinationScript, 'heartbeat', '--file', process.env.CODEX_COORDINATION_FILE, '--id', 'fixture-owner'], { cwd: process.cwd(), encoding: 'utf8' }); assert.equal(refreshed.status, 0, refreshed.stderr); }",
    "    writeFileSync(path.join(output, 'button-safety-chromium-fixture.json'), JSON.stringify({ status: 'failed', observedActions: ['act:download-backup'], actionObservation: { recognizedOffered: ['act:download-backup'], executed: [], coverage: 'fixture producer only' }, outcomes: [], rapidOutcomes: [], errors: ['controlled-page-crash'], cleanup: { contextClosed: true, browserClosed: true, serverClosed: true }, browserVersion: 'external-mock-no-engine' }));",
    "    t.diagnostic(JSON.stringify({ scope: 'Controlled OS-process transfer only; no native/runtime proof', earlyRootExecutions: 5, uniqueEarlyRoots: 5, ordinaryGroups: 4, aggregateCaseCount: 11, liveListenerObservations: [listenerObservation] }));",
    "    if (behavior === 'failure') assert.fail('controlled local fixture failure');",
    "  } finally {",
    "    if (server.listening) await new Promise(resolve => server.close(() => resolve()));",
    "  }",
    "});",
  ].join('\n');
}

async function createLocalFixture(t, { behavior = 'success', foreignEntry = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'record-run-local-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = await createCommittedRepository(root);
  const canonicalRepo = await realpath(repo);
  const testPath = path.join(repo, 'scripts/agent-tools/test-groups.test.mjs');
  await mkdir(path.dirname(testPath), { recursive: true });
  await writeFile(testPath, fixtureTestSource(behavior, coordinationEntrypoint));
  const add = spawnSync('git', ['-C', repo, 'add', 'scripts/agent-tools/test-groups.test.mjs'], { encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);
  const commit = spawnSync('git', ['-C', repo, 'commit', '--quiet', '-m', 'fixed fixture runner'], { encoding: 'utf8' });
  assert.equal(commit.status, 0, commit.stderr);
  const deliveryPort = await getFreePort();
  const smokePort = await getFreePort();
  const foreignPort = foreignEntry ? await getFreePort() : null;
  const now = new Date();
  const resource = 'loopback:127.0.0.1:' + deliveryPort;
  const ledger = path.join(root, 'coordination.json');
  const owner = activeLedgerOwner({ id: 'fixture-owner', worktree: canonicalRepo, resources: [resource], now });
  const foreign = foreignEntry ? activeLedgerOwner({
    id: 'foreign-owner',
    worktree: path.join(root, 'foreign-repo'),
    resources: ['loopback:127.0.0.1:' + foreignPort, 'foreign-reservation:keep'],
    now,
  }) : null;
  const ledgerValue = { version: 1, scope: 'codex-wide', entries: [owner, ...(foreign ? [foreign] : [])] };
  await writeFile(ledger, JSON.stringify(ledgerValue));
  const evidence = path.join(root, 'evidence');
  const nativeOutput = path.join(root, 'evidence-native-output-');
  return {
    root,
    repo,
    canonicalRepo,
    evidence,
    nativeOutput,
    ledger,
    ledgerValue,
    owner,
    foreign,
    resource,
    deliveryPort,
    smokePort,
    foreignPort,
    env: {
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      CODEX_COORDINATION_FILE: ledger,
      DOW_EMULATOR_COORDINATION_FILE: path.join(root, 'foreign-ledger.json'),
      CHAIN_NATIVE_PORT: String(deliveryPort),
      CHAIN_NATIVE_SMOKE_PORT: String(smokePort),
      CHAIN_NATIVE_OUTPUT: path.join(root, 'inherited-output'),
      CHAIN_NATIVE_CANDIDATE_SHA: 'stale-sha',
      CHAIN_NATIVE_CANDIDATE_TREE: 'stale-tree',
      CI: 'true',
      CONTINUOUS_INTEGRATION: 'true',
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: 'foreign-run',
      PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'foreign-engines'),
      FIREBASE_CONFIG: path.join(root, 'foreign-firebase.json'),
      AWS_PROFILE: 'foreign-profile',
      NODE_OPTIONS: '--trace-warnings',
      NODE_PATH: path.join(root, 'foreign-node-path'),
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

test('local fixture runs its fixed child, records nested outcomes, and releases only its own allocation', async (t) => {
  const fixture = await createLocalFixture(t, { foreignEntry: true });
  const foreignServer = await listenAtPort(fixture.foreignPort);
  t.after(() => new Promise((resolve) => foreignServer.close(() => resolve())));
  const foreignBefore = structuredClone(fixture.foreign);

  const first = invokeLocalFixture({ repo: fixture.repo, evidence: fixture.evidence, env: fixture.env });
  assert.equal(first.status, 0, JSON.stringify({ status: first.status, signal: first.signal, error: first.error?.message, stdout: first.stdout, stderr: first.stderr }));
  const firstSummary = summaryFrom(first);
  assert.equal(firstSummary.status, 'passed');
  assert.equal(firstSummary.fixture.mode, 'early-group-aggregate');
  assert.equal(firstSummary.fixture.workloadOutcome, 'passed');
  assert.deepEqual(firstSummary.fixture.nestedOutcomes, {
    testName: 'group and aggregate retain actual early cases once across fresh group processes',
    status: 'passed',
    earlyRootExecutions: 5,
    uniqueEarlyRoots: 5,
    ordinaryGroups: 4,
    aggregateCaseCount: 11,
    liveListener: {
      allocatedPort: fixture.deliveryPort,
      observedPort: fixture.deliveryPort,
      httpStatus: 200,
      reachable: true,
      responseBodyVerified: true,
      matchesAllocation: true,
      observationCount: 1,
    },
    controlledBoundary: 'Playwright chromium.launch is replaced by the fixture; no native browser engine or memory qualification runs.',
  });
  assert.equal(firstSummary.fixture.producer.status, 'failed', 'the expected page-crash producer remains visible inside a passing group assertion');
  assert.deepEqual(firstSummary.fixture.producer.errors, ['controlled-page-crash']);
  assert.equal(firstSummary.fixture.producer.cleanup.serverClosed, true);
  assert.equal(firstSummary.fixture.cleanup.child.completed, true);
  assert.equal(firstSummary.fixture.cleanup.listener.status, 'closed');
  assert.equal(firstSummary.fixture.cleanup.allocation.status, 'released');
  assert.equal(firstSummary.fixture.cleanup.runtimeDirectory.status, 'removed');
  const firstRecord = JSON.parse(await readFile(firstSummary.evidence.metadataPath, 'utf8'));
  assert.match(firstRecord.localFixture.runtime.nodeVersion, /^v22\./);
  assert.equal(firstRecord.localFixture.runtime.nodeExecutable, node);
  assert.equal(firstRecord.localFixture.nestedOutcomes.aggregateCaseCount, 11);
  assert.notEqual(firstRecord.localFixture.evidence.nativeOutputDirectory, fixture.evidence);

  let ledger = JSON.parse(await readFile(fixture.ledger, 'utf8'));
  assert.equal(ledger.entries[0].resources.includes(fixture.resource), false, 'the exact completed fixture allocation is released');
  assert.deepEqual(ledger.entries[1], foreignBefore, 'foreign owner and reservation metadata remain byte-equivalent');
  const foreignResponse = await fetch('http://127.0.0.1:' + fixture.foreignPort + '/foreign');
  assert.equal(await foreignResponse.text(), 'foreign-control-live', 'foreign listener remains live after owned cleanup');
  await assertPortCanBind(fixture.deliveryPort);

  const reclaimed = claimLocalFixtureResource(fixture);
  assert.equal(reclaimed.status, 0, reclaimed.stderr);
  const second = invokeLocalFixture({ repo: fixture.repo, evidence: fixture.evidence, env: fixture.env });
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  const secondSummary = summaryFrom(second);
  assert.equal(secondSummary.status, 'passed');
  assert.notEqual(secondSummary.evidence.metadataPath, firstSummary.evidence.metadataPath);
  const secondRecord = JSON.parse(await readFile(secondSummary.evidence.metadataPath, 'utf8'));
  assert.notEqual(secondRecord.localFixture.evidence.nativeOutputDirectory, firstRecord.localFixture.evidence.nativeOutputDirectory,
    'fresh invocation retains a separate producer directory');
  await readFile(firstSummary.evidence.metadataPath, 'utf8');
  ledger = JSON.parse(await readFile(fixture.ledger, 'utf8'));
  assert.equal(ledger.entries[0].resources.includes(fixture.resource), false);
  assert.deepEqual(ledger.entries[1], foreignBefore);
});

test('local fixture rejects invalid ownership and evidence before starting the fixed workload', async (t) => {
  for (const [name, mutate, expectedError] of [
    ['missing resource', (ledger) => { ledger.entries[0].resources = []; }, /CHAIN_NATIVE_PORT.*not allocated/],
    ['changed owner', (ledger, fixture) => { ledger.entries[0].worktree = path.join(fixture.root, 'changed-owner'); }, /exactly one active host coordination entry/],
    ['expired lease', (ledger) => { ledger.entries[0].lease.expiresAt = new Date(Date.now() - 1000).toISOString(); }, /lease.*stale|expired/i],
  ]) {
    await t.test(name, async (t) => {
      const fixture = await createLocalFixture(t);
      const changed = JSON.parse(await readFile(fixture.ledger, 'utf8'));
      mutate(changed, fixture);
      await writeFile(fixture.ledger, JSON.stringify(changed));
      const ledgerBefore = await readFile(fixture.ledger, 'utf8');
      const result = invokeLocalFixture({ repo: fixture.repo, evidence: fixture.evidence, env: fixture.env });
      assert.equal(result.status, 74, `${result.stdout}\n${result.stderr}`);
      const summary = summaryFrom(result);
      assert.equal(summary.status, 'evidence-failure');
      assert.equal(summary.outcome, 'not-started');
      assert.equal(summary.fixture.workloadOutcome, undefined);
      assert.match(summary.evidence.errors[0].message, expectedError);
      await assertNoFixtureOutput(fixture);
      assert.equal(await readFile(fixture.ledger, 'utf8'), ledgerBefore, 'failed readiness must not edit the canonical ledger');
    });
  }

  const badEvidence = await createLocalFixture(t);
  const ledgerBefore = await readFile(badEvidence.ledger, 'utf8');
  const rejected = invokeLocalFixture({
    repo: badEvidence.repo,
    evidence: path.join(badEvidence.repo, 'inside-checkout-evidence'),
    env: badEvidence.env,
  });
  assert.equal(rejected.status, 74, `${rejected.stdout}\n${rejected.stderr}`);
  assert.match(summaryFrom(rejected).evidence.errors[0].message, /outside the candidate Git worktree/);
  const badEvidenceNames = await readdir(badEvidence.repo);
  assert.equal(badEvidenceNames.some((name) => name.startsWith('inside-checkout-evidence-native-output-')), false);
  assert.equal(await readFile(badEvidence.ledger, 'utf8'), ledgerBefore);
  await assert.rejects(stat(path.join(badEvidence.repo, 'inside-checkout-evidence')), { code: 'ENOENT' });
});

test('local fixture rejects help misuse and arbitrary commands without workload or ledger writes', async (t) => {
  const fixture = await createLocalFixture(t);
  const ledgerBefore = await readFile(fixture.ledger, 'utf8');
  const help = spawnSync(node, [recorder, '--help'], { cwd: fixture.repo, encoding: 'utf8', env: fixture.env });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--local-fixture early-group-aggregate/);
  const invalid = invokeLocalFixture({ repo: fixture.repo, evidence: fixture.evidence, env: fixture.env, extraOptions: ['--unknown'] });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Unsupported option for --local-fixture/);
  const arbitrary = invokeLocalFixture({ repo: fixture.repo, evidence: fixture.evidence, env: fixture.env, extraOptions: ['--', 'node', '-e', 'process.exit(77)'] });
  assert.equal(arbitrary.status, 2);
  assert.match(arbitrary.stderr, /fixed child command/);
  await assertNoFixtureOutput(fixture);
  assert.equal(await readFile(fixture.ledger, 'utf8'), ledgerBefore);
  await assert.rejects(stat(fixture.evidence), { code: 'ENOENT' });
});

test('record-run CLI executes through a path alias and importing its readiness helper stays inert', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'record-run-cli-alias-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const alias = path.join(root, 'record-run-alias.mjs');
  await symlink(recorder, alias);

  const help = spawnSync(node, [alias, '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: record-run\.mjs/);
  assert.equal(help.stderr, '');

  const importUrl = new URL('./record-run.mjs', import.meta.url).href;
  const importSource = 'import { validateQualificationReadiness } from ' + JSON.stringify(importUrl)
    + '; process.stdout.write(typeof validateQualificationReadiness + "\\n");';
  const imported = spawnSync(node, ['--input-type=module', '-e', importSource], { cwd: root, encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, 'function\n', 'importing the shared readiness helper must not start the recorder CLI');
  assert.equal(imported.stderr, '');
});

test('local fixture reports child failure separately from successful owned cleanup', async (t) => {
  const fixture = await createLocalFixture(t, { behavior: 'failure' });
  const result = invokeLocalFixture({ repo: fixture.repo, evidence: fixture.evidence, env: fixture.env });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const summary = summaryFrom(result);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.outcome, 'assertion-failure');
  assert.equal(summary.fixture.workloadOutcome, 'assertion-failure');
  assert.equal(summary.fixture.nestedOutcomes.status, 'assertion-failure');
  assert.equal(summary.fixture.cleanup.child.completed, true);
  assert.equal(summary.fixture.cleanup.listener.status, 'closed');
  assert.equal(summary.fixture.cleanup.allocation.status, 'released');
  assert.equal(summary.fixture.cleanup.runtimeDirectory.status, 'removed');
  const ledger = JSON.parse(await readFile(fixture.ledger, 'utf8'));
  assert.equal(ledger.entries[0].resources.includes(fixture.resource), false);
});

test('local fixture interruption finalizes child and allocation cleanup independently', async (t) => {
  const fixture = await createLocalFixture(t, { behavior: 'interrupt' });
  const child = startLocalFixture(fixture);
  const completion = captureProcess(child);
  let result;
  try {
    await waitForFixtureFile(fixture, 'fixture-listener-live.txt');
    child.kill('SIGTERM');
    result = await completion;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await completion;
    }
  }
  assert.equal(result.status, 143, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr, '');
  const summary = JSON.parse(result.stdout.trim());
  assert.equal(summary.status, 'interrupted');
  assert.equal(summary.outcome, 'interrupted');
  assert.equal(summary.fixture.workloadOutcome, 'interrupted');
  assert.equal(summary.fixture.cleanup.child.completed, true);
  assert.equal(summary.fixture.cleanup.listener.status, 'closed');
  assert.equal(summary.fixture.cleanup.allocation.status, 'released');
  assert.equal(summary.fixture.cleanup.runtimeDirectory.status, 'removed');
  const record = JSON.parse(await readFile(summary.evidence.metadataPath, 'utf8'));
  assert.equal(record.state, 'incomplete');
  assert.equal(record.execution.outcome, 'interrupted');
  const ledger = JSON.parse(await readFile(fixture.ledger, 'utf8'));
  assert.equal(ledger.entries[0].resources.includes(fixture.resource), false);
});

test('local fixture preserves a passing workload and allocation when lease identity changes during cleanup', async (t) => {
  const fixture = await createLocalFixture(t, { behavior: 'change-lease', foreignEntry: true });
  const foreignBefore = structuredClone(fixture.foreign);
  const result = invokeLocalFixture({ repo: fixture.repo, evidence: fixture.evidence, env: fixture.env });
  const summary = summaryFrom(result);
  const attempt = JSON.parse(await readFile(summary.evidence.metadataPath, 'utf8'));
  assert.equal(result.status, 74, JSON.stringify({ summary, childStdout: attempt.execution.output.stdout, childStderr: attempt.execution.output.stderr }));
  assert.equal(summary.status, 'evidence-failure');
  assert.equal(summary.outcome, 'passed');
  assert.equal(summary.fixture.workloadOutcome, 'passed');
  assert.equal(summary.fixture.cleanup.child.completed, true);
  assert.equal(summary.fixture.cleanup.listener.status, 'closed');
  assert.equal(summary.fixture.cleanup.allocation.status, 'unresolved');
  assert.match(summary.fixture.cleanup.allocation.error, /allocation identity changed/);
  const ledger = JSON.parse(await readFile(fixture.ledger, 'utf8'));
  assert.equal(ledger.entries[0].resources.includes(fixture.resource), true, 'a changed lease prevents automatic release');
  assert.deepEqual(ledger.entries[1], foreignBefore, 'foreign ledger entry bytes are not rewritten by the local fixture');
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
  const unownedOwner = activeLedgerOwner({
    id: 'fixture-owner',
    worktree: unowned.canonicalRepo,
    resources: [`loopback:127.0.0.1:${unowned.deliveryPort}`],
  });
  await writeFile(unowned.ledger, JSON.stringify({ version: 1, scope: 'codex-wide', entries: [unownedOwner] }));
  await assertQualificationSetupRejected(t, unowned, { expectedError: /CHAIN_NATIVE_SMOKE_PORT.*active worktree/ });

  const conflict = await createQualificationFixture(t);
  const conflictOwner = activeLedgerOwner({
    id: 'fixture-owner',
    worktree: conflict.canonicalRepo,
    resources: [`loopback:127.0.0.1:${conflict.deliveryPort}`, `loopback:127.0.0.1:${conflict.smokePort}`],
  });
  const otherOwner = activeLedgerOwner({
    id: 'other-owner',
    worktree: path.join(conflict.root, 'other-repo'),
    resources: [`loopback:127.0.0.1:${conflict.smokePort}`],
    status: 'parked',
  });
  await writeFile(conflict.ledger, JSON.stringify({ version: 1, scope: 'codex-wide', entries: [
    conflictOwner,
    otherOwner,
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

test('keeps ordinary and compact callers compatible for large failures and changed-source evidence', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-caller-compatibility-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const sourcePath = path.join(repo, 'src/app.js');
  await writeFile(sourcePath, 'export const value = 2;\n');
  const stdoutSecret = 'COMPAT-STDOUT-SECRET-19d2';
  const stderrSecret = 'COMPAT-STDERR-SECRET-b510';
  const child = `process.stdout.write('O'.repeat(128 * 1024) + ' token=${stdoutSecret}\\n'); process.stderr.write('E'.repeat(96 * 1024) + ' password=${stderrSecret}\\n'); process.exitCode = 7;`;
  const expectedStdout = `${'O'.repeat(128 * 1024)} token=[REDACTED]\n`;
  const expectedStderr = `${'E'.repeat(96 * 1024)} password=[REDACTED]\n`;
  const ordinaryEvidence = path.join(temp, 'ordinary-evidence');
  const ordinary = invokeRecorder({
    repo,
    evidence: ordinaryEvidence,
    purpose: 'green',
    command: node,
    args: ['-e', child],
  });

  assert.equal(ordinary.status, 7, 'the default stream mode preserves the actual child exit');
  assert.equal(ordinary.stdout, expectedStdout, 'existing ordinary callers still receive the full sanitized stdout');
  assert.ok(ordinary.stderr.includes(expectedStderr), 'existing ordinary callers still receive the full sanitized stderr');
  const ordinaryMetadataPath = evidencePathFrom(ordinary);
  const ordinaryRecordBytes = await readFile(ordinaryMetadataPath);
  const ordinaryRecord = JSON.parse(ordinaryRecordBytes.toString('utf8'));
  assert.equal(ordinaryRecord.execution.exitCode, 7);
  assert.equal(ordinaryRecord.execution.signal, null);
  assert.equal(ordinaryRecord.execution.outcome, 'nonzero-exit');
  assert.equal(ordinaryRecord.state, 'complete');
  assert.equal(ordinaryRecord.execution.output.stdout, expectedStdout);
  assert.equal(ordinaryRecord.execution.output.stderr, expectedStderr);

  const compactEvidence = path.join(temp, 'compact-evidence');
  const compact = invokeRecorder({
    repo,
    evidence: compactEvidence,
    purpose: 'green',
    command: node,
    args: ['-e', child],
    extraOptions: ['--summary'],
  });

  assert.equal(compact.status, 7, 'summary mode also preserves the actual child exit');
  assert.ok(Buffer.byteLength(compact.stdout) + Buffer.byteLength(compact.stderr) < 2048,
    'the compact caller remains bounded as child output grows');
  const compactSummary = summaryFrom(compact);
  assert.equal(compactSummary.status, 'failed');
  assert.equal(compactSummary.outcome, 'nonzero-exit');
  assert.deepEqual(compactSummary.child, { exitCode: 7, signal: null });
  const compactRecordBytes = await readFile(compactSummary.evidence.metadataPath);
  const compactRecord = JSON.parse(compactRecordBytes.toString('utf8'));
  assert.equal(compactRecord.execution.output.stdout, expectedStdout);
  assert.equal(compactRecord.execution.output.stderr, expectedStderr);
  assert.equal(await readFile(compactSummary.evidence.stdoutPath, 'utf8'), expectedStdout);
  assert.equal(await readFile(compactSummary.evidence.stderrPath, 'utf8'), expectedStderr);

  for (const record of [ordinaryRecord, compactRecord]) {
    assert.equal(record.workingTree.identity.status, 'complete');
    assert.match(record.workingTree.sourceTestDiffSha256, /^[a-f0-9]{64}$/);
    const changedSource = record.workingTree.sourceTestFiles.find(file => file.path === 'src/app.js');
    assert.ok(changedSource, 'the changed source remains attributed to the recorded attempt');
    assert.match(changedSource.actualBytesSha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(record).includes(stdoutSecret), false);
    assert.equal(JSON.stringify(record).includes(stderrSecret), false);
    assert.equal(record.execution.output.stdout.includes(stdoutSecret), false);
    assert.equal(record.execution.output.stderr.includes(stderrSecret), false);
  }
  assert.equal(ordinaryRecord.workingTree.sourceTestDiffSha256, compactRecord.workingTree.sourceTestDiffSha256,
    'ordinary and compact callers identify the same unchanged source diff');
  for (const [pathValue, secret] of [
    [ordinaryMetadataPath, stdoutSecret], [ordinaryMetadataPath, stderrSecret],
    [compactSummary.evidence.metadataPath, stdoutSecret], [compactSummary.evidence.metadataPath, stderrSecret],
    [compactSummary.evidence.stdoutPath, stdoutSecret], [compactSummary.evidence.stderrPath, stderrSecret],
  ]) assert.equal((await readFile(pathValue, 'utf8')).includes(secret), false, `${path.basename(pathValue)} stays redacted`);
  assert.equal(ordinary.stdout.includes(stdoutSecret), false);
  assert.equal(ordinary.stderr.includes(stderrSecret), false);
  assert.equal(compact.stdout.includes(stdoutSecret), false);
  assert.equal(compact.stdout.includes(stderrSecret), false);
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

test('redacts synthetic secrets from every summary and provenance surface while preserving the child failure', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-run-secret-surfaces-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const stdoutSecret = 'RECORDER-STDOUT-SECRET-415a';
  const stderrSecret = 'RECORDER-STDERR-SECRET-730b';
  const argumentSecret = 'RECORDER-ARGUMENT-SECRET-841c';
  const sourceSecret = 'RECORDER-SOURCE-SECRET-952d';
  const sourcePath = path.join(repo, 'src', 'evidence.test.mjs');
  await writeFile(sourcePath, `export const token = "${sourceSecret}";\n`);
  const child = `const token=process.argv[2];process.stdout.write('O'.repeat(64*1024)+' token='+token+' ${stdoutSecret}\\n');process.stderr.write('AssertionError: password='+token+' ${stderrSecret}\\n');process.exitCode=7;`;

  const result = invokeRecorder({
    repo,
    evidence,
    purpose: 'green',
    command: node,
    args: ['-e', child, '--', '--token', argumentSecret],
    extraOptions: ['--summary', '--redact-pattern', stdoutSecret, '--redact-pattern', stderrSecret],
  });

  assert.equal(result.status, 7, result.stderr);
  assert.ok(Buffer.byteLength(result.stdout) < 2048, 'summary output stays bounded while child output grows');
  const summary = summaryFrom(result);
  const serializedSummary = JSON.stringify(summary);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.outcome, 'assertion-failure');
  assert.equal(summary.wrapperExitCode, 7);
  assert.deepEqual(summary.child, { exitCode: 7, signal: null });
  assert.equal(summary.evidence.status, 'complete');
  assert.equal(summary.source.identityStatus, 'complete');
  assert.match(summary.source.diffSha256, /^[a-f0-9]{64}$/);
  for (const secret of [stdoutSecret, stderrSecret, argumentSecret, sourceSecret]) {
    assert.equal(serializedSummary.includes(secret), false, 'bounded console summary must be secret-free');
  }

  const recordPath = summary.evidence.metadataPath;
  const recordBytes = await readFile(recordPath, 'utf8');
  const record = JSON.parse(recordBytes);
  assert.equal(record.execution.outcome, 'assertion-failure');
  assert.equal(record.execution.exitCode, 7);
  assert.equal(record.execution.signal, null);
  assert.equal(record.git.commit, summary.source.commit);
  assert.equal(record.workingTree.identity.status, 'complete');
  assert.match(record.workingTree.sourceTestDiffSha256, /^[a-f0-9]{64}$/);
  assert.equal(record.command.args.at(-2), '--token');
  assert.equal(record.command.args.at(-1), '[REDACTED]');
  assert.ok(record.redaction.locations['command.args[4]'] > 0);

  const capturedSource = record.workingTree.sourceTestFiles.find((file) => file.path === 'src/evidence.test.mjs');
  assert.ok(capturedSource, 'changed source remains part of the recorded provenance');
  assert.equal(capturedSource.status, 'untracked');
  assert.match(capturedSource.content, /token = \[REDACTED\]/);
  assert.equal(capturedSource.content.includes(sourceSecret), false);
  assert.match(record.execution.output.stdout, /^O{65536} token=\[REDACTED\] \[REDACTED\]$/m);
  assert.equal(record.execution.output.stderr, 'AssertionError: password=[REDACTED] [REDACTED]\n');
  assert.equal(await readFile(summary.evidence.stdoutPath, 'utf8'), record.execution.output.stdout);
  assert.equal(await readFile(summary.evidence.stderrPath, 'utf8'), record.execution.output.stderr);

  const evidenceFiles = await readdir(evidence);
  assert.deepEqual(evidenceFiles.sort(), [path.basename(recordPath), path.basename(summary.evidence.stdoutPath), path.basename(summary.evidence.stderrPath)].sort());
  for (const file of evidenceFiles) {
    const bytes = await readFile(path.join(evidence, file), 'utf8');
    for (const secret of [stdoutSecret, stderrSecret, argumentSecret, sourceSecret]) {
      assert.equal(bytes.includes(secret), false, `${file} must not retain synthetic secrets`);
    }
  }
  assert.equal(recordBytes.includes(stdoutSecret), false);
  assert.equal(recordBytes.includes(stderrSecret), false);
  assert.equal(recordBytes.includes(argumentSecret), false);
  assert.equal(recordBytes.includes(sourceSecret), false);
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

test('preserves an ordinary TAP case identity containing the word token through recording', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-tap-token-name-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = process.env.CHAIN_RECORDER_TAP_TEST_EVIDENCE_DIR
    ? path.resolve(process.env.CHAIN_RECORDER_TAP_TEST_EVIDENCE_DIR)
    : path.join(temp, 'evidence');
  const caseName = 'token results keep their full nonsecret identity';
  const testFile = path.join(repo, 'token-case.test.mjs');
  await writeFile(testFile, `import { test } from 'node:test';\ntest(${JSON.stringify(caseName)}, () => {});\n`);

  const result = invokeRecorder({
    repo,
    evidence,
    purpose: 'green',
    command: node,
    args: ['--test', '--test-reporter=tap', testFile],
  });

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(await readFile(evidencePathFrom(result), 'utf8'));
  const tapOutput = record.execution.output.stdout;
  const cases = parseTap(tapOutput).map(({ id, root, status, skipReason }) => ({ id, root, status, skipReason }));
  assert.deepEqual(cases, [{ id: caseName, root: caseName, status: 'passed', skipReason: null }]);
  assert.match(tapOutput, /^1\.\.1$/m);
  assert.match(tapOutput, /^# tests 1$/m);
  assert.match(tapOutput, /^# pass 1$/m);
  assert.match(tapOutput, /^# fail 0$/m);
  assert.equal(record.execution.exitCode, 0);
  assert.equal(record.execution.outcome, 'passed');
});

test('redacts a secret-bearing TAP token identity without losing its status or plain-log sanitization', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-tap-token-secret-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = process.env.CHAIN_RECORDER_TAP_TEST_EVIDENCE_DIR
    ? path.resolve(process.env.CHAIN_RECORDER_TAP_TEST_EVIDENCE_DIR)
    : path.join(temp, 'evidence');
  const secret = 'TAP-NAME-SECRET-8c14a19f';
  const caseName = `token=${secret}`;
  const testFile = path.join(repo, 'token-secret-case.test.mjs');
  const diagnosticLine = `token ${secret}\n`;
  await writeFile(testFile, `import { test } from 'node:test';\ntest(${JSON.stringify(caseName)}, () => process.stderr.write(${JSON.stringify(diagnosticLine)}));\n`);

  const result = invokeRecorder({
    repo,
    evidence,
    purpose: 'green',
    command: node,
    args: ['--test', '--test-reporter=tap', testFile],
  });

  assert.equal(result.status, 0, result.stderr);
  const recordBytes = await readFile(evidencePathFrom(result), 'utf8');
  const record = JSON.parse(recordBytes);
  const tapOutput = record.execution.output.stdout;
  const cases = parseTap(tapOutput).map(({ id, root, status, skipReason }) => ({ id, root, status, skipReason }));
  assert.deepEqual(cases, [{ id: 'token=[REDACTED]', root: 'token=[REDACTED]', status: 'passed', skipReason: null }]);
  assert.match(tapOutput, /^# token \[REDACTED\]$/m, 'bare token/value log syntax stays protected outside TAP identity context');
  assert.match(tapOutput, /^# tests 1$/m);
  assert.match(tapOutput, /^# pass 1$/m);
  assert.match(tapOutput, /^# fail 0$/m);
  assert.equal(recordBytes.includes(secret), false, 'the persisted metadata must not contain the synthetic secret');
  assert.equal(record.execution.exitCode, 0);
});

test('preserves adjacent nested TAP records across multiline secret redaction', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-tap-multiline-secret-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = process.env.CHAIN_RECORDER_TAP_TEST_EVIDENCE_DIR
    ? path.resolve(process.env.CHAIN_RECORDER_TAP_TEST_EVIDENCE_DIR)
    : path.join(temp, 'evidence');
  const firstLineSecret = 'MULTILINE-RECORDER-SECRET-BEGIN-591a';
  const secondLineSecret = 'MULTILINE-RECORDER-SECRET-CONTINUED-602b';
  const testFile = path.join(repo, 'multiline-tap.test.mjs');
  const rawTapOutput = [
    'TAP version 13',
    '# Subtest: outer case',
    '    # token',
    '    # Subtest: nested case',
    '    ok 1 - nested case',
    '    1..1',
    'ok 1 - outer case',
    '1..1',
    '# tests 2',
    '# suites 0',
    '# pass 2',
    '# fail 0',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    '# duration_ms 1',
    `# "password": "${firstLineSecret}\n    # ${secondLineSecret}"`,
    '',
  ].join('\n');
  await writeFile(testFile, `process.stdout.write(${JSON.stringify(rawTapOutput)});\n`);

  const result = invokeRecorder({
    repo,
    evidence,
    purpose: 'green',
    command: node,
    args: [testFile],
    extraOptions: ['--summary'],
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = summaryFrom(result);
  assert.equal(summary.status, 'passed');
  assert.equal(summary.outcome, 'passed');
  assert.equal(summary.evidence.status, 'complete');
  assert.equal(summary.source.identityStatus, 'complete');
  assert.equal(JSON.stringify(summary).includes(firstLineSecret), false);
  assert.equal(JSON.stringify(summary).includes(secondLineSecret), false);
  const recordPath = summary.evidence.metadataPath;
  const recordBytes = await readFile(recordPath, 'utf8');
  const record = JSON.parse(recordBytes);
  assert.equal(record.workingTree.identity.status, 'complete');
  const tapOutput = record.execution.output.stdout;
  const cases = parseTap(record.execution.output.stdout).map(({ id, root, status, skipReason }) => ({ id, root, status, skipReason }));
  assert.deepEqual(cases, [
    { id: 'outer case > nested case', root: 'outer case', status: 'passed', skipReason: null },
    { id: 'outer case', root: 'outer case', status: 'passed', skipReason: null },
  ]);
  assert.match(tapOutput, /^# tests 2$/m);
  assert.match(tapOutput, /^# pass 2$/m);
  assert.match(tapOutput, /^# fail 0$/m);
  assert.equal(await readFile(summary.evidence.stdoutPath, 'utf8'), tapOutput, 'the retained stream matches the parsed sanitized protocol');
  assert.equal(tapOutput.includes(firstLineSecret), false);
  assert.equal(tapOutput.includes(secondLineSecret), false);
  assert.equal(recordBytes.includes(firstLineSecret), false);
  assert.equal(recordBytes.includes(secondLineSecret), false);
  const capturedSource = record.workingTree.sourceTestFiles.find((file) => file.path === 'multiline-tap.test.mjs');
  assert.ok(capturedSource, 'the child fixture remains in captured source provenance');
  assert.equal(capturedSource.content.includes(firstLineSecret), false);
  assert.equal(capturedSource.content.includes(secondLineSecret), false);
  assert.equal(record.execution.outcome, 'passed');
  assert.equal(record.execution.exitCode, 0);
});

test('reconciles nested token and ordinary cases and keeps corrected redacted evidence immutable', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-tap-nested-outcomes-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const secret = 'NESTED-TAP-SECRET-661c';
  const testFile = path.join(repo, 'nested-outcomes.test.mjs');
  await writeFile(testFile, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('token parent result', async (t) => {\n  await t.test('ordinary child', () => {});\n  await t.test('token failure child', (child) => {\n    child.diagnostic('"password": "${secret}"');\n    assert.fail('controlled nested assertion');\n  });\n});\n`);

  const run = (purpose, extraOptions = []) => invokeRecorder({
    repo,
    evidence,
    purpose,
    command: node,
    args: ['--test', '--test-reporter=tap', testFile],
    extraOptions: ['--summary', ...extraOptions],
  });
  const first = run('green');

  assert.equal(first.status, 1, first.stderr);
  const firstSummary = summaryFrom(first);
  assert.equal(firstSummary.status, 'failed');
  assert.equal(firstSummary.outcome, 'assertion-failure');
  assert.deepEqual(firstSummary.child, { exitCode: 1, signal: null });
  const firstMetadataPath = firstSummary.evidence.metadataPath;
  const firstStdoutPath = firstSummary.evidence.stdoutPath;
  const firstStderrPath = firstSummary.evidence.stderrPath;
  const firstBytes = await readFile(firstMetadataPath);
  const firstStdout = await readFile(firstStdoutPath);
  const firstStderr = await readFile(firstStderrPath);
  const firstRecord = JSON.parse(firstBytes.toString('utf8'));
  const firstTap = firstStdout.toString('utf8');
  const cases = parseTap(firstTap).map(({ id, root, status, skipReason }) => ({ id, root, status, skipReason }));
  assert.deepEqual(cases, [
    { id: 'token parent result > ordinary child', root: 'token parent result', status: 'passed', skipReason: null },
    { id: 'token parent result > token failure child', root: 'token parent result', status: 'failed', skipReason: null },
    { id: 'token parent result', root: 'token parent result', status: 'failed', skipReason: null },
  ]);
  assert.match(firstTap, /^# tests 3$/m);
  assert.match(firstTap, /^# pass 1$/m);
  assert.match(firstTap, /^# fail 2$/m);
  assert.equal(firstRecord.execution.outcome, 'assertion-failure');
  assert.equal(firstRecord.execution.exitCode, 1);
  for (const bytes of [firstBytes, firstStdout, firstStderr, Buffer.from(JSON.stringify(firstSummary))]) {
    assert.equal(bytes.includes(secret), false, 'the first attempt must retain only redacted payloads');
  }
  const capturedSource = firstRecord.workingTree.sourceTestFiles.find((file) => file.path === 'nested-outcomes.test.mjs');
  assert.ok(capturedSource);
  assert.equal(capturedSource.content.includes(secret), false);

  const correctionNote = 'Later controlled replay; original remains immutable.';
  const corrected = run('later-baseline-sensitivity', ['--correction-of', firstRecord.id, '--correction-note', correctionNote]);
  assert.equal(corrected.status, 1, corrected.stderr);
  const correctedSummary = summaryFrom(corrected);
  const correctedRecord = JSON.parse(await readFile(correctedSummary.evidence.metadataPath, 'utf8'));
  assert.notEqual(correctedRecord.id, firstRecord.id);
  assert.deepEqual(correctedRecord.correction, { originalRecordId: firstRecord.id, note: correctionNote });
  assert.deepEqual(await readFile(firstMetadataPath), firstBytes);
  assert.deepEqual(await readFile(firstStdoutPath), firstStdout);
  assert.deepEqual(await readFile(firstStderrPath), firstStderr);
  for (const file of await readdir(evidence)) {
    assert.equal((await readFile(path.join(evidence, file))).includes(secret), false, `${file} must stay secret-free`);
  }
});

test('preserves passed, skipped, TODO, and failed TAP cases with their bounded summary totals', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-tap-terminal-statuses-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const secret = 'RECORDER-STATUS-SECRET-913e';
  const testFile = path.join(repo, 'terminal-statuses.test.mjs');
  await writeFile(testFile, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('token passing case', () => {});\ntest('accepted optional case', { skip: 'accepted fixture skip' }, () => {});\ntest('required case remains skipped', { skip: 'forbidden required skip' }, () => {});\ntest.todo('TODO case remains distinct');\ntest('required failing case', () => assert.fail('password=${secret}'));\n`);

  const result = invokeRecorder({
    repo,
    evidence,
    purpose: 'green',
    command: node,
    args: ['--test', '--test-reporter=tap', testFile],
    extraOptions: ['--summary'],
  });

  assert.equal(result.status, 1, result.stderr);
  assert.ok(Buffer.byteLength(result.stdout) < 2048, 'console summary remains bounded');
  const summary = summaryFrom(result);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.outcome, 'assertion-failure');
  assert.deepEqual(summary.child, { exitCode: 1, signal: null });
  const recordBytes = await readFile(summary.evidence.metadataPath);
  const record = JSON.parse(recordBytes.toString('utf8'));
  const tap = await readFile(summary.evidence.stdoutPath, 'utf8');
  const cases = parseTap(tap).map(({ id, root, status, skipReason }) => ({ id, root, status, skipReason }));
  assert.deepEqual(cases, [
    { id: 'token passing case', root: 'token passing case', status: 'passed', skipReason: null },
    { id: 'accepted optional case', root: 'accepted optional case', status: 'skipped', skipReason: 'accepted fixture skip' },
    { id: 'required case remains skipped', root: 'required case remains skipped', status: 'skipped', skipReason: 'forbidden required skip' },
    { id: 'TODO case remains distinct', root: 'TODO case remains distinct', status: 'todo', skipReason: null },
    { id: 'required failing case', root: 'required failing case', status: 'failed', skipReason: null },
  ]);
  assert.match(tap, /^# tests 5$/m);
  assert.match(tap, /^# pass 1$/m);
  assert.match(tap, /^# fail 1$/m);
  assert.match(tap, /^# skipped 2$/m);
  assert.match(tap, /^# todo 1$/m);
  assert.equal(record.execution.outcome, 'assertion-failure');
  assert.equal(record.execution.exitCode, 1);
  assert.equal(record.execution.output.stdout, tap);
  assert.equal(record.execution.output.stderr.includes(secret), false);
  assert.equal(recordBytes.includes(secret), false);
  assert.equal(tap.includes(secret), false);
  assert.equal(JSON.stringify(summary).includes(secret), false);
});

test('keeps a cancelled child non-successful when only partial TAP was retained', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'record-tap-cancelled-child-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = await createCommittedRepository(temp);
  const evidence = path.join(temp, 'evidence');
  const secret = 'RECORDER-CANCELLED-SECRET-a41d';
  const partialTap = [
    'TAP version 13',
    '# Subtest: interrupted after one case',
    'ok 1 - interrupted after one case',
    `# "password": "${secret}"`,
    '',
  ].join('\n');
  const child = `process.stdout.write(${JSON.stringify(partialTap)}, () => process.kill(process.pid, 'SIGTERM'));`;

  const result = invokeRecorder({
    repo,
    evidence,
    purpose: 'green',
    command: node,
    args: ['-e', child],
    extraOptions: ['--summary'],
  });

  assert.equal(result.status, 143, result.stderr);
  assert.ok(Buffer.byteLength(result.stdout) < 2048, 'interruption summary remains bounded');
  const summary = summaryFrom(result);
  assert.equal(summary.status, 'interrupted');
  assert.equal(summary.outcome, 'interrupted');
  assert.deepEqual(summary.child, { exitCode: null, signal: 'SIGTERM' });
  assert.equal(summary.wrapperExitCode, 143);
  const recordBytes = await readFile(summary.evidence.metadataPath);
  const record = JSON.parse(recordBytes.toString('utf8'));
  const tap = await readFile(summary.evidence.stdoutPath, 'utf8');
  assert.deepEqual(parseTap(tap).map(({ id, root, status }) => ({ id, root, status })), [
    { id: 'interrupted after one case', root: 'interrupted after one case', status: 'passed' },
  ]);
  assert.equal(/^# (?:tests|pass|fail)\b/m.test(tap), false, 'partial cases do not acquire a fabricated complete summary');
  assert.equal(record.state, 'incomplete');
  assert.equal(record.execution.outcome, 'interrupted');
  assert.equal(record.execution.signal, 'SIGTERM');
  assert.equal(recordBytes.includes(secret), false);
  assert.equal(tap.includes(secret), false);
  assert.equal(JSON.stringify(summary).includes(secret), false);
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
