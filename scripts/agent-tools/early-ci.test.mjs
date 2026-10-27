import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
// Model only the external GitHub scheduler boundary. Every dispatched job is
// an actual fresh OS child; the current checked-in workflow supplies all edges.
function dispatch(outcome){
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/data-safety.yml'),'utf8');
 const blocks=[...workflow.matchAll(/^  ([a-z-]+):\n([\s\S]*?)(?=^  [a-z-]+:\n|$(?![\s\S]))/gm)];
 const jobs=new Map(blocks.map(([,id,body])=>[id,{needs:(body.match(/^    needs: (.+)$/m)?.[1]||'').replace(/[\[\]]/g,'').split(/,\s*|\s+/).filter(Boolean),body}]));
 const results={},launched=[];
 for(const id of ['validation-context','cohort-routing','early-startup','event-gates','regression','mobile-stress','scanner-tests','release-evidence','deploy-pages']){
  if(!jobs.has(id))continue;const job=jobs.get(id),blocked=job.needs.some(dep=>results[dep]!=='success');
  if(blocked&&!/^    if: always\(\)/m.test(job.body)){results[id]='skipped';continue;}
  // Explicit always guards must still require success for every declared need.
  if(blocked&&id==='regression'&&job.needs.some(dep=>!job.body.includes(`needs.${dep}.result == 'success'`))===false){results[id]='skipped';continue;}
  const count=id==='regression'?4:1;
  for(let i=0;i<count;i++){const child=spawnSync(process.execPath,['-e',"process.stdout.write('dispatched')"],{encoding:'utf8'});assert.equal(child.status,0);launched.push(id);}
  results[id]=id==='early-startup'?outcome:id==='scanner-tests'&&blocked?'failure':'success';
 }
 return {launched,results};
}
test('early CI workflow failure blocks every expensive child and deployment',()=>{
 const observed=dispatch('failure');assert.equal(observed.launched.filter(id=>['regression','event-gates','mobile-stress','deploy-pages'].includes(id)).length,0,'failed early story must dispatch zero expensive or deployment children');
 assert.notEqual(observed.results['scanner-tests'],'success','aggregate cannot pass blocked coverage');
});
test('early CI workflow success retains the complete assigned cohort and deployment chain',()=>{
 const observed=dispatch('success');assert.equal(observed.launched.filter(id=>id==='regression').length,4);assert.equal(observed.results['event-gates'],'success');assert.equal(observed.results['scanner-tests'],'success');assert.equal(observed.results['deploy-pages'],'success');
});

