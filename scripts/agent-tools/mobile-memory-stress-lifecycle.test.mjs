// Actual launcher with controlled daemon/process observations only. No runtime
// or memory-limit acceptance is claimed by these synthetic lifecycle fixtures.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createMobileBundle,refreshMobileBundle} from './mobile-memory-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
function git(repo,...args){const r=spawnSync('git',args,{cwd:repo,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
test('mobile stress CLI preserves a failed normal app attempt and executes reduced before complete cleanup',t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'chain-stress-lifecycle-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const repo=path.join(dir,'repo'),bin=path.join(dir,'bin'),output=path.join(dir,'output'),seed=path.join(dir,'seed');fs.mkdirSync(path.join(repo,'scripts'),{recursive:true});fs.mkdirSync(bin);
 for(const name of ['button-safety-mobile-memory.mjs','button-safety-mobile-contract.mjs','button-safety-ci-policy.mjs','button-safety-inventory.json'])fs.copyFileSync(path.join(root,'scripts',name),path.join(repo,'scripts',name));
 fs.writeFileSync(path.join(repo,'package.json'),'{"type":"module"}\n');git(repo,'init','--quiet');git(repo,'add','.');git(repo,'-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Controlled launcher source');
 const source={candidateCommit:git(repo,'rev-parse','HEAD'),candidateTree:git(repo,'rev-parse','HEAD^{tree}'),sourceSha:git(repo,'rev-parse','HEAD'),repository:'example/fixture',runId:'1',runAttempt:1,eventPolicy:'outgoing-branch-push-v1'};
 const b=createMobileBundle(seed,source,'stress-512mb');b.report.hostedPolicy={eventPolicy:source.eventPolicy,eventName:'push',eventRef:'refs/heads/fixture'};
 for(const row of [b.report.negativeControl,...b.report.cases]){row.hostedPolicy=b.report.hostedPolicy;row.server.hostedPolicy=b.report.hostedPolicy;}
 for(const native of Object.values(b.native))native.hostedPolicy=b.report.hostedPolicy;
 b.report.status='failed';b.report.cases[0].appOutcome='app-runtime-failure';b.native.normal.status='failed';b.native.normal.errors=['page-crash'];b.native.normal.failure='page.goto: Page crashed';refreshMobileBundle(b);
 const docker=path.join(bin,'docker');fs.writeFileSync(docker,'#!'+process.execPath+'\n'+String.raw`
import fs from 'node:fs';import path from 'node:path';
const base=process.env.CHAIN_STRESS_FIXTURE,args=process.argv.slice(2),stateFile=base+'/daemon.json';let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{};const save=()=>fs.writeFileSync(stateFile,JSON.stringify(state));fs.appendFileSync(base+'/trace.jsonl',JSON.stringify(args)+'\n');
if(args[0]==='pull')process.exit(0);
if(args[0]==='image'){process.stdout.write('['+fs.readFileSync(base+'/seed/image.json','utf8')+']');process.exit(0);}
if(args[0]==='create'){
 const role=args.includes('--browser-server')?'browser':'driver',label=args.includes('--control')?'negative':args[args.indexOf('--motion')+1],index=['negative','normal','reduced'].indexOf(label),id=String(index+(role==='browser'?1:4)).repeat(64),config=JSON.parse(fs.readFileSync(base+'/seed/'+label+'/'+(role==='browser'?'docker-before.json':'driver-before.json')));
 config.Config.Labels={'chain.mobile.owner':args[args.indexOf('--label')+1].split('=')[1]};state[id]={...config,role,label};save();process.stdout.write(id+'\n');process.exit(0);
}
const row=state[args[1]];
if(args[0]==='inspect'){process.stdout.write(JSON.stringify([row]));process.exit(0);}
if(args[0]==='start'){
 row.State={Running:true,Pid:row.role==='browser'?100:200};save();const d=base+'/output/'+row.label;fs.mkdirSync(d,{recursive:true});if(row.role==='browser')fs.writeFileSync(d+'/ready.json','{"status":"ready"}');process.exit(0);
}
if(args[0]==='wait'){
 const d=base+'/output/'+row.label;
 for(const file of ['inside.json','browser-server.json','native.json']){const f=base+'/seed/'+row.label+'/'+file;if(fs.existsSync(f))fs.copyFileSync(f,d+'/'+file);}
 for(const [id,item]of Object.entries(state))if(item.label===row.label){const raw=JSON.parse(fs.readFileSync(base+'/seed/'+item.label+'/'+(item.role==='browser'?'docker-after.json':'driver-after.json')));item.State=raw.State;}save();process.stdout.write('0\n');process.exit(0);
}
if(args[0]==='logs')process.exit(0);
if(args[0]==='rm'){delete state[args[1]];save();process.exit(0);}
process.exit(2);
`);fs.chmodSync(docker,0o700);
 const entry=path.join(repo,'scripts/button-safety-mobile-memory.mjs');
 const wrapper=`import fs from'node:fs';import{pathToFileURL}from'node:url';Object.defineProperty(process,'platform',{value:'linux'});const read=fs.readFileSync.bind(fs),link=fs.readlinkSync.bind(fs);fs.readFileSync=(file,...args)=>{const m=String(file).match(/^\\/proc\\/(100|200)\\/(stat|cgroup)$/);if(!m)return read(file,...args);if(m[2]==='stat')return m[1]+' (fixture) S 1 '+Array(17).fill('0').join(' ')+' '+(m[1]==='100'?'1':'2')+' 0';const state=JSON.parse(read(${JSON.stringify(path.join(dir,'daemon.json'))},'utf8')),value=Object.values(state).find(row=>row.State.Pid===Number(m[1]));return'0::/docker/'+value.Id;};fs.readlinkSync=(file,...args)=>String(file).endsWith('/ns/net')?'net:[42]':String(file).endsWith('/ns/pid')?(String(file).includes('/100/')?'pid:[42]':'pid:[43]'):String(file).endsWith('/exe')?'/usr/bin/fixture':link(file,...args);process.argv=[process.execPath,${JSON.stringify(entry)},'--run','--profile','stress-512mb','--output-dir',${JSON.stringify(output)}];await import(pathToFileURL(${JSON.stringify(entry)}));`;
 const env={...process.env,CI:'true',CHAIN_STRESS_FIXTURE:dir,CHAIN_TEST_EVENT_POLICY:source.eventPolicy,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/fixture',GITHUB_REPOSITORY:source.repository,GITHUB_RUN_ID:source.runId,GITHUB_RUN_ATTEMPT:'1',CHAIN_TEST_SOURCE_SHA:source.sourceSha,PATH:bin+path.delimiter+process.env.PATH};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--input-type=module','-e',wrapper],{cwd:repo,env,encoding:'utf8',timeout:15000});assert.equal(result.error,undefined);assert.equal(result.status,0,'A valid failed stress application result is reported without hiding the second motion: '+result.stderr);
 assert.match(result.stdout,/stress-512mb outcome: failed/,'A nonblocking stress app failure must be reported as failed in the public CLI');
 const report=JSON.parse(fs.readFileSync(path.join(output,'report.json'))),ownership=JSON.parse(fs.readFileSync(path.join(output,'ownership.json')));assert.equal(report.status,'failed');assert.deepEqual(report.cases.map(row=>[row.motion,row.appOutcome]),[['normal','app-runtime-failure'],['reduced','passed']]);assert.equal(report.cleanup.containersRemoved,true);assert.deepEqual(ownership.objects,[]);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'daemon.json'))),{});
 const trace=fs.readFileSync(path.join(dir,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(trace.filter(args=>args[0]==='create').length,6);assert.equal(trace.filter(args=>args[0]==='rm').length,6);
});
