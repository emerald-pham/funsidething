import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyMobileMemoryReport,MOBILE_IMAGE} from '../button-safety-mobile-contract.mjs';
import {readMemoryBoundary,containerArgs} from '../button-safety-mobile-memory.mjs';
import {createMobileBundle,refreshMobileBundle} from './mobile-memory-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-mobile-parser-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return createMobileBundle(directory);}
const verify=bundle=>verifyMobileMemoryReport(bundle.report,{artifactRoot:bundle.directory,candidateCommit:'a'.repeat(40),candidateTree:'b'.repeat(40),sourceSha:'a'.repeat(40),repository:'example/fixture',runId:'fixture-run-1',runAttempt:1,eventPolicy:'local'});
test('mobile memory parser rejects waived limits synthetic touch and mismatched durable evidence',async t=>{
 const good=fixture(t);assert.equal(verify(good).status,'passed','Controlled parser fixture only; not a live cap receipt');
 const mutations=[
  ['unbounded or enlarged memory',b=>b.report.cases[0].after.memoryMaxBytes=1024000000],
  ['swappable client',b=>b.report.cases[0].after.swapMaxBytes=512000000],
  ['peak above budget',b=>b.report.cases[0].after.peakBytes=512004096],
  ['fake OOM negative control',b=>b.report.negativeControl.after.events.oom_kill=0],
  ['unconfirmed control exit',b=>b.report.negativeControl.childSignal='SIGTERM'],
  ['reused container',b=>b.report.cases[1].containerId=b.report.cases[0].containerId],
  ['missing normal motion',b=>b.report.cases.shift()],
  ['desktop input',b=>b.native.normal.presses[0].pointerType='mouse'],
  ['synthetic pointer',b=>b.native.normal.presses[0].trusted=false],
  ['synthetic click',b=>b.native.normal.clicks[0].trusted=false],
  ['duplicate offered tasks',b=>{const r=b.native.normal;for(const list of [r.presses,r.clicks])for(const row of list)row.offeredTaskId='same-task';r.mobileStory.acceptedTaskIds=Array(10).fill('same-task');r.mobileStory.finalChain=['initial-dot',...Array(10).fill('same-task')];r.mobileStory.durableChain=[...r.mobileStory.finalChain];}],
  ['different accepted task',b=>b.native.normal.clicks[1].offeredTaskId='not-offered'],
  ['lost durable Yes',b=>b.native.normal.mobileStory.durableChain.pop()],
  ['lost source',b=>b.native.normal.mobileStory.after.protectedSourcesHash='0'.repeat(64)],
  ['slow burst',b=>b.native.normal.rapidOutcomes[0].bursts[0].windowMs=2001],
  ['wrong source identity',b=>b.report.candidateCommit='0'.repeat(40)],
  ['dirty runtime error',b=>b.native.normal.errors.push('page-crash')],
  ['failed cleanup',b=>b.native.normal.cleanup.browserClosed=false],
 ];
 for(const [name,mutate]of mutations)await t.test(name,sub=>{const bundle=fixture(sub);mutate(bundle);refreshMobileBundle(bundle);assert.throws(()=>verify(bundle));});
 await t.test('missing raw kernel observation',sub=>{const bundle=fixture(sub);fs.unlinkSync(path.join(bundle.directory,bundle.report.negativeControl.insidePath));assert.throws(()=>verify(bundle));});
 await t.test('altered raw native bytes',sub=>{const bundle=fixture(sub);fs.appendFileSync(path.join(bundle.directory,bundle.report.cases[0].nativeReportPath),' ');assert.throws(()=>verify(bundle));});
});
test('mobile memory boundary refuses unsupported or unbounded runtimes before native launch',()=>{
 assert.throws(()=>readMemoryBoundary({platform:'darwin',read:()=>assert.fail('Darwin must not invent cgroup evidence')}),/Linux cgroup-v2/);
 const files={'memory.max':'512000000','memory.swap.max':'0','memory.swap.current':'0','memory.current':'20000000','memory.peak':'30000000','memory.events':'max 0\noom 0\noom_kill 0','/proc/self/cgroup':'0::/'};
 const read=file=>files[file]??files[path.basename(file)];assert.equal(readMemoryBoundary({platform:'linux',read}).memoryMaxBytes,512000000);
 for(const [key,value]of [['memory.max','max'],['memory.max','1024000000'],['memory.swap.max','max'],['memory.swap.max','512000000']])assert.throws(()=>readMemoryBoundary({platform:'linux',read:file=>path.basename(file)===key?value:read(file)}));
});
test('mobile memory command cannot run a pretend local cap and pins the owned container boundary',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-mobile-refusal-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const result=spawnSync(process.execPath,['scripts/button-safety-mobile-memory.mjs','--run','--output-dir',path.join(directory,'proof')],{cwd:root,env:{...process.env,CI:'false'},encoding:'utf8',timeout:5000});assert.notEqual(result.status,0);assert.match(result.stderr,/hosted Linux/);assert.equal(fs.existsSync(path.join(directory,'proof')),false);
 const args=containerArgs({repo:'/synthetic/repo',output:'/synthetic/output',nodeBinary:'/synthetic/node22',motion:'normal',control:false,eventPolicy:'push'});
 for(const name of ['--memory','--memory-swap'])assert.equal(args[args.indexOf(name)+1],'512000000');assert.equal(args[args.indexOf('--network')+1],'none');assert.ok(args.includes(MOBILE_IMAGE));assert.ok(args.includes('/opt/chain-node'));assert.equal(args.includes('--privileged'),false);assert.equal(args.includes('--ipc=host'),false);assert.equal(args.some(value=>value.includes('docker.sock')),false);
});

