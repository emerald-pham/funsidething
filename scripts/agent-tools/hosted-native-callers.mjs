import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {StringDecoder} from 'node:string_decoder';
import {parseTap} from '../test-groups.mjs';

const MAX_OUTPUT=4194304,MAX_EXECUTION=180000,TERM_MS=3000,KILL_MS=3000;
const MAX_IDENTITY_INCIDENTS=256,MAX_INCIDENT_OBSERVATIONS=8;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const stamp=()=>({utc:new Date().toISOString(),monotonicMs:performance.now()});
const save=(file,value)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');fs.renameSync(file+'.tmp',file);};
const git=(cwd,...args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8',timeout:3000,maxBuffer:1048576});assert.equal(r.status,0,'Native owner source identity: '+r.stderr);return r.stdout.trim();};

// OS identities are independently observed. macOS ps reports start time only
// to the second; that precision is explicit and never described as /proc ticks.
export function readNativeProcessTable(){
 const rows=[];
 if(process.platform==='linux')return readLinuxNativeProcessTable();
 else if(process.platform==='darwin'){
  const r=spawnSync('/bin/ps',['-axo','pid=,ppid=,pgid=,sess=,uid=,lstart=,stat=,comm='],{encoding:'utf8',timeout:1000,maxBuffer:8388608});
  assert.equal(r.status,0,'macOS process identity table unavailable');
  for(const line of r.stdout.split('\n')){const m=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.{24})\s+(\S+)\s+(.+)$/.exec(line);if(m)rows.push({pid:+m[1],ppid:+m[2],pgid:+m[3],session:m[4],uid:+m[5],startIdentity:m[6],startPrecision:'ps-lstart-one-second',state:m[7],executable:m[8],pidNamespace:'unavailable-on-darwin'});}
 }else throw Error('Owned native process OS identity is unavailable on '+process.platform);
 return rows;
}
export function readLinuxNativeProcessTable({procRoot='/proc',filesystem=fs}={}){
 const rows=[];
 for(const name of filesystem.readdirSync(procRoot).filter(value=>/^\d+$/.test(value))){
  const base=path.join(procRoot,name),errors=[];let fields;
  try{const raw=filesystem.readFileSync(base+'/stat','utf8');fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');}
  catch(error){if(['ENOENT','ESRCH'].includes(error.code))continue;if(!['EACCES','EPERM'].includes(error.code))throw error;rows.push({pid:Number(name),state:null,statStatus:'unavailable',enrichment:{status:'unavailable',errors:[{field:'stat',code:error.code}]}});continue;}
  let uid=null;try{const match=/^Uid:\s+(\d+)/m.exec(filesystem.readFileSync(base+'/status','utf8'));if(match)uid=Number(match[1]);else errors.push({field:'uid',code:'invalid'});}catch(error){if(!['ENOENT','ESRCH','EACCES','EPERM'].includes(error.code))throw error;errors.push({field:'uid',code:error.code});}
  // Permission-limited foreign processes are not part of this owner's tree.
  // Filter their known UID before requesting protected exe/namespace links.
  if(uid!==null&&uid!==process.getuid())continue;
  const row={pid:Number(name),ppid:Number(fields[1]),pgid:Number(fields[2]),session:Number(fields[3]),state:fields[0],uid,startIdentity:fields[19],startPrecision:'kernel-clock-ticks',statStatus:'observed',executable:null,pidNamespace:null};
  for(const [field,suffix]of [['executable','/exe'],['pidNamespace','/ns/pid']])try{row[field]=filesystem.readlinkSync(base+suffix);}catch(error){if(!['ENOENT','ESRCH','EACCES','EPERM'].includes(error.code))throw error;errors.push({field,code:error.code});}
  row.enrichment={status:errors.length?'unavailable':'complete',errors};rows.push(row);
 }
 return rows;
}
const same=(a,b)=>a&&b&&['pid','startIdentity','startPrecision','uid','pidNamespace'].every(key=>a[key]===b[key]);
const live=row=>row&&!/^[ZX]/.test(row.state);
const usable=row=>row&&row.enrichment?.status!=='unavailable'&&Number.isSafeInteger(row.pid)&&row.pid>0&&Number.isSafeInteger(row.uid)&&typeof row.startIdentity==='string'&&row.startIdentity.length>0&&typeof row.startPrecision==='string'&&row.startPrecision.length>0&&typeof row.pidNamespace==='string'&&row.pidNamespace.length>0&&typeof row.executable==='string'&&row.executable.length>0;

// Only this system seam admits small real-process controls. Production callers
// cannot raise any of the agreed ceilings through its options.
export async function runOwnedNativeProcess({cwd,outputDir,env=process.env,executable=process.execPath,args,timeoutMs=MAX_EXECUTION,outputLimitBytes=MAX_OUTPUT,system={}}){
 assert.ok(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=MAX_EXECUTION,'Finite native execution ceiling required');
 assert.ok(Number.isSafeInteger(outputLimitBytes)&&outputLimitBytes>0&&outputLimitBytes<=MAX_OUTPUT,'Finite native output ceiling required');
 assert.ok(Array.isArray(args)&&args.every(value=>typeof value==='string'));
 assert.ok(Object.keys(system).every(key=>['readProcessTable','signalProcess'].includes(key)),'Only OS process boundaries may be controlled');
 const processTable=system.readProcessTable||readNativeProcessTable,signalProcess=system.signalProcess||((pid,signal)=>process.kill(pid,signal));
 fs.mkdirSync(outputDir,{recursive:true});
 const files={stdout:path.join(outputDir,'stdout.tap'),stderr:path.join(outputDir,'stderr.txt'),frontier:path.join(outputDir,'frontier.jsonl')},fds={};
 for(const [key,file]of Object.entries(files))fds[key]=fs.openSync(file,'wx');
 const receipt={schemaVersion:1,kind:'owned-native-process',started:stamp(),source:{commit:git(cwd,'rev-parse','HEAD'),tree:git(cwd,'rev-parse','HEAD^{tree}'),base:env.CHAIN_TEST_COMPARISON_BASE||null,sourceSha:env.CHAIN_TEST_SOURCE_SHA||null,toolSha256:digest(fs.readFileSync(new URL(import.meta.url)))},runtime:{node:process.version,executable:process.execPath,platform:process.platform,arch:process.arch,kernel:os.release(),systemBoundary:Object.keys(system).length?'controlled-test-only':'actual-OS'},hostedPolicy:{CI:env.CI||null,eventPolicy:env.CHAIN_TEST_EVENT_POLICY||null,eventName:env.GITHUB_EVENT_NAME||null,ref:env.GITHUB_REF||null,runId:env.GITHUB_RUN_ID||null,runAttempt:env.GITHUB_RUN_ATTEMPT||null,requestedPort:env.CHAIN_NATIVE_PORT===undefined?'default':env.CHAIN_NATIVE_PORT,debug:env.DEBUG||null},command:{executable,args,cwd},bounds:{executionMs:timeoutMs,termMs:TERM_MS,killMs:KILL_MS,combinedOutputBytes:outputLimitBytes},files,bytes:0,timedOut:false,outputLimit:false,status:null,signal:null,signals:[],processes:[],browserLaunches:[],browserExits:[],refusals:[],incidents:[],cleanup:{complete:false},frontier:null};
 save(path.join(outputDir,'process.json'),receipt);
 let sequence=0,child,closed=false,exitObserved=false,monitor,deadline,reason,doneResolve;
 const done=new Promise(resolve=>doneResolve=resolve),known=new Map(),pending={stdout:'',stderr:''},decoders={stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')},lineOffsets={stdout:0,stderr:0};
 const event=value=>{const row={sequence:++sequence,...stamp(),...value};fs.writeSync(fds.frontier,JSON.stringify(row)+'\n');receipt.frontier=row;};
 const interruptions=Object.fromEntries(['SIGINT','SIGTERM'].map(signal=>[signal,()=>{receipt.interruption=signal;reason='interrupted:'+signal;event({kind:'interruption',signal});doneResolve();}]));
 for(const [signal,handler]of Object.entries(interruptions))process.on(signal,handler);
 const refuse=message=>{if(!receipt.refusals.includes(message))receipt.refusals.push(message);};
 const incidents=new Map();
 const enrichmentIncident=(row,witness,parent)=>{
  const kind=witness?'owned-enrichment':'unwitnessed-descendant',message=(witness?'Owned process':'Owned descendant')+' enrichment unavailable; refused '+row.pid,key=kind+':'+row.pid,observed=stamp();
  refuse(message);
  const errors=row.enrichment?.errors;
  // Only a previously complete exact identity can survive an executable-link
  // terminal read race. Unknown rows and every core ambiguity stay refused.
  const eligible=!!witness&&usable(witness.identity)&&usable(receipt.owner)&&usable(witness.proof.parentIdentity)&&same(witness.identity,row)&&!witness.terminalResolutionBlocked&&row.executable===null&&row.enrichment?.status==='unavailable'&&Array.isArray(errors)&&errors.length>0&&errors.every(error=>error.field==='executable'&&['ENOENT','ESRCH'].includes(error.code));
  let incident=incidents.get(key);
  if(!incident){
   if(receipt.incidents.length>=MAX_IDENTITY_INCIDENTS){refuse('Process identity incident retention limit reached');return;}
   incident={id:key,kind,message,status:'active',observed,observation:structuredClone(row),priorIdentity:witness?structuredClone(witness.identity):null,priorProof:witness?structuredClone(witness.proof):null,parentWitness:parent?{identity:structuredClone(parent.identity),proof:structuredClone(parent.proof)}:null,eligible,occurrences:0,observations:[]};
   incidents.set(key,incident);receipt.incidents.push(incident);event({kind:'identity-incident',incident});
  }
  incident.occurrences++;incident.lastObserved=observed;incident.lastObservation=structuredClone(row);
  if(incident.observations.length<MAX_INCIDENT_OBSERVATIONS)incident.observations.push({observed,identity:structuredClone(row)});else incident.observationsTruncated=true;
  incident.eligible&&=eligible;
  if(incident.status==='resolved'){incident.status='active';incident.reopened=observed;incident.eligible=false;refuse('Owned identity reappeared after terminal proof; refused '+row.pid);}
 };
 const blockTerminalResolution=(witness,current)=>{
  witness.terminalResolutionBlocked??={...stamp(),observation:structuredClone(current)};
  for(const incident of receipt.incidents)if(incident.priorIdentity?.pid===witness.identity.pid){incident.eligible=false;incident.blocked=witness.terminalResolutionBlocked;}
 };
 const capture=()=>{
  const table=processTable(),byPid=new Map(table.map(row=>[row.pid,row]));
  for(const [pid,witness]of known){const current=byPid.get(pid);if(live(current)&&!usable(current))enrichmentIncident(current,witness);if(current&&!same(witness.identity,current)){blockTerminalResolution(witness,current);refuse('PID identity changed; refused '+pid);}if(live(current)&&witness.nonliveConfirmedAt){blockTerminalResolution(witness,current);refuse('Owned PID reappeared after terminal proof; refused '+pid);}}
  let changed=true;while(changed){changed=false;for(const row of table){if(known.has(row.pid)||Number.isSafeInteger(row.uid)&&row.uid!==process.getuid())continue;const parent=known.get(row.ppid);if(parent){if(!usable(row)||parent.terminalResolutionBlocked||!usable(byPid.get(row.ppid))||!same(parent.identity,byPid.get(row.ppid))){enrichmentIncident(row,null,parent);continue;}known.set(row.pid,{identity:row,proof:{kind:'observed-owned-ancestry',parentPid:row.ppid,parentStartIdentity:parent.identity.startIdentity,parentIdentity:parent.identity},first:stamp()});changed=true;}}}
  for(const [pid,witness]of known){const current=byPid.get(pid);let status;
   if(current)status=!same(witness.identity,current)?'identity-reused':!live(current)?'nonlive':!usable(current)?'identity-unavailable':'live';
   else if(witness.nonliveConfirmedAt)status='nonlive';
   else{let result='still-live-or-ambiguous';try{signalProcess(pid,0);}catch(error){result=error.code||String(error);}witness.absenceProbe={...stamp(),result};status=result==='ESRCH'?'nonlive':'identity-unavailable';if(status!=='nonlive'){blockTerminalResolution(witness,{pid,absent:true,probe:witness.absenceProbe});refuse('Absent owned PID has no kernel nonliveness proof; refused '+pid);}}
   if(status==='nonlive'){
    witness.nonliveConfirmedAt??=stamp();witness.nonliveProof??=current?{kind:'kernel-terminal-state',identity:structuredClone(current),...stamp()}:{kind:'kernel-absence',...witness.absenceProbe};
    for(const incident of receipt.incidents)if(incident.status==='active'&&incident.eligible&&!witness.terminalResolutionBlocked&&same(incident.priorIdentity,witness.identity)&&witness.nonliveProof.monotonicMs>incident.observed.monotonicMs){
     incident.status='resolved';incident.resolution={observed:stamp(),proof:structuredClone(witness.nonliveProof)};receipt.refusals=receipt.refusals.filter(message=>message!==incident.message);event({kind:'identity-incident-resolved',id:incident.id,resolution:incident.resolution});
    }
   }witness.last={...stamp(),status,state:current?.state??null,identity:current??null};
   if(current&&same(witness.identity,current)){const prior=witness.transitions?.at(-1)?.identity??witness.identity;if(['ppid','pgid','session','executable'].some(key=>prior[key]!==current[key])){witness.transitions??=[];witness.transitions.push({identity:current,...stamp()});}}
  }
  receipt.processes=[...known.values()];return byPid;
 };
 const line=(stream,value,offset)=>{
  event({kind:'line',stream,offset,line:value});
  let match=/(?:^|\s)pw:browser <launched> pid=(\d+)\s*$/.exec(value);
  if(match){const pid=Number(match[1]),table=capture(),witness=known.get(pid),current=table.get(pid);const proven=witness&&same(witness.identity,current)&&live(current);
   receipt.browserLaunches.push({pid,line:value,stream,offset,...stamp(),identity:proven?witness.identity:null,proof:proven?witness.proof:null,status:proven?'owned':'unavailable'});if(!proven)refuse('Browser launch PID lacks matching live owned OS ancestry: '+pid);
  }
  match=/(?:^|\s)pw:browser \[pid=(\d+)\] <process did exit: exitCode=(-?\d+|null), signal=([^>]+)>\s*$/.exec(value);
  if(match){const pid=Number(match[1]);receipt.browserExits.push({pid,line:value,stream,offset,...stamp(),exitCode:match[2]==='null'?null:Number(match[2]),signal:match[3]==='null'?null:match[3],owner:receipt.browserLaunches.some(row=>row.pid===pid&&row.status==='owned')});}
 };
 const intake=(stream,chunk)=>{
  const available=outputLimitBytes-receipt.bytes,accepted=chunk.subarray(0,Math.max(0,available));
  if(accepted.length){const offset=fs.fstatSync(fds[stream]).size;fs.writeSync(fds[stream],accepted);receipt.bytes+=accepted.length;event({kind:'chunk',stream,offset,bytes:accepted.length,sha256:digest(accepted)});
   pending[stream]+=decoders[stream].write(accepted);let index;while((index=pending[stream].indexOf('\n'))!==-1){const value=pending[stream].slice(0,index),lineOffset=lineOffsets[stream];lineOffsets[stream]+=Buffer.byteLength(value)+1;pending[stream]=pending[stream].slice(index+1);try{line(stream,value,lineOffset);}catch(error){refuse('Live observation: '+String(error));reason??='identity-observation';doneResolve();}}
  }
  if(accepted.length!==chunk.length){receipt.outputLimit=true;reason??='output-limit';event({kind:'output-limit',receivedChunkBytes:chunk.length,retainedChunkBytes:accepted.length});doneResolve();}
 };
 try{
  const before=processTable();receipt.owner=before.find(row=>row.pid===process.pid);assert.ok(receipt.owner,'Actual owner OS identity required');
  const debug=[...(env.DEBUG||'').split(',').filter(Boolean),'pw:browser'].filter((value,index,all)=>all.indexOf(value)===index).join(',');
  receipt.hostedPolicy.debug=debug;receipt.launched=stamp();
  child=spawn(executable,args,{cwd,env:{...env,DEBUG:debug,DEBUG_COLORS:'0',FORCE_COLOR:'0'},detached:true,stdio:['ignore','pipe','pipe']});receipt.pid=child.pid;
  child.stdout.on('data',chunk=>intake('stdout',chunk));child.stderr.on('data',chunk=>intake('stderr',chunk));
  child.once('error',error=>{receipt.error={name:error.name,code:error.code,message:error.message};reason??='launch-error';doneResolve();});
  child.once('exit',(code,signal)=>{exitObserved=true;receipt.status=code;receipt.signal=signal;receipt.exit={code,signal,...stamp()};event({kind:'root-exit',code,signal});doneResolve();});
  child.once('close',(code,signal)=>{closed=true;receipt.close={code,signal,...stamp()};event({kind:'root-close',code,signal});doneResolve();});
  const initial=processTable().find(row=>row.pid===child.pid);assert.ok(usable(initial)&&initial.ppid===process.pid&&initial.uid===receipt.owner.uid,'Spawned child live OS ancestry required');
  known.set(child.pid,{identity:initial,proof:{kind:'actual-spawn-child',parentPid:process.pid,parentStartIdentity:receipt.owner.startIdentity,parentIdentity:receipt.owner},first:stamp()});receipt.rootIdentity=initial;capture();event({kind:'root-start',pid:child.pid,identity:initial});
  monitor=setInterval(()=>{try{capture();}catch(error){refuse('Process monitor: '+String(error));reason??='identity-observation';doneResolve();}},20);
  const scheduledMonotonicMs=receipt.launched.monotonicMs+timeoutMs;
  deadline=setTimeout(()=>{receipt.timedOut=true;reason='deadline';receipt.deadline={scheduledMonotonicMs,...stamp()};receipt.deadline.latenessMs=receipt.deadline.monotonicMs-scheduledMonotonicMs;event({kind:'deadline',pid:child.pid,...receipt.deadline});doneResolve();},Math.max(0,scheduledMonotonicMs-performance.now()));
  await done;clearTimeout(deadline);
  // Capture ancestry before a parent can disappear, then signal only one exact
  // witnessed identity at a time. No negative-PGID or name-based host kill.
  const signalOwned=(signal,until)=>{capture();for(const [pid,witness]of [...known].reverse()){if(performance.now()>=until){refuse('Identity-checked signal phase deadline reached');break;}const current=processTable().find(row=>row.pid===pid);if(current&&!same(witness.identity,current)){blockTerminalResolution(witness,current);refuse('Signal refused for changed identity '+pid);continue;}if(!live(current))continue;if(witness.terminalResolutionBlocked){refuse('Signal refused after ambiguous owned identity '+pid);continue;}if(!usable(current)){enrichmentIncident(current,witness);continue;}let result='sent';try{signalProcess(pid,signal);}catch(error){result=error.code||String(error);if(error.code!=='ESRCH')refuse('Signal '+signal+' failed for '+pid+': '+result);}const row={pid,signal,identity:current,result,...stamp()};receipt.signals.push(row);event({kind:'signal',...row});}};
  const allGone=()=>{capture();return[...known.values()].every(row=>row.last.status==='nonlive');};
  const settle=async until=>{while(performance.now()<until){if(allGone()&&closed)return true;await delay(20);}return allGone()&&closed;};
  if(reason||!allGone()){
   reason??='descendant-outlived-root';receipt.stopReason=reason;receipt.teardownStarted=stamp();const termUntil=receipt.teardownStarted.monotonicMs+TERM_MS,killUntil=termUntil+KILL_MS;signalOwned('SIGTERM',termUntil);
   if(!await settle(termUntil)){signalOwned('SIGKILL',killUntil);await settle(killUntil);}receipt.teardownFinished=stamp();
  }else if(!closed)await settle(performance.now()+KILL_MS);
  clearInterval(monitor);monitor=null;capture();
  for(const stream of Object.keys(pending)){pending[stream]+=decoders[stream].end();if(pending[stream])event({kind:'partial-line',stream,offset:lineOffsets[stream],line:pending[stream]});}
  receipt.stopReason??=reason||'normal-exit';receipt.cleanup={complete:closed&&exitObserved&&[...known.values()].every(row=>row.last.status==='nonlive')&&receipt.refusals.length===0&&receipt.incidents.every(row=>row.status==='resolved'),rootClosed:closed,rootExitObserved:exitObserved,monitorStopped:true,deadlineStopped:true,signalScope:'identity-checked-individual-owned-processes'};
  for(const launch of receipt.browserLaunches){launch.finalState=known.get(launch.pid)?.last??{status:'unavailable'};launch.actualExit=receipt.browserExits.find(row=>row.pid===launch.pid&&row.owner)||{status:'unavailable',reason:'No actual browser ChildProcess close log; attempted signals are not exit status'};if(receipt.stopReason==='normal-exit'&&launch.actualExit.status==='unavailable'){receipt.cleanup.complete=false;refuse('Normal browser close log unavailable for '+launch.pid);}}
 }catch(error){receipt.error??={name:error.name,code:error.code||null,message:error.message};refuse(String(error));receipt.cleanup.complete=false;
  // If observation failed, never broaden signaling to an unproved PID/group.
  for(const [pid,witness]of known)try{const current=processTable().find(row=>row.pid===pid);if(!witness.terminalResolutionBlocked&&usable(current)&&same(witness.identity,current)&&live(current)){signalProcess(pid,'SIGKILL');receipt.signals.push({pid,signal:'SIGKILL',identity:current,result:'sent-after-owner-error',...stamp()});}}catch(cleanupError){refuse(String(cleanupError));}
  const until=performance.now()+KILL_MS;while(child&&!closed&&performance.now()<until)await delay(20);
 }finally{
  for(const [signal,handler]of Object.entries(interruptions))process.off(signal,handler);
  clearTimeout(deadline);clearInterval(monitor);receipt.finished=stamp();receipt.executionElapsedMs=(receipt.deadline?.monotonicMs??receipt.exit?.monotonicMs??receipt.finished.monotonicMs)-(receipt.launched?.monotonicMs??receipt.started.monotonicMs);receipt.rootLifetimeMs=receipt.exit?receipt.exit.monotonicMs-receipt.launched.monotonicMs:null;
  if(child&&!closed){child.stdout.removeAllListeners('data');child.stderr.removeAllListeners('data');child.stdout.destroy();child.stderr.destroy();child.removeAllListeners('exit');child.removeAllListeners('close');child.unref();}
  for(const [key,fd]of Object.entries(fds)){fs.closeSync(fd);receipt[key+'Sha256']=digest(fs.readFileSync(files[key]));}
  save(path.join(outputDir,'process.json'),receipt);
 }
 return receipt;
}

// Node's event reporter exposes starts while TAP can buffer nested outcomes.
// This second reporter leaves the first reporter's original TAP untouched.
export default async function* nativeFrontierReporter(source){
 for await(const event of source)if(['test:start','test:pass','test:fail'].includes(event.type))yield '# native-frontier '+JSON.stringify({event:event.type,name:event.data.name,nesting:event.data.nesting,...stamp()})+'\n';
}

// Independent literal catalog retained from both original complete native TAPs;
// this list never learns an expected case from a current observed outcome.
const EXPECTED_CASES=Object.freeze([
 "RISK repository process: retained native sources seed once without a persistent board bootstrap > normal",
 "RISK repository process: retained native sources seed once without a persistent board bootstrap > reduced",
 "RISK repository process: retained native sources seed once without a persistent board bootstrap > ordinary",
 "RISK repository process: retained native sources seed once without a persistent board bootstrap",
 "RISK synced scene durability: native retained boards keep immediate scene locks through reload without changing tasks or sources > normal",
 "RISK synced scene durability: native retained boards keep immediate scene locks through reload without changing tasks or sources > reduced",
 "RISK synced scene durability: native retained boards keep immediate scene locks through reload without changing tasks or sources",
 "RISK scenery startup: native mobile paints once while hidden return saved choices resize and rain preserve the scene > normal visible",
 "RISK scenery startup: native mobile paints once while hidden return saved choices resize and rain preserve the scene > normal hidden then visible",
 "RISK scenery startup: native mobile paints once while hidden return saved choices resize and rain preserve the scene > reduced visible",
 "RISK scenery startup: native mobile paints once while hidden return saved choices resize and rain preserve the scene > reduced hidden then visible",
 "RISK scenery startup: native mobile paints once while hidden return saved choices resize and rain preserve the scene > controlled failing probe cleanup",
 "RISK scenery startup: native mobile paints once while hidden return saved choices resize and rain preserve the scene",
 "RISK repository process: ordinary repeated selected eligibility preserves rows receipts and sources",
 "RISK repository process: ordinary task Undo keeps unchanged scenery while separate scene choices repaint and save",
 "RISK repository process: refused saved decision capture waits for its refreshed unselected review > chromium",
 "RISK repository process: refused saved decision capture waits for its refreshed unselected review > webkit",
 "RISK repository process: refused saved decision capture waits for its refreshed unselected review",
 "RISK repository process: ordinary top-layer release refuses a covered intended opener and preserves complete sources > chromium",
 "RISK repository process: ordinary top-layer release refuses a covered intended opener and preserves complete sources > webkit",
 "RISK repository process: ordinary top-layer release refuses a covered intended opener and preserves complete sources",
 "RISK repository process: external browser termination retains lifecycle classification without app crash credit > chromium owned external browser close",
 "RISK repository process: external browser termination retains lifecycle classification without app crash credit > webkit owned external browser close",
 "RISK repository process: external browser termination retains lifecycle classification without app crash credit"
]);
const ROOTS=Object.freeze([
 "RISK repository process: retained native sources seed once without a persistent board bootstrap",
 "RISK synced scene durability: native retained boards keep immediate scene locks through reload without changing tasks or sources",
 "RISK scenery startup: native mobile paints once while hidden return saved choices resize and rain preserve the scene",
 "RISK repository process: ordinary repeated selected eligibility preserves rows receipts and sources",
 "RISK repository process: ordinary task Undo keeps unchanged scenery while separate scene choices repaint and save",
 "RISK repository process: refused saved decision capture waits for its refreshed unselected review",
 "RISK repository process: ordinary top-layer release refuses a covered intended opener and preserves complete sources",
 "RISK repository process: external browser termination retains lifecycle classification without app crash credit"
]);
const SAVED_ROOT="RISK repository process: refused saved decision capture waits for its refreshed unselected review";
const escapeRegex=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export function verifyHostedNativeCallerReceipts(batches){
 const issues=[],seen=new Set(),cases=[];
 if(batches.length!==2)issues.push('Exactly two serial native selections required');
 for(const [index,batch]of batches.entries()){
  if(batch.selection!==(index===0?'saved-decision':'remaining-seven'))issues.push('Native selection/order mismatch');
  if(batch.status!==0||batch.signal!==null||batch.timedOut||batch.outputLimit||batch.error||batch.cleanup?.complete!==true)issues.push('Unsuccessful or incompletely cleaned native child '+batch.selection);
  if(!Array.isArray(batch.browserLaunches)||batch.browserLaunches.length===0||batch.browserLaunches.some(row=>row.status!=='owned'||!row.identity?.startIdentity||row.finalState?.status!=='nonlive'||row.actualExit?.owner!==true))issues.push('Missing complete nonvacuous browser launch/actual-close/OS-nonliveness evidence in '+batch.selection);
  const text=fs.readFileSync(batch.files.stdout,'utf8');
  if(!text.endsWith('\n'))issues.push('Incomplete final TAP line');
  const expectedCount=index===0?3:21;
  for(const [key,value]of [['tests',expectedCount],['pass',expectedCount],['fail',0],['cancelled',0],['skipped',0],['todo',0]]){const rows=[...text.matchAll(new RegExp('^# '+key+' (\\d+)$','gm'))];if(rows.length!==1||Number(rows[0][1])!==value)issues.push('Missing, duplicate or contradictory terminal '+key+' count in '+batch.selection);}
  try{for(const row of parseTap(text)){
   if(seen.has(row.id))issues.push('Duplicate native case: '+row.id);seen.add(row.id);cases.push(row);
   if(!EXPECTED_CASES.includes(row.id))issues.push('Unknown native case: '+row.id);
   if(row.status!=='passed')issues.push('Unsuccessful native case: '+row.id);
   if(index===0&&row.root!==SAVED_ROOT||index===1&&row.root===SAVED_ROOT)issues.push('Native case in wrong selection: '+row.id);
  }}catch(error){issues.push('Invalid native TAP: '+error.message);}
 }
 for(const id of EXPECTED_CASES)if(!seen.has(id))issues.push('Missing native case: '+id);
 if(batches.reduce((sum,row)=>sum+row.bytes,0)>MAX_OUTPUT)issues.push('Native combined output ceiling exceeded');
 if(batches.reduce((sum,row)=>sum+row.executionElapsedMs,0)>360000)issues.push('Native aggregate execution ceiling exceeded');
 return {issues,cases,expectedCases:[...EXPECTED_CASES],expectedRoots:[...ROOTS]};
}

export async function runHostedNativeCallers({cwd,outputDir,env}){
 fs.mkdirSync(outputDir,{recursive:true});const batches=[],started=stamp();
 const request={schemaVersion:1,kind:'hosted-native-callers',started,source:{commit:git(cwd,'rev-parse','HEAD'),tree:git(cwd,'rev-parse','HEAD^{tree}')},expectedCases:[...EXPECTED_CASES],expectedRoots:[...ROOTS],policy:{serialSelections:['saved-decision','remaining-seven'],perChildExecutionMs:180000,totalExecutionMs:360000,teardownMsPerFailedChild:6000,combinedOutputBytes:MAX_OUTPUT,originalVerdictUnchanged:true}};
 save(path.join(outputDir,'hosted-direct-callers.request.json'),request);
 let bytes=0;
 for(const selection of ['saved-decision','remaining-seven']){
  if(bytes>=MAX_OUTPUT)break;
  const roots=selection==='saved-decision'?[SAVED_ROOT]:ROOTS.filter(root=>root!==SAVED_ROOT),directory=path.join(outputDir,selection),nativeOutput=path.join(directory,'native');
  fs.mkdirSync(directory,{recursive:true});save(path.join(directory,'selection.json'),{selection,roots,expectedCases:EXPECTED_CASES.filter(id=>roots.some(root=>id===root||id.startsWith(root+' > '))),processPath:'process.json'});
  const childEnv={...env,CHAIN_NATIVE_OUTPUT:nativeOutput};delete childEnv.NODE_TEST_CONTEXT;
  const args=['--test','--test-reporter=tap','--test-reporter=./scripts/agent-tools/hosted-native-callers.mjs','--test-reporter-destination=stdout','--test-reporter-destination=stderr','--test-name-pattern=^('+roots.map(escapeRegex).join('|')+')$','tests.js'];
  const receipt=await runOwnedNativeProcess({cwd,outputDir:directory,env:childEnv,args,outputLimitBytes:MAX_OUTPUT-bytes});
  receipt.selection=selection;bytes+=receipt.bytes;batches.push(receipt);
  if(receipt.status!==0||receipt.signal!==null||receipt.timedOut||receipt.outputLimit||receipt.error||!receipt.cleanup.complete)break;
 }
 const verification=verifyHostedNativeCallerReceipts(batches),result={...request,finished:stamp(),status:verification.issues.length?'failed':'passed',...verification,batches};
 save(path.join(outputDir,'hosted-direct-callers.result.json'),result);return result;
}

// Pure planning at the existing caller boundary. Actual host/runtime and once-only
// admission remain in runLinuxNativeFailureFollowup; this function launches nothing.
export function planLinuxNativeFailureFollowup({report,origin,source,nativeOutput,port='0',inventoryBytes,reportPath}){
 const setup=report.scenarios?.find(row=>row.name===(origin==='pageerror-opening'?'detector sensitivity':'ordinary scene choice survives reopen and task Undo'))?.setup;
 if(report.status!=='failed'||report.engine!=='webkit'||report.profile!=='ordinary'||report.runtime?.platform!=='linux'||report.runtime?.nodeVersion!=='v22.23.4'||report.runtime?.playwright!=='1.62.1'||report.runtime?.version!=='26.5'||setup?.currentTasks!==64||setup?.durableTasks!==64||['contextClosed','browserClosed','serverClosed'].some(key=>report.cleanup?.[key]!==true)||report.cleanupFailures?.length||report.linuxFailureObservation)return{status:'not-selected',reason:'Exact failed ordinary64 report with complete original cleanup required'};
 if(report.candidateCommit!==source.commit||report.candidateTree!==source.tree)return{status:'not-selected',reason:'Original report source differs from this child source'};
 let window;
 if(origin==='pageerror-opening'&&report.kind==='button-sensitivity'&&report.samples?.some(row=>row.scenario==='detector sensitivity'&&row.action==='act:settings'&&row.phase==='opening-before-input'&&row.inputStatus==='not-reached'&&row.firstTrustedInputAt===null&&Number.isFinite(row.openingMaxFrameGapMs)&&row.openingMaxFrameGapMs>=1000))window='pageerror-opening';
 if(origin==='required-actions'&&report.kind==='button-safety'&&report.samples?.some(row=>row.scenario==='ordinary scene choice survives reopen and task Undo'&&row.action==='act:scene-time-settings'&&Number.isFinite(row.maxFrameGapMs)&&row.maxFrameGapMs>=1000))window='scene-time-settings';
 if(!window)return{status:'not-selected',reason:'No exact approved native frame frontier'};
 let history=null;
 if(window==='scene-time-settings'){
  // This approved frontier occurs after exactly the ordinary inventory's first
  // 30 scenarios. Inventory order after that prefix is not execution order.
  try{
   const inventory=JSON.parse(inventoryBytes),ordinary=inventory.profiles.ordinary,target='ordinary scene choice survives reopen and task Undo',names=[...ordinary.requiredScenarios.slice(0,30),target];
   assert.equal(report.inventorySha256,digest(inventoryBytes));assert.equal(ordinary.fixture.savedTasks,64);
   assert.equal(ordinary.requiredScenarios.length,60);assert.equal(inventory.requiredActions.length,114);
   assert.deepEqual(report.requiredScenarios,ordinary.requiredScenarios);assert.deepEqual(report.requiredActions,inventory.requiredActions);
   assert.equal(names.length,31);assert.equal(new Set(names).size,31);assert.ok(ordinary.requiredScenarios.includes(target));
   assert.deepEqual(report.scenarios.map(row=>row.name),names);
   for(const [index,row]of report.scenarios.entries()){
    assert.equal(row.status,index===30?'running':'passed');assert.equal(row.setup.currentTasks,64);assert.equal(row.setup.durableTasks,64);
    const fixture=ordinary.scenarioFixtures[row.name];assert.equal(row.setup.authMode,fixture.authMode);assert.equal(row.setup.source,fixture.source);assert.equal(row.setup.fixtureRole,fixture.fixtureRole);
   }
   const frontier=report.samples.at(-1);assert.equal(frontier.scenario,target);assert.equal(frontier.action,'act:scene-time-settings');assert.ok(Number.isFinite(frontier.maxFrameGapMs)&&frontier.maxFrameGapMs>=1000);assert.deepEqual(report.errors,[]);
   assert.ok(path.isAbsolute(reportPath),'Original owned report path required');
   history={mode:'same-browser-history-v2',inventorySha256:report.inventorySha256,scenarios:names,targetScenario:target,targetAction:'act:scene-time-settings',successfulPrefix:30,originalReportPath:reportPath};
  }catch{return{status:'not-selected',reason:'Exact approved successful ordinary history, inventory and failed scene frontier required'};}
 }
 const mode=history?.mode||'fresh-isolated-v1';
 const args=['scripts/button-safety.mjs','--run','--profile','ordinary','--engine','webkit','--output-dir',nativeOutput,'--port',port,'--linux-failure-observation','linux-webkit-frontier-v1',...(window==='pageerror-opening'?['--probe','--control','pageerror']:['--scenario','ordinary scene choice survives reopen and task Undo','--linux-failure-history',reportPath])];
 return{status:'selected',window,mode,history,args};
}

export function createLinuxSceneHistoryReplay(history){
 assert.equal(history.mode,'same-browser-history-v2');assert.equal(history.successfulPrefix,30);
 assert.equal(history.scenarios.length,31);assert.equal(history.scenarios[30],history.targetScenario);
 let index=0,active=false,failed=false;
 return{
  enter(name){
   assert.equal(failed,false,'Failed diagnostic history cannot advance');
   if(index===history.scenarios.length)return false;
   assert.equal(active,false,'One diagnostic history scenario at a time');assert.equal(name,history.scenarios[index],'Diagnostic history must keep original order');active=true;
   return{index,target:index===30};
  },
  complete(name){assert.equal(failed,false);assert.equal(active,true);assert.equal(name,history.scenarios[index]);active=false;index++;},
  fail(){failed=true;},
  finish(){assert.equal(failed,false);assert.equal(active,false);assert.equal(index,31,'Every approved history scenario must complete');},
 };
}

export function reserveLinuxNativeFailureWindow(plan,windows){
 if(plan.status!=='selected')return plan;
 assert.ok(['pageerror-opening','scene-time-settings'].includes(plan.window),'Only approved Linux failure windows may be reserved');
 if(windows.has(plan.window)||windows.size>=2)return{status:'not-selected',reason:'Matching failure diagnostic already admitted once'};
 windows.add(plan.window);return plan;
}

const followedWindows=new Set();let diagnosticQueue=Promise.resolve();
export async function runLinuxNativeFailureFollowup({cwd,outputDir,reportPath,origin,env=process.env}){
 // A passing required invocation never calls this function. Recheck all facts
 // here so a generic failure, partial cleanup, foreign runtime or report cannot
 // admit a diagnostic browser. No environment switch selects an extra capture.
 if(process.platform!=='linux'||process.version!=='v22.23.4'||env.CI!=='true')return{status:'not-selected',reason:'Actual supported Linux CI runtime required'};
 const bytes=fs.readFileSync(reportPath),report=JSON.parse(bytes),nativeOutput=path.join(outputDir,'native'),plan=planLinuxNativeFailureFollowup({report,origin,source:{commit:git(cwd,'rev-parse','HEAD'),tree:git(cwd,'rev-parse','HEAD^{tree}')},nativeOutput,port:env.CHAIN_NATIVE_PORT||'0',reportPath,inventoryBytes:fs.readFileSync(path.join(cwd,'scripts/button-safety-inventory.json'))});
 const selection=reserveLinuxNativeFailureWindow(plan,followedWindows);if(selection.status!=='selected')return selection;const{window}=selection;
 const task=async()=>{
  assert.ok(fs.readFileSync(reportPath).equals(bytes),'Original failed report bytes changed before diagnostic launch');
  fs.mkdirSync(outputDir);const request={schemaVersion:1,kind:'linux-native-failure-followup',window,mode:plan.mode,history:plan.history,original:{path:reportPath,sha256:digest(bytes),status:report.status,candidateCommit:report.candidateCommit,candidateTree:report.candidateTree,cleanup:report.cleanup},policy:{originalVerdictUnchanged:true,onceOnly:true,serial:true,maxChildren:2,executionMs:180000,teardownMs:6000,captureMs:12000,rawBytesPerCapture:33554432,maxRawBytesTwoCaptures:67108864}};
  save(path.join(outputDir,'request.json'),request);
  const args=plan.args;
  const childEnv={...env};delete childEnv.NODE_TEST_CONTEXT;
  const processReceipt=await runOwnedNativeProcess({cwd,outputDir:path.join(outputDir,'process'),env:childEnv,args});
  const reports=fs.existsSync(nativeOutput)?fs.readdirSync(nativeOutput).filter(file=>/^button-safety-webkit-.*\.json$/.test(file)):[];
  const result={...request,process:processReceipt,diagnosticStatus:reports.length===1?JSON.parse(fs.readFileSync(path.join(nativeOutput,reports[0]))).linuxFailureObservation?.capture?.status||'unavailable':'unavailable',diagnosticReports:reports,status:processReceipt.cleanup.complete?'diagnostic-finished':'diagnostic-cleanup-incomplete',originalBytesUnchanged:fs.readFileSync(reportPath).equals(bytes)};
  save(path.join(outputDir,'result.json'),result);return result;
 };
 const pending=diagnosticQueue.then(task,task);diagnosticQueue=pending.catch(()=>{});return pending;
}
