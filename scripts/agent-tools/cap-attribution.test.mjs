import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const observer=path.join(root,'scripts/cap-attribution.py');
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cap-attribution-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const id='a'.repeat(64),cg='/system.slice/docker-'+id+'.scope',pid={pid:301,startTime:155,namespacePids:[301,9],cgroup:cg,comm:'chain-node',oomScoreAdj:1000,observedMono:1.9};
 const raw={capability:{available:true,event:'oom:mark_victim',clock:'mono',dockerEventsSubscribed:true},cleanup:{traceRemoved:true,childrenClosed:true},lostEvents:0,kernelLogLost:0,ownedContainersRemoved:true,errors:[],source:'fe42f57e880c5edafc26b01af954bfe3205e1d22',containers:[{id,label:'negative',cgroup:cg,memoryMax:512000000,swapMax:0,samples:[{mono:1.9,current:10000000,peak:10000000,events:{max:0,oom_kill:0},stat:{anon:8000000,file:1000000,shmem:0},processes:[pid]},{mono:2.1,current:12000000,peak:512000000,events:{max:22,oom_kill:1},stat:{anon:9000000,file:1000000,shmem:0},processes:[pid]}]}],victims:[{mono:2,pid:301,comm:'chain-node',identity:{...pid,observedMono:2.02}},{mono:2,pid:999,comm:'foreign',identity:null}]};
 raw.capability.format='field:int pid;';raw.capability.formatSha256=createHash('sha256').update(raw.capability.format).digest('hex');raw.capability.kernelRelease='fixture-kernel';
 fs.writeFileSync(path.join(directory,'observer.json'),JSON.stringify(raw));fs.mkdirSync(path.join(directory,'canonical/negative'),{recursive:true});
 fs.writeFileSync(path.join(directory,'canonical/negative/docker-after.json'),JSON.stringify({Id:id,State:{OOMKilled:true,ExitCode:0}}));
 fs.writeFileSync(path.join(directory,'canonical/negative/inside.json'),JSON.stringify({status:'passed',childSignal:'SIGKILL',before:{events:{max:0,oom_kill:0}},after:{events:{max:22,oom_kill:1}}}));
 const normalId='b'.repeat(64),normalCg='/system.slice/docker-'+normalId+'.scope',normalPid={...pid,pid:401,namespacePids:[401,9],cgroup:normalCg,comm:'WPEWebProcess',oomScoreAdj:0,ppid:400,rollupKiB:{Pss:230000,Pss_Anon:210000,Pss_File:10000,Pss_Shmem:10000}};
 raw.containers.push({...structuredClone(raw.containers[0]),id:normalId,label:'normal',cgroup:normalCg,samples:raw.containers[0].samples.map(s=>({...s,processes:[normalPid,{pid:400,ppid:1,startTime:100,namespacePids:[400,2],cgroup:normalCg,comm:'MiniBrowser',rollupKiB:{Pss:60000}},{pid:399,ppid:1,startTime:90,namespacePids:[399,7],cgroup:normalCg,comm:'chain-node',rollupKiB:{Pss:120000}}]}))});raw.victims.push({mono:2,pid:401,comm:'WPEWebProcess',identity:{...normalPid,observedMono:2.02}});
 fs.mkdirSync(path.join(directory,'canonical/normal'));
 fs.writeFileSync(path.join(directory,'canonical/normal/docker-after.json'),JSON.stringify({Id:normalId,State:{OOMKilled:true,ExitCode:1}}));
 fs.writeFileSync(path.join(directory,'canonical/normal/inside.json'),JSON.stringify({status:'failed',before:{events:{max:0,oom_kill:0}},after:{events:{max:22,oom_kill:1}}}));
 for(const event of raw.victims){const c=raw.containers.find(c=>event.identity?.cgroup===c.cgroup);if(c)event.kernelContext={mono:1.999,sequence:event.pid,containerId:c.id,oomMemcg:c.cgroup,taskMemcg:c.cgroup,pid:event.pid,comm:event.comm,constraint:'CONSTRAINT_MEMCG'};}
 fs.writeFileSync(path.join(directory,'source.json'),JSON.stringify({source:raw.source,tree:'6c26511caaff846e42a2417076ed2a7acaf69e02',files:{'consumer.mjs':'c'.repeat(64)}}));
 const inventory=[];for(const label of ['negative','normal'])for(const name of ['docker-after.json','inside.json']){const relative=label+'/'+name,bytes=fs.readFileSync(path.join(directory,'canonical',relative));inventory.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
 fs.writeFileSync(path.join(directory,'canonical/report.json'),JSON.stringify({kind:'button-mobile-memory',status:'failed',candidateCommit:raw.source,candidateTree:'6c26511caaff846e42a2417076ed2a7acaf69e02',sourceSha:raw.source,cases:[],cleanup:{containersRemoved:true},artifacts:inventory}));
 return {directory,raw,run(){fs.writeFileSync(path.join(directory,'observer.json'),JSON.stringify(raw));const r=spawnSync('python3',[observer,'--summarize',directory],{encoding:'utf8',timeout:5000});return{...r,report:JSON.parse(fs.readFileSync(path.join(directory,'attribution.json'),'utf8'))};}};
}
test('attribution CLI correlates the kernel control and filters a foreign victim without acceptance credit',t=>{
 const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(r.report.status,'complete','A bounded owned kernel witness must produce complete attribution');assert.equal(r.report.acceptanceEligible,false);assert.deepEqual(r.report.victims.map(v=>v.pid),[301,401]);assert.equal(r.report.ignoredForeignVictims,1);
});

