#!/usr/bin/env node
// NONMERGEABLE observation only; native action assertions and exits are retained.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hostedButtonPolicy} from './button-safety-ci-policy.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function recordExistingPhase(record,phase,work,now=()=>performance.now()){
 if(!record)return work();const start=now(),finish=error=>{if(record.phases.length<24)record.phases.push({phase,startMs:start-record.nodeOriginMs,durationMs:now()-start,...(error?{errorName:error.name||'Error'}:{})});};
 try{return work().then(value=>{finish();return value;},error=>{finish(error);throw error;});}catch(error){finish(error);throw error;}
}
export async function captureBurstTiming(record,collect,frozenWindowMs=null){
 if(!record||record.collected)return;record.windowMs=frozenWindowMs;record.collected=true;
 try{const snapshot=await collect();if(typeof snapshot?.heartbeatAtAssertion?.maxGapMs!=='number')throw Error('Missing diagnostic heartbeat');Object.assign(record,snapshot);record.collectionError=null;}catch(error){record.collectionError={name:error.name||'Error'};}
}
// These functions are serialized into the page; keep them self-contained.
export function browserTimingInit(){
 if(window.top!==window)return;
 window.__buttonDiagnostic={active:false,pasteActive:false,actions:[],frames:[],pasteEvents:[],droppedActions:0,droppedFrames:0,droppedPaste:0,scan:{calls:0,totalMs:0,maxMs:0,bindingCallMs:0}};
 window.__buttonDiagnosticFrame=(now,gapMs)=>{const d=window.__buttonDiagnostic;if(d.active){if(d.frames.length<512)d.frames.push({at:performance.timeOrigin+now,gapMs,decisionBusy:typeof decisionRecoveryBusy!=='undefined'&&!!decisionRecoveryBusy,cloudBusy:typeof cloudSourceRecoveryBusy!=='undefined'&&!!cloudSourceRecoveryBusy});else d.droppedFrames++;}};
 document.addEventListener('paste',event=>{const d=window.__buttonDiagnostic;if(d.pasteActive&&event.target?.id==='jsonBox'){if(d.pasteEvents.length<32){const row={consumerCaptureAt:performance.timeOrigin+performance.now()};d.pasteEvents.push(row);d.currentPaste=row;}else{d.droppedPaste++;d.currentPaste=null;}}},true);
}
export function resetBrowserTiming(mode){const d=window.__buttonDiagnostic;if(!d)return;d.active=mode==='burst';d.pasteActive=mode==='paste';d.actions=[];d.frames=[];d.pasteEvents=[];d.currentPaste=null;d.droppedActions=0;d.droppedFrames=0;d.droppedPaste=0;d.scan={calls:0,totalMs:0,maxMs:0,bindingCallMs:0};}
export function installActionTiming(){
 const original=onAction;onAction=function(...args){const d=window.__buttonDiagnostic;if(!d?.active)return Reflect.apply(original,this,args);const enterAt=performance.timeOrigin+performance.now();let value,threw=true;try{value=Reflect.apply(original,this,args);threw=false;return value;}finally{if(d.actions.length<128)d.actions.push({action:typeof args[0]==='string'?args[0].slice(0,80):'unknown',enterAt,returnAt:performance.timeOrigin+performance.now(),returnedPromise:value instanceof Promise,threw});else d.droppedActions++;}};
 document.addEventListener('paste',event=>{const d=window.__buttonDiagnostic;if(d?.pasteActive&&event.target?.id==='jsonBox'&&d.currentPaste)d.currentPaste.consumerBubbleAfterAt=performance.timeOrigin+performance.now();});
}
export function drainBrowserTiming(){const d=window.__buttonDiagnostic;if(!d)return{};d.active=false;d.pasteActive=false;return{browserActions:d.actions,browserFrames:d.frames,pasteEvents:d.pasteEvents,scan:d.scan,bufferDropped:{actions:d.droppedActions,frames:d.droppedFrames,paste:d.droppedPaste},heartbeatAtAssertion:{...window.__buttonHeartbeat},asyncCompletion:'unmeasured; existing independent outcome remains authoritative'};}
export function timingPlan(){return{kind:'button-timing-diagnostic',acceptanceEligible:false,cases:[
 {id:'paste',engine:'chromium',scenario:'oversized retained-source export'},
 {id:'undo',engine:'webkit',scenario:'rapid Undo consumes ten actual saved edit frames'},
 {id:'decision',engine:'chromium',scenario:'rapid Settings decision review offers Light and saves it while protecting failures'},
 {id:'cloud',engine:'chromium',scenario:'rapid cloud recovery reviews, protects, and applies a source with read and write failures'},
 {id:'bulk-webkit',engine:'webkit',scenario:'rapid All Tasks and bulk editing with 400 saved tasks'},
 {id:'decision-webkit',engine:'webkit',scenario:'rapid Settings decision review offers Light and saves it while protecting failures'},
 ]};}
export async function executeTimingCases({output,repo=ROOT,invoke=spawnSync}){
 const rows=[];for(const c of timingPlan().cases){const directory=path.join(output,c.id);fs.mkdirSync(directory,{recursive:true});const args=['scripts/button-safety.mjs','--run','--engine',c.engine,'--scenario',c.scenario,'--output-dir',directory,'--port','0'];let result;
  try{result=invoke(process.execPath,args,{cwd:repo,env:{...process.env,CHAIN_BUTTON_DIAGNOSTIC_TIMINGS:'1'},encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});}catch(error){result={status:null,signal:null,error};}
  fs.writeFileSync(path.join(directory,'stdout.txt'),result.stdout||'');fs.writeFileSync(path.join(directory,'stderr.txt'),result.stderr||'');rows.push({...c,exitCode:result.status,signal:result.signal,errorName:result.error?.name,status:result.status===0&&!result.error&&!result.signal?'passed':'failed'});
 }return rows;
}
export async function runTimingDiagnostic({outputDir}){
 if(process.platform!=='linux'||process.env.CI!=='true'||process.env.GITHUB_EVENT_NAME!=='push'||process.env.CHAIN_TEST_EVENT_POLICY!=='outgoing-branch-push-v1'||process.env.GITHUB_REF!=='refs/heads/diagnose/webkit-cap-31c')throw Error('Only the isolated hosted diagnostic branch may run timing observations');hostedButtonPolicy();
 const output=path.resolve(outputDir);if(output===ROOT||output.startsWith(ROOT+path.sep))throw Error('Timing output must be outside checkout');fs.mkdirSync(output,{recursive:true});if(fs.readdirSync(output).length)throw Error('Timing output must be empty');const dirty=spawnSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'});if(dirty.status!==0||dirty.stdout.trim())throw Error('Clean diagnostic checkout required');
 const {appBinding}=await import('./button-safety-mobile-diagnostic.mjs');
 const report={schemaVersion:1,...timingPlan(),binding:appBinding(),status:'running'};try{report.results=await executeTimingCases({output});report.status=report.results.every(r=>r.status==='passed')?'passed':'failed';return report;}finally{fs.writeFileSync(path.join(output,'timing-report.json'),JSON.stringify(report,null,2)+'\n');}
}
if(path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){const args=process.argv.slice(2);try{if(args.length===1&&args[0]==='--plan')process.stdout.write(JSON.stringify(timingPlan(),null,2)+'\n');else if(args.includes('--run')){const report=await runTimingDiagnostic({outputDir:args[args.indexOf('--output-dir')+1]});if(report.status!=='passed')process.exitCode=1;}else throw Error('Choose --plan or --run');}catch(error){process.stderr.write(error.stack+'\n');process.exitCode=1;}}
