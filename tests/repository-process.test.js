import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
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

test('RISK test-first gate: tests stay required for app changes and new RISK tests only for high-risk or enforcement files',async()=>{
 const {validateTestFirst}=await import('../scripts/test-first-gate.mjs');
 const ordinary=['+test("scan: ordinary direct test",()=>{})'],processRisk=['+test("RISK test-first gate: process coverage",()=>{})'];
 assert.match(validateTestFirst(['location.js'],[]).join(' '),/without a tests\/ file/,'an app change without tests is rejected');
 assert.deepEqual(validateTestFirst(['landscape.css','tests/core.test.js'],ordinary),[],'a CSS-only change passes with a direct non-RISK test');
 assert.deepEqual(validateTestFirst(['icon-192.png','tests/core.test.js'],ordinary),[],'a static-asset change passes with a direct non-RISK test');
 assert.match(validateTestFirst(['landscape.js','tests/core.test.js'],ordinary).join(' '),/RISK/,'a high-risk JS change without a new RISK test is rejected');
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
 const riskFiles=['index.html','location.js','stars.js','landscape.js','landscape-appearance.js','landscape-riders.js','landscape-seasonal.js','landscape-skywriter.js','landscape-winter.js','sw.js','manifest.webmanifest','firestore.rules','features/new-module.js'];
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
  const candidate={localRef:'refs/heads/release',localSha:fixture.candidateSha,remoteRef:'refs/heads/release',remoteSha:'0'.repeat(40)};
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
