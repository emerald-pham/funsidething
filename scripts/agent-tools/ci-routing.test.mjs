import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deriveReleaseReviewPlan } from '../release-evidence.mjs';
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

function fixture(t, grouped=false, policy=false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'chain-ci-routing-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), bin = path.join(root, 'bin');
  mkdirSync(source); mkdirSync(bin);
  git(source, 'init', '-b', 'fixture');
  git(source, 'config', 'user.name', 'Routing fixture');
  git(source, 'config', 'user.email', 'routing@example.invalid');
  if(policy)git(source,'-c','core.hooksPath=/dev/null','commit','--allow-empty','-qm','prior product');
  writeFileSync(path.join(source, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test tests.js' } }));
  writeFileSync(path.join(source, 'tests.js'), "import { test } from 'node:test';test('isolated routing fixture',()=>{});\n");
  if(grouped){for(const file of ['.github/workflows/data-safety.yml','scripts/test-group-inventory.json','scripts/test-group-assignments.json','scripts/test-groups.mjs','scripts/agent-tools/ci-routing.mjs']){mkdirSync(path.dirname(path.join(source,file)),{recursive:true});writeFileSync(path.join(source,file),'fixture '+file+'\n');}}
  if(policy)writeFileSync(path.join(source,'AGENTS.md'),'Read [release and review](docs/agents/release-and-review.md) before release.\n');
  git(source, 'add', '.'); git(source, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture base');
  const base = git(source, 'rev-parse', 'HEAD');
  if(policy)writeFileSync(path.join(source,'AGENTS.md'),'Consult [release and review guidance](docs/agents/release-and-review.md)\nbefore release.\n');
  else writeFileSync(path.join(source, 'candidate.txt'), 'isolated candidate\n');
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
const jobs=x.jobsByRun?.[url.split('/runs/')[1]?.split('/')[0]]??x.jobs;
console.log(JSON.stringify(url.includes('/statuses?')?x.statuses:url.includes('/jobs?')?{total_count:jobs.length,jobs}:url.includes('/pulls?')?(x.pulls??[]).map(({mergeable,...listed})=>listed):url.includes('/pulls/')?x.pulls?.[0]:url.includes('/git/commits/')?x.merge:url.includes('/git/trees/')?x.tree:{total_count:x.omitRunTotal?undefined:x.runs.length,workflow_runs:x.runs}));
`);
  writeFileSync(path.join(bin, 'node'), '#!/bin/sh\nif [ "$1" = "-p" ] && [ "$ROUTING_READ_FAILURE" = "1" ]; then exit 1; fi\nexec ' + JSON.stringify(process.execPath) + ' "$@"\n');
  chmodSync(path.join(bin, 'node'), 0o755);
  chmodSync(path.join(bin, 'npm'), 0o755); chmodSync(path.join(bin, 'curl'), 0o755);
  return { root, source, bin, base, head, merge, tree, journal, external, attempt: 0 };
}

// Public routing-command consumer fixtures; the grouped workflow's actual
// scanner command is separately executed by test-groups.test.mjs.
function cohortShell() {
  return `set -- --max-wait-ms 1000 --poll-interval-ms 1 --comparison-base "$ROUTING_BASE" --evidence-dir "$ROUTING_OUTPUT/ci-routing"
if [[ -n "\${ROUTING_DESCRIPTOR:-}" ]]; then set -- "$@" --descriptor "$ROUTING_DESCRIPTOR"; fi
node "$ROUTING_COMMAND" "$@"
decision="$(node -p "require('$ROUTING_OUTPUT/ci-routing/routing.json').decision")"
if [[ "$decision" == "full" ]]; then npm test; elif [[ "$decision" != "reuse" && "$decision" != "policy-reuse" ]]; then exit 1; fi`;
}

function invoke(f, { event = 'push', ref = 'refs/heads/topic', source = f.head, checkout = f.head, base = f.base, action = 'synchronize', changes = undefined, planOnly = false, environment = {} } = {}) {
  git(f.source, 'checkout', '--detach', checkout);
  const output = path.join(f.root, `attempt-${++f.attempt}`);
  mkdirSync(output);
  const eventPath = path.join(output, 'event.json');
  writeFileSync(eventPath, JSON.stringify(event === 'pull_request' ? {
    action, changes, number: 17, pull_request: { number: 17, head: { sha: source, ref: 'topic', repo: { full_name: 'fixture/repo' } }, base: { sha: base, ref: 'main' } },
  } : { after: source, before: base, repository: { full_name: 'fixture/repo' } }));
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', planOnly ? 'node "$ROUTING_COMMAND" --comparison-base "$ROUTING_BASE" --evidence-dir "$ROUTING_OUTPUT/ci-routing" --plan-only 1' : cohortShell()], {
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
  assert.ok(second.record.observations.every(observation => observation.exitCode === 0), second.stdout);
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

test('workflow routing rejects uncertain producer contexts', async parent => {
for (const [name, change] of fallbackCases) {
  await parent.test(`workflow runs the actual branch cohort for ${name}`, t => {
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
});

test('workflow routing refuses unsuccessful canonical producers', async parent => {
for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
  await parent.test(`workflow refuses a known exact canonical producer ${conclusion}`, t => {
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
});

test('exact main and fresh or base-edited PR events execute their own cohort despite matching prior producer observations', t => {
  const f = fixture(t);
  const producer = invoke(f, { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge });
  published(f, producer.record);
  for (const event of [
    { event: 'push', ref: 'refs/heads/main' },
    { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge, action: 'opened' },
    { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge, action: 'edited', changes: {base:{ref:{from:'old-base'}}} },
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


test('workflow routing rechecks final PR identity', async parent => {
for (const field of ['source', 'base', 'merge']) {
  await parent.test(`workflow rechecks the final PR ${field} before accepting producer reuse`, t => {
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
});

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


test('metadata-only PR edits reuse completed full merge coverage without treating pending as success', t => {
  const f=fixture(t);
  const producer=invoke(f,{event:'pull_request',ref:'refs/pull/17/merge',checkout:f.merge});
  published(f,producer.record);
  const result=invoke(f,{event:'pull_request',ref:'refs/pull/17/merge',checkout:f.merge,action:'edited',changes:{body:{from:'prior evidence'}}});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(executions(f).length,1,'an unchanged exact PR context must not repeat the complete cohort for body metadata');
  assert.equal(result.record?.decision,'reuse');
  assert.equal(result.record.coveredBy.runAttempt,'2');
});


test('workflow context planning does not wait on external producer observations', t => {
  const f=fixture(t),producer=invoke(f,{event:'pull_request',ref:'refs/pull/17/merge',checkout:f.merge});
  published(f,producer.record);
  const result=invoke(f,{planOnly:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(result.record.observations.length,0,'quick context planning must not consume the routing wait/API budget');
  assert.equal(result.record.decision,'full');
});

test('workflow routing refuses a descriptor for a different validation candidate', t => {
  const f=fixture(t),descriptor=path.join(f.root,'wrong-descriptor.json');
  writeFileSync(descriptor,JSON.stringify({resultIdentity:{repository:'wrong/repo'}}));
  const result=invoke(f,{environment:{ROUTING_DESCRIPTOR:descriptor}});
  assert.notEqual(result.status,0,'descriptor identity must bind the actual validation candidate');
  assert.equal(executions(f).length,0);
});


const groupedIds=['core','scenery','persistence-recovery','native-process'];
function descriptorFor(f,checkout,source=f.head) {
  const file=path.join(f.root,'descriptor-'+(f.attempt+1)+'.json');
  writeFileSync(file,JSON.stringify({resultIdentity:{repository:'fixture/repo',sourceSha:source,sourceTree:git(f.source,'rev-parse',source+'^{tree}'),checkoutSha:checkout,checkoutTree:git(f.source,'rev-parse',checkout+'^{tree}'),comparisonBase:f.base,runId:String(101+f.attempt),runAttempt:1,checkoutDirty:false,cohortDigestSha256:'1'.repeat(64),inventorySha256:'2'.repeat(64),assignmentsSha256:'3'.repeat(64),expectedGroups:groupedIds}}));
  return {ROUTING_DESCRIPTOR:file};
}
function publishedGroups(f,record) {
  published(f,record);const github=JSON.parse(readFileSync(f.external));
  github.tree={truncated:false,tree:['.github/workflows/data-safety.yml','scripts/test-group-inventory.json','scripts/test-group-assignments.json','scripts/test-groups.mjs','scripts/agent-tools/ci-routing.mjs'].map(file=>({path:file,type:'blob',sha:git(f.source,'rev-parse',f.head+':'+file)}))};
  const original=github.jobs[0];original.steps=[{name:`Complete regression context ${record.contextSha256} report ${'8'.repeat(64)}`,conclusion:'success'}];
  github.jobs=['validation-context','event-gates','cohort-routing',...groupedIds.map(id=>'regression-'+id)].map(name=>({...original,name,steps:name==='validation-context'?[{name:`Announce regression context ${record.contextSha256}`,conclusion:'success'}]:[]})).concat(original);
  writeFileSync(f.external,JSON.stringify(github));return github;
}
test('grouped routing reuses only an exact completed reconciled producer and preserves origin attempt', async parent => {
  const scenarios=[
    ['exact producer',()=>{},'reuse',0],
    ['missing group',x=>{x.jobs=x.jobs.filter(job=>job.name!=='regression-scenery');},'full',0],
    ['skipped group',x=>{x.jobs.find(job=>job.name==='regression-core').conclusion='skipped';},'full',0],
    ['wrong group attempt',x=>{x.jobs.find(job=>job.name==='regression-core').run_attempt=1;},'full',0],
    ['unverified marker',x=>{x.jobs.find(job=>job.name==='scanner-tests').steps=[];},'full',0],
    ['wrong definition',x=>{x.tree.tree[0].sha='f'.repeat(40);},'full',0],
    ['unknown extra job',x=>{x.jobs.push({...x.jobs[0],name:'unexpected-validation'});},'full',0],
    ['known failed producer without aggregate',x=>{x.runs[0].conclusion='failure';x.jobs=x.jobs.filter(job=>job.name!=='scanner-tests');},'fail',1],
  ];
  for(const [name,mutate,decision,code]of scenarios)await parent.test(name,t=>{
    const f=fixture(t,true),first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});
    assert.equal(first.status,0,first.stdout+first.stderr);const github=publishedGroups(f,first.record);mutate(github);writeFileSync(f.external,JSON.stringify(github));
    const second=invoke(f,{environment:descriptorFor(f,f.head)});assert.equal(second.status,code,second.stdout+second.stderr);assert.equal(second.record?.decision,decision,second.stdout);
    if(decision==='reuse'){assert.equal(second.record.coveredBy.runId,'71');assert.equal(second.record.coveredBy.runAttempt,'2');assert.equal(second.record.coveredBy.reportSha256,'8'.repeat(64));assert.equal(executions(f).length,1);}
  });
});

test('grouped metadata-only edited PR reuses only its completed exact merge context', t => {
  const f=fixture(t,true),first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});assert.equal(first.status,0,first.stderr);publishedGroups(f,first.record);
  const edited=invoke(f,{event:'pull_request',checkout:f.merge,action:'edited',changes:{body:{from:'previous evidence'}},environment:descriptorFor(f,f.merge)});
  assert.equal(edited.status,0,edited.stdout+edited.stderr);assert.equal(edited.record.decision,'reuse');assert.equal(executions(f).length,1);
  const baseEdit=invoke(f,{event:'pull_request',checkout:f.merge,action:'edited',changes:{base:{ref:{from:'previous-base'}}},environment:descriptorFor(f,f.merge)});
  assert.equal(baseEdit.status,0,baseEdit.stderr);assert.equal(baseEdit.record.decision,'full');assert.equal(executions(f).length,2);
});


test('metadata edits continue past verified covered runs to the original full producer', t => {
  const f=fixture(t,true),first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});assert.equal(first.status,0,first.stderr);
  const github=publishedGroups(f,first.record),covered=github.jobs.map(job=>({...job,run_id:72,run_attempt:1,steps:job.name==='scanner-tests'?[{name:`Verified complete cohort ${first.record.contextSha256} report ${'9'.repeat(64)} mode reuse`,conclusion:'success'}]:job.steps}));
  github.jobsByRun={'71':github.jobs,'72':covered};github.runs.unshift({...github.runs[0],id:72,run_attempt:1});writeFileSync(f.external,JSON.stringify(github));
  const edited=invoke(f,{event:'pull_request',checkout:f.merge,action:'edited',changes:{title:{from:'earlier title'}},environment:descriptorFor(f,f.merge)});
  assert.equal(edited.status,0,edited.stderr);assert.equal(edited.record.decision,'reuse',edited.stdout);assert.equal(edited.record.coveredBy.runId,'71');assert.equal(edited.record.coveredBy.runAttempt,'2');assert.equal(executions(f).length,1);
});


function publishedPolicyBase(f) {
  const baseTree=git(f.source,'rev-parse',f.base+'^{tree}'),baseParent=git(f.source,'rev-parse',f.base+'^');
  const plan=deriveReleaseReviewPlan(f.source,f.head,f.base);
  const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
  const prefix=createHash('sha256').update(canonical(plan)).digest('hex').slice(0,12);
  const description=`r=${'7'.repeat(64)};b=${f.base};p=${prefix};c=0;s=1;v=4`;
  const context={repository:'fixture/repo',sourceSha:f.base,sourceTree:baseTree,checkoutSha:f.base,checkoutTree:baseTree,comparisonBase:baseParent,eventPolicy:'exact-main-push-v1',requiredCohort:'four-groups-v1',runtime:{node:process.versions.node,platform:process.platform,arch:process.arch},cohortDigestSha256:'1'.repeat(64),inventorySha256:'2'.repeat(64),assignmentsSha256:'3'.repeat(64),expectedGroups:groupedIds,workflowBlob:git(f.source,'rev-parse',f.base+':.github/workflows/data-safety.yml')};
  const digest=createHash('sha256').update(JSON.stringify(context)).digest('hex');
  const step=name=>({name,status:'completed',conclusion:'success'});
  const names=['validation-context','event-gates','cohort-routing',...groupedIds.map(id=>'regression-'+id),'scanner-tests','release-evidence','deploy-pages'];
  const github={runs:[{id:70,run_attempt:1,status:'completed',conclusion:'success',event:'push',head_branch:'main',head_sha:f.base,name:'Data safety',path:'.github/workflows/data-safety.yml',repository:{full_name:'fixture/repo'},head_repository:{full_name:'fixture/repo'}}],jobs:names.map(name=>({name,status:'completed',conclusion:'success',run_id:70,run_attempt:1,head_sha:f.base,steps:name==='validation-context'?[step(`Announce regression context ${digest}`),step(`Actual checkout ${f.base} tree ${baseTree}`),step(`Validation source ${f.base} base ${baseParent}`),step(`Workflow blob ${context.workflowBlob} policy four-groups-v1`)]:name==='scanner-tests'?[step(`Complete regression context ${digest} report ${'8'.repeat(64)}`)]:name.startsWith('regression-')?[step('Execute complete assigned group')]:name==='event-gates'?[step('Run npm run test:rules'),step('Backward compatibility')]:[]})),statuses:['funsidething/memory-audit','funsidething/independent-review','funsidething/specialist-review'].map(context=>({context,state:'success',description,created_at:new Date().toISOString()}))};
  writeFileSync(f.external,JSON.stringify(github));return github;
}

test('policy prose routing inherits only a successful full exact-base product cohort and current reviews', t=>{
  const f=fixture(t,true,true);
  // A genuine baseline parent is needed for the full producer's own comparison.
  // Amend no source after publishing the immutable fixture identities.
  const github=publishedPolicyBase(f);
  const result=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(result.record?.decision,'policy-reuse','unchanged product execution is inherited only after current policy review and authoritative base cohort checks');
  assert.equal(executions(f).length,0,'the policy route must not claim another current product execution');
  assert.equal(result.record.coveredBy.runId,'70');assert.equal(result.record.coveredBy.reportSha256,'8'.repeat(64));
  assert.equal(result.record.policyImpact.sourceSha,f.head);assert.equal(result.record.policyImpact.baseSha,f.base);
  assert.equal(result.record.cohortContext.sourceSha,f.base);assert.equal(result.record.validationContext.sourceSha,f.head);
});


test('policy prose routing rejects incomplete inherited rule and compatibility execution',t=>{
 const f=fixture(t,true,true),github=publishedPolicyBase(f);github.jobs.find(job=>job.name==='event-gates').steps=[];writeFileSync(f.external,JSON.stringify(github));
 const result=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.record.decision,'full','inheriting an aggregate cannot silently skip the original rules/compatibility gates');assert.equal(executions(f).length,1);
});

test('policy prose routing preserves gates for uncertain base execution and stale current evidence',async parent=>{
 const scenarios=[
  ['missing current status',x=>{x.statuses.pop();}],
  ['revoked current status',x=>{x.statuses[0].state='failure';}],
  ['stale policy plan',x=>{x.statuses.forEach(status=>status.description=status.description.replace(/;p=[a-f0-9]{12}/,';p='+ '0'.repeat(12)));}],
  ['wrong receipt',x=>{x.statuses[0].description=x.statuses[0].description.replace(/^r=[a-f0-9]{64}/,'r='+ '0'.repeat(64));}],
  ['old status schema',x=>{x.statuses.forEach(status=>status.description=status.description.replace(';v=4',';v=2'));}],
  ['incomplete runs',x=>{x.omitRunTotal=true;}],
  ['pending base',x=>{x.runs[0].status='in_progress';x.runs[0].conclusion=null;}],
  ['failed base',x=>{x.runs[0].conclusion='failure';}],
  ['wrong producer source',x=>{x.runs[0].head_sha='0'.repeat(40);}],
  ['wrong base branch',x=>{x.runs[0].head_branch='topic';}],
  ['missing group',x=>{x.jobs=x.jobs.filter(job=>job.name!=='regression-core');}],
  ['skipped group',x=>{x.jobs.find(job=>job.name==='regression-core').conclusion='skipped';}],
  ['covered base',x=>{x.jobs.find(job=>job.name==='scanner-tests').steps[0].name=x.jobs.find(job=>job.name==='scanner-tests').steps[0].name.replace('Complete regression context','Verified complete cohort')+' mode reuse';}],
  ['wrong base attempt',x=>{x.jobs[0].run_attempt=2;}],
  ['wrong frozen context',x=>{x.jobs.find(job=>job.name==='validation-context').steps[0].name='Announce regression context '+'0'.repeat(64);}],
  ['missing compatibility',x=>{x.jobs.find(job=>job.name==='event-gates').steps=x.jobs.find(job=>job.name==='event-gates').steps.filter(step=>step.name!=='Backward compatibility');}],
 ];
 for(const [name,mutate]of scenarios)await parent.test(name,t=>{const f=fixture(t,true,true),github=publishedPolicyBase(f);mutate(github);writeFileSync(f.external,JSON.stringify(github));const result=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.record.decision,'full',name+' requires full current execution');assert.equal(result.record.coveredBy,null);assert.equal(executions(f).length,1);});
});


test('policy prose exact main routing retains current reviewed head and original base execution',t=>{
 const f=fixture(t,true,true),github=publishedPolicyBase(f);
 github.pulls=[{number:17,merged_at:new Date().toISOString(),merge_commit_sha:f.merge,head:{sha:f.head},base:{ref:'main'}}];writeFileSync(f.external,JSON.stringify(github));
 const result=invoke(f,{event:'push',ref:'refs/heads/main',source:f.merge,checkout:f.merge,environment:descriptorFor(f,f.merge,f.merge)});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.record.decision,'policy-reuse',result.stdout);assert.equal(result.record.policyReview.sourceSha,f.head);assert.equal(result.record.policyImpact.sourceSha,f.merge);assert.equal(result.record.coveredBy.checkoutSha,f.base);assert.equal(executions(f).length,0);
});
