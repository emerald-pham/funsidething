import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {canonicalStartupSource} from './button-safety-startup.mjs';
import {readNativeProcessTable} from './agent-tools/hosted-native-callers.mjs';

export const LINUX_FRONTIER_PROFILE='linux-webkit-frontier-v1';
export const LINUX_FRONTIER_BOUNDS=Object.freeze({maxDurationMs:12000,maxEvents:4096,maxEventBytes:1048576,maxTotalBytes:33554432,sampleIntervalMs:50,maxSamples:241,maxProcessThreads:64});
const hash=b=>createHash('sha256').update(b).digest('hex'),check=(ok,message)=>assert.ok(ok,'Linux native diagnostic '+message);
const stamp=()=>({utc:new Date().toISOString(),monotonicMs:performance.now(),cpuMicroseconds:process.cpuUsage()});
const sourceModules=['scripts/button-safety.mjs','scripts/button-safety-native.mjs','scripts/button-safety-timeline-linux.mjs','scripts/button-safety-timeline-core.mjs','scripts/button-safety-timeline.mjs','scripts/button-safety-startup.mjs','scripts/button-safety-scenes.mjs','scripts/agent-tools/hosted-native-callers.mjs'];
const fileIdentity=file=>{const bytes=fs.readFileSync(file);return{path:file,bytes:bytes.length,sha256:hash(bytes)};};

// Fresh observed Linux hashes are diagnostic provenance, never Mac vendor
// attestation. The original pinned Mac verifier/provider remain unchanged.
export function verifyLinuxNativeRuntime({repo=process.cwd()}={}){
 check(process.platform==='linux'&&process.version==='v22.23.4','actual Linux Node22.23.4 required');
 check(!process.env.PLAYWRIGHT_BROWSERS_PATH&&!process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH,'custom browser paths refused');
 const require=createRequire(import.meta.url),root=path.dirname(require.resolve('playwright-core/package.json'));
 check(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version==='1.62.1','Playwright1.62.1 required');
 const registry=JSON.parse(fs.readFileSync(path.join(root,'browsers.json'))),webkit=registry.browsers.find(row=>row.name==='webkit');
 check(webkit?.revision==='2336'&&webkit.browserVersion==='26.5','WebKit2336/26.5 required');
 const pw=require('playwright'),executable=pw.webkit.executablePath(),directory=path.dirname(executable),protocolPath=path.join(directory,'protocol.json');
 check(executable.includes('/webkit-2336/'),'actual installed2336 launcher required');
 const protocol=JSON.parse(fs.readFileSync(protocolPath)),timeline=protocol.find(row=>row.domain==='Timeline'),cpu=protocol.find(row=>row.domain==='CPUProfiler');
 check(timeline?.commands?.some(row=>row.name==='start'),'actual Timeline protocol required');
 const files={coreBundle:path.join(root,'lib/coreBundle.js'),protocol:protocolPath,launcher:executable,registry:path.join(root,'browsers.json'),coreEntry:path.join(root,'index.js'),coreModule:path.join(root,'index.mjs'),package:path.join(root,'package.json'),playwrightEntry:require.resolve('playwright')};
 return{kind:'linux-runtime-observed',profile:LINUX_FRONTIER_PROFILE,node:process.version,platform:process.platform,arch:process.arch,distro:fs.readFileSync('/etc/os-release','utf8'),kernel:os.release(),observed:stamp(),playwright:'1.62.1',webkitRevision:'2336',browserVersion:'26.5',executable,files:Object.fromEntries(Object.entries(files).map(([key,file])=>[key,fileIdentity(file)])),modules:sourceModules.map(file=>({...fileIdentity(path.join(repo,file)),path:file})),protocol:{CPUProfilerAdvertised:!!cpu,CPUProfilerCondition:cpu?.condition??null,CPUClockBasis:'unavailable: protocol timestamp origin is not independently calibrated',instruments:timeline.commands.find(row=>row.name==='setInstruments')?.parameters??null},limits:['Observed package/protocol/source hashes; no vendor build attestation','Advertised protocol does not establish compiled command support']};
}