test('attribution CLI refuses ambiguous PID reuse lost events missing capability and incomplete control',async t=>{
 for(const [name,mutate]of [
  ['missing-capability',r=>r.capability.available=false],
  ['lost-records',r=>r.lostEvents=1],
  ['lost-kernel-context',r=>r.kernelLogLost=1],
  ['foreign-memcg',r=>r.victims[0].kernelContext.taskMemcg='/foreign'],
  ['stale-context',r=>r.victims[0].kernelContext.mono=1],
  ['duplicate-victim',r=>r.victims.push(structuredClone(r.victims[0]))],
  ['PID-reuse',r=>r.victims[0].identity={...r.victims[0].identity,startTime:999}],
  ['wrong-namespace',r=>r.victims[0].identity={...r.victims[0].identity,namespacePids:[301,88]}],
  ['missing-victim',r=>r.victims=[]],
  ['cleanup-incomplete',r=>r.cleanup.traceRemoved=false],
 ])await t.test(name,t=>{const f=fixture(t);mutate(f.raw);const r=f.run();assert.notEqual(r.status,0);assert.equal(r.report.status,'incomplete');assert.equal(r.report.acceptanceEligible,false);});
 await t.test('kernel control must identify the deliberate allocating child',t=>{
  const f=fixture(t);f.raw.containers[0].samples.forEach(s=>s.processes[0].oomScoreAdj=0);f.raw.victims[0].identity.oomScoreAdj=0;
  const r=f.run();assert.notEqual(r.status,0,'An arbitrary owned process kill must not pass the known high-score child control');assert.equal(r.report.status,'incomplete');
 });
});

test('attribution CLI preserves a malformed partial artifact as incomplete',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.directory,'observer.json'),'{partial');
 const r=spawnSync('python3',[observer,'--summarize',f.directory],{encoding:'utf8',timeout:5000});assert.notEqual(r.status,0);assert.equal(fs.existsSync(path.join(f.directory,'attribution.json')),true,'Malformed partial observations must still yield an explicit incomplete receipt');
});

test('attribution CLI refuses missing canonical inventory rather than treating control alone as the app profile',t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.directory,'canonical/report.json'));const r=f.run();assert.notEqual(r.status,0,'A successful control alone cannot provide complete source-bound canonical attribution');assert.equal(r.report.status,'incomplete');
});

