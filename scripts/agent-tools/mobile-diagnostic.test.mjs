import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const modulePath='../button-safety-mobile-diagnostic.mjs';
const hosted={CI:'true',CHAIN_TEST_EVENT_POLICY:'outgoing-branch-push-v1',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/diagnose/webkit-cap-31c'};
const temporary=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mobile-startup-diagnostic-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
test('diagnostic CLI exposes exactly seven bounded controls without launching a runtime',async()=>{
 const result=spawnSync(process.execPath,['scripts/button-safety-mobile-diagnostic.mjs','--plan'],{cwd:root,encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);const p=JSON.parse(result.stdout);
 assert.equal(p.kind,'button-mobile-memory-diagnostic');assert.equal(p.acceptanceEligible,false);assert.equal(p.appSourceCommit,'31c98a6e075f180681a49d1647b2462521c7ac5f');
 assert.deepEqual(p.cases.map(c=>c.id),['negative','minimal-fresh','minimal-handoff','original-normal','original-reduced','reuse-normal','reuse-reduced']);
 for(const c of p.cases){assert.equal(c.timeoutMs,60000);assert.equal(c.memoryBytes,512000000);assert.equal(c.swapBytes,0);}assert.equal(p.cases.filter(c=>c.reuseObserverPage).length,2);
 const {diagnosticContainerArgs}=await import(modulePath);for(const c of p.cases){const args=diagnosticContainerArgs({repo:'/repo-fixture',output:'/evidence-fixture',nodeBinary:'/node22',caseDefinition:c,...{eventPolicy:hosted.CHAIN_TEST_EVENT_POLICY,eventName:hosted.GITHUB_EVENT_NAME,eventRef:hosted.GITHUB_REF}});assert.equal(args[args.indexOf('--memory')+1],'512000000');assert.equal(args[args.indexOf('--memory-swap')+1],'512000000');assert.equal(args[args.indexOf('--shm-size')+1],'67108864');assert.ok(args.includes('/tmp:rw,nosuid,size=67108864'));assert.equal(args[args.indexOf('--network')+1],'none');assert.ok(args.includes('--read-only'));assert.ok(args.includes('GITHUB_REF='+hosted.GITHUB_REF));assert.ok(args.includes('scripts/button-safety-mobile-diagnostic.mjs'));assert.equal(args[args.indexOf('--case')+1],c.id);}
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'scripts/test-group-assignments.json'),'utf8')).rootAssignments;
 const names=[...fs.readFileSync(fileURLToPath(import.meta.url),'utf8').matchAll(/^test\('([^']+)'/gm)].map(match=>match[1]);for(const name of names)assert.equal(catalog.filter(row=>row.root===name&&row.file==='scripts/agent-tools/mobile-diagnostic.test.mjs'&&row.group==='native-process').length,1,'Each diagnostic root must have one actual catalog assignment: '+name);
});
test('actual diagnostic consumer refuses local and canonical release launches before output mutation',t=>{
 const output=path.join(temporary(t),'sentinel');fs.writeFileSync(output,'preserve');
 const invoke=(env,linux)=>spawnSync(process.execPath,linux?['--input-type=module','-e',`Object.defineProperty(process,'platform',{value:'linux'});const{runDiagnostic}=await import('./scripts/button-safety-mobile-diagnostic.mjs');try{await runDiagnostic({outputDir:process.env.DIAGNOSTIC_OUTPUT});}catch(e){process.stderr.write(e.message);process.exitCode=1;}`]:['scripts/button-safety-mobile-diagnostic.mjs','--run','--output-dir',output],{cwd:root,env:{...process.env,...env,DIAGNOSTIC_OUTPUT:output},encoding:'utf8',timeout:5000});
 // Linux admission is simulated only up to an intentional filesystem stop;
 // this process fixture never launches Docker or produces cap evidence.
 for(const [env,linux]of [[{...hosted,CI:'false'},false],[{...hosted,GITHUB_REF:'refs/heads/integration/webkit-button-safety'},true],[{...hosted,GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/pull/285/merge',CHAIN_TEST_EVENT_POLICY:'canonical-pr-merge-v1'},true]]){const r=invoke(env,linux);assert.notEqual(r.status,0);assert.match(r.stderr,/diagnostic-only hosted branch|Linux hosted diagnostic/);assert.doesNotMatch(r.stderr,/EEXIST/);assert.equal(fs.readFileSync(output,'utf8'),'preserve');}
 assert.match(invoke(hosted,true).stderr,/EEXIST/,'The valid diagnostic route reaches the deliberate pre-Docker filesystem stop');
});
test('diagnostic orchestration preserves failures and still executes every independent fresh case',async()=>{
 const {diagnosticPlan,executeDiagnosticCases}=await import(modulePath),seen=[];
 const result=await executeDiagnosticCases(diagnosticPlan().cases,async c=>{seen.push(c.id);if(c.id==='original-normal')throw Error('Actual simulated renderer failure');return{status:'passed',containerId:c.id};});
 assert.equal(seen.length,7);assert.deepEqual(seen,diagnosticPlan().cases.map(c=>c.id));assert.equal(result.length,7);assert.equal(result.find(c=>c.id==='original-normal').status,'failed');assert.match(result.find(c=>c.id==='original-normal').error,/renderer failure/);assert.equal(result.at(-1).status,'passed');
});
test('diagnostic outputs cannot satisfy release memory or functional report contracts',async()=>{
 const {diagnosticPlan}=await import(modulePath),{verifyMobileMemoryReport,verifyMobileFunctionalReport}=await import('../button-safety-mobile-contract.mjs');
 assert.throws(()=>verifyMobileMemoryReport({...diagnosticPlan(),schemaVersion:1,status:'passed'}),/button-mobile-memory/);assert.throws(()=>verifyMobileFunctionalReport({kind:'button-mobile-diagnostic-native',status:'passed'}),/Actual mobile consumer report/);
});
test('diagnostic app binding preserves exact31c assets and rejects a changed product byte',async t=>{
 const {appBinding}=await import(modulePath),binding=appBinding(root);assert.equal(binding.appSourceCommit,'31c98a6e075f180681a49d1647b2462521c7ac5f');assert.ok(Object.keys(binding.assets).length>=29);assert.match(binding.assets['index.html'],/^[a-f0-9]{64}$/);assert.ok(binding.runnerCommit);assert.ok(binding.runnerTree);
 const copy=temporary(t),git=(...args)=>{const r=spawnSync('git',args,{cwd:copy,encoding:'utf8'});assert.equal(r.status,0,r.stderr);};git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');fs.writeFileSync(path.join(copy,'index.html'),'original');git('add','.');git('commit','-qm','original');const original=spawnSync('git',['rev-parse','HEAD'],{cwd:copy,encoding:'utf8'}).stdout.trim();fs.writeFileSync(path.join(copy,'index.html'),'changed');assert.throws(()=>appBinding(copy,original),/App bytes differ/);
});
test('diagnostic telemetry binds durable stages to raw cgroup and process snapshots',async t=>{
 const {createTelemetry}=await import(modulePath),output=temporary(t),snapshot={cgroup:{currentBytes:12,peakBytes:20,events:{oom:0},stat:{anon:8,file:4}},processes:[{pid:17,name:'WebKitWebProcess',rssKiB:9,pssKiB:7}]};let stopped=false;
 const telemetry=createTelemetry(output,{snapshot:()=>snapshot,intervalMs:0});telemetry.phase('before-app-goto');telemetry.stop();stopped=true;assert.equal(stopped,true);const records=fs.readFileSync(path.join(output,'startup.ndjson'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(records[0].stage,'before-app-goto');assert.deepEqual(records[0].snapshot,snapshot);assert.equal(typeof records[0].at,'string');
});
test('diagnostic workflow is branch-only and never publishes canonical acceptance jobs',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/data-safety.yml'),'utf8');assert.match(workflow,/branches: \[diagnose\/webkit-cap-31c\]/);assert.doesNotMatch(workflow,/pull_request:|scanner-tests:|mobile-memory:/);assert.match(workflow,/NONMERGEABLE/);assert.match(workflow,/button-safety-mobile-diagnostic\.mjs --run/);assert.match(workflow,/if: always\(\)/);assert.match(workflow,/timeout-minutes: 12/);
});

test('actual diagnostic batch retains an OOM case and removes all seven fixture containers',async t=>{
 // Fake Docker tests orchestration, not Linux memory or native acceptance.
 const {appBinding}=await import(modulePath),directory=temporary(t),repo=path.join(directory,'repo'),bin=path.join(directory,'bin'),output=path.join(directory,'output'),state=path.join(directory,'docker-state.json');fs.mkdirSync(repo);fs.mkdirSync(bin);
 for(const file of Object.keys(appBinding(root).assets)){fs.mkdirSync(path.dirname(path.join(repo,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(repo,file));}
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');const objects=spawnSync('git',['rev-parse','--git-path','objects'],{cwd:root,encoding:'utf8'}).stdout.trim();fs.writeFileSync(path.join(repo,'.git/objects/info/alternates'),path.resolve(root,objects)+'\n');git('add','.');git('commit','-qm','fixture app source');
 const docker=`#!${process.execPath}
const fs=require('node:fs');const file=process.env.DIAGNOSTIC_DOCKER_STATE,s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)): {rows:[],removed:[]};const args=process.argv.slice(2),command=args[0];let out='',exit=0;
if(command==='create'){const label=args[args.indexOf('--case')+1],mount=args.find(a=>a.startsWith('type=bind,src=')&&a.endsWith(',dst=/evidence')),output=mount.slice(14,-14),id=String(s.rows.length+1).padStart(64,'0');s.rows.push({id,label,output,image:args.find(a=>a.startsWith('mcr.microsoft.com/'))});out=id;}
if(command==='inspect'){const r=s.rows.find(r=>r.id===args[1]);out=JSON.stringify([{Id:r.id,Config:{Image:r.image},HostConfig:{Memory:512000000,MemorySwap:512000000},State:{Running:false,ExitCode:r.label==='original-normal'?1:0,OOMKilled:r.label==='original-normal'}}]);}
if(command==='start'){const r=s.rows.find(r=>r.id===args.at(-1));fs.writeFileSync(r.output+'/diagnostic-inside.json',JSON.stringify({status:'passed'}));if(r.label==='original-normal'){process.stderr.write('fixture kernel OOM sentinel');exit=1;}}
if(command==='rm')s.removed.push(args.at(-1));fs.writeFileSync(file,JSON.stringify(s));process.stdout.write(out);process.exitCode=exit;
`;fs.writeFileSync(path.join(bin,'docker'),docker,{mode:0o755});
 const script=`Object.defineProperty(process,'platform',{value:'linux'});const{runDiagnostic}=await import('./scripts/button-safety-mobile-diagnostic.mjs');try{const r=await runDiagnostic({outputDir:process.env.DIAGNOSTIC_OUTPUT,repo:process.env.DIAGNOSTIC_REPO});process.stdout.write(JSON.stringify(r));}catch(e){process.stderr.write(e.stack);process.exitCode=1;}`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,env:{...process.env,...hosted,PATH:bin+path.delimiter+process.env.PATH,DIAGNOSTIC_OUTPUT:output,DIAGNOSTIC_REPO:repo,DIAGNOSTIC_DOCKER_STATE:state},encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout),dockerState=JSON.parse(fs.readFileSync(state,'utf8'));assert.equal(report.acceptanceEligible,false);assert.equal(report.status,'diagnostic-complete');assert.equal(report.results.length,7);assert.equal(report.results.find(r=>r.id==='original-normal').status,'failed');assert.equal(report.results.at(-1).status,'passed');assert.equal(dockerState.removed.length,7);assert.equal(new Set(dockerState.removed).size,7);assert.equal(report.cleanup.containersRemoved,true);assert.match(fs.readFileSync(path.join(output,'original-normal/stderr.txt'),'utf8'),/fixture kernel OOM sentinel/);assert.ok(fs.existsSync(path.join(output,'diagnostic-report.json')));
});
