import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  test, __dirname, loadApp, SYNC_STORE_KEY, LOCAL_HEAD_KEY, loadCloudBackendV2, syncTask, syncState,
  releaseGateGit, releaseGateHash, releaseGateReseal, makeReleaseGateFixture, releaseGateInput,
  cleanupReleaseGateFixture, riskBasedReleaseInput, testSurfaceSource, SCALED_REVIEW_POLICY_TEXT,
  makeScaledReviewFixture, scaledPlan, SCALED_FAQ_COVERAGE,
} from "./shared.js";

test('RISK repository process: Playwright waitForFunction predicates are synchronous',()=>{
 const source=testSurfaceSource();
 const asyncWaitCalls=[...source.matchAll(/\.waitForFunction\s*\(\s*async\b/g)].map(match=>source.slice(0,match.index).split('\n').length);
 assert.deepEqual(asyncWaitCalls,[],'waitForFunction predicates must be synchronous; await storage reads through a bounded Node probe. Found lines: '+asyncWaitCalls.join(', '));
});

test('RISK repository process: compatibility round trips preserve independently hashed production bytes',async t=>{
 const {assertRoundTrip}=await import('../scripts/backward-compatibility.mjs');
 const h=await loadCloudBackendV2({timeoutMs:5000});t.after(()=>h.CS.suspend());
 const payload=JSON.stringify({tasks:[{id:'compatibility-utf8',title:'Unicode 😀'}],futureOpaque:{retain:[1,2]}});
 await assertRoundTrip(h.CS,payload,0,'independent UTF8 compatibility');
 const root=h.docs.get('users/owner'),header=h.docs.get('users/owner/generations/'+root.activeGeneration);
 assert.equal(header.hash,createHash('sha256').update(payload,'utf8').digest('hex'));
});

test('RISK repository process: Beta packaging preserves exact committed product bytes and separate channel identity',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-name-pattern=preserves committed product bytes','scripts/agent-tools/channel-release.test.mjs'],{cwd:__dirname,encoding:'utf8',env,maxBuffer:4*1024*1024});
 assert.equal(result.status,0,result.stdout+result.stderr);
});

test('Repository test-first guard covers every app module and documents risk cases',()=>{
 const guard=fs.readFileSync(path.join(__dirname,'.claude/hooks/test-first-guard.sh'),'utf8');
 for(const pattern of ['*.html','*.js','*.mjs','*.css','*.webmanifest','*.svg','*.png'])
  assert.ok(guard.includes(pattern),`future runtime files of type ${pattern} must remain protected`);
 assert.match(guard,/scripts\/test-first-gate\.mjs/);
 assert.match(guard,/\.github\/workflows/);
 const policy=fs.readFileSync(path.join(__dirname,'CLAUDE.md'),'utf8');
 assert.match(policy,/risk-based/i);assert.match(policy,/red output/i);assert.match(policy,/full suite/i);
});

test('Repository CI gate requires changed tests and risk cases with app source diffs',async()=>{
 const {validateTestFirst}=await import('../scripts/test-first-gate.mjs');
 assert.deepEqual(validateTestFirst(['README.md'],[]),[]);
 assert.match(validateTestFirst(['landscape.css'],[])[0],/tests\//);
 assert.deepEqual(validateTestFirst(['landscape.css','tests/core.test.js'],['+test("visual regression",()=>{})']),[]);
 assert.match(validateTestFirst(['index.html','tests/core.test.js'],['+test("ordinary",()=>{})'])[0],/RISK/);
 assert.deepEqual(validateTestFirst(['index.html','tests/core.test.js'],['+test("RISK eligibility: boundary",()=>{})']),[]);
 const workflow=fs.readFileSync(path.join(__dirname,'.github/workflows/data-safety.yml'),'utf8');
 assert.match(workflow,/test-first-gate\.mjs/);
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const equivalent=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^test group runner reconciles complete full and grouped fixture cohorts$','scripts/agent-tools/test-groups.test.mjs'],{cwd:__dirname,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 assert.equal(equivalent.status,0,'The unchanged public full-suite command and all four isolated groups must execute the same fixture case IDs: '+equivalent.stdout+'\n'+equivalent.stderr);
 assert.match(equivalent.stdout,/^# tests 1$/m);assert.match(equivalent.stdout,/^# skipped 0$/m);
});

test('RISK repository process: npm test fails when an agent-tool cohort assertion fails',async t=>{
 const root=__dirname,os=await import('node:os');
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'funsidething-agent-tool-cohort-'));
 t.after(()=>fs.rmSync(fixture,{recursive:true,force:true}));
 const packageData=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 fs.writeFileSync(path.join(fixture,'package.json'),JSON.stringify(packageData));
 fs.writeFileSync(path.join(fixture,'tests.js'),"import { test } from 'node:test'; test('fixture baseline passes',()=>{});\n");
 const cohort=path.join(fixture,'scripts','agent-tools');fs.mkdirSync(cohort,{recursive:true});
 fs.writeFileSync(path.join(cohort,'synthetic-failure.test.mjs'),"import { test } from 'node:test'; import assert from 'node:assert/strict'; test('synthetic agent-tool assertion fails',()=>assert.equal('wrong','right','synthetic agent-tool cohort assertion failed'));\n");
 const env={...process.env,CI:'1',npm_config_audit:'false',npm_config_fund:'false',npm_config_update_notifier:'false'};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync('npm',['test'],{cwd:fixture,encoding:'utf8',timeout:30000,env});
 assert.equal(result.error,undefined,result.error?.message);
 const output=[result.stdout,result.stderr].filter(Boolean).join('\n');
 assert.notEqual(result.status,0,`npm test passed despite a failing agent-tool cohort:\n${output}`);
 assert.match(output,/synthetic agent-tool cohort assertion failed/);
});

test('RISK regression gate: changing existing tests requires a specific reason and replacement coverage',async()=>{
 const {validateRegressionChanges,protectedTestFingerprint}=await import('../scripts/test-first-gate.mjs');
 assert.equal(typeof validateRegressionChanges,'function','CI must protect existing feature tests');
 const diff=["- assert.equal(actual,expected,'existing feature');","+test('RISK replacement: preserve feature',()=>{});"];
 const record={testChangesSha256:protectedTestFingerprint(diff),reason:'The user explicitly requested a different motion model.',previousBehavior:'All reflected objects sway together across the water.',intendedBehavior:'Different patches move independently at the same depth.',replacementTests:['RISK replacement: preserve feature'],preservedCoverage:['Natural reflected height, sharpness, horizon contact and reduced motion.'],redEvidence:{command:"node --test --test-name-pattern='replacement' tests.js",failure:'Existing implementation failed because every patch moved together.'}};
 assert.match(validateRegressionChanges(diff,[]).join(' '),/reason|rationale/i,'deleting or changing assertions cannot silently pass');
 assert.deepEqual(validateRegressionChanges(diff,[record]),[],'a reviewed behavior change can replace obsolete expectations');
 assert.ok(validateRegressionChanges(diff,[{...record,testChangesSha256:'0'.repeat(64)}]).length,'earlier explanations cannot approve a different diff');
 assert.ok(validateRegressionChanges(diff,[{...record,reason:''}]).length);
 assert.ok(validateRegressionChanges(diff,[{...record,replacementTests:['Unrelated unchanged test']}]).length,'replacement must appear in this diff');
 assert.ok(validateRegressionChanges(diff,[{...record,redEvidence:{command:'',failure:''}}]).length,'record the discriminating red result');
 assert.ok(validateRegressionChanges(diff,[{...record,preservedCoverage:[]}]).length,'name the existing feature boundaries retained');
 assert.deepEqual(validateRegressionChanges(['--- a/tests.js','-   ','- // explanatory comment'],[]),[],'format-only blank/comment removals are harmless');
});

 test('RISK regression gate: insertions cannot silently disable existing assertions',async()=>{
  const {validateRegressionChanges,protectedTestFingerprint}=await import('../scripts/test-first-gate.mjs');
  assert.notEqual(protectedTestFingerprint(['@@ -12,0 +13 @@','+ return;'],40),protectedTestFingerprint(['@@ -22,0 +23 @@','+ return;'],40),'a reason for one test cannot authorize editing another');
  for(const line of ['+ return;','+ if(false){','+ /*']){
   assert.ok(validateRegressionChanges(['@@ -12,0 +13 @@',line],[],40).length,'add-only suppression within existing coverage needs a reason');
  }
  assert.ok(validateRegressionChanges(['@@ -40,0 +41 @@','+process.exit(0);'],[],40).length,'appended executable code cannot disable the suite');
 });

test('RISK regression gate: a rationale is required only for removed or weakened tests',async()=>{
 const {validateRegressionChanges}=await import('../scripts/test-first-gate.mjs');
 assert.deepEqual(validateRegressionChanges(['@@ -40,0 +41,3 @@',"+test('scan: empty board offers no candidate',()=>{",'+ assert.equal(rank([]).length,0);','+});'],[]),[],
  'an added test needs no rationale record');
 assert.deepEqual(validateRegressionChanges(['@@ -12,0 +13,2 @@','+ const second=rank(board)[1];',"+ assert.equal(second.title,'Dishes','extra boundary');"],[]),[],
  'extending an existing test with another assertion needs no rationale record');
 const needsRecord=(diff,why)=>assert.match(validateRegressionChanges(diff,[]).join(' '),/rationale/i,why);
 needsRecord(['@@ -12 +11,0 @@',"- assert.equal(second.title,'Dishes');"],'a deleted assertion needs a record');
 needsRecord(['@@ -12 +12 @@',"- assert.equal(second.title,'Dishes');",'+ assert.ok(second);'],'a weakened assertion needs a record');
 needsRecord(['@@ -10 +10 @@',"-test('RISK scan: old name',()=>{","+test('RISK scan: new name',()=>{"],'a renamed test needs a record');
 needsRecord(['@@ -10,3 +9,0 @@',"-test('scan: removed coverage',()=>{",'- assert.ok(rank(board).length);','-});'],'a removed test needs a record');
 // Pure insertions that stop existing assertions from running weaken them too.
 for(const line of ['+process.exit(0);','+ process.exitCode=0;','+ return;','+ if(false){','+ /*','+ */',"+ t.skip('later');","+ t.todo('later');"])
  needsRecord(['@@ -12,0 +13 @@',line],`suite-suppressing insertion ${line} needs a record`);
});

test('RISK regression gate: a rationale record bound to its weakened lines survives later test edits and merges',async()=>{
 const {validateRegressionChanges}=await import('../scripts/test-first-gate.mjs');
 const file=['--- a/tests/core.test.js','+++ b/tests/core.test.js'];
 const replacement=["@@ -40,0 +41 @@","+test('scan: second candidate keeps a title',()=>{ assert.ok(rank(board)[1].title); });"];
 const weakened=line=>[`@@ -${line} +${line} @@`,"- assert.equal(second.title,'Dishes');",'+ assert.ok(second);'];
 // The record names the weakened lines by file and content (#2233), not a hash
 // of the whole test diff with line numbers.
 const record={weakenedTestLines:["tests/core.test.js:-assert.equal(second.title,'Dishes');"],
  reason:'Second-candidate titles now come from the saved view, not a fixed list.',previousBehavior:'The second candidate was always titled Dishes in the fixture.',
  intendedBehavior:'The second candidate keeps whatever title the saved view gives it.',replacementTests:['scan: second candidate keeps a title'],
  preservedCoverage:['Candidate ranking order and the first candidate title are still asserted.'],
  redEvidence:{command:"node --test --test-name-pattern='second candidate' tests/core.test.js",failure:'AssertionError: expected Dishes, got Laundry before the change.'}};
 assert.deepEqual(validateRegressionChanges([...file,...weakened(12),...replacement],[record]),[],'the record approves its own weakening');
 assert.deepEqual(validateRegressionChanges([...file,...weakened(12),...replacement,'@@ -60,0 +62,2 @@',"+test('scan: empty board',()=>{","+});"],[record]),[],
  'adding another test later does not invalidate the record');
 assert.deepEqual(validateRegressionChanges([...file,...weakened(57),...replacement],[record]),[],
  'merging main shifts line numbers without invalidating the record');
 assert.match(validateRegressionChanges([...file,...weakened(12),...replacement,'@@ -80 +80 @@',"- assert.ok(rank(board).length);"],[record]).join(' '),/rationale/i,
  'a new weakening the record does not name is still rejected');
 assert.match(validateRegressionChanges([...file,...weakened(12),...replacement],[{...record,weakenedTestLines:["tests/scenery.test.js:-assert.equal(second.title,'Dishes');"]}]).join(' '),/rationale/i,
  'a record for another file cannot approve this weakening');
});

test('RISK test-first gate: a new RISK test is required only where saved data, the offline shell or enforcement can break',async()=>{
 const {validateTestFirst}=await import('../scripts/test-first-gate.mjs');
 const ordinary=['+test("scan: ordinary direct test",()=>{})'];
 for(const file of ['landscape.js','landscape-mood.js','location.js','stars.js'])
  assert.deepEqual(validateTestFirst([file,'tests/scenery.test.js'],ordinary),[],`${file}: scenery and location code needs a direct test, not a new RISK test`);
 for(const file of ['index.html','sw.js','manifest.webmanifest','device-store-v2.js','cloud-store-v2.js','app-release.js','firestore.rules','vendor/lz-string-1.5.0.min.js','sync-queue.js','auth-session.js','backup-archive.js'])
  assert.match(validateTestFirst([file,'tests/core.test.js'],ordinary).join(' '),/RISK/,`${file}: persistence, offline-shell and rules changes still need a new RISK test`);
 assert.match(validateTestFirst(['location.js'],[]).join(' '),/without a tests\/ file/,'every app change still needs a test');
});

test('RISK test-first gate: a scenery change with refreshed fingerprints needs only a direct test, end to end',()=>{
 const repo=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'gate-2233-'));
 try{
  const git=(...args)=>spawnSync('git',['-C',repo,...args],{encoding:'utf8'});
  git('init','-q','-b','main');git('config','user.email','t@example.com');git('config','user.name','t');
  const page=(fingerprint,entry,extra='')=>`<!doctype html>\n<body>\n${extra}<!-- changelog:start -->\n<template id="appChangelogCurrent"><div data-app-fingerprint="${fingerprint}"><ul>${entry}</ul></div></template>\n<!-- changelog:end -->\n</body>\n`;
  const worker=key=>`const CACHE_NAME = "chain-scanner-shell-${key}";\nself.addEventListener("install", () => {});\n`;
  const write=files=>{for(const [name,text] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(repo,name)),{recursive:true});fs.writeFileSync(path.join(repo,name),text);}};
  write({'index.html':page('a'.repeat(64),'<li>Old.</li>'),'sw.js':worker('1'.repeat(64)),'landscape.js':'const hue = 30;\n','tests/scenery.test.js':"test('sky: hue',()=>{});\n"});
  git('add','-A');git('commit','-qm','base');const base=git('rev-parse','HEAD').stdout.trim();
  const gate=()=>spawnSync(process.execPath,[path.join(__dirname,'scripts','test-first-gate.mjs'),base],{cwd:repo,encoding:'utf8'});
  // The scenery fix, its direct test, a changelog entry and both refreshed fingerprints.
  write({'landscape.js':'const hue = 32;\n','tests/scenery.test.js':"test('sky: hue',()=>{});\ntest('sky: dawn hue is 32',()=>{});\n",
   'index.html':page('b'.repeat(64),'<li>Warmer dawn.</li><li>Old.</li>'),'sw.js':worker('2'.repeat(64))});
  git('add','-A');git('commit','-qm','scenery');
  const scenery=gate();
  assert.equal(scenery.status,0,'changelog and fingerprint bookkeeping does not make a scenery fix high-risk: '+scenery.stderr);
  // Real page code still needs a new RISK test.
  write({'index.html':page('c'.repeat(64),'<li>Warmer dawn.</li><li>Old.</li>','<script>\nlocalStorage.clear();\n</script>\n')});
  git('add','-A');git('commit','-qm','page code');
  const pageCode=gate();
  assert.equal(pageCode.status,1,'a page code change still needs a new RISK test');
  assert.match(pageCode.stderr,/RISK/);
  // Changelog markup is injected into the page, so a handler there is code.
  git('reset','-q','--hard','HEAD~1');
  write({'index.html':page('d'.repeat(64),'<li>Warmer dawn.</li><li><img src=x onerror="localStorage.clear()">Old.</li>')});
  git('add','-A');git('commit','-qm','changelog handler');
  assert.equal(gate().status,1,'a changelog entry that runs code still needs a new RISK test');
  // Line numbers come from the merge-base, so the base side must be read there too.
  git('reset','-q','--hard','HEAD~1');
  git('checkout','-q','-b','side',base);write({'index.html':'<!-- side note -->\n'.repeat(3)+fs.readFileSync(path.join(repo,'index.html'),'utf8')});git('add','-A');git('commit','-qm','side');const side=git('rev-parse','HEAD').stdout.trim();
  git('checkout','-q','-b','diverged',base);
  write({'index.html':fs.readFileSync(path.join(repo,'index.html'),'utf8').replace('</body>\n',''),'tests/scenery.test.js':"test('sky: hue',()=>{});\ntest('sky: page closes',()=>{});\n"});
  git('add','-A');git('commit','-qm','markup removed after block');
  const diverged=spawnSync(process.execPath,[path.join(__dirname,'scripts','test-first-gate.mjs'),side],{cwd:repo,encoding:'utf8'});
  assert.equal(diverged.status,1,'markup outside the changelog block needs RISK even against a non-ancestor base');
 }finally{fs.rmSync(repo,{recursive:true,force:true});}
});

test('RISK regression gate: any covering record that validates approves the diff, and suppressors must be listed',async()=>{
 const {validateRegressionChanges}=await import('../scripts/test-first-gate.mjs');
 const file=['--- a/tests/core.test.js','+++ b/tests/core.test.js'];
 const diff=[...file,'@@ -12 +12 @@','- assert.ok(result);','+ assert.ok(result!==undefined);','@@ -40,0 +41 @@',"+test('scan: result shape stays defined',()=>{});"];
 const full={weakenedTestLines:['tests/core.test.js:-assert.ok(result);'],reason:'Result may now be a falsy empty array for an empty board.',previousBehavior:'Result was always a non-empty array.',
  intendedBehavior:'Result is defined, and may be empty for an empty board.',replacementTests:['scan: result shape stays defined'],preservedCoverage:['Ranking of non-empty boards is still asserted.'],
  redEvidence:{command:"node --test --test-name-pattern='result shape' tests/core.test.js",failure:'AssertionError: empty board returned [] and failed assert.ok.'}};
 const older={...full,replacementTests:['an older replacement test from a merged PR']};
 assert.deepEqual(validateRegressionChanges(diff,[older,full]),[],'an older record listing the same generic line does not shadow this diff\'s complete record');
 const suppressed=[...file,'@@ -12,0 +13 @@','+ return;','@@ -40,0 +41 @@',"+test('scan: result shape stays defined',()=>{});"];
 assert.match(validateRegressionChanges(suppressed,[full]).join(' '),/rationale/i,'an inserted return must itself be listed');
 assert.deepEqual(validateRegressionChanges(suppressed,[{...full,weakenedTestLines:['tests/core.test.js:+return;']}]),[],'a record listing the inserted return approves it');
 // Each listed line covers one weakening: identical lines repeat across tests.
 const twice=[...file,'@@ -12 +12 @@','- assert.ok(result);','+ assert.ok(result!==undefined);','@@ -90 +90 @@','- assert.ok(result);','+ assert.ok(result!==undefined);','@@ -140,0 +141 @@',"+test('scan: result shape stays defined',()=>{});"];
 assert.match(validateRegressionChanges(twice,[full]).join(' '),/rationale/i,'a line listed once cannot approve removing it from a second test');
 assert.deepEqual(validateRegressionChanges(twice,[{...full,weakenedTestLines:['tests/core.test.js:-assert.ok(result);','tests/core.test.js:-assert.ok(result);']}]),[],
  'listing the line twice approves both removals');
});

test('RISK test-first gate: tests stay required for app changes and new RISK tests only for high-risk or enforcement files',async()=>{
 const {validateTestFirst}=await import('../scripts/test-first-gate.mjs');
 const ordinary=['+test("scan: ordinary direct test",()=>{})'],processRisk=['+test("RISK test-first gate: process coverage",()=>{})'];
 assert.match(validateTestFirst(['location.js'],[]).join(' '),/without a tests\/ file/,'an app change without tests is rejected');
 assert.deepEqual(validateTestFirst(['landscape.css','tests/core.test.js'],ordinary),[],'a CSS-only change passes with a direct non-RISK test');
 assert.deepEqual(validateTestFirst(['icon-192.png','tests/core.test.js'],ordinary),[],'a static-asset change passes with a direct non-RISK test');
 assert.match(validateTestFirst(['device-store-v2.js','tests/core.test.js'],ordinary).join(' '),/RISK/,'a high-risk JS change without a new RISK test is rejected');
 assert.match(validateTestFirst(['scripts/test-first-gate.mjs','tests/core.test.js'],['+test("RISK landscape colors: dawn",()=>{})']).join(' '),/process/,
  'an enforcement change without process RISK coverage is rejected');
 assert.deepEqual(validateTestFirst(['scripts/test-first-gate.mjs','tests/core.test.js'],processRisk),[],'process RISK coverage satisfies an enforcement change');
});

test('RISK test-first gate: an app change paired with an edit to any split test file is accepted',async t=>{
 const {validateTestFirst,protectedTestFingerprint}=await import('../scripts/test-first-gate.mjs');
 const risk=['+test("RISK eligibility: boundary",()=>{})'];
 for(const file of ['tests/core.test.js','tests/scenery.test.js','tests/repository-process.test.js','tests/shared.js'])
  assert.deepEqual(validateTestFirst(['index.html',file],risk),[],`${file} is part of the test surface`);
 assert.deepEqual(validateTestFirst(['tests/core.test.js'],[]),[],'a test-only change is not an app change');
 assert.match(validateTestFirst(['index.html','docs/tests/notes.js'],risk).join(' '),/without a tests\/ file/,'only the top-level test directory counts');
 const edit=file=>[`--- a/${file}`,`+++ b/${file}`,'@@ -10 +10 @@','- assert.equal(value,1);','+ assert.equal(value,2);'];
 assert.notEqual(protectedTestFingerprint(edit('tests/core.test.js')),protectedTestFingerprint(edit('tests/scenery.test.js')),
  'a rationale for one split file cannot approve the same change in another file');
 // The CLI reads the whole test directory for RISK cases and weakened tests.
 const os=await import('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'chain-split-gate-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const write=(file,text)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);};
 write('scripts/test-first-gate.mjs',fs.readFileSync(path.join(__dirname,'scripts/test-first-gate.mjs'),'utf8'));
 write('index.html','<p>old</p>\n');write('tests/scenery.test.js',"test('scenery: sky',()=>{\n assert.ok(true);\n});\n");write('TEST_CHANGE_RATIONALES.json','[]\n');
 git('init','-q');git('config','user.email','gate@example.invalid');git('config','user.name','Gate fixture');git('add','.');git('commit','-qm','base');
 const base=git('rev-parse','HEAD');
 write('index.html','<p>new</p>\n');write('tests/core.test.js',"test('RISK eligibility: new boundary',()=>{});\n");git('add','.');git('commit','-qm','app change with a split test');
 const gate=()=>spawnSync(process.execPath,['scripts/test-first-gate.mjs',base],{cwd:root,encoding:'utf8'});
 const accepted=gate();
 assert.equal(accepted.status,0,'an app change with a new RISK test in a split file passes the CLI: '+accepted.stdout+accepted.stderr);
 write('tests/scenery.test.js',"test('scenery: sky',()=>{\n});\n");git('add','.');git('commit','-qm','weaken a split test');
 const weakened=gate();
 assert.equal(weakened.status,1,'a removed assertion in a split file still needs a rationale: '+weakened.stdout+weakened.stderr);
 assert.match(weakened.stderr,/without an exact-diff rationale/);
});

