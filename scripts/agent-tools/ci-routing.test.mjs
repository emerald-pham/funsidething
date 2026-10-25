import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const command = path.join(repo, 'scripts/agent-tools/ci-routing.mjs');
const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'chain-ci-routing-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), bin = path.join(root, 'bin');
  mkdirSync(source); mkdirSync(bin);
  git(source, 'init', '-b', 'fixture');
  git(source, 'config', 'user.name', 'Routing fixture');
  git(source, 'config', 'user.email', 'routing@example.invalid');
  writeFileSync(path.join(source, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test tests.js' } }));
  writeFileSync(path.join(source, 'tests.js'), "import { test } from 'node:test';test('isolated routing fixture',()=>{});\n");
  git(source, 'add', '.'); git(source, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture base');
  const base = git(source, 'rev-parse', 'HEAD');
  writeFileSync(path.join(source, 'candidate.txt'), 'isolated candidate\n');
  git(source, 'add', '.'); git(source, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture candidate');
  const head = git(source, 'rev-parse', 'HEAD');
  const tree = git(source, 'rev-parse', 'HEAD^{tree}');
  const merge = git(source, 'commit-tree', tree, '-p', base, '-p', head, '-m', 'synthetic fixture PR merge');
  const journal = path.join(root, 'executions.jsonl');
  const external = path.join(root, 'github.json');
  writeFileSync(external, JSON.stringify({ runs: [], jobs: [] }));
  writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.ROUTING_EXECUTIONS, JSON.stringify({argv:process.argv.slice(2),sha:process.env.GITHUB_SHA})+'\\n');\n`);
  writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env node
const fs=require('node:fs'),x=JSON.parse(fs.readFileSync(process.env.ROUTING_GITHUB));
const url=process.argv.at(-1);
if(url.includes('/runs?')&&x.runSequence?.length){x.runs=x.runSequence.shift();fs.writeFileSync(process.env.ROUTING_GITHUB,JSON.stringify(x));}
if(url.includes('/pulls?')&&x.pullSequence?.length){x.pulls=x.pullSequence.shift();fs.writeFileSync(process.env.ROUTING_GITHUB,JSON.stringify(x));}
if(x.error){process.stderr.write('controlled unavailable GitHub');process.exit(22);}
console.log(JSON.stringify(url.includes('/jobs?')?{total_count:x.jobs.length,jobs:x.jobs}:url.includes('/pulls?')?(x.pulls??[]):url.includes('/git/commits/')?x.merge:{total_count:x.omitRunTotal?undefined:x.runs.length,workflow_runs:x.runs}));
`);
  writeFileSync(path.join(bin, 'node'), '#!/bin/sh\nif [ "$1" = "-p" ] && [ "$ROUTING_READ_FAILURE" = "1" ]; then exit 1; fi\nexec ' + JSON.stringify(process.execPath) + ' "$@"\n');
  chmodSync(path.join(bin, 'node'), 0o755);
  chmodSync(path.join(bin, 'npm'), 0o755); chmodSync(path.join(bin, 'curl'), 0o755);
  return { root, source, bin, base, head, merge, tree, journal, external, attempt: 0 };
}

function cohortShell() {
  const workflow = readFileSync(path.join(repo, '.github/workflows/data-safety.yml'), 'utf8');
  const step = workflow.match(/      - name: Run complete regression cohort\n[\s\S]*?        run: \|\n((?:          [^\n]*\n|\n)*)/);
  if (!step) {
    assert.match(workflow, /      - run: npm test\n/, 'execute the current workflow cohort entry point');
    return 'npm test';
  }
  return step[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n')
    .replaceAll('node scripts/agent-tools/ci-routing.mjs', 'node "$ROUTING_COMMAND" --max-wait-ms 1000 --poll-interval-ms 1')
    .replaceAll('${{ steps.diff-base.outputs.sha }}', '$ROUTING_BASE')
    .replaceAll('${{ runner.temp }}', '$ROUTING_OUTPUT');
}

function invoke(f, { event = 'push', ref = 'refs/heads/topic', source = f.head, checkout = f.head, base = f.base, action = 'synchronize', environment = {} } = {}) {
  git(f.source, 'checkout', '--detach', checkout);
  const output = path.join(f.root, `attempt-${++f.attempt}`);
  mkdirSync(output);
  const eventPath = path.join(output, 'event.json');
  writeFileSync(eventPath, JSON.stringify(event === 'pull_request' ? {
    action, number: 17, pull_request: { number: 17, head: { sha: source, repo: { full_name: 'fixture/repo' } }, base: { sha: base, ref: 'main' } },
  } : { after: source, before: base, repository: { full_name: 'fixture/repo' } }));
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', cohortShell()], {
    cwd: f.source, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PATH: f.bin + path.delimiter + process.env.PATH,
      ROUTING_COMMAND: command, ROUTING_BASE: base, ROUTING_OUTPUT: output,
      ROUTING_EXECUTIONS: f.journal, ROUTING_GITHUB: f.external,
      GITHUB_REPOSITORY: 'fixture/repo', GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: eventPath,
      GITHUB_REF: ref, GITHUB_SHA: checkout, GITHUB_RUN_ID: String(100 + f.attempt),
      GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: path.join(output, 'outputs'), CI: 'true', ...environment },
  });
  const record = path.join(output, 'ci-routing', 'routing.json');
  return { ...result, record: existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : null };
}

