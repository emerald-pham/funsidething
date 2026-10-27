#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseTap,coverageReference} from './test-groups.mjs';
import {ciInputContext,ciInputKey} from './agent-tools/ci-pass-reuse.mjs';
import {verifySceneryFixtureReport} from './scenery-source-fixture.mjs';
import {verifyProfiledNativeReport} from './mobile-source-profile.mjs';
import {verifyMobileMemoryReport,verifyMobileStressReport} from './button-safety-mobile-contract.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const manifestPath='scripts/early-ci-harness-source.json';
export const EARLY_CASES=['RISK repository process: Playwright waitForFunction predicates are synchronous','RISK repository process: scenery consumers use allocated fallback ports and preserve early native failures','RISK repository process: native scene-time bursts cannot activate controls behind a refused top-layer release'];
const git=(...args)=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
function source(){
 const manifest=json(path.join(root,manifestPath));
 for(const row of manifest.files){const bytes=fs.readFileSync(path.join(root,row.preservedOriginalPath||row.path));assert.equal(hash(bytes),row.sha256,'Preserved imported harness drift: '+row.path);if(row.effectiveSha256)assert.equal(hash(fs.readFileSync(path.join(root,row.path))),row.effectiveSha256,'Effective native adapter drift: '+row.path);assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex'),row.gitBlob);}
 const tests=fs.readFileSync(path.join(root,'tests.js'),'utf8');
 for(const row of manifest.testExcerpts){if(row.snapshotPath){assert.equal(hash(fs.readFileSync(path.join(root,row.snapshotPath))),row.sha256,'Preserved unexecuted regression drift: '+row.name);continue;}if(row.preservedOriginalPath)assert.equal(hash(fs.readFileSync(path.join(root,row.preservedOriginalPath))),row.sha256,'Preserved scenery regression drift: '+row.name);const start=tests.indexOf("test('"+row.name+"'");assert.ok(start>=0,'Imported regression missing: '+row.name);const next=tests.slice(start+1).search(/^test\(/m),end=next<0?tests.length:start+1+next;assert.equal(hash(tests.slice(start,end).trimEnd()+'\n'),row.effectiveSha256||row.sha256,'Imported regression drift: '+row.name);}
 if(manifest.sceneryFixture)assert.equal(hash(fs.readFileSync(path.join(root,manifest.sceneryFixture.path))),manifest.sceneryFixture.sha256,'Fixed scenery source manifest drift');
 if(manifest.canonicalLimitedProfile){
  assert.equal(hash(fs.readFileSync(path.join(root,manifest.canonicalLimitedProfile.path))),manifest.canonicalLimitedProfile.sha256,'Reviewed canonical source profile drift');
  const expected=manifest.testExcerpts.filter(row=>!row.snapshotPath).map(row=>row.name).sort(),catalog=earlyCatalog();
  assert.equal(expected.length,5,'The five confirmed saved regressions remain executable');
  assert.deepEqual(catalog.map(row=>row.root).sort(),expected,'Saved confirmed regressions must retain exact early execution assignments');
  const owners=new Map(expected.map(name=>[name,name===EARLY_CASES[0]?'core':'native-process']));
  assert.ok(catalog.every(row=>row.group===owners.get(row.root)&&row.file==='tests.js'),'Early execution retains each existing core/native-process catalog owner');
 }
 return hash(fs.readFileSync(path.join(root,manifestPath)));
}
function identity(descriptor){
 const id=descriptor.resultIdentity;assert.ok(id&&!id.checkoutDirty,'Clean complete descriptor required');
 assert.equal(git('status','--porcelain=v1','--untracked-files=all'),'','Early execution requires clean source');
 assert.equal(id.checkoutSha,git('rev-parse','HEAD'));assert.equal(id.checkoutTree,git('rev-parse','HEAD^{tree}'));assert.equal(id.sourceTree,git('rev-parse',id.sourceSha+'^{tree}'));git('cat-file','-e',id.comparisonBase+'^{commit}');
 for(const [key,value]of Object.entries({repository:process.env.GITHUB_REPOSITORY,sourceSha:process.env.CHAIN_TEST_SOURCE_SHA,eventPolicy:process.env.CHAIN_TEST_EVENT_POLICY,runId:process.env.GITHUB_RUN_ID,runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT)}))assert.equal(id[key],value,'Early descriptor environment '+key);
 const eventName=process.env.GITHUB_EVENT_NAME||null,eventRef=process.env.GITHUB_REF||null;
 let eventAction=null;
 if(eventName==='pull_request'){
  assert.ok(process.env.GITHUB_EVENT_PATH,'Raw pull request payload is required by the early consumer');
  eventAction=json(process.env.GITHUB_EVENT_PATH).action;
  assert.ok(typeof eventAction==='string'&&eventAction.trim(),'Raw pull request action is required by the early consumer');
 }
 for(const [key,value]of Object.entries({eventName,eventRef,eventAction})){
  if(Object.hasOwn(id,key))assert.equal(id[key],value,'Early descriptor raw event '+key);
  else assert.equal(value,null,'Early descriptor must retain raw event '+key);
 }
 return{descriptor:id,workflowBlob:git('rev-parse','HEAD:.github/workflows/data-safety.yml'),harnessSourceSha256:source(),...(process.env.ImageOS&&process.env.ImageVersion?{runtime:ciInputContext({runtime:{node:process.versions.node,platform:process.platform,arch:process.arch}}).runtime}:{}),eventName,eventRef,eventAction};
}
function inventory(directory){
 const rows=[];const visit=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);assert.equal(entry.isSymbolicLink(),false);if(entry.isDirectory())visit(file);else{assert.equal(entry.isFile(),true);const relative=path.relative(directory,file).split(path.sep).join('/');if(relative==='receipt.json')continue;const bytes=fs.readFileSync(file);rows.push({path:relative,bytes:bytes.length,sha256:hash(bytes)});}}};visit(directory);return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
