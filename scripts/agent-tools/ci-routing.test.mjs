import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMobileBundle, refreshMobileBundle } from './mobile-memory-fixture.mjs';
import { deriveReleaseReviewPlan } from '../release-evidence.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function fixture(t, grouped=false, policy=false, early=false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'chain-ci-routing-'));
  t.after(() => { if(process.env.CHAIN_METADATA_EVIDENCE){mkdirSync(process.env.CHAIN_METADATA_EVIDENCE,{recursive:true});cpSync(root,path.join(process.env.CHAIN_METADATA_EVIDENCE,path.basename(root)),{recursive:true});} rmSync(root, { recursive: true, force: true }); });
  const source = path.join(root, 'source'), bin = path.join(root, 'bin');
  mkdirSync(source); mkdirSync(bin);
  mkdirSync(path.join(source,'scripts/agent-tools'),{recursive:true});
  copyFileSync(path.join(repo,'scripts/agent-tools/ci-pass-reuse.mjs'),path.join(source,'scripts/agent-tools/ci-pass-reuse.mjs'));
  git(source, 'init', '-b', 'fixture');
  git(source, 'config', 'user.name', 'Routing fixture');
  git(source, 'config', 'user.email', 'routing@example.invalid');
  if(policy)git(source,'-c','core.hooksPath=/dev/null','commit','--allow-empty','-qm','prior product');
  writeFileSync(path.join(source, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test tests.js' } }));
  writeFileSync(path.join(source, 'tests.js'), "import { test } from 'node:test';test('isolated routing fixture',()=>{});\n");
  if(grouped){for(const file of ['.github/workflows/data-safety.yml','scripts/test-group-inventory.json','scripts/test-group-assignments.json','scripts/test-groups.mjs','scripts/agent-tools/ci-routing.mjs']){mkdirSync(path.dirname(path.join(source,file)),{recursive:true});writeFileSync(path.join(source,file),'fixture '+file+'\n');}}
  if(early){writeFileSync(path.join(source,'scripts/early-ci-harness-source.json'),'{"files":[],"testExcerpts":[],"limits":["Controlled parser fixtures only; no native proof"]}\n');writeFileSync(path.join(source,'scripts/test-group-assignments.json'),'{"rootAssignments":[]}\n');}
  if(policy)writeFileSync(path.join(source,'AGENTS.md'),'Read [release and review](docs/agents/release-and-review.md) before release.\nIndependent FAQ coverage review is required for every product release.\n');
  git(source, 'add', '.'); git(source, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture base');
  const base = git(source, 'rev-parse', 'HEAD');
  if(policy)writeFileSync(path.join(source,'AGENTS.md'),'Consult [release and review guidance](docs/agents/release-and-review.md)\nbefore release.\nIndependent FAQ coverage review is required for every product release.\n');
  else writeFileSync(path.join(source, 'candidate.txt'), 'isolated candidate\n');
  git(source, 'add', '.'); git(source, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture candidate');
  const head = git(source, 'rev-parse', 'HEAD');
  const tree = git(source, 'rev-parse', 'HEAD^{tree}');
  const merge = git(source, 'commit-tree', tree, '-p', base, '-p', head, '-m', 'synthetic fixture PR merge');
  const journal = path.join(root, 'executions.jsonl');
  const external = path.join(root, 'github.json');
  writeFileSync(external, JSON.stringify({ runs: [], jobs: [] }));
  writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.ROUTING_EXECUTIONS, JSON.stringify({argv:process.argv.slice(2),sha:process.env.GITHUB_SHA})+'\\n');\nif(process.argv.some(arg=>arg==='test:rules'||arg==='test:compatibility'))console.log('TAP version 13\\n# tests 24\\n# pass 24\\n# fail 0\\n# cancelled 0\\n# skipped 0');\n`);
  writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env node
const fs=require('node:fs'),x=JSON.parse(fs.readFileSync(process.env.ROUTING_GITHUB));
const url=process.argv.at(-1);
fs.appendFileSync(process.env.ROUTING_GITHUB+'.requests',JSON.stringify(process.argv.slice(2))+'\\n');
if(url.includes('/actions/artifacts/')&&url.endsWith('/zip')){if(x.archiveError)process.exit(22);process.stdout.write(fs.readFileSync(x.artifacts.find(a=>String(a.id)===url.split('/artifacts/')[1].split('/')[0]).fixturePath));process.exit(0);}
if(url.includes('/runs?')&&x.runSequence?.length){x.runs=x.runSequence.shift();fs.writeFileSync(process.env.ROUTING_GITHUB,JSON.stringify(x));}
if(url.includes('/pulls?')&&x.pullSequence?.length){x.pulls=x.pullSequence.shift();fs.writeFileSync(process.env.ROUTING_GITHUB,JSON.stringify(x));}
if(x.error){process.stderr.write('controlled unavailable GitHub');process.exit(22);}
const jobs=x.jobsByAttempt?.[url.split('/runs/')[1]?.split('/jobs?')[0]]??x.jobsByRun?.[url.split('/runs/')[1]?.split('/')[0]]??x.jobs;
const artifacts=(x.artifacts||[]).filter(a=>String(a.workflow_run.id)===url.split('/runs/')[1]?.split('/')[0]);
console.log(JSON.stringify(url.includes('/statuses?')?(x.statusesBySha?.[url.split('/commits/')[1]?.split('/')[0]]??x.statuses):url.includes('/commits/')&&url.includes('/pulls?')?(x.associatedBySha?.[url.split('/commits/')[1]?.split('/')[0]]??x.pulls):url.includes('/compare/')?(x.comparison??{}):url.includes('/commits/')&&!url.includes('/git/commits/')?(x.restCommits?.[url.split('/commits/')[1]]??{}):url.includes('/artifacts?')?{total_count:artifacts.length,artifacts}:url.includes('/jobs?')?{total_count:jobs.length,jobs}:url.includes('/attempts/')?x.attempts?.[url.split('/runs/')[1].replace('/attempts/','/')]:url.includes('/pulls?')?(x.pulls??[]).map(({mergeable,...listed})=>listed):url.includes('/pulls/')?x.pulls?.[0]:url.includes('/git/commits/')?(x.commits?.[url.split('/git/commits/')[1]]??x.merge):url.includes('/git/trees/')?x.tree:{total_count:x.omitRunTotal?undefined:(x.runsByHead?.[new URL(url).searchParams.get('head_sha')]??x.runs).length,workflow_runs:x.runsByHead?.[new URL(url).searchParams.get('head_sha')]??x.runs}));
`);
  writeFileSync(path.join(bin, 'node'), '#!/bin/sh\nif [ "$1" = "-p" ] && [ "$ROUTING_READ_FAILURE" = "1" ]; then exit 1; fi\nexec ' + JSON.stringify(process.execPath) + ' "$@"\n');
  chmodSync(path.join(bin, 'node'), 0o755);
  chmodSync(path.join(bin, 'npm'), 0o755); chmodSync(path.join(bin, 'curl'), 0o755);
  return { root, source, bin, base, head, merge, tree, journal, external, early, attempt: 0 };
}

// Public routing-command consumer fixtures; the grouped workflow's actual
// scanner command is separately executed by test-groups.test.mjs.
function cohortShell() {
  return `set -- --max-wait-ms "\${ROUTING_MAX_WAIT:-1000}" --poll-interval-ms 1 --comparison-base "$ROUTING_BASE" --evidence-dir "$ROUTING_OUTPUT/ci-routing"
if [[ -n "\${ROUTING_DESCRIPTOR:-}" ]]; then set -- "$@" --descriptor "$ROUTING_DESCRIPTOR"; fi
if [[ -n "\${ROUTING_RESUME:-}" ]]; then set -- "$@" --resume "$ROUTING_RESUME"; fi
if [[ "\${ROUTING_REQUIRE_INPUT_PASSES:-}" == "1" ]]; then set -- "$@" --require-input-passes 1; fi
if [[ -n "\${ROUTING_INPUT_PROOF:-}" ]]; then set -- "$@" --input-proof "$ROUTING_INPUT_PROOF"; fi
node "$ROUTING_COMMAND" "$@"
decision="$(node -p "require('$ROUTING_OUTPUT/ci-routing/routing.json').decision")"
if [[ "$decision" == "full" ]]; then
  if [[ "$(node -p "Object.keys(require('$ROUTING_OUTPUT/ci-routing/routing.json').inputPasses||{}).length")" != "6" ]]; then npm test; fi
elif [[ "$decision" != "reuse" && "$decision" != "policy-reuse" ]]; then exit 1; fi`;
}

function invoke(f, { event = 'push', ref = 'refs/heads/topic', source = f.head, checkout = f.head, base = f.base, action = 'synchronize', changes = undefined, planOnly = false, environment = {} } = {}) {
  git(f.source, 'checkout', '--detach', checkout);
  const output = path.join(f.root, `attempt-${++f.attempt}`);
  mkdirSync(output);
  const eventPath = path.join(output, 'event.json');
  writeFileSync(eventPath, JSON.stringify(event === 'pull_request' ? {
    action, changes, number: 17, pull_request: { number: 17, head: { sha: source, ref: 'topic', repo: { full_name: 'fixture/repo' } }, base: { sha: base, ref: 'main' } },
  } : { after: source, before: base, repository: { full_name: 'fixture/repo' } }));
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', planOnly ? 'set -- --comparison-base "$ROUTING_BASE" --evidence-dir "$ROUTING_OUTPUT/ci-routing" --plan-only 1; if [[ -n "${ROUTING_DESCRIPTOR:-}" ]]; then set -- "$@" --descriptor "$ROUTING_DESCRIPTOR"; fi; node "$ROUTING_COMMAND" "$@"' : cohortShell()], {
    cwd: f.source, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PATH: f.bin + path.delimiter + process.env.PATH,
      ROUTING_COMMAND: command, ROUTING_BASE: base, ROUTING_OUTPUT: output,
      ROUTING_EXECUTIONS: f.journal, ROUTING_GITHUB: f.external,
      GITHUB_REPOSITORY: 'fixture/repo', GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: eventPath,
      GITHUB_REF: ref, GITHUB_SHA: checkout, GITHUB_RUN_ID: String(100 + f.attempt),
      GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: path.join(output, 'outputs'), CI: 'true', ImageOS: 'ubuntu24', ImageVersion: '20261022.1.0', ...environment },
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

function publishedInputPass(f, plan, gates = ['core']) {
  published(f, plan);
  const github = JSON.parse(readFileSync(f.external));
  github.jobs = [{ id: 700, name: 'validation-context', status: 'completed', conclusion: 'success', run_id: 71, run_attempt: 2, head_sha: f.head, steps: [
    { name: `Actual checkout ${f.merge} tree ${f.tree}`, status: 'completed', conclusion: 'success' },
    { name: `Validation source ${f.head} base ${f.base}`, status: 'completed', conclusion: 'success' },
  ] }, ...gates.map((gate, index) => ({ id: 701 + index, name: ['rules', 'compatibility'].includes(gate) ? 'event-gates' : 'regression-' + gate,
    status: 'completed', conclusion: 'success', run_id: 71, run_attempt: 2, head_sha: f.head, steps: [
      { name: `Execute CI gate ${gate} input ${plan.inputKeys?.[gate] || '0'.repeat(64)}`, status: 'completed', conclusion: 'success' },
      { name: `Completed CI gate ${gate} input ${plan.inputKeys?.[gate] || '0'.repeat(64)} result ${'8'.repeat(64)}`, status: 'completed', conclusion: 'success' },
    ] }))];
  github.jobs=github.jobs.reduce((jobs,job)=>{const existing=jobs.find(item=>item.name===job.name);if(existing)existing.steps.push(...job.steps);else jobs.push(job);return jobs;},[]);
  github.commits = { [f.merge]: github.merge };
  for(const job of github.jobs){
    job.started_at='2026-10-27T10:00:00Z';job.completed_at='2026-10-27T10:01:00Z';
    for(const step of job.steps){step.started_at='2026-10-27T10:00:10Z';step.completed_at=step.name.startsWith('Completed CI gate ')?'2026-10-27T10:00:50Z':'2026-10-27T10:00:11Z';}
  }
  attachInputArtifacts(f,github,github.jobs);
  github.attempts={'71/1':{...github.runs[0],run_attempt:1,conclusion:'failure'}};github.jobsByAttempt={'71/attempts/1':[]};
  writeFileSync(f.external, JSON.stringify(github));
  return github;
}

function attachInputArtifacts(f,github,jobs){
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  for(const job of jobs)for(const marker of job.steps.filter(step=>step.name.startsWith('Completed CI gate '))){
    const gate=marker.name.split(' ')[3],emulator=['rules','compatibility'].includes(gate);
    const name=emulator?`event-gates-${job.run_id}-${job.run_attempt}`:`regression-${job.run_id}-${job.run_attempt}-${gate}`;
    const directory=path.join(f.root,name),prefix=emulator?gate+'/':'';mkdirSync(path.join(directory,prefix,'native'),{recursive:true});
    const stdout='TAP version 13\n# tests 24\n# pass 24\n# fail 0\n# cancelled 0\n# skipped 0\n';
    writeFileSync(path.join(directory,prefix,'stdout.tap'),stdout);writeFileSync(path.join(directory,prefix,'stderr.log'),'');
    const native=gate==='native-process'&&f.largeNativeEvidence?f.largeNativeEvidence:'{"status":"passed","mode":"original"}\n';writeFileSync(path.join(directory,prefix,'native/original.json'),native);
    const report={status:'passed',resultIdentity:{repository:'fixture/repo',runId:String(job.run_id),runAttempt:emulator?String(job.run_attempt):Number(job.run_attempt),sourceSha:job.head_sha,checkoutSha:f.merge,checkoutTree:f.tree,comparisonBase:f.base,selectedGroup:gate,checkoutDirty:false,...(f.artifactIdentity||{})},
      issues:[],cases:[{id:'original fixture case',status:'passed'}],artifacts:[{path:'native/original.json',bytes:Buffer.byteLength(native),sha256:hash(native)}],process:{exitCode:0,signal:null,spawnError:null,stdout:{path:'stdout.tap',sha256:hash(stdout)},stderr:{path:'stderr.log',sha256:hash('')},stdoutSha256:hash(stdout),stderrSha256:hash('')},tests:24,passed:24};
    const bytes=JSON.stringify(report);writeFileSync(path.join(directory,prefix,'result.json'),bytes);
    marker.name=marker.name.replace(/result [a-f0-9]{64}$/,`result ${hash(bytes)}`);
    const archive=directory+'.zip';const result=spawnSync('zip',['-qr',archive,'.'],{cwd:directory,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    const content=readFileSync(archive);github.artifacts||=[];github.artifacts=github.artifacts.filter(a=>a.name!==name);
    github.artifacts.push({id:900+github.artifacts.length,name,expired:false,created_at:'2026-10-27T10:00:45Z',expires_at:'2030-01-01T00:00:00Z',digest:'sha256:'+hash(content),size_in_bytes:content.length,workflow_run:{id:job.run_id,head_sha:job.head_sha},fixturePath:archive});
  }
}

test('workflow reuses an independently passed gate on main for the same complete inputs', t => {
  const f = fixture(t);
  const plan = invoke(f, { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge, planOnly: true });
  assert.equal(plan.status, 0, plan.stderr);
  publishedInputPass(f, plan.record);
  const landed=git(f.source,'commit-tree',f.tree,'-p',f.base,'-p',f.head,'-m','distinct landed commit metadata');
  const main = invoke(f, { event: 'push', ref: 'refs/heads/main', checkout: landed, source: landed });
  assert.equal(main.status, 0, main.stderr);
  assert.equal(main.record?.inputPasses?.core?.coveredBy?.runId, '71', 'main must retain the original successful core pass instead of requiring it again');
  assert.equal(main.record.inputPasses.core.coveredBy.checkoutSha, f.merge);
  assert.equal(main.record.inputPasses.scenery, undefined, 'an unexecuted group still requires actual execution');
  const originalProof=path.join(f.root,'original-routing.json');writeFileSync(originalProof,JSON.stringify(main.record));
  const final=invoke(f,{event:'push',ref:'refs/heads/main',checkout:landed,source:landed,environment:{ROUTING_INPUT_PROOF:originalProof,GITHUB_RUN_ID:main.record.runId,ImageVersion:'20261023.2.0'}});
  assert.equal(final.status,0,final.stderr);assert.deepEqual(final.record.inputPasses.core,main.record.inputPasses.core,'aggregation must reobserve the consumer\'s original proof independently of its own VM image');
});

test('workflow input reuse keeps a newer failed gate from inheriting an older pass', t => {
  const f = fixture(t);
  const plan = invoke(f, { event: 'pull_request', ref: 'refs/pull/17/merge', checkout: f.merge, planOnly: true });
  const github = publishedInputPass(f, plan.record);
  const failed = github.jobs.map(job => ({ ...job, id: job.id + 10, run_id: 72, run_attempt: 1,
    ...(job.name.startsWith('regression-') ? { conclusion: 'failure', steps: job.steps.filter(step => !step.name.startsWith('Completed CI gate ')) } : {}) }));
  github.runs.push({ ...github.runs[0], id: 72, run_attempt: 1, conclusion: 'failure' });
  github.jobsByRun = { 71: github.jobs, 72: failed };
  writeFileSync(f.external, JSON.stringify(github));
  const main = invoke(f, { ref: 'refs/heads/main', checkout: f.merge, source: f.merge });
  assert.equal(main.status, 0, main.stderr);
  assert.equal(main.record?.inputPasses?.core, undefined, 'a newer actual failure invalidates the older reusable pass for those inputs');
});

test('workflow emulator gate reuses a verified pass and executes an uncovered gate', t => {
  const f=fixture(t),plan=invoke(f,{event:'pull_request',ref:'refs/pull/17/merge',checkout:f.merge,planOnly:true});
  publishedInputPass(f,plan.record,['rules']);
  const main=invoke(f,{ref:'refs/heads/main',checkout:f.merge,source:f.merge});assert.equal(main.status,0,main.stderr);
  const temporary=path.join(f.root,'gate-workflow');mkdirSync(path.join(temporary,'ci-routing'),{recursive:true});
  writeFileSync(path.join(temporary,'ci-routing/routing.json'),JSON.stringify(main.record));
  const workflow=readFileSync(path.join(repo,'.github/workflows/data-safety.yml'),'utf8');
  const env={...process.env,PATH:f.bin+path.delimiter+process.env.PATH,ROUTING_EXECUTIONS:f.journal,RUNNER_TEMP:temporary,GITHUB_REPOSITORY:'fixture/repo',GITHUB_SHA:f.merge,CHAIN_TEST_SOURCE_SHA:f.merge,GITHUB_RUN_ID:main.record.runId,GITHUB_RUN_ATTEMPT:'1',ImageOS:'ubuntu24',ImageVersion:'20261022.1.0',GITHUB_OUTPUT:path.join(temporary,'outputs')};
  const selection=[...workflow.matchAll(/^\s+run: (node scripts\/agent-tools\/ci-pass-reuse\.mjs select .+)$/gm)][0]?.[1];assert.ok(selection,'the job must select its own runner inputs before dependency setup');
  const selectedProof=spawnSync('bash',['-euo','pipefail','-c',selection],{cwd:f.source,env,encoding:'utf8'});assert.equal(selectedProof.status,0,selectedProof.stderr);
  for(const [gate,script,covered]of [['rules','test:rules',true],['compatibility','test:compatibility',false]]){
    const lines=[...workflow.matchAll(/^\s+run: (.+)$/gm)].map(match=>match[1]);
    const selected=lines.find(line=>line.includes(`run-gate --gate ${gate} `))||`npm run ${script}`;
    const command=selected.replaceAll('${{ needs.validation-context.outputs.base }}',f.base);
    const before=executions(f).length;
    const result=spawnSync('bash',['-euo','pipefail','-c',command],{cwd:f.source,env,encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
    assert.equal(executions(f).length-before,covered?0:1,gate+' must execute only when a verified successful pass is absent');
    assert.ok(selected.includes('run-gate'),'the actual workflow must use the enforcing emulator consumer');
    if(covered){const report=JSON.parse(readFileSync(path.join(temporary,'emulator-gates',gate,'result.json')));assert.match(readFileSync(env.GITHUB_OUTPUT,'utf8'),new RegExp('^coverage='+createHash('sha256').update(JSON.stringify(report.coverage)).digest('hex')+'$','m'),'the actual consumer must fingerprint the exact original pass it consumed');}
  }
  rmSync(path.join(temporary,'emulator-gates/rules'),{recursive:true,force:true});
  rmSync(path.join(temporary,'selected-routing'),{recursive:true,force:true});
  const reselected=spawnSync('bash',['-euo','pipefail','-c',selection],{cwd:f.source,env:{...env,ImageVersion:'20261023.2.0'},encoding:'utf8'});assert.equal(reselected.status,0,reselected.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path.join(temporary,'selected-routing/routing.json'))).inputPasses,{},'changed job images must admit dependency installation before fresh execution');
  assert.match(workflow,/if:.*steps\.selected\.outputs\.reused/);
  const selected=[...workflow.matchAll(/^\s+run: (.+)$/gm)].map(match=>match[1]).find(line=>line.includes('run-gate --gate rules '));
  const changedImage=spawnSync('bash',['-euo','pipefail','-c',selected.replaceAll('${{ needs.validation-context.outputs.base }}',f.base)],{cwd:f.source,env:{...env,ImageVersion:'20261023.2.0'},encoding:'utf8',timeout:15000});
  assert.equal(changedImage.status,0,changedImage.stdout+changedImage.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(temporary,'emulator-gates/rules/result.json'))).status,'passed','different consuming image must execute the emulator gate');
});

test('workflow rerun reuses an original successful gate from its own earlier attempt', t => {
  const f=fixture(t),plan=invoke(f,{event:'pull_request',ref:'refs/pull/17/merge',checkout:f.merge,planOnly:true});
  const github=publishedInputPass(f,plan.record),original=structuredClone(github.runs[0]);
  github.runs[0]={...original,status:'in_progress',conclusion:null,run_attempt:3};github.attempts={'71/2':original,'71/1':{...original,run_attempt:1,conclusion:'failure'}};github.jobsByAttempt={'71/attempts/1':[]};
  writeFileSync(f.external,JSON.stringify(github));
  const rerun=invoke(f,{event:'pull_request',ref:'refs/pull/17/merge',checkout:f.merge,environment:{GITHUB_RUN_ID:'71',GITHUB_RUN_ATTEMPT:'3'}});
  assert.equal(rerun.status,0,rerun.stderr);
  assert.equal(rerun.record?.inputPasses?.core?.coveredBy?.runAttempt,'2','rerunning a workflow must not discard an original successful earlier attempt');
  assert.equal(rerun.record.inputPasses.core.coveredBy.runId,'71');
});

test('workflow partial retries preserve successful gates and invalidate a later failed execution',async parent=>{
  for(const [name,failedGate]of [['later group failure','core'],['later emulator failure','rules'],['successful subset','compatibility']])await parent.test(name,t=>{
    const f=fixture(t),plan=invoke(f,{event:'pull_request',ref:'refs/pull/17/merge',checkout:f.merge,planOnly:true});
    const github=publishedInputPass(f,plan.record,['core','rules','compatibility']);
    const original=structuredClone(github.runs[0]),initialJobs=structuredClone(github.jobs);
    // A failed-job/specific-job retry omits the already successful dependency.
    github.runs[0]={...original,run_attempt:3,conclusion:failedGate==='compatibility'?'success':'failure'};
    github.attempts={'71/2':original,'71/1':{...original,run_attempt:1,conclusion:'failure'}};
    github.jobsByAttempt={'71/attempts/1':[],'71/attempts/2':initialJobs};
    const job=structuredClone(initialJobs.find(job=>job.name===(failedGate==='core'?'regression-core':'event-gates')));
    job.id=801;job.run_attempt=3;job.started_at='2026-10-27T11:00:00Z';job.completed_at='2026-10-27T11:01:00Z';
    job.steps=[{name:`Execute CI gate ${failedGate} input ${plan.record.inputKeys[failedGate]}`,status:'completed',conclusion:'success',started_at:job.started_at,completed_at:job.started_at}];
    job.conclusion=failedGate==='compatibility'?'success':'failure';
    if(failedGate==='compatibility')job.steps.push({name:`Completed CI gate compatibility input ${plan.record.inputKeys.compatibility} result ${'8'.repeat(64)}`,status:'completed',conclusion:'success',started_at:'2026-10-27T11:00:45Z',completed_at:'2026-10-27T11:00:50Z'});
    github.jobs=[job];
    const olderPass=initialJobs.map(job=>({...structuredClone(job),id:job.id+100,run_id:72,run_attempt:1}));
    attachInputArtifacts(f,github,olderPass);github.runs.push({...original,id:72,run_attempt:1});github.jobsByRun={72:olderPass};
    if(failedGate==='compatibility'){attachInputArtifacts(f,github,[job]);const a=github.artifacts.find(a=>a.name==='event-gates-71-3');a.created_at='2026-10-27T11:00:45Z';}
    writeFileSync(f.external,JSON.stringify(github));
    const main=invoke(f,{ref:'refs/heads/main',checkout:f.merge,source:f.merge});assert.equal(main.status,0,main.stderr);
    assert.ok(main.record.inputPasses[failedGate==='rules'?'compatibility':'rules'],'the independently successful earlier gate must remain reusable');
    if(failedGate==='compatibility')assert.equal(main.record.inputPasses.compatibility?.coveredBy.runAttempt,'3','a successful subset can use its original immutable validation context');
    else assert.equal(main.record.inputPasses[failedGate],undefined,'a later failed subset execution must invalidate the older pass even without rerunning validation-context');
  });
});

test('workflow input reuse rejects changed inputs and uncertain original evidence', async parent => {
  const scenarios=[
    ['changed candidate bytes',(_x,f)=>({checkout:f.base,source:f.base})],
    ['changed comparison base',(_x,f)=>({base:f.head})],
    ['changed runner image',()=>({environment:{ImageVersion:'20261023.2.0'}})],
    ['unknown runner image',()=>({environment:{ImageVersion:''}})],
    ['external observation unavailable',x=>{x.error=true;}],
    ['fork producer',x=>{x.runs[0].head_repository.full_name='fork/repo';}],
    ['different workflow',x=>{x.runs[0].path='.github/workflows/other.yml';}],
    ['missing current job attempt',x=>{x.jobs[1].run_attempt=1;}],
    ['different job source',x=>{x.jobs[1].head_sha='f'.repeat(40);}],
    ['cancelled required job',x=>{x.jobs[1].conclusion='cancelled';}],
    ['skipped completion',x=>{x.jobs[1].steps[1].conclusion='skipped';}],
    ['duplicate completion',x=>{x.jobs[1].steps.push(x.jobs[1].steps[1]);}],
    ['missing execution admission',x=>{x.jobs[1].steps.shift();}],
    ['duplicate execution admission',x=>{x.jobs[1].steps.push(x.jobs[1].steps[0]);}],
    ['incomplete result fingerprint',x=>{x.jobs[1].steps[1].name=x.jobs[1].steps[1].name.slice(0,-1);}],
    ['different original Git tree',x=>{x.merge.tree.sha='f'.repeat(40);}],
    ['different original merge base',x=>{x.merge.parents[0].sha='f'.repeat(40);}],
    ['different original source parent',x=>{x.merge.parents[1].sha='f'.repeat(40);}],
    ['duplicate validation context',x=>{x.jobs.push(x.jobs[0]);}],
  ];
  for(const [name,mutate]of scenarios)await parent.test(name,t=>{
    const f=fixture(t),plan=invoke(f,{event:'pull_request',ref:'refs/pull/17/merge',checkout:f.merge,planOnly:true});
    const github=publishedInputPass(f,plan.record);const options=mutate(github,f)||{};writeFileSync(f.external,JSON.stringify(github));
    const main=invoke(f,{ref:'refs/heads/main',checkout:f.merge,source:f.merge,...options});
    assert.equal(main.status,0,main.stderr);assert.equal(main.record?.inputPasses?.core,undefined,name+' must require actual execution');
  });
});

test('workflow input reuse orders actual gate executions across rerun IDs', async parent => {
  for(const [name,start,end,accepted]of [
    ['later failure in older run','2026-10-27T11:00:00Z','2026-10-27T11:01:00Z',false],
    ['failure before the successful execution','2026-10-27T09:00:00Z','2026-10-27T09:01:00Z',true],
    ['overlapping contradictory execution','2026-10-27T09:59:00Z','2026-10-27T10:00:40Z',false],
    ['unknown failure chronology',null,null,false],
  ])await parent.test(name,t=>{
    const f=fixture(t),plan=invoke(f,{event:'pull_request',ref:'refs/pull/17/merge',checkout:f.merge,planOnly:true});
    const github=publishedInputPass(f,plan.record);
    github.attempts['71/2']={...github.runs[0]};github.jobsByAttempt['71/attempts/2']=structuredClone(github.jobs);
    const passed=github.jobs.map(job=>({...structuredClone(job),id:job.id+10,run_id:72,run_attempt:1}));
    attachInputArtifacts(f,github,passed);
    const failed=github.jobs.map(job=>({...structuredClone(job),run_attempt:3,...(job.name==='regression-core'?{conclusion:'failure',started_at:start,completed_at:end,steps:job.steps.filter(step=>!step.name.startsWith('Completed CI gate ')).map(step=>({...step,started_at:start,completed_at:start}))}:{})}));
    github.jobsByRun={71:failed,72:passed};github.runs=[{...github.runs[0],run_attempt:3,conclusion:'failure'},{...github.runs[0],id:72,run_attempt:1}];
    writeFileSync(f.external,JSON.stringify(github));
    const main=invoke(f,{ref:'refs/heads/main',checkout:f.merge,source:f.merge});assert.equal(main.status,0,main.stderr);
    assert.equal(Boolean(main.record?.inputPasses?.core),accepted,name+' must follow actual execution chronology rather than run creation order');
  });
});

test('workflow input reuse requires readable retained original result and native artifacts', async parent=>{
  const scenarios=[
    ['missing archive',x=>{x.artifacts=[];}],
    ['expired archive',x=>{x.artifacts[0].expired=true;}],
    ['unreadable archive',x=>{x.archiveError=true;}],
    ['wrong archive digest',x=>{x.artifacts[0].digest='sha256:'+'0'.repeat(64);}],
    ['replacement archive after original job',x=>{x.artifacts[0].created_at='2026-10-27T11:00:00Z';}],
    ['duplicate archive',x=>{x.artifacts.push({...x.artifacts[0],id:999});}],
    ['changed original result',x=>{const a=x.artifacts[0],directory=a.fixturePath.slice(0,-4);writeFileSync(path.join(directory,'result.json'),'{}');spawnSync('zip',['-q',a.fixturePath,'result.json'],{cwd:directory});a.digest='sha256:'+createHash('sha256').update(readFileSync(a.fixturePath)).digest('hex');}],
    ['missing native proof',x=>{const a=x.artifacts[0];spawnSync('zip',['-qd',a.fixturePath,'native/original.json']);a.digest='sha256:'+createHash('sha256').update(readFileSync(a.fixturePath)).digest('hex');}],
  ];
  for(const [name,mutate]of scenarios)await parent.test(name,t=>{
    const f=fixture(t),plan=invoke(f,{event:'pull_request',ref:'refs/pull/17/merge',checkout:f.merge,planOnly:true});
    const github=publishedInputPass(f,plan.record);mutate(github);writeFileSync(f.external,JSON.stringify(github));
    const main=invoke(f,{ref:'refs/heads/main',checkout:f.merge,source:f.merge});assert.equal(main.status,0,main.stderr);
    assert.equal(main.record.inputPasses.core,undefined,name+' must require current execution');
  });
});

test('workflow input reuse retains large original native evidence and rejects changed bytes', async parent=>{
  for(const scenario of ['retained large original','changed native bytes','wrong declared bytes'])await parent.test(scenario,t=>{
    const f=fixture(t),plan=invoke(f,{event:'pull_request',ref:'refs/pull/17/merge',checkout:f.merge,planOnly:true});
    f.largeNativeEvidence=Buffer.concat([Buffer.alloc(33*1024*1024,32),Buffer.from('{"status":"passed"}\n')]);
    const github=publishedInputPass(f,plan.record,['native-process']);
    const artifact=github.artifacts.find(a=>a.name.endsWith('-native-process')),directory=artifact.fixturePath.slice(0,-4);
    if(scenario!=='retained large original'){
      const reportPath=path.join(directory,'result.json'),report=JSON.parse(readFileSync(reportPath));
      if(scenario==='changed native bytes'){f.largeNativeEvidence[0]=10;writeFileSync(path.join(directory,'native/original.json'),f.largeNativeEvidence);}
      else report.artifacts[0].bytes--;
      const bytes=JSON.stringify(report);writeFileSync(reportPath,bytes);
      const marker=github.jobs.find(j=>j.name==='regression-native-process').steps.find(s=>s.name.startsWith('Completed CI gate '));
      marker.name=marker.name.replace(/result [a-f0-9]{64}$/, 'result '+createHash('sha256').update(bytes).digest('hex'));
      const zip=spawnSync('zip',['-qr',artifact.fixturePath,'.'],{cwd:directory,encoding:'utf8'});assert.equal(zip.status,0,zip.stderr);
      artifact.digest='sha256:'+createHash('sha256').update(readFileSync(artifact.fixturePath)).digest('hex');
    }
    writeFileSync(f.external,JSON.stringify(github));
    const main=invoke(f,{ref:'refs/heads/main',checkout:f.merge,source:f.merge});assert.equal(main.status,0,main.stderr);
    if(scenario==='retained large original'){
      assert.ok(main.record.inputPasses['native-process'],'the actual router must retain a successful native original above the old buffered-read limit');
      assert.equal(main.record.inputPasses['native-process'].coveredBy.runId,'71');
    }else{assert.equal(main.record.inputPasses['native-process'],undefined,scenario+' must require current execution');}
  });
});

test('reconciled input reuse retains transferred early and browser evidence bytes', async parent=>{
 for(const kind of ['earlyReceiptRef','browserRuntimeReceipt'])for(const changed of [false,true])await parent.test(kind+(changed?' changed':' original'),t=>{
  const f=fixture(t),plan=invoke(f,{event:'pull_request',checkout:f.merge,planOnly:true}),github=publishedInputPass(f,plan.record,['native-process']);
  const artifact=github.artifacts[0],directory=artifact.fixturePath.slice(0,-4),reportPath=path.join(directory,'result.json'),report=JSON.parse(readFileSync(reportPath));
  const folder=kind==='earlyReceiptRef'?'early-startup-evidence':'browser-runtime-preflight';mkdirSync(path.join(directory,folder));
  const raw=Buffer.from('retained actual raw fixture stream\n'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  writeFileSync(path.join(directory,folder,'raw.tap'),changed?'changed bytes\n':raw);
  const receipt=Buffer.from(JSON.stringify({status:'passed',resultIdentity:report.resultIdentity,identity:{descriptor:report.resultIdentity},artifacts:[{path:'raw.tap',bytes:raw.length,sha256:hash(raw)}]}));
  writeFileSync(path.join(directory,folder,'receipt.json'),receipt);report[kind]={path:folder+'/receipt.json',sha256:hash(receipt)};
  const bytes=JSON.stringify(report);writeFileSync(reportPath,bytes);github.jobs.find(job=>job.name==='regression-native-process').steps.find(step=>step.name.startsWith('Completed CI gate ')).name=`Completed CI gate native-process input ${plan.record.inputKeys['native-process']} result ${hash(bytes)}`;
  assert.equal(spawnSync('zip',['-qr',artifact.fixturePath,'.'],{cwd:directory}).status,0);artifact.digest='sha256:'+hash(readFileSync(artifact.fixturePath));writeFileSync(f.external,JSON.stringify(github));
  const result=invoke(f,{ref:'refs/heads/main',checkout:f.merge,source:f.merge});assert.equal(result.status,0,result.stderr);
  assert.equal(Boolean(result.record.inputPasses['native-process']),!changed,'Changed transferred evidence must execute the gate instead of accepting a stale original');
 });
});

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

test('workflow mandatory input policy rejects legacy coverage without original gate artifacts',t=>{
  const f=fixture(t),first=invoke(f,{event:'pull_request',ref:'refs/pull/17/merge',checkout:f.merge});published(f,first.record);
  const required=invoke(f,{environment:{ROUTING_REQUIRE_INPUT_PASSES:'1'}});assert.equal(required.status,0,required.stderr);
  assert.equal(required.record.decision,'full','hosted policy must not inherit an unretained legacy completion marker');assert.deepEqual(required.record.inputPasses,{});
  const workflow=readFileSync(path.join(repo,'.github/workflows/data-safety.yml'),'utf8');
  assert.match(workflow,/ci-routing\.mjs --require-input-passes 1 --descriptor/);assert.match(workflow,/ci-routing\.mjs --require-input-passes 1 --input-proof/);
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
    assert.equal(result.record.observations.some(item=>item.url.includes('/pulls')), false, 'fresh events must not wait for a canonical PR; only complete input-pass evidence may cover them');
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
  github.jobs=['validation-context','event-gates','cohort-routing',...(f.early?['early-startup','mobile-stress']:[]),...groupedIds.map(id=>'regression-'+id)].map(name=>({...original,name,steps:name==='validation-context'?[{name:`Announce regression context ${record.contextSha256}`,conclusion:'success'}]:name==='early-startup'?[{name:`Complete early startup report ${'6'.repeat(64)}`,conclusion:'success'}]:name==='cohort-routing'?[{name:`Admit original full producer context ${record.contextSha256}`,status:'completed',conclusion:'success'}]:[]})).concat(original);
  writeFileSync(f.external,JSON.stringify(github));return github;
}
function publishedOriginalEarly(f,record,github,variant='valid'){
 const original=github.runs[0],id={...JSON.parse(readFileSync(path.join(f.root,'descriptor-1.json'))).resultIdentity,...Object.fromEntries(['repository','sourceSha','sourceTree','checkoutSha','checkoutTree','comparisonBase','cohortDigestSha256','inventorySha256','assignmentsSha256','expectedGroups'].map(key=>[key,record.cohortContext[key]])),runId:String(original.id),runAttempt:Number(original.run_attempt),eventPolicy:record.cohortContext.eventPolicy};
 const root=path.join(f.root,'original-early'),policy={eventPolicy:id.eventPolicy,eventName:'pull_request',eventRef:'refs/pull/17/merge'};
 const required=createMobileBundle(path.join(root,'required'),{candidateCommit:id.checkoutSha,candidateTree:id.checkoutTree,sourceSha:id.sourceSha,repository:id.repository,runId:id.runId,runAttempt:id.runAttempt,eventPolicy:id.eventPolicy});
 const stress=createMobileBundle(path.join(f.root,'original-stress'),{candidateCommit:id.checkoutSha,candidateTree:id.checkoutTree,sourceSha:id.sourceSha,repository:id.repository,runId:id.runId,runAttempt:id.runAttempt,eventPolicy:id.eventPolicy},'stress-512mb');
 for(const bundle of [required,stress]){bundle.report.hostedPolicy=policy;for(const row of [bundle.report.negativeControl,...bundle.report.cases]){row.hostedPolicy=policy;row.server.hostedPolicy=policy;}for(const native of Object.values(bundle.native))native.hostedPolicy=policy;refreshMobileBundle(bundle);}
 if(variant==='wrong cap'){required.report.requiredStory.memoryBudgetBytes=512000000;refreshMobileBundle(required);}
 const names=['RISK repository process: Playwright waitForFunction predicates are synchronous','RISK repository process: scenery consumers use allocated fallback ports and preserve early native failures','RISK repository process: native scene-time bursts cannot activate controls behind a refused top-layer release'];
 writeFileSync(path.join(root,'harness.stdout'),'TAP version 13\n'+names.map((name,i)=>`# Subtest: ${name}\nok ${i+1} - ${name}\n`).join(''));writeFileSync(path.join(root,'harness.stderr'),'');
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),artifacts=[];const visit=dir=>{for(const item of readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())visit(file);else{const bytes=readFileSync(file);artifacts.push({path:path.relative(root,file).split(path.sep).join('/'),bytes:bytes.length,sha256:hash(bytes)});}}};
 visit(root);
 const receipt={schemaVersion:1,status:'passed',mode:variant==='covered early'?'covered':'full',identity:{descriptor:id,workflowBlob:record.cohortContext.workflowBlob,harnessSourceSha256:hash(readFileSync(path.join(f.source,'scripts/early-ci-harness-source.json'))),runtime:record.inputContext.runtime,eventName:'pull_request',eventRef:'refs/pull/17/merge'},children:['harness','required-1gb'].map(kind=>({kind,exitCode:0,signal:null,error:null})),harnessCaseCount:3,artifacts:artifacts.sort((a,b)=>a.path.localeCompare(b.path))};
 const bytes=JSON.stringify(receipt);writeFileSync(path.join(root,'receipt.json'),bytes);
 if(variant==='changed raw')writeFileSync(path.join(root,'harness.stdout'),'changed stream\n');
 for(const [name,directory]of [['early-startup',root],['mobile-stress',stress.directory]]){
  const job=github.jobs.find(job=>job.name===name);Object.assign(job,{id:name==='early-startup'?1701:1702,started_at:'2026-10-27T10:00:00Z',completed_at:'2026-10-27T10:01:00Z'});
  job.steps=[{name:name==='early-startup'?'Required saved harness and populated mobile startup':'Report 512MB application stress with required execution integrity',status:'completed',conclusion:'success'},...(name==='early-startup'?[{name:`Complete early startup report ${hash(bytes)}`,status:'completed',conclusion:'success'}]:[])];
  const archive=directory+'.zip';assert.equal(spawnSync('zip',['-qr',archive,'.'],{cwd:directory}).status,0);const data=readFileSync(archive);
  github.artifacts||=[];if(variant!=='missing early'||name!=='early-startup')github.artifacts.push({id:2000+github.artifacts.length,name:`${name}-${original.id}-${original.run_attempt}`,expired:false,created_at:'2026-10-27T10:00:45Z',expires_at:'2030-01-01T00:00:00Z',digest:'sha256:'+hash(data),workflow_run:{id:original.id,head_sha:original.head_sha},fixturePath:archive});
 }
 return hash(bytes);
}
function publishedOriginalAggregate(f,context,github,run,jobs,{early=null,mode='full'}={}){
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),id={...context,runId:String(run.id),runAttempt:Number(run.run_attempt),checkoutDirty:false,selectedGroup:null};
 const report={schemaVersion:1,status:'passed',mode,resultIdentity:id,issues:[],emulatorCoverage:{},caseCount:4,groups:groupedIds.map(group=>({group,cases:1,earlyCases:0,resultSha256:jobs.find(job=>job.name==='regression-'+group).steps.find(step=>step.name.startsWith('Completed CI gate ')).name.split(' result ')[1],identity:{...id,selectedGroup:group}})),...(early?{earlyEvidence:{mode:'full',receiptSha256:early},stressEvidence:{status:'passed',reportSha256:hash(readFileSync(path.join(f.root,'original-stress/report.json')))}}:{})};
 const directory=path.join(f.root,'original-aggregate');mkdirSync(path.join(directory,'aggregate'),{recursive:true});const bytes=JSON.stringify(report);writeFileSync(path.join(directory,'aggregate/aggregate.json'),bytes);
 const job=jobs.find(job=>job.name==='scanner-tests');for(const step of job.steps)if(/ report [a-f0-9]{64}/.test(step.name))step.name=step.name.replace(/ report [a-f0-9]{64}/,' report '+hash(bytes));Object.assign(job,{id:job.id||1800,started_at:'2026-10-27T10:00:00Z',completed_at:'2026-10-27T10:01:00Z'});
 const archive=directory+'.zip';assert.equal(spawnSync('zip',['-qr',archive,'.'],{cwd:directory}).status,0);github.artifacts||=[];github.artifacts.push({id:3000+github.artifacts.length,name:`scanner-aggregate-${run.id}-${run.run_attempt}`,expired:false,created_at:'2026-10-27T10:00:45Z',expires_at:'2030-01-01T00:00:00Z',digest:'sha256:'+hash(readFileSync(archive)),workflow_run:{id:run.id,head_sha:run.head_sha},fixturePath:archive});
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
  const github=publishedGroups(f,first.record),covered=github.jobs.map(job=>({...job,run_id:72,run_attempt:1,steps:job.name==='cohort-routing'?[]:job.name==='scanner-tests'?[{name:`Verified complete cohort ${first.record.contextSha256} report ${'9'.repeat(64)} mode reuse`,conclusion:'success'}]:job.steps}));
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
  const context={repository:'fixture/repo',sourceSha:f.base,sourceTree:baseTree,checkoutSha:f.base,checkoutTree:baseTree,comparisonBase:baseParent,eventPolicy:'exact-main-push-v1',requiredCohort:'four-groups-v1',runtime:{node:process.versions.node,platform:process.platform,arch:process.arch},cohortDigestSha256:'1'.repeat(64),inventorySha256:'2'.repeat(64),assignmentsSha256:'3'.repeat(64),expectedGroups:groupedIds,workflowBlob:git(f.source,'rev-parse',f.base+':.github/workflows/data-safety.yml'),...(f.early?{earlyPolicy:'saved-harness-required-mobile-v1'}:{})};
  const digest=createHash('sha256').update(JSON.stringify(context)).digest('hex');
  const step=name=>({name,status:'completed',conclusion:'success'});
  const names=['validation-context','event-gates','cohort-routing',...(f.early?['early-startup','mobile-stress']:[]),...groupedIds.map(id=>'regression-'+id),'scanner-tests','release-evidence','deploy-pages'];
  const github={runs:[{id:70,run_attempt:1,status:'completed',conclusion:'success',event:'push',head_branch:'main',head_sha:f.base,name:'Data safety',path:'.github/workflows/data-safety.yml',repository:{full_name:'fixture/repo'},head_repository:{full_name:'fixture/repo'}}],jobs:names.map(name=>({name,status:'completed',conclusion:'success',run_id:70,run_attempt:1,head_sha:f.base,steps:name==='validation-context'?[step(`Announce regression context ${digest}`),step(`Actual checkout ${f.base} tree ${baseTree}`),step(`Validation source ${f.base} base ${baseParent}`),step(`Workflow blob ${context.workflowBlob} policy four-groups-v1`)]:name==='early-startup'?[step(`Complete early startup report ${'6'.repeat(64)}`)]:name==='scanner-tests'?[step(`Complete regression context ${digest} report ${'8'.repeat(64)}`)]:name.startsWith('regression-')?[step('Execute complete assigned group')]:name==='event-gates'?[step('Run npm run test:rules'),step('Backward compatibility')]:[]})),statuses:['funsidething/memory-audit','funsidething/independent-review','funsidething/specialist-review'].map(context=>({context,state:'success',description,created_at:new Date().toISOString()}))};
  github.fixtureContext=context;writeFileSync(f.external,JSON.stringify(github));return github;
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

test('reconciled policy input routing refuses an unretained full-product origin',t=>{
 const f=fixture(t,true,true);publishedPolicyBase(f);
 const result=invoke(f,{event:'pull_request',checkout:f.merge,environment:{...descriptorFor(f,f.merge),ROUTING_REQUIRE_INPUT_PASSES:'1'}});
 assert.equal(result.status,0,result.stderr);assert.equal(result.record.decision,'full','A legacy full marker cannot substitute for six retained original gate passes in the hosted policy path');
 assert.equal(executions(f).length,1,'Unavailable policy inheritance falls back to actual required execution');
});

test('reconciled policy routing uses six keyed originals and refuses a covered origin',t=>{
 const f=fixture(t,true,true),github=publishedPolicyBase(f),baseTree=git(f.source,'rev-parse',f.base+'^{tree}'),parent=git(f.source,'rev-parse',f.base+'^');
 const inputs={policy:'complete-ci-inputs-v1',repository:'fixture/repo',checkoutTree:baseTree,comparisonBase:parent,runtime:{node:process.versions.node,platform:process.platform,arch:process.arch,imageOS:'ubuntu24',imageVersion:'20261022.1.0'}};
 const gates=['core','scenery','persistence-recovery','native-process','rules','compatibility'];
 for(const [index,job]of github.jobs.entries()){
  job.id=700+index;job.started_at='2026-10-27T10:00:00Z';job.completed_at='2026-10-27T10:01:00Z';
  if(job.name==='event-gates')job.steps=[];
  for(const gate of gates.filter(gate=>job.name===(['rules','compatibility'].includes(gate)?'event-gates':'regression-'+gate))){
   const key=createHash('sha256').update(JSON.stringify({...inputs,gate})).digest('hex');
   job.steps.push({name:`Execute CI gate ${gate} input ${key}`,status:'completed',conclusion:'success',completed_at:'2026-10-27T10:00:11Z'},{name:`Completed CI gate ${gate} input ${key} result ${'8'.repeat(64)}`,status:'completed',conclusion:'success',completed_at:'2026-10-27T10:00:50Z'});
  }
 }
 f.artifactIdentity={checkoutSha:f.base,checkoutTree:baseTree,comparisonBase:parent};attachInputArtifacts(f,github,github.jobs);publishedOriginalAggregate(f,github.fixtureContext,github,github.runs[0],github.jobs);github.commits={[f.base]:{sha:f.base,tree:{sha:baseTree},parents:[{sha:parent}]}};writeFileSync(f.external,JSON.stringify(github));
 const environment={...descriptorFor(f,f.merge),ROUTING_REQUIRE_INPUT_PASSES:'1'};
 const result=invoke(f,{event:'pull_request',checkout:f.merge,environment});assert.equal(result.status,0,result.stderr);
 assert.equal(result.record.decision,'policy-reuse','The current workflow names must admit the retained original full execution');assert.equal(Object.keys(result.record.policyInputPasses).length,6);for(const gate of groupedIds.concat(['rules','compatibility']))assert.deepEqual(result.record.gateDecisions[gate].original,result.record.policyInputPasses[gate].coveredBy,'Durable policy decisions retain the actual original producer');assert.equal(executions(f).length,0);
 const workflow=readFileSync(path.join(repo,'.github/workflows/data-safety.yml'),'utf8'),upload=workflow.match(/- name: Preserve emulator gate evidence\n([\s\S]*?)\n      - name:/)?.[1];
 assert.match(upload||'',/if: always\(\) && steps\.selected\.outputs\.decision != 'policy-reuse'/,'Policy inheritance produces no current emulator archive; its upload must be skipped rather than failing the required job');
 github.jobs.find(job=>job.name==='scanner-tests').steps[0].name=`Verified complete cohort ${result.record.contextSha256} report ${'8'.repeat(64)} mode reuse`;writeFileSync(f.external,JSON.stringify(github));
 const covered=invoke(f,{event:'pull_request',checkout:f.merge,environment:{...descriptorFor(f,f.merge),ROUTING_REQUIRE_INPUT_PASSES:'1'}});assert.equal(covered.status,0,covered.stderr);assert.equal(covered.record.decision,'full','A covered or mixed consumer cannot become the policy origin');
});

function publishedReviewedProductOrigin(f,record,variant='valid'){
 const github=publishedPolicyBase(f),tree=git(f.source,'rev-parse',f.base+'^{tree}'),base=git(f.source,'rev-parse',f.base+'^');
 const head=git(f.source,'commit-tree',tree,'-p',base,'-m','independently reviewed full product head'),checkout=git(f.source,'commit-tree',tree,'-p',base,'-p',head,'-m','original full PR checkout');
 const context={...record.cohortContext,sourceSha:head,sourceTree:tree,checkoutSha:checkout,checkoutTree:tree,comparisonBase:base,eventPolicy:'canonical-pr-merge-v1'};
 const digest=createHash('sha256').update(JSON.stringify(context)).digest('hex'),runtime=variant==='original earlier image'?{...record.inputContext.runtime,imageVersion:'20261021.1.0'}:record.inputContext.runtime,inputs={policy:'complete-ci-inputs-v1',repository:'fixture/repo',checkoutTree:tree,comparisonBase:base,runtime};
 const origin={id:71,run_attempt:2,status:'completed',conclusion:'success',event:'pull_request',head_sha:head,name:'Data safety',path:'.github/workflows/data-safety.yml',repository:{full_name:'fixture/repo'},head_repository:{full_name:'fixture/repo'}};
 const originalJobs=github.jobs.map((job,index)=>({...job,id:1700+index,run_id:71,run_attempt:2,head_sha:head,started_at:'2026-10-27T10:00:00Z',completed_at:'2026-10-27T10:01:00Z',steps:[]}));
 const step=name=>({name,status:'completed',conclusion:'success'});
 originalJobs.find(job=>job.name==='validation-context').steps=[`Announce regression context ${digest}`,`Actual checkout ${checkout} tree ${tree}`,`Validation source ${head} base ${base}`,`Workflow blob ${context.workflowBlob} policy four-groups-v1`].map(step);
 originalJobs.find(job=>job.name==='cohort-routing').steps=[step(`Admit original full producer context ${digest}`)];
 originalJobs.find(job=>job.name==='scanner-tests').steps=[step(`${variant==='covered origin'?'Verified complete cohort':'Complete regression context'} ${digest} report ${'8'.repeat(64)}${variant==='covered origin'?' mode reuse':''}`)];
 for(const gate of ['core','scenery','persistence-recovery','native-process','rules','compatibility']){
  const job=originalJobs.find(job=>job.name===(['rules','compatibility'].includes(gate)?'event-gates':'regression-'+gate)),key=createHash('sha256').update(JSON.stringify({...inputs,gate})).digest('hex');
  if(job.name.startsWith('regression-'))job.steps.push(step('Execute complete assigned group'));
  job.steps.push({...step(`Execute CI gate ${gate} input ${key}`),completed_at:'2026-10-27T10:00:11Z'},{...step(`Completed CI gate ${gate} input ${key} result ${'8'.repeat(64)}`),completed_at:'2026-10-27T10:00:50Z'});
 }
 const mainJobs=github.jobs;mainJobs.find(job=>job.name==='scanner-tests').steps=[step(`Verified complete cohort ${digest} report ${'9'.repeat(64)} mode reuse`)];
 github.runs=[origin,...github.runs];github.runsByHead={[head]:[origin],[f.base]:github.runs.filter(run=>run.id===70)};github.jobs=originalJobs;github.jobsByRun={'71':originalJobs,'70':mainJobs};github.attempts={'71/1':{...origin,run_attempt:1,conclusion:'failure'}};github.jobsByAttempt={'71/attempts/1':[]};
 f.artifactIdentity={checkoutSha:checkout,checkoutTree:tree,comparisonBase:base};attachInputArtifacts(f,github,originalJobs);
 const early=publishedOriginalEarly(f,{...record,cohortContext:context,inputContext:inputs},github);
 github.commits={[checkout]:{sha:checkout,tree:{sha:tree},parents:[{sha:base},{sha:head}]}};
 github.restCommits={[f.base]:{sha:f.base,parents:[{sha:base}],commit:{tree:{sha:tree}}},[head]:{sha:head,parents:[{sha:base}],commit:{tree:{sha:variant==='changed reviewed tree'?'f'.repeat(40):tree}}}};
 github.associatedBySha={[f.base]:[{number:19,merge_commit_sha:f.base,merged_at:'2026-10-27T10:02:00Z',head:{sha:head,ref:'product',repo:{full_name:'fixture/repo'}},base:{sha:base,ref:'main',repo:{full_name:'fixture/repo'}}}]};github.comparison={status:'ahead'};
 const plan=deriveReleaseReviewPlan(f.source,head,base),canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
 const prefix=createHash('sha256').update(canonical(plan)).digest('hex').slice(0,12),description=`r=${'5'.repeat(64)};b=${base};p=${prefix};c=${plan.requiresCodeReview?1:0};s=${plan.requiresSpecialistReview?1:0};v=${variant==='policy receipt'?4:3}`;
 github.statusesBySha={[head]:['funsidething/memory-audit','funsidething/independent-review','funsidething/specialist-review'].map(context=>({context,state:'success',description,created_at:new Date().toISOString()}))};
 if(variant!=='missing aggregate')publishedOriginalAggregate(f,context,github,origin,originalJobs,{early,mode:variant==='mixed aggregate'?'mixed':'full'});
 writeFileSync(f.external,JSON.stringify(github));return{head,base,checkout,tree,early,github};
}

test('reconciled policy routing directly verifies the reviewed full origin behind covered main',async parent=>{
 for(const variant of ['valid','original earlier image','covered origin','changed reviewed tree','policy receipt','missing aggregate','mixed aggregate'])await parent.test(variant,t=>{
  const f=fixture(t,true,true,true),initial=invoke(f,{event:'pull_request',checkout:f.merge,planOnly:true,environment:descriptorFor(f,f.merge)});assert.equal(initial.status,0,initial.stderr);
  const original=publishedReviewedProductOrigin(f,initial.record,variant),result=invoke(f,{event:'pull_request',checkout:f.merge,environment:{...descriptorFor(f,f.merge),ROUTING_REQUIRE_INPUT_PASSES:'1'}});assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(result.record.decision,['valid','original earlier image'].includes(variant)?'policy-reuse':'full','Only the directly bound full reviewed execution may supply inherited product coverage: '+result.record.reason);
  if(['valid','original earlier image'].includes(variant)){assert.equal(result.record.policyOriginReview.reviewedSha,original.head);assert.equal(result.record.policyOriginReview.deployedSha,f.base);assert.equal(result.record.policyOriginReview.receiptSha256,'5'.repeat(64));assert.equal(result.record.cohortContext.sourceSha,original.head);assert.equal(result.record.cohortContext.comparisonBase,original.base);assert.equal(result.record.coveredBy.runId,'71');assert.equal(result.record.coveredBy.earlyReportSha256,original.early);assert.equal(Object.keys(result.record.policyInputPasses).length,6);assert.equal(executions(f).length,0);}
 });
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


test('early CI routing retains original full startup and stress proof for ordinary and policy coverage',async parent=>{
 for(const policy of [false,true])await parent.test(policy?'policy inheritance':'same-source reuse',async t=>{
  for(const fault of ['none','missing early','skipped early','missing stress','missing receipt'])await t.test(fault,sub=>{
   const f=fixture(sub,true,policy,true);let github;
   if(policy)github=publishedPolicyBase(f);else{const producer=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});assert.equal(producer.status,0,producer.stderr);github=publishedGroups(f,producer.record);}
   if(fault==='missing early')github.jobs=github.jobs.filter(job=>job.name!=='early-startup');
   if(fault==='skipped early')github.jobs.find(job=>job.name==='early-startup').conclusion='skipped';
   if(fault==='missing stress')github.jobs=github.jobs.filter(job=>job.name!=='mobile-stress');
   if(fault==='missing receipt')github.jobs.find(job=>job.name==='early-startup').steps=[];
   writeFileSync(f.external,JSON.stringify(github));
   const result=invoke(f,{event:policy?'pull_request':'push',checkout:policy?f.merge:f.head,environment:descriptorFor(f,policy?f.merge:f.head)});assert.equal(result.status,0,result.stderr);
   assert.equal(result.record.decision,fault==='none'?(policy?'policy-reuse':'reuse'):'full',result.stdout);
   if(fault==='none')assert.equal(result.record.coveredBy.earlyReportSha256,'6'.repeat(64));
  });
 });
});


test('metadata observation retains a bound pending producer without launching another cohort', t => {
  const f=fixture(t,true), first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});
  assert.equal(first.status,0,first.stdout+first.stderr);
  const github=publishedGroups(f,first.record);
  github.runs[0].status='in_progress';github.runs[0].conclusion=null;
  github.jobs=github.jobs.filter(job=>['validation-context','cohort-routing'].includes(job.name));
  writeFileSync(f.external,JSON.stringify(github));
  const result=invoke(f,{event:'pull_request',checkout:f.merge,action:'edited',changes:{body:{from:'prior evidence'}},environment:{...descriptorFor(f,f.merge),ROUTING_MAX_WAIT:'0'}});
  assert.equal(executions(f).length,1,'An announced pending producer must not launch a second full cohort');
  assert.equal(result.status,2,'Pending is incomplete, not successful');
  assert.equal(result.record.decision,'pending');
  assert.equal(result.record.coveredBy.runId,'71');
  assert.equal(result.record.coveredBy.runAttempt,'2');
  assert.equal(result.record.producerOutcome.status,'in_progress');
});