import {createHash} from 'node:crypto';
import {createMobileBundle} from './mobile-memory-fixture.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const requiredCases=['RISK repository process: Playwright waitForFunction predicates are synchronous','RISK repository process: scenery consumers use allocated fallback ports and preserve early native failures','RISK repository process: native scene-time bursts cannot activate controls behind a refused top-layer release'];
function fixture(t,{mode='pass'}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-early-process-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const repo=path.join(directory,'repo'),out=path.join(directory,'early'),journal=path.join(directory,'children.jsonl');fs.mkdirSync(path.join(repo,'scripts'),{recursive:true});fs.mkdirSync(path.join(repo,'.github/workflows'),{recursive:true});
 for(const name of ['early-ci.mjs','test-groups.mjs','release-evidence.mjs','button-safety-mobile-contract.mjs','button-safety-inventory.json','button-safety-contract.mjs','button-safety-ci-policy.mjs'])fs.copyFileSync(path.join(root,'scripts',name),path.join(repo,'scripts',name));
 fs.writeFileSync(path.join(repo,'package.json'),'{"type":"module"}\n');fs.writeFileSync(path.join(repo,'.github/workflows/data-safety.yml'),'jobs:\n  early-startup:\n    runs-on: controlled-fixture\n');
 const tests="import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';fs.appendFileSync(process.env.EARLY_JOURNAL,'harness\\n');\n"+requiredCases.map((name,index)=>`test(${JSON.stringify(name)},{skip:process.env.EARLY_MODE==='skip'&&${index}===0},()=>{if(process.env.EARLY_MODE==='cancel'&&${index}===0)process.kill(process.pid,'SIGTERM');if(process.env.EARLY_MODE==='fail'&&${index}===0)assert.fail('controlled original story failure');});`).join('\n')+'\n';fs.writeFileSync(path.join(repo,'tests.js'),tests);
 const mobile="import fs from 'node:fs';import path from 'node:path';fs.appendFileSync(process.env.EARLY_JOURNAL,'mobile\\n');const args=process.argv.slice(2),out=args[args.indexOf('--output-dir')+1];if(process.env.EARLY_MODE==='missing')process.exit(0);fs.cpSync(process.env.EARLY_SEED,out,{recursive:true});\n";fs.writeFileSync(path.join(repo,'scripts/button-safety-mobile-memory.mjs'),mobile);
 const bytes=Buffer.from(mobile),manifest={schemaVersion:1,sourceCommit:'9b5bc1c9d5a87fed022a17706bbb0e69e94757b1',files:[{path:'scripts/button-safety-mobile-memory.mjs',sha256:digest(bytes),gitBlob:createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex')}],testExcerpts:[]};fs.writeFileSync(path.join(repo,'scripts/early-ci-harness-source.json'),JSON.stringify(manifest));
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};git('init','-q');git('add','.');git('-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Synthetic process boundary; no native proof');const sha=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
 const id={repository:'example/fixture',eventPolicy:'outgoing-branch-push-v1',runId:'100',runAttempt:1,sourceSha:sha,sourceTree:tree,checkoutSha:sha,checkoutTree:tree,checkoutDirty:false,comparisonBase:sha,selectedGroup:null,expectedGroups:['core','scenery','persistence-recovery','native-process']};const descriptor=path.join(directory,'descriptor.json');fs.writeFileSync(descriptor,JSON.stringify({schemaVersion:1,resultIdentity:id}));
 const seed=path.join(directory,'seed');createMobileBundle(seed,{candidateCommit:sha,candidateTree:tree,sourceSha:sha,repository:id.repository,runId:id.runId,runAttempt:1,eventPolicy:id.eventPolicy});
 // The parser fixture is independently labeled local. Give every raw witness
 // the actual raw/routed event identity and refresh immutable artifact hashes.
 const bundle=createMobileBundle(path.join(directory,'seed-hosted'),{candidateCommit:sha,candidateTree:tree,sourceSha:sha,repository:id.repository,runId:id.runId,runAttempt:1,eventPolicy:id.eventPolicy});
 const policy={eventPolicy:id.eventPolicy,eventName:'push',eventRef:'refs/heads/fixture'};bundle.report.hostedPolicy=policy;for(const row of [bundle.report.negativeControl,...bundle.report.cases]){row.hostedPolicy=policy;row.server.hostedPolicy=policy;}for(const native of Object.values(bundle.native))native.hostedPolicy=policy;
 const env={...process.env,CI:'true',GITHUB_REPOSITORY:id.repository,CHAIN_TEST_SOURCE_SHA:sha,CHAIN_TEST_EVENT_POLICY:id.eventPolicy,GITHUB_RUN_ID:'100',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/fixture',EARLY_MODE:mode,EARLY_JOURNAL:journal,EARLY_SEED:bundle.directory};delete env.NODE_TEST_CONTEXT;
 return{directory,repo,out,journal,descriptor,bundle,env,run:(args)=>spawnSync(process.execPath,['scripts/early-ci.mjs',...args,'--descriptor',descriptor],{cwd:repo,env,encoding:'utf8',timeout:10000}),counts:()=>fs.existsSync(journal)?fs.readFileSync(journal,'utf8').trim().split('\n'):[]};
}
import {refreshMobileBundle} from './mobile-memory-fixture.mjs';
test('early CI public command preserves durable predecessor authority and rejects corrupted artifacts',async t=>{
 const f=fixture(t);refreshMobileBundle(f.bundle);const initial=f.run(['--run','--output-dir',f.out]);assert.equal(initial.status,0,initial.stdout+initial.stderr);assert.deepEqual(f.counts(),['harness','mobile']);
 const receipt=path.join(f.out,'receipt.json'),verified=f.run(['--verify','--receipt',receipt]);assert.equal(verified.status,0,'Fresh process must accept durable proof alone: '+verified.stderr);assert.deepEqual(f.counts(),['harness','mobile'],'verification launches no workload child');
 const baselineEnv={...f.env},baselineDescriptor=fs.readFileSync(f.descriptor),baselineReceipt=fs.readFileSync(receipt),raw=fs.readFileSync(path.join(f.out,'harness.stdout'));
 const descriptorChange=change=>{const x=JSON.parse(baselineDescriptor);change(x.resultIdentity);fs.writeFileSync(f.descriptor,JSON.stringify(x));};
 for(const [name,mutate]of [
  ['missing raw artifact',()=>fs.unlinkSync(path.join(f.out,'harness.stdout'))],
  ['stale attempt',()=>f.env.GITHUB_RUN_ATTEMPT='2'],
  ['wrong source',()=>f.env.CHAIN_TEST_SOURCE_SHA='0'.repeat(40)],
  ['wrong raw event',()=>f.env.GITHUB_EVENT_NAME='pull_request'],
  ['wrong checkout tree',()=>descriptorChange(x=>x.checkoutTree='0'.repeat(40))],
  ['missing comparison base',()=>descriptorChange(x=>x.comparisonBase='0'.repeat(40))],
  ['cancelled child receipt',()=>{const x=JSON.parse(baselineReceipt);x.children[0].signal='SIGTERM';fs.writeFileSync(receipt,JSON.stringify(x));}],
 ])await t.test(name,()=>{Object.assign(f.env,baselineEnv);fs.writeFileSync(f.descriptor,baselineDescriptor);fs.writeFileSync(receipt,baselineReceipt);fs.writeFileSync(path.join(f.out,'harness.stdout'),raw);mutate();const r=f.run(['--verify','--receipt',receipt]);assert.notEqual(r.status,0,name+' cannot authorize downstream');assert.deepEqual(f.counts(),['harness','mobile']);});
});
test('early CI public command refuses failed skipped cancelled and missing mandatory execution',async t=>{
 for(const mode of ['fail','skip','cancel','missing'])await t.test(mode,sub=>{const f=fixture(sub,{mode});refreshMobileBundle(f.bundle);const r=f.run(['--run','--output-dir',f.out]);assert.notEqual(r.status,0,'Controlled '+mode+' cannot pass');assert.deepEqual(f.counts(),mode==='missing'?['harness','mobile']:['harness']);const receipt=path.join(f.out,'receipt.json');assert.equal(JSON.parse(fs.readFileSync(receipt)).status,'failed');assert.notEqual(f.run(['--verify','--receipt',receipt]).status,0);});
});

test('early CI workflow cancelled missing and skipped predecessors never authorize downstream',()=>{
 for(const outcome of ['cancelled','skipped',undefined]){const observed=dispatch(outcome);assert.equal(observed.launched.filter(id=>['regression','event-gates','mobile-stress','deploy-pages'].includes(id)).length,0);assert.notEqual(observed.results['scanner-tests'],'success');}
});
