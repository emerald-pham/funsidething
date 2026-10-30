import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {canonicalStartupSource} from './button-safety-startup.mjs';
export {canonicalStartupSource} from './button-safety-startup.mjs';

//1468 vendor release/build mapping, not an assertion about the private C++ recipe.
export const TIMELINE_PROVENANCE=Object.freeze({playwright:'1.62.1',webkitRevision:'2336',node:'v24.19.0',coreBundle:'9393fa79e1c67c74edc26b610d65a4f7ed73d345a762465cc88340a33a2454ac',protocol:'448bdfe4851c841182a686d85cf3080672adbebf5dfc54d516eb3e3cd967e5fe',wrapper:'a85baad3d8c07173ac387a59b41500c382b21ed692afe0964d29aac247ccc63b',webkit:'0eb9d97522607740724d1f019f5ecc8cc1839d24a8152243a4d2d9c59a5de361',webcore:'9403414950b629fa8732c9ac3df48cbcd05828bf09cf0ad5423a466ce8aef3f3',jsc:'7f5f6858e7c990f616850c129757548483f56041f9cc7acff2771581ecfa903d',executable:'fbb73b3ee767f999e312bdf67095b95c81421185513e196a74f6f62a2f702845'});
export const TIMELINE_BOUNDS=Object.freeze({maxDurationMs:12000,maxEvents:4096,maxEventBytes:1048576,maxTotalBytes:33554432,maxFrames:120,maxFrameBytes:1048576});
const RETENTION_PROFILE='canonical-json-48mib-memory-png-v1';
const RETENTION_PROFILE_BOUNDS=Object.freeze({...TIMELINE_BOUNDS,maxTotalBytes:50331648,maxPhysicalPayloadBytes:33554432,maxPersistentPngBytes:0,maxDecodedPngInFlightBytes:1048576});
const RETENTION_PROFILES=Object.freeze({[RETENTION_PROFILE]:RETENTION_PROFILE_BOUNDS,'canonical-json-56mib-memory-png-v1':Object.freeze({...RETENTION_PROFILE_BOUNDS,maxTotalBytes:58720256})});
const hash=b=>createHash('sha256').update(b).digest('hex'),finite=n=>Number.isFinite(n)&&n>=0;
const check=(ok,message)=>assert.ok(ok,'Native Timeline '+message);
export function verifyNativeTimelineCapture(c,{retentionProfile}={}){
 const selected=c?.schemaVersion===3;
 if(selected)check(typeof retentionProfile==='string'&&Object.hasOwn(RETENTION_PROFILES,retentionProfile),'explicit retention profile consent required');
 const bounds=selected?RETENTION_PROFILES[retentionProfile]:TIMELINE_BOUNDS;
 if(selected)check(c.retentionProfile===retentionProfile,'selected retention profile mismatch');
 else check(retentionProfile===undefined,'retention profile does not match capture schema');
 check([1,2,3].includes(c?.schemaVersion)&&c.selected===true&&c.provider==='webkit-native-timeline','selected provider required');
 check(c.engine==='webkit'&&c.connection==='local-owned','owned local WebKit required');
 check(JSON.stringify(c.provenance)===JSON.stringify(TIMELINE_PROVENANCE),'exact1468 runtime provenance required');
 if(selected)assert.deepEqual(c.bounds,bounds,'Native Timeline fixed finite bounds required');
 else check(JSON.stringify(c.bounds)===JSON.stringify(bounds),'fixed finite bounds required');
 check(['captured','unavailable','error'].includes(c.status),'explicit outcome required');
 check(c.clock?.basis==='inspector-stopwatch-seconds'&&c.clock.fallback===false&&c.clock.pageClockConversion==='unavailable','native clock cannot be replaced with host/fallback time');
 check(c.startedBeforeNavigation===true&&finite(c.startedHostMonotonicMs)&&finite(c.stoppedHostMonotonicMs)&&c.stoppedHostMonotonicMs>=c.startedHostMonotonicMs&&c.stoppedHostMonotonicMs-c.startedHostMonotonicMs<=12000,'pre-navigation bounded lifetime required');
 check(typeof c.stopReason==='string'&&c.stopReason.length>0&&Array.isArray(c.errors),'stop outcome required');
 check(Array.isArray(c.sessions)&&c.sessions.length>0&&new Set(c.sessions.map(s=>s.id)).size===c.sessions.length,'unique owned sessions required');
 const sessions=new Map(c.sessions.map(s=>[s.id,s]));
 for(const s of c.sessions)check(typeof s.id==='string'&&s.id&&typeof s.epoch==='string'&&s.epoch&&(s.armedBeforeResume===true||s.role==='initial-blank'&&s.armedBeforeNavigation===true),'session was not armed before its relevant navigation/resume');
 check(Array.isArray(c.documents),'document bindings required');
 for(const d of c.documents)check(typeof d.id==='string'&&d.id&&sessions.has(d.sessionId)&&Number.isSafeInteger(d.contextId)&&d.contextId>0&&finite(d.timeOrigin),'exact document/context/session binding required');
 check(Array.isArray(c.events)&&Array.isArray(c.frames)&&c.events.length<=4096&&c.frames.length<=120,'raw event/frame limits required');
 check(c.counts&&['received','accepted','dropped'].every(k=>Number.isSafeInteger(c.counts[k])&&c.counts[k]>=0)&&c.counts.accepted===c.events.length&&c.counts.received===c.counts.accepted+c.counts.dropped,'raw counts must reconcile');
 const canonical=c.schemaVersion===2||selected;
 if(canonical)check(c.storage?.kind==='canonical-native-json-derived-png','canonical storage kind required');
 const paths=new Set();let bytes=0,rawBytes=0,frameBytes=0;
 for(const [i,e]of c.events.entries()){
  check(e.index===i+1&&/^startup-timeline\/event-[0-9]{4}\.json$/.test(e.path)&&!paths.has(e.path)&&e.epoch===sessions.get(e.sessionId)?.epoch,'raw event identity/epoch/path required');paths.add(e.path);
  check(Number.isSafeInteger(e.bytes)&&e.bytes>0&&e.bytes<=1048576&&/^[a-f0-9]{64}$/.test(e.sha256),'raw event bytes/hash required');bytes+=e.bytes;rawBytes+=e.bytes;
 }
 for(const [i,f]of c.frames.entries()){
  check(f.index===i+1&&/^startup-timeline\/frame-[0-9]{4}\.png$/.test(f.path)&&!paths.has(f.path)&&Number.isSafeInteger(f.eventIndex)&&c.events[f.eventIndex-1]?.sessionId===f.sessionId&&Array.isArray(f.recordPath)&&f.recordPath.every(n=>Number.isSafeInteger(n)&&n>=0),selected?'snapshot frame/raw-record path correlation required':'snapshot/raw-record correlation required');paths.add(f.path);
  check(finite(f.startSeconds)&&finite(f.endSeconds)&&f.endSeconds>=f.startSeconds&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=1048576&&/^[a-f0-9]{64}$/.test(f.sha256),'bounded native snapshot interval required');bytes+=f.bytes;frameBytes+=f.bytes;
 }
 check(Number.isSafeInteger(bytes)&&c.totalBytes===bytes&&bytes<=bounds.maxTotalBytes,selected?'logical total bytes must reconcile':'total written bytes must reconcile');
 if(canonical){
  let orphanBytes=0;check(c.orphans===undefined||Array.isArray(c.orphans)&&c.orphans.length<=1,'bounded owned orphan inventory required');
  for(const row of c.orphans||[]){check(/^startup-timeline\/event-[0-9]{4}\.json$/.test(row.path)&&!paths.has(row.path)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=1048576&&/^[a-f0-9]{64}$/.test(row.sha256),'owned partial write identity required');paths.add(row.path);orphanBytes+=row.bytes;}
  check(c.rawEventBytes===rawBytes&&c.derivedFrameBytes===frameBytes&&Number.isSafeInteger(c.physicalPayloadBytes)&&c.physicalPayloadBytes===rawBytes+orphanBytes&&c.physicalPayloadBytes<=33554432,'canonical physical/logical bytes must reconcile');
  if(c.status==='captured')check(orphanBytes===0&&!(c.orphans||[]).length,'captured cannot hide partial writes');
 }
 check(c.facts?.presentation==='engine-content-snapshot; first-occurrence-unverified'&&Array.isArray(c.facts.work),'snapshot is not first presentation');
 for(const w of c.facts.work)check(w.kind==='instrumented-sync'&&finite(w.startSeconds)&&finite(w.endSeconds)&&w.endSeconds>=w.startSeconds&&typeof w.caller==='string'&&w.caller.length>0&&typeof w.source==='string'&&w.source.length>0,'instrumented caller scope required; async wait is not CPU work');
 const calibration=c.facts.calibration;check(calibration&&['unavailable','bounded'].includes(calibration.status),'explicit calibration outcome required');
 if(calibration.status==='bounded'){
  const a=calibration.anchors;check(Array.isArray(a)&&a.length>=2&&calibration.rate===1&&finite(calibration.uncertaintyMs)&&calibration.uncertaintyMs<=1.001&&Number.isFinite(calibration.offsetMs),'bounded same-clock anchors required');
  const d=c.documents.find(d=>d.id===a[0].documentId);check(d&&a.every(x=>x.documentId===d.id&&x.contextId===d.contextId&&x.sessionId===d.sessionId&&x.epoch===sessions.get(d.sessionId)?.epoch&&finite(x.pageMs)&&finite(x.nativeSeconds)),'same document/context/epoch anchors required');
  check(a.at(-1).pageMs>a[0].pageMs&&a.at(-1).nativeSeconds>a[0].nativeSeconds&&a.every(x=>Math.abs(x.pageMs-1000*x.nativeSeconds-calibration.offsetMs)<=calibration.uncertaintyMs),'anchor offset/rate/reset disagreement');
 }
 check(c.cleanup?.listenersRemoved===true&&c.cleanup.hookRestored===true&&c.cleanup.sessionsStopped===true&&c.cleanup.timerCleared===true,'owned listener/hook/session/timer cleanup required');
 if(c.status==='captured')check(c.events.length>0&&c.errors.length===0&&c.counts.dropped===0,'captured cannot hide loss/error');
 return c;
}