test('reconciled metadata input routing preserves pending failed and cancelled admission', async parent => {
  for (const [status, conclusion, decision, code] of [['in_progress',null,'pending',2],['completed','failure','fail',1],['completed','cancelled','cancelled',1]]) await parent.test(decision, t => {
    const f=fixture(t,true), first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});
    assert.equal(first.status,0,first.stderr);
    const github=publishedGroups(f,first.record);
    github.runs[0].status=status;github.runs[0].conclusion=conclusion;
    github.jobs=github.jobs.filter(job=>['validation-context','cohort-routing'].includes(job.name));
    writeFileSync(f.external,JSON.stringify(github));
    const result=invoke(f,{event:'pull_request',checkout:f.merge,action:'edited',changes:{body:{from:'old'}},environment:{...descriptorFor(f,f.merge),ROUTING_MAX_WAIT:'0',ROUTING_REQUIRE_INPUT_PASSES:'1'}});
    assert.equal(result.status,code,'Mandatory input-pass routing must retain the admitted producer outcome: '+result.stdout+result.stderr);
    assert.equal(result.record.decision,decision);
    assert.equal(result.record.coveredBy.runId,'71');
    assert.equal(executions(f).length,1,'No duplicate cohort or early mobile producer may be admitted');
  });
});

test('reconciled metadata routing retains six original gate passes and the full early producer', t => {
  const f=fixture(t,true,false,true), first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});
  const canonical=publishedGroups(f,first.record);
  const gates=['core','scenery','persistence-recovery','native-process','rules','compatibility'];
  const github=publishedInputPass(f,first.record,gates);
  for(const job of canonical.jobs){const keyed=github.jobs.find(row=>row.name===job.name);if(keyed)keyed.steps.push(...job.steps);else github.jobs.push(job);}
  Object.assign(github,{tree:canonical.tree});const earlyReport=publishedOriginalEarly(f,first.record,github);writeFileSync(f.external,JSON.stringify(github));
  const result=invoke(f,{event:'pull_request',checkout:f.merge,action:'edited',changes:{body:{from:'old'}},environment:{...descriptorFor(f,f.merge),ROUTING_REQUIRE_INPUT_PASSES:'1'}});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.record.decision,'reuse','Six retained passes plus the original complete early producer admit no new early or group child');
  assert.deepEqual(Object.keys(result.record.inputPasses).sort(),[...gates].sort());
  assert.equal(result.record.coveredBy.earlyReportSha256,earlyReport);
  assert.deepEqual(Object.keys(result.record.gateDecisions).sort(),[...gates].sort(),'The durable routing checkpoint retains every gate decision');
  for(const gate of gates){assert.equal(result.record.gateDecisions[gate].mode,'covered');assert.deepEqual(result.record.gateDecisions[gate].original,result.record.inputPasses[gate].coveredBy);}
  assert.equal(executions(f).length,1);
});