test('observer public CLI records capability refusal and closes all resources it actually acquired',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cap-refusal-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const command="import runpy,sys;sys.platform='unsupported-fixture';sys.argv=sys.argv[1:];runpy.run_path(sys.argv[0],run_name='__main__')";
 const r=spawnSync('python3',['-c',command,observer,'--observe','--repo',dir,'--output',dir,'--canonical',path.join(dir,'canonical')],{encoding:'utf8',timeout:5000});
 assert.notEqual(r.status,0);assert.equal(JSON.parse(r.stdout).ready,false);const raw=JSON.parse(fs.readFileSync(path.join(dir,'observer.json'),'utf8'));assert.equal(raw.capability.available,false);assert.deepEqual(raw.cleanup,{traceRemoved:true,childrenClosed:true},'No trace was created; refusal still must positively account for owned cleanup');assert.deepEqual(raw.containers,[]);
});

test('attribution command refuses an in-checkout output without writing to the source',t=>{
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'cap-source-'));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));const output=path.join(repo,'evidence');
 const r=spawnSync('python3',[observer,'--run','--repo',repo,'--output',output],{encoding:'utf8',timeout:5000});assert.notEqual(r.status,0);assert.equal(fs.existsSync(output),false,'Rejected evidence path must not dirty immutable source');
});

test('attribution CLI rejects an unconfirmed Docker lifecycle subscription',t=>{
 const f=fixture(t);f.raw.capability.dockerEventsSubscribed=false;const r=f.run();assert.notEqual(r.status,0,'A trace alone cannot establish that short-lived owned containers were observed from launch');assert.equal(r.report.status,'incomplete');
});

test('parsed diagnostic workflow runs one immutable fe42 canonical attribution and always preserves evidence',async()=>{
 const yaml=(await import('js-yaml')).default,C='fe42f57e880c5edafc26b01af954bfe3205e1d22',branch='diagnose/webkit-cap-canonical-startup';
 const validate=w=>{
  assert.equal(w.name,'NONMERGEABLE canonical capped WebKit attribution');assert.deepEqual(w.on,{push:{branches:[branch]}});assert.deepEqual(w.permissions,{contents:'read'});assert.deepEqual(Object.keys(w.jobs),['cap-attribution']);
  const j=w.jobs['cap-attribution'];assert.equal(j['runs-on'],'ubuntu-latest');assert.equal(j['timeout-minutes'],15);assert.notEqual(j['continue-on-error'],true);assert.deepEqual(j.env,{CHAIN_TEST_EVENT_POLICY:'outgoing-branch-push-v1',CANDIDATE_SHA:C});
  assert.deepEqual(j.steps.filter(s=>s.uses==='actions/checkout@v4').map(s=>s.with),[{ref:'${{ github.sha }}',path:'observer','fetch-depth':0},{ref:C,path:'candidate','fetch-depth':0}]);
  const setup=j.steps.find(s=>s.uses==='actions/setup-node@v4');assert.equal(setup.with['node-version'],'22');assert.equal(setup.with['cache-dependency-path'],'candidate/package-lock.json');
  assert.deepEqual(j.steps.filter(s=>s.run==='npm ci').map(s=>s['working-directory']),['candidate']);
  const run=j.steps.find(s=>s.id==='profile');assert.equal(run['working-directory'],'candidate');assert.deepEqual(run.env,{CHAIN_TEST_SOURCE_SHA:C});assert.equal(run.run,'python3 ../observer/scripts/cap-attribution.py --run --repo "$PWD" --output "$RUNNER_TEMP/mobile-cap-attribution"');assert.equal(run.if,undefined);assert.notEqual(run['continue-on-error'],true);
  const check=j.steps.find(s=>s.id==='artifact-completeness');assert.equal(check.if,'always()');assert.notEqual(check['continue-on-error'],true);assert.ok(check.run.startsWith("node --input-type=module <<'JS'\n"));
  const upload=j.steps.find(s=>s.uses==='actions/upload-artifact@v4');assert.equal(upload.if,'always()');assert.equal(upload.with['if-no-files-found'],'error');assert.equal(upload.with.path,'${{ runner.temp }}/mobile-cap-attribution');assert.equal(upload.with.name,'NONMERGEABLE-cap-attribution-${{ github.run_id }}-${{ github.run_attempt }}');assert.equal(j.steps.length,7);
  for(const step of j.steps){assert.notEqual(step['continue-on-error'],true);for(const k of ['CI','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_SHA'])assert.equal(step.env?.[k],undefined);}return j;
 };
 const raw=fs.readFileSync(path.join(root,'.github/workflows/data-safety.yml'),'utf8'),w=yaml.load(raw);validate(w);
 assert.throws(()=>yaml.load(raw.replace('        run: |','        run: node -e "process: unsafe"')),/bad indentation|mapping/);
 for(const mutate of [x=>x.on.push.branches=['main'],x=>x.on.pull_request={},x=>x.jobs.deploy={},x=>x.jobs['cap-attribution'].steps.find(s=>s.id==='profile')['continue-on-error']=true,x=>x.jobs['cap-attribution'].steps.find(s=>s.id==='profile').env.CHAIN_TEST_SOURCE_SHA='a'.repeat(40),x=>x.jobs['cap-attribution'].steps.find(s=>s.id==='profile').run+=' --control',x=>x.jobs['cap-attribution'].steps.find(s=>s.id==='artifact-completeness').if='success()',x=>x.jobs['cap-attribution'].steps.find(s=>s.uses==='actions/upload-artifact@v4').if='success()']){const changed=structuredClone(w);mutate(changed);assert.throws(()=>validate(changed),{name:'AssertionError'});}
});

