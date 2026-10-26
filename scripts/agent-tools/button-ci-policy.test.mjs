import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const routes=[
 ['canonical-pr-merge-v1','pull_request','refs/pull/285/merge'],
 ['outgoing-branch-push-v1','push','refs/heads/integration/webkit-button-safety'],
 ['exact-main-push-v1','push','refs/heads/main'],
 ['pull_request','pull_request','refs/pull/285/merge'],
 ['push','push','refs/heads/fixture'],
];
function boundary(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-hosted-policy-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const output=path.join(directory,'intentional-file-not-directory');fs.writeFileSync(output,'policy-boundary-sentinel');return output;}
function invoke(kind,output,env){
 // Only the OS admission boundary is simulated for the capped controller. The
 // intentional filesystem stop occurs before Git identity or Docker. No cap,
 // kernel, browser or hosted success is inferred from this process fixture.
 const args=kind==='native'?['scripts/button-safety.mjs','--run','--engine','webkit','--probe','--port','0','--output-dir',output]:['--input-type=module','-e',`Object.defineProperty(process,'platform',{value:'linux'});const {runCappedMobile}=await import('./scripts/button-safety-mobile-memory.mjs');try{await runCappedMobile({outputDir:process.env.POLICY_TEST_OUTPUT});}catch(error){process.stderr.write(error.message+'\\n');process.exitCode=1;}`];
 const result=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,...env,POLICY_TEST_OUTPUT:output},encoding:'utf8',timeout:5000,maxBuffer:1024*1024});assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.notEqual(result.status,0);assert.equal(fs.readFileSync(output,'utf8'),'policy-boundary-sentinel');return result;
}
test('hosted button consumers admit routed event policies before their runtime boundary',async t=>{
 for(const [policy,event,ref]of routes)for(const kind of ['native','memory'])await t.test(kind+' '+policy,sub=>{
  const result=invoke(kind,boundary(sub),{CI:'true',CHAIN_TEST_EVENT_POLICY:policy,GITHUB_EVENT_NAME:event,GITHUB_REF:ref});assert.match(result.stderr,/EEXIST|file already exists/,'The actual consumer must admit the configured route before the deliberate filesystem stop: '+result.stderr);
 });
});
test('hosted button consumers reject invalid missing mismatched and local launches',async t=>{
 const invalid=[
  ['missing policy',{CHAIN_TEST_EVENT_POLICY:''}],['unknown policy',{CHAIN_TEST_EVENT_POLICY:'local'}],['missing raw event',{GITHUB_EVENT_NAME:''}],
  ['mismatched raw event',{GITHUB_EVENT_NAME:'push'}],['PR policy on branch ref',{GITHUB_REF:'refs/heads/fixture'}],
  ['main policy on branch',{CHAIN_TEST_EVENT_POLICY:'exact-main-push-v1',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/fixture'}],
  ['branch policy on main',{CHAIN_TEST_EVENT_POLICY:'outgoing-branch-push-v1',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main'}],
  ['local launch',{CI:'false',CODEX_COORDINATION_FILE:'',DOW_EMULATOR_COORDINATION_FILE:''}],
 ];
 for(const [name,env]of invalid)for(const kind of ['native','memory'])await t.test(kind+' '+name,sub=>{const result=invoke(kind,boundary(sub),{CI:'true',CHAIN_TEST_EVENT_POLICY:'canonical-pr-merge-v1',GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/pull/285/merge',...env});assert.doesNotMatch(result.stderr,/EEXIST|file already exists/,'Invalid admission must stop before filesystem/runtime work');});
});

test('hosted child and memory artifacts preserve raw policy and distinct source checkout identity',async t=>{
 const {containerArgs}=await import('../button-safety-mobile-memory.mjs');
 const {createMobileBundle,refreshMobileBundle}=await import('./mobile-memory-fixture.mjs');
 const {verifyMobileMemoryReport}=await import('../button-safety-mobile-contract.mjs');
 const policy={eventPolicy:'canonical-pr-merge-v1',eventName:'pull_request',eventRef:'refs/pull/285/merge'};
 const args=containerArgs({repo:'/fixture/repo',output:'/fixture/output',nodeBinary:'/fixture/node22',motion:'normal',control:false,...policy});
 for(const value of ['CHAIN_TEST_EVENT_POLICY='+policy.eventPolicy,'GITHUB_EVENT_NAME='+policy.eventName,'GITHUB_REF='+policy.eventRef])assert.ok(args.includes(value),'Capped child must receive distinct raw/routed values');
 const create=owner=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-policy-artifacts-'));owner.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const bundle=createMobileBundle(directory,{sourceSha:'c'.repeat(40),eventPolicy:policy.eventPolicy});bundle.report.hostedPolicy={...policy};for(const row of [bundle.report.negativeControl,...bundle.report.cases])row.hostedPolicy={...policy};for(const native of Object.values(bundle.native))native.hostedPolicy={...policy};refreshMobileBundle(bundle);return bundle;};
 const verify=b=>verifyMobileMemoryReport(b.report,{artifactRoot:b.directory,candidateCommit:'a'.repeat(40),candidateTree:'b'.repeat(40),sourceSha:'c'.repeat(40),eventPolicy:policy.eventPolicy});
 assert.equal(verify(create(t)).status,'passed','Controlled parser witness only; no actual cap receipt');
 for(const [name,mutate]of [
  ['missing routed/raw metadata',b=>{delete b.report.hostedPolicy;}],
  ['raw event mismatch',b=>{b.report.hostedPolicy.eventName='push';}],
  ['wrong child policy',b=>{b.report.cases[0].hostedPolicy.eventPolicy='pull_request';}],
  ['wrong native policy',b=>{b.native.normal.hostedPolicy.eventPolicy='pull_request';}],
  ['source confused with checkout',b=>{b.report.sourceSha=b.report.candidateCommit;}],
 ])await t.test(name,sub=>{const bundle=create(sub);mutate(bundle);refreshMobileBundle(bundle);assert.throws(()=>verify(bundle));});
});