test('reconciled metadata routing holds a mixed early origin without duplicate mobile admission',t=>{
 const f=fixture(t,true,false,true),first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)}),github=publishedGroups(f,first.record);
 github.jobs.find(job=>job.name==='scanner-tests').steps=[{name:`Verified complete cohort ${first.record.contextSha256} report ${'8'.repeat(64)} mode reuse`,status:'completed',conclusion:'success'}];writeFileSync(f.external,JSON.stringify(github));
 const result=invoke(f,{event:'pull_request',checkout:f.merge,action:'edited',changes:{body:{from:'old'}},environment:{...descriptorFor(f,f.merge),ROUTING_REQUIRE_INPUT_PASSES:'1'}});
 assert.equal(result.status,2,'An unverified original early receipt is an observation gap, never permission for another mobile story');
 assert.equal(result.record.decision,'unresolved');assert.equal(result.record.nextGate,'verify-original-early-producer');
 assert.equal(result.record.producerKind,'early-evidence-unavailable');assert.equal(result.record.coveredBy.runId,'71');
 assert.equal(executions(f).length,1);
});

test('reconciled mixed metadata verifies original early artifacts without full-product authority',async parent=>{
 for(const variant of ['valid','wrong cap','covered early','changed raw','missing early'])await parent.test(variant,t=>{
  const f=fixture(t,true,false,true),first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)}),canonical=publishedGroups(f,first.record),github=publishedInputPass(f,first.record,['core','scenery','persistence-recovery','native-process','rules','compatibility']);
  for(const job of canonical.jobs){const keyed=github.jobs.find(row=>row.name===job.name);if(keyed)keyed.steps.push(...job.steps);else github.jobs.push(job);}github.tree=canonical.tree;
  const report=publishedOriginalEarly(f,first.record,github,variant);github.jobs.find(job=>job.name==='scanner-tests').steps=[{name:`Verified complete cohort ${first.record.contextSha256} report ${'8'.repeat(64)} mode reuse`,status:'completed',conclusion:'success'}];writeFileSync(f.external,JSON.stringify(github));
  const result=invoke(f,{event:'pull_request',checkout:f.merge,action:'edited',changes:{body:{from:'old'}},environment:{...descriptorFor(f,f.merge),ROUTING_REQUIRE_INPUT_PASSES:'1'}});
  assert.equal(result.status,variant==='valid'?0:2,'Only actual complete retained early execution can suppress the mobile story: '+result.stdout+result.stderr);
  if(variant==='valid'){assert.equal(result.record.decision,'full','Mixed evidence cannot claim legacy full-cohort reuse');assert.equal(result.record.coveredBy,null);assert.equal(result.record.earlyCoverage.coveredBy.earlyReportSha256,report);assert.equal(result.record.earlyCoverage.coveredBy.runId,'71');assert.equal(Object.keys(result.record.inputPasses).length,6);}
  else assert.equal(result.record.decision,'unresolved');
  assert.equal(executions(f).length,1,'Observing originals starts no equivalent gate or early workload');
 });
});


