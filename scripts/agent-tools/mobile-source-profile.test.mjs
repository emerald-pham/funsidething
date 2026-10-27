import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const story='rapid scanner candidate actions with 400 active tasks';
function canonicalSource(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-mobile-source-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const files=spawnSync('git',['ls-files'],{cwd:root,encoding:'utf8'}).stdout.trim().split('\n').filter(file=>file!=='tests.js'&&!file.startsWith('scripts/')&&/\.(?:js|html)$/.test(file));const source=path.join(directory,'source.js');fs.writeFileSync(source,files.map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n'));return{directory,source};}
function invoke(source,args=[]){const env={...process.env};delete env.NODE_TEST_CONTEXT;const defaults=['--engine','webkit','--motion','normal','--scenario',story],kept=[];for(let i=0;i<defaults.length;i+=2)if(!args.includes(defaults[i]))kept.push(defaults[i],defaults[i+1]);return spawnSync(process.execPath,['scripts/mobile-source-profile.mjs','--check','--source',source,...kept,...args],{cwd:root,env,encoding:'utf8',timeout:10000});}
test('canonical mobile source profile admits exact current app without changing original story or full catalog',async t=>{
 const fixture=canonicalSource(t),result=invoke(fixture.source);assert.equal(result.status,0,'Exact canonical app must reach the limited mobile boundary: '+result.stderr);assert.match(result.stdout,/Limited canonical source admitted/);
 await t.test('fixed saved scenery fixture separates app identity from current tooling and cannot qualify mobile',async t=>{
  const {runButtonSafety}=await import('../button-safety-native.mjs'),playwright=await import('playwright');
  const {createHash}=await import('node:crypto');const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const saved='b176026825e4f9539780f745fe60e09cf348d288',savedTree='27e293d0fa9aae62a906b36dc984bd0ef184f956';
  const landscape=spawnSync('git',['show',saved+':landscape.js'],{cwd:root});assert.equal(landscape.status,0);
  const fixturePort=process.env.CI==='true'?0:Number(process.env.CHAIN_NATIVE_PORT||process.env.CHAIN_NATIVE_SMOKE_PORT||0);assert.ok(process.env.CI==='true'||fixturePort>0,'Focused local source consumer requires its existing allocated native port');
  const output=path.join(fixture.directory,'native'),ledger=path.join(fixture.directory,'ledger.json'),prior=process.env.CODEX_COORDINATION_FILE,launch=playwright.webkit.launch;
  fs.writeFileSync(ledger,JSON.stringify({entries:[{status:'active',worktree:root,lease:{state:'healthy',expiresAt:new Date(Date.now()+60000).toISOString()},resources:['browser-runtime:playwright-webkit','loopback:127.0.0.1:'+fixturePort]}]}));process.env.CODEX_COORDINATION_FILE=ledger;
  const stopped=Error('Intentional external browser launch boundary');let observed;
  playwright.webkit.launch=async()=>{observed=JSON.parse(fs.readFileSync(path.join(output,fs.readdirSync(output).find(file=>file.endsWith('.json')))));throw stopped;};
  t.after(()=>{playwright.webkit.launch=launch;if(prior===undefined)delete process.env.CODEX_COORDINATION_FILE;else process.env.CODEX_COORDINATION_FILE=prior;});
  await assert.rejects(runButtonSafety({repo:root,engine:'webkit',port:fixturePort,outputDir:output,mobileYesMotion:'reduced',appFixture:'saved-scenery-b176'}),error=>error===stopped);
  observed=JSON.parse(fs.readFileSync(path.join(output,fs.readdirSync(output).find(file=>file.endsWith('.json')))));
  assert.equal(observed.assets['landscape.js'],hash(landscape.stdout),'The explicit scenery consumer must serve the immutable saved app, not canonical paint bytes');
  assert.equal(Object.keys(observed.assets).length,36,'The complete saved app includes its immutable shell and license assets');assert.ok(observed.assets['vendor/HYG-LICENSE']);
  assert.equal(observed.kind,'button-scenery-fixture');assert.equal(observed.appFixture.commit,saved);assert.equal(observed.appFixture.tree,savedTree);assert.equal(observed.appFixture.id,'saved-scenery-b176');assert.equal(observed.appFixture.originalHarnessCommit,'9b5bc1c9d5a87fed022a17706bbb0e69e94757b1');
  assert.equal(observed.appFixture.tooling.commit,spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim());assert.equal(observed.appFixture.tooling.assets['scripts/button-safety-native.mjs'],hash(fs.readFileSync(path.join(root,'scripts/button-safety-native.mjs'))));
  const {verifyProfiledNativeReport}=await import('../mobile-source-profile.mjs'),{verifyMobileFunctionalReport}=await import('../button-safety-mobile-contract.mjs');
  assert.throws(()=>verifyProfiledNativeReport(observed,{repo:root}));assert.throws(()=>verifyMobileFunctionalReport(observed));
  const {verifySceneryFixtureReport}=await import('../scenery-source-fixture.mjs');assert.equal(verifySceneryFixtureReport(observed,{repo:root}).id,'saved-scenery-b176');
  for(const mutate of [r=>r.appFixture.commit='6'.repeat(40),r=>r.appFixture.tree='7'.repeat(40),r=>delete r.assets['landscape.js'],r=>r.appFixture.tooling.assets['tests.js']='0'.repeat(64)]){const next=structuredClone(observed);mutate(next);assert.throws(()=>verifySceneryFixtureReport(next,{repo:root}));}
  await assert.rejects(runButtonSafety({repo:root,engine:'chromium',port:fixturePort,outputDir:path.join(fixture.directory,'forbidden'),appFixture:'saved-scenery-b176'}));
  await assert.rejects(runButtonSafety({repo:root,engine:'webkit',port:fixturePort,outputDir:path.join(fixture.directory,'forbidden'),mobileYesMotion:'reduced',appFixture:saved}));
  t.diagnostic('Fixed saved scenery source reached the actual launch boundary; current tooling and frozen app identities remain distinct; fixture cannot qualify current mobile.');
 });
});

test('canonical limited profiles reject wrong source profile engine scenario control and full coverage',async t=>{
 const fixture=canonicalSource(t),profile=JSON.parse(fs.readFileSync(path.join(root,'scripts/mobile-source-profile.json')));
 for(const [name,args]of [
  ['desktop full run',['--engine','chromium','--motion','none','--scenario','full-native-actions']],
  ['wrong engine',['--engine','chromium']],['wrong scenario',['--scenario','rapid Add and context actions with 400 saved tasks']],
  ['sensitivity',['--control','pageerror']],['probe',['--probe']],
 ])await t.test(name,()=>{const result=invoke(fixture.source,args);assert.notEqual(result.status,0,name+' cannot use a limited profile');});
 for(const [name,mutate]of [['wrong profile ID',p=>p.id='other'],['changed asset',p=>p.applicationAssets['index.html']='0'.repeat(64)],['expanded scope',p=>p.allowedScopes.push({id:'full',engine:'chromium',scenario:'all',motions:[null]})],['changed original catalog',p=>p.originalInventorySha256='0'.repeat(64)],['expanded known IDs',p=>p.recognizedActions.push('act:gate-new-untested')]])await t.test(name,()=>{const next=structuredClone(profile);mutate(next);const file=path.join(fixture.directory,'profile.json');fs.writeFileSync(file,JSON.stringify(next));const result=invoke(fixture.source,['--profile',file]);assert.notEqual(result.status,0,name+' cannot be silently admitted');});
 await t.test('wrong source despite unchanged templates',()=>{fs.appendFileSync(fixture.source,'\n// different runtime source');assert.notEqual(invoke(fixture.source).status,0);});
});
test('confirmed modal source profile admits only its exact existing Chromium consumer',t=>{
 const fixture=canonicalSource(t),result=invoke(fixture.source,['--engine','chromium','--motion','none','--scenario','rapid scene time presets, lock, live time, and close']);assert.equal(result.status,0,result.stderr);const binding=JSON.parse(result.stdout.split('\n')[1]);assert.equal(binding.scope,'confirmed-modal-release');assert.ok(binding.recognizedActions?.includes('act:download-backup'),'Reviewed canonical offered backup ID must be admitted independently of executed coverage');assert.match(binding.coverage,/no full native action coverage/);
});
test('native report verifier binds the complete actual source and refuses full-action relabeling',async t=>{
 const {verifyProfiledNativeReport}=await import('../mobile-source-profile.mjs');const fixture=canonicalSource(t),result=invoke(fixture.source);assert.equal(result.status,0,result.stderr);const binding=JSON.parse(result.stdout.split('\n')[1]),profile=JSON.parse(fs.readFileSync(path.join(root,'scripts/mobile-source-profile.json')));
 const report={kind:'button-mobile-functional',engine:'webkit',status:'passed',sourceProfile:binding,observedActions:['act:download-backup'],actionObservation:{recognizedOffered:['act:download-backup'],executed:[],coverage:'Offered IDs are recognized, not credited as executed; limited consumer only'},assets:profile.applicationAssets,scenarios:[{name:story}]};assert.equal(verifyProfiledNativeReport(report,{repo:root}).scope,'required-mobile-story','Source parser fixture only; no actual browser or functional acceptance');
 for(const [name,change]of [['missing binding',r=>delete r.sourceProfile],['different profile',r=>r.sourceProfile.profileSha256='0'.repeat(64)],['missing served asset',r=>delete r.assets['index.html']],['full native relabel',r=>r.kind='button-safety'],['different scenario',r=>r.scenarios[0].name='all native actions'],['unknown offered ID',r=>r.observedActions.push('act:gate-new-untested')],['unbound known ID',r=>r.sourceProfile.recognizedActions.push('act:gate-new-untested')],['offered mislabeled executed',r=>r.actionObservation.executed.push('act:download-backup')]])await t.test(name,()=>{const changed=structuredClone(report);change(changed);assert.throws(()=>verifyProfiledNativeReport(changed,{repo:root}));});
});