test('RISK test-first gate: a root tests.js is no longer a test file and adding or editing one is rejected',async t=>{
 const {validateTestFirst}=await import('../scripts/test-first-gate.mjs');
 const risk=['+test("RISK eligibility: boundary",()=>{})'];
 // npm test and the group runner no longer run tests.js (#2213), so a test
 // written there would protect nothing; the gate points at the port instead.
 for(const changed of [['index.html','tests.js'],['tests.js']]){
  const errors=validateTestFirst(changed,risk).join(' ');
  assert.match(errors,/tests\.js/,`${changed.join(', ')}: the root tests.js edit is named`);
  assert.match(errors,/tests\//,'the message points at the tests/ directory');
  assert.match(errors,/docs\/agents\/test-groups\.md/,'the message points at the porting note');
 }
 assert.match(validateTestFirst(['index.html','tests.js'],risk).join(' '),/without a tests\/ file/,'a root tests.js does not count as the test for an app change');
 // Comparing against a base from before the split, deleting tests.js is the move itself.
 assert.deepEqual(validateTestFirst(['index.html','tests.js','tests/core.test.js'],risk,['tests.js']),[],'deleting the old root tests.js is not an edit to it');
 const os=await import('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'chain-root-tests-gate-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 const write=(file,text)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);};
 write('scripts/test-first-gate.mjs',fs.readFileSync(path.join(__dirname,'scripts/test-first-gate.mjs'),'utf8'));
 write('index.html','<p>old</p>\n');write('tests.js',"test('scan: sky',()=>{\n assert.ok(true);\n});\n");write('TEST_CHANGE_RATIONALES.json','[]\n');
 git('init','-q');git('config','user.email','gate@example.invalid');git('config','user.name','Gate fixture');git('add','.');git('commit','-qm','old layout');
 const oldBase=git('rev-parse','HEAD');
 const gate=base=>spawnSync(process.execPath,['scripts/test-first-gate.mjs',base],{cwd:root,encoding:'utf8'});
 // This move drops the assertion, so it must still need a record.
 git('rm','-q','tests.js');write('tests/core.test.js',"test('scan: sky',()=>{\n});\n");git('add','.');git('commit','-qm','split');
 const split=gate(oldBase);
 assert.doesNotMatch(split.stderr,/test-groups\.md/,'deleting the root tests.js in the split is not rejected as an edit to it: '+split.stderr);
 assert.match(split.stderr,/without an exact-diff rationale/,'the deleted tests.js lines stay protected, so a weakened move still needs its record');
 const splitBase=git('rev-parse','HEAD');
 write('index.html','<p>new</p>\n');write('tests.js',"test('RISK eligibility: recreated root file',()=>{});\n");git('add','.');git('commit','-qm','recreate tests.js');
 const recreated=gate(splitBase);
 assert.equal(recreated.status,1,'a recreated root tests.js fails the CLI: '+recreated.stdout+recreated.stderr);
 assert.match(recreated.stderr,/docs\/agents\/test-groups\.md/);
});