test('metadata observation preserves cancelled producers and incomplete final evidence', async parent => {
 for(const [name,mutate,decision,code] of [
  ['cancelled',x=>{x.runs[0].conclusion='cancelled';x.jobs=x.jobs.filter(job=>['validation-context','cohort-routing'].includes(job.name));},'cancelled',1],
  ['failed',x=>{x.runs[0].conclusion='failure';x.jobs=x.jobs.filter(job=>['validation-context','cohort-routing'].includes(job.name));},'fail',1],
  ['missing completion',x=>{x.jobs.find(job=>job.name==='scanner-tests').steps=[];},'unresolved',2],
  ['missing aggregate',x=>{x.jobs=x.jobs.filter(job=>job.name!=='scanner-tests');},'unresolved',2],
  ['unknown lifecycle',x=>{x.runs[0].status='unclassified';},'unresolved',2],
  ['unknown conclusion',x=>{x.runs[0].conclusion='neutral';},'unresolved',2],
 ]) await parent.test(name,t=>{
  const f=fixture(t,true),first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});
  assert.equal(first.status,0,first.stderr);const github=publishedGroups(f,first.record);mutate(github);writeFileSync(f.external,JSON.stringify(github));
  const result=invoke(f,{event:'pull_request',checkout:f.merge,action:'edited',changes:{body:{from:'previous'}},environment:descriptorFor(f,f.merge)});
  assert.equal(result.record.decision,decision,result.stdout+result.stderr);assert.equal(result.status,code);
  assert.equal(result.record.coveredBy.runId,'71');assert.equal(result.record.producerOutcome.conclusion,github.runs[0].conclusion);
  assert.equal(executions(f).length,1,'Metadata must preserve actual unsuccessful history without launching another cohort');
 });
});