// Only this explicit diagnostic mode obtains the private in-process owned session.
export function createNativeTimelineProvider({verifyRuntime}={}){
 check(typeof verifyRuntime==='function','mandatory runtime verifier required');
 // Construction is import-safe. Only an actual start activates the mandatory guard.
 return async function startNativeTimelineCapture({page,outputDir,sourceURL,onSave=()=>{},onStop=()=>{},retentionProfile}){
 check(retentionProfile===undefined||typeof retentionProfile==='string'&&Object.hasOwn(RETENTION_PROFILES,retentionProfile),'unknown retention profile');
 const selectedRetention=retentionProfile!==undefined,bounds=selectedRetention?RETENTION_PROFILES[retentionProfile]:TIMELINE_BOUNDS;
 const provenance=verifyRuntime();check(JSON.stringify(provenance)===JSON.stringify(TIMELINE_PROVENANCE),'exact verifier provenance required');
 canonicalStartupSource('',undefined,sourceURL);
 const connection=page?._connection;
 check(page?._type==='Page'&&typeof connection?.toImpl==='function','in-process owned Page required');
 const impl=connection.toImpl(page),delegate=impl?.delegate,initial=delegate?._session;
 check(delegate?._page===impl&&impl?.browserContext?._browser?.options?.browserType==='webkit'&&initial&&typeof initial.send==='function'&&!initial.isDisposed()&&typeof delegate._initializeSession==='function','Page/delegate/live WebKit session back-map required');
 check(page.url()==='about:blank'&&impl.mainFrame().url()==='about:blank','initial blank Page/main-frame required; late navigation is unavailable');
 const descriptor=Object.getOwnPropertyDescriptor(delegate,'_initializeSession'),original=delegate._initializeSession,nonce=randomUUID(),prefix='native-timeline:'+nonce+':',directory=path.join(outputDir,'startup-timeline');fs.mkdirSync(directory);
 const capture={schemaVersion:selectedRetention?3:2,...(selectedRetention?{retentionProfile}:{}),storage:{kind:'canonical-native-json-derived-png'},rawEventBytes:0,derivedFrameBytes:0,physicalPayloadBytes:0,orphans:[],selected:true,provider:'webkit-native-timeline',status:'running',engine:'webkit',connection:'local-owned',provenance,bounds:{...bounds},clock:{basis:'inspector-stopwatch-seconds',fallback:false,pageClockConversion:'unavailable'},startedBeforeNavigation:false,startedHostMonotonicMs:performance.now(),stoppedHostMonotonicMs:null,stopReason:null,sessions:[],documents:[],counts:{received:0,accepted:0,dropped:0},totalBytes:0,events:[],frames:[],errors:[],facts:{calibration:{status:'unavailable',reason:'No matched same-document pre/post native marks'},work:[],presentation:'engine-content-snapshot; first-occurrence-unverified'},cleanup:{listenersRemoved:false,hookRestored:false,sessionsStopped:false,timerCleared:false},overhead:'Diagnostic instance session initialization hook, native Timeline/Screenshot instrumentation, page marks, raw synchronous bounded writes; no OS presentation acknowledgement'};
 const owned=new Map(),listeners=[],anchors=[],contexts=new Map();let halted=false,stopping=false,stopPromise,timer,boundMainContext=null;
 const deadline=async work=>{let t;try{return await Promise.race([work,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('native command deadline')),1000);})]);}finally{clearTimeout(t);}};
 const fail=error=>{capture.errors.push(String(error).slice(0,500));capture.status='error';halted=true;try{onSave(capture);}catch(error){capture.errors.push('onSave: '+String(error).slice(0,500));}finally{queueMicrotask(()=>{void stop('capture-error');});}};
 const listen=(session,event,handler)=>{session.on(event,handler);listeners.push([session,event,handler]);};
 const walk=walkNativeRecords;
 const receive=(session,event)=>{
  capture.counts.received++;
  if(halted){capture.counts.dropped++;return;}
  let availableEventBytes=null,availableFrameBytes=null,prospectiveLogicalBytes=null,prospectivePhysicalBytes=null;
  try{
   check(performance.now()-capture.startedHostMonotonicMs<=TIMELINE_BOUNDS.maxDurationMs,'native duration bound reached before delivery acceptance');
   const bytes=Buffer.from(JSON.stringify(event)),screens=[];availableEventBytes=bytes.length;
   check(bytes.length<=1048576&&capture.events.length<4096,'raw event bound reached');
   walk(event.record,(record,recordPath)=>{if(record.type==='Screenshot'){
    check(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(record.data?.imageData||''),'native PNG data required');const data=Buffer.from(record.data.imageData.split(',')[1],'base64');check(data.toString('base64')===record.data.imageData.split(',')[1]&&data.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&data.length<=1048576&&finite(record.startTime)&&finite(record.endTime)&&record.endTime>=record.startTime,'native snapshot bound/interval');screens.push(selectedRetention?{bytes:data.length,sha256:hash(data),record,recordPath}:{data,record,recordPath});
   }});
   availableFrameBytes=screens.reduce((n,s)=>n+(selectedRetention?s.bytes:s.data.length),0);prospectiveLogicalBytes=capture.totalBytes+bytes.length+availableFrameBytes;prospectivePhysicalBytes=capture.physicalPayloadBytes+bytes.length;
   check(capture.frames.length+screens.length<=120,'raw frame bound reached');
   check(Number.isSafeInteger(prospectiveLogicalBytes)&&prospectiveLogicalBytes<=bounds.maxTotalBytes,'raw logical total byte bound reached');
   check(Number.isSafeInteger(prospectivePhysicalBytes)&&prospectivePhysicalBytes<=33554432,'raw physical payload bound reached');
   const index=capture.events.length+1,relative='startup-timeline/event-'+String(index).padStart(4,'0')+'.json',row=owned.get(session);
   // One exclusive canonical file owns the delivery. Derived PNGs are views,
   // charged once per occurrence logically, without a persistent duplicate.
   let fd,created=false;
   try{
    fd=fs.openSync(path.join(outputDir,relative),'wx+');created=true;let written=0;
    while(written<bytes.length){const n=fs.writeSync(fd,bytes,written,bytes.length-written,written);check(n>0,'canonical write made no progress');written+=n;}
    capture.rawEventBytes+=bytes.length;capture.physicalPayloadBytes+=bytes.length;capture.totalBytes+=bytes.length;capture.events.push({index,sessionId:session.sessionId,epoch:row.epoch,bytes:bytes.length,sha256:hash(bytes),path:relative});capture.counts.accepted++;
    for(const item of screens){const i=capture.frames.length+1,relative='startup-timeline/frame-'+String(i).padStart(4,'0')+'.png',bytes=selectedRetention?item.bytes:item.data.length,sha256=selectedRetention?item.sha256:hash(item.data);capture.derivedFrameBytes+=bytes;capture.totalBytes+=bytes;capture.frames.push({index:i,path:relative,bytes,sha256,sessionId:session.sessionId,eventIndex:index,recordPath:item.recordPath,startSeconds:item.record.startTime,endSeconds:item.record.endTime});}
   }catch(error){
    if(created){const size=fs.fstatSync(fd).size;check(Number.isSafeInteger(size)&&size>=0&&size<=bytes.length,'partial canonical write size required');const partial=Buffer.alloc(size);let read=0;while(read<size){const n=fs.readSync(fd,partial,read,size-read,read);check(n>0,'partial canonical read made no progress');read+=n;}capture.orphans.push({path:relative,bytes:size,sha256:hash(partial)});capture.physicalPayloadBytes+=size;}
    throw error;
   }finally{if(fd!==undefined)fs.closeSync(fd);}
   walk(event.record,r=>{if(r.type==='TimeStamp'&&r.data?.message?.startsWith(prefix)){const a=JSON.parse(r.data.message.slice(prefix.length));check(['open','close'].includes(a.phase)&&typeof a.documentId==='string'&&a.documentId&&finite(r.startTime)&&finite(a.pageMs),'malformed document mark');if(a.phase==='open'){const main=[...contexts.values()].filter(x=>x.session===session&&x.context.frameId===impl.mainFrame()._id);check(main.length===1,'unique initial main context required');check(boundMainContext===null,'unexpected document/context replacement');boundMainContext=main[0].context.id;}anchors.push({...a,sessionId:session.sessionId,epoch:row.epoch,nativeSeconds:r.startTime});check(new Set(anchors.filter(x=>x.phase==='open').map(x=>x.documentId)).size<=1,'unexpected document replacement');}});
   onSave(capture);
  }catch(error){if(capture.counts.received>capture.counts.accepted+capture.counts.dropped){capture.counts.dropped++;capture.firstRejection??={reason:String(error).slice(0,500),eventBytes:availableEventBytes,derivedFrameBytes:availableFrameBytes,prospectiveLogicalBytes,prospectivePhysicalBytes,received:capture.counts.received};}fail(error);}
 };
 const arm=async(session,role)=>{
  check(!halted&&!stopping&&!owned.has(session)&&session.connection===initial.connection&&!session.isDisposed()&&session.constructor===initial.constructor&&capture.sessions.length<2,'foreign/reused/disposed/stopped native session or initial/provisional bound');
  const row={id:session.sessionId,epoch:randomUUID(),role,armedBeforeResume:false,armedBeforeNavigation:false};check(!capture.sessions.some(x=>x.id===row.id),'reused target ID');owned.set(session,row);capture.sessions.push(row);
  listen(session,'Timeline.eventRecorded',event=>receive(session,event));
  listen(session,'Runtime.executionContextCreated',({context})=>{if(context?.type==='normal'){
   if(!Number.isSafeInteger(context.id)||context.id<=0||typeof context.frameId!=='string'||!context.frameId||contexts.has(session.sessionId+':'+context.id)){fail('unexpected native document context');return;}
   if(context.frameId===impl.mainFrame()._id){if(boundMainContext!==null){fail('bound main context replacement');return;}for(const [key,value]of contexts)if(value.session===session&&value.context.frameId===context.frameId)contexts.delete(key);}
   contexts.set(session.sessionId+':'+context.id,{session,context});
  }});
  listen(session,'Runtime.executionContextsCleared',()=>{if(boundMainContext!==null){fail('bound main context reset');return;}for(const [key,value]of contexts)if(value.session===session)contexts.delete(key);});
  listen(session,'Debugger.paused',()=>fail('stopwatch debugger pause invalidates calibration'));
  listen(session,'Timeline.recordingStopped',()=>{if(!halted&&!stopping)fail('unexpected recording epoch stop');});
  await deadline(session.send('Timeline.enable'));check(!halted&&!stopping,'arming stopped');await deadline(session.send('Timeline.setInstruments',{instruments:['Timeline','Screenshot']}));check(!halted&&!stopping,'arming stopped');await deadline(session.send('Timeline.start',{maxCallStackDepth:8}));check(!halted&&!stopping,'arming stopped');
  if(role==='initial-blank')row.armedBeforeNavigation=true;else row.armedBeforeResume=true;
 };
 const hook=async function(){
  const error=Error('Native Timeline initial-only: provisional/session initialization is unvalidated');fail(error);throw error;
 };
 delegate._initializeSession=hook;
 const stop=reason=>{
  if(stopPromise)return stopPromise;
  stopPromise=Promise.resolve().then(async()=>{
   clearTimeout(timer);capture.cleanup.timerCleared=true;
   if(!halted)try{
    check(owned.has(delegate._session)&&!delegate._session.isDisposed(),'unarmed/replaced active native session');
    for(const {session,context}of contexts.values())if(session===delegate._session&&context.frameId===impl.mainFrame()._id&&context.id===boundMainContext){
     const result=await deadline(session.send('Runtime.evaluate',{contextId:context.id,returnByValue:true,expression:`(()=>{const d=window.__nativeTimelineDocument;if(!d)return null;const pageMs=performance.now();performance.mark(${JSON.stringify(prefix)}+JSON.stringify({phase:'close',documentId:d.id,pageMs}),{startTime:pageMs});return {id:d.id,timeOrigin:d.timeOrigin,url:location.href};})()`}));
     check(!result.wasThrown,'document anchor evaluation failed');const d=result.result?.value;if(d)capture.documents.push({...d,sessionId:session.sessionId,contextId:context.id});
    }
   }catch(error){fail(error);}
   stopping=true;capture.stopReason=reason;
   // Native stop flushes pending records before its reply. Keep intake/listeners
   // live through that reply; stopping intake first silently lost the final work.
   let stopped=true;for(const session of owned.keys())try{check(!session.isDisposed(),'session disposed before raw finalization');await deadline(session.send('Timeline.stop'));await deadline(session.send('Timeline.disable'));}catch(error){stopped=false;capture.errors.push(String(error));}
   halted=true;capture.cleanup.sessionsStopped=stopped;
   for(const [session,event,listener]of listeners)session.off(event,listener);capture.cleanup.listenersRemoved=true;
   if(delegate._initializeSession===hook){if(descriptor)Object.defineProperty(delegate,'_initializeSession',descriptor);else delete delegate._initializeSession;capture.cleanup.hookRestored=true;}else capture.errors.push('Owned lifecycle hook was externally replaced; preserved foreign property');
   const valid=anchors.filter(a=>capture.documents.some(d=>d.id===a.documentId&&d.sessionId===a.sessionId));
   if(valid.length>=2){const first=valid[0],same=valid.filter(a=>a.documentId===first.documentId&&a.sessionId===first.sessionId&&a.epoch===first.epoch),d=capture.documents.find(d=>d.id===first.documentId),offset=first.pageMs-1000*first.nativeSeconds;
    if(same.some(a=>a.phase==='open')&&same.some(a=>a.phase==='close')&&same.at(-1).pageMs>same[0].pageMs&&same.every(a=>Math.abs(a.pageMs-1000*a.nativeSeconds-offset)<=1.001))capture.facts.calibration={status:'bounded',rate:1,offsetMs:offset,uncertaintyMs:1.001,anchors:same.map(a=>({...a,contextId:d.contextId})),limit:'Candidate native/page map under1468 source model; no first-presentation guarantee'};
   }
   // Producer raw facts stay separate from later, byte-bound pure derivation.
   capture.stoppedHostMonotonicMs=performance.now();capture.status=capture.errors.length||capture.counts.dropped?'error':capture.startedBeforeNavigation&&capture.events.length?'captured':'unavailable';onSave(capture);return capture;
  });return stopPromise;
 };
 try{
  // Register cleanup before any await so the existing controller watchdog can
  // stop a partially armed owner instead of abandoning an instance hook.
  onStop(stop);
  timer=setTimeout(()=>{fail('native capture duration bound');void stop('duration-limit');},TIMELINE_BOUNDS.maxDurationMs);
  await arm(initial,'initial-blank');
  const script=canonicalStartupSource(({prefix})=>{if(window.top!==window)return;const d=window.__nativeTimelineDocument={id:crypto.randomUUID(),timeOrigin:performance.timeOrigin};const pageMs=performance.now();performance.mark(prefix+JSON.stringify({phase:'open',documentId:d.id,pageMs}),{startTime:pageMs});},{prefix},sourceURL);
  capture.instrumentation=script;await page.addInitScript({content:script.content});
  capture.startedBeforeNavigation=true;onSave(capture);return{capture,stop};
 }catch(error){fail(error);await stop('arming-failed');throw error;}
}
}