test('a short-lived SIGKILL child reaped before consumption is bound by direct kernel memcg context',t=>{
 const f=fixture(t),kill=spawnSync('python3',['-c',"import subprocess,os,signal,json;p=subprocess.Popen(['sleep','5']);pid=p.pid;os.kill(pid,signal.SIGKILL);p.wait();print(json.dumps({'pid':pid,'signal':-p.returncode,'gone':p.poll()==-signal.SIGKILL}))"],{encoding:'utf8',timeout:5000});assert.equal(kill.status,0,kill.stderr);const child=JSON.parse(kill.stdout);assert.equal(child.signal,9);assert.equal(child.gone,true);
 const c=f.raw.containers[0];for(const s of c.samples)s.processes[0].pid=child.pid;
 f.raw.victims[0]={mono:2,pid:child.pid,kernelContext:{mono:1.999,sequence:101,containerId:c.id,oomMemcg:c.cgroup,taskMemcg:c.cgroup,pid:child.pid,comm:'chain-node',constraint:'CONSTRAINT_MEMCG'},identity:null};
 const r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(r.report.status,'complete','A reaped victim must remain attributable through its exact kernel memcg record');assert.equal(r.report.victims[0].pid,child.pid);assert.equal(r.report.victims[0].binding,'kernel-memcg-context');assert.equal(r.report.victims[0].identity,undefined,'Never attach a guessed post-kill process identity');
});