test('metadata observation resumes the saved producer in a fresh process despite newer equivalent history', t => {
 const f=fixture(t,true),first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});
 assert.equal(first.status,0,first.stderr);const github=publishedGroups(f,first.record);
 github.runs[0].status='in_progress';github.runs[0].conclusion=null;writeFileSync(f.external,JSON.stringify(github));
 const pending=invoke(f,{event:'pull_request',checkout:f.merge,action:'edited',changes:{body:{from:'before'}},environment:{...descriptorFor(f,f.merge),ROUTING_MAX_WAIT:'0'}});
 assert.equal(pending.record.decision,'pending');
 const saved=path.join(f.root,'attempt-'+f.attempt,'ci-routing/routing.json'),binding=JSON.parse(readFileSync(saved));
 assert.equal(binding.coveredBy.runId,'71');
 github.runs[0].status='completed';github.runs[0].conclusion='failure';
 github.jobsByRun={'71':github.jobs,'72':github.jobs.map(job=>({...job,run_id:72,run_attempt:1}))};
 github.runs.unshift({...github.runs[0],id:72,run_attempt:1,conclusion:'success'});writeFileSync(f.external,JSON.stringify(github));
 const resumed=invoke(f,{event:'pull_request',checkout:binding.validationContext.checkoutSha,base:binding.validationContext.comparisonBase,action:'edited',changes:{body:{from:'before'}},environment:{...descriptorFor(f,f.merge),ROUTING_RESUME:saved}});
 assert.equal(resumed.record.decision,'fail','Resumption must observe the saved producer rather than hide its failure behind newer success');
 assert.equal(resumed.record.coveredBy.runId,'71');assert.equal(resumed.status,1);
 assert.equal(executions(f).length,1,'Observation/resumption launches zero additional cohorts');
 const freshOutput=path.join(f.root,'fresh-no-conversation'),freshEnv={...process.env,PATH:f.bin+path.delimiter+process.env.PATH,ROUTING_GITHUB:f.external};delete freshEnv.NODE_TEST_CONTEXT;for(const key of Object.keys(freshEnv))if(key.startsWith('GITHUB_'))delete freshEnv[key];
 const fresh=spawnSync(process.execPath,[command,'--resume',saved,'--evidence-dir',freshOutput],{cwd:f.source,env:freshEnv,encoding:'utf8',timeout:15000});
 assert.equal(fresh.status,1,fresh.stdout+fresh.stderr);const freshRecord=JSON.parse(readFileSync(path.join(freshOutput,'routing.json')));assert.equal(freshRecord.decision,'fail');assert.equal(freshRecord.coveredBy.runId,binding.coveredBy.runId);assert.equal(freshRecord.contextSha256,binding.contextSha256);

 const requests=readFileSync(f.external+'.requests','utf8').trim().split('\n').map(JSON.parse);
 assert.ok(requests.every(args=>!args.some(value=>/dispatch|POST|PATCH|PUT/.test(value))),'Actual transport children only observe GitHub');
});


