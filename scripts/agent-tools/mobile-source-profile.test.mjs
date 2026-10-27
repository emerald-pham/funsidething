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
test('canonical mobile source profile admits exact current app without changing original story or full catalog',t=>{
 const fixture=canonicalSource(t),result=invoke(fixture.source);assert.equal(result.status,0,'Exact canonical app must reach the limited mobile boundary: '+result.stderr);assert.match(result.stdout,/Limited canonical source admitted/);
});

test('canonical limited profiles reject wrong source profile engine scenario control and full coverage',async t=>{
 const fixture=canonicalSource(t),profile=JSON.parse(fs.readFileSync(path.join(root,'scripts/mobile-source-profile.json')));
 for(const [name,args]of [
  ['desktop full run',['--engine','chromium','--motion','none','--scenario','full-native-actions']],
  ['wrong engine',['--engine','chromium']],['wrong scenario',['--scenario','rapid Add and context actions with 400 saved tasks']],
  ['sensitivity',['--control','pageerror']],['probe',['--probe']],
 ])await t.test(name,()=>{const result=invoke(fixture.source,args);assert.notEqual(result.status,0,name+' cannot use a limited profile');});
 for(const [name,mutate]of [['wrong profile ID',p=>p.id='other'],['changed asset',p=>p.applicationAssets['index.html']='0'.repeat(64)],['expanded scope',p=>p.allowedScopes.push({id:'full',engine:'chromium',scenario:'all',motions:[null]})],['changed original catalog',p=>p.originalInventorySha256='0'.repeat(64)]])await t.test(name,()=>{const next=structuredClone(profile);mutate(next);const file=path.join(fixture.directory,'profile.json');fs.writeFileSync(file,JSON.stringify(next));const result=invoke(fixture.source,['--profile',file]);assert.notEqual(result.status,0,name+' cannot be silently admitted');});
 await t.test('wrong source despite unchanged templates',()=>{fs.appendFileSync(fixture.source,'\n// different runtime source');assert.notEqual(invoke(fixture.source).status,0);});
});
test('confirmed modal source profile admits only its exact existing Chromium consumer',t=>{
 const fixture=canonicalSource(t),result=invoke(fixture.source,['--engine','chromium','--motion','none','--scenario','rapid scene time presets, lock, live time, and close']);assert.equal(result.status,0,result.stderr);const binding=JSON.parse(result.stdout.split('\n')[1]);assert.equal(binding.scope,'confirmed-modal-release');assert.match(binding.coverage,/no full native action coverage/);
});
test('native report verifier binds the complete actual source and refuses full-action relabeling',async t=>{
 const {verifyProfiledNativeReport}=await import('../mobile-source-profile.mjs');const fixture=canonicalSource(t),result=invoke(fixture.source);assert.equal(result.status,0,result.stderr);const binding=JSON.parse(result.stdout.split('\n')[1]),profile=JSON.parse(fs.readFileSync(path.join(root,'scripts/mobile-source-profile.json')));
 const report={kind:'button-mobile-functional',engine:'webkit',status:'passed',sourceProfile:binding,assets:profile.applicationAssets,scenarios:[{name:story}]};assert.equal(verifyProfiledNativeReport(report,{repo:root}).scope,'required-mobile-story','Source parser fixture only; no actual browser or functional acceptance');
 for(const [name,change]of [['missing binding',r=>delete r.sourceProfile],['different profile',r=>r.sourceProfile.profileSha256='0'.repeat(64)],['missing served asset',r=>delete r.assets['index.html']],['full native relabel',r=>r.kind='button-safety'],['different scenario',r=>r.scenarios[0].name='all native actions']])await t.test(name,()=>{const changed=structuredClone(report);change(changed);assert.throws(()=>verifyProfiledNativeReport(changed,{repo:root}));});
});