function commandFixture(t,{ready=true}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cap-command-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const repo=path.join(directory,'candidate'),bin=path.join(directory,'bin'),output=path.join(directory,'evidence');fs.mkdirSync(repo);fs.mkdirSync(bin);fs.writeFileSync(path.join(repo,'fixture.mjs'),'isolated source');
 const executable=(name,body)=>{const file=path.join(bin,name);fs.writeFileSync(file,'#!/usr/bin/env python3\n'+body);fs.chmodSync(file,0o755);};
 executable('git',String.raw`import sys
args=sys.argv[1:]
if args[-2:]==['rev-parse','HEAD']: print('fe42f57e880c5edafc26b01af954bfe3205e1d22')
elif args[-2:]==['rev-parse','HEAD^{tree}']: print('6c26511caaff846e42a2417076ed2a7acaf69e02')
elif args[-2:]==['status','--porcelain=v1']: pass
elif args[-2:]==['ls-files','-z']: sys.stdout.write('fixture.mjs\0')
else: sys.exit(3)
`);
 executable('sudo',`import sys,json,pathlib,os\na=sys.argv;out=pathlib.Path(a[a.index('--output')+1]);trace=out/'fixture-trace';trace.mkdir()\ntry:\n print(json.dumps({'ready':${ready?'True':'False'},'pid':os.getpid(),'startTime':1}),flush=True)\n sys.stdin.read()\nfinally:\n trace.rmdir();(out/'fixture-worker-closed.json').write_text(json.dumps({'closed':True}))\n (out/'observer.json').write_text(json.dumps({'source':'fe42f57e880c5edafc26b01af954bfe3205e1d22','capability':{'available':False},'cleanup':{'traceRemoved':True,'childrenClosed':True},'errors':['fixture-only']}))\n`);
 executable('node',String.raw`import sys,json,pathlib
out=pathlib.Path(sys.argv[-1]);out.mkdir();(out.parent/'fixture-argv.json').write_text(json.dumps(sys.argv[1:]));sys.exit(23)
`);
 const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,CI:'true',CHAIN_TEST_SOURCE_SHA:'fe42f57e880c5edafc26b01af954bfe3205e1d22',GITHUB_SHA:'d'.repeat(40),GITHUB_RUN_ID:'fixture-run',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/diagnose/webkit-cap-canonical-startup',CHAIN_TEST_EVENT_POLICY:'outgoing-branch-push-v1',GITHUB_REPOSITORY:'fixture/public'};
 return{directory,repo,output,env,run:()=>spawnSync('python3',[observer,'--run','--repo',repo,'--output',output],{env,encoding:'utf8',timeout:5000})};
}
test('command CLI preserves canonical failure and closes its owned observer on all capability outcomes',async t=>{
 for(const ready of [true,false])await t.test(String(ready),t=>{
  const f=commandFixture(t,{ready}),r=f.run();assert.notEqual(r.status,0);const command=JSON.parse(fs.readFileSync(path.join(f.output,'command.json'),'utf8'));assert.deepEqual(command.cleanup,{canonicalChildClosed:true,observerClosed:true});assert.equal(JSON.parse(fs.readFileSync(path.join(f.output,'fixture-worker-closed.json'),'utf8')).closed,true);assert.equal(fs.existsSync(path.join(f.output,'fixture-trace')),false);
  if(ready){assert.equal(command.canonicalExit,23);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.output,'fixture-argv.json'),'utf8')),['scripts/button-safety-mobile-memory.mjs','--run','--output-dir',path.join(fs.realpathSync(f.output),'canonical')]);}else{assert.equal(command.canonicalExit,null);assert.equal(fs.existsSync(path.join(f.output,'fixture-argv.json')),false);}
  assert.equal(fs.existsSync(path.join(f.output,'attribution.json')),true,'A failed capability or partial invocation must preserve an explicit incomplete attribution receipt');assert.equal(JSON.parse(fs.readFileSync(path.join(f.output,'attribution.json'),'utf8')).status,'incomplete');
 });
});

test('kernel ownership alone cannot substitute for missing Node and browser memory samples',t=>{
 const f=fixture(t);for(const s of f.raw.containers.find(c=>c.label==='normal').samples)s.processes=[];delete f.raw.victims.find(e=>e.pid===401).identity;const r=f.run();assert.notEqual(r.status,0);assert.equal(r.report.status,'incomplete','The proposed attribution must actually distinguish harness Node from the browser tree');
});

