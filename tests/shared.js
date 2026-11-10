import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, webcrypto } from "node:crypto";
import { inspect } from "node:util";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { execFile } from "node:child_process";
import { createServer } from "node:http";

// Shared fixtures and helpers for the per-area test files. They moved here
// unchanged from tests.js (#2213), in their original order.

// Every top-level test owns its app fixtures. Nested t.test cases inherit the
// parent scope so a shared fixture remains live until all its consumers finish.
const appFixtureScope = new AsyncLocalStorage();
function test(...args){
 const run=args.at(-1);
 if(typeof run!=="function")return nodeTest(...args);
 return nodeTest(...args.slice(0,-1),async context=>{
  const fixtures=new Set();
  context=releasingTestContext(context);
  try{return await appFixtureScope.run(fixtures,()=>run(context));}
  finally{context.after(async()=>{
   try{for(const fixture of fixtures)await fixture.dispose();}
   finally{fixtures.clear();}
  });}
 });
}

// #2281 CI: node:test keeps every finished test, with its subtests and hooks,
// until the process ends, and with them whatever their functions close over.
// Tests close over the apps they open, so the core process kept every app's
// realm: on CI, 4,000 to 5,600 realms in a 2.4 to 2.8 GB heap by the test 'a
// durable ordinary save retries and clears its stale cloud error without
// reload'. Collections that its save queues run right after the save, before
// the retry, and with that heap they took up to 37 ms (scavenges) and 124 ms
// (full collections), longer than its 30 ms settle. Each hook and subtest runs
// once, so once it has run it drops its function and what that closed over.
function releasingTestContext(context){
 const once=fn=>{let held=fn;const released=function(...args){const run=held;held=null;return run.apply(this,args);};
  Object.defineProperty(released,'length',{value:fn.length});return released;};
 return new Proxy(context,{get(target,key){
  if(key==='after')return (fn,...rest)=>target.after(typeof fn==='function'?once(fn):fn,...rest);
  // A subtest runs once too, and its own hooks are released the same way.
  if(key==='test')return (...args)=>{const run=args.at(-1);
   if(typeof run==='function'){const body=once(run),wrapped=function(child,...rest){return body.call(this,releasingTestContext(child),...rest);};
    Object.defineProperty(wrapped,'length',{value:run.length});args[args.length-1]=wrapped;}
   return target.test(...args);};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
}

async function injectRecoveryDatabaseFailure187(t,app,{key='pending:owner',failAt=[1],errorName='UnknownError',errorMessage='An internal error was encountered in the Indexed Database server',beforeRequest=false,untilReopened=false,onFailure=()=>{}}={}){
 const {IDBDatabase}=await import('fake-indexeddb'),originalTransaction=IDBDatabase.prototype.transaction;
 const observed={reads:0,failures:0};let failedConnection=null;
 // Inject a browser database-server abort after a native request succeeds.
 // The real app and storage consumers still run; only the OS boundary fails.
 IDBDatabase.prototype.transaction=function(names,mode,...args){
  const connection=this,tx=originalTransaction.call(this,names,mode,...args);
  if(mode==='readonly'&&this.name===app.deviceDbName){
   const objectStore=tx.objectStore.bind(tx);
   tx.objectStore=name=>{
    const source=objectStore(name),get=source.get.bind(source);
    source.get=requestedKey=>{
     const fail=name==='meta'&&requestedKey===key&&(failAt.includes(++observed.reads)||untilReopened&&connection===failedConnection),trigger=fail&&beforeRequest?source.count():null;
     const request=get(requestedKey);
     if(fail){
      observed.failures++;
      if(untilReopened)failedConnection=connection;
      (trigger??request).addEventListener('success',()=>{
       Object.defineProperty(tx,'error',{configurable:true,value:Object.assign(Error(errorMessage),{name:errorName})});
       onFailure();
       tx.abort();
      },{once:true});
     }
     return request;
    };
    return source;
   };
  }
  return tx;
 };
 t.after(()=>{IDBDatabase.prototype.transaction=originalTransaction;});
 return observed;
}

async function editRawDevice187(indexedDB,dbName,visit){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{await new Promise((resolve,reject)=>{const tx=db.transaction(['meta','snapshots','backups','opaque'],'readwrite');visit(tx);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Synthetic raw transaction aborted'));});}finally{db.close();}
}

function deviceFaultProvider187(factory,control){
 return {open(...args){const request=factory.open(...args);return new Proxy(request,{
  get(target,key){
   if(key==='result'){const db=Reflect.get(target,key,target);if(!db?.transaction)return db;return new Proxy(db,{get(target,key){
    if(key!=='transaction'){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}
    return(names,mode,...rest)=>{
     const stores=typeof names==='string'?[names]:Array.from(names);
     if(control.readFailure&&mode==='readonly'&&stores.includes('opaque'))throw Object.assign(Error('Synthetic raw read failure'),{name:'AbortError'});
     const tx=target.transaction(names,mode,...rest);
     return new Proxy(tx,{get(target,key){
      if(key==='objectStore')return name=>{const store=target.objectStore(name);return new Proxy(store,{get(target,key){
       if(key==='getAll'&&name==='opaque'&&control.stallRawRead)return(...args)=>{
        const request=target.getAll(...args);return new Proxy(request,{get:(target,key)=>Reflect.get(target,key,target),set(target,key,value){
         if(key==='onsuccess'){target.onsuccess=event=>{const release=()=>{control.stallRawRead=false;value.call(target,event);};control.releaseRawRead=release;(control.rawReadReleases??=[]).push(release);};return true;}
         return Reflect.set(target,key,value,target);
        }});
       };
       if(key==='put')return(...args)=>{
        if(name==='opaque'&&control.quotaOpaque)throw Object.assign(Error('Synthetic recovery quota refusal'),{name:'QuotaExceededError'});
        const result=target.put(...args);
        if(name==='opaque'&&control.abortOpaque||name==='meta'&&args[1]==='head'&&control.abortHead)tx.abort();
        return result;
       };
       if(key==='get'&&name==='meta')return(...args)=>{
        const result=target.get(...args);
        if(args[0]!=='recoveryCloudHold')return result;
        return new Proxy(result,{get(target,key){return Reflect.get(target,key,target);},set(target,key,value){
         if(key==='onsuccess'){target.onsuccess=event=>{if(result.result?.reason==='device-source-recovery')control.afterHoldRead?.(db);value.call(target,event);};return true;}
         return Reflect.set(target,key,value,target);
        }});
       };
       const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
     },set(target,key,value){
      if(key==='oncomplete'&&mode==='readwrite'&&stores.includes('opaque')&&control.stallRawWrite){target.oncomplete=event=>{control.releaseRawWrite=()=>{control.stallRawWrite=false;value.call(target,event);};};return true;}
      return Reflect.set(target,key,value,target);
     }});
    };
   }});}
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  },set(target,key,value){return Reflect.set(target,key,value,target);}
 });}};
}

function partialSavedBoard187(collection){
 const board=syncState({tasks:[syncTask('partial-kept-task','Supported task stays in exact original')],seenQuickStart:true});
 if(collection==='History')board.workLog=[{id:'readable',title:'Readable History',at:1},{id:'opaque-history',title:'Unknown History',at:'future-time',opaque:['keep',17]}];
 if(collection==='contexts')board.contexts=[{id:'readable-context',name:'Readable context',active:true},{id:'opaque-context',name:{future:'context'},opaque:['keep',19]}];
 if(collection==='deletions')board.deletionLog=[{id:'readable-delete',taskId:'older-task',kind:'task',at:1},{id:'opaque-delete',taskId:'future-task',kind:'future-kind',at:2,opaque:['keep',23]}];
 if(collection==='task contexts')board.tasks[0].ctx=['unavailable-context',{future:'context-ref',opaque:['keep',29]}];
 return board;
}


function refuseNextRecoveryTransaction255(faults){
 const refusal=Object.assign(Error('Controlled first automatic publication refusal'),{code:'permission-denied'});
 Object.defineProperty(faults,'push',{configurable:true,get(){queueMicrotask(()=>{delete faults.push;});return refusal;}});
}

async function damagedAcknowledgedApp187(t,{timeoutMs=5000,sourcePadding=0,timerProvider=null,recoveryTimeoutMs=timeoutMs,artifacts=null,nativeDeviceConnection=false,keepFirstChunk=false}={}){
 const fixture=heldDecisionFixture188();
 if(sourcePadding)fixture.remote.futureIOSReportFixture={opaque:'q'.repeat(sourcePadding)};
 fixture.local=structuredClone(fixture.remote);
 const faults={},app=await heldDecisionApp188(t,{fixture,failures:faults,timeoutMs,timerProvider,recoveryTimeoutMs,artifacts,nativeDeviceConnection}),{ctx,shim,backend}=app;
 ctx.window.CLOUD_PUSH_DELAY_MS=60000;
 // Own only the two setup Add callbacks. Their real persistence finishes before
 // damage/recovery, so neither can later replace a consented recovery head.
 const schedule=ctx.setTimeout,cancel=ctx.clearTimeout,saveClock={elapsed:0,jobs:[]};
 ctx.setTimeout=(fn,delay,...args)=>{
  if(delay!==350)return schedule(fn,delay,...args);
  const token={acknowledgedSeedSave187:true},job={token,fn,args,delay,at:saveClock.elapsed+delay,cancelled:false};saveClock.jobs.push(job);return token;
 };
 ctx.clearTimeout=token=>{const job=saveClock.jobs.find(row=>row.token===token);if(job)job.cancelled=true;else cancel(token);};
 const finishSeedSave=async()=>{
  const jobs=saveClock.jobs.filter(job=>!job.cancelled);assert.equal(jobs.length,1,'each native setup Add owns exactly one scheduled save');
  const job=jobs[0];assert.equal(job.delay,350);saveClock.elapsed+=350;assert.equal(job.at,saveClock.elapsed,'deliver only this earned setup callback at its declared deadline');
  const saved=job.fn(...job.args);assert.equal(typeof saved?.then,'function','the actual setup callback runs real persistence');
  assert.equal(await fixtureDeadline(saved,'acknowledged seed scheduled persistence finishes'),true);job.cancelled=true;
  await settleSourceFixtureSave187(app,'acknowledged seed save settles before source damage',true);
 };
 try{
 shim.document.getElementById('addInput').value='Acknowledged before source damage';
 await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 await finishSeedSave();
 await ctx.sendPush();await settleRecovery188(app);
 shim.document.getElementById('addInput').value='Second acknowledged source';
 await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 await finishSeedSave();
 await ctx.sendPush();await settleRecovery188(app);
 }finally{ctx.setTimeout=schedule;ctx.clearTimeout=cancel;}
 const originalRoot={...backend.docs.get('users/owner')};
 assert.equal(originalRoot.schemaVersion,2,'the setup must produce a real chunk-generation ACK');
 const originalHeader={...backend.docs.get('users/owner/generations/'+originalRoot.activeGeneration)};
 const activePath='users/owner/generations/'+originalRoot.activeGeneration;
 const activeChunks=[...backend.docs].filter(([key])=>key.startsWith(activePath+'/chunks/')).map(([,row])=>structuredClone(row)).sort((a,b)=>a.index-b.index);
 assert.equal(activeChunks.length,originalHeader.chunkCount,'the newer source is complete before the fixture makes its chunks unavailable');
 const acknowledged=ctx.state.decisionBase.payload;
 assert.equal(createHash('sha256').update(acknowledged,'utf8').digest('hex'),originalHeader.hash,'the retained source is independently proved byte exact');
 const acknowledgedTasks=JSON.parse(acknowledged).tasks;
 const previousPath='users/owner/generations/'+originalRoot.previousGeneration;
 const previousSource=[...backend.docs].filter(([key])=>key===previousPath||key.startsWith(previousPath+'/')).map(([key,value])=>[key,JSON.stringify(value)]);
 assert.ok(previousSource.length>1,'the damaged root also names a complete previous source');
 for(const key of [...backend.docs.keys()])if(key.startsWith('users/owner/generations/'+originalRoot.activeGeneration+'/chunks/'))backend.docs.delete(key);
 // keepFirstChunk: a partly readable generation, whose bytes can still come back
 // (#2287: one with zero chunks has nothing left, and is not an earlier source).
 if(keepFirstChunk){assert.ok(activeChunks.length>=2,'fixture: a partly readable source needs more than one chunk');backend.docs.set(activePath+'/chunks/0',structuredClone(activeChunks[0]));}
 return {...app,faults,originalRoot,originalHeader,activeSource:{id:originalRoot.activeGeneration,header:originalHeader,chunks:activeChunks},acknowledgedTasks,previousSource};
}

// #2254 (owner direction, 2026-11-06): once the cloud acknowledges a board the
// device trims an automatic recovery's archives and keeps a note naming what the
// check of earlier sources still reports. An archive is never rewritten: each
// is still byte for byte what was written, or the trim has cleared it, and then
// a note names the unresolved generation.
async function exactOrTrimmedArchives254(store,rows,unresolvedId,message){
 const archives=await store.listOpaqueArchives();
 for(const [key,raw] of rows){const saved=archives.find(row=>row.key===key);if(saved)assert.equal(saved.raw,raw,message+': '+key+' is never rewritten');}
 if(rows.some(([key])=>!archives.some(row=>row.key===key)))
  assert.ok(archives.some(row=>row.key.startsWith('automatic-recovery-note:')&&row.raw.includes(unresolvedId)),message+': once the trim clears it, a note names the unresolved generation');
 return archives;
}
async function automaticSourceLifecycle254(t,afterAcknowledged=null){
 // #2287: partly readable: a generation whose bytes can come back. One with zero chunks has nothing left to recover.
 const damaged=await damagedAcknowledgedApp187(t,{sourcePadding:600000,keepFirstChunk:true}),{backend,originalRoot,activeSource,indexedDB,deviceDbName}=damaged;
 const targetPayload=await damaged.ctx.window.ChainStorageV2.decodeSnapshot(activeSource.header,activeSource.chunks);
 const targetTask=JSON.parse(targetPayload).tasks.find(row=>row.title==='Second acknowledged source');
 assert.ok(targetTask,'the independently complete newer source contains a distinct accepted task');
 await closeLegacyApp173(damaged);backend.CS.suspend();
 const {IDBFactory}=await import('fake-indexeddb'),recoveryDb=new IDBFactory(),recoveryName='background-resume-254-'+Math.random();
 const cold=await loadAppAtTime(1792323000000,{indexedDBProvider:recoveryDb,deviceDbName:recoveryName});t.after(()=>closeLegacyApp173(cold));
 await fixtureDeadline(async wait=>{while(!vm.runInContext('automaticCloudFallbackBootBaseline',cold.ctx))await wait();},'verified empty startup capture completes before fallback recovery');
 const firstPublicationFault={authPending:true};refuseNextRecoveryTransaction255(firstPublicationFault);const reader=await loadCloudBackendV2({runtimeWindow:cold.ctx.window,failures:firstPublicationFault,timeoutMs:5000,recoveryTimeoutMs:5000});t.after(()=>reader.CS.suspend());
 for(const [key,value]of backend.docs)reader.docs.set(key,value);
 reader.emitAuth({uid:'owner',email:'e@example.test'});cold.ctx.closeModal();await cold.ctx.cloudPull();
 const store=cold.ctx.window.ScannerDeviceStore,firstHold=await store.getRecoveryCloudHold();
 assert.ok(firstHold?.automaticRecovery,'the complete older source opens under the exact automatic fallback authority');
 const beforeAckArchives=await store.listOpaqueArchives(),originalEnvelope=beforeAckArchives.find(row=>row.key===firstHold.originalKey);
 assert.ok(originalEnvelope,'the initial fallback commits exact originals before an edit is accepted');
 const originalEnvelopeRaw=originalEnvelope.raw,envelope=JSON.parse(originalEnvelope.raw);
 const originalSourceKey=envelope.sourceArchiveKeys[0],originalSourceRow=beforeAckArchives.find(row=>row.key===originalSourceKey);
 assert.ok(originalSourceRow,'the automatic originals envelope names one exact cloud-source archive');
 const originalSourceRaw=originalSourceRow.raw,originalSource=JSON.parse(originalSourceRaw);
 assert.ok(originalSource.generations.some(row=>row.id===activeSource.id&&row.chunks.length===1),
  'the unavailable newer generation remains an exact unresolved reference in the durable source archive');
 cold.shim.document.getElementById('addInput').value='Accepted after the older fallback';
 await cold.ctx.onAction('add',{});assert.equal(await cold.ctx.persist(),true,'the accepted edit is durably saved on the fallback');
 await cold.ctx.sendPush();
 const firstAck=await reader.CS.pull();
 assert.ok(firstAck.rev>originalRoot.rev,'the existing guarded publisher acknowledges the edited fallback');
 assert.equal(firstAck.payload,cold.ctx.cloudPayload(),'the first ACK is the exact current fallback board');
 assert.equal(await store.getRecoveryCloudHold(),null,'the first current-board ACK clears only its exact automatic hold');
 const firstResolution=(await store.listOpaqueArchives()).map(row=>({row,value:row.key.startsWith('automatic-recovery-ack:')?JSON.parse(row.raw):null}))
  .find(entry=>entry.value?.originalKey===firstHold.originalKey);
 assert.ok(firstResolution,'the exact ACK durably records which complete source references it resolved');
 assert.ok(!firstResolution.value.resolvedGenerationIds.includes(activeSource.id),
  'an incomplete generation is not marked resolved by the fallback board ACK');
 assert.equal(reader.docs.get('users/owner').previousGeneration,activeSource.id,
  'the first ACK retains the unresolved newer source in its previous root slot');
 cold.shim.document.getElementById('addInput').value='Accepted before a second publication';
 await cold.ctx.onAction('add',{});assert.equal(await cold.ctx.persist(),true,'a second accepted edit remains durable before root rotation');
 await cold.ctx.sendPush();
 const rotationAck=await reader.CS.pull();
 assert.ok(rotationAck.rev>firstAck.rev,'a second ordinary publication rotates the acknowledged root slots');
 assert.equal(rotationAck.payload,cold.ctx.cloudPayload(),'the second publication is the exact current board');
 const firstRoot=reader.docs.get('users/owner');
 assert.ok(![firstRoot.activeGeneration,firstRoot.previousGeneration].includes(activeSource.id),
  'the unresolved newer source has rotated out of both current root slots');
 assert.ok(reader.docs.has('users/owner/recoveryProtections/'+activeSource.id),
  'shared retention protects the old generation even after root-slot rotation');
 await exactOrTrimmedArchives254(store,[[firstHold.originalKey,originalEnvelopeRaw],[originalSourceKey,originalSourceRaw]],activeSource.id,
  'the successful ACK retains the original partial envelope and source capture byte-for-byte');

 cold.shim.window.dispatchEvent({type:'pagehide'});
 cold.shim.document.getElementById('addInput').value='Accepted while offline';
 await cold.ctx.onAction('add',{});assert.equal(await cold.ctx.persist(),true,'the offline edit is durably saved locally');
 const offlineHead=await store.readHead(),offlineBoard=JSON.parse(offlineHead.payload);
 assert.ok(offlineBoard.tasks.some(row=>row.title==='Accepted while offline'));
 await closeLegacyApp173(cold);
 const offline=await loadAppAtTime(1792323000000,{indexedDBProvider:recoveryDb,deviceDbName:recoveryName,sharedStorage:cold.shim.localStorage});t.after(()=>closeLegacyApp173(offline));
 assert.equal(offline.ctx.window.CloudSync,undefined,'the second cold open exercises the offline startup path');
 assert.equal((await offline.ctx.window.ScannerDeviceStore.readHead()).payload,JSON.stringify(offline.ctx.state),
  'cold reopen accepts the exact locally saved offline edit');
 assert.ok(offline.ctx.state.tasks.some(row=>row.title==='Accepted while offline'));

 offline.shim.window.CLOUD_RETRY_DELAY_MS=60000;
 const resumed=await loadCloudBackendV2({runtimeWindow:offline.ctx.window,sharedDocs:reader.docs,failures:{authPending:true},timeoutMs:5000,recoveryTimeoutMs:5000});
 t.after(()=>resumed.CS.suspend());resumed.emitAuth({uid:'owner',email:'e@example.test'});offline.ctx.closeModal();
 await offline.ctx.cloudPull();await settleRecoveryOperations188(offline.ctx);
 const rotated=resumed.docs.get('users/owner');
 assert.ok(![rotated.activeGeneration,rotated.previousGeneration].includes(activeSource.id),
  'the unresolved reference remains discoverable outside the current root slots');
 assert.ok(resumed.docs.has('users/owner/recoveryProtections/'+activeSource.id),
  'the exact source remains protected while another local edit is reconciled');
 await exactOrTrimmedArchives254(offline.ctx.window.ScannerDeviceStore,[[firstHold.originalKey,originalEnvelopeRaw],[originalSourceKey,originalSourceRaw]],activeSource.id,
  'later publication does not rewrite prior automatic originals or the original partial source evidence');
 let retryFire=null;const retryTimerId='automatic-source-retry-254',priorSetTimeout=offline.ctx.setTimeout,priorClearTimeout=offline.ctx.clearTimeout;
 offline.ctx.setTimeout=(callback,delay,...args)=>{
  if(delay===60000){retryFire=()=>callback(...args);return retryTimerId;}
  return priorSetTimeout(callback,delay,...args);
 };
 offline.ctx.clearTimeout=id=>{if(id===retryTimerId){retryFire=null;return;}return priorClearTimeout(id);};
 offline.shim.window.dispatchEvent({type:'online'});
 const waitUntil=async predicate=>{const until=Date.now()+5000;while(!predicate()&&Date.now()<until)await flush();return predicate();};
 assert.equal(await waitUntil(()=>!!retryFire),true,
  'an incomplete durable source reference schedules through the existing bounded retry');
 assert.equal(vm.runInContext('automaticCloudSourceResumeStatus.state',offline.ctx),'unresolved',
  'the saved current board remains usable while older source bytes are still incomplete');
 assert.equal(offline.ctx.state.tasks.some(row=>row.id===targetTask.id),false,
  'an incomplete capture is not presented as recovered');
 await exactOrTrimmedArchives254(offline.ctx.window.ScannerDeviceStore,[[originalSourceKey,originalSourceRaw]],activeSource.id,
  'a transient retry preserves the exact old partial source capture');
 for(const chunk of activeSource.chunks)resumed.docs.set('users/owner/generations/'+activeSource.id+'/chunks/'+chunk.index,structuredClone(chunk));
 assert.equal(resumed.docs.get('users/owner/generations/'+activeSource.id).hash,activeSource.header.hash,
  'the newly readable source uses its unchanged original header');
 const retry=retryFire;retryFire=null;retry();
 assert.equal(await waitUntil(()=>vm.runInContext('automaticCloudSourceResumeStatus.state==="acknowledged"',offline.ctx)),true,
  'the existing bounded retry rereads the source and completes the guarded automatic resumption');
 assert.ok(offline.ctx.state.tasks.some(row=>row.id===targetTask.id),
  'online lifecycle rereads the retired newer source and merges it with the accepted offline edit');
 assert.ok(offline.ctx.state.tasks.some(row=>row.title==='Accepted while offline'),
  'automatic source resumption preserves the current accepted device edit');
 const acknowledged=await resumed.CS.pull();
 assert.ok(acknowledged.rev>rotated.rev,'the existing current-context publisher acknowledges the later merged board');
 assert.equal(acknowledged.payload,offline.ctx.cloudPayload(),'the later cloud ACK matches the exact recovered current board');
 assert.equal(await offline.ctx.window.ScannerDeviceStore.getRecoveryCloudHold(),null,
  'the publisher clears the new hold only after the later exact current-board ACK');
 const afterArchives=await exactOrTrimmedArchives254(offline.ctx.window.ScannerDeviceStore,[[firstHold.originalKey,originalEnvelopeRaw],[originalSourceKey,originalSourceRaw]],
  activeSource.id,'the first original envelope and partial capture stay exact after later discovery');
 const latestEnvelope=afterArchives.filter(row=>row.key.startsWith('automatic-device-recovery:')&&row.key!==firstHold.originalKey).at(-1);
 assert.ok(latestEnvelope,'later source recovery records a distinct fresh guarded publication context');
 const latestEnvelopeValue=JSON.parse(latestEnvelope.raw),latestSourceKey=latestEnvelopeValue.sourceArchiveKeys[0],latestSourceRow=afterArchives.find(row=>row.key===latestSourceKey);
 assert.ok(latestSourceRow&&latestSourceKey!==originalSourceKey,'later discovery creates a distinct exact cloud-source capture');
 const latestSource=JSON.parse(latestSourceRow.raw).generations.find(row=>row.id===activeSource.id);
 assert.deepEqual(latestSource?.chunks,activeSource.chunks,'the fresh source archive stores the exact newly readable original chunks');
 const priorStillSaved=[firstHold.originalKey,originalSourceKey].filter(key=>afterArchives.some(row=>row.key===key));
 assert.ok(priorStillSaved.every(key=>latestEnvelopeValue.preservedAutomaticArchiveKeys.includes(key))&&
  latestEnvelopeValue.preservedAutomaticArchiveKeys.every(key=>afterArchives.some(row=>row.key===key)),
  'later originals reference prior automatic archives without rewriting them, and none the trim cleared');
 assert.ok(!latestEnvelopeValue.indexedDB.opaque.some(row=>row.key?.type==='string'&&
  latestEnvelopeValue.preservedAutomaticArchiveKeys.includes(row.key.value)),
  'later originals do not recursively copy prior automatic archive payloads');
 const latestResolution=afterArchives.map(row=>row.key.startsWith('automatic-recovery-ack:')?JSON.parse(row.raw):null)
  .find(value=>value?.originalKey===latestEnvelope.key);
 assert.ok(latestResolution?.resolvedGenerationIds.includes(activeSource.id),
  'the new exact current-board ACK records the newly recovered generation as resolved');
 assert.equal(JSON.stringify(resumed.docs.get('users/owner/generations/'+activeSource.id)),JSON.stringify(activeSource.header),
  'the original protected generation header remains exact');
 const restoredChunks=[...resumed.docs].filter(([key])=>key.startsWith('users/owner/generations/'+activeSource.id+'/chunks/'))
  .map(([,row])=>row).sort((a,b)=>a.index-b.index);
 assert.deepEqual(restoredChunks,activeSource.chunks,'the original generation bytes remain exact after recovery publication');
 const receiver=await loadAppAtTime(1792323000000,{indexedDBProvider:recoveryDb,deviceDbName:recoveryName+'-receiver'});t.after(()=>closeLegacyApp173(receiver));
 const receiving=await loadCloudBackendV2({runtimeWindow:receiver.ctx.window,sharedDocs:resumed.docs,failures:{authPending:true},timeoutMs:5000});
 t.after(()=>receiving.CS.suspend());receiving.emitAuth({uid:'owner',email:'e@example.test'});receiver.ctx.closeModal();
 await fixtureDeadline(async wait=>{while(vm.runInContext('automaticCloudFallbackBootCapturePending||!state',receiver.ctx))await wait();},
  'the independent receiver completes its own durable-source startup capture before cloud reconciliation');
 await receiver.ctx.cloudPull();await settleRecoveryOperations188(receiver.ctx);
 assert.equal(vm.runInContext('reconciledAs',receiver.ctx),receiving.CS.user,'the independent receiver finishes account-bound cloud reconciliation');
 assert.ok(receiver.ctx.state.tasks.some(row=>row.id===targetTask.id),'an independent client receives the later recovered decision');
 assert.ok(receiver.ctx.state.tasks.some(row=>row.title==='Accepted while offline'),'the receiver also accepts the offline edit');
 assert.equal(receiver.ctx.cloudPayload(),acknowledged.payload,'the independent receiver accepts the exact complete acknowledged board');
 if(afterAcknowledged)await afterAcknowledged({app:offline,backend:resumed,acknowledged});
 const finalExpected=offline.ctx.cloudPayload();
 await closeLegacyApp173(offline);
 const reopened=await loadAppAtTime(1792323000000,{indexedDBProvider:recoveryDb,deviceDbName:recoveryName,sharedStorage:offline.shim.localStorage});
 t.after(()=>closeLegacyApp173(reopened));
 assert.equal((await reopened.ctx.window.ScannerDeviceStore.readHead()).payload,JSON.stringify(reopened.ctx.state),
  'a later cold reopen retains the exact durably acknowledged recovered board');
 if(!afterAcknowledged)assert.equal(reopened.ctx.cloudPayload(),acknowledged.payload);
 else assert.equal(reopened.ctx.cloudPayload(),finalExpected);
}

async function automaticDefaultApp251(t,{prepare=null,assertAdopted=true}={}){
 const app=await divergentCloudSourceApp187(t,{phase:'automatic-inputs',holdCloudPush:true}),{ctx,backend,originalRoot}=app;
 const path='users/owner/generations/'+originalRoot.previousGeneration,header=backend.docs.get(path),chunks=[...backend.docs].filter(([key])=>key.startsWith(path+'/chunks/')).map(([,row])=>row).sort((a,b)=>a.index-b.index);
 const previous=JSON.parse(await ctx.window.ChainStorageV2.decodeSnapshot(header,chunks));previous.settings.workedHours=8;previous.tasks.push(syncTask('cloud-default-251','Cloud alternative task'));
 const encoded=await ctx.window.ChainStorageV2.encodeSnapshot(JSON.stringify(previous));backend.docs.set(path,{...header,...encoded,chunks:undefined});for(const key of [...backend.docs.keys()])if(key.startsWith(path+'/chunks/'))backend.docs.delete(key);
 for(const chunk of encoded.chunks)backend.docs.set(path+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk);
 if(prepare)await prepare(app);
 ctx.closeModal();await flush();await ctx.cloudPull();
 if(assertAdopted){assert.equal(ctx.state.settings.workedHours,16,'the accepted device value is the reversible residual default');assert.ok(ctx.state.tasks.some(row=>row.id==='cloud-default-251'));
 assert.equal((await ctx.window.ScannerDeviceStore.getRecoveryCloudHold())?.automaticRecovery,true,'the setup reaches a real automatic guarded local adoption');}
 return app;
}

function recoveryReadClock187(){
 // The backend receives this clock before setup ACKs. Attaching the app later
 // must not let host fixture work spend its controlled source-operation time.
 let active=true,elapsed=0,next=0,ctx;const start=1792323000000,timers=new Map(),scheduled=[];
 const provider={Date:class extends Date{static now(){return active?start+elapsed:Date.now();}},performance:{now:()=>elapsed},
  setTimeout(fn,delay,...args){if(!active)return setTimeout(fn,delay,...args);const id={recoveryClock187:++next};timers.set(id,{fn:()=>fn(...args),at:elapsed+Number(delay),delay:Number(delay)});scheduled.push(Number(delay));return id;},
  clearTimeout(id){if(timers.has(id))timers.delete(id);else clearTimeout(id);}};
 // Consumer entry observations belong to the attached app phase; completed
 // seed calls cannot satisfy a later consumer's wait-for-entry predicate.
 return {provider,timers,scheduled,get elapsed(){return elapsed;},activate(app){ctx=app.ctx;active=true;scheduled.length=0;ctx.setTimeout=provider.setTimeout;ctx.clearTimeout=provider.clearTimeout;ctx.performance=provider.performance;setFakeTime(ctx,start);},
  async advance(ms){const target=elapsed+ms;while(true){const due=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;elapsed=due[1].at;setFakeTime(ctx,start+elapsed);timers.delete(due[0]);due[1].fn();await flush();}elapsed=target;setFakeTime(ctx,start+elapsed);await flush();},
  stop(){active=false;timers.clear();}};
}

async function settleSourceFixtureSave187(app,message,requireDurable=false){
 const end=Date.now()+5000;
 while(Date.now()<end){
  const save=app.ctx.buildSupportDiagnosticsReport().save;
  if(!save.debouncePending.value&&!save.activePersistCalls.value&&(!requireDurable||save.localDurability.value==='durable'&&save.durableThroughRequest.value>=save.acceptedRequests.value))return;
  await flush();
 }
 const timer=vm.runInContext('saveTimer',app.ctx);throw Error(message+'; startup save observations '+JSON.stringify(app.ctx.buildSupportDiagnosticsReport().save)+'; timer '+inspect(timer,{depth:0}));
}
async function freshSourceCheckFixture187(t,options={}){
 const app=await divergentCloudSourceApp187(t,{...options,settleDeviceBeforeCloud:true});
 app.ctx.window.CLOUD_PUSH_DELAY_MS=60000;
 await settleSourceFixtureSave187(app,'fixture saves finish before fresh-check controls');
 return app;
}

async function inspectCompleteSource230(t,{page,remote,receivedRaw,browser,engine,width,shortValues}){
  const {waitForTruthyProbe}=await import('../scripts/agent-tools/async-probe.mjs');
  t.diagnostic('Native complete-source entry: '+engine+' '+browser.version()+', '+width+'x844, '+Buffer.byteLength(receivedRaw)+' source bytes.');
  await page.locator('[data-act="apply-cloud-source-recovery"]').waitFor();
  // This read-only source review runs after startup migration has produced a
  // larger in-memory projection; it must not invent a save just to make it
  // match the durable original. Wait only for actual app saves to quiesce, then
  // keep the live projection and durable head as separate exact facts below.
  await waitForTruthyProbe(()=>page.evaluate(()=>{const save=buildSupportDiagnosticsReport().save;return !save.debouncePending.value&&save.activePersistCalls.value===0;}),{timeoutMs:30_000,pollIntervalMs:25});
  const capture=()=>page.evaluate(async()=>({documentId:__installedFixture.documentId,board:JSON.stringify(state),head:await ScannerDeviceStore.readHead(),pending:await ScannerDeviceStore.getPendingUpload('owner'),originals:await ScannerDeviceStore.readRawExportSnapshot()})),beforeSource=await capture(),cloudBefore=JSON.stringify([...remote]);
  const saveBaseline=await page.evaluate(async()=>{const save=buildSupportDiagnosticsReport().save,head=await ScannerDeviceStore.readHead();return {debounce:save.debouncePending.value,activePersists:save.activePersistCalls.value,localDurability:save.localDurability.value,liveBytes:JSON.stringify(state).length,durableHeadBytes:head?.payload?.length??null};});
  t.diagnostic('Native complete-source baseline is quiescent; live and durable bytes remain separate read-only facts: '+JSON.stringify(saveBaseline)+'.');
  const source=page.locator('#modalRoot section.settings-section').filter({has:page.getByRole('heading',{name:'Previous cloud source',exact:true})}),disclosure=source.locator('summary').filter({hasText:'Complete supported source, including other saved fields'}),reader=source.locator('pre,textarea');assert.equal(await disclosure.count(),1);assert.equal(await reader.count(),1);
  let ready=false,watchdog;const interaction=(async()=>{await disclosure.click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));ready=true;})();
  try{await Promise.race([interaction,new Promise(resolve=>{watchdog=setTimeout(resolve,1000);})]);assert.equal(ready,true,'opening a complete supported source must return native frames within the existing one-second reader bound');}finally{clearTimeout(watchdog);}
  const expectedText=JSON.stringify(JSON.parse(receivedRaw),null,2),currentText=()=>reader.evaluate(element=>'value' in element?element.value:element.textContent);assert.equal(await currentText(),expectedText,'the complete supported text preserves every saved value without truncation');
  const geometry=await reader.evaluate(element=>{const box=element.getBoundingClientRect(),modal=element.closest('.modal');return{open:element.closest('details').open,height:box.height,viewportHeight:innerHeight,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,modalScrollWidth:modal.scrollWidth,modalClientWidth:modal.clientWidth};});
  assert.equal(geometry.open,true);assert.ok(geometry.height<=geometry.viewportHeight/2+2,'complete source text stays in a bounded reading pane');assert.ok(geometry.scrollHeight>geometry.clientHeight,'all complete source lines remain internally scrollable');assert.ok(geometry.modalScrollWidth<=geometry.modalClientWidth+1,'a long saved value cannot overflow the recovery dialog');
  await reader.evaluate(element=>{window.__completeSourceReader=element;});await disclosure.focus();await page.keyboard.press('Tab');assert.equal(await reader.evaluate(element=>document.activeElement===element),true,'native Tab reaches the complete source reader');
  const beforeTop=await reader.evaluate(element=>element.scrollTop);await page.keyboard.press(beforeTop>0?'PageUp':'PageDown');await page.waitForFunction(before=>document.activeElement===window.__completeSourceReader&&window.__completeSourceReader.scrollTop!==before,beforeTop,{timeout:1000});
  await reader.evaluate(element=>{window.__completeSourceScrollSample={top:element.scrollTop,steadyFrames:0};});await page.waitForFunction(()=>{const sample=window.__completeSourceScrollSample,top=window.__completeSourceReader.scrollTop;sample.steadyFrames=top===sample.top?sample.steadyFrames+1:0;sample.top=top;return sample.steadyFrames>=3;},null,{timeout:1000,polling:'raf'});
  if(geometry.scrollWidth>geometry.clientWidth+1){const beforeLeft=await reader.evaluate(element=>element.scrollLeft);await reader.hover();await page.mouse.wheel(160,0);await page.waitForFunction(before=>window.__completeSourceReader.scrollLeft!==before,beforeLeft,{timeout:1000});}
  assert.equal(await reader.evaluate(element=>element.isContentEditable||('readOnly' in element&&!element.readOnly)),false,'the complete source reader remains read only');await page.keyboard.type('y');assert.equal(await currentText(),expectedText,'native reading keys cannot edit the complete source text');
  assert.equal(await reader.evaluate(element=>element.closest('.modal').scrollWidth<=element.closest('.modal').clientWidth+1),true,'native horizontal reading stays contained in the dialog');
  assert.equal(await page.locator('[data-act="choose-cloud-recovery-source"][aria-pressed="true"]').count(),0,'reading or scrolling a complete source never grants consent');assert.equal(await page.locator('[data-act="apply-cloud-source-recovery"]').isDisabled(),true);
  await page.locator('#modalRoot .mbtns [data-act="close-modal"]').last().click();assert.deepEqual(await capture(),beforeSource,'Cancel retains exact live, durable, pending and original source facts');assert.equal(JSON.stringify([...remote]),cloudBefore,'read-only source inspection never publishes');
  t.diagnostic('Native complete-source consumer: '+engine+' '+browser.version()+', '+width+'x844, '+Buffer.byteLength(receivedRaw)+' source bytes, '+(shortValues?'byte-matched short values':'long scalar')+'. No physical-device or production-account proof.');
}

async function waitForNativeHistoryAck226(page,owner){
 const completion=item=>{
  const read=item.read,fail=reason=>({ok:false,reason,serial:read.serial,deadline:item.deadline});
  if(window.CloudSync!==read.backend||read.backend.user!==read.account||cloudAccountIdentity()!==read.identity)return fail('identity-changed');
  if(cloudSourceRecoverySerial!==read.serial)return fail('superseded');
  if(item.controller!==read.controller||read.controller.signal.aborted||performance.now()>=item.deadline)return fail(read.controller.signal.reason?.code||'original-deadline');
  const acknowledged=automaticCloudSourceResumeStatus.state==='acknowledged';
  if(automaticCloudSourceResumeStatus.state==='stopped')return fail('stopped:'+automaticCloudSourceResumeStatus.reason);
  if(acknowledged&&!cloudSourceRecoveryBusy&&!pulling&&
    (cloudSourceRecoveryRead===read||cloudSourceRecoveryRead===null))return {ok:true,serial:read.serial,deadline:item.deadline,completedAt:performance.now(),cleanedUp:cloudSourceRecoveryRead===null};
  if(cloudSourceRecoveryRead!==read&&!(cloudSourceRecoveryRead===null&&acknowledged))return fail('owner-ended-before-ack');
  return false;
 };
 // Completed/stale owners are terminal observations even after their old deadline.
 const immediate=await page.evaluate(completion,owner);if(immediate)return immediate;
 const remaining=await page.evaluate(item=>item.deadline-performance.now(),owner);
 if(remaining<=0)return {ok:false,reason:'original-deadline'};
 const result=await page.waitForFunction(completion,owner,{timeout:Math.max(1,Math.floor(remaining))});
 try{return await result.jsonValue();}finally{await result.dispose();}
}

async function runNativeRecoveryInspection226(t,width=390,holdDemoted=false,completeSource=null,automaticView=null,sharedBrowser=null){
 const {waitForTruthyProbe}=await import('../scripts/agent-tools/async-probe.mjs');
 const playwright=await import('playwright'),engine=(completeSource||automaticView)?(automaticView?.engine||process.env.CHAIN_RECOVERY_TEST_ENGINE||'chromium'):'chromium';assert.ok(['chromium','webkit'].includes(engine),'the native source consumer uses an existing supported engine');
 const sdk=await import('../scripts/installed-client-fixture.mjs'),ownsBrowser=!sharedBrowser,browser=sharedBrowser||await playwright[engine].launch({headless:true}),context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();
 const current=deferredSyncFixture(),previous=deferredSyncFixture(),finalRoot=deferredSyncFixture(),freshFinalRoot=deferredSyncFixture(),demoted=deferredSyncFixture(),raw=JSON.stringify({...sdk.fixture('reconcile-held'),...(automaticView?{settings:{...sdk.fixture('reconcile-held').settings,theme:automaticView.theme}}:{})}),encoded=await loadStorageV2().encodeSnapshot(raw),{chunks,...header}=encoded,remote=new Map([['users/owner',{schemaVersion:2,rev:4,activeGeneration:'held-current',previousGeneration:'received-previous'}],['users/owner/generations/held-current',{...header,hash:'f'.repeat(64),state:'published',baseRev:3}],['users/owner/generations/received-previous',{...header,state:'published',baseRev:2}],...chunks.map(c=>['users/owner/generations/received-previous/chunks/'+String(c.index).padStart(8,'0'),c])]);
 if(automaticView){remote.set('users/owner/generations/held-current',{...header,state:'published',baseRev:3});for(const chunk of chunks)remote.set('users/owner/generations/held-current/chunks/'+chunk.index,chunk);}
 let publicationAllowed=false,historyArmed=false,historyEntered=false;const historyGate=deferredSyncFixture();
 const boundedAck={armed:false,enteredAt:null,deliveredAt:null,observation:null},boundedAckDelivered=deferredSyncFixture();let boundedAckTimer=null,boundedAckOwner=null;const nativeHistoryOwners=[];
 const origin='https://recovery-inspection.invalid',prefix='/synthetic-sdk/';let armed=false,previousEntered=false,freshFinalEntered=false,demotedEntered=false,roots=0;
 t.after(async()=>{if(boundedAckTimer)await boundedAckDelivered.promise;if(boundedAckOwner)await boundedAckOwner.dispose();for(const owner of nativeHistoryOwners)await owner.dispose();if(automaticView?.boundedAck&&process.env.CHAIN_RECOVERY_UI_OUTPUT){fs.mkdirSync(process.env.CHAIN_RECOVERY_UI_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.CHAIN_RECOVERY_UI_OUTPUT,automaticView.theme+'-'+width+'-bounded-ack.json'),JSON.stringify(boundedAck,null,2));}try{await page.evaluate(()=>{closeModal();window.__releaseNativeRetry?.();});}catch{}current.resolve();previous.resolve();finalRoot.resolve();freshFinalRoot.resolve();demoted.resolve();historyGate.resolve();await context.close();if(ownsBrowser)await browser.close();});
 await context.exposeBinding('__installedRPC',async(_,kind,args)=>{const key=args?.[0];if(boundedAck.armed&&kind==='get'&&key==='users/owner/generations/held-current'){
  boundedAck.armed=false;boundedAck.enteredAt=Date.now();boundedAckOwner=await page.evaluateHandle(()=>window.__nativeHistoryBudget());
  boundedAckTimer=setTimeout(async()=>{try{boundedAck.observation=await page.evaluate(owner=>({sameRead:cloudSourceRecoveryRead===owner.read,sameController:cloudSourceRecoveryRead?.controller===owner.controller,serial:cloudSourceRecoveryRead?.serial,originalSerial:owner.read.serial,deadline:owner.deadline,deadlineUnchanged:window.__nativeHistoryBudget()===owner,remaining:owner.deadline-performance.now(),state:automaticCloudSourceResumeStatus.state,aborted:owner.controller.signal.aborted}),boundedAckOwner);boundedAck.deliveredAt=Date.now();}catch(error){boundedAck.error=String(error);}finally{boundedAckTimer=null;boundedAckDelivered.resolve();}},16000);
  await boundedAckDelivered.promise;
 }if(historyArmed&&kind==='get'&&key==='users/owner/generations/held-current'){historyEntered=true;await historyGate.promise;}if(armed&&kind==='get'&&key==='users/owner'&&++roots>1){await finalRoot.promise;if(roots===4){freshFinalEntered=true;await freshFinalRoot.promise;}}if(armed&&kind==='list'&&key.endsWith('/held-current/chunks')){await current.promise;if(holdDemoted&&roots>=3){demotedEntered=true;await demoted.promise;}}if(armed&&kind==='list'&&key.endsWith('/received-previous/chunks')){previousEntered=true;await previous.promise;}if(kind==='get')return structuredClone(remote.get(key)??null);if(kind==='list')return [...remote].filter(([id])=>id.startsWith(key+'/'));if(kind==='apply'){if(!automaticView)throw Error('Unexpected recovery inspection write');if(!publicationAllowed)return {fixtureFailure:'permission-denied'};for(const [op,id,value]of args[0]){if(op==='delete')remote.delete(id);else remote.set(id,op==='update'?{...remote.get(id),...structuredClone(value)}:structuredClone(value));}return true;}throw Error('Unexpected fixture RPC');});
 await context.addInitScript(sdk.browserInit,{dbName:'native-inspection-'+Math.random(),authMode:'reconcile-held',sdkBase:origin+prefix});
 if(automaticView?.history)await context.addInitScript(()=>{
  const schedule=window.setTimeout.bind(window),cancel=window.clearTimeout.bind(window);let overall=null,held=null,used=false;
  window.setTimeout=(callback,delay,...args)=>{
   const read=typeof cloudSourceRecoveryRead==='undefined'?null:cloudSourceRecoveryRead;
   if(delay===60000&&read&&overall?.read!==read)overall={read,controller:read.controller,deadline:performance.now()+delay};
   if(!used&&delay===2000&&typeof cloudRetryOwner!=='undefined'&&cloudRetryOwner==='automatic-source'&&read&&overall?.read===read){
    used=true;held={read,controller:read.controller,deadline:overall.deadline,earnedAt:performance.now(),ready:false,cancelled:false,callback:()=>callback(...args)};
    held.token=schedule(()=>{if(held)held.ready=true;},delay);return held.token;
   }
   return schedule(callback,delay,...args);
  };
  window.clearTimeout=token=>{if(held?.token===token)held.cancelled=true;return cancel(token);};
  window.__nativeHistoryBudget=()=>overall;
  window.__nativeRetryReady=()=>!!held?.ready;
  window.__releaseNativeRetry=()=>{
   const item=held;if(!item)return null;held=null;cancel(item.token);
   const valid=item.ready&&!item.cancelled&&cloudSourceRecoveryRead===item.read&&item.read.controller===item.controller&&!item.controller.signal.aborted&&overall?.deadline===item.deadline&&performance.now()<item.deadline;
   const result={valid,deadline:item.deadline,earnedAt:item.earnedAt,releasedAt:performance.now(),sameRead:cloudSourceRecoveryRead===item.read,sameController:item.read.controller===item.controller};
   if(valid)item.callback();return result;
  };
 });

 await context.addInitScript(raw=>{if(!localStorage.getItem('fvp:chain-scanner:device-store-v2')){localStorage.setItem('fvp:chain-scanner:v1',raw);localStorage.setItem('fvp:chain-scanner:protected:v1',raw);localStorage.setItem('fvp:chain-scanner:daily-backups:v1','[]');}},raw);
 await context.route('**/*',async route=>{const url=new URL(route.request().url()),file=url.pathname;if(url.origin!==origin)return route.abort();const module=file===prefix+'firebase-app.js'?sdk.appModule:file===prefix+'firebase-auth.js'?sdk.authModule:file===prefix+'firebase-firestore.js'?sdk.firestoreModule:null;if(module!==null)return route.fulfill({contentType:'application/javascript',body:automaticView&&file===prefix+'firebase-firestore.js'?module.replace("const rpc=(kind,args)=>window.__installedRPC(kind,args)","const rpc=async(kind,args)=>{const result=await window.__installedRPC(kind,args);if(result?.fixtureFailure)throw Object.assign(Error('Controlled SDK refusal'),{code:result.fixtureFailure});return result;}"):module});const relative=file==='/'?'index.html':file.slice(1);if(relative.includes('..')||!fs.existsSync(path.join(__dirname,relative)))return route.fulfill({status:404,body:''});return route.fulfill({body:fs.readFileSync(path.join(__dirname,relative)),contentType:relative.endsWith('.html')?'text/html':relative.endsWith('.js')?'application/javascript':relative.endsWith('.css')?'text/css':undefined});});
 await page.goto(origin+'/');await page.locator('html[data-app-ready="true"]').waitFor();
 if(automaticView){
  page.on('pageerror',error=>{if(process.env.CHAIN_RECOVERY_UI_OUTPUT){fs.mkdirSync(process.env.CHAIN_RECOVERY_UI_OUTPUT,{recursive:true});fs.appendFileSync(path.join(process.env.CHAIN_RECOVERY_UI_OUTPUT,'debug.log'),error.stack+'\n');}});
  await page.waitForFunction(()=>localStorage.getItem('fvp:chain-scanner:device-store-v2')==='1'&&state.tasks.length===64&&!pulling&&!cloudPushInFlight,{},{timeout:10000}).catch(async error=>{t.diagnostic(await page.evaluate(()=>JSON.stringify({marker:localStorage.getItem('fvp:chain-scanner:device-store-v2'),tasks:state?.tasks.length,pulling,liveBoardAccepted,deviceStorageAuthority,deviceStorageRequired,cloud:{ready:window.CloudSync?.ready,status:window.CloudSync?.status,code:window.CloudSync?.errorCode}})));throw error;});
  const prior=JSON.parse(await page.evaluate(()=>cloudPayload()));prior.tasks.push({...structuredClone(prior.tasks[0]),id:'native-cloud-only-255',title:'Automatically recovered cloud task'});
  const supported=await loadStorageV2().encodeSnapshot(JSON.stringify(prior));assert.ok(supported.chunks.length>1);
  remote.set('users/owner/generations/received-previous',{...supported,chunks:undefined,state:'published',baseRev:2});for(const key of [...remote.keys()])if(key.startsWith('users/owner/generations/received-previous/chunks/'))remote.delete(key);for(const chunk of supported.chunks)remote.set('users/owner/generations/received-previous/chunks/'+chunk.index,chunk);
  remote.set('users/owner/generations/held-current',{...header,hash:'f'.repeat(64),state:'published',baseRev:3});for(const key of [...remote.keys()])if(key.startsWith('users/owner/generations/held-current/chunks/'))remote.delete(key);
  if(automaticView.history){
   const later=structuredClone(prior);later.tasks.push({...structuredClone(prior.tasks[0]),id:'native-later-254',title:'Later readable source task'});
   const laterEncoded=await loadStorageV2().encodeSnapshot(JSON.stringify(later)),{chunks:laterChunks,...laterHeader}=laterEncoded,currentHeader={...laterHeader,state:'published',baseRev:3};
   remote.set('users/owner/generations/held-current',currentHeader);publicationAllowed=true;
   // #2287: one chunk survives, so this generation stays an earlier source; one with zero chunks has nothing to recover.
   assert.ok(laterChunks.length>1,'fixture: a partly readable source needs more than one chunk');remote.set('users/owner/generations/held-current/chunks/'+laterChunks[0].index,laterChunks[0]);
   const output=process.env.CHAIN_RECOVERY_UI_OUTPUT?path.resolve(process.env.CHAIN_RECOVERY_UI_OUTPUT):null,captures=[];if(output)fs.mkdirSync(output,{recursive:true});
   const capture=async(stage,expected)=>{
    await page.locator('[data-act="settings"]').first().click();const status=page.locator('#automaticCloudSourceResumeStatus'),neighbor=page.locator('#modalRoot [data-act="scene-settings"]');
    await status.waitFor();assert.match(await status.textContent(),expected);if(stage==='stopped')assert.doesNotMatch(await status.textContent(),/open Review cloud recovery/i,'a healthy-root historical status cannot direct users to an unavailable recovery action');await neighbor.focus();assert.equal(await neighbor.evaluate(el=>el===document.activeElement),true);
    let enlarged=null;
    for(const scale of [1,1.5]){
     if(scale>1)enlarged=await page.addStyleTag({content:'#modalRoot .modal{font-size:150%} #modalRoot .modal :is(p,button,label,summary,select,input){font-size:1em}'});
     await status.scrollIntoViewIfNeeded();const metrics=await status.evaluate(el=>{const pane=el.closest('.modal'),n=pane.querySelector('.settings-section > p.kv'),read=x=>{const st=getComputedStyle(x),r=x.getBoundingClientRect();return {fontFamily:st.fontFamily,fontSize:st.fontSize,lineHeight:st.lineHeight,color:st.color,height:r.height,width:r.width};};return {text:el.textContent,theme:document.documentElement.dataset.theme,scheme:getComputedStyle(document.documentElement).colorScheme,paint:getComputedStyle(pane).backgroundColor,overflow:pane.scrollWidth>pane.clientWidth+1,status:read(el),neighbor:read(n)};});
     assert.equal(metrics.theme,automaticView.theme);assert.ok(metrics.scheme.includes(automaticView.theme));assert.equal(metrics.overflow,false);assert.equal(metrics.status.fontFamily,metrics.neighbor.fontFamily);assert.ok(metrics.status.height>0);assert.match(metrics.text,expected);
     let fonts=null;if(engine==='chromium'){const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const {root}=await cdp.send('DOM.getDocument',{depth:-1}),{nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#automaticCloudSourceResumeStatus'});fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});await cdp.detach();}
     if(output)await page.screenshot({path:path.join(output,automaticView.theme+'-'+width+'-'+stage+'-'+scale+'.png')});captures.push({stage,scale,...metrics,fonts});
    }
    if(enlarged)await enlarged.evaluate(el=>el.remove());await page.locator('#modalRoot [data-act="close-modal"]').first().click();
    if(stage==='retrying'||stage==='checking')assert.equal(await page.evaluate(()=>cloudSourceRecoveryRead?.automaticHistoryResume===true&&!cloudSourceRecoveryRead.controller.signal.aborted),true,'closing ordinary Settings preserves the active bounded automatic source attempt');
   };
   await page.reload();await page.waitForFunction(()=>automaticCloudSourceResumeStatus.retrying===true&&!deviceRecoveryCloudHold,{},{timeout:15000}).catch(async error=>{t.diagnostic(await page.evaluate(()=>JSON.stringify({status:automaticCloudSourceResumeStatus.state,reason:automaticCloudSourceResumeStatus.reason,hold:deviceRecoveryCloudHold,dirty:state?.syncDirty,tasks:state?.tasks.length,cloud:window.CloudSync.errorCode,busy:cloudSourceRecoveryBusy,pulling,toast:document.getElementById('toast').textContent})));throw error;});historyArmed=true;
   const originalArchives=await page.evaluate(async()=>ScannerDeviceStore.listOpaqueArchives());
   await capture('retrying',/temporarily unavailable.*retry/i);
   await page.waitForFunction(()=>window.__nativeRetryReady(),{},{timeout:5000});const timerDelivery=await page.evaluate(()=>window.__releaseNativeRetry());assert.equal(timerDelivery.valid,true);assert.equal(timerDelivery.sameRead,true);assert.equal(timerDelivery.sameController,true);assert.ok(timerDelivery.releasedAt>=timerDelivery.earnedAt+2000&&timerDelivery.releasedAt<timerDelivery.deadline);
   await page.waitForFunction(()=>automaticCloudSourceResumeStatus.state==='checking',{},{timeout:10000});
   await fixtureDeadline(async wait=>{while(!historyEntered)await wait();},'native historical source reaches the controlled external header read');
   await capture('checking',/Checking an earlier saved cloud source/);
   const ownedRead=await page.evaluateHandle(()=>cloudSourceRecoveryRead);try{await page.locator('[data-act="help"]').first().click();await page.locator('#modalRoot [data-act="close-modal"]').first().click();assert.equal(await page.evaluate(read=>cloudSourceRecoveryRead===read&&!read.controller.signal.aborted,ownedRead),true,'closing ordinary Help preserves the same bounded automatic source read');}finally{await ownedRead.dispose();}
   remote.set('users/owner/generations/held-current',{...currentHeader,schemaVersion:99});historyArmed=false;historyGate.resolve();
   await page.waitForFunction(()=>automaticCloudSourceResumeStatus.state==='stopped'&&!cloudSourceRecoveryBusy,{},{timeout:10000});
   const stoppedOwner=await page.evaluateHandle(()=>window.__nativeHistoryBudget());nativeHistoryOwners.push(stoppedOwner);
   const stoppedCompletion=await waitForNativeHistoryAck226(page,stoppedOwner);assert.equal(stoppedCompletion.ok,false);assert.match(stoppedCompletion.reason,/^stopped:/,'an actual unsupported source cannot be waited into confirmation');
   await capture('stopped',/earlier cloud source remains unresolved and protected/i);
   remote.set('users/owner/generations/held-current',currentHeader);for(const chunk of laterChunks)remote.set('users/owner/generations/held-current/chunks/'+chunk.index,chunk);
   const previousSerial=await page.evaluate(()=>window.__nativeHistoryBudget().read.serial);
   boundedAck.armed=automaticView.boundedAck===true;
   await page.evaluate(()=>window.dispatchEvent(new Event('online')));
   // Keep the original responsiveness bound for entering a new actual owner.
   await page.waitForFunction(serial=>window.__nativeHistoryBudget()?.read.serial>serial,previousSerial,{timeout:15000});
   const ackOwner=await page.evaluateHandle(()=>window.__nativeHistoryBudget());nativeHistoryOwners.push(ackOwner);
   const ackCompletion=await waitForNativeHistoryAck226(page,ackOwner);assert.equal(ackCompletion.ok,true,'only the same current owner may finish within its original budget: '+JSON.stringify(ackCompletion));
   const staleCompletion=await waitForNativeHistoryAck226(page,stoppedOwner);assert.equal(staleCompletion.ok,false);assert.equal(staleCompletion.reason,'superseded','a stopped older owner cannot borrow the later ACK');
   if(automaticView.boundedAck){assert.equal(boundedAck.error,undefined,'the actual bounded SDK delivery must finish: '+boundedAck.error);assert.ok(boundedAck.deliveredAt>=boundedAck.enteredAt+16000,'the actual entered SDK reply spends real time beyond the former ACK observation limit');assert.equal(boundedAck.observation.sameRead,true);assert.equal(boundedAck.observation.sameController,true);assert.equal(boundedAck.observation.deadlineUnchanged,true);assert.equal(boundedAck.observation.aborted,false);assert.ok(boundedAck.observation.remaining>0);assert.notEqual(boundedAck.observation.state,'acknowledged','the held earlier source cannot be called confirmed before its reply');}
   await capture('acknowledged',/The current board is confirmed by cloud/);
   assert.equal(await page.evaluate(()=>state.tasks.some(row=>row.id==='native-later-254')),true,'actual lifecycle resumption adopts the independently complete later source');
   const finalArchives=await page.evaluate(async()=>ScannerDeviceStore.listOpaqueArchives());for(const row of originalArchives)assert.ok(finalArchives.some(next=>next.key===row.key&&next.raw===row.raw),'native later-source resumption retains original archive bytes');
   await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await page.locator('#addInput').fill('Native edit after background ACK');await page.locator('#addButton').click();await waitForTruthyProbe(()=>page.evaluate(async()=>JSON.parse((await ScannerDeviceStore.readHead()).payload).tasks.some(row=>row.title==='Native edit after background ACK')),{timeoutMs:30_000,pollIntervalMs:25});
   await page.locator('#addInput').fill('Native unfinished status draft');await capture('later-edit',/not been confirmed by cloud/);assert.equal(await page.locator('#addInput').inputValue(),'Native unfinished status draft');await page.locator('#addInput').fill('');
   await page.locator('#syncBtn').click();await page.waitForFunction(()=>window.CloudSync.user===null);await capture('signed-out',/different signed-in account/);
   const signedOutCompletion=await waitForNativeHistoryAck226(page,ackOwner);assert.equal(signedOutCompletion.ok,false);assert.equal(signedOutCompletion.reason,'identity-changed','a prior completed owner cannot confirm after actual signout');
   if(output)fs.writeFileSync(path.join(output,automaticView.theme+'-'+width+'-history.json'),JSON.stringify({source:process.env.CHAIN_NATIVE_CANDIDATE_SHA||'working-tree',indexSha256:createHash('sha256').update(fs.readFileSync(path.join(__dirname,'index.html'))).digest('hex'),engine,browser:browser.version(),captures,timerDelivery,boundedAck,ackCompletion,stoppedCompletion,staleCompletion,signedOutCompletion,limits:['actual native browser with isolated synthetic SDK','no production account or physical-device proof']},null,2));return;
  }

  await page.reload();await page.locator('html[data-app-ready="true"]').waitFor();
  await page.waitForFunction(()=>state.tasks.some(row=>row.id==='native-cloud-only-255')&&!pulling&&!cloudSourceRecoveryBusy,{},{timeout:15000}).catch(async error=>{t.diagnostic(await page.evaluate(async()=>JSON.stringify({archives:(await ScannerDeviceStore.listOpaqueArchives()).map(row=>{let v;try{v=JSON.parse(row.raw)}catch{}return {key:row.key,format:v?.format,mode:v?.recoveryMode,issues:v?.unsupported,candidates:v?.candidateSources,adopted:!!v?.adoptedHeadHash}}),hold:deviceRecoveryCloudHold,tasks:state?.tasks.length,pulling,liveBoardAccepted,deviceStorageAuthority,deviceStorageRequired,cloud:{ready:window.CloudSync?.ready,status:window.CloudSync?.status,code:window.CloudSync?.errorCode},status:automaticCloudSourceResumeStatus,modal:document.querySelector('#modalRoot')?.textContent?.slice(0,250)})));throw error;});
  assert.equal(await page.locator('[data-act="choose-cloud-recovery-source"]').count(),0,'automatic adoption never requires a source picker');
  assert.equal(await page.locator('#modalRoot .modal').count(),0,'automatic recovery leaves the working board available');
  const originalArchives=await page.evaluate(async()=>Promise.all((await ScannerDeviceStore.listOpaqueArchives()).map(async row=>({key:row.key,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.raw)))).map(x=>x.toString(16).padStart(2,'0')).join('')}))));
  await page.locator('#addInput').fill('Native accepted recovery edit');await page.locator('#addButton').click();
  await page.waitForFunction(()=>state.tasks.some(row=>row.title==='Native accepted recovery edit'));
  await page.locator('#addInput').fill('Unfinished native recovery draft');const draft=await page.locator('#addInput').inputValue();
  await page.locator('[data-act="settings"]').first().click();
  const warning=page.locator('#modalRoot [role="status"]').filter({hasText:'Cloud recovery is pending'});await warning.waitFor();
  const review=page.locator('#modalRoot [data-act="review-cloud-source-recovery"]'),neighbor=page.locator('#modalRoot [data-act="sync-signout"]');
  const focusForward=engine==='webkit'&&process.platform==='darwin'?'Alt+Tab':'Tab',focusBackward=engine==='webkit'&&process.platform==='darwin'?'Alt+Shift+Tab':'Shift+Tab';
  await review.focus();await page.keyboard.press(focusForward);assert.equal(await neighbor.evaluate(el=>el===document.activeElement),true,'native forward focus reaches the actual next recovery control');await page.keyboard.press(focusBackward);assert.equal(await review.evaluate(el=>el===document.activeElement),true,'native focus returns to the actual recovery action');
  const output=process.env.CHAIN_RECOVERY_UI_OUTPUT?path.resolve(process.env.CHAIN_RECOVERY_UI_OUTPUT):null,observations=[];
  if(output)fs.mkdirSync(output,{recursive:true});
  await page.waitForFunction(()=>!document.getElementById('toast')?.classList.contains('show'),{},{timeout:15000});
  for(const scale of [1,1.5]){
   if(scale>1)await page.addStyleTag({content:'#modalRoot .modal{font-size:150%} #modalRoot .modal :is(p,button,label,summary,select,input){font-size:1em}'});
   const metrics=await page.evaluate(()=>{const modal=document.querySelector('#modalRoot .modal'),warning=[...modal.querySelectorAll('[role="status"]')].find(el=>el.textContent.includes('Cloud recovery is pending')),control=modal.querySelector('[data-act="review-cloud-source-recovery"]'),neighbor=modal.querySelector('[data-act="sync-signout"]'),read=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {text:el.textContent,fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,color:s.color,background:s.backgroundColor,height:r.height,width:r.width,left:r.left,right:r.right,border:s.border,radius:s.borderRadius,padding:s.padding};};return {theme:document.documentElement.dataset.theme,scheme:getComputedStyle(document.documentElement).colorScheme,paint:getComputedStyle(modal).backgroundColor,viewport:{width:innerWidth,height:innerHeight},overflow:modal.scrollWidth>modal.clientWidth+1,warning:read(warning),control:read(control),neighbor:read(neighbor)};});
   assert.equal(metrics.theme,automaticView.theme);assert.ok(metrics.scheme.includes(automaticView.theme));assert.equal(metrics.overflow,false,'status and adjacent controls fit the actual Settings pane');assert.equal(metrics.control.fontFamily,metrics.neighbor.fontFamily);assert.equal(metrics.control.fontSize,metrics.neighbor.fontSize);assert.ok(metrics.warning.height>0);
   await warning.scrollIntoViewIfNeeded();if(output)await page.screenshot({path:path.join(output,automaticView.theme+'-'+width+'-'+scale+'.png')});observations.push({scale,...metrics});
  }
  assert.ok(parseFloat(observations[1].warning.fontSize)>parseFloat(observations[0].warning.fontSize),'enlarged observation changes actual status text size');
  let fonts={status:'unavailable'};if(engine==='chromium'){const session=await context.newCDPSession(page);await session.send('DOM.enable');await session.send('CSS.enable');const {root}=await session.send('DOM.getDocument',{depth:-1});const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#modalRoot [data-act="review-cloud-source-recovery"]'});fonts={status:'observed',...(await session.send('CSS.getPlatformFontsForNode',{nodeId}))};await session.detach();}
  await page.locator('#modalRoot [data-act="close-modal"]').first().click();assert.equal(await page.locator('#addInput').inputValue(),draft,'Settings inspection and asynchronous recovery preserve the native unfinished draft');
  assert.equal(await page.evaluate(async()=>JSON.parse((await ScannerDeviceStore.readHead()).payload).tasks.some(row=>row.title==='Native accepted recovery edit')),true,'native accepted edit reaches the durable head before restart');
  await page.locator('#addInput').fill('');publicationAllowed=true;
  await page.reload();await page.locator('html[data-app-ready="true"]').waitFor();
  await page.waitForFunction(()=>!deviceRecoveryCloudHold&&state.syncDirty===false,{},{timeout:10000}).catch(async()=>{const actual=await page.evaluate(()=>({hold:deviceRecoveryCloudHold,dirty:state.syncDirty,pulling,busy:cloudSourceRecoveryBusy,authority:deviceStorageAuthority,required:deviceStorageRequired,cloud:window.CloudSync?.errorCode}));assert.equal(actual.hold,null,'ordinary authenticated cold startup resumes its verified automatic hold: '+JSON.stringify(actual));assert.equal(actual.dirty,false);});
  assert.ok([...remote].some(([id,row])=>id.includes('/recoveryProtections/')),'the actual SDK mutation boundary receives original-source protection');
  const acknowledgement=await page.evaluate(()=>({label:document.getElementById('syncBtn').textContent,dirty:state.syncDirty,hold:deviceRecoveryCloudHold,status:automaticCloudSourceResumeStatus,retention:window.CloudSync.recoveryRetentionPending}));assert.equal(acknowledgement.dirty,false);assert.equal(acknowledgement.hold,null);
  const finalArchives=await page.evaluate(async()=>Promise.all((await ScannerDeviceStore.listOpaqueArchives()).map(async row=>({key:row.key,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.raw)))).map(x=>x.toString(16).padStart(2,'0')).join('')}))));for(const row of originalArchives)assert.deepEqual(finalArchives.find(saved=>saved.key===row.key),row,'automatic startup ACK preserves every original native source byte');
  const accepted=await page.evaluate(()=>cloudPayload());assert.ok(accepted.includes('Native accepted recovery edit'));assert.ok(accepted.includes('native-cloud-only-255'));
  await page.reload();await page.waitForFunction(()=>state?.tasks.some(row=>row.title==='Native accepted recovery edit')&&!pulling);
  if(!await page.locator('#listBody').isVisible())await page.locator('[data-act="toggle-list"]').first().click();
  const list=page.locator('#listBody');await list.scrollIntoViewIfNeeded();await list.hover();const scrolling=[];
  const listObservation=()=>list.evaluate(host=>{const bounds=host.getBoundingClientRect();return {top:host.scrollTop,height:host.scrollHeight,viewport:host.clientHeight,overflow:host.scrollWidth>host.clientWidth+1,visible:[...host.querySelectorAll('.trow')].filter(row=>{const r=row.getBoundingClientRect();return r.top>=bounds.top&&r.bottom<=bounds.bottom;}).map(row=>({id:row.dataset.row,height:row.getBoundingClientRect().height}))};});
  scrolling.push(await listObservation());assert.ok(scrolling[0].visible.length>0);assert.equal(scrolling[0].top,0);
  await page.mouse.wheel(0,Math.floor(scrolling[0].height/2));await page.waitForFunction(()=>document.getElementById('listBody').scrollTop>0);scrolling.push(await listObservation());
  await page.mouse.wheel(0,scrolling[0].height);await page.waitForFunction(()=>{const el=document.getElementById('listBody');return el.scrollTop+el.clientHeight>=el.scrollHeight-2;});scrolling.push(await listObservation());
  assert.ok(scrolling[1].top>scrolling[0].top&&scrolling[2].top>scrolling[1].top,'native wheel reaches top middle and end task positions');assert.ok(scrolling.every(row=>!row.overflow&&row.visible.length>0),'actual complete task rows remain visible and contained at every scroll position');
  if(output)fs.writeFileSync(path.join(output,automaticView.theme+'-'+width+'.json'),JSON.stringify({source:process.env.CHAIN_NATIVE_CANDIDATE_SHA||'working-tree',indexSha256:createHash('sha256').update(fs.readFileSync(path.join(__dirname,'index.html'))).digest('hex'),engine,browser:browser.version(),observations,fonts,scrolling,acknowledgement,originalArchives,finalArchives,acceptedHash:createHash('sha256').update(accepted).digest('hex'),limits:['synthetic SDK and isolated native browser','no physical-device or affected-account proof']},null,2));
  return;
 }
 await page.waitForFunction(()=>typeof state!=='undefined'&&state?.tasks.length===64&&CloudSync.ready===true&&CloudSync.errorCode==='corrupt-generation');
 // The first error arrives before automatic source preservation finishes.
 // Manual reading begins after that actual read, not during its busy interval.
 await page.waitForFunction(()=>!pulling&&!cloudSourceRecoveryBusy);
 await page.evaluate(()=>{document.getElementById('motionDialog')?.close();closeModal();state.seenQuickStart=true;state.apologySeen=APOLOGY_NOTICE_ID;render();});
 let receivedRaw=await page.evaluate(()=>JSON.stringify(state));
 if(completeSource?.shortValues){const source=JSON.parse(receivedRaw),padding=source.futurePopulated.opaque,n=8000,budget=padding.length-3*n+1,part=Math.floor(budget/n);source.futurePopulated.opaque=Array.from({length:n},(_,i)=>'p'.repeat(i===n-1?budget-part*(n-1):part));const next=JSON.stringify(source);assert.equal(Buffer.byteLength(next),Buffer.byteLength(receivedRaw),'the short-value control retains the exact source byte budget');receivedRaw=next;}
 const receivedEncoded=await loadStorageV2().encodeSnapshot(receivedRaw),{chunks:receivedChunks,...receivedHeader}=receivedEncoded;remote.set('users/owner/generations/received-previous',{...receivedHeader,state:'published',baseRev:2});for(const key of [...remote.keys()])if(key.startsWith('users/owner/generations/received-previous/chunks/'))remote.delete(key);for(const chunk of receivedChunks)remote.set('users/owner/generations/received-previous/chunks/'+String(chunk.index).padStart(8,'0'),chunk);
 await page.locator('[data-act="sync"]').first().click();armed=true;await page.locator('[data-act="review-cloud-source-recovery"]').click();
 if(completeSource){current.resolve();previous.resolve();finalRoot.resolve();freshFinalRoot.resolve();demoted.resolve();await inspectCompleteSource230(t,{page,remote,receivedRaw,browser,engine,width,shortValues:completeSource.shortValues});return;}
 const enteredBy=Date.now()+3000;while(Date.now()<enteredBy&&!previousEntered)await flush();assert.equal(previousEntered,true,'the actual native SDK source consumer reaches the held sibling');
 await page.locator('[data-cloud-source-readonly] summary').click();const cancel=page.locator('#modalRoot .mbtns [data-act="close-modal"]');await cancel.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
 const before=await page.evaluate(()=>{const modal=document.querySelector('#modalRoot .modal');modal.scrollTop=300;window.__inspectionFocusedControl=document.activeElement;return {scroll:modal.scrollTop,focus:document.activeElement.dataset.act,open:document.querySelector('[data-cloud-source-readonly] details').open};});assert.equal(before.focus,'close-modal');assert.equal(before.open,true);assert.ok(before.scroll>0);
 previous.resolve();await page.locator('[data-cloud-source-inspection]').waitFor();
 const after=await page.evaluate(()=>({sameControl:document.activeElement===window.__inspectionFocusedControl,focus:document.activeElement.dataset.act,open:document.querySelector('[data-cloud-source-readonly] details').open,scroll:document.querySelector('#modalRoot .modal').scrollTop}));
 assert.equal(after.sameControl,true,'an asynchronously received source must preserve the mounted keyboard-focused Cancel control');assert.equal(after.open,true,'receiving a cloud source must not close an opened device-source disclosure');assert.equal(after.scroll,before.scroll,'inspection updates must retain the reader’s scroll position');assert.equal(await page.locator('[data-act="choose-cloud-recovery-source"]').count(),0);
 const summary=page.locator('[data-cloud-source-inspection] summary').first();await summary.click();await summary.focus();const receivedBefore=await page.evaluate(()=>{const modal=document.querySelector('#modalRoot .modal');modal.scrollTop=400;window.__receivedSummary=document.activeElement;return modal.scrollTop;});current.resolve();await page.locator('[data-cloud-source-inspection] h4').filter({hasText:'Current cloud source'}).waitFor();
 const receivedAfter=await page.evaluate(()=>({same:document.activeElement===window.__receivedSummary,open:window.__receivedSummary.closest('details').open,scroll:document.querySelector('#modalRoot .modal').scrollTop}));assert.equal(receivedAfter.same,true,'a second source result preserves the already mounted focused received-copy summary');assert.equal(receivedAfter.open,true);assert.equal(receivedAfter.scroll,receivedBefore);
 const readerBefore=await page.evaluate(()=>{
  const modal=document.querySelector('#modalRoot .modal'),bounds=modal.getBoundingClientRect();
  window.__inspectionVisibleText=[...modal.querySelectorAll('[data-cloud-source-readonly] li')].map(item=>{
   const range=document.createRange();range.selectNodeContents(item);return {node:item,range,text:item.textContent};
  }).filter(({range})=>{const rect=range.getBoundingClientRect();return rect.height>0&&rect.top>=bounds.top+8&&rect.bottom<=bounds.bottom-8;}).slice(0,8);
  return window.__inspectionVisibleText.map(({node,range,text})=>{const rect=range.getBoundingClientRect();return {text,connected:node.isConnected,top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right};});
 });
 assert.ok(readerBefore.length>=3,'the actual reading fixture must expose several complete unchanged task lines');
 remote.set('users/owner',{schemaVersion:2,rev:5,activeGeneration:'received-previous',previousGeneration:'held-current'});finalRoot.resolve();
 if(holdDemoted){
  const heldBy=Date.now()+3000;while(Date.now()<heldBy&&!demotedEntered)await flush();assert.equal(demotedEntered,true,'the fresh demoted generation reaches its still-held chunk read');
  await page.waitForFunction(()=>document.querySelector('[data-cloud-source-inspection-id="received-previous"] h4')?.textContent==='Current cloud source');
  assert.equal(await page.locator('[data-cloud-source-inspection-id="held-current"] h4').textContent(),'Previous cloud source','the retained demoted row must change role before its fresh chunks finish');
  assert.deepEqual(await page.locator('[data-cloud-source-inspection] h4').allTextContents(),['Current cloud source','Previous cloud source'],'one observed manifest must give both retained rows truthful roles while a read is held');
  assert.equal(await page.locator('[data-act="choose-cloud-recovery-source"]').count(),0,'an observed role update cannot grant source eligibility');
  demoted.resolve();
 }
 const freshBy=Date.now()+3000;while(Date.now()<freshBy&&!freshFinalEntered)await flush();assert.equal(freshFinalEntered,true,'the changed manifest reaches its fresh capture with independently received copies');
 assert.equal(await page.locator('[data-cloud-source-inspection-id="received-previous"] h4').textContent(),'Current cloud source','a promoted received generation must show its current manifest role');assert.equal(await page.locator('[data-cloud-source-inspection-id="held-current"] h4').textContent(),'Previous cloud source','a demoted received generation must not retain a second Current heading');
 const refreshed=await page.evaluate(()=>({same:document.activeElement===window.__receivedSummary,open:window.__receivedSummary.closest('details').open,scroll:document.querySelector('#modalRoot .modal').scrollTop,reader:window.__inspectionVisibleText.map(({node,range})=>{const rect=range.getBoundingClientRect();return {text:node.textContent,connected:node.isConnected,top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right};})}));assert.equal(refreshed.same,true);assert.equal(refreshed.open,true);assert.deepEqual(refreshed.reader,readerBefore,'mounted progress updates must preserve exact viewport positions of unchanged visible text');assert.equal(refreshed.scroll,receivedBefore);assert.equal(await page.locator('[data-act="choose-cloud-recovery-source"]').count(),0);
 await page.evaluate(()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Reader frame limit exceeded')),1000);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timeout);resolve();}));}));
 const settledReader=await page.evaluate(()=>window.__inspectionVisibleText.map(({node,range})=>{const rect=range.getBoundingClientRect();return {text:node.textContent,connected:node.isConnected,top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right};}));
 assert.deepEqual(settledReader,readerBefore,'unchanged visible text must also stay in place through the next two frames');
}

async function runNativeRecoveryInspectionMatrix226(t,engine,viewForCase){
 const playwright=await import('playwright'),browserType=playwright[engine],originalLaunch=browserType.launch,launches=[],contexts=[],pages=[];let sharedBrowser=null;
 browserType.launch=async function(...args){
  const browser=await originalLaunch.apply(this,args);launches.push(browser);const newContext=browser.newContext.bind(browser);
  browser.newContext=async function(...contextArgs){
   const context=await newContext(...contextArgs);contexts.push(context);const newPage=context.newPage.bind(context);
   context.newPage=async function(...pageArgs){const page=await newPage(...pageArgs);pages.push(page);return page;};return context;
  };return browser;
 };
 t.after(async()=>{browserType.launch=originalLaunch;if(sharedBrowser)await sharedBrowser.close();});
 sharedBrowser=await browserType.launch({headless:true});
 for(const [theme,width]of [['light',390],['dark',390],['light',1280],['dark',1280]])await t.test(theme+' '+width,sub=>runNativeRecoveryInspection226(sub,width,false,null,viewForCase(theme,width),sharedBrowser));
 assert.equal(contexts.length,4,'each theme/viewport scenario must create its own fresh browser context');assert.equal(new Set(contexts).size,4,'theme/viewport scenarios cannot share browser context state');
 assert.equal(pages.length,4,'each theme/viewport scenario must create its own page');assert.equal(new Set(pages).size,4,'theme/viewport scenarios cannot share page state');
 assert.equal(launches.length,1,'all four independent theme/viewport scenarios should reuse one browser process');assert.equal(launches[0],sharedBrowser);
}

// #2201: these budget contracts must not depend on the recovery read expiring.
// They hold a damaged source whose complete prior generation would otherwise
// reconcile automatically (#2198). Give that prior a conflicting legacy rating
// (the #2408 refusal shape) so the automatic default genuinely has to wait.
// Decodes one stored cloud generation, lets `edit` return its new payload,
// and stores that payload re-encoded in place of the old header and chunks.
async function rewriteGenerationFixture(backend,generationPath,codec,edit){
 const header=backend.docs.get(generationPath);
 const chunks=[...backend.docs].filter(([key])=>key.startsWith(generationPath+'/chunks/')).map(([,row])=>row).sort((a,b)=>a.index-b.index);
 const payload=await edit(JSON.parse(await codec.decodeSnapshot(header,chunks))),encoded=await codec.encodeSnapshot(payload);
 for(const key of [...backend.docs.keys()])if(key.startsWith(generationPath+'/chunks/'))backend.docs.delete(key);
 backend.docs.set(generationPath,{...header,hash:encoded.hash,byteLength:encoded.byteLength,chunkCount:encoded.chunkCount});
 for(const chunk of encoded.chunks)backend.docs.set(generationPath+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk);
 return {payload,encoded};
}
async function conflictingPriorGeneration2201(backend,previousGeneration,codec){
 await rewriteGenerationFixture(backend,'users/owner/generations/'+previousGeneration,codec,board=>{
  const task=board.tasks.find(row=>row.id==='a');
  assert.equal(board.decisionBaseline,undefined);assert.equal(task.mu,25,'the accepted board rates this task differently');task.mu=26;
  return JSON.stringify(board);
 });
}

async function coldDamagedSourceWithoutAck214(t,{newerLocalWork=false,conflictingPrior=false}={}){
 const seed=await damagedAcknowledgedApp187(t,{sourcePadding:2000000});
 if(conflictingPrior)await conflictingPriorGeneration2201(seed.backend,seed.originalRoot.previousGeneration,seed.ctx.window.ChainStorageV2);
 if(newerLocalWork){seed.shim.document.getElementById('addInput').value='Newer local task without an ACK export';await seed.ctx.onAction('add',{});assert.equal(await seed.ctx.persist(),true);}
 const raw=seed.ctx.cloudPayload(),originalRoot={...seed.originalRoot},originalHeader={...seed.originalHeader},provider=[...seed.backend.docs];
 assert.equal(Object.hasOwn(JSON.parse(raw),'decisionBase'),false,'the supported export does not carry the private ACK payload');
 assert.equal(createHash('sha256').update(raw).digest('hex')===originalHeader.hash,!newerLocalWork,'control whether retained current bytes can reconstruct the published missing payload');
 await closeLegacyApp173(seed);seed.backend.CS.suspend();
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='cold-no-ack-214-'+Math.random();
 const app=await loadAppAtTime(1792323000000,{seed:214,seedStorage:{[SYNC_STORE_KEY]:raw,[LOCAL_HEAD_KEY]:raw},indexedDBProvider:indexedDB,deviceDbName});
 const faults={authPending:true},counts={reads:0};faults.serverRead=async()=>{counts.reads++;};
 const backend=await loadCloudBackendV2({rootData:originalRoot,timeoutMs:5000,recoveryTimeoutMs:5000,failures:faults,recordSyncError:app.ctx.recordSyncError,runtimeWindow:app.ctx.window});
 for(const [key,value] of provider)backend.docs.set(key,value);
 app.ctx.window.CLOUD_PUSH_DELAY_MS=60000;
 t.after(async()=>{backend.CS.suspend();vm.runInContext('clearCloudRetry();clearTimeout(cloudTimer)',app.ctx);await app.ctx.window.ScannerDeviceStore?.close?.();await app.dispose();});
 assert.equal(app.ctx.state.decisionBase==null,true,'the actual cold-opened app has no historical acknowledged copy');
 backend.emitAuth({uid:'owner',email:'e@example.com'});await app.ctx.cloudPull();
 await fixtureDeadline(async wait=>{while(vm.runInContext('pulling||cloudPushInFlight',app.ctx))await wait(5);},'the first no-ACK pull settles before inspecting its outcome');
 return {...app,backend,faults,counts,originalRoot,originalHeader,raw,indexedDB,deviceDbName};
}
const APOLOGY_NOTICE_ID = "sync-stability-2026-10";
const ORIGINAL_APOLOGY = `Hey users! Terribly sorry about sync and stability issues that have happened in the past twenty four hours. App will be moving to a proper stable and beta approach in the future, with beta versions tested by me and only released to users like you on the stable version (the one you are on) after I have beta tested them myself in ways automated tests and reviews sometimes fail to catch (like today). Thank you for your patience as I am adopting sensible software dev approaches late because this blew up from a personal project to something a little bigger real fast, and as someone who is a theatre major - well, it’s all still a big shock.

Have a great day, and keep whittling those todo lists! <3 Emerald`;

function channelReleaseEnvelope(channel, startsAt, deployedAt = startsAt) {
  const destination = channel === "beta"
    ? { origin: "https://chain-scanner.web.app", basePath: "/" }
    : { origin: "https://emerald-pham.github.io", basePath: "/funsidething/" };
  const current = html.match(/<template id="appChangelogCurrent">([\s\S]*?)<\/template>/)?.[1];
  const appFingerprint = current?.match(/data-app-fingerprint="([a-f0-9]{64})"/)?.[1];
  assert.ok(appFingerprint, "the current app shell supplies its own product fingerprint");
  return {
    schemaVersion: 1,
    channel,
    ...destination,
    product: {
      sourceRevision: "01b95ef42414d6ba7817ff9c5ebac6e3be3d6350",
      tree: "37248116fc2cac8bd35e7d966c92b45c7744b728",
      appFingerprint,
    },
    deployedAt: new Date(deployedAt).toISOString(),
    notices: { [APOLOGY_NOTICE_ID]: { startsAt: new Date(startsAt).toISOString() } },
  };
}

const LEGACY_COMPLETION_RELEASE='bd84e5c0ccc7c6ebe065f42f18df34d89eeab14e';
async function legacyCompletionSource173(t,release=LEGACY_COMPLETION_RELEASE,account='e@example.com'){
 const released=spawnSync('git',['show',release+':index.html'],{cwd:__dirname,encoding:'utf8'});assert.equal(released.status,0,released.stderr);
 const at=Date.parse('2026-10-17T15:00:00Z'),ids=['legacy-173-done','legacy-173-next'],initial=syncState({
  tasks:ids.map((id,i)=>({...syncTask(id,'Legacy task '+i),evergreen:true,evergreenHours:1,evergreenResetAtDay:false})),chain:[ids[1]],candidateId:ids[0],passId:'legacy-173-pass',passStartedAt:at-60000,
  syncAccount:account,syncRev:4,syncDirty:false,scanMode:'descending',settings:{thresholdPct:0,horizonMin:60,samples:40}});
 const h=makeSyncHarness({remote:initial,rev:4,delayMs:1}),app=await loadAppAtTime(at,{appSource:extractAppScript(released.stdout),seedStorage:{[SYNC_STORE_KEY]:JSON.stringify(initial),[LOCAL_HEAD_KEY]:JSON.stringify(initial)},cloudSyncFactory:()=>{const CS=h.factory();CS.user=account;return CS;}});
 await app.ctx.cloudPull();app.ctx.window.CloudSync.ready=false;
 hydrateUnchangedEditorDraft(app,ids[0]);app.ctx.onAction('dot-task',{dataset:{id:ids[0]}});assert.equal(await app.ctx.persist(),true);
 const common=app.shim.localStorage.getItem(SYNC_STORE_KEY),earlier=await loadAppAtTime(at+20,{appSource:extractAppScript(released.stdout),seedStorage:{[SYNC_STORE_KEY]:common,[LOCAL_HEAD_KEY]:common}});
 hydrateUnchangedEditorDraft(earlier,ids[1]);earlier.shim.document.getElementById('etTitle').value='Retained legacy title';earlier.ctx.onAction('save-edit',{dataset:{id:ids[1]}});assert.equal(await earlier.ctx.persist(),true);
 const stale=earlier.shim.localStorage.getItem(SYNC_STORE_KEY);
 setFakeTime(app.ctx,at+100);hydrateUnchangedEditorDraft(app,ids[0]);app.ctx.onAction('done-task',{dataset:{id:ids[0]}});assert.equal(await app.ctx.persist(),true);
 const completed=app.shim.localStorage.getItem(SYNC_STORE_KEY),board=JSON.parse(completed),published=app.ctx.cloudPayload();
 assert.deepEqual(board.chain,[ids[1]]);assert.equal(board.tasks[0].lastDoneAt,at+100);assert.equal((board.decisionEvents||[]).some(e=>e.kind==='completion'),false,'immutable released Done has no lifecycle journal row');
 let returning=null,returned=null;if(release===LEGACY_COMPLETION_RELEASE){ returning=await loadAppAtTime(at+200,{appSource:extractAppScript(released.stdout),seedStorage:{[SYNC_STORE_KEY]:completed,[LOCAL_HEAD_KEY]:completed}});hydrateUnchangedEditorDraft(returning,ids[0]);returning.ctx.onAction('return-candidate',{dataset:{id:ids[0]}});hydrateUnchangedEditorDraft(returning,ids[0]);returning.ctx.onAction('dot-task',{dataset:{id:ids[0]}});assert.equal(await returning.ctx.persist(),true);returned=returning.shim.localStorage.getItem(SYNC_STORE_KEY);assert.equal(JSON.parse(returned).tasks[0].lastDoneAt,null,'actual released early Return cancels completion rest');}

 setFakeTime(app.ctx,at+2*3600000);app.shim.localStorage.setItem(SYNC_STORE_KEY,stale);app.shim.localStorage.setItem(LOCAL_HEAD_KEY,stale);if(!await app.ctx.persist())assert.equal(await app.ctx.persist(),true);const revived=app.shim.localStorage.getItem(SYNC_STORE_KEY);assert.equal(JSON.parse(revived).chain.length,2,'the immutable released app actually saves its expired stale-replay failure');
 for(const closed of [app,earlier,returning].filter(Boolean)){closed.ctx.suspendCloudSync?.();vm.runInContext('clearTimeout(saveTimer);clearTimeout(cloudTimer);clearCloudRetry()',closed.ctx);}
 return {at,ids,initial,completed,stale,board,revived,returned,published};
}
async function closeLegacyApp173(app){
 if(app.closed173)return;app.closed173=true;
 await app.ctx.persist();app.ctx.suspendCloudSync();vm.runInContext('clearTimeout(saveTimer);clearTimeout(cloudTimer);clearCloudRetry()',app.ctx);await app.ctx.window.ScannerDeviceStore?.close?.();
}

async function upgradedLegacyApp173(t,options={}){
 const f=await legacyCompletionSource173(t),h=makeSyncHarness({remote:f.board,rev:4,delayMs:1}),app=await loadAppAtTime(f.at+2*3600000,{seedStorage:{[SYNC_STORE_KEY]:f.completed,[LOCAL_HEAD_KEY]:f.completed},cloudSyncFactory:()=>{const CS=h.factory();CS.ready=false;return CS;},...options});
 t.after(()=>closeLegacyApp173(app));app.shim.localStorage.setItem(SYNC_STORE_KEY,f.stale);app.shim.localStorage.setItem(LOCAL_HEAD_KEY,f.stale);if(!await app.ctx.persist())assert.equal(await app.ctx.persist(),true);
 return {...app,f,h};
}

async function releasedExpiryStartSource173(t){
 const released=spawnSync('git',['show',LEGACY_COMPLETION_RELEASE+':index.html'],{cwd:__dirname,encoding:'utf8'});assert.equal(released.status,0,released.stderr);
 const publish=async(app,h,label)=>{assert.equal(await app.ctx.persist(),true);await app.ctx.cloudPushNow();await settleSavedViewPublication(app,h,label);};
 const at=Date.parse('2026-10-17T15:00:00Z'),initial=syncState({tasks:[
  {...syncTask('expiry-recurring','Recurring first task'),createdAt:at-2000,evergreen:true,evergreenHours:1,evergreenResetAtDay:false},
  {...syncTask('expiry-peer','Independent peer title'),createdAt:at-1000,startsAt:'2999-01-01'}],chain:[],candidateId:null,mode:'work',scanMode:'descending',
  passId:'expiry-initial-pass',passStartedAt:at-60000,syncAccount:'e@example.com',syncRev:4,syncDirty:false,seenQuickStart:true,
  settings:{horizonMin:60,thresholdPct:0,samples:40}}),remote=structuredClone(initial);for(const key of ['syncRev','syncAccount','syncDirty'])delete remote[key];
 const h=makeSyncHarness({remote,rev:4,delayMs:1}),raw=JSON.stringify(initial),old=await loadAppAtTime(at,{appSource:extractAppScript(released.stdout),
  seedStorage:{[SYNC_STORE_KEY]:raw,[LOCAL_HEAD_KEY]:raw},cloudSyncFactory:h.factory});t.after(()=>closeLegacyApp173(old));await old.ctx.cloudPull();
 // This peer is deliberately not yet eligible; real local calendar dates are
 // independent of this fixture's Date.now-only completion clock.
 assert.equal(old.ctx.isEligible(old.ctx.state.tasks.find(task=>task.id==='expiry-peer')),false,'the actual released peer stays future-dated in every local calendar');
 old.ctx.window.CloudSync.ready=false;old.ctx.onAction('start-scan',{dataset:{mode:'descending'}});old.ctx.window.CloudSync.ready=true;await publish(old,h,'expiry-released-initial-start');
 old.ctx.window.CloudSync.ready=false;hydrateUnchangedEditorDraft(old,'expiry-recurring');old.ctx.onAction('dot-task',{dataset:{id:'expiry-recurring'}});old.ctx.window.CloudSync.ready=true;await publish(old,h,'expiry-released-original-dot');
 const beforeDoneRaw=old.shim.localStorage.getItem(SYNC_STORE_KEY);old.ctx.window.CloudSync.ready=false;setFakeTime(old.ctx,at+100);hydrateUnchangedEditorDraft(old,'expiry-recurring');old.ctx.onAction('done-task',{dataset:{id:'expiry-recurring'}});assert.equal(await old.ctx.persist(),true);
 const afterDoneRaw=old.shim.localStorage.getItem(SYNC_STORE_KEY);setFakeTime(old.ctx,at+2*3600000);old.ctx.ensureCandidate();old.ctx.renderScan();
 assert.match(old.shim.document.getElementById('scan').innerHTML,/data-act="start-scan"/,'the actual old scanner offers permitted Start after its rest expires');
 assert.deepEqual(Array.from(old.ctx.pool(),task=>task.id),['expiry-recurring'],'the actual released expired Start pool contains only its eligible recurring task');
 old.ctx.onAction('start-scan',{dataset:{mode:'descending'}});assert.deepEqual(Array.from(old.ctx.state.chain),['expiry-recurring']);
 hydrateUnchangedEditorDraft(old,'expiry-peer');old.shim.document.getElementById('etTitle').value='Actual later released peer title';old.ctx.onAction('save-edit',{dataset:{id:'expiry-peer'}});
 old.ctx.window.CloudSync.ready=true;await publish(old,h,'expiry-released-informed-start-title');
 const exactOldCloud=h.doc.payload,exactOldRev=h.doc.rev,exactOldDevice=old.shim.localStorage.getItem(SYNC_STORE_KEY);assert.deepEqual(JSON.parse(exactOldCloud).chain,['expiry-recurring']);assert.equal(exactOldRev,6);assert.equal(old.ctx.decisionProjectionIssue(old.ctx.state),null);await closeLegacyApp173(old);
 return {at,h,beforeDoneRaw,afterDoneRaw,exactOldDevice,exactOldCloud,exactOldRev};
}

async function scopedUndoClients(configure=()=>{}){
 const at=Date.parse('2026-10-17T15:00:00Z');
 const initial=syncState({tasks:[syncTask('undo-base','Benchmark'),syncTask('undo-local','Local choice'),syncTask('undo-peer','Peer choice')],
  chain:['undo-base'],candidateId:'undo-local',mode:'scan',scanMode:'descending',passId:'undo-pass',passStartedAt:at-60000,
  syncRev:4,syncAccount:'e@example.com',syncDirty:false,settings:{horizonMin:60,thresholdPct:0,samples:250,cantMin:30,workedHours:8}});
 configure(initial);
 const remote=JSON.parse(JSON.stringify(initial));for(const key of ['syncRev','syncAccount','syncDirty'])delete remote[key];
 const h=makeSyncHarness({remote,rev:4,delayMs:1}),seedStorage={[SYNC_STORE_KEY]:JSON.stringify(initial),[LOCAL_HEAD_KEY]:JSON.stringify(initial)};
 const local=await loadAppAtTime(at,{seedStorage,cloudSyncFactory:h.factory}),peer=await loadAppAtTime(at,{seedStorage,cloudSyncFactory:h.factory});
 await local.ctx.cloudPull();await peer.ctx.cloudPull();
 local.ctx.window.CloudSync.ready=false;peer.ctx.window.CloudSync.ready=false;
 return {local,peer,h,at,initial};
}

// Last task WOOP exercises mounted handlers and real task history, not guessed pass marks.
async function woopFixture(){
 const app=await loadApp({seed:971});const {ctx}=app;
 const task=ctx.addTask('Private final task');ctx.state.mode='work';ctx.state.chain=[task.id];
 return {...app,task};
}
function woopStep(app,value){
 const {ctx,shim}=app;shim.document.getElementById('woopAnswer').value=value;
 const session=vm.runInContext('woopDraft',ctx);
 ctx.onAction('woop-next',{dataset:{session:session.id,step:String(session.step)}});
}
function woopDislodgeTwice(app){
 const {ctx,task}=app;
 for(let i=0;i<2;i++){ctx.state.chain=[task.id];ctx.dislodge();}
 ctx.state.chain=[task.id];ctx.state.mode='work';ctx.state.settings.lastTaskWoop=true;
}

const ratingHistoryCopy = value => JSON.parse(JSON.stringify(value));
const ratingHistoryTask=(ctx,id)=>ctx.state.tasks.find(t=>t.id===id)||null;
async function ratingHistoryFixture(seed=613){
 const h=await loadApp({seed,cryptoProvider:webcrypto});
 setFakeTime(h.ctx,Date.parse('2026-10-06T12:34:56.789Z'));
 const a=h.ctx.addTask('Private benchmark'),b=h.ctx.addTask('Private candidate'),c=h.ctx.addTask('Unrelated private task');
 h.ctx.state.chain=[a.id];h.ctx.state.candidateId=b.id;h.ctx.recomputeRanks();
 return {...h,a,b,c};
}

// tests/shared.js sits one level below the repository root; tests resolve
// repository files from the root exactly as they did from tests.js.
const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HTML_PATH = path.join(__dirname, "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");
const lzStringSrc = fs.readFileSync(path.join(__dirname, "vendor/lz-string-1.5.0.min.js"), "utf8");

const sceneTimelineScripts=new Map();
function runSceneTimelineScript(source,context){
 let script=sceneTimelineScripts.get(source);
 if(script){sceneTimelineScripts.delete(source);sceneTimelineScripts.set(source,script);}
 else{
  script=new vm.Script(source);sceneTimelineScripts.set(source,script);
  if(sceneTimelineScripts.size>48)sceneTimelineScripts.delete(sceneTimelineScripts.keys().next().value);
 }
 return script.runInContext(context);
}
function sceneTimeline(transforms={}) {
 const context=vm.createContext({Date,Math,Intl,console});
 for(const file of ['landscape-config.js','vendor/astronomy.min.js','stars.js','landscape-core.js','landscape-geometry.js','landscape-visits.js','landscape-timeline.js']){
  assert.ok(fs.existsSync(path.join(__dirname,file)),`deterministic scenery module missing: ${file}`);
  const source=fs.readFileSync(path.join(__dirname,file),'utf8');
  runSceneTimelineScript(transforms[file]?transforms[file](source):source,context);
 }
 return context;
}

/* The landscape computes its sky locally from offline scene mirrors. It never
   makes a location-service request to decide what the sky looks like. */
function livingSky() {
  const ctx = vm.createContext({ Date, Math, console });
  for (const file of ["landscape-config.js", "vendor/astronomy.min.js", "stars.js", "landscape-core.js"]) {
    assert.ok(fs.existsSync(path.join(__dirname, file)), `offline landscape asset missing: ${file}`);
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), ctx);
  }
  return ctx.LivingSky;
}

function livingLocation({ stored, navigator, storage } = {}) {
  const values = new Map(Object.entries(stored || {}));
  const events = [];
  const localStorage = storage || {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const document = {
    dispatchEvent(event) { events.push(event); return true; },
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelector() { return null; },
  };
  const ctx = vm.createContext({ Date, Math, console, Intl, JSON, document, localStorage,
    navigator: navigator || { geolocation: { getCurrentPosition() { throw new Error("prompted"); } } },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; Object.assign(this, options || {}); } },
  });
  const file = path.join(__dirname, "location.js");
  assert.ok(fs.existsSync(file), "offline location module must exist");
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: "location.js" });
  return { location: ctx.LivingLocation, events, values, localStorage, ctx };
}

function landscapeLuminance(hex){
  return hex.slice(1).match(/../g).map(c=>parseInt(c,16)/255)
    .map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4)
    .reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
}

/* ---------- PWA upgrade contract ----------
   These are intentionally repository-text tests: they describe the installable
   shell the implementation must add without requiring a browser or network. */
function manifestHrefFromHtml() {
  const match = html.match(/<link\b[^>]*\brel=["']manifest["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i)
    || html.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']manifest["'][^>]*>/i);
  assert.ok(match, "index.html must link a web app manifest");
  assert.ok(!/^(?:[a-z]+:)?\/\//i.test(match[1]), "manifest link must be a repository-local file");
  return match[1];
}

function serviceWorkerSource() {
  const match = html.match(/navigator\.serviceWorker\.register\(\s*["']([^"']+)["']/);
  assert.ok(match, "service-worker source path must be discoverable from the app registration");
  const workerPath = path.resolve(__dirname, match[1]);
  assert.ok(workerPath.startsWith(`${__dirname}${path.sep}`), "service worker must stay inside the app repository");
  return fs.readFileSync(workerPath, "utf8");
}

function appShellContract(worker) {
  const cacheMatch = worker.match(/const\s+CACHE_NAME\s*=\s*["']([^"']+)["']/);
  assert.ok(cacheMatch, "service worker must declare a literal CACHE_NAME");

  const addAllMatch = worker.match(/\.addAll\(\s*\[([\s\S]*?)\]/);
  assert.ok(addAllMatch, "service worker must precache a literal app-shell path list");
  const rawPaths = [...addAllMatch[1].matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
  assert.ok(rawPaths.length > 0, "service worker app-shell path list must not be empty");

  const localPaths = [...new Set(rawPaths.flatMap((entry) => {
    // Remote URLs are intentionally not part of the local shell fingerprint.
    if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(entry) || /^[a-z][a-z\d+.-]*:/i.test(entry)) return [];
    const normalized = path.posix.normalize(entry.replace(/^\.\//, ""));
    // The root navigation and its explicit HTML fallback are the same shell file.
    if (normalized === "." || normalized === "index.html") return ["index.html"];
    // A worker cannot fingerprint itself without creating a circular release key.
    if (normalized === "sw.js") return [];
    return [normalized];
  }))].sort();
  assert.ok(localPaths.includes("index.html"), "app-shell fingerprint must include index.html");

  const hash = createHash("sha256");
  for (const relativePath of localPaths) {
    const absolutePath = path.resolve(__dirname, relativePath);
    assert.ok(absolutePath.startsWith(`${__dirname}${path.sep}`),
      `precached local asset must stay inside the app repository: ${relativePath}`);
    assert.ok(fs.existsSync(absolutePath), `precached local asset must exist: ${relativePath}`);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(absolutePath));
    hash.update("\0");
  }

  return {
    cacheName: cacheMatch[1],
    rawPaths,
    localPaths,
    fingerprint: hash.digest("hex"),
  };
}

function serviceWorkerHarness(worker, existingCacheNames = []) {
  const handlers = {};
  const cacheRecords = new Map(existingCacheNames.map((name) => [name, { added: [] }]));
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  const caches = {
    open(name) {
      if (!cacheRecords.has(name)) cacheRecords.set(name, { added: [] });
      const record = cacheRecords.get(name);
      return Promise.resolve({
        addAll(entries) {
          record.added.push(...entries);
          return Promise.resolve();
        },
        put() { return Promise.resolve(); },
      });
    },
    keys() { return Promise.resolve([...cacheRecords.keys()]); },
    delete(name) { return Promise.resolve(cacheRecords.delete(name)); },
    match() { return Promise.resolve(undefined); },
  };
  const context = {
    caches,
    console,
    fetch() { return Promise.reject(new Error("network should not be used in lifecycle test")); },
    URL,
    Request: class { constructor(url, options){ this.url=url; this.cache=options.cache; } },
    self: {
      location: { origin: "https://scanner.example" },
      addEventListener(type, handler) { handlers[type] = handler; },
      skipWaiting() { skipWaitingCalls += 1; return Promise.resolve(); },
      clients: { claim() { claimCalls += 1; return Promise.resolve(); } },
    },
  };
  vm.runInNewContext(worker, context, { filename: "sw.js" });
  return { handlers, cacheRecords, skipWaitingCalls: () => skipWaitingCalls, claimCalls: () => claimCalls };
}

function slice(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker);
  if (s === -1 || e === -1 || e < s) throw new Error(`markers not found: ${startMarker} .. ${endMarker}`);
  return src.slice(s + startMarker.length, e);
}
const engineSrc = slice(html, "/*ENGINE-START*/", "/*ENGINE-END*/");

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_SNIPPET = (seed) => `
Math.random = (function(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})(${seed});
`;

function loadEngine(seed) {
  const sandbox = {};
  vm.createContext(sandbox);
  // Seed FIRST, inside the context — vm contexts don't expose their built-in
  // Math as a settable property on the outer sandbox object, so reassigning
  // Math.random has to happen as code run *in* the context, not from outside.
  if (seed !== undefined) vm.runInContext(SEED_SNIPPET(seed), sandbox);
  vm.runInContext(engineSrc, sandbox, { filename: "index.html#engine" });
  return sandbox;
}
// `const`/`let` at top level (SIGMA_FLOOR, BETA, TAU, ...) live in the script's
// lexical scope, not as properties of the sandbox object — unlike `function`
// declarations, which do attach. Read them by evaluating the bare name inside
// the same context instead of via the returned object.
function readConst(sandbox, name) {
  return vm.runInContext(name, sandbox);
}

/* =====================================================================
   Harness for the FULL app script (state, decide/*, addTask, deleteTask,
   parseTaskList, the new queue-gate, etc.) — the classic (non-module)
   <script> block, identified by its "use strict" opener so it doesn't
   depend on script ordering in the file.
   ===================================================================== */
function extractAppScript(src) {
  const m = src.match(/<script>\s*"use strict";([\s\S]*?)<\/script>/);
  if (!m) throw new Error("could not find the main app <script> block");
  return '"use strict";' + m[1];
}
const appSrc = extractAppScript(html);

function makeFakeElement() {
  const el = {
    innerHTML: "", textContent: "", value: "", hidden: false, scrollTop: 0, children: [],
    dataset: {}, style: {},
    classList: {
      _set: new Set(),
      toggle(cls, force) {
        if (force === undefined) { this._set.has(cls) ? this._set.delete(cls) : this._set.add(cls); }
        else if (force) { this._set.add(cls); } else { this._set.delete(cls); }
      },
      add(cls) { this._set.add(cls); },
      remove(cls) { this._set.delete(cls); },
      contains(cls) { return this._set.has(cls); },
    },
    addEventListener() {}, removeEventListener() {},
    focus() {}, select() {}, click() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    // Attributes are really stored now (they used to be no-op stubs) so that
    // <html data-theme="..."> can be asserted on. getAttribute still returns
    // null for anything never set, which is what the old stub always did.
    _attrs: new Map(),
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
    setAttribute(k, v) { this._attrs.set(k, String(v)); },
    removeAttribute(k) { this._attrs.delete(k); },
    hasAttribute(k) { return this._attrs.has(k); },
    appendChild(child) { this.children.push(child); }, append(child) { this.children.push(child); }, scrollIntoView() {},
  };
  return el;
}

function makeDomShim({ prefersDark = false, sharedStorage = null } = {}) {
  const elements = new Map();
  const winListeners = {};
  const documentListeners = {};
  const localStorageMap = new Map();

  const documentElement = makeFakeElement();

  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeFakeElement());
      return elements.get(id);
    },
    querySelector() { return null; },   // "no modal open" by default
    querySelectorAll() { return []; },
    addEventListener(evt, fn) { (documentListeners[evt] ||= []).push(fn); },
    removeEventListener() {},
    dispatchEvent(evt) {
      for (const fn of (documentListeners[evt.type] || [])) fn(evt);
      return true;
    },
    // Observe completion through the actual registered async event handlers.
    dispatchEventAndWait(evt) {
      const completions=[];
      for(const fn of (documentListeners[evt.type]||[])){
        const outcome=fn(evt);
        if(outcome&&typeof outcome.then==='function')completions.push(outcome);
      }
      return Promise.all(completions);
    },
    createElement() { return makeFakeElement(); },
    body: { appendChild() {} },
    documentElement,
  };
  const localStorage = sharedStorage || {
    getItem(k) { return localStorageMap.has(k) ? localStorageMap.get(k) : null; },
    setItem(k, v) { localStorageMap.set(k, String(v)); },
    removeItem(k) { localStorageMap.delete(k); },
  };
  // A minimal MediaQueryList good enough for prefers-color-scheme. `setDark`
  // flips the OS preference and notifies listeners the way a real browser does
  // when you change the system appearance while the page is open.
  const mqlListeners = [];
  const mql = {
    media: "(prefers-color-scheme: dark)",
    matches: prefersDark,
    addEventListener(evt, fn) { if (evt === "change") mqlListeners.push(fn); },
    removeEventListener(evt, fn) {
      const i = mqlListeners.indexOf(fn);
      if (i >= 0) mqlListeners.splice(i, 1);
    },
  };
  function setDark(v) {
    mql.matches = !!v;
    for (const fn of [...mqlListeners]) fn({ matches: mql.matches, media: mql.media });
  }

  const window = {
    addEventListener(evt, fn) { (winListeners[evt] ||= []).push(fn); },
    removeEventListener() {},
    dispatchEvent(evt) {
      for (const fn of (winListeners[evt.type] || [])) fn(evt);
      return true;
    },
    matchMedia(q) {
      // Only the color-scheme query is modelled; anything else reports no match.
      if (String(q).includes("prefers-color-scheme: dark")) return mql;
      return { media: String(q), matches: false, addEventListener() {}, removeEventListener() {} };
    },
    localStorage,
    CloudSync: undefined,
  };
  window.window = window;
  return { document, window, localStorage, elements, winListeners, documentElement, setDark, mqlListeners };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function loadApp({ appSource=appSrc, artifacts=null, seed, cloudSyncFactory, prefersDark = false, noMatchMedia = false, seedStorage, sharedStorage, hostStorage, hostStorageDelayMs = 0, beforeStateReady, navigatorProvider, cryptoProvider = webcrypto, indexedDBProvider, deviceDbName, deviceOpenTimeoutMs, withSceneModules = false, sceneModulesAfterDomReady = false, locationHref, fetchProvider } = {}) {
  const shim = makeDomShim({ prefersDark, sharedStorage });
  const ownedTimers=new Set();let disposed=false,sandbox;
  const fixture={async dispose(){
    if(disposed)return;
    disposed=true;sandbox?.suspendCloudSync?.();
    for(const timer of ownedTimers)clearTimeout(timer);
    ownedTimers.clear();await shim.window.ScannerDeviceStore?.close?.();
  }};
  appFixtureScope.getStore()?.add(fixture); // before startup, including failed boots
  const schedule=(fn,ms,...args)=>{
    // A late in-flight continuation cannot revive a disposed fixture.
    const timer=setTimeout(()=>{ownedTimers.delete(timer);if(!disposed)fn(...args);},ms);
    if(disposed)clearTimeout(timer);else ownedTimers.add(timer);
    timer.unref?.();return timer;
  };
  const cancel=timer=>{ownedTimers.delete(timer);clearTimeout(timer);};
  if(locationHref)shim.window.location=new URL(locationHref);
  if(fetchProvider){shim.window.fetch=fetchProvider;shim.window.AbortController=AbortController;}
  if (noMatchMedia) delete shim.window.matchMedia;   // old browser / bare JS host
  if (seedStorage) for (const [k, v] of Object.entries(seedStorage)) shim.localStorage.setItem(k, v);
  /* The OTHER persistence backend. loadState() prefers window.storage (the
     artifact host's async key-value store) and only falls back to
     localStorage — `useLocal` — when there isn't one. Every existing test
     runs the localStorage path; pass hostStorage to run the other. */
  if (hostStorage) {
    const map = new Map(Object.entries(hostStorage));
    shim.window.storage = {
      _map: map,
      async get(k) {
        if (hostStorageDelayMs) await new Promise((resolve) => setTimeout(resolve, hostStorageDelayMs));
        return map.has(k) ? { value: map.get(k) } : null;
      },
      async set(k, v) { map.set(k, String(v)); },
    };
  }
  if (cloudSyncFactory) shim.window.CloudSync = cloudSyncFactory(shim.window);
  if (deviceDbName) shim.window.CHAIN_STORAGE_DB_NAME = deviceDbName;
  if (deviceOpenTimeoutMs) shim.window.CHAIN_STORAGE_OPEN_TIMEOUT_MS = deviceOpenTimeoutMs;
  if (indexedDBProvider) shim.window.indexedDB = indexedDBProvider;
  sandbox = {
    navigator:navigatorProvider,
    window: shim.window,
    document: shim.document,
    localStorage: shim.localStorage,
    URL,
    AbortController,
    fetch:fetchProvider,
    console,
    JSON,
    crypto:cryptoProvider,
    indexedDB:indexedDBProvider,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    structuredClone,
    AbortController,
    performance,
    // NOTE: deliberately NOT injecting the outer process's `Date` here — it's
    // passed by reference, so overriding Date.now on it (for time-travel
    // tests) would leak into the whole Node process. Leave Date unset and the
    // vm context auto-provisions its own separate, safely-overridable Date;
    // see setFakeTime() below, which overrides it via in-context code only.
    CustomEvent: class CustomEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); } },
    setTimeout: schedule,
    clearTimeout: cancel,
    requestAnimationFrame: (fn) => schedule(fn, 0),
    confirm: () => true,
    alert: () => {},
    prompt: () => null,
  };
  vm.createContext(sandbox);
  vm.runInContext(lzStringSrc, sandbox, { filename: "vendor/lz-string-1.5.0.min.js" });
  if(indexedDBProvider){
    vm.runInContext(artifacts?.storage||fs.readFileSync(path.join(__dirname,"device-store-v2.js"),"utf8"),sandbox,{filename:"device-store-v2.js"});
    vm.runInContext(artifacts?.cloud||fs.readFileSync(path.join(__dirname,"cloud-store-v2.js"),"utf8"),sandbox,{filename:"cloud-store-v2.js"});
    shim.window.ChainStorageV2=sandbox.ChainStorageV2;
    shim.window.ChainCloudV2=sandbox.ChainCloudV2;
  }
  if (seed !== undefined) vm.runInContext(SEED_SNIPPET(seed), sandbox);
  const installSceneModules = () => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "location.js"), "utf8"), sandbox, { filename: "location.js" });
    const timeKey = "fvp:chain-scanner:scene-time", seasonKey = "fvp:chain-scanner:scene-season";
    sandbox.LivingSky = {
      readSceneTime: storage => storage.getItem(timeKey),
      readSceneSeason: storage => storage.getItem(seasonKey),
    };
    return () => { shim.window.applySyncedSceneTime = (time, season) => {
      if (time === null) shim.localStorage.removeItem(timeKey);
      else shim.localStorage.setItem(timeKey, time);
      if (season === null) shim.localStorage.removeItem(seasonKey);
      else shim.localStorage.setItem(seasonKey, season);
    }; };
  };
  if (withSceneModules && !sceneModulesAfterDomReady) installSceneModules()();
  if (sceneModulesAfterDomReady) shim.document.readyState = "loading";
  shim.document.currentScript={textContent:appSource,src:""};
  vm.runInContext(appSource, sandbox, { filename: "index.html#app" });
  shim.document.currentScript=null;
  beforeStateReady?.(sandbox, shim);
  if(/<script\b[^>]*\bsrc=["']app-release\.js["']/i.test(html))
    vm.runInContext(fs.readFileSync(path.join(__dirname,"app-release.js"),"utf8"),sandbox,{filename:"app-release.js"});
  if (sceneModulesAfterDomReady) {
    await flush(); // the inline boot script can resume before deferred modules execute
    const installTimeHook=installSceneModules();
    shim.document.readyState = "interactive";
    shim.document.dispatchEvent({ type: "DOMContentLoaded" });
    await flush(); // landscape.js also awaits its local spawn-rates file
    installTimeHook();
    shim.document.dispatchEvent({ type: "landscape-scene-time-ready" });
  }
  // `state` is a top-level `let`, reassigned wholesale by undo()/cloudPull() —
  // expose it as a live getter (re-reading the binding each time) rather than
  // a one-time snapshot, so it never goes stale after such a reassignment.
  Object.defineProperty(sandbox, "state", {
    get() { return vm.runInContext("state", sandbox); },
    configurable: true,
  });
  // `esc` is a top-level `const` arrow fn (not `function esc(){}`), so — like
  // SIGMA_FLOOR and state — it never attaches to the sandbox object on its
  // own. It's never reassigned though, so a one-time copy is fine here.
  vm.runInContext("this.esc = esc;", sandbox);
  await flush(); // let the boot IIFE's `await loadState()` resolve before returning
  if(indexedDBProvider){
    // Hashing and IndexedDB completion are not bounded by an event-loop count.
    // Await readiness with an explicit deadline so slowness cannot masquerade
    // as an unrelated task-action failure against null state.
    const deadline=Date.now()+5000;
    while(vm.runInContext("state",sandbox)===null && Date.now()<deadline) await flush();
    assert.notEqual(vm.runInContext("state",sandbox),null,"App durable startup did not finish within 5 seconds");
  }
  return { ctx: sandbox, shim, dispose:fixture.dispose };
}

// Overrides Date.now() *inside one vm context only*, via in-context code —
// never touches the outer process's real Date, so it can't leak across tests.
function setFakeTime(sandbox, ts) {
  vm.runInContext(`Date.now = () => ${ts};`, sandbox);
}
function realNow(sandbox) {
  return vm.runInContext("Date.now()", sandbox);
}

function publishedBetaContinuation(){
 const startsAt='2026-10-20T19:42:33.722Z';
 return {schemaVersion:1,channel:'beta',origin:'https://chain-scanner.web.app',basePath:'/',noticeId:APOLOGY_NOTICE_ID,
  originalProduct:{sourceRevision:'b50ac1694502090a51503fdaa79d97d19d13d43e',tree:'d0a89f3232179b5fe6368744b9a69a82b533f547',appFingerprint:'cc008c890dc3f5de3ce1e5fb35c8a3dede880d3aec5d6881e4c563fce722ec48'},
  originalDeployedAt:startsAt,originalStartsAt:startsAt,
  evidence:{artifactSha256:'c3f68dab62ed156e413e88d78c0901c761f9f013edb97528a5fadb8e29ae880e',publicationSha256:'1'.repeat(64),publicVerificationSha256:'2'.repeat(64)}};
}

/* ---------- undo has to be durable, not just visible ----------
   undo() restored the snapshot on screen but called commit(false), which skips
   save() — so the reverted state never reached storage. Since save() is
   debounced, any undo more than ~350ms after the action it reverses left the
   pre-undo state on disk, and a reload resurrected whatever you just took back.
   save() also stamps updatedAt, which is what arbitrates the cloud's
   last-write-wins: an undo carrying its snapshot's stale timestamp loses the
   next reconcile to the remote copy it was meant to overrule. */

const SAVE_DEBOUNCE_MS = 350;
const settle = () => new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 120));
const persisted = (shim) => JSON.parse(shim.localStorage.getItem("fvp:chain-scanner:v1"));


/* ---------- regression: the cloud-sync recursion bug fixed last turn ----------
   CS.push/CS.pull each ping() (dispatch "cloudsync") BEFORE their own network
   await — once for "syncing", once for "ok". The old listener called
   cloudPull() directly on every ping, including ones fired *by* cloudPull's
   own call into CS.pull — an unbounded synchronous recursive cascade. This
   fake CloudSync reproduces that exact ping-before-await shape; if the guard
   in cloudPull() ever regresses, this test will hang or crash instead of
   completing with a small, bounded call count. */
function makeFakeCloudSyncFactory({ delayMs = 4 } = {}) {
  const store = { payload: null, updatedAt: 0 };
  return (shimWindow) => {
    const CS = {
      configured: true, ready: true, user: "test@example.com", status: "ok",
      signIn() {}, signOut() {},
      pullCalls: 0,
      async pull() {
        CS.pullCalls++;
        if (CS.pullCalls > 100) throw new Error("runaway recursive pull — the guard regressed");
        CS.status = "syncing";
        shimWindow.dispatchEvent({ type: "cloudsync" }); // ping BEFORE the await, same as the real module
        await new Promise((r) => setTimeout(r, delayMs));
        CS.status = "ok";
        shimWindow.dispatchEvent({ type: "cloudsync" });
        return store.payload ? { payload: store.payload, updatedAt: store.updatedAt } : null;
      },
      async push(payload, updatedAt) {
        CS.status = "syncing";
        shimWindow.dispatchEvent({ type: "cloudsync" });
        await new Promise((r) => setTimeout(r, delayMs));
        store.payload = payload; store.updatedAt = updatedAt;
        CS.status = "ok";
        shimWindow.dispatchEvent({ type: "cloudsync" });
      },
    };
    return CS;
  };
}

/* ---------- cantMin settings validation ---------- */

function setInput(ctx, id, value) {
  ctx.document.getElementById(id).value = String(value);
}

/* =====================================================================
   "WORKED ON IT" IS BULLETPROOF FOR A CONFIGURABLE WINDOW
   Forster rule 7 crosses a task off and sends it to the bottom of the list.
   Until now the "worked" mark it left behind never expired on its own — the
   task stayed out of the scan until a new pass, a rescan, or Return as
   candidate cleared it by hand. Now the mark carries a timestamp
   (state.workedAt), survives newPass() while fresh, and expireWorked()
   clears it once state.settings.workedHours have elapsed OR the local clock
   crosses 02:00, whichever comes first. It is the hours-scale sibling of the
   "can't" window (cantMin / cantAt / expireCants).
   ===================================================================== */

const WH_STORE_KEY = "fvp:chain-scanner:v1";
const preChangeState = (over = {}) => Object.assign({
  v: 1, tasks: [], contexts: [], chain: [], considered: {}, cantAt: {}, candidateId: null,
  interventionActive: false, interventionP: 0, snooze: 0, mode: "scan", decisionsMs: [],
  presentedAt: 0, listOpen: false, ctxOpen: true, histOpen: false, updatedAt: 0, workLog: [],
  seenQuickStart: true,
  settings: { horizonMin: 60, thresholdPct: 25, samples: 250, cantMin: 30, theme: "system" },
}, over);

/* ---- expires on its own schedule ----
   A worked mark releases at min(workedAt + workedHours, the next 02:00 local).
   The 02:00 day line is a hard ceiling: worked on yesterday is today's concern,
   so no window — however long the user sets it — carries a mark past the next
   02:00. A short window can still end the hold earlier, within the same day.
   These anchor to fixed local times so which limit bites is deterministic,
   rather than depending on the hour the suite runs. */
const localAt = (day, h, m) => new Date(2026, 7, day, h, m || 0).getTime();

/* ---------- chain start: one click, then the oldest outstanding task is dotted ----------
   Starting a chain has no benchmark, so a ranked pick and a Yes/No comparison
   are both meaningless — and so is asking "can I do this?", because the answer
   changes nothing about which task goes first. So nothing is dotted while you
   are still adding: the scan waits behind a Start scanning button, and that
   click dots the oldest outstanding task. That first dot moves no ranks —
   nothing was compared. */

function addTaskAged(ctx, title, ageMs) { // add a task with a backdated createdAt
  const t = ctx.addTask(title, false);
  ctx.state.tasks.find((x) => x.id === t.id).createdAt = Date.now() - ageMs;
  return t;
}
const titleOf = (ctx, id) => (ctx.state.tasks.find((t) => t.id === id) || {}).title;
const scanHtmlOf = (ctx, shim) => { ctx.render(); return shim.elements.get("scan").innerHTML; };

/* ---------- the benchmark's actions are one row beneath the card ----------
   Six actions stacked in a right-hand rail made the purple card as tall as the
   rail and pushed the candidate card down past it. They now sit in a single
   row directly beneath the card they act on, and a hairline separates that
   whole block from the candidate being compared against it — so the two things
   you're weighing read as two things, not one long column. */

const benchAction = (scanHtml) => (scanHtml.match(/<div class="actionrow[^"]*">[\s\S]*?<\/div>/) || [])[0];

/* ---------- Done saves the pane's fields first ----------
   Delete throws unsaved edits away; Done doesn't. Retitle a task and cross it
   off in one motion and the completed task carries the new title. The two
   halves share a single undo snapshot, so one `u` reverses both. */

function fillEditPane(ctx, shim, { title, url, due, start, evergreen, ctxIds } = {}) {
  const g = (id) => ctx.document.getElementById(id);
  g("etTitle").value = title ?? "";
  g("etUrl").value = url ?? "";
  g("etDue").value = due ?? "";
  g("etStart").value = start ?? "";
  g("etEver").checked = !!evergreen;
  const picks = (ctxIds || []).map((id) => ({ checked: true, dataset: { editctx: id } }));
  shim.document.querySelectorAll = (sel) => (sel === "[data-editctx]" ? picks : []);
}

/* =====================================================================
   NIGHT MODE — Unit 1: preference model & resolution
   ===================================================================== */
const STORE_KEY = "fvp:chain-scanner:v1";

/* =====================================================================
   NIGHT MODE — Unit 2: DOM application, persistence, anti-flash boot
   ===================================================================== */
const THEME_HINT_KEY = "fvp:chain-scanner:theme";

// The synchronous <head> script that paints before first frame, sliced out of
// index.html the same way the engine is, so it's tested as shipped. Sliced
// lazily: at module load a missing marker would take down the whole file.
const themeBootSrc = () => slice(html, "/*THEME-BOOT-START*/", "/*THEME-BOOT-END*/");

function runThemeBoot({ hint, throwingStorage = false } = {}) {
  const root = makeFakeElement();
  const store = new Map();
  if (hint !== undefined) store.set(THEME_HINT_KEY, hint);
  const sandbox = {
    document: { documentElement: root },
    localStorage: throwingStorage
      ? { getItem() { throw new Error("storage blocked"); } }
      : { getItem(k) { return store.has(k) ? store.get(k) : null; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(themeBootSrc(), sandbox, { filename: "index.html#theme-boot" });
  return root;
}

/* =====================================================================
   NIGHT MODE — Unit 3: the one-tap footer control & live OS reactivity
   ===================================================================== */
const themeBtnText = (shim) => shim.elements.get("themeBtn").textContent;

/* =====================================================================
   NIGHT MODE — Unit 4: the palette itself
   A dark mode is only as good as its least-converted colour. This guard
   walks every declaration in <style> and fails on any background, border,
   fill or accent that is still a hardcoded literal, which is how a stray
   white input box survives into a dark theme.
   ===================================================================== */
const styleSrc = slice(html, "<style>", "</style>").replace(/\/\*[\s\S]*?\*\//g, "");

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g;
const WHITE_RE = /^(#fff|#ffffff|rgba?\(\s*255\s*,\s*255\s*,\s*255[^)]*\))$/i;
// Properties whose colour is decorative or sits on a saturated fill, so it is
// genuinely the same in both themes.
const INVARIANT_PROPS = new Set(["box-shadow", "text-decoration-color"]);
// Deliberate, reviewed exceptions. Each must justify itself.
const ALLOWED_DECLS = new Set([
  "background:rgba(28,26,50,.42)",   // modal scrim — dark over both themes by design
]);

function declarations() {
  const out = [];
  for (const [, body] of styleSrc.matchAll(/\{([^{}]*)\}/g)) {
    for (const chunk of body.split(";")) {
      const i = chunk.indexOf(":");
      if (i === -1) continue;
      const prop = chunk.slice(0, i).trim().toLowerCase();
      const value = chunk.slice(i + 1).trim();
      if (prop && value) out.push({ prop, value, text: prop + ":" + value.replace(/\s+/g, " ") });
    }
  }
  return out;
}

// Pulls the arguments out of every light-dark(...) in a value. Needs real
// paren balancing, not a regex: light-dark(rgba(...),rgba(...)) is legal and a
// lazy /\(([^)]*)\)/ would stop at the inner rgba's closing paren.
function lightDarkArgs(value) {
  const TAG = "light-dark(";
  const out = [];
  let i = 0;
  while ((i = value.indexOf(TAG, i)) !== -1) {
    let depth = 0, j = i + TAG.length - 1;
    for (; j < value.length; j++) {
      if (value[j] === "(") depth++;
      else if (value[j] === ")" && --depth === 0) break;
    }
    out.push(value.slice(i + TAG.length, j));
    i = j + 1;
  }
  return out.join(",");
}

function offendingDeclarations() {
  const bad = [];
  for (const d of declarations()) {
    const literals = d.value.match(COLOR_RE);
    if (!literals) continue;
    if (INVARIANT_PROPS.has(d.prop)) continue;
    if (ALLOWED_DECLS.has(d.text.replace(/\s/g, ""))) continue;
    if (d.prop === "color" && literals.every((l) => WHITE_RE.test(l))) continue; // white on a saturated fill
    // Everything else must route its literals through light-dark().
    const insideLightDark = lightDarkArgs(d.value);
    const escaped = literals.filter((l) => !insideLightDark.includes(l));
    if (escaped.length) bad.push(`${d.text}   [escaped: ${escaped.join(", ")}]`);
  }
  return bad;
}

/* =====================================================================
   NIGHT MODE — Unit 5: the app's copy is English
   Checks characters, not words: anything outside plain ASCII must be a
   deliberate typographic mark or an icon glyph. \uXXXX escapes are decoded
   first, so writing foreign text the long way round is caught too.
   ===================================================================== */
const ALLOWED_NON_ASCII = new Set([
  "\u2014", "\u2013", "\u2026", "\u00b7", "\u2022",           // dashes, ellipsis, dots
  "\u2265", "\u2264", "\u2212", "\u00b1", "\u2248",           // maths
  "\u2192", "\u2193", "\u2197", "\u21ba", "\u21bb", "\u232b", // arrows & keycaps
  "\u2715", "\u2699", "\u25c9", "\u25a6", "\u{1f5d3}",        // icons
  "\u2713",                                                  // check mark, Done in the edit pane
  "\u25b6", "\u25b8", "\u25be", "\u25bc", "\u25cf",           // carets & bullets
  "\u25d0", "\u2600", "\u263e",                               // night-mode faces
  "\u201c", "\u201d",                                     // English quotation marks in Quick start
  "\u2019",                                                   // English apostrophe ("Can't")
  "\u2601",                                                   // cloud-sync icon
  "\u{1f329}", "\ufe0f",                                     // requested thundercloud and emoji presentation
]);

function decodeEscapes(src) {
  return src
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/* =====================================================================
   NIGHT MODE — Unit 6: both palettes stay readable
   Dark mode is easy to ship and hard to ship legibly. These compute real
   WCAG contrast ratios from the tokens, in both themes, so a palette
   tweak cannot quietly push text under the line.
   ===================================================================== */
function themeTokens() {
  const rootBlock = styleSrc.slice(styleSrc.indexOf(":root{"), styleSrc.indexOf("*{box-sizing"));
  const light = {}, dark = {};
  for (const m of rootBlock.matchAll(/(--[a-z-]+)\s*:\s*light-dark\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/g)) {
    light[m[1]] = m[2];
    dark[m[1]] = m[3];
  }
  return { light, dark };
}

function channel(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function luminance(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// [description, foreground token, background token, minimum ratio]
const CONTRAST_PAIRS = [
  ["body text on the page",        "--ink",       "--bg",         4.5],
  ["body text on a panel",         "--ink",       "--panel",      4.5],
  ["muted secondary text",         "--mut",       "--bg",         4.5],
  ["links and accents",            "--accent",    "--bg",         4.5],
  ["white ink, top of chain card", "--chain-ink", "--chain",      3.0],
  ["white ink, foot of chain card","--chain-ink", "--chain-deep", 3.0],
  ["candidate card text",          "--cand-ink",  "--cand-bg",    4.5],
];

/* =====================================================================
   ALL-TASKS LIST: search by name, and filter by tag
   ---------------------------------------------------------------------
   Two independent controls sitting above the list body. Search matches
   the task title, case-insensitively. The tag filter offers only the
   contexts that are currently *active*, and lights exactly one at a time.
   Both are view-only: they never touch state.contexts[].active, so what's
   eligible for the scan is completely unaffected by what you're looking at.
   ===================================================================== */

function openList(ctx) {
  ctx.state.listOpen = true;
  ctx.render();
}
function listHTML(shim) {
  return shim.elements.get("listBody").innerHTML;
}
function listCount(shim) {
  return shim.elements.get("listCount").textContent;
}
function selectedListIds(shim) {
  return [...listHTML(shim).matchAll(/data-act="bulk-toggle" data-id="([^"]+)" aria-pressed="true"/g)].map(match=>match[1]);
}
function tagRowHTML(shim) {
  return shim.elements.get("listTagRow").innerHTML;
}
// The context ids of the tag buttons currently carrying the "on" class. Parses
// whole <button ...> tags so a neighbouring button's class can't bleed in.
function litTags(shim) {
  return [...tagRowHTML(shim).matchAll(/<button[^>]*>/g)]
    .map((m) => m[0])
    .filter((b) => /\bclass="[^"]*\bon\b[^"]*"/.test(b))
    .map((b) => (b.match(/data-id="([^"]+)"/) || [])[1]);
}

// Explicit external-IO controls for the five delivery-sensitive consumers below.
// They observe real application promises; no loader, production state or timer changes.
function deferredSyncFixture(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
async function fixtureDeadline(promise,message,ms=5000){
 const deadline=performance.now()+ms;
 let timer,finished=false;const waits=new Map();
 // Polling belongs to this observation, not the product operation it watches.
 // A raced async loop otherwise keeps scheduling host timers after failure.
 const wait=(delay=0)=>new Promise((resolve,reject)=>{
  if(finished){reject(Error(message));return;}
  const pending=setTimeout(()=>{waits.delete(pending);resolve();},delay);waits.set(pending,reject);
 });
 try{
  // Arm from the same absolute start before any synchronous callback prefix.
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),Math.max(0,deadline-performance.now()));});
  const result=await Promise.race([typeof promise==='function'?promise(wait):promise,timeout]);
  // A blocked host can deliver a successful microtask before its expired timer.
  if(performance.now()>=deadline)throw Error(message);
  return result;
 }
 finally{
  finished=true;clearTimeout(timer);
  for(const [pending,reject]of waits){clearTimeout(pending);reject(Error(message));}
  waits.clear();
 }
}
function observeSyncFixtureCalls(ctx,name){
 const original=ctx[name],calls=[];
 ctx[name]=(...args)=>{const promise=original(...args),call={promise,settled:false};calls.push(call);Promise.resolve(promise).finally(()=>{call.settled=true;});return promise;};
 return calls;
}
function observeQueuedNativeSaves(ctx,t){
 const schedule=ctx.setTimeout,cancel=ctx.clearTimeout,persist=ctx.persist,context=new AsyncLocalStorage(),jobs=new Map(),persists=[];
 ctx.persist=(...args)=>{const promise=persist(...args),call={promise,settled:false};persists.push(call);Promise.resolve(promise).finally(()=>{call.settled=true;});return promise;};
 ctx.setTimeout=(fn,ms,...args)=>{
  if(ms!==350)return schedule(fn,ms,...args);
  const job={waiting:true,finished:false};
  const timer=schedule((...fired)=>context.run(true,()=>{job.waiting=false;const result=fn(...fired);Promise.resolve(result).then(value=>{job.finished=true;job.value=value;});return result;}),ms,...args);
  jobs.set(timer,job);return timer;
 };
 ctx.clearTimeout=timer=>{const job=jobs.get(timer);if(job?.waiting){job.waiting=false;job.finished=true;job.cancelled=true;}return cancel(timer);};
 t.after(()=>{ctx.setTimeout=schedule;ctx.clearTimeout=cancel;ctx.persist=persist;});
 return {active:()=>context.getStore()===true,async settle(stage){
  const deadline=performance.now()+8000;
  while(performance.now()<deadline){
   if([...jobs.values()].every(job=>job.finished)&&persists.every(call=>call.settled))return {completed:[...jobs.values()].filter(job=>!job.cancelled).length,results:[...jobs.values()].filter(job=>!job.cancelled).map(job=>job.value)};
   await syncSettle(2);
  }
  assert.fail(stage+' still has an actual queued native save or persist producer');
 }};
}
function holdNextSyncFixturePush(app){
 const CS=app.shim.window.CloudSync,push=CS.push.bind(CS),entered=deferredSyncFixture(),release=deferredSyncFixture(),returned=deferredSyncFixture();let first=true;
 CS.push=async(...args)=>{if(first){first=false;entered.resolve();await release.promise;}const result=await push(...args);returned.resolve(result);return result;};
 return {entered:entered.promise,release:release.resolve,returned:returned.promise};
}

async function settleSavedViewPublication(app,h,stage){
 const deadline=performance.now()+8000;let observed,stored;
 do{
  observed=JSON.parse(vm.runInContext('JSON.stringify({idle:!cloudPushInFlight&&!pulling&&!pendingPush&&!cloudResumePending,payload:cloudPayload(),raw:lastPersistedRaw,stateRaw:JSON.stringify(state),revision:state.syncRev,dirty:state.syncDirty})',app.ctx));
  if(observed.idle && !observed.dirty && observed.payload===h.doc?.payload && observed.revision===h.doc?.rev && observed.raw===observed.stateRaw){
   stored=await vm.runInContext('deviceStorageAuthority?deviceStore.readHead().then(head=>head?.payload):useLocal?Promise.resolve(localStorage.getItem(STORE_KEY)):window.storage.get(STORE_KEY).then(item=>item?.value)',app.ctx);
   if(stored===observed.stateRaw)return;
  }
  await syncSettle(25);
 }while(performance.now()<deadline);
 assert.fail(stage+' did not durably acknowledge publication: '+JSON.stringify({idle:observed.idle,dirty:observed.dirty,localRev:observed.revision,remoteRev:h.doc?.rev,cloudMatches:observed.payload===h.doc?.payload,persistedMatches:observed.raw===observed.stateRaw,durableMatches:stored===observed.stateRaw,code:app.shim.window.CloudSync.errorCode}));
}

async function delayedLocalBoardBrowser(viewport={width:390,height:844},dispatchResizeDuringLoad=false,theme='system'){
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||process.env.LANDSCAPE_PLAYWRIGHT||'playwright');
 const browser=await chromium.launch({headless:true,channel:process.env.LANDSCAPE_BROWSER_CHANNEL||'chrome'});
 const context=await browser.newContext({viewport,serviceWorkers:'block'});
 const board=syncState({
  contexts:[{id:'home',name:'Home',active:true}],
  tasks:Array.from({length:45},(_,i)=>({...syncTask('boot-'+i,'Saved boot task '+i),ctx:['home']})),
  listOpen:true,seenQuickStart:true,settings:{...syncState().settings,theme}
 });
 const payload=JSON.stringify(board),delayMs=1000;
 await context.addInitScript(({payload,delayMs,theme})=>{
  Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
  if(theme==='light'||theme==='dark')localStorage.setItem('fvp:chain-scanner:theme',theme);
  localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));
  window.__savedViewRead={started:false,settled:false};
  window.storage={
   async get(){window.__savedViewRead.started=true;await new Promise(resolve=>setTimeout(resolve,delayMs));window.__savedViewRead.settled=true;return {value:payload};},
   async set(){}
  };
 },{payload,delayMs,theme});
 const origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__savedViewRead?.started===true);
 if(dispatchResizeDuringLoad)await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
 const early=await page.evaluate(()=>({
  storageSettled:window.__savedViewRead.settled,
  shellVisibility:getComputedStyle(document.querySelector('.wrap')).visibility,
  status:document.querySelector('#startupStatus')?.textContent.trim()||null,
  colorScheme:getComputedStyle(document.documentElement).colorScheme,
  inkReference:getComputedStyle(document.body).color,
  statusCard:(()=>{
   const node=document.querySelector('#startupStatus .startup-status-card');if(!node)return null;
   const style=getComputedStyle(node),rect=node.getBoundingClientRect();
   return {background:style.backgroundColor,color:style.color,borderColor:style.borderColor,borderRadius:style.borderRadius,
    bounds:{x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height}};
  })(),
  panelReference:(()=>{const node=document.querySelector('.wrap #listWrap');if(!node)return null;const style=getComputedStyle(node);return {id:node.id,className:node.className,sameNode:node===document.querySelector('#startupStatus .startup-status-card'),background:style.backgroundColor,color:style.color,borderColor:style.borderColor,borderRadius:style.borderRadius};})(),
  viewport:{width:innerWidth,height:innerHeight},
  rows:document.querySelectorAll('#listBody [data-row]').length,
  listCount:document.querySelector('#listCount')?.textContent||''
 }));
 if(process.env.SAVED_VIEW_ARTIFACT_DIR&&(theme==='light'||theme==='dark')){
  fs.mkdirSync(process.env.SAVED_VIEW_ARTIFACT_DIR,{recursive:true});
  await page.screenshot({path:path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`startup-loading-${theme}.png`)});
 }
 await page.waitForFunction(()=>document.querySelectorAll('#listBody [data-row]').length===45,{timeout:5000});
 const ready=await page.evaluate(()=>({
  shellVisibility:getComputedStyle(document.querySelector('.wrap')).visibility,
  status:document.querySelector('#startupStatus')?.textContent.trim()||null,
  rows:document.querySelectorAll('#listBody [data-row]').length,
  listCount:document.querySelector('#listCount')?.textContent||'',
  listOpen:!document.querySelector('#listBody').hidden
 }));
 return {browser,context,page,early,ready,errors};
}

// New startup consumers run in the default/CI cohort without an external server.
// Explicit browser QA keeps its configured origin and Chromium/WebKit matrix.
let openingBoardSelfHosted=false;
async function openingBoardFixture(t){
 if(process.env.LANDSCAPE_BROWSER_URL)return;
 const port=process.env.CI==='true'?0:Number(process.env.CHAIN_NATIVE_PORT);
 assert.ok(Number.isInteger(port)&&port>=0&&(port>0||process.env.CI==='true'),'allocate CHAIN_NATIVE_PORT for the local startup fixture');
 const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
 const server=createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname),file=path.resolve(__dirname,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(__dirname+path.sep)){response.writeHead(403);response.end();return;}
  fs.readFile(file,(error,bytes)=>{response.writeHead(error?404:200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});response.end(error?'Not found':bytes);});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 const previous=process.env.LANDSCAPE_BROWSER_URL;openingBoardSelfHosted=true;
 process.env.LANDSCAPE_BROWSER_URL='http://127.0.0.1:'+server.address().port+'/';
 t.after(async()=>{if(previous===undefined)delete process.env.LANDSCAPE_BROWSER_URL;else process.env.LANDSCAPE_BROWSER_URL=previous;openingBoardSelfHosted=false;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
}
async function invisibleSavedViewBrowser(theme='light',delayAppearanceAsset=false,keepHeader=false,viewport={width:390,height:844},activeScanner=false,startupOptions={}){
 const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||process.env.LANDSCAPE_PLAYWRIGHT||'playwright');
 const engineName=startupOptions.browserEngine==='webkit'?'webkit':'chromium',engine=engineName==='webkit'?webkit:chromium,
  evidencePrefix=startupOptions.brokenDeviceBoard?`broken-board-${engineName}-${theme}-${viewport.width}-${startupOptions.retainAppearance===false?'without-appearance':'with-appearance'}`:`invisible-${theme}`;
 const browser=await engine.launch(engineName==='webkit'?{headless:true}:{headless:true,channel:process.env.LANDSCAPE_BROWSER_CHANNEL||(openingBoardSelfHosted?undefined:'chrome')});
 const fixtureTime=startupOptions.fixedTime?Date.parse(startupOptions.fixedTime):startupOptions.availabilityFixture?Date.parse('2026-10-28T12:00:00Z'):null;
 let releaseFirebaseImports,resolveFirebaseImportsStarted,firebaseImportCount=0;
 const firebaseImportsStarted=new Promise(resolve=>{resolveFirebaseImportsStarted=resolve;});
 const firebaseImportsReleased=new Promise(resolve=>{releaseFirebaseImports=resolve;});
 const releaseHeldFirebaseImports=()=>releaseFirebaseImports?.();
 const waitForFirebaseImports=async(expected=3)=>{
  if(firebaseImportCount>=expected)return firebaseImportCount;
  await Promise.race([firebaseImportsStarted,new Promise((_,reject)=>setTimeout(()=>reject(Error('Configured Firebase imports did not reach the held-module boundary')),8000))]);
  if(firebaseImportCount<expected)throw Error(`Expected ${expected} held Firebase module imports, observed ${firebaseImportCount}`);
  return firebaseImportCount;
 };
 try{
 const context=await browser.newContext({viewport,serviceWorkers:startupOptions.installedOffline?'allow':'block',reducedMotion:'reduce'});
 const origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 if(startupOptions.holdConfiguredFirebaseImports)await context.route('https://www.gstatic.com/firebasejs/10.12.2/**',async route=>{
  firebaseImportCount++;
  if(firebaseImportCount>=3)resolveFirebaseImportsStarted(firebaseImportCount);
  await firebaseImportsReleased;
  await route.abort();
 });
 if(startupOptions.syntheticCloud)await context.addInitScript(()=>{
  const auth=JSON.parse(localStorage.getItem('__fullBoardAuth')||'null');window.__fullBoardCloudWrites=0;
  const configure=value=>{if(auth){value.user=auth.account;value.ready=true;value.recoveryIdentity=()=>auth.identity;}if(localStorage.getItem('__fullBoardTrace')==='true')value.push=async()=>{window.__fullBoardCloudWrites++;return{error:true};};return value;};
  let cloud=configure({configured:true,ready:false,user:null,status:'syncing',errorStage:null,errorCode:null,
   signIn(){},signOut(){},async pull(){return{error:true};},async push(){return{error:true};}});
  Object.defineProperty(window,'CloudSync',{configurable:true,enumerable:true,get:()=>cloud,set:value=>{if(value?.configured!==false)cloud=configure(value);}});
 });
 if(delayAppearanceAsset)await context.route('**/saved-appearance.js',async route=>{await new Promise(resolve=>setTimeout(resolve,600));await route.continue();});
 await context.addInitScript(({theme,fixtureTime})=>{
  const configured=localStorage.getItem('__quietStartupConfiguredCloud')==='true';
  Object.defineProperty(window,'FIREBASE_CONFIG',{value:configured?{apiKey:'quiet-startup-test-only',authDomain:'quiet-startup.invalid',projectId:'quiet-startup-test'}:null,writable:false});
  window.__cloudsyncEvents=0;window.addEventListener('cloudsync',()=>window.__cloudsyncEvents++);
  localStorage.setItem('fvp:chain-scanner:theme',theme);
  localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:fixtureTime??Date.now()}));
  window.__actualLocalRead={started:false,settled:false};
  window.__firstAppearanceFrames=[];let frames=0;function observe(){if(localStorage.getItem('__delayLocalRead')==='true'&&document.querySelector('.wrap')){const preview=document.querySelector('[data-saved-preview]');const root=[...document.querySelectorAll('.wrap')].find(e=>getComputedStyle(e).visibility==='visible');window.__firstAppearanceFrames.push({ready:document.documentElement.dataset.appReady==='true',populated:!!preview&&getComputedStyle(preview).visibility==='visible'&&!!preview.querySelector('.trow'),readStarted:window.__actualLocalRead.started,boardVisible:!!root,rows:root?.querySelectorAll('.trow').length||0,connectedBoards:document.querySelectorAll('.wrap:has(.trow)').length});}if(++frames<600)requestAnimationFrame(observe);}requestAnimationFrame(observe);
  const open=indexedDB.open.bind(indexedDB),success=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess');
  indexedDB.open=(...args)=>{const request=open(...args);if(localStorage.getItem('__delayLocalRead')!=='true')return request;
   window.__actualLocalRead.started=true;window.__actualLocalRead.attempts=(window.__actualLocalRead.attempts||0)+1;const failures=Number(localStorage.getItem('__openingReadFailures'))||0;if(window.__actualLocalRead.attempts<=failures){request.onsuccess=()=>request.result.close();const failed={};setTimeout(()=>{window.__actualLocalRead.failedAttempts=(window.__actualLocalRead.failedAttempts||0)+1;failed.error=Object.assign(Error('An internal error was encountered in the Indexed Database server'),{name:'UnknownError'});failed.onerror?.();},200);return failed;}let listener=null;const delay=Number(localStorage.getItem('__delayLocalReadMs'))||1800;
   Object.defineProperty(request,'onsuccess',{configurable:true,get:()=>listener,set:fn=>{listener=fn;success.set.call(request,event=>setTimeout(()=>{window.__actualLocalRead.settled=true;fn?.call(request,event);},delay));}});return request;};
 },{theme,fixtureTime});
 const page=await context.newPage(),errors=[],pageErrorDetails=[];page.on('pageerror',error=>{errors.push(error.message);pageErrorDetails.push({message:error.message,stack:error.stack,url:page.url()});});
 if(fixtureTime!==null)await page.clock.setFixedTime(new Date(fixtureTime));
 await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded',timeout:10000});
 await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true',null,{timeout:10000});
 // Finish the fresh-profile fixture's unrelated local asset reads before
 // seeding and navigating. The actual reopening read remains held below.
 await page.waitForLoadState('networkidle');
 if(await page.locator('#motionDialog').isVisible())await page.locator('[data-landscape-motion="reduced"]').click();
 await page.waitForFunction(()=>!!document.querySelector('#modalRoot [data-act="ok-quickstart"]'),null,{timeout:10000});
 await page.locator('#modalRoot [data-act="ok-quickstart"]').click();
 assert.equal(await page.evaluate(()=>state.tasks.length),0,'a genuinely fresh profile contains no fabricated saved tasks');
 await page.evaluate(async ({longTitle,oneTask,availabilityFixture})=>{document.getElementById('motionDialog')?.close();state.addOpen=false;state.histOpen=false;state.settings.theme=localStorage.getItem('fvp:chain-scanner:theme');
  for(let i=0;i<(oneTask?1:65);i++)addTask('Saved appearance task '+String(i).padStart(2,'0')+(i===0&&longTitle?' '+('Saved long task text '.repeat(100)):''));
  if(!oneTask)addTask('Unmatched control task');if(availabilityFixture)state.tasks.at(-1).startsAt='2026-10-29';save();await persist();render();},{longTitle:startupOptions.longTitle===true,oneTask:startupOptions.oneTask===true,availabilityFixture:startupOptions.availabilityFixture===true});
 if(activeScanner)await page.locator('[data-act="start-scan"]').first().click();
 if(startupOptions.scannerState)await page.evaluate(async mode=>{state.chain=state.tasks.slice(0,2).map(t=>t.id);state.candidateId=state.tasks[2].id;state.mode=mode==='paused'?'work':'scan';state.interventionActive=mode==='intervention';state.interventionP=.23;save();await persist();render();},startupOptions.scannerState);
 if(keepHeader){await page.locator('[data-act="settings"]').first().click();await page.getByText('Scanning and recurrence',{exact:true}).click();await page.locator('#stFloatingHeader').check();await page.locator('#modalRoot [data-act="close-modal"]').click();}
 if(await page.locator('#listBody').isHidden())await page.locator('[data-act="toggle-list"]').first().click();
 await page.locator('#listSearch').fill('Saved appearance');
 await page.locator('[data-act="list-eligibility"][data-id="all"]').click();
 await page.locator('#listSearch').fill('Saved appearance');
 await page.locator('#listBody').evaluate(e=>{e.scrollTop=420;e.dispatchEvent(new Event('scroll'));});
 if(startupOptions.historyFixture)await page.evaluate(async()=>{state.ctxOpen=true;state.histOpen=true;state.workLog.push({id:'opening-history-fixture',taskId:state.tasks[64].id,title:'Saved earlier work',kind:'worked',at:Date.now()-60000});save();await persist();render();});
 if(startupOptions.savedFilter)await page.evaluate(async kind=>{
  if(kind==='context'){
   const id=state.contexts[0].id;state.tasks.slice(0,60).forEach(task=>{task.ctx=[id];});state.tasks.slice(60).forEach(task=>{task.ctx=[state.contexts[1].id];});save();await persist();render();
   setTaskPrerequisites(state.tasks[5].id,[state.tasks[6].id]);decide('cant');decide('no');TaskActionOwner.perform({type:'benchmark',action:'worked'});await persist();
   allTasksView.toggleTag('c:'+id);
  }else if(kind==='status'||kind==='combined'){
   const id=state.contexts[0].id;state.tasks.slice(0,3).forEach(task=>{task.ctx=[id];task.evergreen=true;task.evergreenHours=18;});save();await persist();render();
   if(kind==='combined'){allTasksView.setEligibility('eligible');allTasksView.toggleTag('c:'+id);allTasksView.toggleTag('s:evergreen');}else allTasksView.toggleTag('s:evergreen');
   allTasksView.setQuery('Saved appearance');
  }else if(kind==='missing-context'){const view=JSON.parse(localStorage.getItem('fvp:chain-scanner:saved-view:v1'));view.tagFilter='c:missing-opening-context';localStorage.setItem('fvp:chain-scanner:saved-view:v1',JSON.stringify(view));return;
  }else if(kind==='ineligible'){allTasksView.setEligibility('ineligible');allTasksView.setQuery('Saved appearance');}
  else if(kind==='long-query')allTasksView.setQuery('Saved long task text '.repeat(100).slice(0,2048));
  renderList();window.dispatchEvent(new Event('pagehide'));
 },startupOptions.savedFilter);
 if(startupOptions.savedFilter==='combined'){
  await page.locator('[data-act="list-eligibility"][data-id="eligible"]').click();const id=await page.evaluate(()=>state.contexts[0].id);await page.locator('[data-act="list-tag"][data-id="c:'+id+'"]').click();assert.equal(await page.locator('[data-act="list-tag"].on').textContent(),await page.evaluate(()=>state.contexts[0].name));await page.locator('[data-act="list-tag"][data-id="s:evergreen"]').click();await page.locator('#listSearch').fill('Saved appearance');
 }
 const startup=await page.evaluate(async({brokenDeviceBoard,retainAppearance,topOfPage,seedPriorRecoveryAppearance,theme})=>{
  window.scrollTo(0,topOfPage?0:220);window.dispatchEvent(new Event('pagehide'));
  let brokenPayload=null;
  if(brokenDeviceBoard){
   brokenPayload='{broken durable device board';
   const sourceBoard=JSON.parse(JSON.stringify(state));
   sourceBoard.settings??={};sourceBoard.settings.theme=theme;
   const source=JSON.stringify(sourceBoard);
   const checked=cloudSourceRecoveryBoard(source,state.syncAccount??null);
   window.__brokenBoardSourceCheck={account:state.syncAccount??null,hasSyncAccount:Object.hasOwn(state,'syncAccount'),hasSyncIdentity:Object.hasOwn(state,'syncIdentity'),
    board:!!checked.board,sourceIssue:checked.issue||null,automaticIssue:checked.board?automaticRecoveryBoardIssue(checked.board,state.syncAccount??null):null,
    projectionIssue:checked.board?decisionProjectionIssue(checked.board):null,taskCount:sourceBoard.tasks.length};
   localStorage.setItem('fvp:chain-scanner:v1',source);
   localStorage.setItem('fvp:chain-scanner:protected:v1',source);
   const deadline=promise=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('Fixture device-store operation exceeded five seconds')),5000))]);
   const head=await deadline(window.ScannerDeviceStore.readHead());
   const committed=await deadline(window.ScannerDeviceStore.commitHead({expectedHash:head.hash,payload:brokenPayload,account:null}));
   if(!committed.ok)throw Error('Could not seed the malformed durable board');
  }
  if(!retainAppearance){localStorage.removeItem('fvp:chain-scanner:appearance:v1');localStorage.removeItem('fvp:chain-scanner:saved-view:v1');}
  if(!seedPriorRecoveryAppearance)localStorage.setItem('__delayLocalRead','true');
  return{brokenPayload,sourceCheck:window.__brokenBoardSourceCheck||null};
 },{brokenDeviceBoard:startupOptions.brokenDeviceBoard===true,retainAppearance:startupOptions.retainAppearance!==false,topOfPage:startupOptions.topOfPage===true,seedPriorRecoveryAppearance:startupOptions.seedPriorRecoveryAppearance===true,theme});
 if(startupOptions.sourceFault)await page.evaluate(fault=>{
  const shared='fvp:chain-scanner:v1',protectedKey='fvp:chain-scanner:protected:v1',board=JSON.parse(localStorage.getItem(shared));
  if(fault==='malformed-primary')localStorage.setItem(shared,'{unreadable primary source');
  if(fault==='malformed-protected')localStorage.setItem(protectedKey,'{unreadable protected source');
  if(fault==='unsupported-protected')localStorage.setItem(protectedKey,JSON.stringify({...board,v:999}));
  if(fault==='divergent'){board.tasks[0].title='Distinct supported alternative';localStorage.setItem(protectedKey,JSON.stringify(board));}
  if(fault==='no-valid'){localStorage.setItem(shared,'{unreadable shared source');localStorage.setItem(protectedKey,'{unreadable protected source');}
  if(fault==='early-account'||fault==='early-account-no-appearance')localStorage.setItem('__fullBoardAuth',JSON.stringify({account:'other@example.com',identity:'other-identity'}));
  if(['early-identity','late-identity','early-identity-cache-only','late-identity-cache-only','terminal-signed-in'].includes(fault)){board.syncAccount='fixture@example.com';board.syncIdentity='saved-identity';for(const key of ['fvp:chain-scanner:appearance:v1','fvp:chain-scanner:saved-view:v1']){const raw=localStorage.getItem(key);if(raw){const value=JSON.parse(raw);value.account='fixture@example.com';localStorage.setItem(key,JSON.stringify(value));}}for(const key of [shared,protectedKey])localStorage.setItem(key,JSON.stringify(board));if(fault.startsWith('early-identity')||fault==='terminal-signed-in')localStorage.setItem('__fullBoardAuth',JSON.stringify({account:'fixture@example.com',identity:fault==='terminal-signed-in'?'saved-identity':'other-identity'}));}
  if(fault.endsWith('cache-only')||fault==='late-cache-source'){board.v=999;for(const key of [shared,protectedKey])localStorage.setItem(key,JSON.stringify(board));}
  if(fault.endsWith('cache-only'))localStorage.setItem('__appearanceOwnerFixture',JSON.stringify({appearance:localStorage.getItem('fvp:chain-scanner:appearance:v1'),view:localStorage.getItem('fvp:chain-scanner:saved-view:v1')}));
  if(fault.startsWith('late-signout')){board.syncAccount='fixture@example.com';board.syncIdentity='saved-identity';for(const key of [shared,protectedKey])localStorage.setItem(key,JSON.stringify(board));for(const key of ['fvp:chain-scanner:appearance:v1','fvp:chain-scanner:saved-view:v1']){const raw=localStorage.getItem(key);if(raw){const value=JSON.parse(raw);value.account='fixture@example.com';localStorage.setItem(key,JSON.stringify(value));}}localStorage.setItem('__fullBoardAuth',JSON.stringify({account:'fixture@example.com',identity:'saved-identity'}));}
  localStorage.setItem('__fullBoardTrace','true');
 },startupOptions.sourceFault);
 if(startupOptions.sourceFault)await page.addInitScript(()=>{
  window.__fullBoardSourceWrites=[];const set=Storage.prototype.setItem,remove=Storage.prototype.removeItem,keys=['fvp:chain-scanner:v1','fvp:chain-scanner:protected:v1','fvp:chain-scanner:backups:v1'];
  Storage.prototype.setItem=function(key,value){if(keys.includes(key))window.__fullBoardSourceWrites.push({operation:'set',key});return set.call(this,key,value);};
  Storage.prototype.removeItem=function(key){if(keys.includes(key))window.__fullBoardSourceWrites.push({operation:'remove',key});return remove.call(this,key);};
  const fixture=JSON.parse(localStorage.getItem('__appearanceOwnerFixture')||'null');if(fixture){localStorage.setItem('fvp:chain-scanner:appearance:v1',fixture.appearance);localStorage.setItem('fvp:chain-scanner:saved-view:v1',fixture.view);window.__appearanceOwnerAtRead=JSON.parse(fixture.appearance).account;}
 });
 if(startupOptions.retainAppearance===false)await page.addInitScript(()=>{localStorage.removeItem('fvp:chain-scanner:appearance:v1');localStorage.removeItem('fvp:chain-scanner:saved-view:v1');});
 if(startupOptions.seedPriorRecoveryAppearance){
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true',null,{timeout:15000});
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(()=>{
   const record=JSON.parse(localStorage.getItem('fvp:chain-scanner:appearance:v1')||'null'),find=node=>{if(!node||typeof node!=='object')return null;if(node.t==='button'&&typeof node.c==='string'&&node.c.split(/\s+/).includes('syncbtn'))return node;for(const child of node.n||[]){const found=find(child);if(found)return found;}return null;},button=find(record?.tree);
   return button?.c?.split(/\s+/).includes('err')&&button?.n?.some(child=>child==='☁ recovery pending');
  },null,{timeout:8000});
  const priorRecovery=await page.evaluate(async()=>{
   const hold=await window.ScannerDeviceStore?.getRecoveryCloudHold?.(),record=JSON.parse(localStorage.getItem('fvp:chain-scanner:appearance:v1')||'null'),find=node=>{
    if(!node||typeof node!=='object')return null;if(node.t==='button'&&typeof node.c==='string'&&node.c.split(/\s+/).includes('syncbtn'))return node;
    for(const child of node.n||[]){const found=find(child);if(found)return found;}return null;
   },button=find(record?.tree);
   return{hold,ready:document.documentElement.dataset.appReady==='true',status:document.getElementById('syncBtn')?.textContent||null,
    taskCount:state?.tasks?.length||0,appearanceStatus:button?.n?.filter(child=>typeof child==='string').join('')||null,
    appearanceDisabled:button?.d??false,appearanceClass:button?.c||null,appearanceVisible:!!record};
  });
  const priorHoldCleared=await page.evaluate(async malformed=>{
   const head=await window.ScannerDeviceStore.readHead(),hold=await window.ScannerDeviceStore.getRecoveryCloudHold();
   if(!hold||hold.reason!=='device-source-recovery')throw Error('The prior recovery hold is unavailable for the isolated second-startup fixture');
   const cleared=await window.ScannerDeviceStore.clearRecoveryCloudHold({expectedHeadHash:head.hash,expectedHold:hold});
   if(!cleared)throw Error('Could not safely close the prior fixture recovery hold before seeding a new damaged head');
   const result=await window.ScannerDeviceStore.commitHead({expectedHash:head.hash,payload:malformed,account:null});
   if(!result.ok)throw Error('Could not reseed the malformed durable board after capturing the prior recovery hold');
   localStorage.setItem('__delayLocalRead','true');window.dispatchEvent(new Event('pagehide'));
   return true;
  },startup.brokenPayload);
  startup.priorRecovery={...priorRecovery,fixtureHoldSafelyCleared:priorHoldCleared};
 }
 if(startupOptions.readFailures)await page.evaluate(count=>localStorage.setItem('__openingReadFailures',String(count)),startupOptions.readFailures);
 if(startupOptions.seedCachedError)await page.addInitScript(()=>{if(localStorage.getItem('__delayLocalRead')!=='true')return;const key='fvp:chain-scanner:appearance:v1',record=JSON.parse(localStorage.getItem(key)),find=node=>{if(!node||typeof node!=='object')return null;if(node.t==='button'&&node.c?.split(/\s+/).includes('syncbtn'))return node;for(const child of node.n||[]){const found=find(child);if(found)return found;}return null;},button=find(record.tree);button.n=['☁ error'];localStorage.setItem(key,JSON.stringify(record));window.__cachedOldErrorSeeded=button.c.split(/\s+/).includes('err')&&button.n[0]==='☁ error';});
 if(startupOptions.savedFilter==='missing-context')await page.addInitScript(()=>{if(localStorage.getItem('__delayLocalRead')!=='true')return;const key='fvp:chain-scanner:saved-view:v1',view=JSON.parse(localStorage.getItem(key));view.tagFilter='c:missing-opening-context';localStorage.setItem(key,JSON.stringify(view));});
 if(startupOptions.appearanceFault)await page.addInitScript(kind=>{if(localStorage.getItem('__delayLocalRead')!=='true')return;const key='fvp:chain-scanner:appearance:v1';if(kind==='corrupt')localStorage.setItem(key,'{unreadable optional appearance');if(kind==='blocked'){const get=Storage.prototype.getItem;Storage.prototype.getItem=function(name){if(name===key)throw new DOMException('isolated appearance storage blocked','SecurityError');return get.call(this,name);};}},startupOptions.appearanceFault);
 if(process.env.SAVED_VIEW_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`${evidencePrefix}-before.png`)});
 const before=await page.evaluate(()=>({query:document.getElementById('listSearch').value,scroll:document.getElementById('listBody').scrollTop,pageY:scrollY,geometry:(()=>{const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};return{scan:rect('scan'),list:rect('listWrap'),body:rect('listBody'),separators:document.querySelectorAll('#scan hr.sep').length};})(),visibleTitles:(()=>{const body=document.getElementById('listBody'),r=body.getBoundingClientRect();return[...body.querySelectorAll('.trow')].filter(e=>{const b=e.getBoundingClientRect();return b.bottom>r.top&&b.top<Math.min(r.bottom,innerHeight);}).map(e=>e.querySelector('.tt')?.textContent);})(),header:(()=>{const r=document.getElementById('appHeader').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})(),tasks:JSON.stringify(state.tasks),sourceCopies:{legacy:localStorage.getItem('fvp:chain-scanner:v1'),localHead:localStorage.getItem('fvp:chain-scanner:protected:v1')},cache:localStorage.getItem('fvp:chain-scanner:appearance:v1')}));
 if(startupOptions.holdConfiguredFirebaseImports)await page.evaluate(delay=>{localStorage.setItem('__quietStartupConfiguredCloud','true');localStorage.setItem('__delayLocalReadMs',String(delay));},startupOptions.openingDelayMs||4000);
 await page.reload({waitUntil:startupOptions.holdConfiguredFirebaseImports?'commit':'domcontentloaded'});
 await page.waitForFunction(()=>window.__actualLocalRead?.started,null,{timeout:10000});
 const early=await page.evaluate(()=>{const preview=document.querySelector('[data-saved-preview]'),list=preview?.querySelector('[data-preview-id="listBody"]'),search=preview?.querySelector('[data-preview-id="listSearch"]'),status=(button)=>{if(!button)return null;const box=button.getBoundingClientRect(),style=getComputedStyle(button);return{text:button.textContent,disabled:button.disabled,hidden:button.hidden,visibility:style.visibility,fontSize:style.fontSize,clientWidth:button.clientWidth,scrollWidth:button.scrollWidth,box:{x:box.x,y:box.y,width:box.width,height:box.height}};},liveSync=document.getElementById('syncBtn'),projectedSync=preview?.querySelector('.syncbtn'),liveSettings=document.querySelector('#appHeader [data-act="settings"]'),projectedSettings=preview?.querySelector('.topbtns .ghost:last-child');return{settled:window.__actualLocalRead.settled,ready:document.documentElement.dataset.appReady==='true',cloud:window.CloudSync?{configured:window.CloudSync.configured,ready:window.CloudSync.ready,status:window.CloudSync.status,errorStage:window.CloudSync.errorStage,errorCode:window.CloudSync.errorCode,events:window.__cloudsyncEvents}:null,shellVisibility:getComputedStyle(document.querySelector('.wrap')).visibility,previewVisible:!!preview&&getComputedStyle(preview).visibility==='visible',rows:[...(list?.querySelectorAll('.trow')||[])].map(e=>e.textContent),query:search?.value,listScroll:list?.scrollTop,pageY:scrollY,geometry:(()=>{const rect=id=>{const r=preview?.querySelector('[data-preview-id="'+id+'"]')?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null;};return{scan:rect('scan'),list:rect('listWrap'),body:rect('listBody'),separators:preview?.querySelectorAll('hr.sep').length||0};})(),visibleTitles:(()=>{if(!list)return[];const r=list.getBoundingClientRect();return[...list.querySelectorAll('.trow')].filter(e=>{const b=e.getBoundingClientRect();return b.bottom>r.top&&b.top<Math.min(r.bottom,innerHeight);}).map(e=>e.querySelector('.tt')?.textContent);})(),header:(()=>{const r=preview?.querySelector('[data-preview-id="appHeader"]')?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null;})(),sync:{live:status(liveSync),projection:status(projectedSync),settings:status(liveSettings),projectionSettings:status(projectedSettings)},status:document.getElementById('startupStatus')?.textContent||null,theme:document.documentElement.dataset.theme,colorScheme:getComputedStyle(document.documentElement).colorScheme,duplicateIds:[...document.querySelectorAll('[id]')].map(e=>e.id).filter((id,i,all)=>all.indexOf(id)!==i),activeActions:preview?.querySelectorAll('[data-act],[href],[onclick],[onerror]').length||0};});
 if(process.env.SAVED_VIEW_ARTIFACT_DIR&&!startupOptions.holdConfiguredFirebaseImports)await page.screenshot({path:path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`${evidencePrefix}-early.png`)});
 if(process.env.SAVED_VIEW_ARTIFACT_DIR)fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`${evidencePrefix}-probe.json`),JSON.stringify({before:{...before,cache:JSON.parse(before.cache||'null')},early},null,2));
 return {browser,context,page,errors,pageErrorDetails,before,early,startup,waitForFirebaseImports,releaseHeldFirebaseImports,get firebaseImportCount(){return firebaseImportCount;}};
 }catch(error){releaseHeldFirebaseImports();await browser.close();throw error;}
}

/* ---------- filter by the badges a row actually carries ----------
   The buttons in the FILTER row are the states you can see on the rows
   themselves: the skip marks (no / can't / dislodged / worked), the flags
   (evergreen, not started), the due states, and the contexts. One rule
   governs all of them — a button exists only when at least one open task
   would match it. Nothing offers you a filter that returns nothing. */

function tagLabels(shim) {
  return [...tagRowHTML(shim).matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
}
function tagKeys(shim) {
  return [...tagRowHTML(shim).matchAll(/<button[^>]*data-id="([^"]+)"/g)].map((m) => m[1]);
}
function clickTag(ctx, key) {
  ctx.onAction("list-tag", { dataset: { id: key } });
}
function rowTitles(shim) {
  return [...listHTML(shim).matchAll(/data-act="edit"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
}

/* =====================================================================
   REGRESSION: A STALE DEVICE MUST NOT OVERWRITE A NEWER CLOUD STATE

   The incident: a browser holding weeks-old localStorage was opened and
   its stale chain replaced a chain that had been built up in the cloud
   over a full day of work on another device. Three separate defects in
   the sync glue each allow that on their own.

   1. CS.pull() returned null both for "the document does not exist" and
      for "the read threw", and cloudPull() read null as an empty cloud
      and seeded it from this device. One flaky first request on a stale
      tab was enough to overwrite a perfectly good remote document.

   2. Pushes were gated only on "is auth ready", never on "has this
      session actually seen the cloud yet". cloudPushNow() (dotting,
      deleting) fires with no comparison at all, so an edit made in the
      seconds before the first pull landed wrote stale content straight
      over the remote.

   3. save() stamps state.updatedAt = Date.now() on every local write.
      On a device that had not reconciled yet, that put a fresh timestamp
      on weeks-old content, which then won the last-write-wins comparison
      in cloudPull() — so the stale side was declared "ahead" and pushed
      deliberately, not just by racing.

   The fix has to close all three: a failed read is not an empty cloud,
   nothing is written before the session reconciles once, and the first
   reconcile judges this device by the timestamp it LOADED with rather
   than one a local edit has since re-stamped.
   ===================================================================== */

const SYNC_STORE_KEY = "fvp:chain-scanner:v1";
const LOCAL_HEAD_KEY = "fvp:chain-scanner:protected:v1";
const LOCAL_BACKUPS_KEY = "fvp:chain-scanner:daily-backups:v1";
const DEVICE_AUTHORITY_KEY = "fvp:chain-scanner:device-store-v2";
const HOUR = 3600000;

function sharedScannerStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

async function loadCloudBackend({ serverData={rev:4}, serverExists=true, failures={}, timeoutMs=25, cryptoProvider=webcrypto }={}){
  const rootData=serverExists?{...serverData}:null;
  const h=await loadCloudBackendV2({rootData,failures,timeoutMs,cryptoProvider});
  return {...h,getStored:()=>({exists:h.docs.has('users/owner'),data:h.docs.get('users/owner')})};
}

async function loadCloudBackendV2({artifacts=null,sharedDocs=null,rootData=null,batchFailureAt=Infinity,failures={},timeoutMs=25,recoveryTimeoutMs=timeoutMs,recordSyncError,cryptoProvider=webcrypto,runtimeWindow=null,firebaseSDK=null,timerProvider=null}={}){
 const moduleMatch=(artifacts?.html||html).match(/<script type="module">([\s\S]*?)<\/script>/);assert.ok(moduleMatch);
 const moduleSource=moduleMatch[1].replace(/const \[appMod, A, F\] = await Promise\.all\(\[[\s\S]*?\]\);/,
  'const [appMod, A, F] = globalThis.__cloudModules;');
 const clone=value=>value==null||typeof value!=='object'?value:Array.isArray(value)?value.map(clone):Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)]));
 const docs=sharedDocs||new Map(),rootPath='users/owner';
 if(rootData)docs.set(rootPath,clone(rootData));
 const pathOf=(parts)=>parts.filter(part=>part!==undefined).join('/');
 const ref=(...parts)=>({path:pathOf(parts),id:String(parts.at(-1))});
 const snap=reference=>{
  const observedExists=docs.has(reference.path),observedData=observedExists?clone(docs.get(reference.path)):undefined;
  return {id:reference.id,ref:reference,exists:()=>observedExists,data:()=>observedExists?clone(observedData):undefined};
 };
 const directRows=collectionRef=>[...docs].filter(([key])=>key.startsWith(collectionRef.path+'/')&&
  !key.slice(collectionRef.path.length+1).includes('/')).map(([key])=>snap(ref(...key.split('/')))).slice(0,collectionRef.limit??Infinity);
 const writes=[],popupProviders=[],authCalls=[],queries=[],network=[];let batchCommits=0,transactionCalls=0;
 const normalize=value=>Object.fromEntries(Object.entries(value).map(([key,item])=>[key,item?.__serverTimestamp?{toMillis:()=>1234}:item]));
 const apply=(operation)=>{
  if(operation.type==='set'){docs.set(operation.ref.path,normalize(clone(operation.value)));if(operation.ref.path===rootPath)writes.push(clone(docs.get(rootPath)));}
  else if(operation.type==='update')docs.set(operation.ref.path,{...(docs.get(operation.ref.path)||{}),...normalize(clone(operation.value))});
  else docs.delete(operation.ref.path);
 };
 const F={
  getFirestore:()=>({}),doc:(_db,...parts)=>ref(...parts),collection:(_db,...parts)=>ref(...parts),
  query:(reference,...constraints)=>({...reference,...Object.assign({},...constraints)}),limit:limit=>({limit}),
  getDoc:async reference=>{if(reference.path===rootPath&&docs.get(rootPath)?.schemaVersion===2&&failures.stampPending)return failures.stampPending;if(reference.path===rootPath&&failures.pullPending)return failures.pullPending;if(reference.path===rootPath&&failures.pull)throw failures.pull;return snap(reference);},getDocs:async collectionRef=>{queries.push(collectionRef.path);return {docs:directRows(collectionRef)};},
  serverTimestamp:()=>({__serverTimestamp:true}),
  runTransaction:async(_db,fn)=>{transactionCalls++;await failures.beforeTransaction?.(docs);if(failures.pushPending)return failures.pushPending;if(failures.push)throw failures.push;const operations=[],tx={get:async reference=>{await failures.transactionRead?.(reference.path,docs);return snap(reference);},set:(reference,value)=>operations.push({type:'set',ref:reference,value}),update:(reference,value)=>operations.push({type:'update',ref:reference,value}),delete:reference=>operations.push({type:'delete',ref:reference})};const result=await fn(tx);if(failures.publishPending&&operations.some(op=>op.ref.path===rootPath)){failures.publicationStarted=true;await failures.publishPending;}for(const operation of operations){if(failures.enforceDeletingTransition&&operation.type==='update'&&operation.value.state==='deleting'&&docs.get(operation.ref.path)?.state==='deleting')throw Object.assign(Error('rules reject deleting to deleting'),{code:'permission-denied'});apply(operation);}await failures.afterTransaction?.(docs);return result;},
  writeBatch:()=>{const operations=[];return {set:(reference,value)=>operations.push({type:'set',ref:reference,value}),delete:reference=>operations.push({type:'delete',ref:reference}),async commit(){batchCommits++;if(batchCommits===batchFailureAt)throw Object.assign(Error('batch unavailable'),{code:'unavailable'});for(const operation of operations)apply(operation);}};},
 };
 const readDoc=F.getDoc,readDocs=F.getDocs;
 F.getDoc=async reference=>failures.cacheMiss?{exists:()=>false}:readDoc(reference);
 F.getDocFromServer=async reference=>{network.push('server:'+reference.path);if(failures.serverOffline)throw Object.assign(Error('offline'),{code:'unavailable'});await failures.serverRead?.(reference.path,docs);return readDoc(reference);};
 F.getDocsFromServer=async reference=>{network.push('server:'+reference.path);if(failures.serverOffline)throw Object.assign(Error('offline'),{code:'unavailable'});await failures.serverRead?.(reference.path,docs);return readDocs(reference);};
 F.disableNetwork=async()=>{network.push('disable');if(failures.disable)throw failures.disable;};
 F.enableNetwork=async()=>{network.push('enable');if(failures.enablePending)await failures.enablePending;};
 const subscriptions=[];
 F.onSnapshot=(reference,options,next,error)=>{
  const entry={reference,options,next,error,active:true};subscriptions.push(entry);
  return ()=>{entry.active=false;};
 };
 let authListener=null;
 const auth={currentUser:{uid:'owner',email:'owner@example.test'}},A={browserLocalPersistence:{},getAuth:()=>auth,setPersistence:async()=>{if(failures.persistence)throw failures.persistence;},
  signInWithPopup:async(_auth,provider)=>{popupProviders.push(provider);if(failures.signIn)throw failures.signIn;},signOut:async()=>{authCalls.push('signOut');if(failures.signOut)throw failures.signOut;},GoogleAuthProvider:class{setCustomParameters(value){this.customParameters=value;}},onAuthStateChanged(_auth,listener){authListener=listener;if(!failures.authPending)listener(auth.currentUser);}};
 const events=[],pending=new Map(),window=runtimeWindow||{FIREBASE_CONFIG:{apiKey:'test-key'},CLOUD_SYNC_TIMEOUT_MS:timeoutMs,dispatchEvent:event=>{events.push(event);return true;}};
 window.FIREBASE_CONFIG??={apiKey:'test-key'};window.CLOUD_SYNC_TIMEOUT_MS??=timeoutMs;window.window=window;
 if(recoveryTimeoutMs!==null)window.CLOUD_RECOVERY_READ_TIMEOUT_MS=recoveryTimeoutMs;
 if(runtimeWindow){
  const dispatchEvent=window.dispatchEvent?.bind(window);
  window.dispatchEvent=event=>{events.push(event);return dispatchEvent?dispatchEvent(event):true;};
 }else{
  window.ScannerDeviceStore={
   async getPendingUpload(account){return clone(pending.get(account)||null);},
   async setPendingUpload(account,value){pending.set(account,clone(value));return {ok:true};},
   async clearPendingUpload(account,generationId){if(pending.get(account)?.generationId!==generationId)return false;pending.delete(account);return true;},
  };
 }
 if(!runtimeWindow||recordSyncError!==undefined)window.recordSyncError=recordSyncError;
 const sdk=firebaseSDK?{...F,...firebaseSDK}:F;
 const context=vm.createContext({window,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},__cloudModules:[{initializeApp:()=>({})},A,sdk],
  console,crypto:cryptoProvider,TextEncoder,TextDecoder,Uint8Array,structuredClone,performance:timerProvider?.performance??performance,...(timerProvider?.Date?{Date:timerProvider.Date}:{}),setTimeout:timerProvider?.setTimeout??setTimeout,clearTimeout:timerProvider?.clearTimeout??clearTimeout});context.globalThis=context;
 for(const file of ['device-store-v2.js','cloud-store-v2.js'])vm.runInContext(artifacts?(file==='device-store-v2.js'?artifacts.storage:artifacts.cloud):fs.readFileSync(path.join(__dirname,file),'utf8'),context,{filename:file});
 if(!runtimeWindow)window.ChainStorageV2=context.ChainStorageV2;window.ChainCloudV2=context.ChainCloudV2;
 await vm.runInContext(`(async()=>{${moduleSource}\n})()`,context,{filename:'index.html#cloud-v2-backend'});
 return {CS:window.CloudSync,sdk,auth,docs,pending,events,batchCommits,writes,popupProviders,authCalls,transactionCalls,queries,network,subscriptions,
  emitSnapshot(entry,data,{fromCache=false,hasPendingWrites=false}={}){entry.next({exists:()=>data!==null,data:()=>clone(data),metadata:{fromCache,hasPendingWrites}});},
  emitAuth(user){auth.currentUser=user;authListener?.(user);}};
}

// These two conformance consumers control native crypto delivery, independently
// retaining a real short-deadline negative control; default loader timing is unchanged.
function cloudAdapterCryptoGate(){
 const entered=deferredSyncFixture(),release=deferredSyncFixture(),trace=[],start=performance.now();let digests=0;
 return {entered:entered.promise,release:release.resolve,trace,provider:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),randomUUID:webcrypto.randomUUID.bind(webcrypto),subtle:{async digest(...args){
  trace.push({event:'digest-enter',elapsed:performance.now()-start,bytes:args[1].byteLength});
  // The first payload hash precedes cloudDeadline; the snapshot hash is inside it.
  if(++digests===2){entered.resolve();await release.promise;}
  const result=await webcrypto.subtle.digest(...args);trace.push({event:'digest-delivered',elapsed:performance.now()-start});return result;
 }}}};
}
async function releaseCloudAdapterCryptoAfterDeadline(app,gate,t){
 await gate.entered;
 const negativeGate=cloudAdapterCryptoGate(),negative=await loadCloudBackend({timeoutMs:25,cryptoProvider:negativeGate.provider});t.after(()=>{gate.release();negativeGate.release();});
 const started=performance.now(),deadline=negative.CS.push('{}',1,4);await negativeGate.entered;
 const expired=await deadline;
 assert.equal(expired.error,true,'the independent real25ms deadline rejects a still-undelivered native digest');
 assert.equal(negative.CS.errorStage,'push');assert.equal(negative.CS.errorCode,'deadline-exceeded');assert.equal(negative.writes.length,0);
 assert.equal(negative.getStored().data.rev,4,'the timeout control never publishes its pending snapshot');
 assert.equal(negativeGate.trace.filter(row=>row.event==='digest-delivered').length,1,'the timed operation is still awaiting the second native digest');
 assert.equal(app.writes.length,0,'the original conformance source also remains unpublished while crypto is held');
 assert.equal(gate.trace.filter(row=>row.event==='digest-delivered').length,1,'the original assertion cannot run on a delivered crypto operation yet');
 const observation={deadlineMs:25,elapsed:performance.now()-started,negative:{stage:negative.CS.errorStage,code:negative.CS.errorCode,writes:negative.writes.length},original:{stage:app.CS.errorStage,code:app.CS.errorCode,writes:app.writes.length},originalTrace:[...gate.trace],negativeTrace:[...negativeGate.trace]};
 t.diagnostic(JSON.stringify(observation));
 negative.CS.suspend();negativeGate.release();gate.release();
 return observation;
}

function decodeManualArchiveTypedValue(node){
  assert.ok(node&&typeof node.type==='string','each archived value has an explicit type tag');
  switch(node.type){
    case 'null':return null;
    case 'boolean':case 'string':case 'number':return node.value;
    case 'special-number':return node.value==='NaN'?NaN:node.value==='Infinity'?Infinity:node.value==='-Infinity'?-Infinity:-0;
    case 'undefined':return undefined;
    case 'bigint':return BigInt(node.value);
    case 'date':return node.valid?new Date(node.value):new Date(NaN);
    case 'object':{
      const value={};
      for(const [key,entry] of node.entries)Object.defineProperty(value,key,{value:decodeManualArchiveTypedValue(entry),enumerable:true,writable:true,configurable:true});
      return value;
    }
    case 'array':{
      const value=new Array(node.items.length);
      node.items.forEach((entry,index)=>{if(entry.type!=='hole')value[index]=decodeManualArchiveTypedValue(entry);});
      for(const [key,entry] of node.properties??[])Object.defineProperty(value,key,{value:decodeManualArchiveTypedValue(entry),enumerable:true,writable:true,configurable:true});
      return value;
    }
    case 'array-buffer':return Uint8Array.from(Buffer.from(node.base64,'base64')).buffer;
    case 'data-view':return new DataView(decodeManualArchiveTypedValue(node.buffer),node.byteOffset,node.byteLength);
    case 'typed-array':{
      const constructors={Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array};
      const Constructor=constructors[node.constructor];assert.ok(Constructor,'the archived typed-array constructor is supported');
      return new Constructor(decodeManualArchiveTypedValue(node.buffer),node.byteOffset,node.length);
    }
    case 'map':return new Map(node.entries.map(([key,value])=>[decodeManualArchiveTypedValue(key),decodeManualArchiveTypedValue(value)]));
    case 'set':return new Set(node.items.map(decodeManualArchiveTypedValue));
    default:assert.fail(`Unknown manual archive type ${node.type}`);
  }
}

const backupFileFixtures=new WeakMap();
async function loadBackupFileFixtureApp(options={}){
 const pending=new Set(),before=options.beforeStateReady;
 const app=await loadApp({...options,beforeStateReady(ctx,shim){
  const schedule=ctx.setTimeout,cancel=ctx.clearTimeout;
  // Observe the actual save producer. Do not cancel or manually invoke it:
  // Add's explicit persist does not consume its queued 350ms save callback.
  ctx.setTimeout=(fn,ms,...args)=>{
   if(ms!==350)return schedule(fn,ms,...args);
   let resolve,reject;const row={done:new Promise((yes,no)=>{resolve=yes;reject=no;})};
   row.done.catch(()=>{});
   row.timer=schedule(()=>{const result=fn(...args);return Promise.resolve(result).then(resolve,reject).finally(()=>pending.delete(row));},ms);
   row.cancel=()=>{pending.delete(row);resolve();};pending.add(row);return row.timer;
  };
  ctx.clearTimeout=timer=>{cancel(timer);for(const row of pending)if(row.timer===timer)row.cancel();};
  before?.(ctx,shim);
 }});
 backupFileFixtures.set(app.ctx,{app,pending});return app;
}
async function prepareBackupFileFixtureSource(context,cloud=null){
 const fixture=backupFileFixtures.get(context.ctx||context);assert.ok(fixture,'file fixture must observe its real save producers');
 const {app,pending}=fixture;
 if(cloud){app.ctx.cloudPull();app.ctx.cloudPushNow();await settleSavedViewPublication(app,cloud,'File fixture source');}
 else assert.equal(await app.ctx.persist(),true,'fixture board is durably accepted');
 let timer;
 try{
  await Promise.race([(async()=>{while(pending.size)await Promise.all([...pending].map(row=>row.done));})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('file fixture save producer did not complete')),8000);})]);
 }finally{clearTimeout(timer);}
 if(cloud){
  await settleSavedViewPublication(app,cloud,'File fixture after queued save');
  assert.equal(app.ctx.state.syncAccount,app.shim.window.CloudSync.user,'fixture board belongs to the reconciled signed-in account');
  assert.equal(vm.runInContext('reconciled()&&!cloudAdoptionHeld&&!deferredCloudPull',app.ctx),true,'fixture reconciliation and source adoption are settled');
 }
 const raw=JSON.stringify(app.ctx.state),head=await app.ctx.window.ScannerDeviceStore.readHead();
 assert.equal(head?.payload,raw,'fixture source is the exact accepted durable board');
 assert.equal(head?.hash,vm.runInContext('deviceHeadHash',app.ctx),'fixture source commit acknowledgement is complete');
}

const syncTask = (id, title) => ({
  id, title, url: null, due: null, evergreen: false, ctx: [],
  mu: 25, sigma: 25 / 3, done: false, createdAt: 1, completedAt: null, lastDoneAt: null,
});

/* A complete, valid saved state — the shape loadState() reads off disk and
   the shape a remote payload carries. `passStartedAt: 0` keeps the boot-time
   stale-pass recycle out of these tests; it isn't what's under test here. */
const syncState = (over = {}) => Object.assign({
  v: 1, tasks: [], contexts: [], chain: [], considered: {}, cantAt: {}, workedAt: {},
  candidateId: null, workLog: [], interventionActive: false, interventionP: 0, snooze: 0,
  mode: "scan", decisionsMs: [], presentedAt: 0, passStartedAt: 0,
  listOpen: false, ctxOpen: true, histOpen: false, seenQuickStart: true, updatedAt: 0,
  settings: { horizonMin: 60, thresholdPct: 25, samples: 250, cantMin: 30, workedHours: 8, theme: "system" },
}, over);

async function saveEditorChoice(app,id,at,changes={}){
 const task=app.ctx.state.tasks.find(row=>row.id===id);
 assert.ok(task,`normal editor action has task ${id}`);
 setFakeTime(app.ctx,at);app.ctx.openEdit(id);
 app.shim.document.getElementById('etEverReset').checked=task.evergreenResetAtDay!==false;
 const value=(key,fallback)=>Object.hasOwn(changes,key)?changes[key]:fallback;
 fillEditPane(app.ctx,app.shim,{title:value('title',task.title),url:value('url',task.url||''),due:value('due',task.due||''),
  start:value('startsAt',task.startsAt||''),evergreen:task.evergreen,ctxIds:value('ctxIds',task.ctx)});
 app.ctx.onAction('save-edit',{dataset:{id}});
 return app.ctx.persist();
}

// #2232: pins the app realm's whole clock. new Date() and Date.now() both read
// `at` (the app's "today" comes from new Date()), explicit dates are unchanged,
// and the outer process's Date is untouched. A fixture whose dates sit "a few
// days ahead" of a pinned clock passes on any real date.
function pinAppClock(sandbox,at){
 vm.runInContext(`(()=>{const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){if(args.length)super(...args);else super(${Number(at)});}static now(){return ${Number(at)};}};})()`,sandbox);
}
// Both clock loaders install their pin after the app script runs and before its
// state is ready. loadAppAtTime pins Date.now() only (new Date() still reads the
// real clock); loadAppPinningNewDate also pins new Date(), which the app's
// "today" reads.
function loadAppWithClock(pin,at,options={}){
 const original=options.beforeStateReady;
 return loadApp({...options,beforeStateReady(ctx,shim){pin(ctx,at);original?.(ctx,shim);}});
}
function loadAppPinningNewDate(at,options={}){ return loadAppWithClock(pinAppClock,at,options); }

function loadAppAtTime(at,options={}){ return loadAppWithClock(setFakeTime,at,options); }

function hydrateUnchangedEditorDraft(app,id){
 const task=app.ctx.state.tasks.find(row=>row.id===id);
 assert.ok(task,`normal editor action has task ${id}`);
 app.ctx.openEdit(id);
 fillEditPane(app.ctx,app.shim,{title:task.title,url:task.url||'',due:task.due||'',start:task.startsAt||'',
  evergreen:task.evergreen,ctxIds:task.ctx});
 app.shim.document.getElementById('etEverReset').checked=task.evergreenResetAtDay!==false;
 return task;
}

/* The weeks-old copy sitting in the stale browser. */
const STALE_CHAIN = ["t_old"];
const staleState = (updatedAt) => syncState({
  tasks: [syncTask("t_old", "Something from last month")],
  chain: STALE_CHAIN.slice(), updatedAt,
});

/* The chain built up over today's work, living in the cloud. */
const CLOUD_CHAIN = ["t_day_a", "t_day_b", "t_day_c"];
const cloudState = (updatedAt) => syncState({
  tasks: [syncTask("t_day_a", "Draft the chapter"), syncTask("t_day_b", "Call the bank"), syncTask("t_day_c", "Fix the gate")],
  chain: CLOUD_CHAIN.slice(), updatedAt,
});

/* A CloudSync double with a real backing document, so a test can assert what
   actually survives in the cloud rather than which methods were called.
   pull() mirrors the module's contract: a well-formed {payload, updatedAt}
   when the document exists, {empty:true} when it provably does not, and
   {error:true} when the read failed and we therefore know nothing. */
function makeSyncHarness({ delayMs = 4, remote = null, failPull = false, rev = null } = {}) {
  const h = {
    doc: remote
      ? { payload: JSON.stringify(remote), updatedAt: remote.updatedAt, ...(rev === null ? {} : { rev }) }
      : null,
    failPull,
    calls: [],
    conflicts: 0,
    remoteState() { return h.doc ? JSON.parse(h.doc.payload) : null; },
    remoteChain() { const s = h.remoteState(); return s ? s.chain : null; },
    remoteTitles() { const s = h.remoteState(); return s ? s.tasks.map((t) => t.title) : null; },
    // Stands in for another device writing behind this one's back.
    writeBehindBack(state) {
      h.doc = { payload: JSON.stringify(state), updatedAt: state.updatedAt,
                rev: (h.doc && h.doc.rev ? h.doc.rev : 0) + 1 };
    },
    factory: () => ({
      configured: true, ready: true, user: "e@example.com", status: "ok",
      signIn() {}, signOut() {},
      async pull() {
        h.calls.push("pull");
        await new Promise((r) => setTimeout(r, delayMs));
        if (h.failPull) return { error: true };
        return h.doc ? { ...h.doc } : { empty: true };
      },
      // Mirrors the module's conditional write: the transaction refuses to
      // overwrite a revision the caller never read.
      async push(payload, updatedAt, baseRev) {
        h.calls.push("push");
        await new Promise((r) => setTimeout(r, delayMs));
        const cur = h.doc && h.doc.rev ? h.doc.rev : 0;
        if (h.doc && baseRev !== undefined && cur !== baseRev) { h.conflicts++; return { conflict: true, rev: cur }; }
        h.doc = { payload, updatedAt, rev: cur + 1 };
        return { ok: true, rev: cur + 1 };
      },
    }),
  };
  return h;
}

async function decisionRecoveryApp146(account='e@example.com'){
 const initial=syncState({tasks:[Object.assign(syncTask('bench','Recovery benchmark'),{mu:35,sigma:7}),syncTask('candidate','Recovery candidate'),Object.assign(syncTask('peer','Peer task'),{done:true,completedAt:100})],chain:['bench'],candidateId:'candidate',considered:{},mode:'scan',scanMode:'descending',passStartedAt:Date.now(),passId:'recovery-pass-146',settings:{thresholdPct:0,horizonMin:60,samples:250},syncRev:4,syncAccount:account,syncDirty:false});
 const h=makeSyncHarness({remote:initial,rev:4,delayMs:1});
 const storage=sharedScannerStorage({[SYNC_STORE_KEY]:JSON.stringify(initial),[LOCAL_HEAD_KEY]:JSON.stringify(initial)});
 const app=await loadApp({sharedStorage:storage,cloudSyncFactory:()=>{const CS=h.factory();CS.user=account;return CS;}});
 await app.ctx.cloudPull();await syncSettle(15);
 app.ctx.window.CloudSync.ready=false;
 app.ctx.renderScan();assert.match(app.shim.document.getElementById('scan').innerHTML,/data-act="no"/);
 app.ctx.onAction('no',{dataset:{candidate:'candidate',benchmark:'bench'}});
 assert.equal(await app.ctx.persist(),true);
 assert.equal(app.ctx.state.decisionEvents.length,1);
 return {...app,h,storage,event:JSON.parse(JSON.stringify(app.ctx.state.decisionEvents[0]))};
}

function mixedSharedOutcome146(board){
 return JSON.parse(JSON.stringify({theme:board.settings.theme,dateFormat:board.settings.dateFormat,
  scene:board.settings.scene,contexts:board.contexts}));
}
async function recordMixedDecisionActions146(app){
 const {ctx,shim}=app;
 ctx.onAction('cycle-theme',{});ctx.openSettings();
 const format=shim.document.getElementById('stDateFormat');format.id='stDateFormat';format.matches=()=>false;format.value='ymd';
 shim.document.dispatchEvent({type:'change',target:format});
 shim.document.getElementById('newCtxName').value='Mixed shared context';ctx.onAction('add-ctx-named',{});ctx.closeModal();
 shim.document.dispatchEvent({type:'landscape-scene-time-change',detail:{time:'sunset',season:'autumn'}});
 assert.deepEqual([...new Set(Array.from(ctx.state.decisionEvents).filter(event=>event.kind==='current-choice').map(event=>event.target.type))].sort(),['context','scene','setting'],'real preference/context producers coexist with comparison authority');
 const shared=mixedSharedOutcome146(ctx.state),yesTask=ctx.addTask('Mixed Yes candidate');
 ctx.renderScan();assert.equal(ctx.state.candidateId,yesTask.id,'the actual scanner offers the new Yes candidate');
 const benchmark=ctx.state.chain.at(-1);assert.match(shim.document.getElementById('scan').innerHTML,/data-act="yes"/);
 ctx.onAction('yes',{dataset:{candidate:yesTask.id,benchmark}});
 const dotTask=ctx.addTask('Mixed editor Dot candidate');hydrateUnchangedEditorDraft(app,dotTask.id);
 shim.document.getElementById('etTitle').value='Mixed compound title';ctx.onAction('dot-task',{dataset:{id:dotTask.id}});
 const dot=ctx.state.decisionEvents.find(event=>event.kind==='comparison'&&event.action==='dot');assert.ok(dot);
 const compound=ctx.state.decisionEvents.filter(event=>event.actionId===dot.actionId);assert.ok(compound.some(event=>event.kind==='current-choice'),'the actual editor Dot also retains its changed title');
 await ctx.onAction('undo',{});assert.equal(ctx.state.tasks.find(task=>task.id===dotTask.id).title,'Mixed editor Dot candidate');
 assert.deepEqual(Array.from(ctx.state.decisionEvents.find(event=>event.kind==='undo').targetEventIds).sort(),Array.from(compound,event=>event.id).sort(),'Undo targets the complete real editor/Dot gesture');
 ctx.renderScan();assert.equal(ctx.state.candidateId,dotTask.id,'the undone Dot is again the eligible offered candidate');
 const pauseControl=shim.document.getElementById('scan').innerHTML.match(/<button\b[^>]*data-act="start-working"[^>]*>/)?.[0];assert.ok(pauseControl,'the normal scanner shows its Pause control');assert.doesNotMatch(pauseControl,/disabled/,'Pause is enabled with the offered candidate');
 const beforePause=new Set(ctx.state.decisionEvents.map(event=>event.id));ctx.onAction('start-working',{});assert.equal(ctx.state.mode,'work');
 const pause=ctx.state.decisionEvents.find(event=>!beforePause.has(event.id)&&event.kind==='current-choice'&&event.target?.type==='pass'&&event.target.property==='mode');assert.ok(pause);assert.equal(pause.target.id,pause.passId);assert.equal(pause.value,'work');assert.deepEqual(JSON.parse(JSON.stringify(pause.before)),{present:true,value:'scan'});assert.equal(ctx.supportedDecisionEvent(pause),true);const originalPause=JSON.stringify(pause);
 assert.equal(await ctx.onAction('undo',{}),true);assert.equal(ctx.state.mode,'scan','ordinary Undo restores scanning without forcing a disabled Resume');
 const pauseUndo=ctx.state.decisionEvents.at(-1);assert.equal(pauseUndo.kind,'undo');assert.deepEqual(Array.from(pauseUndo.targetEventIds),[pause.id]);assert.equal(pauseUndo.targetActionId,pause.actionId);assert.equal(JSON.stringify(ctx.state.decisionEvents.find(event=>event.id===pause.id)),originalPause,'Pause keeps its exact original fact after cancellation');
 for(const id of [yesTask.id,benchmark]){assert.equal(ctx.state.chain.at(-1),id);ctx.onAction('dislodge',{dataset:{benchmark:id}});}
 assert.equal(ctx.state.chain.length,0,'real Dislodge actions make the Start control available');
 ctx.onAction('start-scan',{dataset:{mode:'halving'}});
 assert.ok(ctx.state.decisionEvents.some(event=>event.kind==='current-choice'&&event.target?.type==='pass'&&event.target.property==='chain'),'actual Start records its paired pass root');
 await ctx.onAction('undo',{});assert.equal(ctx.state.chain.length,0);assert.ok(ctx.state.decisionEvents.some(event=>event.kind==='undo'&&event.passBefore),'actual Start Undo retains exact prior-pass authority');
 hydrateUnchangedEditorDraft(app,benchmark);shim.document.getElementById('etTitle').value='Mixed retained benchmark title';ctx.onAction('save-edit',{dataset:{id:benchmark}});
 assert.equal(await ctx.persist(),true);assert.equal(ctx.decisionEvidenceIssue(ctx.state,'e@example.com'),null,'all new kinds coexist as coherent real-app authority');
 return {yesTaskId:yesTask.id,dotTaskId:dotTask.id,benchmark,shared,pauseEventId:pause.id,pauseUndoId:pauseUndo.id};
}
async function decisionMixedActionsApp146(){
 const app=await decisionRecoveryApp146();return {...app,mixed:await recordMixedDecisionActions146(app)};
}

const syncSettle = (ms) => new Promise((r) => setTimeout(r, ms));
const PAST_DEBOUNCE = 2300;   // longer than cloudPush()'s 2s debounce

/* =====================================================================
   HISTORY RECONCILE: TASK IDENTITY OUTRANKS DISPLAY TEXT

   The import path now blocks completed-title duplicates before creating
   them. Existing same-title tasks are ambiguous, though: Quick Add explicitly
   permits them, and deleting one after completion destroys real user data.
   reconcileHistory() therefore preserves completed task records and only
   sweeps impossible live references; same-day work sessions consolidate by
   taskId rather than title.
   ===================================================================== */

const doneTitles = (ctx) =>
  Array.from(ctx.state.tasks.filter((t) => t.done), (t) => t.title).sort();

// An ambiguous old shape: an import artifact and two deliberate tasks look identical here.
function seedDuplicateCompletion(ctx, title) {
  const a = ctx.addTask(title, false);
  ctx.completeTask(ctx.state.tasks.find((x) => x.id === a.id));
  const b = { ...ctx.state.tasks.find((x) => x.id === a.id), id: a.id + "_dupe" };
  ctx.state.tasks.push(b);
  return { first: a.id, second: b.id };
}

/* =====================================================================
   REGRESSION: DEVICE CLOCKS MUST NOT DECIDE WHO WINS

   Second incident: a laptop's older history replaced a phone's newer one,
   including task renames. state.updatedAt is stamped with Date.now() — the
   writing device's OWN clock — and the two sides were compared directly.
   A laptop running minutes or hours ahead therefore "wins" every reconcile
   no matter how stale its content is, and no amount of care around when we
   write fixes an ordering that was never trustworthy to begin with.

   The document now carries a revision counter the devices agree on, and
   each device remembers which revision its copy is based on. Ahead/behind
   is a question about revisions, not clocks. Writes are conditional on the
   revision the device actually read, so a push cannot overwrite a revision
   it never saw — which also closes the case of two devices pushing at once.
   ===================================================================== */

const renamedCloud = (rev, title) => cloudState(0 /* clock is irrelevant now */),
      titlesOf = (ctx) => Array.from(ctx.state.tasks, (t) => t.title);

/* =====================================================================
   HISTORY RECONCILE, PART 2: SAME-DAY "WORKED ON IT" REPEATS

   The first pass only collapsed duplicate completed *tasks*. The repeats
   actually showing up in History were workLog entries: "beat mafia 1
   definitive edition · worked on it · today" twice over, once at 7:38 AM
   and once at 5:29 PM. Both render as "today", which reads as a glitch.

   Crossing a task off with Worked on it holds it out of the scan for
   settings.workedHours (8 by default) and then lets it back in, so a
   second session later the same day is working exactly as designed —
   there is no mechanism bug here, only a log that records each session
   as its own row. One row per task per day is what History wants.

   Across days the repeats are real and stay: working on something Sunday
   AND Monday is two days of work, not a duplicate. Evergreen completions
   are exempt entirely, repeating daily being their whole point.
   ===================================================================== */

const workedLog = (ctx) =>
  Array.from(ctx.state.workLog.filter((e) => e.kind === "worked"), (e) => e.title + "@" + e.at);

// 8/31 7:38 AM and 5:29 PM local, the pair from the report.
const MORNING = new Date(2026, 7, 31, 7, 38).getTime();
const EVENING = new Date(2026, 7, 31, 17, 29).getTime();
const DAY_BEFORE = new Date(2026, 7, 30, 11, 2).getTime();

function seedWorkLog(ctx, entries) {
  ctx.state.workLog = entries.map((e, i) => ({ id: "w" + i, taskId: e.taskId || "t1", title: e.title, kind: e.kind || "worked", at: e.at }));
}

function moodRuntime() {
  const context = vm.createContext({ Date, Intl, Math, JSON });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-config.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(__dirname,'vendor/astronomy.min.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(__dirname, "landscape-mood.js"), "utf8"), context, {
    filename: "landscape-mood.js",
  });
  return context.LandscapeMood;
}

function atNoon(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`);
}

function hourLabel(hour) {
  return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
}

const nativeSource = html.slice(html.indexOf("async function installNative(){"), html.indexOf("function openSettings(){"));

async function runNativeInstall(promptEvent) {
  const calls = { prompt: 0, help: 0, close: 0, toasts: [] };
  const context = vm.createContext({
    deferredInstallPrompt: promptEvent,
    openInstallHelp() { calls.help++; },
    closeModal() { calls.close++; },
    toast(message) { calls.toasts.push(message); },
  });
  vm.runInContext(nativeSource + "\nthis.runNativeInstall = installNative;", context);
  context.deferredInstallPrompt.prompt = async () => {
    calls.prompt++;
    if (promptEvent.throwOnPrompt) throw new Error("withdrawn");
  };
  await context.runNativeInstall();
  return calls;
}

function loadSeasonalRepair(){
  const context=vm.createContext({Math,JSON});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-geometry.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-seasonal.js'),'utf8'),context,{filename:'landscape-seasonal.js'});
  return {context,seasonal:context.LandscapeSeasonal};
}

function seasonalRepairCanvas(){
  const ops=[];
  return {ops,g:{globalAlpha:1,fillStyle:'',strokeStyle:'',lineWidth:1,
    save(){ops.push(['save']);},restore(){ops.push(['restore']);},
    beginPath(){ops.push(['begin']);},closePath(){ops.push(['close']);},
    moveTo(...a){ops.push(['move',...a]);},lineTo(...a){ops.push(['line',...a]);},
    quadraticCurveTo(...a){ops.push(['quadratic',...a]);},bezierCurveTo(...a){ops.push(['bezier',...a]);},
    ellipse(...a){ops.push(['ellipse',...a]);},arc(...a){ops.push(['arc',...a]);},
    fill(){ops.push(['fill',this.fillStyle,this.globalAlpha]);},
    stroke(){ops.push(['stroke',this.strokeStyle,this.globalAlpha]);},
    fillRect(...a){ops.push(['rect',...a,this.fillStyle,this.globalAlpha]);},
  }};
}

const seasonalRepairPalette={sky:['#8ed4f3','#d4f5f2','#f6fbe2'],front:'#8dcca1',hill:'#ace097',city:'#bbdce1',night:0};
const seasonalRepairNight={...seasonalRepairPalette,night:1};
const seasonalRepairWeather={status:'clear',intensity:0,storm:false};
const seasonalRepairRain={status:'rain',intensity:1,storm:false};
const seasonalRepairStorm={status:'thunderstorm',intensity:1,storm:true};
const seasonalRepairSnow={status:'snow',intensity:1,storm:false};
const seasonalRepairSnowstorm={status:'snowstorm',intensity:1,storm:true};
function seasonalEnvelopeRuntime(){
  const context=vm.createContext({Math,JSON});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-geometry.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'landscape-seasonal.js'),'utf8'),context,{filename:'landscape-seasonal.js'});
  return context.LandscapeSeasonal;
}
function chanceProbabilityFixture(fields){return {title:fields.id,ctx:[],...fields};}
function pwaUpdateHarness({controller=true,editing=false,saveOK=true,durable=false,host=false}={}){
 const wh={},dh={},sh={};let updates=0,reloads=0,saves=0,options;const toasts=[];
 const registration={update:async()=>{updates++;}};
 const sw={controller:controller?{}:null,addEventListener:(e,f)=>sh[e]=f,register:async(url,opts)=>{options=opts;return registration;}};
 const doc={hidden:false,readyState:'complete',activeElement:{matches:()=>false},querySelector:()=>editing?{}:null,addEventListener:(e,f)=>dh[e]=f};
 const raw='{}',storage={getItem:key=>durable&&(key==='head'||key==='store')?raw:null};
 const box={navigator:{serviceWorker:sw},window:{addEventListener:(e,f)=>wh[e]=f,location:{reload:()=>reloads++}},document:doc,setTimeout,clearTimeout,state:{},scannerGestureActive:false,persist:async()=>{saves++;return saveOK;},toast:message=>toasts.push(message),console,
  storageOK:true,useLocal:durable&&!host,lastPersistedRaw:durable?raw:null,localStorage:storage,LOCAL_HEAD_KEY:'head',STORE_KEY:'store'};
 const source=html.slice(html.indexOf('function hasActiveEditor(){'),html.indexOf('function resumeDeferredCloudPull(){'))+html.slice(html.indexOf('function registerServiceWorker(){'),html.indexOf('registerServiceWorker();',html.indexOf('function registerServiceWorker(){')));
 vm.runInNewContext(source+';registerServiceWorker();',box);
 return {box,sw,wh,dh,sh,ready:async()=>{if(wh.load)await wh.load();await flush();},counts:()=>({updates,reloads,saves,options,toasts}),edit:v=>editing=v};
}

const updateNoticeKey='fvp:chain-scanner:last-notified-release';
const releaseMarkup=html.match(/<template id="appChangelogCurrent">([\s\S]*?)<\/template>/)[1];
const releaseFingerprint=releaseMarkup.match(/data-app-fingerprint="([^"]+)"/)[1];
function prepareReleaseNotice(ctx,shim){shim.document.getElementById('appChangelogCurrent').innerHTML=releaseMarkup;}

// USNO one-day API reference observations retrieved 2026-09-19; no runtime network dependency.
const SOLAR_AUDIT_FIXTURES = [
  {
    "name": "London",
    "latitude": 51.5,
    "longitude": -0.12,
    "timezone": "Europe/London",
    "date": "2026-09-19",
    "offset": 1,
    "source": "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-09-19&coords=51.5,-0.12&tz=1",
    "firstLight": "06:08",
    "rise": "06:42",
    "set": "19:06",
    "lastLight": "19:39"
  },
  {
    "name": "Orlando",
    "latitude": 28.5383,
    "longitude": -81.3792,
    "timezone": "America/New_York",
    "date": "2026-06-21",
    "offset": -4,
    "source": "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-06-21&coords=28.5383,-81.3792&tz=-4",
    "firstLight": "06:02",
    "rise": "06:29",
    "set": "20:26",
    "lastLight": "20:53"
  },
  {
    "name": "Sydney",
    "latitude": -33.87,
    "longitude": 151.21,
    "timezone": "Australia/Sydney",
    "date": "2026-12-21",
    "offset": 11,
    "source": "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-12-21&coords=-33.87,151.21&tz=11",
    "firstLight": "05:11",
    "rise": "05:41",
    "set": "20:05",
    "lastLight": "20:35"
  },
  {
    "name": "New York DST",
    "latitude": 40.71,
    "longitude": -74.01,
    "timezone": "America/New_York",
    "date": "2026-03-08",
    "offset": -4,
    "source": "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-03-08&coords=40.71,-74.01&tz=-4",
    "firstLight": "06:52",
    "rise": "07:19",
    "set": "18:55",
    "lastLight": "19:23"
  },
  {
    "name": "Kathmandu",
    "latitude": 27.72,
    "longitude": 85.32,
    "timezone": "Asia/Kathmandu",
    "date": "2026-03-20",
    "offset": 5.75,
    "source": "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-03-20&coords=27.72,85.32&tz=5.75",
    "firstLight": "05:45",
    "rise": "06:08",
    "set": "18:15",
    "lastLight": "18:38"
  },
  {
    "name": "Kiritimati",
    "latitude": 1.87,
    "longitude": -157.43,
    "timezone": "Pacific/Kiritimati",
    "date": "2026-01-01",
    "offset": 14,
    "source": "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-01-01&coords=1.87,-157.43&tz=14",
    "firstLight": "06:10",
    "rise": "06:32",
    "set": "18:34",
    "lastLight": "18:56"
  },
  {
    "name": "Tromso winter",
    "latitude": 69.65,
    "longitude": 18.96,
    "timezone": "Europe/Oslo",
    "date": "2026-12-21",
    "offset": 1,
    "source": "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-12-21&coords=69.65,18.96&tz=1",
    "firstLight": "09:31",
    "rise": null,
    "set": null,
    "lastLight": "13:53"
  },
  {
    "name": "Tromso summer",
    "latitude": 69.65,
    "longitude": 18.96,
    "timezone": "Europe/Oslo",
    "date": "2026-06-21",
    "offset": 2,
    "source": "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-06-21&coords=69.65,18.96&tz=2",
    "firstLight": null,
    "rise": null,
    "set": null,
    "lastLight": null
  }
];

function changeQuickEvergreen(shim,id,value,type='change'){
 shim.document.getElementById('addEverHours').id='addEverHours';
 const field=shim.document.getElementById(id);Object.assign(field,{id,value,matches:()=>false});
 shim.document.dispatchEvent({type,target:field});
 return field;
}

function releaseGateGit(repo,args){
 const result=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});
 assert.equal(result.status,0,'git '+args.join(' ')+' failed: '+result.stderr);
 return result.stdout.trim();
}
function releaseGateHash(file){
 return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function releaseGateCanonicalJson(value){
 if(Array.isArray(value))return '['+value.map(releaseGateCanonicalJson).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+releaseGateCanonicalJson(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
function releaseGateReseal(receipt){
 const {receiptSha256,...payload}=receipt;
 receipt.receiptSha256=createHash('sha256').update(releaseGateCanonicalJson(payload)).digest('hex');
 return receipt;
}
function makeReleaseGateFixture(options={}){
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR||'/tmp','funsidething-release-gate-'));
 const repo=path.join(root,'repo');
 fs.mkdirSync(repo);
 const init=spawnSync('git',['init','--quiet',repo],{encoding:'utf8'});
 assert.equal(init.status,0,init.stderr);
 releaseGateGit(repo,['config','user.name','Release Owner']);
 releaseGateGit(repo,['config','user.email','release-owner@example.test']);
 releaseGateGit(repo,['remote','add','origin','https://github.com/emerald-pham/funsidething.git']);
 const changedPath=options.changedPath||'app.js';
 const changedFile=path.join(repo,changedPath);
 fs.mkdirSync(path.dirname(changedFile),{recursive:true});
 fs.writeFileSync(changedFile,options.baseText??'const value = 1;\n');
 releaseGateGit(repo,['add','--all']);
 releaseGateGit(repo,['commit','-m','Create release base']);
 const baseSha=releaseGateGit(repo,['rev-parse','HEAD']);
 fs.writeFileSync(changedFile,options.candidateText??'const value = 2;\n');
 releaseGateGit(repo,['add','--all']);
 releaseGateGit(repo,['commit','-m','Change release behavior']);
 const candidateSha=releaseGateGit(repo,['rev-parse','HEAD']);
 const treeSha=releaseGateGit(repo,['rev-parse',candidateSha+'^{tree}']);
 const sourcePath=path.join(root,'MEMORY.md');
 const memoryEvidencePath=path.join(root,'memory-audit.md');
 const reviewEvidencePath=path.join(root,'independent-review.md');
 const ownerEvidencePath=path.join(root,'owner-review.md');
 const codeEvidencePath=path.join(root,'code-review.md');
 const specialistEvidencePath=path.join(root,'specialist-review.md');
 fs.writeFileSync(sourcePath,'Memory source snapshot\n');
 fs.writeFileSync(memoryEvidencePath,'Audited memory sources against current project behavior.\n');
 fs.writeFileSync(reviewEvidencePath,'Reviewed the full diff, tests, and user-visible and data-safety effects.\n');
 fs.writeFileSync(ownerEvidencePath,'The owner inspected the exact candidate diff and found no unaddressed issue.\n');
 fs.writeFileSync(codeEvidencePath,'The independent reviewer inspected the full diff, tests, and user impact.\n');
 fs.writeFileSync(specialistEvidencePath,'The specialist inspected the affected risk domain and focused tests.\n');
 return {root,repo,baseSha,candidateSha,treeSha,changedPath,sourcePath,memoryEvidencePath,reviewEvidencePath,
  ownerEvidencePath,codeEvidencePath,specialistEvidencePath};
}
function releaseGateInput(fixture,overrides={}){
 const now=new Date().toISOString();
 const input={
  schemaVersion:1,
  candidate:{commitSha:fixture.candidateSha,treeSha:fixture.treeSha,baseSha:fixture.baseSha},
  ownerTask:'/root/release-owner',
  memoryAudit:{task:'/root/memory-auditor',outcome:'pass',completedAt:now,
   scope:{
    memory:{affected:false,rationale:'This fixture changes no memory-dependent behavior.',tests:[]},
    cloud:{affected:false,rationale:'This fixture changes no cloud data or account path.',tests:[]},
    sync:{affected:false,rationale:'This fixture changes no synchronization or reconciliation path.',tests:[]}
   },
   sources:[{path:fixture.sourcePath,sha256:releaseGateHash(fixture.sourcePath)}],
   evidencePath:fixture.memoryEvidencePath,evidenceSha256:releaseGateHash(fixture.memoryEvidencePath)},
  independentReview:{task:'/root/exact-final-review',outcome:'approved',reviewedSha:fixture.candidateSha,completedAt:now,
   summary:'Reviewed the full diff, relevant tests, and user-visible and data-safety effects.',
   scope:{fullDiff:true,relevantTests:true,userVisibleAndDataSafety:true},
   evidencePath:fixture.reviewEvidencePath,evidenceSha256:releaseGateHash(fixture.reviewEvidencePath)}
 };
 return {...input,...overrides,
  candidate:{...input.candidate,...overrides.candidate},
  memoryAudit:{...input.memoryAudit,...overrides.memoryAudit},
  independentReview:{...input.independentReview,...overrides.independentReview}};
}
function cleanupReleaseGateFixture(fixture){
 fs.rmSync(fixture.root,{recursive:true,force:true});
}

function riskBasedReleaseInput(fixture,options={}){
 const now=new Date().toISOString();
 const input={
  schemaVersion:2,
  candidate:{commitSha:fixture.candidateSha,treeSha:fixture.treeSha,baseSha:fixture.baseSha},
  ownerReview:{task:'/root/release-owner',outcome:'approved',reviewedSha:fixture.candidateSha,
   completedAt:now,summary:'The owner inspected the exact final diff and checked for unaddressed issues.',
   scope:{fullDiff:true,rationale:'The owner checked every changed path against the release review policy.'},
   evidencePath:fixture.ownerEvidencePath,evidenceSha256:releaseGateHash(fixture.ownerEvidencePath)}
 };
 if(options.codeReview!==false)input.independentReview={task:'/root/exact-code-review',outcome:'approved',
  reviewedSha:fixture.candidateSha,completedAt:now,
  summary:'The independent reviewer inspected the full diff, relevant tests, and user-visible effects.',
  scope:{fullDiff:true,relevantTests:true,userVisibleAndDataSafety:true},
  evidencePath:fixture.codeEvidencePath,evidenceSha256:releaseGateHash(fixture.codeEvidencePath)};
 if(options.specialistReview!==false){
  const specialistDomains=options.domains||['memory-cloud-sync'];
  const affectsMemoryCloudSync=specialistDomains.includes('memory-cloud-sync');
  input.specialistReview={task:'/root/exact-specialist-review',outcome:'approved',
  reviewedSha:fixture.candidateSha,completedAt:now,domains:specialistDomains,
  summary:'The specialist reviewed the affected domain, failure modes, and focused tests.',
  scope:{fullDiff:true,relevantTests:true,userVisibleAndDataSafety:true},
  memoryScope:{
   memory:{affected:false,rationale:'This candidate does not change saved device memory behavior.',tests:[]},
   cloud:{affected:affectsMemoryCloudSync,rationale:'This candidate changes a cloud-related implementation path.',
    tests:affectsMemoryCloudSync?['RISK repository process: risk-based receipts require the derived exact-final reviewer roles']:[]},
   sync:{affected:affectsMemoryCloudSync&&fixture.changedPath.includes('sync'),
    rationale:'This candidate changes synchronization only when its exact changed path is sync-related.',
    tests:affectsMemoryCloudSync&&fixture.changedPath.includes('sync')
     ?['RISK repository process: risk-based receipts require the derived exact-final reviewer roles']:[]}
  },
  sources:[{path:fixture.sourcePath,sha256:releaseGateHash(fixture.sourcePath)}],
  evidencePath:fixture.specialistEvidencePath,evidenceSha256:releaseGateHash(fixture.specialistEvidencePath)};
 }
 return {...input,...options.input,
  candidate:{...input.candidate,...options.input?.candidate},
  ownerReview:{...input.ownerReview,...options.input?.ownerReview},
  ...(input.independentReview?{independentReview:{...input.independentReview,...options.input?.independentReview}}:{}),
  ...(input.specialistReview?{specialistReview:{...input.specialistReview,...options.input?.specialistReview}}:{})};
}

// Checks over every test read the whole test surface, not one file: every file
// in the per-area tests/ directory (#2213), shared helpers included. A root
// tests.js is rejected by the test-first gate, so it is not read.
function testSurfaceSource(root=__dirname){
 const directory=path.join(root,'tests');
 const files=fs.readdirSync(directory).filter(file=>file.endsWith('.js')).sort().map(file=>path.join(directory,file));
 return files.map(file=>fs.readFileSync(file,'utf8')).join('\n');
}

function recoveringCloudStatusHarness(shim,ctx,{failedRetry=false,beforePushAck=null}={}){
 let pulls=0,pushes=0;
 let remotePayload=ctx.cloudPayload(),remoteRev=ctx.state.syncRev||0;
 const ping=()=>shim.window.dispatchEvent({type:'cloudsync'});
 const fail=(stage,code)=>{CS.status='error';CS.errorStage=stage;CS.errorCode=code;ping();};
 const succeed=()=>{CS.status='ok';CS.errorStage=null;CS.errorCode=null;ping();};
 const CS={configured:true,ready:true,user:'owner@example.test',status:'ok',errorStage:null,errorCode:null,
  signIn(){},signOut(){},
  reportError(stage,code){fail(stage,code)},
  async pull(){
   pulls++;CS.status='syncing';ping();await flush();
   if(failedRetry){fail('pull','unavailable');return {error:true};}
   succeed();return {payload:remotePayload,rev:remoteRev};
  },
  async push(payload,_updatedAt,baseRev){
   pushes++;CS.status='syncing';ping();await flush();
   if(beforePushAck)await beforePushAck(pushes);
   if(failedRetry){fail('push','permission-denied');return {error:true};}
   if(baseRev!==remoteRev){succeed();return {conflict:true,rev:remoteRev};}
   remotePayload=payload;remoteRev++;succeed();return {ok:true,rev:remoteRev};
  },
 };
 shim.window.CloudSync=CS;
 return {CS,fail,pulls:()=>pulls,pushes:()=>pushes,remote:()=>JSON.parse(remotePayload)};
}

const recentDeletionAt=Date.now();
function deletionEvidence(id,taskId,kind='task',at=recentDeletionAt,extra={}){
 return {id,taskId,kind,at,...extra};
}

function repeatedDeletionBoard(ctx){
 const counts=[32,384,768,768,3072,3072];
 const rows=counts.map((count,index)=>({count,row:deletionEvidence(
  `operation-${index}-00000000-0000-4000-8000-000000000000`,
  `task-${index}-00000000-0000-4000-8000-000000000000`,
  index%2?'history':'task',
  recentDeletionAt+index,
  {futureEvidence:{source:'sanitized-size-fixture',slot:index}}
 )}));
 const board=ctx.defaultState();
 board.seenQuickStart=true;board.syncDirty=true;
 ctx.hydrateState(board);
 board.deletionLog=rows.flatMap(({count,row})=>Array.from({length:count},()=>JSON.parse(JSON.stringify(row))));
 return {board,unique:rows.map(({row})=>row)};
}

function loadStorageV2({indexedDB}={}){
 const file=path.join(__dirname,'device-store-v2.js');
 assert.ok(fs.existsSync(file),'the scalable local/cloud storage module must ship with the offline app');
 const sandbox=vm.createContext({console,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,indexedDB,
  setTimeout,clearTimeout,structuredClone});
 sandbox.globalThis=sandbox;
 vm.runInContext(fs.readFileSync(file,'utf8'),sandbox,{filename:'device-store-v2.js'});
 assert.ok(sandbox.ChainStorageV2,'the storage module exposes its browser API');
 return sandbox.ChainStorageV2;
}

function loadCloudV2(){
 const sandbox=vm.createContext({console,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout,structuredClone});
 sandbox.globalThis=sandbox;
 for(const file of ['device-store-v2.js','cloud-store-v2.js']){
  assert.ok(fs.existsSync(path.join(__dirname,file)),'the scalable cloud module must ship with the offline app: '+file);
  vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),sandbox,{filename:file});
 }
 return sandbox.ChainCloudV2;
}

function cloudV2Payload(label='large'){
 return JSON.stringify({tasks:Array.from({length:3600},(_,index)=>({id:`${label}-${index}`,
  title:`${label} ${index} 😀 ${'recoverable '.repeat(32)}`,done:false})),settings:{future:{kept:true}}});
}

function cloudV2Adapter(){
 const roots=new Map(),generations=new Map();let crashAfter=Infinity,crashed=false,beforePublish=null,onGenerationRead=null;
 const key=(uid,id)=>uid+'/'+id,clone=value=>value==null?value:structuredClone(value);
 const api={roots,generations,
  setCrashAfter(value){crashAfter=value;crashed=false},setBeforePublish(fn){beforePublish=fn},setGenerationRead(fn){onGenerationRead=fn},
  async readRoot(uid){return clone(roots.get(uid)||null)},
  async beginGeneration(uid,id,header){const k=key(uid,id),existing=generations.get(k);if(existing)return clone(existing.header);generations.set(k,{header:clone(header),chunks:new Map()});return clone(header)},
  async readGeneration(uid,id){if(onGenerationRead){const fn=onGenerationRead;onGenerationRead=null;await fn({uid,id,api});}return clone(generations.get(key(uid,id))?.header||null)},
  async readChunks(uid,id){return [...(generations.get(key(uid,id))?.chunks.values()||[])].sort((a,b)=>a.index-b.index).map(clone)},
  async writeChunks(uid,id,chunks){const generation=generations.get(key(uid,id));if(!generation)throw Error('missing generation');for(const chunk of chunks){
   if(!crashed&&generation.chunks.size>=crashAfter){crashed=true;throw Error('simulated upload crash');}
   const old=generation.chunks.get(chunk.index);if(old&&JSON.stringify(old)!==JSON.stringify(chunk))throw Error('immutable chunk mismatch');if(!old)generation.chunks.set(chunk.index,clone(chunk));
  }},
  async sealGeneration(uid,id,header){const generation=generations.get(key(uid,id));if(!generation)throw Error('missing generation');generation.header={...clone(header),state:'sealed'};return clone(generation.header)},
  async publishGeneration(uid,id,{baseRev,updatedAt,stillCurrent}){if(beforePublish)await beforePublish();if(stillCurrent&&!stillCurrent())return {cancelled:true};const generation=generations.get(key(uid,id));const current=roots.get(uid)||null,rev=current?.rev||0;if(generation?.header.state!=='sealed')return {error:true,code:'unsealed'};if(rev!==baseRev)return {conflict:true,rev};const root={schemaVersion:2,rev:rev+1,activeGeneration:id,previousGeneration:current?.activeGeneration||null,updatedAt};generation.header={...generation.header,state:'published',publishedAt:Date.now()};roots.set(uid,root);return {ok:true,rev:root.rev,root:clone(root)}},
  async listGenerations(uid){return [...generations].filter(([k])=>k.startsWith(uid+'/')).map(([k,value])=>({id:k.slice(uid.length+1),...clone(value.header)}))},
  async markDeleting(uid,id,protectedIds=[]){const root=roots.get(uid),generation=generations.get(key(uid,id));if(!generation||root?.activeGeneration===id||root?.previousGeneration===id||protectedIds.includes(id))return false;generation.header={...generation.header,state:'deleting'};return true},
  async deleteChunks(uid,id){const generation=generations.get(key(uid,id));if(generation?.header.state!=='deleting')throw Error('generation is not deleting');generation.chunks.clear()},
  async deleteGeneration(uid,id){const k=key(uid,id),generation=generations.get(k);if(generation?.header.state!=='deleting'||generation.chunks.size)throw Error('generation is not empty');generations.delete(k)},
 };
 return api;
}

// #2225 (spec #2224): a board shaped like the owner's large board, generated
// with no real data. The measured board had 447 tasks, rating histories
// averaging about 2.4 KB per task and reaching about 58 KB, 368 decision events
// averaging about 0.75 KB and reaching about 78 KB, about 2.4 MB serialized.
// The fixture is at least that large on every measure. Its baseline, pass and
// event shapes come from the real app's own scan actions, so the app accepts
// its decision evidence as coherent and opens it on the ordinary path instead
// of a recovery one; the bulk is then filled to size from those real shapes.
// #2227 and #2228 reuse largeBoardFixture() for the recovery memory tests.
const LARGE_BOARD_SHAPE=Object.freeze({tasks:447,decisionEvents:368,historyMeanBytes:2400,historyMaxBytes:58000,
 eventMeanBytes:750,eventMaxBytes:78000,serializedBytes:2400000});
let largeBoardFixturePromise=null;
function largeBoardFixture(){return largeBoardFixturePromise||=buildLargeBoardFixture();}
// #2227: the same board with every decision made while signed in to account,
// as on the owner's phone. Decisions record their account and the baseline's
// identity derives from it, so it is built signed in rather than relabelled.
const largeSignedInBoardFixtures=new Map();
function largeSignedInBoardFixture(account){
 if(!largeSignedInBoardFixtures.has(account))largeSignedInBoardFixtures.set(account,buildLargeBoardFixture({account}));
 return largeSignedInBoardFixtures.get(account);
}
async function buildLargeBoardFixture({account:signedInAccount=null}={}){
 const shape=LARGE_BOARD_SHAPE,start=Date.parse('2026-06-01T12:00:00Z'),rand=mulberry32(2225);
 const ids=Array.from({length:shape.tasks},(_,i)=>'large-board-task-'+String(i).padStart(3,'0'));
 const seeded=syncState({contexts:[{id:'home',name:'Home',active:true}],listOpen:true,seenQuickStart:true,
  tasks:ids.map((id,i)=>({...syncTask(id,'Large board task '+i),ctx:['home'],createdAt:start-(shape.tasks-i)*3600000}))});
 // #2227: largeSignedInBoardFixture passes {account}; the scan below then
 // records every decision for that account, exactly as a signed-in app does.
 if(signedInAccount!==null)seeded.syncAccount=signedInAccount;
 const app=await loadApp({seed:2225,cryptoProvider:webcrypto,seedStorage:{[STORE_KEY]:JSON.stringify(seeded)}});
 try{
  const {ctx}=app;let now=start;const at=()=>{now+=60000;setFakeTime(ctx,now);return now;};setFakeTime(ctx,now);
  const control=()=>({dataset:{candidate:ctx.state.candidateId,benchmark:ctx.state.chain.at(-1)}});
  // Real scan decisions across two passes: a scan mode per pass carrying a
  // weight for every task (the large events), comparisons, ratings applied
  // to the ratings, and a worked disposition.
  ctx.onAction('start-scan',{});
  for(const answer of ['no','yes','no','no','yes','no']){at();assert.ok(ctx.state.candidateId,'large-board fixture: the pass offers a candidate');ctx.onAction(answer,control());}
  at();ctx.onAction('worked',{dataset:{benchmark:ctx.state.chain.at(-1)}});
  at();ctx.onAction('start-scan',{});
  for(const answer of ['no','no']){at();assert.ok(ctx.state.candidateId,'large-board fixture: the restarted pass offers a candidate');ctx.onAction(answer,control());}
  const board=JSON.parse(JSON.stringify(ctx.state));
  // More benchmark-preferred decisions in the current pass, each a distinct
  // action observing the one before, cloned from the last real No, about a
  // task not yet considered. They are recorded without a rating update and
  // each marks its candidate considered, so the saved board stays exactly
  // what its decisions imply when the app replays them.
  const template=board.decisionEvents.findLast(event=>event.kind==='no');
  assert.ok(template,'large-board fixture: a real No decision exists');
  const offered=ids.filter(id=>!board.chain.includes(id)&&!Object.hasOwn(board.considered,id)&&id!==board.candidateId);
  assert.ok(offered.length>=shape.decisionEvents-board.decisionEvents.length,'large-board fixture: enough unconsidered tasks');
  for(let n=0;board.decisionEvents.length<shape.decisionEvents;n++){
   const previous=board.decisionEvents.at(-1).id,candidateId=offered[n];
   board.decisionEvents.push({...JSON.parse(JSON.stringify(template)),id:'large-board-decision-'+n,actionId:'large-board-action-'+n,
    at:at(),observedActionIds:[previous],candidateId,ratingApplied:false});
   board.considered[candidateId]='no';
  }
  // Older observational rating rows: rankings moved, the rating did not.
  // A heavy-tailed spread with one long history, as on the measured board.
  const rowTemplate=board.tasks.flatMap(task=>task.ratingHistory||[]).find(row=>row.kind==='no');
  assert.ok(rowTemplate,'large-board fixture: a real rating history row exists');
  const historyBytes=task=>Buffer.byteLength(JSON.stringify(task.ratingHistory||[]),'utf8');
  const weights=board.tasks.map(()=>-Math.log(1-rand()*0.98));
  const restTotal=shape.historyMeanBytes*shape.tasks-shape.historyMaxBytes,weightTotal=weights.slice(1).reduce((sum,w)=>sum+w,0);
  board.tasks.forEach((task,index)=>{
   const target=index===0?shape.historyMaxBytes:Math.ceil(restTotal*weights[index]/weightTotal),older=[];
   const real=task.ratingHistory||[];let k=0;
   while(historyBytes({ratingHistory:[...older,...real]})<target){
    const topK=1+Math.floor(rand()*shape.tasks),likelihood=Number((rand()/shape.tasks).toFixed(12));
    const values={...rowTemplate.after,mu:25,sigma:25/3,topK,n:shape.tasks,likelihood};
    older.push({v:1,id:`large-board-history-${index}-${k}`,at:start-(k+1)*86400000-index*1000,kind:'no',change:'relative',
     after:values,basis:rowTemplate.basis,before:{...values,topK:Math.min(shape.tasks,topK+1),likelihood:Number((likelihood*0.9).toFixed(12))}});
    k++;
   }
   older.reverse();task.ratingHistory=[...older,...real];
  });
  // A long History brings the whole board to the measured serialized size.
  for(let n=0;Buffer.byteLength(JSON.stringify(board),'utf8')<shape.serializedBytes;n++){
   const batch=Array.from({length:500},(_,i)=>{const task=board.tasks[(n*500+i)%shape.tasks];
    return {id:`large-board-work-${n*500+i}`,taskId:task.id,title:task.title,kind:'worked',at:start-(n*500+i)*600000};});
   board.workLog.push(...batch);
  }
  const payload=JSON.stringify(board);
  const issue=vm.runInContext('decisionEvidenceIssue',ctx)(JSON.parse(payload),board.syncAccount??null);
  assert.equal(issue,null,'large-board fixture: the app accepts its decision evidence');
  const eventSizes=board.decisionEvents.map(event=>Buffer.byteLength(JSON.stringify(event),'utf8'));
  const histories=board.tasks.map(historyBytes);
  const stats={tasks:board.tasks.length,serializedBytes:Buffer.byteLength(payload,'utf8'),
   decisionEvents:{count:eventSizes.length,meanBytes:Math.round(eventSizes.reduce((a,b)=>a+b,0)/eventSizes.length),maxBytes:Math.max(...eventSizes)},
   ratingHistory:{meanBytes:Math.round(histories.reduce((a,b)=>a+b,0)/histories.length),maxBytes:Math.max(...histories)},
   workLog:board.workLog.length};
  return Object.freeze({payload,ids:Object.freeze(ids.slice()),stats:Object.freeze(stats)});
 }finally{await app.dispose();}
}
// Peak resident memory of the web content processes a browser launched with
// webProcessMemoryEnv(tag) owns, read by the harness from the operating system
// (never from page code). Chromium renderers and Linux WebKit web processes
// inherit the tag; macOS WebKit web processes are XPC services that launchd
// starts, which receive __XPC_-prefixed variables without the prefix.
const WEB_PROCESS_COMMAND=/--type=renderer|WebKit\.WebContent|WebKitWebProcess/;
function webProcessMemoryEnv(tag){return {...process.env,CHAIN_MEMORY_PROBE:tag,__XPC_CHAIN_MEMORY_PROBE:tag};}
function webProcessMemorySampler(tag,intervalMs=40){
 const run=args=>new Promise(resolve=>execFile('ps',args,{maxBuffer:64*1024*1024},(error,stdout)=>resolve(error?'':stdout)));
 const owned=new Map(),peaks=new Map();let stopped=false,samples=0;
 const sample=async()=>{
  const rows=(await run(['-axww','-o','pid=,rss=,command='])).split('\n').map(line=>line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean);
  for(const [,pid,rss,command] of rows){
   if(!WEB_PROCESS_COMMAND.test(command))continue;
   if(!owned.has(pid))owned.set(pid,(await run(['eww','-o','command=','-p',pid])).includes('CHAIN_MEMORY_PROBE='+tag));
   if(owned.get(pid))peaks.set(pid,Math.max(peaks.get(pid)||0,Number(rss)*1024));
  }
  samples++;
 };
 const loop=(async()=>{while(!stopped){await sample();await new Promise(resolve=>setTimeout(resolve,intervalMs));}})();
 return {async stop(){stopped=true;await loop;await sample();
  return {peakBytes:Math.max(0,...peaks.values()),processes:peaks.size,samples};}};
}

// #2195: the shape a real diagnostics export captured (spec #2194), rebuilt from
// isolated synthetic data only. Recovery (#2198) and read-cost (#2201) tickets
// reuse capturedUnreadableGenerationFixture() instead of inventing a failure.
const CAPTURED_UNREADABLE_GENERATION=Object.freeze({rev:2346,
 active:Object.freeze({chunkCount:8,byteLength:2057012}),prior:Object.freeze({chunkCount:8,byteLength:2014008})});
function syntheticBoardOfBytes(label,byteLength){
 const board={tasks:Array.from({length:3000},(_,index)=>({id:`${label}-${index}`,title:`Synthetic ${label} task ${index}`,done:false})),
  settings:{fixture:'synthetic-2195',pad:''}};
 const unpadded=Buffer.byteLength(JSON.stringify(board),'utf8');assert.ok(unpadded<byteLength,'synthetic board must fit the captured size');
 board.settings.pad='x'.repeat(byteLength-unpadded);
 const payload=JSON.stringify(board);assert.equal(Buffer.byteLength(payload,'utf8'),byteLength);
 return payload;
}
async function capturedUnreadableGenerationFixture({defect=true,uid='fixture-owner'}={}){
 const adapter=cloudV2Adapter(),store=loadCloudV2().createCloudStore({adapter,crypto:webcrypto}),codec=loadStorageV2();
 const {rev,active,prior}=CAPTURED_UNREADABLE_GENERATION;
 const priorGenerationId='fixture-prior-generation',activeGenerationId='fixture-active-generation';
 const priorPayload=syntheticBoardOfBytes('prior',prior.byteLength),activePayload=syntheticBoardOfBytes('active',active.byteLength);
 // Earlier history is irrelevant to the capture; seed its revision so the two
 // real publishes land on rev-1 (prior) and rev (active) through the store.
 adapter.roots.set(uid,{schemaVersion:2,rev:rev-2,activeGeneration:null,previousGeneration:null,updatedAt:1});
 assert.equal((await store.push(uid,priorPayload,2,rev-2,{generationId:priorGenerationId})).ok,true);
 assert.equal((await store.push(uid,activePayload,3,rev-1,{generationId:activeGenerationId})).ok,true);
 // The defect: the published active header still declares its chunks and
 // bytes, but none of its chunks remain readable on the server.
 if(defect)adapter.generations.get(uid+'/'+activeGenerationId).chunks.clear();
 const reads=[];
 for(const method of ['readRoot','readGeneration','readChunks']){
  const original=adapter[method];adapter[method]=(...args)=>{reads.push(method);return original(...args);};
 }
 const generation=id=>{const stored=adapter.generations.get(uid+'/'+id);
  return {header:structuredClone(stored.header),readableChunks:[...stored.chunks.values()].sort((a,b)=>a.index-b.index).map(chunk=>structuredClone(chunk))};};
 return {adapter,store,uid,rev,priorGenerationId,activeGenerationId,priorPayload,activePayload,generation,
  decodeGeneration:id=>{const {header,readableChunks}=generation(id);return codec.decodeSnapshot(header,readableChunks);},
  async pullOnce(options){const start=reads.length,result=await store.pull(uid,options),calls=reads.slice(start);return {result,calls,roundTrips:calls.length};}};
}

// #2198: the same captured shape (#2195) reaching the real app consumer. The
// device holds an accepted board whose acknowledged copy no longer matches the
// damaged active header, and the immediately prior generation is complete.
// The product reads sources inside one 60s budget, and every consumer here
// keeps exactly that budget. Whether recovery fits a phone is decided by
// counting work (multi-megabyte serializations), never by elapsed time, so a
// slow or loaded host cannot change any verdict (#2194 review F3).
const CAPTURED_RECOVERY_BUDGET_MS=60000;
const CAPTURED_RESULT_BUDGET_MS=CAPTURED_RECOVERY_BUDGET_MS;
// Sums the length of every serialization of at least one mebibyte made by the
// app realm while `work` runs. The #2198 defect re-encoded the same captured
// multi-megabyte copies at every cloud read stage; that work is the same count
// on any host, so it is measured instead of the time it takes.
async function largeSerializedBytes2198(ctx,work){
 const counter=vm.runInContext(`(()=>{const original=JSON.stringify,state={bytes:0,calls:0};
  JSON.stringify=function(...args){const result=Reflect.apply(original,this,args);
   if(typeof result==='string'&&result.length>=1048576){state.bytes+=result.length;state.calls++;}return result;};
  return {state,restore(){JSON.stringify=original;}};})()`,ctx);
 try{await work();}finally{counter.restore();}
 return {bytes:counter.state.bytes,calls:counter.state.calls};
}
// What one recovery pull may serialize on a phone inside the product budget.
// Fixed constants, never measured at test time: desktop JSON serialization of
// this board shape ran at 425 MB/s (2026-11-05), spec #2194 puts phone class
// CPU at up to 6x slower, and the captured export spent 9.57 s of the 60 s
// budget in network chunk stages. Before the #2198 fix one pull serialized
// about 4.9 GB, which is about 70 s of phone CPU.
const CAPTURED_PHONE_SERIALIZATION_BYTES=Math.floor((60-9.57)*425e6/6);
function exactPaddedBoard(board,field,byteLength){
 board[field]={opaque:''};const unpadded=Buffer.byteLength(JSON.stringify(board),'utf8');
 assert.ok(unpadded<byteLength,'the synthetic board must fit the captured size');board[field].opaque='p'.repeat(byteLength-unpadded);
 const payload=JSON.stringify(board);assert.equal(Buffer.byteLength(payload,'utf8'),byteLength);return payload;
}
async function capturedGenerationAcceptedApp2198(t,{recoveryTimeoutMs=CAPTURED_RECOVERY_BUDGET_MS,priorVariant=null,defect=true}={}){
 const {active,prior}=CAPTURED_UNREADABLE_GENERATION;
 // The unproxied factory lets the multi-megabyte database be deleted below.
 const app=await damagedAcknowledgedApp187(t,{sourcePadding:2000000,recoveryTimeoutMs,nativeDeviceConnection:true}),{ctx,shim,backend,originalRoot}=app,codec=ctx.window.ChainStorageV2;
 // The runner retains finished hooks and, through them, each app realm. Its
 // in-memory database keeps every transaction's multi-megabyte rollback log,
 // so release the sources themselves or the full suite exhausts its heap.
 // #2227: a debounced save from the test's last edit can still be writing
 // when the test ends (recovery now finishes sooner); let it settle first.
 t.after(async()=>{for(let i=0;i<500;i++){let active=0;try{active=vm.runInContext('supportDiagnosticsActivePersistCalls+(saveTimer?1:0)',ctx);}catch{}if(!active)break;await new Promise(resolve=>setTimeout(resolve,10));}});
 t.after(async()=>{try{vm.runInContext('cancelCloudSourceRecoveryRead({record:false});clearCloudRetry();clearTimeout(cloudTimer);clearTimeout(saveTimer)',ctx);}catch{}
  backend.CS.suspend();try{await ctx.window.ScannerDeviceStore?.close?.();}catch{}
  await app.dispose();backend.docs.clear();try{shim.localStorage.clear();}catch{}
  for(const name of ['state','undoStack','lastKnownCloudPayload','cloudSourceRecoveryCloudInspection','cloudSourceRecoveryPreview',
   'unrepairableCloudSource','lastPersistedRaw','fileRestorePreview','pasteDraftBuffer','deviceBackupCache','deviceLegacySeenSignature'])try{vm.runInContext(name+'=null',ctx);}catch{}
  try{vm.runInContext('decisionBaseIdentityCache.length=0',ctx);}catch{}
  await new Promise(resolve=>{try{const request=app.indexedDB.deleteDatabase(app.deviceDbName);request.onsuccess=request.onerror=request.onblocked=()=>resolve();}catch{resolve();}});});
 const activePath='users/owner/generations/'+originalRoot.activeGeneration,priorPath='users/owner/generations/'+originalRoot.previousGeneration;
 // Prior generation: complete and verifiable, carrying one change this device
 // never saw, so its use is observable in the working board.
 const {payload:priorPayload,encoded:priorEncoded}=await rewriteGenerationFixture(backend,priorPath,codec,priorBoard=>{
  priorBoard.tasks.push(syncTask('captured-prior-only','Saved only in the intact prior generation'));
  // Unsafe variants must keep waiting: an ambiguous legacy rating (the #2408
  // refusal shape) or a board saved under another account.
  if(priorVariant==='ambiguous legacy rating'){assert.equal(priorBoard.decisionBaseline,undefined);priorBoard.tasks.find(row=>row.id==='a').mu=26;}
  else if(priorVariant==='different account')priorBoard.syncAccount='other-account@example.com';
  else assert.equal(priorVariant,null);
  return exactPaddedBoard(priorBoard,'futurePriorGenerationFixture',prior.byteLength);
 });
 assert.equal(priorEncoded.chunkCount,prior.chunkCount);
 // Active generation: a different source whose header declares the captured
 // chunks and bytes while none of its chunks remain readable.
 const different=JSON.parse(ctx.state.decisionBase.payload);
 const activeEncoded=await codec.encodeSnapshot(exactPaddedBoard(different,'futureUnreadableActiveFixture',active.byteLength));
 assert.equal(activeEncoded.chunkCount,active.chunkCount);
 backend.docs.set(activePath,{...backend.docs.get(activePath),hash:activeEncoded.hash,byteLength:activeEncoded.byteLength,chunkCount:activeEncoded.chunkCount});
 // {defect:false}: the same captured sizes with every declared chunk readable.
 if(!defect)for(const chunk of activeEncoded.chunks)backend.docs.set(activePath+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk);
 else assert.equal([...backend.docs.keys()].filter(key=>key.startsWith(activePath+'/chunks/')).length,0,'none of the declared active chunks are readable');
 const setupRead=await backend.CS.pull();
 if(defect)assert.equal(setupRead.code,'corrupt-generation','the real pull reproduces the captured failure');
 else assert.equal(createHash('sha256').update(setupRead.payload,'utf8').digest('hex'),activeEncoded.hash,'the healthy active generation reads byte-exactly');
 // Newer accepted local work that no cloud generation contains.
 shim.document.getElementById('addInput').value='Newer local edit before reconciliation';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 await settleSourceFixtureSave187(app,'the newer local edit is durably saved before the cloud read',true);
 return {...app,activePath,priorPath,priorPayload};
}

// #2194 review F4, a characterization (it passes on the pre-#2194 app as well):
// with a readable active generation nothing #2198/#2200/#2201 added may run.
// The reference is independent of the code under test: the board saved before
// the pull, the cloud documents before it, and the status, writes and stores
// recorded once from main 8cd524a running this same fixture.
// Recorded from main 8cd524a (2026-11-05T04:5xZ, rf/logs/F4-record-main.log).
const RECORDED_HEALTHY_STATUS_8CD524A=Object.freeze({text:'☁ syncing',title:'Cloud sync is pending for e@example.com; this board is not acknowledged yet.',className:'syncbtn busy',hidden:false});
const RECORDED_HEALTHY_READS_8CD524A=Object.freeze(['<root>','<active>','<active>/chunks','<root>']);

// #2194 independent review B1: the in-process document's querySelector always
// answers null, so no test could see that Settings itself is an open modal
// (.mback). This makes the shim report the mounted modal faithfully for the
// modal selectors the app uses, and leaves every other selector unchanged.
function faithfulModalQuery2194(shim){
 const original=shim.document.querySelector;
 shim.document.querySelector=function(selector){
  const open=/class="mback"/.test(String(shim.document.getElementById('modalRoot').innerHTML||''));
  const parts=String(selector).split(',').map(part=>part.trim());
  if(open&&parts.some(part=>part==='.mback'||part==='#modalRoot .mback'))return {matches:()=>true,closest:()=>null,contains:()=>true,getAttribute:()=>null};
  return original.call(this,selector);
 };
 return ()=>{shim.document.querySelector=original;};
}
function declineButton2194(){
 const button={dataset:{act:'decline-automatic-cloud-recovery'},classList:{contains:()=>false},closest(){return button;}};
 return button;
}
async function pendingAutomaticDefault2194(t,app){
 const {ctx}=app,store=ctx.window.ScannerDeviceStore;
 // Publication stays refused, so the automatic default stays pending.
 const refusal=Object.assign(Error('Controlled automatic publication refusal'),{code:'permission-denied'});
 Object.defineProperty(app.faults,'push',{configurable:true,get(){return refusal;}});t.after(()=>{delete app.faults.push;});
 const idle=()=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy',ctx);
 ctx.closeModal();await flush();const opening=ctx.cloudPull();let opened=false;opening.then(()=>{opened=true;},()=>{opened=true;});
 await fixtureDeadline(async wait=>{await wait(5);while(!opened||!idle())await wait(20);},'the automatic default settles unpublished',CAPTURED_RESULT_BUDGET_MS+20000);
 const pending=await store.getRecoveryCloudHold();
 assert.ok(pending?.automaticRecovery===true,'positive control: the automatic default is pending');
 return {idle,pending};
}

// #2194 review F1: the reporter's case is an installed app relaunched. A
// completed refusal over an unchanged server root must survive that cold
// launch, keyed by account, revision and generation. The root is still a
// forced server read, and the conclusion only ever holds writes.
async function coldRelaunch2198(t,app,reads,{signIn=true}={}){
 let reopened=await loadAppAtTime(1792323000000,{indexedDBProvider:app.indexedDB,deviceDbName:app.deviceDbName,sharedStorage:app.shim.localStorage});
 if(!reopened.ctx.window.ChainStorageV2){vm.runInContext(fs.readFileSync(path.join(__dirname,'device-store-v2.js'),'utf8'),reopened.ctx,{filename:'device-store-v2.js'});reopened.ctx.window.ChainStorageV2=reopened.ctx.ChainStorageV2;}
 await reopened.ctx.__dataReady;reopened.ctx.window.CLOUD_PUSH_DELAY_MS=60000;
 const faults={authPending:true,serverRead:async path=>{reads.push(path);}};
 let backend=await loadCloudBackendV2({runtimeWindow:reopened.ctx.window,sharedDocs:app.backend.docs,failures:faults,timeoutMs:5000,recoveryTimeoutMs:CAPTURED_RECOVERY_BUDGET_MS,recordSyncError:reopened.ctx.recordSyncError});
 // The same release as the #2198 fixture: the runner retains finished hooks
 // and their realms, and the shared in-memory database keeps every multi-
 // megabyte transaction log until it is deleted after this connection closes.
 t.after(async()=>{backend.CS.suspend();try{vm.runInContext('cancelCloudSourceRecoveryRead({record:false});clearCloudRetry();clearTimeout(cloudTimer);clearTimeout(saveTimer)',reopened.ctx);}catch{}
  try{await reopened.ctx.window.ScannerDeviceStore?.close?.();}catch{}await reopened.dispose();backend.docs.clear();try{reopened.shim.localStorage.clear();}catch{}
  for(const name of ['state','undoStack','lastKnownCloudPayload','cloudSourceRecoveryCloudInspection','cloudSourceRecoveryPreview',
   'unrepairableCloudSource','provedUnreadableCloudSource','lastPersistedRaw','fileRestorePreview','pasteDraftBuffer','deviceBackupCache','deviceLegacySeenSignature'])try{vm.runInContext(name+'=null',reopened.ctx);}catch{}
  try{vm.runInContext('decisionBaseIdentityCache.length=0',reopened.ctx);}catch{}
  await new Promise(resolve=>{try{const request=app.indexedDB.deleteDatabase(app.deviceDbName);request.onsuccess=request.onerror=request.onblocked=()=>resolve();}catch{resolve();}});
  // This retained hook must not keep the relaunched realm or its backend alive.
  reopened=null;backend=null;});
 const settled=()=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy||automaticCloudFallbackBootCapturePending',reopened.ctx);
 const relaunched={...reopened,backend,faults,settle:message=>fixtureDeadline(async wait=>{await wait(5);while(!settled())await wait(10);},message,CAPTURED_RESULT_BUDGET_MS+20000)};
 if(signIn){backend.emitAuth({uid:'owner',email:'e@example.com'});reopened.ctx.closeModal();await flush();await reopened.ctx.cloudPull();await relaunched.settle('the relaunched opening settles');}
 return relaunched;
}

// #2200: what the person sees while the automatic recovery default (#2198) is
// using the older complete generation and no cloud acknowledgement exists yet.
// The status is read from the real sync control at the moment the guarded
// publication starts, before any cloud write can acknowledge the board.
function syncStatus2200(shim){
 const button=shim.document.getElementById('syncBtn');
 return {text:button.textContent,title:button.title,className:button.className,hidden:button.hidden};
}

async function decisionBackend146(artifacts,db,F,uid='owner',{beforePublication=null}={}){
 const pending=new Set(),auth={currentUser:{uid,email:'e@example.com'}},events=[];
 const host=value=>Array.isArray(value)?Array.from(value,host):value?.constructor?.name==='Object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,host(v)])):value;
 const writer=(target,onWrite=null)=>new Proxy(target,{get(object,key){const value=object[key];return typeof value!=='function'?value:(...args)=>{if(['set','update'].includes(key))onWrite?.(args[0]);return Reflect.apply(value,object,['set','update'].includes(key)?args.map(host):args);};}});
 const sdk={...F,getFirestore:()=>db,writeBatch:(...args)=>writer(F.writeBatch(...args))};
 for(const key of ['getDoc','getDocs','runTransaction'])sdk[key]=(...args)=>{
  if(key==='runTransaction'){const fn=args[1];args[1]=async tx=>{
   let publishes=false;
   const result=await fn(writer(tx,ref=>{if(ref.path===`users/${uid}`)publishes=true;}));
   if(publishes)await beforePublication?.();
   return result;
  };}
  const result=F[key](...args);pending.add(result);result.then(()=>pending.delete(result),()=>pending.delete(result));return result;
 };
 const window={FIREBASE_CONFIG:{apiKey:'emulator-only'},CLOUD_SYNC_TIMEOUT_MS:5000,dispatchEvent:event=>events.push(event)};
 const A={getAuth:()=>auth,setPersistence:async()=>{},browserLocalPersistence:{},onAuthStateChanged:(_,fn)=>fn(auth.currentUser)};
 const context=vm.createContext({window,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,structuredClone,console,performance,setTimeout,clearTimeout,CustomEvent:class{},__modules:[{initializeApp:()=>({})},A,sdk]});
 for(const [file,code] of [['device-store-v2.js',artifacts.storage],['cloud-store-v2.js',artifacts.cloud]])vm.runInContext(code,context,{filename:file});
 window.ChainStorageV2=context.ChainStorageV2;window.ChainCloudV2=context.ChainCloudV2;
 const module=artifacts.html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/const \[appMod, A, F\] = await Promise\.all\(\[[\s\S]*?\]\);/,'const [appMod,A,F]=globalThis.__modules;');
 await vm.runInContext(`(async()=>{${module}\n})()`,context);
 assert.equal(window.CloudSync.ready,true);
 const CS=window.CloudSync;
 return {CS,attachAppWindow(appWindow){
  // Browser classic and module scripts share this exact window. Binding the
  // actual app keeps its planner, pending store and live backend checks real.
  appWindow.ChainStorageV2??=context.ChainStorageV2;
  appWindow.ChainCloudV2??=context.ChainCloudV2;
  appWindow.CloudSync=CS;context.window=appWindow;return CS;
 },async drain(){for(let idle=0;idle<2;){if(pending.size){idle=0;await Promise.allSettled([...pending]);}else idle++;await flush();}}};
}
function decisionCandidate146(){return {html,cloud:fs.readFileSync(path.join(__dirname,'cloud-store-v2.js'),'utf8'),storage:fs.readFileSync(path.join(__dirname,'device-store-v2.js'),'utf8')};}

async function exerciseCompletionEditorBoundaries(t,nativeOnly=false,holdAcknowledgedPins=false){
 const observerWatchdog=setTimeout(()=>{},15000);t.after(()=>clearTimeout(observerWatchdog));
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),at=Date.parse('2026-10-17T15:00:00Z'),
  doneId='boundary-editor-done',peerId='boundary-editor-peer',gateId='boundary-editor-gate',dependentId='boundary-editor-dependent',
  name=`completion-boundary-editor-${Date.now()}-${Math.random()}`;
 const initial=syncState({tasks:[
  syncTask(doneId,'Completed chain member'),syncTask(peerId,'Independent peer task'),syncTask(gateId,'Saved prerequisite'),
  {...syncTask(dependentId,'Saved dependent task'),prerequisiteId:gateId,prerequisiteIds:[gateId]},
  ...Array.from({length:12},(_,index)=>syncTask(`boundary-editor-extra-${index}`,`Independent peer extra ${index}`))],
  chain:[doneId,peerId],candidateId:'boundary-editor-extra-0',passId:'boundary-editor-pass',passStartedAt:at-60000,
  syncRev:4,syncAccount:'e@example.com',syncDirty:false,seenQuickStart:true,
  settings:{horizonMin:60,thresholdPct:0,samples:40,cantMin:30,workedHours:8,theme:'system'}});
 const remote=structuredClone(initial);for(const key of ['syncRev','syncAccount','syncDirty'])delete remote[key];
 const stale=structuredClone(remote),h=makeSyncHarness({remote,rev:4,delayMs:2}),storage=sharedScannerStorage({
  [SYNC_STORE_KEY]:JSON.stringify(initial),[LOCAL_HEAD_KEY]:JSON.stringify(initial)}),
  options={sharedStorage:storage,indexedDBProvider:indexedDB,deviceDbName:name,cloudSyncFactory:h.factory},
  app=await loadAppAtTime(at,options);
 const {ctx,shim}=app,CS=shim.window.CloudSync,store=shim.window.ScannerDeviceStore,basePull=CS.pull.bind(CS),
  scan=shim.document.getElementById('scan'),paints=[],durable=[],commit=store.commitHead.bind(store);
 let painted=scan.innerHTML,phase='completion-adoption',releaseRead,readStartedResolve;
 const readStarted=new Promise(resolve=>{readStartedResolve=resolve;}),readGate=new Promise(resolve=>{releaseRead=resolve;});
 const closed=new WeakSet(),closeFixture=async fixture=>{if(!fixture||closed.has(fixture))return;closed.add(fixture);try{fixture.shim.window.CloudSync&&(fixture.shim.window.CloudSync.user=null);fixture.ctx.suspendCloudSync?.();vm.runInContext('clearTimeout(saveTimer);saveTimer=null;clearTimeout(cloudTimer);cloudTimer=null;clearCloudRetry();',fixture.ctx);}catch{}try{await fixture.shim.window.ScannerDeviceStore?.close?.();}catch{}};
 t.after(()=>closeFixture(app));
 const nativeSaves=observeQueuedNativeSaves(ctx,t),oldEntered=deferredSyncFixture(),oldRelease=deferredSyncFixture(),nativeSave=deferredSyncFixture();let heldOld=false,nativeSource=null,heldPinRelease=false;
 t.after(()=>oldRelease.resolve());
 await ctx.__dataReady;await ctx.cloudPull();CS.ready=false;
 hydrateUnchangedEditorDraft(app,doneId);ctx.onAction('done-task',{dataset:{id:doneId}});
 if(!nativeOnly)assert.equal(await ctx.persist(),true,'the actual editor Done is durably saved before stale delivery');
 const completion=JSON.parse(JSON.stringify(ctx.state.decisionEvents.find(event=>event.kind==='completion'&&event.taskId===doneId)));
 assert.ok(completion,'the completion fact is bound to the real task response');
 setFakeTime(ctx,at+25);ctx.onAction('cycle-theme',{});if(!nativeOnly)assert.equal(await ctx.persist(),true,'the actual preference action has its own device save');
 const theme=ctx.state.settings.theme,themeFact=JSON.parse(JSON.stringify(ctx.state.decisionEvents.find(event=>event.kind==='current-choice'&&event.target?.property==='theme')));
 assert.ok(themeFact,'the independent theme selection remains an immutable fact');
 ctx.onAction('toggle-list',{});const search=shim.document.getElementById('listSearch');search.id='listSearch';search.value='Independent peer';
 shim.document.dispatchEvent({type:'input',target:search});const body=shim.document.getElementById('listBody');body.id='listBody';body.scrollTop=420;shim.document.dispatchEvent({type:'scroll',target:body});
 assert.equal(ctx.state.listOpen,true);assert.equal(ctx.state.tasks.find(row=>row.id===dependentId).prerequisiteId,gateId);
 assert.equal(ctx.isEligible(ctx.state.tasks.find(row=>row.id===dependentId)),false,'the saved prerequisite still controls eligibility');
 Object.defineProperty(scan,'innerHTML',{configurable:true,get:()=>painted,set(value){painted=value;paints.push({phase,gestureActive:vm.runInContext('scannerGestureActive',ctx),chain:[...ctx.state.chain],markup:String(value)});}});
 store.commitHead=async options=>{
  // Exercise real commit completion beyond the editor's queued 350ms save
  // so the regression retains the observed slow-storage producer overlap.
  if(phase==='editor-save-and-deferred-adoption')await syncSettle(400);
  const result=await commit(options);
  if(holdAcknowledgedPins&&!heldPinRelease&&result?.ok&&ctx.state.syncRev===6&&JSON.parse(options.payload).syncRev===5&&
     !Object.hasOwn(options,'backups')&&!Object.hasOwn(options,'backup')){
   // The real cloud ACK has arrived and this real metadata commit is durable.
   // Deliver its return after the older native Save's CAS repair finishes.
   // No state, payload, revision, production timer or assertion is replaced.
   heldPinRelease=true;
   await fixtureDeadline(nativeSave.promise,'the older native Save must finish while the acknowledged pin-release return is held');
  }
  if(nativeOnly&&nativeSaves.active()&&phase==='completion-adoption'&&result?.ok&&!heldOld){heldOld=true;nativeSource=options.payload;oldEntered.resolve();await oldRelease.promise;}
  if(result?.ok)durable.push({phase,chain:JSON.parse(options.payload).chain,events:JSON.parse(options.payload).decisionEvents||[]});return result;
 };
 // A newer cloud revision still carries the membership from before this Done.
 h.writeBehindBack(stale);CS.ready=true;
 CS.pull=async(...args)=>{const response=await basePull(...args);readStartedResolve();await readGate;return response;};
 const pending=ctx.cloudPull();await readStarted;
 const paintsBeforeEditorPull=paints.length,scanBeforeEditorPull=scan.innerHTML,chainBeforeEditorPull=[...ctx.state.chain];
 hydrateUnchangedEditorDraft(app,peerId);const title=shim.document.getElementById('etTitle'),due=shim.document.getElementById('etDue');
 const querySelector=shim.document.querySelector.bind(shim.document);
 // Model only the modal boundary absent from this lightweight DOM. Other
 // selectors must keep their real fixture result, including no saved preview.
 shim.document.querySelector=selector=>selector==='.mback, dialog[open]'?{}:querySelector(selector);
 assert.ok(shim.document.querySelector('.mback, dialog[open]'));
 assert.equal(shim.document.querySelector('[data-saved-preview] .syncbtn'),null,'the editor fixture does not invent a saved appearance status node');
 title.value='Editor draft during delayed recovery';due.value='2026-11-02';
 releaseRead();await pending;CS.pull=basePull;
 assert.equal(shim.document.getElementById('etTitle').value,'Editor draft during delayed recovery','the editor draft remains open when the stale response arrives');
 assert.deepEqual([...ctx.state.chain],chainBeforeEditorPull,'an open editor keeps displayed membership until its draft closes');
 assert.equal(paints.length,paintsBeforeEditorPull,'deferred adoption does not replace scanner DOM beneath the editor');
 assert.equal(scan.innerHTML,scanBeforeEditorPull,'the scanner remains exactly as shown before the held read');
 assert.equal(ctx.state.tasks.find(row=>row.id===peerId).title,'Independent peer task','cloud content cannot replace the active editor under its draft');
 assert.equal(vm.runInContext('deferredCloudPull',ctx),true,'the cloud adoption waits for the editor close boundary');
 if(nativeOnly){await oldEntered.promise;const pendingHead=await store.readHead();assert.equal(pendingHead.payload,nativeSource,'the held real native save already protects the original Done and theme before editor Save');}
 shim.document.querySelector=querySelector;
 phase='editor-save-and-deferred-adoption';
 const schedule=ctx.setTimeout;
 // Observe the real Save callback and its persistence result. Let the native
 // editor/deferred producers finish before adding a redundant fixture save.
 ctx.setTimeout=(fn,ms,...args)=>{
  const timer=schedule(ms===350?(...fired)=>{const result=fn(...fired);nativeSave.resolve(result);return result;}:fn,ms,...args);
  if(ms===350)timer.ref?.();return timer;
 };
 try{ctx.onAction('save-edit',{dataset:{id:peerId}});}finally{ctx.setTimeout=schedule;}
 assert.equal(await nativeSave.promise,true,'the real queued editor Save completes a successful durable persist');
 if(nativeOnly)oldRelease.resolve();
 else{
  // The extra immediate fixture push must not overtake earlier native or
  // deferred persistence. Native-only coverage below adds no such barrier.
  await nativeSaves.settle('editor native and deferred producers before the extra fixture push');ctx.cloudPushNow();
 }
 if(holdAcknowledgedPins)assert.equal(heldPinRelease,true,'the actual acknowledged pin-release commit delivered after the older native save');
 await settleSavedViewPublication(app,h,'editor-deferred completion adoption');
 if(!nativeOnly)assert.equal(await ctx.persist(),true,'the redundant fixture save succeeds after native editor publication is durably acknowledged');phase='settled';
 if(nativeOnly){const backups=await store.listBackups();assert.ok(backups.some(row=>{const board=JSON.parse(row.payload);return board.tasks?.some(task=>task.id===peerId&&task.title==='Editor draft during delayed recovery')&&board.decisionEvents?.some(event=>event.id===completion.id)&&board.decisionEvents?.some(event=>event.id===themeFact.id);}), 'automatic convergence retains a verified recovery copy of the native editor fields and original facts');}
 const cloud=h.remoteState(),savedTask=ctx.state.tasks.find(row=>row.id===peerId);
 assert.deepEqual([...ctx.state.chain],[peerId],'deferred adoption never paints the completed member back into the chain');
 assert.equal(savedTask.title,'Editor draft during delayed recovery');assert.equal(savedTask.due,'2026-11-02');
 assert.deepEqual([...ctx.state.tasks.find(row=>row.id===dependentId).prerequisiteIds],[gateId]);
 assert.equal(ctx.isEligible(ctx.state.tasks.find(row=>row.id===dependentId)),false,'prerequisite behavior remains unchanged after adoption');
 assert.equal(ctx.state.settings.theme,theme);assert.equal(JSON.stringify(cloud.settings.theme),JSON.stringify(theme));
 assert.equal(JSON.stringify(cloud.decisionEvents.find(event=>event.id===completion.id)),JSON.stringify(completion));
 assert.equal(JSON.stringify(cloud.decisionEvents.find(event=>event.id===themeFact.id)),JSON.stringify(themeFact));
 assert.equal(cloud.decisionEvents.filter(event=>event.kind==='completion'&&event.taskId===doneId).length,1);
 assert.equal(ctx.state.listOpen,true);assert.equal(search.value,'Independent peer');assert.equal(body.scrollTop,420);
 assert.ok(paints.length>0&&paints.every(row=>row.chain.every(id=>id!==doneId)
  &&![...String(row.markup).matchAll(/data-act="reveal" data-id="([^"]+)"/g)].some(match=>match[1]===doneId)),
  'every scan replacement while deferred recovery is released omits the completed member');
 assert.ok(durable.length>0&&durable.every(row=>row.chain.every(id=>id!==doneId)
  &&row.events.filter(event=>event.kind==='completion'&&event.taskId===doneId).length===1),
  'every production IndexedDB write after Done keeps the exact completion and repaired membership');
 assert.deepEqual(JSON.parse((await store.readHead()).payload).chain,[peerId]);
 // A scanner control pressed before a second stale response arrives is also an
 // interaction boundary; let its actual delegated click finish before draining.
 h.writeBehindBack(stale);let releaseGesture,gestureStartedResolve;
 const paintCountBeforePreparation=paints.length,pullCalls=observeSyncFixtureCalls(ctx,'cloudPull'),gestureTrace=[];
 const trace=event=>gestureTrace.push({event,phase,active:vm.runInContext('scannerGestureActive',ctx),paints:paints.length,chain:[...ctx.state.chain]});trace('before-preparation');
 const gestureStarted=new Promise(resolve=>{gestureStartedResolve=resolve;}),gestureGate=new Promise(resolve=>{releaseGesture=resolve;});
 phase='pre-press-delivery-control';await ctx.cloudPull();await settleSavedViewPublication(app,h,'legitimate delivery before pointerdown');
 assert.ok(paints.length>paintCountBeforePreparation,'a real pre-press cloud delivery has an observable scanner replacement');
 assert.ok(paints.slice(paintCountBeforePreparation).every(row=>!row.gestureActive),'these legitimate replacements really precede the active pointer');trace('pre-press-read-and-ACK');
 h.writeBehindBack(stale);phase='pressed-response-held';
 CS.pull=async(...args)=>{const response=await basePull(...args);gestureStartedResolve({consumer:pullCalls.findLast(call=>!call.settled)});await gestureGate;return response;};
 const gesturePull=ctx.cloudPull(),{consumer}=await gestureStarted;assert.ok(consumer,'the held response belongs to a real cloudPull continuation');
 shim.document.dispatchEvent({type:'pointerdown'});assert.equal(vm.runInContext('scannerGestureActive',ctx),true,'actual pointerdown establishes the guarded baseline');trace('pointerdown');
 const paintCountBeforePress=paints.length,scannerBeforePress=scan.innerHTML,chainBeforePress=[...ctx.state.chain];
 releaseGesture();await consumer.promise;await gesturePull;CS.pull=basePull;trace('held-response-consumed');assert.equal(vm.runInContext('scannerGestureActive',ctx),true,'the actual response was consumed while the pointer remained held');
 assert.equal(vm.runInContext('deferredCloudPull',ctx),true,'a cloud response cannot replace a scanner under a held pointer');
 assert.deepEqual([...ctx.state.chain],chainBeforePress,'the held scanner keeps the same chain after recovery arrives');
 assert.equal(paints.length,paintCountBeforePress,'no scanner replacement occurs before the pressed response is delivered');
 assert.equal(scan.innerHTML,scannerBeforePress,'the scanner DOM stays exact beneath the held pointer');
 const candidate=ctx.state.candidateId,benchmark=ctx.benchmark()?.id;
 assert.ok(candidate&&benchmark);assert.match(scan.innerHTML,/data-act="no"/,'the actual scanner control remains available while the pointer is held');
 const noButton={dataset:{act:'no',candidate,benchmark},disabled:false};
 shim.document.dispatchEvent({type:'pointerup'});trace('pointerup-before-click');
 shim.document.dispatchEvent({type:'click',detail:1,target:{classList:{contains:()=>false},closest:()=>noButton}});
 ctx.cloudPushNow();await settleSavedViewPublication(app,h,'pressed scanner control and stale completion adoption');phase='settled';trace('click-and-final-ACK');assert.equal(vm.runInContext('scannerGestureActive',ctx),false);
 const noFact=ctx.state.decisionEvents.find(event=>event.kind==='no'&&event.candidateId===candidate);
 assert.ok(noFact,'the held actual scanner response commits before deferred cloud adoption is drained');
 assert.equal(JSON.stringify(h.remoteState().decisionEvents.find(event=>event.id===completion.id)),JSON.stringify(completion));
 assert.equal(JSON.stringify(h.remoteState().decisionEvents.find(event=>event.id===noFact.id)),JSON.stringify(noFact));
 assert.deepEqual([...ctx.state.chain],[peerId]);
 assert.ok(paints.every(row=>row.chain.every(id=>id!==doneId)
  &&![...String(row.markup).matchAll(/data-act="reveal" data-id="([^"]+)"/g)].some(match=>match[1]===doneId)),
  'scanner paints after the held control still exclude the completed member');
 assert.ok(durable.every(row=>row.chain.every(id=>id!==doneId)
  &&row.events.filter(event=>event.kind==='completion'&&event.taskId===doneId).length===1),
  'durable writes after the held control retain one exact completion and no completed membership');
 t.diagnostic(JSON.stringify({gestureTrace,allPaints:paints.map(({phase,gestureActive,chain})=>({phase,gestureActive,chain}))}));
 if(process.env.SYNC_DELIVERY_EVIDENCE_DIR){fs.mkdirSync(process.env.SYNC_DELIVERY_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.SYNC_DELIVERY_EVIDENCE_DIR,'gesture-observations-'+process.pid+'.json'),JSON.stringify({gestureTrace,paints,durable},null,2));}
 const savedView=storage.getItem('fvp:chain-scanner:saved-view:v1');assert.ok(savedView,'the device view has its own saved record');
 await closeFixture(app);
 const reopened=await loadAppAtTime(at+100,{...options,cloudSyncFactory:h.factory});
 assert.equal(await reopened.ctx.__dataReady,undefined);
 await reopened.ctx.cloudPull();await settleSavedViewPublication(reopened,h,'cold reopen after deferred completion adoption');
 const cold=JSON.parse((await reopened.shim.window.ScannerDeviceStore.readHead()).payload);
 assert.deepEqual([...reopened.ctx.state.chain],[peerId]);assert.deepEqual(cold.chain,[peerId]);
 assert.equal(reopened.ctx.state.tasks.find(row=>row.id===doneId).done,true);
 assert.equal(reopened.ctx.state.tasks.find(row=>row.id===peerId).title,'Editor draft during delayed recovery');
 assert.equal(reopened.ctx.state.tasks.find(row=>row.id===peerId).due,'2026-11-02');
 assert.deepEqual([...reopened.ctx.state.tasks.find(row=>row.id===dependentId).prerequisiteIds],[gateId]);
 assert.equal(reopened.ctx.state.settings.theme,theme);assert.equal(reopened.ctx.state.listOpen,true);
 assert.equal(reopened.shim.document.getElementById('listSearch').value,'Independent peer');
 assert.equal(reopened.shim.document.getElementById('listBody').scrollTop,420);
 assert.ok(savedView.includes('Independent peer'),'the exact device-local filter survives the durable board reopen');
 t.after(()=>closeFixture(reopened));
}

/* Separate device stores share only the synthetic revision-checked cloud.
   Notifications contain account/revision hints, never trusted board bytes. */
async function liveScanSyncClients({evergreen=false,hostStorage=false}={}){
 const prepared=await loadApp({seed:615});
 const bench=prepared.ctx.addTask('Existing chain tail'),candidate=prepared.ctx.addTask('Scanned task'),next=prepared.ctx.addTask('Next scanned task');
 candidate.evergreen=evergreen;
 Object.assign(prepared.ctx.state,{chain:[bench.id],candidateId:candidate.id,mode:'scan',scanMode:'descending',snooze:100});
 const board=JSON.parse(prepared.ctx.cloudPayload()),h=makeSyncHarness({remote:board,rev:5,delayMs:1}),clients=[];
 const factory=win=>{
  const CS=h.factory();clients.push({win,CS});
  const push=CS.push;
  CS.push=async(...args)=>{const result=await push(...args);if(result?.ok)notify();return result;};
  return CS;
 };
 function notify(user='e@example.com',rev=h.doc.rev){for(const {win} of clients)win.dispatchEvent({type:'cloudboardchange',detail:{user,rev}});}
 const bytes=JSON.stringify({...board,syncRev:5,syncAccount:'e@example.com',syncDirty:false});
 const options={cloudSyncFactory:factory,[hostStorage?'hostStorage':'seedStorage']:{[SYNC_STORE_KEY]:bytes}};
 const a=await loadApp(options),b=await loadApp(options);await syncSettle(40);
 assert.equal(a.ctx.state.syncRev,5);assert.equal(b.ctx.state.syncRev,5);
 return {a,b,h,notify,benchId:bench.id,candidateId:candidate.id,nextId:next.id};
}

async function delayedEvergreenReadFixture({incumbentRead=false}={}){
 const {a,b,h,notify,candidateId,benchId,nextId}=await liveScanSyncClients({evergreen:true});
 const stale=h.remoteState();stale.chain=[benchId,candidateId];stale.candidateId=nextId;
 a.ctx.onAction('cand-done',{dataset:{candidate:candidateId,benchmark:benchId}});
 await settleSavedViewPublication(a,h,'Completion sender before the delayed stale read');
 await settleSavedViewPublication(b,h,'Completion peer before the delayed stale read');
 const completed=h.remoteState(),doneAt=completed.tasks.find(t=>t.id===candidateId).lastDoneAt;
 if(incumbentRead){
  const CS=b.shim.window.CloudSync,pull=CS.pull,entered=deferredSyncFixture();
  CS.pull=async(...args)=>{CS.pull=pull;const reply=await pull(...args);entered.resolve();await syncSettle(40);return reply;};
  const incumbent=b.ctx.cloudPull();
  await fixtureDeadline(entered.promise,'The occupied-read control did not enter its real read owner');
  assert.equal(vm.runInContext('pulling',b.ctx),true,'the control actually holds an incumbent read');
  await fixtureDeadline(incumbent,'The incumbent read did not finish before the delayed-read hook');
 }
 const CS=b.shim.window.CloudSync,ordinaryPull=CS.pull;let release,started;
 const reading=new Promise(resolve=>{started=resolve;});
 CS.pull=async()=>{CS.pull=ordinaryPull;const reply={...h.doc};started();return new Promise(resolve=>{release=()=>resolve(reply);});};
 try{
  h.writeBehindBack(stale);const delayed=b.ctx.cloudPull();
  await fixtureDeadline(reading,'The intended stale-source read never entered its one-shot hook');
  completed.chain=[benchId,candidateId];completed.candidateId=nextId;completed.tasks.find(t=>t.id===nextId).title='Newest independent edit';
  h.writeBehindBack(completed);notify();release();
  await fixtureDeadline(delayed,'The delayed stale-source read did not finish after release');
  await settleSavedViewPublication(a,h,'Sender after the newer revision');
  await settleSavedViewPublication(b,h,'Peer after the newer revision');
  for(const client of [a,b]){
   assert.deepEqual([...client.ctx.state.chain],[benchId],'neither delayed nor latest shared chain can override completion evidence');
   assert.equal(client.ctx.state.tasks.find(t=>t.id===candidateId).lastDoneAt,doneAt);
   assert.equal(client.ctx.state.tasks.find(t=>t.id===nextId).title,'Newest independent edit');
   assert.equal(client.ctx.state.workLog.filter(e=>e.taskId===candidateId).length,1);
  }
 }finally{
  release?.();CS.pull=ordinaryPull;
  a.ctx.suspendCloudSync();b.ctx.suspendCloudSync();
 }
}

function liveDoneDeliverySnapshot(app,id){
 return JSON.parse(vm.runInContext('JSON.stringify({rev:state.syncRev,dirty:state.syncDirty,reconciledAs,pulling,cloudPushInFlight,pendingPush,pendingCloudRevision,lastKnownCloudRevision,currentDoneAt:state.tasks.find(row=>row.id==='+JSON.stringify(id)+')?.lastDoneAt??null,knownDoneAt:JSON.parse(lastKnownCloudPayload||"null")?.tasks?.find(row=>row.id==='+JSON.stringify(id)+')?.lastDoneAt??null,lastPersistedRaw,stateRaw:JSON.stringify(state)})',app.ctx));
}
async function ordinaryEditDebounceControl(){
 const initial=syncState({tasks:[syncTask('ordinary-control','Ordinary edit control')],syncRev:5,syncAccount:'e@example.com',syncDirty:false}),h=makeSyncHarness({remote:initial,rev:5,delayMs:1}),entered=deferredSyncFixture();
 const startupEntered=deferredSyncFixture(),releaseStartup=deferredSyncFixture();let reads=[];
 const app=await loadApp({seedStorage:{[SYNC_STORE_KEY]:JSON.stringify(initial)},cloudSyncFactory:()=>{
  const CS=h.factory(),pull=CS.pull;let first=true;CS.pull=async(...args)=>{if(first){first=false;startupEntered.resolve();await releaseStartup.promise;}return pull(...args);};return CS;
 },beforeStateReady:ctx=>{reads=observeSyncFixtureCalls(ctx,'cloudPull');ctx.cloudPull();}});
 try{
  await startupEntered.promise;const initialConsumers=reads.filter(call=>!call.settled),caller=app.ctx.cloudPull();await caller;
  assert.ok(initialConsumers.length>0,'the ordinary control captures the real queued startup read');
  assert.equal(vm.runInContext('pulling',app.ctx),true);assert.equal(vm.runInContext('reconciledAs',app.ctx),null,'a second early-returning caller is not initial read authority');
  assert.equal(app.ctx.state.tasks.length,1,'ordinary Add has not run while startup is pending');assert.equal(h.doc.rev,5);
  const startup={heldConsumers:initialConsumers.length,heldSourceRaw:h.doc.payload,heldRaw:JSON.stringify(app.ctx.state)};
  releaseStartup.resolve();await Promise.all(initialConsumers.map(call=>call.promise));await caller;
  assert.equal(await app.ctx.persist(),true);assert.equal(vm.runInContext('reconciledAs',app.ctx),'e@example.com');
  assert.equal(app.shim.localStorage.getItem(SYNC_STORE_KEY),JSON.stringify(app.ctx.state),'the actual startup consumer and device head are acknowledged before ordinary Add');
  startup.acknowledgedRaw=JSON.stringify(app.ctx.state);startup.account=vm.runInContext('reconciledAs',app.ctx);
  assert.equal(app.shim.window.CLOUD_PUSH_DELAY_MS,undefined,'the actual ordinary producer retains the default two-second debounce');
  const acknowledged=deferredSyncFixture(),push=app.shim.window.CloudSync.push;app.shim.window.CloudSync.push=async(...args)=>{entered.resolve({at:performance.now(),args});const reply=await push(...args);acknowledged.resolve({at:performance.now(),reply});return reply;};
  const started=performance.now();app.ctx.addTask('Actual ordinary debounced edit');return {app,h,started,entered:entered.promise,acknowledged:acknowledged.promise,startup};
 }catch(error){releaseStartup.resolve();await Promise.all(reads.filter(call=>!call.settled).map(call=>call.promise));app.ctx.suspendCloudSync();throw error;}
 finally{releaseStartup.resolve();}
}

function liveModeDeliverySnapshot(app){
 return JSON.parse(vm.runInContext('JSON.stringify({mode:state.mode,rev:state.syncRev,dirty:state.syncDirty,reconciledAs,pulling,knownMode:JSON.parse(lastKnownCloudPayload||"null")?.mode??null,lastKnownCloudRevision,lastPersistedRaw,stateRaw:JSON.stringify(state)})',app.ctx));
}
async function settleLiveModePublication(app,h,label){
 const deadline=performance.now()+8000;let observed,stored;
 do{
  observed=JSON.parse(vm.runInContext('JSON.stringify({idle:!cloudPushInFlight&&!pulling&&!pendingPush&&!cloudResumePending,dirty:state.syncDirty,payload:cloudPayload(),rev:state.syncRev,raw:lastPersistedRaw,stateRaw:JSON.stringify(state)})',app.ctx));
  if(observed.idle&&!observed.dirty&&observed.payload===h.doc.payload&&observed.rev===h.doc.rev&&observed.raw===observed.stateRaw){
   stored=app.shim.window.storage?(await app.shim.window.storage.get(SYNC_STORE_KEY))?.value:app.shim.localStorage.getItem(SYNC_STORE_KEY);
   if(stored===observed.stateRaw)return;
  }
  await syncSettle(25);
 }while(performance.now()<deadline);
 assert.fail(label+' did not acknowledge the coherent browser/host head: '+JSON.stringify({observed,storedMatches:stored===observed.stateRaw}));
}

function releasedDependencyHydrator(ctx,sha){
 const result=spawnSync('git',['show',sha+':index.html'],{cwd:__dirname,encoding:'utf8'});
 assert.equal(result.status,0,'actual supported released source must exist');
 const start=result.stdout.indexOf('function hydrateState(st){'),end=result.stdout.indexOf('\nfunction ',start+1);
 assert.ok(start>=0&&end>start);
 return vm.runInContext('('+result.stdout.slice(start,end)+')',ctx);
}

const MODE_LIFECYCLE_NOW=new Date(2026,9,6,12).getTime();
const modeLifecycleCopy=value=>JSON.parse(JSON.stringify(value));
function modeLifecycleEdit(app,task,{hours=18,title=task.title}={}){
 app.ctx.openEdit(task.id);
 fillEditPane(app.ctx,app.shim,{title,evergreen:task.evergreen,ctxIds:task.ctx});
 app.shim.document.getElementById('etEverHours').value=String(hours);
 app.shim.document.getElementById('etEverUnit').value='hours';
 app.shim.document.getElementById('etEverReset').checked=false;
}
async function modeLifecycleWaitFor(predicate,message){
 for(let i=0;i<160;i++){if(predicate())return;await syncSettle(5);}
 assert.ok(predicate(),message);
}

async function privateMigratedDeleteFixture({payloadFirst=false,packed=false}={}){
 const {indexedDB}=await import('fake-indexeddb'),dbName='chain-scanner-delete-mirror-'+Date.now()+'-'+Math.random();
 const raw=JSON.stringify(syncState({tasks:[syncTask('private-delete-board','Private current board')]}));
 const metadata={id:'private-selected-mirror',day:'2026-10-01',at:Date.parse('2026-10-01T12:00Z'),kind:'manual',futureData:{z:1,a:[2,{z:3,a:4}]}};
 const selected=payloadFirst?{payload:raw,...metadata}:{...metadata,payload:raw};
 const hidden={id:'private-unreadable-neighbor',day:'2020-01-01',at:1,kind:'future-recovery',payload:'unreadable',futureData:{keep:'exact bytes'}};
 const hiddenBytes=JSON.stringify(hidden),storage=sharedScannerStorage({[LOCAL_HEAD_KEY]:raw,[SYNC_STORE_KEY]:raw,[LOCAL_BACKUPS_KEY]:'[ '+hiddenBytes+' , '+JSON.stringify(selected)+' ]'});
 const loaded=await loadApp({sharedStorage:storage,indexedDBProvider:indexedDB,deviceDbName:dbName});
 if(packed)storage.setItem(LOCAL_BACKUPS_KEY,loaded.ctx.packBackupIndex(storage.getItem(LOCAL_BACKUPS_KEY)));
 const store=loaded.shim.window.ScannerDeviceStore,head=await store.readHead(),stateRaw=JSON.stringify(loaded.ctx.state);
 const copy={...selected,id:'private-shared-payload-neighbor'};assert.equal((await store.putBackup({expectedHash:head.hash,backup:copy})).ok,true);
 await loaded.ctx.refreshDeviceBackupCache();
 return {...loaded,indexedDB,dbName,storage,store,selected,hidden,hiddenBytes,head,stateRaw};
}

async function privateRewriteDurableBackup(fixture,change){
 const db=await new Promise((resolve,reject)=>{const request=fixture.indexedDB.open(fixture.dbName);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 try{await new Promise((resolve,reject)=>{
  const tx=db.transaction('backups','readwrite'),store=tx.objectStore('backups'),request=store.get(fixture.selected.id);
  request.onsuccess=()=>store.put(change(request.result),fixture.selected.id);
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('private rewrite aborted'));
 });}finally{db.close();}
}

function privateVisibleBackupRows(fixture){
 return Array.from(vm.runInContext('backupRowsShown',fixture.ctx)).filter(row=>row.id===fixture.selected.id);
}

async function privateClickBackupDelete(fixture){
 await fixture.ctx.onAction('delete-local-backup',{dataset:{id:fixture.selected.id}});
 for(let i=0;i<10;i++)await flush();
}

async function privateAssertBackupSurvives(fixture){
 assert.ok((await fixture.store.listBackups()).some(row=>row.id===fixture.selected.id),'the durable selected recovery copy remains');
 assert.equal((await fixture.store.readHead()).payload,fixture.head.payload,'deleting a backup never writes the durable board');
 assert.equal(JSON.stringify(fixture.ctx.state),fixture.stateRaw,'the in-memory board remains untouched');
}

const PRIVATE_EXPIRY_NOW=+new Date(2026,9,7,0,1),PRIVATE_EXPIRY_OLD='2026-09-30';
async function privateLegacyExpiryFixture({packed=false,protectedIds=[],makeRows=null}={}){
 const {indexedDB}=await import('fake-indexeddb'),dbName='chain-scanner-legacy-expiry-'+Date.now()+'-'+Math.random();
 const task={...syncTask('private-expiry-board','Private retained board'),futureHistory:{facts:['😀',{unknown:true}]}};
 const raw=JSON.stringify(syncState({tasks:[task],mode:'work',protectedBackupIds:protectedIds,futureData:{keep:'exact board facts'}}));
 const row=(id,kind='daily',day=PRIVATE_EXPIRY_OLD,extra={})=>({id,day,at:PRIVATE_EXPIRY_NOW-60*1000,kind,payload:raw,...extra});
 const rows=makeRows?makeRows(row,raw):[row('private-expired'),row('private-manual','manual'),row('private-unknown','future-recovery')];
 // An existing daily row prevents the released boot-time daily write from
 // rotating a readable fixture before the successful save under test.
 rows.push(row('private-today-daily','daily','2026-10-07'));
 const plain='[ '+rows.map(item=>JSON.stringify(item)).join(' ,\n ')+' ]',storage=sharedScannerStorage({[LOCAL_HEAD_KEY]:raw,[SYNC_STORE_KEY]:raw,[LOCAL_BACKUPS_KEY]:plain});
 const loaded=await loadApp({sharedStorage:storage,indexedDBProvider:indexedDB,deviceDbName:dbName,beforeStateReady:ctx=>setFakeTime(ctx,PRIVATE_EXPIRY_NOW)});
 setFakeTime(loaded.ctx,PRIVATE_EXPIRY_NOW);const store=loaded.shim.window.ScannerDeviceStore;
 assert.equal(loaded.ctx.deviceStorageActive(),true);if(packed)storage.setItem(LOCAL_BACKUPS_KEY,loaded.ctx.packBackupIndex(plain));
 const index=storage.getItem(LOCAL_BACKUPS_KEY),archives=JSON.stringify(await store.listOpaqueArchives());
 assert.ok(loaded.ctx.parseBackupIndex(index).some(item=>item.id.startsWith('private-expired')),'fixture retains an expired automatic entry before the save under test');
 return {...loaded,indexedDB,dbName,storage,store,row,rows,raw,plain,index,archives};
}
function privateExpiryLegacyRows(f){return f.ctx.parseBackupIndex(f.storage.getItem(LOCAL_BACKUPS_KEY));}
async function privateExpirySave(f){f.ctx.state.tasks[0].title+=' saved';return f.ctx.persist();}
async function privateExpiryAssertCurrentBoard(f){assert.equal((await f.store.readHead()).payload,JSON.stringify(f.ctx.state));assert.deepEqual(f.ctx.state.tasks[0].futureHistory,{facts:['😀',{unknown:true}]});}

function mountPrivateEditInterval(ctx,shim,task){
 ctx.openEdit(task.id);
 const markup=shim.document.getElementById('modalRoot').innerHTML;
 // The shim does not parse modal innerHTML: hydrate the emitted controls, then
 // dispatch through the app's registered listener rather than a copied helper.
 const value=markup.match(/id="etEverHours"[^>]*value="([^"]+)"/)[1];
 const unit=markup.match(/value="(hours|days)" selected/)[1];
 for(const [id,v] of [['etEverHours',value],['etEverUnit',unit]])Object.assign(shim.document.getElementById(id),{id,value:v,matches:()=>false});
 shim.document.getElementById('etEver').checked=true;
 shim.document.getElementById('etEverReset').checked=task.evergreenResetAtDay!==false;
 shim.document.getElementById('etTitle').value=task.title;
 return (id,value,type='change')=>{const field=shim.document.getElementById(id);field.value=value;shim.document.dispatchEvent({type,target:field});return field;};
}

function installPrivateDateValueDescriptors(shim){
 for(const id of ['addStart','addDue','etStart','etDue']){
  const input=shim.document.getElementById(id);let value=input.value;
  Object.defineProperty(input,'value',{configurable:true,get(){return value;},set(next){value=String(next);}});
 }
}

// Spec #2205 scaled review policy. The switch is the committed AGENTS.md
// wording below, read from the exact candidate head and base like the FAQ policy.
const SCALED_REVIEW_POLICY_TEXT='Release reviews scale to the exact diff. The release validator derives the\nplan, and the owner review records FAQ coverage for every product release.\n';
function makeScaledReviewFixture(options={}){
 const f=makeReleaseGateFixture();
 const write=files=>{for(const [file,text] of Object.entries(files)){const target=path.join(f.repo,file);if(text===null){fs.rmSync(target,{force:true});continue;}fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);}};
 const commit=message=>{releaseGateGit(f.repo,['add','--all']);releaseGateGit(f.repo,['commit','--allow-empty','-q','-m',message]);return releaseGateGit(f.repo,['rev-parse','HEAD']);};
 write({'AGENTS.md':options.agentsBase===undefined?SCALED_REVIEW_POLICY_TEXT:options.agentsBase,...options.base});f.baseSha=commit('Scaled review policy base');
 write({'AGENTS.md':options.agentsHead===undefined?SCALED_REVIEW_POLICY_TEXT:options.agentsHead,...options.candidate});f.candidateSha=commit('Scaled review policy candidate');
 f.treeSha=releaseGateGit(f.repo,['rev-parse',f.candidateSha+'^{tree}']);f.changedPath=Object.keys(options.candidate||{})[0]||'AGENTS.md';
 return f;
}
function scaledPlan(fields){
 return {schemaVersion:2,mode:'independent-review',requiresCodeReview:true,requiresFaqReview:false,requiresOwnerFaqCoverage:true,
  requiresSpecialistReview:false,requiresTypographyReview:false,specialistDomains:[],...fields};
}

const SCALED_FAQ_COVERAGE={result:'no-user-facing-change',summary:'The change alters no control, default or saved data the extended FAQ describes.'};

function chanceWeatherPaint(source=fs.readFileSync(path.join(__dirname,'landscape.js'),'utf8')){
 const start=source.indexOf('  function paintWeatherOn('),end=source.indexOf('\n  function paintRainCloud(',start),c=sceneTimeline(),strokes=[];
 const context=vm.createContext({T:c.LandscapeTimeline,sceneSeed:'chance-bolts',Math,W:390,H:844,hy:410,p:{night:1},world:{elapsed:0},sceneSeason:'summer',treeOrigins:[],geometry:{},reduced:false,
  LandscapeSeasonal:{paint(){}},document:{documentElement:{dataset:{}}},rand:()=>.2,paintRainCloud(){},ellipse(){},line(...args){strokes.push(args);}});
 vm.runInContext(source.slice(start,end),context);
 const ctx={save(){},restore(){},createLinearGradient(){return {addColorStop(){}};},fillRect(){}};
 return {context,strokes,paint(weather,phase){strokes.length=0;context.paintWeatherOn(ctx,weather,phase,false,false,false);return strokes.length;}};
}

function sharedSkywriterConsumer(seen=false,empty=false,source=fs.readFileSync(path.join(__dirname,'landscape.js'),'utf8')){
 const mood=moodRuntime();mood.setHumanText(empty?'## Skywriters':'## Skywriters\n- HELLO');if(seen)mood.recordSeen('HELLO');
 const event={id:'arrival:123',type:'skywriter',age:35,duration:70,seed:.4,lane:.3,reverse:false},flights=[];
 const start=source.indexOf('  function syncScene('),end=source.indexOf('\n  function advanceRooftopParty(',start);
 const context=vm.createContext({LandscapeMood:mood,globalThis:{LivingLocation:{current:()=>null}},S:{readSceneTime:()=>null,readSceneSeason:()=>null},sceneStorage:{},sceneSeason:'summer',timelineKey:'["summer",null,null,null]',
  timeline:{at:()=>({elapsed:123,events:[{...event}],woodland:[],party:null,clocktower:null})},world:{events:[]},woodland:{},rooftopRoofs:[],rooftopParty:{},clocktowerVisit:{},Intl,Date,Math});
 vm.runInContext(source.slice(start,end),context);context.syncScene(123000);const selected=context.world.events[0];
 const branch=source.slice(source.indexOf("    if(e.type==='skywriter'){"),source.indexOf("    if(e.type==='banner'){"));
 const paint=vm.createContext({e:selected,reduced:false,f:.5,x:100,hy:410,W:390,dir:1,t:123,p:{night:0},S:{smooth:()=>0},g:{save(){},restore(){},translate(){},scale(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},rotate(){}},visibleBanners:[],airplane(...args){flights.push(args);},LandscapeSkywriter:{wordPath:word=>word?{width:100}:null,trace:()=>({segments:[],x:10,y:10,angle:0,complete:false})}});
 vm.runInContext(`(function(){${branch}})()`,paint);
 return {selected,flights,context,paintContext:paint,paintSource:branch};
}

async function overdueWoopFixture(){
 const app=await loadApp({seed:971}),{ctx}=app;
 const base=ctx.addTask('Private benchmark'),task=ctx.addTask('Private overdue',false,[],{due:ctx.todayISO(-1)});
 ctx.dotTask(base.id);ctx.onAction('start-scan',{dataset:{}});ctx.state.candidateId=task.id;ctx.renderScan();
 return {...app,base,task};
}
function overdueWoopControl(app){
 const html=app.shim.document.getElementById('scan').innerHTML;
 const tag=html.match(/<button[^>]*data-act="run-woop"[^>]*>/)?.[0];assert.ok(tag,'overdue offered task must expose Run WOOP');
 return {dataset:Object.fromEntries([...tag.matchAll(/data-([a-z]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]))};
}


// A finite display recipe is not another admission reservation. The source bound
// covers at most one ordinary draw per eight seconds and independent short streams.
function pedestrianReservationPolicy(source){
 // Apply only the approved accounting correction to immutable historical
 // planner implementations; preserve their distinct RNG, cache and rare guards.
 assert.ok(source.includes('active.push({end});'),'historical fixture must expose its original full-life reservation');
 return source.replace('active.push({end});','active.push({end:e.start+reservationDuration(e)});');
}

function pedestrianDaytimeSpawnPolicy(source){
 // Historical planner comparisons isolate scheduling optimizations from the
 // requested later rate change. Keep whole-scene equality and every budget;
 // the separate rate test still uses its unmodified, pinned released baseline.
 const marker='return {events,woodland};';
 assert.equal(source.split(marker).length,2,'historical planner exposes one final post-admission scene boundary');
 const people=['cyclist','walker','dogwalker','reader','picnic','couple','kite','skateboarder','rollerskater','hoverboard','scooter','jetski','windsurfer','sailboat','hangglider','snowman','skier','snowangel'];
 return source.replace(marker,`return {events:events.filter(e=>!${JSON.stringify(people)}.includes(e.type)||sunAt(e.start).altitude<-6||sample(seed,'daytime-human-visit',e.id)<.5),woodland};`);
}

function assertPedestrianReservationBound(scene){
 const reserving=scene.events.filter(e=>e.age<(e.scheduleDuration||e.activityDuration||e.duration));
 assert.ok(reserving.length<=14,`shared admission has ${reserving.length} reservations`);
 assert.ok(scene.events.length<=345,`finite crossing recipes exceed derived bound: ${scene.events.length}`);
}

function pedestrianFrameSelection(visits,world,geometry,reduced=false,poseOther=event=>event){
 const calls=[],selected=visits.forPaint(world.events,geometry,reduced,{poseOther:event=>{calls.push(event.id);return poseOther(event);}});
 return {selected,calls};
}

function pedestrianPresentationConsumer(source,geometry,reduced=false,visits){
 const paintStart=source.indexOf('  function paintLife('),selection=source.slice(source.indexOf('    const paintEvents=',paintStart),source.indexOf('    const weather=',paintStart));
 const poseStart=source.indexOf('  function scenePose('),pose=source.slice(poseStart,source.indexOf('  function syncScene(',poseStart));
 const context=vm.createContext({world:{events:[]},geometry,reduced,visits});
 vm.runInContext(pose+`globalThis.selectPaintEvents=function(){${selection};return paintEvents;};`,context);
 return {context,select(events,nextGeometry=geometry,nextReduced=reduced){context.world={events};context.geometry=nextGeometry;context.reduced=nextReduced;return vm.runInContext('selectPaintEvents()',context);}};
}

// Replay actual canvas transforms and paint bounds. Tracking-camera ground marks
// are diagnostic ink; exclude only their documented gray color, not actor shapes.
function paintedMotionWorldXs(frame){
 let state={m:[1,0,0,1,0,0],alpha:1,fill:'',stroke:''},stack=[],path=[],xs=[];
 const point=(x,y)=>state.m[0]*x+state.m[2]*y+state.m[4];
 const multiply=n=>{const m=state.m;state.m=[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];};
 const paint=kind=>{if(state.alpha>1e-8&&state[kind]!=='#819b8d')xs.push(...path.map(x=>x-180+frame.metadata.x));};
 for(const [op,...a]of frame.commands){
  if(op==='save')stack.push({...state,m:[...state.m]});else if(op==='restore')state=stack.pop();
  else if(op==='translate')multiply([1,0,0,1,a[0],a[1]]);else if(op==='scale')multiply([a[0],0,0,a[1],0,0]);else if(op==='rotate')multiply([Math.cos(a[0]),Math.sin(a[0]),-Math.sin(a[0]),Math.cos(a[0]),0,0]);
  else if(op==='set'){if(a[0]==='globalAlpha')state.alpha=a[1];else if(a[0]==='fillStyle')state.fill=a[1];else if(a[0]==='strokeStyle')state.stroke=a[1];}
  else if(op==='beginPath')path=[];else if(['moveTo','lineTo'].includes(op))path.push(point(a[0],a[1]));
  else if(op==='quadraticCurveTo'||op==='bezierCurveTo'){for(let i=0;i<a.length;i+=2)path.push(point(a[i],a[i+1]));}
  else if(op==='ellipse'){const x=point(a[0],a[1]),extent=Math.abs(state.m[0])*a[2]+Math.abs(state.m[2])*a[3];path.push(x-extent,x+extent);}
  else if(op==='fill'||op==='stroke')paint(op);
  else if(op==='fillRect'){path=[point(a[0],a[1]),point(a[0]+a[2],a[1]),point(a[0],a[1]+a[3]),point(a[0]+a[2],a[1]+a[3])];paint('fill');}
 }
 return xs;
}

// Isolated original mixed-release replay: current typed light choice, then the
// released pre-decision client saved dark while retaining that exact choice.
function heldDecisionFixture188(){return {"local":{"v":2,"tasks":[{"id":"a","title":"Fixture A","url":null,"due":null,"evergreen":false,"ctx":[],"mu":25,"sigma":8.333333333333334,"done":false,"createdAt":1,"completedAt":null,"lastDoneAt":null,"startsAt":null,"prerequisiteRevision":0,"prerequisiteIds":[],"prerequisiteId":null,"prerequisiteMirror":null,"prerequisiteOps":{},"evergreenHours":18,"evergreenResetAtDay":true}],"contexts":[],"chain":[],"considered":{},"cantAt":{},"workedAt":{},"candidateId":null,"workLog":[],"interventionActive":false,"interventionP":0,"snooze":0,"mode":"scan","decisionsMs":[],"presentedAt":0,"passStartedAt":1792321140000,"listOpen":false,"ctxOpen":true,"histOpen":false,"seenQuickStart":true,"updatedAt":1792321201000,"settings":{"horizonMin":60,"thresholdPct":25,"samples":250,"cantMin":30,"workedHours":16,"postponeHours":1,"evergreenHours":18,"evergreenResetAtDay":true,"scanMode":"squared","squaredDefaultVersion":1,"listMetric":"rank","excludeNoContext":false,"lastTaskWoop":false,"floatingHeader":false,"patternedIndicators":false,"showPostpone":true,"theme":"dark","dateFormat":"system","hourlyQuotes":{},"scene":{"time":null,"season":null,"location":null},"skipOldestFirstDot":false},"passId":"mixed-rollout","scanMode":"descending","syncAccount":"e@example.com","syncRev":4,"syncDirty":true,"deletionLog":[],"deletedTaskIds":{},"clearedHistoryIds":{},"restoredTaskIds":{},"restoredHistoryIds":{},"restoredTaskOps":{},"restoredHistoryOps":{},"deletedAfterRestoreOps":{},"clearedAfterRestoreOps":{},"chance":null,"addOpen":true,"decisionBase":{"v":1,"id":"db1:ef0eff3a10121ebe968caa55bd33d2bb","account":"e@example.com","revision":4,"payload":"{\"v\":2,\"tasks\":[{\"id\":\"a\",\"title\":\"Fixture A\",\"url\":null,\"due\":null,\"evergreen\":false,\"ctx\":[],\"mu\":25,\"sigma\":8.333333333333334,\"done\":false,\"createdAt\":1,\"completedAt\":null,\"lastDoneAt\":null,\"startsAt\":null,\"prerequisiteRevision\":0,\"prerequisiteIds\":[],\"prerequisiteId\":null,\"prerequisiteMirror\":null,\"prerequisiteOps\":{},\"evergreenHours\":18,\"evergreenResetAtDay\":true}],\"contexts\":[],\"chain\":[],\"considered\":{},\"cantAt\":{},\"workedAt\":{},\"candidateId\":null,\"workLog\":[],\"interventionActive\":false,\"interventionP\":0,\"snooze\":0,\"mode\":\"scan\",\"decisionsMs\":[],\"presentedAt\":0,\"passStartedAt\":1792321140000,\"listOpen\":false,\"ctxOpen\":true,\"histOpen\":false,\"seenQuickStart\":true,\"updatedAt\":0,\"settings\":{\"horizonMin\":60,\"thresholdPct\":25,\"samples\":250,\"cantMin\":30,\"workedHours\":16,\"postponeHours\":1,\"evergreenHours\":18,\"evergreenResetAtDay\":true,\"scanMode\":\"squared\",\"squaredDefaultVersion\":1,\"listMetric\":\"rank\",\"excludeNoContext\":false,\"lastTaskWoop\":false,\"skipOldestFirstDot\":false,\"floatingHeader\":false,\"patternedIndicators\":false,\"showPostpone\":true,\"theme\":\"system\",\"dateFormat\":\"system\",\"hourlyQuotes\":{},\"scene\":{\"time\":null,\"season\":null,\"location\":null}},\"passId\":\"mixed-rollout\",\"scanMode\":\"descending\",\"deletionLog\":[],\"deletedTaskIds\":{},\"clearedHistoryIds\":{},\"restoredTaskIds\":{},\"restoredHistoryIds\":{},\"restoredTaskOps\":{},\"restoredHistoryOps\":{},\"deletedAfterRestoreOps\":{},\"clearedAfterRestoreOps\":{},\"chance\":null,\"addOpen\":true}"},"decisionBaseline":{"v":1,"account":"e@example.com","sourceBaseId":"db1:ef0eff3a10121ebe968caa55bd33d2bb","sourceRevision":4,"includedActionIds":[],"ratings":[{"taskId":"a","mu":25,"sigma":8.333333333333334}],"chainIds":[],"passId":"mixed-rollout","passAt":1792321140000,"considered":{},"cantAt":{},"workedAt":{},"observedRatingHistoryIds":[],"id":"dlb2:6b9e4e304cf1e2aa3f14f7dfde0b3097"},"decisionEvents":[{"v":1,"id":"te9703fc8-b286-48a2-ac2b-b42b9c803f19","at":1792321200000,"account":"e@example.com","baseId":"db1:ef0eff3a10121ebe968caa55bd33d2bb","kind":"current-choice","actionId":"tfa255a29-fb5d-40f6-ab66-73248fed8170","target":{"type":"setting","id":"board","property":"theme"},"value":"light","after":{"present":true},"before":{"present":true,"value":"system"},"passId":"mixed-rollout","passAt":1792321140000,"scanMode":"descending","chainIds":[],"observedActionIds":[]}]},"remote":{"v":1,"tasks":[{"id":"a","title":"Fixture A","url":null,"due":null,"evergreen":false,"ctx":[],"mu":25,"sigma":8.333333333333334,"done":false,"createdAt":1,"completedAt":null,"lastDoneAt":null}],"contexts":[],"chain":[],"considered":{},"cantAt":{},"workedAt":{},"candidateId":null,"workLog":[],"interventionActive":false,"interventionP":0,"snooze":0,"mode":"idle","decisionsMs":[],"presentedAt":0,"passStartedAt":1792321140000,"listOpen":false,"ctxOpen":true,"histOpen":false,"seenQuickStart":true,"updatedAt":0,"settings":{"horizonMin":60,"thresholdPct":25,"samples":250,"cantMin":30,"workedHours":8,"theme":"system"},"passId":"mixed-rollout","scanMode":"descending","syncAccount":"e@example.com","syncRev":4,"syncDirty":false},"rev":4,"producer":{"current":"52d4b25","old":"69a9fed","actions":["current cycle-theme system to light","old cycle-theme light to dark"]}};}
async function heldDecisionApp188(t,{fixture=heldDecisionFixture188(),failures={},storageBackend="indexedDB",timeoutMs=5000,timerProvider=null,recoveryTimeoutMs=timeoutMs,artifacts=null,nativeDeviceConnection=false}={}){
 const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory(),deviceDbName='held-choice-188-'+Math.random(),idbFault={};
 // Connection-lifecycle consumers need the native transaction.db identity;
 // the optional per-write fixture proxies below do not preserve that identity.
 const indexedDB=nativeDeviceConnection?factory:{open(...args){const request=factory.open(...args);return new Proxy(request,{
  get(target,key){
   if(key==='result'){const db=Reflect.get(target,key,target);if(!db?.transaction)return db;return new Proxy(db,{get(target,key){
    if(key!=='transaction'){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}
    return(names,mode,...rest)=>{
     const stores=typeof names==='string'?[names]:Array.from(names);
     if(idbFault.readBackups&&mode==='readonly'&&stores.includes('backups'))throw Object.assign(Error('fixture storage read unavailable'),{name:'AbortError'});
     const tx=target.transaction(names,mode,...rest);
     if(mode==='readonly')tx.addEventListener('complete',()=>idbFault.afterReadTransaction?.(stores));
     if(mode==='readwrite')tx.addEventListener('complete',()=>idbFault.afterWriteTransaction?.(stores));
     if(mode!=='readwrite'||!stores.includes('backups')&&!stores.includes('opaque'))return tx;
     return new Proxy(tx,{get(target,key){
      if(key==='objectStore')return name=>{const store=target.objectStore(name);return new Proxy(store,{get(target,key){
       if(key==='put'&&name==='backups')return(...args)=>{const result=target.put(...args);if(idbFault.abortBackup){idbFault.aborts=(idbFault.aborts||0)+1;tx.abort();}return result;};
       if(key==='put'&&name==='meta')return(...args)=>{const result=target.put(...args);if(args[1]==='head'&&idbFault.afterHeadCommit)tx.addEventListener('complete',()=>idbFault.afterHeadCommit());if(idbFault.abortHead&&args[1]==='head'){idbFault.aborts=(idbFault.aborts||0)+1;tx.abort();}return result;};
       if(key==='put'&&name==='opaque')return(...args)=>{const result=target.put(...args);if(idbFault.abortOpaque){idbFault.aborts=(idbFault.aborts||0)+1;tx.abort();}return result;};
       const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
     },set(target,key,value){return Reflect.set(target,key,value,target);}});
    };
   }});}
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  },set(target,key,value){return Reflect.set(target,key,value,target);}
 });}};
 // #2281 CI: teardown deletes the database through this object to release its
 // in-memory rollback logs; without deleteDatabase every such release threw.
 if(!nativeDeviceConnection)indexedDB.deleteDatabase=(...args)=>factory.deleteDatabase(...args);
 const localRaw=JSON.stringify(fixture.local),cloudRaw=fixture.remote===null?null:JSON.stringify(fixture.remote);
 const app=await loadAppAtTime(1792323000000,{...(artifacts?{artifacts,appSource:extractAppScript(artifacts.html)}:{}),seed:188,seedStorage:{[SYNC_STORE_KEY]:localRaw,[LOCAL_HEAD_KEY]:localRaw},...(storageBackend==='indexedDB'?{indexedDBProvider:indexedDB,deviceDbName}:{})});
 if(!app.ctx.window.ChainStorageV2){vm.runInContext(fs.readFileSync(path.join(__dirname,'device-store-v2.js'),'utf8'),app.ctx,{filename:'device-store-v2.js'});app.ctx.window.ChainStorageV2=app.ctx.ChainStorageV2;}
 failures.authPending=true;
 const backend=await loadCloudBackendV2({artifacts,rootData:cloudRaw===null?null:{payload:cloudRaw,updatedAt:fixture.remote.updatedAt,rev:fixture.rev,serverUpdatedAt:1},failures,timeoutMs,timerProvider,recoveryTimeoutMs,recordSyncError:app.ctx.recordSyncError,runtimeWindow:app.ctx.window});
 backend.emitAuth({uid:'owner',email:'e@example.com'});app.ctx.window.CLOUD_PUSH_DELAY_MS=0;
 t.after(async()=>{backend.CS.suspend();vm.runInContext('clearCloudRetry();clearTimeout(cloudTimer)',app.ctx);await app.ctx.window.ScannerDeviceStore?.close?.();});
 await app.ctx.cloudPull();
 return {...app,backend,localRaw,cloudRaw,indexedDB,deviceDbName,idbFault};
}
async function settleRecovery188(app){
 const end=Date.now()+5000;
 while(Date.now()<end){
  // A verifier read mutates the fake backend's shared status. Let the real
  // owner finish, including a scheduled retry, before verifying its ACK.
  if(app.ctx.state.syncDirty||vm.runInContext('pulling||cloudPushInFlight||cloudRetryTimer!==null',app.ctx)){await new Promise(resolve=>setTimeout(resolve,5));continue;}
  const remote=await app.backend.CS.pull(),head=app.ctx.window.ScannerDeviceStore?await app.ctx.window.ScannerDeviceStore.readHead():{payload:app.shim.localStorage.getItem(LOCAL_HEAD_KEY)};
  if(!app.ctx.state.syncDirty&&remote?.payload===app.ctx.cloudPayload()&&remote.rev===app.ctx.state.syncRev&&head.payload===JSON.stringify(app.ctx.state))return {remote,head};
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 assert.fail('recovery must reach an actual remote ACK and an exact durable local head');
}


function recoveryReleasedArtifacts188(sha){
 return Object.fromEntries([['html','index.html'],['storage','device-store-v2.js'],['cloud','cloud-store-v2.js']].map(([key,file])=>{
  const source=spawnSync('git',['show',sha+':'+file],{cwd:__dirname,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(source.status,0,source.stderr);return [key,source.stdout];
 }));
}
async function settleRecoveryOperations188(ctx){
 for(let n=0;n<1000&&vm.runInContext('pulling||cloudPushInFlight||!!cloudTimer',ctx);n++)await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal(vm.runInContext('pulling||cloudPushInFlight||!!cloudTimer',ctx),false,'ordinary app operations reach a settled observation');
}

function retainedWorkerCacheHarness(){
 const origin='https://scanner.example',worker=serviceWorkerSource(),current=appShellContract(worker).cacheName;
 const previous='chain-scanner-shell-retained-predecessor',handlers={},network=[];
 const key=request=>new URL(typeof request==='string'?request:request.url,origin+'/').href;
 const entries=values=>new Map(Object.entries(values).map(([url,body])=>[key(url),body]));
 const records=new Map([
  [previous,entries({'/':'PREDECESSOR HTML','/index.html':'PREDECESSOR HTML','/device-store-v2.js':'PREDECESSOR MODULE','/old-only.js':'PREDECESSOR ONLY MODULE'})],
  [current,entries({'/':'CURRENT HTML','/index.html':'CURRENT HTML','/device-store-v2.js':'CURRENT MODULE'})],
  ['unrelated-cache',entries({'/':'UNRELATED HTML'})],
 ]);
 let offline=false,claims=0,skips=0;
 const caches={
  async keys(){return [...records.keys()];},
  async delete(name){if(name===previous)throw Object.assign(Error('Synthetic external cache retirement failure'),{name:'UnknownError'});return records.delete(name);},
  async open(name){if(!records.has(name))records.set(name,new Map());return {async put(request,response){records.get(name).set(key(request),await response.clone().text());}};},
  async match(request,options={}){
   const names=options.cacheName===undefined?[...records.keys()]:[options.cacheName];
   for(const name of names){const body=records.get(name)?.get(key(request));if(body!==undefined)return new Response(body);}
  },
 };
 vm.runInNewContext(worker,{caches,URL,Request,console,
  fetch:async request=>{const url=key(request);network.push(url);if(offline)throw TypeError('Synthetic offline transport');return new Response('NETWORK:'+new URL(url).pathname);},
  self:{location:{origin},addEventListener(type,handler){handlers[type]=handler;},skipWaiting(){skips++;return Promise.resolve();},clients:{claim(){claims++;return Promise.resolve();}}},
 },{filename:'sw.js'});
 return {handlers,records,network,current,previous,setOffline(value){offline=value;},claims:()=>claims,skips:()=>skips,
  async request(url,mode='cors'){
   let response;handlers.fetch({request:{url:new URL(url,origin+'/').href,method:'GET',mode},respondWith(value){response=value;}});
   assert.ok(response,'the actual worker fetch consumer must handle this same-origin request');return response;
  },
 };
}

// Manual review owns the default: finish the real setup Add save, then return
// the unchanged original before any app recovery. Automatic consumers explicitly
// request input assembly and enter via their own cloudPull/cold bootstrap below;
// this fixture never starts a second recovery owner on their behalf.
async function divergentCloudSourceApp187(t,options={}){
 const phase=options.phase??'manual-review';
 assert.ok(['manual-review','automatic-inputs'].includes(phase),'explicit recovery fixture phase');
 options={...options,settleDeviceBeforeCloud:options.settleDeviceBeforeCloud??phase==='manual-review'};
 const app=await damagedAcknowledgedApp187(t,options),{ctx,shim,backend,originalRoot}=app;
 if(options?.settleDeviceBeforeCloud)t.after(()=>app.dispose());
 const path='users/owner/generations/'+originalRoot.activeGeneration;
 backend.docs.set(path,{...backend.docs.get(path),hash:'f'.repeat(64)});
 if(options?.settleDeviceBeforeCloud)ctx.window.CLOUD_PUSH_DELAY_MS=60000;
 if(options?.holdCloudPush)ctx.window.CLOUD_PUSH_DELAY_MS=60000;
 if(options.holdCloudPush)refuseNextRecoveryTransaction255(app.faults);
 shim.document.getElementById('addInput').value='Device source only';
 const schedule=ctx.setTimeout,cancel=ctx.clearTimeout,saveClock={elapsed:0,jobs:[]};
 if(options?.settleDeviceBeforeCloud){
  ctx.setTimeout=(fn,ms,...args)=>{
   if(ms!==350)return schedule(fn,ms,...args);
   const token={sourceFixtureClock:true},job={token,fn,args,at:saveClock.elapsed+ms,delay:ms,cancelled:false};saveClock.jobs.push(job);return token;
  };
  ctx.clearTimeout=token=>{const job=saveClock.jobs.find(row=>row.token===token);if(job)job.cancelled=true;else cancel(token);};
 }
 try{
  await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
  if(options?.settleDeviceBeforeCloud){
   assert.equal(saveClock.jobs.length,1,'the final native Add schedules exactly one ordinary save');const job=saveClock.jobs[0];assert.equal(job.delay,350);assert.equal(job.cancelled,false);
   saveClock.elapsed+=350;assert.equal(job.at,saveClock.elapsed,'advance only the setup save clock to its declared deadline');
   const saved=job.fn(...job.args);assert.equal(typeof saved?.then,'function','the actual scheduled callback must run its real persistence consumer');assert.equal(await fixtureDeadline(saved,'fixture final scheduled persist finishes before cloud controls'),true);
   await settleSourceFixtureSave187(app,'fixture final native save settles before cloud controls',true);
  }
 }finally{ctx.setTimeout=schedule;ctx.clearTimeout=cancel;}
 assert.equal((await backend.CS.pull()).code,'corrupt-generation');
 return app;
}

function retentionSDK253(F,db,{afterTransaction=null,beforeProtectionCommit=null}={}){
 const pending=new Set(),stats={reads:[]};
 const host=value=>Array.isArray(value)?Array.from(value,host):value?.constructor?.name==='Object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,host(item)])):value;
 const track=promise=>{pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;};
 const writer=object=>({get:ref=>object.get(ref),set:(ref,value)=>object.set(ref,host(value)),update:(ref,value)=>object.update(ref,host(value)),delete:ref=>object.delete(ref)});
 const sdk={...F,getFirestore:()=>db,runTransaction:(database,callback)=>track(F.runTransaction(database,async tx=>{const port=writer(tx),set=port.set;let protecting=false;port.set=(ref,value)=>{if(ref.path.includes('/recoveryProtections/'))protecting=true;return set(ref,value);};const result=await callback(port);if(protecting)await beforeProtectionCommit?.();return result;}).then(async result=>{await afterTransaction?.();return result;})),
  writeBatch(database){const batch=F.writeBatch(database);return {...writer(batch),commit:()=>track(batch.commit())};}};
 for(const key of ['getDoc','getDocs','getDocFromServer','getDocsFromServer'])sdk[key]=(...args)=>{stats.reads.push(args[0].path);return track(F[key](...args));};
 return {sdk,db,stats,async drain(){for(let idle=0;idle<30;){if(pending.size){idle=0;await Promise.allSettled([...pending]);}else idle++;await new Promise(resolve=>setImmediate(resolve));}}};
}

async function replaceIndependentServerPayload263(app,id,payload){
 const path='users/owner/generations/'+id,old=app.backend.docs.get(path),encoded=await app.ctx.ChainStorageV2.encodeSnapshot(payload);
 for(const key of [...app.backend.docs.keys()])if(key.startsWith(path+'/chunks/'))app.backend.docs.delete(key);
 app.backend.docs.set(path,{state:'published',baseRev:app.backend.docs.get('users/owner')?.rev??0,createdAt:{toMillis:()=>1},...old,...encoded,chunks:undefined});delete app.backend.docs.get(path).chunks;
 for(const chunk of encoded.chunks)app.backend.docs.set(path+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk);
}

export {
  appFixtureScope, test, injectRecoveryDatabaseFailure187, editRawDevice187, deviceFaultProvider187,
  partialSavedBoard187, refuseNextRecoveryTransaction255, damagedAcknowledgedApp187,
  automaticSourceLifecycle254, automaticDefaultApp251, recoveryReadClock187,
  settleSourceFixtureSave187, freshSourceCheckFixture187, inspectCompleteSource230,
  waitForNativeHistoryAck226, runNativeRecoveryInspection226, runNativeRecoveryInspectionMatrix226,
  rewriteGenerationFixture, conflictingPriorGeneration2201, coldDamagedSourceWithoutAck214,
  APOLOGY_NOTICE_ID, ORIGINAL_APOLOGY, channelReleaseEnvelope, LEGACY_COMPLETION_RELEASE,
  legacyCompletionSource173, closeLegacyApp173, upgradedLegacyApp173, releasedExpiryStartSource173,
  scopedUndoClients, woopFixture, woopStep, woopDislodgeTwice, ratingHistoryCopy, ratingHistoryTask,
  ratingHistoryFixture, __dirname, HTML_PATH, html, lzStringSrc, sceneTimelineScripts,
  runSceneTimelineScript, sceneTimeline, livingSky, livingLocation, landscapeLuminance,
  manifestHrefFromHtml, serviceWorkerSource, appShellContract, serviceWorkerHarness, slice, engineSrc,
  mulberry32, SEED_SNIPPET, loadEngine, readConst, extractAppScript, appSrc, makeFakeElement,
  makeDomShim, flush, loadApp, setFakeTime, realNow, publishedBetaContinuation, SAVE_DEBOUNCE_MS,
  settle, persisted, makeFakeCloudSyncFactory, setInput, WH_STORE_KEY, preChangeState, localAt,
  addTaskAged, titleOf, scanHtmlOf, benchAction, fillEditPane, STORE_KEY, THEME_HINT_KEY, themeBootSrc,
  runThemeBoot, themeBtnText, styleSrc, COLOR_RE, WHITE_RE, INVARIANT_PROPS, ALLOWED_DECLS,
  declarations, lightDarkArgs, offendingDeclarations, ALLOWED_NON_ASCII, decodeEscapes, themeTokens,
  channel, luminance, contrast, CONTRAST_PAIRS, openList, listHTML, listCount, selectedListIds,
  tagRowHTML, litTags, deferredSyncFixture, fixtureDeadline, observeSyncFixtureCalls,
  observeQueuedNativeSaves, holdNextSyncFixturePush, settleSavedViewPublication,
  delayedLocalBoardBrowser, openingBoardSelfHosted, openingBoardFixture, invisibleSavedViewBrowser,
  tagLabels, tagKeys, clickTag, rowTitles, SYNC_STORE_KEY, LOCAL_HEAD_KEY, LOCAL_BACKUPS_KEY,
  DEVICE_AUTHORITY_KEY, HOUR, sharedScannerStorage, loadCloudBackend, loadCloudBackendV2,
  cloudAdapterCryptoGate, releaseCloudAdapterCryptoAfterDeadline, decodeManualArchiveTypedValue,
  backupFileFixtures, loadBackupFileFixtureApp, prepareBackupFileFixtureSource, syncTask, syncState,
  saveEditorChoice, loadAppAtTime, loadAppPinningNewDate, hydrateUnchangedEditorDraft, STALE_CHAIN, staleState, CLOUD_CHAIN,
  cloudState, makeSyncHarness, decisionRecoveryApp146, mixedSharedOutcome146,
  recordMixedDecisionActions146, decisionMixedActionsApp146, syncSettle, PAST_DEBOUNCE, doneTitles,
  seedDuplicateCompletion, renamedCloud, titlesOf, workedLog, MORNING, EVENING, DAY_BEFORE,
  seedWorkLog, moodRuntime, atNoon, hourLabel, nativeSource, runNativeInstall, loadSeasonalRepair,
  seasonalRepairCanvas, seasonalRepairPalette, seasonalRepairNight, seasonalRepairWeather,
  seasonalRepairRain, seasonalRepairStorm, seasonalRepairSnow, seasonalRepairSnowstorm,
  seasonalEnvelopeRuntime, chanceProbabilityFixture, pwaUpdateHarness, updateNoticeKey, releaseMarkup,
  releaseFingerprint, prepareReleaseNotice, SOLAR_AUDIT_FIXTURES, changeQuickEvergreen, releaseGateGit,
  releaseGateHash, releaseGateCanonicalJson, releaseGateReseal, makeReleaseGateFixture,
  releaseGateInput, cleanupReleaseGateFixture, riskBasedReleaseInput, testSurfaceSource,
  recoveringCloudStatusHarness, recentDeletionAt, deletionEvidence, repeatedDeletionBoard,
  loadStorageV2, loadCloudV2, cloudV2Payload, cloudV2Adapter, CAPTURED_UNREADABLE_GENERATION,
  syntheticBoardOfBytes, capturedUnreadableGenerationFixture, CAPTURED_RECOVERY_BUDGET_MS,
  LARGE_BOARD_SHAPE, largeBoardFixture, webProcessMemoryEnv, webProcessMemorySampler,
  largeSignedInBoardFixture,
  CAPTURED_RESULT_BUDGET_MS, largeSerializedBytes2198, CAPTURED_PHONE_SERIALIZATION_BYTES,
  exactPaddedBoard, capturedGenerationAcceptedApp2198, RECORDED_HEALTHY_STATUS_8CD524A,
  RECORDED_HEALTHY_READS_8CD524A, faithfulModalQuery2194, declineButton2194,
  pendingAutomaticDefault2194, coldRelaunch2198, syncStatus2200, decisionBackend146,
  decisionCandidate146, exerciseCompletionEditorBoundaries, liveScanSyncClients,
  delayedEvergreenReadFixture, liveDoneDeliverySnapshot, ordinaryEditDebounceControl,
  liveModeDeliverySnapshot, settleLiveModePublication, releasedDependencyHydrator, MODE_LIFECYCLE_NOW,
  modeLifecycleCopy, modeLifecycleEdit, modeLifecycleWaitFor, privateMigratedDeleteFixture,
  privateRewriteDurableBackup, privateVisibleBackupRows, privateClickBackupDelete,
  privateAssertBackupSurvives, PRIVATE_EXPIRY_NOW, PRIVATE_EXPIRY_OLD, privateLegacyExpiryFixture,
  privateExpiryLegacyRows, privateExpirySave, privateExpiryAssertCurrentBoard,
  mountPrivateEditInterval, installPrivateDateValueDescriptors, SCALED_REVIEW_POLICY_TEXT,
  makeScaledReviewFixture, scaledPlan, SCALED_FAQ_COVERAGE,
  chanceWeatherPaint, sharedSkywriterConsumer, overdueWoopFixture, overdueWoopControl,
  pedestrianReservationPolicy, pedestrianDaytimeSpawnPolicy, assertPedestrianReservationBound,
  pedestrianFrameSelection, pedestrianPresentationConsumer, paintedMotionWorldXs,
  heldDecisionFixture188, heldDecisionApp188, settleRecovery188, recoveryReleasedArtifacts188,
  settleRecoveryOperations188, retainedWorkerCacheHarness, divergentCloudSourceApp187, retentionSDK253,
  replaceIndependentServerPayload263,
};