test('RISK test-first gate: the edit hook treats the test directory as the test surface',async t=>{
 const os=await import('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'chain-split-hook-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 fs.mkdirSync(path.join(root,'tests'));fs.writeFileSync(path.join(root,'index.html'),'<p>old</p>\n');
 fs.writeFileSync(path.join(root,'tests/core.test.js'),"test('core: one',()=>{});\n");fs.writeFileSync(path.join(root,'tests/shared.js'),'export const one=1;\n');
 git('init','-q');git('config','user.email','hook@example.invalid');git('config','user.name','Hook fixture');git('add','.');git('commit','-qm','base');
 const hook=file=>{
  const r=spawnSync('bash',[path.join(__dirname,'.claude/hooks/test-first-guard.sh')],{input:JSON.stringify({tool_input:{file_path:path.join(root,file)}}),encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);return /"permissionDecision": "deny"/.test(r.stdout);
 };
 assert.equal(hook('index.html'),true,'an app edit with no test written is refused');
 assert.equal(hook('tests/core.test.js'),false,'writing a split test file is never refused');
 assert.equal(hook('tests/shared.js'),false,'writing the shared test helpers is never refused');
 fs.appendFileSync(path.join(root,'tests/core.test.js'),"test('core: two',()=>{});\n");
 assert.equal(hook('index.html'),false,'an uncommitted split test change lets the app edit through');
 git('add','tests/core.test.js');
 assert.equal(hook('index.html'),false,'a staged split test change also counts');
});

test('RISK test-first gate: the edit hook refuses a root tests.js and never counts it as a written test',async t=>{
 const os=await import('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'chain-root-tests-hook-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 fs.mkdirSync(path.join(root,'tests'));fs.writeFileSync(path.join(root,'index.html'),'<p>old</p>\n');
 fs.writeFileSync(path.join(root,'tests/core.test.js'),"test('core: one',()=>{});\n");fs.writeFileSync(path.join(root,'tests.js'),"test('legacy: one',()=>{});\n");
 git('init','-q');git('config','user.email','hook@example.invalid');git('config','user.name','Hook fixture');git('add','.');git('commit','-qm','base');
 const hook=file=>{
  const r=spawnSync('bash',[path.join(__dirname,'.claude/hooks/test-first-guard.sh')],{input:JSON.stringify({tool_input:{file_path:path.join(root,file)}}),encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);return r.stdout;
 };
 const refusal=hook('tests.js');
 assert.match(refusal,/"permissionDecision": "deny"/,'writing a root tests.js is refused: nothing runs it');
 assert.match(refusal,/tests\//,'the refusal points at the tests/ directory');
 assert.match(refusal,/docs\/agents\/test-groups\.md/,'the refusal points at the porting note');
 fs.appendFileSync(path.join(root,'tests.js'),"test('legacy: two',()=>{});\n");
 assert.match(hook('index.html'),/"permissionDecision": "deny"/,'an uncommitted root tests.js change does not let an app edit through');
 git('add','tests.js');
 assert.match(hook('index.html'),/"permissionDecision": "deny"/,'nor does a staged one');
});

test('RISK test-first gate: future runtime modules are detected without a filename allowlist',async()=>{
 const {validateTestFirst}=await import('../scripts/test-first-gate.mjs');
 const errors=validateTestFirst(['features/new-scan-rule.js'],[]).join(' ');
 assert.match(errors,/tests\//,'a new application module must not bypass the test-first diff gate');
});

test('RISK test-first gate: scanner, landscape, time, rules, and offline-shell edits need a new risk case',async()=>{
 const {validateTestFirst}=await import('../scripts/test-first-gate.mjs');
 const riskFiles=['index.html','sw.js','manifest.webmanifest','firestore.rules','device-store-v2.js','cloud-store-v2.js','app-release.js','features/new-page.html'];
 for(const file of riskFiles){
  const errors=validateTestFirst([file,'tests/core.test.js'],['+test("ordinary behavior test",()=>{})']).join(' ');
  assert.match(errors,/RISK/,`${file} must require a new high-risk contract`);
 }
});

test('RISK test-first gate: changing enforcement code requires process tests and a new risk case',async()=>{
 const {validateTestFirst}=await import('../scripts/test-first-gate.mjs');
 for(const file of ['scripts/test-first-gate.mjs','scripts/release-evidence.mjs','scripts/install-release-hook.mjs','scripts/test-groups.mjs','.claude/hooks/test-first-guard.sh','.github/workflows/data-safety.yml']){
  assert.match(validateTestFirst([file],[]).join(' '),/tests\//,`${file} must be covered by a process test`);
  assert.match(validateTestFirst([file,'tests/core.test.js'],['+test("ordinary behavior test",()=>{})']).join(' '),/RISK/,`${file} requires a risk-labeled process test`);
 }
});

test('RISK test-first gate: release evidence scripts receive edit-time process protection',async()=>{
 const {validateTestFirst}=await import('../scripts/test-first-gate.mjs');
 const hook=fs.readFileSync(path.join(__dirname,'.claude/hooks/test-first-guard.sh'),'utf8');
 for(const file of ['scripts/release-evidence.mjs','scripts/install-release-hook.mjs']){
  assert.match(validateTestFirst([file],[]).join(' '),/tests\//,'release enforcement edits need process tests');
  assert.ok(hook.includes(file),'release enforcement scripts need edit-time test-first protection');
 }
});

test('RISK test-first gate: unrelated risk cases cannot approve enforcement edits',async()=>{
 const {validateTestFirst}=await import('../scripts/test-first-gate.mjs');
 const unrelated=['+test("RISK landscape colors: dawn hue stays warm",()=>{})'];
 for(const file of ['scripts/test-first-gate.mjs','scripts/release-evidence.mjs','scripts/install-release-hook.mjs','.claude/hooks/test-first-guard.sh','.github/workflows/data-safety.yml']){
  assert.match(validateTestFirst([file,'tests/core.test.js'],unrelated).join(' '),/process/i,
   `${file} needs a risk-labeled process test rather than an unrelated risk case`);
 }
});

test('RISK test-first gate: initial branch pushes cannot skip the diff comparison',()=>{
 const result=spawnSync(process.execPath,[path.join(__dirname,'scripts/test-first-gate.mjs'),'0'.repeat(40)],{cwd:__dirname,encoding:'utf8'});
 assert.equal(result.status,2,`an all-zero base must fail closed; received ${result.status}: ${result.stdout}`);
 assert.match(result.stderr,/base|compare|resolve/i);
 const workflow=fs.readFileSync(path.join(__dirname,'.github/workflows/data-safety.yml'),'utf8');
 assert.match(workflow,/git merge-base origin\/main/i,'branch creation must compare against the existing default branch');
});

test('RISK repository process: review policy derives code and specialist roles from the exact diff',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 assert.equal(typeof deriveReleaseReviewPlan,'function','the release gate must expose its exact-diff policy classifier');
 const docs=makeReleaseGateFixture({changedPath:'README.md',baseText:'Old setup note.\n',candidateText:'Clearer setup note.\n'});
 const ordinary=makeReleaseGateFixture({changedPath:'src/landscape.mjs'});
 const cloud=makeReleaseGateFixture({changedPath:'src/cloud-sync.mjs'});
 const rules=makeReleaseGateFixture({changedPath:'firestore.rules'});
 const callable=makeReleaseGateFixture({changedPath:'src/handlers.mjs',
  baseText:'exports.limit = https.onCall((request) => checkOwner(request));\n',
  candidateText:'exports.limit = https.onCall((request) => checkTeam(request));\n'});
 const inlineStorage=makeReleaseGateFixture({changedPath:'index.html',
  baseText:"localStorage.setItem('board', 1);\n",candidateText:"localStorage.setItem('board', 2);\n"});
 const inlineAuth=makeReleaseGateFixture({changedPath:'index.html',
  baseText:'firebase.auth().signInAnonymously();\n',candidateText:'firebase.auth().signInWithPopup();\n'});
 const cssSelector=makeReleaseGateFixture({changedPath:'styles.css',
  baseText:'#status { color: red; }\n',candidateText:'#status { color: blue; }\n'});
 const policyComment=makeReleaseGateFixture({changedPath:'tools/release-evidence.mjs',
  baseText:'// old release-gate explanation\n',candidateText:'// clarified release-gate explanation\n'});
 const templateCode=makeReleaseGateFixture({changedPath:'src/landscape.mjs',
  baseText:'eval(`\n// oldBehavior();\n`);\n',candidateText:'eval(`\n// newBehavior();\n`);\n'});
 const blockComments=makeReleaseGateFixture({changedPath:'src/landscape.mjs',
  baseText:'/* old explanation\n * unchanged second line\n */\nconst value = 1;\n',
  candidateText:'/* revised explanation\n * unchanged second line\n */\nconst value = 1;\n'});
 const addedComment=makeReleaseGateFixture({changedPath:'src/landscape.mjs',
  baseText:'const value = 1;\n',candidateText:'// explains the existing value\nconst value = 1;\n'});
 const comments=makeReleaseGateFixture({changedPath:'src/landscape.mjs',baseText:'// old explanation\n',candidateText:'// clearer explanation\n'});
 try{
  const plan=(fixture)=>deriveReleaseReviewPlan(fixture.repo,fixture.candidateSha,fixture.baseSha);
  assert.deepEqual(plan(docs),{schemaVersion:1,changedFiles:['README.md'],mode:'owner-self-review',
   requiresCodeReview:false,requiresSpecialistReview:false,specialistDomains:[]});
  assert.equal(plan(ordinary).mode,'independent-review');
  assert.equal(plan(ordinary).requiresCodeReview,true);
  assert.equal(plan(ordinary).requiresSpecialistReview,false);
  assert.deepEqual(plan(cloud).specialistDomains,['memory-cloud-sync']);
  assert.equal(plan(cloud).mode,'dual-review','a cloud behavior change affects code and specialist domains');
  assert.deepEqual(plan(rules).specialistDomains,['memory-cloud-sync','security-deployment']);
  assert.equal(plan(rules).requiresCodeReview,true);
  assert.equal(plan(rules).requiresSpecialistReview,true);
  assert.deepEqual(plan(callable).specialistDomains,['security-deployment'],
   'callable endpoint behavior receives its security specialist even in a generic source file');
  assert.equal(plan(callable).mode,'dual-review');
  assert.deepEqual(plan(inlineStorage).specialistDomains,['memory-cloud-sync'],
   'central app files still classify changed persisted-data lines as high risk');
  assert.deepEqual(plan(inlineAuth).specialistDomains,['security-deployment'],
   'central app files still classify changed authentication lines as high risk');
  assert.equal(plan(cssSelector).mode,'independent-review',
   'a CSS ID selector beginning with # is executable styling, not a shell comment');
  assert.deepEqual(plan(policyComment).specialistDomains,['release-process'],
   'comment-only edits to release-gate policy remain specialist scoped');
  assert.equal(plan(policyComment).requiresCodeReview,true,
   'release-gate tooling is never downgraded by comment syntax');
  assert.equal(plan(templateCode).mode,'independent-review',
   'comment-shaped lines inside executable template strings are not JavaScript comments');
  assert.equal(plan(blockComments).mode,'owner-self-review',
   'a valid multiline block-comment edit with unchanged code stays owner-only');
  assert.equal(plan(addedComment).mode,'owner-self-review',
   'adding an unambiguous standalone comment without changing code stays owner-only');
  assert.equal(plan(comments).mode,'owner-self-review','comment-only edits do not become behavior reviews');
 }finally{
  for(const fixture of [docs,ordinary,cloud,rules,callable,inlineStorage,inlineAuth,cssSelector,policyComment,templateCode,blockComments,addedComment,comments])cleanupReleaseGateFixture(fixture);
 }
});

test('RISK repository process: a generic role guard requires a security specialist',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const roleGuard=makeReleaseGateFixture({changedPath:'src/guards.mjs',
  baseText:'export function canEnter(role) { return role === "owner"; }\n',
  candidateText:'export function canEnter(role) { return true; }\n'});
 try{
  assert.deepEqual(deriveReleaseReviewPlan(roleGuard.repo,roleGuard.candidateSha,roleGuard.baseSha).specialistDomains,
   ['security-deployment'],
   'removing a generic role check fails closed to a security specialist without auth-named paths');
 }finally{cleanupReleaseGateFixture(roleGuard);}
});

test('RISK repository process: generic state persistence requires a memory specialist',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const genericPersistence=makeReleaseGateFixture({changedPath:'src/repository.mjs',
  baseText:'export function saveState(state) { return adapter.write(state); }\n',
  candidateText:'export function saveState(state) { return adapter.clear(state); }\n'});
 const genericPersistedMutation=makeReleaseGateFixture({changedPath:'src/repository.mjs',
  baseText:'export function replaceTasks(state) { return adapter.write({...state,tasks:state.tasks}); }\n',
  candidateText:'export function replaceTasks(state) { return adapter.write({...state,tasks:[]}); }\n'});
 const genericRemove=makeReleaseGateFixture({changedPath:'src/repository.mjs',
  baseText:'export function replaceTasks(state) { return adapter.remove({...state,tasks:state.tasks}); }\n',
  candidateText:'export function replaceTasks(state) { return adapter.remove({...state,tasks:[]}); }\n'});
 const genericClear=makeReleaseGateFixture({changedPath:'src/repository.mjs',
  baseText:'export function replaceTasks(state) { return adapter.clear({...state,tasks:state.tasks}); }\n',
  candidateText:'export function replaceTasks(state) { return adapter.clear({...state,tasks:[]}); }\n'});
 try{
  assert.deepEqual(deriveReleaseReviewPlan(genericPersistence.repo,genericPersistence.candidateSha,genericPersistence.baseSha).specialistDomains,
   ['memory-cloud-sync'],
   'generic state persistence changes receive a data-safety specialist without storage-named paths');
  assert.deepEqual(deriveReleaseReviewPlan(genericPersistedMutation.repo,genericPersistedMutation.candidateSha,genericPersistedMutation.baseSha).specialistDomains,
   ['memory-cloud-sync'],
   'mutating an adapter-written persisted record fails closed to a data-safety specialist');
  assert.deepEqual({
   remove:deriveReleaseReviewPlan(genericRemove.repo,genericRemove.candidateSha,genericRemove.baseSha).specialistDomains,
   clear:deriveReleaseReviewPlan(genericClear.repo,genericClear.candidateSha,genericClear.baseSha).specialistDomains,
  },{
   remove:['memory-cloud-sync'],
   clear:['memory-cloud-sync'],
  },'adapter remove and clear operations that mutate persisted records fail closed to a data-safety specialist');
 }finally{
  cleanupReleaseGateFixture(genericPersistence);
  cleanupReleaseGateFixture(genericPersistedMutation);
  cleanupReleaseGateFixture(genericRemove);
  cleanupReleaseGateFixture(genericClear);
 }
});

test('RISK repository process: persisting generic sessions requires both affected specialists',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const persistedSession=makeReleaseGateFixture({changedPath:'src/current-context.mjs',
  baseText:'export function saveSession(session) { return adapter.write(session); }\n',
  candidateText:'export function saveSession(session) { return adapter.remove(session); }\n'});
 try{
  assert.deepEqual(deriveReleaseReviewPlan(persistedSession.repo,persistedSession.candidateSha,persistedSession.baseSha).specialistDomains,
   ['memory-cloud-sync','shared-session-state'],
   'generic session persistence requires both data-safety and shared-session specialists');
 }finally{cleanupReleaseGateFixture(persistedSession);}
});

test('RISK repository process: TypeScript tooling directives cannot use comment-only exemption',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const typecheckDirective=makeReleaseGateFixture({changedPath:'src/types.ts',
  baseText:'const value: number = 1;\n',candidateText:'// @ts-nocheck\nconst value: number = 1;\n'});
 const typecheckEnabled=makeReleaseGateFixture({changedPath:'src/legacy.js',
  baseText:'const value = 1;\n',candidateText:'// @ts-check\nconst value = 1;\n'});
 try{
  assert.equal(deriveReleaseReviewPlan(typecheckDirective.repo,typecheckDirective.candidateSha,typecheckDirective.baseSha).mode,'independent-review',
   'a behavior-changing TypeScript directive is never exempted as a comment-only edit');
  assert.equal(deriveReleaseReviewPlan(typecheckEnabled.repo,typecheckEnabled.candidateSha,typecheckEnabled.baseSha).mode,'independent-review',
   'enabling JavaScript type checking is a tooling change and cannot be owner-only');
 }finally{
  cleanupReleaseGateFixture(typecheckDirective);
  cleanupReleaseGateFixture(typecheckEnabled);
 }
});

test('RISK repository process: CSS comment removal cannot join selector tokens under owner-only review',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const cssTokenJoin=makeReleaseGateFixture({changedPath:'styles.css',
  baseText:'a b { color: red; }\n',candidateText:'a/**/b { color: red; }\n'});
 try{
  assert.equal(deriveReleaseReviewPlan(cssTokenJoin.repo,cssTokenJoin.candidateSha,cssTokenJoin.baseSha).mode,'independent-review',
   'removing a CSS comment that joins selector tokens is executable behavior');
 }finally{cleanupReleaseGateFixture(cssTokenJoin);}
});

// Release preparation (#2296) runs the real command with its working directory
// in a fixture repository and git's repository-locating variables removed, so
// neither the commands nor the fixture can reach this checkout.
function releaseCommand(fixture,...args){
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 for(const name of Object.keys(env))if(name.startsWith('GIT_'))delete env[name];
 return spawnSync(process.execPath,[path.join(__dirname,'scripts/release-evidence.mjs'),...args],{cwd:fixture.repo,encoding:'utf8',timeout:30000,env});
}

test('RISK repository process: release plan prints the review plan the validator derives for a commit',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const fixture=makeScaledReviewFixture({candidate:{'src/cloud-sync.mjs':'export const value = 2;\n'}});
 try{
  const printed=releaseCommand(fixture,'plan',fixture.candidateSha,fixture.baseSha);
  assert.equal(printed.status,0,printed.stdout+printed.stderr);
  const plan=JSON.parse(printed.stdout);
  assert.deepEqual(plan,{schemaVersion:2,changedFiles:['src/cloud-sync.mjs'],mode:'dual-review',
   requiresCodeReview:true,requiresFaqReview:false,requiresOwnerFaqCoverage:true,requiresSpecialistReview:true,
   requiresTypographyReview:false,specialistDomains:['memory-cloud-sync']});
  assert.deepEqual(plan,deriveReleaseReviewPlan(fixture.repo,fixture.candidateSha,fixture.baseSha));
 }finally{cleanupReleaseGateFixture(fixture);}
});

const releaseReportHeader=(commit,verdict,completed)=>`Commit: ${commit}\nVerdict: ${verdict}\nCompleted: ${completed}\n\n`;
function writeReleaseReports(fixture,reports){
 const directory=path.join(fixture.root,'reports');
 fs.mkdirSync(directory,{recursive:true});
 for(const [name,text] of Object.entries(reports))fs.writeFileSync(path.join(directory,name),text);
 return directory;
}
const sha256Of=text=>createHash('sha256').update(text).digest('hex');

test('RISK repository process: release prepare writes receipt input that record accepts once a person adds the summaries',()=>{
 const fixture=makeScaledReviewFixture({candidate:{'scripts/tool.mjs':'export const value = 2;\n'}});
 try{
  const owner=releaseReportHeader(fixture.candidateSha,'approved','2026-11-01T12:00:33.000Z')+'The owner read the exact diff.\n';
  const independent=releaseReportHeader(fixture.candidateSha,'approved','2026-11-01T11:53:58.000Z')+'The reviewer read the exact diff.\n';
  const reports=writeReleaseReports(fixture,{'owner-review.md':owner,'independent-review.md':independent});
  const prepared=releaseCommand(fixture,'prepare',fixture.candidateSha,fixture.baseSha,reports,'2296');
  assert.equal(prepared.status,0,prepared.stdout+prepared.stderr);
  const inputPath=path.join(reports,'receipt-input.json');
  const input=JSON.parse(fs.readFileSync(inputPath,'utf8'));
  assert.deepEqual(input,{
   schemaVersion:2,
   candidate:{commitSha:fixture.candidateSha,treeSha:fixture.treeSha,baseSha:fixture.baseSha},
   ownerReview:{task:'owner:2296',outcome:'approved',reviewedSha:fixture.candidateSha,completedAt:'2026-11-01T12:00:33.000Z',
    summary:'',scope:{fullDiff:true,rationale:''},
    evidencePath:path.join(reports,'owner-review.md'),evidenceSha256:sha256Of(owner)},
   independentReview:{task:'independent-review:2296',outcome:'approved',reviewedSha:fixture.candidateSha,completedAt:'2026-11-01T11:53:58.000Z',
    summary:'',scope:{fullDiff:true,relevantTests:true,userVisibleAndDataSafety:true},
    evidencePath:path.join(reports,'independent-review.md'),evidenceSha256:sha256Of(independent)},
  });
  const unauthored=releaseCommand(fixture,'record',inputPath);
  assert.notEqual(unauthored.status,0,'an input nobody has summarized must not become a receipt');
  assert.match(unauthored.stderr,/summary/i);
  input.ownerReview.summary='The owner read every line of the exact candidate diff.';
  input.ownerReview.scope.rationale='An ordinary tooling change fits the derived independent review.';
  input.independentReview.summary='The reviewer read the full diff and its tests and found no defect.';
  fs.writeFileSync(inputPath,JSON.stringify(input,null,2)+'\n');
  const recorded=releaseCommand(fixture,'record',inputPath);
  assert.equal(recorded.status,0,recorded.stdout+recorded.stderr);
  const verified=releaseCommand(fixture,'verify',fixture.candidateSha);
  assert.equal(verified.status,0,verified.stdout+verified.stderr);
 }finally{cleanupReleaseGateFixture(fixture);}
});

// Prepares an ordinary tooling candidate whose owner report is fine and whose
// independent report is the one under test.
function prepareWithIndependentReport(independentReport){
 const fixture=makeScaledReviewFixture({candidate:{'scripts/tool.mjs':'export const value = 2;\n'}});
 const owner=releaseReportHeader(fixture.candidateSha,'approved','2026-11-01T12:00:33.000Z')+'The owner read the exact diff.\n';
 const reports=writeReleaseReports(fixture,{'owner-review.md':owner,'independent-review.md':independentReport(fixture)});
 const result=releaseCommand(fixture,'prepare',fixture.candidateSha,fixture.baseSha,reports,'2296');
 const inputWritten=fs.existsSync(path.join(reports,'receipt-input.json'));
 cleanupReleaseGateFixture(fixture);
 return {result,inputWritten};
}

test('RISK repository process: release prepare refuses a report naming another commit',()=>{
 const {result,inputWritten}=prepareWithIndependentReport(fixture=>
  releaseReportHeader(fixture.baseSha,'approved','2026-11-01T11:53:58.000Z')+'A review of the previous commit.\n');
 assert.notEqual(result.status,0,'a review of another commit cannot approve this candidate');
 assert.match(result.stderr,/independent-review\.md.*names commit/i);
 assert.equal(inputWritten,false);
});

test('RISK repository process: release prepare refuses a report with no approved verdict',()=>{
 const missing=prepareWithIndependentReport(fixture=>`Commit: ${fixture.candidateSha}\nCompleted: 2026-11-01T11:53:58.000Z\n\nNo verdict line.\n`);
 assert.notEqual(missing.result.status,0,'a report without a verdict cannot approve this candidate');
 assert.match(missing.result.stderr,/independent-review\.md.*Verdict/);
 assert.equal(missing.inputWritten,false);
 const blocked=prepareWithIndependentReport(fixture=>releaseReportHeader(fixture.candidateSha,'changes-requested','2026-11-01T11:53:58.000Z'));
 assert.notEqual(blocked.result.status,0,'a report that asks for changes cannot approve this candidate');
 assert.match(blocked.result.stderr,/independent-review\.md.*changes-requested/);
 assert.equal(blocked.inputWritten,false);
});

test('RISK repository process: release prepare refuses a report with a missing or future completion time',()=>{
 const missing=prepareWithIndependentReport(fixture=>`Commit: ${fixture.candidateSha}\nVerdict: approved\n\nNo completion time.\n`);
 assert.notEqual(missing.result.status,0,'a report without a completion time cannot supply the receipt time');
 assert.match(missing.result.stderr,/independent-review\.md.*Completed/);
 assert.equal(missing.inputWritten,false);
 const future=prepareWithIndependentReport(fixture=>releaseReportHeader(fixture.candidateSha,'approved',new Date(Date.now()+3600000).toISOString()));
 assert.notEqual(future.result.status,0,'a future completion time cannot enter an immutable receipt');
 assert.match(future.result.stderr,/independent-review\.md.*future/);
 assert.equal(future.inputWritten,false);
});

test('RISK repository process: release prepare needs only the reports the derived plan requires',()=>{
 const fixture=makeScaledReviewFixture({candidate:{'docs/notes.md':'Updated notes.\n'}});
 try{
  const owner=releaseReportHeader(fixture.candidateSha,'approved','2026-11-01T12:00:33.000Z')+'The owner read the exact diff.\n';
  const reports=writeReleaseReports(fixture,{'owner-review.md':owner});
  const prepared=releaseCommand(fixture,'prepare',fixture.candidateSha,fixture.baseSha,reports,'2296');
  assert.equal(prepared.status,0,prepared.stdout+prepared.stderr);
  const inputPath=path.join(reports,'receipt-input.json');
  const input=JSON.parse(fs.readFileSync(inputPath,'utf8'));
  assert.deepEqual(Object.keys(input),['schemaVersion','candidate','ownerReview']);
  input.ownerReview.summary='The owner read every line of the exact candidate diff.';
  input.ownerReview.scope.rationale='A documentation-only diff needs only the owner review.';
  fs.writeFileSync(inputPath,JSON.stringify(input,null,2)+'\n');
  const recorded=releaseCommand(fixture,'record',inputPath);
  assert.equal(recorded.status,0,recorded.stdout+recorded.stderr);
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: release prepare takes specialist domains from the plan and source digests from the exact commit',()=>{
 const candidateText='export const cloudValue = 2;\n';
 const fixture=makeScaledReviewFixture({candidate:{'scripts/cloud-sync.mjs':candidateText}});
 try{
  const header=completed=>releaseReportHeader(fixture.candidateSha,'approved',completed)+'The review of the exact diff.\n';
  const specialist=header('2026-11-01T12:05:26.000Z');
  const reports=writeReleaseReports(fixture,{'owner-review.md':header('2026-11-01T12:00:33.000Z'),'independent-review.md':header('2026-11-01T11:53:58.000Z')});
  const inputPath=path.join(reports,'receipt-input.json');
  const absent=releaseCommand(fixture,'prepare',fixture.candidateSha,fixture.baseSha,reports,'2296');
  assert.notEqual(absent.status,0,'the plan requires a specialist, so its report cannot be absent');
  assert.match(absent.stderr,/specialist-review\.md/);
  assert.equal(fs.existsSync(inputPath),false);

  writeReleaseReports(fixture,{'specialist-review.md':specialist});
  const prepared=releaseCommand(fixture,'prepare',fixture.candidateSha,fixture.baseSha,reports,'2296');
  assert.equal(prepared.status,0,prepared.stdout+prepared.stderr);
  const input=JSON.parse(fs.readFileSync(inputPath,'utf8'));
  const unassessed={affected:null,rationale:'',tests:[]};
  assert.deepEqual(input.specialistReview,{task:'specialist-review:2296',outcome:'approved',reviewedSha:fixture.candidateSha,
   completedAt:'2026-11-01T12:05:26.000Z',summary:'',domains:['memory-cloud-sync'],
   scope:{fullDiff:true,relevantTests:true,userVisibleAndDataSafety:true},
   memoryScope:{memory:unassessed,cloud:unassessed,sync:unassessed},
   sources:[{path:path.join(fs.realpathSync(fixture.repo),'scripts/cloud-sync.mjs'),sha256:sha256Of(candidateText)}],
   evidencePath:path.join(reports,'specialist-review.md'),evidenceSha256:sha256Of(specialist)});
  input.ownerReview.summary='The owner read every line of the exact candidate diff.';
  input.ownerReview.scope.rationale='A cloud tooling change fits the derived code and specialist reviews.';
  input.independentReview.summary='The reviewer read the full diff and its tests and found no defect.';
  input.specialistReview.summary='The specialist read the full diff and found no cloud or sync defect.';
  fs.writeFileSync(inputPath,JSON.stringify(input,null,2)+'\n');
  const unjudged=releaseCommand(fixture,'record',inputPath);
  assert.notEqual(unjudged.status,0,'memory, cloud and sync impact stay a judgement made by a person');
  assert.match(unjudged.stderr,/memoryScope/);
  const assessed=area=>({affected:false,rationale:`This candidate does not change ${area} behaviour.`,tests:['RISK focused preservation test']});
  input.specialistReview.memoryScope={memory:assessed('memory'),cloud:assessed('cloud'),sync:assessed('sync')};
  fs.writeFileSync(inputPath,JSON.stringify(input,null,2)+'\n');
  const recorded=releaseCommand(fixture,'record',inputPath);
  assert.equal(recorded.status,0,recorded.stdout+recorded.stderr);
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: release prepare refuses a source file that differs from the exact commit',()=>{
 const fixture=makeScaledReviewFixture({candidate:{'scripts/cloud-sync.mjs':'export const cloudValue = 2;\n'}});
 try{
  const header=completed=>releaseReportHeader(fixture.candidateSha,'approved',completed)+'The review of the exact diff.\n';
  const reports=writeReleaseReports(fixture,{'owner-review.md':header('2026-11-01T12:00:33.000Z'),
   'independent-review.md':header('2026-11-01T11:53:58.000Z'),'specialist-review.md':header('2026-11-01T12:05:26.000Z')});
  fs.writeFileSync(path.join(fixture.repo,'scripts/cloud-sync.mjs'),'export const cloudValue = 3;\n');
  const prepared=releaseCommand(fixture,'prepare',fixture.candidateSha,fixture.baseSha,reports,'2296');
  assert.notEqual(prepared.status,0,'a digest of the commit cannot be paired with different bytes on disk');
  assert.match(prepared.stderr,/scripts\/cloud-sync\.mjs/);
  assert.equal(fs.existsSync(path.join(reports,'receipt-input.json')),false);
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: release prepare leaves FAQ coverage for a person to author on a product change',()=>{
 const fixture=makeScaledReviewFixture({candidate:{'src/feature.mjs':'export const value = 2;\n'}});
 try{
  const header=completed=>releaseReportHeader(fixture.candidateSha,'approved',completed)+'The review of the exact diff.\n';
  const reports=writeReleaseReports(fixture,{'owner-review.md':header('2026-11-01T12:00:33.000Z'),'independent-review.md':header('2026-11-01T11:53:58.000Z')});
  const prepared=releaseCommand(fixture,'prepare',fixture.candidateSha,fixture.baseSha,reports,'2296');
  assert.equal(prepared.status,0,prepared.stdout+prepared.stderr);
  const inputPath=path.join(reports,'receipt-input.json');
  const input=JSON.parse(fs.readFileSync(inputPath,'utf8'));
  assert.deepEqual(input.ownerReview.faqCoverage,{result:'',summary:''});
  input.ownerReview.summary='The owner read every line of the exact candidate diff.';
  input.ownerReview.scope.rationale='An ordinary product change fits the derived independent review.';
  input.independentReview.summary='The reviewer read the full diff and its tests and found no defect.';
  fs.writeFileSync(inputPath,JSON.stringify(input,null,2)+'\n');
  const unauthored=releaseCommand(fixture,'record',inputPath);
  assert.notEqual(unauthored.status,0,'FAQ coverage stays a result a person records');
  assert.match(unauthored.stderr,/FAQ coverage/);
  input.ownerReview.faqCoverage=SCALED_FAQ_COVERAGE;
  fs.writeFileSync(inputPath,JSON.stringify(input,null,2)+'\n');
  const recorded=releaseCommand(fixture,'record',inputPath);
  assert.equal(recorded.status,0,recorded.stdout+recorded.stderr);
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: release recording classifies the tail of a complete large diff',async t=>{
 const makeFixture=options=>{
  const fixture=makeReleaseGateFixture(options);
  fs.writeFileSync(path.join(fixture.repo,'package.json'),JSON.stringify({private:true,type:'module',scripts:{
   'release:record':'node scripts/release-evidence.mjs record',
   'release:verify':'node scripts/release-evidence.mjs verify'
  }}));
  fs.copyFileSync(path.join(__dirname,'scripts/release-evidence.mjs'),path.join(fixture.repo,'scripts/release-evidence.mjs'));
  const inputPath=path.join(fixture.root,'release-input.json');
  fs.writeFileSync(inputPath,JSON.stringify(riskBasedReleaseInput(fixture,{domains:['security-deployment']}),null,2)+'\n');
  return { ...fixture,inputPath,receiptPath:path.join(fixture.repo,'.git','funsidething-release-evidence',fixture.candidateSha,'receipt.json') };
 };
 const env={...process.env,npm_config_audit:'false',npm_config_fund:'false',npm_config_update_notifier:'false'};delete env.NODE_TEST_CONTEXT;
 const run=(fixture,command,args)=>spawnSync('npm',['run',command,'--',...args],{
  cwd:fixture.repo,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,
  env
 });
 const control=makeFixture({changedPath:'scripts/test-group-inventory.json',baseText:'{"ordinary":"old"}\n',
  candidateText:'{"permissionBoundary":"requires security review"}\n'});
 const neutralPayload='x'.repeat(2*1024*1024);
 const candidateText=JSON.stringify({ordinary:neutralPayload,permissionBoundary:'requires security review'})+'\n';
 const oversized=makeFixture({changedPath:'scripts/test-group-inventory.json',baseText:'{"ordinary":"old"}\n',candidateText});
 try{
  const controlResult=spawnSync('npm',['run','release:record','--',control.inputPath],{
   cwd:control.repo,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,env
  });
  const controlOutput=[controlResult.stdout,controlResult.stderr].filter(Boolean).join('\n');
  assert.equal(controlResult.error,undefined,controlResult.error?.message||controlOutput);
  assert.equal(controlResult.signal,null,controlOutput);
  assert.equal(controlResult.status,0,'a valid small-diff public release:record control must pass before the large-diff probe:\n'+controlOutput);
  const controlReceipt=JSON.parse(fs.readFileSync(control.receiptPath,'utf8'));
  assert.deepEqual(controlReceipt.reviewPlan.specialistDomains,['security-deployment'],
   'the small public process control proves the receipt input and classification assertion are valid');

  const completeDiff=spawnSync('git',['-C',oversized.repo,'diff','--unified=2',oversized.baseSha,oversized.candidateSha,'--',oversized.changedPath],{
   encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024
  });
  assert.equal(completeDiff.error,undefined,completeDiff.error?.message);
  assert.equal(completeDiff.status,0,completeDiff.stderr);
  assert.ok(Buffer.byteLength(completeDiff.stdout)>1024*1024,'the exact fixture patch exceeds Node execFileSync default output capacity');
  assert.match(completeDiff.stdout.slice(-1024),/permissionBoundary.*security review/,
   'the only security classification marker remains at the complete patch tail');
  t.diagnostic(JSON.stringify({fixtureDiffBytes:Buffer.byteLength(completeDiff.stdout),tail:completeDiff.stdout.slice(-160)}));

  const recorded=run(oversized,'release:record',[oversized.inputPath]);
  const output=[recorded.stdout,recorded.stderr].filter(Boolean).join('\n');
  assert.equal(recorded.error,undefined,recorded.error?.message||output);
  assert.equal(recorded.signal,null,output);
  assert.equal(recorded.status,0,'public release:record must process the complete oversized diff:\n'+output);
  const receipt=JSON.parse(fs.readFileSync(oversized.receiptPath,'utf8'));
  assert.deepEqual(receipt.reviewPlan.specialistDomains,['security-deployment'],
   'the complete diff tail must still require its security specialist');
  assert.equal(receipt.reviewPlan.mode,'dual-review');
  const verified=run(oversized,'release:verify',[oversized.candidateSha]);
  assert.equal(verified.error,undefined,verified.error?.message);
  assert.equal(verified.signal,null,[verified.stdout,verified.stderr].filter(Boolean).join('\n'));
  assert.equal(verified.status,0,[verified.stdout,verified.stderr].filter(Boolean).join('\n'));
 }finally{cleanupReleaseGateFixture(control);cleanupReleaseGateFixture(oversized);}
});

test('RISK repository process: risk-based receipts require the derived exact-final reviewer roles',async()=>{
 const {recordReleaseEvidence,verifyReleaseEvidence}=await import('../scripts/release-evidence.mjs');
 const docs=makeReleaseGateFixture({changedPath:'README.md',baseText:'Old copy.\n',candidateText:'Updated copy.\n'});
 const ordinary=makeReleaseGateFixture({changedPath:'src/landscape.mjs'});
 const cloud=makeReleaseGateFixture({changedPath:'src/cloud-sync.mjs'});
 try{
  const docsReceipt=recordReleaseEvidence(docs.repo,riskBasedReleaseInput(docs,{codeReview:false,specialistReview:false}));
  assert.equal(docsReceipt.receipt.reviewPlan.mode,'owner-self-review');
  assert.equal(verifyReleaseEvidence(docs.repo,docs.candidateSha).ok,true,
   'pure documentation needs only the owner exact-diff review');
  assert.throws(()=>recordReleaseEvidence(ordinary.repo,
   riskBasedReleaseInput(ordinary,{codeReview:false,specialistReview:false})),/code|independent|review/i,
   'a caller cannot classify changed code as owner-only');
  const ordinaryReceipt=recordReleaseEvidence(ordinary.repo,
   riskBasedReleaseInput(ordinary,{specialistReview:false}));
  assert.equal(ordinaryReceipt.receipt.reviewPlan.mode,'independent-review');
  assert.equal(verifyReleaseEvidence(ordinary.repo,ordinary.candidateSha).ok,true,
   'ordinary behavior needs exactly one independent reviewer');
  assert.throws(()=>recordReleaseEvidence(cloud.repo,
   riskBasedReleaseInput(cloud,{specialistReview:false})),/specialist|domain|review/i,
   'high-risk cloud behavior cannot omit its specialist');
  assert.throws(()=>recordReleaseEvidence(cloud.repo,
   riskBasedReleaseInput(cloud,{domains:['security-deployment']})),/domain|classification|specialist/i,
   'a specialist receipt cannot substitute an unrelated risk domain');
  const cloudReceipt=recordReleaseEvidence(cloud.repo,riskBasedReleaseInput(cloud));
  assert.equal(cloudReceipt.receipt.reviewPlan.mode,'dual-review');
  assert.notEqual(cloudReceipt.receipt.independentReview.task,cloudReceipt.receipt.specialistReview.task,
   'code and specialist reviews must be independent task identities');
  assert.equal(verifyReleaseEvidence(cloud.repo,cloud.candidateSha).ok,true);
  const tampered=JSON.parse(fs.readFileSync(cloudReceipt.receiptPath,'utf8'));
  tampered.reviewPlan={schemaVersion:1,changedFiles:['src/cloud-sync.mjs'],mode:'owner-self-review',
   requiresCodeReview:false,requiresSpecialistReview:false,specialistDomains:[]};
  releaseGateReseal(tampered);
  fs.writeFileSync(cloudReceipt.receiptPath,JSON.stringify(tampered,null,2)+'\n');
  const rejected=verifyReleaseEvidence(cloud.repo,cloud.candidateSha);
  assert.equal(rejected.ok,false,'a checksum-valid low-risk classification cannot authorize a high-risk exact diff');
  assert.match(rejected.errors.join(' '),/classification|review plan|risk/i);
 }finally{
  for(const fixture of [docs,ordinary,cloud])cleanupReleaseGateFixture(fixture);
 }
});

test('RISK repository process: caller-declared specialist domains can only raise the derived plan',async()=>{
 const {deriveReleaseReviewPlan,recordReleaseEvidence}=await import('../scripts/release-evidence.mjs');
 const roleGuard=makeReleaseGateFixture({changedPath:'src/guards.mjs',
  baseText:'export function canEnter(role) { return role === "owner"; }\n',
  candidateText:'export function canEnter(role) { return true; }\n'});
 try{
  const derived=deriveReleaseReviewPlan(roleGuard.repo,roleGuard.candidateSha,roleGuard.baseSha);
  assert.deepEqual(derived.specialistDomains,['security-deployment'],
   'the source-derived security domain remains mandatory even when a caller supplies an empty escalation list');
  assert.throws(()=>recordReleaseEvidence(roleGuard.repo,
   riskBasedReleaseInput(roleGuard,{specialistReview:false,input:{additionalSpecialistDomains:[]}})),
   /specialist|review/i,'an empty caller declaration cannot remove an automatically derived specialist requirement');
 }finally{cleanupReleaseGateFixture(roleGuard);}
});

test('RISK repository process: caller-declared specialist domains raise and bind the exact review plan',async()=>{
 const {recordReleaseEvidence,verifyReleaseEvidence}=await import('../scripts/release-evidence.mjs');
 const escalation=makeReleaseGateFixture({changedPath:'src/opaque.mjs'});
 try{
  const input=riskBasedReleaseInput(escalation,{domains:['security-deployment'],
   input:{additionalSpecialistDomains:['security-deployment']}});
  const recorded=recordReleaseEvidence(escalation.repo,input);
  assert.deepEqual(recorded.receipt.additionalSpecialistDomains,['security-deployment'],
   'caller-declared specialist scope is bound into the exact receipt');
  assert.deepEqual(recorded.receipt.reviewPlan.specialistDomains,['security-deployment'],
   'caller declarations may raise the derived plan for an otherwise ordinary code change');
  assert.equal(verifyReleaseEvidence(escalation.repo,escalation.candidateSha).ok,true,
   'a checksum-bound caller escalation remains verifiable against the exact diff');
 }finally{cleanupReleaseGateFixture(escalation);}
});

test('RISK repository process: caller-declared specialist domains reject unknown values',async()=>{
 const {recordReleaseEvidence}=await import('../scripts/release-evidence.mjs');
 const fixture=makeReleaseGateFixture({changedPath:'src/landscape.mjs'});
 try{
  assert.throws(()=>recordReleaseEvidence(fixture.repo,
   riskBasedReleaseInput(fixture,{specialistReview:false,input:{additionalSpecialistDomains:['unrecognized-domain']}})),
   /domain|allowed|recognized/i,'caller escalation accepts only known specialist domains');
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: exact-SHA receipts bind audit and review evidence outside the git tree',async()=>{
 const {recordReleaseEvidence,verifyReleaseEvidence}=await import('../scripts/release-evidence.mjs');
 const fixture=makeReleaseGateFixture();
 try{
  const recorded=recordReleaseEvidence(fixture.repo,releaseGateInput(fixture));
  assert.equal(recorded.receipt.candidate.commitSha,fixture.candidateSha);
  assert.equal(recorded.receipt.candidate.treeSha,fixture.treeSha);
  assert.equal(recorded.receipt.candidate.baseSha,fixture.baseSha);
  assert.deepEqual(Object.keys(recorded.receipt.memoryAudit.scope).sort(),['cloud','memory','sync'],
   'the exact-SHA memory review receipt records each data-safety domain');
  assert.equal(recorded.receipt.memoryAudit.scope.cloud.affected,false,
   'a pure release-gate fixture can record a justified cloud no-impact assessment');
  assert.equal(verifyReleaseEvidence(fixture.repo,fixture.candidateSha).ok,true);
  const common=releaseGateGit(fixture.repo,['rev-parse','--path-format=absolute','--git-common-dir']);
  assert.ok(recorded.receiptPath.startsWith(path.join(common,'funsidething-release-evidence')+path.sep),
   'evidence must remain in git metadata outside the committed tree');
  assert.ok(!releaseGateGit(fixture.repo,['ls-tree','-r','--name-only',fixture.candidateSha]).includes('funsidething-release-evidence'),
   'release evidence must never be committed into the candidate tree');
  fs.writeFileSync(fixture.sourcePath,'An unrelated memory note was added after this audit.\n');
  assert.equal(verifyReleaseEvidence(fixture.repo,fixture.candidateSha).ok,true,
   'later changes to an audited source do not rewrite historical evidence for this exact candidate');
  fs.appendFileSync(path.join(path.dirname(recorded.receiptPath),'memory-audit.md'),'tampered\n');
  assert.equal(verifyReleaseEvidence(fixture.repo,fixture.candidateSha).ok,false,
   'editing the recorded audit evidence invalidates its digest');
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: memory cloud and sync review scope scales evidence to impact',async()=>{
 const {recordReleaseEvidence,verifyReleaseEvidence}=await import('../scripts/release-evidence.mjs');
 const fixture=makeReleaseGateFixture();
 const affectedFixture=makeReleaseGateFixture();
 try{
  const baseScope=releaseGateInput(fixture).memoryAudit.scope;
  const missing=releaseGateInput(fixture,{memoryAudit:{scope:undefined}});
  assert.throws(()=>recordReleaseEvidence(fixture.repo,missing),/scope|memory|cloud|sync/i,
   'the existing memory audit role must explicitly assess all three data-safety domains');
  const noImpact=releaseGateInput(fixture,{memoryAudit:{scope:{
   memory:{affected:false,rationale:'This candidate changes no behavior that reads or writes saved memory.',tests:[]},
   cloud:{affected:false,rationale:'This candidate does not change cloud documents, accounts, or ownership.',tests:[]},
   sync:{affected:false,rationale:'This candidate does not change synchronization or reconciliation paths.',tests:[]}
  }}});
  const noImpactReceipt=recordReleaseEvidence(fixture.repo,noImpact);
  assert.deepEqual(noImpactReceipt.receipt.memoryAudit.scope,noImpact.memoryAudit.scope,
   'pure copy or UI changes retain explicit, justified no-impact decisions without requiring unrelated cloud tests');
  assert.equal(verifyReleaseEvidence(fixture.repo,fixture.candidateSha).ok,true);

  const affectedScope=structuredClone(baseScope);
  affectedScope.memory={affected:true,rationale:'This candidate changes persisted rating data during hydration and normalization.',tests:[]};
  assert.throws(()=>recordReleaseEvidence(affectedFixture.repo,
   releaseGateInput(affectedFixture,{memoryAudit:{scope:affectedScope}})),/test|evidence|scope|affected/i,
   'an affected data-safety domain needs focused test evidence');
  affectedScope.memory.tests=['RISK rating bounds: hydration and frozen chance opponents normalize extremes without changing healthy ratings'];
  const affectedReceipt=recordReleaseEvidence(affectedFixture.repo,
   releaseGateInput(affectedFixture,{memoryAudit:{scope:affectedScope}}));
  assert.equal(affectedReceipt.receipt.memoryAudit.scope.memory.affected,true);
  assert.equal(verifyReleaseEvidence(affectedFixture.repo,affectedFixture.candidateSha).ok,true,
   'risk-based affected review evidence is preserved and verifiable on the exact candidate');
 }finally{
  cleanupReleaseGateFixture(fixture);
  cleanupReleaseGateFixture(affectedFixture);
 }
});

test('RISK repository process: schema-v2 specialist scope accepts unaffected assessments with preservation evidence',async()=>{
 const {recordReleaseEvidence,verifyReleaseEvidence}=await import('../scripts/release-evidence.mjs');
 const fixture=makeReleaseGateFixture({changedPath:'src/cloud-sync.mjs'});
 const noEvidence=makeReleaseGateFixture({changedPath:'src/cloud-sync.mjs'});
 const affectedNoEvidence=makeReleaseGateFixture({changedPath:'src/cloud-sync.mjs'});
 try{
  const memoryScope={
   memory:{affected:false,rationale:'The fixture changes no saved-board bytes, recovery records, or local restore behavior.',
    tests:['RISK LOCAL BACKUPS: exhausted quota leaves the original index and unsaved board untouched']},
   cloud:{affected:false,rationale:'The fixture does not alter cloud documents, serialization, rules, accounts, or compatibility.',
    tests:['RISK BACKWARD COMPATIBILITY: released clients and candidate interoperate across both rule versions']},
   sync:{affected:false,rationale:'The fixture does not alter sync ordering, reconciliation, or acknowledgement behavior.',
    tests:['RISK PWA SYNC RESUME: reopening drains interrupted reads and writes before one fresh reconciliation']}
  };
  const validInput=riskBasedReleaseInput(fixture,{input:{specialistReview:{memoryScope}}});
  const noTestsScope=structuredClone(memoryScope);
  for(const entry of Object.values(noTestsScope))entry.tests=[];
  assert.throws(()=>recordReleaseEvidence(noEvidence.repo,
   riskBasedReleaseInput(noEvidence,{input:{specialistReview:{memoryScope:noTestsScope}}})),
   /focused test|preservation test|assessed domains/i,
   'an all-unaffected specialist scope still needs focused preservation evidence');
  const affectedScope=structuredClone(memoryScope);
  affectedScope.memory={...affectedScope.memory,affected:true,tests:[]};
  assert.throws(()=>recordReleaseEvidence(affectedNoEvidence.repo,
   riskBasedReleaseInput(affectedNoEvidence,{input:{specialistReview:{memoryScope:affectedScope}}})),
   /affected.*test|focused test/i,
   'every affected memory, cloud, or sync domain still needs its own focused tests');

  const invalidInputs=[
   riskBasedReleaseInput(fixture,{input:{specialistReview:{reviewedSha:fixture.baseSha}}}),
   riskBasedReleaseInput(fixture,{input:{specialistReview:{domains:['security-deployment']}}}),
   riskBasedReleaseInput(fixture,{input:{specialistReview:{sources:[{path:fixture.sourcePath,sha256:'0'.repeat(64)}]}}}),
   riskBasedReleaseInput(fixture,{input:{specialistReview:{evidenceSha256:'0'.repeat(64)}}}),
   riskBasedReleaseInput(fixture,{input:{specialistReview:{task:'/root/exact-code-review'}}})
  ];
  for(const input of invalidInputs)assert.throws(()=>recordReleaseEvidence(fixture.repo,input),
   /sha|domain|source|fingerprint|identit|distinct|evidence/i,
   'scope evidence cannot weaken exact-SHA, derived-domain, source, evidence, or reviewer-identity checks');

  const recorded=recordReleaseEvidence(fixture.repo,validInput);
  assert.deepEqual(recorded.receipt.reviewPlan.specialistDomains,['memory-cloud-sync']);
  assert.deepEqual(recorded.receipt.specialistReview.memoryScope,memoryScope,
   'the recorder preserves all-false domain decisions and their focused preservation tests');
  assert.equal(verifyReleaseEvidence(fixture.repo,fixture.candidateSha).ok,true,
   'an all-unaffected assessment with focused preservation evidence records and verifies');

  for(const scope of [noTestsScope,affectedScope]){
   const tampered=JSON.parse(fs.readFileSync(recorded.receiptPath,'utf8'));
   tampered.specialistReview.memoryScope=scope;
   releaseGateReseal(tampered);
   fs.writeFileSync(recorded.receiptPath,JSON.stringify(tampered,null,2)+'\n');
   const verified=verifyReleaseEvidence(fixture.repo,fixture.candidateSha);
   assert.equal(verified.ok,false,'verification must reject a checksum-valid scope without required preservation evidence');
   assert.match(verified.errors.join(' '),/focused test|affected.*test|preservation/i);
  }
 }finally{
  for(const item of [fixture,noEvidence,affectedNoEvidence])cleanupReleaseGateFixture(item);
 }
});

test('RISK repository process: absent, stale, malformed, or nonindependent receipts fail closed',async()=>{
 const {recordReleaseEvidence,verifyReleaseEvidence}=await import('../scripts/release-evidence.mjs');
 const fixture=makeReleaseGateFixture();
 try{
  assert.equal(verifyReleaseEvidence(fixture.repo,fixture.candidateSha).ok,false,'a missing receipt blocks the candidate');
  const invalid=[
   releaseGateInput(fixture,{candidate:{commitSha:fixture.baseSha}}),
   releaseGateInput(fixture,{ownerTask:'/root/memory-auditor'}),
   releaseGateInput(fixture,{independentReview:{task:'/root/memory-auditor'}}),
   releaseGateInput(fixture,{memoryAudit:{sources:[]}}),
   releaseGateInput(fixture,{independentReview:{reviewedSha:fixture.baseSha}}),
   releaseGateInput(fixture,{independentReview:{scope:{fullDiff:true,relevantTests:false,userVisibleAndDataSafety:true}}})
  ];
  for(const input of invalid)assert.throws(()=>recordReleaseEvidence(fixture.repo,input),
   /receipt|sha|identity|source|review|scope|candidate/i,'invalid release evidence must never become a receipt');
  const recorded=recordReleaseEvidence(fixture.repo,releaseGateInput(fixture));
  fs.writeFileSync(recorded.receiptPath,'{ malformed');
  assert.equal(verifyReleaseEvidence(fixture.repo,fixture.candidateSha).ok,false,'malformed evidence cannot authorize a push');
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: memory receipts require absolute source paths',async()=>{
 const {recordReleaseEvidence,verifyReleaseEvidence}=await import('../scripts/release-evidence.mjs');
 const fixture=makeReleaseGateFixture();
 try{
  const relative=path.relative(process.cwd(),fixture.sourcePath);
  const invalid=releaseGateInput(fixture,{memoryAudit:{sources:[{path:relative,sha256:releaseGateHash(fixture.sourcePath)}]}});
  assert.throws(()=>recordReleaseEvidence(fixture.repo,invalid),/absolute/i,
   'relative source paths must not be accepted by resolving them from an incidental current directory');
  const recorded=recordReleaseEvidence(fixture.repo,releaseGateInput(fixture));
  const receipt=JSON.parse(fs.readFileSync(recorded.receiptPath,'utf8'));
  receipt.memoryAudit.sources[0].path=relative;
  releaseGateReseal(receipt);
  fs.writeFileSync(recorded.receiptPath,JSON.stringify(receipt,null,2)+'\n');
  const verified=verifyReleaseEvidence(fixture.repo,fixture.candidateSha);
  assert.equal(verified.ok,false,'a checksum-valid but nonabsolute source must not authorize the candidate');
  assert.match(verified.errors.join(' '),/absolute/i);
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: release evidence rejects future and noncanonical audit timestamps',async()=>{
 const {recordReleaseEvidence,verifyReleaseEvidence}=await import('../scripts/release-evidence.mjs');
 const fixture=makeReleaseGateFixture();
 try{
  const future=new Date(Date.now()+60_000).toISOString();
  const noncanonical=new Date(Date.now()-60_000).toISOString().replace(/\.\d{3}Z$/,'Z');
  for(const [field,time] of [['memoryAudit',future],['independentReview',future],
   ['memoryAudit',noncanonical],['independentReview',noncanonical]]){
   assert.throws(()=>recordReleaseEvidence(fixture.repo,releaseGateInput(fixture,{[field]:{completedAt:time}})),
    /time|timestamp|future|canonical/i,`${field} must reject ${time}`);
  }

  const recorded=recordReleaseEvidence(fixture.repo,releaseGateInput(fixture));
  const original=JSON.parse(fs.readFileSync(recorded.receiptPath,'utf8'));
  for(const [field,time] of [['memoryAudit',future],['independentReview',future],
   ['memoryAudit',noncanonical],['independentReview',noncanonical]]){
   const receipt=structuredClone(original);
   receipt[field].completedAt=time;
   releaseGateReseal(receipt);
   fs.writeFileSync(recorded.receiptPath,JSON.stringify(receipt,null,2)+'\n');
   const verified=verifyReleaseEvidence(fixture.repo,fixture.candidateSha);
   assert.equal(verified.ok,false,`verification must reject ${field} timestamp ${time}`);
   assert.match(verified.errors.join(' '),/time|timestamp|future|canonical/i);
  }
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: pre-push checks every outgoing tip and rejects dirty worktrees',async()=>{
 const {recordReleaseEvidence,validatePrePushUpdates}=await import('../scripts/release-evidence.mjs');
 const fixture=makeReleaseGateFixture();
 try{
  recordReleaseEvidence(fixture.repo,releaseGateInput(fixture));
  const deletion={localRef:'refs/heads/old',localSha:'0'.repeat(40),remoteRef:'refs/heads/old',remoteSha:fixture.candidateSha};
  const candidate={localRef:'refs/heads/release',localSha:fixture.candidateSha,remoteRef:'refs/heads/main',remoteSha:'0'.repeat(40)};
  assert.deepEqual(validatePrePushUpdates(fixture.repo,[candidate,deletion]),[]);
  fs.writeFileSync(path.join(fixture.repo,'uncommitted-draft.txt'),'not in the reviewed tree');
  assert.match(validatePrePushUpdates(fixture.repo,[candidate]).join(' '),/clean/i,
   'local changes cannot be confused with the reviewed immutable commit');
  fs.rmSync(path.join(fixture.repo,'uncommitted-draft.txt'));
  fs.writeFileSync(path.join(fixture.repo,'app.js'),'const value = 3;\n');
  releaseGateGit(fixture.repo,['commit','-am','Add a second outgoing commit']);
  const newerTip=releaseGateGit(fixture.repo,['rev-parse','HEAD']);
  const errors=validatePrePushUpdates(fixture.repo,[candidate,{...candidate,localRef:'refs/heads/second',localSha:newerTip}]);
  assert.match(errors.join(' '),/receipt|exact|evidence/i,'each distinct outgoing commit tip needs its own receipt');
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: pre-push lets branch pushes run CI before review and still guards main',async()=>{
 const {validatePrePushUpdates}=await import('../scripts/release-evidence.mjs');
 const fixture=makeReleaseGateFixture();
 try{
  // No receipt exists for this commit and the worktree is dirty.
  fs.writeFileSync(path.join(fixture.repo,'uncommitted-draft.txt'),'work in progress');
  const branch={localRef:'refs/heads/fix/2234',localSha:fixture.candidateSha,remoteRef:'refs/heads/fix/2234',remoteSha:'0'.repeat(40)};
  assert.deepEqual(validatePrePushUpdates(fixture.repo,[branch]),[],
   'a work branch can be pushed for CI before its reviews exist (#2234)');
  const main={...branch,remoteRef:'refs/heads/main'};
  const errors=validatePrePushUpdates(fixture.repo,[branch,main]).join(' ');
  assert.match(errors,/clean/i,'a push to main still requires a clean worktree');
  assert.match(errors,/refs\/heads\/fix\/2234 at [0-9a-f]{40}: .*(receipt|evidence)/i,'a push to main still requires an exact-SHA receipt');
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: pre-push command accepts a branch push and says no receipt was checked',()=>{
 const fixture=makeReleaseGateFixture();
 try{
  // The real hook runs this command; a crash here blocks every push.
  const line=`refs/heads/fix/2234 ${fixture.candidateSha} refs/heads/fix/2234 ${'0'.repeat(40)}\n`;
  const run=spawnSync(process.execPath,[path.join(__dirname,'scripts','release-evidence.mjs'),'pre-push'],{cwd:fixture.repo,input:line,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout,/No push to refs\/heads\/main; no release receipt checked/);
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: status publication needs a valid exact-SHA receipt',async()=>{
 const {recordReleaseEvidence,publishReleaseStatuses}=await import('../scripts/release-evidence.mjs');
 const fixture=makeReleaseGateFixture();
 try{
  const calls=[];
  await assert.rejects(()=>publishReleaseStatuses(fixture.repo,fixture.candidateSha,
   async status=>calls.push(status)),/receipt|evidence/i);
  assert.equal(calls.length,0,'status publication cannot invent missing clearance');
  const recorded=recordReleaseEvidence(fixture.repo,releaseGateInput(fixture));
  await publishReleaseStatuses(fixture.repo,fixture.candidateSha,async status=>calls.push(status));
  assert.deepEqual(calls.map(status=>status.context).sort(),
   ['funsidething/independent-review','funsidething/memory-audit','funsidething/specialist-review'],
   'schema-v1 publication includes the compatibility context required by current branch protection');
  assert.ok(calls.every(status=>status.state==='success'&&status.description.includes(recorded.receipt.receiptSha256)));
  assert.ok(calls.every(status=>status.commitSha===fixture.candidateSha&&status.baseSha===fixture.baseSha));
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: risk-based statuses bind required roles and keep legacy receipts valid',async()=>{
 const {recordReleaseEvidence,publishReleaseStatuses,verifyDeploymentEvidence}=await import('../scripts/release-evidence.mjs');
 const docs=makeReleaseGateFixture({changedPath:'README.md',baseText:'Old note.\n',candidateText:'Updated note.\n'});
 const ordinary=makeReleaseGateFixture({changedPath:'src/landscape.mjs'});
 const mainSha='c'.repeat(40);
 const deployment=(fixture,statuses)=>async input=>{
  const pathname=new URL(typeof input==='string'?input:input.url).pathname;
  let body;
  if(pathname.endsWith('/commits/'+mainSha+'/pulls'))body=[{number:31,state:'closed',merged_at:'2026-09-29T12:00:00Z',
   merge_commit_sha:mainSha,head:{sha:fixture.candidateSha},base:{ref:'main'}}];
  else if(pathname.endsWith('/commits/'+mainSha))body={sha:mainSha,commit:{tree:{sha:fixture.treeSha}},parents:[{sha:fixture.baseSha}]};
  else if(pathname.endsWith('/commits/'+fixture.candidateSha))body={sha:fixture.candidateSha,commit:{tree:{sha:fixture.treeSha}}};
  else if(pathname.endsWith('/compare/'+fixture.baseSha+'...'+fixture.candidateSha))body={status:'ahead'};
  else if(pathname.endsWith('/commits/'+fixture.candidateSha+'/statuses'))body=statuses.map((status,index)=>
   ({...status,created_at:`2026-09-29T12:0${index}:00Z`}));
  else throw new Error('Unexpected GitHub API request: '+pathname);
  return {ok:true,status:200,json:async()=>body};
 };
 try{
  recordReleaseEvidence(docs.repo,riskBasedReleaseInput(docs,{codeReview:false,specialistReview:false}));
  const docsStatuses=[];
  await publishReleaseStatuses(docs.repo,docs.candidateSha,async status=>docsStatuses.push(status));
  assert.deepEqual(docsStatuses.map(status=>status.context).sort(),[
   'funsidething/independent-review','funsidething/memory-audit','funsidething/specialist-review'],
   'existing required contexts remain published alongside the conditional specialist context');
  assert.ok(docsStatuses.every(status=>status.state==='success'&&/;c=0;s=0;v=2$/.test(status.description)),
   'self-reviewed documentation marks both optional independent roles as not required');
  assert.equal((await verifyDeploymentEvidence({repository:'emerald-pham/funsidething',deployedSha:mainSha,
   beforeSha:docs.baseSha,token:'test-token',fetchImpl:deployment(docs,docsStatuses)})).ok,true,
   'deployment accepts owner-only evidence only when the exact receipt policy marks external reviews not required');

  recordReleaseEvidence(ordinary.repo,riskBasedReleaseInput(ordinary,{specialistReview:false}));
  const ordinaryStatuses=[];
  await publishReleaseStatuses(ordinary.repo,ordinary.candidateSha,async status=>ordinaryStatuses.push(status));
  const codeStatus=ordinaryStatuses.find(status=>status.context==='funsidething/independent-review');
  const specialistStatus=ordinaryStatuses.find(status=>status.context==='funsidething/specialist-review');
  assert.match(codeStatus.description,/;c=1;s=0;v=2$/);
  assert.match(specialistStatus.description,/;c=1;s=0;v=2$/);
  assert.equal((await verifyDeploymentEvidence({repository:'emerald-pham/funsidething',deployedSha:mainSha,
   beforeSha:ordinary.baseSha,token:'test-token',fetchImpl:deployment(ordinary,ordinaryStatuses)})).ok,true,
   'deployment requires the code reviewer but accepts the unneeded specialist role');
  const misbound=ordinaryStatuses.map(status=>status.context==='funsidething/specialist-review'
   ?{...status,description:status.description.replace(';s=0;v=2',';s=1;v=2')}:status);
  assert.equal((await verifyDeploymentEvidence({repository:'emerald-pham/funsidething',deployedSha:mainSha,
   beforeSha:ordinary.baseSha,token:'test-token',fetchImpl:deployment(ordinary,misbound)})).ok,false,
   'status contexts cannot overstate or disagree about the exact review plan');
 }finally{
  cleanupReleaseGateFixture(docs);
  cleanupReleaseGateFixture(ordinary);
 }
});

test('RISK repository process: main deployment requires the merged reviewed head, full tree parity, and latest statuses',async()=>{
 const {verifyDeploymentEvidence}=await import('../scripts/release-evidence.mjs');
 const fixture=makeReleaseGateFixture();
 const mainSha='a'.repeat(40),receiptHash='b'.repeat(64);
 try{
  const api=async options=>async input=>{
   const url=new URL(typeof input==='string'?input:input.url);
   const pathname=url.pathname;
   let body;
   if(pathname.endsWith('/commits/'+mainSha+'/pulls'))body=options.merged?[{number:23,state:'closed',merged_at:'2026-09-28T21:00:00Z',merge_commit_sha:mainSha,head:{sha:fixture.candidateSha},base:{ref:'main'}}]:[];
   else if(pathname.endsWith('/commits/'+mainSha))body={sha:mainSha,commit:{tree:{sha:options.tree||fixture.treeSha}},parents:[{sha:fixture.baseSha}]};
   else if(pathname.endsWith('/commits/'+fixture.candidateSha))body={sha:fixture.candidateSha,commit:{tree:{sha:fixture.treeSha}}};
   else if(pathname.endsWith('/compare/'+fixture.baseSha+'...'+fixture.candidateSha))body={status:options.compare||'ahead'};
   else if(pathname.endsWith('/commits/'+fixture.candidateSha+'/statuses'))body=options.reviewStatuses||[
   {context:'funsidething/memory-audit',state:'success',description:'receipt-sha256='+receiptHash+';base='+fixture.baseSha,created_at:'2026-09-28T21:02:00Z'},
    {context:'funsidething/independent-review',state:'success',description:'receipt-sha256='+receiptHash+';base='+fixture.baseSha,created_at:'2026-09-28T21:03:00Z'},
    {context:'funsidething/specialist-review',state:'success',description:'receipt-sha256='+receiptHash+';base='+fixture.baseSha,created_at:'2026-09-28T21:03:30Z'}];
   else throw new Error('Unexpected GitHub API request: '+pathname);
   return {ok:true,status:200,json:async()=>body};
  };
  const verify=fetchImpl=>verifyDeploymentEvidence({repository:'emerald-pham/funsidething',deployedSha:mainSha,
   beforeSha:fixture.baseSha,token:'test-token',fetchImpl});
  const good=await verify(await api({merged:true}));
  assert.equal(good.ok,true,good.errors.join('\n'));
  assert.equal((await verify(await api({merged:true,tree:'c'.repeat(40)}))).ok,false,
   'a different full tree cannot authorize deployment');
  assert.equal((await verify(await api({merged:true,compare:'diverged'}))).ok,false,
   'an out-of-date reviewed branch cannot authorize deployment');
  const latestStatuses=[
   {context:'funsidething/memory-audit',state:'success',description:'receipt-sha256='+receiptHash+';base='+fixture.baseSha,created_at:'2026-09-28T21:01:00Z'},
   {context:'funsidething/memory-audit',state:'failure',description:'receipt-sha256='+receiptHash+';base='+fixture.baseSha,created_at:'2026-09-28T21:04:00Z'},
   {context:'funsidething/independent-review',state:'success',description:'receipt-sha256='+receiptHash+';base='+fixture.baseSha,created_at:'2026-09-28T21:03:00Z'},
   {context:'funsidething/specialist-review',state:'success',description:'receipt-sha256='+receiptHash+';base='+fixture.baseSha,created_at:'2026-09-28T21:03:30Z'}];
  assert.equal((await verify(await api({merged:true,reviewStatuses:latestStatuses}))).ok,false,
   'the latest status for each exact-head context controls');
  const missingSpecialistContext=await api({merged:true,reviewStatuses:[
   {context:'funsidething/memory-audit',state:'success',description:'receipt-sha256='+receiptHash+';base='+fixture.baseSha,created_at:'2026-09-28T21:02:00Z'},
   {context:'funsidething/independent-review',state:'success',description:'receipt-sha256='+receiptHash+';base='+fixture.baseSha,created_at:'2026-09-28T21:03:00Z'}]});
  const missingCompatibility=await verify(missingSpecialistContext);
  assert.equal(missingCompatibility.ok,false,
   'schema-v1 deployment evidence cannot bypass the new specialist compatibility context');
  assert.match(missingCompatibility.errors.join(' '),/specialist-review/i);
  assert.equal((await verify(await api({merged:false}))).ok,false,
   'a main push without an associated merged PR cannot deploy');
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: CI makes verified release evidence a deployment prerequisite',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'.github/workflows/data-safety.yml'),'utf8');
 assert.match(workflow,/release-evidence:/,'CI must have a distinct exact-SHA deployment evidence job');
 assert.match(workflow,/node scripts\/release-evidence\.mjs verify-deployment/,
  'the main push must check its merged pull request, exact tree, and latest review statuses');
 assert.match(workflow,/needs: \[scanner-tests, release-evidence\]/,
  'Pages deployment must wait for both behavior checks and reviewer/memory evidence');
});

// The trigger and concurrency decisions are interpreted at the agreed CI workflow
// seam in the CI-routing agent-tool tests; this process RISK requires those pins to
// execute and pass rather than duplicating their workflow interpretation here.
test('RISK repository process: CI runs once per pull request commit and never cancels main',()=>{
 const pins=['workflow runs once per pull request commit and keeps push validation on main','workflow cancels superseded non-main runs and never cancels main'];
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^(?:'+pins.join('|')+')$','scripts/agent-tools/ci-routing.test.mjs'],{cwd:__dirname,env,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,'The CI trigger and concurrency pins must pass: '+result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,new RegExp('^# tests '+pins.length+'$','m'),'every named CI trigger pin must execute');
 assert.match(result.stdout,/^# skipped 0$/m);
 for(const pin of pins)assert.ok(result.stdout.split('\n').some(line=>/^ok \d+ - /.test(line)&&line.endsWith(' - '+pin)),'pin did not pass: '+pin);
});

// #2232 process RISKs require their named seam tests to execute and pass, with
// one top-level outcome per pin and no skips.
function requirePinsPass(file,pins,label){
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^(?:'+pins.join('|')+')$',file],{cwd:__dirname,env,encoding:'utf8',timeout:300000,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,'The '+label+' pins must pass: '+result.stdout+'\n'+result.stderr);
 assert.equal(result.stdout.split('\n').filter(line=>/^(?:not )?ok \d+ - /.test(line)).length,pins.length,'every named '+label+' pin must execute');
 assert.match(result.stdout,/^# skipped 0$/m);
 for(const pin of pins)assert.ok(result.stdout.split('\n').some(line=>/^ok \d+ - /.test(line)&&line.endsWith(' - '+pin)),'pin did not pass: '+pin);
}

// #2232: a PR description update started a second full run on the same SHA. The
// edited trigger is pinned at the CI workflow seam (CI-routing tests).
test('RISK repository process: a pull request edit starts no CI run and executes no test group',()=>{
 requirePinsPass('scripts/agent-tools/ci-routing.test.mjs',['workflow starts no run and no test group for a pull request edited event'],'PR edit trigger');
});

// #2232: the nightly root resolved to zero tests and nothing said so until the
// nightly run. The zero-test guard is pinned at the group runner's command line
// with fixture cohorts (test-group tests). It deliberately does not require
// main's live nightly roots to resolve: they return with #2248.
test('RISK repository process: a declared required or nightly root that resolves to zero tests fails the group runner',()=>{
 requirePinsPass('scripts/agent-tools/test-groups.test.mjs',['test group describe and nightly preflight fail when a declared required or nightly root resolves to zero tests'],'zero-test guard');
});

// #2232: every new test root needed a hand-written group row. Default-by-file
// placement, overrides and fail-closed aggregation of placed roots are pinned at
// the group runner's command line with fixture cohorts.
test('RISK repository process: a test root without a group row runs in its file group and the cohort still fails closed',()=>{
 requirePinsPass('scripts/agent-tools/test-groups.test.mjs',['test group roots without a row take their file group and rows override it'],'default-by-file');
});

// #2232: heavy roots were moved between groups to stay under Node's default
// heap. The per-group heap, including its 512 to 12288 MB bounds, is pinned at
// the group runner's command line with a fixture cohort.
test('RISK repository process: a group runs with its declared Node heap instead of moving roots out of it',()=>{
 requirePinsPass('scripts/agent-tools/test-groups.test.mjs',['test group runs a group with its declared Node heap and rejects an invalid heap'],'group heap');
});

// The nightly cross-engine move is pinned at the agreed seams (the CI workflow
// files in the CI-routing tests, and test:group --aggregate in the test-group
// tests); this process RISK requires those pins to execute and pass.
test('RISK repository process: cross-engine native checks run nightly outside the required cohort',()=>{
 const pins={
  'scripts/agent-tools/test-groups.test.mjs':['test group required cohort passes without nightly cross-engine cases and never executes them','test group nightly declarations cannot remove required or installed-client cases from the required cohort','test group aggregate with nightly roots still fails closed on missing duplicate skipped failed groups and installed-client reports','test group nightly cohort runs only the declared cross-engine cases and fails visibly'],
  'scripts/agent-tools/ci-routing.test.mjs':['workflow runs the cross-engine native checks nightly and on dispatch outside the required cohort'],
 };
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 for(const [file,names] of Object.entries(pins)){
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^(?:'+names.join('|')+')$',file],{cwd:__dirname,env,encoding:'utf8',timeout:300000,maxBuffer:8*1024*1024});
  assert.equal(result.status,0,'The nightly cross-engine pins must pass: '+result.stdout+'\n'+result.stderr);
  // Several pins carry subtests, so count top-level outcomes, not "# tests".
  assert.equal(result.stdout.split('\n').filter(line=>/^(?:not )?ok \d+ - /.test(line)).length,names.length,'every named nightly pin must execute');
  assert.match(result.stdout,/^# skipped 0$/m);
  for(const name of names)assert.ok(result.stdout.split('\n').some(line=>/^ok \d+ - /.test(line)&&line.endsWith(' - '+name)),'pin did not pass: '+name);
 }
});

// #2216: GitHub-side branch protection lives outside the repository, so a
// ruleset edit could silently drop a required check. The nightly drift check is
// pinned at the CI workflow seam (CI-routing tests) and its comparison at the
// drift tool's command line with fixture GitHub responses; this process RISK
// requires those pins to execute and pass.
test('RISK repository process: nightly run fails when the live main ruleset drifts from the committed required checks',()=>{
 const pins={
  'scripts/agent-tools/ci-routing.test.mjs':['workflow checks the live main ruleset against the committed required checks every night'],
  'scripts/agent-tools/ruleset-drift.test.mjs':['ruleset drift passes for the committed set and names missing and extra checks on a mismatch','ruleset drift fails visibly and names the manual comparison when the rules cannot be read'],
 };
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 for(const [file,names] of Object.entries(pins)){
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^(?:'+names.join('|')+')$',file],{cwd:__dirname,env,encoding:'utf8',timeout:300000,maxBuffer:8*1024*1024});
  assert.equal(result.status,0,'The ruleset drift pins must pass: '+result.stdout+'\n'+result.stderr);
  assert.equal(result.stdout.split('\n').filter(line=>/^(?:not )?ok \d+ - /.test(line)).length,names.length,'every named ruleset drift pin must execute');
  assert.match(result.stdout,/^# skipped 0$/m);
  for(const name of names)assert.ok(result.stdout.split('\n').some(line=>/^ok \d+ - /.test(line)&&line.endsWith(' - '+name)),'pin did not pass: '+name);
 }
});

// The weekly velocity report is pinned at the agreed seams (the CI-monitor
// agent-tool tests with fixture GitHub responses, and the CI workflow files in
// the CI-routing tests); this process RISK requires those pins to execute and pass.
test('RISK repository process: nightly velocity report alerts on merge stalls and issue spikes',()=>{
 const pins={
  'scripts/agent-tools/ci-monitor.test.mjs':['velocity report writes a readable weekly summary and raises no alert when neither threshold trips','velocity report alerts when nothing merged to main in 7 days while PRs are open','velocity report alerts when more than 100 issues are opened in a week','velocity report reuses an existing open alert issue instead of filing a duplicate','velocity report dry run reports the alert without writing to GitHub'],
  'scripts/agent-tools/ci-routing.test.mjs':['workflow runs the weekly velocity report nightly with only the permissions its alert needs'],
 };
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 for(const [file,names] of Object.entries(pins)){
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^(?:'+names.join('|')+')$',file],{cwd:__dirname,env,encoding:'utf8',timeout:300000,maxBuffer:8*1024*1024});
  assert.equal(result.status,0,'The velocity report pins must pass: '+result.stdout+'\n'+result.stderr);
  // The summary pin carries subtests, so count top-level outcomes, not "# tests".
  assert.equal(result.stdout.split('\n').filter(line=>/^(?:not )?ok \d+ - /.test(line)).length,names.length,'every named velocity pin must execute');
  assert.match(result.stdout,/^# skipped 0$/m);
  for(const name of names)assert.ok(result.stdout.split('\n').some(line=>/^ok \d+ - /.test(line)&&line.endsWith(' - '+name)),'pin did not pass: '+name);
 }
});

test('RISK repository process: shared hook chains prior hooks and blocks a legacy worktree without the validator',async()=>{
 const {installSharedPrePushHook}=await import('../scripts/install-release-hook.mjs');
 const fixture=makeReleaseGateFixture();
 try{
  const common=releaseGateGit(fixture.repo,['rev-parse','--path-format=absolute','--git-common-dir']);
  const hooks=path.join(common,'hooks');
  const legacyWorktree=path.join(fixture.root,'legacy');
  const marker=path.join(fixture.root,'prior-hook-ran');
  fs.mkdirSync(hooks,{recursive:true});
  const priorHook=path.join(hooks,'pre-push');
  const priorContents='#!/usr/bin/env bash\nprintf preserved > "$RELEASE_HOOK_MARKER"\n';
  fs.writeFileSync(priorHook,priorContents,{mode:0o755});
  releaseGateGit(fixture.repo,['worktree','add','-b','legacy',legacyWorktree,fixture.baseSha]);
  const installed=installSharedPrePushHook(fixture.repo);
  assert.equal(fs.readFileSync(installed.preservedHookPath,'utf8'),priorContents,
   'installing the gate retains the previous hook byte-for-byte');
  const legacyHook=releaseGateGit(legacyWorktree,['rev-parse','--path-format=absolute','--git-path','hooks/pre-push']);
  assert.equal(legacyHook,path.join(hooks,'pre-push'),'the shared hook covers every worktree');
  const result=spawnSync('bash',[legacyHook],{cwd:legacyWorktree,encoding:'utf8',
   input:'refs/heads/legacy '+fixture.candidateSha+' refs/heads/legacy '+'0'.repeat(40)+'\n',
   env:{...process.env,RELEASE_HOOK_MARKER:marker}});
  assert.ok(fs.existsSync(marker),'the pre-existing hook still runs before the gate');
  assert.notEqual(result.status,0,'an old branch without the validator must fail closed');
  assert.match(result.stderr,/validator|release gate|missing/i);

  const custom=makeReleaseGateFixture();
  try{
   const externalHooks=path.join(custom.root,'custom-hooks');
   fs.mkdirSync(externalHooks);
   const externalHook=path.join(externalHooks,'pre-push');
   fs.writeFileSync(externalHook,'#!/usr/bin/env bash\nexit 0\n',{mode:0o755});
   releaseGateGit(custom.repo,['config','core.hooksPath',externalHooks]);
   assert.throws(()=>installSharedPrePushHook(custom.repo),/core\.hooksPath|custom hook/i);
   assert.equal(fs.readFileSync(externalHook,'utf8'),'#!/usr/bin/env bash\nexit 0\n',
    'a configured hook path is never replaced or silently bypassed');
  }finally{cleanupReleaseGateFixture(custom);}
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: custom hook paths are compared with the shared git default',async()=>{
 const {installSharedPrePushHook}=await import('../scripts/install-release-hook.mjs');
 const fixture=makeReleaseGateFixture();
 try{
  const common=releaseGateGit(fixture.repo,['rev-parse','--path-format=absolute','--git-common-dir']);
  const defaultHooks=path.join(fs.realpathSync(common),'hooks');
  const customHooks=path.join(fixture.root,'custom-hooks');
  fs.mkdirSync(customHooks);
  const customHook=path.join(customHooks,'pre-push');
  const customContents='#!/usr/bin/env bash\nexit 0\n';
  fs.writeFileSync(customHook,customContents,{mode:0o755});
  assert.notEqual(fs.realpathSync(customHooks),fs.realpathSync(defaultHooks),
   'the configured external hook fixture must be distinct from the shared Git default');
  releaseGateGit(fixture.repo,['config','core.hooksPath',customHooks]);
  assert.throws(()=>installSharedPrePushHook(fixture.repo),/core\.hooksPath|custom hook/i,
   'Git resolving --git-path hooks to core.hooksPath must not make a custom dispatcher look default');
  assert.equal(fs.readFileSync(customHook,'utf8'),customContents,'the configured dispatcher remains untouched');
  assert.equal(fs.existsSync(path.join(defaultHooks,'pre-push')),false,'the shared default remains unmodified');
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: release hooks reject marker-only or tampered dispatchers',async()=>{
 const {installSharedPrePushHook}=await import('../scripts/install-release-hook.mjs');
 const markerOnly=makeReleaseGateFixture();
 try{
  const common=releaseGateGit(markerOnly.repo,['rev-parse','--path-format=absolute','--git-common-dir']);
  const hooks=path.join(common,'hooks');
  fs.mkdirSync(hooks,{recursive:true});
  const hook=path.join(hooks,'pre-push');
  const bypass='#!/usr/bin/env bash\n# codex-release-gate-managed-v1\nexit 0\n';
  fs.writeFileSync(hook,bypass,{mode:0o755});
  assert.throws(()=>installSharedPrePushHook(markerOnly.repo),/managed|modified|tampered|integrity/i,
   'a marker comment cannot be treated as a valid release gate');
  assert.equal(fs.readFileSync(hook,'utf8'),bypass,'an untrusted marker-only hook is left untouched');
 }finally{cleanupReleaseGateFixture(markerOnly);}

 const tampered=makeReleaseGateFixture();
 try{
  const common=releaseGateGit(tampered.repo,['rev-parse','--path-format=absolute','--git-common-dir']);
  const hooks=path.join(common,'hooks');
  fs.mkdirSync(hooks,{recursive:true});
  const hook=path.join(hooks,'pre-push');
  const prior='#!/usr/bin/env bash\nprintf prior-hook-preserved\n';
  fs.writeFileSync(hook,prior,{mode:0o755});
  const installed=installSharedPrePushHook(tampered.repo);
  const altered=fs.readFileSync(hook,'utf8').replace('printf "%s\\n" "$payload" | node "$validator" pre-push "$@"','exit 0');
  assert.notEqual(altered,fs.readFileSync(hook,'utf8'),'fixture must remove the validator call');
  fs.writeFileSync(hook,altered,{mode:0o755});
  assert.throws(()=>installSharedPrePushHook(tampered.repo),/managed|modified|tampered|integrity/i,
   'an altered dispatcher must not be accepted as an installed gate');
  assert.equal(fs.readFileSync(hook,'utf8'),altered,'repair does not overwrite an unrecognized dispatcher');
  assert.equal(fs.readFileSync(installed.preservedHookPath,'utf8'),prior,
   'the real hook remains recoverable byte-for-byte');
 }finally{cleanupReleaseGateFixture(tampered);}
});

test('RISK test inventory: risk map and source checks read every file in the test directory',async t=>{
 const os=await import('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'chain-test-surface-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'tests'));
 fs.writeFileSync(path.join(root,'tests/core.test.js'),"test('RISK alpha boundary: core case',()=>{});\n");
 fs.writeFileSync(path.join(root,'tests/scenery.test.js'),"test('RISK beta boundary: scenery case',async()=>{await page.waitForFunction(()=>true);});\n");
 fs.writeFileSync(path.join(root,'tests/shared.js'),"export async function sharedProbe(page){return page.waitForFunction(()=>true);}\n");
 const source=testSurfaceSource(root);
 for(const marker of ['RISK alpha boundary: core case','RISK beta boundary: scenery case','export async function sharedProbe'])
  assert.ok(source.includes(marker),`the test surface includes ${marker}`);
});

// #2194 CI (PR #2222): the group runner accepts only the 61 environment skips
// captured in the baseline inventory, so every browser root this branch added
// under {skip:!process.env.LANDSCAPE_BROWSER_URL} failed CI as an unexpected
// skip. An added root may skip only through an explicit environmentSkips
// declaration naming the variable its registration is gated on.
// The group runner's --describe output is the effective required cohort: a
// root's group comes from its row or, with no row, from its file (#2232).
function requiredCohortDescriptor(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-required-cohort-')),output=path.join(directory,'describe');
 try{
  const head=spawnSync('git',['rev-parse','HEAD'],{cwd:__dirname,encoding:'utf8'}).stdout.trim();
  const result=spawnSync(process.execPath,['scripts/test-groups.mjs','--describe','--group','core','--output-dir',output,'--repository','local/describe','--event-policy','local','--run-id','1','--run-attempt','1','--source-sha',head,'--comparison-base',head],{cwd:__dirname,encoding:'utf8',timeout:60000});
  assert.equal(result.status,0,'the required cohort must describe: '+result.stdout+result.stderr);
  return JSON.parse(fs.readFileSync(path.join(output,'descriptor.json'),'utf8'));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}

test('RISK test inventory: every added environment-gated root is declared with the variable its registration skips on',()=>{
 const assignments=JSON.parse(fs.readFileSync(path.join(__dirname,'scripts/test-group-assignments.json'),'utf8'));
 const inventory=JSON.parse(fs.readFileSync(path.join(__dirname,'scripts/test-group-inventory.json'),'utf8'));
 const baselineSkips=new Set(inventory.acceptedSkipCaseIds);
 // A baseline root renamed through rootReplacements keeps its baseline skip:
 // scripts/test-groups.mjs maps it and refuses a declaration for it (#2246).
 for(const replacement of assignments.rootReplacements||[])if(baselineSkips.has(replacement.baselineRoot))baselineSkips.add(replacement.currentRoot);
 const source=testSurfaceSource();
 const gated=new Map();
 for(const match of source.matchAll(/^test\(\s*(['"])(.*?)\1\s*,\s*\{\s*skip\s*:\s*!process\.env\.([A-Z][A-Z0-9_]*)\s*\}/gm))gated.set(match[2],match[3]);
 const added=[...gated].filter(([root])=>!baselineSkips.has(root));
 assert.ok(added.length>=10,'positive control: this branch adds environment-gated browser roots: '+added.length);
 const declared=new Map((assignments.environmentSkips||[]).map(entry=>[entry.root,entry])),requiredGroups=requiredCohortDescriptor().groups;
 for(const [root,environment] of added){
  assert.ok(declared.has(root),'the added environment-gated root is declared: '+root);
  assert.equal(declared.get(root).environment,environment,'the declaration names the variable the registration skips on: '+root);
  assert.ok(String(declared.get(root).reason||'').trim().length>=20,'the declaration explains why the root cannot run in CI: '+root);
 }
 for(const root of declared.keys()){
  assert.ok(gated.has(root),'every declaration names an environment-gated root in the test directory: '+root);
  assert.equal(baselineSkips.has(root),false,'baseline skips stay in the independent inventory, not in declarations: '+root);
  // #2232: rows hold only overrides; the runner's descriptor is the effective
  // placement, whether by row or by the root's file.
  assert.ok(requiredGroups.some(group=>group.roots.includes(root)),'every declared root keeps its group assignment: '+root);
 }
});

test('RISK test inventory: the RISK map is generated from RISK test names, one section per test file',()=>{
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'risk-map-2233-'));
 try{
  fs.mkdirSync(path.join(dir,'tests'));
  fs.writeFileSync(path.join(dir,'tests','core.test.js'),"test('RISK scan: b ranks second',()=>{});\ntest('scan: ordinary',()=>{});\ntest(\"RISK scan: a ranks first\",()=>{});\n");
  fs.writeFileSync(path.join(dir,'tests','scenery.test.js'),"test('RISK sky: dawn stays warm',()=>{});\n");
  fs.writeFileSync(path.join(dir,'tests','shared.js'),"// test('RISK helper: not a test file',()=>{});\n");
  const run=(...args)=>spawnSync(process.execPath,[path.join(__dirname,'scripts','risk-map.mjs'),'--root',dir,...args],{encoding:'utf8'});
  assert.equal(run('--check').status,1,'a missing map is out of date');
  assert.equal(run('--write').status,0);
  const map=fs.readFileSync(path.join(dir,'RISK_TEST_COVERAGE.md'),'utf8');
  assert.deepEqual(map.split('\n').filter(line=>/^(?:## |- )/.test(line)),
   ['## tests/core.test.js','- RISK scan: b ranks second','- RISK scan: a ranks first','## tests/scenery.test.js','- RISK sky: dawn stays warm'],
   'each RISK test is listed once, in source order, under its test file');
  assert.match(map,/npm run risk-map -- --write/,'the map says how it is regenerated');
  assert.match(map,/new feature/i,'the map explains how new features add risk contracts');
  assert.equal(run('--check').status,0,'a freshly written map is current');
  fs.appendFileSync(path.join(dir,'tests','scenery.test.js'),"test('RISK sky: dusk fades',()=>{});\n");
  const stale=run('--check');
  assert.equal(stale.status,1,'adding a RISK test makes the map stale');
  assert.match(stale.stderr,/npm run risk-map -- --write/,'the stale message names the command');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 assert.equal(spawnSync(process.execPath,[path.join(__dirname,'scripts','risk-map.mjs'),'--check'],{cwd:__dirname,encoding:'utf8'}).status,0,
  'the committed RISK map matches the RISK tests');
});

test('RISK test inventory: every named risk contract maps to a feature boundary',()=>{
 const inventoryPath=path.join(__dirname,'RISK_TEST_COVERAGE.md');
 assert.ok(fs.existsSync(inventoryPath),'the repository must keep a readable inventory of current risk contracts');
 const inventory=fs.readFileSync(inventoryPath,'utf8');
 const source=testSurfaceSource();
 const riskNames=[...source.matchAll(/^\s*test\(\s*(['"])(RISK\b[^'"]*)\1/gm)].map(match=>match[2]);
 for(const name of riskNames)assert.ok(inventory.includes(name),`risk contract is missing from the feature inventory: ${name}`);
 assert.match(inventory,/future|new feature/i,'the inventory must explain how future work adds risk contracts');
});

test('RISK repository process: backward compatibility is a mandatory fail-closed release gate',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'.github/workflows/data-safety.yml'),'utf8');
 assert.match(workflow,/name: Backward compatibility/,'the required scanner job must run the compatibility matrix');
 assert.match(workflow,/run: node scripts\/agent-tools\/ci-pass-reuse\.mjs run-gate --gate compatibility /,'compatibility must use the enforcing execution-or-original-pass consumer');
 const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8'));
 assert.match(pkg.scripts['test:compatibility'],/firebase emulators:exec.*backward-compatibility\.mjs/);
 const result=spawnSync(process.execPath,['scripts/backward-compatibility.mjs'],{cwd:__dirname,encoding:'utf8',env:{...process.env,FIRESTORE_EMULATOR_HOST:''}});
 assert.notEqual(result.status,0,'missing emulator cannot silently skip compatibility');
 assert.match(result.stderr,/Firestore emulator is required/);
});

test('RISK repository process: backward compatibility finds its required families across the test directory',async t=>{
 const {COMPATIBILITY_FAMILIES,compatibilityTestFiles}=await import('../scripts/backward-compatibility.mjs');
 const os=await import('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'chain-split-compatibility-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'tests'));
 const register=names=>names.map(name=>`test('${name} fixture case',()=>{});`).join('\n')+'\n';
 fs.writeFileSync(path.join(root,'tests/core.test.js'),register(COMPATIBILITY_FAMILIES.slice(0,2)));
 fs.writeFileSync(path.join(root,'tests/persistence-recovery.test.js'),register(COMPATIBILITY_FAMILIES.slice(2)));
 fs.writeFileSync(path.join(root,'tests/scenery.test.js'),"test('scenery: unrelated',()=>{});\n");
 assert.deepEqual(compatibilityTestFiles(root),['tests/core.test.js','tests/persistence-recovery.test.js'],
  'the gate runs every split file that registers a compatibility family');
 fs.writeFileSync(path.join(root,'tests/persistence-recovery.test.js'),register(COMPATIBILITY_FAMILIES.slice(2,4)));
 assert.throws(()=>compatibilityTestFiles(root),new RegExp('Missing required compatibility family '+COMPATIBILITY_FAMILIES[4]),
  'a family missing from every split file still fails the gate');
});

test('RISK repository process: the Firestore rules command loads every registered Firestore rules test',()=>{
 const command=JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8')).scripts['test:rules'];
 const files=[...command.matchAll(/(?:^|\s)((?:tests\/[\w.-]+|tests)\.js)\b/g)].map(match=>match[1]);
 assert.ok(files.length,'the rules command names its test files');
 const registered=source=>(source.match(/^\s*test\(\s*['"]Firestore rules:/gm)||[]).length;
 const loaded=files.reduce((total,file)=>total+registered(fs.readFileSync(path.join(__dirname,file),'utf8')),0);
 assert.ok(loaded>0,'the rules command loads Firestore rules tests');
 assert.equal(loaded,registered(testSurfaceSource()),'every Firestore rules test is in a file the rules command loads');
});

test('RISK repository process: backward compatibility pins released code and rejects broken roundtrips',async()=>{
 const {SUPPORTED_RELEASE,readReleasedClient,assertRoundTrip}=await import('../scripts/backward-compatibility.mjs');
 assert.equal(SUPPORTED_RELEASE,'7b9c92a41999a44a12f92b7d6d1c8d02758c635e','the oldest supported baseline cannot float with HEAD');
 const released=readReleasedClient(__dirname,SUPPORTED_RELEASE);
 assert.ok(released.html.includes('const CS = window.CloudSync'));
 assert.ok(released.cloud.includes('createCloudStore'));
 assert.throws(()=>readReleasedClient(__dirname,'HEAD'),/full commit SHA/);
 let payload=null;
 const healthy={status:'ok',async push(value){payload=value;return {ok:true,rev:1};},async pull(){return {payload,rev:1};}};
 await assertRoundTrip(healthy,'exact legacy bytes',0,'healthy');
 await assert.rejects(assertRoundTrip({status:'ok',async push(){return {error:true};}},'x',0,'old writer'),/old writer.*upload/);
 await assert.rejects(assertRoundTrip({status:'ok',async push(){return {ok:true,rev:1};},async pull(){return {payload:'lost',rev:1};}},'x',0,'bad reader'),/bad reader.*payload/);
});

test('RISK repository process: backward compatibility rejects skipped or empty gate runs',async()=>{
 const {validateGateSummary}=await import('../scripts/backward-compatibility.mjs');
 const report=(tests,pass,fail,skip)=>`# tests ${tests}\n# pass ${pass}\n# fail ${fail}\n# cancelled 0\n# skipped ${skip}\n`;
 assert.doesNotThrow(()=>validateGateSummary(report(15,15,0,0)));
 for(const output of ['',report(0,0,0,0),report(15,14,0,1),report(15,14,1,0),report(15,15,0,0).replace('# cancelled 0','# cancelled 1')])
  assert.throws(()=>validateGateSummary(output),/compatibility/i,'missing or skipped coverage is a failed gate');
});

test('RISK repository process: Firestore deployment aborts when backward compatibility fails',async()=>{
 const config=JSON.parse(fs.readFileSync(path.join(__dirname,'firebase.json'),'utf8'));
 assert.deepEqual(config.firestore.predeploy,['npm run test:compatibility'],'direct rules deployments must run the same gate');
 const {lifecycleHooks}=await import('firebase-tools/lib/deploy/lifecycleHooks.js');
 const os=await import('node:os'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'compatibility-hook-'));
 try{
  fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({scripts:{'test:compatibility':'node -e "process.exit(17)"'}}));
  const options={project:'demo-compatibility-hook',projectRoot:temp,only:'firestore:rules',config:{projectDir:temp,path:value=>path.resolve(temp,value||'.'),get:key=>config[key]}};
  await assert.rejects(lifecycleHooks('firestore','predeploy')({},options),/firestore predeploy error/,'the real CLI hook must propagate a failing compatibility command');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('RISK repository process: the app harness awaits slow durable startup instead of returning null state',async()=>{
 const {indexedDB}=await import('fake-indexeddb');let delayed=false;
 const cryptoProvider={...webcrypto,subtle:{async digest(...args){
  if(!delayed){delayed=true;await new Promise(resolve=>setTimeout(resolve,180));}
  return webcrypto.subtle.digest(...args);
 }},getRandomValues:array=>webcrypto.getRandomValues(array),randomUUID:()=>webcrypto.randomUUID()};
 const board=syncState({tasks:[syncTask('slow','Recovered after slow hashing')]});
 const raw=JSON.stringify(board);
 const {ctx,shim}=await loadApp({indexedDBProvider:indexedDB,cryptoProvider,deviceDbName:'slow-start-'+Date.now(),
  seedStorage:{[LOCAL_HEAD_KEY]:raw,[SYNC_STORE_KEY]:raw}});
 assert.ok(ctx.state,'loadApp must wait until the durable boot has supplied state');
 assert.equal(ctx.state.tasks[0].title,'Recovered after slow hashing');
 await shim.window.ScannerDeviceStore.close();
});
test('RISK repository process: FAQ coverage needs a distinct exact-candidate reviewer and bound evidence',async()=>{
 const {deriveReleaseReviewPlan,recordReleaseEvidence,verifyReleaseEvidence}=await import('../scripts/release-evidence.mjs');
 const fixture=makeReleaseGateFixture({changedPath:'index.html',baseText:'<p>Old control</p>',candidateText:'<p>New control</p>'});
 try{
  fs.writeFileSync(path.join(fixture.repo,'AGENTS.md'),'Independent FAQ coverage review is required for every product release.\n');releaseGateGit(fixture.repo,['add','--all']);releaseGateGit(fixture.repo,['commit','-m','Require independent FAQ review']);fixture.candidateSha=releaseGateGit(fixture.repo,['rev-parse','HEAD']);fixture.treeSha=releaseGateGit(fixture.repo,['rev-parse','HEAD^{tree}']);
  const plan=deriveReleaseReviewPlan(fixture.repo,fixture.candidateSha,fixture.baseSha);assert.equal(plan.requiresFaqReview,true);
  const input=riskBasedReleaseInput(fixture,{domains:plan.specialistDomains});assert.throws(()=>recordReleaseEvidence(fixture.repo,input),/FAQ/);
  assert.throws(()=>recordReleaseEvidence(fixture.repo,releaseGateInput(fixture)),/FAQ.*schemaVersion 2/);
  const faqPath=path.join(fixture.root,'faq-review.md');fs.writeFileSync(faqPath,'Reviewed all changed controls and audited Settings-aligned FAQ coverage.\n');
  input.faqReview={task:'/root/faq-review',outcome:'approved',reviewedSha:fixture.candidateSha,completedAt:new Date().toISOString(),summary:'Reviewed changed user controls and past feature coverage in the Settings-aligned FAQ.',scope:{fullDiff:true,relevantTests:true,userVisibleAndDataSafety:true},evidencePath:faqPath,evidenceSha256:releaseGateHash(faqPath)};
  const bad=JSON.parse(JSON.stringify(input));bad.faqReview.task=input.independentReview.task;assert.throws(()=>recordReleaseEvidence(fixture.repo,bad),/distinct/);
  const stale=JSON.parse(JSON.stringify(input));stale.faqReview.reviewedSha=fixture.baseSha;assert.throws(()=>recordReleaseEvidence(fixture.repo,stale),/exact candidate/);
  recordReleaseEvidence(fixture.repo,input);assert.equal(verifyReleaseEvidence(fixture.repo,fixture.candidateSha).ok,true);
 }finally{cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: FAQ policy rejects legacy verified receipts and old deployment descriptions',async()=>{
 const {deriveReleaseReviewPlan,recordReleaseEvidence,verifyReleaseEvidence,publishReleaseStatuses,verifyDeploymentEvidence}=await import('../scripts/release-evidence.mjs');
 const f=makeReleaseGateFixture();
 try{
  const original=recordReleaseEvidence(f.repo,releaseGateInput(f));assert.equal(verifyReleaseEvidence(f.repo,f.candidateSha).ok,true);
  fs.writeFileSync(path.join(f.repo,'AGENTS.md'),'Independent FAQ coverage review is required for every product release.\n');releaseGateGit(f.repo,['add','--all']);releaseGateGit(f.repo,['commit','-m','Require FAQ coverage']);f.candidateSha=releaseGateGit(f.repo,['rev-parse','HEAD']);f.treeSha=releaseGateGit(f.repo,['rev-parse','HEAD^{tree}']);
  const target=path.join(f.repo,'.git','funsidething-release-evidence',f.candidateSha);fs.cpSync(path.dirname(original.receiptPath),target,{recursive:true});
  const receipt=JSON.parse(fs.readFileSync(original.receiptPath,'utf8'));receipt.candidate={commitSha:f.candidateSha,treeSha:f.treeSha,baseSha:f.baseSha};receipt.independentReview.reviewedSha=f.candidateSha;releaseGateReseal(receipt);fs.writeFileSync(path.join(target,'receipt.json'),JSON.stringify(receipt));
  assert.equal(verifyReleaseEvidence(f.repo,f.candidateSha).ok,false,'old publisher cannot authorize new policy candidate');fs.rmSync(target,{recursive:true});
  const required=deriveReleaseReviewPlan(f.repo,f.candidateSha,f.baseSha);const input=riskBasedReleaseInput(f,{specialistReview:required.requiresSpecialistReview,domains:required.specialistDomains});const faqPath=path.join(f.root,'faq.md');fs.writeFileSync(faqPath,'Reviewed changed controls, saved data, defaults and complete FAQ coverage.');
  input.faqReview={...input.independentReview,task:'/root/faq-distinct-reviewer',evidencePath:faqPath,evidenceSha256:releaseGateHash(faqPath)};recordReleaseEvidence(f.repo,input);
  const published=[];await publishReleaseStatuses(f.repo,f.candidateSha,async status=>published.push(status));assert.ok(published.every(status=>/;v=3$/.test(status.description)),'FAQ-approved binding distinguishes older policy publishers');assert.ok(published.every(status=>status.description.length<=140));
  const mainSha='c'.repeat(40),fetchFor=statuses=>async url=>{
   const pathname=new URL(url).pathname;let body;
   if(pathname.endsWith('/commits/'+mainSha+'/pulls'))body=[{merge_commit_sha:mainSha,merged_at:new Date().toISOString(),base:{ref:'main'},head:{sha:f.candidateSha}}];
   else if(pathname.endsWith('/commits/'+mainSha))body={parents:[{sha:f.baseSha}],commit:{tree:{sha:f.treeSha}}};
   else if(pathname.endsWith('/commits/'+f.candidateSha+'/statuses'))body=statuses.map((row,i)=>({...row,created_at:new Date(Date.now()+i).toISOString()}));
   else if(pathname.endsWith('/commits/'+f.candidateSha))body={commit:{tree:{sha:f.treeSha}}};
   else if(pathname.includes('/compare/'))body={status:'ahead'};else throw Error(pathname);
   return {ok:true,status:200,json:async()=>body};
  };
  const verify=statuses=>verifyDeploymentEvidence({repoRoot:f.repo,repository:'emerald-pham/funsidething',deployedSha:mainSha,beforeSha:f.baseSha,token:'fixture',fetchImpl:fetchFor(statuses)});
  assert.equal((await verify(published)).ok,true);assert.equal((await verify(published.map(row=>({...row,description:row.description.replace(';v=3',';v=2')})))).ok,false,'Pages rejects old normal publisher for FAQ-policy candidate');
  f.baseSha=f.candidateSha;fs.writeFileSync(path.join(f.repo,'README.md'),'Documentation only after FAQ policy.');releaseGateGit(f.repo,['add','--all']);releaseGateGit(f.repo,['commit','-m','Prose only']);f.candidateSha=releaseGateGit(f.repo,['rev-parse','HEAD']);f.treeSha=releaseGateGit(f.repo,['rev-parse','HEAD^{tree}']);
  recordReleaseEvidence(f.repo,riskBasedReleaseInput(f,{codeReview:false,specialistReview:false}));const docs=[];await publishReleaseStatuses(f.repo,f.candidateSha,async status=>docs.push(status));assert.equal((await verify(docs)).ok,true,'prose-only release retains owner-review exemption');

 }finally{cleanupReleaseGateFixture(f);}
});

test('RISK repository process: Pages FAQ policy reads exact head and base from a full release-evidence checkout',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'.github/workflows/data-safety.yml'),'utf8');const release=workflow.split('  release-evidence:')[1].split('  deploy-pages:')[0];assert.match(release,/actions\/checkout@v4\s+with:\s+fetch-depth: 0/,'Pages must not infer missing policy objects from a shallow checkout');
});

test('RISK repository process: scaled review plan pins ordinary code to owner plus independent and docs to owner only',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 // A realistic ordinary fix also edits its test, the RISK map and the test
 // rationale file; those process files must not summon a specialist.
 const ordinary=makeScaledReviewFixture({base:{'src/landscape.mjs':'const hue = 30;\n','tests.js':'\n','RISK_TEST_COVERAGE.md':'# Map\n','TEST_CHANGE_RATIONALES.json':'[]\n'},
  candidate:{'src/landscape.mjs':'const hue = 32;\n','tests.js':"test('RISK landscape colors: dawn hue stays warm',()=>{});\n",
   'RISK_TEST_COVERAGE.md':'# Map\n- RISK landscape colors: dawn hue stays warm\n','TEST_CHANGE_RATIONALES.json':'[{"reason":"Dawn hue regression case"}]\n'}});
 const docs=makeScaledReviewFixture({base:{'README.md':'Old setup note.\n'},candidate:{'README.md':'Clearer setup note.\n'}});
 try{
  assert.deepEqual(deriveReleaseReviewPlan(ordinary.repo,ordinary.candidateSha,ordinary.baseSha),
   scaledPlan({changedFiles:['RISK_TEST_COVERAGE.md','TEST_CHANGE_RATIONALES.json','src/landscape.mjs','tests.js']}),
   'an ordinary code fix needs exactly the owner review plus one combined independent review');
  assert.deepEqual(deriveReleaseReviewPlan(docs.repo,docs.candidateSha,docs.baseSha),
   scaledPlan({changedFiles:['README.md'],mode:'owner-self-review',requiresCodeReview:false,requiresOwnerFaqCoverage:false}),
   'a documentation-only diff needs only the owner review');
 }finally{cleanupReleaseGateFixture(ordinary);cleanupReleaseGateFixture(docs);}
});

// Spec #2230 / #2234: the changed-line review policy is switched on by this
// committed AGENTS.md sentence at both base and head, like the scaled policy, so
// receipts recorded under the earlier classification keep verifying.
const CHANGED_LINE_POLICY_TEXT_2234='Release reviews scale to the exact diff. The release validator derives the\nplan, and the owner review records FAQ coverage for every product release.\nReview plans classify changed code, not prose.\n';
const changedLinePlan2234=(base,candidate,policy=true)=>{
 const options={base,candidate};
 if(policy)Object.assign(options,{agentsBase:CHANGED_LINE_POLICY_TEXT_2234,agentsHead:CHANGED_LINE_POLICY_TEXT_2234});
 return options;
};

test('RISK repository process: changed-line review plan reads nearby code but not distant storage code',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 // A guard edit is persistence code because of the storage calls beside it,
 // but an unrelated edit far from storage code is not (#2234 review).
 const filler='const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\n';
 const near=hue=>`function remember(board){\n  localStorage.setItem("board", JSON.stringify(board));\n  return ${hue};\n}\n`;
 const far=hue=>`function remember(board){\n  localStorage.setItem("board", JSON.stringify(board));\n}\n${filler}const hue = ${hue};\n`;
 const plan=(base,candidate,policy=true)=>{
  const f=makeScaledReviewFixture(changedLinePlan2234({'landscape-mood.js':base},{'landscape-mood.js':candidate},policy));
  try{return deriveReleaseReviewPlan(f.repo,f.candidateSha,f.baseSha).specialistDomains;}finally{cleanupReleaseGateFixture(f);}
 };
 assert.deepEqual(plan(near(30),near(32)),['memory-cloud-sync'],'a change beside a storage call is reviewed as persistence code');
 assert.deepEqual(plan(far(30),far(32)),[],'a change several lines away from storage code is not a persistence change');
 const commented=hue=>`// Remember the board in local storage before syncing.\nconst hue = ${hue};\n`;
 assert.deepEqual(plan(commented(30),commented(32)),[],'a comment beside the change is prose, not storage code');
 assert.deepEqual(plan(commented(30),commented(32),false),['memory-cloud-sync'],
  'a candidate whose base predates the policy keeps its earlier classification');
});

test('RISK repository process: changed-line review plan treats a changelog entry and refreshed fingerprints as an ordinary change',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 // Every app change must add a changelog entry and refresh both fingerprints,
 // and the changelog talks about cloud recovery, sync and sessions in prose.
 const page=(fingerprint,entries)=>'<!doctype html>\n<body>\n<script>\nfunction boot(){ start(); }\n</script>\n<!-- changelog:start -->\n'+
  `<template id="appChangelogCurrent"><div data-app-fingerprint="${fingerprint}"><ul>${entries}</ul></div></template>\n<!-- changelog:end -->\n</body>\n`;
 const worker=key=>`const CACHE_NAME = "chain-scanner-shell-${key}";\nself.addEventListener("install", () => {});\n`;
 const older='<li>Cloud recovery keeps your saved board when a session sync fails.</li>';
 const newer='<li>Restore now waits for a deliberate run; backups, migration and storage stay untouched.</li>';
 const f=makeScaledReviewFixture(changedLinePlan2234(
  {'index.html':page('a'.repeat(64),older),'sw.js':worker('1'.repeat(64))},
  {'index.html':page('b'.repeat(64),newer+older),'sw.js':worker('2'.repeat(64))}));
 try{
  assert.deepEqual(deriveReleaseReviewPlan(f.repo,f.candidateSha,f.baseSha),scaledPlan({changedFiles:['index.html','sw.js']}),
   'the changelog entry and refreshed fingerprints need the owner and one independent review, no specialist or typography review');
 }finally{cleanupReleaseGateFixture(f);}
});

test('RISK repository process: changed-line review plan reads persistence only from script code, not prose, comments or Node sync APIs',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const domains=(base,candidate)=>{
  const f=makeScaledReviewFixture(changedLinePlan2234(base,candidate));
  try{return deriveReleaseReviewPlan(f.repo,f.candidateSha,f.baseSha).specialistDomains;}finally{cleanupReleaseGateFixture(f);}
 };
 const help=text=>`<!doctype html>\n<body>\n<dialog id="help"><p>${text}</p></dialog>\n<script>\nfunction boot(){ start(); }\n</script>\n</body>\n`;
 assert.deepEqual(domains({'index.html':help('Cloud recovery keeps your saved board.')},
  {'index.html':help('Cloud recovery waits for a deliberate run before it restores a backup from sync storage or a session.')}),[],
  'Help prose about cloud recovery is not persistence code');
 assert.deepEqual(domains({'scripts/report.mjs':'export const tool = 1;\n'},
  {'scripts/report.mjs':"import fs from 'node:fs';\nimport { spawnSync } from 'node:child_process';\n// Sync the session cache and reload the stored board before saving.\nexport const read = file => fs.readFileSync(file, 'utf8');\nexport const run = args => spawnSync(process.execPath, args);\nfs.writeFileSync('out.txt', 'x');\n"}),[],
  'Node synchronous file and process APIs and comments are not app persistence');
 // The #2231 diff: a new scripts/ tool and its tests, with app shell unchanged.
 const shellTool=fs.readFileSync(path.join(__dirname,'scripts','shell-fingerprints.mjs'),'utf8');
 const core=fs.readFileSync(path.join(__dirname,'tests','core.test.js'),'utf8');
 const shellTests=core.slice(core.indexOf('const expectedShellIdentities2231'),core.indexOf("test('Ducks: seeded occasional takeoffs"));
 assert.ok(shellTool.includes('readFileSync')&&shellTests.includes('spawnSync'),'precondition: the #2231 fixture uses Node sync APIs');
 assert.deepEqual(domains({'tests/core.test.js':"import fs from 'node:fs';\n"},{'scripts/shell-fingerprints.mjs':shellTool,'tests/core.test.js':"import fs from 'node:fs';\n"+shellTests}),[],
  'the #2231 tooling diff derives no specialist domain');
 assert.deepEqual(domains({'landscape-mood.js':'function save(board){ return board; }\n'},{'landscape-mood.js':'function save(board){ return renderSync(board); }\n'}),['memory-cloud-sync'],
  'an app identifier such as renderSync still derives the persistence specialist');
 assert.deepEqual(domains({'index.html':help('Help.')},{'index.html':help('Help.').replace('start();','localStorage.setItem("board", "{}"); start();')}),['memory-cloud-sync'],
  'storage code inside an inline script still derives the persistence specialist');
 // Only whole-line comments are ignored: code after or around a comment still counts.
 for(const line of ['/* legacy */ localStorage.clear();','*/ localStorage.removeItem("board");','  * localStorage.length']){
  assert.deepEqual(domains({'landscape-mood.js':'const hue = 30;\n'},{'landscape-mood.js':'const hue = 30;\n'+line+'\n'}),['memory-cloud-sync'],
   `code sharing a line with a comment marker is still code: ${line}`);
 }
});

test('RISK repository process: changed-line review plan fails closed on large pages, revision edits and HTML that loads or runs script',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const plan=(base,candidate)=>{
  const f=makeScaledReviewFixture(changedLinePlan2234(base,candidate));
  try{return deriveReleaseReviewPlan(f.repo,f.candidateSha,f.baseSha);}finally{cleanupReleaseGateFixture(f);}
 };
 // The real index.html is over 1 MiB; reading it must not silently fail open.
 const padding='<p>Board help text.</p>\n'.repeat(60000);
 const page=(code,entry)=>`<!doctype html>\n<body>\n${padding}<script>\nfunction boot(){ ${code} }\n</script>\n<!-- changelog:start -->\n<template id="appChangelogCurrent"><div data-app-fingerprint="${entry}"><ul><li>Note.</li></ul></div></template>\n<!-- changelog:end -->\n</body>\n`;
 assert.ok(page('start();','a'.repeat(64)).length>1024*1024,'precondition: the fixture page is larger than 1 MiB');
 assert.deepEqual(plan({'index.html':page('start();','a'.repeat(64))},{'index.html':page('localStorage.setItem("board", "{}"); start();','a'.repeat(64))}).specialistDomains,['memory-cloud-sync'],
  'storage code in a large page still derives the persistence specialist');
 const fingerprintOnly=plan({'index.html':page('start();','a'.repeat(64))},{'index.html':page('start();','b'.repeat(64))});
 assert.deepEqual([fingerprintOnly.specialistDomains,fingerprintOnly.requiresTypographyReview],[[],false],
  'a fingerprint refresh in a large page is still recognized as changelog bookkeeping');
 // Revision ordering lives in functions such as cloudPull; edits there are sync changes.
 const pull=check=>`<script>\nasync function cloudPull(){\n  const remote = await fetchRemote();\n  if(${check}) apply(remote);\n}\nfunction chooseBase(rr, localRev){\n  return localRev;\n}\n</script>\n`;
 assert.deepEqual(plan({'index.html':pull('remote.rev>=0')},{'index.html':pull('remote.rev>0')}).specialistDomains,['memory-cloud-sync'],
  'an edit inside cloudPull is a sync change');
 assert.deepEqual(plan({'index.html':pull('ok')},{'index.html':pull('ok').replace('return localRev;','return impossibleLocalBase ? rr : localRev;')}).specialistDomains,['memory-cloud-sync'],
  'choosing between revisions is revision ordering');
 // HTML that loads or runs code is code, even outside an inline script body.
 const shell=tag=>`<!doctype html>\n<body>\n${tag}\n</body>\n`;
 assert.deepEqual(plan({'index.html':shell('<script src="device-store-v2.js"></script>')},{'index.html':shell('<script defer src="device-store-v2.js"></script>')}).specialistDomains,['memory-cloud-sync'],
  'deferring the device store script changes when storage code loads');
 assert.deepEqual(plan({'index.html':shell('<button>Save</button>')},{'index.html':shell('<button onclick="localStorage.clear()">Save</button>')}).specialistDomains,['memory-cloud-sync'],
  'an inline event handler that clears storage is persistence code');
 // Real-shaped guard edits from the specialist review: a transaction's
 // existing-generation guard and the device store's compare-and-swap.
 const generation=guard=>`<script>\nconst cloud = {\n  async beginGeneration(uid,id,header){\n    return F.runTransaction(db,async tx=>{\n      const ref=generationRef(uid,id),existing=snapshotData(await tx.get(ref));\n${guard}      tx.set(ref,{...header});return header;\n    });\n  }\n};\n</script>\n`;
 assert.deepEqual(plan({'index.html':generation('      if(existing)return existing;\n')},{'index.html':generation('')}).specialistDomains,['memory-cloud-sync'],
  'dropping the existing-generation guard in a cloud transaction is a persistence change');
 const cas=check=>`export async function writeHead(expectedHash, next){\n  const tx = begin();\n  const current = await read(tx);\n  if(${check}){ tx.abort(); return false; }\n  put(tx, next);\n  return true;\n}\n`;
 assert.deepEqual(plan({'device-store-v2.js':cas('current.hash!==expectedHash')},{'device-store-v2.js':cas('false')}).specialistDomains,['memory-cloud-sync'],
  'disabling the device store compare-and-swap guard is a persistence change');
 // The device store is persistence code throughout, even where an edited line
 // and its neighbours carry no storage words, and its schema constant is a migration.
 const deviceStore=compare=>`(function(){\n  function same(a,b){\n    return a===b${compare};\n  }\n})();\n`;
 assert.deepEqual(plan({'device-store-v2.js':deviceStore('')},{'device-store-v2.js':deviceStore('||true')}).specialistDomains,['memory-cloud-sync'],
  'any edit to the device store derives the persistence specialist');
 assert.deepEqual(plan({'landscape-mood.js':'const SCHEMA_VERSION=2;\n'},{'landscape-mood.js':'const SCHEMA_VERSION=3;\n'}).specialistDomains,['data-migration'],
  'changing a SCHEMA_VERSION constant is a data migration');
 // Changelog markup is injected into Settings, so code there still runs, and
 // moving a marker could hide script lines; SVG files can carry script too.
 const log=(entry,end='<!-- changelog:end -->')=>`<!doctype html>\n<body>\n<!-- changelog:start -->\n<template id="appChangelogCurrent"><div><ul>${entry}</ul></div></template>\n${end}\n<script>\nfunction boot(){ start(); }\n</script>\n</body>\n`;
 assert.deepEqual(plan({'index.html':log('<li>Note.</li>')},{'index.html':log('<li onclick="localStorage.clear()">Note.</li>')}).specialistDomains,['memory-cloud-sync'],
  'an event handler inside the changelog block is code');
 assert.notDeepEqual(plan({'index.html':log('<li>Note.</li>')},{'index.html':log('<li>Note.</li>','').replace('</body>','<!-- changelog:end -->\n</body>').replace('start();','localStorage.clear(); start();')}).specialistDomains,[],
  'moving the changelog end marker over a script edit cannot hide it');
 assert.deepEqual(plan({'icon.svg':'<svg><script>start()</script></svg>\n'},{'icon.svg':'<svg><script>localStorage.clear()</script></svg>\n'}).specialistDomains,['memory-cloud-sync'],
  'script inside an SVG is code');
});

test('RISK repository process: changed-line review plan skips typography for text-only edits inside existing elements',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const typography=(base,candidate)=>{
  const f=makeScaledReviewFixture(changedLinePlan2234(base,candidate));
  try{return deriveReleaseReviewPlan(f.repo,f.candidateSha,f.baseSha).requiresTypographyReview;}finally{cleanupReleaseGateFixture(f);}
 };
 const help=body=>`<!doctype html>\n<body>\n<dialog id="help">\n${body}\n</dialog>\n</body>\n`;
 assert.equal(typography({'index.html':help('<p>Tap a row to <b>start</b> it.</p>')},{'index.html':help('<p>Tap a task to <b>begin</b> working on it.</p>')}),false,
  'rewording Help inside the same elements needs no typography review');
 assert.equal(typography({'index.html':help('<p>Tap a row.</p>')},{'index.html':help('<p>Tap a row.</p>\n<p class="note">New note.</p>')}),true,
  'a new Help element is new rendered markup');
 assert.equal(typography({'index.html':help('<p>Tap a row.</p>')},{'index.html':help('<p class="note">Tap a row.</p>')}),true,
  'a changed class on an existing element changes rendering');
 assert.equal(typography({'landscape.css':'a{color:red}\n'},{'landscape.css':'a{color:blue}\n'}),true,'stylesheet changes still need typography review');
 assert.equal(typography({'index.html':help('<style>\n.note{color:red}\n</style>')},{'index.html':help('<style>\n.note{color:blue}\n</style>')}),true,
  'an inline stylesheet rule has no tags but still changes rendering');
});

test('RISK repository process: scaled review plan asks the owner for FAQ coverage only when product behavior changes',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const neutral={base:'const value = 1;\n',head:'const value = 2;\n'};
 // Tests, tooling and workflows change no control, default or saved data the
 // FAQ describes; the app's runtime files and rules do.
 const cases={
  'test-only':[{'tests/core.test.js':neutral.base},{'tests/core.test.js':neutral.head},false],
  'shared test helper':[{'tests/shared.js':neutral.base},{'tests/shared.js':neutral.head},false],
  'agent tooling':[{'scripts/agent-tools/report.mjs':neutral.base},{'scripts/agent-tools/report.mjs':neutral.head},false],
  'workflow':[{'.github/workflows/nightly.yml':'on: schedule\n'},{'.github/workflows/nightly.yml':'on: workflow_dispatch\n'},false],
  'app module':[{'landscape-mood.js':neutral.base},{'landscape-mood.js':neutral.head},true],
  'stylesheet':[{'landscape.css':'a{color:red}\n'},{'landscape.css':'a{color:blue}\n'},true],
  'firestore rules':[{'firestore.rules':'rules_version = "1";\n'},{'firestore.rules':'rules_version = "2";\n'},true],
  'app change with its test':[{'landscape-mood.js':neutral.base,'tests/core.test.js':neutral.base},{'landscape-mood.js':neutral.head,'tests/core.test.js':neutral.head},true],
 };
 for(const [name,[base,candidate,expected]] of Object.entries(cases)){
  const f=makeScaledReviewFixture({base,candidate});
  try{
   const plan=deriveReleaseReviewPlan(f.repo,f.candidateSha,f.baseSha);
   assert.equal(plan.requiresCodeReview,true,`${name}: code changed, so code review stays required`);
   assert.equal(plan.requiresOwnerFaqCoverage,expected,`${name}: owner FAQ coverage ${expected?'is':'is not'} required`);
  }finally{cleanupReleaseGateFixture(f);}
 }
});

test('RISK repository process: scaled review plan keeps the specialist for sync, rules, auth, deployment and ambiguous persistence',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const neutral={base:'const value = 1;\n',head:'const value = 2;\n'};
 const fixtures={
  // The release receipt verifier and pre-push gate are deployment infrastructure
  // even when the changed line itself looks neutral.
  releaseVerifier:makeScaledReviewFixture({base:{'scripts/release-evidence.mjs':neutral.base},candidate:{'scripts/release-evidence.mjs':neutral.head}}),
  pushGate:makeScaledReviewFixture({base:{'scripts/install-release-hook.mjs':neutral.base},candidate:{'scripts/install-release-hook.mjs':neutral.head}}),
  workflow:makeScaledReviewFixture({base:{'.github/workflows/data-safety.yml':'on: push\n'},candidate:{'.github/workflows/data-safety.yml':'on: pull_request\n'}}),
  cloud:makeScaledReviewFixture({base:{'src/cloud-sync.mjs':neutral.base},candidate:{'src/cloud-sync.mjs':neutral.head}}),
  rules:makeScaledReviewFixture({base:{'firestore.rules':neutral.base},candidate:{'firestore.rules':neutral.head}}),
  callable:makeScaledReviewFixture({base:{'src/handlers.mjs':'exports.limit = https.onCall((request) => checkOwner(request));\n'},
   candidate:{'src/handlers.mjs':'exports.limit = https.onCall((request) => checkTeam(request));\n'}}),
  migration:makeScaledReviewFixture({base:{'src/upgrade.mjs':'const schemaVersion = 3;\n'},candidate:{'src/upgrade.mjs':'const schemaVersion = 4;\n'}}),
  ambiguous:makeScaledReviewFixture({base:{'src/current-context.mjs':'export function saveSession(session) { return adapter.write(session); }\n'},
   candidate:{'src/current-context.mjs':'export function saveSession(session) { return adapter.remove(session); }\n'}}),
  ordinary:makeScaledReviewFixture({base:{'src/landscape.mjs':neutral.base},candidate:{'src/landscape.mjs':neutral.head}}),
 };
 try{
  const domains=(name,options)=>deriveReleaseReviewPlan(fixtures[name].repo,fixtures[name].candidateSha,fixtures[name].baseSha,options).specialistDomains;
  assert.deepEqual(domains('releaseVerifier'),['security-deployment'],'the receipt verifier keeps its deployment specialist');
  assert.deepEqual(domains('pushGate'),['security-deployment'],'the pre-push release gate keeps its deployment specialist');
  assert.deepEqual(domains('workflow'),['security-deployment'],'CI and Pages workflow edits keep the deployment specialist');
  assert.deepEqual(domains('cloud'),['memory-cloud-sync']);
  assert.deepEqual(domains('rules'),['memory-cloud-sync','security-deployment']);
  assert.deepEqual(domains('callable'),['security-deployment']);
  assert.deepEqual(domains('migration'),['data-migration']);
  assert.deepEqual(domains('ambiguous'),['memory-cloud-sync','shared-session-state'],'ambiguous session persistence still fails closed to the specialist');
  const cloudPlan=deriveReleaseReviewPlan(fixtures.cloud.repo,fixtures.cloud.candidateSha,fixtures.cloud.baseSha);
  assert.equal(cloudPlan.mode,'dual-review');assert.equal(cloudPlan.schemaVersion,2);
  assert.deepEqual(domains('ordinary',{additionalSpecialistDomains:['release-process']}),['release-process'],'the owner can still add a known domain');
  assert.deepEqual(domains('cloud',{additionalSpecialistDomains:[]}),['memory-cloud-sync'],'an empty declaration cannot remove a derived domain');
  assert.deepEqual(domains('rules',{additionalSpecialistDomains:['data-migration']}),['data-migration','memory-cloud-sync','security-deployment'],'declarations only add');
 }finally{for(const fixture of Object.values(fixtures))cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: scaled review plan sets typography only for markup or stylesheet content',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const page=(style,script,body)=>'<!doctype html>\n<style>\n'+style+'\n</style>\n<script>\n'+script+'\n</script>\n<body>\n'+body+'\n</body>\n';
 const basePage=page('.row { color: red; }','const limit = 3;\nrow.innerHTML = \'<span class="a">x</span>\';','<p>Old control</p>');
 const fixtures={
  stylesheet:makeScaledReviewFixture({base:{'styles.css':'#status { color: red; }\n'},candidate:{'styles.css':'#status { color: blue; }\n'}}),
  stylesheetComment:makeScaledReviewFixture({base:{'styles.css':'/* old note */\n#status { color: red; }\n'},candidate:{'styles.css':'/* clearer note */\n#status { color: red; }\n'}}),
  markup:makeScaledReviewFixture({base:{'index.html':basePage},candidate:{'index.html':basePage.replace('<p>Old control</p>','<p>New control</p>')}}),
  inlineStyle:makeScaledReviewFixture({base:{'index.html':basePage},candidate:{'index.html':basePage.replace('color: red','color: blue')}}),
  scriptTemplate:makeScaledReviewFixture({base:{'index.html':basePage},candidate:{'index.html':basePage.replace('class="a"','class="b"')}}),
  scriptLogic:makeScaledReviewFixture({base:{'index.html':basePage},candidate:{'index.html':basePage.replace('const limit = 3;','const limit = 4;')}}),
  moduleLogic:makeScaledReviewFixture({base:{'src/landscape.mjs':'const hue = 30;\n'},candidate:{'src/landscape.mjs':'const hue = 32;\n'}}),
  // Tests and tooling assert on markup strings but are never rendered to users.
  testMarkup:makeScaledReviewFixture({base:{'tests.js':'\n','scripts/agent-tools/report.mjs':'\n'},
   candidate:{'tests.js':"assert.match(html,/<p class=\"note\">/);\n",'scripts/agent-tools/report.mjs':"const row = '<td class=\"ok\">';\n"}}),
 };
 try{
  const typography=name=>deriveReleaseReviewPlan(fixtures[name].repo,fixtures[name].candidateSha,fixtures[name].baseSha).requiresTypographyReview;
  assert.equal(typography('stylesheet'),true,'stylesheet content needs typography review');
  assert.equal(typography('markup'),true,'page markup needs typography review');
  assert.equal(typography('inlineStyle'),true,'an inline style block is stylesheet content');
  assert.equal(typography('scriptTemplate'),true,'markup rendered from a script template is markup content');
  assert.equal(typography('scriptLogic'),false,'inline script logic is not markup');
  assert.equal(typography('moduleLogic'),false,'module logic is not markup');
  assert.equal(typography('stylesheetComment'),false,'a comment-only stylesheet edit changes no styling');
  assert.equal(typography('testMarkup'),false,'markup strings in tests and tooling are not rendered app markup');
 }finally{for(const fixture of Object.values(fixtures))cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: scaled review plan treats the test directory like the single test file',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const markupBase={'tests.js':'\n','tests/shared.js':'\n','tests/core.test.js':'\n'},markup="assert.match(html,/<p class=\"note\">/);\n";
 const commentBase="test('core: one',()=>{\n // old note\n assert.ok(true);\n});\n",commented=commentBase.replace('old note','clearer note');
 const fixtures={
  legacyMarkup:makeScaledReviewFixture({base:markupBase,candidate:{'tests.js':markup}}),
  sharedMarkup:makeScaledReviewFixture({base:markupBase,candidate:{'tests/shared.js':markup}}),
  areaMarkup:makeScaledReviewFixture({base:markupBase,candidate:{'tests/core.test.js':markup}}),
  legacyComment:makeScaledReviewFixture({base:{'tests.js':commentBase},candidate:{'tests.js':commented}}),
  sharedComment:makeScaledReviewFixture({base:{'tests/shared.js':commentBase},candidate:{'tests/shared.js':commented}}),
  areaComment:makeScaledReviewFixture({base:{'tests/core.test.js':commentBase},candidate:{'tests/core.test.js':commented}}),
 };
 try{
  const plan=name=>{const {changedFiles,...rest}=deriveReleaseReviewPlan(fixtures[name].repo,fixtures[name].candidateSha,fixtures[name].baseSha);return rest;};
  for(const kind of ['Markup','Comment'])for(const area of ['shared','area'])
   assert.deepEqual(plan(area+kind),plan('legacy'+kind),`${area} test file ${kind.toLowerCase()} edits derive the same review plan as tests.js`);
  assert.equal(plan('sharedMarkup').requiresTypographyReview,false,'markup strings in the shared test helpers are not rendered app markup');
 }finally{for(const fixture of Object.values(fixtures))cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: scaled review policy needs its committed AGENTS.md wording at both the exact head and base',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 const faqPolicy='Independent FAQ coverage review is required for every product release.\n';
 const app={base:{'src/landscape.mjs':'const hue = 30;\n'},candidate:{'src/landscape.mjs':'const hue = 32;\n'}};
 const fixtures={
  // The candidate that introduces the lighter policy is still reviewed under
  // the policy its base carries, so a diff cannot lower its own review bar.
  introducing:makeScaledReviewFixture({...app,agentsBase:faqPolicy,agentsHead:SCALED_REVIEW_POLICY_TEXT}),
  removing:makeScaledReviewFixture({...app,agentsBase:SCALED_REVIEW_POLICY_TEXT,agentsHead:faqPolicy}),
  rewrapped:makeScaledReviewFixture({...app,agentsBase:SCALED_REVIEW_POLICY_TEXT,agentsHead:SCALED_REVIEW_POLICY_TEXT.replace(/\s+/g,'\n  ')}),
 };
 try{
  const plan=name=>deriveReleaseReviewPlan(fixtures[name].repo,fixtures[name].candidateSha,fixtures[name].baseSha);
  const introducing=plan('introducing');
  assert.equal(introducing.schemaVersion,1,'an old-policy base keeps the old plan');
  assert.equal(introducing.requiresFaqReview,true,'an old-policy base keeps the separate FAQ review');
  assert.equal(Object.hasOwn(introducing,'requiresTypographyReview'),false);
  const removing=plan('removing');
  assert.equal(removing.schemaVersion,1,'a head without the wording returns to the old policy');
  assert.equal(removing.requiresFaqReview,true);
  assert.equal(plan('rewrapped').schemaVersion,2,'rewrapping the committed wording keeps the scaled policy');
 }finally{for(const fixture of Object.values(fixtures))cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: scaled receipts record FAQ coverage in the owner review instead of a separate reviewer',async()=>{
 const {recordReleaseEvidence,verifyReleaseEvidence}=await import('../scripts/release-evidence.mjs');
 const ordinary=makeScaledReviewFixture({base:{'src/landscape.mjs':'const hue = 30;\n'},candidate:{'src/landscape.mjs':'const hue = 32;\n'}});
 const docs=makeScaledReviewFixture({base:{'README.md':'Old note.\n'},candidate:{'README.md':'New note.\n'}});
 const coverage={result:'no-user-facing-change',summary:'The hue tweak changes no control, default or saved data the extended FAQ describes.'};
 try{
  const input=riskBasedReleaseInput(ordinary,{specialistReview:false});
  assert.throws(()=>recordReleaseEvidence(ordinary.repo,input),/FAQ coverage/,'product behavior needs the owner FAQ coverage result');
  const badResult=riskBasedReleaseInput(ordinary,{specialistReview:false,input:{ownerReview:{faqCoverage:{...coverage,result:'skipped'}}}});
  assert.throws(()=>recordReleaseEvidence(ordinary.repo,badResult),/FAQ coverage/);
  const vague=riskBasedReleaseInput(ordinary,{specialistReview:false,input:{ownerReview:{faqCoverage:{...coverage,summary:'fine'}}}});
  assert.throws(()=>recordReleaseEvidence(ordinary.repo,vague),/FAQ coverage/);
  const separate=riskBasedReleaseInput(ordinary,{specialistReview:false,input:{ownerReview:{faqCoverage:coverage}}});
  const faqPath=path.join(ordinary.root,'faq-review.md');fs.writeFileSync(faqPath,'A separate FAQ reviewer is no longer part of the plan.\n');
  separate.faqReview={...separate.independentReview,task:'/root/faq-review',evidencePath:faqPath,evidenceSha256:releaseGateHash(faqPath)};
  assert.throws(()=>recordReleaseEvidence(ordinary.repo,separate),/FAQ review/,'the scaled plan has no separate FAQ reviewer');
  const recorded=recordReleaseEvidence(ordinary.repo,riskBasedReleaseInput(ordinary,{specialistReview:false,input:{ownerReview:{faqCoverage:coverage}}}));
  assert.deepEqual(recorded.receipt.ownerReview.faqCoverage,coverage);
  assert.equal(verifyReleaseEvidence(ordinary.repo,ordinary.candidateSha).ok,true);
  const stripped=JSON.parse(fs.readFileSync(recorded.receiptPath,'utf8'));delete stripped.ownerReview.faqCoverage;releaseGateReseal(stripped);
  fs.writeFileSync(recorded.receiptPath,JSON.stringify(stripped));
  const tampered=verifyReleaseEvidence(ordinary.repo,ordinary.candidateSha);
  assert.equal(tampered.ok,false,'a resealed receipt cannot drop the owner FAQ coverage result');assert.match(tampered.errors.join(' '),/FAQ coverage/);
  recordReleaseEvidence(docs.repo,riskBasedReleaseInput(docs,{codeReview:false,specialistReview:false}));
  assert.equal(verifyReleaseEvidence(docs.repo,docs.candidateSha).ok,true,'documentation-only receipts need no FAQ coverage result');
 }finally{cleanupReleaseGateFixture(ordinary);cleanupReleaseGateFixture(docs);}
});

test('RISK repository process: scaled receipts publish the v=4 binding and cannot cross policy boundaries',async()=>{
 const {recordReleaseEvidence,verifyReleaseEvidence,publishReleaseStatuses}=await import('../scripts/release-evidence.mjs');
 const app={base:{'src/landscape.mjs':'const hue = 30;\n'},candidate:{'src/landscape.mjs':'const hue = 32;\n'}};
 const ordinary=makeScaledReviewFixture(app);
 const docs=makeScaledReviewFixture({base:{'README.md':'Old note.\n'},candidate:{'README.md':'New note.\n'}});
 const legacyInput=makeScaledReviewFixture(app);
 const introducing=makeScaledReviewFixture({...app,agentsBase:'Independent FAQ coverage review is required for every product release.\n'});
 try{
  const recorded=recordReleaseEvidence(ordinary.repo,riskBasedReleaseInput(ordinary,{specialistReview:false,input:{ownerReview:{faqCoverage:SCALED_FAQ_COVERAGE}}}));
  const statuses=[];await publishReleaseStatuses(ordinary.repo,ordinary.candidateSha,async status=>statuses.push(status));
  assert.deepEqual(statuses.map(status=>status.context).sort(),['funsidething/independent-review','funsidething/memory-audit','funsidething/specialist-review'],
   'all three required contexts are still published');
  assert.ok(statuses.every(status=>/;c=1;s=0;v=4$/.test(status.description)&&status.description.length<=140),'scaled receipts publish the new v=4 binding');
  recordReleaseEvidence(docs.repo,riskBasedReleaseInput(docs,{codeReview:false,specialistReview:false}));
  const docsStatuses=[];await publishReleaseStatuses(docs.repo,docs.candidateSha,async status=>docsStatuses.push(status));
  assert.ok(docsStatuses.every(status=>/;c=0;s=0;v=4$/.test(status.description)));
  assert.throws(()=>recordReleaseEvidence(legacyInput.repo,releaseGateInput(legacyInput)),/schemaVersion 2/,
   'the historical two-review receipt cannot stand in for a scaled-policy candidate');
  // Rebind the scaled receipt onto a candidate whose base predates the policy.
  const target=path.join(introducing.repo,'.git','funsidething-release-evidence',introducing.candidateSha);
  fs.cpSync(path.dirname(recorded.receiptPath),target,{recursive:true});
  const moved=JSON.parse(fs.readFileSync(recorded.receiptPath,'utf8'));
  moved.candidate={commitSha:introducing.candidateSha,treeSha:introducing.treeSha,baseSha:introducing.baseSha};
  for(const key of ['ownerReview','independentReview'])moved[key].reviewedSha=introducing.candidateSha;
  releaseGateReseal(moved);fs.writeFileSync(path.join(target,'receipt.json'),JSON.stringify(moved));
  assert.equal(verifyReleaseEvidence(introducing.repo,introducing.candidateSha).ok,false,'the scaled receipt is rejected for an old-policy candidate');
 }finally{for(const fixture of [ordinary,docs,legacyInput,introducing])cleanupReleaseGateFixture(fixture);}
});

test('RISK repository process: Pages accepts the v=4 binding only for scaled-policy candidates',async()=>{
 const {deriveReleaseReviewPlan,recordReleaseEvidence,publishReleaseStatuses,verifyDeploymentEvidence}=await import('../scripts/release-evidence.mjs');
 const app={base:{'src/landscape.mjs':'const hue = 30;\n'},candidate:{'src/landscape.mjs':'const hue = 32;\n'}};
 const scaled=makeScaledReviewFixture(app);
 const introducing=makeScaledReviewFixture({...app,agentsBase:'Independent FAQ coverage review is required for every product release.\n'});
 const mainSha='d'.repeat(40);
 const pages=(f,statuses,repoRoot=f.repo)=>verifyDeploymentEvidence({repoRoot,repository:'emerald-pham/funsidething',deployedSha:mainSha,beforeSha:f.baseSha,token:'fixture',
  fetchImpl:async url=>{
   const pathname=new URL(url).pathname;let body;
   if(pathname.endsWith('/commits/'+mainSha+'/pulls'))body=[{number:41,merge_commit_sha:mainSha,merged_at:new Date().toISOString(),base:{ref:'main'},head:{sha:f.candidateSha}}];
   else if(pathname.endsWith('/commits/'+mainSha))body={parents:[{sha:f.baseSha}],commit:{tree:{sha:f.treeSha}}};
   else if(pathname.endsWith('/commits/'+f.candidateSha+'/statuses'))body=statuses.map((row,i)=>({...row,created_at:new Date(Date.now()+i).toISOString()}));
   else if(pathname.endsWith('/commits/'+f.candidateSha))body={commit:{tree:{sha:f.treeSha}}};
   else if(pathname.includes('/compare/'))body={status:'ahead'};else throw Error(pathname);
   return {ok:true,status:200,json:async()=>body};
  }});
 const rebind=(statuses,from,to)=>statuses.map(row=>({...row,description:row.description.replace(from,to)}));
 try{
  const recorded=recordReleaseEvidence(scaled.repo,riskBasedReleaseInput(scaled,{specialistReview:false,input:{ownerReview:{faqCoverage:SCALED_FAQ_COVERAGE}}}));
  const statuses=[];await publishReleaseStatuses(scaled.repo,scaled.candidateSha,async row=>statuses.push(row));
  const accepted=await pages(scaled,statuses);
  assert.equal(accepted.ok,true,accepted.errors.join('; '));
  assert.deepEqual([accepted.reviewedSha,accepted.treeSha,accepted.baseSha,accepted.receiptSha256],
   [scaled.candidateSha,scaled.treeSha,scaled.baseSha,recorded.receipt.receiptSha256],'Pages still binds the exact head, tree, base and receipt digest');
  for(const older of [';v=2',';v=3'])assert.equal((await pages(scaled,rebind(statuses,';v=4',older))).ok,false,older+' cannot authorize a scaled-policy candidate');
  const legacy=statuses.map(row=>({...row,description:'receipt-sha256='+recorded.receipt.receiptSha256+';base='+scaled.baseSha}));
  assert.equal((await pages(scaled,legacy)).ok,false,'the schema-1 binding cannot authorize a scaled-policy candidate');
  const unknownHead=path.join(scaled.root,'empty');fs.mkdirSync(unknownHead);releaseGateGit(unknownHead,['init','-q']);
  assert.equal((await pages(scaled,statuses,unknownHead)).ok,false,'v=4 fails closed when the exact head policy cannot be read');

  const plan=deriveReleaseReviewPlan(introducing.repo,introducing.candidateSha,introducing.baseSha);assert.equal(plan.requiresFaqReview,true);
  const input=riskBasedReleaseInput(introducing,{specialistReview:plan.requiresSpecialistReview,domains:plan.specialistDomains});
  const faqPath=path.join(introducing.root,'faq.md');fs.writeFileSync(faqPath,'Reviewed changed controls, saved data, defaults and complete FAQ coverage.\n');
  input.faqReview={...input.independentReview,task:'/root/faq-distinct-reviewer',evidencePath:faqPath,evidenceSha256:releaseGateHash(faqPath)};
  recordReleaseEvidence(introducing.repo,input);
  const historical=[];await publishReleaseStatuses(introducing.repo,introducing.candidateSha,async row=>historical.push(row));
  assert.ok(historical.every(row=>/;v=3$/.test(row.description)),'an old-policy candidate keeps its FAQ binding');
  assert.equal((await pages(introducing,historical)).ok,true,'historical v=3 bindings still verify for their own candidates');
  assert.equal((await pages(introducing,rebind(historical,';v=3',';v=4'))).ok,false,'v=4 is rejected for an old-policy candidate');
 }finally{cleanupReleaseGateFixture(scaled);cleanupReleaseGateFixture(introducing);}
});

test('RISK repository process: the repository AGENTS.md wording switches on the scaled review policy',async()=>{
 const {deriveReleaseReviewPlan}=await import('../scripts/release-evidence.mjs');
 // Guidance cleanups must keep the exact sentence the release validator reads.
 const agents=fs.readFileSync(path.join(__dirname,'AGENTS.md'),'utf8');
 const f=makeScaledReviewFixture({agentsBase:agents,agentsHead:agents,base:{'src/landscape.mjs':'const hue = 30;\n'},candidate:{'src/landscape.mjs':'const hue = 32;\n'}});
 try{
  const plan=deriveReleaseReviewPlan(f.repo,f.candidateSha,f.baseSha);
  assert.equal(plan.schemaVersion,2,'the committed AGENTS.md must carry the scaled review policy wording');
  assert.equal(plan.requiresFaqReview,false);assert.equal(plan.requiresOwnerFaqCoverage,true);
 }finally{cleanupReleaseGateFixture(f);}
});

test('RISK repository process: deployment fetches deleted squash PR head and rejects ref identity mismatch',async()=>{
 const {recordReleaseEvidence,publishReleaseStatuses,verifyDeploymentEvidence}=await import('../scripts/release-evidence.mjs'),f=makeReleaseGateFixture();
 try{
  recordReleaseEvidence(f.repo,releaseGateInput(f));const statuses=[];await publishReleaseStatuses(f.repo,f.candidateSha,async row=>statuses.push({...row,created_at:new Date().toISOString()}));
  releaseGateGit(f.repo,['update-ref','refs/pull/78/head',f.candidateSha]);const squash=releaseGateGit(f.repo,['commit-tree',f.treeSha,'-p',f.baseSha,'-m','Squash reviewed change']);const checkout=path.join(f.root,'deployed');fs.mkdirSync(checkout);releaseGateGit(checkout,['init','-q']);releaseGateGit(checkout,['remote','add','origin',f.repo]);releaseGateGit(checkout,['fetch','-q','origin',squash]);releaseGateGit(checkout,['checkout','-q','--detach','FETCH_HEAD']);
  assert.notEqual(spawnSync('git',['-C',checkout,'cat-file','-e',f.candidateSha+'^{commit}']).status,0,'squashed full main history lacks deleted PR head');
  const fetchImpl=async url=>{const p=new URL(url).pathname;let body;if(p.endsWith('/commits/'+squash+'/pulls'))body=[{number:78,merge_commit_sha:squash,merged_at:new Date().toISOString(),base:{ref:'main'},head:{sha:f.candidateSha}}];else if(p.endsWith('/commits/'+squash))body={parents:[{sha:f.baseSha}],commit:{tree:{sha:f.treeSha}}};else if(p.endsWith('/commits/'+f.candidateSha+'/statuses'))body=statuses;else if(p.endsWith('/commits/'+f.candidateSha))body={commit:{tree:{sha:f.treeSha}}};else if(p.includes('/compare/'))body={status:'ahead'};else throw Error(p);return{ok:true,status:200,json:async()=>body};};
  const result=await verifyDeploymentEvidence({repoRoot:checkout,repository:'emerald-pham/funsidething',deployedSha:squash,beforeSha:f.baseSha,token:'fixture',fetchImpl});assert.equal(result.ok,true,result.errors.join('; '));assert.equal(releaseGateGit(checkout,['rev-parse',f.candidateSha+'^{commit}']),f.candidateSha);
  const wrong=path.join(f.root,'wrong');fs.mkdirSync(wrong);releaseGateGit(wrong,['init','-q']);releaseGateGit(wrong,['remote','add','origin',f.repo]);releaseGateGit(wrong,['fetch','-q','origin',squash]);releaseGateGit(wrong,['checkout','-q','--detach','FETCH_HEAD']);releaseGateGit(f.repo,['update-ref','refs/pull/78/head',f.baseSha]);const rejected=await verifyDeploymentEvidence({repoRoot:wrong,repository:'emerald-pham/funsidething',deployedSha:squash,beforeSha:f.baseSha,token:'fixture',fetchImpl});assert.equal(rejected.ok,false,'moved PR ref must not authorize another head');assert.match(rejected.errors.join(' '),/exact|match|head/i);
 }finally{cleanupReleaseGateFixture(f);}
});

test('RISK repository process boundary: actual visual tests compare every changed control with neighboring controls and scrolled states',()=>{
 for(const name of ['CLAUDE.md','RELEASE_GATES.md']){
  const guide=fs.readFileSync(path.join(__dirname,name),'utf8').replace(/\s+/g,' ');assert.match(guide,/Actual visual tests are mandatory/,'review guidance must require executed visual tests, not screenshot presence alone');
  assert.match(guide,/computed color scheme and paint/i,'theme labels must not substitute for actual applied colors');assert.match(guide,/theme labels alone.*not.*coverage/i);
  assert.match(guide,/changed control.*established neighboring control/i);assert.match(guide,/top, middle and end.*scroll/i);assert.match(guide,/day and night.*enlarged/i);assert.match(guide,/screenshots in isolation.*not.*pass/i);
 }
});
test('RISK repository process: preflight catches outgoing upstream rationale gaps after the selected base passes',async t=>{
 const os=await import('node:os'),fixture=fs.mkdtempSync(path.join(os.tmpdir(),'chain-preflight-outgoing-'));
 t.after(()=>fs.rmSync(fixture,{recursive:true,force:true}));
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:fixture,encoding:'utf8',env});assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout.trim();};
 const run=(...args)=>spawnSync(process.execPath,args,{cwd:fixture,encoding:'utf8',env});
 fs.mkdirSync(path.join(fixture,'scripts'));fs.mkdirSync(path.join(fixture,'tests'));
 fs.copyFileSync(path.join(__dirname,'scripts/test-first-gate.mjs'),path.join(fixture,'scripts/test-first-gate.mjs'));
 fs.writeFileSync(path.join(fixture,'TEST_CHANGE_RATIONALES.json'),'[]\n');
 const selected="import {test} from 'node:test';\ntest('Landscape location: visible default-sky copy does not name Orlando',()=>{});\ntest('RISK Quick start content: essential steps stay brief and detailed help remains user-facing in existing sections',()=>{});\n";
 fs.writeFileSync(path.join(fixture,'tests/core.test.js'),selected);
 git('init','-b','main');git('config','user.name','Preflight regression fixture');git('config','user.email','fixture@example.invalid');
 git('add','.');git('commit','-m','selected comparison');const selectedBase=git('rev-parse','HEAD');
 git('switch','-c','task');
 fs.writeFileSync(path.join(fixture,'tests/core.test.js'),selected+"test('published branch test',()=>{});\n");
 git('add','tests/core.test.js');git('commit','-m','published task tip');const outgoing=git('rev-parse','HEAD');
 const remote=path.join(fixture,'remote.git');git('init','--bare',remote);git('remote','add','origin',remote);git('push','-u','origin','task');
 fs.writeFileSync(path.join(fixture,'tests/core.test.js'),selected);git('add','tests/core.test.js');git('commit','-m','restore selected base tests');
 const selectedGate=run('scripts/test-first-gate.mjs',selectedBase),outgoingGate=run('scripts/test-first-gate.mjs',outgoing);
 assert.equal(selectedGate.status,0,selectedGate.stderr);assert.equal(outgoingGate.status,1,outgoingGate.stderr);
 assert.match(outgoingGate.stderr,/without an exact-diff rationale/,'real existing rationale gate distinguishes the outgoing delta');
 const before={refs:git('show-ref'),head:git('rev-parse','HEAD'),status:git('status','--porcelain','--untracked-files=no'),config:git('config','--local','--list')};
 const result=run(path.join(__dirname,'scripts/agent-tools/preflight.mjs'),'--base',selectedBase),output=result.stdout+result.stderr;
 assert.equal(result.status,1,`selected-base validation passed, but preflight must reject the missing outgoing rationale:\n${output}`);
 assert.match(output,/upstream/i,'failure identifies the outgoing upstream comparison');assert.match(output,/without an exact-diff rationale/);
 assert.equal((output.match(/^✔ Landscape location:/gm)||[]).length,1);assert.equal((output.match(/^✔ RISK Quick start content:/gm)||[]).length,1);
 assert.equal((output.match(/Test-first diff gate passed\./g)||[]).length,1,'selected-base rationale runs once before upstream rejects');
 assert.deepEqual({refs:git('show-ref'),head:git('rev-parse','HEAD'),status:git('status','--porcelain','--untracked-files=no'),config:git('config','--local','--list')},before,'preflight preserves local refs, HEAD, tracked files and configuration');
});


test('RISK repository process: large immutable installed assets retain exact bytes and reject a changed checkout',async t=>{
 const {runInstalledClientCase}=await import('../scripts/installed-client-regression.mjs');
 const git=(...args)=>{const result=spawnSync('git',args,{cwd:__dirname,maxBuffer:16*1024*1024});assert.equal(result.status,0,String(result.stderr));return result.stdout;};
 const sha=git('rev-parse','HEAD').toString().trim(),tree=git('rev-parse','HEAD^{tree}').toString().trim();
 const original=git('show',sha+':index.html');assert.ok(original.length>1024*1024,'the real committed candidate exceeds the former default Git buffer');
 const directory=fs.mkdtempSync(path.join((await import('node:os')).tmpdir(),'installed-asset-boundary-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 // Read-only Git metadata points to this checkout; only the isolated local asset
 // differs. The actual immutable shell reader must finish before its exact-byte guard.
 fs.writeFileSync(path.join(directory,'.git'),'gitdir: '+git('rev-parse','--absolute-git-dir').toString().trim()+'\n');
 fs.writeFileSync(path.join(directory,'index.html'),Buffer.concat([original,Buffer.from('changed checkout')]));
 await assert.rejects(runInstalledClientCase({mode:'signed-out',repo:directory,oldCommit:'779defa4e8c3465fdf535fe17dbe2227d2b76ea1',candidateCommit:sha,candidateTree:tree,outputDir:path.join(directory,'evidence')}),/checkout app asset differs from explicit candidate: index\.html/,'large immutable Git bytes must reach the existing dirty-asset refusal before browser or server allocation');
 assert.equal(fs.existsSync(path.join(directory,'evidence')),false,'refused source identity cannot produce a native delivery report');
});

test('RISK repository process: event routing retains exact merge validation before avoiding a duplicate cohort',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-name-pattern=workflow avoids a second complete cohort',path.join(__dirname,'scripts/agent-tools/ci-routing.test.mjs')],{cwd:__dirname,encoding:'utf8',timeout:30000,env});
 assert.equal(result.status,0,'The public workflow cohort command must preserve exact canonical merge validation: '+result.stdout+'\n'+result.stderr);
});

test('RISK repository process: unchanged CI inputs reuse an original successful gate across events',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^workflow reuses an independently passed gate on main for the same complete inputs$','scripts/agent-tools/ci-routing.test.mjs'],{cwd:__dirname,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 const output=(result.stdout||'')+'\n'+(result.stderr||'');
 assert.equal(result.error,undefined,'The public CI reuse consumer must start: '+output);
 assert.equal(result.status,0,'Equivalent complete inputs must retain their original successful gate: '+output);
 assert.match(result.stdout||'',/^# tests 1$/m);assert.match(result.stdout||'',/^# skipped 0$/m);
});

test('RISK repository process: large original CI artifacts retain verified coverage without buffering native reports',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^workflow input reuse retains large original native evidence and rejects changed bytes$','scripts/agent-tools/ci-routing.test.mjs'],{cwd:__dirname,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout||'',/^# tests 4$/m);assert.match(result.stdout||'',/^# skipped 0$/m);
});

test('RISK repository process: released host locks cannot cause spurious CI migration failures',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^migration accepts a live token lock released during ownership inspection$','scripts/agent-tools/coordination.test.mjs'],{cwd:__dirname,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout||'',/^# tests 1$/m);assert.match(result.stdout||'',/^# skipped 0$/m);
});

test('RISK repository process: CI admission enforces reuse before repeating a passed test child',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^test group workflow consumer forbids duplicate execution for a verified input pass$','scripts/agent-tools/test-groups.test.mjs'],{cwd:__dirname,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 const output=(result.stdout||'')+'\n'+(result.stderr||'');
 assert.equal(result.error,undefined,'The actual workflow reuse guard must start: '+output);
 assert.equal(result.status,0,'CI must reject any route that repeats an already passed test child: '+output);
 assert.match(result.stdout||'',/^# tests 1$/m);assert.match(result.stdout||'',/^# skipped 0$/m);
});

test('RISK repository process: CI observer keeps honest reuse and fresh emulator fallback outcomes',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^test group aggregate preserves observer protocol across emulator coverage and fresh fallback$','scripts/agent-tools/test-groups.test.mjs'],{cwd:__dirname,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout||'',/^# tests 5$/m);assert.match(result.stdout||'',/^# skipped 0$/m);
});

test('RISK repository process: grouped runner stays covered at the default npm test boundary',t=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^test group runner (executes a complete isolated group with bound identity|keeps oversized group selections below the portable argument limit|binds native tests to the actual checkout commit and tree|reconciles a renamed root and preserves baseline case identities)$','scripts/agent-tools/test-groups.test.mjs'],{cwd:__dirname,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 const output=[result.stdout,result.stderr].filter(Boolean).join('\n');t.diagnostic(output);
 assert.equal(result.error,undefined,'The grouped runner process contract must start: '+(result.error?.message||output));
 assert.equal(result.signal,null,'The focused group runner process contract must finish: '+output);
 assert.equal(result.status,0,'The default full-suite boundary must keep focused group runner coverage live: '+output);
 assert.match(result.stdout||'',/^# tests 4$/m,'Isolated group, portable pattern sizing, actual-checkout identity, and captured-baseline reconciliation contracts must run');
 assert.match(result.stdout||'',/^# skipped 0$/m,'The runner contract cannot pass through a skip');
});

test('RISK repository process: required parallel scanner aggregation rejects absent group evidence',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-name-pattern=^test group workflow scanner command rejects missing parallel group evidence$',path.join(__dirname,'scripts/agent-tools/test-groups.test.mjs')],{cwd:__dirname,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,'The executed scanner aggregate must fail closed on absent required group evidence: '+result.stdout+'\n'+result.stderr);
});

test('RISK repository process: grouped catalog binds real declarations rather than quoted fixtures',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^test group catalog routes real declarations despite matching quoted fixture text$','scripts/agent-tools/test-groups.test.mjs'],{cwd:__dirname,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 const output=(result.stdout||'')+'\n'+(result.stderr||'');
 assert.equal(result.error,undefined,'The public catalog ownership regression must start: '+output);
 assert.equal(result.status,0,'Real declarations must be classified and execute once despite quoted fixture copies: '+output);
 assert.match(result.stdout||'',/^# tests 1$/m);assert.match(result.stdout||'',/^# skipped 0$/m);
});

test('RISK repository process: nested native fixture output stays isolated at the command boundary',t=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^test group runner reconciles complete full and grouped fixture cohorts$','scripts/agent-tools/test-groups.test.mjs'],{cwd:__dirname,env,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 const output=[result.stdout,result.stderr].filter(Boolean).join('\n');t.diagnostic(output);
 assert.equal(result.error,undefined,'The isolated nested fixture cohort must start: '+output);
 assert.equal(result.signal,null,'The isolated nested fixture cohort must finish: '+output);
 assert.equal(result.status,0,'A nested fixture with its own native output directory must succeed: '+output);
 assert.match(result.stdout||'',/^# tests 1$/m,'Exactly one real grouped-fixture contract must run');
 assert.match(result.stdout||'',/^# pass 1$/m);assert.match(result.stdout||'',/^# fail 0$/m);
 assert.match(result.stdout||'',/^# skipped 0$/m,'The command-boundary contract cannot pass through a skip');
 assert.match(result.stdout||'',/^# Nested output negative control:.*ENOENT: no such file or directory, open .*candidate-identity\.json/m,
  'The unisolated inherited-output child must actually fail before the isolated child proves success');
});