test('actual always-run workflow guard rejects missing source profile inventory and nominal pass with missing motion',async t=>{
 const yaml=(await import('js-yaml')).default,w=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/data-safety.yml'),'utf8')),guard=w.jobs['cap-attribution'].steps.find(s=>s.id==='artifact-completeness'),script=guard.run.split('\n').slice(1,-2).join('\n');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cap-guard-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const repo=path.join(directory,'candidate'),runner=path.join(directory,'observer'),temp=path.join(directory,'temp'),output=path.join(temp,'mobile-cap-attribution');fs.mkdirSync(output,{recursive:true});
 const git=(cwd,...args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 for(const dir of [repo,runner]){fs.mkdirSync(path.join(dir,'scripts'),{recursive:true});git(dir,'init','-q');git(dir,'config','user.name','Fixture');git(dir,'config','user.email','fixture@example.invalid');}
 for(const file of ['button-safety-mobile-contract.mjs','button-safety-ci-policy.mjs','button-safety-inventory.json'])fs.copyFileSync(path.join(root,'scripts',file),path.join(repo,'scripts',file));fs.writeFileSync(path.join(runner,'scripts/cap-attribution.py'),'fixture observer bytes');
 for(const dir of [repo,runner]){git(dir,'add','.');git(dir,'commit','-qm','isolated process fixture');}
 const C=git(repo,'rev-parse','HEAD'),D=git(runner,'rev-parse','HEAD'),env={...process.env,CI:'true',GITHUB_WORKSPACE:directory,RUNNER_TEMP:temp,CANDIDATE_SHA:C,GITHUB_SHA:D,GITHUB_RUN_ID:'fixture-run',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/diagnose/webkit-cap-canonical-startup',CHAIN_TEST_EVENT_POLICY:'outgoing-branch-push-v1',GITHUB_REPOSITORY:'fixture/public'};
 const files={};for(const name of git(repo,'ls-files','-z').split('\0').filter(Boolean))files[name]=createHash('sha256').update(fs.readFileSync(path.join(repo,name))).digest('hex');
 const source={source:C,tree:git(repo,'rev-parse','HEAD^{tree}'),files,workflowCommit:D,runId:env.GITHUB_RUN_ID,runAttempt:1,eventName:'push',eventRef:env.GITHUB_REF,eventPolicy:env.CHAIN_TEST_EVENT_POLICY,repository:env.GITHUB_REPOSITORY,observerSha256:createHash('sha256').update('fixture observer bytes').digest('hex')};
 const write=(name,data)=>fs.writeFileSync(path.join(output,name),JSON.stringify(data));write('source.json',source);write('command.json',{acceptanceEligible:false,canonicalExit:0,observerExit:0,cleanup:{canonicalChildClosed:true,observerClosed:true},errors:[]});write('attribution.json',{kind:'nonmergeable-cap-attribution',acceptanceEligible:false,status:'complete',errors:[]});
 const {createMobileBundle,refreshMobileBundle}=await import('./mobile-memory-fixture.mjs'),bundle=createMobileBundle(path.join(output,'canonical'),{candidateCommit:C,candidateTree:source.tree,sourceSha:C,repository:env.GITHUB_REPOSITORY,runId:env.GITHUB_RUN_ID,runAttempt:1,eventPolicy:env.CHAIN_TEST_EVENT_POLICY}),policy={eventPolicy:env.CHAIN_TEST_EVENT_POLICY,eventName:'push',eventRef:env.GITHUB_REF};bundle.report.hostedPolicy=policy;for(const row of [bundle.report.negativeControl,...bundle.report.cases])row.hostedPolicy=policy;for(const native of Object.values(bundle.native))native.hostedPolicy=policy;refreshMobileBundle(bundle);
 const run=()=>spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:repo,env,encoding:'utf8',timeout:5000}),read=()=>JSON.parse(fs.readFileSync(path.join(output,'artifact-check.json'),'utf8'));let r=run();assert.equal(r.status,0,r.stderr);assert.equal(read().status,'complete');assert.equal(read().acceptanceEligible,false);
 for(const name of ['source.json','attribution.json','canonical/report.json']){const file=path.join(output,name),bytes=fs.readFileSync(file);fs.unlinkSync(file);r=run();assert.notEqual(r.status,0,'Missing '+name+' must fail');assert.equal(read().status,'incomplete');fs.writeFileSync(file,bytes);}
 write('attribution.json',{kind:'nonmergeable-cap-attribution',acceptanceEligible:false,status:'incomplete',errors:['missing kernel context']});assert.notEqual(run().status,0);write('attribution.json',{kind:'nonmergeable-cap-attribution',acceptanceEligible:false,status:'complete',errors:[]});
 fs.writeFileSync(path.join(output,'canonical/unlisted.txt'),'unlisted bytes');assert.notEqual(run().status,0);fs.unlinkSync(path.join(output,'canonical/unlisted.txt'));
 bundle.report.cases.pop();fs.writeFileSync(path.join(bundle.directory,'report.json'),JSON.stringify(bundle.report));assert.notEqual(run().status,0,'A nominal passed report cannot omit Reduced');assert.equal(read().status,'incomplete');
 t.diagnostic('Synthetic process/artifact fixtures only; no native, kernel cap or hosted proof.');
});

