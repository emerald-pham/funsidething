import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function fixture(t, grouped=false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'chain-ci-routing-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), bin = path.join(root, 'bin');
  mkdirSync(source); mkdirSync(bin);
  mkdirSync(path.join(source,'scripts/agent-tools'),{recursive:true});
  copyFileSync(path.join(repo,'scripts/agent-tools/ci-pass-reuse.mjs'),path.join(source,'scripts/agent-tools/ci-pass-reuse.mjs'));
  git(source, 'init', '-b', 'fixture');
  git(source, 'config', 'user.name', 'Routing fixture');
  git(source, 'config', 'user.email', 'routing@example.invalid');
  writeFileSync(path.join(source, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test tests.js' } }));
  writeFileSync(path.join(source, 'tests.js'), "import { test } from 'node:test';test('isolated routing fixture',()=>{});\n");
  if(grouped){for(const file of ['.github/workflows/data-safety.yml','scripts/test-group-inventory.json','scripts/test-group-assignments.json','scripts/test-groups.mjs','scripts/agent-tools/ci-routing.mjs']){mkdirSync(path.dirname(path.join(source,file)),{recursive:true});writeFileSync(path.join(source,file),'fixture '+file+'\n');}}
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
  writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.ROUTING_EXECUTIONS, JSON.stringify({argv:process.argv.slice(2),sha:process.env.GITHUB_SHA})+'\\n');\nif(process.argv.some(arg=>arg==='test:rules'||arg==='test:compatibility'))console.log('TAP version 13\\n# tests 24\\n# pass 24\\n# fail 0\\n# cancelled 0\\n# skipped 0');\n`);
  writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env node
const fs=require('node:fs'),x=JSON.parse(fs.readFileSync(process.env.ROUTING_GITHUB));
const url=process.argv.at(-1);
if(url.includes('/actions/artifacts/')&&url.endsWith('/zip')){if(x.archiveError)process.exit(22);process.stdout.write(fs.readFileSync(x.artifacts.find(a=>String(a.id)===url.split('/artifacts/')[1].split('/')[0]).fixturePath),()=>process.exit(0));return;}
if(url.includes('/runs?')&&x.runSequence?.length){x.runs=x.runSequence.shift();fs.writeFileSync(process.env.ROUTING_GITHUB,JSON.stringify(x));}
if(url.includes('/pulls?')&&x.pullSequence?.length){x.pulls=x.pullSequence.shift();fs.writeFileSync(process.env.ROUTING_GITHUB,JSON.stringify(x));}
if(x.error){process.stderr.write('controlled unavailable GitHub');process.exit(22);}
const jobs=x.jobsByAttempt?.[url.split('/runs/')[1]?.split('/jobs?')[0]]??x.jobsByRun?.[url.split('/runs/')[1]?.split('/')[0]]??x.jobs;
const artifacts=(x.artifacts||[]).filter(a=>String(a.workflow_run.id)===url.split('/runs/')[1]?.split('/')[0]);
console.log(JSON.stringify(url.includes('/artifacts?')?{total_count:artifacts.length,artifacts}:url.includes('/jobs?')?{total_count:jobs.length,jobs}:url.includes('/attempts/')?x.attempts?.[url.split('/runs/')[1].replace('/attempts/','/')]:url.includes('/pulls?')?(x.pulls??[]).map(({mergeable,...listed})=>listed):url.includes('/pulls/')?x.pulls?.[0]:url.includes('/git/commits/')?(x.commits?.[url.split('/git/commits/')[1]]??x.merge):url.includes('/git/trees/')?x.tree:{total_count:x.omitRunTotal?undefined:x.runs.length,workflow_runs:x.runs}));
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
if [[ "\${ROUTING_REQUIRE_INPUT_PASSES:-}" == "1" ]]; then set -- "$@" --require-input-passes 1; fi
if [[ -n "\${ROUTING_INPUT_PROOF:-}" ]]; then set -- "$@" --input-proof "$ROUTING_INPUT_PROOF"; fi
node "$ROUTING_COMMAND" "$@"
decision="$(node -p "require('$ROUTING_OUTPUT/ci-routing/routing.json').decision")"
if [[ "$decision" == "full" ]]; then npm test; elif [[ "$decision" != "reuse" ]]; then exit 1; fi`;
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
    const report={status:'passed',resultIdentity:{repository:'fixture/repo',runId:String(job.run_id),runAttempt:emulator?String(job.run_attempt):Number(job.run_attempt),sourceSha:job.head_sha,checkoutSha:f.merge,checkoutTree:f.tree,comparisonBase:f.base,selectedGroup:gate,checkoutDirty:false},
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
function descriptorFor(f,checkout) {
  const file=path.join(f.root,'descriptor-'+(f.attempt+1)+'.json');
  writeFileSync(file,JSON.stringify({resultIdentity:{repository:'fixture/repo',sourceSha:f.head,sourceTree:f.tree,checkoutSha:checkout,checkoutTree:git(f.source,'rev-parse',checkout+'^{tree}'),comparisonBase:f.base,runId:String(101+f.attempt),runAttempt:1,checkoutDirty:false,cohortDigestSha256:'1'.repeat(64),inventorySha256:'2'.repeat(64),assignmentsSha256:'3'.repeat(64),expectedGroups:groupedIds}}));
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
