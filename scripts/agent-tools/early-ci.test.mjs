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
 const results={},launched=[],children=[];
 for(const id of ['validation-context','cohort-routing','early-startup','event-gates','regression','mobile-stress','scanner-tests','release-evidence','deploy-pages']){
  if(!jobs.has(id))continue;const job=jobs.get(id),blocked=job.needs.some(dep=>results[dep]!=='success');
  if(blocked&&!/^    if: always\(\)/m.test(job.body)){results[id]='skipped';continue;}
  // Explicit always guards must still require success for every declared need.
  if(blocked&&id==='regression'&&job.needs.some(dep=>!job.body.includes(`needs.${dep}.result == 'success'`))===false){results[id]='skipped';continue;}
  const count=id==='regression'?4:1;
  for(let i=0;i<count;i++){const child=spawnSync(process.execPath,['-e',"process.stdout.write('dispatched')"],{encoding:'utf8'});assert.equal(child.status,0);launched.push(id);children.push({job:id,index:i,pid:child.pid,exitCode:child.status,signal:child.signal,stdout:child.stdout});}
  results[id]=id==='early-startup'?outcome:id==='scanner-tests'&&blocked?'failure':'success';
 }
 return {launched,results,children};
}
test('early CI workflow failure blocks every expensive child and deployment',t=>{
 const observed=dispatch('failure');t.diagnostic(JSON.stringify({scope:'controlled scheduler OS children',...observed}));assert.equal(observed.launched.filter(id=>['regression','event-gates','mobile-stress','deploy-pages'].includes(id)).length,0,'failed early story must dispatch zero expensive or deployment children');
 assert.notEqual(observed.results['scanner-tests'],'success','aggregate cannot pass blocked coverage');
});
test('early CI workflow success retains the complete assigned cohort and deployment chain',t=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/data-safety.yml'),'utf8');for(const job of ['early-startup','regression','scanner-tests']){const block=workflow.match(new RegExp('^  '+job+':\\n([\\s\\S]*?)(?=^  [a-z-]+:|$(?![\\s\\S]))','m'))?.[1];assert.ok(block?.includes('git fetch --no-tags origin b176026825e4f9539780f745fe60e09cf348d288'),'Each full consumer must receive the one immutable saved scenery object before setup: '+job);assert.ok(block.indexOf('git fetch --no-tags origin')<block.indexOf('actions/setup-node'),'Immutable object refusal precedes heavy runtime setup');}
 const observed=dispatch('success');t.diagnostic(JSON.stringify({scope:'controlled scheduler OS children',...observed}));assert.equal(observed.launched.filter(id=>id==='regression').length,4);assert.equal(observed.results['event-gates'],'success');assert.equal(observed.results['scanner-tests'],'success');assert.equal(observed.results['deploy-pages'],'success');
});