function producerInputs(identity){
 const id=identity.descriptor,inputs={policy:'complete-ci-inputs-v1',repository:id.repository,checkoutTree:id.checkoutTree,comparisonBase:id.comparisonBase,runtime:identity.runtime};
 return{kind:'ci-early-producer-inputs-v1',identity,inputs,inputKey:ciInputKey(inputs,'early-startup')};
}
function verifyProducerRuntime(receipt,directory){
 const runtime=receipt.identity?.runtime,file=path.join(directory,'producer-inputs.json');
 if(runtime===undefined){assert.equal(fs.existsSync(file),false,'Early producer runtime is missing from its retained identity');return null;}
 const keys=['node','platform','arch','imageOS','imageVersion'];
 assert.deepEqual(Object.keys(runtime||{}).sort(),[...keys].sort(),'Complete original early runtime required');
 assert.ok(keys.every(key=>typeof runtime[key]==='string'&&runtime[key].trim()),'Original early runtime cannot be unknown');
 assert.deepEqual(json(file),producerInputs(receipt.identity),'Early producer complete-input proof differs from its retained identity');
 return runtime;
}
function assertHarness(raw){const cases=parseTap(raw),roots=cases.filter(row=>EARLY_CASES.includes(row.root));for(const name of EARLY_CASES)assert.equal(cases.filter(row=>row.id===name&&row.status==='passed').length,1,'One completed required harness root: '+name);assert.ok(roots.length>=EARLY_CASES.length);assert.ok(cases.every(row=>row.status==='passed'),'Harness cannot omit, skip, cancel or fail outcomes');return cases.length;}
function earlyCatalog(repo=root){
 const file=path.join(repo,'scripts/test-group-assignments.json');
 return fs.existsSync(file)?json(file).rootAssignments.filter(row=>row.executionStage==='early-startup'):[];
}
function collectEarlyCases(directory,descriptor,repo=root){
 const cases=parseTap(fs.readFileSync(path.join(directory,'harness.stdout'),'utf8'));
 const files=inventory(directory).filter(row=>/(^|\/)no-port\.tap$/.test(row.path));
 assert.ok(files.length<=1,'The saved source consumer must have one actual no-port child stream');
 for(const row of files)cases.push(...parseTap(fs.readFileSync(path.join(directory,row.path),'utf8')));
 const expected=earlyCatalog(repo).map(row=>row.root).sort();
 if(expected.length){
  const actual=cases.filter(row=>row.id===row.root).map(row=>row.root).sort();
  assert.deepEqual(actual,expected,'The existing catalog must reconcile every early root exactly once');
 }
 assert.ok(cases.every(row=>row.status==='passed'),'No skipped failed cancelled or TODO early coverage is accepted');
 assert.equal(new Set(cases.map(row=>row.id)).size,cases.length,'Duplicate early outcome');
 return cases.map(({id,root,status,skipReason})=>({id,root,status,skipReason})).sort((a,b)=>a.id.localeCompare(b.id));
}
export function earlyGroupCoverage(file,descriptor,group,{proof}={}){
 const receipt=verifyEarlyReceipt(file,descriptor,{proof});
 const roots=earlyCatalog().filter(row=>row.group===group).map(row=>row.root).sort();
 if(receipt.mode==='covered')return null;
 const selected=new Set(roots),cases=collectEarlyCases(path.dirname(file),descriptor).filter(row=>selected.has(row.root));
 return roots.length?{receiptSha256:hash(fs.readFileSync(file)),roots,cases}:null;
}
function mobile(directory,id,stress=false,repo=root){const file=path.join(directory,'report.json');const report=(stress?verifyMobileStressReport:verifyMobileMemoryReport)(json(file),{artifactRoot:directory,candidateCommit:id.checkoutSha,candidateTree:id.checkoutTree,sourceSha:id.sourceSha,repository:id.repository,runId:id.runId,runAttempt:id.runAttempt,eventPolicy:id.eventPolicy});if(json(path.join(repo,manifestPath)).canonicalLimitedProfile){for(const row of report.cases)verifyProfiledNativeReport(json(path.join(directory,row.nativeReportPath)),{repo,candidateCommit:id.checkoutSha,candidateTree:id.checkoutTree});}return report;}
function earlyCoverageReference(proof,id){
 if(!proof.earlyCoverage)return coverageReference(proof,id);
 const pass=proof.earlyCoverage,expected=ciInputContext({...id,runtime:{node:process.versions.node,platform:process.platform,arch:process.arch}});
 assert.ok(['full','reuse'].includes(proof.decision));assert.equal(String(proof.runId),String(id.runId));assert.equal(Number(proof.runAttempt),Number(id.runAttempt));
 for(const key of ['repository','sourceSha','sourceTree','checkoutSha','checkoutTree','comparisonBase'])assert.equal(proof.validationContext?.[key],id[key]);
 assert.equal(pass.kind,'ci-early-execution-v1');assert.deepEqual(pass.inputs,expected);assert.equal(pass.inputKey,ciInputKey(expected,'early-startup'));assert.ok(expected.runtime.imageOS&&expected.runtime.imageVersion);
 const origin=pass.coveredBy;for(const key of ['runId','runAttempt','earlyJobId','stressJobId'])assert.match(origin?.[key]||'',/^[1-9][0-9]*$/);
 assert.equal(origin.checkoutTree,id.checkoutTree);assert.equal(origin.comparisonBase,id.comparisonBase);
 for(const key of ['sourceSha','checkoutSha'])assert.match(origin[key]||'',/^[a-f0-9]{40}$/);assert.match(origin.earlyReportSha256||'',/^[a-f0-9]{64}$/);
 for(const artifact of [origin.earlyArtifact,origin.stressArtifact]){assert.match(artifact?.artifactId||'',/^[1-9][0-9]*$/);assert.match(artifact.artifactSha256||'',/^[a-f0-9]{64}$/);assert.ok(Date.parse(artifact.artifactExpiresAt)>Date.now());}
 assert.equal(origin.earlyArtifact.reportSha256,origin.earlyReportSha256);return pass;
}
export function verifyEarlyReceipt(file,descriptor,{proof}={}){
 const receipt=json(file),directory=path.dirname(file),bound=identity(descriptor);
 assert.equal(receipt.schemaVersion,1);assert.equal(receipt.status,'passed');assert.deepEqual(receipt.artifacts,inventory(directory),'Every early artifact byte must remain present');
 // A fresh downstream job may use another image. Verify the original producer's
 // complete inputs from the inventoried artifact; reuse admission still checks
 // the current runtime when creating and consuming covered evidence below.
 if(receipt.mode==='full'){const runtime=verifyProducerRuntime(receipt,directory);if(runtime)bound.runtime=runtime;}
 assert.deepEqual(receipt.identity,bound);
 if(receipt.mode==='covered'){assert.ok(proof,'Fresh complete producer proof required');const coverage=earlyCoverageReference(json(proof),descriptor.resultIdentity);assert.deepEqual(receipt.coverage,coverage);assert.match(coverage.coveredBy.earlyReportSha256||'',/^[a-f0-9]{64}$/,'Original early receipt required');assert.equal(receipt.children.length,0);return receipt;}
 return verifyRetainedEarlyReceipt(file,bound,{repo:root});
}
export function verifyRetainedEarlyReceipt(file,expected,{repo=root}={}){
 const receipt=json(file),directory=path.dirname(file),descriptor={resultIdentity:expected.descriptor};assert.equal(receipt.schemaVersion,1);assert.equal(receipt.status,'passed');assert.deepEqual(receipt.identity,expected);assert.deepEqual(receipt.artifacts,inventory(directory),'Every retained early artifact byte must remain present');
 // Older retained uploads predate producer-inputs.json. Their caller binds the
 // exact expected identity/runtime to original job, archive and input-key proof;
 // current standalone/group verification requires the new inventoried proof.
 if(fs.existsSync(path.join(directory,'producer-inputs.json')))verifyProducerRuntime(receipt,directory);
 assert.equal(receipt.mode,'full');assert.deepEqual(receipt.children.map(row=>row.kind),['harness','required-1gb']);for(const child of receipt.children){assert.equal(child.exitCode,0);assert.equal(child.signal,null);assert.equal(child.error,null);}
 assert.equal(receipt.harnessCaseCount,assertHarness(fs.readFileSync(path.join(directory,'harness.stdout'),'utf8')));if(earlyCatalog(repo).length||receipt.executionCases)assert.deepEqual(receipt.executionCases,collectEarlyCases(directory,descriptor,repo),'Early outcome records must equal actual raw streams');if(json(path.join(repo,manifestPath)).canonicalLimitedProfile){const reports=receipt.artifacts.filter(row=>row.path.endsWith('.json')).map(row=>json(path.join(directory,row.path))).filter(row=>row.kind==='button-diagnostic'&&row.engine==='chromium');assert.equal(reports.length,1,'Exactly one actual confirmed modal consumer report required');for(const report of reports)verifyProfiledNativeReport(report,{repo,candidateCommit:descriptor.resultIdentity.checkoutSha,candidateTree:descriptor.resultIdentity.checkoutTree});}if(json(path.join(repo,manifestPath)).sceneryFixture){const reports=receipt.artifacts.filter(row=>row.path.endsWith('.json')).map(row=>json(path.join(directory,row.path))).filter(row=>row.kind==='button-scenery-fixture');assert.equal(reports.length,5,'Four actual saved scenery causal reports plus their early-launch refusal required');const causal=reports.filter(report=>/^Error: Causal (?:painted-slot|late-copy) probe complete; not native acceptance/.test(report.failure||''));assert.equal(causal.length,4);assert.equal(causal.filter(report=>report.failure.startsWith('Error: Causal painted-slot')).length,1);for(const report of reports){verifySceneryFixtureReport(report,{repo,candidateCommit:descriptor.resultIdentity.checkoutSha,candidateTree:descriptor.resultIdentity.checkoutTree});assert.equal(report.status,'failed');assert.equal(report.cleanup?.serverClosed,true);if(causal.includes(report)){for(const key of ['contextClosed','browserClosed'])assert.equal(report.cleanup?.[key],true);}else assert.match(report.failure,/Controlled early scenery launch failure/);}}mobile(path.join(directory,'required'),descriptor.resultIdentity,false,repo);return receipt;
}
function options(argv){const result={};for(let i=0;i<argv.length;i++){const key=argv[i];assert.ok(['--run','--verify','--covered','--descriptor','--output-dir','--receipt','--proof'].includes(key),'Unknown early option: '+key);assert.equal(result[key],undefined);result[key]=['--run','--verify','--covered'].includes(key)?true:argv[++i];assert.ok(result[key]);}assert.equal(['--run','--verify','--covered'].filter(key=>result[key]).length,1);assert.ok(result['--descriptor']);return result;}
async function main(){const args=options(process.argv.slice(2)),descriptor=json(args['--descriptor']);if(args['--verify']){verifyEarlyReceipt(args['--receipt'],descriptor,{proof:args['--proof']});return;}
 const bound=identity(descriptor),directory=path.resolve(args['--output-dir']);assert.equal(fs.existsSync(directory),false,'Fresh early output required');fs.mkdirSync(directory,{recursive:true});
 if(args['--run']&&bound.runtime)fs.writeFileSync(path.join(directory,'producer-inputs.json'),JSON.stringify(producerInputs(bound),null,2)+'\n',{flag:'wx'});
 const receipt={schemaVersion:1,status:'running',mode:args['--covered']?'covered':'full',identity:bound,startedAt:new Date().toISOString(),children:[],artifacts:[],limits:['OS-process and raw artifact accounting; actual hosted mobile evidence is required separately from controlled process fixtures.']};
 const save=()=>{receipt.artifacts=inventory(directory);fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');};
 try{
  if(args['--covered']){receipt.coverage=earlyCoverageReference(json(args['--proof']),descriptor.resultIdentity);assert.match(receipt.coverage.coveredBy.earlyReportSha256||'',/^[a-f0-9]{64}$/,'Original early receipt required');}
  else{
   const child=(kind,command)=>{const began=Date.now(),result=spawnSync(process.execPath,command,{cwd:root,env:{...process.env,NODE_OPTIONS:[process.env.NODE_OPTIONS,'--test-reporter=tap'].filter(Boolean).join(' '),CHAIN_NATIVE_OUTPUT:path.join(directory,'native')},encoding:'utf8',timeout:kind==='harness'?180000:600000,maxBuffer:32*1024*1024});for(const stream of ['stdout','stderr'])fs.writeFileSync(path.join(directory,kind+'.'+stream),result[stream]||'');receipt.children.push({kind,command,pid:result.pid,exitCode:result.status,signal:result.signal,error:result.error?.message||null,durationMs:Date.now()-began});save();assert.equal(result.status,0,kind+' did not complete successfully: '+result.stderr);assert.equal(result.signal,null);assert.equal(result.error,undefined);return result;};
   const pattern='^(?:'+EARLY_CASES.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')$';
   receipt.harnessCaseCount=assertHarness(child('harness',['--test','--test-name-pattern='+pattern,'tests.js']).stdout);
   child('required-1gb',['scripts/button-safety-mobile-memory.mjs','--run','--profile','required-1gb','--output-dir',path.join(directory,'required')]);mobile(path.join(directory,'required'),descriptor.resultIdentity);
  }
  if(receipt.mode==='full')receipt.executionCases=collectEarlyCases(directory,descriptor);receipt.status='passed';receipt.finishedAt=new Date().toISOString();save();verifyEarlyReceipt(path.join(directory,'receipt.json'),descriptor,{proof:args['--proof']});
  if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,'report='+hash(fs.readFileSync(path.join(directory,'receipt.json')))+'\n');
 }catch(error){receipt.status='failed';receipt.failure=error.stack;receipt.finishedAt=new Date().toISOString();save();throw error;}
}
export {mobile as verifyEarlyMobileReport};
if(path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
