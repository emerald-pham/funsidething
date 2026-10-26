// Controlled Docker CLI/daemon fixtures only: no Docker daemon, container,
// browser, cgroup or real memory-cap acceptance is exercised by these tests.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MOBILE_IMAGE} from '../button-safety-mobile-contract.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function git(repo,...args){const r=spawnSync('git',args,{cwd:repo,encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
async function runFixture(t,mode){
 const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'chain-mobile-create-lifecycle-')));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const repo=path.join(directory,'repo'),bin=path.join(directory,'bin'),output=path.join(directory,'output');fs.mkdirSync(path.join(repo,'scripts'),{recursive:true});fs.mkdirSync(bin);
 for(const name of ['button-safety-mobile-memory.mjs','button-safety-mobile-contract.mjs','button-safety-ci-policy.mjs','button-safety-inventory.json'])fs.copyFileSync(path.join(root,'scripts',name),path.join(repo,'scripts',name));
 fs.writeFileSync(path.join(repo,'package.json'),'{"type":"module"}\n');git(repo,'init','--quiet');git(repo,'add','.');git(repo,'-c','core.hooksPath=/dev/null','-c','user.name=Controlled fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Actual launcher fixture source');
 const docker=path.join(bin,'docker');fs.writeFileSync(docker,'#!'+process.execPath+'\n'+String.raw`
import fs from 'node:fs';
const args=process.argv.slice(2),base=process.env.CHAIN_LIFECYCLE_FIXTURE,mode=process.env.CHAIN_LIFECYCLE_MODE;
fs.appendFileSync(base+'/trace.jsonl',JSON.stringify({args})+'\n');
if(args[0]==='pull')process.exit(0);
if(args[0]==='image'){process.stdout.write(JSON.stringify([{Id:'sha256:'+'8'.repeat(64),RepoDigests:[process.env.CHAIN_LIFECYCLE_IMAGE]}]));process.exit(0);}
if(args[0]==='create'){
 const name=args[args.indexOf('--name')+1],owner=args[args.indexOf('--label')+1].split('=')[1],value={Id:'7'.repeat(64),name,owner};
 fs.writeFileSync(base+'/create-started.json',JSON.stringify(value));
 if(mode==='known-id-prestart-refusal'||mode==='timeout-visible')fs.writeFileSync(base+'/object.json',JSON.stringify(value));
 if(mode==='known-id-prestart-refusal'){process.stdout.write(value.Id+'\n');process.exit(0);}
 // Bound even an accidentally orphaned fake command. The real launcher timer
 // is scaled in the child fixture only; production action/command clocks stay intact.
 setTimeout(()=>process.exit(3),3000);setInterval(()=>{},1000);
}else if(args[0]==='inspect'){
 if(!fs.existsSync(base+'/object.json')){process.stderr.write('Error: No such object: '+args[1]);process.exit(1);}
 const value=JSON.parse(fs.readFileSync(base+'/object.json'));process.stdout.write(JSON.stringify([{...value,Config:{Labels:{'chain.mobile.owner':value.owner}}}]));
}else if(args[0]==='logs')process.exit(0);
else if(args[0]==='rm'){fs.unlinkSync(base+'/object.json');process.exit(0);}
else process.exit(2);
`);fs.chmodSync(docker,0o700);
 const entry=path.join(repo,'scripts/button-safety-mobile-memory.mjs');
 const wrapper=`import{pathToFileURL}from'node:url';Object.defineProperty(process,'platform',{value:'linux'});const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>timer(fn,ms===60000?300:ms,...args);process.argv=[process.execPath,${JSON.stringify(entry)},'--run','--output-dir',${JSON.stringify(output)}];await import(pathToFileURL(${JSON.stringify(entry)}));`;
 const env={...process.env,CI:'true',CHAIN_TEST_EVENT_POLICY:'outgoing-branch-push-v1',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/controlled-lifecycle-fixture',CHAIN_TEST_SOURCE_SHA:git(repo,'rev-parse','HEAD'),CHAIN_LIFECYCLE_FIXTURE:directory,CHAIN_LIFECYCLE_MODE:mode,CHAIN_LIFECYCLE_IMAGE:MOBILE_IMAGE,PATH:bin+path.delimiter+process.env.PATH};delete env.NODE_TEST_CONTEXT;
 const child=spawn(process.execPath,['--input-type=module','-e',wrapper],{cwd:repo,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',finished=false;child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const completion=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>{finished=true;resolve({code,signal});});});t.after(async()=>{if(!finished)child.kill('SIGTERM');await completion;});
 const started=path.join(directory,'create-started.json'),begin=Date.now();while(!fs.existsSync(started)){assert.ok(!finished,'Actual launcher exited before create: '+stderr);assert.ok(Date.now()-begin<5000,'Actual launcher create fixture did not start');await wait(10);}
 const created=JSON.parse(fs.readFileSync(started));
 if(mode==='signal-late')child.kill('SIGTERM');
 const exit=await completion;
 // The external daemon fixture completes only after the early lookup and CLI
 // finalizer. This ordering is deterministic even on a loaded CI runner.
 if(mode.endsWith('-late'))fs.writeFileSync(path.join(directory,'object.json'),JSON.stringify(created));
 assert.notEqual(exit.code,0,'Every controlled fixture deliberately fails before browser launch; none is capped acceptance');
 const report=JSON.parse(fs.readFileSync(path.join(output,'report.json'))),ownership=JSON.parse(fs.readFileSync(path.join(output,'ownership.json'))),trace=fs.readFileSync(path.join(directory,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(report.status,'failed');assert.equal(trace.some(row=>row.args[0]==='start'),false,'No fake fixture launches an engine or container');
 return{mode,created,report,ownership,trace,stderr,lateCreated:fs.existsSync(path.join(directory,'object.json'))};
}
test('mobile budget CLI preserves uncertain create ownership and cleans confirmed objects',async t=>{
 for(const mode of ['timeout-late','timeout-visible','known-id-prestart-refusal','signal-late'])await t.test(mode,async sub=>{
  const observed=await runFixture(sub,mode),late=mode.endsWith('-late');
  if(mode.startsWith('timeout'))assert.match(observed.stderr,/Docker command timed out/);
  if(mode==='signal-late')assert.equal(observed.report.interruptionSignal,'SIGTERM');
  if(late){
   assert.equal(observed.lateCreated,true,'Controlled daemon completes after the failed command and early absence lookup');
   assert.equal(observed.report.cleanup.containersRemoved,false,'An uncertain daemon create cannot earn a cleanup pass');
   assert.equal(observed.ownership.objects.length,1,'Pending name must survive for owner recovery');assert.equal(observed.ownership.objects[0].name,observed.created.name);assert.equal(observed.ownership.ownerToken,observed.created.owner);
   assert.ok(observed.trace.some(row=>row.args[0]==='inspect'&&row.args[1]===observed.created.name),'Actual launcher reaches the early pending-name lookup');assert.equal(observed.trace.some(row=>row.args[0]==='rm'),false,'Absence is not positive owned removal');
  }else{
   assert.equal(observed.lateCreated,false,'Confirmed owned object was removed');assert.equal(observed.report.cleanup.containersRemoved,true);assert.deepEqual(observed.ownership.objects,[]);assert.ok(observed.trace.some(row=>row.args[0]==='rm'&&row.args.includes(observed.created.Id)),'Actual launcher removes the positively identified owned object');
  }
 });
});