// Iterative bounded traversal preserves native structural identity. The caller
// retains the source bytes; no receipt-order reconstruction or truncation occurs.
function walkNativeRecords(root,visit){
 const pending=[{record:root,recordPath:[],parent:null}];let count=0;
 while(pending.length){const item=pending.pop(),r=item.record;
  check(r&&typeof r==='object'&&!Array.isArray(r)&&typeof r.type==='string'&&r.type.length>0&&finite(r.startTime),'raw record type/start required');
  check(item.recordPath.length<=64&&++count<=16384,'raw record traversal bound exceeded');
  if(r.endTime!==undefined)check(finite(r.endTime)&&r.endTime>=r.startTime,'raw record interval required');
  check(r.data&&typeof r.data==='object'&&!Array.isArray(r.data),'raw record data required');
  if(r.children!==undefined)check(Array.isArray(r.children),'raw children must be an array');
  visit(r,item.recordPath,item.parent);
  for(let i=(r.children?.length||0)-1;i>=0;i--)pending.push({record:r.children[i],recordPath:[...item.recordPath,i],parent:{recordPath:item.recordPath,type:r.type,data:r.data}});
 }
}
const sha256Pattern=/^[a-f0-9]{64}$/;
function verifyStackTrace(stack,clone=true){
 let current=stack,depth=0;
 while(current!==undefined){
  check(current&&typeof current==='object'&&!Array.isArray(current)&&Array.isArray(current.callFrames)&&current.callFrames.length<=64&&++depth<=64,'typed stack object/frame/parent bounds required');
  for(const frame of current.callFrames)check(frame&&typeof frame==='object'&&!Array.isArray(frame)&&['functionName','url','scriptId'].every(k=>typeof frame[k]==='string')&&['lineNumber','columnNumber'].every(k=>Number.isSafeInteger(frame[k])&&frame[k]>=0),'verbatim typed stack frame required');
  for(const field of ['topCallFrameIsBoundary','truncated'])if(current[field]!==undefined)check(typeof current[field]==='boolean','typed stack flag required');
  current=current.parentStackTrace;
 }
 return clone?structuredClone(stack):stack;
}