function loadedLinuxFiles(owned){
 const files=new Map(),processes=[];
 for(const identity of owned){
  try{
   const actual=fs.readlinkSync('/proc/'+identity.pid+'/exe'),maps=fs.readFileSync('/proc/'+identity.pid+'/maps','utf8'),paths=new Set([actual,...maps.split('\n').map(line=>line.match(/\s(\/[^\n]+)$/)?.[1]).filter(Boolean)]);
   const loaded=[];for(const file of paths){if(files.size>=512&&!files.has(file))throw Error('Loaded ELF file count bound');if(!files.has(file)){const fd=fs.openSync(file,'r');let magic;try{magic=Buffer.alloc(4);fs.readSync(fd,magic,0,4,0);}finally{fs.closeSync(fd);}if(magic.toString('hex')!=='7f454c46')continue;files.set(file,fileIdentity(file));}loaded.push(file);}
   processes.push({identity,actualExecutable:actual,loadedELF:loaded,status:'observed'});
  }catch(error){processes.push({identity,status:'unavailable',reason:String(error)});}
 }
 return{observed:stamp(),processes,files:[...files.values()],scope:'Only actual owned PID/start identities; read-only /proc maps and executable ELF hashes'};
}

function createLinuxSampler({accept,onFailure}){
 if(process.platform!=='linux')return{status:'unavailable',reason:'Protocol double on non-Linux host; no Linux execution',stop:()=>({status:'unavailable',samples:0,cleanup:true})};
 const seen=new Map(),initial=readNativeProcessTable().find(row=>row.pid===process.pid);check(initial,'actual observer PID identity required');seen.set(initial.pid,initial);
 let timer,stopped=false,count=0,lastDue=performance.now(),failed=null;
 const same=(a,b)=>a&&b&&a.startIdentity===b.startIdentity&&a.uid===b.uid&&a.pidNamespace===b.pidNamespace;
 const owned=()=>{const all=readNativeProcessTable(),byPid=new Map(all.map(row=>[row.pid,row]));let changed=true;while(changed){changed=false;for(const row of all){if(seen.has(row.pid))continue;const parent=seen.get(row.ppid);if(parent&&same(parent,byPid.get(parent.pid))){check(row.enrichment?.status!=='unavailable'&&row.uid===initial.uid&&row.pidNamespace===initial.pidNamespace,'owned descendant process identity unavailable');seen.set(row.pid,row);changed=true;}}}return[...seen.values()].filter(row=>same(row,byPid.get(row.pid))&&!/^[ZX]/.test(byPid.get(row.pid).state));};
 const before=loadedLinuxFiles(owned());
 const sample=()=>{
  if(stopped)return;const bracketStart=stamp(),due=lastDue;lastDue+=50;
  try{
   check(++count<=241,'scheduler sample count bound');const rows=[];
   for(const identity of owned()){
    check(rows.length<64,'owned process/thread sample bound');
    const base='/proc/'+identity.pid;
    try{
     const raw=fs.readFileSync(base+'/stat','utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');
     check(fields[19]===identity.startIdentity&&fs.readlinkSync(base+'/ns/pid')===identity.pidNamespace,'owned process identity changed before counter read');
     let schedstat;try{const value=fs.readFileSync(base+'/schedstat','utf8').trim();check(/^\d+ \d+ \d+$/.test(value),'schedstat counters unavailable');const [runtimeNs,runqueueWaitNs,timeslices]=value.split(' ');schedstat={status:'observed',runtimeNs,runqueueWaitNs,timeslices,scope:'OS process-leader thread only; not identified as the page-main thread'};}catch(error){schedstat={status:'unavailable',reason:String(error)};}
     rows.push({pid:identity.pid,processStartIdentity:identity.startIdentity,tid:identity.pid,threadStartIdentity:fields[19],userTicks:fields[11],systemTicks:fields[12],cpuScope:'proc PID stat counters; kernel ticks, no inferred percentage',schedstat,role:identity.pid===process.pid?'node-observer-process':'owned-browser-process-unmapped-thread',pageMainThread:'unavailable: no native-thread-to-OS-TID mapping',otherThreadCounters:'unmeasured'});
    }catch(error){rows.push({pid:identity.pid,processStartIdentity:identity.startIdentity,status:'unavailable',reason:String(error)});}
   }
   let pressure;try{pressure={status:'observed',raw:fs.readFileSync('/proc/pressure/cpu','utf8')};}catch(error){pressure={status:'unavailable',reason:String(error)};}
   accept({kind:'scheduler-sample',index:count,scheduledMonotonicMs:due,lagMs:bracketStart.monotonicMs-due,bracketStart,bracketEnd:stamp(),rows,pressure});
  }catch(error){failed=String(error);clearInterval(timer);onFailure(error);}
 };
 sample();timer=setInterval(sample,50);
 return{status:'sampling',before,stop:()=>{if(!stopped){stopped=true;clearInterval(timer);}return{status:failed?'incomplete':'observed',failure:failed,samples:count,before,after:loadedLinuxFiles(owned()),cleanup:true,scope:'Read-only counter intervals; CPU and wait attribution unavailable without a mapped page-main TID and narrow clock brackets'};}};
}

