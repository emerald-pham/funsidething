import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyMobileMemoryReport,verifyMobileStressReport,MOBILE_IMAGE} from '../button-safety-mobile-contract.mjs';
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
  ['peak above budget',b=>b.report.cases[0].after.peakBytes=1000004096],
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
 const files={'memory.max':'1000000000','memory.swap.max':'0','memory.swap.current':'0','memory.current':'20000000','memory.peak':'30000000','memory.events':'max 0\noom 0\noom_kill 0','/proc/self/cgroup':'0::/'};
 const read=file=>files[file]??files[path.basename(file)];assert.equal(readMemoryBoundary({platform:'linux',read}).memoryMaxBytes,1000000000);
 for(const [key,value]of [['memory.max','max'],['memory.max','1024000000'],['memory.swap.max','max'],['memory.swap.max','512000000']])assert.throws(()=>readMemoryBoundary({platform:'linux',read:file=>path.basename(file)===key?value:read(file)}));
});
test('mobile memory command cannot run a pretend local cap and pins the owned container boundary',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-mobile-refusal-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const result=spawnSync(process.execPath,['scripts/button-safety-mobile-memory.mjs','--run','--output-dir',path.join(directory,'proof')],{cwd:root,env:{...process.env,CI:'false'},encoding:'utf8',timeout:5000});assert.notEqual(result.status,0);assert.match(result.stderr,/hosted Linux/);assert.equal(fs.existsSync(path.join(directory,'proof')),false);
 const args=containerArgs({repo:'/synthetic/repo',output:'/synthetic/output',nodeBinary:'/synthetic/node22',motion:'normal',control:false,eventPolicy:'push'});
 for(const name of ['--memory','--memory-swap'])assert.equal(args[args.indexOf(name)+1],'1000000000');assert.equal(args[args.indexOf('--network')+1],'none');assert.ok(args.includes(MOBILE_IMAGE));assert.ok(args.includes('/opt/chain-node'));assert.equal(args.includes('--privileged'),false);assert.equal(args.includes('--ipc=host'),false);assert.equal(args.some(value=>value.includes('docker.sock')),false);
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


test('mobile budget profiles require one decimal GB without accepting the reported stress limit',t=>{
 const args=containerArgs({repo:'/synthetic/repo',output:'/synthetic/output',nodeBinary:'/synthetic/node22',motion:'normal',eventPolicy:'push'});
 assert.equal(args[args.indexOf('--memory')+1],'1000000000','Required browser-family planner uses the newly authorized1GB cap from launch');
 const bundle=fixture(t);assert.equal(bundle.report.schemaVersion,3,'New policy has its own schema; historical512MB reports stay historical');assert.equal(bundle.report.budgetProfile,'required-1gb');assert.equal(bundle.report.requiredStory.memoryBudgetBytes,1000000000);
 assert.equal(verify(bundle).status,'passed');
 const stress=containerArgs({repo:'/synthetic/repo',output:'/synthetic/output',nodeBinary:'/synthetic/node22',motion:'normal',eventPolicy:'push',budgetProfile:'stress-512mb'});assert.equal(stress[stress.indexOf('--memory')+1],'512000000');
 assert.throws(()=>containerArgs({repo:'/synthetic/repo',output:'/synthetic/output',nodeBinary:'/synthetic/node22',eventPolicy:'push',budgetProfile:'arbitrary-limit'}),/profile/);
 for(const mutate of [b=>b.report.budgetProfile='stress-512mb',b=>b.report.cases[0].after.memoryMaxBytes=512000000,b=>b.report.schemaVersion=2]){const b=fixture(t);mutate(b);refreshMobileBundle(b);assert.throws(()=>verify(b),'Required gate rejects changed profile, numeric boundary and legacy relabeling');}
});


test('mobile budget profiles report authentic stress application failures without waiving execution integrity',async t=>{
 const make=()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-stress-parser-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return createMobileBundle(directory,{},'stress-512mb');};
 const verifyStress=b=>verifyMobileStressReport(b.report,{artifactRoot:b.directory});
 const passed=make();assert.equal(verifyStress(passed).status,'passed','A complete stress pass is reportable but cannot substitute for required proof');assert.throws(()=>verify(passed));
 const fail=(b,kind)=>{const row=b.report.cases[0],n=b.native.normal;b.report.status='failed';row.appOutcome=kind;n.status='failed';
  if(kind==='kernel-oom'){row.after.events={max:1,oom:1,oom_kill:1};row.containerOOMKilled=true;row.server.status='failed';row.server.errors=['Browser budget OOM: oom','Browser budget OOM: oom_kill'];n.errors=['page-crash'];n.failure='page.goto: Page crashed';}
  else if(kind==='app-runtime-failure'){n.errors=['page-crash'];n.failure='Page crashed';}
  else{n.samples=[{maxFrameGapMs:1001}];n.failure='AssertionError: Native button safety detected blocked frame loop: start-scan 1001ms';}
  refreshMobileBundle(b);return b;};
 for(const kind of ['kernel-oom','app-runtime-failure','app-budget-failure'])await t.test(kind,()=>{const b=fail(make(),kind);assert.equal(verifyStress(b).status,'failed');assert.throws(()=>verify(b));});
 await t.test('ten-touch deadline requires ten actually delivered trusted attempts',()=>{
  const b=fail(make(),'app-budget-failure'),n=b.native.normal;n.samples=[];n.inFlightBurst={windowMs:2001,attempts:Array.from({length:10},()=>({trustedPresses:1,nativeDownAction:'act:yes'}))};n.failure='AssertionError: Ten native press attempts must finish within two seconds: yes 2001ms';refreshMobileBundle(b);assert.equal(verifyStress(b).status,'failed','The raw measured deadline failure stays reported');
  n.presses.pop();refreshMobileBundle(b);assert.throws(()=>verifyStress(b),'A missing native input cannot be waived as a measured ten-touch deadline breach');
 });
 const invalids={
  'missing execution':b=>b.report.cases.pop(),
  'waived driver failure':b=>b.report.cases[0].driver.containerExitCode=1,
  'transport error':b=>{b.native.normal.errors=[];b.native.normal.failure='Browser endpoint transport refused';},
  'failed owner cleanup':b=>b.report.cases[0].server.cleanup.engineExited=false,
  'fake OOM':b=>{b.report.cases[0].after.events.oom_kill=0;b.native.normal.errors=[];},
  'changed profile':b=>b.report.budgetProfile='required-1gb',
  'changed source':b=>b.native.normal.candidateCommit='0'.repeat(40),
  'fake failed stress label':b=>b.native.normal.status='passed',
 };
 for(const [name,mutate]of Object.entries(invalids))await t.test(name,()=>{const b=fail(make(),'kernel-oom');mutate(b);refreshMobileBundle(b);assert.throws(()=>verifyStress(b),name);});
});