test('workflow metadata events serialize equivalent admission and run the actual routing command once per event', async t => {
 const f=fixture(t,true);rmSync(path.join(f.bin,'npm'));
 // Real isolated npm test callbacks are counted; only the GitHub service and
 // its documented concurrency scheduler are controlled in this process proof.
 writeFileSync(path.join(f.source,'tests.js'),"import {test} from 'node:test';import fs from 'node:fs';test('isolated admitted cohort',()=>{fs.appendFileSync(process.env.ROUTING_EXECUTIONS,JSON.stringify({sha:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID})+'\\n')});\n");
 git(f.source,'add','.');git(f.source,'-c','core.hooksPath=/dev/null','commit','-qm','real process callback');
 f.head=git(f.source,'rev-parse','HEAD');f.tree=git(f.source,'rev-parse','HEAD^{tree}');f.merge=git(f.source,'commit-tree',f.tree,'-p',f.base,'-p',f.head,'-m','concurrent merge');git(f.source,'checkout','--detach',f.merge);
 const workflow=readFileSync(path.join(repo,'.github/workflows/data-safety.yml'),'utf8');
 const route=workflow.match(/      - name: Resolve complete cohort coverage\n[\s\S]*?        run: ([^\n]+)/);assert.ok(route,'Actual event routing command required');
 const concurrency=workflow.match(/^concurrency:\n  group: ([^\n]+)\n  cancel-in-progress: (true|false)$/m);
 const admission=workflow.match(/      - name: (Admit original full producer context [^\n]+)\n        if: ([^\n]+)\n        run: ([^\n]+)/);
 const queues=new Map();
 const eventKey=index=>concurrency?concurrency[1].replaceAll('${{ github.workflow }}','Data safety').replaceAll('${{ github.event.pull_request.number || github.ref }}','17'):'event-'+index;
 const launch=async index=>{
  const key=eventKey(index),previous=queues.get(key)||Promise.resolve();
  let release;queues.set(key,new Promise(resolve=>{release=resolve;}));await previous;
  try {
   if(concurrency)assert.equal(concurrency[2],'false','A metadata event cannot cancel its running producer');
   const output=path.join(f.root,'scheduled-'+index),descriptor=descriptorFor(f,f.merge).ROUTING_DESCRIPTOR;f.attempt++;
   mkdirSync(path.join(output,'validation/descriptor'),{recursive:true});writeFileSync(path.join(output,'validation/descriptor/descriptor.json'),readFileSync(descriptor));
   const eventPath=path.join(output,'event.json');writeFileSync(eventPath,JSON.stringify({action:'edited',changes:{body:{from:'previous'}},number:17,pull_request:{head:{sha:f.head,ref:'topic'}}}));
   const script=route[1].replace('node scripts/agent-tools/ci-routing.mjs',JSON.stringify(process.execPath)+' '+JSON.stringify(command)).replace('${{ needs.validation-context.outputs.base }}','$ROUTING_BASE')+"\n"+`decision="$(node -p "require('$RUNNER_TEMP/ci-routing/routing.json').decision")"\nif [[ "$decision" == "full" ]]; then npm test; elif [[ "$decision" != "reuse" ]]; then exit 1; fi`;
   const env={...process.env,PATH:f.bin+path.delimiter+process.env.PATH,RUNNER_TEMP:output,ROUTING_BASE:f.base,ROUTING_EXECUTIONS:f.journal,ROUTING_GITHUB:f.external,GITHUB_REPOSITORY:'fixture/repo',GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:eventPath,GITHUB_SHA:f.merge,GITHUB_REF:'refs/pull/17/merge',GITHUB_RUN_ID:String(100+f.attempt),GITHUB_RUN_ATTEMPT:'1',ImageOS:'ubuntu24',ImageVersion:'20261022.1.0'};delete env.NODE_TEST_CONTEXT;
   const result=await new Promise(resolve=>{const child=spawn('bash',['-euo','pipefail','-c',script],{cwd:f.source,env});let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('close',status=>resolve({status,stdout,stderr}));});
   writeFileSync(path.join(output,'consumer.stdout'),result.stdout);writeFileSync(path.join(output,'consumer.stderr'),result.stderr);writeFileSync(path.join(output,'command.sh'),script);
   assert.equal(result.status,0,result.stdout+result.stderr);const record=JSON.parse(readFileSync(path.join(output,'ci-routing/routing.json')));
   let admitted=false;if(admission){assert.equal(admission[2],"success() && steps.route.outputs.decision == 'full'");if(record.decision==='full'){const step=spawnSync('bash',['-euo','pipefail','-c',admission[3]],{cwd:f.source,env,encoding:'utf8'});assert.equal(step.status,0,step.stderr);admitted=true;}}
   if(record.decision==='full'){
    const canonical=publishedGroups(f,record),github=publishedInputPass(f,record,['core','scenery','persistence-recovery','native-process','rules','compatibility']);
    for(const job of canonical.jobs){const keyed=github.jobs.find(row=>row.name===job.name);if(keyed)keyed.steps.push(...job.steps);else github.jobs.push(job);}
    github.tree=canonical.tree;github.jobs.find(job=>job.name==='cohort-routing').steps=admitted?[{name:admission[1].replace('${{ needs.validation-context.outputs.context }}',record.contextSha256),status:'completed',conclusion:'success'}]:[];
    github.runs[0].id=Number(record.runId);github.runs[0].run_attempt=Number(record.runAttempt);github.jobs.forEach(job=>{job.run_id=Number(record.runId);job.run_attempt=Number(record.runAttempt);});github.artifacts=[];github.attempts={};github.jobsByAttempt={};attachInputArtifacts(f,github,github.jobs);writeFileSync(f.external,JSON.stringify(github));
   }
   return record;
  }finally{release();}
 };
 const settled=await Promise.allSettled([launch(0),launch(1)]);for(const result of settled)assert.equal(result.status,'fulfilled',String(result.reason));const records=settled.map(result=>result.value);
 assert.deepEqual(records.map(record=>record.decision).sort(),['full','reuse'],'Concurrent equivalent metadata events admit exactly one full producer');
 assert.equal(executions(f).length,1,'Count actual npm child callbacks, not successful routing exits');
 assert.equal(new Set(records.map(record=>record.contextSha256)).size,1);
 const producer=records.find(record=>record.decision==='full'),covered=records.find(record=>record.decision==='reuse');assert.equal(covered.coveredBy.runId,producer.runId);assert.equal(covered.coveredBy.runAttempt,producer.runAttempt);assert.equal(covered.coveredBy.checkoutSha,f.merge);assert.equal(covered.coveredBy.checkoutTree,f.tree);assert.equal(executions(f)[0].runId,producer.runId);
});