export function createLinuxNativeTimelineProvider({verifyRuntime=verifyLinuxNativeRuntime}={}){
 check(typeof verifyRuntime==='function','runtime verifier required');
 return async function startLinuxNativeTimelineCapture({page,outputDir,sourceURL,repo=process.cwd(),profile=LINUX_FRONTIER_PROFILE,mode='fresh-isolated-v1',sources=()=>[],onStop=()=>{},onSave=()=>{}}){
  check(profile===LINUX_FRONTIER_PROFILE,'unknown diagnostic profile');check(['fresh-isolated-v1','same-browser-history-v2'].includes(mode),'unknown observation mode');const provenance=verifyRuntime({repo});
  check(provenance?.profile===LINUX_FRONTIER_PROFILE,'distinct Linux runtime manifest required');
  canonicalStartupSource('',undefined,sourceURL);
  const impl=page?._connection?.toImpl?.(page),delegate=impl?.delegate,session=delegate?._session,initialConnection=session?.connection;
  check(page?._type==='Page'&&delegate?._page===impl&&impl.browserContext?._browser?.options?.browserType==='webkit'&&session&&!session.isDisposed()&&typeof delegate._initializeSession==='function','owned in-process WebKit session required');
  check(page.url()==='about:blank'&&impl.mainFrame().url()==='about:blank','initial blank session required');
  const directory=path.join(outputDir,'linux-frontier');fs.mkdirSync(directory);const epoch=randomUUID(),prefix='native-timeline:'+randomUUID()+':',descriptor=Object.getOwnPropertyDescriptor(delegate,'_initializeSession'),listeners=[],contexts=new Map(),anchors=[],observerMarks=[];
  const capture={schemaVersion:1,profile,mode,kind:'linux-native-failure-diagnostic',status:'running',provenance,bounds:{...LINUX_FRONTIER_BOUNDS},started:stamp(),stopped:null,startedBeforeNavigation:false,session:{id:session.sessionId,epoch,initialOnly:true},documents:[],events:[],cpu:{status:'unavailable',commands:[],events:[],clockMapping:{status:'unavailable',reason:'CPUProfiler timestamp basis has no independently proved native/page calibration'}},samples:[],rawBytes:0,received:0,dropped:0,errors:[],facts:{calibration:{status:'unavailable',reason:'No same-document anchor pair'},work:[],observerPhases:[],causalAttribution:'unavailable'},cleanup:{listenersRemoved:false,hookRestored:false,sessionsStopped:false,timerCleared:false,samplerStopped:false},limits:['Instrumented failure follow-up; never required-gate acceptance','No Screenshot instrument; no pixel/presentation claim','Native elapsed scopes and CPU usage samples do not alone identify a cause']};
  let halted=false,stopping=false,stopPromise,timer,boundContext=null,sampler,cpuStarted=false;
  const notify=()=>onSave(capture),deadline=async work=>{let t;try{return await Promise.race([work,new Promise((_,reject)=>t=setTimeout(()=>reject(Error('native command deadline')),1000))]);}finally{clearTimeout(t);}};
  const fail=error=>{capture.errors.push(String(error).slice(0,1000));halted=true;capture.status='incomplete';queueMicrotask(()=>{void stop('capture-error');});};
  const put=(kind,value)=>{
   capture.received++;if(halted){capture.dropped++;return null;}
   try{
    check(performance.now()-capture.started.monotonicMs<=12000,'capture duration bound');
    const bytes=Buffer.from(JSON.stringify(value));check(bytes.length<=1048576,'raw event byte bound');check(capture.events.length<4096,'raw event count bound');check(capture.rawBytes+bytes.length+sources().reduce((sum,row)=>sum+row.bytes,0)<=33554432,'shared raw byte bound');
    const row={index:capture.events.length+1,kind,sessionId:session.sessionId,epoch,...stamp(),path:'linux-frontier/event-'+String(capture.events.length+1).padStart(4,'0')+'.json',bytes:bytes.length,sha256:hash(bytes)};
    fs.writeFileSync(path.join(outputDir,row.path),bytes,{flag:'wx'});capture.rawBytes+=bytes.length;capture.events.push(row);return row;
   }catch(error){capture.dropped++;fail(error);return null;}
  };
  let hostPhaseSequence=0;
  const phase=(name,boundary,id,detail={})=>{
   if(halted||stopping)return null;
   try{
    current();check(boundContext!==null&&['fixture-source-transport','host-source-serialization','safety-binding'].includes(name)&&['begin','end'].includes(boundary),'unknown/unbound host observer phase');
    if(boundary==='begin')id='host-phase-'+(++hostPhaseSequence);
    check(typeof id==='string'&&id.length<=200&&Buffer.byteLength(JSON.stringify(detail))<=2048,'bounded host phase identity/detail required');
    const mark={phase:'observer',name,boundary,id,detail,documentId:anchors[0].documentId,contextId:boundContext,sessionId:session.sessionId,epoch,clock:'host-monotonic',...stamp()},row=put('host-observer-phase',mark);
    if(row)observerMarks.push({...mark,eventIndex:row.index});return row?id:null;
   }catch(error){fail(error);return null;}
  };
  const current=()=>{check(delegate._session===session&&!session.isDisposed(),'foreign/replaced native session');};
  const walk=(record,visit,depth=0)=>{check(record&&typeof record.type==='string'&&Number.isFinite(record.startTime)&&record.startTime>=0&&depth<=64&&record.data&&typeof record.data==='object','malformed Timeline record');if(record.endTime!==undefined)check(Number.isFinite(record.endTime)&&record.endTime>=record.startTime,'malformed Timeline interval');check(record.type!=='Screenshot','Screenshot instrument/event refused');visit(record);if(record.children!==undefined){check(Array.isArray(record.children),'malformed Timeline children');for(const child of record.children)walk(child,visit,depth+1);}};
  const listen=(event,fn)=>{session.on(event,fn);listeners.push([event,fn]);};
  listen('Runtime.executionContextCreated',({context})=>{try{current();if(context&&context.type!=='normal')return;check(context?.type==='normal'&&Number.isSafeInteger(context.id)&&context.id>0&&typeof context.frameId==='string','malformed native context');if(context.frameId===impl.mainFrame()._id){check(boundContext===null,'bound document/context replaced');contexts.clear();contexts.set(context.id,context);}}catch(error){fail(error);}});
  listen('Runtime.executionContextsCleared',()=>{if(boundContext!==null)fail('bound document/context cleared');else contexts.clear();});
  listen('Timeline.eventRecorded',event=>{try{current();if(halted){put('Timeline.eventRecorded',event);return;}const pendingMarks=[],pendingAnchors=[];walk(event.record,record=>{if(record.type==='TimeStamp'&&record.data.message?.startsWith(prefix)){const a=JSON.parse(record.data.message.slice(prefix.length));check(['open','close','observer'].includes(a.phase)&&typeof a.documentId==='string'&&Number.isFinite(a.pageMs),'malformed native anchor');
    if(a.phase==='observer'){
     check(boundContext!==null&&a.documentId===(anchors[0]||pendingAnchors[0])?.documentId&&['fixture-source-encode','safety-scan'].includes(a.name)&&['begin','end'].includes(a.boundary)&&typeof a.id==='string'&&a.id.length>0&&a.id.length<=200&&(a.fixtureDocumentId===null||typeof a.fixtureDocumentId==='string'&&a.fixtureDocumentId.length<=200)&&Buffer.byteLength(JSON.stringify(a.detail||{}))<=2048,'malformed/foreign observer phase');
     pendingMarks.push({...a,nativeSeconds:record.startTime,sessionId:session.sessionId,epoch,contextId:boundContext,clock:'page-performance'});
    }else{if(a.phase==='open'){check(contexts.size===1&&boundContext===null,'unique initial main context required');boundContext=[...contexts.keys()][0];}pendingAnchors.push({...a,nativeSeconds:record.startTime,sessionId:session.sessionId,epoch,contextId:boundContext});}}});const row=put('Timeline.eventRecorded',event);if(row){anchors.push(...pendingAnchors.map(anchor=>({...anchor,eventIndex:row.index})));observerMarks.push(...pendingMarks.map(mark=>({...mark,eventIndex:row.index})));}}catch(error){fail(error);}});
  for(const event of ['trackingStart','trackingUpdate','trackingComplete'])listen('CPUProfiler.'+event,value=>{try{current();const raw=event==='trackingUpdate'?value.event:value;check(raw&&Number.isFinite(raw.timestamp),'malformed CPU timestamp');if(event==='trackingUpdate')check(Number.isFinite(raw.usage)&&raw.usage>=0&&(!raw.threads||Array.isArray(raw.threads)&&raw.threads.every(row=>typeof row.name==='string'&&Number.isFinite(row.usage)&&row.usage>=0)),'malformed CPU usage');const row=put('CPUProfiler.'+event,value);if(row){capture.cpu.events.push(row);capture.cpu.status='observed';}}catch(error){fail(error);}});
  listen('Debugger.paused',()=>fail('debugger pause invalidates clock'));listen('Timeline.recordingStopped',()=>{if(!stopping)fail('unexpected Timeline stop');});
  const hook=async()=>{fail('initial-only provisional/session replacement refused');throw Error('Linux native initial-only session replacement refused');};delegate._initializeSession=hook;
  const cpuCommand=async method=>{const before=stamp();try{await deadline(session.send(method));capture.cpu.commands.push({method,status:'supported',before,after:stamp()});return true;}catch(error){capture.cpu.commands.push({method,status:'unavailable',error:String(error),before,after:stamp()});capture.cpu.status='unavailable';return false;}};
  const stop=reason=>stopPromise??=(async()=>{
   clearTimeout(timer);capture.cleanup.timerCleared=true;
   try{if(!halted)current();else check(session.connection===initialConnection&&!session.isDisposed(),'original owned session unavailable for page hook cleanup');if(boundContext!==null){const cleanupOnly=halted,request=stamp(),result=await deadline(session.send('Runtime.evaluate',{contextId:boundContext,returnByValue:true,expression:`(()=>{const d=window.__nativeTimelineDocument;if(!d)return null;const pageMs=performance.now();if(!${cleanupOnly})performance.mark(${JSON.stringify(prefix)}+JSON.stringify({phase:'close',documentId:d.id,pageMs}),{startTime:pageMs});const observerHookStatus=window.__nativeLinuxPhase===d.observerHook?(delete window.__nativeLinuxPhase?'removed':'refused'):'foreign-preserved';return{id:d.id,timeOrigin:d.timeOrigin,fixtureDocumentId:window.__installedFixture?.documentId??null,url:location.href,pageMs,observerHookStatus};})()`}));check(!result.wasThrown,'close clock evaluation failed');const document=result.result?.value;capture.pageObserverHook={status:document?.observerHookStatus||'unavailable'};if(mode==='same-browser-history-v2')check(document?.observerHookStatus==='removed','owned page observer cleanup unavailable or replaced');if(document)capture.documents.push({...document,contextId:boundContext,sessionId:session.sessionId,epoch,hostBracket:{request,returned:stamp()}});}}catch(error){fail(error);}
   stopping=true;capture.stopReason=reason;
   if(cpuStarted)await cpuCommand('CPUProfiler.stopTracking');
   let stopped=true;for(const method of ['Timeline.stop','Timeline.disable'])try{check(session.connection===initialConnection&&!session.isDisposed(),'original owned session unavailable during stop');await deadline(session.send(method));}catch(error){stopped=false;capture.errors.push(String(error));}
   capture.cpu.stopCompletion={status:capture.cpu.events.some(row=>row.kind==='CPUProfiler.trackingComplete')?'observed':'unavailable',scope:'Actual native event only; command acknowledgement alone is not tracking completion'};
   halted=true;capture.cleanup.sessionsStopped=stopped;
   for(const [event,fn]of listeners)session.off(event,fn);capture.cleanup.listenersRemoved=true;
   if(delegate._initializeSession===hook){if(descriptor)Object.defineProperty(delegate,'_initializeSession',descriptor);else delete delegate._initializeSession;capture.cleanup.hookRestored=true;}else capture.errors.push('Owned hook replaced; foreign property preserved');
   capture.scheduler=sampler?.stop()??{status:'unavailable',reason:'Sampler never started',cleanup:true};capture.cleanup.samplerStopped=capture.scheduler.cleanup===true;
   const valid=anchors.filter(a=>capture.documents.some(d=>d.id===a.documentId&&d.contextId===a.contextId));
   if(valid.length>=2){const first=valid[0],offsetMs=first.pageMs-1000*first.nativeSeconds;if(valid.some(a=>a.phase==='open')&&valid.some(a=>a.phase==='close')&&valid.at(-1).pageMs>first.pageMs&&valid.every(a=>a.documentId===first.documentId&&Math.abs(a.pageMs-1000*a.nativeSeconds-offsetMs)<=1.001))capture.facts.calibration={status:'bounded',rate:1,offsetMs,uncertaintyMs:1.001,anchors:valid,scope:'Timeline/page only; CPU and scheduler clocks remain separately bracketed'};}
   const clockDocument=capture.documents.at(-1);capture.facts.hostPageClock=clockDocument&&Number.isFinite(clockDocument.pageMs)?{status:'observed-bracket',pageMs:clockDocument.pageMs,hostMonotonicBracket:[clockDocument.hostBracket.request.monotonicMs,clockDocument.hostBracket.returned.monotonicMs],widthMs:clockDocument.hostBracket.returned.monotonicMs-clockDocument.hostBracket.request.monotonicMs,scope:'One actual same-document evaluation bracket; no CPU timestamp conversion or extrapolated scheduler attribution'}:{status:'unavailable',reason:'No returned same-document page clock value'};
   const openPhases=new Map(),phaseSource={'fixture-source-encode':'scripts/button-safety-scenes.mjs','safety-scan':'scripts/button-safety-native.mjs','fixture-source-transport':'scripts/button-safety-native.mjs','host-source-serialization':'scripts/button-safety-native.mjs','safety-binding':'scripts/button-safety-native.mjs'};
   for(const mark of observerMarks){
    const key=mark.clock+':'+mark.id,previous=openPhases.get(key);
    if(mark.boundary==='begin'){if(previous){capture.errors.push('Duplicate observer phase begin');continue;}openPhases.set(key,mark);continue;}
    if(!previous||previous.name!==mark.name||previous.documentId!==mark.documentId||previous.contextId!==mark.contextId){capture.errors.push('Unmatched/foreign observer phase end');continue;}
    openPhases.delete(key);const module=provenance.modules?.find(row=>row.path===phaseSource[mark.name]),calibration=capture.facts.calibration,within=mark.clock==='page-performance'&&calibration.status==='bounded'&&previous.nativeSeconds>=calibration.anchors[0].nativeSeconds&&mark.nativeSeconds<=calibration.anchors.at(-1).nativeSeconds;
    const ordered=mark.clock==='page-performance'?mark.pageMs>=previous.pageMs:mark.monotonicMs>=previous.monotonicMs;if(!ordered)capture.errors.push('Reversed observer phase clock');
    capture.facts.observerPhases.push({name:mark.name,id:mark.id,documentId:mark.documentId,fixtureDocumentId:mark.fixtureDocumentId??null,contextId:mark.contextId,sessionId:session.sessionId,epoch,eventIndices:[previous.eventIndex,mark.eventIndex],clock:mark.clock,begin:previous,end:mark,sourceBinding:module?{status:'bound-observer-module',path:module.path,sha256:module.sha256,bytes:module.bytes,basis:'Explicit observer operation brackets; not an application CPU attribution'}:{status:'unavailable',path:phaseSource[mark.name]},pageInterval:within?{status:'bounded',startMs:previous.pageMs,endMs:mark.pageMs,uncertaintyMs:calibration.uncertaintyMs}:{status:'unavailable',reason:'Host scopes retain their actual clocks; no extrapolated CPU/page mapping'},causalAttribution:'unavailable'});
   }
   if(openPhases.size){capture.errors.push('Observer phase did not finish before stop');capture.facts.unfinishedObserverPhases=[...openPhases.values()];}
   capture.stopped=stamp();
   try{
    const byURL=new Map();capture.sources=sources().map(source=>{check(typeof source.url==='string'&&!byURL.has(source.url)&&typeof source.path==='string'&&!path.isAbsolute(source.path)&&!source.path.split(/[\\/]/).includes('..'),'unique owned source reference');const bytes=fs.readFileSync(path.join(outputDir,source.path));check(bytes.length===source.bytes&&hash(bytes)===source.sha256,'source byte identity changed');byURL.set(source.url,source);return source;});
    for(const row of capture.events)if(row.kind==='Timeline.eventRecorded'){
     const bytes=fs.readFileSync(path.join(outputDir,row.path));check(bytes.length===row.bytes&&hash(bytes)===row.sha256,'raw byte identity changed');
     walk(JSON.parse(bytes).record,record=>{if(!['FunctionCall','EvaluateScript'].includes(record.type))return;const fields=record.type==='FunctionCall'?['scriptName','scriptLine','scriptColumn']:['url','lineNumber','columnNumber'],url=record.data[fields[0]],source=byURL.get(url);check(Number.isFinite(record.endTime)&&record.endTime>=record.startTime,'native work interval required');const calibration=capture.facts.calibration,anchors=calibration.anchors||[],within=calibration.status==='bounded'&&record.startTime>=anchors[0].nativeSeconds&&record.endTime<=anchors.at(-1).nativeSeconds;
      capture.facts.work.push({eventIndex:row.index,sessionId:row.sessionId,epoch:row.epoch,type:record.type,startSeconds:record.startTime,endSeconds:record.endTime,durationMs:1000*(record.endTime-record.startTime),caller:{url:url??null,line:record.data[fields[1]]??null,column:record.data[fields[2]]??null,coordinateBasis:'native-verbatim; base-unestablished'},sourceBinding:source?{status:'bound',sha256:source.sha256,bytes:source.bytes,kind:source.kind}:{status:url?'unbound':'unlocated'},pageInterval:within?{status:'bounded',startMs:1000*record.startTime+calibration.offsetMs,endMs:1000*record.endTime+calibration.offsetMs,uncertaintyMs:calibration.uncertaintyMs}:{status:'unavailable',reason:'outside a bounded same-document Timeline/page interval'},cpuUsage:'unmeasured for this scope',causalAttribution:'unavailable'});
     });
    }
    capture.provenanceAfter=verifyRuntime({repo});check(JSON.stringify(capture.provenance.files)===JSON.stringify(capture.provenanceAfter.files)&&JSON.stringify(capture.provenance.modules)===JSON.stringify(capture.provenanceAfter.modules),'fresh runtime/source hashes changed during capture');
   }catch(error){capture.errors.push(String(error));}
   capture.sourceBytes=capture.sources?.reduce((sum,row)=>sum+row.bytes,0)??0;
   if(capture.rawBytes+capture.sourceBytes>33554432)capture.errors.push('shared raw/source bound exceeded');
   capture.status=capture.errors.length||capture.dropped||capture.scheduler.status==='incomplete'||!cpuStarted?'incomplete':capture.events.length?'captured':'unavailable';notify();return capture;
  })();
  try{
   onStop(stop);timer=setTimeout(()=>{fail('native capture duration bound');void stop('duration-limit');},12000);
   await deadline(session.send('Timeline.enable'));check(!halted&&!stopping,'arming stopped');
   try{await deadline(session.send('Timeline.setInstruments',{instruments:['Timeline','CPU']}));}catch(error){capture.cpu.commands.push({method:'Timeline.setInstruments CPU',status:'unavailable',error:String(error),observed:stamp()});await deadline(session.send('Timeline.setInstruments',{instruments:['Timeline']}));}
   cpuStarted=await cpuCommand('CPUProfiler.startTracking');
   await deadline(session.send('Timeline.start',{maxCallStackDepth:8}));check(!halted&&!stopping,'arming stopped');
   const source=canonicalStartupSource(({prefix})=>{if(window.top!==window)return;const d=window.__nativeTimelineDocument={id:crypto.randomUUID(),timeOrigin:performance.timeOrigin};const pageMs=performance.now();performance.mark(prefix+JSON.stringify({phase:'open',documentId:d.id,pageMs}),{startTime:pageMs});
    let sequence=0;window.__nativeLinuxPhase=(name,boundary,id,detail={})=>{if(boundary==='begin')id=d.id+':'+(++sequence);const pageMs=performance.now();performance.mark(prefix+JSON.stringify({phase:'observer',name,boundary,id,detail,documentId:d.id,fixtureDocumentId:window.__installedFixture?.documentId??null,pageMs}),{startTime:pageMs});return id;};d.observerHook=window.__nativeLinuxPhase;
   },{prefix},sourceURL);
   capture.instrumentation=source;await page.addInitScript({content:source.content});capture.startedBeforeNavigation=true;
   sampler=createLinuxSampler({accept:value=>{const row=put('scheduler-sample',value);if(row)capture.samples.push(row);},onFailure:fail});notify();return{capture,stop,phase};
  }catch(error){fail(error);await stop('arming-failed');throw error;}
 };
}

export const startLinuxNativeTimelineCapture=createLinuxNativeTimelineProvider();