test('mobile budget profiles reject failed stress setup substitutions and mixed nonapp errors',async t=>{
 const make=()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-stress-setup-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const b=createMobileBundle(directory,{},'stress-512mb');b.report.status='failed';b.report.cases[0].appOutcome='app-runtime-failure';const n=b.native.normal;n.status='failed';n.errors=['page-crash'];n.failure='page.goto: Page crashed';delete n.mobileStory;n.scenarios=[];refreshMobileBundle(b);return b;};
 const verify=b=>verifyMobileStressReport(b.report,{artifactRoot:b.directory});
 const good=make();assert.equal(verify(good).status,'failed','Prepared startup crash remains reportable before app-ready and successful story evidence');
 const mutations={
  'missing pre-attempt setup':n=>delete n.mobileAttempt,
  'wrong scenario':n=>n.mobileAttempt.scenario='small board',
  'desktop profile':n=>n.mobileAttempt.profile.isMobile=false,
  'wrong actual viewport':n=>n.mobileAttempt.observed.width=1100,
  'wrong motion':n=>n.mobileAttempt.motion='reduced',
  'wrong actual motion':n=>n.mobileAttempt.observed.reducedMedia=true,
  'undersized durable fixture':n=>n.retainedSources[0].bootstrap.workload.durableTasks=64,
  'undersized unknown data':n=>n.retainedSources[0].bootstrap.workload.unknownBytes=1024,
  'duplicate tasks':n=>n.retainedSources[0].bootstrap.workload.distinctTaskIds=1,
  'undersized protected copy':n=>n.retainedSources[0].bootstrap.retainedSources[0].durableTasks=64,
  'missing opaque original':n=>delete n.retainedSources[0].bootstrap.workload.opaque,
  'changed pending original':n=>n.retainedSources[0].bootstrap.workload.pending.payloadHash='0'.repeat(64),
  'different prepared head':n=>n.mobileAttempt.headPayloadHash='0'.repeat(64),
  'mixed transport loss without OOM':n=>n.errors.push('browser-disconnected'),
  'mixed unexpected navigation':n=>n.errors.push('unexpected-navigation-or-reload: https://example.invalid'),
  'mixed unidentified action':n=>n.errors.push('unidentified-button'),
 };
 for(const [name,mutate]of Object.entries(mutations))await t.test(name,()=>{const b=make();mutate(b.native.normal);refreshMobileBundle(b);assert.throws(()=>verify(b),name);});
 await t.test('real kernel OOM admits engine disconnect but never unrelated navigation',()=>{const b=make(),r=b.report.cases[0],n=b.native.normal;r.appOutcome='kernel-oom';r.after.events={max:1,oom:1,oom_kill:1};r.containerOOMKilled=true;r.server.status='failed';r.server.errors=['Browser budget OOM: oom_kill'];n.errors=['page-crash','browser-disconnected','unexpected-close'];refreshMobileBundle(b);assert.equal(verify(b).status,'failed');n.errors.push('unexpected-navigation-or-reload: https://example.invalid');refreshMobileBundle(b);assert.throws(()=>verify(b),'A kernel OOM cannot waive an unrelated navigation fault');});
});