test('metadata observation recovers after an actual interrupted process using only durable evidence', async t => {
 const f=fixture(t,true),first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});
 assert.equal(first.status,0,first.stderr);const github=publishedGroups(f,first.record);
 github.runs[0].status='in_progress';github.runs[0].conclusion=null;writeFileSync(f.external,JSON.stringify(github));
 const descriptor=descriptorFor(f,f.merge).ROUTING_DESCRIPTOR,output=path.join(f.root,'interrupted');mkdirSync(output);
 const eventPath=path.join(output,'event.json');writeFileSync(eventPath,JSON.stringify({action:'edited',changes:{body:{from:'before interruption'}},number:17,pull_request:{head:{sha:f.head,ref:'topic'}}}));
 f.attempt++;const env={...process.env,PATH:f.bin+path.delimiter+process.env.PATH,ROUTING_GITHUB:f.external,GITHUB_REPOSITORY:'fixture/repo',GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:eventPath,GITHUB_SHA:f.merge,GITHUB_REF:'refs/pull/17/merge',GITHUB_RUN_ID:String(100+f.attempt),GITHUB_RUN_ATTEMPT:'1',ImageOS:'ubuntu24',ImageVersion:'20261022.1.0'};delete env.NODE_TEST_CONTEXT;
 const child=spawn(process.execPath,[command,'--descriptor',descriptor,'--comparison-base',f.base,'--evidence-dir',path.join(output,'routing'),'--max-wait-ms','9000','--poll-interval-ms','5000'],{cwd:f.source,env,stdio:'ignore'});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 const ended=new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal}))),file=path.join(output,'routing/routing.json');
 let saved;for(let i=0;i<200;i++){if(existsSync(file)){try{saved=JSON.parse(readFileSync(file));}catch{}}if(saved?.decision==='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(saved?.decision,'pending','The pending producer binding must be durable before waiting');child.kill('SIGTERM');assert.equal((await ended).signal,'SIGTERM');
 assert.equal(saved.coveredBy.runId,'71');assert.equal(saved.nextGate,'resume-bound-producer-observation');assert.ok(saved.observations.length>0);
 github.runs[0].status='completed';github.runs[0].conclusion='success';writeFileSync(f.external,JSON.stringify(github));
 const resumed=invoke(f,{event:saved.eventName,checkout:saved.validationContext.checkoutSha,base:saved.validationContext.comparisonBase,action:'edited',changes:{body:{from:'before interruption'}},environment:{...descriptorFor(f,saved.validationContext.checkoutSha),ROUTING_RESUME:file}});
 assert.equal(resumed.status,0,resumed.stdout+resumed.stderr);assert.equal(resumed.record.decision,'reuse');assert.equal(resumed.record.coveredBy.runId,saved.coveredBy.runId);assert.equal(resumed.record.resumedFrom.path,file);assert.equal(executions(f).length,1);
 assert.equal(JSON.parse(readFileSync(file)).decision,'pending','Resumption must retain original interrupted evidence');
});