function published(f, record) {
  writeFileSync(f.external, JSON.stringify({
    pulls: [{ number: 17, state: 'open', mergeable: true, merge_commit_sha: f.merge, head: { sha: f.head, ref: 'topic', repo: { full_name: 'fixture/repo' } }, base: { sha: f.base, ref: 'main', repo: { full_name: 'fixture/repo' } } }],
    merge: { sha: f.merge, tree: { sha: f.tree }, parents: [{ sha: f.base }, { sha: f.head }] },
    runs: [{
    id: 71, run_attempt: 2, status: 'completed', conclusion: 'success', event: 'pull_request',
    name: 'Data safety', path: '.github/workflows/data-safety.yml', head_sha: f.head,
    repository: { full_name: 'fixture/repo' }, head_repository: { full_name: 'fixture/repo' },
  }], jobs: [{ name: 'scanner-tests', status: 'completed', conclusion: 'success', run_id: 71, run_attempt: 2, head_sha: f.head,
    steps: [
      { name: `Announce regression context ${record?.contextSha256 ?? '0'.repeat(64)}`, conclusion: 'success', status: 'completed' },
      { name: `Complete regression context ${record?.contextSha256 ?? '0'.repeat(64)}`, conclusion: 'success', status: 'completed' }]  }] }));
}

const executions = f => existsSync(f.journal) ? readFileSync(f.journal, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];

test('workflow avoids a second complete cohort only for an already successful exact validation context', t => {
  const f = fixture(t);
  const first = invoke(f, { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge });
  assert.equal(first.status, 0, first.stderr);
  published(f, first.record);
  const second = invoke(f);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(executions(f).length, 1, 'an equivalent completed cohort must not execute twice');
  assert.equal(second.record?.decision, 'reuse');
  assert.deepEqual(second.record?.coveredBy, { runId: '71', runAttempt: '2', checkoutSha: f.merge, checkoutTree: f.tree, comparisonBase: f.base });
});


test('workflow waits for a pending canonical producer without treating pending work as success', t => {
  const f = fixture(t);
  const producer = invoke(f, { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge });
  published(f, producer.record);
  const github = JSON.parse(readFileSync(f.external, 'utf8'));
  github.runSequence = [[{ ...github.runs[0], status: 'in_progress', conclusion: null }], github.runs];
  writeFileSync(f.external, JSON.stringify(github));
  const result = invoke(f);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(executions(f).length, 1, 'a pending equivalent producer must finish before avoiding a duplicate execution');
  assert.equal(result.record?.decision, 'reuse');
  assert.ok(result.record.observations.filter(x => x.url.includes('/runs?')).length >= 2);
});