test('mobile memory intentional OOM control binds the Docker flag while clients reject it',async t=>{
 const control=fixture(t);control.report.negativeControl.containerOOMKilled=true;refreshMobileBundle(control);
 assert.equal(verify(control).status,'passed','A real child OOM may mark Docker OOMKilled while the reporting consumer exits0');
 for(const motion of ['normal','reduced'])await t.test(motion+' client OOM remains rejected',sub=>{
  const client=fixture(sub);client.report.negativeControl.containerOOMKilled=true;client.report.cases.find(row=>row.motion===motion).containerOOMKilled=true;refreshMobileBundle(client);assert.throws(()=>verify(client),'An OOM-marked acceptance client must never pass');
 });
 await t.test('raw Docker OOM flag cannot differ from envelope',sub=>{
  const bundle=fixture(sub);bundle.report.negativeControl.containerOOMKilled=true;refreshMobileBundle(bundle);bundle.report.negativeControl.containerOOMKilled=false;assert.throws(()=>verify(bundle));
 });
 await t.test('Docker OOM flag alone is not kernel proof',sub=>{
  const bundle=fixture(sub);bundle.report.negativeControl.containerOOMKilled=true;bundle.report.negativeControl.after.events.oom_kill=0;refreshMobileBundle(bundle);assert.throws(()=>verify(bundle));
 });
});

test('mobile memory parser rejects changed final browser or driver container isolation',async t=>{
 for(const role of ['browser','driver'])await t.test(role,async sub=>{
  const bundle=fixture(sub),row=role==='browser'?bundle.report.cases[0]:bundle.report.cases[0].driver,file=path.join(bundle.directory,row.dockerAfterPath),after=JSON.parse(fs.readFileSync(file,'utf8'));
  after.HostConfig={...(after.HostConfig||{}),Memory:1024000000};fs.writeFileSync(file,JSON.stringify(after));
  row.dockerAfterSha256=(await import('../button-safety-mobile-contract.mjs')).mobileDigest(fs.readFileSync(file));bundle.report.artifacts=(await import('../button-safety-mobile-contract.mjs')).mobileArtifactInventory(bundle.directory);
  assert.throws(()=>verify(bundle),'Rehashed post-run Docker configuration cannot relax the observed budget/isolation');
 });
});