test('metadata observation requires fresh validation for changed complete contexts or unverifiable admission', async parent=>{
 for(const [name,mutate,descriptorChange] of [
  ['base',x=>{x.pulls[0].base.sha='b'.repeat(40);}],
  ['checkout',x=>{x.pulls[0].merge_commit_sha='c'.repeat(40);x.merge.sha='c'.repeat(40);}],
  ['source',x=>{x.pulls[0].head.sha='d'.repeat(40);}],
  ['event policy',x=>{x.runs[0].event='push';}],
  ['repository',x=>{x.runs[0].repository.full_name='other/repo';}],
  ['workflow/configuration',x=>{x.tree.tree[0].sha='e'.repeat(40);}],
  ['cohort inventory',()=>{},true],
  ['missing announcement',x=>{x.jobs.find(job=>job.name==='validation-context').steps=[];}],
 ])await parent.test(name,t=>{
  const f=fixture(t,true),first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});assert.equal(first.status,0,first.stderr);
  const github=publishedGroups(f,first.record);mutate(github);writeFileSync(f.external,JSON.stringify(github));const env=descriptorFor(f,f.merge);
  if(descriptorChange){const file=env.ROUTING_DESCRIPTOR,descriptor=JSON.parse(readFileSync(file));descriptor.resultIdentity.cohortDigestSha256='4'.repeat(64);writeFileSync(file,JSON.stringify(descriptor));}
  const result=invoke(f,{event:'pull_request',checkout:f.merge,action:'edited',changes:{body:{from:'prior'}},environment:env});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.record.decision,'full',name+' cannot inherit source SHA alone');assert.equal(result.record.coveredBy,null);assert.equal(executions(f).length,2);
 });
});


test('metadata observation skips failed observers without full producer admission and retains original execution',t=>{
 const f=fixture(t,true),first=invoke(f,{event:'pull_request',checkout:f.merge,environment:descriptorFor(f,f.merge)});assert.equal(first.status,0,first.stderr);
 const github=publishedGroups(f,first.record),observer=github.jobs.map(job=>({...job,run_id:72,run_attempt:1,steps:job.name==='cohort-routing'?[]:job.steps}));
 github.jobsByRun={'71':github.jobs,'72':observer};github.runs.unshift({...github.runs[0],id:72,run_attempt:1,conclusion:'cancelled'});writeFileSync(f.external,JSON.stringify(github));
 const result=invoke(f,{event:'pull_request',checkout:f.merge,action:'edited',changes:{body:{from:'earlier'}},environment:descriptorFor(f,f.merge)});
 assert.equal(result.record.decision,'reuse','A cancelled observer cannot impersonate original full producer admission');assert.equal(result.status,0,result.stderr);assert.equal(result.record.coveredBy.runId,'71');assert.equal(executions(f).length,1);
});