const fallbackCases = [
  ['standalone branch', x => { x.pulls = []; }],
  ['ambiguous PRs', x => { x.pulls.push(x.pulls[0]); }],
  ['fork PR', x => { x.pulls[0].head.repo.full_name = 'fork/repo'; }],
  ['changed source head', x => { x.pulls[0].head.sha = 'a'.repeat(40); }],
  ['different source branch', x => { x.pulls[0].head.ref = 'other-branch'; }],
  ['uncertain mergeability', x => { x.pulls[0].mergeable = null; }],
  ['changed PR base', x => { x.pulls[0].base.sha = 'b'.repeat(40); }],
  ['changed merge parent', x => { x.merge.parents[1].sha = 'c'.repeat(40); }],
  ['changed merge tree', x => { x.merge.tree.sha = 'd'.repeat(40); }],
  ['changed merge checkout', x => { x.pulls[0].merge_commit_sha = 'e'.repeat(40); x.merge.sha = 'e'.repeat(40); }],
  ['different producer repository', x => { x.runs[0].repository.full_name = 'other/repo'; }],
  ['different producer head repository', x => { x.runs[0].head_repository.full_name = 'other/repo'; }],
  ['unknown workflow', x => { x.runs[0].path = '.github/workflows/other.yml'; }],
  ['different producer source', x => { x.runs[0].head_sha = 'a'.repeat(40); }],
  ['unknown event policy', x => { x.runs[0].event = 'workflow_dispatch'; }],
  ['unavailable external observation', x => { x.error = true; }],
  ['missing aggregate', x => { x.jobs = []; }],
  ['duplicate aggregate', x => { x.jobs.push(x.jobs[0]); }],
  ['missing complete reconciliation marker', x => { x.jobs[0].steps.pop(); }],
  ['different complete cohort identity', x => { x.jobs[0].steps.forEach(step => { step.name = step.name.slice(0, -64) + '0'.repeat(64); }); }],
  ['ambiguous completion marker', x => { x.jobs[0].steps.push(x.jobs[0].steps[1]); }],
  ['skipped completion attestation', x => { x.jobs[0].steps[1].conclusion = 'skipped'; }],
  ['different producer attempt', x => { x.jobs[0].run_attempt = 1; }],
  ['different producer run', x => { x.jobs[0].run_id = 72; }],
  ['unknown producer lifecycle', x => { x.runs[0].status = 'unclassified'; }],
  ['missing producer inventory count', x => { x.omitRunTotal = true; }],
];

for (const [name, change] of fallbackCases) {
  test(`workflow runs the actual branch cohort for ${name}`, t => {
    const f = fixture(t);
    const producer = invoke(f, { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge });
    published(f, producer.record);
    const github = JSON.parse(readFileSync(f.external, 'utf8'));
    change(github);
    writeFileSync(f.external, JSON.stringify(github));
    const result = invoke(f);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.record?.decision, 'full', result.stdout);
    assert.equal(executions(f).length, 2, `${name} must retain the branch's complete execution`);
    assert.equal(executions(f)[1].sha, f.head, 'fallback retains the actual outgoing checkout');
    assert.equal(result.record?.coveredBy, null);
  });
}

for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
  test(`workflow refuses a known exact canonical producer ${conclusion}`, t => {
    const f = fixture(t);
    const producer = invoke(f, { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge });
    published(f, producer.record);
    const github = JSON.parse(readFileSync(f.external, 'utf8'));
    github.runs[0].conclusion = conclusion;
    github.jobs[0].conclusion = conclusion;
    github.jobs[0].steps.pop();
    writeFileSync(f.external, JSON.stringify(github));
    const result = invoke(f);
    assert.notEqual(result.status, 0);
    assert.equal(result.record?.decision, 'fail');
    assert.equal(executions(f).length, 1, 'a known producer failure must not be converted to a passing consumer');
  });
}