// Pure byte-to-evidence consumer. Filesystem custody/realpath checks belong to
// the loader: this boundary accepts bytes, never paths that it opens itself.
export function deriveNativeTimelineEvidence({capture,captureBytes,expectedCaptureSha256,rawInventoryBytes,rawFiles,sources,producer,consumer,retentionProfile,access=null,reference=null}={}){
 check(Buffer.isBuffer(captureBytes)&&captureBytes.length<=1048576&&sha256Pattern.test(expectedCaptureSha256||'')&&hash(captureBytes)===expectedCaptureSha256,'capture bytes/hash binding required');
 const parse=(bytes,label)=>{try{return JSON.parse(bytes.toString('utf8'));}catch{check(false,label+' JSON required');}};
 const parsed=parse(captureBytes,'capture');assert.deepEqual(capture,parsed,'Native Timeline capture object must equal exact bytes');verifyNativeTimelineCapture(capture,{retentionProfile});
 const canonical=capture.schemaVersion===2||capture.schemaVersion===3,partial=canonical&&capture.status!=='captured';
 check((capture.status==='captured'||partial)&&capture.sessions.length===1&&capture.sessions[0].role==='initial-blank'&&capture.sessions[0].armedBeforeNavigation===true&&(partial?capture.documents.length<=1:capture.documents.length===1),'initial-only captured session/document required');
 const session=capture.sessions[0],document=capture.documents[0]||null;check(!document||document.sessionId===session.id,'sole main document session required');
 check(producer&&producer.captureSha256===expectedCaptureSha256&&sha256Pattern.test(producer.sourcePacketSha256||'')&&typeof producer.recorderId==='string'&&producer.recorderId.length>0,'original producer identity required');
 check(Buffer.isBuffer(rawInventoryBytes)&&rawInventoryBytes.length<=1048576&&hash(rawInventoryBytes)===producer.rawInventorySha256,'original raw inventory bytes/hash required');
 check(consumer&&typeof consumer.kind==='string'&&consumer.kind.length>0&&Array.isArray(consumer.modules)&&consumer.modules.length>0,'separate consumer identity required');
 const modulePaths=new Set();for(const module of consumer.modules){check(typeof module.path==='string'&&module.path.length>0&&!modulePaths.has(module.path)&&sha256Pattern.test(module.sha256||''),'consumer module identity/hash required');modulePaths.add(module.path);}
 check(!reference||access,'reference adapter requires owned byte access');
 const io=access||{physicalSize:rawFiles instanceof Map?rawFiles.size:-1,physicalKeys:()=>rawFiles.keys(),withPhysical:(entry,visit)=>visit(rawFiles.get(entry.path)),withEvent:(event,visit)=>visit(parse(rawFiles.get(event.path),'event'),null),withSource:(ordinal,visit)=>visit(sources[ordinal].bytes),withPNG:(encoded,visit)=>visit(Buffer.from(encoded.slice('data:image/png;base64,'.length),'base64'))};
 const entries=[...capture.events,...capture.frames,...(canonical?capture.orphans||[]:[])],physical=canonical?[...capture.events,...(capture.orphans||[])]:entries,inventory=parse(rawInventoryBytes,'inventory');check(Array.isArray(inventory)&&inventory.length===entries.length&&(access||rawFiles instanceof Map)&&io.physicalSize===physical.length,'complete declared raw inventory/map required');
 const byPath=new Map();for(const row of inventory){check(row&&typeof row.path==='string'&&!byPath.has(row.path),'unique inventory path required');byPath.set(row.path,row);}
 for(const entry of entries){const row=byPath.get(entry.path);check(row&&row.bytes===entry.bytes&&row.sha256===entry.sha256,'exact declared raw inventory identity required: '+entry.path);if(canonical)check(row.kind===(capture.events.includes(entry)?'canonical':capture.frames.includes(entry)?'derived-png':'orphan'),'canonical inventory kind required');}
 for(const entry of physical)io.withPhysical(entry,bytes=>check(Buffer.isBuffer(bytes)&&bytes.length===entry.bytes&&hash(bytes)===entry.sha256,'exact declared raw bytes/hash required: '+entry.path));
 for(const key of io.physicalKeys())check(physical.some(row=>row.path===key),'extra raw path refused');
 check(Array.isArray(sources),'explicit source bindings required');const sourceByURL=new Map();
 for(const [ordinal,source]of sources.entries())io.withSource(ordinal,bytes=>{check(source&&typeof source.url==='string'&&source.url.length>0&&!sourceByURL.has(source.url)&&Buffer.isBuffer(bytes)&&bytes.length<=33554432&&hash(bytes)===source.sha256&&sha256Pattern.test(source.sha256||''),'unique retained source URL/bytes/hash required');sourceByURL.set(source.url,{source,ordinal,length:bytes.length});if(reference)reference.sourceLength(ordinal,bytes.length);});
 const records=[],workScopes=[],stackObservations=[],rawAnchors=[],rawRecords=reference?null:new Map();let stackTruncated=false;
 for(const event of capture.events){check(event.sessionId===session.id&&event.epoch===session.epoch,'sole native session/epoch required');io.withEvent(event,(delivery,nodeIndex)=>{
  check(delivery&&typeof delivery==='object'&&!Array.isArray(delivery),'raw event delivery required');reference?.beginEvent(event,nodeIndex);
  try{walkNativeRecords(delivery.record,(record,recordPath,parent)=>{
   check(records.length<16384,'total record traversal bound exceeded');const identity={eventIndex:event.index,recordPath:[...recordPath],sessionId:event.sessionId,epoch:event.epoch};
   const row=reference?reference.record(record,recordPath,parent,event):{...identity,type:record.type,startSeconds:record.startTime,endSeconds:record.endTime??null,parent:parent?{eventIndex:event.index,recordPath:[...parent.recordPath],type:parent.type,data:structuredClone(parent.data)}:null,data:structuredClone(record.data)};
   records.push(row);if(rawRecords)rawRecords.set(event.index+':'+JSON.stringify(recordPath),{record,row});
   if(record.stackTrace!==undefined){const stackTrace=verifyStackTrace(record.stackTrace,!reference);for(let s=stackTrace;s;s=s.parentStackTrace)if(s.truncated)stackTruncated=true;stackObservations.push(reference?reference.stack(row):{...identity,type:record.type,atSeconds:record.startTime,stackTrace,durationAttribution:false,association:'this-native-record-only'});}
   if(['FunctionCall','EvaluateScript'].includes(record.type)){
    check(finite(record.endTime)&&record.endTime>=record.startTime,'source-located native interval required');const fields=record.type==='FunctionCall'?['scriptName','scriptLine','scriptColumn']:['url','lineNumber','columnNumber'],data=record.data;
    check(typeof data[fields[0]]==='string'&&Number.isSafeInteger(data[fields[1]])&&data[fields[1]]>=0&&Number.isSafeInteger(data[fields[2]])&&data[fields[2]]>=0,'verbatim source-located caller fields required');
    const url=data[fields[0]],bound=sourceByURL.get(url),source=bound?.source,sourceBinding=source?{status:'bound',url,sha256:source.sha256,bytes:bound.length,kind:source.kind||'unspecified'}:{status:url?'unbound':'unlocated',url};
    workScopes.push(reference?reference.work(record,row,bound,fields):{...identity,parent:row.parent,type:record.type,kind:'instrumented-sync-scope',startSeconds:record.startTime,endSeconds:record.endTime,durationMs:1000*(record.endTime-record.startTime),callerIdentity:{url,line:data[fields[1]],column:data[fields[2]],coordinateKind:record.type==='FunctionCall'?'function-call':'evaluate-script',coordinateBasis:'native-verbatim; base-unestablished'},sourceBinding,name:null,nameStatus:'unavailable',requiredOrOptional:'unclassified',cpuUsage:'unmeasured'});
   }
   if(record.type==='TimeStamp'&&typeof record.data.message==='string'&&record.data.message.startsWith('native-timeline:')){
    const match=/^(native-timeline:[^:]+:)(\{.*\})$/.exec(record.data.message);check(match,'native document mark format required');const anchor=parse(Buffer.from(match[2]),'anchor');check(['open','close'].includes(anchor.phase)&&typeof anchor.documentId==='string'&&anchor.documentId&&(!document||anchor.documentId===document.id)&&finite(anchor.pageMs),'same-document native anchor required');rawAnchors.push(reference?reference.anchor(row,anchor,identity,match[1],document):{...identity,...anchor,prefix:match[1],nativeSeconds:record.startTime,contextId:document?.contextId??null});
   }
  });}finally{reference?.endEvent();}
 });}
 const calibration=capture.facts.calibration;let clock,mapInterval;
 if(calibration.status==='bounded'){check(document&&calibration.status==='bounded'&&rawAnchors.length===2&&rawAnchors[0].phase==='open'&&rawAnchors[1].phase==='close'&&rawAnchors[0].prefix===rawAnchors[1].prefix,'unique ordered raw document anchors required');
 const first=rawAnchors[0],last=rawAnchors[1];check(last.pageMs>first.pageMs&&last.nativeSeconds>first.nativeSeconds,'positive same-epoch anchor span required');
 const offset=first.pageMs-1000*first.nativeSeconds;check(offset===calibration.offsetMs&&calibration.anchors.length===2,'declared offset/anchor identity required');
 for(let i=0;i<2;i++){const raw=rawAnchors[i],declared=calibration.anchors[i];for(const key of ['phase','documentId','pageMs','sessionId','epoch','nativeSeconds','contextId'])check(raw[key]===declared[key],'raw/declaration anchor mismatch: '+key);check(Math.abs(raw.pageMs-1000*raw.nativeSeconds-offset)<=calibration.uncertaintyMs,'anchor residual disagreement');}
 mapInterval=(start,end=start)=>start>=first.nativeSeconds&&end<=last.nativeSeconds?{status:'bounded',startMs:1000*start+offset,endMs:1000*end+offset,uncertaintyMs:calibration.uncertaintyMs}:{status:'unavailable',reason:'outside same-document native anchor interval'};
 clock={status:'bounded',basis:'inspector-stopwatch-seconds',pageBasis:'document-performance',document:reference?document:structuredClone(document),sessionId:session.id,epoch:session.epoch,rate:1,offsetMs:offset,uncertaintyMs:calibration.uncertaintyMs,anchors:rawAnchors,empiricalRate:(last.pageMs-first.pageMs)/(1000*(last.nativeSeconds-first.nativeSeconds)),nativeInterval:[first.nativeSeconds,last.nativeSeconds],limit:'Finite-span source-model mapping only; no host receipt conversion, extrapolation or long-term drift claim'};
 }else{
  check(partial,'captured native evidence requires bounded calibration');
  mapInterval=()=>({status:'unavailable',reason:'No matched same-document native anchors'});
  clock={status:'unavailable',basis:'inspector-stopwatch-seconds',reason:'No matched same-document native anchors',anchors:rawAnchors};
 }
 for(const record of records)record.pageInterval=mapInterval(record.startSeconds,record.endSeconds??record.startSeconds);
 for(const work of workScopes)work.pageInterval=mapInterval(work.startSeconds,work.endSeconds);
 const withSnapshotRecord=(frame,visit)=>reference?io.withEvent(capture.events[frame.eventIndex-1],delivery=>{let record=delivery.record;for(const i of frame.recordPath)record=record?.children?.[i];return visit({record,row:reference.findRecord(frame.eventIndex,frame.recordPath)});}):visit(rawRecords.get(frame.eventIndex+':'+JSON.stringify(frame.recordPath)));
 const snapshots=capture.frames.map((frame,ordinal)=>withSnapshotRecord(frame,match=>{
  check(match?.record?.type==='Screenshot'&&match.row?.sessionId===frame.sessionId,'exact native snapshot event/path/type required');const record=match.record,encoded=record.data.imageData;
  check(typeof encoded==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(encoded),'native PNG data URL required');return io.withPNG(encoded,bytes=>{
   check(bytes.toString('base64')===encoded.slice('data:image/png;base64,'.length)&&bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&(canonical||(access?io.withPhysical(frame,retained=>bytes.equals(retained)):bytes.equals(rawFiles.get(frame.path))))&&bytes.length===frame.bytes&&hash(bytes)===frame.sha256,'native PNG bytes must equal retained file or canonical derived view');
   check(record.startTime===frame.startSeconds&&record.endTime===frame.endSeconds,'native PNG interval must equal metadata');
   if(reference)return reference.snapshot(frame,ordinal,match.row,session,document,mapInterval(frame.startSeconds,frame.endSeconds));
   return{...structuredClone(frame),epoch:session.epoch,parent:match.row.parent,compositeParent:match.row.parent?.type==='Composite'?match.row.parent:null,pageInterval:mapInterval(frame.startSeconds,frame.endSeconds),documentAssociation:document?'sole-owned-document-session-epoch':'unbound-native-prefix',documentId:document?.id??null,nativeDocumentId:null,nativeContextId:null,firstOccurrence:'unverified',presentation:'engine-main-frame-content-snapshot',limit:'No per-image native document/context tag, OS display fence or every-frame guarantee'};
  });
 }));
 check(records.filter(x=>x.type==='Screenshot').length===snapshots.length,'every native screenshot must have exact retained PNG');
 const result={schemaVersion:1,status:partial?'incomplete':'derived-bounded-observations',producer:reference?producer:structuredClone(producer),consumer:reference?consumer:structuredClone(consumer),inputDigests:{captureSha256:expectedCaptureSha256,rawInventorySha256:hash(rawInventoryBytes),sources:reference?null:sources.map(x=>({url:x.url,sha256:x.sha256,bytes:x.bytes.length}))},policy:{branch:'initial-only',provisional:'unvalidated-refused',coordinateConvention:'native-verbatim; base-unestablished',workRoles:'unclassified'},records,workScopes,stackObservations,clock,snapshots,coverage:{rawEvents:capture.events.length,rawFiles:entries.length,totalRawBytes:capture.totalBytes,records:records.length,workScopes:workScopes.length,boundSourceScopes:workScopes.filter(x=>x.sourceBinding.status==='bound').length,stackObservations:stackObservations.length,stackChainCompleteness:stackTruncated?'truncated':'reported-only',snapshots:snapshots.length,missingFrames:'unmeasured',osPresentation:'unmeasured',physicalIOS:'unmeasured'},gaps:['Application source/operation/required-or-optional roles unbound','Background/safe-board/visible-response states require independent exact pixel annotations','Human names on source-located scopes unavailable; point stacks are not named-span associations','Native instrumentation is observed synchronous scope elapsed time, not CPU usage','Snapshots establish bounded observed engine content; first occurrence, OS presentation and every-frame coverage unverified','Only initial session/document/epoch supported; provisional branch unvalidated','Original1472 producer identity is distinct from this later consumer; later producer execution unproved']};
 if(reference){reference.nativeResult(result,stackTruncated);reference.findInputMarks=text=>{const matches=[];for(const event of capture.events)io.withEvent(event,delivery=>walkNativeRecords(delivery.record,record=>{if(record.type==='TimeStamp'&&record.data.message===text)matches.push({pageInterval:mapInterval(record.startTime,record.endTime??record.startTime)});}));return matches;};}
 return result;
}
