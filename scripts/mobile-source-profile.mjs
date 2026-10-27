#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest,sourceButtonTemplates} from './button-safety-contract.mjs';

export const PROFILE_FILE='scripts/mobile-source-profile.json';
export const MOBILE_SOURCE_SCENARIO='rapid scanner candidate actions with 400 active tasks';
export const MODAL_SOURCE_SCENARIO='rapid scene time presets, lock, live time, and close';
const scopes=[
 {id:'required-mobile-story',engine:'webkit',scenario:MOBILE_SOURCE_SCENARIO,motions:['normal','reduced']},
 {id:'confirmed-modal-release',engine:'chromium',scenario:MODAL_SOURCE_SCENARIO,motions:[null]},
];
const objectDigest=value=>digest(JSON.stringify(value));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export function currentApplication(repo){
 const result=spawnSync('git',['ls-files'],{cwd:repo,encoding:'utf8'});
 assert.equal(result.status,0,'Application file inventory must be available');
 const original=JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8'));
 const files=result.stdout.trim().split('\n').filter(file=>file!=='tests.js'&&!file.startsWith('scripts/')&&(/\.(?:html|js|css|svg|png|webmanifest)$/.test(file)||Object.hasOwn(original.requiredRuntimeAssets,file)));
 const sources=new Map(files.map(file=>[file,fs.readFileSync(path.join(repo,file))]));
 return {assets:Object.fromEntries([...sources].map(([file,bytes])=>[file,digest(bytes)])),source:[...sources].filter(([file])=>/\.(?:js|html)$/.test(file)).map(([,bytes])=>bytes.toString()).join('\n')};
}

export function checkProfile({repo,source,assets,engine,motion,scenario,control=null,probe=false,profileFile=path.join(repo,PROFILE_FILE)}){
 assert.equal(control,null,'Sensitivity controls cannot use the limited source profile');
 assert.equal(probe,false,'Probes cannot use the limited source profile');
 const scope=scopes.find(row=>row.engine===engine&&row.scenario===scenario&&row.motions.includes(motion));
 assert.ok(scope,'Only the original mobile story and confirmed modal harness may use this source profile');
 const bytes=fs.readFileSync(profileFile),profile=JSON.parse(bytes);
 assert.deepEqual(Object.keys(profile).sort(),['allowedScopes','applicationAssets','id','originalInventorySha256','schemaVersion','sourceBaselineSha','sourceSha256','sourceTemplates'].sort(),'Unknown or omitted profile fields');
 assert.equal(profile.schemaVersion,1);assert.equal(profile.id,'canonical-mobile-modal-source-v1');
 assert.match(profile.sourceBaselineSha,/^[a-f0-9]{40}$/);
 assert.deepEqual(profile.allowedScopes,scopes,'A data profile cannot expand admitted consumer scopes');
 const application=currentApplication(repo);
 assert.deepEqual(application.assets,profile.applicationAssets,'Canonical application assets drifted from the reviewed limited profile');
 if(assets!==undefined)assert.deepEqual(assets,profile.applicationAssets,'Actual served/report assets must bind the complete reviewed app');
 assert.equal(digest(application.source),profile.sourceSha256,'Current source profile is stale');
 assert.equal(digest(source),profile.sourceSha256,'Actual consumer source must equal the reviewed canonical source');
 assert.deepEqual(sourceButtonTemplates(source),profile.sourceTemplates,'Canonical source templates drifted');
 const inventoryBytes=fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'));
 assert.equal(digest(inventoryBytes),profile.originalInventorySha256,'Saved full native inventory must remain unchanged');
 return {schemaVersion:1,profileId:profile.id,profileSha256:digest(bytes),applicationAssetsSha256:objectDigest(profile.applicationAssets),sourceSha256:profile.sourceSha256,originalInventorySha256:profile.originalInventorySha256,scope:scope.id,engine,scenario,motion,coverage:'limited consumer only; no full native action coverage'};
}

export function verifyProfiledNativeReport(report,{repo=root,candidateCommit,candidateTree}={}){
 for(const [key,value]of Object.entries({candidateCommit,candidateTree}))if(value!==undefined)assert.equal(report[key],value,'Limited source report actual checkout '+key);
 const binding=report.sourceProfile;assert.ok(binding,'Actual native source-profile admission evidence is required');
 assert.ok(['required-mobile-story','confirmed-modal-release'].includes(binding.scope));
 assert.equal(report.kind,binding.scope==='required-mobile-story'?'button-mobile-functional':'button-diagnostic','Source profile cannot qualify full native action coverage');
 if(report.mobileAttempt)assert.equal(binding.motion,report.mobileAttempt.motion,'Profile motion must match actual pre-attempt setup');
 if(report.mobileStory)assert.equal(binding.motion,report.mobileStory.motion,'Profile motion must match actual completed story');
 const actual=currentApplication(repo);
 const expected=checkProfile({repo,source:actual.source,assets:report.assets,engine:report.engine,motion:binding.motion,scenario:binding.scenario});
 assert.deepEqual(binding,expected,'Raw native profile identity or scope mismatch');
 if(report.status==='passed'){assert.equal(report.scenarios?.length,1);assert.equal(report.scenarios[0].name,binding.scenario);}
 return binding;
}

function main(){
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i++){
  const key=args[i];assert.ok(['--check','--source','--profile','--engine','--motion','--scenario','--control','--probe'].includes(key),'Unknown source-profile option: '+key);
  assert.equal(options[key],undefined);options[key]=['--check','--probe'].includes(key)?true:args[++i];assert.ok(options[key]);
 }
 assert.equal(options['--check'],true);assert.ok(options['--source']);
 const binding=checkProfile({repo:root,source:fs.readFileSync(options['--source'],'utf8'),engine:options['--engine'],motion:options['--motion']==='none'?null:options['--motion'],scenario:options['--scenario'],control:options['--control']||null,probe:options['--probe']||false,...(options['--profile']?{profileFile:options['--profile']}:{})});
 process.stdout.write('Limited canonical source admitted.\n'+JSON.stringify(binding)+'\n');
}
if(path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url))try{main();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