import {createHash} from 'node:crypto';
import {createMobileBundle} from './mobile-memory-fixture.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const requiredCases=['RISK repository process: Playwright waitForFunction predicates are synchronous','RISK repository process: scenery consumers use allocated fallback ports and preserve early native failures','RISK repository process: native scene-time bursts cannot activate controls behind a refused top-layer release'];
function fixture(t,{mode='pass'}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-early-process-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const repo=path.join(directory,'repo'),out=path.join(directory,'early'),journal=path.join(directory,'children.jsonl');fs.mkdirSync(path.join(repo,'scripts'),{recursive:true});fs.mkdirSync(path.join(repo,'.github/workflows'),{recursive:true});
 for(const name of ['early-ci.mjs','scenery-source-fixture.mjs','mobile-source-profile.mjs','test-groups.mjs','release-evidence.mjs','button-safety-mobile-contract.mjs','button-safety-inventory.json','button-safety-contract.mjs','button-safety-ci-policy.mjs'])fs.copyFileSync(path.join(root,'scripts',name),path.join(repo,'scripts',name));
 fs.mkdirSync(path.join(repo,'scripts/agent-tools'),{recursive:true});for(const name of ['checkpoint-progress.mjs','ci-pass-reuse.mjs','workflow-validator.mjs'])fs.copyFileSync(path.join(root,'scripts/agent-tools',name),path.join(repo,'scripts/agent-tools',name));
 fs.writeFileSync(path.join(repo,'package.json'),'{"type":"module"}\n');fs.writeFileSync(path.join(repo,'.github/workflows/data-safety.yml'),'jobs:\n  early-startup:\n    runs-on: controlled-fixture\n');
 const tests="import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';fs.appendFileSync(process.env.EARLY_JOURNAL,'harness\\n');\n"+requiredCases.map((name,index)=>`test(${JSON.stringify(name)},{skip:process.env.EARLY_MODE==='skip'&&${index}===0},()=>{if(process.env.EARLY_MODE==='cancel'&&${index}===0)process.kill(process.pid,'SIGTERM');if(process.env.EARLY_MODE==='fail'&&${index}===0)assert.fail('controlled original story failure');});`).join('\n')+'\n';fs.writeFileSync(path.join(repo,'tests.js'),tests);
 const mobile="import fs from 'node:fs';import path from 'node:path';fs.appendFileSync(process.env.EARLY_JOURNAL,'mobile\\n');const args=process.argv.slice(2),out=args[args.indexOf('--output-dir')+1];if(process.env.EARLY_MODE==='missing')process.exit(0);fs.cpSync(process.env.EARLY_SEED,out,{recursive:true});\n";fs.writeFileSync(path.join(repo,'scripts/button-safety-mobile-memory.mjs'),mobile);
 const bytes=Buffer.from(mobile),manifest={schemaVersion:1,sourceCommit:'9b5bc1c9d5a87fed022a17706bbb0e69e94757b1',files:[{path:'scripts/button-safety-mobile-memory.mjs',sha256:digest(bytes),gitBlob:createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex')}],testExcerpts:[]};fs.writeFileSync(path.join(repo,'scripts/early-ci-harness-source.json'),JSON.stringify(manifest));
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};git('init','-q');git('add','.');git('-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Synthetic process boundary; no native proof');const sha=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
 const id={repository:'example/fixture',eventPolicy:'outgoing-branch-push-v1',eventName:'push',eventRef:'refs/heads/fixture',eventAction:null,runId:'100',runAttempt:1,sourceSha:sha,sourceTree:tree,checkoutSha:sha,checkoutTree:tree,checkoutDirty:false,comparisonBase:sha,selectedGroup:null,expectedGroups:['core','scenery','persistence-recovery','native-process']};const descriptor=path.join(directory,'descriptor.json');fs.writeFileSync(descriptor,JSON.stringify({schemaVersion:1,resultIdentity:id}));
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
 const f=fixture(t);refreshMobileBundle(f.bundle);const initial=f.run(['--run','--output-dir',f.out]);assert.equal(initial.status,0,initial.stdout+initial.stderr);assert.deepEqual(f.counts(),['harness','mobile']);t.diagnostic(JSON.stringify({scope:'controlled public process children; no cap/browser proof',journal:f.counts(),receipt:JSON.parse(fs.readFileSync(path.join(f.out,'receipt.json'))).children}));
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

test('reconciled early consumer references an independently verified execution without workload children',t=>{
 const f=fixture(t);f.env.ImageOS='fixture-os';f.env.ImageVersion='fixture-image';refreshMobileBundle(f.bundle);
 assert.equal(f.run(['--run','--output-dir',f.out]).status,0);const descriptor=JSON.parse(fs.readFileSync(f.descriptor)),id=descriptor.resultIdentity;
 const inputs={policy:'complete-ci-inputs-v1',repository:id.repository,checkoutTree:id.checkoutTree,comparisonBase:id.comparisonBase,runtime:{node:process.versions.node,platform:process.platform,arch:process.arch,imageOS:'fixture-os',imageVersion:'fixture-image'}};
 const artifact={artifactId:'91',artifactName:'original-early',artifactSha256:'1'.repeat(64),artifactExpiresAt:'2030-01-01T00:00:00Z',reportSha256:digest(fs.readFileSync(path.join(f.out,'receipt.json')))};
 const pass={kind:'ci-early-execution-v1',inputs,inputKey:digest(JSON.stringify({...inputs,gate:'early-startup'})),coveredBy:{runId:'71',runAttempt:'2',earlyJobId:'701',stressJobId:'702',sourceSha:id.sourceSha,checkoutSha:id.checkoutSha,checkoutTree:id.checkoutTree,comparisonBase:id.comparisonBase,earlyReportSha256:artifact.reportSha256,earlyArtifact:artifact,stressArtifact:{...artifact,artifactId:'92',artifactName:'original-stress'}}};
 const proof=path.join(f.directory,'routing.json');fs.writeFileSync(proof,JSON.stringify({decision:'full',runId:id.runId,runAttempt:id.runAttempt,validationContext:id,earlyCoverage:pass}));
 const target=path.join(f.directory,'covered'),result=f.run(['--covered','--proof',proof,'--output-dir',target]);assert.equal(result.status,0,result.stderr);const receipt=JSON.parse(fs.readFileSync(path.join(target,'receipt.json')));assert.deepEqual(receipt.children,[]);assert.deepEqual(f.counts(),['harness','mobile']);assert.deepEqual(receipt.coverage,pass);
 assert.equal(f.run(['--verify','--proof',proof,'--receipt',path.join(target,'receipt.json')]).status,0);
 f.env.ImageVersion='changed-image';assert.notEqual(f.run(['--verify','--proof',proof,'--receipt',path.join(target,'receipt.json')]).status,0,'Current runner inputs must still match the original early execution');
});
test('early CI public command refuses failed skipped cancelled and missing mandatory execution',async t=>{
 for(const mode of ['fail','skip','cancel','missing'])await t.test(mode,sub=>{const f=fixture(sub,{mode});refreshMobileBundle(f.bundle);const r=f.run(['--run','--output-dir',f.out]);assert.notEqual(r.status,0,'Controlled '+mode+' cannot pass');assert.deepEqual(f.counts(),mode==='missing'?['harness','mobile']:['harness']);const receipt=path.join(f.out,'receipt.json');assert.equal(JSON.parse(fs.readFileSync(receipt)).status,'failed');sub.diagnostic(JSON.stringify({scope:'controlled refusal',mode,journal:f.counts(),receipt:JSON.parse(fs.readFileSync(receipt)).children}));assert.notEqual(f.run(['--verify','--receipt',receipt]).status,0);});
});

test('early CI workflow cancelled missing and skipped predecessors never authorize downstream',()=>{
 for(const outcome of ['cancelled','skipped',undefined]){const observed=dispatch(outcome);assert.equal(observed.launched.filter(id=>['regression','event-gates','mobile-stress','deploy-pages'].includes(id)).length,0);assert.notEqual(observed.results['scanner-tests'],'success');}
});


test('early CI canonical source admits its existing mixed owners through durable public verification',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-early-canonical-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const repo=path.join(directory,'repo');fs.mkdirSync(repo);
 const tracked=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'});assert.equal(tracked.status,0);
 for(const file of tracked.stdout.split('\0').filter(Boolean)){const destination=path.join(repo,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,file),destination);}
 const git=(...args)=>{const result=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
 git('init','-q');git('add','.');git('-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Actual canonical source admission fixture');
 const sha=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
 const id={repository:'example/fixture',eventPolicy:'outgoing-branch-push-v1',eventName:null,eventRef:null,eventAction:null,runId:'100',runAttempt:1,sourceSha:sha,sourceTree:tree,checkoutSha:sha,checkoutTree:tree,checkoutDirty:false,comparisonBase:sha,expectedGroups:['core','scenery','persistence-recovery','native-process']};
 const descriptor=path.join(directory,'descriptor.json');fs.writeFileSync(descriptor,JSON.stringify({resultIdentity:id}));
 const context={repository:id.repository,sourceSha:sha,sourceTree:tree,checkoutSha:sha,checkoutTree:tree,comparisonBase:sha,requiredCohort:'four-groups-v1',expectedGroups:id.expectedGroups};
 const proof=path.join(directory,'proof.json');fs.writeFileSync(proof,JSON.stringify({decision:'reuse',runId:100,runAttempt:1,validationContext:id,cohortContext:context,contextSha256:digest(JSON.stringify(context)),coveredBy:{runId:'71',runAttempt:'2',checkoutSha:sha,checkoutTree:tree,comparisonBase:sha,reportSha256:'8'.repeat(64),earlyReportSha256:'9'.repeat(64)}}));
 const env={...process.env,GITHUB_REPOSITORY:id.repository,CHAIN_TEST_SOURCE_SHA:sha,CHAIN_TEST_EVENT_POLICY:id.eventPolicy,GITHUB_RUN_ID:'100',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:undefined,GITHUB_EVENT_PATH:undefined,GITHUB_REF:undefined};delete env.NODE_TEST_CONTEXT;
 const invoke=args=>spawnSync(process.execPath,['scripts/early-ci.mjs',...args,'--descriptor',descriptor,'--proof',proof],{cwd:repo,env,encoding:'utf8',timeout:15000});
 const output=path.join(directory,'early'),started=invoke(['--covered','--output-dir',output]);assert.equal(started.status,0,'Actual canonical manifest must admit its literal core/native owners: '+started.stderr);
 const receipt=path.join(output,'receipt.json');assert.equal(invoke(['--verify','--receipt',receipt]).status,0,'A fresh verifier must re-admit the exact canonical source');
 const result=JSON.parse(fs.readFileSync(receipt));assert.equal(result.identity.harnessSourceSha256,digest(fs.readFileSync(path.join(root,'scripts/early-ci-harness-source.json'))));assert.deepEqual(result.children,[],'Controlled inherited coverage starts zero current workload children');
 const predicate=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+requiredCases[0]+'$','tests.js'],{cwd:repo,env,encoding:'utf8',timeout:15000});assert.equal(predicate.status,0,predicate.stdout+predicate.stderr);const predicateOutcomes=predicate.stdout.match(/^ok \d+ - RISK repository process: Playwright waitForFunction predicates are synchronous$/gm)||[];assert.equal(predicateOutcomes.length,1,'The actual canonical Node predicate child must execute exactly one existing early root, never two duplicate registrations: '+predicate.stdout);assert.match(predicate.stdout,/# skipped 0$/m);
 t.diagnostic('Actual canonical Node predicate child completed exactly one required outcome with zero skips.');
 const rows=JSON.parse(fs.readFileSync(path.join(repo,'scripts/test-group-assignments.json'))).rootAssignments.filter(row=>row.executionStage==='early-startup');assert.deepEqual(rows.map(({root,group})=>({root,group})).sort((a,b)=>a.root.localeCompare(b.root)),[
  {root:requiredCases[0],group:'core'},...requiredCases.slice(1).map(root=>({root,group:'native-process'})),
  ...['RISK scenery backdrop cache: first unchanged lighting timer reuses actual pixels while changed slots and loaded copy still paint','RISK scenery text loading: delayed bank reuses identical backdrop while current copy visitors and changed scenes refresh'].map(root=>({root,group:'native-process'})),
 ].sort((a,b)=>a.root.localeCompare(b.root)));

 const localDirectory=path.join(directory,'local-allocation');fs.mkdirSync(localDirectory);const boundary=path.join(localDirectory,'runtime-boundary-file');fs.writeFileSync(boundary,'owned deliberate pre-browser boundary');
 const foreignMissing=path.join(localDirectory,'foreign-missing'),foreignFile=path.join(localDirectory,'foreign-file');fs.writeFileSync(foreignFile,'foreign controlled fixture');const foreignLoop=path.join(localDirectory,'foreign-loop');fs.symlinkSync('foreign-loop',foreignLoop);
 const resources=['browser-runtime:playwright-chromium','loopback:127.0.0.1:31275'],own={id:'own-fixture',status:'active',worktree:repo,resources,lease:{state:'healthy',expiresAt:new Date(Date.now()+60000).toISOString(),ownerConfirmationRequired:false}},foreign={id:'foreign-fixture',status:'active',worktree:foreignMissing,resources:[],unknown:{opaque:'retain exact foreign fields'}};
 const scenarios=[
  ['missing foreign path',[foreign,own],true,/EEXIST|file already exists/],
  ['foreign path under a regular file',[{...foreign,worktree:foreignFile+'/child'},own],true,/EEXIST|file already exists/],
  ['missing parked foreign browser conflict',[{...foreign,status:'parked',resources:[resources[0]]},own],false,/Conflicting local native allocation/],
  ['missing active foreign port conflict',[{...foreign,resources:[resources[1]]},own],false,/Conflicting local native allocation/],
  ['missing own allocation',[foreign],false,/Active worktree allocation/],
  ['expired own lease',[foreign,{...own,lease:{...own.lease,expiresAt:'2000-01-01T00:00:00.000Z'}}],false,/healthy worktree lease/],
  ['ambiguous own allocation',[foreign,own,{...own,id:'duplicate-own-fixture',worktree:repo+path.sep+'.'}],false,/Ambiguous active worktree allocation/],
  ['malformed foreign identity',[{...foreign,worktree:null},own],false,/ERR_INVALID_ARG_TYPE|path.*string/i],
  ['unresolvable foreign symlink',[{...foreign,worktree:foreignLoop},own],false,/ELOOP|too many symbolic links/i],
 ];
 for(const [name,entries,admitted,expected]of scenarios){
  const ledger=path.join(localDirectory,name.replaceAll(' ','-')+'.json'),raw=JSON.stringify({version:1,entries,unknown:{preserve:'all raw ledger bytes'}},null,2)+'\n';fs.writeFileSync(ledger,raw);
  const localEnv={...process.env,CODEX_COORDINATION_FILE:ledger};for(const key of ['CI','DOW_EMULATOR_COORDINATION_FILE','NODE_TEST_CONTEXT','NODE_OPTIONS'])delete localEnv[key];
  const local=spawnSync(process.execPath,['scripts/button-safety.mjs','--run','--engine','chromium','--probe','--port','31275','--output-dir',boundary],{cwd:repo,env:localEnv,encoding:'utf8',timeout:10000});assert.equal(local.error,undefined);assert.equal(local.signal,null);assert.notEqual(local.status,0,'Every controlled public consumer stops before browser work');assert.equal(fs.readFileSync(ledger,'utf8'),raw,'All own/foreign ledger bytes must remain exact: '+name);assert.equal(fs.readFileSync(boundary,'utf8'),'owned deliberate pre-browser boundary');
  const observed=local.stdout+local.stderr;if(admitted)assert.equal(/EEXIST|file already exists/.test(observed),true,'Valid own allocation must reach its deliberate runtime-preparation boundary despite an unavailable foreign path: '+name);else{assert.match(observed,expected,'Unsafe allocation must fail closed: '+name+'\n'+observed);assert.doesNotMatch(observed,/EEXIST|file already exists/,'Refused allocation cannot reach runtime work: '+name);}
 }
 t.diagnostic('Local allocation public consumer passed9 isolated ledger cases without foreign or own ledger writes; no browser was launched.');

 t.diagnostic('Actual canonical source/manifest/catalog covered admission with controlled GitHub producer metadata starts zero workload children; the separately counted canonical predicate child executes once; no hosted or native qualification.');
});