test('exact main and fresh PR events execute their own cohort despite matching prior producer observations', t => {
  const f = fixture(t);
  const producer = invoke(f, { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge });
  published(f, producer.record);
  for (const event of [
    { event: 'push', ref: 'refs/heads/main' },
    { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge, action: 'opened' },
    { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge, action: 'edited' },
  ]) {
    const result = invoke(f, event);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.record?.decision, 'full');
    assert.equal(result.record.observations.length, 0, 'main and PR do not wait on another candidate');
  }
  assert.equal(executions(f).length, 4);
});

test('workflow refuses an outgoing source that differs from its actual push checkout', t => {
  const f = fixture(t);
  const producer = invoke(f, { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge });
  published(f, producer.record);
  const result = invoke(f, { checkout: f.base });
  assert.notEqual(result.status, 0, 'an inconsistent source/actual-checkout pair must not produce passing routing');
  assert.equal(executions(f).length, 1);
});


for (const field of ['source', 'base', 'merge']) {
  test(`workflow rechecks the final PR ${field} before accepting producer reuse`, t => {
    const f = fixture(t);
    const producer = invoke(f, { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge });
    published(f, producer.record);
    const github = JSON.parse(readFileSync(f.external, 'utf8'));
    const changed = structuredClone(github.pulls);
    if (field === 'source') changed[0].head.sha = 'a'.repeat(40);
    if (field === 'base') changed[0].base.sha = 'b'.repeat(40);
    if (field === 'merge') changed[0].merge_commit_sha = 'c'.repeat(40);
    github.pullSequence = [github.pulls, changed];
    writeFileSync(f.external, JSON.stringify(github));
    const result = invoke(f);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.record?.decision, 'full');
    assert.equal(executions(f).length, 2, 'a changed final PR context needs actual checkout validation');
  });
}

test('canonical reuse preserves different outgoing and merge trees with distinct gate bases', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.source, 'merged-base-change.txt'), 'a base-only change in the synthetic merge\n');
  git(f.source, 'add', '.');
  f.tree = git(f.source, 'write-tree');
  f.merge = git(f.source, 'commit-tree', f.tree, '-p', f.base, '-p', f.head, '-m', 'different merge tree');
  git(f.source, 'reset', '--hard', f.head);
  const producer = invoke(f, { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge });
  published(f, producer.record);
  const result = invoke(f, { base: f.head });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.record?.decision, 'reuse');
  assert.equal(result.record.validationContext.checkoutSha, f.head);
  assert.equal(result.record.validationContext.comparisonBase, f.head);
  assert.equal(result.record.cohortContext.checkoutSha, f.merge);
  assert.equal(result.record.cohortContext.comparisonBase, f.base);
  assert.notEqual(result.record.validationContext.checkoutTree, result.record.cohortContext.checkoutTree);
  assert.deepEqual(executions(f).map(x => x.sha), [f.merge]);
});


test('workflow refuses routing evidence without an exact current run and attempt identity', t => {
  const f = fixture(t);
  for (const environment of [{ GITHUB_RUN_ID: '' }, { GITHUB_RUN_ATTEMPT: '' }]) {
    const result = invoke(f, { environment });
    assert.notEqual(result.status, 0, 'missing run/attempt provenance cannot produce passing routing');
  }
  assert.equal(executions(f).length, 0);
});


test('workflow fails instead of claiming completion when the routing record cannot be read', t => {
  const f = fixture(t);
  const result = invoke(f, { environment: { ROUTING_READ_FAILURE: '1' } });
  assert.notEqual(result.status, 0, 'a failed routing evidence read must not silently skip the complete cohort');
  assert.equal(executions(f).length, 0);
});