test('owned process scalar reader refuses foreign membership before touching metadata',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cap-proc-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const foreign=path.join(directory,'88');fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'cgroup'),'0::/foreign\n');
 const code="import runpy,json,sys,pathlib;m=runpy.run_path(sys.argv[1]);print(json.dumps(m['process_identity'](pathlib.Path(sys.argv[2]),88,'/owned')))";
 const r=spawnSync('python3',['-c',code,observer,directory],{encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout),null,'No foreign stat/status/smaps/argv/environ or source content is available to read');assert.deepEqual(fs.readdirSync(foreign),['cgroup']);
});

test('attribution cannot complete with uncollected owned containers',t=>{
 const f=fixture(t);f.raw.ownedContainersRemoved=false;const r=f.run();assert.notEqual(r.status,0);assert.equal(r.report.status,'incomplete');
});

test('actual trace clock and PID format remain bound to the attribution capability',t=>{
 const f=fixture(t);f.raw.capability.clock='global';const r=f.run();assert.notEqual(r.status,0);assert.equal(r.report.status,'incomplete');
});

test('owned cleanup revalidates exact mounts and leaves a foreign container untouched',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cap-cleanup-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const bin=path.join(directory,'bin');fs.mkdirSync(bin);
 const script=String.raw`#!/usr/bin/env python3
import sys,json,pathlib,os
root=pathlib.Path(os.environ['FIXTURE_CLEANUP_ROOT']);args=sys.argv[1:];cid=args[-1]
if args[0]=='rm':
 with (root/'removed.txt').open('a') as f:f.write(cid+'\n')
 (root/'removed-marker').touch();print(cid);sys.exit(0)
if cid=='c'*64 or cid=='a'*64 and (root/'removed-marker').exists():print('Error: No such object: '+cid,file=sys.stderr);sys.exit(1)
mounts=[{'Destination':'/repo','Source':str(root/'candidate')},{'Destination':'/evidence','Source':str(root/'canonical'/'negative') if cid=='a'*64 else '/foreign/evidence'}]
image='mcr.microsoft.com/playwright@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e'
print('|'.join(json.dumps(v) for v in [cid,512000000,512000000,image,mounts]))
`;
 fs.writeFileSync(path.join(bin,'docker'),script);fs.chmodSync(path.join(bin,'docker'),0o755);
 const code="import runpy,json,pathlib,sys;m=runpy.run_path(sys.argv[1]);p=pathlib.Path(sys.argv[2]);c=[{'id':v*64,'label':'negative'} for v in 'abc'];print(json.dumps(m['cleanup_owned_containers'](c,p/'candidate',p/'canonical')))";
 const r=spawnSync('python3',['-c',code,observer,directory],{env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,FIXTURE_CLEANUP_ROOT:directory},encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{removed:['a'.repeat(64)],alreadyRemoved:['c'.repeat(64)],unresolved:['b'.repeat(64)]});assert.equal(fs.readFileSync(path.join(directory,'removed.txt'),'utf8'),'a'.repeat(64)+'\n');
});

test('direct kernel context never silently associates a reused prior PID lifetime',t=>{
 const f=fixture(t),c=f.raw.containers[0];delete f.raw.victims[0].identity;c.samples.splice(1,0,{...structuredClone(c.samples[0]),mono:1.95,processes:[{...c.samples[0].processes[0],observedMono:1.95,startTime:999,namespacePids:[301,88]}]});const r=f.run();assert.notEqual(r.status,0);assert.equal(r.report.status,'incomplete');assert.ok(r.report.errors.some(e=>e.includes('PID reuse')));
});

test('control startup may progress from inherited score zero to its deliberate final score',t=>{
 const f=fixture(t),c=f.raw.containers[0];delete f.raw.victims[0].identity;c.samples[0].processes[0].oomScoreAdj=0;c.samples.splice(1,0,{...structuredClone(c.samples[0]),mono:1.95,processes:[{...c.samples[0].processes[0],observedMono:1.95,oomScoreAdj:1000}]});const r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(r.report.status,'complete','The latest pre-kill sample identifies the deliberate child without erasing its earlier startup state');
});