test('mobile budget profiles require attributable primary failures for reported stress',async t=>{
 const make=(outcome='app-runtime-failure')=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-stress-primary-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const b=createMobileBundle(directory,{},'stress-512mb'),r=b.report.cases[0],n=b.native.normal;b.report.status='failed';r.appOutcome=outcome;n.status='failed';n.errors=['page-crash'];n.failure='page.goto: Page crashed';delete n.mobileStory;n.scenarios=[];
  if(outcome==='kernel-oom'){r.after.events={max:1,oom:1,oom_kill:1};r.containerOOMKilled=true;r.server.status='failed';r.server.errors=['Browser budget OOM: oom_kill'];n.errors=['page-crash','browser-disconnected'];}
  if(outcome==='app-budget-failure'){n.errors=[];n.samples=[{maxFrameGapMs:1001}];n.failure='AssertionError [ERR_ASSERTION]: Native button safety detected blocked frame loop: start-scan 1001ms';}
  return b;};
 const verify=b=>{refreshMobileBundle(b);return verifyMobileStressReport(b.report,{artifactRoot:b.directory});};
 for(const [name,outcome,errors,failure]of [
  ['startup page crash','app-runtime-failure',['page-crash'],'page.goto: Page crashed'],
  ['crashed target evaluation','app-runtime-failure',['page-crash'],'page.evaluate: Target crashed '],
  ['app closed its page','app-runtime-failure',['unexpected-close'],'page.evaluate: Target page, context or browser has been closed'],
  ['actual app event assertion','app-runtime-failure',['pageerror: Controlled application error'],'AssertionError [ERR_ASSERTION]: Native button safety detected pageerror: Controlled application error\n    at check (native-consumer)'],
  ['kernel engine loss','kernel-oom',['page-crash','browser-disconnected'],'page.evaluate: Target page, context or browser has been closed'],
 ])await t.test(name,()=>{const b=make(outcome);b.native.normal.errors=errors;b.native.normal.failure=failure;assert.equal(verify(b).status,'failed');});
 await t.test('measured blocked frame remains reportable',()=>assert.equal(verify(make('app-budget-failure')).status,'failed'));
 const late=()=>{const b=make('app-budget-failure'),n=b.native.normal;n.samples=[];n.inFlightBurst={windowMs:2001,attempts:Array.from({length:10},()=>({trustedPresses:1,nativeDownAction:'act:yes'}))};n.failure='AssertionError [ERR_ASSERTION]: Ten native press attempts must finish within two seconds: yes 2001ms';return b;};
 await t.test('ten delivered late touches remain reportable',()=>assert.equal(verify(late()).status,'failed'));
 for(const [name,build]of [
  ['pageerror plus unrelated primary driver error',()=>{const b=make();b.native.normal.errors=['pageerror: Controlled application error'];return b;}],
  ['page crash plus unrelated primary driver error',()=>make()],
  ['kernel OOM plus unrelated primary driver error',()=>make('kernel-oom')],
  ['measured frame plus unrelated primary driver error',()=>make('app-budget-failure')],
  ['late touches plus unrelated primary driver error',late],
 ])await t.test(name,()=>{const b=build();b.native.normal.failure='Error: Controlled unrelated evaluation/transport error';assert.throws(()=>verify(b),name);});
 await t.test('app event cannot conceal an unrelated primary with crash text later in the stack',()=>{const b=make();b.native.normal.errors=['pageerror: Controlled application error'];b.native.normal.failure='Error: Controlled unrelated evaluation/transport error\n    at page.goto: Page crashed';assert.throws(()=>verify(b));});
});
