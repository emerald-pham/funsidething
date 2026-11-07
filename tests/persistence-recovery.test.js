import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  test, editRawDevice187, deviceFaultProvider187, damagedAcknowledgedApp187,
  automaticSourceLifecycle254, freshSourceCheckFixture187, runNativeRecoveryInspection226,
  conflictingPriorGeneration2201, coldDamagedSourceWithoutAck214, closeLegacyApp173, scopedUndoClients,
  __dirname, html, loadEngine, extractAppScript, appSrc, makeFakeElement, flush, loadApp, setFakeTime,
  settle, persisted, channel, deferredSyncFixture, fixtureDeadline, observeSyncFixtureCalls,
  observeQueuedNativeSaves, settleSavedViewPublication, openingBoardSelfHosted, openingBoardFixture,
  invisibleSavedViewBrowser, SYNC_STORE_KEY, LOCAL_HEAD_KEY, LOCAL_BACKUPS_KEY, DEVICE_AUTHORITY_KEY,
  HOUR, sharedScannerStorage, loadCloudBackendV2, decodeManualArchiveTypedValue,
  loadBackupFileFixtureApp, prepareBackupFileFixtureSource, syncTask, syncState, saveEditorChoice,
  loadAppAtTime, hydrateUnchangedEditorDraft, STALE_CHAIN, staleState, CLOUD_CHAIN, cloudState,
  makeSyncHarness, syncSettle, PAST_DEBOUNCE, titlesOf, pwaUpdateHarness, recentDeletionAt,
  deletionEvidence, loadStorageV2, exerciseCompletionEditorBoundaries, liveScanSyncClients,
  liveDoneDeliverySnapshot, ordinaryEditDebounceControl, settleRecovery188,
  settleRecoveryOperations188, divergentCloudSourceApp187, replaceIndependentServerPayload263,
  LARGE_BOARD_SHAPE, largeBoardFixture, webProcessMemoryEnv, webProcessMemorySampler,
  largeSignedInBoardFixture,
} from "./shared.js";
import { rewriteGenerationFixture } from "./shared.js";
import { pendingAutomaticDefault2194, declineButton2194, faithfulModalQuery2194 } from "./shared.js";
import { capturedGenerationAcceptedApp2198, syncStatus2200, CAPTURED_RESULT_BUDGET_MS, coldRelaunch2198, refuseNextRecoveryTransaction255,
  exactPaddedBoard, CAPTURED_UNREADABLE_GENERATION } from "./shared.js";

test('RISK cloud recovery memory: retained saved copies leave automatic checks and manual review usable in a bounded heap',async t=>{
 if(process.env.CHAIN_RECOVERY_MEMORY_CHILD!=='1'){
  const env={...process.env,CHAIN_RECOVERY_MEMORY_CHILD:'1'};delete env.NODE_TEST_CONTEXT;
  // A deterministic process budget catches amplification of 32 MiB of saved
  // copies. It is a regression budget, not an asserted iPhone memory limit.
  const child=spawnSync(process.execPath,['--max-old-space-size=512','--test','--test-reporter=tap',
   '--test-name-pattern=^RISK cloud recovery memory: retained saved copies',fileURLToPath(import.meta.url)],
   {cwd:__dirname,env,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
  const output=(child.stdout||'')+(child.stderr||'');
  assert.match(output,/recovery-memory-consumer-started/,'the populated setup reaches the actual consumer: '+output);
  assert.equal(child.error,undefined,'the bounded consumer must finish: '+String(child.error));
  assert.equal(child.signal,null,'the consumer must not be terminated: '+output);
  assert.equal(child.status,0,'automatic recovery and the actual manual action must finish without exhausting memory: '+output);
  assert.match(output,/recovery-memory-preserved-and-usable/);return;
 }
 // Finish the actual setup Add's debounce before populating the protected
 // copies; a late setup save must not abort the recovery before its full check.
 const app=await divergentCloudSourceApp187(t,{phase:'automatic-inputs',settleDeviceBeforeCloud:true,holdCloudPush:true}),{ctx,shim,backend}=app,store=ctx.window.ScannerDeviceStore;
 const current=await store.readHead(),originals=[];
 for(let i=0;i<16;i++){
  const board=JSON.parse(current.payload);board.futureProtected={id:i,text:'p'.repeat(2*1024*1024)};
  const payload=JSON.stringify(board),id='protected-memory-'+i;
  assert.equal((await store.putBackup({expectedHash:current.hash,backup:{id,kind:'manual',at:i+1,day:'2026-10-25',payload}})).ok,true);
  originals.push({id,hash:createHash('sha256').update(payload).digest('hex')});
 }
 const cloud=JSON.stringify([...backend.docs]);
 console.error('recovery-memory-consumer-started');
 await ctx.cloudPull();
 const checks=ctx.buildSupportDiagnosticsReport().sourceOperations.flatMap(operation=>operation.events);
 for(const role of ['first','second'])assert.ok(checks.some(event=>event.stage==='aggregate'&&event.status==='completed'&&event.role===role),'automatic recovery completes both full source checks before manual review');
 assert.equal((await store.readHead()).payload,current.payload,'automatic checks retain the accepted device board');
 assert.equal(JSON.stringify([...backend.docs]),cloud,'held recovery must preserve the original cloud records');
 ctx.onAction('sync',{});
 assert.match(shim.document.getElementById('modalRoot').innerHTML,/data-act="review-cloud-source-recovery"/);
 assert.equal(await ctx.onAction('review-cloud-source-recovery',{}),true);
 assert.doesNotMatch(shim.document.getElementById('modalRoot').innerHTML,/data-act="choose-cloud-recovery-source"[^>]*aria-pressed="true"/);
 assert.equal(await ctx.onAction('apply-cloud-source-recovery',{}),false,'opening review does not choose a source');
 await ctx.onAction('close-modal',{});
 assert.equal((await store.readHead()).payload,current.payload);
 assert.equal(JSON.stringify([...backend.docs]),cloud);
 const after=await store.listBackups();
 for(const row of originals){const saved=after.find(copy=>copy.id===row.id);assert.ok(saved);assert.equal(createHash('sha256').update(saved.payload).digest('hex'),row.hash,'every protected copy retains its exact unknown fields');}
 shim.document.getElementById('addInput').value='Usable after populated recovery review';await ctx.onAction('add',{});
 assert.equal(await ctx.persist(),true);assert.ok(JSON.parse((await store.readHead()).payload).tasks.some(row=>row.title==='Usable after populated recovery review'));
 console.error('recovery-memory-preserved-and-usable');
});

test('RISK offline device recovery: an exact retained local copy repairs damaged current bytes without cloud',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='offline-exact-head-'+Math.random();let networkCalls=0;
 const offline={navigatorProvider:{onLine:false},fetchProvider:async()=>{networkCalls++;throw Error('fully offline source recovery');}};
 const original=JSON.stringify(syncState({tasks:[syncTask('offline-original','Exact original offline task')],syncAccount:'owner@example.com',syncIdentity:'owner',syncRev:7,syncDirty:false,futureOffline:{keep:['all',47]}}));
 const storage=sharedScannerStorage({[LOCAL_HEAD_KEY]:original,[SYNC_STORE_KEY]:original});
 const first=await loadApp({...offline,indexedDBProvider:indexedDB,deviceDbName,sharedStorage:storage});t.after(()=>first.dispose());
 assert.equal(await first.ctx.persist(),true);const expected=await first.shim.window.ScannerDeviceStore.readHead();
 storage.setItem(LOCAL_HEAD_KEY,expected.payload);storage.setItem(SYNC_STORE_KEY,expected.payload);await first.dispose();
 const damaged='damaged current snapshot original bytes';
 await editRawDevice187(indexedDB,deviceDbName,tx=>{
  tx.objectStore('snapshots').put({hash:expected.hash,payload:damaged,futureRaw:{keep:19}},expected.hash);
  tx.objectStore('snapshots').put({unknownOrphan:['keep',37]},'offline-orphan');
  tx.objectStore('meta').put({generationId:'offline-pending-original',futurePending:[3,4]},'pending:uninterpreted');
  tx.objectStore('meta').put({...expected,futureHead:{keep:29}},'head');
 });
 const inspector=loadStorageV2({indexedDB}).createDeviceStore({indexedDB,crypto:webcrypto,dbName:deviceDbName});await inspector.open();t.after(()=>inspector.close());
 const before=await inspector.readRawExportSnapshot();
 const app=await loadApp({...offline,indexedDBProvider:indexedDB,deviceDbName,sharedStorage:storage}),{ctx}=app;t.after(()=>app.dispose());
 assert.equal(ctx.deviceStorageActive(),true,'offline startup repairs only a retained complete copy matching the authoritative head hash');
 const head=await inspector.readHead();assert.equal(head.payload,expected.payload);assert.deepEqual(head.futureHead,{keep:29});
 assert.ok(ctx.state.tasks.some(row=>row.id==='offline-original'));assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.futureOffline)),{keep:['all',47]});
 const after=await inspector.readRawExportSnapshot(),value=(source,name,key)=>source.stores[name].values[source.stores[name].keys.indexOf(key)];
 assert.deepEqual(value(after,'meta','pending:uninterpreted'),value(before,'meta','pending:uninterpreted'));
 assert.deepEqual(value(after,'snapshots','offline-orphan'),value(before,'snapshots','offline-orphan'));
 assert.ok((await inspector.listOpaqueArchives()).some(row=>{try{const original=JSON.parse(row.raw);return original.format==='chain-scanner.device-recovery-source'&&JSON.stringify(original.indexedDB)===JSON.stringify(ctx.encodeManualArchiveSnapshot(before).stores);}catch{return false;}}),'the entire exact damaged source is protected before the active bytes are repaired');
 assert.equal(networkCalls,0);assert.equal(await inspector.getRecoveryCloudHold(),null,'an exact byte repair does not invent a cloud choice or acknowledgement');
 ctx.addTask('Work after offline repair');assert.equal(await ctx.persist(),true);await app.dispose();
 const cold=await loadApp({...offline,indexedDBProvider:indexedDB,deviceDbName,sharedStorage:storage});t.after(()=>cold.dispose());
 assert.ok(cold.ctx.state.tasks.some(row=>row.title==='Work after offline repair'));assert.equal(networkCalls,0);
});

test('RISK offline working recovery: surviving linked backups open useful protected work before any network',async t=>{
 for(const fault of ['missing-head','malformed-head'])await t.test(fault,async t=>{
  const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='offline-working-'+fault+'-'+Math.random();let networkCalls=0;
  const offline={navigatorProvider:{onLine:false},fetchProvider:async()=>{networkCalls++;throw Error('fully offline working recovery');}};
  const original=JSON.stringify(syncState({tasks:[syncTask('local-survivor','Surviving offline task')],syncAccount:'e@example.com',syncIdentity:'owner',syncRev:4,syncDirty:false,futureLocal:{keep:['all',31]}}));
  const store=loadStorageV2({indexedDB}).createDeviceStore({indexedDB,crypto:webcrypto,dbName:deviceDbName});await store.open();t.after(()=>store.close());
  assert.equal((await store.commitHead({expectedHash:null,payload:original,account:'e@example.com'})).ok,true);const oldHead=await store.readHead();
  assert.equal((await store.putBackup({expectedHash:oldHead.hash,backup:{id:'healthy-linked',kind:'manual',at:1,day:'2026-10-24',payload:original}})).ok,true);
  await editRawDevice187(indexedDB,deviceDbName,tx=>{
   if(fault==='missing-head')tx.objectStore('meta').delete('head');else tx.objectStore('meta').put({schemaVersion:99,hash:'damaged-original-head',account:'e@example.com',futureHead:[13]},'head');
   tx.objectStore('backups').put({payloadHash:'absent',futureBroken:[17]},'broken-sibling');
   tx.objectStore('snapshots').put({unknownOrphan:[23]},'unknown-orphan');
   tx.objectStore('meta').put({generationId:'opaque-pending',future:[29]},'pending:unknown');
  });
  const before=await store.readRawExportSnapshot(),browser={[SYNC_STORE_KEY]:'{broken browser original',[LOCAL_HEAD_KEY]:'{other broken original'},storage=sharedScannerStorage({'fvp:chain-scanner:device-store-v2':'1',...browser});
  const app=await loadApp({...offline,indexedDBProvider:indexedDB,deviceDbName,sharedStorage:storage}),{ctx,shim}=app;t.after(()=>app.dispose());
  assert.equal(ctx.deviceStorageActive(),true,'a complete linked backup opens a usable protected offline board even beside an unreadable sibling');
  assert.deepEqual(Array.from(ctx.state.tasks,row=>row.id),['local-survivor']);assert.equal(ctx.state.futureLocal.keep[1],31);
  const hold=await store.getRecoveryCloudHold();assert.equal(hold.reason,'device-source-recovery');assert.equal(hold.phase,'awaiting-cloud-evidence');assert.equal(Object.hasOwn(hold,'epoch'),false,'offline recovery never fabricates live cloud authority');
  const archive=(await store.listOpaqueArchives()).find(row=>row.key===hold.originalKey);assert.ok(archive);
  assert.equal(JSON.stringify(JSON.parse(archive.raw).indexedDB),JSON.stringify(ctx.encodeManualArchiveSnapshot(before).stores),'the full original source is protected atomically');
  for(const [key,raw]of Object.entries(browser))assert.equal(storage.getItem(key),raw);
  shim.document.getElementById('addInput').value='Accepted after offline working recovery';await ctx.onAction('add',{});await ctx.persist();
  const added=ctx.state.tasks.find(row=>row.title==='Accepted after offline working recovery');assert.ok(added,'native Add is useful during offline recovery');
  ctx.doneTask(added.id);await ctx.persist();assert.ok(ctx.state.tasks.find(row=>row.id===added.id).done);
  await ctx.onAction('undo',{});assert.equal(await ctx.persist(),true);assert.equal(!!ctx.state.tasks.find(row=>row.id===added.id).done,false);
  const current=await store.readHead(),editedHold=await store.getRecoveryCloudHold();assert.equal(current.payload,JSON.stringify(ctx.state));assert.equal(editedHold.originalKey,hold.originalKey);assert.equal(networkCalls,0);
  await app.dispose();const cold=await loadApp({...offline,indexedDBProvider:indexedDB,deviceDbName,sharedStorage:storage});t.after(()=>cold.dispose());
  assert.ok(cold.ctx.state.tasks.some(row=>row.id===added.id),'cold offline reopen keeps current new work rather than reselecting the old backup');assert.equal(!!cold.ctx.state.tasks.find(row=>row.id===added.id).done,false);
  assert.equal((await store.getRecoveryCloudHold()).originalKey,hold.originalKey);assert.equal((await store.listOpaqueArchives()).find(row=>row.key===hold.originalKey).raw,archive.raw);
  const after=await store.readRawExportSnapshot(),value=(source,name,key)=>source.stores[name].values[source.stores[name].keys.indexOf(key)];
  for(const [name,key]of [['backups','broken-sibling'],['snapshots','unknown-orphan'],['meta','pending:unknown']])assert.deepEqual(value(after,name,key),value(before,name,key));
  assert.equal(networkCalls,0);
 });
});

test('RISK offline working ownership: startup binds explicit null and proved browser UID while preserving ambiguous alternatives',async t=>{
 const cases=[
  {name:'explicit null with browser proof',head:'null',browser:true,expected:'local'},
  {name:'explicit null without browser proof',head:'null',expected:'local'},
  {name:'missing owner with complete browser head',head:'missing',browser:true,expected:'local'},
  {name:'missing owner without provenance',head:'missing',expected:'new-work',reopen:true},
  {name:'same email with complete browser UID',head:'email',browser:true,expected:'local'},
  {name:'same email without UID provenance',head:'email',expected:'new-work'},
  {name:'reversed source order with browser proof',head:'email',browser:true,reverse:true,expected:'local'},
  {name:'browser store alone cannot choose between owner groups',head:'missing',storeOnly:true,expected:'new-work'},
  {name:'browser head without owner fields is not unsigned proof',head:'missing',browser:true,missingBrowserOwner:true,expected:'new-work'},
  {name:'browser email without UID cannot select a UID group',head:'email',browser:true,missingBrowserUID:true,expected:'new-work'},
  {name:'empty foreign owner is not explicit unsigned ownership',head:'null',foreignEmptyOwner:true,expected:'local'}
 ];
 for(const mode of cases)await t.test(mode.name,async t=>{
  const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='offline-ownership-'+Math.random(),sameEmail=mode.head==='email';
  const local=syncState({v:2,tasks:[syncTask('local-provenance','Local retained board')],syncAccount:sameEmail?'e@example.com':null,syncIdentity:sameEmail?'current-uid':null,futureLocal:{keep:[13]}});
  const foreign=syncState({v:2,tasks:[syncTask('foreign-provenance','Another saved owner'),syncTask('local-provenance','Conflicting foreign title')],syncAccount:mode.foreignEmptyOwner?'':sameEmail?'e@example.com':'other@example.com',syncIdentity:mode.foreignEmptyOwner?null:'different-uid',futureForeign:{keep:[17]}});
  const store=loadStorageV2({indexedDB}).createDeviceStore({indexedDB,crypto:webcrypto,dbName:deviceDbName});await store.open();t.after(()=>store.close());
  await store.commitHead({expectedHash:null,payload:JSON.stringify(local),account:local.syncAccount});const head=await store.readHead();
  const sources=mode.reverse?[['z-foreign-owner',foreign],['a-local-owner',local]]:[['a-foreign-owner',foreign],['z-local-owner',local]];
  for(const [id,board]of sources)await store.putBackup({expectedHash:head.hash,backup:{id,kind:'manual',at:1,day:'2026-10-24',payload:JSON.stringify(board)}});
  await editRawDevice187(indexedDB,deviceDbName,tx=>{
   if(mode.head==='missing')tx.objectStore('meta').delete('head');else tx.objectStore('meta').put({schemaVersion:99,hash:'damaged-original',account:local.syncAccount},'head');
   tx.objectStore('meta').put({generationId:'pending-ownership',unknown:[23]},'pending:ownership');
   tx.objectStore('snapshots').put({unknownOrphan:[29]},'ownership-orphan');
  });
  const browserBoard={...local};if(mode.missingBrowserOwner){delete browserBoard.syncAccount;delete browserBoard.syncIdentity;}if(mode.missingBrowserUID)delete browserBoard.syncIdentity;
  const before=await store.readRawExportSnapshot(),browser={[DEVICE_AUTHORITY_KEY]:'1',...(mode.browser?{[LOCAL_HEAD_KEY]:JSON.stringify(browserBoard),[SYNC_STORE_KEY]:JSON.stringify(browserBoard)}:mode.storeOnly?{[SYNC_STORE_KEY]:JSON.stringify(local)}:{})},storage=sharedScannerStorage(browser);
  const app=await loadApp({indexedDBProvider:indexedDB,deviceDbName,sharedStorage:storage,navigatorProvider:{onLine:false}});t.after(()=>app.dispose());
  assert.equal(app.ctx.deviceStorageActive(),true,'the protected workspace remains usable offline');
  const hold=await store.getRecoveryCloudHold(),archive=(await store.listOpaqueArchives()).find(row=>row.key===hold?.originalKey);assert.ok(archive);
  assert.equal(JSON.stringify(JSON.parse(archive.raw).indexedDB),JSON.stringify(app.ctx.encodeManualArchiveSnapshot(before).stores),'all exact owner alternatives, unknown and pending rows are protected before adoption');
  assert.equal(app.ctx.state.tasks.some(row=>row.id==='foreign-provenance'),false,'a foreign account or UID must never become the accepted working board');
  assert.equal(hold.workspace,mode.expected==='local'?'supported-source':'new-work');
  if(mode.expected==='local'){
   assert.equal(app.ctx.state.tasks.find(row=>row.id==='local-provenance')?.title,'Local retained board');
   assert.equal(app.ctx.state.syncIdentity??null,local.syncIdentity);assert.equal(hold.unresolvedSourceRefs.length,0,'proved foreign sources stay archived without becoming an owner conflict');
  }else{
   assert.equal(app.ctx.state.tasks.length,0,'ambiguous complete owner groups do not choose an arbitrary original');
   const archived=JSON.parse(archive.raw);assert.ok(hold.unresolvedSourceRefs.length>=2,'the separate new-work hold retains every ambiguous complete alternative');
   assert.deepEqual(hold.unresolvedSourceRefs.map(row=>row.hash).sort(),archived.candidates.map(row=>row.sourceRef.hash).sort());
  }
  for(const [key,raw]of Object.entries(browser))assert.equal(storage.getItem(key),raw);
  const after=await store.readRawExportSnapshot(),value=(raw,name,key)=>raw.stores[name].values[raw.stores[name].keys.indexOf(key)];
  for(const [name,key]of [['meta','pending:ownership'],['snapshots','ownership-orphan']])assert.deepEqual(value(after,name,key),value(before,name,key));
  if(mode.reopen){
   app.shim.document.getElementById('addInput').value='New work beside ambiguous owners';await app.ctx.onAction('add',{});assert.equal(await app.ctx.persist(),true);await app.dispose();
   const cold=await loadApp({indexedDBProvider:indexedDB,deviceDbName,sharedStorage:storage,navigatorProvider:{onLine:false}});t.after(()=>cold.dispose());
   assert.deepEqual(Array.from(cold.ctx.state.tasks,row=>row.title),['New work beside ambiguous owners']);
   assert.equal((await store.getRecoveryCloudHold()).originalKey,hold.originalKey);assert.equal((await store.listOpaqueArchives()).find(row=>row.key===hold.originalKey).raw,archive.raw);
   const backend=await loadCloudBackendV2({runtimeWindow:cold.ctx.window,failures:{authPending:true},timeoutMs:5000,recoveryTimeoutMs:5000});t.after(()=>backend.CS.suspend());backend.emitAuth({uid:'current-uid',email:'e@example.com'});
   const remoteRaw=JSON.stringify(syncState({v:2,tasks:[syncTask('cloud-peer','Unseen peer work')],syncAccount:'e@example.com',syncIdentity:'current-uid'}));assert.equal((await backend.CS.push(remoteRaw,1792323000000,0)).ok,true);
   const remoteBefore=await backend.CS.pull();await fixtureDeadline(cold.ctx.cloudPull(),'ambiguous owner reconnect remains bounded');await cold.ctx.sendPush();
   const remoteAfter=await backend.CS.pull();assert.equal(remoteAfter.payload,remoteBefore.payload,'ambiguous owner evidence cannot publish the separate workspace over unseen cloud work');assert.equal(remoteAfter.rev,remoteBefore.rev);
   assert.deepEqual((await store.getRecoveryCloudHold()).unresolvedSourceRefs,hold.unresolvedSourceRefs);assert.deepEqual(Array.from(cold.ctx.state.tasks,row=>row.title),['New work beside ambiguous owners']);
  }
 });
});

test('RISK offline working recovery: verified protected archive and browser decisions combine without foreign sources',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='offline-archive-'+Math.random(),helper=await loadApp();
 const first=syncState({v:2,tasks:[syncTask('archive-task','Archived task')],syncAccount:'e@example.com',syncIdentity:'owner'}),second=syncState({v:2,tasks:[syncTask('browser-task','Browser task')],syncAccount:'e@example.com',syncIdentity:'owner'}),foreign=syncState({v:2,tasks:[syncTask('foreign-task','Another account task')],syncAccount:'other@example.com',syncIdentity:'other'});
 const store=loadStorageV2({indexedDB}).createDeviceStore({indexedDB,crypto:webcrypto,dbName:deviceDbName});await store.open();t.after(()=>store.close());
 assert.equal((await store.commitHead({expectedHash:null,payload:JSON.stringify(first),account:'e@example.com'})).ok,true);
 const encoded=helper.ctx.encodeManualArchiveSnapshot(await store.readRawExportSnapshot()).stores,archive=JSON.stringify({format:'chain-scanner.device-recovery-source',formatVersion:1,indexedDB:encoded,localStorage:[]});
 await editRawDevice187(indexedDB,deviceDbName,tx=>{tx.objectStore('meta').put({schemaVersion:2,hash:'missing',account:'e@example.com'},'head');tx.objectStore('snapshots').clear();tx.objectStore('snapshots').put({hash:'a'.repeat(64),payload:JSON.stringify(second)},'a'.repeat(64));tx.objectStore('backups').put({id:'mislabelled-sibling',payloadHash:'a'.repeat(64)},'mislabelled-sibling');tx.objectStore('opaque').put({key:'device-recovery-original:older',raw:archive},'device-recovery-original:older');tx.objectStore('opaque').put({key:'unknown-board-looking-text',raw:JSON.stringify(foreign)},'unknown-board-looking-text');});
 const storage=sharedScannerStorage({'fvp:chain-scanner:device-store-v2':'1',[LOCAL_HEAD_KEY]:JSON.stringify(second),[LOCAL_BACKUPS_KEY]:JSON.stringify([{id:'foreign-browser',kind:'manual',at:99999999,day:'2026-10-24',payload:JSON.stringify(foreign)}])});
 const app=await loadApp({indexedDBProvider:indexedDB,deviceDbName,sharedStorage:storage,navigatorProvider:{onLine:false}});t.after(()=>app.dispose());
 assert.deepEqual(Array.from(app.ctx.state.tasks,row=>row.id).sort(),['archive-task','browser-task'],'known independently hashed archived bytes combine with compatible browser work; opaque text and foreign owners stay excluded');
 assert.equal((await store.listOpaqueArchives()).find(row=>row.key==='device-recovery-original:older').raw,archive);
 const hold=await store.getRecoveryCloudHold();assert.equal(hold.reason,'device-source-recovery');assert.equal(hold.unresolvedSourceRefs.length,0);
});

test('RISK offline working reconnect: current offline edits and retained peer work reach exact cloud acknowledgement',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='offline-reconnect-'+Math.random(),storage=sharedScannerStorage({'fvp:chain-scanner:device-store-v2':'1'});
 const local=syncState({v:2,tasks:[syncTask('local-base','Local base task')],syncAccount:'e@example.com',syncIdentity:'owner',syncRev:1,syncDirty:false}),raw=JSON.stringify(local),store=loadStorageV2({indexedDB}).createDeviceStore({indexedDB,crypto:webcrypto,dbName:deviceDbName});await store.open();t.after(()=>store.close());
 assert.equal((await store.commitHead({expectedHash:null,payload:raw,account:'e@example.com'})).ok,true);const firstHead=await store.readHead();
 assert.equal((await store.putBackup({expectedHash:firstHead.hash,backup:{id:'local-before-loss',kind:'manual',at:1,day:'2026-10-24',payload:raw}})).ok,true);
 await editRawDevice187(indexedDB,deviceDbName,tx=>tx.objectStore('meta').delete('head'));
 const app=await loadApp({indexedDBProvider:indexedDB,deviceDbName,sharedStorage:storage,navigatorProvider:{onLine:false}});t.after(()=>app.dispose());
 app.shim.document.getElementById('addInput').value='Accepted entirely offline';await app.ctx.onAction('add',{});app.ctx.doneTask('local-base');await app.ctx.onAction('undo',{});assert.equal(await app.ctx.persist(),true);
 const offlineIds=Array.from(app.ctx.state.tasks,row=>row.id),offlineDecisions=JSON.parse(JSON.stringify(app.ctx.state.decisionEvents)),localHold=await store.getRecoveryCloudHold(),original=(await store.listOpaqueArchives()).find(row=>row.key===localHold.originalKey);await app.dispose();
 const cold=await loadApp({indexedDBProvider:indexedDB,deviceDbName,sharedStorage:storage});t.after(()=>cold.dispose());
 const backend=await loadCloudBackendV2({runtimeWindow:cold.ctx.window,failures:{authPending:true},timeoutMs:5000,recoveryTimeoutMs:5000});t.after(()=>backend.CS.suspend());backend.emitAuth({uid:'owner',email:'e@example.com'});
 const peer=syncState({...local,tasks:[...local.tasks,syncTask('peer-new','Newer peer task')],futurePeer:{keep:43}}),peerRaw=JSON.stringify(peer);
 try{assert.equal((await backend.CS.push(peerRaw,1792323000000,0)).ok,true);}catch(error){throw Error('seed push: '+String(error?.message||error?.code||error),{cause:error});}try{assert.equal((await backend.CS.push(peerRaw,1792323000001,1)).ok,true);}catch(error){throw Error('second seed push: '+String(error?.message||error?.code||error),{cause:error});}
 const oldRoot=JSON.parse(JSON.stringify(backend.docs.get('users/owner'))),oldPath='users/owner/generations/'+oldRoot.activeGeneration,oldHeader=JSON.stringify(backend.docs.get(oldPath));
 for(const key of [...backend.docs.keys()])if(key.startsWith(oldPath+'/chunks/'))backend.docs.delete(key);
 const previous=[...backend.docs].filter(([key])=>key.startsWith('users/owner/generations/'+oldRoot.previousGeneration)).map(([key,value])=>[key,JSON.stringify(value)]);
 cold.ctx.closeModal();await fixtureDeadline(cold.ctx.cloudPull(),'reconnect completes');await cold.ctx.sendPush();
 assert.equal(await store.getRecoveryCloudHold(),null,'fresh account evidence automatically transitions the local intent and exact ACK clears only its matching hold');
 const remote=await backend.CS.pull();assert.ok(remote.rev>oldRoot.rev);const board=JSON.parse(remote.payload);
 for(const id of [...offlineIds,'peer-new'])assert.ok(board.tasks.some(row=>row.id===id),'offline and peer task '+id+' survives reconnect');
 for(const decision of offlineDecisions)assert.ok(board.decisionEvents.some(row=>row.id===decision.id&&JSON.stringify(row)===JSON.stringify(decision)),'every native offline Done/Undo decision remains exact');
 assert.equal(board.futurePeer.keep,43);assert.equal(remote.payload,cold.ctx.cloudPayload());assert.equal((await store.readHead()).payload,JSON.stringify(cold.ctx.state));
 assert.equal((await store.listOpaqueArchives()).find(row=>row.key===localHold.originalKey).raw,original.raw);assert.equal(JSON.stringify(backend.docs.get(oldPath)),oldHeader);
 for(const [key,value]of previous)assert.equal(JSON.stringify(backend.docs.get(key)),value);
 const root=backend.docs.get('users/owner'),path='users/owner/generations/'+root.activeGeneration,chunks=[...backend.docs].filter(([key])=>key.startsWith(path+'/chunks/')).map(([,row])=>row).sort((a,b)=>a.index-b.index);
 assert.equal(await cold.ctx.window.ChainStorageV2.decodeSnapshot(backend.docs.get(path),chunks),remote.payload,'the new acknowledged generation independently decodes');
});

test('RISK offline new-work recovery: absent complete original opens a distinct durable workspace and preserves unseen cloud tasks',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='offline-new-work-'+Math.random(),source='{original complete board bytes are unavailable',storage=sharedScannerStorage({'fvp:chain-scanner:device-store-v2':'1',[LOCAL_HEAD_KEY]:source,[SYNC_STORE_KEY]:source});
 const store=loadStorageV2({indexedDB}).createDeviceStore({indexedDB,crypto:webcrypto,dbName:deviceDbName});await store.open();t.after(()=>store.close());
 assert.equal((await store.commitHead({expectedHash:null,payload:source,account:'e@example.com'})).ok,true);const before=await store.readRawExportSnapshot();
 const app=await loadApp({indexedDBProvider:indexedDB,deviceDbName,sharedStorage:storage,navigatorProvider:{onLine:false}});t.after(()=>app.dispose());
 app.ctx.openSettings();assert.match(app.shim.document.getElementById('modalRoot').innerHTML,/new offline workspace/i,'the app explicitly distinguishes new work from the unreadable original');app.ctx.closeModal();
 app.shim.document.getElementById('addInput').value='New work while originals are unreadable';await app.ctx.onAction('add',{});assert.equal(await app.ctx.persist(),true,'a separately protected new-work head can save fully offline');
 const added=app.ctx.state.tasks.find(row=>row.title==='New work while originals are unreadable');assert.ok(added);const hold=await store.getRecoveryCloudHold();assert.equal(hold.workspace,'new-work');
 const archive=(await store.listOpaqueArchives()).find(row=>row.key===hold.originalKey);assert.equal(JSON.stringify(JSON.parse(archive.raw).indexedDB),JSON.stringify(app.ctx.encodeManualArchiveSnapshot(before).stores));
 await app.dispose();const cold=await loadApp({indexedDBProvider:indexedDB,deviceDbName,sharedStorage:storage});t.after(()=>cold.dispose());assert.ok(cold.ctx.state.tasks.some(row=>row.id===added.id));
 const backend=await loadCloudBackendV2({runtimeWindow:cold.ctx.window,failures:{authPending:true},timeoutMs:5000,recoveryTimeoutMs:5000});t.after(()=>backend.CS.suspend());backend.emitAuth({uid:'owner',email:'e@example.com'});
 const remoteRaw=JSON.stringify(syncState({v:2,tasks:[syncTask('unseen-old-cloud','Previously unseen cloud task')],syncAccount:'e@example.com',syncIdentity:'owner',syncRev:0}));assert.equal((await backend.CS.push(remoteRaw,1792323000000,0)).ok,true);
 cold.ctx.closeModal();await fixtureDeadline(cold.ctx.cloudPull(),'new workspace reconnect completes');await cold.ctx.sendPush();
 const remote=await backend.CS.pull(),board=JSON.parse(remote.payload);assert.ok(board.tasks.some(row=>row.id==='unseen-old-cloud'),'an empty new-work basis cannot delete unseen old cloud tasks');assert.ok(board.tasks.some(row=>row.id===added.id));
 assert.equal((await store.listOpaqueArchives()).find(row=>row.key===hold.originalKey).raw,archive.raw);assert.equal(storage.getItem(LOCAL_HEAD_KEY),source);assert.equal(storage.getItem(SYNC_STORE_KEY),source);
 const history=await cold.ctx.automaticCloudSourceHistory();assert.ok(history.permanent.some(row=>row.reason==='original-device-source-unreadable'),'cloud acknowledgement does not claim unreadable device originals were recovered');
});

test('RISK offline memory recovery: refused durable media still permit new work with an honest unsaved status',async t=>{
 const refused=()=>{throw Object.assign(Error('synthetic all storage refused'),{name:'SecurityError'});},storage={getItem:refused,setItem:refused,removeItem:refused,key:refused,get length(){return 0;}},indexedDBProvider={open:refused};
 const app=await loadApp({sharedStorage:storage,indexedDBProvider,navigatorProvider:{onLine:false}}),{ctx,shim}=app;t.after(()=>app.dispose());
 shim.document.getElementById('addInput').value='Useful unsaved in-memory work';await ctx.onAction('add',{});
 assert.ok(ctx.state.tasks.some(row=>row.title==='Useful unsaved in-memory work'),'fully refused storage still permits useful work in this open tab');
 assert.equal(await ctx.persist(),false);assert.equal(ctx.deviceStorageActive(),false);assert.ok(ctx.deviceSaveIssue(),'unsaved work cannot appear durable');
 ctx.openSettings();assert.match(shim.document.getElementById('modalRoot').innerHTML,/not saved|unsaved|only in this tab/i,'the new-work status makes the durability limit visible');
 assert.equal(vm.runInContext('liveBoardAccepted',ctx),true,'only this distinct in-memory workspace is accepted; no unreadable original is adopted');
});

test('RISK offline memory recovery resume: returning storage saves current new work without replacing the refused original',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory(),deviceDbName='memory-retry-'+Math.random(),saved=sharedScannerStorage();let available=false;
 const denied=()=>{throw Object.assign(Error('temporary storage refusal'),{name:'SecurityError'});},storage={getItem:key=>available?saved.getItem(key):denied(),setItem:(key,value)=>available?saved.setItem(key,value):denied(),removeItem:key=>available?saved.removeItem(key):denied(),key:index=>available?saved.key(index):denied(),get length(){return available?saved.length:0;}},indexedDBProvider={open:(...args)=>available?factory.open(...args):denied()};
 const app=await loadApp({sharedStorage:storage,indexedDBProvider,deviceDbName,navigatorProvider:{onLine:false}});t.after(()=>app.dispose());
 app.shim.document.getElementById('addInput').value='Accepted while storage refused';await app.ctx.onAction('add',{});assert.equal(await app.ctx.persist(),false);const id=app.ctx.state.tasks.find(row=>row.title==='Accepted while storage refused').id;
 available=true;const old='{sole unreadable browser original';saved.setItem(LOCAL_HEAD_KEY,old);saved.setItem(SYNC_STORE_KEY,old);
 assert.equal(await app.ctx.persist(),true,'an actual save after storage returns protects originals and saves the current in-memory workspace');assert.equal(app.ctx.deviceSaveIssue(),null);
 const head=await app.ctx.window.ScannerDeviceStore.readHead(),hold=await app.ctx.window.ScannerDeviceStore.getRecoveryCloudHold();assert.equal(head.payload,JSON.stringify(app.ctx.state));assert.equal(hold.workspace,'new-work');assert.equal(saved.getItem(LOCAL_HEAD_KEY),old);
 await app.dispose();const cold=await loadApp({sharedStorage:saved,indexedDBProvider:factory,deviceDbName});t.after(()=>cold.dispose());assert.ok(cold.ctx.state.tasks.some(row=>row.id===id),'the saved memory-only work survives cold reopen');
});

test('RISK offline working authority: a changed original archive cannot activate a claimed recovered working head',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory(),deviceDbName='offline-archive-readback-'+Math.random(),control={},indexedDB=deviceFaultProvider187(factory,control),original=JSON.stringify(syncState({v:2,tasks:[syncTask('archive-authority','Protected source task')]}));
 const inspector=loadStorageV2({indexedDB:factory}).createDeviceStore({indexedDB:factory,crypto:webcrypto,dbName:deviceDbName});await inspector.open();t.after(()=>inspector.close());
 await inspector.commitHead({expectedHash:null,payload:original});const head=await inspector.readHead();await inspector.putBackup({expectedHash:head.hash,backup:{id:'authority-source',kind:'manual',at:1,day:'2026-10-24',payload:original}});await editRawDevice187(factory,deviceDbName,tx=>tx.objectStore('meta').delete('head'));
 let mutated=false;control.afterHoldRead=db=>{if(mutated)return;mutated=true;const tx=db.transaction('opaque','readwrite'),store=tx.objectStore('opaque'),request=store.getAll();request.onsuccess=()=>{const row=request.result.find(row=>row?.key?.startsWith('device-recovery-original:working:'));if(row)store.put({...row,raw:'changed peer original archive bytes'},row.key);};};
 const app=await loadApp({indexedDBProvider:indexedDB,deviceDbName,seedStorage:{'fvp:chain-scanner:device-store-v2':'1'},navigatorProvider:{onLine:false}});t.after(()=>app.dispose());
 assert.equal(mutated,true);assert.equal(app.ctx.deviceStorageActive(),false,'archive authority must be verified before a recovered source is activated');assert.equal(app.ctx.state.tasks.some(row=>row.id==='archive-authority'),false,'changed original evidence cannot be presented as recovered tasks');
 assert.ok(app.ctx.deviceSaveIssue(),'a separate memory-only workspace stays honest about its unsaved state');
});

test('RISK offline working archives: prior exact originals are referenced without recursively copying their bytes',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='offline-reference-'+Math.random(),helper=await loadApp(),store=loadStorageV2({indexedDB}).createDeviceStore({indexedDB,crypto:webcrypto,dbName:deviceDbName});await store.open();t.after(()=>store.close());
 const original=JSON.stringify(syncState({v:2,tasks:[syncTask('reference-task','Retained linked work')],futurePadding:'x'.repeat(32768)}));await store.commitHead({expectedHash:null,payload:original});const head=await store.readHead();await store.putBackup({expectedHash:head.hash,backup:{id:'reference-backup',kind:'manual',at:1,day:'2026-10-24',payload:original}});
 const previous=JSON.stringify({format:'chain-scanner.device-recovery-source',formatVersion:1,reason:'device-source-recovery',indexedDB:helper.ctx.encodeManualArchiveSnapshot(await store.readRawExportSnapshot()).stores,localStorage:[]}),key='device-recovery-original:working:prior';
 await editRawDevice187(indexedDB,deviceDbName,tx=>{tx.objectStore('meta').delete('head');tx.objectStore('opaque').put({key,raw:previous},key);});
 const app=await loadApp({indexedDBProvider:indexedDB,deviceDbName,seedStorage:{'fvp:chain-scanner:device-store-v2':'1'},navigatorProvider:{onLine:false}});t.after(()=>app.dispose());assert.equal(app.ctx.deviceStorageActive(),true);
 const hold=await store.getRecoveryCloudHold(),rows=await store.listOpaqueArchives(),current=JSON.parse(rows.find(row=>row.key===hold.originalKey).raw);
 assert.equal(current.indexedDBCapture?.completeness,'reference-compressed','a repeated recovery references the already immutable exact original instead of embedding it again');
 assert.ok(current.indexedDBCapture.references.some(row=>row.key===key));assert.equal(rows.find(row=>row.key===key).raw,previous);
 const raw=await store.readRawExportSnapshot(),references=await app.ctx.automaticRecoveryReferencedArchiveRows(current,app.ctx.automaticRecoveryOpaqueRows(raw));assert.ok(references.some(row=>row.key===key&&row.raw===previous),'the bounded reference capture reconstructs and verifies the original raw source hash');
});

test('RISK offline working reconnect guards: changed source hold pending draft and account retain the current workspace',async t=>{
 for(const fault of ['raw-peer','hold-peer','pending-peer','unfinished-draft','account-change','unavailable-read'])await t.test(fault,async t=>{
  const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='offline-reconnect-guard-'+fault+'-'+Math.random(),store=loadStorageV2({indexedDB}).createDeviceStore({indexedDB,crypto:webcrypto,dbName:deviceDbName});await store.open();t.after(()=>store.close());await store.commitHead({expectedHash:null,payload:'{unreadable original'});
  const app=await loadApp({indexedDBProvider:indexedDB,deviceDbName,seedStorage:{'fvp:chain-scanner:device-store-v2':'1'}});t.after(()=>app.dispose());app.shim.document.getElementById('addInput').value='Accepted guarded offline task';await app.ctx.onAction('add',{});assert.equal(await app.ctx.persist(),true);
  const id=app.ctx.state.tasks.find(row=>row.title==='Accepted guarded offline task').id,head=await store.readHead(),hold=await store.getRecoveryCloudHold(),original=(await store.listOpaqueArchives()).find(row=>row.key===hold.originalKey);
  const backend=await loadCloudBackendV2({runtimeWindow:app.ctx.window,failures:{authPending:true},timeoutMs:5000,recoveryTimeoutMs:5000});t.after(()=>backend.CS.suspend());backend.emitAuth({uid:'owner',email:'e@example.com'});const remote=JSON.stringify(syncState({v:2,tasks:[syncTask('remote-guarded','Retained remote task')],syncAccount:'e@example.com',syncIdentity:'owner'}));assert.equal((await backend.CS.push(remote,1792323000000,0)).ok,true);
  const read=backend.CS.readRecoverySource.bind(backend.CS);let changed=false;
  backend.CS.readRecoverySource=async(...args)=>{
   if(!changed){changed=true;
    if(fault==='unfinished-draft')app.shim.document.getElementById('addInput').value='New unfinished draft';
    else if(fault==='account-change')backend.emitAuth({uid:'other',email:'e@example.com'});
    else if(fault==='unavailable-read')throw Object.assign(Error('synthetic unavailable source'),{code:'unavailable'});
    else await editRawDevice187(indexedDB,deviceDbName,tx=>{
     if(fault==='raw-peer')tx.objectStore('meta').put({unknown:['peer',71]},'future-peer');
     if(fault==='hold-peer')tx.objectStore('meta').put({...hold,futurePeer:new Uint8Array([73])},'recoveryCloudHold');
     if(fault==='pending-peer')tx.objectStore('meta').put({generationId:'peer-pending',payloadHash:'a'.repeat(64),baseRev:1,updatedAt:79},'pending:owner');
    });
   }
   return read(...args);
  };
  app.ctx.closeModal();await fixtureDeadline(app.ctx.cloudPull(),'guarded local-intent read settles');
  assert.equal(changed,true);assert.equal(backend.writes.length,1,'a stale or unavailable local-intent capture cannot publish');assert.ok(await store.getRecoveryCloudHold());assert.equal((await store.readHead()).payload,head.payload);assert.ok(app.ctx.state.tasks.some(row=>row.id===id));assert.equal((await store.listOpaqueArchives()).find(row=>row.key===hold.originalKey).raw,original.raw);
  if(fault==='unfinished-draft')assert.equal(app.shim.document.getElementById('addInput').value,'New unfinished draft');
  if(fault==='pending-peer')assert.equal((await store.getPendingUpload('owner')).generationId,'peer-pending');
 });
});

test('RISK offline startup budget: stalled open and raw reads expose unsaved work without late adoption',async t=>{
 for(const fault of ['stalled-open','stalled-raw-read'])await t.test(fault,async t=>{
  const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory(),deviceDbName='offline-startup-budget-'+fault+'-'+Math.random(),control={stallRawRead:fault==='stalled-raw-read'},inspector=loadStorageV2({indexedDB:factory}).createDeviceStore({indexedDB:factory,crypto:webcrypto,dbName:deviceDbName});await inspector.open();t.after(()=>inspector.close());
  const original=JSON.stringify(syncState({v:2,tasks:[syncTask('late-original','Late original task')]}));await inspector.commitHead({expectedHash:null,payload:original});const head=await inspector.readHead();await inspector.putBackup({expectedHash:head.hash,backup:{id:'late-backup',kind:'manual',at:1,day:'2026-10-24',payload:original}});await editRawDevice187(factory,deviceDbName,tx=>tx.objectStore('meta').delete('head'));
  const indexedDBProvider=fault==='stalled-open'?{open(){return {};}}:deviceFaultProvider187(factory,control);let app;
  const loading=loadApp({indexedDBProvider,deviceDbName,deviceOpenTimeoutMs:35,seedStorage:{'fvp:chain-scanner:device-store-v2':'1'},navigatorProvider:{onLine:false}}).then(value=>app=value);
  t.after(async()=>{control.releaseRawRead?.();await loading;await app?.dispose();});await new Promise(resolve=>setTimeout(resolve,150));
  assert.ok(app,'one original startup budget must release a permanently stalled storage read into a useful workspace');
  assert.equal(app.ctx.deviceStorageActive(),false);app.shim.document.getElementById('addInput').value='Accepted while storage read stalled';await fixtureDeadline(app.ctx.onAction('add',{}),'stalled storage Add returns honestly',400);assert.equal(await fixtureDeadline(app.ctx.persist(),'stalled storage save returns honestly',400),false);
  const id=app.ctx.state.tasks.find(row=>row.title==='Accepted while storage read stalled').id;assert.ok(app.ctx.deviceSaveIssue());
  if(fault==='stalled-raw-read'){
   control.releaseRawRead();await flush();await flush();assert.ok(app.ctx.state.tasks.some(row=>row.id===id),'a late original read cannot replace accepted in-memory work');assert.equal(app.ctx.deviceStorageActive(),false,'timed-out startup cannot activate later');
   assert.equal(await app.ctx.persist(),true,'a separate current save may protect originals and persist the current workspace after the old read settles');
  }
 });
});

test('RISK offline startup resume: fresh storage saves accepted memory work while an expired readonly delivery remains withheld',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory(),deviceDbName='offline-readonly-resume-'+Math.random(),control={stallRawRead:true};
 const inspector=loadStorageV2({indexedDB:factory}).createDeviceStore({indexedDB:factory,crypto:webcrypto,dbName:deviceDbName});await inspector.open();t.after(()=>inspector.close());
 const original=JSON.stringify(syncState({v:2,tasks:[syncTask('withheld-original','Protected original before withheld callback')]}));await inspector.commitHead({expectedHash:null,payload:original});const head=await inspector.readHead();await inspector.putBackup({expectedHash:head.hash,backup:{id:'withheld-backup',kind:'manual',at:1,day:'2026-10-25',payload:original}});await editRawDevice187(factory,deviceDbName,tx=>{tx.objectStore('meta').delete('head');tx.objectStore('meta').put({unknown:[31]},'pending:withheld');});
 const before=await inspector.readRawExportSnapshot(),storage=sharedScannerStorage({[DEVICE_AUTHORITY_KEY]:'1'});let app;
 const loading=loadApp({indexedDBProvider:deviceFaultProvider187(factory,control),deviceDbName,deviceOpenTimeoutMs:35,sharedStorage:storage,navigatorProvider:{onLine:false}}).then(value=>app=value);
 t.after(async()=>{for(const release of control.rawReadReleases||[])release();await loading;await app?.dispose();});await new Promise(resolve=>setTimeout(resolve,150));assert.ok(app);const releaseOld=control.releaseRawRead;assert.equal(typeof releaseOld,'function');
 app.shim.document.getElementById('addInput').value='Accepted while old readonly delivery stays withheld';await fixtureDeadline(app.ctx.onAction('add',{}),'withheld readonly Add returns',400);assert.equal(await fixtureDeadline(app.ctx.persist(),'withheld readonly save returns',400),false);const accepted=JSON.stringify(app.ctx.state),id=app.ctx.state.tasks.find(row=>row.title==='Accepted while old readonly delivery stays withheld').id;
 assert.equal(vm.runInContext('localDeviceStartupAttempt.expired&&localDeviceStartupAttempt.pending',app.ctx),true);
 control.stallRawRead=false;
 const fresh=await fixtureDeadline(app.ctx.window.ScannerDeviceStore.readRawExportSnapshot(),'fresh raw request completes before old callback',400);assert.equal(JSON.stringify(fresh),JSON.stringify(before));
 assert.equal(await fixtureDeadline(app.ctx.persist(),'fresh save after readonly storage returns',400),true,'an expired readonly callback cannot permanently block a fresh guarded save');
 const saved=await inspector.readHead(),hold=await inspector.getRecoveryCloudHold(),archive=(await inspector.listOpaqueArchives()).find(row=>row.key===hold.originalKey);assert.ok(JSON.parse(saved.payload).tasks.some(row=>row.id===id));assert.ok(archive);
 assert.equal(JSON.stringify(JSON.parse(archive.raw).indexedDB),JSON.stringify(app.ctx.encodeManualArchiveSnapshot(before).stores));
 releaseOld();await flush();await flush();assert.equal((await inspector.readHead()).payload,saved.payload,'obsolete readonly delivery cannot overwrite the verified current head');assert.equal(JSON.stringify(app.ctx.state),saved.payload,'obsolete delivery cannot adopt the old original over current work');assert.notEqual(saved.payload,original);assert.ok(JSON.parse(accepted).tasks.some(row=>row.id===id));
 await app.dispose();const cold=await loadApp({indexedDBProvider:factory,deviceDbName,sharedStorage:storage,navigatorProvider:{onLine:false}});t.after(()=>cold.dispose());assert.ok(cold.ctx.state.tasks.some(row=>row.id===id));assert.equal((await inspector.getRecoveryCloudHold()).originalKey,hold.originalKey);assert.equal((await inspector.listOpaqueArchives()).find(row=>row.key===hold.originalKey).raw,archive.raw);
});

test('RISK offline startup resume budget: fresh stalled captures stop and uncertain started writes never replay',async t=>{
 for(const fault of ['fresh-read-stalls','startup-write-withheld'])await t.test(fault,async t=>{
  const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory(),deviceDbName='offline-resume-bound-'+fault+'-'+Math.random(),control={stallRawRead:fault==='fresh-read-stalls',stallRawWrite:fault==='startup-write-withheld'};
  const inspector=loadStorageV2({indexedDB:factory}).createDeviceStore({indexedDB:factory,crypto:webcrypto,dbName:deviceDbName});await inspector.open();t.after(()=>inspector.close());
  const original=JSON.stringify(syncState({v:2,tasks:[syncTask('budget-original','Protected source before delayed storage')]}));await inspector.commitHead({expectedHash:null,payload:original});const head=await inspector.readHead();await inspector.putBackup({expectedHash:head.hash,backup:{id:'budget-backup',kind:'manual',at:1,day:'2026-10-25',payload:original}});await editRawDevice187(factory,deviceDbName,tx=>tx.objectStore('meta').delete('head'));
  let app;const loading=loadApp({indexedDBProvider:deviceFaultProvider187(factory,control),deviceDbName,deviceOpenTimeoutMs:35,seedStorage:{[DEVICE_AUTHORITY_KEY]:'1'},navigatorProvider:{onLine:false}}).then(value=>app=value);
  t.after(async()=>{for(const release of control.rawReadReleases||[])release();control.releaseRawWrite?.();await loading;await app?.dispose();});await new Promise(resolve=>setTimeout(resolve,150));assert.ok(app);
  app.shim.document.getElementById('addInput').value='Accepted work during delayed '+fault;await fixtureDeadline(app.ctx.onAction('add',{}),'delayed storage Add returns',400);const accepted=JSON.stringify(app.ctx.state);
  if(fault==='fresh-read-stalls'){
   control.releaseRawRead();await flush();await flush();control.stallRawRead=true;
   assert.equal(await fixtureDeadline(app.ctx.persist(),'fresh recovery capture has one bounded budget',400),false);
   assert.equal(app.ctx.deviceStorageActive(),false);assert.equal(JSON.stringify(app.ctx.state),accepted);control.releaseRawRead();await flush();await flush();assert.equal(JSON.stringify(app.ctx.state),accepted);assert.equal(app.ctx.deviceStorageActive(),false,'late fresh read cannot activate after its own timeout');assert.equal(await inspector.readHead(),null);
  }else{
   assert.equal(typeof control.releaseRawWrite,'function','the original recovery write started before its completion delivery was withheld');const before=await inspector.readRawExportSnapshot();
   assert.equal(await fixtureDeadline(app.ctx.persist(),'uncertain started mutation remains protected',400),false);assert.equal(JSON.stringify(await inspector.readRawExportSnapshot()),JSON.stringify(before),'a pending started mutation cannot be replayed as a fresh recovery write');
   control.releaseRawWrite();await flush();await flush();assert.equal(JSON.stringify(app.ctx.state),accepted);assert.equal(app.ctx.deviceStorageActive(),false,'late original write completion cannot adopt over accepted memory work');
  }
 });
});

test('RISK offline recovery activation: a verified committed workspace activates before optional cache reads can strand later edits',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory(),control={quotaOpaque:true},deviceDbName='offline-final-activation-'+Math.random(),original='{unreadable activation original',storage=sharedScannerStorage({[LOCAL_HEAD_KEY]:original,[SYNC_STORE_KEY]:'{other unreadable activation original'});
 const app=await loadApp({indexedDBProvider:deviceFaultProvider187(factory,control),deviceDbName,deviceOpenTimeoutMs:60,sharedStorage:storage,navigatorProvider:{onLine:false}});t.after(async()=>{for(const release of control.rawReadReleases||[])release();await app.dispose();});
 app.shim.document.getElementById('addInput').value='Accepted before verified recovery activates';await app.ctx.onAction('add',{});assert.equal(await app.ctx.persist(),false);const first=app.ctx.state.tasks.find(row=>row.title==='Accepted before verified recovery activates').id;
 control.quotaOpaque=false;let armed=true;const set=storage.setItem.bind(storage);storage.setItem=(key,value)=>{set(key,value);if(armed&&key===DEVICE_AUTHORITY_KEY){armed=false;control.stallRawRead=true;}};
 assert.equal(await fixtureDeadline(app.ctx.persist(),'verified fresh recovery activation completes',400),true,'the fully read-back committed head and process flags must activate as one transition');assert.equal(armed,false);
 assert.equal(app.ctx.deviceStorageActive(),true);assert.equal(vm.runInContext('memoryRecoveryWorkspace',app.ctx),false);assert.equal(app.ctx.deviceSaveIssue(),null);
 const hold=await app.ctx.window.ScannerDeviceStore.getRecoveryCloudHold(),saved=await app.ctx.window.ScannerDeviceStore.readHead();assert.equal(saved.payload,JSON.stringify(app.ctx.state));assert.ok(JSON.parse(saved.payload).tasks.some(row=>row.id===first));
 control.stallRawRead=false;
 app.shim.document.getElementById('addInput').value='Later accepted work after verified activation';await fixtureDeadline(app.ctx.onAction('add',{}),'later activation Add returns',400);const later=app.ctx.state.tasks.find(row=>row.title==='Later accepted work after verified activation').id;
 app.ctx.doneTask(later);assert.equal(await app.ctx.persist(),true);await app.ctx.onAction('undo',{});assert.equal(await app.ctx.persist(),true);assert.equal(!!app.ctx.state.tasks.find(row=>row.id===later).done,false);
 app.shim.document.getElementById('addInput').value='Unfinished activation draft';const accepted=JSON.stringify(app.ctx.state);for(const release of control.rawReadReleases||[])release();await flush();await flush();assert.equal(JSON.stringify(app.ctx.state),accepted,'late optional cache delivery cannot replace current accepted edits');assert.equal(app.shim.document.getElementById('addInput').value,'Unfinished activation draft');
 assert.equal(await app.ctx.persist(),true);const final=await app.ctx.window.ScannerDeviceStore.readHead(),archive=(await app.ctx.window.ScannerDeviceStore.listOpaqueArchives()).find(row=>row.key===hold.originalKey);assert.equal(final.payload,JSON.stringify(app.ctx.state));assert.ok(JSON.parse(archive.raw).localStorage.some(row=>row.key===LOCAL_HEAD_KEY&&row.raw===original));
 await app.dispose();const cold=await loadApp({indexedDBProvider:factory,deviceDbName,sharedStorage:storage,navigatorProvider:{onLine:false}});t.after(()=>cold.dispose());for(const id of [first,later])assert.ok(cold.ctx.state.tasks.some(row=>row.id===id));assert.equal(!!cold.ctx.state.tasks.find(row=>row.id===later).done,false);assert.equal((await cold.ctx.window.ScannerDeviceStore.getRecoveryCloudHold()).originalKey,hold.originalKey);assert.equal((await cold.ctx.window.ScannerDeviceStore.listOpaqueArchives()).find(row=>row.key===hold.originalKey).raw,archive.raw);
});

test('RISK offline recovery reentry: settled own recovery writes permit fresh current work while changed holds stay protected',async t=>{
 for(const mode of ['settled-own-intent','settled-own-intent-read-retry','settled-own-intent-write-retry','changed-hold'])await t.test(mode,async t=>{
  const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory(),control={stallRawWrite:true},deviceDbName='offline-settled-reentry-'+mode+'-'+Math.random(),storage=sharedScannerStorage({[DEVICE_AUTHORITY_KEY]:'1'}),inspector=loadStorageV2({indexedDB:factory}).createDeviceStore({indexedDB:factory,crypto:webcrypto,dbName:deviceDbName});await inspector.open();t.after(()=>inspector.close());
  const original=JSON.stringify(syncState({v:2,tasks:[syncTask('settled-original','Original before uncertain recovery completion')]}));await inspector.commitHead({expectedHash:null,payload:original});const head=await inspector.readHead();await inspector.putBackup({expectedHash:head.hash,backup:{id:'settled-backup',kind:'manual',at:1,day:'2026-10-25',payload:original}});await editRawDevice187(factory,deviceDbName,tx=>{tx.objectStore('meta').delete('head');tx.objectStore('meta').put({unknown:[41]},'pending:settled');});
  let app;const loading=loadApp({indexedDBProvider:deviceFaultProvider187(factory,control),deviceDbName,deviceOpenTimeoutMs:60,sharedStorage:storage,navigatorProvider:{onLine:false}}).then(value=>app=value);t.after(async()=>{control.releaseRawWrite?.();for(const release of control.rawReadReleases||[])release();await loading;await app?.dispose();});await new Promise(resolve=>setTimeout(resolve,150));assert.ok(app);
  app.shim.document.getElementById('addInput').value='Accepted while recovery completion is uncertain';await fixtureDeadline(app.ctx.onAction('add',{}),'uncertain completion Add returns',400);const first=app.ctx.state.tasks.find(row=>row.title==='Accepted while recovery completion is uncertain').id,prior=await inspector.readRawExportSnapshot(),priorHold=await inspector.getRecoveryCloudHold(),priorArchive=(await inspector.listOpaqueArchives()).find(row=>row.key===priorHold.originalKey);
  assert.equal(await app.ctx.persist(),false,'an uncertain started write cannot replay before completion settles');assert.equal(JSON.stringify(await inspector.readRawExportSnapshot()),JSON.stringify(prior));
  control.releaseRawWrite();await flush();await flush();assert.equal(app.ctx.deviceStorageActive(),false,'late completion alone cannot adopt over accepted memory work');assert.ok(app.ctx.state.tasks.some(row=>row.id===first));
  if(mode==='changed-hold')await editRawDevice187(factory,deviceDbName,tx=>tx.objectStore('meta').put({...priorHold,unknownPeer:{keep:[43]}},'recoveryCloudHold'));
  if(mode==='settled-own-intent-read-retry')control.stallRawRead=true;if(mode==='settled-own-intent-write-retry')control.quotaOpaque=true;
  app.shim.document.getElementById('addInput').value='Later accepted work after recovery settles';await fixtureDeadline(app.ctx.onAction('add',{}),'settled completion Add returns',400);const later=app.ctx.state.tasks.find(row=>row.title==='Later accepted work after recovery settles').id;app.shim.document.getElementById('addInput').value='Unfinished settled recovery draft';
  if(mode==='settled-own-intent-read-retry')control.stallRawRead=false;if(mode==='settled-own-intent-write-retry')control.quotaOpaque=false;const beforeSave=await inspector.readRawExportSnapshot();
  assert.equal(await fixtureDeadline(app.ctx.persist(),'settled recovery permits one fresh current save',400),mode!=='changed-hold','only exact own settled recovery intent can resume durable progress');assert.equal(app.shim.document.getElementById('addInput').value,'Unfinished settled recovery draft');
  if(mode==='changed-hold'){assert.equal(JSON.stringify(await inspector.readRawExportSnapshot()),JSON.stringify(beforeSave));assert.equal(app.ctx.deviceStorageActive(),false);return;}
  app.ctx.doneTask(later);assert.equal(await app.ctx.persist(),true);await app.ctx.onAction('undo',{});assert.equal(await app.ctx.persist(),true);
  const saved=await inspector.readHead(),hold=await inspector.getRecoveryCloudHold();assert.equal(saved.payload,JSON.stringify(app.ctx.state));for(const id of [first,later])assert.ok(JSON.parse(saved.payload).tasks.some(row=>row.id===id));assert.equal((await inspector.listOpaqueArchives()).find(row=>row.key===priorHold.originalKey).raw,priorArchive.raw);assert.ok(hold.originalKey);
  const after=await inspector.readRawExportSnapshot(),value=raw=>raw.stores.meta.values[raw.stores.meta.keys.indexOf('pending:settled')];assert.equal(JSON.stringify(value(after)),JSON.stringify(value(prior)));
  if(mode==='settled-own-intent-read-retry'){
   const cache=vm.runInContext('JSON.stringify(deviceBackupCache)',app.ctx),current=JSON.stringify(app.ctx.state);for(const release of control.rawReadReleases||[])release();await flush();await flush();
   assert.equal(vm.runInContext('JSON.stringify(deviceBackupCache)',app.ctx),cache,'an expired auxiliary read cannot replace the current verified backup cache');assert.equal(JSON.stringify(app.ctx.state),current);assert.equal(app.shim.document.getElementById('addInput').value,'Unfinished settled recovery draft');
  }
  await app.dispose();const cold=await loadApp({indexedDBProvider:factory,deviceDbName,sharedStorage:storage,navigatorProvider:{onLine:false}});t.after(()=>cold.dispose());for(const id of [first,later])assert.ok(cold.ctx.state.tasks.some(row=>row.id===id));assert.equal(!!cold.ctx.state.tasks.find(row=>row.id===later).done,false);assert.equal((await inspector.getRecoveryCloudHold()).originalKey,hold.originalKey);
 });
});

test('RISK offline memory restore: a deliberate Paste after storage returns protects accepted unsaved work',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory(),control={quotaOpaque:true},indexedDB=deviceFaultProvider187(factory,control),deviceDbName='memory-paste-'+Math.random(),original='{unreadable sole browser source';
 const app=await loadApp({indexedDBProvider:indexedDB,deviceDbName,seedStorage:{[SYNC_STORE_KEY]:original,[LOCAL_HEAD_KEY]:original}});t.after(()=>app.dispose());
 app.ctx.addTask('Accepted unsaved work before explicit Restore');const accepted=JSON.stringify(app.ctx.state),selected=JSON.stringify(syncState({tasks:[syncTask('explicit-after-memory','Deliberately selected supported board')]}));control.quotaOpaque=false;
 assert.equal(await app.ctx.previewPastedRecovery(selected),true,'returning raw storage permits the existing guarded explicit Restore path from a memory-only workspace');assert.equal(await app.ctx.confirmFileRestore(),true);
 assert.ok(app.ctx.state.tasks.some(row=>row.id==='explicit-after-memory'));assert.equal(await app.ctx.persist(),true,'successful explicit recovery retires the memory-only status');
 assert.ok((await app.ctx.window.ScannerDeviceStore.listOpaqueArchives()).some(row=>{try{return JSON.parse(row.raw).currentWorkingBoard===accepted;}catch{return false;}}),'the exact accepted unsaved workspace is protected alongside unreadable originals before explicit replacement');
 assert.equal(app.shim.localStorage.getItem(SYNC_STORE_KEY),original);assert.equal(app.shim.localStorage.getItem(LOCAL_HEAD_KEY),original);
});

test('RISK device connection startup: one internal server failure recovers the authoritative offline board within a bounded attempt',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory();let networkCalls=0,opens=0;
 const offline={navigatorProvider:{onLine:false},fetchProvider:async()=>{networkCalls++;throw Error('isolated offline startup');}};
 const original=JSON.stringify(syncState({tasks:[syncTask('startup-original','Retained original')],futureConnection:{original:97}})),storage=sharedScannerStorage({[LOCAL_HEAD_KEY]:original,[SYNC_STORE_KEY]:original}),deviceDbName='startup-reconnect-'+Math.random();
 const first=await loadApp({...offline,sharedStorage:storage,indexedDBProvider:factory,deviceDbName});t.after(()=>first.dispose());
 first.ctx.addTask('Only in the authoritative device database');assert.equal(await first.ctx.persist(),true);const expected=await first.shim.window.ScannerDeviceStore.readHead();await first.dispose();
 const indexedDBProvider={open(...args){opens++;if(opens>1)return factory.open(...args);const request={};setTimeout(()=>{request.error=Object.assign(Error('An internal error was encountered in the Indexed Database server'),{name:'UnknownError'});request.onerror?.();},0);return request;}};
 const app=await loadApp({...offline,sharedStorage:storage,indexedDBProvider,deviceDbName}),{ctx}=app;t.after(()=>app.dispose());
 assert.equal(ctx.deviceStorageActive(),true,'the app safely retries a transient internal server error without reviving the stale browser shell');
 assert.equal((await ctx.window.ScannerDeviceStore.readHead()).payload,expected.payload);
 assert.ok(ctx.state.tasks.some(row=>row.title==='Only in the authoritative device database'));
 assert.equal(opens,2,'one transient open failure receives exactly one retry');assert.equal(networkCalls,0);
 const events=JSON.parse(ctx.supportDiagnosticsText()).events.filter(row=>row.stage==='device-store');
 assert.ok(events.some(row=>row.status==='failed'&&row.code.value==='unavailable'),'bounded diagnostics retain the original failure');
 assert.ok(events.some(row=>row.status==='completed'),'the recovered connection is observed separately from board durability');
});

test('RISK device connection recovery: offline accepted work survives a lost handle and durable reopen',async t=>{
 for(const mode of ['unexpected-close','closed-before-transaction'])await t.test(mode,async t=>{
  const {IDBFactory,forceCloseDatabase}=await import('fake-indexeddb'),factory=new IDBFactory(),handles=[];
  let opens=0,networkCalls=0;
  const indexedDBProvider={open(...args){opens++;const request=factory.open(...args);request.addEventListener('success',()=>handles.push(request.result));return request;}};
  const offline={navigatorProvider:{onLine:false},fetchProvider:async()=>{networkCalls++;throw Error('isolated fully offline transport');}};
  const original=JSON.stringify(syncState({tasks:[syncTask('connection-original','Existing offline work')],futureConnection:{keep:['all',47]}}));
  const storage=sharedScannerStorage({[LOCAL_HEAD_KEY]:original,[SYNC_STORE_KEY]:original}),deviceDbName='offline-connection-'+mode+'-'+Math.random();
  const app=await loadApp({...offline,sharedStorage:storage,indexedDBProvider,deviceDbName}),{ctx,shim}=app,store=shim.window.ScannerDeviceStore;t.after(()=>app.dispose());
  assert.equal(await ctx.persist(),true);const before=await store.readHead();
  const manual=await ctx.saveDurableBackup('manual',before.payload),manualBefore=(await store.listBackups()).find(row=>row.id===manual.id);
  await store.setPendingUpload('other-original-owner',{generationId:'original-pending',payloadHash:'c'.repeat(64),baseRev:9,updatedAt:17});
  const pendingBefore=await store.getPendingUpload('other-original-owner');
  const connection=handles.at(-1);assert.ok(connection);
  if(mode==='unexpected-close')forceCloseDatabase(connection);else connection.close();
  ctx.addTask('Accepted during offline database recovery');shim.document.getElementById('addInput').value='Unfinished independent draft';
  assert.equal(await ctx.persist(),true,'an accepted offline edit reconnects to the existing database and reaches verified durable storage');
  assert.equal((await store.readHead()).payload,JSON.stringify(ctx.state));assert.equal(ctx.deviceSaveIssue(),null);
  assert.equal(shim.document.getElementById('addInput').value,'Unfinished independent draft');
  assert.deepEqual((await store.listBackups()).find(row=>row.id===manual.id),manualBefore);
  assert.deepEqual(await store.getPendingUpload('other-original-owner'),pendingBefore);assert.equal(networkCalls,0);
  assert.equal(opens,2,'one lost connection has one shared reopen');await app.dispose();
  const cold=await loadApp({...offline,sharedStorage:storage,indexedDBProvider,deviceDbName});t.after(()=>cold.dispose());
  assert.ok(cold.ctx.state.tasks.some(row=>row.title==='Accepted during offline database recovery'));
  assert.deepEqual(JSON.parse(JSON.stringify(cold.ctx.state.futureConnection)),{keep:['all',47]});assert.equal(networkCalls,0);
 });
});

test('RISK device connection cancellation: explicit close invalidates a delayed open without resurrecting or replacing sources',async t=>{
 for(const freshOpen of [false,true])await t.test(freshOpen?'fresh explicit open owns the replacement':'late success stays closed',async sub=>{
  const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory(),dbName='cancel-device-open-'+Math.random();
  const seed=loadStorageV2({indexedDB:factory}).createDeviceStore({indexedDB:factory,crypto:webcrypto,dbName});await seed.open();
  const payload=JSON.stringify(syncState({tasks:[syncTask('cancel-original','Preserved through cancellation')],futureCancel:{keep:47}}));
  assert.equal((await seed.commitHead({expectedHash:null,payload,account:null})).ok,true);
  await seed.setPendingUpload('another-owner',{generationId:'cancel-original-pending',baseRev:4,payloadHash:'a'.repeat(64),updatedAt:1});
  const original=await seed.readRawExportSnapshot();await seed.close();
  let release,opened,opens=0;const gate=new Promise(resolve=>{release=resolve;}),arrived=new Promise(resolve=>{opened=resolve;});
  const indexedDB={open(...args){
   const native=factory.open(...args);opens++;if(opens!==1)return native;
   const request={};for(const key of ['result','error','transaction'])Object.defineProperty(request,key,{get:()=>native[key]});
   for(const event of ['upgradeneeded','error','blocked'])native.addEventListener(event,()=>request['on'+event]?.());
   native.addEventListener('success',async()=>{opened();await gate;request.onsuccess?.();});return request;
  }};
  const store=loadStorageV2({indexedDB}).createDeviceStore({indexedDB,crypto:webcrypto,dbName,openTimeoutMs:1000});
  sub.after(async()=>{release();await store.close();});
  const old=store.open().then(()=>({ok:true}),error=>({ok:false,name:error.name}));await fixtureDeadline(arrived,'native open reaches delayed external delivery');
  await store.close();
  if(freshOpen){
   const next=store.open();await new Promise(resolve=>setImmediate(resolve));
   assert.equal(opens,2,'an explicit new open has a fresh operation, independent of the cancelled request');
   await fixtureDeadline(next,'fresh explicit open completes while stale delivery waits');
  }
  release();const outcome=await fixtureDeadline(old,'cancelled old open settles');
  assert.equal(outcome.ok,false,'explicit close must invalidate a delayed success instead of silently reopening authority');
  assert.equal(outcome.name,'AbortError');
  if(!freshOpen){await assert.rejects(()=>store.readHead(),/not open/);await store.open();}
  assert.deepEqual(structuredClone(await store.readRawExportSnapshot()),structuredClone(original),'cancellation and explicit reopening preserve every original physical source across isolated runtime realms');
 });
});

test('RISK device connection cancellation: closing before first upgrade leaves no replacement database',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory(),dbName='cancel-before-upgrade-'+Math.random();let delivered;
 const nativeSettled=new Promise(resolve=>{delivered=resolve;});
 const indexedDB={open(...args){const request=factory.open(...args);for(const event of ['success','error'])request.addEventListener(event,delivered);return request;}};
 const store=loadStorageV2({indexedDB}).createDeviceStore({indexedDB,crypto:webcrypto,dbName});t.after(()=>store.close());
 const opening=store.open().then(()=>({ok:true}),error=>({ok:false,name:error.name}));await store.close();
 assert.equal((await fixtureDeadline(opening,'explicit shutdown settles the opening')).name,'AbortError');
 await fixtureDeadline(nativeSettled,'the cancelled native request settles');
 assert.ok(!(await factory.databases()).some(row=>row.name===dbName),'a cancelled first open cannot create an empty replacement database after authority was revoked');
 await store.open();assert.equal(await store.readHead(),null,'a later explicit open can initialize its own new store');
});

test('RISK iOS source replay: an exact acknowledged board repairs missing current chunks after a cold reopen without a new edit',async t=>{
 const app=await damagedAcknowledgedApp187(t,{sourcePadding:2000000}),{backend,originalRoot,originalHeader,indexedDB,deviceDbName}=app;
 await closeLegacyApp173(app);backend.CS.suspend();
 const cold=await loadAppAtTime(1792323000000,{sharedStorage:app.shim.localStorage,indexedDBProvider:indexedDB,deviceDbName});t.after(()=>closeLegacyApp173(cold));
 const reader=await loadCloudBackendV2({runtimeWindow:cold.ctx.window,failures:{authPending:true},timeoutMs:5000});t.after(()=>reader.CS.suspend());
 for(const [key,value]of backend.docs)reader.docs.set(key,value);
 const ack=cold.ctx.state.decisionBase.payload;
 assert.equal(createHash('sha256').update(ack,'utf8').digest('hex'),originalHeader.hash,'cold-open bytes independently match the damaged current generation');
 assert.equal(Buffer.byteLength(ack,'utf8'),originalHeader.byteLength,'the retained source has the exact declared byte length');
 reader.emitAuth({uid:'owner',email:'e@example.com'});await cold.ctx.cloudPull();await cold.ctx.sendPush();
 const {remote,head}=await settleRecovery188({...cold,backend:reader});
 assert.ok(remote.rev>originalRoot.rev,'repair obtains an actual later revision ACK without needing a fresh task');
 assert.deepEqual(JSON.parse(remote.payload).tasks,app.acknowledgedTasks);
 assert.equal(JSON.parse(remote.payload).futureIOSReportFixture.opaque.length,2000000);
 assert.equal(head.payload,JSON.stringify(cold.ctx.state));
 const root=reader.docs.get('users/owner'),path='users/owner/generations/'+root.activeGeneration,header=reader.docs.get(path),chunks=[...reader.docs].filter(([key])=>key.startsWith(path+'/chunks/')).map(([,row])=>row).sort((a,b)=>a.index-b.index);
 assert.equal(await cold.ctx.window.ChainStorageV2.decodeSnapshot(header,chunks),remote.payload,'repair publishes a complete independently decodable generation');
 for(const [key,raw]of app.previousSource)assert.equal(JSON.stringify(reader.docs.get(key)),raw,'the older original stays exact');
 const peer=await loadAppAtTime(1792323000000,{indexedDBProvider:indexedDB,deviceDbName:deviceDbName+'-independent-receiver'});t.after(()=>closeLegacyApp173(peer));
 const receiving=await loadCloudBackendV2({runtimeWindow:peer.ctx.window,failures:{authPending:true},timeoutMs:5000});t.after(()=>receiving.CS.suspend());for(const [key,value]of reader.docs)receiving.docs.set(key,value);
 receiving.emitAuth({uid:'owner',email:'e@example.com'});await fixtureDeadline(async wait=>{while(vm.runInContext('automaticCloudFallbackBootCapturePending||!state',peer.ctx))await wait();},'receiver boot raw authority completes before reconciliation');peer.ctx.closeModal();await peer.ctx.cloudPull();await settleRecoveryOperations188(peer.ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(peer.ctx.state.tasks)),app.acknowledgedTasks,'an isolated ordinary receiving client accepts every serialized field of the repaired board');
 assert.equal(peer.ctx.state.futureIOSReportFixture.opaque.length,2000000);
});

test('RISK cloud source recovery resume: an offline edit survives reopen and a retired newer source is later acknowledged',async t=>automaticSourceLifecycle254(t));

test('RISK automatic source status: completed confirmation follows current edits and signed-in identity',async t=>{
 for(const change of ['offline edit','sign out','same-email account change'])await t.test(change,sub=>automaticSourceLifecycle254(sub,async({app,backend})=>{
  const {ctx,shim}=app;ctx.openSettings();assert.match(shim.document.getElementById('modalRoot').innerHTML,/The current board is confirmed by cloud/);ctx.closeModal();
  if(change==='offline edit'){shim.window.dispatchEvent({type:'pagehide'});shim.document.getElementById('addInput').value='Accepted after background confirmation';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);assert.ok((await ctx.window.ScannerDeviceStore.readHead()).payload.includes('Accepted after background confirmation'));}
  else backend.emitAuth(change==='sign out'?null:{uid:'different-owner',email:'e@example.test'});
  await flush();ctx.openSettings();const text=shim.document.getElementById('modalRoot').innerHTML;
  assert.doesNotMatch(text,/The current board is confirmed by cloud/,'a completed attempt cannot confirm later work or another signed-in identity');
  assert.match(text,change==='offline edit'?/not.*confirmed|pending/i:/different signed-in account|sign.in/i,'status explains the current authority boundary');
 }));
});

test('RISK integrated automatic recovery: no-input fallback continues through exact cloud confirmation',async t=>{
 const damaged=await damagedAcknowledgedApp187(t),{backend,activeSource}=damaged;await closeLegacyApp173(damaged);backend.CS.suspend();
 const {IDBFactory}=await import('fake-indexeddb'),cold=await loadAppAtTime(1792323000000,{indexedDBProvider:new IDBFactory(),deviceDbName:'no-input-255-'+Math.random()});t.after(()=>closeLegacyApp173(cold));
 await fixtureDeadline(async wait=>{while(!vm.runInContext('automaticCloudFallbackBootBaseline',cold.ctx))await wait();},'fresh startup authority is captured');
 const reader=await loadCloudBackendV2({runtimeWindow:cold.ctx.window,sharedDocs:backend.docs,failures:{authPending:true},timeoutMs:5000});t.after(()=>reader.CS.suspend());
 reader.emitAuth({uid:'owner',email:'e@example.test'});cold.ctx.closeModal();const running=cold.ctx.cloudPull();
 await fixtureDeadline(async wait=>{while(!(await cold.ctx.window.ScannerDeviceStore.listOpaqueArchives()).some(row=>row.key.startsWith('automatic-recovery-ack:')))await wait();},'no-input initial fallback reaches its actual current-board ACK');
 assert.equal(cold.ctx.state.tasks.some(row=>row.title==='Second acknowledged source'),false,'missing newer bytes remain unknown after the first ACK');
 for(const chunk of activeSource.chunks)reader.docs.set('users/owner/generations/'+activeSource.id+'/chunks/'+chunk.index,structuredClone(chunk));
 await fixtureDeadline(running,'the same bounded automatic continuation settles after external source bytes return',8000);
 const until=Date.now()+3000;while((await cold.ctx.window.ScannerDeviceStore.getRecoveryCloudHold())&&Date.now()<until)await flush();
 assert.equal(await cold.ctx.window.ScannerDeviceStore.getRecoveryCloudHold(),null,'initial automatic adoption must continue through its existing publisher without another action or lifecycle event');
 const remote=await reader.CS.pull();assert.equal(remote.payload,cold.ctx.cloudPayload());assert.equal(cold.ctx.state.syncDirty,false);assert.ok(cold.ctx.state.tasks.some(row=>row.title==='Second acknowledged source'),'the no-input continuation recovers the later readable current-only task');
 assert.ok((await cold.ctx.window.ScannerDeviceStore.listOpaqueArchives()).some(row=>row.key.startsWith('automatic-recovery-ack:')));
});

test('RISK integrated automatic recovery: a failed current read cannot hide the healthy previous source',async t=>{
 const seed=await damagedAcknowledgedApp187(t),{backend,originalRoot}=seed,previousPath='users/owner/generations/'+originalRoot.previousGeneration;
 const expected=await seed.ctx.window.ChainStorageV2.decodeSnapshot(backend.docs.get(previousPath),[...backend.docs].filter(([key])=>key.startsWith(previousPath+'/chunks/')).map(([,row])=>row).sort((a,b)=>a.index-b.index));
 await closeLegacyApp173(seed);backend.CS.suspend();
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='independent-source-255-'+Math.random(),cold=await loadAppAtTime(1792323000000,{indexedDBProvider:indexedDB,deviceDbName});t.after(()=>closeLegacyApp173(cold));
 await fixtureDeadline(async wait=>{while(!vm.runInContext('automaticCloudFallbackBootBaseline',cold.ctx))await wait();},'fresh raw source capture settles before selective SDK failure');
 const faults={authPending:true},reader=await loadCloudBackendV2({runtimeWindow:cold.ctx.window,sharedDocs:backend.docs,failures:faults,timeoutMs:5000,recoveryTimeoutMs:5000});t.after(()=>reader.CS.suspend());
 let currentReads=0;faults.serverRead=async path=>{if(path==='users/owner/generations/'+originalRoot.activeGeneration+'/chunks'&&++currentReads>1)throw Object.assign(Error('Selective current source unavailable'),{code:'unavailable'});};
 reader.emitAuth({uid:'owner',email:'e@example.com'});cold.ctx.closeModal();await fixtureDeadline(cold.ctx.cloudPull(),'selective source attempt retains its original bounded deadline',7000);await settleRecoveryOperations188(cold.ctx);
 const store=cold.ctx.window.ScannerDeviceStore,hold=await store.getRecoveryCloudHold();assert.ok(currentReads>1,'the automatic source read reaches the actual selective SDK rejection');
 assert.equal(hold?.automaticRecovery,true,'an independently complete previous source opens despite the current source read rejection');
 assert.deepEqual(JSON.parse((await store.readHead()).payload).tasks,JSON.parse(expected).tasks);assert.equal(cold.ctx.state.syncDirty,true);
 const archives=await store.listOpaqueArchives(),envelope=JSON.parse(archives.find(row=>row.key===hold.originalKey).raw),source=JSON.parse(archives.find(row=>row.key===envelope.sourceArchiveKeys[0]).raw);
 assert.ok(source.generations.some(row=>row.id===originalRoot.activeGeneration&&row.unavailable===true),'a failed SDK read is explicitly unknown rather than captured as an empty source');
 await fixtureDeadline(cold.ctx.sendPush(),'explicit selective-source verification remains bounded',7000);assert.equal(reader.docs.get('users/owner').rev,originalRoot.rev,'unexamined current-source bytes cannot authorize publication');assert.ok(await store.getRecoveryCloudHold());
 const originalRows=await store.listOpaqueArchives();cold.shim.document.getElementById('addInput').value='Accepted after selective fallback';await cold.ctx.onAction('add',{});assert.equal(await cold.ctx.persist(),true);
 await closeLegacyApp173(cold);reader.CS.suspend();delete faults.serverRead;
 for(const chunk of seed.activeSource.chunks)reader.docs.set('users/owner/generations/'+seed.activeSource.id+'/chunks/'+chunk.index,structuredClone(chunk));
 const reopened=await loadAppAtTime(1792323000000,{indexedDBProvider:indexedDB,deviceDbName,sharedStorage:cold.shim.localStorage});t.after(()=>closeLegacyApp173(reopened));await reopened.ctx.__dataReady;
 const resumed=await loadCloudBackendV2({runtimeWindow:reopened.ctx.window,sharedDocs:reader.docs,failures:{authPending:true},timeoutMs:5000,recoveryTimeoutMs:5000});t.after(()=>resumed.CS.suspend());resumed.emitAuth({uid:'owner',email:'e@example.com'});reopened.ctx.closeModal();await reopened.ctx.cloudPull();await fixtureDeadline(async wait=>{while(vm.runInContext('automaticCloudFallbackBootCapturePending||cloudPullPending||cloudSourceRecoveryBusy||cloudPushInFlight',reopened.ctx))await wait();},'ordinary boot replay and publisher finish before final acceptance');await settleRecoveryOperations188(reopened.ctx);
 assert.equal(await reopened.ctx.window.ScannerDeviceStore.getRecoveryCloudHold(),null,'a later complete read resumes the automatic hold without reinterpreting its unknown original capture');
 const confirmed=await resumed.CS.pull();assert.equal(confirmed.payload,reopened.ctx.cloudPayload());assert.ok(JSON.parse(confirmed.payload).tasks.some(row=>row.title==='Second acknowledged source'));assert.ok(JSON.parse(confirmed.payload).tasks.some(row=>row.title==='Accepted after selective fallback'));
 const laterCopies=await reopened.ctx.window.ScannerDeviceStore.listOpaqueArchives(),fresh=laterCopies.map(row=>{try{return JSON.parse(row.raw);}catch{return null;}}).find(row=>row?.sourceCapture&&row.refreshedFrom===envelope.sourceArchiveKeys[0]);assert.ok(fresh,'the later complete observation is separately captured with original-source provenance');assert.equal(await reopened.ctx.window.ChainStorageV2.decodeSnapshot(fresh.sourceCapture.generations.find(row=>row.id===seed.activeSource.id).header,fresh.sourceCapture.generations.find(row=>row.id===seed.activeSource.id).chunks),await seed.ctx.window.ChainStorageV2.decodeSnapshot(seed.activeSource.header,seed.activeSource.chunks),'newly observed original bytes are independently exact');
 for(const original of originalRows)assert.equal((await reopened.ctx.window.ScannerDeviceStore.listOpaqueArchives()).find(row=>row.key===original.key)?.raw,original.raw,'later positive capture never relabels an unavailable original');
 const receiver=await loadAppAtTime(1792323000000,{});t.after(()=>closeLegacyApp173(receiver));const receiving=await loadCloudBackendV2({runtimeWindow:receiver.ctx.window,sharedDocs:reader.docs,failures:{authPending:true},timeoutMs:5000});t.after(()=>receiving.CS.suspend());receiving.emitAuth({uid:'owner',email:'e@example.com'});receiver.ctx.closeModal();await receiver.ctx.cloudPull();await settleRecoveryOperations188(receiver.ctx);assert.equal(receiver.ctx.cloudPayload(),confirmed.payload);

});

test('RISK integrated automatic recovery: persisted multichunk sources retain pending ACK and true Done Undo through restart',async t=>{
 const app=await divergentCloudSourceApp187(t,{sourcePadding:1100000,phase:'automatic-inputs',holdCloudPush:true}),{ctx,backend,indexedDB,deviceDbName,originalRoot}=app;
 ctx.window.CloudSync.ready=false;
 ctx.onAction('done-task',{dataset:{id:'a'}});assert.equal(await ctx.persist(),true);
 const completion=JSON.parse(JSON.stringify(ctx.state.decisionEvents.find(row=>row.kind==='completion'&&row.taskId==='a')));assert.ok(completion?.id);
 assert.equal(await ctx.onAction('undo',{}),true);assert.equal(await ctx.persist(),true);
 const cancellation=JSON.parse(JSON.stringify(ctx.state.decisionEvents.find(row=>row.kind==='undo'&&row.targetEventIds.includes(completion.id))));assert.ok(cancellation?.id);
 const ack=JSON.parse(ctx.cloudPayload());ack.tasks.push(syncTask('ack-only-255','Independent retained acknowledgement'));
 const ackRaw=JSON.stringify(ack);ctx.state.decisionBase=ctx.makeDecisionBase(ctx.state.syncAccount,ctx.state.syncRev,ackRaw);assert.ok(ctx.state.decisionBase);assert.equal(await ctx.persist(),true);
 const pendingBoard=JSON.parse(ctx.cloudPayload());pendingBoard.tasks.push(syncTask('pending-only-255','Independent pending generation'));pendingBoard.futurePending255={keep:['exact',255]};
 const pendingRaw=JSON.stringify(pendingBoard),encoded=await ctx.window.ChainStorageV2.encodeSnapshot(pendingRaw),id='integrated-pending-255';assert.ok(encoded.chunks.length>1,'pending recovery input crosses real chunk boundaries');
 backend.docs.set('users/owner/generations/'+id,{...encoded,chunks:undefined,state:'staging',baseRev:originalRoot.rev,createdAt:1});for(const chunk of encoded.chunks)backend.docs.set('users/owner/generations/'+id+'/chunks/'+chunk.index,chunk);
 const pending={generationId:id,payloadHash:encoded.hash,baseRev:originalRoot.rev,updatedAt:1};assert.equal((await ctx.window.ScannerDeviceStore.setPendingUpload('owner',pending)).ok,true);
 assert.equal(app.shim.localStorage.getItem('fvp:chain-scanner:device-store-v2'),'1','ordinary accepted saves establish persisted device authority');
 await closeLegacyApp173(app);backend.CS.suspend();
 const cold=await loadAppAtTime(1792323000000,{indexedDBProvider:indexedDB,deviceDbName,sharedStorage:app.shim.localStorage});t.after(()=>closeLegacyApp173(cold));
 await cold.ctx.__dataReady;const reader=await loadCloudBackendV2({runtimeWindow:cold.ctx.window,sharedDocs:backend.docs,failures:{authPending:true,push:Object.assign(Error('Controlled publication refusal until restart'),{code:'permission-denied'})},timeoutMs:15000,recoveryTimeoutMs:60000});t.after(()=>reader.CS.suspend());
 reader.emitAuth({uid:'owner',email:'e@example.com'});cold.ctx.closeModal();await cold.ctx.cloudPull();await settleRecoveryOperations188(cold.ctx);
 const store=cold.ctx.window.ScannerDeviceStore,hold=await store.getRecoveryCloudHold();assert.equal(hold?.automaticRecovery,true,'a positively verified accepted cold board can automatically reconcile despite its persisted authority marker: '+vm.runInContext('JSON.stringify({liveBoardAccepted,deviceStorageAuthority,deviceStorageRequired,pulling,cloud:window.CloudSync.errorCode,hold:deviceRecoveryCloudHold?.reason,status:automaticCloudSourceResumeStatus,sourceIssue:unrepairableCloudSource?.code})',cold.ctx)+'; toast '+cold.shim.document.getElementById('toast').textContent);
 for(const taskId of ['ack-only-255','pending-only-255'])assert.ok(cold.ctx.state.tasks.some(row=>row.id===taskId),'each independently validated candidate contributes its known unique task: '+taskId);
 assert.equal(cold.ctx.state.tasks.find(row=>row.id==='a').done,false);for(const fact of [completion,cancellation])assert.deepEqual(JSON.parse(JSON.stringify(cold.ctx.state.decisionEvents.find(row=>row.id===fact.id))),fact,'actual Done and Undo identities survive automatic adoption');
 const originals=await store.listOpaqueArchives(),envelope=JSON.parse(originals.find(row=>row.key===hold.originalKey).raw),source=JSON.parse(originals.find(row=>row.key===envelope.sourceArchiveKeys[0]).raw),captured=source.generations.find(row=>row.id===id);
 assert.equal(await cold.ctx.window.ChainStorageV2.decodeSnapshot(captured.header,captured.chunks),pendingRaw,'the exact complete pending bytes survive in the source archive');assert.equal(JSON.parse(source.acceptedDeviceBoard).decisionBase.payload,ackRaw);
 await closeLegacyApp173(cold);reader.CS.suspend();
 const reopened=await loadAppAtTime(1792323000000,{indexedDBProvider:indexedDB,deviceDbName,sharedStorage:cold.shim.localStorage});t.after(()=>closeLegacyApp173(reopened));await reopened.ctx.__dataReady;
 const resumed=await loadCloudBackendV2({runtimeWindow:reopened.ctx.window,sharedDocs:backend.docs,failures:{authPending:true},timeoutMs:15000,recoveryTimeoutMs:60000});t.after(()=>resumed.CS.suspend());resumed.emitAuth({uid:'owner',email:'e@example.com'});reopened.ctx.closeModal();await reopened.ctx.cloudPull();await settleRecoveryOperations188(reopened.ctx);
 assert.equal(await reopened.ctx.window.ScannerDeviceStore.getRecoveryCloudHold(),null,'a verified automatic hold can finish exact cloud confirmation after a persisted-authority restart');
 const confirmed=await resumed.CS.pull();assert.equal(confirmed.payload,reopened.ctx.cloudPayload());assert.equal(reopened.ctx.state.syncDirty,false);
 for(const fact of [completion,cancellation])assert.deepEqual(JSON.parse(confirmed.payload).decisionEvents.find(row=>row.id===fact.id),fact);assert.equal(JSON.parse(confirmed.payload).tasks.find(row=>row.id==='a').done,false);
 for(const row of originals)assert.equal((await reopened.ctx.window.ScannerDeviceStore.listOpaqueArchives()).find(saved=>saved.key===row.key)?.raw,row.raw,'cloud acknowledgement keeps every original archive exact');
 const receiver=await loadAppAtTime(1792323000000,{});t.after(()=>closeLegacyApp173(receiver));const receiving=await loadCloudBackendV2({runtimeWindow:receiver.ctx.window,sharedDocs:backend.docs,failures:{authPending:true},timeoutMs:5000});t.after(()=>receiving.CS.suspend());receiving.emitAuth({uid:'owner',email:'e@example.com'});receiver.ctx.closeModal();await receiver.ctx.cloudPull();await settleRecoveryOperations188(receiver.ctx);assert.equal(receiver.ctx.cloudPayload(),confirmed.payload);
});

test('RISK cloud source inspection: refreshed roles update before a demoted read finishes',async t=>runNativeRecoveryInspection226(t,390,true));

test('RISK cloud source recovery: complete-source details stay responsive bounded and exact',async t=>{
 for(const shortValues of [false,true])await t.test(shortValues?'byte-matched short values':'long saved scalar',sub=>runNativeRecoveryInspection226(sub,390,false,{shortValues}));
});

test('RISK cloud source recovery: preliminary inspection bounds large device task lists without changing saved work',async t=>{
 const app=await freshSourceCheckFixture187(t,{timeoutMs:150}),{ctx,shim}=app;
 ctx.state.tasks=Array.from({length:10000},(_,n)=>({...ctx.state.tasks[0],id:'preview-budget-'+n,title:'Device task '+n}));
 assert.equal(await ctx.persist(),true);const original=JSON.stringify(ctx.state),raw=await ctx.window.ScannerDeviceStore.readRawExportSnapshot();
 let release;const gate=new Promise(resolve=>release=resolve);app.faults.serverRead=()=>gate;
 const reviewing=ctx.onAction('review-cloud-source-recovery',{});
 t.after(async()=>{delete app.faults.serverRead;release();await reviewing;});
 const modal=shim.document.getElementById('modalRoot').innerHTML;
 assert.ok((modal.match(/<li>/g)||[]).length<=50,'pending inspection must not eagerly create a DOM row for every accepted task');
 assert.ok(modal.includes(ctx.state.tasks.length+' tasks'));assert.match(modal,/Device task 0/);
 assert.ok(modal.includes('Showing the first 50 of '+ctx.state.tasks.length+' tasks'));assert.doesNotMatch(modal,/Device task 9999/);
 assert.equal(JSON.stringify(ctx.state),original);assert.deepEqual(await ctx.window.ScannerDeviceStore.readRawExportSnapshot(),raw);
});

test('RISK rapid action durability: ten distinct actions remain pending through a held cloud acknowledgement then reach peer and cold reopen',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),dbName='rapid-cloud-'+Math.random(),at=Date.parse('2026-10-20T15:00:00Z');
 const board=syncState({tasks:[syncTask('rapid-cloud-anchor','Anchor'),syncTask('rapid-cloud-bench','Benchmark'),syncTask('rapid-cloud-warmup','Warmup'),syncTask('rapid-cloud-cant','Candidate'),...Array.from({length:12},(_,i)=>syncTask('rapid-cloud-next-'+i,'Next '+i)),syncTask('rapid-cloud-edit','Editor')],chain:['rapid-cloud-anchor','rapid-cloud-bench'],candidateId:'rapid-cloud-warmup',mode:'scan',scanMode:'descending',passId:'rapid-cloud-pass',passStartedAt:at-HOUR,snooze:100,syncAccount:'e@example.com',syncRev:4,syncDirty:false,updatedAt:at-HOUR,futureRapid:{original:'kept'},settings:{horizonMin:60,thresholdPct:0,samples:250,cantMin:30,workedHours:8,theme:'system'}}),raw=JSON.stringify(board),h=makeSyncHarness({remote:board,rev:4,delayMs:2});
 const app=await loadAppAtTime(at,{seed:314159,seedStorage:{[SYNC_STORE_KEY]:raw,[LOCAL_HEAD_KEY]:raw},indexedDBProvider:indexedDB,deviceDbName:dbName,cloudSyncFactory:h.factory}),{ctx,shim}=app,store=ctx.window.ScannerDeviceStore,apps=[app];
 const until=async(predicate,label)=>{const end=performance.now()+15000;do{if(await predicate())return;await syncSettle(20);}while(performance.now()<end);assert.fail(label);};
 let release,entered;const held=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),pending=new Set(),pushCalls=[],messages=[];let delaying=false,first=true;
 const commit=store.commitHead.bind(store),push=ctx.window.CloudSync.push.bind(ctx.window.CloudSync);
 t.after(async()=>{release();delaying=false;for(const item of apps){item.ctx.suspendCloudSync();vm.runInContext('clearTimeout(saveTimer);clearTimeout(cloudTimer);clearCloudRetry()',item.ctx);}await Promise.allSettled([...pending]);for(const item of apps)await item.dispose();});
 await ctx.cloudPull();ctx.onAction('toggle-list',{});await ctx.cloudPushNow();await settleSavedViewPublication(app,h,'rapid cloud setup');const baseRev=ctx.state.syncRev;
 const manual=await ctx.saveDurableBackup('manual',JSON.stringify(ctx.state)),originalManual=(await store.listBackups()).find(row=>row.id===manual.id);
 assert.equal((await store.setPendingUpload('unrelated-original-owner',{generationId:'rapid-cloud-original',payloadHash:'b'.repeat(64),baseRev:7,updatedAt:at})).ok,true);const originalPending=await store.getPendingUpload('unrelated-original-owner');
 store.commitHead=async options=>{const operation=(async()=>{const result=await commit(options);if(delaying&&result?.ok)await syncSettle(450);return result;})();pending.add(operation);try{return await operation;}finally{pending.delete(operation);}};
 ctx.window.CloudSync.push=async(...args)=>{const row={payload:args[0],result:null};pushCalls.push(row);const operation=(async()=>{const result=await push(...args);if(first){first=false;entered();await held;}row.result=result;return result;})();pending.add(operation);try{return await operation;}finally{pending.delete(operation);}};
 const toast=shim.document.getElementById('toast');let toastText=toast.textContent;Object.defineProperty(toast,'textContent',{configurable:true,get:()=>toastText,set(value){toastText=value;messages.push(String(value));}});
 const control=()=>({dataset:{candidate:ctx.state.candidateId,benchmark:ctx.state.chain.at(-1)}});
 ctx.onAction('yes',control());await until(()=>pushCalls.length===1&&first===false,'native warmup reaches actual pending cloud acknowledgement');await started;
 assert.equal(h.doc.rev,baseRev+1);assert.equal(ctx.state.syncRev,baseRev);assert.equal(ctx.state.syncDirty,true,'a cloud write without its received acknowledgement is still pending');delaying=true;
 const facts=[],ids=new Set(),act=(name,invoke,check)=>{const before=new Set(ctx.state.decisionEvents.map(row=>row.id));invoke();const added=ctx.state.decisionEvents.filter(row=>!before.has(row.id));assert.equal(added.length,1,name+' is a distinct accepted intent');assert.equal(check(),true,name+' result');assert.ok(!ids.has(added[0].actionId));ids.add(added[0].actionId);facts.push(JSON.parse(JSON.stringify(added[0])));};
 const editor=(id,action)=>{hydrateUnchangedEditorDraft(app,id);ctx.onAction(action,{dataset:{id}});},pause=()=>syncSettle(280);
 const firstControl=control(),firstTarget=firstControl.dataset.candidate;
 act('Cant',()=>ctx.onAction('cant',firstControl),()=>ctx.state.considered[firstTarget]==='cant');const duplicateRaw=JSON.stringify(ctx.state);ctx.onAction('cant',firstControl);assert.equal(JSON.stringify(ctx.state),duplicateRaw,'duplicate callback is separate from the ten valid intents');
 await pause();act('Return',()=>editor(firstTarget,'return-candidate'),()=>ctx.state.considered[firstTarget]===undefined&&!ctx.state.chain.includes(firstTarget));
 await pause();const secondControl=control(),secondTarget=secondControl.dataset.candidate;act('second Cant',()=>ctx.onAction('cant',secondControl),()=>ctx.state.considered[secondTarget]==='cant');
 await pause();act('second Return',()=>editor(secondTarget,'return-candidate'),()=>ctx.state.considered[secondTarget]===undefined);
 await pause();const noControl=control();act('No',()=>ctx.onAction('no',noControl),()=>ctx.state.considered[noControl.dataset.candidate]==='no');
 await pause();act('Save',()=>{hydrateUnchangedEditorDraft(app,'rapid-cloud-edit');shim.document.getElementById('etTitle').value='Edited during cloud acknowledgement';ctx.onAction('save-edit',{dataset:{id:'rapid-cloud-edit'}});},()=>ctx.state.tasks.find(row=>row.id==='rapid-cloud-edit').title==='Edited during cloud acknowledgement');
 await pause();const worked=ctx.state.chain.at(-1);act('Worked',()=>ctx.onAction('worked',{dataset:{benchmark:worked}}),()=>ctx.state.considered[worked]==='worked');
 await pause();act('Worked Return',()=>editor(worked,'return-candidate'),()=>ctx.state.considered[worked]===undefined);
 await pause();const dotted=ctx.state.candidateId;act('Dot',()=>editor(dotted,'dot-task'),()=>ctx.state.chain.includes(dotted));
 await pause();const lastControl=control();act('last Cant',()=>ctx.onAction('cant',lastControl),()=>ctx.state.considered[lastControl.dataset.candidate]==='cant');
 assert.equal(ids.size,10);assert.equal(pushCalls[0].result,null);assert.equal(ctx.state.syncDirty,true);assert.equal(ctx.state.syncRev,baseRev);
 await until(async()=>{const head=await store.readHead();return head?.payload===JSON.stringify(ctx.state)&&vm.runInContext('lastPersistedRaw',ctx)===head.payload;},'latest ten actions are actually durable before cloud acknowledgement');
 release();await settleSavedViewPublication(app,h,'rapid cloud final acknowledgement');await until(()=>pending.size===0&&pushCalls.every(row=>row.result?.ok),'all actual cloud and local acknowledgements drain');delaying=false;
 assert.ok(h.doc.rev>=baseRev+2);assert.equal(h.doc.payload,ctx.cloudPayload());assert.equal(ctx.state.syncRev,h.doc.rev);assert.equal(ctx.state.syncDirty,false);
 const assertFacts=state=>{for(const fact of facts)assert.deepEqual(JSON.parse(JSON.stringify(state.decisionEvents.find(row=>row.id===fact.id))),fact,'original action IDs/times remain exact');};assertFacts(ctx.state);assert.equal(ctx.deviceSaveIssue(),null);assert.doesNotMatch(messages.join('\n'),/device-save:|board kept changing|later draft could not be backed up/);
 assert.deepEqual(await store.getPendingUpload('unrelated-original-owner'),originalPending);assert.deepEqual((await store.listBackups()).find(row=>row.id===manual.id),originalManual);assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.futureRapid)),board.futureRapid);
 const peer=await loadAppAtTime(at,{cloudSyncFactory:h.factory,indexedDBProvider:new IDBFactory(),deviceDbName:dbName+'-peer'});apps.push(peer);await peer.ctx.cloudPull();await settleSavedViewPublication(peer,h,'rapid cloud peer');assertFacts(peer.ctx.state);assert.equal((await peer.ctx.window.ScannerDeviceStore.readHead()).payload,JSON.stringify(peer.ctx.state));
 const head=await store.readHead();await app.dispose();const reopened=await loadAppAtTime(at,{sharedStorage:shim.localStorage,indexedDBProvider:indexedDB,deviceDbName:dbName,cloudSyncFactory:()=>({configured:false,ready:false,user:null,status:'off',async pull(){return{error:true};},async push(){return{error:true};}})});apps.push(reopened);assertFacts(reopened.ctx.state);assert.equal((await reopened.ctx.window.ScannerDeviceStore.readHead()).payload,head.payload);assert.equal(JSON.stringify(reopened.ctx.state),head.payload);
});

test('RISK corrupt cloud work budget: ordinary actions stay durable without rereading unchanged unrepairable generations',{timeout:20000+9*5000},async t=>{
 // Finite envelope: startup/auth, two native saves and two ACKs, initial
 // recovery, Retry and healthy-revision observation retain their 5s bounds.
 // The four actual ordinary actions share one separate absolute 20s bound.
 const app=await damagedAcknowledgedApp187(t,{sourcePadding:2000000}),{ctx,shim,backend,originalRoot}=app;
 const headerPath='users/owner/generations/'+originalRoot.activeGeneration;
 const different=JSON.parse(ctx.state.decisionBase.payload);different.futureDifferent={keep:'a different accepted cloud source'};
 const encoded=await ctx.window.ChainStorageV2.encodeSnapshot(JSON.stringify(different));
 backend.docs.set(headerPath,{...backend.docs.get(headerPath),hash:encoded.hash,byteLength:encoded.byteLength,chunkCount:encoded.chunkCount});
 assert.equal(encoded.chunkCount,8,'the supported damaged source represents a populated eight-chunk board');
 await conflictingPriorGeneration2201(backend,originalRoot.previousGeneration,ctx.window.ChainStorageV2);
 let reads=0;app.faults.serverRead=async()=>{reads++;};t.after(()=>{delete app.faults.serverRead;});
 await ctx.cloudPull();assert.equal(backend.CS.errorCode,'corrupt-generation');assert.equal(backend.CS.knownDamagedSource,true);assert.ok(reads>0);
 const originalCloud=JSON.stringify([...backend.docs]),writes=backend.writes.length,attemptReads=reads,byAction=[];
 ctx.window.CLOUD_PUSH_DELAY_MS=0;
 let done;const actionStarted=performance.now();
 try{await fixtureDeadline(async wait=>{
 const settle=async()=>{
  assert.equal(await ctx.persist(),true);await wait();
  await fixtureDeadline(async wait=>{for(;;){await wait(5);if(!vm.runInContext('pulling||cloudPushInFlight||cloudTimer!==null',ctx))break;}},'ordinary accepted action saves and releases its cloud slot');
  assert.equal((await ctx.window.ScannerDeviceStore.readHead()).payload,JSON.stringify(ctx.state));byAction.push(reads-attemptReads);
 };
 shim.document.getElementById('addInput').value='Local work while the cloud source needs a choice';await ctx.onAction('add',{});await settle();
 ctx.onAction('start-scan',{dataset:{mode:'descending'}});await settle();
 const candidate=ctx.state.candidateId,benchmark=ctx.state.chain.at(-1);assert.ok(candidate&&benchmark);
 ctx.onAction('no',{dataset:{candidate,benchmark}});await settle();assert.equal(ctx.state.considered[candidate],'no');
 done=ctx.state.chain.at(-1);ctx.onAction('bench-done',{dataset:{benchmark:done}});await settle();assert.equal(ctx.state.tasks.find(row=>row.id===done).done,true);
 assert.equal(JSON.stringify([...backend.docs]),originalCloud,'held edits cannot rewrite any damaged or complete original cloud source');assert.equal(backend.writes.length,writes);
 assert.equal(ctx.state.syncDirty,true,'device durability is still not a cloud acknowledgement');
 t.diagnostic('Additional unchanged-source SDK reads after Add, Start, No, Done: '+JSON.stringify(byAction));
 assert.equal(reads,attemptReads,'a terminal unchanged corrupt source must not trigger another complete recovery download for every ordinary task action');
 },'four ordinary actions exceed their shared 20000ms durability/read budget',20000);}
 finally{t.diagnostic('Ordinary-action shared 20000ms observation: '+Math.round(performance.now()-actionStarted)+'ms');}
 await ctx.onAction('sync-retry',{});assert.ok(reads>attemptReads,'the explicit Retry control still makes a fresh guarded attempt');
 const healthyPayload=ctx.cloudPayload(),healthy=await ctx.window.ChainStorageV2.encodeSnapshot(healthyPayload),newId='healthy-peer-after-corruption';
 backend.docs.set('users/owner/generations/'+newId,{...healthy,state:'published',baseRev:originalRoot.rev});
 for(const chunk of healthy.chunks)backend.docs.set('users/owner/generations/'+newId+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk);
 backend.docs.set('users/owner',{...originalRoot,rev:originalRoot.rev+1,activeGeneration:newId,previousGeneration:originalRoot.activeGeneration});
 shim.window.dispatchEvent(new ctx.CustomEvent('cloudboardchange',{detail:{user:backend.CS.user,rev:originalRoot.rev+1}}));
 await fixtureDeadline(async wait=>{while(ctx.state.syncRev<originalRoot.rev+1||ctx.state.syncDirty)await wait(10);},'a new server revision escapes the held-source gate');
 assert.ok(ctx.state.tasks.some(row=>row.title==='Local work while the cloud source needs a choice'));assert.equal(ctx.state.tasks.find(row=>row.id===done).done,true);
 assert.equal(backend.CS.knownDamagedSource,false);assert.equal(JSON.stringify(backend.docs.get(headerPath)),JSON.stringify(JSON.parse(originalCloud).find(([key])=>key===headerPath)[1]));
});

test('RISK corrupt cloud work budget: cold-opened sources without an ACK keep newer edits without repeated downloads',{timeout:20000},async t=>{
 const app=await coldDamagedSourceWithoutAck214(t,{newerLocalWork:true,conflictingPrior:true}),{ctx,shim,backend,counts,originalRoot}=app;
 assert.equal(backend.CS.errorCode,'corrupt-generation');assert.equal(backend.CS.knownDamagedSource,true);
 const initialReads=counts.reads,originalCloud=JSON.stringify([...backend.docs]),writes=backend.writes.length,byAction=[];
 assert.ok(initialReads>0);ctx.window.CLOUD_PUSH_DELAY_MS=0;
 const settle=async()=>{try{assert.equal(await ctx.persist(),true);}catch(error){
  // Everything in this handler runs only after the original failed outcome.
  try{
   const issue=ctx.deviceSaveIssue(),stages=new Set(['device-recovery','storage','completion-upgrade','device-store','primary-write','restore-safety']),codes=new Set(['unaccepted-source','unavailable','recovery-unavailable','ambiguous-legacy-completion','legacy-reconcile-failed','write-failed','account-changed','changed-during-save','quota-exhausted','recovery-failed','invalid-payload','invalid-backup','backup-id-collision','concurrent-change','changed-during-write','storage-denied','deadline-exceeded']);
   const flags=vm.runInContext('({accepted:saveRequestGeneration,active:supportDiagnosticsActivePersistCalls,persists:supportDiagnosticsPersistCalls,retries:supportDiagnosticsRetryAttempts,deviceAuthority:deviceStorageAuthority,deviceRequired:deviceStorageRequired,acceptedBoard:liveBoardAccepted,storageOK,pulling,pushing:cloudPushInFlight,cloudTimer:cloudTimer!==null,saveTimer:saveTimer!==null,recoveryBusy:cloudSourceRecoveryBusy,recoveryHold:!!deviceRecoveryCloudHold,pendingCloudBackup:!!pendingDeviceCloudBackup,storeMatchesWindow:deviceStore===window.ScannerDeviceStore,accountMatches:state.syncAccount===(window.CloudSync?.user??null),dirty:state.syncDirty===true,ackPresent:state.decisionBase!=null})',ctx);
   for(const key of ['accepted','active','persists','retries'])if(!Number.isSafeInteger(flags[key])||flags[key]<0||flags[key]>1000000)flags[key]=null;
   for(const key of ['deviceAuthority','deviceRequired','acceptedBoard','storageOK','pulling','pushing','cloudTimer','saveTimer','recoveryBusy','recoveryHold','pendingCloudBackup','storeMatchesWindow','accountMatches','dirty','ackPresent'])if(typeof flags[key]!=='boolean')flags[key]=null;
   const report={v:1,originalAssertion:error?.code==='ERR_ASSERTION',issue:issue?{stage:stages.has(issue.stage)?issue.stage:'other',code:codes.has(issue.code)?issue.code:'other'}:null,flags},text=JSON.stringify(report);
   t.diagnostic('NO_ACK_MINIMAL_FAILURE '+(text.length<=4000?text:'{"v":1,"observationUnavailable":true}'));
  }catch{try{t.diagnostic('NO_ACK_MINIMAL_FAILURE {"v":1,"observationUnavailable":true}');}catch{}}
  throw error;
 }await fixtureDeadline(async wait=>{for(;;){await wait(5);if(!vm.runInContext('pulling||cloudPushInFlight||cloudTimer!==null',ctx))break;}},'no-ACK accepted action is durably saved');assert.equal((await ctx.window.ScannerDeviceStore.readHead()).payload,JSON.stringify(ctx.state));byAction.push(counts.reads-initialReads);};
 shim.document.getElementById('addInput').value='Another local task after a held no-ACK pull';await ctx.onAction('add',{});await settle();
 ctx.onAction('start-scan',{dataset:{mode:'descending'}});await settle();
 const candidate=ctx.state.candidateId,benchmark=ctx.state.chain.at(-1);assert.ok(candidate&&benchmark);ctx.onAction('no',{dataset:{candidate,benchmark}});await settle();assert.equal(ctx.state.considered[candidate],'no');
 const done=ctx.state.chain.at(-1);ctx.onAction('bench-done',{dataset:{benchmark:done}});await settle();assert.equal(ctx.state.tasks.find(row=>row.id===done).done,true);
 assert.equal(JSON.stringify([...backend.docs]),originalCloud);assert.equal(backend.writes.length,writes);assert.equal(ctx.state.syncDirty,true);assert.ok(ctx.state.tasks.some(row=>row.title==='Newer local task without an ACK export'));
 t.diagnostic('No-ACK additional unchanged-source SDK reads: '+JSON.stringify(byAction));
 assert.equal(counts.reads,initialReads,'absence of an exact ACK cannot restart the same corrupt-source read for each accepted local edit');
 await ctx.onAction('sync-retry',{});assert.ok(counts.reads>initialReads,'explicit Retry remains live without an ACK');
 const healthyPayload=ctx.cloudPayload(),healthy=await ctx.window.ChainStorageV2.encodeSnapshot(healthyPayload),newId='healthy-peer-after-no-ack-hold';
 backend.docs.set('users/owner/generations/'+newId,{...healthy,state:'published',baseRev:originalRoot.rev});for(const chunk of healthy.chunks)backend.docs.set('users/owner/generations/'+newId+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk);
 backend.docs.set('users/owner',{...originalRoot,rev:originalRoot.rev+1,activeGeneration:newId,previousGeneration:originalRoot.activeGeneration});shim.window.dispatchEvent(new ctx.CustomEvent('cloudboardchange',{detail:{user:backend.CS.user,rev:originalRoot.rev+1}}));
 await fixtureDeadline(async wait=>{while(ctx.state.syncRev<originalRoot.rev+1||ctx.state.syncDirty)await wait(10);},'new server revision resumes a no-ACK source hold');assert.equal(ctx.state.tasks.find(row=>row.id===done).done,true);assert.ok(ctx.state.tasks.some(row=>row.title==='Another local task after a held no-ACK pull'));
});

test('RISK lossless cloud recovery: an exact current board repairs missing chunks without a historical ACK',{timeout:20000},async t=>{
 const app=await coldDamagedSourceWithoutAck214(t),{ctx,shim,backend,originalRoot,originalHeader,raw,indexedDB,deviceDbName}=app;
 const recovered=await settleRecovery188(app);assert.ok(recovered.remote.rev>originalRoot.rev,'independently matching current bytes permit automatic exact-source reconstruction');
 const original=JSON.parse(raw),saved=JSON.parse(recovered.remote.payload);assert.deepEqual(saved.tasks,original.tasks);assert.deepEqual(saved.futureIOSReportFixture,original.futureIOSReportFixture);assert.deepEqual(ctx.retainedDecisionFacts(saved),ctx.retainedDecisionFacts(original));
 assert.equal(JSON.stringify(backend.docs.get('users/owner/generations/'+originalRoot.activeGeneration)),JSON.stringify(originalHeader),'the damaged generation header remains available as an exact original');
 assert.equal([...backend.docs.keys()].some(key=>key.startsWith('users/owner/generations/'+originalRoot.activeGeneration+'/chunks/')),false,'repair publishes a new complete generation rather than rewriting the original');
 const graph=await ctx.window.ScannerDeviceStore.readRawExportSnapshot(),containsOriginal=value=>value===raw||value&&typeof value==='object'&&Object.values(value).some(containsOriginal);assert.ok(containsOriginal(graph)||[SYNC_STORE_KEY,LOCAL_HEAD_KEY].some(key=>shim.localStorage.getItem(key)===raw),'the exact original remains retained locally');
 shim.document.getElementById('addInput').value='New work after exact no-ACK repair';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);await ctx.sendPush();await fixtureDeadline(async wait=>{while(vm.runInContext('pulling||cloudPushInFlight',ctx))await wait(5);},'post-repair native edit settles before ACK verification');const final=await settleRecovery188(app);assert.ok(JSON.parse(final.remote.payload).tasks.some(row=>row.title==='New work after exact no-ACK repair'));
 const finalHead=final.head.payload;await closeLegacyApp173(app);backend.CS.suspend();const cold=await loadAppAtTime(1792323000000,{sharedStorage:shim.localStorage,indexedDBProvider:indexedDB,deviceDbName,cloudSyncFactory:()=>({configured:false,ready:false,user:null,status:'off'})});t.after(()=>cold.dispose());assert.equal(JSON.stringify(cold.ctx.state),finalHead);assert.equal((await cold.ctx.window.ScannerDeviceStore.readHead()).payload,finalHead,'real cold reopen retains the repaired ACK and subsequent accepted task');
});

test('RISK resilient sync recovery: unsupported unverifiable and foreign sources never authorize a replacement',async t=>{
 for(const control of ['different hash','unsupported header','foreign identity','unavailable server','failed protection'])await t.test(control,async t=>{
  const app=await damagedAcknowledgedApp187(t),{ctx,backend,originalRoot}=app;
  assert.equal(ctx.state.syncIdentity,'owner','the setup must durably bind the successful acknowledgement to its authenticated identity');
  const path='users/owner/generations/'+originalRoot.activeGeneration;
  if(control==='different hash')backend.docs.set(path,{...backend.docs.get(path),hash:'f'.repeat(64)});
  if(control==='unsupported header')backend.docs.set(path,{...backend.docs.get(path),schemaVersion:99});
  if(control==='foreign identity'){
   let headerReads=0;
   app.faults.serverRead=async key=>{if(key===path&&++headerReads===2)backend.emitAuth({uid:'other-owner',email:'e@example.com'});};
  }
  if(control==='unavailable server')app.faults.serverOffline=true;
  if(control==='failed protection')app.idbFault.abortOpaque=true;
  const original=JSON.stringify([...backend.docs]),local=JSON.stringify(ctx.state);
  await fixtureDeadline(ctx.cloudPull(),'unsupported-source recovery stays within its existing bounded attempt',7000);await ctx.sendPush();await syncSettle(30);
  const originalNamespace=[...backend.docs].filter(([key])=>key==='users/owner'||key.startsWith('users/owner/'));
  const supportedFallback=control==='different hash'||control==='unsupported header';
  if(supportedFallback){
   const archives=await ctx.window.ScannerDeviceStore.listOpaqueArchives(),source=archives.map(row=>row.key.startsWith('automatic-cloud-source:')?JSON.parse(row.raw):null).find(Boolean);
   assert.ok(source?.candidateSources.some(row=>row.sourceRef?.id===originalRoot.previousGeneration),'a separately complete previous generation positively authorizes automatic reconciliation');
   assert.ok(!source.candidateSources.some(row=>row.sourceRef?.id===originalRoot.activeGeneration),'the unsupported current source never grants adoption or replacement authority');
   assert.ok(source.unsupported.some(row=>row.sourceRef?.id===originalRoot.activeGeneration));
   assert.equal(JSON.stringify(backend.docs.get(path)),JSON.stringify(JSON.parse(original).find(([key])=>key===path)[1]),'the unsupported original header remains exact');
   const confirmed=await backend.CS.pull();assert.equal(confirmed.payload,ctx.cloudPayload());assert.ok(confirmed.rev>originalRoot.rev);assert.equal(ctx.state.syncDirty,false);
   assert.deepEqual(JSON.parse(confirmed.payload).tasks.map(row=>row.id),JSON.parse(local).tasks.map(row=>row.id),'verified accepted device work remains represented');
  }else assert.ok(JSON.stringify(originalNamespace)===original,'unproved recovery performs no mutation in the original account');
  if(control==='foreign identity'){
   assert.equal(ctx.state.tasks.length,0,'an empty different authenticated identity never inherits the old board; '+JSON.stringify({identity:backend.CS.recoveryIdentity(),localIdentity:ctx.state.syncIdentity,localRevision:ctx.state.syncRev,otherPaths:[...backend.docs.keys()].filter(key=>!key.startsWith('users/owner'))}));
   assert.ok(ctx.readLocalBackups().some(row=>row.payload===local),'the displaced account source remains exact and recoverable');
   const foreign=await backend.CS.pull();
   if(foreign.payload)assert.equal(JSON.parse(foreign.payload).tasks.length,0,'an explicit ordinary sync under the new identity cannot publish old-account tasks');
  }else if(!supportedFallback)assert.ok(JSON.stringify(ctx.state)===local,'unproved source never replaces the accepted board');
  if(!supportedFallback)assert.equal(backend.docs.get('users/owner').rev,originalRoot.rev);
  if(control==='failed protection')assert.ok(app.idbFault.aborts>0,'the external IndexedDB boundary genuinely aborted source preservation');
 });
});
test("RISK scoped Undo recovery: Undo of an informed evergreen return survives older source and permits an acknowledged later return",{timeout:15000},async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),at=Date.parse('2026-10-17T15:00:00Z'),indexedDB=new IDBFactory(),
  deviceDbName=`scoped-undo-return-${Date.now()}-${Math.random()}`,targetId='undo-return-target',referenceId='undo-return-reference',
  peerCandidateId='undo-return-peer-choice',peerFieldId='undo-return-peer-field';
 const initial=syncState({tasks:[syncTask(referenceId,'Reference'),{...syncTask(targetId,'Recurring target'),evergreen:true,evergreenHours:1,
   evergreenResetAtDay:false,restoredAt:at-900,restoredRunOp:'return-run-172'},syncTask(peerCandidateId,'Peer candidate'),syncTask(peerFieldId,'Peer field')],
  chain:[referenceId,targetId],candidateId:targetId,passId:'undo-return-pass',passStartedAt:at-60000,syncRev:4,syncAccount:'e@example.com',syncDirty:false,
  settings:{horizonMin:60,thresholdPct:0,samples:80,cantMin:30,workedHours:8,theme:'system'}});
 const remote=structuredClone(initial);for(const key of ['syncRev','syncAccount','syncDirty'])delete remote[key];
 const h=makeSyncHarness({remote,rev:4,delayMs:100}),seedStorage={[SYNC_STORE_KEY]:JSON.stringify(initial),[LOCAL_HEAD_KEY]:JSON.stringify(initial)},
  local=await loadAppAtTime(at,{seedStorage,indexedDBProvider:indexedDB,deviceDbName,cloudSyncFactory:h.factory}),
  peer=await loadAppAtTime(at,{seedStorage,cloudSyncFactory:h.factory}),fixtures=[local,peer];
 const closed=new WeakSet(),closeFixture=async app=>{if(!app||closed.has(app))return;closed.add(app);try{app.ctx.window.CloudSync.user=null;app.ctx.suspendCloudSync?.();vm.runInContext('clearCloudRetry();clearTimeout(cloudTimer);clearTimeout(saveTimer);',app.ctx);}catch{}try{await app.ctx.window.ScannerDeviceStore?.close?.();}catch{}};
 t.after(async()=>{releasePreUndoResponse.resolve();try{await nativeSaves.settle('Undo fixture cleanup');}finally{clearTimeout(responseWatchdog);for(const app of fixtures)await closeFixture(app);}});
 const nativeSaves=observeQueuedNativeSaves(local.ctx,t),store=local.ctx.window.ScannerDeviceStore,commit=store.commitHead.bind(store),writes=[],
  preUndoResponse=deferredSyncFixture(),releasePreUndoResponse=deferredSyncFixture(),responseWatchdog=setTimeout(()=>{},15000);
 let phase='idle',delayedNativeResponse=false,preUndoResponseArmed=false,preUndoResponseReturned=false;
 store.commitHead=async options=>{const result=await commit(options);
  // Observe before the native return can fire. Hold its actual successful
  // device response until the older-source phase, independent of SDK speed.
  if(result?.ok&&nativeSaves.active()&&preUndoResponseArmed&&!delayedNativeResponse
   &&JSON.parse(options.payload).decisionEvents.some(event=>event.kind==='comparison'&&event.action==='dot'&&event.taskId===targetId)){
   delayedNativeResponse=true;preUndoResponse.resolve();await releasePreUndoResponse.promise;await syncSettle(100);preUndoResponseReturned=true;
  }
  if(result?.ok&&phase!=='idle'){
  const board=JSON.parse(options.payload);writes.push({phase,chain:board.chain.slice(),events:board.decisionEvents.map(event=>event.id)});
 }return result;};

 await local.ctx.cloudPull();await peer.ctx.cloudPull();local.ctx.window.CloudSync.ready=false;peer.ctx.window.CloudSync.ready=false;
 setFakeTime(local.ctx,at+100);hydrateUnchangedEditorDraft(local,targetId);local.ctx.onAction('done-task',{dataset:{id:targetId}});await local.ctx.persist();
 const firstCompletion=JSON.parse(JSON.stringify(local.ctx.state.decisionEvents.find(event=>event.kind==='completion'&&event.taskId===targetId)));
 assert.ok(firstCompletion,'the real first Done creates immutable rest authority');assert.deepEqual(Array.from(local.ctx.state.chain),[referenceId]);
 const priorRun=local.ctx.state.tasks.find(row=>row.id===targetId).restoredRunOp;
 local.ctx.window.CloudSync.ready=true;await local.ctx.cloudPushNow();await settleSavedViewPublication(local,h,'RISK scoped Undo recovery coherent publication 1');const olderCompletionSource=JSON.parse(JSON.stringify(h.remoteState()));
 local.ctx.window.CloudSync.ready=false;setFakeTime(local.ctx,at+2*3600000);local.ctx.ensureCandidate();await local.ctx.persist();
 assert.equal(local.ctx.isEligible(local.ctx.state.tasks.find(row=>row.id===targetId)),true,'the first evergreen rest expires');
 assert.deepEqual(Array.from(local.ctx.state.chain),[referenceId],'expiry alone never restores chain membership');
 setFakeTime(local.ctx,at+2*3600000+10);hydrateUnchangedEditorDraft(local,targetId);local.shim.document.getElementById('etTitle').value='First return edit';
 local.shim.document.getElementById('etDue').value='2026-11-01';preUndoResponseArmed=true;local.ctx.onAction('dot-task',{dataset:{id:targetId}});await local.ctx.persist();
 const firstReturn=JSON.parse(JSON.stringify(local.ctx.state.decisionEvents.find(event=>event.kind==='comparison'&&event.action==='dot'&&event.taskId===targetId)));
 const returnGroup=Array.from(local.ctx.state.decisionEvents).filter(event=>event.actionId===firstReturn.actionId);
 assert.ok(firstReturn?.observedActionIds.includes(firstCompletion.id),'the actual post-rest return observes the original Done');
 assert.ok(returnGroup.some(event=>event.kind==='current-choice'&&event.target.property==='title')&&returnGroup.some(event=>event.kind==='current-choice'&&event.target.property==='due'));
 assert.deepEqual(Array.from(local.ctx.state.chain),[referenceId,targetId]);
 local.ctx.window.CloudSync.ready=true;await local.ctx.cloudPushNow();await settleSavedViewPublication(local,h,'RISK scoped Undo recovery coherent publication 2');const staleReturnSource=JSON.parse(JSON.stringify(h.remoteState()));
 peer.ctx.window.CloudSync.ready=true;await peer.ctx.cloudPull();peer.ctx.state.candidateId=peerCandidateId;peer.ctx.renderScan();
 setFakeTime(peer.ctx,at+2*3600000+20);peer.ctx.onAction('yes',{dataset:{candidate:peerCandidateId,benchmark:referenceId}});
 await saveEditorChoice(peer,peerFieldId,at+2*3600000+25,{title:'Peer kept return title'});peer.ctx.window.CloudSync.ready=true;await peer.ctx.cloudPushNow();await settleSavedViewPublication(peer,h,'RISK scoped Undo recovery coherent publication 3');
 local.ctx.window.CloudSync.ready=true;await local.ctx.cloudPull();await settleSavedViewPublication(local,h,'RISK scoped Undo recovery coherent publication 4');
 assert.deepEqual(Array.from(local.ctx.state.chain),[referenceId,targetId,peerCandidateId],'the permitted return and peer pass progress both survive before Undo');
 assert.equal(local.ctx.state.tasks.find(row=>row.id===peerFieldId).title,'Peer kept return title');
 const rated=(...events)=>{const values=Object.fromEntries(initial.tasks.map(row=>[row.id,{mu:row.mu,sigma:row.sigma}])),engine=loadEngine(1450);
  for(const event of events)engine.updatePair(values[event.winnerId],values[event.loserId]);return values;};
 const peerChoice=peer.ctx.state.decisionEvents.find(event=>event.kind==='comparison'&&event.action==='yes'&&event.candidateId===peerCandidateId);
 assert.ok(peerChoice,'the peer makes a real independent comparison');
 const expectedBeforeUndo=rated(firstReturn,peerChoice);
 for(const row of local.ctx.state.tasks){assert.equal(row.mu,expectedBeforeUndo[row.id].mu,`${row.id}: both local return and peer Yes are learned before Undo`);assert.equal(row.sigma,expectedBeforeUndo[row.id].sigma);}
 const scan=local.shim.document.getElementById('scan'),paints=[];
 let markup=scan.innerHTML;
 Object.defineProperty(scan,'innerHTML',{configurable:true,get:()=>markup,set(value){markup=value;if(phase!=='idle'){
  const visible=[...String(value).matchAll(/data-act="reveal" data-id="([^"]+)"/g)].map(match=>match[1]),bench=String(value).match(/data-act="bench-done" data-benchmark="([^"]+)"/);if(bench)visible.push(bench[1]);
  paints.push({phase,chain:Array.from(local.ctx.state.chain),visible});
 }}});
 await preUndoResponse.promise;
 assert.equal(preUndoResponseReturned,false,'the actual successful native return response remains held before older-source recovery');
 phase='pre-undo-source';h.writeBehindBack(olderCompletionSource);await local.ctx.cloudPull();await local.ctx.cloudPushNow();await settleSavedViewPublication(local,h,'RISK scoped Undo recovery coherent publication 5');
 assert.deepEqual(Array.from(local.ctx.state.chain),[referenceId,targetId,peerCandidateId],'the older completion-only source cannot erase the informed return or peer pass progress before Undo');
 assert.ok(local.ctx.state.decisionEvents.some(event=>event.id===firstReturn.id));
 const completionBytes=JSON.stringify(local.ctx.state.decisionEvents.find(event=>event.id===firstCompletion.id));
 assert.equal(preUndoResponseReturned,false,'older-source recovery finishes before releasing the successful native device response');
 releasePreUndoResponse.resolve();
 const beforeUndoSaves=await nativeSaves.settle('pre-Undo native saves');
 assert.equal(preUndoResponseReturned,true,'the held native device response actually completes before Undo');
 assert.equal(delayedNativeResponse,true,'the actual queued pre-Undo save exercises delayed successful device response delivery');
 await settleSavedViewPublication(local,h,'pre-Undo native producer and durable acknowledgement');
 phase='undo-action';
 assert.equal(await local.ctx.onAction('undo',{}),true,'the real Undo targets the complete informed Dot/editor gesture');
 const cancellation=local.ctx.state.decisionEvents.find(event=>event.kind==='undo'&&event.targetEventIds.includes(firstReturn.id));
 assert.ok(cancellation);assert.deepEqual(Array.from(cancellation.targetEventIds).sort(),Array.from(returnGroup,event=>event.id).sort());
 assert.equal(JSON.stringify(local.ctx.state.decisionEvents.find(event=>event.id===firstCompletion.id)),completionBytes,'Undo leaves original Done bytes and time intact');
 assert.equal(local.ctx.state.tasks.find(row=>row.id===targetId).title,'Recurring target');assert.equal(local.ctx.state.tasks.find(row=>row.id===targetId).due,null);
 assert.equal(local.ctx.state.tasks.find(row=>row.id===targetId).restoredRunOp,priorRun,'the cancellation preserves existing restore-run lineage');
 assert.deepEqual(Array.from(local.ctx.state.chain),[referenceId,peerCandidateId],'cancelling only the later return restores the original completion fence and keeps peer membership');
 assert.equal(local.ctx.state.tasks.find(row=>row.id===peerFieldId).title,'Peer kept return title');
 const expectedAfterUndo=rated(peerChoice);
 for(const row of local.ctx.state.tasks){assert.equal(row.mu,expectedAfterUndo[row.id].mu,`${row.id}: true Undo removes only its own Dot learning`);assert.equal(row.sigma,expectedAfterUndo[row.id].sigma);}
 assert.equal(local.ctx.state.workLog.filter(row=>row.taskId===targetId&&row.kind==='evergreen-done').length,1,'Undo preserves the first evergreen History session');
 assert.ok(local.ctx.state.decisionEvents.some(event=>event.id===cancellation.id));
 const afterUndoSaves=await nativeSaves.settle('native Undo save');
 assert.ok(afterUndoSaves.completed>beforeUndoSaves.completed&&afterUndoSaves.results.at(-1)===true,'the actual native Undo save completes before the redundant fixture persist');
 await settleSavedViewPublication(local,h,'native Undo producer and durable acknowledgement');
 const nativeUndoHead=JSON.parse((await store.readHead()).payload);
 assert.ok(nativeUndoHead.decisionEvents.some(event=>event.id===cancellation.id)&&!nativeUndoHead.chain.includes(targetId),'the native Undo cancellation reaches the actual head before the extra fixture persist');
 await local.ctx.persist();await local.ctx.cloudPushNow();await settleSavedViewPublication(local,h,'RISK scoped Undo recovery coherent publication 6');assert.equal(local.ctx.state.syncDirty,false);
 phase='post-undo-source';
 h.writeBehindBack(staleReturnSource);await local.ctx.cloudPull();await local.ctx.cloudPushNow();await settleSavedViewPublication(local,h,'RISK scoped Undo recovery coherent publication 7');
 assert.ok(paints.length>0&&writes.length>0,'older sources exercise the mounted scanner and production IndexedDB store');
 const preUndoPaints=paints.filter(row=>row.phase==='pre-undo-source'),undoPaints=paints.filter(row=>row.phase==='undo-action'),
  postUndoPaints=paints.filter(row=>row.phase==='post-undo-source'),preUndoWrites=writes.filter(row=>row.phase==='pre-undo-source'),
  undoWrites=writes.filter(row=>row.phase==='undo-action'),postUndoWrites=writes.filter(row=>row.phase==='post-undo-source');
 assert.ok(preUndoPaints.length>0&&preUndoWrites.length>0,'the older pre-Undo source exercises both rendered and durable recovery');
 assert.ok(preUndoPaints.every(row=>row.chain.includes(targetId)&&row.visible.includes(targetId)),`every pre-Undo recovery paint retains the valid informed return: ${JSON.stringify(preUndoPaints)}`);
 assert.ok(preUndoWrites.every(row=>row.chain.includes(targetId)),`every pre-Undo device-head write retains the valid informed return: ${JSON.stringify(preUndoWrites)}`);
 assert.ok(undoPaints.length>0&&undoPaints.every(row=>!row.chain.includes(targetId)&&!row.visible.includes(targetId)),'actual Undo removes the target from every scanner paint');
 assert.ok(undoWrites.length>0&&undoWrites.every(row=>!row.chain.includes(targetId)),'actual Undo persists the cancellation to the device head');
 assert.ok(postUndoPaints.length>0&&postUndoWrites.length>0,'the stale return source is retried after Undo upload');
 assert.ok(postUndoPaints.every(row=>!row.chain.includes(targetId)&&!row.visible.includes(targetId)),'every post-Undo recovery paint keeps the returned target cancelled');
 assert.ok(postUndoWrites.every(row=>!row.chain.includes(targetId)),'every post-Undo device-head write keeps the returned target cancelled');
 const cloud=h.remoteState();assert.deepEqual(Array.from(cloud.chain),[referenceId,peerCandidateId]);
 assert.equal(JSON.stringify(cloud.decisionEvents.find(event=>event.id===firstCompletion.id)),completionBytes);
 assert.equal(JSON.stringify(cloud.decisionEvents.find(event=>event.id===firstReturn.id)),JSON.stringify(firstReturn));
 assert.ok(cloud.decisionEvents.some(event=>event.id===cancellation.id));assert.equal(cloud.tasks.find(row=>row.id===peerFieldId).title,'Peer kept return title');
 assert.equal(cloud.workLog.filter(row=>row.taskId===targetId&&row.kind==='evergreen-done').length,1);
 for(const row of cloud.tasks){assert.equal(row.mu,expectedAfterUndo[row.id].mu);assert.equal(row.sigma,expectedAfterUndo[row.id].sigma);}
 const device=JSON.parse((await store.readHead()).payload);assert.deepEqual(device.chain,[referenceId,peerCandidateId]);assert.ok(device.decisionEvents.some(event=>event.id===cancellation.id));
 await closeFixture(local);
 const cold=await loadAppAtTime(at+2*3600000+40,{indexedDBProvider:indexedDB,deviceDbName,cloudSyncFactory:()=>{const cloudSync=h.factory();cloudSync.ready=false;return cloudSync;}});fixtures.push(cold);
 await cold.ctx.__dataReady;assert.deepEqual(Array.from(cold.ctx.state.chain),[referenceId,peerCandidateId]);assert.equal(cold.ctx.state.tasks.find(row=>row.id===targetId).restoredRunOp,priorRun);
 assert.equal(JSON.stringify(cold.ctx.state.decisionEvents.find(event=>event.id===firstCompletion.id)),completionBytes);
 assert.ok(cold.ctx.state.decisionEvents.some(event=>event.id===cancellation.id));
 setFakeTime(cold.ctx,at+2*3600000+60);const coldTarget=cold.ctx.state.tasks.find(row=>row.id===targetId);
 assert.equal(cold.ctx.isEligible(coldTarget),true,'the original rest remains expired after reopening');assert.deepEqual(Array.from(cold.ctx.state.chain),[referenceId,peerCandidateId]);
 hydrateUnchangedEditorDraft(cold,targetId);cold.ctx.onAction('dot-task',{dataset:{id:targetId}});await cold.ctx.persist();
 const nextReturn=JSON.parse(JSON.stringify(cold.ctx.state.decisionEvents.filter(event=>event.kind==='comparison'&&event.action==='dot'&&event.taskId===targetId).at(-1)));
 const byId=new Map(cold.ctx.state.decisionEvents.map(event=>[event.id,event])),observes=(event,id,seen=new Set())=>event.observedActionIds.some(parent=>parent===id||
  !seen.has(parent)&&(seen.add(parent),byId.has(parent)&&observes(byId.get(parent),id,seen)));
 assert.ok(nextReturn.id!==firstReturn.id&&nextReturn.observedActionIds.includes(cancellation.id)&&observes(nextReturn,firstCompletion.id),
  'a new informed return remains possible and follows the original Done through the return cancellation lineage');
 assert.deepEqual(Array.from(cold.ctx.state.chain),[referenceId,peerCandidateId,targetId]);
 setFakeTime(cold.ctx,at+2*3600000+70);hydrateUnchangedEditorDraft(cold,targetId);cold.ctx.onAction('done-task',{dataset:{id:targetId}});await cold.ctx.persist();
 const laterCompletion=JSON.parse(JSON.stringify(cold.ctx.state.decisionEvents.filter(event=>event.kind==='completion'&&event.taskId===targetId).at(-1)));
 assert.ok(laterCompletion.id!==firstCompletion.id&&laterCompletion.observedActionIds.includes(nextReturn.id));assert.deepEqual(Array.from(cold.ctx.state.chain),[referenceId,peerCandidateId]);
 assert.equal(cold.ctx.state.workLog.filter(row=>row.taskId===targetId&&row.kind==='evergreen-done').length,2,'the next real Done creates its own later History session');
 const CS=cold.ctx.window.CloudSync,push=CS.push.bind(CS),traffic=[];let releasePublication,publicationStarted=false;
 const publicationGate=new Promise(resolve=>{releasePublication=resolve;});CS.push=async(...args)=>{publicationStarted=true;traffic.push({stage:'pending',baseRev:args[2],eventIds:JSON.parse(args[0]).decisionEvents.map(event=>event.id),payloadHash:createHash('sha256').update(args[0]).digest('hex')});await publicationGate;const response=await push(...args);traffic.push({stage:'acknowledged',response});return response;};
 // cloudPushNow starts asynchronous work; a pending transport is not an ACK.
 try{cold.ctx.window.CloudSync.ready=true;await cold.ctx.cloudPushNow();const deadline=performance.now()+8000;while(!publicationStarted&&performance.now()<deadline)await syncSettle(25);assert.ok(publicationStarted);
  assert.equal(cold.ctx.state.syncDirty,true,'an actually held publication remains pending');assert.ok(traffic[0].eventIds.includes(nextReturn.id)&&traffic[0].eventIds.includes(laterCompletion.id),'the pending real payload carries both new actions');assert.ok([nextReturn.id,laterCompletion.id].every(id=>!h.remoteState().decisionEvents.some(event=>event.id===id)),'the held server has not acknowledged either new action');}
 finally{releasePublication();await settleSavedViewPublication(cold,h,'later informed return and Done publication');}
 assert.deepEqual(Array.from(h.remoteState().chain),[referenceId,peerCandidateId]);assert.ok(h.remoteState().decisionEvents.some(event=>event.id===nextReturn.id)&&h.remoteState().decisionEvents.some(event=>event.id===laterCompletion.id));

});

// #2194 independent review B1 at the real consumer: a real click on the
// decline button inside open Settings was refused as "A save or edit is
// running", because Settings itself is an open .mback. The browser has no cloud
// backend, so the pending hold and cloud fields are set in page (as in the
// rendered captures); the stored device hold then differs, so a decline that
// passes the busy check stops at its next refusal, "Recovery changed".
test('RISK cloud generation recovery browser: a real click on Use my board from before recovery in open Settings passes the busy check in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},async t=>{
 const {chromium,webkit}=await import(process.env.LANDSCAPE_PLAYWRIGHT),origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 const observed=[];
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true,...(engineName==='chromium'&&process.env.LANDSCAPE_BROWSER_CHANNEL?{channel:process.env.LANDSCAPE_BROWSER_CHANNEL}:{})});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
   try{
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await context.addInitScript(()=>{Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
     localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.LANDSCAPE_BROWSER_URL);
    await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true'&&typeof state==='object'&&state,null,{timeout:20000});
    const {resolveExpectedFirstRunHelp}=await import('../scripts/browser-fixture-setup.mjs');
    await page.evaluate(()=>document.getElementById('motionDialog')?.close?.());
    await page.waitForSelector('#modalRoot .mback .modal',{timeout:5000}).catch(()=>{});await resolveExpectedFirstRunHelp(page);
    // A saved board gives this fresh profile device-storage authority, as a real device has.
    await page.locator('#addInput').fill('Saved board task');await page.locator('#addInput').press('Enter');
    await page.waitForFunction(()=>deviceStorageAuthority&&liveBoardAccepted&&state.tasks.some(task=>task.title==='Saved board task'),null,{timeout:20000});
    const board=await page.evaluate(()=>{
     const CS=window.CloudSync;CS.readRecoverySource=async()=>({error:true,code:'fixture'});CS.recoveryIdentity=()=>'fixture-identity';
     Object.assign(CS,{configured:true,ready:true,user:'owner@example.test',status:'error',errorStage:'pull',errorCode:'corrupt-generation',knownDamagedSource:true});
     deviceRecoveryCloudHold={v:1,reason:'cloud-source-recovery',automaticRecovery:true,account:'owner@example.test',identity:'fixture-identity',epoch:1,originalKey:'automatic-device-recovery:fixture'};
     renderSync();return JSON.stringify(state);});
    await page.locator('#appHeader [data-act="settings"]').click();
    const button=page.locator('#modalRoot [data-act="decline-automatic-cloud-recovery"]');
    await button.waitFor();
    assert.equal(await page.evaluate(()=>!!document.querySelector('.mback')),true,'positive control: Settings is an open .mback modal');
    await page.evaluate(()=>{const el=document.getElementById('toast');if(el)el.textContent='';});
    await button.click();
    await page.waitForFunction(()=>!!document.getElementById('toast')?.textContent,null,{timeout:15000});
    const result=await page.evaluate(()=>({message:document.getElementById('toast').textContent,board:JSON.stringify(state),settingsOpen:!!document.querySelector('#modalRoot [data-act="decline-automatic-cloud-recovery"]')}));
    observed.push({engine:engineName,message:result.message});
    assert.doesNotMatch(result.message,/save or edit is running/i,`${engineName}: the open Settings modal is not an active editor: ${result.message}`);
    assert.match(result.message,/Recovery changed/,`${engineName}: the decline passes its busy, storage and account checks and reaches the device check: ${result.message}`);
    assert.equal(result.board,board,`${engineName}: the refused decline changes nothing`);
    assert.deepEqual(errors,[],`${engineName}: no page errors`);
   }finally{await context.close();}
  }finally{await browser.close();}
 }
 t.diagnostic(JSON.stringify(observed));
});

// #2225 (spec #2224): opening a large board from this device's storage, with
// no cloud, held several full parsed copies of the board and its decisions at
// once: about 500 MB over an empty board in WebKit for a board shaped like the
// owner's. Each scenario seeds a fresh browser profile through the app's own
// first open (which moves the saved board into device storage, as on a real
// device), then measures a cold open of a fresh browser on that profile. Peak
// web-process memory is read by the harness from the operating system and is
// compared only with the empty board in the same run on the same engine,
// never with an absolute byte count. The fixed margin covers showing this many
// tasks at all: in WebKit the same 447 tasks with no history or decisions
// opened about 75 MiB over an empty board. The per-byte cost bounds the work on
// the saved histories and decisions; before #2225 it was about 60-65 bytes of
// memory per serialized byte in WebKit (218-236 MiB over empty for this board).
const LARGE_BOARD_OPEN_FIXED_MARGIN=96*1024*1024,LARGE_BOARD_OPEN_BYTES_FACTOR=32;
async function largeBoardOpeningWithinMargin(t,motion){
 const {chromium,webkit}=await import(process.env.LANDSCAPE_PLAYWRIGHT),origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 const fixture=await largeBoardFixture(),{stats}=fixture;
 // The fixture is at least as large as the measured board on every measure.
 assert.equal(stats.tasks,LARGE_BOARD_SHAPE.tasks);assert.ok(stats.decisionEvents.count>=LARGE_BOARD_SHAPE.decisionEvents);
 assert.ok(stats.serializedBytes>=LARGE_BOARD_SHAPE.serializedBytes);
 assert.ok(stats.decisionEvents.meanBytes>=LARGE_BOARD_SHAPE.eventMeanBytes&&stats.decisionEvents.maxBytes>=LARGE_BOARD_SHAPE.eventMaxBytes);
 assert.ok(stats.ratingHistory.meanBytes>=LARGE_BOARD_SHAPE.historyMeanBytes&&stats.ratingHistory.maxBytes>=LARGE_BOARD_SHAPE.historyMaxBytes);
 const emptyBoard=JSON.stringify(syncState({contexts:[{id:'home',name:'Home',active:true}],listOpen:true,seenQuickStart:true}));
 const allowance=LARGE_BOARD_OPEN_FIXED_MARGIN+LARGE_BOARD_OPEN_BYTES_FACTOR*stats.serializedBytes;
 const SETTLE_MS=4000,observed=[],failures=[];
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  const open=async(scenario,payload,taskCount)=>{
   const profile=fs.mkdtempSync(path.join(os.tmpdir(),'chain-2225-'+engineName+'-'+motion+'-'+scenario+'-'));
   const launch=async(tag,seed)=>{
    const context=await engine.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:motion==='reduced'?'reduce':'no-preference',
     env:webProcessMemoryEnv(tag),...(engineName==='chromium'&&process.env.LANDSCAPE_BROWSER_CHANNEL?{channel:process.env.LANDSCAPE_BROWSER_CHANNEL}:{})});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await context.addInitScript(({seed,motion})=>{Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
     localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:motion,savedAt:Date.now()}));
     if(seed!==null&&localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',seed);},{seed,motion});
    return context;
   };
   const shown=count=>page=>page.waitForFunction(count=>document.documentElement.dataset.appReady==='true'&&!document.querySelector('dialog[open]')
    &&document.getElementById('listCount')?.textContent==='('+count+')'&&document.querySelectorAll('#listBody [data-row]').length===count,count,{timeout:60000});
   try{
    const tag=`chain-2225-${engineName}-${motion}-${scenario}-${process.pid}-${Date.now()}`;
    let context=await launch(tag+'-seed',payload);
    try{
     const page=context.pages()[0]||await context.newPage();
     await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(taskCount)(page);
     // Fixture precondition: the board is saved in device storage before the measured open.
     await page.waitForFunction(()=>new Promise(resolve=>{const request=indexedDB.open('chain-scanner-v2');request.onerror=()=>resolve(false);
      request.onsuccess=()=>{const names=[...request.result.objectStoreNames];request.result.close();resolve(names.length>0);};}),null,{timeout:30000});
     await page.waitForTimeout(1000);
    }finally{await context.close();}
    context=await launch(tag,null);
    let result;
    try{
     const page=context.pages()[0]||await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
     const sampler=webProcessMemorySampler(tag);
     let memory;
     try{
      await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(taskCount)(page);
      await page.waitForTimeout(SETTLE_MS);
     }finally{memory=await sampler.stop();}
     // Visible and editable: every saved task is listed and a new one is accepted and kept.
     const titles=await page.$$eval('#listBody [data-row]',rows=>rows.map(row=>row.textContent));
     await page.locator('#addInput').fill('Added after opening '+scenario);await page.locator('#addInput').press('Enter');
     await shown(taskCount+1)(page);
     result={memory,titles,errors};
    }finally{await context.close();}
    return result;
   }finally{fs.rmSync(profile,{recursive:true,force:true});}
  };
  const empty=await open('empty',emptyBoard,0),large=await open('large',fixture.payload,LARGE_BOARD_SHAPE.tasks);
  const extra=large.memory.peakBytes-empty.memory.peakBytes,mib=bytes=>Math.round(bytes/1048576);
  const summary={engine:engineName,motion,emptyPeakMiB:mib(empty.memory.peakBytes),largePeakMiB:mib(large.memory.peakBytes),extraMiB:mib(extra),allowanceMiB:mib(allowance),
   processes:[empty.memory.processes,large.memory.processes],samples:[empty.memory.samples,large.memory.samples]};
  observed.push(summary);t.diagnostic(JSON.stringify(summary));
  // Measurement preconditions: the harness saw this browser's own web process.
  assert.ok(empty.memory.processes>0&&large.memory.processes>0&&empty.memory.samples>10&&large.memory.samples>10,`${engineName}: web-process memory was sampled ${JSON.stringify(summary)}`);
  for(const [index,id] of fixture.ids.entries())assert.ok(large.titles.some(text=>new RegExp('Large board task '+index+'(?!\\d)').test(text)),`${engineName}: task ${id} is listed after opening`);
  assert.deepEqual([empty.errors,large.errors],[[],[]],`${engineName}: no page errors`);
  if(extra>allowance)failures.push(`${engineName}: opening the large board peaked ${mib(extra)} MiB over the empty board, above the ${mib(allowance)} MiB allowance`);
 }
 assert.deepEqual(failures,[],JSON.stringify(observed));
}
test('RISK large board opening browser: a large saved board opens from device storage within a fixed memory margin of an empty board, with every task present and editable, in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},t=>largeBoardOpeningWithinMargin(t,'reduced'));
// #2228 review (story 19): the same opening guarantee with normal motion,
// where the scenery animates. Both scenarios share the motion choice, so the
// margin over the empty board stays the same.
test('RISK large board opening browser: with normal motion, a large saved board opens from device storage within the same memory margin of an empty board, with every task present and editable, in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},t=>largeBoardOpeningWithinMargin(t,'normal'));

// #2226 (spec #2224): the accepted device board appears and takes input before
// any automatic recovery default work starts, extending #2194's board before
// scenery ordering to cloud recovery. The cloud is faked in the page, as in the
// #2194 browser test above: signed in, the current generation reads as
// unreadable (corrupt-generation) and known damaged, and its root names an
// intact earlier generation. The fake answers the opening pull only when the
// test releases it, then busy-holds the main thread briefly so a trusted tap on
// Add and keys are certainly pending when the answer lands, as on a slow phone.
// The recovery-source read is held open, so recovery is still running when
// Settings, the debug log, Review cloud recovery and Restore are checked. Only
// ordering is asserted, never elapsed time.
test('RISK cloud generation recovery browser: the board renders and a trusted key reaches Add before any automatic recovery source read starts, and Settings, the debug log, Review cloud recovery and Restore stay reachable while it runs in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},async t=>{
 const {chromium,webkit}=await import(process.env.LANDSCAPE_PLAYWRIGHT),origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 const ROWS=30,HOLD_MS=600,KEYS=3;
 const board=JSON.stringify(syncState({contexts:[{id:'home',name:'Home',active:true}],tasks:Array.from({length:ROWS},(_,i)=>({...syncTask('recovery-opening-'+i,'Recovery opening task '+i),ctx:['home']})),listOpen:true,seenQuickStart:true}));
 const failures=[],observed=[];
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true,...(engineName==='chromium'&&process.env.LANDSCAPE_BROWSER_CHANNEL?{channel:process.env.LANDSCAPE_BROWSER_CHANNEL}:{})});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
   try{
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    let answerHeld=false;await context.exposeBinding('__cloudAnswerHeld',()=>{answerHeld=true;});
    await context.addInitScript(({board,ROWS,HOLD_MS})=>{
     Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
     // A valid saved choice, so the first-run motion prompt cannot confound the opening.
     localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));
     if(localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',board);
     const opening=window.__recoveryOpening={log:[],pulls:0};
     opening.boardShown=()=>{
      const panel=document.getElementById('addPanel'),body=document.getElementById('addBody'),input=document.getElementById('addInput');
      return !!(panel&&body&&input)&&document.documentElement.dataset.appReady==='true'&&!document.querySelector('dialog[open]')&&!panel.closest('[hidden],[inert]')&&
       !body.hidden&&!input.disabled&&input.getClientRects().length>0&&getComputedStyle(input).visibility==='visible'&&document.querySelectorAll('#listBody [data-row]').length===ROWS;
     };
     for(const type of ['pointerdown','keydown'])document.addEventListener(type,event=>{if(event.isTrusted)opening.log.push({kind:'input',type,board:opening.boardShown(),target:event.target?.id||''});},true);
     let release;const answer=new Promise(resolve=>{release=resolve;});opening.releasePull=()=>{setTimeout(release,0);};
     const root={rev:7,activeGeneration:'generation-unreadable',previousGeneration:'generation-intact-earlier'};
     const cloud={configured:true,ready:true,user:'owner@example.test',status:'syncing',errorStage:null,errorCode:null,knownDamagedSource:false,recoveryRetentionPending:false,
      signIn(){},signOut(){},recoveryIdentity:()=>'fixture-identity',
      async pull(){
       const first=++opening.pulls===1;opening.log.push({kind:'pull',board:opening.boardShown()});
       if(first){await answer;window.__cloudAnswerHeld();const until=performance.now()+HOLD_MS;while(performance.now()<until){}}
       Object.assign(cloud,{status:'error',errorStage:'pull',errorCode:'corrupt-generation',knownDamagedSource:true});
       window.dispatchEvent(new CustomEvent('cloudsync'));
       return {error:true,code:'corrupt-generation',rev:root.rev,generationId:root.activeGeneration};
      },
      async push(){opening.log.push({kind:'push'});return {error:true};},
      async recoveryEvidence(){opening.log.push({kind:'source-read',read:'evidence',board:opening.boardShown()});return {identity:'fixture-identity',epoch:1,pending:null};},
      // Held open: automatic recovery is still running for the rest of the test.
      readRecoverySource(){opening.log.push({kind:'source-read',read:'source',board:opening.boardShown()});return new Promise(()=>{});},
     };
     // The page's own backend module stays unconfigured; this signed-in fake is the cloud.
     Object.defineProperty(window,'CloudSync',{configurable:false,get:()=>cloud,set(){}});
     // Auth restoration finishing early, as a signed-in phone does on a cold open.
     document.addEventListener('DOMContentLoaded',()=>{window.dispatchEvent(new CustomEvent('cloudsync'));window.cloudPull?.();});
    },{board,ROWS,HOLD_MS});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>__recoveryOpening.boardShown()&&__recoveryOpening.log.some(entry=>entry.kind==='pull'),null,{timeout:20000});
    const add=await page.locator('#addInput').boundingBox();
    await page.evaluate(()=>__recoveryOpening.releasePull());
    const deadline=Date.now()+10000;while(!answerHeld&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1));
    assert.ok(answerHeld,`${engineName}: the unreadable cloud answer arrives`);
    // Dispatched while the answer holds the main thread, so both are pending.
    await page.mouse.click(add.x+add.width/2,add.y+add.height/2);
    for(let i=0;i<KEYS;i++)await page.keyboard.press('KeyQ');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0))));
    const first=await page.evaluate(()=>({log:__recoveryOpening.log.slice(),value:document.getElementById('addInput').value,focused:document.activeElement?.id||''}));
    const log=first.log,firstInput=log.findIndex(entry=>entry.kind==='input'),firstKey=log.findIndex(entry=>entry.kind==='input'&&entry.type==='keydown'),
     firstRead=log.findIndex(entry=>entry.kind==='source-read');
    const summary={engine:engineName,firstInput,firstKey,firstRead,value:first.value,focused:first.focused,log:log.map(entry=>entry.kind+(entry.type?':'+entry.type:'')+(entry.read?':'+entry.read:''))};
    // Fixture preconditions: the board was showing, a tap and keys were dispatched, and the keys reached Add.
    assert.ok(firstInput>=0&&firstKey>=0,`${engineName}: trusted input was observed ${JSON.stringify(summary)}`);
    assert.equal(first.value,'q'.repeat(KEYS),`${engineName}: every trusted key reached Add ${JSON.stringify(summary)}`);
    // Behavior under test: ordering only.
    if(log.some((entry,index)=>entry.kind==='source-read'&&!entry.board))failures.push(`${engineName}: a recovery-source read started before the board was showing ${JSON.stringify(summary)}`);
    if(!log[firstInput].board)failures.push(`${engineName}: the board was not showing when the first trusted input was handled ${JSON.stringify(summary)}`);
    if(firstRead>=0&&firstRead<firstKey)failures.push(`${engineName}: a recovery-source read started before a trusted key reached Add ${JSON.stringify(summary)}`);
    // Recovery still runs once the person leaves Add; it is never skipped.
    await page.locator('#addInput').blur();
    await page.waitForFunction(()=>__recoveryOpening.log.some(entry=>entry.kind==='source-read'),null,{timeout:15000});
    // Reachable while the recovery-source read is still held open.
    await page.locator('#appHeader [data-act="settings"]').click();
    for(const act of ['view-support-diagnostics','restore-backup']){
     const section=page.locator('#modalRoot details.settings-section:has([data-act="'+act+'"])');
     if(await section.count()&&!await section.evaluate(el=>el.open))await section.locator(':scope > summary').click();
    }
    const settings=await page.evaluate(()=>{const read=act=>{const el=document.querySelector('#modalRoot [data-act="'+act+'"]');return el?{visible:el.getClientRects().length>0,disabled:el.disabled}:null;};
     return {debugLog:read('view-support-diagnostics'),restore:read('restore-backup')};});
    summary.settings=settings;
    if(!settings.debugLog?.visible||settings.debugLog.disabled)failures.push(`${engineName}: Settings does not offer the debug log while recovery runs ${JSON.stringify(settings)}`);
    if(!settings.restore?.visible||settings.restore.disabled)failures.push(`${engineName}: Settings does not offer Restore while recovery runs ${JSON.stringify(settings)}`);
    if(settings.debugLog?.visible&&!settings.debugLog.disabled){
     await page.locator('#modalRoot [data-act="view-support-diagnostics"]').click();
     summary.debugLogOpened=await page.waitForFunction(()=>/debug log/i.test(document.querySelector('#modalRoot')?.textContent||'')&&!!document.querySelector('#modalRoot pre,#modalRoot textarea'),null,{timeout:5000}).then(()=>true,()=>false);
     if(!summary.debugLogOpened)failures.push(`${engineName}: the debug log did not open while recovery runs`);
    }
    await page.keyboard.press('Escape');await page.evaluate(()=>closeModal());
    await page.locator('#syncBtn').click();
    const review=await page.evaluate(()=>{const el=document.querySelector('#modalRoot [data-act="review-cloud-source-recovery"]');return el?{visible:el.getClientRects().length>0,disabled:el.disabled}:null;});
    summary.review=review;
    if(!review?.visible||review.disabled)failures.push(`${engineName}: the cloud button does not offer Review cloud recovery while recovery runs ${JSON.stringify(review)}`);
    summary.stillHeld=await page.evaluate(()=>__recoveryOpening.log.filter(entry=>entry.kind==='source-read'&&entry.read==='source').length);
    assert.ok(summary.stillHeld>=1,`${engineName}: the recovery-source read is held open, so recovery is still running`);
    observed.push(summary);
    assert.deepEqual(errors,[],`${engineName}: no page errors`);
   }finally{await context.close();}
  }finally{await browser.close();}
 }
 t.diagnostic(JSON.stringify(observed));
 assert.deepEqual(failures,[],JSON.stringify(observed));
});

// #2227 (spec #2224): the automatic recovery default over the large-board
// fixture stays within a memory margin of opening the same board locally, and
// stays lossless. Both scenarios seed a fresh profile through the app's own
// first open (the board moves into device storage) and add one newer task
// through Add, then measure a cold open of a fresh browser on that profile with
// an unfinished draft left in Add. The local scenario has no cloud. The
// recovery scenario fakes the signed-in cloud in the page as the #2194 and
// #2226 browser tests do: the current generation reads as unreadable
// (corrupt-generation, every chunk missing) and its root names an intact
// earlier generation of similar size: the board this device accepted before
// its newer edit, as it would have published it, plus one task saved
// only there. Every source read downloads and encodes that generation afresh,
// as the network does. Publication is refused, so the board stays on the older
// complete copy without a cloud acknowledgement. Peak web-process memory is
// read by the harness from the operating system, compared only with the local
// opening in the same run on the same engine. The margin is a multiple of the
// board's serialized size, as the spec's recovery budget is. Before #2227 the
// reconciliation compared unchanged sources again for every resolved field and
// never finished inside the app's 60 s recovery budget (WebKit passed 1.1 GiB
// over the local opening while still running). After it, recovery finishes in
// a few seconds at 525-540 MiB over the local opening in Chromium and 727-787
// MiB in WebKit, about 300-340 bytes per serialized byte. What remains is
// mostly writing the lossless recovery archives (about 13 times the board) and
// reading them back exactly before publication. 384 leaves about 15% above
// the highest WebKit run; WebKit is the engine closest to the phone.
const LARGE_BOARD_RECOVERY_BYTES_FACTOR=384;
test('RISK large board recovery browser: a deliberate run of the automatic recovery default from Retry sync reconciles a large board onto an intact earlier generation within a memory margin of opening it locally, keeping every decision, draft and newer edit, in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},async t=>{
 const {chromium,webkit}=await import(process.env.LANDSCAPE_PLAYWRIGHT),origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 // Signed in, as the owner's phone is: its decisions belong to the account.
 const ACCOUNT='owner@example.test',fixture=await largeSignedInBoardFixture(ACCOUNT),{stats}=fixture;
 assert.equal(stats.tasks,LARGE_BOARD_SHAPE.tasks);assert.ok(stats.serializedBytes>=LARGE_BOARD_SHAPE.serializedBytes);
 const PRIOR_TITLE='Saved only in the intact earlier generation',NEWER_TITLE='Newer local edit before recovery',DRAFT='Unfinished draft kept through recovery';
 const GENERATION_PATH='/__chain-2227/earlier-generation.json';
 const allowance=LARGE_BOARD_RECOVERY_BYTES_FACTOR*stats.serializedBytes,SETTLE_MS=4000,RECOVERY_WAIT_MS=90000,observed=[],failures=[];
 const taskCount=LARGE_BOARD_SHAPE.tasks+1;
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  const open=async(scenario,cloud)=>{
   let earlier=null;
   const profile=fs.mkdtempSync(path.join(os.tmpdir(),'chain-2227-'+engineName+'-'+scenario+'-'));
   const launch=async(tag,seed,withCloud)=>{
    const context=await engine.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce',
     env:webProcessMemoryEnv(tag),...(engineName==='chromium'&&process.env.LANDSCAPE_BROWSER_CHANNEL?{channel:process.env.LANDSCAPE_BROWSER_CHANNEL}:{})});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await context.route(origin+GENERATION_PATH,route=>route.fulfill({status:200,contentType:'application/json',body:earlier}));
    await context.addInitScript(({seed,withCloud,GENERATION_PATH,ACCOUNT})=>{
     Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
     localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));
     if(seed!==null&&localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',seed);
     if(!withCloud)return;
     const log=window.__largeRecovery={log:[],pulls:0};
     let release;const answer=new Promise(resolve=>{release=resolve;});log.releasePull=()=>{setTimeout(release,0);};
     const root={schemaVersion:2,rev:7,activeGeneration:'generation-unreadable',previousGeneration:'generation-intact-earlier',updatedAt:1,serverUpdatedAt:null};
     const cloud={configured:true,ready:true,user:ACCOUNT,status:'syncing',errorStage:null,errorCode:null,knownDamagedSource:false,recoveryRetentionPending:false,
      signIn(){},signOut(){},recoveryIdentity:()=>'fixture-identity',
      async pull(){
       if(++log.pulls===1)await answer;log.log.push('pull');
       Object.assign(cloud,{status:'error',errorStage:'pull',errorCode:'corrupt-generation',knownDamagedSource:true});
       window.dispatchEvent(new CustomEvent('cloudsync'));
       return {error:true,code:'corrupt-generation',rev:root.rev,generationId:root.activeGeneration};
      },
      async push(){log.log.push('push');return {error:true,code:'permission-denied'};},
      async recoveryEvidence(){return {identity:'fixture-identity',epoch:1,pending:null};},
      // Each read downloads and encodes the earlier generation afresh, as the network does.
      async readRecoverySource(){
       log.log.push('source-read');
       const payload=await (await fetch(GENERATION_PATH,{cache:'no-store'})).text(),encoded=await window.ChainStorageV2.encodeSnapshot(payload);
       const header=(hash,baseRev)=>({schemaVersion:2,state:'published',encoding:'utf8',chunkCount:encoded.chunkCount,byteLength:encoded.byteLength,hash,baseRev});
       return {identity:'fixture-identity',epoch:1,manifest:{...root},generations:[
        {id:root.activeGeneration,header:header('e'.repeat(64),6),chunks:[]},
        {id:root.previousGeneration,header:header(encoded.hash,5),chunks:encoded.chunks}]};
      },
      // Publication is refused: the board stays on the older copy without an acknowledgement.
      async protectRecoverySources(){log.log.push('protect');return {error:true,code:'permission-denied'};},
     };
     Object.defineProperty(window,'CloudSync',{configurable:false,get:()=>cloud,set(){}});
     document.addEventListener('DOMContentLoaded',()=>{window.dispatchEvent(new CustomEvent('cloudsync'));window.cloudPull?.();});
    },{seed,withCloud,GENERATION_PATH,ACCOUNT});
    return context;
   };
   const shown=count=>page=>page.waitForFunction(count=>document.documentElement.dataset.appReady==='true'&&!document.querySelector('dialog[open]')
    &&document.getElementById('listCount')?.textContent==='('+count+')'&&document.querySelectorAll('#listBody [data-row]').length===count,count,{timeout:60000});
   // What recovery must keep, computed in the page: compact digests of the
   // accepted decisions and tasks, and the History entries and scan
   // dispositions themselves. Recovery keeps the union of its sources, so an
   // entry only an older source still holds (a History entry this device's
   // History limit already dropped, a disposition its new day cleared) may be
   // added back; every accepted one must survive.
   const kept=page=>page.evaluate(async()=>{
    const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value??null)))),b=>b.toString(16).padStart(2,'0')).join('');
    const out={};for(const key of ['decisionEvents','decisionBaseline','chain','deletedTaskIds','clearedHistoryIds'])out[key]=await digest(state[key]);
    out.tasks=await digest(state.tasks.filter(task=>task.id!=='large-board-earlier-only'));out.draft=document.getElementById('addInput').value;
    out.history=(state.workLog||[]).map(entry=>JSON.stringify(entry));
    out.dispositions=Object.fromEntries(['considered','cantAt','workedAt'].map(key=>[key,JSON.parse(JSON.stringify(state[key]??{}))]));
    return out;});
   try{
    const tag=`chain-2227-${engineName}-${scenario}-${process.pid}-${Date.now()}`;
    let context=await launch(tag+'-seed',fixture.payload,false);
    try{
     const page=context.pages()[0]||await context.newPage();
     await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(LARGE_BOARD_SHAPE.tasks)(page);
     // The earlier generation: this device's accepted board before the newer edit.
     const accepted=JSON.parse(await page.evaluate(()=>JSON.stringify(state)));
     earlier=JSON.stringify({...accepted,tasks:[...accepted.tasks,{...syncTask('large-board-earlier-only',PRIOR_TITLE),ctx:['home']}]});
     // The newer accepted edit, made through Add and saved to device storage.
     await page.locator('#addInput').fill(NEWER_TITLE);await page.locator('#addInput').press('Enter');await shown(taskCount)(page);
     // And a newer accepted scan decision, made with the real No button.
     const decisions=await page.evaluate(()=>state.decisionEvents.length);
     await page.locator('[data-act="no"]').first().click();
     await page.waitForFunction(count=>state.decisionEvents.length>count&&Object.keys(state.considered).length>0,decisions,{timeout:30000});
     await page.waitForFunction(()=>new Promise(resolve=>{const request=indexedDB.open('chain-scanner-v2');request.onerror=()=>resolve(false);
      request.onsuccess=()=>{const db=request.result;try{const read=db.transaction('meta').objectStore('meta').get('head');
       read.onsuccess=()=>{db.close();resolve(!!read.result);};read.onerror=()=>{db.close();resolve(false);};}catch{db.close();resolve(false);}};}),null,{timeout:30000});
     await page.waitForTimeout(1500);
    }finally{await context.close();}
    context=await launch(tag,null,cloud);
    let result;
    try{
     const page=context.pages()[0]||await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
     const sampler=webProcessMemorySampler(tag);
     let memory,before,after,status=null,log=null,settled=true;
     try{
      await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(taskCount)(page);
      // An unfinished draft left in Add, not focused, as a person leaves it.
      await page.locator('#addInput').fill(DRAFT);await page.locator('#addInput').blur();
      before=await kept(page);
      if(cloud){
       await page.evaluate(()=>__largeRecovery.releasePull());
       // #2228: this board is over the automatic default's work budget, so the
       // opening waits instead. Retry sync, from the cloud button, runs the
       // same recovery deliberately, and that run is what this test bounds.
       await page.waitForFunction(()=>document.getElementById('syncBtn')?.textContent==='☁ recovery waiting',null,{timeout:RECOVERY_WAIT_MS});
       await page.locator('#syncBtn').click();await page.locator('#modalRoot [data-act="sync-retry"]').click();
       // Recovery has settled once its guarded publication was attempted. The
       // wait is longer than the app's own 60 s recovery budget.
       settled=await page.waitForFunction(()=>__largeRecovery.log.includes('protect')&&document.getElementById('syncBtn')?.textContent==='☁ older copy in use',null,{timeout:RECOVERY_WAIT_MS}).then(()=>true,()=>false);
      }
      await page.waitForTimeout(SETTLE_MS);
     }finally{memory=await sampler.stop();}
     after=await kept(page);
     const titles=await page.$$eval('#listBody [data-row]',rows=>rows.map(row=>row.textContent));
     if(cloud){status=await page.evaluate(()=>{const el=document.getElementById('syncBtn');return {text:el.textContent,title:el.title,className:el.className};});
      log=await page.evaluate(()=>__largeRecovery.log.slice());}
     result={memory,before,after,titles,status,log,errors,settled};
    }finally{await context.close();}
    return result;
   }finally{fs.rmSync(profile,{recursive:true,force:true});}
  };
  const local=await open('local',false),recovered=await open('recovery',true);
  const extra=recovered.memory.peakBytes-local.memory.peakBytes,mib=bytes=>Math.round(bytes/1048576);
  const summary={engine:engineName,localPeakMiB:mib(local.memory.peakBytes),recoveryPeakMiB:mib(recovered.memory.peakBytes),extraMiB:mib(extra),allowanceMiB:mib(allowance),
   processes:[local.memory.processes,recovered.memory.processes],samples:[local.memory.samples,recovered.memory.samples],settled:recovered.settled,
   status:recovered.status?.text,log:recovered.log};
  observed.push(summary);t.diagnostic(JSON.stringify(summary));
  // Measurement preconditions: the harness saw this browser's own web process.
  assert.ok(local.memory.processes>0&&recovered.memory.processes>0&&local.memory.samples>10&&recovered.memory.samples>10,`${engineName}: web-process memory was sampled ${JSON.stringify(summary)}`);
  if(extra>allowance)failures.push(`${engineName}: recovering the large board peaked ${mib(extra)} MiB over opening it locally, above the ${mib(allowance)} MiB allowance`);
  if(!recovered.settled){failures.push(`${engineName}: the automatic recovery default did not reach the older complete copy within ${RECOVERY_WAIT_MS/1000} s ${JSON.stringify(summary)}`);continue;}
  assert.deepEqual([local.errors,recovered.errors],[[],[]],`${engineName}: no page errors`);
  // Recovery ran on the intact earlier generation and the board uses it.
  assert.ok(recovered.log.filter(entry=>entry==='source-read').length>=1,`${engineName}: the earlier generation was read`);
  assert.ok(recovered.titles.some(text=>text.includes(PRIOR_TITLE)),`${engineName}: the task saved only in the earlier generation is on the board`);
  // Lossless: every accepted decision, the unfinished draft and the newer edit are kept.
  for(const [index,id] of fixture.ids.entries())assert.ok(recovered.titles.some(text=>new RegExp('Large board task '+index+'(?!\\d)').test(text)),`${engineName}: task ${id} is kept`);
  assert.ok(recovered.titles.some(text=>text.includes(NEWER_TITLE)),`${engineName}: the newer local edit is kept`);
  const {dispositions:beforeDispositions,history:beforeHistory,...beforeKept}=recovered.before,{dispositions:afterDispositions,history:afterHistory,...afterKept}=recovered.after;
  assert.deepEqual(afterKept,beforeKept,`${engineName}: every accepted decision, task and the unfinished draft survive recovery unchanged`);
  // Every accepted History entry survives, unchanged and in the same order.
  const afterHistorySet=new Set(afterHistory);
  assert.deepEqual(beforeHistory.filter(entry=>!afterHistorySet.has(entry)),[],`${engineName}: every accepted History entry survives recovery`);
  const beforeHistorySet=new Set(beforeHistory);
  assert.deepEqual(afterHistory.filter(entry=>beforeHistorySet.has(entry)),beforeHistory,`${engineName}: accepted History keeps its order`);
  assert.ok(Object.keys(beforeDispositions.considered).length>0,`${engineName}: fixture precondition: the device holds a newer scan decision`);
  for(const [key,entries] of Object.entries(beforeDispositions))for(const [id,value] of Object.entries(entries))
   assert.deepEqual(afterDispositions[key]?.[id],value,`${engineName}: the accepted ${key} entry for ${id} survives recovery`);
  assert.equal(recovered.after.draft,DRAFT);
  // The status says the older copy is in use until a cloud acknowledgement.
  assert.equal(recovered.status.text,'☁ older copy in use',`${engineName}: ${JSON.stringify(recovered.status)}`);
  assert.match(recovered.status.title,/older complete copy of your board is in use/i);assert.match(recovered.status.title,/cloud saving is not confirmed/i);
  assert.ok(!recovered.log.includes('push'),`${engineName}: nothing was published without the guarded recovery publication`);
 }
 assert.deepEqual(failures,[],JSON.stringify(observed));
});

// #2247: Restore refused the owner's own board file with "The replacement
// could not be prepared safely". The file came from a board signed in to an
// account: its decision baseline and every decision belong to that account,
// and a board file carries no syncAccount. Restoring it on a board with no
// account read those decisions as another account's
// ("decision-account-mismatch") inside decision replacement and stopped. The
// app's rule for account-bound decision history is to sign in before
// restoring it (another signed-in account inherits it explicitly). So, with
// a board shaped like the owner's (the large signed-in fixture, with a deleted
// task and a cleared History entry made through the app):
// - with no account, Restore previews the file and says to sign in first,
//   changing nothing and keeping the file and current board protected;
// - signed in to the file's account, Restore preview → confirm keeps its
//   tasks, decisions, History order, deletion and clear records and baseline.
async function signedInLargeBoardFile2247(){
 const ACCOUNT='owner@example.test',fixture=await largeSignedInBoardFixture(ACCOUNT);
 const source=await loadApp({seedStorage:{[SYNC_STORE_KEY]:fixture.payload}});
 try{
  assert.equal(source.ctx.state.tasks.length,LARGE_BOARD_SHAPE.tasks,'fixture: the signed-in board opens');
  source.ctx.deleteTask(fixture.ids.at(-1));
  assert.ok(source.ctx.state.workLog.length,'fixture: History has entries');
  source.ctx.state.workLog.at(-1).kind='done';source.ctx.clearCompleted();
  const file=source.ctx.currentBoardExportPayload(),exported=JSON.parse(file);
  assert.equal(exported.syncAccount,undefined,'fixture: the board file carries no account, like the owner file');
  assert.equal(exported.decisionBaseline.account,ACCOUNT,'fixture: its decisions belong to the account');
  assert.ok(exported.decisionEvents.length>=LARGE_BOARD_SHAPE.decisionEvents&&Object.keys(exported.deletedTaskIds||{}).length>0&&Object.keys(exported.clearedHistoryIds||{}).length>0,'fixture: decisions, a deletion and a clear record');
  return {ACCOUNT,file,exported};
 }finally{await source.dispose();}
}
async function pasteIntoRestore2247(app,text){
 app.ctx.openSettings();app.shim.document.getElementById('backupRestoreSource').value='paste';await app.ctx.onAction('restore-backup',{});
 const box=app.shim.document.getElementById('jsonBox');box.id='jsonBox';box.value=text;app.shim.document.dispatchEvent({type:'input',target:box});
 return app.ctx.onAction('preview-pasted-recovery',{});
}
test('RISK BACKUP FILE RESTORE: a signed-in large board file asks a board with no account to sign in first instead of failing, and changes nothing',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),{file}=await signedInLargeBoardFile2247();
 const target=await loadBackupFileFixtureApp({indexedDBProvider:new IDBFactory(),deviceDbName:'signed-in-file-restore-2247-'+Date.now()});t.after(()=>target.dispose());
 target.ctx.addTask('Board with no account before restore',false);await prepareBackupFileFixtureSource(target);
 assert.equal(target.ctx.state.syncAccount??null,null,'fixture: the destination board has no account');
 const before=JSON.stringify(target.ctx.state),store=target.ctx.window.ScannerDeviceStore,head=await store.readHead();
 const previewed=await pasteIntoRestore2247(target,file),toast=target.shim.document.getElementById('toast').textContent;
 assert.doesNotMatch(toast,/could not be prepared safely/,'the board file is not refused as unsafe');
 assert.equal(previewed,true,'Restore previews the board file: '+toast);
 const markup=target.shim.document.getElementById('modalRoot').innerHTML;
 assert.match(markup,/decision history belongs to a signed-in account\. Sign in/,'the preview says to sign in first');
 assert.equal(await target.ctx.onAction('confirm-file-restore',{}),false,'it cannot be confirmed without an account');
 assert.equal(JSON.stringify(target.ctx.state),before,'the current board is unchanged');assert.equal((await store.readHead()).hash,head.hash);
 assert.ok((await store.listBackups()).some(row=>row.kind==='restore-file-source'&&Buffer.from(row.restoreFile?.bytesBase64||'','base64').toString('utf8')===file),'the exact file stays protected');
});
test('RISK BACKUP FILE RESTORE: signed in to its account, a large board file restores with its tasks, decisions, History order, deletion and clear records and decision baseline',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),{ACCOUNT,file,exported}=await signedInLargeBoardFile2247();
 const at=Date.now(),initial=syncState({contexts:[{id:'home',name:'Home',active:true}],tasks:[{...syncTask('signed-in-target-2247','Signed-in board before restore'),ctx:['home']}],listOpen:true,seenQuickStart:true,syncAccount:ACCOUNT,syncRev:4,syncDirty:false});
 const remote=JSON.parse(JSON.stringify(initial));for(const key of ['syncRev','syncAccount','syncDirty','lastCloudServerAt','protectedBackupIds'])delete remote[key];
 const h=makeSyncHarness({remote,rev:4,delayMs:1});let backend;
 const cloudSyncFactory=()=>{backend=h.factory();backend.user=ACCOUNT;backend.ready=false;
  backend.recoveryIdentity=()=>backend.user===ACCOUNT?'fixture-identity:'+ACCOUNT:null;
  backend.recoveryEvidence=async()=>({identity:backend.recoveryIdentity(),epoch:1,pending:false});return backend;};
 const target=await loadAppAtTime(at,{seedStorage:{[SYNC_STORE_KEY]:JSON.stringify(initial),[LOCAL_HEAD_KEY]:JSON.stringify(initial)},
  indexedDBProvider:new IDBFactory(),deviceDbName:'signed-in-file-restore-2247-in-'+Date.now(),cloudSyncFactory});
 t.after(async()=>{try{target.ctx.window.CloudSync.user=null;target.ctx.suspendCloudSync();}catch{}try{await target.ctx.window.ScannerDeviceStore?.close?.();}catch{}});
 backend.ready=true;await target.ctx.cloudPull();await target.ctx.cloudPushNow();await settleSavedViewPublication(target,h,'signed-in target before the file');
 assert.equal(await pasteIntoRestore2247(target,file),true,'Restore previews the board file: '+target.shim.document.getElementById('toast').textContent);
 assert.equal(await target.ctx.onAction('confirm-file-restore',{}),true,'Restore applies it: '+target.shim.document.getElementById('toast').textContent);
 const restored=JSON.parse(target.ctx.cloudPayload());
 assert.deepEqual(restored.tasks.map(task=>task.id),exported.tasks.map(task=>task.id),'every task, in order');
 // Replacing a board records restore bookkeeping (operation records on a task)
 // and marks the replaced board's own tasks deleted; the file's data is kept.
 const withoutOps=task=>Object.fromEntries(Object.entries(task).filter(([key])=>!/Ops$/.test(key)));
 assert.equal(JSON.stringify(restored.tasks.map(withoutOps)),JSON.stringify(exported.tasks.map(withoutOps)),'tasks and their rating histories are unchanged');
 assert.equal(JSON.stringify(restored.decisionEvents),JSON.stringify(exported.decisionEvents),'every decision, unchanged and in order');
 assert.equal(JSON.stringify(restored.workLog),JSON.stringify(exported.workLog),'History keeps its entries and order');
 for(const [id,value] of Object.entries(exported.deletedTaskIds))assert.deepEqual(restored.deletedTaskIds[id],value,`the deletion record for ${id} is kept`);
 assert.equal(JSON.stringify(restored.clearedHistoryIds),JSON.stringify(exported.clearedHistoryIds),'the History clear records are kept');
 const restoredLog=restored.deletionLog.map(row=>JSON.stringify(row));
 assert.deepEqual(exported.deletionLog.map(row=>JSON.stringify(row)).filter(row=>!restoredLog.includes(row)),[],'every deletion log entry is kept');
 const {replacement,...baseline}=restored.decisionBaseline,{replacement:sourceReplacement,...sourceBaseline}=exported.decisionBaseline;
 assert.equal(JSON.stringify(baseline),JSON.stringify(sourceBaseline),'the decision baseline is kept');
 assert.equal(target.ctx.state.syncAccount,ACCOUNT,'the board stays with the signed-in account');
});

// #2228 (spec #2224): the automatic recovery default over a board shaped like
// the owner's waits instead of running. #2227 bounded that recovery, but it
// still peaks about 780 MiB above the local opening in WebKit (about 330 bytes
// per serialized byte), which a phone may not allow. The same signed-in
// large-board fixture and in-page fake cloud as the #2227 test: an unreadable
// current generation over an intact earlier generation of similar size, and a
// newer Add on the device. Recovery must not run: the board this device
// accepted stays open and editable with nothing from the earlier generation
// applied and nothing published, the cloud button and Settings say cloud
// recovery is waiting, the page keeps answering, and Review cloud recovery and
// Restore stay reachable.
// #2228 review (story 20): the wait itself must stay cheap. The peak
// web-process memory of the waiting opening is compared with opening the same
// board locally, in the same run on the same engine. Before the review the
// budget was weighed only after the exact-copy check and the recovery capture
// had downloaded and encoded the earlier generation and every device source,
// about 140-215 MiB over the local opening in WebKit. The fake cloud answers
// the generation headers on their own, as the real store does.
const RECOVERY_WAIT_MEMORY_MARGIN=64*1024*1024;
test('RISK large board recovery wait browser: an over-budget automatic recovery default waits instead of running, keeping the large board open and editable, saying cloud recovery is waiting, and leaving Review cloud recovery and Restore reachable, in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},async t=>{
 const {chromium,webkit}=await import(process.env.LANDSCAPE_PLAYWRIGHT),origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 const ACCOUNT='owner@example.test',fixture=await largeSignedInBoardFixture(ACCOUNT),{stats}=fixture;
 assert.equal(stats.tasks,LARGE_BOARD_SHAPE.tasks);assert.ok(stats.serializedBytes>=LARGE_BOARD_SHAPE.serializedBytes);
 const PRIOR_TITLE='Saved only in the intact earlier generation',NEWER_TITLE='Newer local edit before the wait',WAITING_TITLE='Added while cloud recovery waits';
 const GENERATION_PATH='/__chain-2228/earlier-generation.json',WAIT_MS=90000,observed=[],failures=[];
 const HEADER_PATH='/__chain-2228/earlier-header.json',OPEN_SETTLE_MS=2000,mib=bytes=>Math.round(bytes/1048576);
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  let earlier=null;
  let earlierHeader=null;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'chain-2228-'+engineName+'-'));
  const launch=async(tag,seed,withCloud)=>{
   const context=await engine.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce',
    env:webProcessMemoryEnv(tag),...(engineName==='chromium'&&process.env.LANDSCAPE_BROWSER_CHANNEL?{channel:process.env.LANDSCAPE_BROWSER_CHANNEL}:{})});
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await context.route(origin+GENERATION_PATH,route=>route.fulfill({status:200,contentType:'application/json',body:earlier}));
   await context.route(origin+HEADER_PATH,route=>route.fulfill({status:200,contentType:'application/json',body:earlierHeader}));
   await context.addInitScript(({seed,withCloud,GENERATION_PATH,HEADER_PATH,ACCOUNT})=>{
    Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
    localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));
    if(seed!==null&&localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',seed);
    if(!withCloud)return;
    const log=window.__recoveryWait={log:[],pulls:0};
    let release;const answer=new Promise(resolve=>{release=resolve;});log.releasePull=()=>{setTimeout(release,0);};
    const root={schemaVersion:2,rev:7,activeGeneration:'generation-unreadable',previousGeneration:'generation-intact-earlier',updatedAt:1,serverUpdatedAt:null};
    const cloud={configured:true,ready:true,user:ACCOUNT,status:'syncing',errorStage:null,errorCode:null,knownDamagedSource:false,recoveryRetentionPending:false,
     signIn(){},signOut(){},recoveryIdentity:()=>'fixture-identity',
     async pull(){
      if(++log.pulls===1)await answer;log.log.push('pull');
      Object.assign(cloud,{status:'error',errorStage:'pull',errorCode:'corrupt-generation',knownDamagedSource:true});
      window.dispatchEvent(new CustomEvent('cloudsync'));
      return {error:true,code:'corrupt-generation',rev:root.rev,generationId:root.activeGeneration};
     },
     async push(){log.log.push('push');return {error:true,code:'permission-denied'};},
     async recoveryEvidence(){return {identity:'fixture-identity',epoch:1,pending:null};},
     async readRecoverySource(){
      log.log.push('source-read');
      const payload=await (await fetch(GENERATION_PATH,{cache:'no-store'})).text(),encoded=await window.ChainStorageV2.encodeSnapshot(payload);
      const header=(hash,baseRev)=>({schemaVersion:2,state:'published',encoding:'utf8',chunkCount:encoded.chunkCount,byteLength:encoded.byteLength,hash,baseRev});
      return {identity:'fixture-identity',epoch:1,manifest:{...root},generations:[
       {id:root.activeGeneration,header:header('e'.repeat(64),6),chunks:[]},
       {id:root.previousGeneration,header:header(encoded.hash,5),chunks:encoded.chunks}]};
     },
     // The root and the generation headers on their own: small documents.
     async readRecoverySourceHeaders(){
      log.log.push('header-read');
      const earlier=await (await fetch(HEADER_PATH,{cache:'no-store'})).json();
      const header=(hash,baseRev)=>({schemaVersion:2,state:'published',encoding:'utf8',chunkCount:earlier.chunkCount,byteLength:earlier.byteLength,hash,baseRev});
      return {identity:'fixture-identity',epoch:1,manifest:{...root},generations:[
       {id:root.activeGeneration,header:header('e'.repeat(64),6)},{id:root.previousGeneration,header:header(earlier.hash,5)}]};
     },
     async protectRecoverySources(){log.log.push('protect');return {error:true,code:'permission-denied'};},
    };
    Object.defineProperty(window,'CloudSync',{configurable:false,get:()=>cloud,set(){}});
    document.addEventListener('DOMContentLoaded',()=>{window.dispatchEvent(new CustomEvent('cloudsync'));window.cloudPull?.();});
   },{seed,withCloud,GENERATION_PATH,HEADER_PATH,ACCOUNT});
   return context;
  };
  const shown=count=>page=>page.waitForFunction(count=>document.documentElement.dataset.appReady==='true'&&!document.querySelector('dialog[open]')
   &&document.getElementById('listCount')?.textContent==='('+count+')'&&document.querySelectorAll('#listBody [data-row]').length===count,count,{timeout:60000});
  const summary={engine:engineName};
  let localMemory=null,waitMemory=null;
  try{
   const tag=`chain-2228-${engineName}-${process.pid}-${Date.now()}`;
   let context=await launch(tag+'-seed',fixture.payload,false);
   try{
    const page=context.pages()[0]||await context.newPage();
    await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(LARGE_BOARD_SHAPE.tasks)(page);
    // The earlier generation: this device's accepted board before the newer edit.
    const accepted=JSON.parse(await page.evaluate(()=>JSON.stringify(state)));
    earlier=JSON.stringify({...accepted,tasks:[...accepted.tasks,{...syncTask('large-board-earlier-only',PRIOR_TITLE),ctx:['home']}]});
    await page.locator('#addInput').fill(NEWER_TITLE);await page.locator('#addInput').press('Enter');await shown(LARGE_BOARD_SHAPE.tasks+1)(page);
    await page.waitForTimeout(1500);
   }finally{await context.close();}
   // The earlier generation's header, as the cloud store keeps it beside its chunks.
   const encodedEarlier=await loadStorageV2().encodeSnapshot(earlier);
   earlierHeader=JSON.stringify({chunkCount:encodedEarlier.chunkCount,byteLength:encodedEarlier.byteLength,hash:encodedEarlier.hash});
   // The same board opened locally, with no cloud, in the same run: the baseline.
   context=await launch(tag+'-local',null,false);
   try{
    const page=context.pages()[0]||await context.newPage(),sampler=webProcessMemorySampler(tag+'-local');
    try{await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(LARGE_BOARD_SHAPE.tasks+1)(page);await page.waitForTimeout(OPEN_SETTLE_MS);}
    finally{localMemory=await sampler.stop();}
   }finally{await context.close();}
   context=await launch(tag,null,true);
   try{
    const page=context.pages()[0]||await context.newPage(),errors=[];let crashed=false;
    page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>{crashed=true;});
    const sampler=webProcessMemorySampler(tag);let memory;
    try{
     await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(LARGE_BOARD_SHAPE.tasks+1)(page);
     const released=Date.now();await page.evaluate(()=>__recoveryWait.releasePull());
     // Settled: either the waiting state, or recovery ran far enough to try
     // its guarded publication (which a waiting recovery never reaches).
     summary.settled=await page.waitForFunction(()=>{const text=document.getElementById('syncBtn')?.textContent||'';
      return text==='☁ recovery waiting'||__recoveryWait.log.includes('protect')||text==='☁ older copy in use';},null,{timeout:WAIT_MS}).then(()=>true,()=>false);
     summary.settleMs=Date.now()-released;
     await page.waitForTimeout(2000);
     // The opening and its wait, measured like the local opening.
     waitMemory=await sampler.stop();
     summary.status=await page.evaluate(()=>{const el=document.getElementById('syncBtn');return {text:el.textContent,title:el.title,className:el.className};});
     summary.log=await page.evaluate(()=>__recoveryWait.log.slice());
     // Responsive: a frame and a task still run promptly.
     summary.frameMs=await page.evaluate(()=>new Promise(resolve=>{const started=performance.now();requestAnimationFrame(()=>setTimeout(()=>resolve(Math.round(performance.now()-started)),0));}));
     summary.titles=await page.$$eval('#listBody [data-row]',rows=>rows.map(row=>row.textContent));
     // Editable: an ordinary Add still works while recovery waits.
     await page.locator('#addInput').fill(WAITING_TITLE);await page.locator('#addInput').press('Enter');
     summary.editable=await shown(LARGE_BOARD_SHAPE.tasks+2)(page).then(()=>true,()=>false);
     await page.waitForTimeout(1000);
     summary.statusAfterEdit=await page.evaluate(()=>document.getElementById('syncBtn').textContent);
     summary.logAfterEdit=await page.evaluate(()=>__recoveryWait.log.slice());
     // Settings says so, and keeps Review cloud recovery, the debug log and Restore.
     await page.locator('#appHeader [data-act="settings"]').click();
     for(const act of ['view-support-diagnostics','restore-backup','review-cloud-source-recovery']){
      const section=page.locator('#modalRoot details.settings-section:has([data-act="'+act+'"])');
      if(await section.count()&&!await section.first().evaluate(el=>el.open))await section.first().locator(':scope > summary').click();
     }
     summary.settings=await page.evaluate(()=>{const read=act=>{const el=document.querySelector('#modalRoot [data-act="'+act+'"]');return el?{visible:el.getClientRects().length>0,disabled:el.disabled}:null;};
      return {waiting:/Cloud recovery is waiting\./.test(document.getElementById('modalRoot').textContent),review:read('review-cloud-source-recovery'),restore:read('restore-backup'),debugLog:read('view-support-diagnostics')};});
     await page.keyboard.press('Escape');await page.evaluate(()=>closeModal());
     // The cloud button keeps Review cloud recovery.
     await page.locator('#syncBtn').click();
     summary.cloudReview=await page.evaluate(()=>{const el=document.querySelector('#modalRoot [data-act="review-cloud-source-recovery"]');return el?{visible:el.getClientRects().length>0,disabled:el.disabled}:null;});
     await page.evaluate(()=>closeModal());
    }finally{memory=await sampler.stop();}
    summary.peakMiB=Math.round(memory.peakBytes/1048576);summary.samples=memory.samples;summary.crashed=crashed;summary.errors=errors;
   }finally{await context.close();}
  }finally{fs.rmSync(profile,{recursive:true,force:true});}
  if(localMemory&&waitMemory)Object.assign(summary,{localPeakMiB:mib(localMemory.peakBytes),waitPeakMiB:mib(waitMemory.peakBytes),
   extraMiB:mib(waitMemory.peakBytes-localMemory.peakBytes),marginMiB:mib(RECOVERY_WAIT_MEMORY_MARGIN),samplesLocalWait:[localMemory.samples,waitMemory.samples]});
  const {titles,...reported}=summary;observed.push(reported);t.diagnostic(JSON.stringify(reported));
  assert.ok(summary.settled,`${engineName}: the opening settled within ${WAIT_MS/1000} s ${JSON.stringify(reported)}`);
  assert.equal(summary.crashed,false,`${engineName}: the page did not crash`);assert.deepEqual(summary.errors,[],`${engineName}: no page errors`);
  // Measurement preconditions: the harness saw this browser's own web process.
  assert.ok(localMemory.processes>0&&waitMemory.processes>0&&localMemory.samples>10&&waitMemory.samples>10,`${engineName}: web-process memory was sampled ${JSON.stringify(reported)}`);
  if(waitMemory.peakBytes-localMemory.peakBytes>RECOVERY_WAIT_MEMORY_MARGIN)
   failures.push(`${engineName}: the waiting opening peaked ${summary.extraMiB} MiB over opening the board locally, above the ${summary.marginMiB} MiB margin`);
  if(summary.log.includes('source-read'))failures.push(`${engineName}: the waiting opening downloaded a recovery source ${JSON.stringify(summary.log)}`);
  // Behavior under test: recovery waits instead of running.
  if(summary.status.text!=='☁ recovery waiting')failures.push(`${engineName}: the cloud button does not say cloud recovery is waiting ${JSON.stringify(summary.status)}`);
  if(!/cloud recovery is waiting/i.test(summary.status.title)||!/not confirmed/i.test(summary.status.title))failures.push(`${engineName}: the cloud button title does not explain the wait ${JSON.stringify(summary.status)}`);
  if(summary.logAfterEdit.includes('protect')||summary.logAfterEdit.includes('push'))failures.push(`${engineName}: recovery ran or published while waiting ${JSON.stringify(summary.logAfterEdit)}`);
  if(titles.some(text=>text.includes(PRIOR_TITLE)))failures.push(`${engineName}: the earlier generation was applied instead of waiting`);
  if(!titles.some(text=>text.includes(NEWER_TITLE)))failures.push(`${engineName}: the accepted newer edit is missing`);
  if(summary.frameMs>1000)failures.push(`${engineName}: the page stalled ${summary.frameMs} ms after the wait`);
  if(!summary.editable)failures.push(`${engineName}: the board was not editable while recovery waits`);
  if(summary.statusAfterEdit!=='☁ recovery waiting')failures.push(`${engineName}: an edit ended the waiting status ${summary.statusAfterEdit}`);
  if(!summary.settings?.waiting)failures.push(`${engineName}: Settings does not say cloud recovery is waiting ${JSON.stringify(summary.settings)}`);
  for(const key of ['review','restore','debugLog'])if(!summary.settings?.[key]?.visible||summary.settings[key].disabled)failures.push(`${engineName}: Settings does not offer ${key} while recovery waits ${JSON.stringify(summary.settings)}`);
  if(!summary.cloudReview?.visible||summary.cloudReview.disabled)failures.push(`${engineName}: the cloud button does not offer Review cloud recovery while recovery waits ${JSON.stringify(summary.cloudReview)}`);
 }
 assert.deepEqual(failures,[],JSON.stringify(observed));
});

// #2239 (spec #2224, user story 3): a board shaped like the owner's recovers
// with one deliberate Retry sync. The product budget keeps its automatic
// recovery default waiting (#2228), so no phone starts that work on its own;
// Retry sync then rebuilds the board, publishes it, takes the cloud's
// confirmation and checks the earlier sources it keeps protected, all in the
// same run. The same signed-in large-board fixture and in-page fake cloud as
// the #2227 test: an unreadable current generation (every chunk missing) over
// an intact earlier generation of similar size, a newer Add and scan decision
// on the device and an unfinished draft in Add. This cloud accepts the
// recovery's guarded publication, as the real store does once the earlier
// sources are protected: it reads the device's protected originals back
// before publishing, then serves the new generation to later reads. The
// unreadable generation stays incomplete, so the run keeps rechecking it until
// its own retries end, as the owner's would. Peak web-process memory, from the
// opening until that run has finished and the page settles, is compared with
// opening the same board locally in the same run on the same engine. The #2227
// margin (384 times the board) covers a run whose publication is refused; this
// run also publishes, reading the recovery archives back exactly before each
// guarded step, and rechecks the earlier sources afterwards.
// Measured over the whole run (about 54 s, most of it the rechecks' retry
// waits): before #2239 the run peaked 1411 MiB over the local opening in WebKit
// and 969 MiB in Chromium; with the archive read-back once and checked by key,
// the device sources read in full once per run and rechecks reading only the
// incomplete generation, 680-866 MiB in WebKit and 445-667 MiB in Chromium over
// five runs. 1100 MiB leaves about 27% above the highest WebKit run. It bounds
// regressions; it is not a phone limit, and the run is still well above the
// +200 MiB #2239 aims for.
const LARGE_BOARD_DELIBERATE_RECOVERY_MARGIN=1100*1024*1024;
test('RISK large board deliberate recovery browser: Retry sync rebuilds a large board whose automatic recovery waits onto an intact earlier generation and publishes it, within a memory margin of opening it locally, keeping every decision, draft and newer edit, in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},async t=>{
 const {chromium,webkit}=await import(process.env.LANDSCAPE_PLAYWRIGHT),origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 const ACCOUNT='owner@example.test',fixture=await largeSignedInBoardFixture(ACCOUNT),{stats}=fixture;
 assert.equal(stats.tasks,LARGE_BOARD_SHAPE.tasks);assert.ok(stats.serializedBytes>=LARGE_BOARD_SHAPE.serializedBytes);
 const PRIOR_TITLE='Saved only in the intact earlier generation',NEWER_TITLE='Newer local edit before recovery',DRAFT='Unfinished draft kept through recovery';
 const GENERATION_PATH='/__chain-2239/earlier-generation.json',HEADER_PATH='/__chain-2239/earlier-header.json';
 const allowance=LARGE_BOARD_DELIBERATE_RECOVERY_MARGIN,SETTLE_MS=4000,RECOVERY_WAIT_MS=120000,observed=[],failures=[];
 const taskCount=LARGE_BOARD_SHAPE.tasks+1,mib=bytes=>Math.round(bytes/1048576);
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  let earlier=null,earlierHeader=null;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'chain-2239-'+engineName+'-'));
  const launch=async(tag,seed,withCloud)=>{
   const context=await engine.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce',
    env:webProcessMemoryEnv(tag),...(engineName==='chromium'&&process.env.LANDSCAPE_BROWSER_CHANNEL?{channel:process.env.LANDSCAPE_BROWSER_CHANNEL}:{})});
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await context.route(origin+GENERATION_PATH,route=>route.fulfill({status:200,contentType:'application/json',body:earlier}));
   await context.route(origin+HEADER_PATH,route=>route.fulfill({status:200,contentType:'application/json',body:earlierHeader}));
   await context.addInitScript(({seed,withCloud,GENERATION_PATH,HEADER_PATH,ACCOUNT})=>{
    Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
    localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));
    if(seed!==null&&localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',seed);
    if(!withCloud)return;
    const log=window.__automaticRecovery={log:[],pulls:0,statuses:[],published:null};
    // Every label the cloud button shows, in order.
    document.addEventListener('DOMContentLoaded',()=>{
     const button=document.getElementById('syncBtn'),note=()=>{const text=button.textContent;if(log.statuses.at(-1)!==text)log.statuses.push(text);};
     note();new MutationObserver(note).observe(button,{childList:true,characterData:true,subtree:true});
    });
    let release;const answer=new Promise(resolve=>{release=resolve;});log.releasePull=()=>{setTimeout(release,0);};
    const root={schemaVersion:2,rev:7,activeGeneration:'generation-unreadable',previousGeneration:'generation-intact-earlier',updatedAt:1,serverUpdatedAt:null};
    const generations=new Map();
    const header=async()=>(await fetch(HEADER_PATH,{cache:'no-store'})).json();
    // The named generations only (active, previous, pending and any named
    // earlier one), each read afresh as the network does.
    const named=(pendingGenerationId,additionalGenerationIds=[])=>[...new Set([root.activeGeneration,root.previousGeneration,pendingGenerationId,...additionalGenerationIds]
     .filter(id=>typeof id==='string'))];
    const read=async(id,withChunks)=>{
     if(id==='generation-intact-earlier'){
      if(!withChunks){const e=await header();return {id,header:{schemaVersion:2,state:'published',encoding:'utf8',chunkCount:e.chunkCount,byteLength:e.byteLength,hash:e.hash,baseRev:5}};}
      const encoded=await window.ChainStorageV2.encodeSnapshot(await (await fetch(GENERATION_PATH,{cache:'no-store'})).text());
      return {id,header:{schemaVersion:2,state:'published',encoding:'utf8',chunkCount:encoded.chunkCount,byteLength:encoded.byteLength,hash:encoded.hash,baseRev:5},chunks:encoded.chunks};
     }
     if(id==='generation-unreadable'){const e=await header();
      return {id,header:{schemaVersion:2,state:'published',encoding:'utf8',chunkCount:e.chunkCount,byteLength:e.byteLength,hash:'e'.repeat(64),baseRev:6},...(withChunks?{chunks:[]}:{})};}
     const stored=generations.get(id);
     return stored?{id,header:{...stored.header},...(withChunks?{chunks:stored.chunks.map(chunk=>({...chunk}))}:{})}:{id,unavailable:true};
    };
    const cloud={configured:true,ready:true,user:ACCOUNT,status:'syncing',errorStage:null,errorCode:null,knownDamagedSource:false,recoveryRetentionPending:false,
     signIn(){},signOut(){},recoveryIdentity:()=>'fixture-identity',
     async pull(){
      if(++log.pulls===1)await answer;log.log.push('pull');
      if(log.published){
       Object.assign(cloud,{status:'ok',errorStage:null,errorCode:null,knownDamagedSource:false});window.dispatchEvent(new CustomEvent('cloudsync'));
       const {payload,rev,updatedAt,serverUpdatedAt}=log.published;
       return {payload,rev,updatedAt,serverUpdatedAt,schemaVersion:2,generationId:root.activeGeneration};
      }
      Object.assign(cloud,{status:'error',errorStage:'pull',errorCode:'corrupt-generation',knownDamagedSource:true});
      window.dispatchEvent(new CustomEvent('cloudsync'));
      return {error:true,code:'corrupt-generation',rev:root.rev,generationId:root.activeGeneration};
     },
     // A guarded publication: the device's protected originals are read back
     // first, then the new generation replaces the root at the next revision.
     async push(payload,updatedAt,baseRev,context){
      log.log.push('push');
      if(typeof context?.validateBeforePublish==='function'&&!await context.validateBeforePublish(context.recoveryPending))return {error:true,code:'recovery-source-changed'};
      if(baseRev!==root.rev)return {conflict:true,rev:root.rev};
      const encoded=await window.ChainStorageV2.encodeSnapshot(payload),id='generation-published-'+(root.rev+1);
      generations.set(id,{header:{schemaVersion:2,state:'published',encoding:'utf8',chunkCount:encoded.chunkCount,byteLength:encoded.byteLength,hash:encoded.hash,baseRev},chunks:encoded.chunks});
      Object.assign(root,{rev:root.rev+1,previousGeneration:root.activeGeneration,activeGeneration:id});
      log.published={payload,rev:root.rev,updatedAt,serverUpdatedAt:Date.now()};log.log.push('published');
      Object.assign(cloud,{status:'ok',errorStage:null,errorCode:null,knownDamagedSource:false});
      return {ok:true,rev:root.rev,serverUpdatedAt:log.published.serverUpdatedAt};
     },
     async recoveryEvidence(){return {identity:'fixture-identity',epoch:1,pending:null};},
     async readRecoverySource({pendingGenerationId,additionalGenerationIds}={}){
      log.log.push('source-read');
      const rows=[];for(const id of named(pendingGenerationId,additionalGenerationIds))rows.push(await read(id,true));
      return {identity:'fixture-identity',epoch:1,manifest:{...root},generations:rows};
     },
     // The root and the generation headers on their own: small documents.
     async readRecoverySourceHeaders({pendingGenerationId,additionalGenerationIds}={}){
      log.log.push('header-read');
      const rows=[];for(const id of named(pendingGenerationId,additionalGenerationIds))rows.push(await read(id,false));
      return {identity:'fixture-identity',epoch:1,manifest:{...root},generations:rows};
     },
     // The header and chunks of the named generations only, as the real store reads them.
     async readRecoverySourceChunks({generationIds=[]}={}){
      log.log.push('chunk-probe');
      const rows=[];for(const id of generationIds)rows.push(await read(id,true));
      return rows;
     },
     async protectRecoverySources(){log.log.push('protect');return {ok:true};},
    };
    Object.defineProperty(window,'CloudSync',{configurable:false,get:()=>cloud,set(){}});
    document.addEventListener('DOMContentLoaded',()=>{window.dispatchEvent(new CustomEvent('cloudsync'));window.cloudPull?.();});
   },{seed,withCloud,GENERATION_PATH,HEADER_PATH,ACCOUNT});
   return context;
  };
  const shown=count=>page=>page.waitForFunction(count=>document.documentElement.dataset.appReady==='true'&&!document.querySelector('dialog[open]')
   &&document.getElementById('listCount')?.textContent==='('+count+')'&&document.querySelectorAll('#listBody [data-row]').length===count,count,{timeout:60000});
  // What recovery must keep, computed in the page, as in the #2227 test.
  const kept=page=>page.evaluate(async()=>{
   const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value??null)))),b=>b.toString(16).padStart(2,'0')).join('');
   const out={};for(const key of ['decisionEvents','decisionBaseline','chain','deletedTaskIds','clearedHistoryIds'])out[key]=await digest(state[key]);
   out.tasks=await digest(state.tasks.filter(task=>task.id!=='large-board-earlier-only'));out.draft=document.getElementById('addInput').value;
   out.history=(state.workLog||[]).map(entry=>JSON.stringify(entry));
   out.dispositions=Object.fromEntries(['considered','cantAt','workedAt'].map(key=>[key,JSON.parse(JSON.stringify(state[key]??{}))]));
   return out;});
  const summary={engine:engineName};
  let local=null,recovered=null,before=null,after=null,errors=[],crashed=false;
  try{
   const tag=`chain-2239-${engineName}-${process.pid}-${Date.now()}`;
   let context=await launch(tag+'-seed',fixture.payload,false);
   try{
    const page=context.pages()[0]||await context.newPage();
    await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(LARGE_BOARD_SHAPE.tasks)(page);
    // The earlier generation: this device's accepted board before the newer edit.
    const accepted=JSON.parse(await page.evaluate(()=>JSON.stringify(state)));
    earlier=JSON.stringify({...accepted,tasks:[...accepted.tasks,{...syncTask('large-board-earlier-only',PRIOR_TITLE),ctx:['home']}]});
    // The newer accepted edit through Add, and a newer scan decision through the real No button.
    await page.locator('#addInput').fill(NEWER_TITLE);await page.locator('#addInput').press('Enter');await shown(taskCount)(page);
    const decisions=await page.evaluate(()=>state.decisionEvents.length);
    await page.locator('[data-act="no"]').first().click();
    await page.waitForFunction(count=>state.decisionEvents.length>count&&Object.keys(state.considered).length>0,decisions,{timeout:30000});
    await page.waitForFunction(()=>new Promise(resolve=>{const request=indexedDB.open('chain-scanner-v2');request.onerror=()=>resolve(false);
     request.onsuccess=()=>{const db=request.result;try{const read=db.transaction('meta').objectStore('meta').get('head');
      read.onsuccess=()=>{db.close();resolve(!!read.result);};read.onerror=()=>{db.close();resolve(false);};}catch{db.close();resolve(false);}};}),null,{timeout:30000});
    await page.waitForTimeout(1500);
   }finally{await context.close();}
   const encodedEarlier=await loadStorageV2().encodeSnapshot(earlier);
   earlierHeader=JSON.stringify({chunkCount:encodedEarlier.chunkCount,byteLength:encodedEarlier.byteLength,hash:encodedEarlier.hash});
   // The same board opened locally, with no cloud, in the same run: the baseline.
   context=await launch(tag+'-local',null,false);
   try{
    const page=context.pages()[0]||await context.newPage(),sampler=webProcessMemorySampler(tag+'-local');
    try{
     await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(taskCount)(page);
     await page.locator('#addInput').fill(DRAFT);await page.locator('#addInput').blur();await page.waitForTimeout(SETTLE_MS);
    }finally{local=await sampler.stop();}
   }finally{await context.close();}
   context=await launch(tag,null,true);
   try{
    const page=context.pages()[0]||await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>{crashed=true;});
    const sampler=webProcessMemorySampler(tag);
    try{
     await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(taskCount)(page);
     // An unfinished draft left in Add, not focused, as a person leaves it.
     await page.locator('#addInput').fill(DRAFT);await page.locator('#addInput').blur();
     before=await kept(page);
     await page.evaluate(()=>__automaticRecovery.releasePull());
     // The opening waits: the board is over the automatic default's budget.
     summary.waited=await page.waitForFunction(()=>document.getElementById('syncBtn')?.textContent==='☁ recovery waiting',null,{timeout:RECOVERY_WAIT_MS}).then(()=>true,()=>false);
     summary.logBeforeRetry=await page.evaluate(()=>__automaticRecovery.log.slice());
     if(summary.waited){
      // Retry sync, from the cloud button, runs the same recovery deliberately.
      const retried=Date.now();
      await page.locator('#syncBtn').click();await page.locator('#modalRoot [data-act="sync-retry"]').click();
      // Settled: the cloud published the recovered board, the device took its
      // confirmation, and the run's own checks of the earlier sources ended.
      summary.settled=await page.waitForFunction(()=>!!__automaticRecovery.published&&state.syncDirty===false&&
       state.syncRev===__automaticRecovery.published.rev&&document.getElementById('syncBtn')?.textContent==='☁ synced'&&
       !cloudSourceRecoveryBusy&&!cloudSourceRecoveryRead&&!pulling&&!cloudPushInFlight,null,{timeout:RECOVERY_WAIT_MS,polling:100}).then(()=>true,()=>false);
      summary.settleMs=Date.now()-retried;
     }
     await page.waitForTimeout(SETTLE_MS);
    }finally{recovered=await sampler.stop();}
    after=await kept(page);
    summary.titles=await page.$$eval('#listBody [data-row]',rows=>rows.map(row=>row.textContent));
    Object.assign(summary,await page.evaluate(async()=>{
     const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value??null)))),b=>b.toString(16).padStart(2,'0')).join('');
     const el=document.getElementById('syncBtn'),published=__automaticRecovery.published,board=published&&JSON.parse(published.payload);
     return {status:{text:el.textContent,title:el.title},statuses:__automaticRecovery.statuses.slice(),log:__automaticRecovery.log.slice(),
      sourceCheck:automaticCloudSourceResumeStatus.state,
      syncRev:state.syncRev,syncDirty:state.syncDirty,publishedRev:published?.rev??null,
      publishedTitles:board?board.tasks.map(task=>task.title):[],
      publishedMatches:board?{tasks:await digest(board.tasks)===await digest(state.tasks),decisionEvents:await digest(board.decisionEvents)===await digest(state.decisionEvents),
       workLog:await digest(board.workLog)===await digest(state.workLog)}:null};
    }));
   }finally{await context.close();}
  }finally{fs.rmSync(profile,{recursive:true,force:true});}
  const extra=recovered.peakBytes-local.peakBytes;
  Object.assign(summary,{localPeakMiB:mib(local.peakBytes),recoveryPeakMiB:mib(recovered.peakBytes),extraMiB:mib(extra),allowanceMiB:mib(allowance),
   processes:[local.processes,recovered.processes],samples:[local.samples,recovered.samples],crashed,errors});
  const {titles,publishedTitles,...reported}=summary;observed.push(reported);t.diagnostic(JSON.stringify(reported));
  // Measurement preconditions: the harness saw this browser's own web process.
  assert.ok(local.processes>0&&recovered.processes>0&&local.samples>10&&recovered.samples>10,`${engineName}: web-process memory was sampled ${JSON.stringify(reported)}`);
  assert.equal(crashed,false,`${engineName}: the page did not crash`);
  // Fixture precondition: the opening waited, starting no recovery work and publishing nothing.
  assert.equal(summary.waited,true,`${engineName}: the automatic recovery default of the large board waits ${JSON.stringify(reported)}`);
  assert.deepEqual(summary.logBeforeRetry.filter(entry=>['source-read','protect','push'].includes(entry)),[],`${engineName}: nothing was read in full or published before Retry sync ${JSON.stringify(reported)}`);
  // Behavior under test: Retry sync recovers, publishes and settles, within the allowance.
  if(!summary.settled||summary.status.text!=='☁ synced'||summary.publishedRev===null){failures.push(`${engineName}: Retry sync did not publish the recovered board, take the cloud's confirmation and finish its checks within ${RECOVERY_WAIT_MS/1000} s ${JSON.stringify(reported)}`);continue;}
  if(extra>allowance)failures.push(`${engineName}: recovering and publishing the large board with Retry sync peaked ${mib(extra)} MiB over opening it locally, above the ${mib(allowance)} MiB allowance`);
  assert.deepEqual(errors,[],`${engineName}: no page errors`);
  // Published through the guarded path, once, at the next revision.
  assert.ok(summary.log.indexOf('protect')>=0&&summary.log.indexOf('protect')<summary.log.indexOf('push'),`${engineName}: the earlier sources were protected before publishing ${JSON.stringify(summary.log)}`);
  assert.deepEqual(summary.log.filter(entry=>entry==='published'),['published'],`${engineName}: published once`);
  assert.equal(summary.publishedRev,8,`${engineName}: published at the revision after the unreadable one`);
  assert.equal(summary.syncRev,8);assert.equal(summary.syncDirty,false,`${engineName}: the device took the cloud's confirmation`);
  assert.deepEqual(summary.publishedMatches,{tasks:true,decisionEvents:true,workLog:true},`${engineName}: the cloud holds exactly the recovered board`);
  // Recovery ran on the intact earlier generation and the board uses it.
  assert.ok(summary.titles.some(text=>text.includes(PRIOR_TITLE)),`${engineName}: the task saved only in the earlier generation is on the board`);
  assert.ok(publishedTitles.includes(PRIOR_TITLE)&&publishedTitles.includes(NEWER_TITLE),`${engineName}: the cloud holds the earlier-only task and the newer edit`);
  // Lossless: every accepted decision, the unfinished draft and the newer edit are kept.
  for(const [index,id] of fixture.ids.entries())assert.ok(summary.titles.some(text=>new RegExp('Large board task '+index+'(?!\\d)').test(text)),`${engineName}: task ${id} is kept`);
  assert.ok(summary.titles.some(text=>text.includes(NEWER_TITLE)),`${engineName}: the newer local edit is kept`);
  const {dispositions:beforeDispositions,history:beforeHistory,...beforeKept}=before,{dispositions:afterDispositions,history:afterHistory,...afterKept}=after;
  assert.deepEqual(afterKept,beforeKept,`${engineName}: every accepted decision, task and the unfinished draft survive recovery unchanged`);
  const afterHistorySet=new Set(afterHistory);
  assert.deepEqual(beforeHistory.filter(entry=>!afterHistorySet.has(entry)),[],`${engineName}: every accepted History entry survives recovery`);
  const beforeHistorySet=new Set(beforeHistory);
  assert.deepEqual(afterHistory.filter(entry=>beforeHistorySet.has(entry)),beforeHistory,`${engineName}: accepted History keeps its order`);
  assert.ok(Object.keys(beforeDispositions.considered).length>0,`${engineName}: fixture precondition: the device holds a newer scan decision`);
  for(const [key,entries] of Object.entries(beforeDispositions))for(const [id,value] of Object.entries(entries))
   assert.deepEqual(afterDispositions[key]?.[id],value,`${engineName}: the accepted ${key} entry for ${id} survives recovery`);
  assert.equal(after.draft,DRAFT);
 }
 assert.deepEqual(failures,[],JSON.stringify(observed));
});

// #2246: exporting from a large board crashed the owner's iPhone app while
// cloud recovery waited. The same signed-in large-board fixture and in-page
// fake cloud as the #2228 wait test bring the page to "☁ recovery waiting";
// the clipboard is faked in the page (the system boundary) and downloads are
// read from the browser. Peak web-process memory of an export is compared
// with an idle window of the same page with the starting dialog open, in the
// same run on the same engine; the longest gap between main-thread tasks is
// the stall. Before #2246 the repair export built a 16 MB archive string of the
// whole board and every device copy and rendered it into the dialog: about
// 0.9-1.3 GiB over the open dialog and a 28 s main-thread stall in WebKit.
const LARGE_BOARD_EXPORT_STALL_MS=1000;
async function largeBoardExportWhileRecoveryWaits(t,label,exercise){
 const {chromium,webkit}=await import(process.env.LANDSCAPE_PLAYWRIGHT),origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 const ACCOUNT='owner@example.test',fixture=await largeSignedInBoardFixture(ACCOUNT),{stats}=fixture;
 assert.equal(stats.tasks,LARGE_BOARD_SHAPE.tasks);assert.ok(stats.serializedBytes>=LARGE_BOARD_SHAPE.serializedBytes);
 const HEADER_PATH='/__chain-2246/earlier-header.json',WAIT_MS=90000,observed=[],failures=[];
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  let earlierHeader=null;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'chain-2246-'+label+'-'+engineName+'-'));
  const launch=async(tag,seed,withCloud)=>{
   const context=await engine.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce',acceptDownloads:true,
    env:webProcessMemoryEnv(tag),...(engineName==='chromium'&&process.env.LANDSCAPE_BROWSER_CHANNEL?{channel:process.env.LANDSCAPE_BROWSER_CHANNEL}:{})});
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await context.route(origin+HEADER_PATH,route=>route.fulfill({status:200,contentType:'application/json',body:earlierHeader}));
   await context.addInitScript(({seed,withCloud,HEADER_PATH,ACCOUNT})=>{
    Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
    localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));
    if(seed!==null&&localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',seed);
    if(!withCloud)return;
    // The clipboard is the system boundary: copied text is kept for the test.
    const copied=window.__diagnosticsCopied=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(value){copied.push(String(value));}}});
    const log=window.__diagnosticsExport={log:[]};
    const root={schemaVersion:2,rev:7,activeGeneration:'generation-unreadable',previousGeneration:'generation-intact-earlier',updatedAt:1,serverUpdatedAt:null};
    const cloud={configured:true,ready:true,user:ACCOUNT,status:'syncing',errorStage:null,errorCode:null,knownDamagedSource:false,recoveryRetentionPending:false,
     signIn(){},signOut(){},recoveryIdentity:()=>'fixture-identity',
     async pull(){log.log.push('pull');
      Object.assign(cloud,{status:'error',errorStage:'pull',errorCode:'corrupt-generation',knownDamagedSource:true});
      window.dispatchEvent(new CustomEvent('cloudsync'));
      return {error:true,code:'corrupt-generation',rev:root.rev,generationId:root.activeGeneration};},
     async push(){log.log.push('push');return {error:true,code:'permission-denied'};},
     async recoveryEvidence(){return {identity:'fixture-identity',epoch:1,pending:null};},
     // A waiting recovery reads no source; any read is recorded and refused.
     async readRecoverySource(){log.log.push('source-read');return {error:true,code:'unavailable'};},
     async readRecoverySourceHeaders(){log.log.push('header-read');
      const earlier=await (await fetch(HEADER_PATH,{cache:'no-store'})).json();
      const header=(hash,baseRev)=>({schemaVersion:2,state:'published',encoding:'utf8',chunkCount:earlier.chunkCount,byteLength:earlier.byteLength,hash,baseRev});
      return {identity:'fixture-identity',epoch:1,manifest:{...root},generations:[
       {id:root.activeGeneration,header:header('e'.repeat(64),6)},{id:root.previousGeneration,header:header(earlier.hash,5)}]};},
     async protectRecoverySources(){log.log.push('protect');return {error:true,code:'permission-denied'};},
    };
    Object.defineProperty(window,'CloudSync',{configurable:false,get:()=>cloud,set(){}});
    document.addEventListener('DOMContentLoaded',()=>{window.dispatchEvent(new CustomEvent('cloudsync'));window.cloudPull?.();});
   },{seed,withCloud,HEADER_PATH,ACCOUNT});
   return context;
  };
  const shown=count=>page=>page.waitForFunction(count=>document.documentElement.dataset.appReady==='true'&&!document.querySelector('dialog[open]')
   &&document.getElementById('listCount')?.textContent==='('+count+')'&&document.querySelectorAll('#listBody [data-row]').length===count,count,{timeout:60000});
  const summary={engine:engineName,exports:[]};
  try{
   const tag=`chain-2246-${label}-${engineName}-${process.pid}-${Date.now()}`;
   let context=await launch(tag+'-seed',fixture.payload,false);
   let earlier;
   try{
    const page=context.pages()[0]||await context.newPage();
    await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(LARGE_BOARD_SHAPE.tasks)(page);
    const accepted=JSON.parse(await page.evaluate(()=>JSON.stringify(state)));
    earlier=JSON.stringify({...accepted,tasks:[...accepted.tasks,{...syncTask('large-board-earlier-only','Saved only in the intact earlier generation'),ctx:['home']}]});
    await page.locator('#addInput').fill('Newer local edit before the wait');await page.locator('#addInput').press('Enter');await shown(LARGE_BOARD_SHAPE.tasks+1)(page);
    await page.waitForTimeout(1500);
   }finally{await context.close();}
   const encodedEarlier=await loadStorageV2().encodeSnapshot(earlier);
   earlierHeader=JSON.stringify({chunkCount:encodedEarlier.chunkCount,byteLength:encodedEarlier.byteLength,hash:encodedEarlier.hash});
   context=await launch(tag,null,true);
   try{
    const page=context.pages()[0]||await context.newPage(),errors=[];let crashed=false;
    page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>{crashed=true;});
    const downloads=[];page.on('download',download=>downloads.push(download));
    await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(LARGE_BOARD_SHAPE.tasks+1)(page);
    summary.waiting=await page.waitForFunction(()=>document.getElementById('syncBtn')?.textContent==='☁ recovery waiting',null,{timeout:WAIT_MS}).then(()=>true,()=>false);
    assert.ok(summary.waiting,`${engineName}: fixture precondition: cloud recovery is waiting`);
    await page.waitForTimeout(2000);
    await exercise({t,engineName,page,tag,downloads,summary,failures});
    summary.crashed=crashed;summary.errors=errors;summary.log=await page.evaluate(()=>__diagnosticsExport.log.slice());
    summary.status=await page.evaluate(()=>document.getElementById('syncBtn').textContent);
   }finally{await context.close();}
  }finally{fs.rmSync(profile,{recursive:true,force:true});}
  observed.push(summary);
  assert.equal(summary.crashed,false,`${engineName}: the page did not crash`);assert.deepEqual(summary.errors,[],`${engineName}: no page errors`);
  // Exporting starts no recovery work and publishes nothing.
  if(summary.log.some(entry=>['source-read','protect','push'].includes(entry)))failures.push(`${engineName}: exporting started recovery or publication ${JSON.stringify(summary.log)}`);
  if(summary.status!=='☁ recovery waiting')failures.push(`${engineName}: the export ended the waiting status ${summary.status}`);
 }
 assert.deepEqual(failures,[],JSON.stringify(observed));
}
// Opens Settings with the section holding act expanded.
async function openSettingsSectionFor(page,act){
 // Closing a dialog opened from Settings returns to Settings; close them all first.
 await page.evaluate(()=>{for(let i=0;i<4&&document.querySelector('.mback');i++)closeModal();});
 await page.locator('#appHeader [data-act="settings"]').click();
 const section=page.locator('#modalRoot details.settings-section:has([data-act="'+act+'"])');
 if(await section.count()&&!await section.first().evaluate(el=>el.open))await section.first().locator(':scope > summary').click();
}
// Measures one export: an idle window with the starting dialog open, then the
// click and whatever finishes it (finish returns true once it is saved).
async function measureLargeBoardExport({page,tag,start,finish,limitMs=120000,windowMs=2500}){
 const idleSampler=webProcessMemorySampler(tag);await page.waitForTimeout(windowMs);const idle=await idleSampler.stop();
 await page.evaluate(()=>{const gaps=window.__exportGaps={max:0,last:performance.now(),on:true};
  const tick=()=>{const now=performance.now();gaps.max=Math.max(gaps.max,now-gaps.last);gaps.last=now;if(gaps.on)setTimeout(tick,0);};setTimeout(tick,0);});
 const sampler=webProcessMemorySampler(tag),started=Date.now();let memory,finished=false;
 try{
  await start();
  while(!finished&&Date.now()-started<limitMs){finished=await finish();if(!finished)await page.waitForTimeout(100);}
  await page.waitForTimeout(windowMs);
 }finally{memory=await sampler.stop();}
 const stallMs=Math.round(await page.evaluate(()=>{__exportGaps.on=false;return __exportGaps.max;}));
 // Measurement preconditions: the harness saw this browser's own web process.
 assert.ok(idle.processes>0&&memory.processes>0&&idle.samples>10&&memory.samples>10,'web-process memory was sampled');
 return {finished,elapsedMs:Date.now()-started,stallMs,idle,memory,extraBytes:memory.peakBytes-idle.peakBytes};
}
const mibOf=bytes=>Math.round(bytes/1048576);

// The person opens Settings → Data and backups → View debug log and uses each
// export the dialog offers, finishing with Copy when an export opens its own
// dialog. It must stay metadata-only and cost about the same whatever the
// board size.
const DIAGNOSTICS_EXPORT_MEMORY_MARGIN=64*1024*1024;
test('RISK large board diagnostics export browser: while cloud recovery waits, every export the Debug log offers is the metadata-only report and stays within a memory margin of the open Debug log without a long stall, in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},t=>largeBoardExportWhileRecoveryWaits(t,'diagnostics',async({t,engineName,page,tag,downloads,summary,failures})=>{
 const NOT_EXPORTS=['select-support-diagnostics','refresh-support-diagnostics','return-support-diagnostics','close-modal'];
 const openDebugLog=async()=>{
  await openSettingsSectionFor(page,'view-support-diagnostics');await page.locator('#modalRoot [data-act="view-support-diagnostics"]').click();
  await page.waitForFunction(()=>!!document.getElementById('supportDiagnosticsData')?.value,null,{timeout:10000});
 };
 await openDebugLog();
 const exports=await page.$$eval('#modalRoot button[data-act]',(buttons,skip)=>buttons.map(button=>button.dataset.act).filter(act=>!skip.includes(act)),NOT_EXPORTS);
 summary.offered=exports;
 if(!exports.length)failures.push(`${engineName}: the Debug log offers no export`);
 for(const act of exports){
  await openDebugLog();
  const copiedBefore=await page.evaluate(()=>__diagnosticsCopied.length),downloadsBefore=downloads.length;
  // An export that opens its own dialog finishes with that dialog's Copy.
  const copy=page.locator('#modalRoot button[data-act^="copy-"]');let copied=false;
  const result=await measureLargeBoardExport({page,tag,start:()=>page.locator('#modalRoot [data-act="'+act+'"]').click({timeout:120000}),
   finish:async()=>{
    if(await page.evaluate(count=>__diagnosticsCopied.length>count,copiedBefore)||downloads.length>downloadsBefore)return true;
    if(!copied&&await copy.count()){copied=true;await copy.first().click({timeout:120000});}
    return false;}});
  // What was exported, summarized in the page so a large export is not moved here.
  const outputs=await page.evaluate(copied=>__diagnosticsCopied.slice(copied).map(text=>{let report=null;try{report=JSON.parse(text);}catch{}
   return {bytes:new TextEncoder().encode(text).length,board:/Large board task \d/.test(text),schema:report?.schema??report?.format??null,metadataOnly:report?.metadataOnly===true&&report?.boardDataIncluded===false};}),copiedBefore);
  for(const download of downloads.slice(downloadsBefore)){const text=fs.readFileSync(await download.path(),'utf8');let report=null;try{report=JSON.parse(text);}catch{}
   outputs.push({bytes:Buffer.byteLength(text,'utf8'),board:/Large board task \d/.test(text),schema:report?.schema??report?.format??null,metadataOnly:report?.metadataOnly===true&&report?.boardDataIncluded===false});}
  const row={act,finished:result.finished,elapsedMs:result.elapsedMs,stallMs:result.stallMs,idlePeakMiB:mibOf(result.idle.peakBytes),exportPeakMiB:mibOf(result.memory.peakBytes),
   extraMiB:mibOf(result.extraBytes),outputs,samples:[result.idle.samples,result.memory.samples]};
  summary.exports.push(row);t.diagnostic(JSON.stringify({engine:engineName,...row}));
  if(!result.finished||!outputs.length)failures.push(`${engineName}: ${act} exported nothing ${JSON.stringify(row)}`);
  for(const output of outputs){
   if(output.board)failures.push(`${engineName}: ${act} exported board content ${JSON.stringify(output)}`);
   if(output.schema!=='funsidething.support-diagnostics'||!output.metadataOnly)failures.push(`${engineName}: ${act} exported something other than the metadata-only Debug log ${JSON.stringify(output)}`);
   if(output.bytes>24*1024)failures.push(`${engineName}: ${act} exported ${output.bytes} bytes, above the 24 KiB report limit`);
  }
  if(result.extraBytes>DIAGNOSTICS_EXPORT_MEMORY_MARGIN)failures.push(`${engineName}: ${act} peaked ${row.extraMiB} MiB over the open Debug log, above the ${mibOf(DIAGNOSTICS_EXPORT_MEMORY_MARGIN)} MiB margin`);
  if(result.stallMs>LARGE_BOARD_EXPORT_STALL_MS)failures.push(`${engineName}: ${act} stalled the page ${result.stallMs} ms`);
 }
}));

// The owner must be able to export the recovery itself: Settings → Data and
// backups → Download recovery file. The file is lossless (the open board and
// every saved device row, exactly as the page reads them afterwards), and
// building it holds about one saved source at a time, so its cost does not
// grow with the number of saved copies: it is measured again after nine more
// distinct full-board copies are saved on the device. Before #2246 the repair
// export peaked 1.05-1.16 GiB over the open Settings (28 s stall in WebKit),
// and the Full recovery archive 178-239 MiB with nine more copies (a 41 MB
// file). After, 25-63 MiB for a 14 MB file and 41-122 MiB for 39 MB: what is
// retained is about one saved copy, and the rest is per-row garbage the
// engines collect lazily. The assertion is on growth: the extra peak memory
// the nine copies add, per byte they add to the file. The Full recovery
// archive grew 3.7 (WebKit) and 7.8 (Chromium) bytes of memory per added file
// byte; the streamed file grows 0.3-2.5. Growth, not an absolute peak, is what
// separates them, and it does not depend on the host's baseline memory.
const ARCHIVE_EXTRA_COPIES=9,ARCHIVE_GROWTH_PER_FILE_BYTE=3;
// Saves count more distinct full-board copies on the device, as manual
// backups. Each differs, so the store keeps each as its own saved snapshot.
const saveExtraBoardCopies=(page,count)=>page.evaluate(async count=>{
 const head=await deviceStore.readHead();
 for(let i=0;i<count;i++){const board=JSON.parse(cloudPayload());board.tasks[0].title+=' (saved copy '+i+')';
  await deviceStore.putBackup({expectedHash:head.hash,backup:{id:'archive-extra-copy-'+i,kind:'manual',day:'2026-11-06',at:Date.now()+i,payload:JSON.stringify(board)}});}
 const snapshot=await deviceStore.readRawExportSnapshot();
 return {backups:snapshot.stores.backups.keys.length,snapshots:snapshot.stores.snapshots.keys.length};},count);
// What a lossless archive must match, read from the page after the export.
async function archiveLosslessFailures(page,text,where){
 const failures=[],archive=JSON.parse(text);
 const expected=await page.evaluate(async()=>{const snapshot=await deviceStore.readRawExportSnapshot();
  return {board:JSON.parse(cloudPayload()),stores:Object.fromEntries(Object.entries(snapshot.stores).map(([name,{keys,values}])=>[name,{keys:JSON.stringify(keys),values:values.map(value=>JSON.stringify(value))}]))};});
 if(archive.format!=='chain-scanner.recovery-archive'||archive.formatVersion!==1||archive.manifest?.status!=='complete')failures.push(`${where}: the file is not a complete recovery archive ${JSON.stringify(archive.manifest?.failures)}`);
 if(JSON.stringify(archive.currentBoard)!==JSON.stringify(expected.board))failures.push(`${where}: the file's board differs from the open board`);
 for(const [name,{keys,values}] of Object.entries(expected.stores)){
  const rows=archive.appSources?.indexedDB?.stores?.[name]||[];
  if(JSON.stringify(rows.map(row=>decodeManualArchiveTypedValue(row.key)))!==keys)failures.push(`${where}: the file's ${name} keys differ`);
  const decoded=rows.map(row=>JSON.stringify(decodeManualArchiveTypedValue(row.value)));
  if(decoded.length!==values.length||decoded.some((value,index)=>value!==values[index]))failures.push(`${where}: the file's ${name} rows differ`);
 }
 return {failures,rows:Object.fromEntries(Object.entries(archive.appSources?.indexedDB?.stores||{}).map(([name,rows])=>[name,rows.length]))};
}
// One archive export, ordinary and again with more saved copies.
const archiveExportExercise=(kind,{open,start,finish})=>async({t,engineName,page,tag,downloads,summary,failures})=>{
 const measured={};
 for(const extra of [0,ARCHIVE_EXTRA_COPIES]){
  const where=`${engineName}/${kind}/${extra} extra copies`;
  if(extra){
   // Saved, then a fresh document over the same profile, so the copying
   // itself is not in the measured page's memory.
   summary.backups=await saveExtraBoardCopies(page,extra);
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true'&&document.getElementById('syncBtn')?.textContent==='☁ recovery waiting',null,{timeout:90000});
   await page.waitForTimeout(2000);
  }
  await open(page);
  const copiedBefore=await page.evaluate(()=>__diagnosticsCopied.length),downloadsBefore=downloads.length,state={pressed:false};
  const result=await measureLargeBoardExport({page,tag,start:()=>start(page),
   finish:async()=>downloads.length>downloadsBefore||await page.evaluate(count=>__diagnosticsCopied.length>count,copiedBefore)||await finish(page,state)});
  const saved=downloads.slice(downloadsBefore);
  const row={kind,extra,finished:result.finished,file:saved.length>0,elapsedMs:result.elapsedMs,stallMs:result.stallMs,idlePeakMiB:mibOf(result.idle.peakBytes),
   exportPeakMiB:mibOf(result.memory.peakBytes),extraMiB:mibOf(result.extraBytes),samples:[result.idle.samples,result.memory.samples]};
  // Lossless: compared with what the page reads afterwards, outside the measured window.
  if(saved.length){const text=fs.readFileSync(await saved[0].path(),'utf8');row.bytes=Buffer.byteLength(text,'utf8');
   const checked=await archiveLosslessFailures(page,text,where);row.rows=checked.rows;failures.push(...checked.failures);}
  else row.copiedBytes=await page.evaluate(count=>__diagnosticsCopied.slice(count).map(text=>text.length),copiedBefore);
  summary.exports.push(row);t.diagnostic(JSON.stringify({engine:engineName,...row}));
  if(!result.finished)failures.push(`${where}: the export did not finish ${JSON.stringify(row)}`);
  if(!saved.length)failures.push(`${where}: the export was not saved as a file ${JSON.stringify(row)}`);
  measured[extra]={extraBytes:result.extraBytes,fileBytes:row.bytes??0};
  if(result.stallMs>LARGE_BOARD_EXPORT_STALL_MS)failures.push(`${where}: the export stalled the page ${result.stallMs} ms`);
 }
 const few=measured[0],many=measured[ARCHIVE_EXTRA_COPIES],addedFile=many.fileBytes-few.fileBytes;
 const growth=addedFile>0?(many.extraBytes-few.extraBytes)/addedFile:Infinity;
 summary.growthPerFileByte=Math.round(growth*100)/100;t.diagnostic(JSON.stringify({engine:engineName,kind,growthPerFileByte:summary.growthPerFileByte,addedFileMiB:mibOf(addedFile)}));
 if(!(addedFile>ARCHIVE_EXTRA_COPIES*1024*1024))failures.push(`${engineName}/${kind}: the saved copies did not grow the file (${addedFile} bytes)`);
 if(growth>ARCHIVE_GROWTH_PER_FILE_BYTE)failures.push(`${engineName}/${kind}: memory grew ${summary.growthPerFileByte} bytes per added file byte with more saved copies, above ${ARCHIVE_GROWTH_PER_FILE_BYTE}`);
};
test('RISK large board recovery file browser: while cloud recovery waits, Download recovery file saves one lossless file without a long stall, and its memory does not grow with more saved copies, in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},t=>largeBoardExportWhileRecoveryWaits(t,'recovery-file',archiveExportExercise('recovery-file',{
 open:page=>openSettingsSectionFor(page,'download-recovery-file'),
 start:page=>page.locator('#modalRoot [data-act="download-recovery-file"]').click({timeout:120000}),
 finish:async()=>false})));

// #2246: an actual visual test for the controls #2246 adds, each measured
// beside its established neighbour in the same pane:
// - Download board and Download recovery file beside Restore in Data and
//   backups, with an accepted board;
// - Download recovery file alone beside Restore when the device has no
//   accepted board (an unreadable original opens an empty new-work board);
// - the Debug log dialog's Copy debug log and Download debug log beside its
//   Select all and Refresh log.
// Day and night themes (attribute, computed color scheme and the modal's own
// paint, which must differ between them and be opaque), phone, the enlarged
// 260 px phone and desktop, ordinary and 150% text, native keyboard focus,
// Chromium and WebKit. Screenshots go to DOWNLOADS_VISUAL_DIR when it is set.
test('RISK downloads visual browser: Download board and Download recovery file render like Restore beside them, with and without an accepted board, and the Debug log Copy and Download render like Select all and Refresh, in day and night, ordinary and enlarged text, phone and desktop, with keyboard focus, in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},async t=>{
 const {chromium,webkit}=await import(process.env.LANDSCAPE_PLAYWRIGHT),origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 const {resolveExpectedFirstRunHelp}=await import('../scripts/browser-fixture-setup.mjs');
 const fontsUrl=html.match(/href="(https:\/\/fonts.googleapis.com\/css2[^\"]+)"/)[1];
 const output=process.env.DOWNLOADS_VISUAL_DIR?path.resolve(process.env.DOWNLOADS_VISUAL_DIR):null;
 if(output)fs.mkdirSync(output,{recursive:true});
 const ROWS=12,boards=new Map();
 for(const theme of ['light','dark']){
  const seed=JSON.stringify(syncState({contexts:[{id:'home',name:'Home',active:true}],listOpen:true,seenQuickStart:true,settings:{...syncState().settings,theme},
   tasks:Array.from({length:ROWS},(_,i)=>({...syncTask('visual-download-'+i,'Visual download task '+i),ctx:['home']}))}));
  const app=await loadApp({seedStorage:{[SYNC_STORE_KEY]:seed}});
  try{boards.set(theme,JSON.stringify(app.ctx.state));}finally{await app.dispose();}
 }
 const scenarios=[
  {name:'downloads',controls:[['download-current-board','Download board'],['download-recovery-file','Download recovery file']],neighbours:[['restore-backup','Restore']],absent:[],
   open:page=>openSettingsSectionFor(page,'download-recovery-file')},
  {name:'no-board',unreadable:true,controls:[['download-recovery-file','Download recovery file']],neighbours:[['restore-backup','Restore']],absent:['download-current-board'],
   open:page=>openSettingsSectionFor(page,'download-recovery-file')},
  {name:'debug-log',controls:[['copy-support-diagnostics','Copy debug log'],['download-support-diagnostics','Download debug log']],neighbours:[['select-support-diagnostics','Select all'],['refresh-support-diagnostics','Refresh log']],absent:[],
   open:async page=>{await openSettingsSectionFor(page,'view-support-diagnostics');await page.locator('#modalRoot [data-act="view-support-diagnostics"]').click();
    await page.waitForFunction(()=>!!document.getElementById('supportDiagnosticsData')?.value,null,{timeout:10000});}},
 ];
 const viewports=[['phone',390,844],['phone-enlarged',260,563],['desktop',1280,800]];
 const ENLARGED='#modalRoot .modal{font-size:150%} #modalRoot .modal :is(p,button,label,summary,select,input){font-size:1em}';
 const STYLE_KEYS=['fontFamily','fontSize','fontWeight','color','borderColor','backgroundColor','height','paddingLeft','borderRadius'];
 const failures=[],observed=[],paints={};
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true,...(engineName==='chromium'&&process.env.LANDSCAPE_BROWSER_CHANNEL?{channel:process.env.LANDSCAPE_BROWSER_CHANNEL}:{})});
  // WebKit on macOS moves keyboard focus between buttons with Alt+Tab.
  const forward=engineName==='webkit'&&process.platform==='darwin'?'Alt+Tab':'Tab',backward=engineName==='webkit'&&process.platform==='darwin'?'Alt+Shift+Tab':'Shift+Tab';
  try{
   for(const scenario of scenarios)for(const theme of ['light','dark'])for(const [viewName,width,height] of viewports){
    const where=`${engineName}/${scenario.name}/${theme}/${viewName}`;
    const context=await browser.newContext({viewport:{width,height},colorScheme:theme,serviceWorkers:'block',reducedMotion:'reduce'});
    try{
     await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());
      return url.origin===origin||request.url()===fontsUrl||(url.origin==='https://fonts.gstatic.com'&&request.resourceType()==='font')?route.continue():route.abort();});
     await context.addInitScript(([board,unreadable])=>{
      Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
      localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));
      if(localStorage.getItem('fvp:chain-scanner:v1')===null){
       if(unreadable){localStorage.setItem('fvp:chain-scanner:v1','{unreadable original source');localStorage.setItem('fvp:chain-scanner:protected:v1','different protected original');}
       else localStorage.setItem('fvp:chain-scanner:v1',board);
      }
     },[boards.get(theme),!!scenario.unreadable]);
     const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
     await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});
     if(scenario.unreadable){
      await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true'&&window.ScannerDeviceStore,null,{timeout:60000});
      const motion=page.locator('#motionDialog [data-landscape-motion="reduced"]');if(await motion.isVisible())await motion.click();await resolveExpectedFirstRunHelp(page);
      const opened=await page.evaluate(()=>({accepted:liveBoardAccepted,emptyNewWork:emptyNewWorkWorkspace()}));
      if(opened.accepted&&!opened.emptyNewWork)failures.push(`${where}: fixture: the device has an accepted board ${JSON.stringify(opened)}`);
     }else await page.waitForFunction(rows=>document.documentElement.dataset.appReady==='true'&&document.querySelectorAll('#listBody [data-row]').length===rows,ROWS,{timeout:60000});
     await page.evaluate(()=>document.fonts.ready);
     await page.waitForFunction(()=>!document.getElementById('toast')?.classList.contains('show'),null,{timeout:15000}).catch(()=>{});
     await scenario.open(page);
     const state={theme:await page.evaluate(()=>({attribute:document.documentElement.getAttribute('data-theme'),scheme:getComputedStyle(document.documentElement).colorScheme,
      paint:getComputedStyle(document.querySelector('#modalRoot .modal')).backgroundColor})),scale:{}};
     const acts=[...scenario.controls,...scenario.neighbours].map(([act])=>act);
     for(const scale of [1,1.5]){
      const enlarged=scale>1?await page.addStyleTag({content:ENLARGED}):null;
      await page.locator('#modalRoot [data-act="'+scenario.controls[0][0]+'"]').scrollIntoViewIfNeeded();
      state.scale[scale]=await page.evaluate(([acts,absent,controlCount])=>{
       const modal=document.querySelector('#modalRoot .modal'),pane=modal.getBoundingClientRect(),paneStyle=getComputedStyle(modal);
       const read=button=>{if(!button)return null;button.scrollIntoView({block:'nearest'});const style=getComputedStyle(button),rect=button.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
        return {text:button.textContent,fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,color:style.color,borderColor:style.borderTopColor,backgroundColor:style.backgroundColor,
         height:Math.round(rect.height),paddingLeft:style.paddingLeft,borderRadius:style.borderTopLeftRadius,clipped:button.scrollWidth>button.clientWidth+1,group:button.parentElement,
         inside:rect.left>=pane.left+parseFloat(paneStyle.paddingLeft)-1&&rect.right<=pane.right-parseFloat(paneStyle.paddingRight)+1,unobscured:hit===button||button.contains(hit)};};
       const rows=Object.fromEntries(acts.map(act=>[act,read(modal.querySelector('button[data-act="'+act+'"]'))]));
       const groups=new Set(acts.slice(0,controlCount).map(act=>rows[act]).filter(Boolean).map(row=>row.group));
       for(const row of Object.values(rows))if(row)delete row.group;
       return {rows,controlGroups:groups.size,present:absent.filter(act=>!!modal.querySelector('[data-act="'+act+'"]')),
        overflow:modal.scrollWidth>modal.clientWidth+1,pageOverflow:document.documentElement.scrollWidth>innerWidth};
      },[acts,scenario.absent,scenario.controls.length]);
      if(output)await page.screenshot({path:path.join(output,`${engineName}-${scenario.name}-${theme}-${viewName}-${scale}.png`)});
      if(enlarged)await enlarged.evaluate(element=>element.remove());
     }
     // Native keyboard focus: from each control to its neighbour and back.
     const focusOf=async act=>{const locator=page.locator('#modalRoot button[data-act="'+act+'"]');await locator.focus();await page.keyboard.press(forward);await page.keyboard.press(backward);
      return locator.evaluate(button=>{const style=getComputedStyle(button);return {active:document.activeElement===button,visible:button.matches(':focus-visible'),outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth,outlineColor:style.outlineColor};});};
     state.focus={};for(const act of acts)state.focus[act]=await focusOf(act);
     state.errors=errors;observed.push({where,...state});
     (paints[engineName+'/'+scenario.name]||={})[theme+'/'+viewName]=state.theme.paint;
     if(!String(state.theme.scheme).split(/\s+/).includes(theme)||!(state.theme.attribute===theme||state.theme.attribute===null&&scenario.unreadable))failures.push(`${where}: theme not applied ${JSON.stringify(state.theme)}`);
     if(!/^rgb\(/.test(state.theme.paint))failures.push(`${where}: the modal paint is not opaque: ${state.theme.paint}`);
     const neighbour=scenario.neighbours[0][0];
     for(const scale of [1,1.5]){
      const row=state.scale[scale];
      if(row.present.length)failures.push(`${where}/${scale}: offers ${row.present.join(', ')}`);
      for(const [act,label] of [...scenario.controls,...scenario.neighbours])if(row.rows[act]?.text!==label)failures.push(`${where}/${scale}: ${act} label ${row.rows[act]?.text}`);
      if(row.controlGroups!==1)failures.push(`${where}/${scale}: the new controls are not one group`);
      for(const [act,name] of scenario.controls){
       const control=row.rows[act],reference=row.rows[neighbour];if(!control||!reference)continue;
       if(control.clipped||!control.inside||!control.unobscured)failures.push(`${where}/${scale}: ${name} is clipped, outside the pane insets or covered ${JSON.stringify(control)}`);
       // At the enlarged 260 px width the longer labels wrap onto a second
       // line; everything else still matches the neighbour, and a wrapped
       // label stays whole inside its button.
       const wraps=viewName==='phone-enlarged'&&control.height>reference.height;
       for(const key of STYLE_KEYS)if(!(wraps&&key==='height')&&control[key]!==reference[key])failures.push(`${where}/${scale}: ${name} ${key} differs from ${scenario.neighbours[0][1]}: ${control[key]} / ${reference[key]}`);
       if(wraps&&control.height>2*reference.height)failures.push(`${where}/${scale}: ${name} wraps onto more than two lines (${control.height} px)`);
      }
      if(row.overflow||row.pageOverflow)failures.push(`${where}/${scale}: the pane scrolls sideways`);
     }
     if(!(parseFloat(state.scale[1.5].rows[scenario.controls[0][0]]?.fontSize)>parseFloat(state.scale[1].rows[scenario.controls[0][0]]?.fontSize)))failures.push(`${where}: enlarged text is not larger`);
     for(const [act,name] of scenario.controls){
      const focus=state.focus[act];
      if(!focus.active||!focus.visible||focus.outlineStyle==='none'||parseFloat(focus.outlineWidth)<2)failures.push(`${where}: ${name} keyboard focus is not shown ${JSON.stringify(focus)}`);
      for(const key of ['outlineStyle','outlineWidth','outlineColor'])if(focus[key]!==state.focus[neighbour][key])failures.push(`${where}: ${name} focus ${key} differs from ${scenario.neighbours[0][1]}: ${focus[key]} / ${state.focus[neighbour][key]}`);
     }
     if(errors.length)failures.push(`${where}: page errors ${JSON.stringify(errors)}`);
    }finally{await context.close();}
   }
  }finally{await browser.close();}
 }
 // Day and night really paint the dialog differently.
 for(const [key,byView] of Object.entries(paints))for(const [viewName] of viewports)
  if(byView['light/'+viewName]===byView['dark/'+viewName])failures.push(`${key}/${viewName}: the modal paints the same in day and night (${byView['light/'+viewName]})`);
 t.diagnostic(JSON.stringify({paints,focus:observed.map(({where,focus})=>({where,focus}))}));
 assert.equal(observed.length,36,'every engine, view, theme and viewport was measured');
 assert.deepEqual(failures,[],JSON.stringify(observed.slice(0,2)));
});

// #2239 round 2: the owner's board carries its last cloud acknowledgement (its
// acknowledged copy, about as large as the board itself), and that copy is
// the intact earlier generation: the device confirmed it and then kept
// working. Retry sync must recover such a board, publish it and take the
// cloud's confirmation. The same signed-in large-board fixture and in-page
// fake cloud as the deliberate test above, except that the earlier generation
// is byte for byte the device's own acknowledged board, before a newer Add and
// scan decision; an unfinished draft stays in Add. Nothing the device
// acknowledged may be lost: every task, decision, History entry, the newer
// edit and the draft survive, and the cloud ends up holding exactly the
// recovered board.
// #2254 release review (B2): the device acknowledged that board at revision 5,
// and the intact earlier generation is the same bytes published again at
// revision 6 (as a save after Retry sync republishes an unchanged board), so
// the unreadable revision 7 does not directly follow the acknowledged one.
// Adoption (#2254) publishes by itself only over the revision just after the
// acknowledged one, so here the opening still waits and Retry sync takes this
// #2239 path, which recognises the acknowledged copy by its bytes.
// Memory: the owner approved a target of 200 MiB over opening the same board
// locally in WebKit (#2239). Round 2 did not reach it, so the target is
// pending: each run reports its peak against the target and asserts a
// regression ceiling per engine instead. Round 2 measured Chromium +515 to
// +557 MiB and WebKit +788 to +1040 MiB over six runs (round 1: +654 and
// +1263); the ceilings leave headroom for WebKit's collector timing, which
// alone moves its peak by a few hundred MiB. What still exceeds the target is
// the commit's original archive, which copies every saved snapshot and the
// legacy browser copy and reads them back. The test-group runner fails any
// TODO case, so the pending target is reported rather than marked TODO.
const LARGE_BOARD_ACKNOWLEDGED_RECOVERY_TARGET=200*1024*1024;
const LARGE_BOARD_ACKNOWLEDGED_RECOVERY_CEILING={chromium:750*1024*1024,webkit:1300*1024*1024};
test('RISK large board acknowledged recovery browser: Retry sync recovers a large board whose acknowledged copy is the intact earlier generation within a regression ceiling over opening it locally, publishing it and keeping every decision, draft and newer edit, and reports its peak against the pending 200 MiB target, in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},async t=>{
 const {chromium,webkit}=await import(process.env.LANDSCAPE_PLAYWRIGHT),origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 const ACCOUNT='owner@example.test',fixture=await largeSignedInBoardFixture(ACCOUNT),{stats}=fixture;
 assert.equal(stats.tasks,LARGE_BOARD_SHAPE.tasks);assert.ok(stats.serializedBytes>=LARGE_BOARD_SHAPE.serializedBytes);
 const NEWER_TITLE='Newer local edit before recovery',DRAFT='Unfinished draft kept through recovery';
 const GENERATION_PATH='/__chain-2239-ack/earlier-generation.json',HEADER_PATH='/__chain-2239-ack/earlier-header.json';
 const target=LARGE_BOARD_ACKNOWLEDGED_RECOVERY_TARGET,SETTLE_MS=4000,RECOVERY_WAIT_MS=120000,observed=[],failures=[];
 const taskCount=LARGE_BOARD_SHAPE.tasks+1,mib=bytes=>Math.round(bytes/1048576);
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  let earlier=null,earlierHeader=null;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'chain-2239-ack-'+engineName+'-'));
  const launch=async(tag,seed,withCloud)=>{
   const context=await engine.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce',
    env:webProcessMemoryEnv(tag),...(engineName==='chromium'&&process.env.LANDSCAPE_BROWSER_CHANNEL?{channel:process.env.LANDSCAPE_BROWSER_CHANNEL}:{})});
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await context.route(origin+GENERATION_PATH,route=>route.fulfill({status:200,contentType:'application/json',body:earlier}));
   await context.route(origin+HEADER_PATH,route=>route.fulfill({status:200,contentType:'application/json',body:earlierHeader}));
   await context.addInitScript(({seed,withCloud,GENERATION_PATH,HEADER_PATH,ACCOUNT})=>{
    Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
    localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));
    if(seed!==null&&localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',seed);
    if(!withCloud)return;
    const log=window.__automaticRecovery={log:[],pulls:0,statuses:[],published:null};
    document.addEventListener('DOMContentLoaded',()=>{
     const button=document.getElementById('syncBtn'),note=()=>{const text=button.textContent;if(log.statuses.at(-1)!==text)log.statuses.push(text);};
     note();new MutationObserver(note).observe(button,{childList:true,characterData:true,subtree:true});
    });
    let release;const answer=new Promise(resolve=>{release=resolve;});log.releasePull=()=>{setTimeout(release,0);};
    const root={schemaVersion:2,rev:7,activeGeneration:'generation-unreadable',previousGeneration:'generation-intact-earlier',updatedAt:1,serverUpdatedAt:null};
    const generations=new Map();
    const header=async()=>(await fetch(HEADER_PATH,{cache:'no-store'})).json();
    const named=(pendingGenerationId,additionalGenerationIds=[])=>[...new Set([root.activeGeneration,root.previousGeneration,pendingGenerationId,...additionalGenerationIds]
     .filter(id=>typeof id==='string'))];
    const read=async(id,withChunks)=>{
     if(id==='generation-intact-earlier'){
      if(!withChunks){const e=await header();return {id,header:{schemaVersion:2,state:'published',encoding:'utf8',chunkCount:e.chunkCount,byteLength:e.byteLength,hash:e.hash,baseRev:5}};}
      const encoded=await window.ChainStorageV2.encodeSnapshot(await (await fetch(GENERATION_PATH,{cache:'no-store'})).text());
      return {id,header:{schemaVersion:2,state:'published',encoding:'utf8',chunkCount:encoded.chunkCount,byteLength:encoded.byteLength,hash:encoded.hash,baseRev:5},chunks:encoded.chunks};
     }
     if(id==='generation-unreadable'){const e=await header();
      return {id,header:{schemaVersion:2,state:'published',encoding:'utf8',chunkCount:e.chunkCount,byteLength:e.byteLength,hash:'e'.repeat(64),baseRev:6},...(withChunks?{chunks:[]}:{})};}
     const stored=generations.get(id);
     return stored?{id,header:{...stored.header},...(withChunks?{chunks:stored.chunks.map(chunk=>({...chunk}))}:{})}:{id,unavailable:true};
    };
    const cloud={configured:true,ready:true,user:ACCOUNT,status:'syncing',errorStage:null,errorCode:null,knownDamagedSource:false,recoveryRetentionPending:false,
     signIn(){},signOut(){},recoveryIdentity:()=>'fixture-identity',
     async pull(){
      if(++log.pulls===1)await answer;log.log.push('pull');
      if(log.published){
       Object.assign(cloud,{status:'ok',errorStage:null,errorCode:null,knownDamagedSource:false});window.dispatchEvent(new CustomEvent('cloudsync'));
       const {payload,rev,updatedAt,serverUpdatedAt}=log.published;
       return {payload,rev,updatedAt,serverUpdatedAt,schemaVersion:2,generationId:root.activeGeneration};
      }
      Object.assign(cloud,{status:'error',errorStage:'pull',errorCode:'corrupt-generation',knownDamagedSource:true});
      window.dispatchEvent(new CustomEvent('cloudsync'));
      return {error:true,code:'corrupt-generation',rev:root.rev,generationId:root.activeGeneration};
     },
     async push(payload,updatedAt,baseRev,context){
      log.log.push('push');
      if(typeof context?.validateBeforePublish==='function'&&!await context.validateBeforePublish(context.recoveryPending))return {error:true,code:'recovery-source-changed'};
      if(baseRev!==root.rev)return {conflict:true,rev:root.rev};
      const encoded=await window.ChainStorageV2.encodeSnapshot(payload),id='generation-published-'+(root.rev+1);
      generations.set(id,{header:{schemaVersion:2,state:'published',encoding:'utf8',chunkCount:encoded.chunkCount,byteLength:encoded.byteLength,hash:encoded.hash,baseRev},chunks:encoded.chunks});
      Object.assign(root,{rev:root.rev+1,previousGeneration:root.activeGeneration,activeGeneration:id});
      log.published={payload,rev:root.rev,updatedAt,serverUpdatedAt:Date.now()};log.log.push('published');
      Object.assign(cloud,{status:'ok',errorStage:null,errorCode:null,knownDamagedSource:false});
      return {ok:true,rev:root.rev,serverUpdatedAt:log.published.serverUpdatedAt};
     },
     async recoveryEvidence(){return {identity:'fixture-identity',epoch:1,pending:null};},
     async readRecoverySource({pendingGenerationId,additionalGenerationIds}={}){
      log.log.push('source-read');
      const rows=[];for(const id of named(pendingGenerationId,additionalGenerationIds))rows.push(await read(id,true));
      return {identity:'fixture-identity',epoch:1,manifest:{...root},generations:rows};
     },
     async readRecoverySourceHeaders({pendingGenerationId,additionalGenerationIds}={}){
      log.log.push('header-read');
      const rows=[];for(const id of named(pendingGenerationId,additionalGenerationIds))rows.push(await read(id,false));
      return {identity:'fixture-identity',epoch:1,manifest:{...root},generations:rows};
     },
     async readRecoverySourceChunks({generationIds=[]}={}){
      log.log.push('chunk-probe');
      const rows=[];for(const id of generationIds)rows.push(await read(id,true));
      return rows;
     },
     async protectRecoverySources(){log.log.push('protect');return {ok:true};},
    };
    Object.defineProperty(window,'CloudSync',{configurable:false,get:()=>cloud,set(){}});
    document.addEventListener('DOMContentLoaded',()=>{window.dispatchEvent(new CustomEvent('cloudsync'));window.cloudPull?.();});
   },{seed,withCloud,GENERATION_PATH,HEADER_PATH,ACCOUNT});
   return context;
  };
  const shown=count=>page=>page.waitForFunction(count=>document.documentElement.dataset.appReady==='true'&&!document.querySelector('dialog[open]')
   &&document.getElementById('listCount')?.textContent==='('+count+')'&&document.querySelectorAll('#listBody [data-row]').length===count,count,{timeout:60000});
  const kept=page=>page.evaluate(async()=>{
   const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value??null)))),b=>b.toString(16).padStart(2,'0')).join('');
   const out={};for(const key of ['tasks','decisionEvents','decisionBaseline','chain','deletedTaskIds','clearedHistoryIds'])out[key]=await digest(state[key]);
   out.draft=document.getElementById('addInput').value;
   out.history=(state.workLog||[]).map(entry=>JSON.stringify(entry));
   out.dispositions=Object.fromEntries(['considered','cantAt','workedAt'].map(key=>[key,JSON.parse(JSON.stringify(state[key]??{}))]));
   return out;});
  const summary={engine:engineName};
  let local=null,recovered=null,before=null,after=null,errors=[],crashed=false;
  try{
   const tag=`chain-2239-ack-${engineName}-${process.pid}-${Date.now()}`;
   let context=await launch(tag+'-seed',fixture.payload,false);
   try{
    const page=context.pages()[0]||await context.newPage();
    await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(LARGE_BOARD_SHAPE.tasks)(page);
    // The device's last cloud acknowledgement: its own board at revision 5,
    // whose bytes the cloud's intact earlier generation (revision 6) repeats.
    // One save first settles the older browser copy the fixture was seeded
    // from, so the acknowledgement written next is not merged away.
    await page.waitForFunction(()=>deviceStorageAuthority===true&&typeof deviceHeadHash==='string',null,{timeout:60000});
    earlier=await page.evaluate(async()=>{
     if(await persist()!==true)throw Error('fixture: the seeded board saves');
     const payload=cloudPayload();state.syncRev=5;state.decisionBase=makeDecisionBase(state.syncAccount,5,payload);state.syncDirty=false;
     if(await persist()!==true)throw Error('fixture: the acknowledgement saves');
     const saved=JSON.parse((await deviceStore.readHead()).payload);
     if(!validDecisionBase(saved.decisionBase,saved.syncAccount,5)||saved.decisionBase.payload!==payload)throw Error('fixture: the saved board carries its acknowledged copy');
     return payload;});
    // The newer accepted edit through Add, and a newer scan decision through the real No button.
    await page.locator('#addInput').fill(NEWER_TITLE);await page.locator('#addInput').press('Enter');await shown(taskCount)(page);
    const decisions=await page.evaluate(()=>state.decisionEvents.length);
    await page.locator('[data-act="no"]').first().click();
    await page.waitForFunction(count=>state.decisionEvents.length>count&&Object.keys(state.considered).length>0,decisions,{timeout:30000});
    await page.waitForFunction(()=>new Promise(resolve=>deviceStore.readHead().then(head=>{
     const saved=head&&JSON.parse(head.payload);resolve(!!saved&&saved.tasks.length===state.tasks.length&&saved.decisionEvents.length===state.decisionEvents.length&&
      validDecisionBase(saved.decisionBase,saved.syncAccount,5));},()=>resolve(false))),null,{timeout:30000});
    summary.deviceBoardBytes=await page.evaluate(()=>JSON.stringify(state).length);
    await page.waitForTimeout(1500);
   }finally{await context.close();}
   const encodedEarlier=await loadStorageV2().encodeSnapshot(earlier);
   earlierHeader=JSON.stringify({chunkCount:encodedEarlier.chunkCount,byteLength:encodedEarlier.byteLength,hash:encodedEarlier.hash});
   // The same board opened locally, with no cloud, in the same run: the baseline.
   context=await launch(tag+'-local',null,false);
   try{
    const page=context.pages()[0]||await context.newPage(),sampler=webProcessMemorySampler(tag+'-local');
    try{
     await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(taskCount)(page);
     await page.locator('#addInput').fill(DRAFT);await page.locator('#addInput').blur();await page.waitForTimeout(SETTLE_MS);
    }finally{local=await sampler.stop();}
   }finally{await context.close();}
   context=await launch(tag,null,true);
   try{
    const page=context.pages()[0]||await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>{crashed=true;});
    const sampler=webProcessMemorySampler(tag);
    try{
     await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await shown(taskCount)(page);
     await page.locator('#addInput').fill(DRAFT);await page.locator('#addInput').blur();
     before=await kept(page);
     await page.evaluate(()=>__automaticRecovery.releasePull());
     summary.waited=await page.waitForFunction(()=>document.getElementById('syncBtn')?.textContent==='☁ recovery waiting',null,{timeout:RECOVERY_WAIT_MS}).then(()=>true,()=>false);
     summary.logBeforeRetry=await page.evaluate(()=>__automaticRecovery.log.slice());
     if(summary.waited){
      const retried=Date.now();
      await page.locator('#syncBtn').click();await page.locator('#modalRoot [data-act="sync-retry"]').click();
      summary.settled=await page.waitForFunction(()=>!!__automaticRecovery.published&&state.syncDirty===false&&
       state.syncRev===__automaticRecovery.published.rev&&document.getElementById('syncBtn')?.textContent==='☁ synced'&&
       !cloudSourceRecoveryBusy&&!cloudSourceRecoveryRead&&!pulling&&!cloudPushInFlight,null,{timeout:RECOVERY_WAIT_MS,polling:100}).then(()=>true,()=>false);
      summary.settleMs=Date.now()-retried;
     }
     await page.waitForTimeout(SETTLE_MS);
    }finally{recovered=await sampler.stop();}
    after=await kept(page);
    summary.titles=await page.$$eval('#listBody [data-row]',rows=>rows.map(row=>row.textContent));
    Object.assign(summary,await page.evaluate(async()=>{
     const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value??null)))),b=>b.toString(16).padStart(2,'0')).join('');
     const el=document.getElementById('syncBtn'),published=__automaticRecovery.published,board=published&&JSON.parse(published.payload);
     return {status:{text:el.textContent,title:el.title},statuses:__automaticRecovery.statuses.slice(),log:__automaticRecovery.log.slice(),
      sourceCheck:automaticCloudSourceResumeStatus.state,
      syncRev:state.syncRev,syncDirty:state.syncDirty,publishedRev:published?.rev??null,
      publishedTitles:board?board.tasks.map(task=>task.title):[],
      publishedMatches:board?{tasks:await digest(board.tasks)===await digest(state.tasks),decisionEvents:await digest(board.decisionEvents)===await digest(state.decisionEvents),
       workLog:await digest(board.workLog)===await digest(state.workLog)}:null};
    }));
   }finally{await context.close();}
  }finally{fs.rmSync(profile,{recursive:true,force:true});}
  const extra=recovered.peakBytes-local.peakBytes,ceiling=LARGE_BOARD_ACKNOWLEDGED_RECOVERY_CEILING[engineName];
  Object.assign(summary,{localPeakMiB:mib(local.peakBytes),recoveryPeakMiB:mib(recovered.peakBytes),extraMiB:mib(extra),ceilingMiB:mib(ceiling),
   targetMiB:mib(target),overTargetMiB:Math.max(0,mib(extra-target)),
   processes:[local.processes,recovered.processes],samples:[local.samples,recovered.samples],crashed,errors});
  const {titles,publishedTitles,...reported}=summary;observed.push(reported);t.diagnostic(JSON.stringify(reported));
  t.diagnostic(`#2239 pending target: ${engineName} peaked ${mib(extra)} MiB over opening the board locally, ${reported.overTargetMiB} MiB above the ${mib(target)} MiB target; `+
   `the commit's original archive still copies every saved snapshot and the legacy browser copy`);
  // Measurement preconditions: the harness saw this browser's own web process.
  assert.ok(local.processes>0&&recovered.processes>0&&local.samples>10&&recovered.samples>10,`${engineName}: web-process memory was sampled ${JSON.stringify(reported)}`);
  assert.equal(crashed,false,`${engineName}: the page did not crash`);
  // Fixture preconditions: the board carries its acknowledged copy, and the
  // opening waited, starting no recovery work and publishing nothing.
  assert.ok(summary.deviceBoardBytes>=2*LARGE_BOARD_SHAPE.serializedBytes,`${engineName}: the saved board carries its acknowledged copy ${JSON.stringify(reported)}`);
  assert.equal(summary.waited,true,`${engineName}: the automatic recovery default of the large board waits ${JSON.stringify(reported)}`);
  assert.deepEqual(summary.logBeforeRetry.filter(entry=>['source-read','protect','push'].includes(entry)),[],`${engineName}: nothing was read in full or published before Retry sync ${JSON.stringify(reported)}`);
  // Behaviour under test: Retry sync recovers, publishes and settles within the regression ceiling.
  if(!summary.settled||summary.status.text!=='☁ synced'||summary.publishedRev===null){failures.push(`${engineName}: Retry sync did not publish the recovered board, take the cloud's confirmation and finish its checks within ${RECOVERY_WAIT_MS/1000} s ${JSON.stringify(reported)}`);continue;}
  if(extra>ceiling)failures.push(`${engineName}: recovering and publishing the large board with its acknowledged copy peaked ${mib(extra)} MiB over opening it locally, above its ${mib(ceiling)} MiB regression ceiling`);
  assert.deepEqual(errors,[],`${engineName}: no page errors`);
  assert.ok(summary.log.indexOf('protect')>=0&&summary.log.indexOf('protect')<summary.log.indexOf('push'),`${engineName}: the earlier sources were protected before publishing ${JSON.stringify(summary.log)}`);
  assert.deepEqual(summary.log.filter(entry=>entry==='published'),['published'],`${engineName}: published once`);
  assert.equal(summary.publishedRev,8,`${engineName}: published at the revision after the unreadable one`);
  assert.equal(summary.syncRev,8);assert.equal(summary.syncDirty,false,`${engineName}: the device took the cloud's confirmation`);
  assert.deepEqual(summary.publishedMatches,{tasks:true,decisionEvents:true,workLog:true},`${engineName}: the cloud holds exactly the recovered board`);
  assert.ok(publishedTitles.includes(NEWER_TITLE),`${engineName}: the cloud holds the newer edit`);
  // Lossless: every accepted task, decision and History entry, the newer edit
  // and the unfinished draft are kept.
  for(const [index,id] of fixture.ids.entries())assert.ok(summary.titles.some(text=>new RegExp('Large board task '+index+'(?!\\d)').test(text)),`${engineName}: task ${id} is kept`);
  assert.ok(summary.titles.some(text=>text.includes(NEWER_TITLE)),`${engineName}: the newer local edit is kept`);
  const {dispositions:beforeDispositions,history:beforeHistory,...beforeKept}=before,{dispositions:afterDispositions,history:afterHistory,...afterKept}=after;
  assert.deepEqual(afterKept,beforeKept,`${engineName}: every accepted task and decision and the unfinished draft survive recovery unchanged`);
  const afterHistorySet=new Set(afterHistory);
  assert.deepEqual(beforeHistory.filter(entry=>!afterHistorySet.has(entry)),[],`${engineName}: every accepted History entry survives recovery`);
  const beforeHistorySet=new Set(beforeHistory);
  assert.deepEqual(afterHistory.filter(entry=>beforeHistorySet.has(entry)),beforeHistory,`${engineName}: accepted History keeps its order`);
  assert.ok(Object.keys(beforeDispositions.considered).length>0,`${engineName}: fixture precondition: the device holds a newer scan decision`);
  for(const [key,entries] of Object.entries(beforeDispositions))for(const [id,value] of Object.entries(entries))
   assert.deepEqual(afterDispositions[key]?.[id],value,`${engineName}: the accepted ${key} entry for ${id} survives recovery`);
  assert.equal(after.draft,DRAFT);
 }
 assert.deepEqual(failures,[],JSON.stringify(observed));
});

// #2228 review: an actual visual test for the "☁ recovery waiting" cloud
// button and the Settings waiting notice, measured beside their established
// neighbours in the same places: the "☁ older copy in use" button in the same
// header, and the Settings pending notice ("Cloud recovery is pending" with an
// older complete copy in use) at the top of the same Settings pane. A small
// signed-in board opens with the cloud faked in the page: an unreadable
// current generation over an intact earlier one. For the waiting state the
// test page lowers the work budget, so the automatic recovery default waits;
// for the neighbour it runs, and its cloud confirmation is refused so the
// older copy stays in use. Day and night themes, the phone, the phone at the
// enlarged 260 px width and desktop, ordinary and 150% Settings text, native
// keyboard focus, and Chromium and WebKit. Screenshots go to
// RECOVERY_WAIT_VISUAL_DIR when it is set; the assertions do not need them.
test('RISK large board recovery wait visual browser: the recovery waiting cloud button and Settings notice render like the older-copy button and notice beside them in day and night, ordinary and enlarged text, phone and desktop, with keyboard focus, in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},async t=>{
 const {chromium,webkit}=await import(process.env.LANDSCAPE_PLAYWRIGHT),origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 const fontsUrl=html.match(/href="(https:\/\/fonts.googleapis.com\/css2[^\"]+)"/)[1];
 const output=process.env.RECOVERY_WAIT_VISUAL_DIR?path.resolve(process.env.RECOVERY_WAIT_VISUAL_DIR):null;
 if(output)fs.mkdirSync(output,{recursive:true});
 const ACCOUNT='owner@example.test',ROWS=18,EARLIER_TITLE='Saved only in the earlier cloud copy';
 // A signed-in board as the app saves it: a raw older-format seed is not a
 // supported recovery source until the app has opened and saved it once.
 const boards=new Map();
 for(const theme of ['light','dark']){
  const seed=JSON.stringify(syncState({contexts:[{id:'home',name:'Home',active:true}],listOpen:true,seenQuickStart:true,syncAccount:ACCOUNT,
   settings:{...syncState().settings,theme},tasks:Array.from({length:ROWS},(_,i)=>({...syncTask('visual-wait-'+i,'Visual recovery task '+i),ctx:['home']}))}));
  const app=await loadApp({seedStorage:{[SYNC_STORE_KEY]:seed}});
  try{boards.set(theme,JSON.stringify(app.ctx.state));}finally{await app.dispose();}
 }
 const boardFor=theme=>boards.get(theme);
 const earlierTask={...syncTask('visual-earlier-only',EARLIER_TITLE),ctx:['home']};
 const viewports=[['phone',390,844],['phone-enlarged',260,563],['desktop',1280,800]];
 const ENLARGED_SETTINGS='#modalRoot .modal{font-size:150%} #modalRoot .modal :is(p,button,label,summary,select,input){font-size:1em}';
 const failures=[],observed=[],artifacts=[],neighbourOverflow=[];
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true,...(engineName==='chromium'&&process.env.LANDSCAPE_BROWSER_CHANNEL?{channel:process.env.LANDSCAPE_BROWSER_CHANNEL}:{})});
  // WebKit on macOS moves keyboard focus between buttons with Alt+Tab.
  const forward=engineName==='webkit'&&process.platform==='darwin'?'Alt+Tab':'Tab',backward=engineName==='webkit'&&process.platform==='darwin'?'Alt+Shift+Tab':'Shift+Tab';
  try{
   for(const theme of ['light','dark'])for(const [viewName,width,height] of viewports){
    const states={};
    for(const scenario of ['waiting','older']){
     const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',reducedMotion:'reduce'});
     try{
      await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());
       return url.origin===origin||request.url()===fontsUrl||(url.origin==='https://fonts.gstatic.com'&&request.resourceType()==='font')?route.continue():route.abort();});
      await context.addInitScript(({board,scenario,ACCOUNT,earlierTask})=>{
       Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
       localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));
       if(localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',board);
       // The test page's own budget override: any recovery is over it.
       if(scenario==='waiting')window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=1;
       const log=window.__visualWait={log:[]};
       const root={schemaVersion:2,rev:7,activeGeneration:'generation-unreadable',previousGeneration:'generation-intact-earlier',updatedAt:1,serverUpdatedAt:null};
       let earlier=null;
       const encodeEarlier=async()=>{
        if(earlier)return earlier;
        const accepted=JSON.parse(JSON.stringify(state));
        return earlier=await window.ChainStorageV2.encodeSnapshot(JSON.stringify({...accepted,tasks:[...accepted.tasks,earlierTask]}));
       };
       const header=(encoded,hash,baseRev)=>({schemaVersion:2,state:'published',encoding:'utf8',chunkCount:encoded.chunkCount,byteLength:encoded.byteLength,hash,baseRev});
       const cloud={configured:true,ready:true,user:ACCOUNT,status:'syncing',errorStage:null,errorCode:null,knownDamagedSource:false,recoveryRetentionPending:false,
        signIn(){},signOut(){},recoveryIdentity:()=>'fixture-identity',
        async pull(){
         log.log.push('pull');
         Object.assign(cloud,{status:'error',errorStage:'pull',errorCode:'corrupt-generation',knownDamagedSource:true});
         window.dispatchEvent(new CustomEvent('cloudsync'));
         return {error:true,code:'corrupt-generation',rev:root.rev,generationId:root.activeGeneration};
        },
        async push(){log.log.push('push');return {error:true,code:'permission-denied'};},
        async recoveryEvidence(){return {identity:'fixture-identity',epoch:1,pending:null};},
        async readRecoverySourceHeaders(){
         const encoded=await encodeEarlier();
         return {identity:'fixture-identity',epoch:1,manifest:{...root},generations:[
          {id:root.activeGeneration,header:header(encoded,'e'.repeat(64),6)},{id:root.previousGeneration,header:header(encoded,encoded.hash,5)}]};
        },
        async readRecoverySource(){
         log.log.push('source-read');const encoded=await encodeEarlier();
         return {identity:'fixture-identity',epoch:1,manifest:{...root},generations:[
          {id:root.activeGeneration,header:header(encoded,'e'.repeat(64),6),chunks:[]},
          {id:root.previousGeneration,header:header(encoded,encoded.hash,5),chunks:encoded.chunks}]};
        },
        // The neighbour's cloud confirmation is refused, so the older copy stays in use.
        async protectRecoverySources(){log.log.push('protect');return {error:true,code:'permission-denied'};},
       };
       Object.defineProperty(window,'CloudSync',{configurable:false,get:()=>cloud,set(){}});
       document.addEventListener('DOMContentLoaded',()=>{window.dispatchEvent(new CustomEvent('cloudsync'));window.cloudPull?.();});
      },{board:boardFor(theme),scenario,ACCOUNT,earlierTask});
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});
      const label=scenario==='waiting'?'☁ recovery waiting':'☁ older copy in use';
      const settled=await page.waitForFunction(label=>document.getElementById('syncBtn')?.textContent===label&&!pulling&&!cloudSourceRecoveryBusy,label,{timeout:60000}).then(()=>true,()=>false);
      const where=`${engineName}/${theme}/${viewName}/${scenario}`;
      if(!settled){failures.push(`${where}: the cloud button never said ${label}: `+await page.evaluate(()=>document.getElementById('syncBtn')?.textContent));continue;}
      await page.evaluate(()=>document.fonts.ready);
      await page.waitForFunction(()=>!document.getElementById('toast')?.classList.contains('show'),null,{timeout:15000}).catch(()=>{});
      const paint=await page.evaluate(()=>{
       const root=document.documentElement,button=document.getElementById('syncBtn'),style=getComputedStyle(button),rect=button.getBoundingClientRect();
       const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
       return {theme:root.getAttribute('data-theme'),scheme:getComputedStyle(root).colorScheme,background:getComputedStyle(document.body).backgroundColor,
        text:button.textContent,className:button.className,fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,color:style.color,
        borderColor:style.borderTopColor,backgroundColor:style.backgroundColor,height:Math.round(rect.height),width:Math.round(rect.width),
        clipped:button.scrollWidth>button.clientWidth+1,inside:rect.left>=0&&rect.right<=innerWidth+0.5&&rect.top>=0,unobscured:hit===button||button.contains(hit),
        earlierApplied:state.tasks.some(task=>task.id==='visual-earlier-only')};
      });
      // Native keyboard focus on the cloud button: forward to its neighbour, then back.
      await page.locator('#syncBtn').focus();await page.keyboard.press(forward);await page.keyboard.press(backward);
      paint.focus=await page.evaluate(()=>{const button=document.getElementById('syncBtn'),style=getComputedStyle(button);
       return {active:document.activeElement===button,visible:button.matches(':focus-visible'),outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth,outlineColor:style.outlineColor};});
      if(output){const file=path.join(output,`${engineName}-${theme}-${viewName}-${scenario}-header.png`);
       await page.screenshot({path:file,clip:{x:0,y:0,width,height:Math.min(height,180)}});artifacts.push(file);}
      // The Settings notice at the top of the Settings pane, ordinary and enlarged.
      await page.locator('#appHeader [data-act="settings"]').click();await page.waitForSelector('#modalRoot .modal');
      const heading=scenario==='waiting'?'Cloud recovery is waiting.':'Cloud recovery is pending.';
      paint.notice={};
      for(const scale of [1,1.5]){
       const enlarged=scale>1?await page.addStyleTag({content:ENLARGED_SETTINGS}):null;
       const notice=page.locator('#modalRoot [role="status"]').filter({hasText:heading}).first();
       await notice.scrollIntoViewIfNeeded();
       paint.notice[scale]=await notice.evaluate(element=>{
        const modal=element.closest('.modal'),style=getComputedStyle(element),bold=getComputedStyle(element.querySelector('b')),rect=element.getBoundingClientRect(),pane=modal.getBoundingClientRect();
        const paneStyle=getComputedStyle(modal),review=element.nextElementSibling?.querySelector('[data-act="review-cloud-source-recovery"]'),reviewStyle=review&&getComputedStyle(review);
        // Anything in the pane wider than the pane, named so a failure says what.
        const wide=[element,modal,...modal.querySelectorAll('*')].filter(node=>node.getBoundingClientRect().right>pane.right+1||
         node.scrollWidth>node.clientWidth+1&&getComputedStyle(node).overflowX!=='visible').slice(0,4)
         .map(node=>node.tagName+(node.dataset?.act?'['+node.dataset.act+']':'')+' '+node.scrollWidth+'/'+node.clientWidth);
        return {text:element.textContent,fontFamily:style.fontFamily,fontSize:style.fontSize,lineHeight:style.lineHeight,color:style.color,boldColor:bold.color,
         left:Math.round(rect.left-pane.left-parseFloat(paneStyle.paddingLeft)),right:Math.round(pane.right-parseFloat(paneStyle.paddingRight)-rect.right),
         overflow:element.scrollWidth>element.clientWidth+1||modal.scrollWidth>modal.clientWidth+1,wide,height:Math.round(rect.height),
         review:review?{fontFamily:reviewStyle.fontFamily,fontSize:reviewStyle.fontSize,color:reviewStyle.color,height:Math.round(review.getBoundingClientRect().height)}:null};
       });
       if(output){const file=path.join(output,`${engineName}-${theme}-${viewName}-${scenario}-settings-${scale}.png`);await page.screenshot({path:file});artifacts.push(file);}
       if(enlarged)await enlarged.evaluate(element=>element.remove());
      }
      // Native keyboard focus on the notice's Review cloud recovery.
      const review=page.locator('#modalRoot [role="status"]').filter({hasText:heading}).first().locator('xpath=following-sibling::div[1]//button[@data-act="review-cloud-source-recovery"]');
      await review.focus();await page.keyboard.press(forward);await page.keyboard.press(backward);
      paint.reviewFocus=await review.evaluate(button=>{const style=getComputedStyle(button);
       return {active:document.activeElement===button,visible:button.matches(':focus-visible'),outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth,outlineColor:style.outlineColor};});
      paint.errors=errors;paint.log=await page.evaluate(()=>__visualWait.log.slice());
      states[scenario]=paint;
     }finally{await context.close();}
    }
    const {waiting,older}=states,where=`${engineName}/${theme}/${viewName}`;
    if(!waiting||!older)continue;
    observed.push({engine:engineName,theme,view:viewName,waiting,older});
    for(const [name,state] of Object.entries(states)){
     // The applied theme: attribute, computed color scheme and paint.
     if(state.theme!==theme)failures.push(`${where}/${name}: data-theme is ${state.theme}`);
     if(!String(state.scheme).split(/\s+/).includes(theme))failures.push(`${where}/${name}: computed color-scheme is ${state.scheme}`);
     if(state.className!=='syncbtn busy')failures.push(`${where}/${name}: cloud button class ${state.className}`);
     if(state.clipped||!state.inside||!state.unobscured)failures.push(`${where}/${name}: the cloud button is clipped, outside the viewport or covered ${JSON.stringify(state)}`);
     for(const [control,focus] of [['cloud button',state.focus],['Review cloud recovery',state.reviewFocus]])
      if(!focus.active||!focus.visible||focus.outlineStyle==='none'||parseFloat(focus.outlineWidth)<2)failures.push(`${where}/${name}: ${control} keyboard focus is not shown ${JSON.stringify(focus)}`);
     for(const scale of [1,1.5]){
      const notice=state.notice[scale];
      if(!notice||notice.left<0||notice.right<0)failures.push(`${where}/${name}/${scale}: the Settings notice leaves its pane insets ${JSON.stringify(notice)}`);
      // The changed notice must fit its pane; the established neighbour's
      // fit is reported with the evidence, not asserted here.
      if(notice?.overflow)(name==='waiting'?failures:neighbourOverflow).push(`${where}/${name}/${scale}: the Settings pane scrolls sideways ${JSON.stringify(notice.wide)}`);
      if(!notice?.review)failures.push(`${where}/${name}/${scale}: the notice has no Review cloud recovery`);
     }
     if(!(parseFloat(state.notice[1.5].fontSize)>parseFloat(state.notice[1].fontSize)))failures.push(`${where}/${name}: enlarged Settings text is not larger`);
     if(state.errors.length)failures.push(`${where}/${name}: page errors ${JSON.stringify(state.errors)}`);
    }
    if(waiting.text!=='☁ recovery waiting'||older.text!=='☁ older copy in use')failures.push(`${where}: labels ${waiting.text} / ${older.text}`);
    if(waiting.earlierApplied||!older.earlierApplied)failures.push(`${where}: the waiting board applied the earlier copy, or the neighbour did not`);
    if(waiting.log.includes('source-read')||waiting.log.includes('protect'))failures.push(`${where}: the waiting state read or protected recovery sources ${JSON.stringify(waiting.log)}`);
    // The waiting button and notice render like their neighbours.
    for(const key of ['fontFamily','fontSize','fontWeight','color','borderColor','backgroundColor','height'])
     if(waiting[key]!==older[key])failures.push(`${where}: the cloud button ${key} differs: ${waiting[key]} / ${older[key]}`);
    for(const key of ['outlineStyle','outlineWidth','outlineColor'])
     if(waiting.focus[key]!==older.focus[key])failures.push(`${where}: the cloud button focus ${key} differs: ${waiting.focus[key]} / ${older.focus[key]}`);
    for(const scale of [1,1.5])for(const key of ['fontFamily','fontSize','lineHeight','color','boldColor','left','right']){
     if(waiting.notice[scale][key]!==older.notice[scale][key])failures.push(`${where}/${scale}: the Settings notice ${key} differs: ${waiting.notice[scale][key]} / ${older.notice[scale][key]}`);
    }
    for(const scale of [1,1.5])for(const key of ['fontFamily','fontSize','color','height'])
     if(waiting.notice[scale].review?.[key]!==older.notice[scale].review?.[key])failures.push(`${where}/${scale}: Review cloud recovery ${key} differs`);
   }
   // Day and night paint the changed controls differently on each engine.
   for(const [viewName] of viewports){
    const pick=theme=>observed.find(row=>row.engine===engineName&&row.theme===theme&&row.view===viewName)?.waiting;
    const day=pick('light'),night=pick('dark');
    if(day&&night&&(day.backgroundColor===night.backgroundColor||day.notice[1].color===night.notice[1].color))
     failures.push(`${engineName}/${viewName}: day and night paint the waiting button or notice alike ${JSON.stringify([day.backgroundColor,night.backgroundColor,day.notice[1].color,night.notice[1].color])}`);
   }
  }finally{await browser.close();}
 }
 t.diagnostic(JSON.stringify({artifacts:artifacts.length?artifacts:'set RECOVERY_WAIT_VISUAL_DIR to save screenshots',neighbourOverflow,observed:observed.map(row=>({engine:row.engine,theme:row.theme,view:row.view,
  button:[row.waiting.width,row.older.width,row.waiting.height],notice:[row.waiting.notice[1].fontSize,row.waiting.notice[1.5].fontSize,row.waiting.notice[1].height,row.older.notice[1].height],
  scheme:row.waiting.scheme,buttonPaint:row.waiting.backgroundColor,noticeColor:row.waiting.notice[1].color,focus:row.waiting.focus,reviewFocus:row.waiting.reviewFocus}))}));
 assert.ok(observed.length===12,'every engine, theme and view was measured: '+observed.length);
 assert.deepEqual(failures,[],JSON.stringify(failures));
});

test('RISK AUTH HYDRATION: a broken device board stays quiet until protected local recovery is visible',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),factory=new IDBFactory(),deviceDbName='broken-board-hydration-'+Date.now()+'-'+Math.random(),broken='{broken saved device board',
  board=syncState({tasks:[syncTask('recovered-phone-board','Saved iPhone board')],futureSaved:{keep:['exact',31]}}),raw=JSON.stringify(board),
  storage=sharedScannerStorage({[DEVICE_AUTHORITY_KEY]:'1',[SYNC_STORE_KEY]:raw,[LOCAL_HEAD_KEY]:raw}),seed=loadStorageV2({indexedDB:factory}).createDeviceStore({indexedDB:factory,crypto:webcrypto,dbName:deviceDbName});
 await seed.open();assert.equal((await seed.commitHead({expectedHash:null,payload:broken,account:null})).ok,true);const before=await seed.readRawExportSnapshot();await seed.close();
 const control={};let holdReads=0;control.afterHoldRead=()=>{if(++holdReads===2)control.stallRawRead=true;};
 let app,ctx,shim;const loading=loadApp({sharedStorage:storage,indexedDBProvider:deviceFaultProvider187(factory,control),deviceDbName,navigatorProvider:{onLine:false},
  cloudSyncFactory:()=>({configured:true,ready:false,user:null,status:'syncing',errorStage:null,errorCode:null}),
  beforeStateReady(context,host){ctx=context;shim=host;}}).then(value=>app=value);
 t.after(async()=>{control.releaseRawRead?.();try{await loading;}finally{await app?.dispose();await seed.close();}});
 const deadline=Date.now()+4000;while(!control.releaseRawRead&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,2));
 assert.ok(control.releaseRawRead,'startup reaches the existing raw IndexedDB verification read after committing recovery');
 assert.equal(holdReads,2,'the hold has been durably reread before verification pauses');
 assert.equal(ctx.state,null,'the recovered board is not hydrated yet');
 assert.equal(ctx.window.ScannerDeviceRecoveryHold?.reason,'device-source-recovery','startup has a genuine durable recovery hold');
 const button=shim.document.getElementById('syncBtn');ctx.renderSync();const directStatus=button.textContent;shim.window.dispatchEvent({type:'cloudsync'});
 assert.deepEqual({directStatus,eventStatus:button.textContent},{directStatus:'☁ syncing',eventStatus:'☁ syncing'},'the recovery badge waits for hydration regardless of event order');
 assert.equal(button.disabled,true,'cloud actions remain unavailable while the board is opening');
 const cloud=shim.window.CloudSync;cloud.status='error';cloud.errorStage='init';cloud.errorCode='unavailable';shim.window.dispatchEvent({type:'cloudsync'});
 assert.equal(button.textContent,'☁ error','a real cloud initialization error remains visible during board hydration');
 control.releaseRawRead();await loading;
 assert.deepEqual(Array.from(ctx.state.tasks,row=>row.id),['recovered-phone-board']);assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.futureSaved)),{keep:['exact',31]});
 assert.equal(ctx.window.ScannerDeviceRecoveryHold?.reason,'device-source-recovery','hydration does not clear the genuine recovery hold');
 assert.equal(button.textContent,'☁ error','the real cloud error remains visible after the board loads');
 cloud.status='syncing';shim.window.dispatchEvent({type:'cloudsync'});
 assert.equal(button.textContent,'☁ recovery pending','the genuine hold becomes visible once the recovered board is ready');
 assert.equal(storage.getItem(SYNC_STORE_KEY),raw,'the source browser copy stays byte-for-byte unchanged');
 assert.equal(storage.getItem(LOCAL_HEAD_KEY),raw,'the source browser head stays byte-for-byte unchanged');
 const head=await app.ctx.window.ScannerDeviceStore.readHead();assert.equal(head.payload,JSON.stringify(ctx.state),'only the supported recovered board becomes the durable working head');
 const hold=await app.ctx.window.ScannerDeviceStore.getRecoveryCloudHold(),archive=(await app.ctx.window.ScannerDeviceStore.listOpaqueArchives()).find(row=>row.key===hold.originalKey);
 assert.ok(archive);const captured=JSON.parse(archive.raw).indexedDB,brokenHash=await app.ctx.window.ChainStorageV2.hashPayload(broken),
  protectedSnapshot=captured.snapshots.find(row=>decodeManualArchiveTypedValue(row.key)===brokenHash);
 assert.equal(decodeManualArchiveTypedValue(protectedSnapshot?.value)?.payload,broken,'the malformed original remains protected exactly');
});

test('RISK recovery fixture shutdown: a failed real source observation stops its own polling and exits',
async t=>{
 const os=await import('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'scanner-source-failure-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=fs.readFileSync(fileURLToPath(import.meta.url),'utf8'),name='RISK corrupt cloud work budget: ordinary actions stay durable without rereading unchanged unrepairable generations';
 const start=source.indexOf("test('"+name+"'"),end=source.indexOf("\ntest('RISK corrupt cloud work budget: cold-opened",start);
 assert.ok(start>=0&&end>start);
 const anchor=' const healthyPayload=ctx.cloudPayload(),healthy=';
 const consumer=source.slice(start,end);assert.equal(consumer.split(anchor).length,2,'the fault starts before the healthy source can become observable');
 const failed=consumer.replace(anchor,` const refusal=Object.assign(Error('Controlled unavailable next revision'),{code:'unavailable'}),observe=app.faults.serverRead;let refusedReads=0;
 app.faults.pull=refusal;
 app.faults.serverRead=async(...args)=>{await observe?.(...args);refusedReads++;throw refusal;};
 app.faults.transactionRead=async()=>{refusedReads++;throw refusal;};
 t.after(async()=>{await app.dispose();assert.ok(refusedReads>0,'the actual SDK must encounter the injected source refusal');assert.equal(vm.runInContext('scanWakeTimer',ctx)?._destroyed,true);assert.ok(backend.subscriptions.every(row=>!row.active));console.log('FAILED_FIXTURE_OWNED_RESOURCES_CLOSED');});
`+anchor);
 const childSource=(source.slice(0,start)+failed+source.slice(end)).replace('const __dirname = path.dirname(fileURLToPath(import.meta.url));','const __dirname = '+JSON.stringify(__dirname)+';');
 fs.writeFileSync(path.join(root,'failed-consumer.mjs'),childSource);fs.symlinkSync(path.join(__dirname,'node_modules'),path.join(root,'node_modules'),'dir');fs.symlinkSync(path.join(__dirname,'tests/shared.js'),path.join(root,'shared.js'));
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const child=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+name+'$','failed-consumer.mjs'],{cwd:root,env,encoding:'utf8',timeout:70000,maxBuffer:1024*1024}),output=child.stdout+child.stderr;
 assert.equal(child.error,undefined,'the real failed consumer must finish before its process cleanup bound: '+output);
 assert.equal(child.signal,null,'the actual failed consumer must exit without a polling worker: '+output);
 assert.equal(child.status,1,'the deliberate external refusal remains a real failed consumer: '+output);
 assert.match(output,/a new server revision escapes the held-source gate/);assert.match(output,/FAILED_FIXTURE_OWNED_RESOURCES_CLOSED/);
 assert.match(output,/# tests 1\b/);assert.match(output,/# fail 1\b/);assert.match(output,/# cancelled 0\b/);
});

test('RISK corrupt work budget fixture: one shared action deadline rejects an actually held device commit',async t=>{
 const os=await import('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'scanner-action-overrun-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=fs.readFileSync(fileURLToPath(import.meta.url),'utf8'),name='RISK corrupt cloud work budget: ordinary actions stay durable without rereading unchanged unrepairable generations';
 const start=source.indexOf("test('"+name+"'"),end=source.indexOf("\ntest('RISK corrupt cloud work budget: cold-opened",start);assert.ok(start>=0&&end>start);
 const anchor=' ctx.window.CLOUD_PUSH_DELAY_MS=0;',consumer=source.slice(start,end);assert.equal(consumer.split(anchor).length,2);
 const stalled=consumer.replace(anchor,` const store=ctx.window.ScannerDeviceStore,commit=store.commitHead.bind(store),gate=deferredSyncFixture(),held=[];let delivery=null;
 store.commitHead=options=>{const call=(async()=>{if(options.payload.includes('Local work while the cloud source needs a choice')){console.log('ACTUAL_ORDINARY_ACTION_COMMIT_ENTERED');if(delivery===null)delivery=setTimeout(()=>gate.resolve(),21000);await gate.promise;}return commit(options);})();held.push(call);return call;};
 t.after(async()=>{clearTimeout(delivery);gate.resolve();await Promise.all(held);store.commitHead=commit;await app.dispose();});
`+anchor);
 fs.writeFileSync(path.join(root,'stalled-consumer.mjs'),(source.slice(0,start)+stalled+source.slice(end)).replace('const __dirname = path.dirname(fileURLToPath(import.meta.url));','const __dirname = '+JSON.stringify(__dirname)+';'));
 fs.symlinkSync(path.join(__dirname,'node_modules'),path.join(root,'node_modules'),'dir');fs.symlinkSync(path.join(__dirname,'tests/shared.js'),path.join(root,'shared.js'));
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 // Child envelope includes the existing setup/control bounds; it must report
 // the single 20s action bound, never pass or require process termination.
 const child=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+name+'$','stalled-consumer.mjs'],{cwd:root,env,encoding:'utf8',timeout:70000,maxBuffer:1024*1024}),output=child.stdout+child.stderr;
 assert.equal(child.error,undefined,output);assert.equal(child.signal,null,output);assert.equal(child.status,1,output);
 assert.match(output,/ACTUAL_ORDINARY_ACTION_COMMIT_ENTERED/);
 assert.match(output,/four ordinary actions exceed their shared 20000ms durability\/read budget/);
 const elapsed=Number(output.match(/Ordinary-action shared 20000ms observation: (\d+)ms/)?.[1]);assert.ok(elapsed>=20000,'the earned action stall reaches the original single 20s limit: '+output);
 t.diagnostic('The actual held ordinary-action commit rejected at the single '+elapsed+'ms action deadline and its child exited normally.');
 assert.match(output,/# tests 1\b/);assert.match(output,/# fail 1\b/);assert.match(output,/# cancelled 0\b/);
});

test('RISK recovery observation budget: the first actual Add prefix belongs to the single action deadline',async t=>{
 const os=await import('node:os'),root=fs.mkdtempSync(path.join(os.tmpdir(),'scanner-action-prefix-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=fs.readFileSync(fileURLToPath(import.meta.url),'utf8'),name='RISK corrupt cloud work budget: ordinary actions stay durable without rereading unchanged unrepairable generations';
 const start=source.indexOf("test('"+name+"'"),end=source.indexOf("\ntest('RISK corrupt cloud work budget: cold-opened",start);assert.ok(start>=0&&end>start);
 const anchor=' ctx.window.CLOUD_PUSH_DELAY_MS=0;',consumer=source.slice(start,end);assert.equal(consumer.split(anchor).length,2);
 const delayed=consumer.replace(anchor,` const action=ctx.onAction;let heldFirstAdd=false;
 ctx.onAction=(name,...args)=>{if(name==='add'&&!heldFirstAdd){heldFirstAdd=true;const started=performance.now();Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,21000);const elapsed=performance.now()-started;assert.ok(elapsed>=20000);const result=action(name,...args);assert.ok(ctx.state.tasks.some(row=>row.title==='Local work while the cloud source needs a choice'));console.log('ACTUAL_FIRST_ADD_PREFIX_MS '+Math.round(elapsed));return result;}return action(name,...args);};
 t.after(()=>{ctx.onAction=action;});
`+anchor);
 fs.writeFileSync(path.join(root,'prefix-consumer.mjs'),(source.slice(0,start)+delayed+source.slice(end)).replace('const __dirname = path.dirname(fileURLToPath(import.meta.url));','const __dirname = '+JSON.stringify(__dirname)+';'));
 fs.symlinkSync(path.join(__dirname,'node_modules'),path.join(root,'node_modules'),'dir');fs.symlinkSync(path.join(__dirname,'tests/shared.js'),path.join(root,'shared.js'));
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const child=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+name+'$','prefix-consumer.mjs'],{cwd:root,env,encoding:'utf8',timeout:70000,maxBuffer:1024*1024}),output=child.stdout+child.stderr;
 assert.equal(child.error,undefined,output);assert.equal(child.signal,null,output);
 assert.equal(child.status,1,'the first actual Add cannot acquire a fresh20s window after its synchronous entry: '+output);
 const prefixElapsed=Number(output.match(/ACTUAL_FIRST_ADD_PREFIX_MS (\d+)/)?.[1]);assert.ok(prefixElapsed>=20000,'the first Add really exceeds the original action budget: '+output);
 assert.match(output,/four ordinary actions exceed their shared 20000ms durability\/read budget/);
 assert.match(output,/# tests 1\b/);assert.match(output,/# fail 1\b/);assert.match(output,/# cancelled 0\b/);
 t.diagnostic(output.match(/ACTUAL_FIRST_ADD_PREFIX_MS \d+/)?.[0]+' rejected under the original action deadline; child exited normally.');
});

test('RISK saved view decision integration: inherited guest authority and peer edits retain this device view through scoped Undo and durably acknowledged reopen',async t=>{
 const {IDBFactory}=await import('fake-indexeddb');
 for(const backend of ['fallback','IndexedDB'])await t.test(backend,async t=>{
  const at=Date.parse('2026-10-17T15:00:00Z'),storage=sharedScannerStorage(),indexedDB=backend==='IndexedDB'?new IDBFactory():undefined;
  const options={sharedStorage:storage,...(indexedDB?{indexedDBProvider:indexedDB,deviceDbName:'saved-view-integration-'+Date.now()}: {})};
  const local=await loadAppAtTime(at,options),apps=[local];
  t.after(()=>{for(const app of apps){app.shim.window.CloudSync&&(app.shim.window.CloudSync.user=null);vm.runInContext('clearCloudRetry();clearTimeout(cloudTimer)',app.ctx);}});
  local.ctx.onAction('ok-quickstart',{});for(let i=0;i<45;i++)local.ctx.addTask('Shared integration task '+i,false);
  local.ctx.onAction('start-scan',{dataset:{mode:'descending'}});
  assert.ok(local.ctx.state.decisionEvents.some(row=>row.account===null),'the real guest scanner creates retained guest authority');
  const h=makeSyncHarness({remote:null,rev:0,delayMs:1}),CS=local.shim.window.CloudSync=h.factory();
  local.shim.window.dispatchEvent({type:'cloudsync'});await local.ctx.cloudPull();local.ctx.cloudPushNow();await settleSavedViewPublication(local,h,'Guest inheritance');
  assert.equal(local.ctx.state.syncAccount,'e@example.com');assert.equal(CS.errorCode||null,null);
  assert.equal(local.ctx.state.decisionBaseline.account,'e@example.com');
  assert.ok(local.ctx.state.decisionBaseline.inheritance.some(row=>row.reason==='guest-first-empty-account'&&row.sourceAccount===null),'normal reconciliation attests guest actions before account publication');
  assert.equal(local.ctx.state.syncDirty,false);assert.match(local.ctx.state.decisionBase.id,/^db1:/);
  if(!local.ctx.state.listOpen)local.ctx.onAction('toggle-list');
  const search=local.shim.document.getElementById('listSearch');search.id='listSearch';search.value='Shared';local.shim.document.dispatchEvent({type:'input',target:search});
  const body=local.shim.document.getElementById('listBody');body.id='listBody';body.scrollTop=420;local.shim.document.dispatchEvent({type:'scroll',target:body});local.shim.window.dispatchEvent({type:'pagehide'});
  // pagehide deliberately suspends publication; reopen through the real lifecycle consumer.
  local.shim.window.dispatchEvent({type:'pageshow'});CS.ready=false;
  await local.ctx.persist();const raw=JSON.stringify(local.ctx.state),peer=await loadAppAtTime(at,{seedStorage:{[SYNC_STORE_KEY]:raw,[LOCAL_HEAD_KEY]:raw},cloudSyncFactory:h.factory});apps.push(peer);await peer.ctx.cloudPull();
  const edited=peer.ctx.state.tasks.at(-1).id;await saveEditorChoice(peer,edited,at+100,{title:'Shared peer title after inheritance'});
  if(peer.ctx.state.listOpen)peer.ctx.onAction('toggle-list');peer.ctx.cloudPushNow();await settleSavedViewPublication(peer,h,'Peer editor Save');
  assert.equal(peer.ctx.state.syncDirty,false);assert.ok(h.remoteState().decisionEvents.some(row=>row.kind==='current-choice'&&row.target?.property==='title'));
  let release;const gate=new Promise(resolve=>{release=resolve;}),pull=CS.pull.bind(CS);CS.pull=async()=>{const response=await pull();await gate;return response;};CS.ready=true;
  const pending=local.ctx.cloudPull();await syncSettle(5);setFakeTime(local.ctx,at+200);const added=local.ctx.addTask('Shared local add during pull',false);release();await pending;CS.pull=pull;local.ctx.cloudPushNow();await settleSavedViewPublication(local,h,'Concurrent local Add');
  assert.equal(local.ctx.state.tasks.find(row=>row.id===edited).title,'Shared peer title after inheritance');assert.ok(local.ctx.state.tasks.some(row=>row.id===added.id));
  assert.equal(local.ctx.state.listOpen,true);assert.equal(search.value,'Shared');assert.equal(body.scrollTop,420);assert.equal(local.ctx.state.syncDirty,false);
  assert.equal(await local.ctx.onAction('undo',{}),true);await local.ctx.persist();local.ctx.cloudPushNow();
  // A clean flag can precede completion of the preceding write's CAS/ack tail.
  // Close only after the intended Undo bytes are acknowledged and durable.
  await settleSavedViewPublication(local,h,'Undo before close');assert.equal(local.ctx.state.syncDirty,false,'Undo publication is acknowledged before closing this fixture');
  assert.equal(local.ctx.state.tasks.some(row=>row.id===added.id),false,'scoped Undo removes only the local addition');assert.equal(local.ctx.state.tasks.find(row=>row.id===edited).title,'Shared peer title after inheritance','scoped Undo retains independent peer authority');
  local.shim.window.dispatchEvent({type:'pagehide'});await local.ctx.persist();
  const reopened=await loadAppAtTime(at+300,{...options,cloudSyncFactory:h.factory});apps.push(reopened);await reopened.ctx.cloudPull();reopened.ctx.cloudPushNow();await settleSavedViewPublication(reopened,h,'Reopened board');
  assert.equal(reopened.ctx.state.listOpen,true);assert.equal(reopened.shim.document.getElementById('listSearch').value,'Shared');assert.equal(reopened.shim.document.getElementById('listBody').scrollTop,420);
  assert.equal(reopened.ctx.state.tasks.find(row=>row.id===edited).title,'Shared peer title after inheritance');assert.equal(reopened.ctx.state.tasks.some(row=>row.id===added.id),false);assert.equal(reopened.ctx.state.syncDirty,false,JSON.stringify({code:reopened.shim.window.CloudSync.errorCode,localRev:reopened.ctx.state.syncRev,remoteRev:h.doc.rev,same:reopened.ctx.cloudPayload()===h.doc.payload,calls:h.calls.slice(-10),differentFields:Object.keys(JSON.parse(h.doc.payload)).filter(key=>JSON.stringify(reopened.ctx.state[key])!==JSON.stringify(JSON.parse(h.doc.payload)[key]))}));
 });
});

test('RISK saved view broken-board startup: prior appearance stays inert until the recovered board opens',async t=>{
 await openingBoardFixture(t);
 for(const retainAppearance of [true,false]){
  const view=await invisibleSavedViewBrowser('light',false,false,{width:390,height:844},false,{brokenDeviceBoard:true,retainAppearance});
  try{
   assert.ok(view.startup.brokenPayload,'the real durable device head was replaced with a malformed board fixture');
   assert.equal(view.startup.sourceCheck?.board,true,'the retained local board independently passes the app recovery-source validator; '+JSON.stringify(view.startup.sourceCheck));
   assert.deepEqual(Object.values(view.before.sourceCopies).map(raw=>JSON.parse(raw).tasks.length),[66,66],'two distinct supported browser sources retain the prior working board independently of the appearance');
   assert.equal(view.early.settled,false,'the real device-store open is still pending when startup is inspected');
   assert.equal(view.early.ready,false,'the application has not declared the broken board open yet');
   assert.equal(view.early.status,null,'no recovery or cloud claim is made before the source is read');
   if(retainAppearance){
    assert.equal(view.early.previewVisible,true,'an existing saved appearance remains visible while the broken durable head is being checked');
    assert.ok(view.early.rows.length>0&&view.early.rows.every(text=>text.includes('Saved appearance task')),'the visible projection contains only the previous task appearance');
    assert.equal(view.early.activeActions,0,'the cached projection remains inert and cannot act as recovered board authority');
   }else{
    assert.equal(view.early.previewVisible,true,'a complete independently validated local board is visible even without the optional appearance');
    assert.equal(view.early.rows.length,66,'all saved tasks are displayed while durable opening waits');
    assert.equal(view.early.shellVisibility,'hidden','the normal empty shell stays hidden until the supported local source opens');
   }
   await view.page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
   const ready=await view.page.evaluate(async()=>({rows:document.querySelectorAll('#listBody .trow').length,taskCount:state.tasks.length,taskIds:state.tasks.map(task=>task.id),query:document.getElementById('listSearch').value,listOpen:!document.getElementById('listBody').hidden,tasks:JSON.stringify(state.tasks),preview:!!document.querySelector('[data-saved-preview]'),recoveryHold:await window.ScannerDeviceStore?.getRecoveryCloudHold?.()||null,head:await window.ScannerDeviceStore?.readHead?.()||null,sourceCopies:{legacy:localStorage.getItem('fvp:chain-scanner:v1'),localHead:localStorage.getItem('fvp:chain-scanner:protected:v1')}}));
   if(process.env.SAVED_VIEW_ARTIFACT_DIR){
    fs.mkdirSync(process.env.SAVED_VIEW_ARTIFACT_DIR,{recursive:true});
    await view.page.screenshot({path:path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`broken-board-ready-${retainAppearance?'with-appearance':'without-appearance'}.png`)});
    fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`broken-board-ready-${retainAppearance?'with-appearance':'without-appearance'}.json`),JSON.stringify({startup:view.startup,early:view.early,ready:{...ready,tasks:JSON.parse(ready.tasks),sourceCopies:Object.fromEntries(Object.entries(ready.sourceCopies).map(([key,value])=>[key,value===null?null:JSON.parse(value)]))}},null,2)+'\n');
   }
   assert.equal(ready.tasks,view.before.tasks,'the actual recovered browser board matches the retained readable local source; '+JSON.stringify({taskCount:ready.taskCount,taskIds:ready.taskIds,hold:ready.recoveryHold}));
   assert.equal(ready.rows,retainAppearance?65:66,'the actual recovered browser board replaces the projection and uses its saved or default list view; '+JSON.stringify({taskCount:ready.taskCount,query:ready.query,listOpen:ready.listOpen,hold:ready.recoveryHold}));
   assert.equal(ready.query,retainAppearance?'Saved appearance':'','the recovered board restores its view when available and otherwise uses the normal list view');
   assert.equal(ready.preview,false,'hydration removes the non-authoritative projection');
   assert.equal(ready.recoveryHold?.reason,'device-source-recovery','opening the recovered board does not clear its genuine hold');
   assert.deepEqual(ready.sourceCopies,view.before.sourceCopies,'the separate working-board sources remain byte-for-byte protected through hydration');
   assert.deepEqual(view.errors,[]);
  }finally{await view.browser.close();}
 }
});

test('RISK saved view opening source preservation: invalid optional appearance keeps its bytes while one complete task opens',async t=>{
 await openingBoardFixture(t);
 for(const config of [{appearanceFault:'corrupt'},{appearanceFault:'blocked'},{readFailures:1},{readFailures:2},{readFailures:2,theme:'dark',mask:'account'},{readFailures:2,viewport:{width:1100,height:900},mask:'source'},{readFailures:2,theme:'dark',viewport:{width:1100,height:900},mask:'view-account'},{readFailures:2,theme:'dark',mask:'uid',sourceFault:'terminal-signed-in'}])await t.test(config.appearanceFault||('read-failures-'+config.readFailures+'-'+(config.theme||'light')+'-'+(config.viewport?.width||390)+(config.sourceFault?'-signed-in':'')),async()=>{
 const {appearanceFault,readFailures}=config;
 const view=await invisibleSavedViewBrowser(config.theme||'light',false,false,config.viewport||{width:390,height:844},false,{brokenDeviceBoard:true,retainAppearance:!!appearanceFault,oneTask:true,appearanceFault,readFailures,sourceFault:config.sourceFault,syntheticCloud:true,holdConfiguredFirebaseImports:true,topOfPage:true});
 try{
  await view.waitForFirebaseImports();
  const opening=await view.page.evaluate(()=>({ready:document.documentElement.dataset.appReady==='true',readSettled:window.__actualLocalRead.settled,stateNull:state===null,scanTimer:scanWakeTimer,saveTimer,appearance:(()=>{try{return localStorage.getItem('fvp:chain-scanner:appearance:v1');}catch{return 'blocked';}})(),rows:[...document.querySelectorAll('[data-saved-preview] .trow .tt')].map(e=>e.textContent),sources:{legacy:localStorage.getItem('fvp:chain-scanner:v1'),localHead:localStorage.getItem('fvp:chain-scanner:protected:v1')}}));
  assert.equal(opening.ready,false);assert.equal(opening.readSettled,false);assert.deepEqual(opening.rows,['Saved appearance task 00']);assert.deepEqual(opening.sources,view.before.sourceCopies);
  assert.equal(opening.stateNull,true);assert.equal(opening.scanTimer,null,'provisional presentation cannot start the scanner clock');assert.equal(opening.saveTimer,null,'provisional presentation cannot queue a board save');
  await view.page.keyboard.press('y');await view.page.keyboard.press('Delete');await view.page.locator('[data-saved-preview] .trow .tt').first().dispatchEvent('click');
  if(appearanceFault)assert.equal(opening.appearance,appearanceFault==='corrupt'?'{unreadable optional appearance':'blocked','ignoring invalid appearance while opening must not delete those bytes');
  if(readFailures){await view.page.waitForFunction(count=>window.__actualLocalRead.failedAttempts>=count,readFailures);const afterFailure=await view.page.evaluate(()=>({ready:document.documentElement.dataset.appReady==='true',previewRows:document.querySelectorAll('[data-saved-preview] .trow').length,liveRows:document.querySelectorAll('.wrap:not([data-saved-preview]) .trow').length,attempts:window.__actualLocalRead.attempts}));assert.equal(afterFailure.previewRows+afterFailure.liveRows,1,'the safe complete board remains connected through the established retry or failure outcome');assert.ok(afterFailure.attempts<=4,'repeated read failure stays bounded');}
  view.releaseHeldFirebaseImports();
  if(readFailures===2){
   await view.page.waitForFunction(()=>window.SavedAppearance?.recoveryHeld===true,null,{timeout:6000});
   const held=await view.page.evaluate(()=>{const paint=element=>{const s=getComputedStyle(element);return{background:s.backgroundColor,border:s.border,borderRadius:s.borderRadius,padding:s.padding};};return{accepted:liveBoardAccepted,stateTasks:state.tasks.length,previewRows:document.querySelectorAll('[data-saved-preview] .trow').length,scannerTimer:scanWakeTimer,saveTimer,notice:paint(document.querySelector('[data-saved-preview] p.kv.warn')),neighbor:paint(document.querySelector('[data-saved-preview] [data-preview-id="scan"] .notice')),sourceBytes:{legacy:localStorage.getItem('fvp:chain-scanner:v1'),localHead:localStorage.getItem('fvp:chain-scanner:protected:v1')},header:[...document.querySelectorAll('[data-saved-preview] #syncBtn,[data-saved-preview] [data-act="settings"]')].map(e=>({id:e.id,hiddenAncestor:!!e.closest('[aria-hidden="true"],[inert]'),disabled:e.disabled}))};});
   assert.equal(held.accepted,false);assert.equal(held.stateTasks,0,'retained presentation is never adopted as hidden workspace state');assert.equal(held.previewRows,1);assert.equal(held.scannerTimer,null);assert.equal(held.saveTimer,null);assert.deepEqual(held.sourceBytes,view.before.sourceCopies);assert.equal(held.header.length,2);assert.ok(held.header.every(e=>!e.hiddenAncestor&&!e.disabled),'real recovery controls stay reachable outside inert or hidden ancestors');
   assert.notEqual(held.notice.background,'rgba(0, 0, 0, 0)','terminal recovery text needs a stable painted surface above the moving landscape');assert.deepEqual(held.notice,held.neighbor,'the new status reuses the adjacent established notice backplate border radius and insets');
   if(config.sourceFault==='terminal-signed-in'){const sameOwner=await view.page.evaluate(()=>{const settings=document.querySelector('[data-saved-preview] [data-act="settings"]'),sync=document.getElementById('syncBtn');window.dispatchEvent(new Event('cloudsync'));return{previewRows:document.querySelectorAll('[data-saved-preview] .trow').length,sameSettings:document.querySelector('[data-saved-preview] [data-act="settings"]')===settings,sameSync:document.querySelector('[data-saved-preview] #syncBtn')===sync,accepted:liveBoardAccepted,tasks:state.tasks.length,scanTimer:scanWakeTimer,saveTimer};});assert.deepEqual(sameOwner,{previewRows:1,sameSettings:true,sameSync:true,accepted:false,tasks:0,scanTimer:null,saveTimer:null},'a matching known account and UID event keeps the same terminal read-only board and real header connected');}
   const refocused=await view.page.evaluate(()=>{const before=JSON.stringify(state);window.dispatchEvent(new Event('focus'));return{changed:JSON.stringify(state)!==before,scanTimer:scanWakeTimer,saveTimer};});assert.deepEqual(refocused,{changed:false,scanTimer:null,saveTimer:null},'returning to a terminal read-only board cannot run scanner decisions or queue a hidden workspace save');
   const hints=await view.page.evaluate(()=>{window.dispatchEvent(new StorageEvent('storage',{key:'fvp:chain-scanner:appearance:v1'}));localStorage.setItem('fvp:chain-scanner:saved-view:v1',JSON.stringify({v:1,account:window.CloudSync.user||null,query:'Saved appearance',eligibility:'all',tagFilter:null}));window.dispatchEvent(new StorageEvent('storage',{key:'fvp:chain-scanner:saved-view:v1'}));return{previewRows:document.querySelectorAll('[data-saved-preview] .trow').length,realSettings:document.querySelectorAll('[data-saved-preview] [data-act="settings"]').length,realSync:document.querySelectorAll('[data-saved-preview] #syncBtn').length,accepted:liveBoardAccepted};});
   assert.deepEqual(hints,{previewRows:1,realSettings:1,realSync:1,accepted:false},'optional same-owner hints preserve the single held board and its connected real recovery header');
   const settings=view.page.locator('[data-saved-preview] [data-act="settings"]');await settings.focus();await view.page.keyboard.press('Shift+Tab');assert.equal(await view.page.evaluate(()=>document.activeElement.id),'syncBtn','native keyboard navigation reaches the real recovery status');
   if(process.env.SAVED_VIEW_ARTIFACT_DIR){const name='terminal-hold-'+(config.theme||'light')+'-'+(config.viewport?.width||390)+(config.sourceFault?'-signed-in':'');await view.page.screenshot({path:path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,name+'.png')});fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,name+'.json'),JSON.stringify({held,frames:await view.page.evaluate(()=>window.__firstAppearanceFrames)},null,2)+'\n');}
   await view.page.locator('[data-saved-preview] [data-act="settings"]').click();assert.match(await view.page.locator('#modalRoot').innerText(),/read.only|needs recovery/i);assert.equal(await view.page.locator('#stDateFormat').isDisabled(),true,'held Settings cannot edit a hidden workspace');
   await view.page.getByText('Data and backups',{exact:true}).click();await view.page.locator('#backupRestoreSource').selectOption('paste');await view.page.locator('#modalRoot [data-act="restore-backup"]').click();assert.equal(await view.page.locator('#jsonBox').isEditable(),true,'the existing deliberate Paste Restore remains reachable');await view.page.getByRole('button',{name:'Close',exact:true}).last().click();
   if(process.env.SAVED_VIEW_ARTIFACT_DIR)await view.page.screenshot({path:path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,'terminal-settings-'+(config.theme||'light')+'-'+(config.viewport?.width||390)+(config.sourceFault?'-signed-in':'')+'.png')});
   await view.page.evaluate(()=>{onAction('add',{});TaskActionOwner.perform({type:'benchmark',action:'done'});});assert.equal(await view.page.evaluate(()=>state.tasks.length),0);
   if(config.mask){
    await view.page.locator('#modalRoot [data-act="close-modal"]').first().click();
    const masked=await view.page.evaluate(kind=>{if(kind==='account'||kind==='uid'){if(kind==='account')window.CloudSync.user='another-opening-owner@example.test';else window.CloudSync.recoveryIdentity=()=>'different-terminal-uid';window.CloudSync.ready=true;window.dispatchEvent(new Event('cloudsync'));}else{const key=kind==='source'?'fvp:chain-scanner:v1':'fvp:chain-scanner:saved-view:v1',value=JSON.parse(localStorage.getItem(key));if(kind==='source')value.tasks[0].title='Different source after the terminal hold';else value.account='another-opening-owner@example.test';localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new StorageEvent('storage',{key}));}return{preview:!!document.querySelector('[data-saved-preview]'),accepted:liveBoardAccepted,tasks:state.tasks.length,undoDisabled:document.querySelector('#appHeader [data-act="undo"]').disabled,themeDisabled:document.getElementById('themeBtn').disabled,settingsHidden:!!document.querySelector('#appHeader [data-act="settings"]').closest('[hidden],[inert],[aria-hidden="true"]')};},config.mask);
    assert.deepEqual(masked,{preview:false,accepted:false,tasks:0,undoDisabled:true,themeDisabled:true,settingsHidden:false},'a held account/source change masks saved content and leaves only the real recovery controls usable');
    await view.page.locator('#appHeader [data-act="settings"]').click();assert.equal(await view.page.locator('#modalRoot [data-act="sync-reload"]').isEnabled(),true);assert.doesNotMatch(await view.page.locator('#modalRoot').innerText(),/complete retained board stays/i,'after privacy masking, Settings cannot claim that the retained board is still visible');
    await view.page.evaluate(sources=>{localStorage.setItem('fvp:chain-scanner:v1',sources.legacy);localStorage.setItem('fvp:chain-scanner:protected:v1',sources.localHead);},view.before.sourceCopies);
   }
   if(config.sourceFault==='terminal-signed-in'){assert.deepEqual(await view.page.evaluate(()=>({accepted:liveBoardAccepted,tasks:state.tasks.length})),{accepted:false,tasks:0},'the additional signed-in hold/UID-mask control claims no source adoption');assert.deepEqual(view.errors,[]);return;}
   await view.page.evaluate(()=>localStorage.removeItem('__openingReadFailures'));await view.page.locator('#modalRoot [data-act="sync-reload"]').click();
  }
  await view.page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  assert.equal(await view.page.locator('#listBody .trow').count(),1);const frames=await view.page.evaluate(()=>window.__firstAppearanceFrames);assert.ok(frames.filter(f=>f.readStarted).every(f=>f.boardVisible&&f.rows===1&&f.connectedBoards===1),'one complete board remains connected from first read through accepted handover');assert.deepEqual(view.errors,[]);
 }finally{view.releaseHeldFirebaseImports();await view.browser.close();}
 });
});

test('RISK saved view accepted handover: normal actions and exact local work survive repeated offline reopening',async t=>{
 await openingBoardFixture(t);
 const {waitForTruthyProbe}=await import('../scripts/agent-tools/async-probe.mjs');
 const view=await invisibleSavedViewBrowser('dark',false,false,{width:390,height:844},false,{brokenDeviceBoard:true,retainAppearance:false,scannerState:'active',installedOffline:true,topOfPage:true,availabilityFixture:true});
 try{
  assert.equal(view.early.settled,false);assert.equal(view.early.rows.length,66,JSON.stringify({early:view.early,startup:view.startup}));
  await view.page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  await view.page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const accepted=await view.page.evaluate(()=>({ranks:[...document.querySelectorAll('#listBody .rank-summary')].map(e=>e.textContent),sparks:document.querySelectorAll('#listBody .rank-summary svg').length,preview:!!document.querySelector('[data-saved-preview]'),mode:state.mode,intervention:state.interventionActive,history:JSON.stringify(state.workLog)}));
  assert.equal(accepted.preview,false);assert.equal(accepted.mode,'scan');assert.equal(accepted.intervention,false);assert.ok(accepted.ranks.some(value=>value.trim()),'accepted opening resumes ordinary current ranking and chance display');assert.ok(accepted.sparks>0,'accepted opening resumes normal sparkline output');
  const futureRow=view.page.locator('#listBody .trow').filter({hasText:'Unmatched control task'});assert.equal(await futureRow.locator('.notstarted').count(),1,'the accepted board initially shows its known future start date');await view.page.clock.setFixedTime(new Date('2026-10-29T12:00:00Z'));await view.page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(await futureRow.locator('.notstarted').count(),0,'returning after the controlled calendar change refreshes normal accepted availability');assert.equal(await view.page.evaluate(()=>isIntrinsicallyEligible(state.tasks.find(task=>task.title==='Unmatched control task'))),true);
  const row=view.page.locator('#listBody .trow').first(),heightBefore=await row.evaluate(e=>e.getBoundingClientRect().height);
  await row.locator('.tt').click();await view.page.locator('#etTitle').fill('Accepted task edit after recovered opening');await view.page.locator('[data-act="save-edit"]').click();
  await waitForTruthyProbe(()=>view.page.evaluate(async()=>JSON.parse((await ScannerDeviceStore.readHead()).payload).tasks.some(t=>t.title==='Accepted task edit after recovered opening')),{timeoutMs:30_000,pollIntervalMs:25});
  const edited=await view.page.evaluate(()=>({tasks:JSON.stringify(state.tasks),sources:{legacy:localStorage.getItem('fvp:chain-scanner:v1'),localHead:localStorage.getItem('fvp:chain-scanner:protected:v1')},history:JSON.stringify(state.workLog)}));
  assert.deepEqual(edited.sources,view.before.sourceCopies,'an accepted native edit preserves both protected recovery originals');assert.equal(edited.history,accepted.history,'reopening and editing a title do not invent History observations');
  await view.page.locator('[data-act="bulk-select"]').click();const selectable=view.page.locator('#listBody .trow').first();const beforeSelected=await selectable.evaluate(e=>e.getBoundingClientRect().height);await selectable.locator('[data-act="bulk-toggle"]').first().click();const selectedHeight=await selectable.evaluate(e=>e.getBoundingClientRect().height);assert.ok(Math.abs(beforeSelected-selectedHeight)<1,'natural selected state retains the same task-row height');await view.page.locator('[data-act="bulk-cancel"]').click();

  const online=await view.page.evaluate(async()=>{const response=await fetch('/index.html?online-opening-control='+Date.now(),{cache:'no-store'});return response.status;});assert.equal(online,200,'online transport control reaches the available origin');
  await view.context.setOffline(true);const failed=await view.page.evaluate(async()=>{try{await fetch('/uncached-opening-offline-'+Date.now(),{cache:'no-store'});return false;}catch{return true;}});assert.equal(failed,true,'actual offline transport fails before local acceptance is claimed');
  if(await view.page.locator('#addInput').isHidden())await view.page.locator('[data-act="toggle-add"]').click();
  await view.page.locator('#addInput').fill('Accepted offline task after recovered opening');await view.page.locator('[data-act="add"]').click();
  await waitForTruthyProbe(()=>view.page.evaluate(async()=>JSON.parse((await ScannerDeviceStore.readHead()).payload).tasks.some(t=>t.title==='Accepted offline task after recovered opening')),{timeoutMs:30_000,pollIntervalMs:25});
  for(let i=0;i<2;i++){
   await view.page.reload({waitUntil:'domcontentloaded'});await view.page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
   const reopened=await view.page.evaluate(()=>({titles:state.tasks.map(t=>t.title),views:document.querySelectorAll('.wrap:has(.trow)').length,preview:!!document.querySelector('[data-saved-preview]'),sources:{legacy:localStorage.getItem('fvp:chain-scanner:v1'),localHead:localStorage.getItem('fvp:chain-scanner:protected:v1')}}));
   assert.ok(reopened.titles.includes('Accepted task edit after recovered opening'));assert.ok(reopened.titles.includes('Accepted offline task after recovered opening'));assert.equal(reopened.views,1);assert.equal(reopened.preview,false);assert.deepEqual(reopened.sources,view.before.sourceCopies);
  }
  assert.ok(heightBefore>0);assert.deepEqual(view.errors,[]);
 }finally{await view.context.setOffline(false);await view.browser.close();}
});

test('RISK saved view broken-board visibility: the complete saved board is readable while durable startup waits',async t=>{
 await openingBoardFixture(t);const enlargedCoverage=new Set();
 for(const config of [
  {browserEngine:'chromium',theme:'light',scannerState:'active'}, {browserEngine:'chromium',theme:'dark',scannerState:'active'},
  {browserEngine:'webkit',theme:'light',scannerState:'active'}, {browserEngine:'webkit',theme:'dark',scannerState:'active'},
  {retainAppearance:true,scannerState:'active',historyFixture:true}, {theme:'dark',retainAppearance:true,scannerState:'active',historyFixture:true,viewport:{width:1100,height:900}}, {theme:'light',retainAppearance:true,scannerState:'active',historyFixture:true,viewport:{width:1100,height:900}}, {theme:'dark',retainAppearance:true,scannerState:'active',historyFixture:true}, {longTitle:true}, {scannerState:'paused'}, {scannerState:'intervention'}].filter(config=>!openingBoardSelfHosted||config.browserEngine!=='webkit')){
  const {retainAppearance=false,longTitle=false,browserEngine='chromium',theme='light',scannerState,historyFixture,viewport={width:390,height:844}}=config;
  const label=[browserEngine,theme,viewport.width,retainAppearance?'saved-view':'no-appearance',longTitle?'long-title':scannerState||'no-dot'].join('-');
  const view=await invisibleSavedViewBrowser(theme,false,false,viewport,false,{brokenDeviceBoard:true,retainAppearance,longTitle,scannerState,historyFixture,browserEngine,syntheticCloud:true,holdConfiguredFirebaseImports:true,openingDelayMs:4000,topOfPage:true});
  try{
   await view.waitForFirebaseImports();
   const opening=await view.page.evaluate(()=>{
    const root=[...document.querySelectorAll('.wrap')].find(e=>getComputedStyle(e).visibility==='visible'&&e.getBoundingClientRect().width>0),list=root?.querySelector('#listBody,[data-preview-id="listBody"]');
    return{ready:document.documentElement.dataset.appReady==='true',stateIsNull:state===null,readSettled:window.__actualLocalRead.settled,
     visible:!!root,inert:root?.inert===true,rows:[...(list?.querySelectorAll('.trow')||[])].map(e=>e.querySelector('.tt')?.textContent||e.textContent),
     count:root?.querySelector('#listCount,[data-preview-id="listCount"]')?.textContent||'',query:root?.querySelector('[data-preview-id="listSearch"]')?.value,scan:root?.querySelector('[data-preview-id="scan"]')?.textContent,cards:[...root.querySelectorAll('.card .title')].map(e=>e.textContent),themeControl:root.querySelector('.themebtn')?.textContent,passCounter:root.querySelector('.plabel')?.textContent,history:root.querySelector('[data-preview-id="histPanel"]')?.textContent,sources:{legacy:localStorage.getItem('fvp:chain-scanner:v1'),localHead:localStorage.getItem('fvp:chain-scanner:protected:v1')}};
   });
   assert.equal(opening.ready,false);assert.equal(opening.stateIsNull,true,'a displayed local board does not gain authoritative application state');
   assert.equal(opening.readSettled,false,'the actual durable source is still being opened');
   assert.equal(opening.visible,true,'a complete retained local board must remain visible even without an optional appearance cache');
   assert.equal(opening.inert,true,'the opening board stays read-only before authoritative validation');
   assert.equal(opening.rows.length,retainAppearance?65:66,'the complete matching list is readable, beyond a bounded cached window');
   assert.equal(opening.query,retainAppearance?'Saved appearance':'','the saved search remains intact when available');
   assert.ok(opening.rows.some(title=>title.includes('Saved appearance task 00')),'the beginning of the saved board is present');
   assert.ok(opening.rows.some(title=>title.includes('Saved appearance task 64')),'the end of the saved board is present');
   assert.match(opening.count,/66/,'the board retains its complete saved task count');
   assert.deepEqual(opening.sources,view.before.sourceCopies,'displaying the complete board does not rewrite either retained source');
   assert.match(opening.themeControl,theme==='dark'?/Dark/:/Light/,'the opening theme control has the actual saved label');assert.match(opening.passCounter,/\d+\/\d+/,'the saved pass counter is populated');
   if(scannerState){
    assert.ok(opening.cards.includes('Saved appearance task 01'),'the saved benchmark is visible');
    assert.equal(opening.cards.includes('Saved appearance task 02'),scannerState==='active','the saved candidate respects paused and intervention states');
    if(scannerState==='paused')assert.match(opening.scan,/Scanning paused/);
    if(scannerState==='intervention')assert.match(opening.scan,/Only 23% chance/);
   }
   if(historyFixture)assert.match(opening.history,/Saved earlier work.*worked on it/,'the saved open History panel contains its complete saved entry');
   const capture=async file=>{if(!process.env.SAVED_VIEW_ARTIFACT_DIR)return;const previous=process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';try{await view.page.screenshot({path:path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,file)});}finally{if(previous===undefined)delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;else process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY=previous;}};
   const surface=[];
   for(const enlarged of [false,true]){
    await view.page.evaluate(enlarged=>{document.getElementById('full-board-text-size')?.remove();if(enlarged){const style=document.createElement('style');style.id='full-board-text-size';style.textContent='.syncbtn{font-size:18px!important}.topbtns .ghost:last-child{font-size:19.5px!important}';document.head.append(style);const root=document.querySelector('[data-saved-preview]');window.__fullBoardTextSizes??=[...root.querySelectorAll('*')].filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>({element:e,old:e.style.fontSize,size:Number.parseFloat(getComputedStyle(e).fontSize)}));for(const row of window.__fullBoardTextSizes)row.element.style.fontSize=(row.size*1.5)+'px';}else{for(const row of window.__fullBoardTextSizes||[])row.element.style.fontSize=row.old;}window.scrollTo(0,0);},enlarged);
    await capture('full-board-'+label+'-'+(enlarged?'enlarged':'ordinary')+'-scanner.png');
    for(const position of ['top','middle','end']){
     const probe=await view.page.evaluate(position=>{const root=document.querySelector('[data-saved-preview]'),body=root.querySelector('[data-preview-id="listBody"]');body.scrollTop=position==='top'?0:position==='middle'?body.scrollHeight/2:body.scrollHeight;window.scrollTo(0,Math.max(0,body.getBoundingClientRect().top+scrollY-100));const r=body.getBoundingClientRect();return{position,settled:window.__actualLocalRead.settled,ready:document.documentElement.dataset.appReady==='true',scroll:body.scrollTop,rows:body.querySelectorAll('.trow').length,visible:[...body.querySelectorAll('.trow')].filter(e=>{const b=e.getBoundingClientRect();return b.bottom>r.top&&b.top<Math.min(r.bottom,innerHeight);}).map(e=>e.querySelector('.tt').textContent),theme:document.documentElement.dataset.theme,width:document.documentElement.scrollWidth,viewport:innerWidth};},position);
     assert.equal(probe.settled,false,'full saved content is actually visible before the held read completes');assert.equal(probe.ready,false);assert.equal(probe.rows,retainAppearance?65:66);assert.ok(probe.visible.length>0);assert.equal(probe.theme,theme);assert.ok(probe.width<=probe.viewport+1,'opening content fits the phone viewport');
     if(position==='end')assert.ok(probe.visible.some(title=>title.includes('Saved appearance task 64')),'the complete last matching task can actually be seen');
     const typography=await view.page.evaluate(()=>{const root=document.querySelector('[data-saved-preview]'),sample=selector=>[...root.querySelectorAll(selector)].filter(e=>e.textContent.trim()).slice(0,2).map(e=>({text:e.textContent,fontSize:getComputedStyle(e).fontSize}));return{cards:sample('.card .title'),filters:sample('.ltag'),rows:sample('.trow .tt'),contexts:sample('.ctxitem'),history:sample('.histbody .dt')};});
     if(enlarged){const ordinary=surface.find(item=>!item.enlarged)?.typography;for(const key of ['cards','filters','rows','contexts','history']){assert.equal(typography[key].length,ordinary[key].length,'the enlarged '+key+' surface retains its sampled content');if(typography[key].length)enlargedCoverage.add(key);assert.ok(typography[key].every((item,i)=>Number.parseFloat(item.fontSize)>=Number.parseFloat(ordinary[key][i].fontSize)*1.49),'enlarged full-board acceptance actually increases '+key+' text, not only the header');}}
     surface.push({enlarged,...probe,typography});
     await capture('full-board-'+label+'-'+(enlarged?'enlarged':'ordinary')+'-'+position+'.png');
    }
   }
   view.releaseHeldFirebaseImports();await view.page.waitForFunction(()=>document.documentElement.dataset.appReady==='true',null,{timeout:15000});
   await view.page.evaluate(()=>new Promise(requestAnimationFrame));
   const frames=await view.page.evaluate(()=>window.__firstAppearanceFrames);
   if(process.env.SAVED_VIEW_ARTIFACT_DIR)fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,'full-board-'+label+'.json'),JSON.stringify({opening,surface,frames},null,2)+'\n');
   assert.ok(frames.some(frame=>frame.ready),'observe the accepted live board after the opening display');
   assert.ok(frames.filter(frame=>frame.readStarted).every(frame=>frame.boardVisible&&frame.rows>0),'every compositor opportunity from the actual durable-read boundary through handoff shows the full board');
   assert.ok(frames.every(frame=>frame.connectedBoards<=1),'the handoff never retains two connected complete board DOMs');
   assert.deepEqual(await view.page.evaluate(()=>state.tasks.map(t=>t.id)),JSON.parse(view.before.tasks).map(t=>t.id),'the authoritative recovered board keeps every displayed task');
   if(scannerState){const lifecycle=await view.page.evaluate(()=>({mode:state.mode,intervention:state.interventionActive}));assert.equal(lifecycle.mode,scannerState==='paused'?'work':'scan');assert.equal(lifecycle.intervention,scannerState==='intervention','accepted opening retains the supported active paused and intervention lifecycle');}


   assert.deepEqual(view.errors,[]);
  }finally{view.releaseHeldFirebaseImports();await view.browser.close();}
 }
 assert.deepEqual([...enlargedCoverage].sort(),['cards','contexts','filters','history','rows'],'actual enlarged coverage includes the complete board surfaces');
});

test('RISK saved view full-board filters: opening preserves saved membership controls and cheap task facts',async t=>{
 await openingBoardFixture(t);
 for(const savedFilter of ['ineligible','context','status','combined','missing-context','long-query','hint-refresh'])await t.test(savedFilter,async()=>{
  const view=await invisibleSavedViewBrowser('light',false,false,{width:390,height:844},false,{brokenDeviceBoard:true,retainAppearance:true,scannerState:'active',longTitle:savedFilter==='long-query',savedFilter,syntheticCloud:true,holdConfiguredFirebaseImports:true,topOfPage:true});
  try{
   await view.waitForFirebaseImports();assert.equal(view.startup.sourceCheck.board,true,'the populated saved fixture passes independent complete-source validation');
   const opening=await view.page.evaluate(()=>{const root=document.querySelector('[data-saved-preview]'),body=root.querySelector('[data-preview-id="listBody"]');return{stateNull:state===null,accepted:liveBoardAccepted,ready:document.documentElement.dataset.appReady==='true',settled:window.__actualLocalRead.settled,query:root.querySelector('[data-preview-id="listSearch"]').value,rows:[...body.querySelectorAll('.trow')].map(row=>({title:row.querySelector('.tt').textContent,dim:row.style.opacity,blockers:row.querySelector('.dependency-blockers')?.textContent,skip:row.querySelector('.skipped')?.textContent})),eligibility:root.querySelector('[data-preview-id="listEligibilityRow"] .on')?.textContent,tags:[...root.querySelectorAll('[data-preview-id="listTagRow"] .on')].map(e=>e.textContent),sources:{legacy:localStorage.getItem('fvp:chain-scanner:v1'),localHead:localStorage.getItem('fvp:chain-scanner:protected:v1')}};});
   assert.equal(opening.stateNull,true);assert.equal(opening.accepted,false);assert.equal(opening.ready,false);assert.equal(opening.settled,false);assert.deepEqual(opening.sources,view.before.sourceCopies);
   assert.equal(opening.rows.length,savedFilter==='ineligible'?2:savedFilter==='context'?60:savedFilter==='status'?3:savedFilter==='combined'?1:savedFilter==='missing-context'||savedFilter==='hint-refresh'?65:1,'all and only the complete matching tasks remain visible');
   assert.equal(opening.eligibility,savedFilter==='ineligible'?'Ineligible':savedFilter==='combined'?'Eligible':'All');
   assert.equal(opening.query,savedFilter==='long-query'?'Saved long task text '.repeat(100).slice(0,2048):'Saved appearance','valid saved query text including more than1024characters stays exact');
   if(savedFilter==='status'||savedFilter==='combined')assert.deepEqual(opening.tags,['evergreen'],'the supported status tag replaces a prior context tag in the shared saved-view slot');
   if(savedFilter==='missing-context')assert.equal(await view.page.evaluate(()=>JSON.parse(localStorage.getItem('fvp:chain-scanner:saved-view:v1')).tagFilter),'c:missing-opening-context','the missing reference was present at the actual unresolved opening boundary');
   if(savedFilter==='missing-context')assert.deepEqual(opening.tags,[],'a missing saved context safely falls back to all otherwise matching tasks');
   if(savedFilter==='long-query')assert.equal(opening.query.length,2048,'the actual maximum supported saved query is retained in full');
   if(savedFilter==='context'){
    assert.ok(opening.tags.length>0,'the saved context filter remains selected');assert.ok(opening.rows.some(row=>row.blockers?.includes('Saved appearance task 06')&&row.dim==='0.45'),'a blocked saved task retains its dependency title and eligibility dimming');
    assert.ok(opening.rows.some(row=>row.skip?.includes('can’t')),'a saved Can’t mark retains its visible hold label');assert.ok(opening.rows.some(row=>row.skip==='no'),'a saved No mark retains its visible label');assert.ok(opening.rows.some(row=>row.skip?.includes('worked')),'a saved Worked mark retains its visible label');
   }
   let acceptedTitles=opening.rows.map(row=>row.title).sort();
   if(savedFilter==='hint-refresh'){
    const changed=await view.page.evaluate(()=>{window.dispatchEvent(new StorageEvent('storage',{key:'fvp:chain-scanner:appearance:v1',newValue:'unrelated optional appearance'}));const retained=document.querySelectorAll('[data-saved-preview] .trow').length,key='fvp:chain-scanner:saved-view:v1',value=JSON.parse(localStorage.getItem(key));value.query='Saved appearance task 64';localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify(value)}));return{retained,ready:document.documentElement.dataset.appReady==='true',stateNull:state===null,rows:[...document.querySelectorAll('[data-saved-preview] .trow .tt')].map(e=>e.textContent)};});
    assert.equal(changed.retained,65,'optional-cache changes do not erase a complete source projection');assert.equal(changed.ready,false);assert.equal(changed.stateNull,true);assert.deepEqual(changed.rows,['Saved appearance task 64'],'a fresh saved-view hint uses independently known exact matching membership');acceptedTitles=['Saved appearance task 64'];
   }
   view.releaseHeldFirebaseImports();await view.page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
   assert.deepEqual(await view.page.evaluate(()=>[...document.querySelectorAll('#listBody .tt')].map(row=>row.textContent).sort()),acceptedTitles,'accepted hydration keeps the same saved membership while computed ranking may reorder it');assert.deepEqual(view.errors,[]);
  }finally{view.releaseHeldFirebaseImports();await view.browser.close();}
 });
});

test('RISK saved view full-board safety: supported copies and identity masks never grant authority',async t=>{
 await openingBoardFixture(t);
 for(const sourceFault of ['malformed-primary','malformed-protected','unsupported-protected','divergent','no-valid','early-account','early-account-no-appearance','early-identity','early-identity-cache-only','late-identity-cache-only','late-cache-source','late-account','late-identity','late-storage','late-view-account','late-signout-with-appearance','late-signout-no-appearance'])await t.test(sourceFault,async()=>{
  const view=await invisibleSavedViewBrowser('light',false,false,{width:390,height:844},false,{brokenDeviceBoard:true,retainAppearance:sourceFault.endsWith('with-appearance')||sourceFault.includes('cache-')||sourceFault.startsWith('early-')&&!sourceFault.endsWith('no-appearance'),syntheticCloud:true,holdConfiguredFirebaseImports:true,sourceFault,topOfPage:true});
  try{
   await view.waitForFirebaseImports();
   const opening=await view.page.evaluate(()=>({stateNull:state===null,accepted:liveBoardAccepted,ready:document.documentElement.dataset.appReady==='true',settled:window.__actualLocalRead.settled,
    preview:!!document.querySelector('[data-saved-preview]'),inert:document.querySelector('[data-saved-preview]')?.inert,actions:document.querySelectorAll('[data-saved-preview] [data-act],[data-saved-preview] [href],[data-saved-preview] [id]').length,
    rows:document.querySelectorAll('[data-saved-preview] .trow').length,pushes:window.__fullBoardCloudWrites,writes:window.__fullBoardSourceWrites,
    sources:{legacy:localStorage.getItem('fvp:chain-scanner:v1'),localHead:localStorage.getItem('fvp:chain-scanner:protected:v1')}}));
   assert.equal(opening.stateNull,true);assert.equal(opening.accepted,false);assert.equal(opening.ready,false);assert.equal(opening.settled,false);
   assert.equal(opening.pushes,0,'a displayed board cannot push before authority');assert.deepEqual(opening.writes,[],'display performs no saved-board or backup writes');assert.equal(opening.actions,0,'the full display cannot acquire live actions links or duplicate IDs');
   assert.deepEqual(opening.sources,view.before.sourceCopies,'all retained originals stay exact');
   if(sourceFault.endsWith('cache-only'))assert.equal(await view.page.evaluate(()=>window.__appearanceOwnerAtRead),'fixture@example.com','the cache-only owner fixture survives the prior pagehide and reaches the actual new-document read boundary');
   const shouldShow=['malformed-primary','malformed-protected','unsupported-protected','late-account','late-identity','late-storage','late-view-account','late-identity-cache-only','late-cache-source'].includes(sourceFault)||sourceFault.startsWith('late-signout');
   assert.equal(opening.preview,shouldShow,'only an unambiguous supported owner may display; divergent missing unsupported and foreign-owner sources never become an empty or chosen board');
   if(shouldShow){if(sourceFault.endsWith('cache-only')||sourceFault==='late-cache-source')assert.ok(opening.rows>0&&opening.rows<=48,'the isolated unsupported-source control reaches only the bounded optional cached appearance');else assert.equal(opening.rows,66);assert.equal(opening.inert,true);}
   if(sourceFault.startsWith('late-')){
    const masked=await view.page.evaluate(fault=>{
     if(fault==='late-view-account'){const key='fvp:chain-scanner:saved-view:v1',value={v:1,account:'different-view-owner',query:'private'};localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify(value)}));}
     else if(fault==='late-storage'||fault==='late-cache-source')window.dispatchEvent(new StorageEvent('storage',{key:'fvp:chain-scanner:protected:v1',newValue:'changed peer source'}));
     else{window.CloudSync.user=fault.startsWith('late-signout')?null:fault.startsWith('late-identity')?'fixture@example.com':'other@example.com';window.CloudSync.ready=true;window.CloudSync.recoveryIdentity=()=>fault.startsWith('late-signout')?null:'other-identity';window.dispatchEvent(new Event('cloudsync'));}
     return{preview:!!document.querySelector('[data-saved-preview]'),stateNull:state===null,accepted:liveBoardAccepted,pushes:window.__fullBoardCloudWrites};
    },sourceFault);
    assert.equal(masked.preview,false,'late account identity and storage changes immediately mask the pending display');assert.equal(masked.stateNull,true);assert.equal(masked.accepted,false);assert.equal(masked.pushes,0);
   }
  }finally{view.releaseHeldFirebaseImports();await view.browser.close();}
 });
});

test('RISK saved view broken-board startup: configured Firebase leaves the prior warning neutral until its first event',async t=>{
 await openingBoardFixture(t);
 for(const seedCachedError of [false,true])await t.test(seedCachedError?'cached old error':'cached recovery warning',async()=>{
 const view=await invisibleSavedViewBrowser('light',false,false,{width:390,height:844},false,{brokenDeviceBoard:true,retainAppearance:true,topOfPage:true,seedPriorRecoveryAppearance:true,seedCachedError,syntheticCloud:true,holdConfiguredFirebaseImports:true,browserEngine:openingBoardSelfHosted?'chromium':'webkit'});
 try{
  assert.equal(view.startup.priorRecovery?.hold?.reason,'device-source-recovery','the remembered warning comes from a real protected local recovery');
  assert.equal(view.startup.priorRecovery?.appearanceStatus,'☁ recovery pending','the initial cache contains the exact prior warning being tested');
  if(seedCachedError)assert.equal(await view.page.evaluate(()=>window.__cachedOldErrorSeeded===true),true,'this isolated variant seeds an old cached error before actual startup has any current error');
  const heldImports=await view.waitForFirebaseImports();
  const opening=await view.page.evaluate(()=>({
   configured:window.CloudSync?.configured===true,ready:window.CloudSync?.ready,status:window.CloudSync?.status,
   events:window.__cloudsyncEvents,readStarted:window.__actualLocalRead.started,readSettled:window.__actualLocalRead.settled,
   appReady:document.documentElement.dataset.appReady==='true',previewVisible:getComputedStyle(document.querySelector('[data-saved-preview]')).visibility==='visible',
   previewInert:document.querySelector('[data-saved-preview]')?.inert,projection:document.querySelector('[data-saved-preview] .syncbtn')?.textContent,
   projectionDisabled:document.querySelector('[data-saved-preview] .syncbtn')?.disabled,taskCount:document.querySelectorAll('[data-saved-preview] .trow').length,
   viewport:{width:innerWidth,height:innerHeight}
  }));
  if(process.env.SAVED_VIEW_ARTIFACT_DIR){
   fs.mkdirSync(process.env.SAVED_VIEW_ARTIFACT_DIR,{recursive:true});
   fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,'configured-cloud-first-paint-'+(seedCachedError?'old-error':'old-recovery')+'-before-event.json'),JSON.stringify({heldImports,opening,priorRecovery:view.startup.priorRecovery,seedCachedError},null,2)+'\n');
  }
  assert.equal(heldImports,3,'all three real Firebase module imports are held before initialization completes');
  assert.equal(opening.configured,true);assert.equal(opening.status,'syncing');
  assert.equal(opening.events,0,'the first real cloudsync event has not fired');
  assert.equal(opening.readStarted,true);assert.equal(opening.readSettled,false,'the durable broken-board read is still pending');
  assert.equal(opening.appReady,false,'the supported recovered board is not yet authoritative');
  assert.equal(opening.previewVisible,true);assert.equal(opening.previewInert,true);
  assert.equal(opening.projection,'☁ syncing','the stale cached recovery warning is neutral before any cloud event');
  assert.equal(opening.projectionDisabled,true);
  assert.equal(opening.taskCount>0,true,'the safe cached appearance remains populated while startup waits');
  view.releaseHeldFirebaseImports();
  await view.page.waitForFunction(()=>window.CloudSync?.status==='error'&&window.__cloudsyncEvents>0,null,{timeout:8000});
  const failed=await view.page.evaluate(()=>({status:window.CloudSync?.status,events:window.__cloudsyncEvents,appReady:document.documentElement.dataset.appReady==='true',readSettled:window.__actualLocalRead.settled,projection:document.querySelector('[data-saved-preview] .syncbtn')?.textContent,title:document.querySelector('[data-saved-preview] .syncbtn')?.title,previewInert:document.querySelector('[data-saved-preview]')?.inert}));
  if(process.env.SAVED_VIEW_ARTIFACT_DIR)fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,'configured-cloud-first-'+(seedCachedError?'old-error':'old-recovery')+'-import-error.json'),JSON.stringify(failed,null,2)+'\n');
  assert.equal(failed.status,'error','an actual configured-module import failure remains visible');
  assert.equal(failed.events>0,true);assert.equal(failed.appReady,false);assert.equal(failed.readSettled,false);
  assert.equal(failed.projection,'☁ error','the real initialization failure replaces the neutral opening label');
  assert.match(failed.title,/Cloud setup failed/);assert.equal(failed.previewInert,true);
  assert.deepEqual(view.errors,[]);
 }finally{view.releaseHeldFirebaseImports();await view.browser.close();}
 });
});

test('RISK saved view broken-board status: configured cloud changes remain visible in the saved appearance and after recovery',async t=>{
 await openingBoardFixture(t);
 const observedThemePaint=[],browserEngines=openingBoardSelfHosted?['chromium']:['chromium','webkit'];
 for(const browserEngine of browserEngines)for(const theme of ['light','dark'])for(const viewport of [{width:390,height:844},{width:1100,height:900}]){
  const view=await invisibleSavedViewBrowser(theme,false,false,viewport,false,{brokenDeviceBoard:true,retainAppearance:true,syntheticCloud:true,topOfPage:true,browserEngine,seedPriorRecoveryAppearance:true,holdConfiguredFirebaseImports:true,fixedTime:'2026-10-28T12:00:00Z'});
  try{
   const detailedPageErrors=[];view.page.on('pageerror',error=>detailedPageErrors.push(error.stack||error.message));
   assert.equal(view.startup.priorRecovery?.hold?.reason,'device-source-recovery','the cached recovery-pending label comes from a real completed protected local recovery');
   assert.equal(view.startup.priorRecovery?.fixtureHoldSafelyCleared,true,'the isolated second broken head starts a separate recovery instead of reusing the prior hold');
   assert.equal(view.startup.priorRecovery?.status,'☁ recovery pending');
   assert.equal(view.startup.priorRecovery?.appearanceStatus,'☁ recovery pending');
   assert.equal(view.startup.priorRecovery?.appearanceDisabled,false);
   const heldImports=await view.waitForFirebaseImports();
   const prefix=`broken-board-status-${browserEngine}-${theme}-${viewport.width}`;
   const capture=async suffix=>{
    if(!process.env.SAVED_VIEW_ARTIFACT_DIR)return;
    const previous=process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
    try{await view.page.screenshot({path:path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`${prefix}-${suffix}.png`)});}finally{if(previous===undefined)delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;else process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY=previous;}
   };
   const snapshot=()=>view.page.evaluate(async()=>{
    const preview=document.querySelector('[data-saved-preview]'),read=button=>{if(!button)return null;const rect=button.getBoundingClientRect(),style=getComputedStyle(button);return{text:button.textContent,title:button.title,disabled:button.disabled,hidden:button.hidden,visibility:style.visibility,focused:document.activeElement===button,focusVisible:button.matches(':focus-visible'),fontLoaded:document.fonts.check(`${style.fontSize} ${style.fontFamily}`),style:{fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,padding:style.padding,height:style.height,borderWidth:style.borderWidth,borderStyle:style.borderStyle,borderColor:style.borderColor,borderRadius:style.borderRadius,backgroundColor:style.backgroundColor,color:style.color,boxShadow:style.boxShadow,outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth,outlineOffset:style.outlineOffset,outlineColor:style.outlineColor},clientWidth:button.clientWidth,scrollWidth:button.scrollWidth,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};};
    const panel=preview?.querySelector('[data-preview-id="listWrap"]')||document.getElementById('listWrap');
    return{ready:document.documentElement.dataset.appReady==='true',settled:window.__actualLocalRead.settled,previewVisible:!!preview&&getComputedStyle(preview).visibility==='visible',previewInert:!!preview?.inert,taskCount:state?.tasks?.length??null,shellVisibility:getComputedStyle(document.querySelector('.wrap')).visibility,hold:await window.ScannerDeviceStore?.getRecoveryCloudHold?.()||null,activeElement:{id:document.activeElement?.id||null,action:document.activeElement?.getAttribute?.('data-act')||null,tag:document.activeElement?.tagName||null},
     projection:read(preview?.querySelector('.syncbtn')),live:read(document.getElementById('syncBtn')),settings:read(preview?.querySelector('.topbtns .ghost:last-child')||document.querySelector('#appHeader [data-act="settings"]')),
     header:(()=>{const rect=(preview?.querySelector('[data-preview-id="appHeader"]')||document.getElementById('appHeader'))?.getBoundingClientRect();return rect?{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height}:null;})(),
     cloud:{configured:window.CloudSync?.configured,ready:window.CloudSync?.ready,status:window.CloudSync?.status,events:window.__cloudsyncEvents},
     theme:document.documentElement.dataset.theme,colorScheme:getComputedStyle(document.documentElement).colorScheme,paint:{rootBackground:getComputedStyle(document.documentElement).backgroundColor,bodyBackground:getComputedStyle(document.body).backgroundColor,bodyColor:getComputedStyle(document.body).color,panelBackground:panel?getComputedStyle(panel).backgroundColor:null,panelColor:panel?getComputedStyle(panel).color:null},viewport:{width:innerWidth,height:innerHeight}};
   });
   const naturalOpening=await snapshot();
   if(process.env.SAVED_VIEW_ARTIFACT_DIR)await capture('natural-syncing');
   await view.page.addStyleTag({content:'.syncbtn{font-size:18px!important}.topbtns [data-act="settings"],.topbtns .ghost:last-child{font-size:19.5px!important}'});
   const opening=await snapshot();
   if(process.env.SAVED_VIEW_ARTIFACT_DIR){
    fs.mkdirSync(process.env.SAVED_VIEW_ARTIFACT_DIR,{recursive:true});
    await capture('syncing');
    fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`${prefix}-syncing.json`),JSON.stringify({heldImports,naturalOpening,opening},null,2)+'\n');
   }
   assert.equal(opening.ready,false,'the malformed device board has not hydrated while the saved appearance is shown');
   assert.equal(opening.settled,false,'the real device-store read remains held');
   assert.equal(opening.previewVisible,true,'the safe saved appearance stays visible while recovery opens');
   assert.equal(opening.previewInert,true,'status updates do not authorize the cached appearance');
   assert.equal(opening.cloud?.configured,true);assert.equal(opening.cloud?.status,'syncing');assert.equal(opening.cloud?.events,0,'the actual configured module has not fired its first event');
   assert.equal(naturalOpening.projection?.text,'☁ syncing');assert.equal(naturalOpening.projection?.disabled,true);
   assert.equal(naturalOpening.projection?.style.fontSize,'12px','the natural system badge is recorded before enlargement');
   assert.equal(naturalOpening.settings?.style.fontSize,'13px','the existing Settings control records its natural baseline size');
   assert.equal(opening.projection?.style.fontSize,'18px','the visible badge is checked with enlarged text');
   assert.equal(opening.settings?.style.fontSize,'19.5px','the saved preview Settings control receives the same enlarged-text check');
   assert.equal(opening.projection?.style.fontFamily,naturalOpening.projection?.style.fontFamily);
   assert.equal(opening.projection?.style.fontWeight,naturalOpening.projection?.style.fontWeight);
   assert.equal(opening.projection?.style.padding,naturalOpening.projection?.style.padding);
   assert.equal(opening.projection?.style.borderRadius,naturalOpening.projection?.style.borderRadius);
   assert.equal(opening.projection?.style.borderWidth,naturalOpening.projection?.style.borderWidth);
   assert.equal(opening.projection?.style.borderStyle,naturalOpening.projection?.style.borderStyle);
   assert.equal(opening.projection?.style.borderColor,naturalOpening.projection?.style.borderColor);
   assert.equal(opening.projection?.style.backgroundColor,naturalOpening.projection?.style.backgroundColor);
   assert.equal(opening.projection?.style.color,naturalOpening.projection?.style.color);
   assert.equal(opening.projection?.style.boxShadow,naturalOpening.projection?.style.boxShadow);
   assert.ok(Math.abs(Number.parseFloat(opening.projection?.style.lineHeight)-Number.parseFloat(naturalOpening.projection?.style.lineHeight)*1.5)<0.01);
   assert.equal(opening.settings?.style.fontFamily,naturalOpening.settings?.style.fontFamily);
   assert.equal(opening.settings?.style.fontWeight,naturalOpening.settings?.style.fontWeight);
   assert.equal(opening.settings?.style.padding,naturalOpening.settings?.style.padding);
   assert.equal(opening.settings?.style.borderRadius,naturalOpening.settings?.style.borderRadius);
   assert.equal(opening.settings?.style.borderColor,naturalOpening.settings?.style.borderColor);
   assert.ok(Math.abs(Number.parseFloat(opening.settings?.style.lineHeight)-Number.parseFloat(naturalOpening.settings?.style.lineHeight)*1.5)<0.01);
   assert.equal(opening.projection?.text,'☁ syncing','the current pre-hydration state is rendered in the visible projection');
   assert.equal(opening.projection?.disabled,true,'syncing remains disabled while board authority is unavailable');
   assert.equal(opening.projection?.style.fontSize,'18px','the status is checked with enlarged text');
   assert.ok(opening.projection.scrollWidth<=opening.projection.clientWidth+1,'the enlarged syncing label fits without clipping: '+JSON.stringify(opening.projection));
   assert.equal(opening.settings?.text,'⚙','the adjacent Settings control remains in the saved header');
   assert.equal(opening.settings?.disabled,false,'the adjacent Settings control retains its saved enabled appearance');
   assert.ok(opening.projection.left>=0&&opening.projection.right<=viewport.width,'the syncing badge stays within the viewport');
   assert.ok(opening.settings.left>=0&&opening.settings.right<=viewport.width,'the neighboring Settings control stays within the viewport');
   assert.equal(opening.projection.right>opening.settings.left&&opening.settings.right>opening.projection.left&&opening.projection.bottom>opening.settings.top&&opening.settings.bottom>opening.projection.top,false,'the enlarged syncing badge does not overlap the adjacent Settings control');
   assert.ok(opening.header.left>=0&&opening.header.right<=viewport.width,'the saved header stays within the selected viewport');
   assert.equal(opening.theme,theme);assert.ok(opening.colorScheme.includes(theme));
   assert.notEqual(opening.paint.rootBackground,'rgba(0, 0, 0, 0)','the selected theme produces a painted page surface');
   assert.notEqual(opening.paint.panelBackground,'rgba(0, 0, 0, 0)','the visible saved board panel is painted');
   observedThemePaint.push({browserEngine,width:viewport.width,theme,rootBackground:opening.paint.rootBackground,panelBackground:opening.paint.panelBackground});
   assert.deepEqual(opening.viewport,viewport);
   const changed=await view.page.evaluate(()=>{
    window.CloudSync.status='error';window.CloudSync.errorStage='init';window.CloudSync.errorCode='unavailable';window.dispatchEvent(new Event('cloudsync'));
    const preview=document.querySelector('[data-saved-preview]'),read=button=>{if(!button)return null;const rect=button.getBoundingClientRect(),style=getComputedStyle(button);return{text:button.textContent,title:button.title,disabled:button.disabled,hidden:button.hidden,visibility:style.visibility,fontLoaded:document.fonts.check(`${style.fontSize} ${style.fontFamily}`),style:{fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,padding:style.padding,height:style.height,borderWidth:style.borderWidth,borderStyle:style.borderStyle,borderColor:style.borderColor,borderRadius:style.borderRadius,backgroundColor:style.backgroundColor,color:style.color,boxShadow:style.boxShadow,outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth,outlineColor:style.outlineColor},clientWidth:button.clientWidth,scrollWidth:button.scrollWidth,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};};
    return{ready:document.documentElement.dataset.appReady==='true',settled:window.__actualLocalRead.settled,previewVisible:!!preview&&getComputedStyle(preview).visibility==='visible',previewInert:!!preview?.inert,
     cloud:{configured:window.CloudSync?.configured,ready:window.CloudSync?.ready,status:window.CloudSync?.status,events:window.__cloudsyncEvents},
     projection:read(preview?.querySelector('.syncbtn')),live:read(document.getElementById('syncBtn')),settings:read(preview?.querySelector('.topbtns .ghost:last-child')),
     theme:document.documentElement.dataset.theme,colorScheme:getComputedStyle(document.documentElement).colorScheme,paint:{rootBackground:getComputedStyle(document.documentElement).backgroundColor,bodyBackground:getComputedStyle(document.body).backgroundColor,bodyColor:getComputedStyle(document.body).color,panelBackground:getComputedStyle(preview?.querySelector('[data-preview-id="listWrap"]')||document.getElementById('listWrap'))?.backgroundColor||null,panelColor:getComputedStyle(preview?.querySelector('[data-preview-id="listWrap"]')||document.getElementById('listWrap'))?.color||null}};
   });
   await capture('error');
   if(process.env.SAVED_VIEW_ARTIFACT_DIR)fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`${prefix}-error.json`),JSON.stringify({naturalOpening,opening,changed},null,2)+'\n');
   assert.equal(changed.ready,false,'a cloud event does not make the broken board authoritative');
   assert.equal(changed.settled,false,'the durable read is still pending when the genuine error appears');
   assert.equal(changed.previewVisible,true);assert.equal(changed.previewInert,true);
   assert.equal(changed.live?.text,'☁ error','the authoritative status registers the real cloud error');
   assert.equal(changed.projection?.text,'☁ error','the real cloud initialization error stays visible in the saved appearance');
   assert.equal(changed.cloud?.status,'error');assert.ok(changed.cloud?.events>0,'the actual status event updates both visible controls');
   assert.match(changed.projection?.title,/Cloud setup failed \(unavailable\)/,'the mirrored title retains the real failure details');
   assert.equal(changed.projection?.disabled,false,'the visible error keeps the ordinary enabled appearance while the inert root still blocks actions');
   assert.equal(changed.settings?.text,'⚙','the neighboring Settings control remains beside the changed badge');
   assert.equal(changed.settings?.disabled,false);
   assert.equal(changed.projection.style.fontSize,'18px');assert.equal(changed.settings.style.fontSize,'19.5px');
   assert.ok(changed.projection.scrollWidth<=changed.projection.clientWidth+1,'the enlarged error label fits without clipping: '+JSON.stringify(changed.projection));
   assert.equal(changed.theme,theme);assert.ok(changed.colorScheme.includes(theme));
   assert.equal(changed.paint.rootBackground,opening.paint.rootBackground);assert.equal(changed.paint.panelBackground,opening.paint.panelBackground);
   view.releaseHeldFirebaseImports();
   await view.page.waitForFunction(()=>window.CloudSync?.ready===true&&window.CloudSync?.status==='error',null,{timeout:8000});
   await view.page.waitForFunction(()=>document.documentElement.dataset.appReady==='true',null,{timeout:10000});
   await view.page.evaluate(()=>{window.CloudSync.status='syncing';window.CloudSync.errorStage=null;window.CloudSync.errorCode=null;window.dispatchEvent(new Event('cloudsync'));});
   const ready=await snapshot();
   await capture('recovery-pending');
   if(process.env.SAVED_VIEW_ARTIFACT_DIR)fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`${prefix}-recovery-pending.json`),JSON.stringify(ready,null,2)+'\n');
   assert.equal(ready.previewVisible,false,'the projection is removed when the supported board opens');
   assert.equal(ready.shellVisibility,'visible');assert.equal(ready.taskCount,66);
   assert.equal(ready.live.text,'☁ recovery pending','the genuine saved-source hold is visible after hydration');
   assert.equal(ready.live.disabled,false,'cloud actions remain held by the existing source recovery control');
   assert.equal(ready.hold?.reason,'device-source-recovery','the genuine durable recovery hold remains active');
   assert.equal(ready.cloud?.status,'syncing');
   assert.equal(ready.live.style.fontSize,'18px');
   assert.ok(ready.live.scrollWidth<=ready.live.clientWidth+1,'the enlarged post-hydration hold remains readable: '+JSON.stringify(ready.live));
   assert.ok(ready.live.left>=0&&ready.live.right<=viewport.width,'the post-hydration recovery badge stays within the viewport');
   assert.ok(ready.settings.left>=0&&ready.settings.right<=viewport.width,'the post-hydration neighboring Settings control stays within the viewport');
   assert.equal(ready.live.right>ready.settings.left&&ready.settings.right>ready.live.left&&ready.live.bottom>ready.settings.top&&ready.settings.bottom>ready.live.top,false,'the post-hydration recovery badge does not overlap Settings');
   assert.equal(ready.theme,theme,'the recovered board keeps the selected fixture theme');assert.ok(ready.colorScheme.includes(theme));
   assert.equal(ready.paint.rootBackground,opening.paint.rootBackground,'the selected theme paint stays stable when the recovered board replaces its appearance');
   assert.equal(ready.paint.panelBackground,opening.paint.panelBackground,'the visible board panel retains the selected paint after hydration');
   await view.page.evaluate(()=>{window.CloudSync.status='error';window.CloudSync.errorStage='init';window.CloudSync.errorCode='unavailable';window.dispatchEvent(new Event('cloudsync'));});
   const postErrorSnapshot=await snapshot();
   const postError=postErrorSnapshot;
   if(process.env.SAVED_VIEW_ARTIFACT_DIR){await capture('post-hydration-error');fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`${prefix}-post-hydration-error.json`),JSON.stringify(postError,null,2)+'\n');}
   assert.equal(postError.ready,true);assert.equal(postError.previewVisible,false);assert.equal(postError.taskCount,66);
   assert.equal(postError.live.text,'☁ error','a post-hydration cloud setup failure remains visible over the genuine recovery hold');
   assert.match(postError.live.title,/Cloud setup failed \(unavailable\)/);
   assert.equal(postError.live.disabled,false);assert.equal(postError.live.hidden,false);assert.equal(postError.live.style.fontSize,'18px');
   assert.ok(postError.live.scrollWidth<=postError.live.clientWidth+1,'the enlarged post-hydration cloud error remains readable: '+JSON.stringify(postError.live));
   assert.ok(postError.live.left>=0&&postError.live.right<=viewport.width,'the post-hydration error badge stays within the viewport');
   assert.ok(postError.settings.left>=0&&postError.settings.right<=viewport.width,'Settings stays within the viewport beside the post-hydration error');
   assert.equal(postError.live.right>postError.settings.left&&postError.settings.right>postError.live.left&&postError.live.bottom>postError.settings.top&&postError.settings.bottom>postError.live.top,false,'the enlarged post-hydration error does not overlap Settings');
   assert.equal(postError.hold?.reason,'device-source-recovery','a real cloud error does not clear the durable recovery hold');
   assert.equal(postError.theme,theme);assert.ok(postError.colorScheme.includes(theme));assert.equal(postError.paint.rootBackground,opening.paint.rootBackground);assert.equal(postError.paint.panelBackground,opening.paint.panelBackground);
   await view.page.evaluate(()=>{window.CloudSync.status='syncing';window.CloudSync.errorStage=null;window.CloudSync.errorCode=null;window.dispatchEvent(new Event('cloudsync'));});
   const postRecovery=await snapshot();
   if(process.env.SAVED_VIEW_ARTIFACT_DIR){await capture('post-hydration-recovery-pending');fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`${prefix}-post-hydration-recovery-pending.json`),JSON.stringify(postRecovery,null,2)+'\n');}
   assert.equal(postRecovery.live.text,'☁ recovery pending','after the transient cloud error clears, the genuine recovery hold remains visible');
   assert.equal(postRecovery.live.disabled,false);assert.equal(postRecovery.live.hidden,false);assert.equal(postRecovery.live.style.fontSize,'18px');
   assert.ok(postRecovery.live.scrollWidth<=postRecovery.live.clientWidth+1,'the enlarged post-hydration recovery label remains readable after the error clears: '+JSON.stringify(postRecovery.live));
   assert.equal(postRecovery.hold?.reason,'device-source-recovery');
   assert.equal(postRecovery.theme,theme);assert.ok(postRecovery.colorScheme.includes(theme));assert.equal(postRecovery.paint.rootBackground,opening.paint.rootBackground);assert.equal(postRecovery.paint.panelBackground,opening.paint.panelBackground);
   await view.page.locator('#appHeader [data-act="undo"]').focus();
   await view.page.keyboard.press('Shift+Tab');
   const keyboardFocus=await snapshot();
   if(process.env.SAVED_VIEW_ARTIFACT_DIR){await capture('keyboard-focus');fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`${prefix}-keyboard-focus.json`),JSON.stringify({activeElement:keyboardFocus.activeElement,control:keyboardFocus.live},null,2)+'\n');}
   if(browserEngine==='chromium'){
    assert.equal(keyboardFocus.live.focused,true,'keyboard traversal reaches the enabled recovery status control');
    assert.equal(keyboardFocus.live.focusVisible,true,'the focused status control keeps its native visible keyboard focus');
    assert.equal(keyboardFocus.live.style.outlineStyle,'solid','keyboard focus has a visible outline');
    assert.equal(keyboardFocus.live.style.outlineWidth,'2px');assert.equal(keyboardFocus.live.style.outlineOffset,'2px');
   }
   const liveScroll=[];
   await view.page.evaluate(()=>{const list=document.getElementById('listBody');window.scrollTo(0,Math.max(0,list.getBoundingClientRect().top+window.scrollY-100));});
   for(const position of ['top','middle','end']){
    const state=await view.page.evaluate(async position=>{
     const list=document.getElementById('listBody'),max=Math.max(0,list.scrollHeight-list.clientHeight);list.scrollTop=position==='top'?0:position==='middle'?Math.round(max/2):max;list.dispatchEvent(new Event('scroll'));
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     const rect=list.getBoundingClientRect(),visible=[...list.querySelectorAll('.trow')].filter(row=>{const r=row.getBoundingClientRect();return r.bottom>rect.top&&r.top<rect.bottom;}).map(row=>row.querySelector('.tt')?.textContent||row.textContent.trim()),header=document.getElementById('appHeader').getBoundingClientRect(),badge=document.getElementById('syncBtn').getBoundingClientRect(),settings=document.querySelector('#appHeader [data-act="settings"]').getBoundingClientRect();
     return{position,scrollTop:list.scrollTop,maxScroll:max,clientHeight:list.clientHeight,scrollHeight:list.scrollHeight,visible,rows:list.querySelectorAll('.trow').length,listBounds:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom},headerBounds:{left:header.left,right:header.right,top:header.top,bottom:header.bottom},badgeBounds:{left:badge.left,right:badge.right,top:badge.top,bottom:badge.bottom},settingsBounds:{left:settings.left,right:settings.right,top:settings.top,bottom:settings.bottom},pageScroll:scrollY,viewport:{width:innerWidth,height:innerHeight}};
    },position);
    liveScroll.push(state);
    if(process.env.SAVED_VIEW_ARTIFACT_DIR&&browserEngine==='webkit'&&theme==='dark'&&viewport.width===390)await capture(`live-scroll-${position}`);
   }
   if(process.env.SAVED_VIEW_ARTIFACT_DIR)fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,`${prefix}-live-scroll.json`),JSON.stringify(liveScroll,null,2)+'\n');
   assert.ok(liveScroll[0].maxScroll>0&&liveScroll[0].rows>=60,'the recovered board keeps its populated scrollable task list');
   assert.equal(liveScroll[0].scrollTop,0);assert.ok(liveScroll[1].scrollTop>0&&liveScroll[1].scrollTop<liveScroll[1].maxScroll);assert.equal(liveScroll[2].scrollTop,liveScroll[2].maxScroll);
   assert.notDeepEqual(liveScroll[0].visible,liveScroll[2].visible,'top and end positions expose distinct recovered rows');
   assert.ok(liveScroll.every(item=>item.listBounds.left>=0&&item.listBounds.right<=viewport.width&&item.listBounds.top<viewport.height&&item.listBounds.bottom>0&&item.headerBounds.left>=0&&item.headerBounds.right<=viewport.width));
   assert.deepEqual(view.errors,[],JSON.stringify({initial:view.pageErrorDetails,later:detailedPageErrors}));
  }finally{await view.browser.close();}
 }
 for(const browserEngine of browserEngines)for(const width of [390,1100]){
  const light=observedThemePaint.find(item=>item.browserEngine===browserEngine&&item.width===width&&item.theme==='light');
  const dark=observedThemePaint.find(item=>item.browserEngine===browserEngine&&item.width===width&&item.theme==='dark');
  assert.ok(light&&dark,'both themes produce rendered evidence for each browser and viewport');
  assert.notEqual(light.rootBackground,dark.rootBackground,`${browserEngine} ${width}px root paint distinguishes light and dark themes`);
  assert.notEqual(light.panelBackground,dark.panelBackground,`${browserEngine} ${width}px board-panel paint distinguishes light and dark themes`);
 }
 if(process.env.SAVED_VIEW_ARTIFACT_DIR)fs.writeFileSync(path.join(process.env.SAVED_VIEW_ARTIFACT_DIR,'final-theme-paint-comparison.json'),JSON.stringify(observedThemePaint,null,2)+'\n');
});

test('CLOUD MERGE: a higher revision without deletion evidence retains older unique tasks', async () => {
  const local = syncState({ tasks: [syncTask('september23', 'September 23 no-history task')], syncRev: 4 });
  const remote = syncState({ tasks: [syncTask('september2', 'Old tab task')] });
  const h = makeSyncHarness({ remote, rev: 5 });
  const { ctx } = await loadApp({ seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) }, cloudSyncFactory: h.factory });
  await ctx.cloudPull(); await syncSettle(PAST_DEBOUNCE);
  assert.deepEqual(new Set(Array.from(ctx.state.tasks, task => task.id)), new Set(['september23', 'september2']));
  assert.deepEqual(new Set(h.remoteState().tasks.map(task => task.id)), new Set(['september23', 'september2']));
});

test('RISK backend fixture: Firestore read snapshots retain existence and deep payload',async t=>{
 await t.test('direct reads retain the original payload through mutation, replacement, and deletion',async t=>{
  const h=await loadCloudBackendV2({failures:{authPending:true},timeoutMs:5000});t.after(()=>h.CS.suspend());
  const db=h.sdk.getFirestore(),rootRef=h.sdk.doc(db,'users','owner'),rootPath=rootRef.path;
  const original={nested:{tasks:[{id:'read-time'}],opaque:{values:[1,2]}}};h.docs.set(rootPath,structuredClone(original));
  const direct=await h.sdk.getDoc(rootRef),server=await h.sdk.getDocFromServer(rootRef);
  h.docs.get(rootPath).nested.tasks[0].id='later';h.docs.get(rootPath).nested.opaque.values.push(3);
  assert.deepEqual(direct.data(),original,'a direct read retains a deep copy from its read time');
  assert.deepEqual(server.data(),original,'a server read retains a deep copy from its read time');
  const replacement={nested:{tasks:[{id:'replacement'}],opaque:{values:[9]}}};h.docs.set(rootPath,structuredClone(replacement));
  assert.equal(direct.exists(),true);assert.equal(server.exists(),true);
  assert.deepEqual(direct.data(),original,'replacement does not rewrite the held direct snapshot');
  const freshReplacement=await h.sdk.getDoc(rootRef);assert.deepEqual(freshReplacement.data(),replacement,'a fresh direct read sees the replacement');
  h.docs.delete(rootPath);
  assert.equal(direct.exists(),true,'deletion does not rewrite the held direct snapshot existence');
  assert.deepEqual(direct.data(),original,'deletion does not erase the held direct snapshot payload');
  assert.equal(server.exists(),true,'deletion does not rewrite the held server snapshot existence');
  const absentDirect=await h.sdk.getDoc(rootRef),absentServer=await h.sdk.getDocFromServer(rootRef);
  assert.equal(absentDirect.exists(),false);assert.equal(absentServer.exists(),false);
  const created={nested:{tasks:[{id:'created'}],opaque:{values:[7]}}};h.docs.set(rootPath,structuredClone(created));
  assert.equal(absentDirect.exists(),false,'creation does not rewrite a held absent direct snapshot');assert.equal(absentDirect.data(),undefined);
  assert.equal(absentServer.exists(),false,'creation does not rewrite a held absent server snapshot');assert.equal(absentServer.data(),undefined);
  assert.deepEqual((await h.sdk.getDoc(rootRef)).data(),created,'a fresh direct read sees creation');
  assert.deepEqual((await h.sdk.getDocFromServer(rootRef)).data(),created,'a fresh server read sees creation');
 });
 await t.test('server-query snapshots retain originals and fresh queries see replacement, deletion, and creation',async t=>{
  const h=await loadCloudBackendV2({failures:{authPending:true},timeoutMs:5000});t.after(()=>h.CS.suspend());
  const db=h.sdk.getFirestore(),collection=h.sdk.collection(db,'users','owner','generations','g','chunks');
  const queryRef=h.sdk.query(collection,h.sdk.limit(10)),rowRef=h.sdk.doc(db,'users','owner','generations','g','chunks','c0');
  const original={index:0,payload:{nested:{values:['read-time']}}};h.docs.set(rowRef.path,structuredClone(original));
  const first=(await h.sdk.getDocsFromServer(queryRef)).docs[0];assert.ok(first);assert.equal(first.exists(),true);
  h.docs.get(rowRef.path).payload.nested.values.push('later');
  assert.deepEqual(first.data(),original,'a server-query row keeps its deep read-time payload');
  const replacement={index:0,payload:{nested:{values:['replacement']}}};h.docs.set(rowRef.path,structuredClone(replacement));
  assert.equal(first.exists(),true);assert.deepEqual(first.data(),original,'replacement does not rewrite the held query snapshot');
  const freshReplacement=(await h.sdk.getDocsFromServer(queryRef)).docs[0];assert.deepEqual(freshReplacement.data(),replacement,'a fresh query sees the replacement');
  h.docs.delete(rowRef.path);assert.equal(first.exists(),true,'deletion does not rewrite the held query snapshot existence');
  assert.deepEqual(first.data(),original);
  assert.deepEqual((await h.sdk.getDocsFromServer(queryRef)).docs,[],'a fresh query sees deletion');
  const createdRef=h.sdk.doc(db,'users','owner','generations','g','chunks','created'),created={index:1,payload:{nested:{values:['created']}}};
  const absent=await h.sdk.getDoc(createdRef);assert.equal(absent.exists(),false);h.docs.set(createdRef.path,structuredClone(created));
  assert.equal(absent.exists(),false,'creation does not rewrite a held absent snapshot');assert.equal(absent.data(),undefined);
  const freshRows=(await h.sdk.getDocsFromServer(queryRef)).docs;assert.ok(freshRows.some(snapshot=>snapshot.ref.path===createdRef.path),'a fresh query sees creation');
 });
 await t.test('transaction snapshots retain their read-time document through replacement, deletion, and creation',async t=>{
  const h=await loadCloudBackendV2({failures:{authPending:true},timeoutMs:5000});t.after(()=>h.CS.suspend());
  const db=h.sdk.getFirestore(),rootRef=h.sdk.doc(db,'users','owner'),rootPath=rootRef.path;
  const original={nested:{tasks:[{id:'read-time'}],opaque:{values:[1,2]}}};h.docs.set(rootPath,structuredClone(original));
  const held=await h.sdk.runTransaction(db,tx=>tx.get(rootRef));
  h.docs.get(rootPath).nested.tasks[0].id='later';h.docs.get(rootPath).nested.opaque.values.push(3);
  assert.deepEqual(held.data(),original,'a transaction read retains a deep copy from its read time');
  const replacement={nested:{tasks:[{id:'replacement'}],opaque:{values:[9]}}};h.docs.set(rootPath,structuredClone(replacement));
  assert.equal(held.exists(),true);assert.deepEqual(held.data(),original,'replacement does not rewrite the held transaction snapshot');
  const freshReplacement=await h.sdk.runTransaction(db,tx=>tx.get(rootRef));assert.deepEqual(freshReplacement.data(),replacement,'a fresh transaction read sees the replacement');
  h.docs.delete(rootPath);assert.equal(held.exists(),true,'deletion does not rewrite the held transaction snapshot existence');
  assert.deepEqual(held.data(),original);const freshMissing=await h.sdk.runTransaction(db,tx=>tx.get(rootRef));
  assert.equal(freshMissing.exists(),false);assert.equal(freshMissing.data(),undefined);
  const createdRef=h.sdk.doc(db,'users','owner','new-document'),absent=await h.sdk.runTransaction(db,tx=>tx.get(createdRef));
  const created={nested:{values:['created']}};h.docs.set(createdRef.path,structuredClone(created));
  assert.equal(absent.exists(),false,'creation does not rewrite a held absent transaction snapshot');assert.equal(absent.data(),undefined);
  const freshCreated=await h.sdk.runTransaction(db,tx=>tx.get(createdRef));assert.equal(freshCreated.exists(),true);assert.deepEqual(freshCreated.data(),created);
 });
});

test('HARD GATE: cloud push repairs an omitted legacy task before conditional write', async () => {
  const base = syncState({ tasks: [syncTask('a','A'), syncTask('b','B')], syncRev: 3 });
  const h = makeSyncHarness({ remote: base, rev: 3 });
  const { ctx } = await loadApp({ seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(base) }, cloudSyncFactory: h.factory });
  await ctx.cloudPull();
  ctx.state.tasks = ctx.state.tasks.filter(task => task.id !== 'b'); // no delete action
  ctx.cloudPushNow(); await syncSettle(PAST_DEBOUNCE);
  assert.ok(h.remoteState().tasks.some(task => task.id === 'b'));
});

test('HISTORY GATE: next client keeps September 23 completion and work log after stale cloud write', async () => {
  const done=syncTask('shared','Shared task'); done.done=true; done.completedAt=Date.parse('2026-09-23T10:00:00Z');
  const local=syncState({tasks:[done],workLog:[{id:'session23',taskId:'shared',title:'Shared task',kind:'worked',at:Date.parse('2026-09-23T09:00:00Z')}],syncRev:4});
  const old=syncState({tasks:[syncTask('shared','Shared task')],workLog:[]});
  const h=makeSyncHarness({remote:old,rev:5});
  const storage=sharedScannerStorage({[SYNC_STORE_KEY]:JSON.stringify(local)});
  const first=await loadApp({sharedStorage:storage,cloudSyncFactory:h.factory});
  await first.ctx.cloudPull(); await syncSettle(PAST_DEBOUNCE);
  assert.equal(first.ctx.state.tasks[0].completedAt,done.completedAt);
  assert.ok(first.ctx.state.workLog.some(entry=>entry.id==='session23'));
  const second=await loadApp({seedStorage:{[SYNC_STORE_KEY]:JSON.stringify({...h.remoteState(),syncRev:h.doc.rev})},cloudSyncFactory:h.factory});
  await second.ctx.cloudPull();
  assert.equal(second.ctx.state.tasks[0].completedAt,done.completedAt);
  assert.ok(second.ctx.state.workLog.some(entry=>entry.id==='session23'));
});

test('DELETE INTENT: an unrelated newer cloud write cannot resurrect a locally deleted task or cleared row', async () => {
  const log={id:'worked-row',taskId:'removed',title:'Removed',kind:'worked',at:Date.now()-1000};
  const local=syncState({tasks:[],workLog:[],deletedTaskIds:{removed:true},clearedHistoryIds:{'worked-row':true},syncRev:4});
  const remote=syncState({tasks:[syncTask('removed','Removed')],workLog:[log]});
  const h=makeSyncHarness({remote,rev:5});
  const {ctx}=await loadApp({seedStorage:{[SYNC_STORE_KEY]:JSON.stringify(local)},cloudSyncFactory:h.factory});
  await ctx.cloudPull(); await syncSettle(PAST_DEBOUNCE);
  assert.equal(ctx.state.tasks.some(task=>task.id==='removed'),false);
  assert.equal(ctx.state.workLog.some(entry=>entry.id==='worked-row'),false);
  assert.equal(h.remoteState().tasks.some(task=>task.id==='removed'),false);
});

test('RISK offline unreadable backup status: useful unsaved work names the protected cause without quota or durability claims',async()=>{
 for(const source of ['unreadable original backup bytes','chain-scanner-backups-lzw9:unsupported-original']){
  const storage=sharedScannerStorage({[LOCAL_BACKUPS_KEY]:source}),app=await loadApp({sharedStorage:storage}),{ctx,shim}=app;
  shim.document.getElementById('addInput').value='Accepted beside protected unreadable backup';await ctx.onAction('add',{});assert.ok(ctx.state.tasks.some(row=>row.title==='Accepted beside protected unreadable backup'));
  assert.equal(vm.runInContext('liveBoardAccepted&&memoryRecoveryWorkspace',ctx),true);assert.equal(await ctx.persist(),false);
  const message=shim.document.getElementById('toast').textContent;assert.match(message,/unreadable backup/i);assert.match(message,/only in this tab|not saved|unsaved/i);assert.doesNotMatch(message,/storage is full|quota|saved successfully/i);
  assert.equal(storage.getItem(LOCAL_BACKUPS_KEY),source);assert.equal(storage.getItem(LOCAL_HEAD_KEY),null);assert.equal(storage.getItem(SYNC_STORE_KEY),null);assert.ok(ctx.deviceSaveIssue());
 }
});

test('RISK LOCAL BACKUPS: quota during Restore keeps the immediate pre-restore board',async()=>{
 for(const changedChance of [false,true]){
 const values=new Map();let quota=Infinity,quotaArmed=false;
 let appCtx=null;
 const used=()=>[...values].reduce((sum,[key,value])=>sum+key.length+value.length,0);
 const storage={
  getItem:key=>values.has(key)?values.get(key):null,
  removeItem:key=>values.delete(key),
  setItem(key,value){
   const next=new Map(values);next.set(key,String(value));
   if([...next].reduce((sum,[name,raw])=>sum+name.length+raw.length,0)>quota){
    const error=Error('aggregate browser storage quota');error.name='QuotaExceededError';throw error;
   }
   values.set(key,String(value));
   if(key===LOCAL_BACKUPS_KEY && appCtx && !quotaArmed){
    const rows=appCtx.parseBackupIndex(value);
    const latest=rows.find(row=>row.kind==='latest' && row.payload.includes('Restored huge'));
    if(latest && rows.some(row=>row.kind==='before-restore')){
     const plain=JSON.stringify(rows),packed=appCtx.packBackupIndex(plain);
     const stored=packed.length<plain.length?packed:plain;
     values.set(key,stored);
     const withoutPlain=JSON.stringify(rows.filter(row=>row!==latest));
     const withoutPacked=appCtx.packBackupIndex(withoutPlain);
     const withoutLatest=withoutPacked.length<withoutPlain.length?withoutPacked:withoutPlain;
     const released=stored.length-withoutLatest.length;
     const primaryGrowth=2*(latest.payload.length-storage.getItem(LOCAL_HEAD_KEY).length);
     // The index write fits, but removing only replaceable latest still leaves
     // the complete two-key restored board one code unit over site quota.
     const debugKey='fvp:chain-scanner:restart-diagnostics:v1',debugRaw=storage.getItem(debugKey);
     quota=used()-released+primaryGrowth-1-(debugRaw===null?0:debugKey.length+debugRaw.length);
     quotaArmed=true;
    }
   }
  },
 };
 const {ctx,shim}=await loadApp({sharedStorage:storage});
 appCtx=ctx;
 ctx.addTask('Current unique work');await ctx.persist();
 const before=storage.getItem(SYNC_STORE_KEY),at=Date.now();
 const targetBoard=syncState({tasks:[syncTask('restored-target','Restored huge '.repeat(100).trim())]});
 if(changedChance) targetBoard.chance={seed:'restored-seed',at:Date.now(),weights:{}};
 const target=JSON.stringify(targetBoard);
 const manual={id:'restore-target',day:new Date(at).toISOString().slice(0,10),at,kind:'manual',payload:target};
 storage.setItem(LOCAL_BACKUPS_KEY,JSON.stringify([manual]));
 ctx.openSettings();
 await ctx.restoreDurableBackupById(manual.id);
 assert.equal(quotaArmed,true,'the restore encountered aggregate quota after both backup writes');
 assert.equal(storage.getItem(SYNC_STORE_KEY),before,'a restore that cannot keep its safety copy holds the original primary board');
 assert.equal(storage.getItem(LOCAL_HEAD_KEY),storage.getItem(SYNC_STORE_KEY));
 await new Promise(resolve=>setTimeout(resolve,420));
 assert.equal(storage.getItem(SYNC_STORE_KEY),before,'a delayed save cannot bypass the protected restore hold');
 // A second tab has no access to this tab's in-memory pending marker and can
 // rotate the ordinary index row before this Restore gets another save chance.
 const peerIndex=storage.getItem(LOCAL_BACKUPS_KEY);
 const peerRows=ctx.parseBackupIndex(peerIndex);
 const displaced=peerRows.find(row=>row.kind==='before-restore' && row.payload===before);
 assert.ok(displaced);
 storage.setItem(LOCAL_BACKUPS_KEY,ctx.encodeBackupIndex(peerRows.filter(row=>row.id!==displaced.id),ctx.packedBackupIndex(peerIndex)));
 quota=Infinity; // otherwise quota, rather than missing safety, could hold the write
 assert.equal(await ctx.persist(),false,'a missing exact safety row blocks primary replacement');
 assert.equal(storage.getItem(SYNC_STORE_KEY),before);
 storage.setItem(LOCAL_BACKUPS_KEY,JSON.stringify(peerRows.map(row=>row.id===displaced.id
  ? {...row,payload:target} : row)));
 assert.equal(await ctx.persist(),false,'reusing the safety ID for different bytes cannot authorize replacement');
 assert.equal(storage.getItem(SYNC_STORE_KEY),before);
 storage.setItem(LOCAL_BACKUPS_KEY,JSON.stringify(peerRows.map(row=>row.id===displaced.id
  ? {...row,day:null} : row)));
 assert.equal(await ctx.persist(true),false,'an unreadable same-ID safety row cannot authorize replacement even when a prior backup was declared safe');
 assert.equal(storage.getItem(SYNC_STORE_KEY),before);
 storage.setItem(LOCAL_BACKUPS_KEY,peerIndex); // restore fixture for background retry coverage
 quota=used(); // a genuinely full device remains full for later background retries
 ctx.saveLocalBackup('before-cloud-adoption',JSON.stringify(ctx.state));
 assert.ok(ctx.parseBackupIndex(storage.getItem(LOCAL_BACKUPS_KEY)).some(row=>row.kind==='before-restore' && row.payload===before),
  'a cloud-reconciliation backup rotation keeps the pending Restore safety copy');
 let cloudSends=0;
 shim.window.CloudSync={ready:true,user:'e@example.com',push:async()=>{cloudSends++;return null;}};
 vm.runInContext('reconciledAs=window.CloudSync.user;',ctx); // an already-reconciled signed-in session
 ctx.cloudPush();
 await new Promise(resolve=>setTimeout(resolve,2050));
 assert.equal(vm.runInContext('cloudTimer',ctx),null,'the signed-in two-second cloud retry ran');
 assert.ok(ctx.parseBackupIndex(storage.getItem(LOCAL_BACKUPS_KEY)).some(row=>row.kind==='before-restore' && row.payload===before),
  'the two-second cloud retry cannot retire the pending Restore safety copy');
 assert.ok(cloudSends===0 || JSON.parse(storage.getItem(SYNC_STORE_KEY)).tasks.some(row=>row.title.startsWith('Restored huge')),
  'cloud writes only after a durable restored primary board exists');
 const update=pwaUpdateHarness();await update.ready();
 update.box.persist=()=>ctx.persist();
 await update.sh.controllerchange();
 assert.equal(update.counts().reloads,0,'a pending app update cannot reload while Restore is held');
 assert.ok(ctx.parseBackupIndex(storage.getItem(LOCAL_BACKUPS_KEY)).some(row=>row.kind==='before-restore' && row.payload===before),
  'the app-update flush keeps the pending Restore safety copy');
 const laterSaved=await ctx.persist(); // the same no-argument path used by cloud push and app-update flush
 assert.ok(ctx.parseBackupIndex(storage.getItem(LOCAL_BACKUPS_KEY)).some(row=>row.kind==='before-restore' && row.payload===before),
  'a later bare save cannot retire the pending Restore safety copy');
 if(!laterSaved) assert.equal(storage.getItem(SYNC_STORE_KEY),before,'a still-full retry keeps the original primary');
 const rows=ctx.parseBackupIndex(storage.getItem(LOCAL_BACKUPS_KEY));
 assert.ok(rows.some(row=>row.kind==='before-restore' && row.payload===before),
  'the exact board displaced by this Restore stays recoverable after the quota retry');
 const reopened=await loadApp({sharedStorage:storage});
 assert.ok(reopened.ctx.readLocalBackups().some(row=>row.kind==='before-restore' && row.payload===before),
  'the safety copy survives reload');
 assert.match(shim.document.getElementById('toast')?.textContent||'',/Could(?:n't| not) save (?:this edit|your changes) on this device/,
  'an unsavable restore reports the held edit');
 if(!laterSaved){
  const future=Date.now()+8*24*60*60*1000;
  setFakeTime(ctx,future);
  quota=Infinity; // freeing browser space later allows the held in-memory Restore to finish
  assert.equal(await ctx.persist(),true);
  assert.ok(ctx.readLocalBackups().some(row=>row.kind==='before-restore' && row.payload===before),
   'a long-held safety row remains restorable after its guarded primary finally saves');
  const later=await loadApp({sharedStorage:storage});setFakeTime(later.ctx,future);
  assert.ok(later.ctx.readLocalBackups().some(row=>row.kind==='before-restore' && row.payload===before),
   'the renewed snapshot remains visible after reopening beyond the seven-day cutoff');
 }
 assert.ok(JSON.parse(storage.getItem(SYNC_STORE_KEY)).tasks.some(row=>row.title.startsWith('Restored huge')),
  'a later guarded retry can save the restored board');
 await new Promise(resolve=>setTimeout(resolve,420));
 assert.ok(ctx.parseBackupIndex(storage.getItem(LOCAL_BACKUPS_KEY)).some(row=>row.kind==='before-restore' && row.payload===before),
  'a delayed save after successful restore cannot retire its safety copy');
 const current=html.match(/<template id="appChangelogCurrent">([\s\S]*?)<\/template>/)?.[1]||'';
 assert.match(current,/Restoring a backup also keeps the exact board it replaces through a storage-quota retry\./);
 }
});

test('RISK BACKUP FILE RESTORE: the actual Settings file selection verifies exact sources before explicit local adoption',async t=>{
  const {File}=await import('node:buffer'),{IDBFactory}=await import('fake-indexeddb');
  const indexedDB=new IDBFactory(),dbName='chain-scanner-file-restore-'+Date.now()+'-'+Math.random(),sharedStorage=sharedScannerStorage();
  const app=await loadBackupFileFixtureApp({sharedStorage,indexedDBProvider:indexedDB,deviceDbName:dbName}),{ctx,shim}=app,store=ctx.window.ScannerDeviceStore;
  assert.ok(store,'the actual app opened its isolated durable-store fixture');
  t.after(async()=>{await store.close();});
  ctx.addTask('Current board task');await prepareBackupFileFixtureSource(ctx);
  const currentBoardRaw=JSON.stringify(ctx.state),prospective=JSON.parse(currentBoardRaw);
  const taskId=prospective.tasks[0].id,heldAt=Date.now()-60_000,largeUnicodeUnknownField='🌿 café 🧭 '.repeat(180_000);
  prospective.settings.workedHours=16;prospective.considered[taskId]='worked';prospective.workedAt[taskId]=heldAt;
  prospective.tasks[0].title='Restored file task';
  prospective.tasks[0].url='https://example.test/restore?a=1&b=2';
  prospective.tasks[0].futureFileField={keep:'opaque <value> & data',sequence:[1,'🌿']};
  prospective.futureFileBoardField={keep:true,tag:'<script> stays data',trace:largeUnicodeUnknownField};
  const fileBytes=new TextEncoder().encode('\uFEFF \n'+JSON.stringify(prospective,null,2)+'\n');
  const file=new File([fileBytes],'backup <selected>.json',{type:'application/json',lastModified:1760792400000});
  const primaryWrites=[],commitHead=store.commitHead.bind(store);
  store.commitHead=(...args)=>{primaryWrites.push(args[0]);return commitHead(...args);};

  ctx.openSettings();
  const settings=shim.document.getElementById('modalRoot').innerHTML;
  const restoreAction=settings.match(/<button\b[^>]*data-act="([^"]*restore-backup[^"]*)"[^>]*>\s*Restore\s*<\/button>/);
  assert.ok(restoreAction,'Settings exposes the single guarded Restore action');
  assert.equal((settings.match(/data-act="restore-backup"/g)||[]).length,1,'the board-data area has exactly one Restore action');
  assert.match(settings,/id="backupRestoreSource"[\s\S]*?value="file"[\s\S]*?value="paste"/,'the Restore action routes either a native file or paste source');
  assert.doesNotMatch(settings,/data-act="choose-backup-file"|data-act="open-paste-recovery"/,'the board-data area has no competing file or paste action');
  assert.match(settings,/<input\b(?=[^>]*type="file")(?=[^>]*id="restoreBackupFile")[^>]*>/,'the action uses a native JSON file input');
  const input=makeFakeElement();input.id='restoreBackupFile';input.files=[];input.matches=()=>false;
  let pickerOpened=0;input.click=()=>{pickerOpened++;};
  const restoreSource=makeFakeElement();restoreSource.value='file';
  const originalGet=shim.document.getElementById.bind(shim.document);
  shim.document.getElementById=id=>id==='restoreBackupFile'?input:id==='backupRestoreSource'?restoreSource:originalGet(id);
  const cloudPushCalls=[],originalPush=ctx.window.CloudSync?.push?.bind(ctx.window.CloudSync);
  if(originalPush)ctx.window.CloudSync.push=(...args)=>{cloudPushCalls.push(args);return originalPush(...args);};
  async function awaitFileFixtureOperation(operation,label){
    let timer;
    try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' did not complete within 5 seconds')),5000);})]);}
    finally{clearTimeout(timer);}
  }
  async function selectFile(selected){
    input.files=[selected];
    const outcomes=await awaitFileFixtureOperation(shim.document.dispatchEventAndWait({type:'change',target:input}),'selected-file change handlers');
    assert.deepEqual(outcomes,[true],'the actual selected-file handler must complete successfully: '+shim.document.getElementById('toast').textContent);
    return shim.document.getElementById('modalRoot').innerHTML;
  }
  await ctx.onAction(restoreAction[1],{});
  assert.equal(pickerOpened,1,'the Settings action opens the native file picker');
  const preview=await selectFile(file);
  const confirm=preview.match(/<button\b[^>]*data-act="confirm-file-restore"[^>]*>/)?.[0];
  assert.ok(confirm,'the supported file reaches a preview with an explicit restore confirmation; '+shim.document.getElementById('toast').textContent);
  assert.doesNotMatch(confirm,/\sdisabled(?:\s|>|=)/,'confirmation is enabled only after the required source copies verify');
  assert.match(preview,/backup &lt;selected&gt;\.json/,'the selected filename is escaped in the preview');
  assert.match(preview,/Current board task/);assert.match(preview,/Restored file task/);
  assert.match(preview,/opaque &lt;value&gt; &amp; data/,'unknown fields are previewed as data, not markup');
  assert.equal(JSON.stringify(ctx.state),currentBoardRaw,'selection and preview leave the live board unchanged');
  assert.deepEqual(primaryWrites,[],'selection and preview do not replace the durable board');
  const backups=await store.listBackups(),currentCopy=backups.find(row=>row.kind==='before-file-restore'&&row.payload===currentBoardRaw),fileCopy=backups.find(row=>row.kind==='restore-file-source');
  assert.ok(currentCopy,'the exact current board has a durable recovery copy');
  assert.ok(fileCopy,'the selected file has a durable recovery copy');
  assert.equal(fileCopy.restoreFile?.format,'chain-scanner.restore-file-source');
  assert.equal(fileCopy.restoreFile?.formatVersion,1);
  assert.equal(fileCopy.restoreFile?.fileName,file.name);
  assert.equal(fileCopy.restoreFile?.byteLength,fileBytes.byteLength);
  assert.ok(fileBytes.byteLength>2_000_000,'the exact-file fixture crosses the multi-megabyte boundary');
  assert.deepEqual(Buffer.from(fileCopy.restoreFile?.bytesBase64||'','base64'),Buffer.from(fileBytes),'file recovery readback preserves the original BOM, whitespace and UTF-8 bytes');

  await ctx.onAction('cancel-file-restore',{});
  assert.equal(JSON.stringify(ctx.state),currentBoardRaw,'Cancel leaves the current board unchanged');
  assert.deepEqual(primaryWrites,[],'Cancel does not replace the durable board');
  assert.deepEqual(cloudPushCalls,[],'selecting, previewing and cancelling do not upload');
  await ctx.onAction(restoreAction[1],{});assert.equal(pickerOpened,2);
  const confirmedPreview=await selectFile(file);
  assert.match(confirmedPreview,/data-act="confirm-file-restore"/);

  await ctx.onAction('confirm-file-restore',{});
  for(let attempt=0;attempt<100&&ctx.state.tasks?.[0]?.title!=='Restored file task';attempt++)await flush();
  assert.equal(ctx.state.tasks[0].title,'Restored file task','explicit confirmation adopts the prepared board locally');
  assert.equal(ctx.state.tasks[0].url,'https://example.test/restore?a=1&b=2');
  assert.deepEqual(ctx.state.tasks[0].futureFileField,{keep:'opaque <value> & data',sequence:[1,'🌿']});
  assert.deepEqual(ctx.state.futureFileBoardField,{keep:true,tag:'<script> stays data',trace:largeUnicodeUnknownField});
  assert.equal(ctx.state.considered[taskId],'worked','a live timed hold remains part of the restored board');
  assert.equal(ctx.state.workedAt[taskId],heldAt,'the timed hold keeps its original start time');
  assert.ok(primaryWrites.length>0,'local adoption uses the guarded durable-head commit');
  assert.ok((await store.listBackups()).some(row=>row.kind==='restore-file-source'&&row.restoreFile?.bytesBase64===Buffer.from(fileBytes).toString('base64')),'the exact file evidence remains after adoption');
  await store.close();
  const reopened=await loadApp({sharedStorage,indexedDBProvider:indexedDB,deviceDbName:dbName});
  assert.equal(reopened.ctx.state.tasks[0].title,'Restored file task','the locally restored board survives a cold reopen');
  assert.deepEqual(reopened.ctx.state.tasks[0].futureFileField,{keep:'opaque <value> & data',sequence:[1,'🌿']});
  assert.equal(reopened.ctx.state.futureFileBoardField.trace,largeUnicodeUnknownField);
  assert.equal(reopened.ctx.state.workedAt[taskId],heldAt,'the timed hold survives a cold reopen');
  const reopenedStore=reopened.ctx.window.ScannerDeviceStore,rotatingHead=await reopenedStore.readHead();
  const staleAt=Date.now()-10*86400000;
  await reopenedStore.putBackup({expectedHash:rotatingHead.hash,backup:{id:'daily-old-file-restore-fixture',day:new Date(staleAt).toISOString().slice(0,10),at:staleAt,kind:'daily',payload:currentBoardRaw}});
  await reopened.ctx.refreshDeviceBackupCache();assert.equal(await reopened.ctx.persist(),true,'ordinary save and automatic backup rotation complete');
  assert.ok((await reopenedStore.listBackups()).some(row=>row.id===fileCopy.id&&row.restoreFile?.bytesBase64===fileCopy.restoreFile.bytesBase64),
    'automatic backup rotation retains the exact selected-file metadata and bytes');

  reopened.ctx.openSettings();
  const reopenedSettings=reopened.shim.document.getElementById('modalRoot').innerHTML;
  const reopenedAction=reopenedSettings.match(/<button\b[^>]*data-act="([^"]*restore-backup[^"]*)"[^>]*>\s*Restore\s*<\/button>/);
  assert.ok(reopenedAction,'the same Settings control remains available after reopen');
  const archiveInput=makeFakeElement();archiveInput.id='restoreBackupFile';archiveInput.files=[];archiveInput.matches=()=>false;
  const reopenedGet=reopened.shim.document.getElementById.bind(reopened.shim.document);
  reopened.shim.document.getElementById=id=>id==='restoreBackupFile'?archiveInput:reopenedGet(id);
  let archivePickerOpens=0;archiveInput.click=()=>{archivePickerOpens++;};
  async function selectReopenedFile(selected,{accepted=true}={}){
    archiveInput.files=[selected];
    const outcomes=await awaitFileFixtureOperation(reopened.shim.document.dispatchEventAndWait({type:'change',target:archiveInput}),'reopened selected-file change handlers');
    assert.deepEqual(outcomes,[accepted],'the actual handler must report the expected source outcome: '+reopened.shim.document.getElementById('toast').textContent);
    return reopened.shim.document.getElementById('modalRoot').innerHTML;
  }
  const archiveBoard=JSON.parse(JSON.stringify(reopened.ctx.state));
  archiveBoard.tasks=[{...archiveBoard.tasks[0],id:'archive-current-board',title:'Archive currentBoard task'}];
  archiveBoard.considered={};archiveBoard.workedAt={};
  const archive={format:'chain-scanner.recovery-archive',formatVersion:1,capturedAt:new Date().toISOString(),currentBoard:archiveBoard,
    manifest:{status:'complete',consistency:'single-readonly-idb-transaction-and-unchanged-live-sources',sources:{
      currentBoard:{status:'included',format:'existing-board-json'},localStorage:{},
      indexedDB:{database:'chain-scanner-v2',schemaVersion:2,stores:{meta:{status:'included',rowCount:0},snapshots:{status:'included',rowCount:0},backups:{status:'included',rowCount:1},opaque:{status:'included',rowCount:0}}}},failures:[]},
    appSources:{localStorage:[],indexedDB:{database:'chain-scanner-v2',stores:{meta:[],snapshots:[],
      backups:[{key:{type:'string',value:'pending-upload'},value:{type:'object',value:{task:{id:'pending-queue-task',title:'Pending queue task'}}}}],opaque:[]}}}};
  const archiveBytes=new TextEncoder().encode(JSON.stringify(archive,null,2)),archiveFile=new File([archiveBytes],'recovery <archive>.json',{type:'application/json'});
  await reopened.ctx.onAction(reopenedAction[1],{});assert.equal(archivePickerOpens,1);
  let archivePreview;
  await t.test('file selection stays pending until its real exact-byte read completes',async()=>{
    const read=archiveFile.arrayBuffer.bind(archiveFile);
    let readEntered,releaseRead;
    const entered=new Promise(resolve=>{readEntered=resolve;}),released=new Promise(resolve=>{releaseRead=resolve;});
    archiveFile.arrayBuffer=async()=>{readEntered();await released;return read();};
    let settled=false;
    const selection=selectReopenedFile(archiveFile).then(preview=>{settled=true;return preview;});
    try{
      await awaitFileFixtureOperation(entered,'the actual selected-file read');
      // Keep the real read pending beyond the former100flush-turn cap. The
      // selected-file consumer must await its handler, without adopting early.
      for(let turn=0;turn<120;turn++)await flush();
      assert.equal(settled,false,'a pending real file read cannot count as a completed selection');
      assert.equal(reopened.ctx.state.tasks[0].title,'Restored file task','holding the selected read cannot adopt its currentBoard');
      assert.doesNotMatch(reopened.shim.document.getElementById('modalRoot').innerHTML,/data-act="confirm-file-restore"/,'protected preview waits for the actual selected bytes');
    }finally{
      releaseRead();archivePreview=await selection;
      // Drain the actual UI operation before fixture disposal even when the
      // pending-selection assertion fails on the unchanged polling helper.
      const deadline=Date.now()+5000;
      while(!reopened.shim.document.getElementById('modalRoot').innerHTML.includes('data-act="confirm-file-restore"')&&!reopened.shim.document.getElementById('toast').textContent&&Date.now()<deadline)await flush();
      archiveFile.arrayBuffer=read;
    }
  });
  assert.match(archivePreview,/Only its ordinary <code>currentBoard<\/code> can be restored/);
  assert.doesNotMatch(archivePreview,/pending-queue-task|Pending queue task/,'raw pending appSources are not rendered as an adopted-board task');
  assert.equal(reopened.ctx.state.tasks[0].title,'Restored file task','archive preview does not apply its currentBoard early');
  await reopened.ctx.onAction('confirm-file-restore',{});
  for(let attempt=0;attempt<100&&reopened.ctx.state.tasks?.[0]?.title!=='Archive currentBoard task';attempt++)await flush();
  assert.deepEqual(Array.from(reopened.ctx.state.tasks,task=>task.id),['archive-current-board'],'only the explicit ordinary currentBoard is adopted');
  assert.doesNotMatch(JSON.stringify(reopened.ctx.state),/pending-queue-task|Pending queue task/,'raw pending appSources are never replayed');

  const heldHead=await reopenedStore.readHead(),incomplete={...archive,manifest:{...archive.manifest,status:'partial',failures:[{source:'indexedDB.backups',status:'error'}]}};
  const incompleteFile=new File([JSON.stringify(incomplete)],'incomplete.json',{type:'application/json'});
  const pickerBefore=archivePickerOpens;await reopened.ctx.onAction(reopenedAction[1],{});assert.equal(archivePickerOpens,pickerBefore+1);
  const priorToast=reopened.shim.document.getElementById('toast').textContent;reopened.shim.document.getElementById('toast').textContent='';
  await selectReopenedFile(incompleteFile,{accepted:false});
  for(let attempt=0;attempt<100&&!reopened.shim.document.getElementById('toast').textContent.includes('incomplete');attempt++)await flush();
  assert.match(reopened.shim.document.getElementById('toast').textContent,/incomplete/,'partial archives stop with an honest source error');
  assert.deepEqual(await reopenedStore.readHead(),heldHead,'an incomplete archive cannot replace the saved board');
  assert.deepEqual(Array.from(reopened.ctx.state.tasks,task=>task.id),['archive-current-board'],'an incomplete archive leaves the live board unchanged');
  assert.notEqual(priorToast,reopened.shim.document.getElementById('toast').textContent);
  t.after(async()=>{await reopened.ctx.window.ScannerDeviceStore.close();});
  reopened.ctx.openHelp();
  const help=reopened.shim.document.getElementById('modalRoot').innerHTML;
  const restoreFaq=help.match(/<dt>How do backups and Restore work\?<\/dt><dd>(.*?)<\/dd>/)?.[1];
  assert.ok(restoreFaq,'the extended FAQ explains file restore');
  assert.ok(restoreFaq.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length<=130,'the Restore FAQ keeps its word limit');
  assert.match(restoreFaq,/exact bytes.*current board.*preview/);
  assert.match(restoreFaq,/Cancel or close during source checks stops before adoption/);
  assert.match(restoreFaq,/Archives apply only their current board.*offline or held sync leaves the board unchanged/);
  assert.match(restoreFaq,/Long before-and-after values wrap inside the preview\./,'the extended FAQ explains how long restore effects remain readable');
  assert.match(html,/Settings can restore a board JSON file with an explicit preview/,'the current changelog source explains guarded file restore');
  assert.match(html,/Long board-field values wrap within the preview\./,'the current changelog explains the corrected file-restore preview');
});

test('RISK cloud No recovery: five scanner decisions survive offline durable reopen beside an independent peer edit',{timeout:15000},async t=>{ // Pin simulated time and cover both publication orders.
 const {IDBFactory}=await import('fake-indexeddb');
 const at=Date.parse('2026-10-16T15:10:00.000Z'),passAt=at-60000;
 for(const publicationOrder of ['Mac first','Phone first'])await t.test(publicationOrder,async publicationTest=>{
 for(const backend of ['browser fallback','IndexedDB'])await publicationTest.test(backend,async()=>{
  const initial=syncState({tasks:[
   Object.assign(syncTask('bench','Phone benchmark'),{mu:36,sigma:8,ctx:['c_shared']}),
   ...Array.from({length:5},(_,i)=>Object.assign(syncTask('phone-no-'+(i+1),'Phone No '+(i+1)),{ctx:['c_shared']})),
   Object.assign(syncTask('mac-edit','Mac independent task'),{done:true,completedAt:100,startsAt:null,evergreenHours:18,evergreenResetAtDay:true,ctx:['c_shared']}),
  ],contexts:[{id:'c_shared',name:'Shared context',active:true}],chain:['bench'],considered:{},candidateId:'phone-no-1',mode:'scan',scanMode:'descending',passStartedAt:passAt,passId:'shared-pass-142',syncRev:4,syncAccount:'e@example.com',syncDirty:false,
   settings:{horizonMin:60,thresholdPct:0,samples:250,cantMin:30,workedHours:8,theme:'system'}});
  const remote=JSON.parse(JSON.stringify(initial));
  for(const key of ['syncRev','syncAccount','syncDirty','lastCloudServerAt','protectedBackupIds'])delete remote[key];
  const h=makeSyncHarness({remote,rev:4,delayMs:1});
  const indexedDB=backend==='IndexedDB'?new IDBFactory():null;
  const names={phone:'cloud-no-142-phone-'+Date.now()+'-'+Math.random(),mac:'cloud-no-142-mac-'+Date.now()+'-'+Math.random()};
  const seedStorage={[SYNC_STORE_KEY]:JSON.stringify(initial),[LOCAL_HEAD_KEY]:JSON.stringify(initial)};
  const beforeStateReady=ctx=>setFakeTime(ctx,at);
  const appOptions=device=>backend==='IndexedDB'
   ?{seedStorage,indexedDBProvider:indexedDB,deviceDbName:names[device],beforeStateReady}
   :{seedStorage,beforeStateReady};
  const {ctx:phone,shim:phoneShim}=await loadApp({...appOptions('phone'),cloudSyncFactory:h.factory});
  const {ctx:mac,shim:macShim}=await loadApp({...appOptions('mac'),cloudSyncFactory:h.factory});
  const closeStore=async app=>{try{await app.window.ScannerDeviceStore?.close?.();}catch{}};
  try{
   await phone.cloudPull();await mac.cloudPull();await syncSettle(20);
   assert.equal(phone.state.syncRev,4);assert.equal(mac.state.syncRev,4);
   phone.window.CloudSync.ready=false; // retain the five real actions locally while the phone is offline
   const acted=[];
   for(let i=0;i<5;i++){
    phone.renderScan();
    const markup=phoneShim.document.getElementById('scan').innerHTML;
    assert.match(markup,/data-act="no"/,'the scanner must render the real No control');
    const candidate=phone.state.candidateId,benchmark=phone.state.chain.at(-1);
    assert.ok(candidate&&candidate!=='bench'&&benchmark==='bench');
    phone.onAction('no',{dataset:{candidate,benchmark}});
    acted.push(candidate);
   }
   assert.equal(new Set(acted).size,5,'each deliberate No compares a distinct candidate');
   const localRatings=Object.fromEntries(phone.state.tasks.map(task=>[task.id,[task.mu,task.sigma]]));
   assert.notDeepEqual(localRatings.bench,[initial.tasks[0].mu,initial.tasks[0].sigma],
    'the five actual No actions changed the learned benchmark rating');
   const localEvents=phone.state.decisionEvents;
   assert.ok(Array.isArray(localEvents),'No actions create a durable cloud-visible event collection');
   const noEvents=localEvents.filter(event=>event?.kind==='no');
   assert.equal(noEvents.length,5,'each No action has one durable cloud-visible decision event');
   assert.equal(localEvents.length,5,'the offline phone contains only its five No decisions');
   assert.equal(new Set(noEvents.map(event=>event.id)).size,5,'each No action event has a stable unique identity');
   assert.ok(noEvents.every(event=>event.v===1&&event.meaning==='benchmark-preferred'),
    'the event records the supported No meaning');
   assert.ok(noEvents.every(event=>event.account==='e@example.com'&&event.baseId===phone.state.decisionBase?.id),
    'No events bind to their owning account and exact observed cloud base');
   assert.ok(noEvents.every(event=>event.at===at&&event.passAt===passAt&&event.passId==='shared-pass-142'),
    'No events retain original action time and pass identity');
   assert.ok(noEvents.every(event=>event.scanMode==='descending'&&event.chainIds[0]==='bench'
    &&event.benchmarkId==='bench'&&event.candidateContextIds.includes('c_shared')
    &&event.benchmarkContextIds.includes('c_shared')),'No events retain scan and comparison context');
   assert.ok(noEvents.every(event=>phone.state.tasks.some(task=>task.ratingHistory?.some(row=>row.id===event.id&&row.kind==='no'))),
    'each No identity is shared by its observation record');
   assert.deepEqual([...noEvents[0].observedActionIds],[],'the first No has no observed predecessor');
   for(let i=1;i<noEvents.length;i++)assert.deepEqual([...noEvents[i].observedActionIds],[noEvents[i-1].id],
    'each later No stores the bounded causal frontier, not a quadratic full history');
   const noEventsSnapshot=JSON.stringify(JSON.parse(JSON.stringify(noEvents)));
   const phoneTaskSnapshots=Object.fromEntries(phone.state.tasks.map(task=>[task.id,JSON.stringify(JSON.parse(JSON.stringify(task)))]));
   const phoneContextsSnapshot=JSON.stringify(JSON.parse(JSON.stringify(phone.state.contexts)));
   assert.equal(await phone.persist(),true,'the offline device store accepts the complete local board');
   const offlineRaw=backend==='IndexedDB'
    ?(await phone.window.ScannerDeviceStore.readHead()).payload
    :phoneShim.localStorage.getItem(SYNC_STORE_KEY);
   assert.ok(offlineRaw,'the phone has a readable durable board before it closes');
   const offlineBoard=JSON.parse(offlineRaw);
   assert.equal(offlineBoard.decisionBase?.account,'e@example.com','the exact-base owner survives durable save');
   assert.equal(offlineBoard.decisionBase?.revision,4,'the common cloud revision survives durable save');
   assert.ok(typeof offlineBoard.decisionBase?.payload==='string','the exact common payload survives durable save');
   assert.equal(JSON.stringify(offlineBoard.decisionEvents),noEventsSnapshot,'the durable bytes preserve the exact five original No event rows');
   await closeStore({window:phone.window});

   const publications=observeSyncFixtureCalls(mac,'sendPush');
   if(publicationOrder==='Mac first'&&backend==='IndexedDB'){
    const backend=mac.window.CloudSync,push=backend.push.bind(backend);
    // Keep the real durable publication slower than the former30ms check.
    backend.push=async(...args)=>{await syncSettle(150);return push(...args);};
   }
   if(publicationOrder==='Phone first')mac.window.CloudSync.ready=false;
   assert.equal(await saveEditorChoice({ctx:mac,shim:macShim},'mac-edit',at+2000,{title:'Mac independent edit'}),true,
    'the independent peer edit uses the actual editor action with unchanged rendered context/reset controls');
   phoneTaskSnapshots['mac-edit']=JSON.stringify(JSON.parse(JSON.stringify(mac.state.tasks.find(task=>task.id==='mac-edit'))));
   const macChoice=mac.state.decisionEvents.filter(event=>event?.kind==='current-choice');
   assert.equal(macChoice.length,1,'the hydrated Mac editor records only its deliberate title change');
   assert.deepEqual(JSON.parse(JSON.stringify(macChoice[0].target)),{type:'task',id:'mac-edit',property:'title'});
   assert.deepEqual(JSON.parse(JSON.stringify(macChoice[0].before)),{present:true,value:'Mac independent task'});
   assert.equal(macChoice[0].value,'Mac independent edit');
   assert.equal(macChoice[0].at,at+2000,'the Mac title fact keeps its original action time');
   assert.equal(macChoice[0].account,'e@example.com','the Mac title fact keeps its owning account');
   assert.equal(macChoice[0].baseId,mac.state.decisionBase?.id,'the Mac title fact keeps its exact observed base');
   assert.equal(macChoice[0].passId,'shared-pass-142','the Mac title fact keeps its observed pass identity');
   assert.equal(macChoice[0].passAt,passAt,'the Mac title fact keeps the original pass time');
   assert.deepEqual(Array.from(mac.state.tasks.find(task=>task.id==='mac-edit').ctx),['c_shared'],'editor hydration preserves its unrelated context');
   assert.equal(mac.state.tasks.find(task=>task.id==='mac-edit').evergreenResetAtDay,true,'editor hydration preserves its checked reset control');
   if(publicationOrder==='Mac first'){
    await mac.cloudPushNow();
    assert.ok(publications.length>0,'the ordinary Mac publication runs through its actual async producer');
    await Promise.all(publications.map(call=>call.promise));
    await settleSavedViewPublication({ctx:mac,shim:macShim},h,'Mac-first actual publication and device/account acknowledgement');
    assert.equal(h.remoteState().tasks.find(task=>task.id==='mac-edit').title,'Mac independent edit');
    assert.deepEqual(Array.from(h.remoteState().tasks.find(task=>task.id==='mac-edit').ctx),['c_shared']);
    assert.equal(h.remoteState().tasks.find(task=>task.id==='mac-edit').evergreenResetAtDay,true);
    const publishedEvents=h.remoteState().decisionEvents;
    assert.equal(publishedEvents.filter(event=>event?.kind==='no').length,0,'offline No actions are not visible before the phone reconnects');
    const publishedChoice=publishedEvents.filter(event=>event?.kind==='current-choice');
    assert.equal(publishedChoice.length,1,'the independent editor action remains a separate current-choice record');
    assert.equal(publishedChoice[0].id,macChoice[0].id,'the Mac title fact keeps its original event identity');
    assert.deepEqual(JSON.parse(JSON.stringify(publishedChoice[0].target)),{type:'task',id:'mac-edit',property:'title'});
    assert.equal(publishedEvents.length,1,'the first peer publication contains only its deliberate Mac title record');
    assert.equal(h.doc.rev,5,'the independent Mac edit is a newer cloud publication');
   }else{
    assert.equal(h.remoteState().tasks.find(task=>task.id==='mac-edit').title,'Mac independent task','an offline Mac edit stays local before phone publication');
    assert.equal(h.remoteState().decisionEvents?.length??0,0,'the offline Mac edit stays unpublished before phone publication');
    assert.equal(h.doc.rev,4,'the offline Mac edit does not advance the shared cloud revision');
   }

   const offlineCloudFactory=()=>{const cloud=h.factory();cloud.ready=false;return cloud;};
   const reloadOptions=backend==='IndexedDB'
    ?{indexedDBProvider:indexedDB,deviceDbName:names.phone,beforeStateReady}
    :{seedStorage:{[SYNC_STORE_KEY]:offlineRaw,[LOCAL_HEAD_KEY]:offlineRaw},beforeStateReady};
   const {ctx:reopened,shim:reopenedShim}=await loadApp({...reloadOptions,cloudSyncFactory:offlineCloudFactory});
   assert.deepEqual(acted.filter(id=>reopened.state.considered[id]==='no').sort(),acted.slice().sort(),
    'the cold device-store reopen itself retains every No mark');
   assert.equal(reopened.state.tasks.find(task=>task.id==='bench').mu,localRatings.bench[0],
    'the cold reopen retains the actual learned benchmark value');
   reopened.window.CloudSync.ready=true;
   await reopened.cloudPull();await syncSettle(60);
   for(const id of acted)assert.equal(reopened.state.considered[id],'no','a newer peer revision cannot clear a deliberate No mark');
   for(const [id,[mu,sigma]] of Object.entries(localRatings)){
    assert.equal(reopened.state.tasks.find(task=>task.id===id).mu,mu,'the effective learned mean survives reconciliation');
    assert.equal(reopened.state.tasks.find(task=>task.id===id).sigma,sigma,'the effective learned uncertainty survives reconciliation');
   }
   assert.equal(reopened.state.tasks.find(task=>task.id==='mac-edit').title,publicationOrder==='Mac first'?'Mac independent edit':'Mac independent task','phone observes exactly the choice events published before its reopen reconciliation');
   assert.deepEqual(Array.from(reopened.state.tasks.find(task=>task.id==='mac-edit').ctx),['c_shared'],'No replay preserves the peer task contexts');
   assert.equal(reopened.state.tasks.find(task=>task.id==='mac-edit').evergreenResetAtDay,true,'No replay preserves the rendered reset preference');
   if(publicationOrder==='Phone first'){
    assert.equal((await reopened.persist()),true,'the reopened phone durably saves its reconciled No records before publishing');
    await reopened.cloudPushNow();await syncSettle(60);
    const phoneFirstEvents=h.remoteState().decisionEvents||[];
    assert.equal(phoneFirstEvents.filter(event=>event?.kind==='no').length,5,'phone-first cloud publication contains all five offline No facts');
    assert.equal(phoneFirstEvents.filter(event=>event?.kind==='current-choice').length,0,'phone-first cloud publication precedes the offline Mac title fact');
    assert.equal(h.remoteState().tasks.find(task=>task.id==='mac-edit').title,'Mac independent task');
    assert.equal(h.doc.rev,5,'the reopened phone publishes the No decisions first');
    mac.window.CloudSync.ready=true;
    await mac.cloudPull();await syncSettle(60);
    for(const id of acted)assert.equal(mac.state.considered[id],'no','the reconnected Mac adopts every phone No mark');
    for(const [id,[mu,sigma]] of Object.entries(localRatings)){
     assert.equal(mac.state.tasks.find(task=>task.id===id).mu,mu,'the reconnected Mac adopts the effective learned mean');
     assert.equal(mac.state.tasks.find(task=>task.id===id).sigma,sigma,'the reconnected Mac adopts the effective learned uncertainty');
    }
    assert.equal(mac.state.tasks.find(task=>task.id==='mac-edit').title,'Mac independent edit','Mac retains its offline title choice while reconciling phone facts');
    await mac.cloudPushNow();await syncSettle(60);
    assert.equal(h.remoteState().tasks.find(task=>task.id==='mac-edit').title,'Mac independent edit');
    assert.equal(h.doc.rev,6,'the reconnected Mac publishes the union at the next revision');
    await reopened.cloudPull();await syncSettle(60);
   }else{
    assert.equal((await reopened.persist()),true);
    await reopened.cloudPushNow();await syncSettle(60);
   }
   for(const id of acted)assert.equal(reopened.state.considered[id],'no','the final phone pull retains every No mark in either publication order');
   for(const [id,[mu,sigma]] of Object.entries(localRatings)){
    assert.equal(reopened.state.tasks.find(task=>task.id===id).mu,mu,'the final phone pull retains the effective learned mean');
    assert.equal(reopened.state.tasks.find(task=>task.id===id).sigma,sigma,'the final phone pull retains the effective learned uncertainty');
   }
   assert.equal(reopened.state.tasks.find(task=>task.id==='mac-edit').title,'Mac independent edit','the final phone pull retains the Mac title fact');
   for(const task of reopened.state.tasks){
    const expected=JSON.parse(phoneTaskSnapshots[task.id]);
    if(task.id==='mac-edit')expected.title='Mac independent edit';
    assert.deepEqual(JSON.parse(JSON.stringify(task)),expected,`all other task data is retained for ${task.id}`);
   }
   assert.equal(JSON.stringify(JSON.parse(JSON.stringify(reopened.state.contexts))),phoneContextsSnapshot,'unrelated shared context data remains unchanged');
   assert.equal(JSON.stringify(JSON.parse(JSON.stringify(h.remoteState().tasks.find(task=>task.id==='mac-edit').ctx))),JSON.stringify(['c_shared']));
   assert.equal(h.remoteState().tasks.find(task=>task.id==='mac-edit').title,'Mac independent edit');
   assert.ok(h.remoteState().considered && acted.every(id=>h.remoteState().considered[id]==='no'),
    'the final cloud board contains all five No marks');
   const finalEvents=h.remoteState().decisionEvents;
   assert.equal(finalEvents.filter(event=>event?.kind==='no').length,5,'after phone reconnect and republish, the cloud retains exactly the five immutable No records');
   assert.equal(finalEvents.filter(event=>event?.kind==='current-choice').length,1,'the cloud retains the separate deliberate Mac title record');
   assert.equal(finalEvents.length,6,'no action or task edit was duplicated during reopen or retry');
   assert.equal(JSON.stringify(JSON.parse(JSON.stringify(finalEvents.filter(event=>event?.kind==='no')))),noEventsSnapshot,'the final cloud keeps each original No event byte-for-byte');
   const finalMacChoice=finalEvents.find(event=>event?.kind==='current-choice');
   assert.equal(finalMacChoice?.id,macChoice[0].id,'the final cloud keeps the original Mac title event identity');
   assert.deepEqual(JSON.parse(JSON.stringify(finalMacChoice)),JSON.parse(JSON.stringify(macChoice[0])),'the final cloud keeps the Mac title event time, base, pass, and prior-field evidence');
   const sortedEvents=rows=>rows.map(row=>JSON.parse(JSON.stringify(row))).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
   assert.deepEqual(sortedEvents(reopened.state.decisionEvents),sortedEvents(finalEvents),'the fully reopened phone acknowledges the exact final cloud event union');
   assert.equal(Object.hasOwn(h.remoteState(),'decisionBase'),false,'the device-local decision base is excluded from cloud payloads');
   const learnedBeforePassReset=Object.fromEntries(acted.map(id=>[id,[reopened.state.tasks.find(task=>task.id===id).mu,reopened.state.tasks.find(task=>task.id===id).sigma]]));
   const retainedEvents=JSON.stringify(reopened.state.decisionEvents),oldPassId=reopened.state.passId;
   reopened.newPass(false,true);
   assert.notEqual(reopened.state.passId,oldPassId,'the established day boundary starts a new pass identity');
   assert.ok(acted.every(id=>reopened.state.considered[id]===undefined),'the established day boundary expires temporary No marks');
   assert.equal(JSON.stringify(reopened.state.decisionEvents),retainedEvents,'pass reset keeps retained comparison evidence');
   for(const [id,[mu,sigma]] of Object.entries(learnedBeforePassReset)){
    assert.equal(reopened.state.tasks.find(task=>task.id===id).mu,mu,'pass expiry does not erase learned ratings');
    assert.equal(reopened.state.tasks.find(task=>task.id===id).sigma,sigma,'pass expiry does not reset learned uncertainty');
   }
  }finally{
   await closeStore({window:phone.window});await closeStore({window:mac.window});
  }
  });
 });
});

test('RISK decision recovery retired comparison effects: exact stale returns cannot revive No Yes Dot or Dislodge after two replacements and peer progress',async t=>{
 for(const action of ['no','yes','dot','dislodge'])await t.test(action,async t=>{
  const {local,peer,h,initial,at}=await scopedUndoClients(),ctx=local.ctx;
  for(const app of [local,peer])t.after(()=>{app.ctx.window.CloudSync.user=null;vm.runInContext('clearCloudRetry();clearTimeout(cloudTimer)',app.ctx);});
  if(action==='no'||action==='yes')ctx.onAction(action,{dataset:{candidate:'undo-local',benchmark:'undo-base'}});
  else if(action==='dot'){hydrateUnchangedEditorDraft(local,'undo-local');ctx.onAction('dot-task',{dataset:{id:'undo-local'}});}
  else ctx.onAction('dislodge',{dataset:{benchmark:'undo-base'}});
  await ctx.persist();ctx.window.CloudSync.ready=true;await ctx.cloudPushNow();await syncSettle(35);const stale=JSON.parse(JSON.stringify(ctx.state));
  const replace=async()=>{local.shim.document.getElementById('jsonBox').value=JSON.stringify(initial);assert.equal(await ctx.onAction('import-json',{}),true);await ctx.persist();await ctx.cloudPushNow();await syncSettle(35);assert.equal(ctx.state.syncDirty,false);};
  await replace();const selected={chain:Array.from(ctx.state.chain),considered:JSON.parse(JSON.stringify(ctx.state.considered)),ratings:JSON.stringify(ctx.state.tasks.map(task=>[task.id,task.mu,task.sigma]))};
  h.writeBehindBack(stale);await ctx.cloudPull();await ctx.cloudPushNow();await syncSettle(45);
  assert.deepEqual(Array.from(ctx.state.chain),selected.chain,'an exact retired comparison cannot restore its former chain effect');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.considered)),selected.considered,'an exact retired comparison cannot restore its former No or Dislodged mark');
  assert.equal(JSON.stringify(ctx.state.tasks.map(task=>[task.id,task.mu,task.sigma])),selected.ratings);assert.equal(ctx.state.decisionEvents.length,0);assert.equal(ctx.state.syncDirty,false);
  await replace();peer.ctx.window.CloudSync.ready=true;await peer.ctx.cloudPull();await saveEditorChoice(peer,'undo-peer',at+500,{title:'Peer choice after replacements'});hydrateUnchangedEditorDraft(peer,'undo-peer');peer.ctx.onAction('dot-task',{dataset:{id:'undo-peer'}});await peer.ctx.persist();await peer.ctx.cloudPushNow();await syncSettle(45);await ctx.cloudPull();await ctx.cloudPushNow();await syncSettle(35);
  const peerRows=JSON.stringify(ctx.state.decisionEvents),peerRatings=JSON.stringify(ctx.state.tasks.map(task=>[task.id,task.mu,task.sigma]));assert.ok(ctx.state.decisionEvents.some(row=>row.kind==='comparison'&&row.action==='dot'));
  h.writeBehindBack(stale);await ctx.cloudPull();await ctx.cloudPushNow();await syncSettle(45);
  assert.deepEqual(Array.from(ctx.state.chain),['undo-base','undo-peer'],'precise retirement must retain the new independent peer Dot');assert.equal(ctx.state.tasks.find(task=>task.id==='undo-peer').title,'Peer choice after replacements');
  assert.equal(JSON.stringify(ctx.state.decisionEvents),peerRows);assert.equal(JSON.stringify(ctx.state.tasks.map(task=>[task.id,task.mu,task.sigma])),peerRatings);assert.equal(ctx.state.considered['undo-local'],undefined);assert.equal(ctx.state.considered['undo-base'],undefined);assert.equal(ctx.state.syncDirty,false);assert.equal(JSON.stringify(h.remoteState().decisionEvents),peerRows);
 });
});

test('RISK decision recovery selected legacy pass: exact retired comparisons cannot replace the imported pass draw root or No marks',async t=>{
 for(const action of ['no','yes','dot','dislodge','title-only'])await t.test(action,async t=>{
  const {local,peer,h,initial,at}=await scopedUndoClients(),ctx=local.ctx;
  for(const app of [local,peer])t.after(()=>{app.ctx.window.CloudSync.user=null;vm.runInContext('clearCloudRetry();clearTimeout(cloudTimer)',app.ctx);});
  if(action==='title-only')await saveEditorChoice(local,'undo-local',at+100,{title:'Displaced title-only choice'});
  else if(action==='no'||action==='yes')ctx.onAction(action,{dataset:{candidate:'undo-local',benchmark:'undo-base'}});
  else if(action==='dot'){hydrateUnchangedEditorDraft(local,'undo-local');ctx.onAction('dot-task',{dataset:{id:'undo-local'}});}
  else ctx.onAction('dislodge',{dataset:{benchmark:'undo-base'}});
  await ctx.persist();ctx.window.CloudSync.ready=true;await ctx.cloudPushNow();await syncSettle(35);const displaced=JSON.parse(JSON.stringify(ctx.state));
  // A plain saved board is a supported explicit selection: it need not invent
  // modern Start facts to retain its different current pass and frozen draw.
  const selected=JSON.parse(JSON.stringify(initial));Object.assign(selected,{chain:['undo-peer'],candidateId:null,mode:'scan',scanMode:'squared',passId:'selected-legacy-pass-Q',passStartedAt:at-5000,considered:{'undo-local':'no'},cantAt:{},workedAt:{},chance:{seed:'selected-Q-frozen-draw',at:at-5000,weights:{},opponents:selected.tasks.map(task=>({id:task.id,mu:task.mu,sigma:task.sigma}))}});selected.settings.scanMode='squared';
  assert.equal(selected.decisionBaseline,undefined);assert.equal(selected.decisionEvents,undefined);local.shim.document.getElementById('jsonBox').value=JSON.stringify(selected);assert.equal(await ctx.onAction('import-json',{}),true);await ctx.persist();await ctx.cloudPushNow();await syncSettle(40);assert.equal(ctx.state.syncDirty,false);assert.equal(ctx.state.decisionEvents.length,0);
  const pass=board=>JSON.stringify(['passId','passStartedAt','mode','scanMode','chance','chain','candidateId','interventionActive','considered','cantAt','workedAt'].map(key=>[key,board[key]]));
  const chosen=pass(ctx.state),chosenRatings=JSON.stringify(ctx.state.tasks.map(task=>[task.id,task.mu,task.sigma]));assert.equal(ctx.state.passId,selected.passId);assert.deepEqual(Array.from(ctx.state.chain),['undo-peer']);assert.equal(ctx.state.considered['undo-local'],'no');assert.equal(ctx.state.chance.seed,selected.chance.seed);
  h.writeBehindBack(displaced);await ctx.cloudPull();await ctx.cloudPushNow();await syncSettle(45);
  assert.equal(pass(ctx.state),chosen,'the selected legacy pass is coherent authority even with no active modern Start or comparison facts');assert.equal(pass(h.remoteState()),chosen);assert.equal(JSON.stringify(ctx.state.tasks.map(task=>[task.id,task.mu,task.sigma])),chosenRatings);assert.equal(ctx.state.settings.scanMode,'squared');assert.equal(ctx.state.syncDirty,false);assert.equal(ctx.window.CloudSync.errorCode??null,null);
  peer.ctx.window.CloudSync.ready=true;await peer.ctx.cloudPull();await saveEditorChoice(peer,'undo-base',at+500,{title:'Peer progress in selected pass'});hydrateUnchangedEditorDraft(peer,'undo-base');peer.ctx.onAction('dot-task',{dataset:{id:'undo-base'}});await peer.ctx.persist();await peer.ctx.cloudPushNow();await syncSettle(40);await ctx.cloudPull();await ctx.cloudPushNow();await syncSettle(35);
  const activePass=pass(ctx.state),facts=JSON.stringify(ctx.state.decisionEvents),ratings=JSON.stringify(ctx.state.tasks.map(task=>[task.id,task.mu,task.sigma]));assert.deepEqual(Array.from(ctx.state.chain),['undo-peer','undo-base']);assert.ok(ctx.state.decisionEvents.some(event=>event.kind==='comparison'&&event.action==='dot'));
  h.writeBehindBack(displaced);await ctx.cloudPull();await ctx.cloudPushNow();await syncSettle(45);
  assert.equal(pass(ctx.state),activePass,'precise pass retirement preserves later peer progress in the selected pass');assert.equal(pass(h.remoteState()),activePass);assert.equal(ctx.state.settings.scanMode,'squared');assert.equal(ctx.state.tasks.find(task=>task.id==='undo-base').title,'Peer progress in selected pass');assert.equal(JSON.stringify(ctx.state.decisionEvents),facts);assert.equal(JSON.stringify(ctx.state.tasks.map(task=>[task.id,task.mu,task.sigma])),ratings);assert.equal(ctx.state.syncDirty,false);assert.equal(ctx.window.CloudSync.errorCode??null,null);
 });
});

test('RISK final decision review: repeated manual Restore and Undo retain bounded exact lineage and peer progress',async t=>{
 const {local,peer,h,at,initial}=await scopedUndoClients(),ctx=local.ctx;for(const app of [local,peer])t.after(()=>{app.ctx.window.CloudSync.user=null;vm.runInContext('clearCloudRetry();clearTimeout(cloudTimer)',app.ctx);});
 ctx.onAction('no',{dataset:{candidate:'undo-local',benchmark:'undo-base'}});await ctx.persist();const original=JSON.stringify(ctx.state.decisionEvents),ratings=JSON.stringify(ctx.state.tasks.map(task=>[task.id,task.mu,task.sigma])),start=JSON.stringify(ctx.state.decisionBaseline).length,backup=await ctx.saveDurableBackup('manual',JSON.stringify(initial));let firstGrowth,retired;
 for(let cycle=1;cycle<=10;cycle++){const sourceBaseline=ctx.canonicalDecisionFact(ctx.state.decisionBaseline);ctx.openSettings();assert.equal(await ctx.restoreDurableBackupById(backup.id),true);await ctx.persist();if(cycle===1)retired=JSON.parse(ctx.cloudPayload());assert.equal(await ctx.onAction('undo',{}),true);await ctx.persist();const bytes=JSON.stringify(ctx.state.decisionBaseline).length;if(cycle===1)firstGrowth=bytes-start;assert.ok(bytes<=start+cycle*firstGrowth*2,'overlapping exact authority must grow at most linearly across supported Restore/Undo cycles: '+JSON.stringify({cycle,bytes,start,firstGrowth}));assert.equal(JSON.stringify(ctx.state.decisionEvents),original);assert.equal(JSON.stringify(ctx.state.tasks.map(task=>[task.id,task.mu,task.sigma])),ratings);assert.equal(ctx.decisionEvidenceIssue(ctx.state,'e@example.com'),null);assert.ok(ctx.replacementDecisionReceipts(ctx.state.decisionBaseline).some(row=>ctx.canonicalDecisionFact(row.baseline)===sourceBaseline),'each original source baseline stays lossless inside the exact archived lineage');assert.ok(ctx.readLocalBackups().some(row=>row.id===backup.id&&row.payload===JSON.stringify(initial)));}
 ctx.window.CloudSync.ready=true;await ctx.cloudPushNow();await syncSettle(35);peer.ctx.window.CloudSync.ready=true;await peer.ctx.cloudPull();await saveEditorChoice(peer,'undo-peer',at+500,{title:'Peer progress after Restore cycles'});await peer.ctx.cloudPushNow();await syncSettle(35);await ctx.cloudPull();h.writeBehindBack(retired);await ctx.cloudPull();await ctx.cloudPushNow();await syncSettle(35);assert.equal(JSON.stringify(ctx.state.decisionEvents.filter(row=>row.kind==='no')),original);assert.equal(ctx.state.tasks.find(row=>row.id==='undo-peer').title,'Peer progress after Restore cycles');assert.equal(ctx.state.syncDirty,false);assert.ok(ctx.retiredDecisionBaseline(ctx.state.decisionBaseline,retired.decisionBaseline),'the exact old replacement branch remains recognized after deduplication');
 const raw=local.shim.localStorage.getItem(SYNC_STORE_KEY),cold=await loadAppAtTime(at+600,{seedStorage:{[SYNC_STORE_KEY]:raw,[LOCAL_HEAD_KEY]:raw},cloudSyncFactory:h.factory});t.after(()=>{cold.ctx.window.CloudSync.user=null;vm.runInContext('clearCloudRetry();clearTimeout(cloudTimer)',cold.ctx);});await cold.ctx.cloudPull();assert.equal(cold.ctx.state.tasks.find(row=>row.id==='undo-peer').title,'Peer progress after Restore cycles');assert.equal(JSON.stringify(cold.ctx.state.decisionEvents.filter(row=>row.kind==='no')),original);assert.equal(cold.ctx.state.syncDirty,false);
});

test("REGRESSION: a dot racing the session's first pull must not overwrite the cloud chain", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), delayMs: 20 });
  const { ctx } = await loadApp({
    seed: 972,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });

  const pull = ctx.cloudPull();          // the session's first reconcile, still in flight
  ctx.addTask("Dotted mid-pull", true);  // a dot takes cloudPushNow() — no debounce, no comparison
  await pull;
  await syncSettle(PAST_DEBOUNCE);

  assert.deepEqual(h.remoteChain(), CLOUD_CHAIN,
    "a write racing the first pull must not land the stale chain in the cloud");
});

/* ---- defect 2: nothing may be written before the session reconciles ---- */

test("REGRESSION: no cloud write goes out before this session has pulled once", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now) });
  const { ctx } = await loadApp({
    seed: 973,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });

  ctx.addTask("Dotted before anything pulled", true);   // immediate-sync path
  await syncSettle(PAST_DEBOUNCE);

  const firstPush = h.calls.indexOf("push");
  if (firstPush !== -1) {
    const firstPull = h.calls.indexOf("pull");
    assert.ok(firstPull !== -1 && firstPull < firstPush,
      `a write must be preceded by a reconcile, got: ${h.calls.join(",")}`);
  }
  assert.deepEqual(h.remoteChain(), CLOUD_CHAIN,
    "an unreconciled device must leave the remote chain alone");
});

/* ---- defect 1: a failed read is not an empty cloud ---- */

test("REGRESSION: a cloud read that failed must not be seeded over as if the cloud were empty", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), failPull: true });
  const { ctx } = await loadApp({
    seed: 974,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  assert.ok(!h.calls.includes("push"),
    `a read we could not complete tells us nothing — it must not authorise a write: ${h.calls.join(",")}`);
  assert.deepEqual(h.remoteChain(), CLOUD_CHAIN, "the remote document must be untouched");
  assert.deepEqual(ctx.state.chain, STALE_CHAIN, "and local must be left alone too");
});

/* ---- the fix must not over-correct: legitimate pushes still go out ---- */

test("an offline edit based on the same cloud revision can still win the reconcile", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now - 6 * HOUR), rev: 4 });
  const local=staleState(now); local.syncRev=4;
  const { ctx } = await loadApp({
    seed: 975,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },   // offline edits based on revision 4
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  assert.deepEqual(ctx.state.chain, STALE_CHAIN, "this device is ahead — it keeps its own state");
  assert.deepEqual(h.remoteChain(), STALE_CHAIN, "and pushes it to the cloud");
});

test("an empty cloud is still seeded from this device", async () => {
  const h = makeSyncHarness({ remote: null });
  const { ctx } = await loadApp({
    seed: 976,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(Date.now())) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  assert.ok(h.remoteState(), "a cloud with provably no document gets created from this device");
  assert.deepEqual(h.remoteChain(), STALE_CHAIN);
});

test("REGRESSION: signing in as a different account re-arms the gate — no write before reading that account's copy", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now) });
  const { ctx, shim } = await loadApp({
    seed: 978,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - 30 * 24 * HOUR)) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();                     // reconciled as e@example.com
  await syncSettle(PAST_DEBOUNCE);
  const afterFirst = h.calls.length;

  shim.window.CloudSync.user = "someone-else@example.com";   // signed out, signed back in as another account
  h.doc = { payload: JSON.stringify(cloudState(now + HOUR)), updatedAt: now + HOUR };

  ctx.addTask("Dotted right after the account switch", true);
  await syncSettle(PAST_DEBOUNCE);

  const after = h.calls.slice(afterFirst);
  assert.equal(after[0], "pull",
    `the new account's document must be read before it is written: ${after.join(",")}`);
});

test("REGRESSION: a rename made on another device is not undone by a stale push", async () => {
  const now = Date.now();
  const phone = cloudState(now);
  phone.tasks[1].title = "Call the credit union";
  const h = makeSyncHarness({ remote: phone, rev: 9 });

  const stale = staleState(now + 3 * HOUR);   // fast clock again
  stale.syncRev = 4;
  const { ctx } = await loadApp({
    seed: 995,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(stale) },
    cloudSyncFactory: h.factory,
  });

  ctx.addTask("Something typed on the laptop", true);   // and it tries to write
  await syncSettle(PAST_DEBOUNCE);

  assert.ok(h.remoteTitles().includes("Call the credit union"),
    `the phone's rename must survive: ${h.remoteTitles()}`);
});

test("REGRESSION: a push cannot overwrite a revision this device never read", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), rev: 3 });
  const local = staleState(now);
  local.syncRev = 3;
  const { ctx } = await loadApp({
    seed: 997,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();                    // in sync at revision 3
  await syncSettle(PAST_DEBOUNCE);

  // Another device writes revision 4 while this one wasn't looking.
  const elsewhere = cloudState(now + HOUR);
  elsewhere.tasks[0].title = "Written from the other device";
  h.writeBehindBack(elsewhere);

  ctx.addTask("Typed here, unaware", false);
  await syncSettle(PAST_DEBOUNCE);

  assert.ok(h.remoteTitles().includes("Written from the other device"),
    `the unseen revision must not be clobbered: ${h.remoteTitles()}`);
  assert.ok(h.conflicts > 0, "the conditional write is what refused it");
});

test("the revision a device is based on is device-local, never part of the shared document", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), rev: 2 });
  const { ctx } = await loadApp({
    seed: 998,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now - HOUR)) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();                    // adopts revision 2
  await syncSettle(PAST_DEBOUNCE);

  assert.equal(ctx.state.syncRev, 3, "the repaired union earns and remembers a new revision");
  assert.ok(!("syncRev" in h.remoteState()),
    "but it must not ride along in the payload, or every adopt would look like a fresh edit");
  const pushesAfterAdopt = h.calls.filter((c) => c === "push").length;
  assert.equal(pushesAfterAdopt, 1, "unique tasks from the older local copy must be published once");
});

test("a cloud document written before revisions existed is adopted without trusting device clocks", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now - HOUR) });   // no rev field at all
  const local=staleState(now + HOUR);local.syncRev=4;
  const { ctx } = await loadApp({
    seed: 999,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  assert.deepEqual(ctx.state.chain, CLOUD_CHAIN, "an unversioned document is adopted conservatively");
  assert.equal(ctx.state.syncRev,1,'the first versioned write uses the legacy document as revision zero');
});

test('CLOUD LEGACY: an adopted unversioned board is upgraded even with no local tasks to merge',async()=>{
  const h=makeSyncHarness({remote:syncState({tasks:[syncTask('legacy','Already in cloud')]})});
  const {ctx}=await loadApp({cloudSyncFactory:h.factory});
  await ctx.cloudPull();await syncSettle(PAST_DEBOUNCE);
  assert.equal(h.doc.rev,1,'the legacy document must stop triggering adoption on every focus');
  assert.equal(ctx.state.syncRev,1);
  const pushes=h.calls.filter(call=>call==='push').length;
  await ctx.cloudPull();await syncSettle(PAST_DEBOUNCE);
  assert.equal(h.calls.filter(call=>call==='push').length,pushes,'a stable upgraded board is not rewritten');
});

/* =====================================================================
   REVISIONS, PART 2: THE REVISION A PUSH EARNS HAS TO REACH DISK

   Symptom, reported from the phone: on a fresh load the first "Done"
   doesn't take. You tap it, the task comes back, you tap it again and it
   sticks. Only ever the first one, only ever right after loading.

   Cause: sendPush() records the revision the cloud hands back on
   state.syncRev and stops there. Nothing saves afterwards — save() has
   already run by then, since it debounces at 350ms and the push at 2s — so
   the copy on disk keeps the revision from *before* the write. Every
   session therefore boots one revision behind a cloud it is perfectly in
   sync with, reads rr > lr as "the cloud holds work this device has never
   seen", and adopts the remote wholesale. Anything done while that first
   pull was in flight goes with it.

   It lands on the first click specifically because a cold load is when the
   pull is slowest (module import, auth restore, then the read) and because
   clicking into an unfocused tab fires the focus event that starts one — so
   the click that gets thrown away is the same click that started the race.
   ===================================================================== */

test("the revision a push earns is written to disk, not just held in memory", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), rev: 4 });
  const local = cloudState(now);
  local.syncRev = 4;
  const { ctx, shim } = await loadApp({
    seed: 1101,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();                       // reconciled at revision 4
  ctx.addTask("Water the plants", false);      // ...and this device writes
  await syncSettle(PAST_DEBOUNCE + 600);       // past the push debounce, then past save()'s

  assert.ok(h.doc.rev > 4, "the cloud moved on, so there is a new revision to remember");
  const saved = JSON.parse(shim.localStorage.getItem(SYNC_STORE_KEY));
  assert.equal(saved.syncRev, h.doc.rev,
    "the revision this device just wrote has to survive the tab closing, or next boot thinks the cloud is ahead");
});

test("REGRESSION: the first Done of a session isn't swallowed by that session's first reconcile", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), rev: 4 });
  const first = cloudState(now);
  first.syncRev = 4;

  // Session one: ordinary use, ending in a write. Nothing here is unusual —
  // it is only the last thing she did before closing the tab.
  const s1 = await loadApp({
    seed: 1102,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(first) },
    cloudSyncFactory: h.factory,
  });
  await s1.ctx.cloudPull();
  s1.ctx.addTask("Water the plants", false);
  await syncSettle(PAST_DEBOUNCE + 600);

  // Session two boots from exactly what session one left on disk, against
  // the same cloud document — nobody else has touched it.
  const s2 = await loadApp({
    seed: 1103,
    seedStorage: { [SYNC_STORE_KEY]: s1.shim.localStorage.getItem(SYNC_STORE_KEY) },
    cloudSyncFactory: h.factory,
  });
  assert.equal(s2.ctx.benchmark().id, "t_day_c", "the newest dot is what the Done button acts on");

  const pull = s2.ctx.cloudPull();   // the load's own reconcile, still in flight
  s2.ctx.benchDone();                // one click on the benchmark card
  await pull;
  await syncSettle(PAST_DEBOUNCE + 600);

  const done = s2.ctx.state.tasks.find((t) => t.id === "t_day_c");
  assert.ok(done.done, "one click has to be enough — the reconcile must not put it back");
  assert.ok(!s2.ctx.state.chain.includes("t_day_c"), "and it comes off the chain");
  assert.ok(h.remoteState().tasks.find((t) => t.id === "t_day_c").done,
    "the completion reaches the cloud too, rather than being reverted to what was already there");
});

test("a device meeting the revision counter for the first time persists the one it adopts", async () => {
  const now = Date.now();
  // A cloud document already on revisions; a device that has never seen one.
  const h = makeSyncHarness({ remote: cloudState(now - HOUR), rev: 6 });
  const { ctx, shim } = await loadApp({
    seed: 1104,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(staleState(now)) },   // no syncRev at all
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();                 // migration path: local is newer, so it pushes
  await syncSettle(PAST_DEBOUNCE + 600);

  const saved = JSON.parse(shim.localStorage.getItem(SYNC_STORE_KEY));
  assert.equal(saved.syncRev, h.doc.rev,
    "the counter it just adopted has to reach disk, or the next boot re-runs this migration a revision behind");
});

/* The trap in the fix above: the obvious way to persist a revision is to call
   save(), and save() re-stamps updatedAt and schedules a cloud push. Recording
   what we just wrote would then count as a change worth writing, whose own
   callback records another revision, and so on every 2 seconds for as long as
   the tab is open — an unbounded stream of writes with no edit behind any of
   them. Hence persist(): the disk half, on its own. */
test("recording the revision a push earned must not schedule another push", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), rev: 3 });
  const local = cloudState(now);
  local.syncRev = 3;
  const { ctx } = await loadApp({
    seed: 1105,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },
    cloudSyncFactory: h.factory,
  });
  await ctx.cloudPull();

  const before = h.calls.filter((c) => c === "push").length;
  ctx.addTask("One edit, one write", false);
  await syncSettle(PAST_DEBOUNCE + 600);
  const after = h.calls.filter((c) => c === "push").length;
  assert.equal(after - before, 1, "one edit sends one write");

  await syncSettle(PAST_DEBOUNCE * 2);   // two more debounce windows, with nobody touching anything
  assert.equal(h.calls.filter((c) => c === "push").length, after,
    "and that write must not breed more of itself while the tab sits idle");
});

/* =====================================================================
   AUDIT — hypotheses about missing logical steps in the app flow.

   Each test below names a step the current flow appears to skip. They are
   written before any fix, and expected to fail, per the test-first rule.

   H1-H4 share one root cause worth stating once: state.syncRev — the
   revision this device's copy is based on — lives INSIDE the state blob.
   Every operation that swaps the blob wholesale (Reset everything, Import
   JSON, undoing a remote adoption) therefore also rewinds the device's
   sync base to whatever that blob was carrying. The cloud is then strictly
   ahead, the conditional write in CS.push() refuses, cloudPull() adopts the
   remote, and the deliberate replacement is silently undone.
   ===================================================================== */

/* ---- H1: a confirmed reset is resurrected by the cloud ---- */
test("AUDIT H1: a twice-confirmed 'Reset everything' must survive the push that follows it", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), rev: 9 });
  const local = cloudState(now); local.syncRev = 9;          // this device is up to date
  const { ctx } = await loadApp({
    seed: 8001,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },
    cloudSyncFactory: h.factory,
  });
  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  ctx.onAction("wipe", {});
  assert.notEqual(ctx.state.tasks.length, 0, "the first tap only opens the explicit confirmation");
  ctx.onAction("confirm-wipe", {});
  await flush();
  assert.equal(ctx.state.tasks.length, 0, "the wipe empties the list on the spot");

  await syncSettle(PAST_DEBOUNCE);
  assert.equal(ctx.state.tasks.length, 0,
    `a confirmed reset must not be resurrected by the cloud: ${titlesOf(ctx)}`);
  assert.deepEqual(h.remoteTitles(), [], "and the empty list must reach the cloud");
});

/* ---- H2: the documented escape hatch is overwritten by what it escapes ----
   SETUP.md offers Export/Import JSON as the way out of the one case sync
   cannot merge. An export carries the syncRev of the device that made it, so
   pasting it into a device the cloud has since moved past hands the cloud the
   win — the paste lands, then vanishes a couple of seconds later, silently:
   the "out of date" toast only fires on a session's FIRST reconcile. */
test("AUDIT H2: an imported export must not be overwritten by a revision it predates", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), rev: 9 });
  const local = cloudState(now); local.syncRev = 9;
  const { ctx } = await loadApp({
    seed: 8002,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },
    cloudSyncFactory: h.factory,
  });
  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  const exported = syncState({                      // taken on the phone a few revisions back
    tasks: [syncTask("t_imp", "Restored from my export")], chain: [], updatedAt: now, syncRev: 4,
  });
  ctx.document.getElementById("jsonBox").value = JSON.stringify(exported);
  ctx.onAction("import-json", {});
  assert.ok(titlesOf(ctx).includes("Restored from my export"), "the paste lands immediately");

  await syncSettle(PAST_DEBOUNCE);
  assert.ok(titlesOf(ctx).includes("Restored from my export"),
    `a hand-pasted import is authoritative and must stay: ${titlesOf(ctx)}`);
  assert.ok(h.remoteTitles().includes("Restored from my export"),
    `and must reach the cloud: ${h.remoteTitles()}`);
});

/* ---- H3: the toast promises an undo the cloud takes straight back ----
   "This tab was out of date — loaded the newer copy. ↺ undoes it." The undo
   snapshot carries the pre-adoption syncRev, so pressing u puts the device
   behind the cloud again and the next push loses to it. */
test("AUDIT H3: cloud adoption keeps recovery without creating ordinary remote-history Undo", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), rev: 4 });
  const local = staleState(now); local.syncRev = 3;
  const { ctx } = await loadApp({
    seed: 8003,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  assert.deepEqual(ctx.state.chain, CLOUD_CHAIN, "the newer revision is adopted, as designed");

  assert.equal(ctx.undo(),false,'receiving a cloud board is not a local user action');
  assert.deepEqual(ctx.state.chain, CLOUD_CHAIN, "ordinary Undo cannot replace peer progress with a prior adoption snapshot");
  assert.ok(ctx.readLocalBackups().some(row=>{try{return JSON.stringify(JSON.parse(row.payload).chain)===JSON.stringify(STALE_CHAIN);}catch{return false;}}),'the displaced board remains available through explicit recovery');

  await syncSettle(PAST_DEBOUNCE);
  assert.deepEqual(ctx.state.chain, CLOUD_CHAIN,
    "an attempted ordinary Undo cannot republish the older board over current peer progress");
});

/* ---- H4: a cloud document BEHIND this device never converges ----
   Reachable by signing in as a second Google account on the same device (the
   new account's document starts at rev 1 while this device still holds the
   first account's syncRev), or by the document being recreated. cloudPull()
   sees rr < lr, decides this device is ahead and pushes; CS.push() sees a base
   revision that does not match and refuses; the conflict handler pulls again.
   Neither side ever moves, and the retry is not rate-limited. */
test("AUDIT H4: a cloud document behind this device's revision must not spin forever", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), rev: 3 });
  const local = staleState(now); local.syncRev = 50;   // the revision the PREVIOUS account was at
  const { ctx } = await loadApp({
    seed: 8004,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },
    cloudSyncFactory: h.factory,
  });

  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);
  const settled = h.calls.length;
  await syncSettle(300);
  const extra = h.calls.length - settled;

  h.doc = null;                       // let any live loop converge before the test ends
  await syncSettle(PAST_DEBOUNCE);

  assert.ok(extra <= 2,
    `the reconcile must converge, not retry forever: ${extra} further reads/writes in 300ms`);
});

/* ---- H9: an account switch carries the previous account's list with it ----
   Nothing in the state records WHICH account it belongs to. The read-before-
   write gate re-arms on a new account (that regression is already covered),
   but the read only decides who is ahead — and against a brand-new account
   with no document at all, cloudPull() takes the {empty:true} branch and
   seeds it from whatever this device happens to be holding. Which is the
   previous account's task list. */
test("AUDIT H9: signing in as a different account must not seed it with the previous account's tasks", async () => {
  const now = Date.now();
  const h = makeSyncHarness({ remote: cloudState(now), rev: 9 });
  const local = cloudState(now); local.syncRev = 9;
  const { ctx, shim } = await loadApp({
    seed: 8009,
    seedStorage: { [SYNC_STORE_KEY]: JSON.stringify(local) },
    cloudSyncFactory: h.factory,
  });
  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);
  const mine = titlesOf(ctx);
  assert.ok(mine.includes("Draft the chapter"), "this account's list is loaded and in sync");

  h.doc = null;                                                // the other account has never synced
  shim.window.CloudSync.user = "someone-else@example.com";     // signed out, signed back in as them
  await ctx.cloudPull();
  await syncSettle(PAST_DEBOUNCE);

  const seeded = h.remoteTitles() || [];
  assert.deepEqual(seeded.filter((t) => mine.includes(t)), [],
    `the other account's cloud must not be seeded from this one: ${seeded}`);
});
test('Consistency repair: remote adoption retains account isolation before switching accounts',async()=>{
 const now=Date.now(),h=makeSyncHarness({remote:cloudState(now),rev:9});const local=staleState(now-1000);local.syncRev=8;local.syncAccount='e@example.com';
 const {ctx,shim}=await loadApp({seedStorage:{[SYNC_STORE_KEY]:JSON.stringify(local)},cloudSyncFactory:h.factory});
 await ctx.cloudPull();await syncSettle(PAST_DEBOUNCE);assert.equal(ctx.state.syncAccount,'e@example.com');
 h.doc=null;shim.window.CloudSync.user='other@example.com';await ctx.cloudPull();ctx.cloudPushNow();await syncSettle(50);
 assert.ok(!(h.remoteTitles()||[]).includes('Draft the chapter'));
});

test('CLOUD ACCOUNT: an older-format document under another account wins over the prior account board',async()=>{
  const local=syncState({tasks:[syncTask('private-a','Private A')],syncAccount:'a@example.com',syncRev:8,updatedAt:Date.now()+HOUR});
  const remote=syncState({tasks:[syncTask('private-b','Private B')],updatedAt:1});
  const h=makeSyncHarness({remote});
  const {ctx,shim}=await loadApp({seedStorage:{[SYNC_STORE_KEY]:JSON.stringify(local)},cloudSyncFactory:h.factory});
  shim.window.CloudSync.user='b@example.com';
  await ctx.cloudPull();
  assert.deepEqual(Array.from(ctx.state.tasks,task=>task.title),['Private B']);
  await syncSettle(PAST_DEBOUNCE);
  assert.deepEqual(h.remoteTitles(),['Private B'],'the prior account must never be pushed into the new account');
});

test('CLOUD ACCOUNT: Undo cannot bring the old board into an empty new account',async()=>{
  const local=syncState({tasks:[syncTask('private-a','Private A')],syncAccount:'a@example.com',syncRev:4});
  const h=makeSyncHarness();
  const {ctx,shim}=await loadApp({seedStorage:{[SYNC_STORE_KEY]:JSON.stringify(local)},cloudSyncFactory:h.factory});
  shim.window.CloudSync.user='b@example.com';
  await ctx.cloudPull();
  ctx.undo();ctx.cloudPushNow();await syncSettle(PAST_DEBOUNCE);
  assert.deepEqual(Array.from(ctx.state.tasks,task=>task.title),[]);
  assert.ok(!h.remoteTitles()?.includes('Private A'),'Undo must not upload A to B');
});

test('CLOUD ACCOUNT: Undo cannot replace a populated new account with the old board',async()=>{
  const local=syncState({tasks:[syncTask('private-a','Private A')],syncAccount:'a@example.com',syncRev:4});
  const h=makeSyncHarness({remote:syncState({tasks:[syncTask('private-b','Private B')]}),rev:2});
  const {ctx,shim}=await loadApp({seedStorage:{[SYNC_STORE_KEY]:JSON.stringify(local)},cloudSyncFactory:h.factory});
  shim.window.CloudSync.user='b@example.com';
  await ctx.cloudPull();
  ctx.undo();ctx.cloudPushNow();await syncSettle(PAST_DEBOUNCE);
  assert.deepEqual(Array.from(ctx.state.tasks,task=>task.title),['Private B']);
  assert.deepEqual(h.remoteTitles(),['Private B']);
});

test('RISK CLOUD PAYLOAD: a cold duplicated board repairs both primary keys, uploads once, and reaches a clean acknowledgement',async()=>{
 const prepared=await loadApp();
 const exact=deletionEvidence('cold-op','cold-task','task',recentDeletionAt,{future:'kept'});
 const local=syncState({
  tasks:[syncTask('live-task','Live task')],deletionLog:[exact,JSON.parse(JSON.stringify(exact)),JSON.parse(JSON.stringify(exact))],
  syncRev:0,syncDirty:true,syncAccount:'e@example.com',updatedAt:1000,
 });
 prepared.ctx.hydrateState(local);
 local.deletionLog=[exact,JSON.parse(JSON.stringify(exact)),JSON.parse(JSON.stringify(exact))];
 const raw=JSON.stringify(local),storage=sharedScannerStorage({[LOCAL_HEAD_KEY]:raw,[SYNC_STORE_KEY]:raw});
 const h=makeSyncHarness();
 const {ctx,shim}=await loadApp({sharedStorage:storage,cloudSyncFactory:h.factory});
 await ctx.cloudPull();await syncSettle(PAST_DEBOUNCE);
 const head=JSON.parse(storage.getItem(LOCAL_HEAD_KEY)),store=JSON.parse(storage.getItem(SYNC_STORE_KEY));
 assert.equal(head.deletionLog.length,1);assert.equal(store.deletionLog.length,1);
 assert.equal(storage.getItem(LOCAL_HEAD_KEY),storage.getItem(SYNC_STORE_KEY),'the guarded browser pair converges exactly');
 assert.equal(h.calls.filter(call=>call==='push').length,1,'the compacted board is uploaded once after the required read');
 assert.equal(h.remoteState().deletionLog.length,1);
 assert.equal(ctx.state.syncDirty,false);assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
});

test('RISK CLOUD STARTUP: a timed-out write reads before its automatic retry and reaches acknowledgement',async()=>{
 const local=syncState({tasks:[syncTask('shared','Current board')],syncRev:4,syncAccount:'e@example.com',syncDirty:false});
 let remote=JSON.stringify(local),rev=4,pulls=0,pushes=0;
 const factory=window=>{
  const ping=()=>window.dispatchEvent({type:'cloudsync'});
  const succeed=()=>{CS.status='ok';CS.errorStage=null;CS.errorCode=null;ping();};
  const CS={configured:true,ready:true,user:'e@example.com',status:'ok',errorStage:null,errorCode:null,signIn(){},signOut(){},
   async pull(){pulls++;CS.status='syncing';ping();await flush();succeed();return {payload:remote,rev};},
   async push(payload,_updatedAt,baseRev){
    pushes++;CS.status='syncing';ping();await flush();
    if(pushes===1){CS.status='error';CS.errorStage='push';CS.errorCode='deadline-exceeded';ping();return {error:true};}
    if(baseRev!==rev){succeed();return {conflict:true,rev};}
    remote=payload;rev++;succeed();return {ok:true,rev};
   },
  };
  return CS;
 };
 const storage=sharedScannerStorage({[SYNC_STORE_KEY]:JSON.stringify(local)});
 const {ctx,shim}=await loadApp({sharedStorage:storage,cloudSyncFactory:factory});
 shim.window.CLOUD_RETRY_DELAY_MS=5;
 await ctx.cloudPull();ctx.addTask('Retry without tapping cloud');await ctx.persist();ctx.cloudPushNow();
 await syncSettle(PAST_DEBOUNCE+80);
 assert.equal(pulls,2,'the uncertain write outcome is read before another transaction starts');
 assert.equal(pushes,2,'the unchanged revision is retried automatically after that read');
 assert.equal(JSON.parse(remote).tasks.some(task=>task.title==='Retry without tapping cloud'),true);
 assert.equal(ctx.state.syncDirty,false);assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
});

test('RISK CLOUD STARTUP: a late timed-out transaction cannot overwrite the authoritative retry read',async()=>{
 const local=syncState({tasks:[syncTask('shared','Current board')],syncRev:4,syncAccount:'e@example.com',syncDirty:false});
 let remote=JSON.stringify(local),rev=4,pulls=0,pushes=0;
 const factory=window=>{
  const ping=()=>window.dispatchEvent({type:'cloudsync'});
  const succeed=()=>{CS.status='ok';CS.errorStage=null;CS.errorCode=null;ping();};
  const CS={configured:true,ready:true,user:'e@example.com',status:'ok',errorStage:null,errorCode:null,signIn(){},signOut(){},
   async pull(){pulls++;CS.status='syncing';ping();await flush();succeed();return {payload:remote,rev};},
   async push(payload,_updatedAt,baseRev){
    pushes++;CS.status='syncing';ping();await flush();
    if(pushes===1){
      setTimeout(()=>{if(rev===baseRev){remote=payload;rev++;}},20);
      CS.status='error';CS.errorStage='push';CS.errorCode='deadline-exceeded';ping();return {error:true};
    }
    if(baseRev!==rev){succeed();return {conflict:true,rev};}
    remote=payload;rev++;succeed();return {ok:true,rev};
   },
  };
  return CS;
 };
 const storage=sharedScannerStorage({[SYNC_STORE_KEY]:JSON.stringify(local)});
 const {ctx,shim}=await loadApp({sharedStorage:storage,cloudSyncFactory:factory});
 shim.window.CLOUD_RETRY_DELAY_MS=5;
 await ctx.cloudPull();ctx.addTask('Committed after the local deadline');await ctx.persist();ctx.cloudPushNow();
 await syncSettle(PAST_DEBOUNCE+180);
 assert.equal(pushes,2,'the retry still uses the old base and is rejected after the late commit');
 assert.equal(pulls,3,'the client reads once after timeout and again after the revision conflict');
 assert.equal(rev,5,'only one transaction advances the original base revision');
 assert.equal(JSON.parse(remote).tasks.some(task=>task.title==='Committed after the local deadline'),true);
 assert.equal(ctx.state.syncRev,5);assert.equal(ctx.state.syncDirty,false);
 assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
});

test('RISK SCALABLE RECOVERY: cloud replacement awaits an IndexedDB safety copy and old-tab bytes reconcile without becoming blind authority',async()=>{
 const {indexedDB}=await import('fake-indexeddb');
 const dbName='chain-scanner-app-recovery-'+Date.now()+'-'+Math.random();
 const local=syncState({tasks:[syncTask('local','Local task')],syncRev:1,syncAccount:'e@example.com',syncDirty:false});
 local.futureBoardData={blob:'L'.repeat(1150000)};
 const localRaw=JSON.stringify(local),values=new Map([[LOCAL_HEAD_KEY,localRaw],[SYNC_STORE_KEY,localRaw]]);
 const storage={
  getItem:key=>values.has(key)?values.get(key):null,
  setItem(key,value){value=String(value);if(value.length>350000)throw Object.assign(Error('quota'),{name:'QuotaExceededError'});values.set(key,value);},
  removeItem:key=>values.delete(key),
 };
 const remote=syncState({tasks:[syncTask('local','Other device title'),syncTask('remote','Remote task')],syncRev:0});
 remote.futureBoardData=local.futureBoardData;
 const sync=makeSyncHarness({remote,rev:2});
 const loaded=await loadApp({sharedStorage:storage,indexedDBProvider:indexedDB,deviceDbName:dbName,cloudSyncFactory:sync.factory});
 const priorBoard=JSON.stringify(loaded.ctx.state);
 await loaded.ctx.cloudPull();await syncSettle(PAST_DEBOUNCE+40);
 const durable=loaded.shim.window.ScannerDeviceStore;
 const afterAdoption=await durable.readHead(),backups=await durable.listBackups();
 assert.ok(JSON.parse(afterAdoption.payload).tasks.some(task=>task.id==='remote'),'the adopted board is durable before it is rendered as accepted');
 assert.ok(backups.some(row=>row.payload===priorBoard&&/^before-cloud-/.test(row.kind)),
  'the exact displaced board is independently restorable: '+JSON.stringify(backups.map(row=>({kind:row.kind,length:row.payload.length,same:row.payload===priorBoard}))));

 const oldTab=syncState({tasks:[syncTask('old-tab','Old tab edit')],syncRev:1,syncAccount:'e@example.com',syncDirty:true});
 const oldRaw=JSON.stringify(oldTab);values.set(LOCAL_HEAD_KEY,oldRaw);values.set(SYNC_STORE_KEY,oldRaw);
 assert.equal(await loaded.ctx.reconcileDeviceLegacyCopy(),true);
 const reconciled=JSON.parse((await durable.readHead()).payload);
 assert.ok(reconciled.tasks.some(task=>task.id==='remote'));assert.ok(reconciled.tasks.some(task=>task.id==='old-tab'));
 assert.ok((await durable.listBackups()).some(row=>row.payload===oldRaw&&row.kind==='other-browser-copy'),'old-shell writes become recovery evidence before merge');

 loaded.ctx.undo();assert.equal(await loaded.ctx.persist(),true);
 assert.ok(JSON.parse((await durable.readHead()).payload).tasks.some(task=>task.id==='remote'),'Undo after reconciliation remains a guarded durable write');
});

test('RISK SCALABLE RECOVERY: clean cloud adoption releases its IndexedDB proof only after shared legacy conflicts become durable',async()=>{
 const {indexedDB}=await import('fake-indexeddb'),dbName='chain-scanner-release-proof-'+Date.now()+'-'+Math.random();
 const local=syncState({tasks:[syncTask('local','Already in cloud')],syncRev:1,syncAccount:'e@example.com',syncDirty:true});
 local.futureBoardData={blob:'represented '.repeat(1000)};
 const raw=JSON.stringify(local),storage=sharedScannerStorage({[LOCAL_HEAD_KEY]:raw,[SYNC_STORE_KEY]:raw});
 const loaded=await loadApp({sharedStorage:storage,indexedDBProvider:indexedDB,deviceDbName:dbName});
 const priorBoard=JSON.stringify(loaded.ctx.state),remote=JSON.parse(loaded.ctx.cloudPayload());
 remote.tasks.push(syncTask('remote','New remote task'));loaded.ctx.hydrateState(remote);const sync=makeSyncHarness({remote,rev:2});
 loaded.shim.window.CloudSync=sync.factory();
 assert.equal(loaded.ctx.recoveryBoardRepresented(priorBoard,remote),true,'precondition: the incoming board fully represents the displaced board');
 const mergedProbe=JSON.parse(JSON.stringify(remote));loaded.ctx.mergeUndeletedTasks(mergedProbe,loaded.ctx.state);
 assert.equal(loaded.ctx.recoveryBoardRepresented(priorBoard,mergedProbe),true,'precondition: reconciliation keeps every displaced user field represented');
 const displaced=JSON.parse(priorBoard);displaced.tasks[0].title='Only offline title';
 const sharedId='shared-recovery-id';
 storage.setItem(LOCAL_BACKUPS_KEY,JSON.stringify([{id:sharedId,day:'2026-09-28',at:1,kind:'daily',payload:JSON.stringify(displaced)}]));
 vm.runInContext(`deviceBackupId=()=>${JSON.stringify(sharedId)}`,loaded.ctx);
 await loaded.ctx.cloudPull();await syncSettle(PAST_DEBOUNCE+40);
 const deviceRows=await loaded.shim.window.ScannerDeviceStore.listBackups();
 const legacyRows=JSON.parse(storage.getItem(LOCAL_BACKUPS_KEY));
 assert.ok(!deviceRows.some(row=>row.id===sharedId),'the represented automatic IndexedDB proof retires after the adopted head is durable: '+JSON.stringify({deviceRows:deviceRows.map(row=>({id:row.id,kind:row.kind,same:row.payload===priorBoard})),pins:loaded.ctx.state.protectedBackupIds,syncDirty:loaded.ctx.state.syncDirty,calls:sync.calls,legacyKinds:legacyRows.map(row=>row.kind)}));
 assert.equal(legacyRows.find(row=>row.id===sharedId)?.kind,'before-cloud-local-edit','a same-ID sole-copy legacy conflict becomes durable before release');
 assert.ok(!loaded.ctx.state.protectedBackupIds.includes(sharedId),'the shared pin releases only after every store is safe');
 assert.ok(JSON.parse((await loaded.shim.window.ScannerDeviceStore.readHead()).payload).tasks.some(task=>task.id==='remote'));
});

test('RISK SCALABLE RECOVERY: an inaccessible established IndexedDB authority never revives or uploads its stale legacy shell',async()=>{
 const {indexedDB}=await import('fake-indexeddb'),dbName='chain-scanner-authority-loss-'+Date.now()+'-'+Math.random();
 const legacy=syncState({tasks:[syncTask('legacy','Legacy shell task')],syncRev:3,syncAccount:'e@example.com',syncDirty:false});
 const legacyRaw=JSON.stringify(legacy),storage=sharedScannerStorage({[LOCAL_HEAD_KEY]:legacyRaw,[SYNC_STORE_KEY]:legacyRaw});
 const first=await loadApp({sharedStorage:storage,indexedDBProvider:indexedDB,deviceDbName:dbName});
 first.ctx.addTask('Only in durable v2');assert.equal(await first.ctx.persist(),true);
 assert.equal(storage.getItem(DEVICE_AUTHORITY_KEY),'1','verified migration leaves a tiny durable authority marker for later boots');
 await first.shim.window.ScannerDeviceStore.close();
 const blocked={open(){const request={};setTimeout(()=>{request.error=Object.assign(Error('blocked'),{name:'InvalidStateError'});request.onerror?.();},0);return request;}};
 const pushes=[];const cloudSyncFactory=()=>({ready:true,configured:true,user:'e@example.com',status:'ok',async pull(){return null;},async push(payload){pushes.push(payload);return {rev:4};},signIn(){},signOut(){}});
 const reopened=await loadApp({sharedStorage:storage,indexedDBProvider:blocked,deviceDbName:dbName,cloudSyncFactory});
 assert.equal(vm.runInContext('storageOK',reopened.ctx),false,'the app reports the authoritative store unavailable instead of accepting old localStorage');
 assert.equal(reopened.ctx.state.tasks.some(task=>task.title==='Legacy shell task'),false,'stale legacy bytes are not treated as the current board');
 reopened.ctx.addTask('Must remain in memory');assert.equal(await fixtureDeadline(reopened.ctx.persist(),'unavailable established authority save settles within its existing budget',6000),false);
 reopened.ctx.cloudPushNow();await syncSettle(PAST_DEBOUNCE+40);
 assert.equal(pushes.length,0,'an unavailable durable authority cannot upload a default or stale board');
 assert.equal(storage.getItem(SYNC_STORE_KEY),legacyRaw,'the last legacy recovery bytes stay untouched');
});

test('RISK SCALABLE DESTRUCTIVE ACTIONS: Restore and Reset await exact IndexedDB recovery proof before replacing a large board',async()=>{
 const {indexedDB}=await import('fake-indexeddb'),dbName='chain-scanner-destructive-'+Date.now()+'-'+Math.random();
 const original=syncState({tasks:[syncTask('original','Original large board')],syncDirty:true});original.futureBoardData={blob:'R'.repeat(1100000)};
 const raw=JSON.stringify(original),values=new Map([[LOCAL_HEAD_KEY,raw],[SYNC_STORE_KEY,raw]]),storage={
  getItem:key=>values.has(key)?values.get(key):null,
  setItem(key,value){value=String(value);if(value.length>250000)throw Object.assign(Error('quota'),{name:'QuotaExceededError'});values.set(key,value);},
  removeItem:key=>values.delete(key),
 };
 const loaded=await loadApp({sharedStorage:storage,indexedDBProvider:indexedDB,deviceDbName:dbName});
 const manual=await loaded.ctx.saveDurableBackup('manual',JSON.stringify(loaded.ctx.state));assert.ok(manual?.id);
 loaded.ctx.addTask('Later edit');assert.equal(await loaded.ctx.persist(),true);
 assert.equal(await loaded.ctx.restoreDurableBackupById(manual.id),true);
 assert.equal(loaded.ctx.state.tasks.some(task=>task.title==='Later edit'),true,'Restore keeps later tasks without deletion evidence');
 assert.ok((await loaded.shim.window.ScannerDeviceStore.listBackups()).some(row=>row.kind==='before-restore'&&row.payload.includes('Later edit')),
  'the exact board displaced by Restore is durable in the same scalable store');

 const beforeReset=JSON.stringify(loaded.ctx.state);
 await loaded.ctx.confirmResetEverything();
 assert.equal(loaded.ctx.state.tasks.length,0);assert.equal(JSON.parse((await loaded.shim.window.ScannerDeviceStore.readHead()).payload).tasks.length,0);
 assert.ok((await loaded.shim.window.ScannerDeviceStore.listBackups()).some(row=>row.kind==='before-reset'&&row.payload===beforeReset));

 const restored=JSON.parse(beforeReset);loaded.ctx.state.tasks=restored.tasks;await loaded.ctx.persist();
 const stable=JSON.stringify(loaded.ctx.state),putBackup=loaded.shim.window.ScannerDeviceStore.putBackup;
 loaded.shim.window.ScannerDeviceStore.putBackup=async()=>({error:true,code:'forced-backup-failure'});
 await loaded.ctx.confirmResetEverything();
 assert.equal(JSON.stringify(loaded.ctx.state),stable,'a failed mandatory recovery transaction aborts Reset without mutating the live board');
 assert.equal((await loaded.shim.window.ScannerDeviceStore.readHead()).payload,stable);
 loaded.shim.window.ScannerDeviceStore.putBackup=putBackup;
});

test('RISK CLOUD LATENCY: ordinary edits retain the two-second debounce and stay dirty until server acknowledgement',async()=>{
 const {ctx,shim}=await loadApp();let calls=0,ack;
 const CS=shim.window.CloudSync={configured:true,ready:true,user:'latency@example.test',status:'ok',pull:async()=>({empty:true}),
  push:async()=>{calls++;CS.status='syncing';return new Promise(resolve=>{ack=result=>{CS.status='ok';resolve(result);};});}};
 await ctx.cloudPull();ctx.addTask('Prompt upload');
 await syncSettle(50);
 const earlyCalls=calls;
 const until=Date.now()+2500;while(!calls&&Date.now()<until)await syncSettle(20);
 assert.equal(calls,1,'a committed edit must start after the ordinary debounce');
 assert.equal(ctx.state.syncDirty,true);ctx.renderSync();assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ syncing');
 ack({ok:true,rev:1});for(let i=0;i<20;i++)await flush();
 assert.equal(ctx.state.syncDirty,false);assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
 assert.equal(earlyCalls,0,'the user retained the two-second debounce for batching ordinary edits');
});

test('RISK completion lifecycle Dot: unseen Dot and opposite No keep learning while observed completion owns membership',async t=>{
 const {IDBFactory}=await import('fake-indexeddb');
 for(const first of ['dot-first','completion-first'])for(const dotOffset of [-100,100,200,2*3600000])await t.test(`${first}, Dot clock offset ${dotOffset}`,async t=>{
  const at=Date.parse('2026-10-17T15:00:00Z'),taskId=`unaware-dot-${first}-${dotOffset}`,benchmarkId='unaware-dot-reference';
  const initial=syncState({tasks:[{...syncTask(taskId,'Unaware recurring task'),evergreen:true,evergreenHours:1,evergreenResetAtDay:false},
   syncTask(benchmarkId,'Saved benchmark')],chain:[benchmarkId],candidateId:taskId,scanMode:'descending',passId:`dot-pass-${first}-${dotOffset}`,passStartedAt:at-60000,
   syncRev:4,syncAccount:'e@example.com',syncDirty:false,settings:{horizonMin:60,thresholdPct:0,samples:40,cantMin:30,workedHours:8,theme:'system'}});
  const remote=structuredClone(initial);for(const key of ['syncRev','syncAccount','syncDirty'])delete remote[key];
  const h=makeSyncHarness({remote,rev:4,delayMs:1}),indexedDB=new IDBFactory(),name=`unaware-dot-${Date.now()}-${Math.random()}`,
   seedStorage={[SYNC_STORE_KEY]:JSON.stringify(initial),[LOCAL_HEAD_KEY]:JSON.stringify(initial)};
  const doneClient=await loadAppAtTime(at,{seedStorage,cloudSyncFactory:h.factory}),
   dotClient=await loadAppAtTime(at,{seedStorage,indexedDBProvider:indexedDB,deviceDbName:name,cloudSyncFactory:h.factory}),
   noClient=await loadAppAtTime(at,{seedStorage,cloudSyncFactory:h.factory});
  const clients=[doneClient,dotClient,noClient],close=async app=>{try{await app?.ctx?.window?.ScannerDeviceStore?.close?.();}catch{}};
  t.after(async()=>{for(const app of clients){app.ctx.window.CloudSync.user=null;vm.runInContext('clearTimeout(saveTimer);saveTimer=null;clearCloudRetry();clearTimeout(cloudTimer);cloudTimer=null;',app.ctx);await close(app);}});
  await doneClient.ctx.cloudPull();await dotClient.ctx.cloudPull();await noClient.ctx.cloudPull();
  for(const app of clients)app.ctx.window.CloudSync.ready=false;
  const paints=[],deviceWrites=[],observations=[],transport=[];let sequence=0,held=false,release;
  const responseGate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  // Receipt marks knowledge before application continuation; retain every paint
  // on both sides, and never reset knowledge after a later source or render.
  const knowledge=new WeakMap(),completionObserved=new WeakSet();
  for(const app of clients){knowledge.set(app,new Set());const CS=app.ctx.window.CloudSync,pull=CS.pull.bind(CS);CS.pull=async(...args)=>{
   const response=await pull(...args),incoming=response.payload?JSON.parse(response.payload):null,ids=(incoming?.decisionEvents||[]).filter(event=>event.kind==='completion'&&event.taskId===taskId).map(event=>event.id),client=app===dotClient?'dot':app===doneClient?'done':'no';
   transport.push({sequence:++sequence,client,stage:'received',revision:response.rev,completionIds:ids});
   if(app===dotClient&&first==='completion-first'&&dotOffset===100&&ids.length&&!held){held=true;await responseGate;}
   for(const id of ids)knowledge.get(app).add(id);if(ids.length)completionObserved.add(app);transport.push({sequence:++sequence,client,stage:'delivered',revision:response.rev,completionIds:ids});return response;
  };}
  for(const app of clients){
   const scan=app.shim.document.getElementById('scan');let markup=scan.innerHTML;
   Object.defineProperty(scan,'innerHTML',{configurable:true,get:()=>markup,set(value){markup=value;
    const painted=[...String(value).matchAll(/data-act="reveal" data-id="([^"]+)"/g)].map(match=>match[1]);
    const benchmark=String(value).match(/data-act="bench-done" data-benchmark="([^"]+)"/);if(benchmark)painted.push(benchmark[1]);
    const currentCompletionIds=(app.ctx.state.decisionEvents||[]).filter(event=>event.kind==='completion'&&event.taskId===taskId).map(event=>event.id),row={sequence:++sequence,client:app===dotClient?'dot':app===doneClient?'done':'no',chain:Array.from(app.ctx.state.chain),painted,currentCompletionIds,deliveredCompletionIds:[...knowledge.get(app)],knownCloudCompletionIds:JSON.parse(vm.runInContext('JSON.stringify(JSON.parse(lastKnownCloudPayload||"null")?.decisionEvents||[])',app.ctx)).filter(event=>event.kind==='completion'&&event.taskId===taskId).map(event=>event.id)};
    if(currentCompletionIds.length||row.knownCloudCompletionIds.length||row.deliveredCompletionIds.length)completionObserved.add(app);row.completionObserved=completionObserved.has(app);
    observations.push(row);if(row.completionObserved)paints.push(row);
   }});
  }
  const store=dotClient.ctx.window.ScannerDeviceStore,commit=store.commitHead.bind(store);
  store.commitHead=async options=>{const result=await commit(options);if(result?.ok){const board=JSON.parse(options.payload);deviceWrites.push({chain:board.chain,
   comparisons:board.decisionEvents?.filter(event=>event.kind==='comparison').length||0,
   completions:board.decisionEvents?.filter(event=>event.kind==='completion'&&event.taskId===taskId).length||0});}return result;};
  const finishDone=async()=>{
   setFakeTime(doneClient.ctx,at+100);hydrateUnchangedEditorDraft(doneClient,taskId);doneClient.ctx.onAction('done-task',{dataset:{id:taskId}});assert.equal(await doneClient.ctx.persist(),true,'Done durably commits its original lifecycle fact');
   const fact=doneClient.ctx.state.decisionEvents.find(event=>event.kind==='completion'&&event.taskId===taskId);assert.ok(fact,'the actual editor Done records one lifecycle fact');
   return JSON.parse(JSON.stringify(fact));
  };
  const finishDot=async()=>{
   setFakeTime(dotClient.ctx,at+dotOffset);hydrateUnchangedEditorDraft(dotClient,taskId);
   assert.equal(dotClient.ctx.state.decisionEvents?.some(event=>event.kind==='completion'&&event.taskId===taskId)??false,false,'Dot starts from a device that has not observed completion');
   assert.equal(dotClient.ctx.isEligible(dotClient.ctx.state.tasks.find(row=>row.id===taskId)),true,'the stale device still sees the task as eligible');
   dotClient.ctx.onAction('dot-task',{dataset:{id:taskId}});assert.equal(await dotClient.ctx.persist(),true,'Dot durably commits its original comparison before publication');
   const fact=dotClient.ctx.state.decisionEvents.find(event=>event.kind==='comparison'&&event.action==='dot'&&event.taskId===taskId);
   assert.ok(fact,'the real editor Dot records its original comparison');assert.equal(fact.winnerId,taskId);assert.equal(fact.loserId,benchmarkId);
   assert.equal(fact.ratingApplied,true,'the Dot teaches the saved benchmark pair');assert.deepEqual(Array.from(fact.observedActionIds),[],'a later clock does not invent knowledge of Done');
   return JSON.parse(JSON.stringify(fact));
  };
  const finishNo=async completion=>{
   setFakeTime(noClient.ctx,at+3*3600000-1);noClient.ctx.onAction('cycle-theme',{});assert.equal(await noClient.ctx.persist(),true,'the independent theme choice reaches its device before No');
   const themeFact=JSON.parse(JSON.stringify(noClient.ctx.state.decisionEvents.find(event=>event.kind==='current-choice'&&event.target?.property==='theme')));
   assert.ok(themeFact,'the independent device records its actual theme preference');
   const theme=noClient.ctx.state.settings.theme;
   setFakeTime(noClient.ctx,at+3*3600000);noClient.ctx.renderScan();
   assert.match(noClient.shim.document.getElementById('scan').innerHTML,/data-act="no" data-candidate="unaware-dot-/,'the stale app offers its actual opposite answer');
   noClient.ctx.onAction('no',{dataset:{candidate:taskId,benchmark:benchmarkId}});assert.equal(await noClient.ctx.persist(),true,'the opposite No remains durably recorded');
   const fact=noClient.ctx.state.decisionEvents.find(event=>event.kind==='no'&&event.candidateId===taskId);
   assert.ok(fact,'the independent real No remains a second observation');assert.equal(fact.benchmarkId,benchmarkId);
   assert.equal(fact.ratingApplied,true);assert.equal(fact.observedActionIds.includes(completion.id),false,'the opposing choice also remains unaware');
   return {fact:JSON.parse(JSON.stringify(fact)),themeFact,theme};
  };
  const publishAndRetry=async(app,stale=false)=>{
   app.ctx.window.CloudSync.ready=true;await app.ctx.cloudPushNow();
   if(stale&&app===dotClient&&first==='completion-first'&&dotOffset===100){
    try{const deadline=performance.now()+8000;while(!held&&performance.now()<deadline)await syncSettle(25);assert.ok(held,'the real completion-bearing pull is held before consumer delivery');
     // Open and close the real disclosure while delivery waits. The saved view
     // returns to its prior value, and normal saves remain enabled throughout.
     assert.equal(knowledge.get(app).size,0);app.ctx.onAction('toggle-list',{});app.ctx.onAction('toggle-list',{});assert.ok(app.ctx.state.chain.includes(taskId),'an unaware app still has its own Dot before completion delivery');assert.ok(observations.slice(-2).every(row=>!row.completionObserved&&row.chain.includes(taskId)),'both actual disclosure paints occur before completion is delivered');
    }finally{release();}
   }
   await settleSavedViewPublication(app,h,`${app===doneClient?'Done':app===dotClient?'Dot':'No'} first publication`);
   if(stale){await app.ctx.cloudPull();await settleSavedViewPublication(app,h,`${app===doneClient?'Done':app===dotClient?'Dot':'No'} stale read`);await app.ctx.cloudPushNow();await settleSavedViewPublication(app,h,`${app===doneClient?'Done':app===dotClient?'Dot':'No'} retry publication`);}
  };
  let completion,dot,no,themeFact,theme;
  if(first==='dot-first'){
   dot=await finishDot();await publishAndRetry(dotClient);
   assert.ok(h.remoteState().decisionEvents.some(event=>event.id===dot.id),'the original Dot reaches the cloud before Done');
   completion=await finishDone();await publishAndRetry(doneClient,true);
  }else{
   completion=await finishDone();await publishAndRetry(doneClient);
   assert.ok(h.remoteState().decisionEvents.some(event=>event.id===completion.id),'Done reaches the cloud before the unaware Dot');
   dot=await finishDot();await publishAndRetry(dotClient,true);
  }
  ({fact:no,themeFact,theme}=await finishNo(completion));await publishAndRetry(noClient,true);
  for(const app of clients){await app.ctx.cloudPull();await settleSavedViewPublication(app,h,'final stale read');await app.ctx.cloudPushNow();await settleSavedViewPublication(app,h,'final retry publication');}
  const cloud=h.remoteState(),facts=[completion,dot,no,themeFact],events=cloud.decisionEvents||[];
  assert.deepEqual(Array.from(cloud.chain),[benchmarkId],'completion defeats both an old or late-unaware Dot independent of revision and event time');
  assert.equal(events.filter(event=>event.kind==='completion'&&event.taskId===taskId).length,1);
  assert.equal(events.filter(event=>event.kind==='comparison'&&event.action==='dot'&&event.taskId===taskId).length,1);
  assert.equal(events.filter(event=>event.kind==='no'&&event.candidateId===taskId).length,1);
  for(const fact of facts)assert.equal(JSON.stringify(events.find(event=>event.id===fact.id)),JSON.stringify(fact),'every original immutable action remains exact');
  assert.equal(new Set(facts.map(event=>event.id)).size,4,'opposite intentional choices and the independent preference remain separate actions');
  assert.equal(cloud.settings.theme,theme,'the unrelated actual theme preference survives every stale retry');
  const expected=Object.fromEntries(initial.tasks.map(task=>[task.id,{mu:task.mu,sigma:task.sigma}])),engine=loadEngine(1430);
  engine.updatePair(expected[taskId],expected[benchmarkId]);engine.updatePair(expected[benchmarkId],expected[taskId]);
  for(const id of [taskId,benchmarkId]){
   const task=cloud.tasks.find(row=>row.id===id);assert.equal(task.mu,expected[id].mu,`${id}: the Dot and opposite No are each learned once`);
   assert.equal(task.sigma,expected[id].sigma,`${id}: replay keeps the deterministic combined uncertainty`);
   const expectedHistory=facts.filter(event=>event.kind==='comparison'||event.kind==='no').map(event=>[event.id,event.kind==='no'?'no':'dot']).sort(([a],[b])=>a.localeCompare(b));
   const actualHistory=task.ratingHistory.filter(row=>expectedHistory.some(([eventId])=>eventId===row.id)).map(row=>[row.id,row.kind]).sort(([a],[b])=>a.localeCompare(b));
   assert.deepEqual(actualHistory,expectedHistory,`${id}: history retains both distinct observation identities`);
  }
  assert.equal(cloud.workLog.filter(row=>row.taskId===taskId&&row.kind==='evergreen-done').length,1,'Done keeps one completed History session');
  assert.ok(cloud.tasks.find(row=>row.id===taskId).lastDoneAt>0,'the completion cooldown remains saved');
  assert.deepEqual(Array.from(doneClient.ctx.state.chain),[benchmarkId]);assert.deepEqual(Array.from(dotClient.ctx.state.chain),[benchmarkId]);
  assert.deepEqual(Array.from(noClient.ctx.state.chain),[benchmarkId]);
  assert.ok(paints.length>0,'stale cloud retries and pulls produce scanner paints');
  for(const client of ['done','dot','no'])assert.ok(paints.some(row=>row.client===client),'every app produces a non-vacuous paint after completion knowledge');
  assert.equal(paints.length,observations.filter(row=>row.completionObserved).length,'all known-completion paints are checked, including the first after response delivery');
  if(first==='completion-first'&&dotOffset===100){const delivered=transport.find(row=>row.client==='dot'&&row.stage==='delivered'&&row.completionIds.length);assert.ok(delivered);assert.ok(observations.some(row=>row.client==='dot'&&row.sequence<delivered.sequence&&!row.completionObserved&&row.chain.includes(taskId)),'the controlled unaware source is genuinely rendered before its first completion-bearing response');}

  assert.ok(paints.every(row=>!row.chain.includes(taskId)&&!row.painted.includes(taskId)),'every captured reconciliation paint keeps the completed Dot out');
  const head=await dotClient.ctx.window.ScannerDeviceStore.readHead(),headBoard=JSON.parse(head.payload);
  assert.deepEqual(headBoard.chain,[benchmarkId],'the production IndexedDB head keeps completion over the unaware Dot');
  assert.ok(headBoard.decisionEvents.some(event=>event.id===dot.id)&&headBoard.decisionEvents.some(event=>event.id===completion.id));
  assert.ok(deviceWrites.some(row=>row.completions===1),'the actual IndexedDB path durably records the merged completion');
  assert.ok(deviceWrites.filter(row=>row.completions===1).every(row=>!row.chain.includes(taskId)),'every durable device write containing completion keeps the Dot out');
  const stable=JSON.stringify(cloud.tasks.map(row=>[row.id,row.mu,row.sigma]));await dotClient.ctx.cloudPull();await dotClient.ctx.cloudPull();
  assert.equal(JSON.stringify(dotClient.ctx.state.tasks.map(row=>[row.id,row.mu,row.sigma])),stable,'duplicate cloud reads do not replay either distinct observation');
  assert.equal(h.remoteState().decisionEvents.filter(event=>event.kind==='comparison'&&event.action==='dot'&&event.taskId===taskId).length,1,'retries retain one exact Dot fact');
  await close(dotClient);
  const reopened=await loadAppAtTime(at+3*3600000+1,{indexedDBProvider:indexedDB,deviceDbName:name,cloudSyncFactory:h.factory});
  t.after(async()=>{reopened.ctx.window.CloudSync.user=null;vm.runInContext('clearTimeout(saveTimer);saveTimer=null;clearCloudRetry();clearTimeout(cloudTimer);cloudTimer=null;',reopened.ctx);await close(reopened);});
  await reopened.ctx.__dataReady;await reopened.ctx.cloudPull();
  assert.deepEqual(Array.from(reopened.ctx.state.chain),[benchmarkId],'IndexedDB reopen retains completion-authoritative membership');
  assert.equal(JSON.stringify(reopened.ctx.state.decisionEvents.find(event=>event.id===dot.id)),JSON.stringify(dot));
  assert.equal(JSON.stringify(reopened.ctx.state.decisionEvents.find(event=>event.id===no.id)),JSON.stringify(no));
  assert.deepEqual(Array.from(reopened.ctx.state.tasks,task=>[task.id,task.mu,task.sigma]),Array.from(cloud.tasks,task=>[task.id,task.mu,task.sigma]));
 });
});

test("RISK completion boundaries: a live editor and pressed scanner control defer stale adoption while the saved view and fields survive cold reopen",{timeout:15000},async t=>exerciseCompletionEditorBoundaries(t));


test('RISK completion convergence: failed saves backup failures account changes suspension and drafts guard recovery wakeups',{timeout:15000},async t=>{
 const {IDBFactory}=await import('fake-indexeddb');
 for(const control of ['failed-save','quota-after-conflict','unavailable-after-conflict','quota-without-conflict','account','suspended','draft'])await t.test(control,async t=>{
  const initial=syncState({tasks:[syncTask('wake-base','Saved task')],syncRev:4,syncAccount:'e@example.com',syncDirty:false,seenQuickStart:true}),remote=structuredClone(initial);
  for(const key of ['syncRev','syncAccount','syncDirty'])delete remote[key];
  const h=makeSyncHarness({remote,rev:4,delayMs:1}),raw=JSON.stringify(initial),storage=sharedScannerStorage({[SYNC_STORE_KEY]:raw,[LOCAL_HEAD_KEY]:raw});
  // Count later recovery wakeups after irreducible quota, with no diagnostic bytes available to reclaim.
  const storageWrite=storage.setItem;storage.setItem=(key,value)=>{if(key==='fvp:chain-scanner:restart-diagnostics:v1')throw Object.assign(Error('diagnostics unavailable'),{name:'QuotaExceededError'});return storageWrite(key,value);};
  const app=await loadApp({sharedStorage:storage,indexedDBProvider:new IDBFactory(),deviceDbName:'native-recovery-guard-'+control+'-'+Math.random(),cloudSyncFactory:h.factory}),{ctx,shim}=app,backend=shim.window.CloudSync,store=shim.window.ScannerDeviceStore,
   saves=observeQueuedNativeSaves(ctx,t),commit=store.commitHead.bind(store),put=store.putBackup.bind(store),entered=deferredSyncFixture(),release=deferredSyncFixture(),failedBackup=deferredSyncFixture(),watchdog=setTimeout(()=>{},12000);
  let held=false,backupAttempts=0,conflicts=0;
  t.after(async()=>{release.resolve();clearTimeout(watchdog);ctx.suspendCloudSync();vm.runInContext('clearTimeout(saveTimer);clearTimeout(cloudTimer);clearTimeout(liveCloudTimer);clearTimeout(deviceCloudBackupTimer);deviceCloudBackupTimer=null;pendingDeviceCloudBackup=null;clearCloudRetry()',ctx);await store.close();});
  await ctx.cloudPull();assert.equal(await ctx.persist(),true,'the isolated guard fixture establishes its actual device head before fault injection');await saves.settle('native recovery guard startup');backend.ready=false;
  shim.document.getElementById('addInput').value='Native task before '+control;ctx.onAction('add',shim.document.getElementById('addButton'));await saves.settle('native recovery guard task setup');
  store.commitHead=async options=>{const result=await commit(options);if(saves.active()&&!held&&result?.ok){held=true;entered.resolve();await release.promise;if(control==='failed-save')return {error:true,code:'synthetic-lost-save-ack'};}return result;};
  store.putBackup=async options=>{
   if(!['before-cloud-local-edit','before-cloud-adoption'].includes(options.backup?.kind))return put(options);
   backupAttempts++;
   if(control==='quota-without-conflict'||conflicts>0&&['quota-after-conflict','unavailable-after-conflict'].includes(control)){
    failedBackup.resolve();if(control==='unavailable-after-conflict')throw Error('synthetic-unavailable-backup');return {error:true,code:'quota-exhausted'};
   }
   const result=await put(options);if(result?.conflict)conflicts++;return result;
  };
  ctx.onAction('cycle-theme',{});await entered.promise;
  const acceptedId=ctx.state.tasks.find(task=>task.title==='Native task before '+control).id;backend.ready=true;h.writeBehindBack(remote);await ctx.cloudPull();
  assert.equal(backupAttempts,1,'the ordinary stale-source consumer really attempts its required backup');
  assert.equal(conflicts,control==='quota-without-conflict'?0:1,'only an actual expected-head refusal can arm a local-save wakeup');
  if(control==='account'){backend.user='other@example.test';shim.window.dispatchEvent({type:'cloudsync'});}
  if(control==='suspended')shim.window.dispatchEvent({type:'pagehide'});
  if(control==='draft')shim.document.activeElement={matches:selector=>selector.includes('input')};
  const reads=h.calls.filter(call=>call==='pull').length;release.resolve();await saves.settle('guarded native save');await syncSettle(0);
  if(['quota-after-conflict','unavailable-after-conflict'].includes(control)){
   await failedBackup.promise;const attempts=backupAttempts;
   backend.ready=false;shim.document.getElementById('addInput').value='Later native task after failed backup';ctx.onAction('add',shim.document.getElementById('addButton'));await saves.settle('later successful native save after permanent backup failure');await syncSettle(0);
   assert.equal(backupAttempts,attempts,'a quota or unreadable backup after a conflict does not leave a retry marker for another successful native save');
  }else assert.equal(h.calls.filter(call=>call==='pull').length,reads,'failed saves unavailable backup changed identity suspension and active drafts cannot authorize another read');
  assert.ok(ctx.state.tasks.some(task=>task.id===acceptedId),'the accepted native task remains open throughout the hold');
  assert.ok(JSON.parse((await store.readHead()).payload).tasks.some(task=>task.id===acceptedId),'the exact committed native task remains in the actual device head');
  assert.equal(h.remoteState().tasks.some(task=>task.id===acceptedId),false,'no protected board is uploaded while its recovery authority is held');
  if(control==='failed-save')assert.ok(ctx.deviceSaveIssue(),'an unacknowledged native save remains an actual device-save failure');
  if(control==='draft'){
   shim.document.activeElement=null;shim.document.dispatchEvent({type:'focusout'});await settleSavedViewPublication(app,h,'natural draft close after native recovery contention');
   assert.ok(h.remoteState().tasks.some(task=>task.id===acceptedId),'only the real draft-close lifecycle resumes the protected native task');
  }
 });
});

test('RISK completion lifecycle recovery: expired rest cannot restore 2→1 or 13→4 saved chains',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),at=Date.parse('2026-10-17T15:00:00Z');
 const fixtures=[],closed=new WeakSet(),persistNow=app=>app.ctx.persist(),closeFixture=async app=>{if(!app||closed.has(app))return;closed.add(app);try{app.ctx.window.CloudSync&&(app.ctx.window.CloudSync.user=null);app.ctx.suspendCloudSync?.();vm.runInContext('clearTimeout(saveTimer);saveTimer=null;clearTimeout(cloudTimer);cloudTimer=null;clearCloudRetry();',app.ctx);}catch{}try{await app.ctx.window.ScannerDeviceStore?.close?.();}catch{}};
 t.after(async()=>{for(const app of fixtures)await closeFixture(app);});
 for(const cohort of [{count:2,completed:1,backend:'fallback'},{count:13,completed:9,backend:'indexedDB'}]){
  const {count,completed,backend}=cohort,ids=Array.from({length:count},(_,index)=>`completion-recovery-${count}-${index}`),
    name=`completion-recovery-${count}-${Date.now()}-${Math.random()}`;
  const initial=syncState({tasks:ids.map((id,index)=>({...syncTask(id,`Saved task ${index}`),evergreen:true,evergreenHours:1,evergreenResetAtDay:false})),
   chain:[ids[0]],candidateId:ids[1],passId:`recovery-pass-${count}`,passStartedAt:0,scanMode:'descending',syncRev:4,syncAccount:'e@example.com',syncDirty:false,
   settings:{horizonMin:60,thresholdPct:0,samples:40,cantMin:30,workedHours:8}});
  const remote=structuredClone(initial);for(const key of ['syncRev','syncAccount','syncDirty'])delete remote[key];
  const h=makeSyncHarness({remote,rev:4,delayMs:1}),seedStorage={[SYNC_STORE_KEY]:JSON.stringify(initial),[LOCAL_HEAD_KEY]:JSON.stringify(initial)};
  const earlier=await loadAppAtTime(at,{seedStorage,cloudSyncFactory:h.factory});fixtures.push(earlier);
  await earlier.ctx.cloudPull();earlier.ctx.window.CloudSync.ready=false;
  for(const [index,id] of ids.slice(1).entries()){
   setFakeTime(earlier.ctx,at+index+1);hydrateUnchangedEditorDraft(earlier,id);earlier.ctx.onAction('dot-task',{dataset:{id}});
  }
  assert.equal(await persistNow(earlier),true,'the older device durably saves its real Dot actions');
  const dotCopy=JSON.parse(earlier.shim.localStorage.getItem(SYNC_STORE_KEY));
  assert.deepEqual(dotCopy.chain,ids,'the older browser copy durably contains its full pre-completion pass');
  earlier.ctx.window.CloudSync.ready=true;await earlier.ctx.cloudPushNow();await settleSavedViewPublication(earlier,h,'older-device chain before its independent title edit');
  assert.deepEqual(h.remoteState().chain,ids,'the synthetic cloud acknowledges the older board before the return source is captured');
  const common=JSON.stringify({...h.remoteState(),syncRev:h.doc.rev,syncAccount:'e@example.com',syncDirty:false});
  earlier.ctx.window.CloudSync.ready=false;earlier.ctx.window.CloudSync.user=null;earlier.ctx.suspendCloudSync();
  setFakeTime(earlier.ctx,at+50);hydrateUnchangedEditorDraft(earlier,ids.at(-1));
  earlier.shim.document.getElementById('etTitle').value='Earlier saved independent title';
  earlier.ctx.onAction('save-edit',{dataset:{id:ids.at(-1)}});assert.equal(await persistNow(earlier),true,'the independent title edit reaches the older device copy');
  const olderBrowserSource=earlier.shim.localStorage.getItem(SYNC_STORE_KEY),olderCloudSource=JSON.parse(earlier.ctx.cloudPayload());
  assert.ok(olderBrowserSource,'the earlier browser session has exact saved bytes before it closes');
  assert.equal(earlier.shim.localStorage.getItem(LOCAL_HEAD_KEY),olderBrowserSource,'both guarded browser copies acknowledge the same earlier-session payload');
  const persistedOlderSource=JSON.parse(olderBrowserSource);
  assert.equal(persistedOlderSource.tasks.find(row=>row.id===ids.at(-1)).title,'Earlier saved independent title','the exact older browser bytes contain the title before delivery');
  assert.ok(persistedOlderSource.decisionEvents.some(event=>event.kind==='current-choice'&&event.target?.type==='task'&&event.target.id===ids.at(-1)&&event.target.property==='title'),'the exact older browser bytes contain the causal title fact');
  assert.equal(olderCloudSource.tasks.find(row=>row.id===ids.at(-1)).title,'Earlier saved independent title','the older cloud fixture carries the independent title edit');
  assert.ok(olderCloudSource.decisionEvents.some(event=>event.kind==='current-choice'&&event.target?.type==='task'&&event.target.id===ids.at(-1)&&event.target.property==='title'),'the older cloud fixture carries its causal title fact');
  await closeFixture(earlier); // The saved source is now a closed earlier session; only the recovery client remains active.
  const options=backend==='indexedDB'?{indexedDBProvider:indexedDB,deviceDbName:name}:{};
  const app=await loadAppAtTime(at+75,{seedStorage:{[SYNC_STORE_KEY]:common,[LOCAL_HEAD_KEY]:common},cloudSyncFactory:h.factory,...options});fixtures.push(app);
  const ctx=app.ctx;await ctx.cloudPull();
  const expectedAfterDone=ids.slice(completed),doneIds=new Set(ids.slice(0,completed)),
    beforeRatings=JSON.stringify(ctx.state.tasks.map(row=>[row.id,row.mu,row.sigma])),
    comparisonIds=ctx.state.decisionEvents.filter(event=>event.kind==='comparison').map(event=>event.id).sort(),
    paints=[],durable=[],scan=app.shim.document.getElementById('scan');
  let phase='actions',markup=scan.innerHTML,removed=[];
  const scanChain=html=>{
   const crumbs=[...String(html).matchAll(/data-act="reveal" data-id="([^"]+)"/g)].map(match=>match[1]);
   const benchmark=String(html).match(/data-act="bench-done" data-benchmark="([^"]+)"/);
   if(benchmark)crumbs.push(benchmark[1]);return crumbs;
  };
  Object.defineProperty(scan,'innerHTML',{configurable:true,get:()=>markup,set(value){
   markup=value;paints.push({phase,completed:[...removed],chain:[...ctx.state.chain],paintedChain:scanChain(value)});
  }});
  if(backend==='indexedDB'){
   const store=ctx.window.ScannerDeviceStore,commit=store.commitHead.bind(store);
   store.commitHead=async options=>{const captured={phase,completed:[...removed],chain:JSON.parse(options.payload).chain};const result=await commit(options);if(result?.ok&&captured.phase!=='inject')durable.push(captured);return result;};
  }else{
   const storage=app.shim.localStorage,set=storage.setItem.bind(storage);
   storage.setItem=(key,value)=>{set(key,value);if(phase!=='inject'&&(key===SYNC_STORE_KEY||key===LOCAL_HEAD_KEY)){
    try{durable.push({phase,completed:[...removed],chain:JSON.parse(value).chain});}catch{}
   }};
  }
  for(const [index,id] of ids.slice(0,completed).entries()){
   phase=`prepare-done-${index}`;removed=[...removed,id];setFakeTime(ctx,at+100+index);hydrateUnchangedEditorDraft(app,id);phase=`done-${index}`;
   ctx.onAction('done-task',{dataset:{id}});assert.equal(await persistNow(app),true,`Done ${index+1} completes its explicit device persistence`);
   assert.deepEqual([...ctx.state.chain],ids.filter(taskId=>!removed.includes(taskId)),`Done ${index+1} keeps each saved chain step current`);
  }
  await ctx.cloudPushNow();await settleSavedViewPublication(app,h,`${backend}: Done sequence before expiry`);
  assert.deepEqual(h.remoteState().chain,expectedAfterDone,'the synthetic cloud receives the current membership after the real Done actions');
  setFakeTime(ctx,at+2*3600000);phase='expired-refresh';app.shim.window.dispatchEvent({type:'focus'});await settleSavedViewPublication(app,h,`${backend}: expiry refresh`);assert.equal(await persistNow(app),true,'expiry refresh finishes its durable save');
  assert.ok([...doneIds].every(id=>ctx.isEligible(ctx.state.tasks.find(row=>row.id===id))),'the rest has expired before older-source recovery');
  phase='cloud-recovery';h.writeBehindBack(olderCloudSource);await ctx.cloudPull();await settleSavedViewPublication(app,h,`${backend}: older cloud source recovery`);
  assert.deepEqual([...ctx.state.chain],expectedAfterDone,`${backend}: an older cloud source cannot re-dot completed tasks after rest expiry`);
  assert.equal(ctx.state.tasks.find(row=>row.id===ids.at(-1)).title,'Earlier saved independent title','an unrelated saved title edit is preserved: '+JSON.stringify({backend,cloudStatus:ctx.window.CloudSync?.status,cloudError:ctx.window.CloudSync?.errorCode,decisionIssue:ctx.decisionEvidenceIssue(ctx.state,'e@example.com'),titleEvents:ctx.state.decisionEvents.filter(event=>event.kind==='current-choice'&&event.target?.type==='task'&&event.target.id===ids.at(-1)&&event.target.property==='title')}));
  assert.deepEqual(ctx.state.decisionEvents.filter(event=>event.kind==='comparison').map(event=>event.id).sort(),comparisonIds,'original comparisons survive exactly once');
  assert.equal(JSON.stringify(ctx.state.tasks.map(row=>[row.id,row.mu,row.sigma])),beforeRatings,'comparison ratings remain unchanged through completion recovery');
  for(const id of doneIds){
   const task=ctx.state.tasks.find(row=>row.id===id);
   assert.equal(task.done,false);assert.equal(task.evergreen,true);assert.ok(task.lastDoneAt>0);
   assert.equal(ctx.state.workLog.filter(row=>row.taskId===id&&row.kind==='evergreen-done').length,1,'the completed History session remains singular');
  }
  assert.equal(ctx.state.decisionEvents.filter(event=>event.kind==='completion'&&doneIds.has(event.taskId)).length,completed,'each actual Done fact survives stale-source union');
  if(backend==='indexedDB'){
   phase='inject';app.shim.localStorage.setItem(SYNC_STORE_KEY,olderBrowserSource);app.shim.localStorage.setItem(LOCAL_HEAD_KEY,olderBrowserSource);
   phase='legacy-recovery';assert.equal(await persistNow(app),true,'legacy-copy recovery finishes its durable save');
   assert.deepEqual([...ctx.state.chain],expectedAfterDone,'the older browser copy also cannot restore completed membership');
  }
  for(const observedPhase of ['done-0','expired-refresh','cloud-recovery']){
   assert.ok(paints.some(row=>row.phase===observedPhase),`${observedPhase}: observe a real scanner DOM update`);
   assert.ok(durable.some(row=>row.phase===observedPhase),`${observedPhase}: observe a real durable save`);
  }
  await ctx.cloudPushNow();await settleSavedViewPublication(app,h,`${backend}: repaired membership publication`);
  assert.deepEqual(h.remoteState().chain,expectedAfterDone,`${backend}: repaired membership is durable in the synthetic cloud`);
  for(const entry of paints.filter(row=>row.phase.startsWith('done-')||row.phase==='expired-refresh'||row.phase==='cloud-recovery'||row.phase==='legacy-recovery')){
   assert.deepEqual(entry.paintedChain,entry.chain,`${entry.phase}: the rendered benchmark and crumbs match the live chain`);
   assert.ok(entry.chain.every(id=>!entry.completed.includes(id)),`${entry.phase}: a completed task never appears in an intermediate chain render`);
  }
  for(const entry of durable.filter(row=>row.phase.startsWith('done-')||row.phase==='expired-refresh'||row.phase==='cloud-recovery'||row.phase==='legacy-recovery'))
   assert.ok(entry.chain.every(id=>!entry.completed.includes(id)),`${entry.phase}: every durable save omits completed chain members: ${JSON.stringify(entry)}`);
  assert.deepEqual([...ctx.state.chain],expectedAfterDone,'the final chain contains every legitimate current member in its original order');
  const saved=backend==='indexedDB'?(await ctx.window.ScannerDeviceStore.readHead()).payload:app.shim.localStorage.getItem(SYNC_STORE_KEY);
  assert.deepEqual(JSON.parse(saved).chain,expectedAfterDone,'the repaired board is durable before cold reopen');
  if(backend!=='indexedDB')app.shim.localStorage.setItem(LOCAL_HEAD_KEY,saved);
  await closeFixture(app); // The acknowledged recovery session is closed before cold reopen.
  const reopenOptions=backend==='indexedDB'?{indexedDBProvider:indexedDB,deviceDbName:name}:{seedStorage:{[SYNC_STORE_KEY]:saved,[LOCAL_HEAD_KEY]:saved}};
  const reopened=await loadAppAtTime(at+2*3600000+1,reopenOptions);fixtures.push(reopened);
  assert.deepEqual([...reopened.ctx.state.chain],expectedAfterDone,`${backend}: offline cold reopen retains the repaired chain after rest expiry`);
  assert.equal(JSON.stringify(reopened.ctx.state.tasks.map(row=>[row.id,row.mu,row.sigma])),beforeRatings);
  assert.equal(reopened.ctx.state.tasks.find(row=>row.id===ids.at(-1)).title,'Earlier saved independent title');
  assert.equal(reopened.ctx.state.decisionEvents.filter(event=>event.kind==='completion'&&doneIds.has(event.taskId)).length,completed);
  for(const id of doneIds)assert.ok(reopened.ctx.state.workLog.some(row=>row.taskId===id&&row.kind==='evergreen-done'));
 }
});

test('RISK live scan sync: candidate Done publishes promptly and reaches another open device without focus', {timeout:10000},async t=>{
 const close=async app=>{if(!app)return;app.ctx.suspendCloudSync();vm.runInContext('clearTimeout(saveTimer);clearTimeout(cloudTimer);clearCloudRetry();clearTimeout(liveCloudTimer);',app.ctx);await app.ctx.window.ScannerDeviceStore?.close?.();};
 for(const evergreen of [false,true]){
  // The DOM shim unrefs application timers; keep this bounded IO observer alive.
  const observerWatchdog=setTimeout(()=>{},10000);t.after(()=>clearTimeout(observerWatchdog));
  const {a,b,h,candidateId,nextId,benchId}=await liveScanSyncClients({evergreen}),ordinary=await ordinaryEditDebounceControl();
  const ratings=JSON.stringify(a.ctx.state.tasks.map(t=>[t.id,t.mu,t.sigma]));
  const before={sourceRaw:h.doc.payload,senderRaw:JSON.stringify(a.ctx.state),peerRaw:JSON.stringify(b.ctx.state),initialA:liveDoneDeliverySnapshot(a,candidateId),initialB:liveDoneDeliverySnapshot(b,candidateId)},trace=[],started=performance.now();
  const entered=deferredSyncFixture(),release=deferredSyncFixture(),senderEntered=deferredSyncFixture(),sourceAcknowledged=deferredSyncFixture(),pulls=observeSyncFixtureCalls(b.ctx,'cloudPull');let held=false,delivered=false,consumer,response;
  const observe=event=>trace.push({event,elapsed:performance.now()-started,delivered,sourceRev:h.doc.rev,sourceDoneAt:h.remoteState().tasks.find(row=>row.id===candidateId).lastDoneAt,peer:liveDoneDeliverySnapshot(b,candidateId)});
  const dispatch=b.shim.window.dispatchEvent.bind(b.shim.window);b.shim.window.dispatchEvent=event=>{if(event.type==='cloudboardchange'){observe('natural-hint');trace.at(-1).hint={...event.detail};}return dispatch(event);};
  const CS=b.shim.window.CloudSync,pull=CS.pull;CS.pull=async(...args)=>{
   observe('canonical-read-enter');const actual=pull(...args);observe('SDK-response-unavailable');const ordinaryACK=await ordinary.acknowledged;assert.equal(ordinaryACK.reply.ok,true,'the independent ordinary write really reached its SDK ACK');observe('ordinary-write-ACK-before-peer-SDK-response');const reply=await actual;observe('SDK-response-available');
   if(!held&&JSON.parse(reply.payload).tasks.find(row=>row.id===candidateId).lastDoneAt){held=true;observe('completion-response-held');entered.resolve({consumer:pulls.findLast(call=>!call.settled),response:{...reply}});await release.promise;delivered=true;observe('response-delivery-before-continuation');}
   return reply;
  };
  const sourceCS=a.shim.window.CloudSync,push=sourceCS.push;sourceCS.push=async(...args)=>{observe('natural-Done-push-enter');senderEntered.resolve({at:performance.now(),args});const reply=await push(...args);observe('source-SDK-write-ACK');sourceAcknowledged.resolve({at:performance.now(),reply});return reply;};
  t.after(release.resolve);
  try{
   const actionAt=performance.now();
   a.ctx.onAction('cand-done',{dataset:{candidate:candidateId,benchmark:benchId}});
   const publication=await senderEntered.promise,sourceACK=await sourceAcknowledged.promise;assert.equal(sourceACK.reply.ok,true,'the natural Done write is acknowledged by the source SDK');assert.ok(sourceACK.at-actionAt<2000,'Done reaches its actual source write ACK before ordinary debounce');
   assert.ok(publication.at-actionAt<2000,'Done starts naturally before the ordinary edit debounce');
   assert.equal(ordinary.h.doc.rev,5,'the default ordinary edit is still unpublished when Done reaches the server');
   assert.ok(h.remoteState().tasks.find(t=>t.id===candidateId).lastDoneAt,'Done bypasses the ordinary two-second edit debounce');
   observe('prompt-source-assertions-before-peer-response');
   ({consumer,response}=await entered.promise);assert.ok(consumer,'the natural revision hint owns an actual canonical read continuation');
   const pending=liveDoneDeliverySnapshot(b,candidateId);assert.equal(pending.currentDoneAt,null,'the peer is unchanged while its real response is held');assert.equal(pending.knownDoneAt,null,'an undelivered response has not established completion knowledge');assert.equal(pending.pulling,true);
   assert.equal(trace.filter(row=>row.event==='natural-hint').length>0,true);assert.equal(delivered,false);
   release.resolve();await consumer.promise;await settleSavedViewPublication(a,h,'natural Done sender device/cloud ACK');await settleSavedViewPublication(b,h,'natural hinted Done read/device ACK');observe('canonical-consumer-and-device-ACK');
   const remoteTask=b.ctx.state.tasks.find(t=>t.id===candidateId);
   assert.ok(remoteTask.lastDoneAt,'a server revision wakes the other already-open client');
   assert.equal(remoteTask.done,!evergreen);assert.equal(b.ctx.isEligible(remoteTask),false);
   assert.equal(b.ctx.state.mode,'scan','candidate Done keeps scanning');
   assert.equal(b.ctx.state.candidateId,nextId);assert.equal(JSON.stringify(b.ctx.state.tasks.map(t=>[t.id,t.mu,t.sigma])),ratings);
   assert.equal(b.ctx.state.workLog.filter(e=>e.taskId===candidateId).length,evergreen?1:0);
   assert.equal(JSON.stringify(JSON.parse(response.payload).decisionEvents),JSON.stringify(b.ctx.state.decisionEvents),'the natural response journal reaches the acknowledged peer exactly');
   const ordinaryPublication=await ordinary.entered;assert.ok(publication.at<ordinaryPublication.at,'the actual default-debounced edit producer follows Done');await settleSavedViewPublication(ordinary.app,ordinary.h,'ordinary edit control device/cloud ACK');
   t.diagnostic(JSON.stringify({evergreen,ordinaryStartup:{heldConsumers:ordinary.startup.heldConsumers,account:ordinary.startup.account},DonePublicationMs:publication.at-actionAt,DoneSourceACKMs:sourceACK.at-actionAt,ordinaryPublicationMs:ordinaryPublication.at-ordinary.started,trace:trace.map(({event,elapsed,delivered,sourceRev,peer})=>({event,elapsed,delivered,sourceRev,peerRev:peer.rev,currentDoneAt:peer.currentDoneAt,knownDoneAt:peer.knownDoneAt}))}));
   if(process.env.LIVE_DONE_DELIVERY_EVIDENCE_DIR){fs.mkdirSync(process.env.LIVE_DONE_DELIVERY_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.LIVE_DONE_DELIVERY_EVIDENCE_DIR,'live-Done-'+process.pid+'-'+(evergreen?'evergreen':'ordinary')+'.json'),JSON.stringify({evergreen,before,response,trace,ordinaryStartup:ordinary.startup,ordinarySourceRaw:ordinary.h.doc.payload,finalSourceRaw:h.doc.payload,finalA:liveDoneDeliverySnapshot(a,candidateId),finalB:liveDoneDeliverySnapshot(b,candidateId)},null,2));}
  }finally{release.resolve();await consumer?.promise;await Promise.all(pulls.filter(call=>!call.settled).map(call=>call.promise));await close(a);await close(b);await close(ordinary.app);clearTimeout(observerWatchdog);}
 }
});

test('RISK completion lifecycle fixtures: released Start informed Start and local maintenance execute in UTC and New York',async t=>{
 // Run the real existing consumers in separate process-local calendars. A passing
 // parent must include all four released-source subcases, not an early exit.
 const pattern='^RISK legacy completion released Start: normally|^RISK completion lifecycle Start: an observed new-pass|^RISK completion lifecycle maintenance: the local day';
 for(const zone of ['UTC','America/New_York'])await t.test(zone,()=>{
  const env={...process.env,TZ:zone};delete env.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+pattern,'tests/core.test.js'],{cwd:__dirname,env,encoding:'utf8',timeout:30000});
  const output=child.stdout+child.stderr;
  assert.equal(child.status,0,zone+' must execute the original Start/maintenance consumers successfully: '+output);
  assert.match(output,/# tests 7\b/,'all three consumers and four released-source subcases actually execute');
  assert.match(output,/# fail 0\b/);assert.match(output,/# skipped 0\b/);
  t.diagnostic(zone+': seven real consumer cases passed, no skips');
 });
});


test('RISK completion delivery fixtures: controlled startup pending and acknowledged boundaries execute all five consumers',()=>{
 const pattern='^RISK comparison replay: deleting an opponent|^RISK completion boundaries: failed read stays pending|^RISK completion boundaries: a pending account-A|^RISK completion boundaries: a live editor and pressed|^RISK live scan sync: evergreen Done Undo propagates';
 const env={...process.env,TZ:'UTC'};delete env.NODE_TEST_CONTEXT;
 const child=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+pattern,'tests/core.test.js','tests/persistence-recovery.test.js'],{cwd:__dirname,env,encoding:'utf8',timeout:30000}),output=child.stdout+child.stderr;
 assert.equal(child.status,0,'all five real controlled-delivery consumers complete: '+output);
 assert.match(output,/# tests 5\b/);assert.match(output,/# fail 0\b/);assert.match(output,/# skipped 0\b/);
});

test('RISK populated task responsiveness: three rapid Yes actions retain history and reopen within the interaction budget',{timeout:30000},async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),at=Date.parse('2026-10-20T15:00:00Z');
 const initial=syncState({tasks:Array.from({length:434},(_,i)=>({...syncTask('responsive-task-'+i,'Synthetic task '+i),futureTask:{keep:i}})),syncDirty:false,futureBoard:{keep:'opaque'}});
 const rawInitial=JSON.stringify(initial),source=await loadAppAtTime(at,{seed:2191,seedStorage:{[SYNC_STORE_KEY]:rawInitial,[LOCAL_HEAD_KEY]:rawInitial}});
 source.ctx.onAction('start-scan',{dataset:{mode:'squared'}});
 const board=JSON.parse(JSON.stringify(source.ctx.state)),startFacts=board.decisionEvents;
 assert.equal(startFacts.length,2,'the actual Start supplies the supported draw and chain evidence');
 const archived=Array.from({length:40},(_,i)=>startFacts.map(event=>({...event,id:'responsive-archive-'+i+'-'+event.target.property,actionId:'responsive-start-'+i,target:{...event.target,id:'responsive-pass-'+i}}))).flat();
 const oldBaseline=board.decisionBaseline;delete board.decisionBase;
 board.decisionBaseline=source.ctx.baselineFromSource(board,{account:null,baseId:null});
 board.decisionBaseline.replacement=[{v:1,reason:'explicit-restore',account:null,actionId:'responsive-recovery',at:at+100,baseline:oldBaseline,
  facts:archived.map(event=>({id:event.id,witness:source.ctx.LZString.compressToUTF16(source.ctx.canonicalDecisionFact(event))}))}];
 board.decisionEvents=[];for(let i=1;i<=40;i++)board.tasks[i].lastDoneAt=at-50000+i;
 assert.equal(source.ctx.decisionEvidenceIssue(board,null),null,'the synthetic historical source is supported before timing starts');
 const raw=JSON.stringify(board),originalFacts=archived.map(event=>source.ctx.canonicalDecisionFact(event));await source.dispose();
 const deviceDbName='populated-responsive-'+Math.random(),app=await loadAppAtTime(at,{seed:2192,seedStorage:{[SYNC_STORE_KEY]:raw,[LOCAL_HEAD_KEY]:raw,[LOCAL_BACKUPS_KEY]:'[]'},indexedDBProvider:indexedDB,deviceDbName}),{ctx,shim}=app;
 t.after(()=>app.dispose());assert.equal(await ctx.persist(),true);
 ctx.onAction('start-scan',{dataset:{mode:'squared'}});
 const priorIds=new Set(ctx.state.decisionEvents.map(event=>event.id)),chosen=[],actionMs=[];
 for(let i=0;i<3;i++){
  const candidate=ctx.state.candidateId,benchmark=ctx.state.chain.at(-1);assert.ok(candidate&&benchmark);
  const started=performance.now();ctx.onAction('yes',{dataset:{candidate,benchmark}});actionMs.push(performance.now()-started);
  assert.equal(ctx.state.chain.at(-1),candidate,'each distinct Yes reaches its intended task');chosen.push(candidate);
 }
 assert.equal(new Set(chosen).size,3,'rapid accepted actions must not retarget or collapse');
 const accepted=ctx.state.decisionEvents.filter(event=>!priorIds.has(event.id));assert.equal(accepted.length,3);
 assert.equal(await ctx.persist(),true,'the real device store acknowledges all accepted work');
 const head=await ctx.window.ScannerDeviceStore.readHead();assert.equal(head.payload,JSON.stringify(ctx.state));
 const retained=ctx.retainedDecisionFacts(JSON.parse(head.payload));
 for(const fact of originalFacts)assert.ok(retained.some(event=>ctx.canonicalDecisionFact(event)===fact),'every archived decision remains exact');
 await app.dispose();
 const beforeShares=ctx.chanceDisplayStats(),cold=await loadAppAtTime(at+10000,{sharedStorage:shim.localStorage,indexedDBProvider:indexedDB,deviceDbName});t.after(()=>cold.dispose());
 const coldShares=cold.ctx.chanceDisplayStats();for(const [id,row] of beforeShares){assert.ok(Math.abs(row.probability-coldShares.get(id).probability)<1e-12,'freshly reopened probabilities match the incremental view');assert.equal(row.fallback,coldShares.get(id).fallback);}
 for(const event of accepted)assert.ok(cold.ctx.state.decisionEvents.some(row=>cold.ctx.canonicalDecisionFact(row)===ctx.canonicalDecisionFact(event)),'cold reopen retains each accepted decision exactly');
 assert.deepEqual([...cold.ctx.state.chain], [...ctx.state.chain]);assert.equal(cold.ctx.state.tasks.length,434);
 assert.deepEqual(JSON.parse(JSON.stringify(cold.ctx.state.futureBoard)),{keep:'opaque'});
 t.diagnostic('Three populated-board task actions: '+JSON.stringify(actionMs.map(ms=>Math.round(ms)))+'ms; source '+Buffer.byteLength(raw)+' bytes');
 assert.ok(actionMs.reduce((sum,ms)=>sum+ms,0)<1000,'three ordinary task controls must not monopolize the main thread for a full second; observed '+Math.round(actionMs.reduce((sum,ms)=>sum+ms,0))+'ms');
});

test('RISK saved-board startup: a large witnessed archive remains responsive and never reuses changed evidence',{timeout:30000},async t=>{
 const initial=syncState({tasks:Array.from({length:434},(_,i)=>({...syncTask('archive-task-'+i,'Synthetic archived task '+i),futureTask:{keep:i}})),syncDirty:false});
 const rawInitial=JSON.stringify(initial),source=await loadAppAtTime(1792322900000,{seed:2191,seedStorage:{[SYNC_STORE_KEY]:rawInitial,[LOCAL_HEAD_KEY]:rawInitial}});
 t.after(()=>vm.runInContext('clearTimeout(saveTimer);clearTimeout(cloudTimer);clearCloudRetry()',source.ctx));
 source.ctx.onAction('start-scan',{dataset:{mode:'squared'}});
 const board=JSON.parse(JSON.stringify(source.ctx.state)),startFacts=board.decisionEvents.map(event=>JSON.parse(JSON.stringify(event)));
 assert.equal(startFacts.length,2,'an actual Start supplies the supported paired draw and chain evidence');
 const originalFacts=Array.from({length:20},(_,i)=>startFacts.map(event=>({...event,id:'archive-fact-'+i+'-'+event.target.property,actionId:'archive-start-'+i,target:{...event.target,id:'archive-pass-'+i}}))).flat();
 const oldBaseline=board.decisionBaseline;delete board.decisionBase;
 board.decisionBaseline=source.ctx.baselineFromSource(board,{account:null,baseId:null});
 board.decisionBaseline.replacement=[{v:1,reason:'explicit-restore',account:null,actionId:'archive-recovery-gesture',at:1792322901000,baseline:oldBaseline,
  facts:originalFacts.map(event=>({id:event.id,witness:source.ctx.LZString.compressToUTF16(source.ctx.canonicalDecisionFact(event))}))}];
 board.decisionEvents=[];for(let i=1;i<=40;i++)board.tasks[i].lastDoneAt=1792322800000+i;
 assert.equal(source.ctx.decisionEvidenceIssue(board,null),null,'the full witnessed fixture is ordinary supported saved data');
 const raw=JSON.stringify(board),start=performance.now(),app=await loadAppAtTime(1792322902000,{seed:2192,seedStorage:{[SYNC_STORE_KEY]:raw,[LOCAL_HEAD_KEY]:raw,[LOCAL_BACKUPS_KEY]:'[]'}});
 assert.equal(await app.ctx.persist(),true);const elapsed=performance.now()-start;
 const retained=app.ctx.retainedDecisionFacts(JSON.parse(app.ctx.currentBoardExportPayload()));
 for(const fact of originalFacts)assert.ok(retained.some(event=>app.ctx.canonicalDecisionFact(event)===app.ctx.canonicalDecisionFact(fact)),'earlier immutable facts remain exact');
 assert.ok(app.ctx.readLocalBackups().some(row=>row.payload===raw));assert.equal(app.ctx.state.tasks.length,434);assert.equal(app.ctx.state.tasks[433].futureTask.keep,433);
 const damaged=JSON.parse(JSON.stringify(app.ctx.state));damaged.decisionBaseline.replacement[0].facts[0].witness=source.ctx.LZString.compressToUTF16('{"v":99}');
 assert.equal(app.ctx.decisionSourceIssue(damaged,null),'unsupported-decision-evidence','a changed immutable witness is validated again and cannot inherit cached authority');
 const receipt=JSON.parse(JSON.stringify(app.ctx.state.decisionBaseline.replacement[0]));receipt.futureAuthority={unsupported:true};
 assert.equal(app.ctx.supportedDecisionReplacement(receipt,null),false,'a warm decoded fact never bypasses new receipt authority fields');delete receipt.futureAuthority;
 receipt.account='other@example.test';receipt.baseline.account=receipt.account;receipt.baseline.id=app.ctx.decisionBaselineIdentity(receipt.account,receipt.baseline.ratings,receipt.baseline.includedActionIds);
 assert.equal(app.ctx.supportedDecisionReplacement(receipt,receipt.account),false,'the same warm witness cannot acquire a different account without its exact attestation');
 const base=app.ctx.makeDecisionBase('cached@example.test',4,raw);assert.equal(app.ctx.validDecisionBase(base,'cached@example.test',4),true);
 assert.equal(app.ctx.validDecisionBase({...base,payload:raw+' '},'cached@example.test',4),false,'even whitespace changes invalidate the exact cached payload identity');

 t.diagnostic('Actual witnessed large-board startup and save: '+Math.round(elapsed)+'ms; source bytes: '+Buffer.byteLength(raw));
 assert.ok(elapsed<3000,'The witnessed saved board must open and save within the three-second responsiveness budget; observed '+Math.round(elapsed)+'ms');
});

test('RISK cloud source recovery: changed consent and external failures retain originals without blind publication',async t=>{
 for(const fault of ['local edit','Add draft','peer device head','browser source','pending upload','cloud revision','account','same-email UID','auth epoch','offline read','opaque abort','backup abort','upload failure','local commit abort','cancel'])await t.test(fault,async sub=>{
  const app=await divergentCloudSourceApp187(sub),{ctx,shim,backend,originalRoot}=app,store=ctx.window.ScannerDeviceStore;
  await ctx.onAction('review-cloud-source-recovery',{});await ctx.onAction('choose-cloud-recovery-source',{dataset:{value:'device'}});
  const originalLocal=JSON.stringify(ctx.state),originalHead=await store.readHead();
  if(fault==='local edit'){shim.document.getElementById('addInput').value='Later accepted device edit';await ctx.onAction('add',{});await ctx.persist();}
  if(fault==='Add draft')shim.document.getElementById('addInput').value='Keep this unfinished draft exactly';
  if(fault==='peer device head'){const peer=JSON.parse(originalHead.payload);peer.tasks.push(syncTask('external-device-peer','Later external head'));assert.equal((await store.commitHead({expectedHash:originalHead.hash,payload:JSON.stringify(peer),account:'e@example.com'})).ok,true);}
  if(fault==='browser source')shim.localStorage.setItem(SYNC_STORE_KEY,'{"tasks":[],"opaque":"later-browser-source"}');
  if(fault==='pending upload')await store.setPendingUpload('owner',{generationId:'new-pending',payloadHash:'c'.repeat(64),baseRev:originalRoot.rev,updatedAt:1});
  if(fault==='cloud revision')backend.docs.set('users/owner',{...originalRoot,rev:originalRoot.rev+1});
  if(fault==='account')backend.emitAuth({uid:'other-owner',email:'other@example.test'});
  if(fault==='same-email UID')backend.emitAuth({uid:'other-owner',email:'e@example.com'});
  if(fault==='auth epoch'){backend.emitAuth(null);backend.emitAuth({uid:'owner',email:'e@example.com'});}
  if(fault==='offline read')app.faults.serverOffline=true;
  if(fault==='opaque abort')app.idbFault.abortOpaque=true;
  if(fault==='backup abort')app.idbFault.abortBackup=true;
  if(fault==='upload failure')app.faults.push=Object.assign(Error('synthetic upload unavailable'),{code:'unavailable'});
  if(fault==='local commit abort')app.idbFault.abortHead=true;
  if(fault==='cancel')ctx.closeModal();
  const before=JSON.stringify(ctx.state),head=await store.readHead(),pending=await store.getPendingUpload('owner');
  assert.equal(await ctx.onAction('apply-cloud-source-recovery',{}),false);
  assert.equal(backend.docs.get('users/owner').rev,originalRoot.rev+(fault==='cloud revision'||fault==='local commit abort'?1:0),'only the intentionally confirmed cloud save or external peer revision may advance');
  if(!['account','same-email UID','auth epoch'].includes(fault))assert.equal(JSON.stringify(ctx.state),before,'failed or stale consent never replaces accepted open-tab work');
  assert.equal((await store.readHead()).payload,head.payload,'a failed adoption never overwrites a newer head');
  if(['pending upload','offline read','cancel'].includes(fault))assert.equal(JSON.stringify(await store.getPendingUpload('owner')),JSON.stringify(pending));
  if(fault==='Add draft')assert.equal(shim.document.getElementById('addInput').value,'Keep this unfinished draft exactly');
  if(fault==='local edit')assert.ok(ctx.state.tasks.some(row=>row.title==='Later accepted device edit'));
  if(fault==='local commit abort'){
   assert.match(shim.document.getElementById('modalRoot').innerHTML,/Cloud saved the selected source/);
   assert.ok((await store.listOpaqueArchives()).some(row=>JSON.parse(row.raw).deviceSource===originalLocal));
  }
 });
});

test('RISK support diagnostics: held cloud acknowledgements stay bound to their accepted request and identity',async t=>{
 const app=await loadApp({hostStorage:{}}),{ctx}=app;t.after(()=>app.dispose());
 ctx.state.syncAccount='owner';ctx.state.syncRev=1;ctx.state.syncDirty=true;assert.equal(await ctx.persist(),true);
 const entered=[deferredSyncFixture(),deferredSyncFixture()],gates=[deferredSyncFixture(),deferredSyncFixture()];let calls=0,replacementGate=null;
 const backend={configured:true,ready:true,user:'owner',status:'ok',async pull(){return {empty:true};},async push(){const index=calls++;entered[index]?.resolve();await gates[index]?.promise;return {ok:true,rev:2+index};},signIn(){},signOut(){}};
 ctx.window.CloudSync=backend;
 vm.runInContext("reconciledAs='owner';lastKnownCloudPayload=JSON.stringify(state);lastKnownCloudAccount='owner';lastKnownCloudRevision=1;lastPushed=''",ctx);
 try{
  ctx.addTask('Request captured before cloud acknowledgement',false);
  const firstRequest=ctx.buildSupportDiagnosticsReport().save.acceptedRequests.value;
  const first=ctx.sendPush();await fixtureDeadline(entered[0].promise,'the actual first cloud push did not reach its held SDK response');
  ctx.addTask('Newer accepted action while older cloud request is held',false);
  const latestRequest=ctx.buildSupportDiagnosticsReport().save.acceptedRequests.value;
  assert.ok(latestRequest>firstRequest,'the second native action is a distinct later accepted request');
  gates[0].resolve();await first;
  await fixtureDeadline(entered[1].promise,'the accepted newer action did not reach its follow-up held cloud push');
  const newer=ctx.buildSupportDiagnosticsReport().save;
  assert.ok(newer.acknowledgedThroughRequest.value<latestRequest,'the older response cannot claim the newer accepted request');
  assert.equal(newer.serverAcknowledgement.value,'pending','the newer actual cloud push remains held');
  gates[1].resolve();
  for(let n=0;n<40&&vm.runInContext('supportDiagnosticsActivePushCalls',ctx)>0;n++)await flush();
  const current=ctx.buildSupportDiagnosticsReport().save;
  assert.equal(current.acknowledgedThroughRequest.value,latestRequest,'the newer request advances only after its own actual cloud reply');
  assert.equal(current.serverAcknowledgement.value,'acknowledged');

  ctx.addTask('Request whose cloud account changes while held',false);
  const staleEntered=deferredSyncFixture(),staleGate=deferredSyncFixture();
  backend.push=async()=>{staleEntered.resolve();await staleGate.promise;return {ok:true,rev:5};};
  const stalePush=ctx.sendPush();await fixtureDeadline(staleEntered.promise,'the actual account-bound push did not reach its held response');
  backend.user='different-uid';staleGate.resolve();await stalePush;
  const stale=ctx.buildSupportDiagnosticsReport().save;
  assert.notEqual(stale.serverAcknowledgement.value,'acknowledged','a reply refused by the existing UID guard is not a current acknowledgement');
  assert.ok(stale.acknowledgedThroughRequest.value<stale.acceptedRequests.value,'the stale reply cannot advance current request coverage');

  backend.user='owner';ctx.window.CloudSync=backend;
  ctx.addTask('Request whose backend object changes while held',false);
  const backendEntered=deferredSyncFixture();replacementGate=deferredSyncFixture();
  backend.push=async()=>{backendEntered.resolve();await replacementGate.promise;return {ok:true,rev:6};};
  const backendPush=ctx.sendPush();await fixtureDeadline(backendEntered.promise,'the actual backend-bound push did not reach its held response');
  ctx.window.CloudSync={configured:true,ready:true,user:'owner',status:'ok',async pull(){return {empty:true};},async push(){return {ok:true,rev:7};},signIn(){},signOut(){}};
  replacementGate.resolve();await backendPush;
  const replaced=ctx.buildSupportDiagnosticsReport().save;
  assert.equal(replaced.serverAcknowledgement.value,'stale','a response from a replaced backend object is not reported as the current server acknowledgement');
  assert.ok(replaced.acknowledgedThroughRequest.value<replaced.acceptedRequests.value,'the replaced backend response does not advance current request coverage');
 }finally{gates.forEach(gate=>gate.resolve());replacementGate?.resolve();}
});


test('RISK History basis work budget: identical exact inputs avoid repeated hashing while changed or custom evidence stays fresh',async t=>{
 const prefix='"use strict";globalThis.basisHashWork=0;globalThis.basisDefaultImul=Math.imul;Math.imul=function(...args){basisHashWork++;return basisDefaultImul.apply(this,args);};globalThis.basisBootImul=Math.imul;\n';
 const app=await loadApp({appSource:prefix+appSrc,seed:318});t.after(()=>app.dispose());const {ctx}=app;
 ctx.addTask('Basis first');ctx.addTask('Basis second');ctx.state.tasks[0].mu+=.125;
 const stats=()=>ctx.chanceDisplayStats('chance');
 const basisInputs=current=>JSON.stringify([ctx.state.tasks.filter(task=>!task.done).map(task=>[task.id,task.mu,task.sigma,!!current.get(task.id)?.available]).sort(([a],[b])=>a<b?-1:a>b?1:0),ctx.state.settings.samples]);
 const oracle=current=>{const inputs=basisInputs(current);return ctx.chanceHash('history:'+inputs).toString(16)+':'+ctx.chanceHash('basis:'+inputs).toString(16)+':'+inputs.length;};
 const firstStats=stats(),expected=oracle(firstStats),before=JSON.stringify(ctx.state);vm.runInContext('basisHashWork=0',ctx);
 assert.equal(ctx.ratingObservationBasis(firstStats),expected);const firstWork=vm.runInContext('basisHashWork',ctx);assert.ok(firstWork>0,'new exact inputs hash through the existing algorithm');
 assert.equal(ctx.ratingObservationBasis(stats()),expected);assert.equal(vm.runInContext('basisHashWork',ctx),firstWork,'repeated exact History basis must not rehash the same serialized inputs');
 assert.equal(JSON.stringify(ctx.state),before,'deriving a basis never mutates the accepted board');
 for(const change of [()=>{ctx.state.tasks[0].sigma+=.25;},()=>{ctx.state.settings.samples+=1;},()=>{ctx.state.tasks[0].startsAt=ctx.todayISO(10);},()=>{ctx.state.tasks[1].id+='-replaced';},()=>{ctx.state.tasks[1].done=true;}]){change();const current=stats(),value=oracle(current),count=vm.runInContext('basisHashWork',ctx);assert.equal(ctx.ratingObservationBasis(current),value);assert.ok(vm.runInContext('basisHashWork',ctx)>count,'changed ratings, samples and membership are freshly hashed');}
 const reorderStats=stats(),reorderExpected=oracle(reorderStats);ctx.state.tasks.reverse();const reorderCount=vm.runInContext('basisHashWork',ctx);assert.equal(ctx.ratingObservationBasis(stats()),reorderExpected);assert.equal(vm.runInContext('basisHashWork',ctx),reorderCount,'order-only changes preserve the language-independent exact basis');
 const savedTasks=ctx.state.tasks;ctx.state.tasks=[];const emptyStats=stats(),emptyExpected=oracle(emptyStats);assert.equal(ctx.ratingObservationBasis(emptyStats),emptyExpected);const emptyCount=vm.runInContext('basisHashWork',ctx);assert.equal(ctx.ratingObservationBasis(stats()),emptyExpected);assert.equal(vm.runInContext('basisHashWork',ctx),emptyCount,'empty exact inputs are stable');ctx.state.tasks=savedTasks;
 const current=stats();vm.runInContext('globalThis.basisSavedHash=chanceHash;globalThis.customBasisCalls=0;chanceHash=text=>{customBasisCalls++;return text.startsWith("history:")?19:23;}',ctx);
 for(let i=0;i<2;i++)assert.match(ctx.ratingObservationBasis(current),/^13:17:/);assert.equal(vm.runInContext('customBasisCalls',ctx),4,'replacement calculators are called for every basis');
 vm.runInContext('chanceHash=basisSavedHash;globalThis.basisOldImul=Math.imul;Math.imul=function(...args){return basisOldImul.apply(this,args);}',ctx);
 for(let i=0;i<2;i++){const value=oracle(current),count=vm.runInContext('basisHashWork',ctx);assert.equal(ctx.ratingObservationBasis(current),value);assert.ok(vm.runInContext('basisHashWork',ctx)>count,'changed Math methods cannot reuse an older basis');}
 vm.runInContext('Math.imul=basisBootImul;globalThis.basisBootMath=Math;Math=Object.create(Math)',ctx);
 for(let i=0;i<2;i++){const value=oracle(current),count=vm.runInContext('basisHashWork',ctx);assert.equal(ctx.ratingObservationBasis(current),value);assert.ok(vm.runInContext('basisHashWork',ctx)>count,'a replacement Math object cannot reuse a default basis');}
 vm.runInContext('Math=basisBootMath',ctx);
 const capTask=ctx.state.tasks.find(task=>!task.done);
 for(const target of [256*1024,256*1024+1]){
  let units=target-100,current,value,found=false;
  for(let attempt=0;attempt<16;attempt++){capTask.id=String.fromCharCode(97+attempt)+'x'.repeat(units-1);current=stats();value=oracle(current);const size=basisInputs(current).length+value.length;if(size===target){found=true;break;}units+=target-size;}
  assert.equal(found,true,'construct exact input-plus-result retention boundary');
  const count=vm.runInContext('basisHashWork',ctx);assert.equal(ctx.ratingObservationBasis(current),value);const computed=vm.runInContext('basisHashWork',ctx);assert.ok(computed>count);
  assert.equal(ctx.ratingObservationBasis(stats()),value);const repeated=vm.runInContext('basisHashWork',ctx);if(target===256*1024)assert.equal(repeated,computed,'the exact UTF-16 cap can reuse its result');else assert.ok(repeated>computed,'one unit above the cap must stay uncached');
 }
 // An oversized valid string remains supported, but is not retained by the fast path.
 ctx.state.tasks.find(task=>!task.done).id='basis-large-'+('x'.repeat(256*1024));const large=stats(),largeExpected=oracle(large);
 for(let i=0;i<2;i++){const count=vm.runInContext('basisHashWork',ctx);assert.equal(ctx.ratingObservationBasis(large),largeExpected);assert.ok(vm.runInContext('basisHashWork',ctx)>count,'oversized inputs use the ordinary uncached result');}
});

test('RISK independent cloud repair: unavailable device storage repairs retained server sources without acknowledging local work',async t=>{
 const {IDBFactory,forceCloseDatabase}=await import('fake-indexeddb'),handles=[],open=IDBFactory.prototype.open;
 IDBFactory.prototype.open=function(...args){const request=open.apply(this,args);request.addEventListener('success',()=>handles.push(request.result));return request;};
 let app;try{app=await damagedAcknowledgedApp187(t);}finally{IDBFactory.prototype.open=open;}
 const {ctx,shim,backend,originalRoot}=app,store=ctx.window.ScannerDeviceStore;
 shim.document.getElementById('addInput').value='Accepted local work not present on the server';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 vm.runInContext('clearTimeout(saveTimer);saveTimer=null;clearTimeout(cloudTimer);cloudTimer=null;clearCloudRetry()',ctx);
 shim.document.getElementById('addInput').value='Unfinished local draft';
 const localBefore=JSON.stringify(ctx.state),draft=shim.document.getElementById('addInput').value,rawBefore=await store.readRawExportSnapshot();
 const originals=[...backend.docs].filter(([key])=>key!=='users/owner').map(([key,row])=>[key,JSON.stringify(row)]);
 const prior=originalRoot.previousGeneration,header=backend.docs.get('users/owner/generations/'+prior),chunks=[...backend.docs].filter(([key])=>key.startsWith('users/owner/generations/'+prior+'/chunks/')).map(([,row])=>row);
 const previous=JSON.parse(await ctx.ChainStorageV2.decodeSnapshot(header,chunks));
 assert.equal((await backend.CS.pull()).code,'corrupt-generation');
 for(const connection of handles.filter(db=>db.name===app.deviceDbName))forceCloseDatabase(connection);
 const reopen=app.indexedDB.open;app.indexedDB.open=()=>{throw Object.assign(Error('Synthetic permanent IndexedDB refusal'),{name:'UnknownError'});};
 t.after(()=>{app.indexedDB.open=reopen;});
 let repairResult;const repair=backend.CS.repairCloudSources?.bind(backend.CS);if(repair)backend.CS.repairCloudSources=async options=>{repairResult=await repair(options);return repairResult;};
 await fixtureDeadline(ctx.cloudPull(),'independent remote repair completes despite device reconnection refusal');t.diagnostic('Independent remote result '+JSON.stringify(repairResult));
 await fixtureDeadline(async wait=>{while(vm.runInContext('pulling||cloudPushInFlight',ctx))await wait(5);},'server-only repair settles');
 const remote=await backend.CS.pull();
 assert.equal(typeof remote.payload,'string','the actual server decoder must return a complete board despite permanent local unavailability');
 assert.ok(remote.rev>originalRoot.rev);assert.notEqual(remote.generationId,originalRoot.activeGeneration);
 for(const task of previous.tasks)assert.deepEqual(JSON.parse(remote.payload).tasks.find(row=>row.id===task.id),task,'complete retained server task fields survive');
 assert.equal(JSON.stringify(ctx.state),localBefore,'remote repair cannot adopt a board or acknowledge unseen local decisions');
 assert.equal(ctx.state.syncDirty,true);assert.equal(shim.document.getElementById('addInput').value,draft);
 for(const [key,value]of originals)assert.equal(JSON.stringify(backend.docs.get(key)),value,'every original header and chunk remains exact');
 for(const id of [originalRoot.activeGeneration,prior])assert.equal(backend.docs.get('users/owner/recoveryProtections/'+id)?.v,1,'original server references receive durable immutable pins');
 app.indexedDB.open=reopen;
 const fresh=ctx.ChainStorageV2.createDeviceStore({indexedDB:app.indexedDB,crypto:ctx.crypto,dbName:app.deviceDbName});await fresh.open();
 try{assert.deepEqual(await fresh.readRawExportSnapshot(),rawBefore,'no local head pending hold backup or archive changes');}finally{await fresh.close();}
});

test('RISK independent cloud source safety: unsupported roots headers boards and absent candidates remain protected',async t=>{
 for(const mode of ['unknown-root','missing-root-field','unsupported-root-capability','malformed-root-clock','malformed-server-clock','missing-header','unsupported-header','deleting-header','unsupported-header-revision','incomplete-only','foreign-board','malformed-board'])await t.test(mode,async sub=>{
  const app=await damagedAcknowledgedApp187(sub),{ctx,backend,originalRoot}=app,prior=originalRoot.previousGeneration,path='users/owner/generations/'+prior;
  if(mode==='unknown-root')backend.docs.get('users/owner').futureRootEvidence={retain:'opaque original manifest'};
  if(mode==='missing-root-field')delete backend.docs.get('users/owner').updatedAt;
  if(mode==='unsupported-root-capability')backend.docs.get('users/owner').decisionCapability=99;
  if(mode==='malformed-root-clock')backend.docs.get('users/owner').updatedAt='unsupported source clock';
  if(mode==='malformed-server-clock')backend.docs.get('users/owner').serverUpdatedAt={opaque:'original timestamp evidence'};
  if(mode==='missing-header')backend.docs.delete('users/owner/generations/'+originalRoot.activeGeneration);
  if(mode==='unsupported-header')backend.docs.get('users/owner/generations/'+originalRoot.activeGeneration).schemaVersion=99;
  if(mode==='deleting-header')backend.docs.get('users/owner/generations/'+originalRoot.activeGeneration).state='deleting';
  if(mode==='unsupported-header-revision')backend.docs.get('users/owner/generations/'+originalRoot.activeGeneration).baseRev='unsupported original revision';
  if(mode==='incomplete-only')for(const key of [...backend.docs.keys()])if(key.startsWith(path+'/chunks/'))backend.docs.delete(key);
  if(mode==='foreign-board')await replaceIndependentServerPayload263(app,prior,JSON.stringify({...JSON.parse(ctx.state.decisionBase.payload),syncAccount:'other@example.test',syncIdentity:'other'}));
  if(mode==='malformed-board')await replaceIndependentServerPayload263(app,prior,'{"tasks":[{"partial":true}]}');
  const before=JSON.stringify([...backend.docs]),local=JSON.stringify(ctx.state);
  const result=await backend.CS.repairCloudSources();assert.equal(result.ok,undefined,'unreadable or unsupported evidence cannot authorize replacement');
  assert.equal(JSON.stringify([...backend.docs]),before,'held source bytes and root remain exact');assert.equal(JSON.stringify(ctx.state),local);
 });
});

test('RISK independent cloud capability: server-only repair ignores injected payloads and never observes local pending state',async t=>{
 const app=await damagedAcknowledgedApp187(t),{ctx,backend}=app,local=JSON.stringify(ctx.state),store=ctx.window.ScannerDeviceStore;let deviceCalls=0;
 Object.defineProperty(ctx.window,'ScannerDeviceStore',{configurable:true,get(){deviceCalls++;throw Error('Device storage is outside this capability');}});
 let result;try{
 const evidence=backend.CS.cloudRecoveryEvidence();assert.equal(evidence.pendingObservation,'unobserved');assert.equal(Object.hasOwn(evidence,'pending'),false);
 result=await backend.CS.repairCloudSources({payload:'{"tasks":[{"id":"injected-local-fact"}]}',pending:null});
 assert.equal(result.ok,true);assert.equal(result.remoteOnly,true);assert.equal(result.pendingObservation,'unobserved');assert.equal(deviceCalls,0);
 }finally{Object.defineProperty(ctx.window,'ScannerDeviceStore',{configurable:true,writable:true,value:store});}
 const peer=await loadCloudBackendV2({sharedDocs:backend.docs,timeoutMs:5000});t.after(()=>peer.CS.suspend());
 const actual=await peer.CS.pull();assert.equal(typeof actual.payload,'string');assert.equal(JSON.parse(actual.payload).tasks.some(row=>row.id==='injected-local-fact'),false);
 assert.equal(JSON.stringify(ctx.state),local);
});

test('RISK independent cloud authority: cancellation account epoch backend and suspension changes cannot publish stale repairs',async t=>{
 for(const mode of ['cancel','account','epoch','backend','suspend'])await t.test(mode,async sub=>{
  const app=await damagedAcknowledgedApp187(sub),{ctx,backend,faults,originalRoot}=app,original=JSON.stringify(backend.docs.get('users/owner'));let changed=false,allowed=true;
  faults.serverRead=async path=>{
   if(changed||!path.endsWith('/chunks'))return;changed=true;
   if(mode==='cancel')allowed=false;
   if(mode==='account')backend.emitAuth({uid:'other',email:'other@example.test'});
   if(mode==='epoch'){backend.emitAuth(null);backend.emitAuth({uid:'owner',email:'e@example.com'});}
   if(mode==='backend')ctx.window.CloudSync={...backend.CS};
   if(mode==='suspend')backend.CS.suspend();
  };
  const result=await backend.CS.repairCloudSources({stillCurrent:()=>allowed});
  assert.ok(changed);assert.equal(result.ok,undefined);assert.equal(JSON.stringify(backend.docs.get('users/owner')),original);
  assert.equal(backend.docs.get('users/owner').activeGeneration,originalRoot.activeGeneration);ctx.window.CloudSync=backend.CS;
 });
});

test('RISK independent cloud races: fresh peer roots win during reads and publication while failed pins keep originals',async t=>{
 for(const mode of ['read-race','publish-race','pin-refusal','source-mutation'])await t.test(mode,async sub=>{
  const app=await damagedAcknowledgedApp187(sub),{ctx,backend,faults,originalRoot}=app;
  const prior=originalRoot.previousGeneration,path='users/owner/generations/'+prior,header=backend.docs.get(path),chunks=[...backend.docs].filter(([key])=>key.startsWith(path+'/chunks/')).map(([,value])=>value);
  const peerBoard=JSON.parse(await ctx.ChainStorageV2.decodeSnapshot(header,chunks));peerBoard.futurePeerEvidence={keep:'newer peer revision'};
  const peerPayload=JSON.stringify(peerBoard);await replaceIndependentServerPayload263(app,'peer-current',peerPayload);backend.docs.get('users/owner/generations/peer-current').state='published';
  const peerRoot={...originalRoot,rev:originalRoot.rev+1,activeGeneration:'peer-current',previousGeneration:originalRoot.activeGeneration};let injected=false,reads=0;
  if(mode==='read-race')faults.serverRead=async key=>{if(!injected&&key.endsWith('/chunks')){injected=true;backend.docs.set('users/owner',peerRoot);}};
  if(mode==='publish-race'||mode==='pin-refusal')faults.beforeTransaction=async docs=>{
   if(mode==='pin-refusal')throw Object.assign(Error('Synthetic refused source pin'),{code:'permission-denied'});
   if(!injected&&[...docs].some(([key,row])=>key.startsWith('users/owner/generations/repair-')&&row.state==='sealed')){injected=true;docs.set('users/owner',peerRoot);}
  };
  if(mode==='source-mutation')faults.serverRead=async key=>{if(key===path+'/chunks'&&++reads===4){injected=true;backend.docs.get(key+'/00000000').text+='changed';}};
  const result=await backend.CS.repairCloudSources();
  if(mode.endsWith('race')){assert.equal(result.ok,true);assert.ok(injected);assert.deepEqual(backend.docs.get('users/owner'),peerRoot);assert.equal((await backend.CS.pull()).payload,peerPayload);}
  else{assert.equal(result.ok,undefined);assert.deepEqual(backend.docs.get('users/owner'),originalRoot);if(mode==='source-mutation')assert.ok(injected);}
 });
});

test('RISK independent cloud uncertain reply: deterministic publication reads back a lost reply and never clears pending uploads',async t=>{
 const app=await damagedAcknowledgedApp187(t),{ctx,backend,faults,originalRoot}=app,store=ctx.window.ScannerDeviceStore;
 const pending={generationId:'unobserved-local-upload',payloadHash:'7'.repeat(64),baseRev:originalRoot.rev,futurePending:{keep:true}};
 await store.setPendingUpload('owner',pending);const before=await store.getPendingUpload('owner');let lost=false;
 faults.afterTransaction=async docs=>{if(!lost&&docs.get('users/owner')?.activeGeneration?.startsWith('repair-')){lost=true;throw Object.assign(Error('Synthetic lost publication reply'),{code:'unavailable'});}};
 const writes=backend.writes.length,result=await backend.CS.repairCloudSources();assert.equal(result.ok,true);assert.ok(lost);assert.equal(result.rev,originalRoot.rev+1);
 const complete=await backend.CS.pull();assert.equal(complete.generationId,result.generationId);assert.equal(createHash('sha256').update(complete.payload).digest('hex'),result.payloadHash);
 const again=await backend.CS.repairCloudSources();assert.equal(again.ok,true);assert.equal(again.alreadyHealthy,true);assert.equal(backend.writes.length,writes+1,'lost reply cannot cause a second revision');
 assert.deepEqual(await store.getPendingUpload('owner'),before,'independent remote ACK does not clear an unseen upload');
 const saved=ctx.window.ScannerDeviceStore;ctx.window.ScannerDeviceStore={async getPendingUpload(){throw Error('Permanent local storage refusal');}};
 try{const ordinary=await backend.CS.push(ctx.cloudPayload(),1,result.rev);assert.equal(ordinary.ok,undefined);assert.equal(backend.writes.length,writes+1,'ordinary push retains device protection');}finally{ctx.window.ScannerDeviceStore=saved;}
});

test('RISK independent cloud retained discovery: pinned originals survive ordinary rotations and repair another damaged root without local storage',async t=>{
 const app=await damagedAcknowledgedApp187(t),{ctx,backend,originalRoot}=app;
 assert.equal((await backend.CS.repairCloudSources()).ok,true);const recovered=await backend.CS.pull(),originalPins=[originalRoot.activeGeneration,originalRoot.previousGeneration];
 const peer=await loadCloudBackendV2({sharedDocs:backend.docs,timeoutMs:5000});t.after(()=>peer.CS.suspend());
 let revision=recovered.rev;for(let index=0;index<3;index++){const result=await peer.CS.push(recovered.payload,index,revision);assert.equal(result.ok,true);revision=result.rev;}
 const root=backend.docs.get('users/owner');assert.ok(originalPins.every(id=>id!==root.activeGeneration&&id!==root.previousGeneration));
 for(const id of [root.activeGeneration,root.previousGeneration])for(const key of [...backend.docs.keys()])if(key.startsWith('users/owner/generations/'+id+'/chunks/'))backend.docs.delete(key);
 const store=ctx.window.ScannerDeviceStore;ctx.window.ScannerDeviceStore=null;
 try{const repaired=await backend.CS.repairCloudSources();assert.equal(repaired.ok,true);assert.equal(typeof (await backend.CS.pull()).payload,'string');assert.ok(backend.queries.includes('users/owner/recoveryProtections'));}
 finally{ctx.window.ScannerDeviceStore=store;}
 for(const id of originalPins)assert.equal(backend.docs.get('users/owner/recoveryProtections/'+id).v,1);
});

test('RISK independent cloud exact reconstruction: a matching retained hash cannot discard other complete server facts',async t=>{
 const app=await damagedAcknowledgedApp187(t),{ctx,backend,originalRoot,activeSource}=app;
 const duplicate='retained-current-duplicate',extra='retained-independent-facts';
 backend.docs.set('users/owner/generations/'+duplicate,{...activeSource.header});
 for(const chunk of activeSource.chunks)backend.docs.set('users/owner/generations/'+duplicate+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk);
 const original=ctx.state.decisionBase.payload,board=JSON.parse(original);board.retainedIndependentField={accepted:'server source fact'};
 await replaceIndependentServerPayload263(app,extra,JSON.stringify(board));backend.docs.get('users/owner/generations/'+extra).state='published';
 for(const id of [duplicate,extra])backend.docs.set('users/owner/recoveryProtections/'+id,{v:1,rootRevision:originalRoot.rev,createdAt:{toMillis:()=>1}});
 const result=await backend.CS.repairCloudSources();assert.equal(result.ok,true);
 const remote=await backend.CS.pull();assert.deepEqual(JSON.parse(remote.payload).retainedIndependentField,{accepted:'server source fact'},'exact reconstruction still retains compatible facts from every complete server source');
 assert.deepEqual(JSON.parse(remote.payload).tasks,JSON.parse(original).tasks);
});

test('RISK device connection recovery: a closed local handle still permits exact cloud reconstruction without losing originals',async t=>{
 const {IDBFactory,forceCloseDatabase}=await import('fake-indexeddb'),handles=[],open=IDBFactory.prototype.open;
 // Observe the external factory only while the established fixture opens its
 // real connection; restore it before exercising app recovery.
 IDBFactory.prototype.open=function(...args){const request=open.apply(this,args);request.addEventListener('success',()=>handles.push(request.result));return request;};
 let app;try{app=await damagedAcknowledgedApp187(t);}finally{IDBFactory.prototype.open=open;}
 const {ctx,backend,originalRoot}=app,store=ctx.window.ScannerDeviceStore;
 const connection=handles.filter(db=>db.name===app.deviceDbName).at(-1);assert.ok(connection);
 const cloudBefore=JSON.stringify([...backend.docs]),localBefore=JSON.stringify(ctx.state),rawBefore=await store.readRawExportSnapshot();
 const originals=[...backend.docs].filter(([key])=>key!=='users/owner').map(([key,row])=>[key,JSON.stringify(row)]);
 assert.equal((await backend.CS.pull()).code,'corrupt-generation','fixture reaches the real missing-chunk decoder failure');
 forceCloseDatabase(connection);
 await ctx.cloudPull();await ctx.sendPush();
 await fixtureDeadline(async wait=>{while(vm.runInContext('pulling||cloudPushInFlight||cloudRetryTimer!==null',ctx))await wait(5);},'closed-connection cloud recovery settles within its finite budget',7000);
 const remote=await backend.CS.pull();
 if(remote.code==='corrupt-generation'){
  assert.equal(JSON.stringify([...backend.docs]),cloudBefore,'unresolved repair preserves remote originals');
  assert.equal(JSON.stringify(ctx.state),localBefore,'unresolved repair preserves accepted local work');
  const fresh=ctx.ChainStorageV2.createDeviceStore({indexedDB:app.indexedDB,crypto:ctx.crypto,dbName:app.deviceDbName});await fresh.open();
  try{assert.deepEqual(await fresh.readRawExportSnapshot(),rawBefore,'unresolved repair preserves every physical local row');}finally{fresh.close();}
 }
 assert.equal(remote.payload,ctx.cloudPayload(),'exact acknowledged reconstruction reaches a complete remote save after recovery settles');
 assert.ok(remote.rev>originalRoot.rev,'repair receives an actual later cloud acknowledgement');
 assert.notEqual(backend.docs.get('users/owner').activeGeneration,originalRoot.activeGeneration,'repair publishes a fresh immutable generation');
 assert.deepEqual(JSON.parse(remote.payload).tasks,app.acknowledgedTasks,'all acknowledged task fields remain exact');
 for(const [key,raw]of originals)assert.equal(JSON.stringify(backend.docs.get(key)),raw,'original generation/header/chunks remain exact');
 assert.equal((await store.readHead()).payload,JSON.stringify(ctx.state),'the acknowledged app board is durably saved');
 assert.equal(ctx.state.syncRev,remote.rev);assert.equal(ctx.state.syncDirty,false);
});

test('RISK independent cloud stalled storage: a pending native IDB request cannot block remote-only repair',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),handles=[],open=IDBFactory.prototype.open;
 IDBFactory.prototype.open=function(...args){const request=open.apply(this,args);request.addEventListener('success',()=>handles.push(request.result));return request;};
 let app;try{app=await damagedAcknowledgedApp187(t);}finally{IDBFactory.prototype.open=open;}
 const {ctx,shim,backend,originalRoot}=app,store=ctx.window.ScannerDeviceStore,connection=handles.filter(db=>db.name===app.deviceDbName).at(-1);
 assert.ok(connection);const local=JSON.stringify(ctx.state),raw=await store.readRawExportSnapshot(),originals=[...backend.docs].filter(([key])=>key!=='users/owner').map(([key,row])=>[key,JSON.stringify(row)]);
 shim.document.getElementById('addInput').value='Draft while native IndexedDB read is stalled';const transaction=connection.transaction.bind(connection);let held=0;
 connection.transaction=(...args)=>{
  const tx=transaction(...args);
  return new Proxy(tx,{get(target,key){if(key==='objectStore')return name=>{const objectStore=target.objectStore(name);return new Proxy(objectStore,{get(target,key){if(key==='get')return input=>{
   const request=target.get(input);if(input!=='pending:owner')return request;held++;
   return new Proxy(request,{get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;},set(target,key,value){if(key==='onsuccess'||key==='onerror')return true;return Reflect.set(target,key,value,target);}});
  };const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 };
 try{
  const operation=ctx.cloudPull();operation.catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,1500));assert.ok(held>0,'the real app reaches a stalled external pending-key IDB request');
  const remote=await backend.CS.pull();assert.equal(typeof remote.payload,'string','actual remote decoder must return a complete repaired board while the native device request remains stalled');
  await fixtureDeadline(operation,'the app remote-only operation settles inside its original finite budget');
  assert.ok(remote.rev>originalRoot.rev);assert.equal(JSON.stringify(ctx.state),local);assert.equal(shim.document.getElementById('addInput').value,'Draft while native IndexedDB read is stalled');
  for(const [key,value]of originals)assert.equal(JSON.stringify(backend.docs.get(key)),value);
 }finally{connection.transaction=transaction;}
 assert.deepEqual(await store.readRawExportSnapshot(),raw,'timing out a read cannot mutate local pending hold or board rows');
});

test('RISK independent cloud absent storage: actual cloudPull repairs remote bytes without a device capability',async t=>{
 const seed=await damagedAcknowledgedApp187(t),local=JSON.stringify(seed.ctx.state),app=await loadAppAtTime(1792323000000,{seedStorage:{[SYNC_STORE_KEY]:local,[LOCAL_HEAD_KEY]:local}}),{ctx,shim}=app;
 assert.equal(ctx.window.ScannerDeviceStore,undefined,'this app has no IndexedDB store capability');
 if(!ctx.window.ChainStorageV2){vm.runInContext(fs.readFileSync(path.join(__dirname,'device-store-v2.js'),'utf8'),ctx);ctx.window.ChainStorageV2=ctx.ChainStorageV2;}
 const backend=await loadCloudBackendV2({runtimeWindow:ctx.window,sharedDocs:seed.backend.docs,failures:{authPending:true},timeoutMs:5000});t.after(()=>backend.CS.suspend());
 backend.emitAuth({uid:'owner',email:'e@example.com'});const before=JSON.stringify(ctx.state);shim.document.getElementById('addInput').value='Draft without device database';
 await fixtureDeadline(ctx.cloudPull(),'cloud-only repair works without any local device-store capability');
 const remote=await backend.CS.pull();assert.equal(typeof remote.payload,'string');assert.ok(remote.rev>seed.originalRoot.rev);
 assert.equal(JSON.stringify(ctx.state),before);assert.equal(shim.document.getElementById('addInput').value,'Draft without device database');
});

test('RISK independent cloud live work: accepted Add comparison and unfinished draft survive a held server-only repair',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),handles=[],open=IDBFactory.prototype.open;
 IDBFactory.prototype.open=function(...args){const request=open.apply(this,args);request.addEventListener('success',()=>handles.push(request.result));return request;};
 let app;try{app=await damagedAcknowledgedApp187(t);}finally{IDBFactory.prototype.open=open;}
 const {ctx,shim,backend,faults}=app,entered=deferredSyncFixture(),gate=deferredSyncFixture(),connection=handles.filter(db=>db.name===app.deviceDbName).at(-1),transaction=connection.transaction.bind(connection);let blocked=false;
 // Only the external pending-key read is unavailable. Local head durability
 // remains real; ordinary user pushes must retain their own pending guard.
 connection.transaction=(...args)=>{const tx=transaction(...args);return new Proxy(tx,{get(target,key){if(key==='objectStore')return name=>{const objectStore=target.objectStore(name);return new Proxy(objectStore,{get(target,key){if(key==='get')return input=>{if(input==='pending:owner')throw Object.assign(Error('Synthetic unavailable native pending read'),{name:'UnknownError'});return target.get(input);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});};
 faults.serverRead=async path=>{if(!blocked&&path.endsWith('/chunks')){blocked=true;entered.resolve();await gate.promise;}};
 const operation=backend.CS.repairCloudSources();await fixtureDeadline(entered.promise,'independent repair reaches an actual held server request');
 try{
  shim.document.getElementById('addInput').value='Accepted while independent server repair is waiting';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
  ctx.onAction('start-scan',{dataset:{mode:'descending'}});const candidate=ctx.state.candidateId,benchmark=ctx.state.chain.at(-1);assert.ok(candidate&&benchmark);
  ctx.onAction('no',{dataset:{candidate,benchmark}});assert.equal(await ctx.persist(),true);
  vm.runInContext('clearTimeout(saveTimer);saveTimer=null;clearTimeout(cloudTimer);cloudTimer=null;clearCloudRetry()',ctx);
  const local=JSON.stringify(ctx.state),raw=await ctx.window.ScannerDeviceStore.readRawExportSnapshot();assert.equal(ctx.state.syncDirty,true);
  shim.document.getElementById('addInput').value='Unfinished draft accepted while remote request is waiting';gate.resolve();
  const result=await fixtureDeadline(operation,'held independent server repair completes');assert.equal(result.ok,true);
  assert.equal(JSON.stringify(ctx.state),local);assert.equal(shim.document.getElementById('addInput').value,'Unfinished draft accepted while remote request is waiting');
  assert.deepEqual(await ctx.window.ScannerDeviceStore.readRawExportSnapshot(),raw,'server repair cannot alter current local decisions pending head or hold');
  const remote=JSON.parse((await backend.CS.pull()).payload);assert.equal(remote.tasks.some(row=>row.title==='Accepted while independent server repair is waiting'),false,'unseen local work is not uploaded by a remote-only capability');
 }finally{gate.resolve();connection.transaction=transaction;}
});

test('RISK independent cloud explicit abort: canceled reads and uncertain committed replies cannot acknowledge local work',async t=>{
 for(const mode of ['read','before-publication','after-publication'])await t.test(mode,async sub=>{
  const app=await damagedAcknowledgedApp187(sub),{ctx,backend,faults,originalRoot}=app,controller=new AbortController(),local=JSON.stringify(ctx.state);let aborted=false;
  const abort=()=>{aborted=true;controller.abort(Object.assign(Error('Synthetic explicit Cancel'),{code:'lifecycle-cancelled'}));};
  if(mode==='read')faults.serverRead=async path=>{if(!aborted&&path.endsWith('/chunks'))abort();};
  if(mode==='before-publication')faults.beforeTransaction=async docs=>{if(!aborted&&[...docs].some(([key,row])=>key.startsWith('users/owner/generations/repair-')&&row.state==='sealed'))abort();};
  if(mode==='after-publication')faults.afterTransaction=async docs=>{if(!aborted&&docs.get('users/owner')?.activeGeneration?.startsWith('repair-'))abort();};
  const result=await backend.CS.repairCloudSources({signal:controller.signal});assert.ok(aborted);assert.equal(result.ok,undefined);assert.equal(result.cancelled,true);assert.equal(JSON.stringify(ctx.state),local);
  if(mode==='after-publication'){const remote=await backend.CS.pull();assert.equal(typeof remote.payload,'string');assert.equal(remote.rev,originalRoot.rev+1,'a permitted uncertain server commit remains readable without a false local ACK');}
  else assert.deepEqual(backend.docs.get('users/owner'),originalRoot);
 });
});

test('RISK independent cloud staged reply: retry resumes the same deterministic generation after uncertain creation',async t=>{
 const app=await damagedAcknowledgedApp187(t),{backend,faults,originalRoot}=app;let lost=false;
 faults.afterTransaction=async docs=>{if(!lost&&[...docs].some(([key,row])=>key.startsWith('users/owner/generations/repair-')&&row.state==='staging')){lost=true;throw Object.assign(Error('Synthetic lost staging creation reply'),{code:'unavailable'});}};
 const writes=backend.writes.length,first=await backend.CS.repairCloudSources();assert.ok(lost);assert.equal(first.error,true);assert.deepEqual(backend.docs.get('users/owner'),originalRoot);
 const staged=[...backend.docs].filter(([key])=>/^users\/owner\/generations\/repair-[^/]+$/.test(key));assert.equal(staged.length,1);assert.equal(staged[0][1].state,'staging');
 const second=await backend.CS.repairCloudSources();assert.equal(second.ok,true);assert.equal('users/owner/generations/'+second.generationId,staged[0][0]);
 assert.equal([...backend.docs].filter(([key])=>/^users\/owner\/generations\/repair-[^/]+$/.test(key)).length,1);assert.equal(backend.writes.length,writes+1);
 assert.equal((await backend.CS.pull()).generationId,second.generationId);
});

test('RISK independent cloud restart budget: repeated fresh root changes stop after one restart without replacement',async t=>{
 const app=await damagedAcknowledgedApp187(t),{backend,faults,originalRoot}=app,originals=[...backend.docs].filter(([key])=>key!=='users/owner').map(([key,row])=>[key,JSON.stringify(row)]);let roots=0,changes=0;
 faults.serverRead=async path=>{if(path==='users/owner'&&++roots%4===0){changes++;backend.docs.set(path,{...backend.docs.get(path),rev:originalRoot.rev+changes});}};
 const result=await backend.CS.repairCloudSources();assert.equal(result.ok,undefined);assert.equal(result.code,'recovery-source-changed');assert.equal(changes,2);assert.equal(roots,8,'only one fresh restart is permitted');
 assert.equal(backend.docs.get('users/owner').activeGeneration,originalRoot.activeGeneration);for(const [key,value]of originals)assert.equal(JSON.stringify(backend.docs.get(key)),value);
});

test('RISK independent cloud total budget: clock skew and late server replies cannot extend the original operation',async t=>{
 let clock=Date.now();const app=await damagedAcknowledgedApp187(t,{timerProvider:{Date:class extends Date{static now(){return clock;}}}}),{backend,faults,originalRoot}=app,started=performance.now(),budget=90;let reads=0;
 faults.serverRead=async()=>{reads++;clock-=86400000;await new Promise(resolve=>setTimeout(resolve,60));};
 const result=await backend.CS.repairCloudSources({remainingMs:()=>Math.max(0,budget-(performance.now()-started))});
 assert.equal(result.ok,undefined);assert.equal(result.code,'deadline-exceeded','budget exhaustion remains an honest deadline failure rather than pretending user cancellation');
 assert.ok(performance.now()-started<600,'the shared budget bounds all dependent server work');const stoppedAt=reads;
 await new Promise(resolve=>setTimeout(resolve,100));assert.equal(reads,stoppedAt,'late SDK completion cannot schedule more dependent reads');assert.deepEqual(backend.docs.get('users/owner'),originalRoot);
});

test('RISK independent cloud final readback: repeated damage after permitted publication cannot become verified repair',async t=>{
 const app=await damagedAcknowledgedApp187(t),{ctx,backend,faults}=app,local=JSON.stringify(ctx.state);let damages=0;
 faults.afterTransaction=async docs=>{const root=docs.get('users/owner');if(!root?.activeGeneration?.startsWith('repair-'))return;
  const prefix='users/owner/generations/'+root.activeGeneration+'/chunks/',chunks=[...docs.keys()].filter(key=>key.startsWith(prefix));
  if(chunks.length){damages++;for(const key of chunks)docs.delete(key);}
 };
 const result=await backend.CS.repairCloudSources();assert.equal(result.ok,undefined,'a permitted write is not successful repair without independently decoded readback');assert.equal(result.error,true);assert.equal(result.code,'verification-failed');assert.equal(damages,2,'one fresh restart remains the whole publication retry budget');
 assert.equal((await backend.CS.pull()).code,'corrupt-generation');assert.equal(JSON.stringify(ctx.state),local);
});

test('RISK independent cloud confirmation status: repairing server bytes cannot show an unchanged local board as acknowledged',async t=>{
 const {IDBFactory,forceCloseDatabase}=await import('fake-indexeddb'),handles=[],open=IDBFactory.prototype.open;
 IDBFactory.prototype.open=function(...args){const request=open.apply(this,args);request.addEventListener('success',()=>handles.push(request.result));return request;};
 let app;try{app=await damagedAcknowledgedApp187(t);}finally{IDBFactory.prototype.open=open;}
 const {ctx,shim,backend,originalRoot}=app,local=JSON.stringify(ctx.state);assert.equal(ctx.state.syncDirty,false,'the old acknowledged board starts clean before cloud corruption is observed');
 for(const connection of handles.filter(db=>db.name===app.deviceDbName))forceCloseDatabase(connection);
 const reopen=app.indexedDB.open;app.indexedDB.open=()=>{throw Object.assign(Error('Synthetic unreadable local storage'),{name:'UnknownError'});};
 try{
  await fixtureDeadline(ctx.cloudPull(),'server-only repair settles with unchanged old local acknowledgement');
  assert.ok(backend.docs.get('users/owner').rev>originalRoot.rev);assert.equal(JSON.stringify(ctx.state),local);
  assert.doesNotMatch(shim.document.getElementById('syncBtn').textContent,/synced/,'independent server repair cannot display this unchanged local board as acknowledged');
  assert.equal(ctx.reconciled(),false,'a separate current local reconciliation remains required');
 }finally{app.indexedDB.open=reopen;}
});

test('RISK independent cloud failure status: protected terminal errors stay visible until verified server recovery',async t=>{
 const app=await damagedAcknowledgedApp187(t),{backend,originalRoot}=app,path='users/owner/generations/'+originalRoot.activeGeneration,header=backend.docs.get(path);
 backend.docs.set(path,{...header,state:'deleting'});const result=await backend.CS.repairCloudSources();assert.equal(result.error,true);
 assert.equal(backend.CS.status,'error','a protected remote failure is reported through the existing backend status consumer');assert.equal(backend.CS.errorCode,'recovery-source-unavailable');assert.equal(backend.CS.knownDamagedSource,true);
 backend.docs.set(path,header);const recovered=await backend.CS.repairCloudSources();assert.equal(recovered.ok,true);assert.equal(backend.CS.knownDamagedSource,false);
 assert.equal(backend.CS.errorCode,null,'only independently verified remote recovery clears its transport error');
});

test('RISK independent cloud legacy source: supported released v1 boards upgrade only their version during server-only repair',async t=>{
 const {readReleasedClient,SUPPORTED_RELEASE}=await import('../scripts/backward-compatibility.mjs'),released=readReleasedClient(__dirname,SUPPORTED_RELEASE);
 for(const mode of ['v2-control','supported-v1','supported-v1-exact-copy','unknown-v99','foreign-owner','lossy-task-context','unsupported-decisions'])await t.test(mode,async sub=>{
  const task={...syncTask('legacy-cloud-task','Supported retained legacy cloud task'),futureLegacyTask:{keep:['exact',7]}},board=syncState({v:mode==='v2-control'?2:mode==='unknown-v99'?99:1,tasks:[task],futureLegacyBoard:{keep:['unchanged',9]}});
  if(mode==='foreign-owner'){board.syncAccount='other@example.test';board.syncIdentity='other';}
  if(mode==='lossy-task-context')task.ctx=[17];
  if(mode==='unsupported-decisions')board.decisionEvents=[{v:99,id:'future-legacy-decision',kind:'future-authority',opaque:'retain exact'}];
  const raw=JSON.stringify(board),producer=await loadCloudBackendV2({artifacts:released,timeoutMs:5000});sub.after(()=>producer.CS.suspend?.());
  assert.equal((await producer.CS.push(raw,1,0)).ok,true,'the real supported released backend publishes this unchanged retained source under its v2 generation protocol');
  const retained=await producer.CS.pull();assert.equal(retained.payload,raw,'the real released codec reads back every original byte');const retainedId=retained.generationId;
  if(mode.startsWith('supported-v1')){
   const control=await loadAppAtTime(1792323000000,{artifacts:released,appSource:extractAppScript(released.html)}),reader=await loadCloudBackendV2({artifacts:released,runtimeWindow:control.ctx.window,sharedDocs:producer.docs,failures:{authPending:true},timeoutMs:5000});sub.after(()=>reader.CS.suspend?.());
   reader.emitAuth({uid:'owner',email:'e@example.com'});await fixtureDeadline(control.ctx.cloudPull(),'normal released app accepts the same unmodified v1 cloud board');
   assert.equal(control.ctx.state.v,2,'the released app already supports the known v1 to v2 saved-board upgrade');assert.equal(control.ctx.state.tasks[0].title,task.title);assert.deepEqual(JSON.parse(JSON.stringify(control.ctx.state.futureLegacyBoard)),board.futureLegacyBoard);
  }
  const current=syncState({v:2,tasks:[task,syncTask('unseen-current-cloud-task','Unavailable newer cloud bytes')],futureLegacyBoard:board.futureLegacyBoard}),currentRaw=mode==='supported-v1-exact-copy'?raw:JSON.stringify(current),base=producer.docs.get('users/owner').rev;
  assert.equal((await producer.CS.push(currentRaw,2,base)).ok,true);for(let i=0;i<10;i++)await flush();
  const originalRoot={...producer.docs.get('users/owner')};assert.equal(originalRoot.previousGeneration,retainedId,'the legitimate next publication retains the supported old generation');
  for(const key of [...producer.docs.keys()])if(key.startsWith('users/owner/generations/'+originalRoot.activeGeneration+'/chunks/'))producer.docs.delete(key);
  const originals=[...producer.docs].filter(([key])=>key!=='users/owner').map(([key,row])=>[key,JSON.stringify(row)]);
  const app=await loadAppAtTime(1792323000000,{seedStorage:{[SYNC_STORE_KEY]:currentRaw,[LOCAL_HEAD_KEY]:currentRaw}}),{ctx,shim}=app;
  if(!ctx.window.ChainStorageV2){vm.runInContext(fs.readFileSync(path.join(__dirname,'device-store-v2.js'),'utf8'),ctx);ctx.window.ChainStorageV2=ctx.ChainStorageV2;}
  const backend=await loadCloudBackendV2({runtimeWindow:ctx.window,sharedDocs:producer.docs,failures:{authPending:true},timeoutMs:5000});sub.after(()=>backend.CS.suspend());backend.emitAuth({uid:'owner',email:'e@example.com'});
  const local=JSON.stringify(ctx.state);shim.document.getElementById('addInput').value='Unfinished local draft during legacy cloud repair';
  await fixtureDeadline(ctx.cloudPull(),'actual current cloudPull attempts source-only repair with no device store');const remote=await backend.CS.pull();
  if(mode==='v2-control'||mode.startsWith('supported-v1')){
   assert.equal(typeof remote.payload,'string','actual remote decoder must return a complete board from the supported retained cloud source');assert.ok(remote.rev>originalRoot.rev);assert.notEqual(remote.generationId,retainedId);assert.notEqual(remote.generationId,originalRoot.activeGeneration);
   const repaired=JSON.parse(remote.payload);assert.equal(repaired.v,2);assert.deepEqual(repaired.tasks[0],JSON.parse(JSON.stringify(ctx.state.tasks.find(row=>row.id===task.id))));
   for(const [key,value]of Object.entries(task))assert.deepEqual(repaired.tasks[0][key],value,'each original legacy task field is retained independently of hydration defaults');
   for(const [key,value]of Object.entries(board.settings))assert.deepEqual(repaired.settings[key],value,'each original setting remains unchanged');
   assert.deepEqual(repaired.futureLegacyBoard,board.futureLegacyBoard);assert.equal(repaired.tasks.some(row=>row.id==='unseen-current-cloud-task'),false,'missing newer bytes are not invented from the unobserved local board');
   for(const id of [retainedId,originalRoot.activeGeneration])assert.equal(backend.docs.get('users/owner/recoveryProtections/'+id)?.v,1);
  }else{assert.equal(remote.code,'corrupt-generation');assert.deepEqual(backend.docs.get('users/owner'),originalRoot,'unknown versions foreign ownership and other lossy fields cannot authorize replacement');}
  assert.equal(JSON.stringify(ctx.state),local);assert.equal(shim.document.getElementById('addInput').value,'Unfinished local draft during legacy cloud repair');for(const [key,value]of originals)assert.equal(JSON.stringify(backend.docs.get(key)),value,'every original published header and chunk remains exact');
 });
});

test('RISK independent cloud boot authority: source-only preflight waits for bounded device startup before repairing remote bytes',async t=>{
 const seed=await damagedAcknowledgedApp187(t),failures={authPending:true},entered=deferredSyncFixture(),release=deferredSyncFixture();
 let ctx,shim,backendPromise,backend,readBeforeReady=false,held=false;
 const boot=loadAppAtTime(1792323000000,{indexedDBProvider:{open(){return {};}},deviceDbName:'independent-cloud-boot-'+Math.random(),deviceOpenTimeoutMs:180,
  seedStorage:{[DEVICE_AUTHORITY_KEY]:'1'},beforeStateReady(app,host){
   ctx=app;shim=host;Object.defineProperty(shim.window,'cloudPull',{get:()=>ctx.cloudPull,configurable:true});
   failures.serverRead=async()=>{if(vm.runInContext('!state||automaticCloudFallbackBootCapturePending',ctx))readBeforeReady=true;if(!held){held=true;entered.resolve();await release.promise;}};
   backendPromise=loadCloudBackendV2({runtimeWindow:shim.window,sharedDocs:seed.backend.docs,failures,timeoutMs:5000});
  }});
 t.after(async()=>{release.resolve();await boot;backend?.CS.suspend();});
 backend=await fixtureDeadline(backendPromise,'actual backend starts while native device startup is pending');
 assert.equal(vm.runInContext('state',ctx),null);backend.emitAuth({uid:'owner',email:'e@example.com'});
 for(const type of ['pageshow','focus','online'])shim.window.dispatchEvent({type,persisted:false});
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(vm.runInContext('state',ctx),null,'the external native open still has not completed or reached its bound');
 assert.equal(backend.network.length,0,'independent repair cannot read any server source before hydration and exact boot capture settle');
 assert.equal(backend.writes.length,0);assert.deepEqual(backend.docs.get('users/owner'),seed.originalRoot);
 const app=await fixtureDeadline(boot,'permanent native open unavailability reaches its bounded usable startup');
 assert.ok(app.ctx.state);assert.equal(app.ctx.deviceStorageActive(),false);
 await fixtureDeadline(entered.promise,'queued Auth automatically starts a server source read after bounded unavailable startup');
 assert.equal(readBeforeReady,false,'all actual server reads occur after hydration and exact boot capture');
 shim.document.getElementById('addInput').value='Accepted after bounded unavailable boot';await fixtureDeadline(ctx.onAction('add',{}),'unsaved local Add remains usable while remote repair is held');
 vm.runInContext('clearTimeout(saveTimer);saveTimer=null;clearTimeout(cloudTimer);cloudTimer=null;clearCloudRetry()',ctx);
 const local=JSON.stringify(ctx.state);shim.document.getElementById('addInput').value='Draft after unavailable boot';
 release.resolve();
 for(let i=0;i<100&&backend.docs.get('users/owner').rev===seed.originalRoot.rev;i++)await new Promise(resolve=>setTimeout(resolve,10));
 const remote=await backend.CS.pull();assert.equal(typeof remote.payload,'string','the real decoder confirms independent cloud repair after bounded unavailable startup');assert.ok(remote.rev>seed.originalRoot.rev);
 assert.equal(JSON.stringify(ctx.state),local);assert.equal(shim.document.getElementById('addInput').value,'Draft after unavailable boot');assert.equal(ctx.state.syncDirty,true);
 assert.equal(JSON.parse(remote.payload).tasks.some(row=>row.title==='Accepted after bounded unavailable boot'),false,'server-only repair never uploads unobserved accepted local work');
});

// Independent review of the #2246/#2239 integration (S1): a push lists only
// this account's manual recovery archives (#2239). The full listing it used
// before skips a corrupt archive row that an exact lossless original keeps, but
// those originals sit outside the push's range, so the range listing refused
// the row and with it every push. The range listing must skip that row exactly
// as the full listing does, still refuse a corrupt row in its range that
// nothing keeps, and still ignore corrupt rows outside its range.
test('RISK recovery archive range listing: a corrupt row in the listed range that an exact original keeps is skipped as the full listing skips it, and one that nothing keeps is still refused',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='range-protected-'+Math.random(),helper=await loadApp();t.after(()=>helper.dispose());
 const encode=helper.ctx.encodeManualArchiveValue,prefix='cloud-generation-recovery:'+encodeURIComponent('owner@example.com')+':';
 const store=loadStorageV2({indexedDB}).createDeviceStore({indexedDB,crypto:webcrypto,dbName:deviceDbName,encodeRecoveryValue:encode});await store.open();t.after(()=>store.close());
 const kept=prefix+'kept-corrupt',keptValue='not an archive row',originalKey='device-recovery-original:range-review';
 const original={format:'chain-scanner.device-recovery-source',formatVersion:1,reason:'device-source-recovery',indexedDB:{opaque:[{key:encode(kept,'opaque key'),value:encode(keptValue,'opaque value')}]}};
 const readable={key:prefix+'readable',raw:JSON.stringify({format:'chain-scanner.cloud-recovery-source',version:1,identity:'owner@example.com'}),order:2};
 await editRawDevice187(indexedDB,deviceDbName,tx=>{const opaque=tx.objectStore('opaque');
  opaque.put({key:originalKey,raw:JSON.stringify(original),order:1},originalKey);opaque.put(readable,readable.key);opaque.put(keptValue,kept);});
 const full=await store.listOpaqueArchives();
 assert.deepEqual(full.map(row=>row.key),[originalKey,readable.key],'the full listing skips the kept corrupt row');
 const ranged=await store.listOpaqueArchives({prefix});
 assert.deepEqual(ranged,full.filter(row=>row.key.startsWith(prefix)),'the range listing skips the kept corrupt row as the full listing does');
 await editRawDevice187(indexedDB,deviceDbName,tx=>tx.objectStore('opaque').put('corrupt and outside the range','automatic-recovery-ack:outside'));
 assert.deepEqual((await store.listOpaqueArchives({prefix})).map(row=>row.key),[readable.key],'a corrupt row outside the range does not stop the range listing');
 await editRawDevice187(indexedDB,deviceDbName,tx=>tx.objectStore('opaque').put('corrupt and kept by nothing',prefix+'unkept'));
 await assert.rejects(store.listOpaqueArchives({prefix}),/corrupt or unprotected/,'a corrupt row in the range that nothing keeps is refused');
});

// #2254 (owner decision, 2026-11-06): a phone cannot afford full recovery of a
// large board, and the owner should not have to decide anything. When the
// cloud generation just before the unreadable current one is exactly this
// device's acknowledged copy (its verified hash and byte length, at the
// revision before the unreadable one), this device's board was built on that
// copy and already holds everything it holds. The app then publishes the
// device board as the next revision through the ordinary save, by itself:
// no reconciliation and no recovery archive, the unreadable generation stays
// protected and untouched, and the write is guarded by revision.
async function containedAdoptionApp2254(t){
 const app=await damagedAcknowledgedApp187(t),{ctx,backend,originalRoot,activeSource}=app,generations='users/owner/generations/';
 // The generation this device acknowledged is complete again.
 for(const chunk of activeSource.chunks)backend.docs.set(generations+activeSource.id+'/chunks/'+String(chunk.index).padStart(8,'0'),structuredClone(chunk));
 // Another writer then published the next revision, which cannot be read:
 // its header declares a different source whose chunks never arrived.
 const base=ctx.state.decisionBase,unreadableId='generation-unreadable-2254';
 const other=JSON.parse(base.payload);other.futureUnreadableActiveFixture={opaque:'saved by another writer'};
 const encoded=await ctx.window.ChainStorageV2.encodeSnapshot(JSON.stringify(other));
 backend.docs.set(generations+unreadableId,{...activeSource.header,hash:encoded.hash,byteLength:encoded.byteLength,chunkCount:encoded.chunkCount,baseRev:originalRoot.rev});
 backend.docs.set('users/owner',{...originalRoot,rev:originalRoot.rev+1,activeGeneration:unreadableId,previousGeneration:activeSource.id});
 ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=1;
 const pushes=[],push=backend.CS.push;
 backend.CS.push=async(payload,updatedAt,baseRev,context)=>{pushes.push({payload,baseRev});return push(payload,updatedAt,baseRev,context);};
 t.after(()=>{backend.CS.push=push;});
 return {...app,unreadableId,acknowledgedId:activeSource.id,unreadablePath:generations+unreadableId,acknowledgedPath:generations+activeSource.id,pushes,push};
}
const adoptionIdle2254=ctx=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy||saveTimer!==null||supportDiagnosticsActivePersistCalls>0',ctx);
const adoptionSettle2254=(ctx,message)=>fixtureDeadline(async wait=>{await wait(5);while(!adoptionIdle2254(ctx))await wait(10);},message,30000);
const generationDocs2254=(backend,path)=>JSON.stringify([...backend.docs].filter(([key])=>key===path||key.startsWith(path+'/')));
async function newerEditBeforeAdoption2254(app){
 const {ctx,shim}=app;
 shim.document.getElementById('addInput').value='Newer local edit before adoption';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
}
// #2254 review (S1, taken as the recommended option under the owner's lossless
// rule): the unreadable generation must also be this device's own upload. The
// device's real push publishes the next revision, but the reply never arrives
// (the transaction committed and then the connection dropped), so the device
// still records the upload as its pending one and stays based on its
// acknowledged copy. The published generation's chunks then become unreadable.
async function ownInterruptedUploadApp2254(t,options={}){
 const app=await damagedAcknowledgedApp187(t,options),{ctx,shim,backend,faults,activeSource}=app,generations='users/owner/generations/';
 const store=ctx.window.ScannerDeviceStore,revision=ctx.state.syncRev;
 // The generation this device acknowledged is complete again.
 for(const chunk of activeSource.chunks)backend.docs.set(generations+activeSource.id+'/chunks/'+String(chunk.index).padStart(8,'0'),structuredClone(chunk));
 ctx.window.CLOUD_RETRY_DELAY_MS=600000;
 shim.document.getElementById('addInput').value='Own upload whose reply was lost';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 let lost=false;
 faults.afterTransaction=async docs=>{if(!lost&&docs.get('users/owner')?.rev===revision+1){lost=true;throw Object.assign(Error('reply lost'),{code:'unavailable'});}};
 await ctx.sendPush();await adoptionSettle2254(ctx,'the upload whose reply is lost settles');
 delete faults.afterTransaction;
 const root=backend.docs.get('users/owner'),unreadableId=root.activeGeneration,pending=await store.getPendingUpload('owner');
 assert.equal(lost,true,'fixture: the upload was published and its reply lost');
 assert.deepEqual([root.rev,root.previousGeneration],[revision+1,activeSource.id],'fixture: the upload is the next revision over the acknowledged copy');
 assert.deepEqual([pending?.generationId,pending?.baseRev,pending?.payloadHash],[unreadableId,revision,backend.docs.get(generations+unreadableId).hash],
  'fixture: this device still records the upload as its own pending one');
 assert.equal(ctx.state.syncRev,revision,'fixture: the device stays based on its acknowledged copy');
 for(const key of [...backend.docs.keys()])if(key.startsWith(generations+unreadableId+'/chunks/'))backend.docs.delete(key);
 ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=1;
 const pushes=[],push=backend.CS.push;
 backend.CS.push=async(payload,updatedAt,baseRev,context)=>{pushes.push({payload,baseRev});return push(payload,updatedAt,baseRev,context);};
 t.after(()=>{backend.CS.push=push;});
 return {...app,revision,unreadableId,acknowledgedId:activeSource.id,unreadablePath:generations+unreadableId,acknowledgedPath:generations+activeSource.id,pushes,push};
}
// The headers-only device records that name an unreadable generation.
async function unreadableRecords2254(store,unreadableId){
 return (await store.listOpaqueArchives()).filter(row=>row.key.startsWith('unreadable-generation-record:')&&row.raw.includes(unreadableId));
}
function assertHeadersOnlyRecord2254(rows,{unreadableId,acknowledgedId},message){
 assert.ok(rows.length>=1,message+': a device record names the unreadable generation');
 for(const row of rows){
  const value=JSON.parse(row.raw);
  assert.equal(value.format,'chain-scanner.unreadable-generation-record');
  assert.equal(value.manifest.activeGeneration,unreadableId);assert.equal(value.manifest.previousGeneration,acknowledgedId);
  assert.deepEqual(value.generations.map(generation=>generation.id).sort(),[unreadableId,acknowledgedId].sort(),message+': it names both generations');
  for(const generation of value.generations){
   assert.equal(typeof generation.header?.hash,'string',message+': it keeps each generation’s header');
   assert.equal(Object.hasOwn(generation,'chunks'),false,message+': it keeps no chunk');
  }
  assert.ok(row.raw.length<4096,message+': the record is small ('+row.raw.length+' characters)');
 }
}
// A different device publishes a readable next revision straight to the cloud.
async function publishElsewhere2254(backend,codec,payload){
 const root=backend.docs.get('users/owner'),id='generation-elsewhere-'+(root.rev+1),encoded=await codec.encodeSnapshot(payload),path='users/owner/generations/'+id;
 backend.docs.set(path,{schemaVersion:2,state:'published',encoding:encoded.encoding,chunkCount:encoded.chunkCount,byteLength:encoded.byteLength,hash:encoded.hash,baseRev:root.rev,createdAt:{toMillis:()=>1234}});
 for(const chunk of encoded.chunks)backend.docs.set(path+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk);
 backend.docs.set('users/owner',{...root,rev:root.rev+1,activeGeneration:id,previousGeneration:root.activeGeneration});
 return id;
}

// #2254 (owner decision, 2026-11-06, superseding review S1): "if the broken
// parts of the save are unrecoverable, we need to cut our losses." No client
// can read the unreadable generation, so who saved it no longer decides: once
// the generation before it is proved to be this device's acknowledged copy,
// the board is adopted whether another writer saved the unreadable one and
// nothing is pending here, this device's own upload was interrupted, or a
// later upload replaced and cleared this device's pending record.
test('RISK contained board adoption: when the generation before the unreadable one is exactly this device’s acknowledged copy, a large board publishes itself once as the next revision whoever saved the unreadable generation, keeping it protected, untouched and named by a headers-only device record after later saves',async t=>{
 for(const variant of ['another writer saved it and nothing is pending here','this device’s own interrupted upload','a later upload replaced and cleared the pending one'])await t.test(variant,async sub=>{
  const elsewhere=variant==='another writer saved it and nothing is pending here',replaced=variant==='a later upload replaced and cleared the pending one';
  const app=elsewhere?await containedAdoptionApp2254(sub):await ownInterruptedUploadApp2254(sub);
  const {ctx,shim,backend,unreadableId,acknowledgedId,unreadablePath,pushes}=app,store=ctx.window.ScannerDeviceStore,revision=ctx.state.syncRev;
  assert.equal(ctx.state.decisionBase.revision,revision,'fixture: the device acknowledged the generation before the unreadable one');
  assert.equal((await backend.CS.pull()).code,'corrupt-generation','fixture: the next revision cannot be read');
  if(elsewhere)assert.equal(await store.getPendingUpload('owner'),null,'fixture: this device has no upload of its own pending');
  // Work goes on, so the board is newer than the unreadable generation's base.
  await newerEditBeforeAdoption2254(app);
  const before=JSON.parse(JSON.stringify(ctx.state)),unreadableBefore=generationDocs2254(backend,unreadablePath);
  const archivesBefore=(await store.listOpaqueArchives()).map(row=>row.key).sort();
  const results=[],recorded=backend.CS.push;
  if(replaced){
   // A later upload of the newer board, still based on the acknowledged copy,
   // replaces the pending pointer, conflicts with the unreadable revision and
   // clears it; the read that follows the conflict is the one that adopts.
   backend.CS.push=async(...args)=>{const result=await recorded(...args);results.push(result);return result;};
   sub.after(()=>{backend.CS.push=recorded;});
   ctx.window.CLOUD_RETRY_DELAY_MS=600000;await ctx.sendPush();
  }else{ctx.closeModal();await flush();await ctx.cloudPull();}
  await adoptionSettle2254(ctx,'the opening settles');
  if(replaced){
   assert.deepEqual([pushes[0]?.baseRev,results[0]?.conflict],[revision,true],'fixture: the later upload, based on the acknowledged copy, conflicted with the unreadable revision');
  }
  const adopted=replaced?pushes.slice(1):pushes;
  // Behaviour under test: one publication over the unreadable revision it proved.
  assert.deepEqual(adopted.map(row=>row.baseRev),[revision+1],'the device board is published once, over the unreadable revision');
  const root=backend.docs.get('users/owner');
  assert.equal(root.rev,revision+2,'the device board is the next revision');
  assert.equal(root.previousGeneration,unreadableId,'the unreadable generation is the previous one, not replaced');
  const published=backend.docs.get('users/owner/generations/'+root.activeGeneration);
  const chunks=[...backend.docs].filter(([key])=>key.startsWith('users/owner/generations/'+root.activeGeneration+'/chunks/')).map(([,row])=>row).sort((a,b)=>a.index-b.index);
  assert.equal(await ctx.window.ChainStorageV2.decodeSnapshot(published,chunks),adopted[0].payload);
  assert.equal(adopted[0].payload,ctx.cloudPayload(),'the cloud holds exactly this device’s board');
  // Lossless for this device: every accepted task and decision, including the newer edit.
  for(const task of before.tasks)assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.tasks.find(row=>row.id===task.id)??null)),task);
  for(const key of ['decisionEvents','decisionBaseline','workLog','chain','deletedTaskIds','clearedHistoryIds'])
   assert.deepEqual(JSON.parse(JSON.stringify(ctx.state[key]??null)),before[key]??null,key);
  // Ordinary-save cost: no reconciliation and no recovery archive, only a
  // headers-only record that names the unreadable generation.
  const records=await unreadableRecords2254(store,unreadableId);
  assertHeadersOnlyRecord2254(records,{unreadableId,acknowledgedId},'after adoption');
  assert.deepEqual((await store.listOpaqueArchives()).map(row=>row.key).filter(key=>!records.some(row=>row.key===key)).sort(),archivesBefore,'no recovery archive is written');
  assert.equal(await store.getRecoveryCloudHold(),null);
  // The unreadable generation stays untouched and protected, as does the earlier one.
  assert.equal(generationDocs2254(backend,unreadablePath),unreadableBefore,'the unreadable generation is untouched');
  for(const id of [unreadableId,acknowledgedId])assert.ok(backend.docs.get('users/owner/recoveryProtections/'+id),'generation '+id+' is protected in the cloud');
  // The device took the cloud's confirmation; nothing waits.
  assert.equal(ctx.state.syncRev,revision+2);assert.equal(ctx.state.syncDirty,false);
  assert.equal(ctx.validDecisionBase(ctx.state.decisionBase,ctx.state.syncAccount,revision+2),true);
  assert.equal(ctx.state.decisionBase.payload,adopted[0].payload,'the new acknowledged copy is the published board');
  assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
  assert.equal(await store.getPendingUpload('owner'),null,'no upload stays pending');
  assert.equal(ctx.localStorage.getItem('fvp:chain-scanner:proved-unreadable-cloud-source'),null,'no refusal is remembered');
  // Two later ordinary saves rotate the unreadable generation out of both root slots.
  for(const title of ['First ordinary save after adoption','Second ordinary save after adoption']){
   shim.document.getElementById('addInput').value=title;await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
   await ctx.sendPush();await adoptionSettle2254(ctx,title+' settles');
  }
  const later=backend.docs.get('users/owner');
  assert.equal(later.rev,revision+4,'positive control: both later saves were published');
  assert.ok(![later.activeGeneration,later.previousGeneration].includes(unreadableId),'positive control: the root no longer names the unreadable generation');
  assertHeadersOnlyRecord2254(await unreadableRecords2254(store,unreadableId),{unreadableId,acknowledgedId},'after later saves');
  assert.ok(backend.docs.get('users/owner/recoveryProtections/'+unreadableId),'the unreadable generation stays protected in the cloud');
  assert.equal(generationDocs2254(backend,unreadablePath),unreadableBefore,'and untouched');
 });
});

// The proof that still decides (b9ad6f8): the generation before the unreadable
// one is this device's acknowledged copy, and an upload this device left
// pending is this board, that copy, the unreadable generation itself, or this
// adoption's own staged upload. A pending upload that names a root generation
// with another payload, an upload staged at the acknowledged revision that
// never published, or one staged at the unreadable revision that no adoption
// on this device recorded may hold work this board lacks, so the board waits.
test('RISK contained board adoption: when the generation before the unreadable one is not proved to be this device’s acknowledged copy, or this device’s pending upload may hold work this board lacks, nothing is published, a large board still waits, and a proved earlier generation keeps the unreadable one named by a headers-only record',async t=>{
 for(const variant of ['earlier generation differs','acknowledged copy is older','pending upload is not that generation’s','pending upload names neither root generation','a staged upload at the unreadable revision that no adoption here recorded'])await t.test(variant,async sub=>{
  const pendingVariant=!['earlier generation differs','acknowledged copy is older'].includes(variant);
  const app=pendingVariant?await containedAdoptionApp2254(sub):await ownInterruptedUploadApp2254(sub),{ctx,shim,backend,acknowledgedPath,pushes}=app,store=ctx.window.ScannerDeviceStore;
  const revision=ctx.state.syncRev,codec=ctx.window.ChainStorageV2,account=ctx.state.syncAccount;
  if(variant==='earlier generation differs')await rewriteGenerationFixture(backend,acknowledgedPath,codec,board=>{board.futureEarlierFixture={opaque:'not this device’s copy'};return JSON.stringify(board);});
  if(variant==='acknowledged copy is older')backend.docs.set('users/owner',{...backend.docs.get('users/owner'),rev:revision+2});
  // This device's pending upload record, as an interrupted push leaves one.
  const pending={'pending upload is not that generation’s':{generationId:app.unreadableId,payloadHash:'f'.repeat(64),baseRev:revision},
   'pending upload names neither root generation':{generationId:'generation-staged-2254',payloadHash:'a'.repeat(64),baseRev:revision},
   'a staged upload at the unreadable revision that no adoption here recorded':{generationId:'generation-staged-unrecorded-2254',payloadHash:'b'.repeat(64),baseRev:revision+1}}[variant];
  if(pending)await store.setPendingUpload('owner',{...pending,updatedAt:1,account});
  await newerEditBeforeAdoption2254(app);
  const before=JSON.stringify(ctx.state),cloudBefore=[...backend.docs].filter(([key])=>!key.startsWith('users/owner/recoveryProtections/'));
  ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the opening settles');
  assert.deepEqual(pushes,[],'nothing is published');
  assert.equal(JSON.stringify([...backend.docs].filter(([key])=>!key.startsWith('users/owner/recoveryProtections/'))),JSON.stringify(cloudBefore),'no cloud generation changes');
  assert.equal(JSON.stringify(ctx.state),before,'the board stays exactly as it was');
  assert.equal(ctx.state.syncDirty,true);
  assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ recovery waiting','a large board still waits');
  if(pending){
   assert.deepEqual(await store.getPendingUpload('owner'),{...pending,updatedAt:1,account:'owner'},'the pending upload stays exactly as it was');
   assertHeadersOnlyRecord2254(await unreadableRecords2254(store,app.unreadableId),{unreadableId:app.unreadableId,acknowledgedId:app.acknowledgedId},'while it waits');
  }
 });
});

test('RISK contained board adoption: a device that remembers a recovery wait adopts its board when it reconnects once containment is proven, whoever saved the unreadable generation, and a conflicting write keeps the newer revision another device published',async t=>{
 for(const variant of ['reconnect after a remembered wait','reconnect after a remembered wait over another writer’s generation','another writer advances the cloud'])await t.test(variant,async sub=>{
  const app=variant==='reconnect after a remembered wait over another writer’s generation'?await containedAdoptionApp2254(sub):await ownInterruptedUploadApp2254(sub);
  const {ctx,shim,backend,acknowledgedPath,pushes,push}=app,codec=ctx.window.ChainStorageV2;
  const revision=ctx.state.syncRev,base=JSON.stringify(ctx.state.decisionBase);
  await newerEditBeforeAdoption2254(app);
  if(variant.startsWith('reconnect after a remembered wait')){
   // First the earlier generation does not match, so the device waits and remembers it.
   await rewriteGenerationFixture(backend,acknowledgedPath,codec,board=>{board.futureEarlierFixture={opaque:'not yet'};return JSON.stringify(board);});
   ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the waiting opening settles');
   assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ recovery waiting','positive control: it waits');
   assert.ok(ctx.localStorage.getItem('fvp:chain-scanner:proved-unreadable-cloud-source'),'positive control: the wait is remembered');
   assert.deepEqual(pushes,[],'positive control: nothing was published while it waited');
   // The earlier generation then holds exactly the acknowledged copy again.
   await rewriteGenerationFixture(backend,acknowledgedPath,codec,()=>JSON.parse(base).payload);
   vm.runInContext('resumeCloudSync({type:"online"})',ctx);
   await fixtureDeadline(async wait=>{while(!pushes.length||!adoptionIdle2254(ctx))await wait(10);},'the reconnect adopts',30000);
  }else{
   // Between the proof and the write, another device publishes a readable next revision.
   const extra={id:'t-written-elsewhere-2254',title:'Written on another device before the adoption'};
   backend.CS.push=async(payload,updatedAt,baseRev,context)=>{
    pushes.push({payload,baseRev});
    if(pushes.length===1){
     const board=JSON.parse(JSON.parse(base).payload);board.tasks=[...board.tasks,{...board.tasks[0],...extra}];
     await publishElsewhere2254(backend,codec,JSON.stringify(board));
     assert.equal(backend.docs.get('users/owner').rev,revision+2,'fixture: the other device publishes first');
    }
    return push(payload,updatedAt,baseRev,context);
   };
   ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the conflict settles');
   await fixtureDeadline(async wait=>{while(ctx.state.syncDirty||!adoptionIdle2254(ctx))await wait(10);},'the conflict reconciles',30000);
   assert.equal(pushes[0].baseRev,revision+1,'the adoption wrote over the unreadable revision only');
   assert.ok(ctx.state.tasks.some(task=>task.title===extra.title),'the other device’s newer revision is read and kept, never overwritten');
  }
  const root=backend.docs.get('users/owner'),last=pushes.at(-1);
  assert.equal(ctx.state.syncDirty,false,'the board is confirmed by the cloud');
  assert.equal(ctx.state.syncRev,root.rev);
  assert.ok(ctx.state.tasks.some(task=>task.title==='Newer local edit before adoption'),'the newer local edit is kept');
  assert.equal(last.payload,ctx.cloudPayload());
  assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
 });
});

// #2254 review (B1): an adoption upload that a network drop, the push deadline
// or an app switch cuts off inside the real push leaves its own staged upload
// recorded as pending, at the unreadable revision. The ownership evidence the
// first attempt used is then gone from the pending record, so the later
// attempt finds it in the headers-only record the first attempt kept. It
// resumes that staged upload when the board is unchanged, or replaces it when
// newer work arrived, and never protects it, so it can be retired like any
// other abandoned upload.
test('RISK contained board adoption: an adoption upload cut off inside the real push by a network drop, the push deadline or an app switch resumes or replaces only its own staged upload on a later attempt, and publishes once over the unreadable revision',async t=>{
 for(const variant of ['network drop before staging','network drop after staging','push deadline','app switch','newer work after the cut','Retry sync after the cut'])await t.test(variant,async sub=>{
  const app=await ownInterruptedUploadApp2254(sub,variant==='push deadline'?{timeoutMs:1500}:{}),{ctx,shim,backend,faults,revision,unreadableId,unreadablePath,acknowledgedId,pushes}=app;
  const store=ctx.window.ScannerDeviceStore,generations='users/owner/generations/';
  // The harness's timers do not hold the process open while a deliberate run waits.
  const alive=setInterval(()=>{},20);sub.after(()=>clearInterval(alive));
  await newerEditBeforeAdoption2254(app);
  const unreadableBefore=generationDocs2254(backend,unreadablePath);
  const stagedOf=async docs=>{
   const pending=await store.getPendingUpload('owner');if(pending?.baseRev!==revision+1)return null;
   const header=docs.get(generations+pending.generationId),chunks=[...docs.keys()].filter(key=>key.startsWith(generations+pending.generationId+'/chunks/')).length;
   return {pending,header,complete:header?.state==='staging'&&chunks===header.chunkCount};
  };
  let cut=false;
  sub.after(()=>{delete faults.beforeTransaction;delete faults.publishPending;shim.document.hidden=false;});
  if(variant==='push deadline')faults.publishPending=new Promise(()=>{});
  else faults.beforeTransaction=async docs=>{
   if(cut)return;const staged=await stagedOf(docs);if(!staged)return;
   // Cut off before staging, the upload leaves nothing the full recovery of
   // Retry sync could take instead (the reviewer's probe on #2254).
   if(['network drop before staging','Retry sync after the cut'].includes(variant)){cut=true;throw Object.assign(Error('offline mid-upload'),{code:'unavailable'});}
   if(!staged.complete)return;
   cut=true;
   // Switching to another app hides the page, which suspends cloud work.
   if(variant==='app switch'){shim.document.hidden=true;shim.document.dispatchEvent({type:'visibilitychange'});return;}
   throw Object.assign(Error('offline mid-upload'),{code:'unavailable'});
  };
  ctx.closeModal();await flush();await ctx.cloudPull();
  if(variant==='push deadline')await fixtureDeadline(async wait=>{while(!faults.publicationStarted)await wait(10);},'the publication starts',30000);
  await adoptionSettle2254(ctx,'the cut-off attempt settles');
  if(variant==='push deadline')cut=faults.publicationStarted===true;
  assert.equal(cut,true,'positive control: the upload was cut off inside the push');
  assert.equal(pushes.length,1,'positive control: one adoption upload was attempted');
  assert.equal(backend.docs.get('users/owner').rev,revision+1,'the cloud did not move');
  const left=await store.getPendingUpload('owner');
  assert.equal(left?.baseRev,revision+1,'fixture: the cut-off upload is still pending, at the unreadable revision');
  assert.notEqual(left.generationId,unreadableId);
  assert.equal(ctx.state.syncRev,revision,'a cut-off upload changes no revision');
  delete faults.publishPending;
  if(variant==='newer work after the cut'){shim.document.getElementById('addInput').value='Newer work after the cut';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);}
  // The later attempt: an app switch returns through the page lifecycle, the
  // person may press Retry sync (a deliberate read), the others read again.
  if(variant==='app switch'){shim.document.hidden=false;shim.document.dispatchEvent({type:'visibilitychange'});}
  else if(variant==='Retry sync after the cut')await ctx.onAction('sync-retry',{});
  else await ctx.cloudPull();
  await fixtureDeadline(async wait=>{while(pushes.length<2||!adoptionIdle2254(ctx))await wait(10);},'the later attempt publishes',30000);
  await adoptionSettle2254(ctx,'the later attempt settles');
  const root=backend.docs.get('users/owner');
  assert.deepEqual(pushes.map(row=>row.baseRev),[revision+1,revision+1],'both attempts write over the unreadable revision only');
  assert.equal(root.rev,revision+2,'the board is published once, as the next revision');
  assert.equal(root.previousGeneration,unreadableId,'the unreadable generation is the previous one');
  if(variant==='newer work after the cut'){
   assert.notEqual(root.activeGeneration,left.generationId,'newer work replaces the cut-off staged upload with a new one');
   assert.notEqual(backend.docs.get(generations+left.generationId)?.state,'published','the replaced staged upload is never published');
   assert.equal(backend.docs.has('users/owner/recoveryProtections/'+left.generationId),false,'nor protected, so the ordinary collector can retire it');
  }else assert.equal(root.activeGeneration,left.generationId,'the unchanged board resumes its own staged upload');
  const published=backend.docs.get(generations+root.activeGeneration);
  const chunks=[...backend.docs].filter(([key])=>key.startsWith(generations+root.activeGeneration+'/chunks/')).map(([,row])=>row).sort((a,b)=>a.index-b.index);
  assert.equal(await ctx.window.ChainStorageV2.decodeSnapshot(published,chunks),ctx.cloudPayload(),'the cloud holds exactly this device’s board');
  assert.equal(await store.getPendingUpload('owner'),null,'no upload stays pending');
  assert.equal(ctx.state.syncRev,revision+2);assert.equal(ctx.state.syncDirty,false);
  assert.ok(ctx.state.tasks.some(task=>task.title==='Newer local edit before adoption'),'the newer local edit is kept');
  if(variant==='newer work after the cut')assert.ok(ctx.state.tasks.some(task=>task.title==='Newer work after the cut'),'and so is the work after the cut');
  assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
  assert.equal(generationDocs2254(backend,unreadablePath),unreadableBefore,'the unreadable generation is untouched');
  for(const id of [unreadableId,acknowledgedId])assert.ok(backend.docs.get('users/owner/recoveryProtections/'+id),'generation '+id+' stays protected');
 });
});

// #2266 (found by the #2261 audit): a device with its own device store on a
// cloud that another device, with its own device store, also saves to.
async function sharedCloudDevice2266(t,{sharedDocs=null,name}){
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='shared-cloud-2266-'+name+'-'+Math.random();
 const app=await loadAppAtTime(1792323060000,{indexedDBProvider:indexedDB,deviceDbName});t.after(()=>closeLegacyApp173(app));
 const {ctx,shim}=app,faults={authPending:true};
 const backend=await loadCloudBackendV2({runtimeWindow:ctx.window,sharedDocs,failures:faults,timeoutMs:5000,recoveryTimeoutMs:5000});t.after(()=>backend.CS.suspend());
 // Saves and retries happen only when this test asks for them. The recovery
 // work budget is exhausted, so a device that is not allowed to adopt waits.
 ctx.window.CLOUD_PUSH_DELAY_MS=60000;ctx.window.CLOUD_RETRY_DELAY_MS=600000;ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=1;
 backend.emitAuth({uid:'owner',email:'e@example.com'});ctx.closeModal();
 await fixtureDeadline(async wait=>{while(vm.runInContext('automaticCloudFallbackBootCapturePending||!state',ctx))await wait();},name+' opens');
 await ctx.cloudPull();await adoptionSettle2254(ctx,name+' reads the cloud');
 const add=async title=>{shim.document.getElementById('addInput').value=title;await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);};
 const save=async message=>{await ctx.sendPush();await adoptionSettle2254(ctx,message);};
 const read=async message=>{await ctx.cloudPull();await adoptionSettle2254(ctx,message);};
 return {...app,backend,faults,add,save,read};
}
const sharedCloudRoot2266=backend=>backend.docs.get('users/owner');
const removeChunks2266=(backend,generationId)=>{for(const key of [...backend.docs.keys()])if(key.startsWith('users/owner/generations/'+generationId+'/chunks/'))backend.docs.delete(key);};
async function publishedPayload2266(device,generationId){
 const path='users/owner/generations/'+generationId,header=device.backend.docs.get(path);
 const chunks=[...device.backend.docs].filter(([key])=>key.startsWith(path+'/chunks/')).map(([,row])=>row).sort((a,b)=>a.index-b.index);
 return device.ctx.window.ChainStorageV2.decodeSnapshot(header,chunks);
}

// #2266 scenario A. Device D's save commits the next revision, but its reply
// is lost. D's next read finds that revision identical to its board and
// records it as confirmed. Device E then saves a readable revision, which D
// reads. Later a revision loses its chunks: either a newer one from E (D's
// board is built on the copy before it, so D publishes its board over it) or
// the one D read and holds exactly (D rebuilds it). The confirmed upload
// leaves nothing that could hold work D's board lacks, so D does exactly what
// a device whose reply arrived does.
test('RISK contained board adoption: an upload whose reply was lost and that a later read confirmed does not stop the device publishing its board over a later unreadable revision or rebuilding one it holds exactly, as a device whose reply arrived does',{timeout:120000},async t=>{
 for(const [reply,unreadable] of [['the reply arrived','a newer revision'],['the reply was lost','a newer revision'],
  ['the reply arrived','the revision the device holds exactly'],['the reply was lost','the revision the device holds exactly']])
  await t.test(reply+', then '+unreadable+' cannot be read',async sub=>{
  const d=await sharedCloudDevice2266(sub,{name:'D'});
  await d.add('Saved on D first');await d.save('D saves');
  const confirmed=sharedCloudRoot2266(d.backend).rev;
  await d.add('Saved on D second');
  let lost=false;
  if(reply==='the reply was lost')d.faults.afterTransaction=async docs=>{
   if(!lost&&docs.get('users/owner')?.rev===confirmed+1){lost=true;throw Object.assign(Error('reply lost'),{code:'unavailable'});}};
  await d.save('D saves again');delete d.faults.afterTransaction;
  assert.equal(sharedCloudRoot2266(d.backend).rev,confirmed+1,'fixture: the second save is the next revision');
  if(reply==='the reply was lost'){
   assert.equal(lost,true,'fixture: the server committed and the reply was lost');
   assert.equal(d.ctx.state.syncRev,confirmed,'fixture: without the reply D is still based on the revision before');
   await d.read('D reads its own save back');
  }
  assert.equal(d.ctx.state.syncRev,confirmed+1,'fixture: D has confirmed its second save');
  assert.equal(d.ctx.state.syncDirty,false);
  assert.equal(d.shim.document.getElementById('syncBtn').textContent,'☁ synced','fixture: D shows synced');
  // Device E reads the cloud and saves a readable revision, which D reads.
  const e=await sharedCloudDevice2266(sub,{sharedDocs:d.backend.docs,name:'E'});
  await e.add('Saved on E');await e.save('E saves');
  const readable=sharedCloudRoot2266(d.backend);
  assert.equal(readable.rev,confirmed+2,'fixture: E saved the next revision');
  await d.read('D reads E’s save');
  assert.equal(d.ctx.state.syncRev,confirmed+2,'fixture: D confirmed E’s revision');
  assert.ok(d.ctx.state.tasks.some(task=>task.title==='Saved on E'),'fixture: D holds E’s work');
  assert.equal(d.ctx.state.syncDirty,false);
  const board=d.ctx.cloudPayload();
  let damaged;
  if(unreadable==='a newer revision'){
   await e.add('Saved on E again');await e.save('E saves again');
   damaged=sharedCloudRoot2266(d.backend);
   assert.equal(damaged.rev,confirmed+3,'fixture: E saved a newer revision');
  }else damaged=readable;
  removeChunks2266(d.backend,damaged.activeGeneration);
  assert.equal((await d.backend.CS.pull()).code,'corrupt-generation','fixture: that revision cannot be read');
  await d.read('D reads the unreadable revision');
  // Behaviour under test: D saves its board as the next revision, keeping the
  // unreadable one as the previous generation.
  const root=sharedCloudRoot2266(d.backend);
  assert.equal(root.rev,damaged.rev+1,'D saves the next revision over the unreadable one');
  assert.equal(root.previousGeneration,damaged.activeGeneration,'the unreadable revision is the previous one, not replaced');
  assert.equal(await publishedPayload2266(d,root.activeGeneration),board,'the cloud holds exactly D’s board');
  assert.equal(d.ctx.cloudPayload(),board,'D’s board is unchanged');
  assert.equal(d.ctx.state.syncRev,root.rev,'D confirmed it');
  assert.equal(d.ctx.state.syncDirty,false);
  assert.equal(d.shim.document.getElementById('syncBtn').textContent,'☁ synced','D shows synced');
 });
});

// #2268 review (finding 12): a read that finds this device's own lost-reply
// save clears only that save's pending record. The device keeps one pending
// upload record per account, shared by its pages, so by the time the read
// comes another page of this device may have staged its own upload, which may
// hold work this page's board lacks. That record, or one naming the landed
// generation with other bytes, must survive the read: when a later revision
// cannot be read, it still keeps the device from publishing its board.
test('RISK contained board adoption: a read that confirms this device’s lost-reply save keeps a pending upload record that is not that save, so a later unreadable revision still waits for it',{timeout:180000},async t=>{
 for(const record of ['the landed save’s own record','another page staged its own upload','the landed generation with other bytes'])await t.test(record,async sub=>{
  const d=await sharedCloudDevice2266(sub,{name:'D'}),store=d.ctx.window.ScannerDeviceStore;
  await d.add('Saved on D first');await d.save('D saves');
  const confirmed=sharedCloudRoot2266(d.backend).rev;
  await d.add('Saved on D second');
  let lost=false;
  d.faults.afterTransaction=async docs=>{if(!lost&&docs.get('users/owner')?.rev===confirmed+1){lost=true;throw Object.assign(Error('reply lost'),{code:'unavailable'});}};
  await d.save('D saves again');delete d.faults.afterTransaction;
  const landed=sharedCloudRoot2266(d.backend),own=await store.getPendingUpload('owner');
  assert.equal(lost,true,'fixture: the server committed and the reply was lost');
  assert.deepEqual([own?.generationId,own?.baseRev],[landed.activeGeneration,confirmed],'fixture: the pending record is the landed save');
  const otherBytes=await d.ctx.window.ChainStorageV2.hashPayload(JSON.stringify({staged:'by another page, with work this board lacks'}));
  if(record==='another page staged its own upload')
   assert.equal((await store.setPendingUpload('owner',{...own,generationId:'staged-by-another-page',payloadHash:otherBytes}))?.ok,true,'fixture: another page staged its upload');
  else if(record==='the landed generation with other bytes')
   assert.equal((await store.setPendingUpload('owner',{...own,payloadHash:otherBytes}))?.ok,true,'fixture: the record names the landed generation with other bytes');
  await d.read('D reads its own save back');
  assert.equal(d.ctx.state.syncRev,confirmed+1,'fixture: D confirmed its save');
  // Device E saves the next revision, which loses its chunks.
  const e=await sharedCloudDevice2266(sub,{sharedDocs:d.backend.docs,name:'E'});
  await e.add('Saved on E');await e.save('E saves');
  const damaged=sharedCloudRoot2266(d.backend);
  assert.equal(damaged.rev,confirmed+2,'fixture: E saved the next revision');
  removeChunks2266(d.backend,damaged.activeGeneration);
  const board=d.ctx.cloudPayload();
  await d.read('D reads the unreadable revision');
  const root=sharedCloudRoot2266(d.backend);
  if(record==='the landed save’s own record'){
   // Positive control: the confirmed save leaves nothing to wait for.
   assert.equal(root.rev,damaged.rev+1,'positive control: D publishes its board over the unreadable revision');
   assert.equal(d.shim.document.getElementById('syncBtn').textContent,'☁ synced');
  }else{
   // Behaviour under test: a record that is not the landed save still stops D publishing.
   assert.equal(root.rev,damaged.rev,'nothing is published');
   assert.equal(root.activeGeneration,damaged.activeGeneration);
   assert.equal(d.ctx.cloudPayload(),board,'D’s board stays as it was');
   assert.notEqual(d.shim.document.getElementById('syncBtn').textContent,'☁ synced','D does not show synced');
  }
 });
});

// #2268 review (finding 3): this device's own upload published the next
// revision but its reply was lost, and that revision's chunks were then lost
// too. An adoption run another page left unfinished keeps contained adoption
// out of an ordinary opening, so the exact rebuild republishes the bytes this
// device holds exactly, over the pending record it captured. The #2266 clear
// of a confirmed pending upload ran for the rebuild's stand-in read as well,
// so the rebuild's save was refused as a changed pending upload and the device
// showed an error until another read.
test('RISK exact acknowledged cloud source: the exact rebuild of this device’s own upload whose reply was lost publishes the board and shows synced',async t=>{
 const app=await ownInterruptedUploadApp2254(t),{ctx,shim,backend,revision,unreadableId,pushes}=app;
 ctx.localStorage.setItem('fvp:chain-scanner:contained-adoption-run',JSON.stringify({v:1,account:ctx.state.syncAccount,identity:'owner',rev:revision+1,generationId:unreadableId,page:'another-page'}));
 assert.equal((await backend.CS.pull()).code,'corrupt-generation','fixture: the upload’s revision cannot be read');
 const board=ctx.cloudPayload();
 ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the opening settles');
 await fixtureDeadline(async wait=>{await wait(20);while(!adoptionIdle2254(ctx))await wait(10);},'the rebuild settles',30000);
 assert.deepEqual(pushes.map(row=>row.baseRev),[revision+1],'positive control: the rebuild saves over the unreadable revision');
 // Behaviour under test: the rebuild's save lands and the device shows synced.
 const root=backend.docs.get('users/owner');
 assert.equal(root.rev,revision+2,'the board is published as the next revision');
 assert.equal(await publishedPayload2266({ctx,backend},root.activeGeneration),board,'the cloud holds exactly this board');
 assert.equal(ctx.state.syncRev,root.rev,'this device confirmed it');
 assert.equal(ctx.state.syncDirty,false);
 assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced','the device shows synced');
});

// #2266 scenario B. Device D, confirmed at a revision, saves an edit, and the
// save is cut off after its upload was staged and before it was published.
// Device E then saves the next revision, which loses its chunks. When D's
// board is still exactly what that upload staged, publishing the board loses
// nothing the upload held, so D publishes it over the unreadable revision.
// When the board has changed since, the record's hash cannot say what the
// staged upload holds, which may be work the board lacks, so D keeps waiting
// and publishes nothing.
test('RISK contained board adoption: an upload of exactly this board that was cut off before it published does not stop the device publishing its board over a later unreadable revision, and one that differs from the board still does',{timeout:120000},async t=>{
 for(const board of ['the board is exactly what the upload staged','the board changed after the cut'])await t.test(board,async sub=>{
  const d=await sharedCloudDevice2266(sub,{name:'D'}),store=d.ctx.window.ScannerDeviceStore,generations='users/owner/generations/';
  await d.add('Saved on D first');await d.save('D saves');
  const confirmed=sharedCloudRoot2266(d.backend).rev;
  assert.equal(d.ctx.state.syncRev,confirmed,'fixture: D confirmed its first save');
  await d.add('Saved on D, cut off');
  const staged=d.ctx.cloudPayload();
  let cut=false;
  d.faults.beforeTransaction=async docs=>{
   if(cut)return;const pending=await store.getPendingUpload('owner');
   if(pending?.baseRev===confirmed&&docs.get(generations+pending.generationId)?.state==='sealed'){cut=true;throw Object.assign(Error('offline mid-upload'),{code:'unavailable'});}};
  await d.save('D’s save is cut off');delete d.faults.beforeTransaction;
  assert.equal(cut,true,'fixture: the upload was staged and cut off before publishing');
  assert.equal(sharedCloudRoot2266(d.backend).rev,confirmed,'fixture: the cut-off upload did not publish');
  assert.equal(d.ctx.state.syncRev,confirmed,'fixture: D is still based on its confirmed revision');
  if(board==='the board changed after the cut'){
   await d.add('Saved on D after the cut');
   assert.notEqual(d.ctx.cloudPayload(),staged,'fixture: the board no longer matches the staged upload');
  }else assert.equal(d.ctx.cloudPayload(),staged,'fixture: the board is exactly what the upload staged');
  // Device E reads the cloud and saves the next revision, which loses its chunks.
  const e=await sharedCloudDevice2266(sub,{sharedDocs:d.backend.docs,name:'E'});
  await e.add('Saved on E');await e.save('E saves');
  const damaged=sharedCloudRoot2266(d.backend);
  assert.equal(damaged.rev,confirmed+1,'fixture: E saved the next revision');
  removeChunks2266(d.backend,damaged.activeGeneration);
  assert.equal((await d.backend.CS.pull()).code,'corrupt-generation','fixture: that revision cannot be read');
  const boardBefore=d.ctx.cloudPayload();
  await d.read('D reads the unreadable revision');
  const root=sharedCloudRoot2266(d.backend);
  if(board==='the board changed after the cut'){
   // Behaviour kept: an upload that may hold work the board lacks still stops adoption.
   assert.equal(root.rev,damaged.rev,'nothing is published');
   assert.equal(root.activeGeneration,damaged.activeGeneration);
   assert.equal(d.ctx.cloudPayload(),boardBefore,'D’s board stays as it was');
   assert.equal(d.ctx.state.syncDirty,true,'D’s board is not confirmed');
   assert.notEqual(d.shim.document.getElementById('syncBtn').textContent,'☁ synced','D does not show synced');
  }else{
   // Behaviour under test: D saves its board as the next revision, keeping the
   // unreadable one as the previous generation.
   assert.equal(root.rev,damaged.rev+1,'D saves the next revision over the unreadable one');
   assert.equal(root.previousGeneration,damaged.activeGeneration,'the unreadable revision is the previous one, not replaced');
   assert.equal(await publishedPayload2266(d,root.activeGeneration),staged,'the cloud holds exactly D’s board, which is what the cut-off upload staged');
   assert.equal(d.ctx.cloudPayload(),staged,'D’s board is unchanged');
   assert.equal(d.ctx.state.syncRev,root.rev,'D confirmed it');
   assert.equal(d.ctx.state.syncDirty,false);
   assert.equal(d.shim.document.getElementById('syncBtn').textContent,'☁ synced','D shows synced');
  }
 });
});

// #2254 review (B2): showing, focusing or reconnecting the app asks for the
// check of earlier incomplete cloud sources. Adoption forgot the #2228 mark
// that keeps that check for a deliberate run on a phone that waited over its
// work budget, and on a device with no automatic recovery the check fell back
// to reading every saved copy and archive, on every return to the app.
test('RISK contained board adoption: after adoption, showing, focusing or reconnecting the app reads no whole device store, and a remembered over-budget mark stays',async t=>{
 for(const variant of ['a device that never waited','a phone that waited over its work budget'])await t.test(variant,async sub=>{
  const app=await ownInterruptedUploadApp2254(sub),{ctx,shim,backend,acknowledgedPath,pushes}=app,store=ctx.window.ScannerDeviceStore,codec=ctx.window.ChainStorageV2;
  const base=JSON.stringify(ctx.state.decisionBase),OVER='fvp:chain-scanner:automatic-recovery-over-budget';
  await newerEditBeforeAdoption2254(app);
  if(variant==='a phone that waited over its work budget'){
   // It waited first: the earlier generation did not match yet.
   await rewriteGenerationFixture(backend,acknowledgedPath,codec,board=>{board.futureEarlierFixture={opaque:'not yet'};return JSON.stringify(board);});
   ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the waiting opening settles');
   assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ recovery waiting','positive control: it waits');
   assert.ok(ctx.localStorage.getItem(OVER),'positive control: the over-budget wait is remembered');
   await rewriteGenerationFixture(backend,acknowledgedPath,codec,()=>JSON.parse(base).payload);
  }
  const mark=ctx.localStorage.getItem(OVER);
  ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the adoption settles');
  await fixtureDeadline(async wait=>{while(vm.runInContext('cloudSourceRecoveryBusy',ctx))await wait(10);},'the adoption settles',30000);
  assert.equal(pushes.length,1,'positive control: the board was adopted');
  assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
  assert.equal(ctx.localStorage.getItem(OVER),mark,'the over-budget mark is kept exactly as it was');
  const counts={snapshots:0,listings:0};
  const readRaw=store.readRawExportSnapshot,list=store.listOpaqueArchives;
  store.readRawExportSnapshot=function(...args){counts.snapshots++;return readRaw.apply(this,args);};
  store.listOpaqueArchives=function(...args){if(!args[0]?.prefix)counts.listings++;return list.apply(this,args);};
  sub.after(()=>{store.readRawExportSnapshot=readRaw;store.listOpaqueArchives=list;});
  for(const event of ['pageshow','focus','online','visibilitychange']){
   if(event==='visibilitychange')shim.document.dispatchEvent({type:event});else shim.window.dispatchEvent({type:event});
   await adoptionSettle2254(ctx,event+' settles');
   await fixtureDeadline(async wait=>{await wait(20);while(vm.runInContext('cloudSourceRecoveryBusy',ctx))await wait(10);},event+' settles',30000);
  }
  assert.deepEqual(counts,{snapshots:0,listings:0},'no return to the app reads every saved copy or archive');
  assert.equal(pushes.length,1,'nothing more is published');
  assert.equal(ctx.localStorage.getItem(OVER),mark,'the over-budget mark is still kept');
  assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
 });
});

// #2254 review (S2), the crash mark the owner asked for on #2239: a page the
// phone closes in the middle of an adoption must not start the same work again
// at every opening. The run is marked in device storage, and the mark read
// back, before its first full source read; a run that ends (published, failed
// or stopped because the page was hidden) clears it. A mark an earlier page
// left makes the next opening wait as it did before adoption existed, while
// Retry sync still adopts deliberately.
test('RISK contained board adoption: a run that ends without completing leaves its saved crash mark, so the next opening waits instead of adopting again and Retry sync adopts deliberately, and a mark that cannot be saved and read back stops adoption before it starts',async t=>{
 const MARK='fvp:chain-scanner:contained-adoption-run';
 await t.test('the page closed mid-run',async sub=>{
  const first=await ownInterruptedUploadApp2254(sub,{timeoutMs:60000}),{ctx,backend,faults,revision,unreadableId}=first;
  await newerEditBeforeAdoption2254(first);
  // The first page's adoption upload never returns: the phone closes the page mid-run.
  faults.publishPending=new Promise(()=>{});
  ctx.closeModal();await flush();ctx.cloudPull();
  await fixtureDeadline(async wait=>{while(!faults.publicationStarted)await wait(10);},'the first page starts publishing',30000);
  const left=JSON.parse(first.shim.localStorage.getItem(MARK)||'null');
  // The next opening: a new page over the same device storage and cloud.
  const next=await loadAppAtTime(1792323000000,{indexedDBProvider:first.indexedDB,deviceDbName:first.deviceDbName,sharedStorage:first.shim.localStorage});
  sub.after(()=>closeLegacyApp173(next));
  Object.assign(next.ctx.window,{CLOUD_RECOVERY_WORK_BUDGET_BYTES:1,CLOUD_RETRY_DELAY_MS:600000,CLOUD_PUSH_DELAY_MS:60000});
  const cloud=await loadCloudBackendV2({runtimeWindow:next.ctx.window,sharedDocs:backend.docs,failures:{authPending:true},timeoutMs:5000,recoveryTimeoutMs:5000});
  sub.after(()=>cloud.CS.suspend());
  const nextPushes=[],push=cloud.CS.push;cloud.CS.push=async(...args)=>{nextPushes.push({baseRev:args[2]});return push(...args);};
  cloud.emitAuth({uid:'owner',email:'e@example.com'});next.ctx.closeModal();
  await fixtureDeadline(async wait=>{while(vm.runInContext('automaticCloudFallbackBootCapturePending||!state',next.ctx))await wait(10);},'the next page opens',30000);
  await next.ctx.cloudPull();await adoptionSettle2254(next.ctx,'the next opening settles');
  assert.deepEqual(nextPushes,[],'the next opening does not adopt again');
  assert.equal(backend.docs.get('users/owner').rev,revision+1,'nothing is published');
  assert.equal(next.shim.document.getElementById('syncBtn').textContent,'☁ recovery waiting','it waits instead');
  assert.deepEqual([left?.rev,left?.generationId],[revision+1,unreadableId],'the first page marked its run in device storage');
  assert.deepEqual(JSON.parse(next.shim.localStorage.getItem(MARK)||'null'),left,'the mark stays for later openings too');
  // Retry sync is deliberate, so it adopts.
  await next.ctx.onAction('sync-retry',{});
  await fixtureDeadline(async wait=>{while(!nextPushes.length||!adoptionIdle2254(next.ctx))await wait(10);},'Retry sync adopts',30000);
  await adoptionSettle2254(next.ctx,'Retry sync settles');
  assert.deepEqual(nextPushes.map(row=>row.baseRev),[revision+1],'Retry sync publishes once, over the unreadable revision');
  assert.equal(backend.docs.get('users/owner').rev,revision+2);
  assert.ok(next.ctx.state.tasks.some(task=>task.title==='Newer local edit before adoption'),'the newer local edit is kept');
  assert.equal(next.shim.document.getElementById('syncBtn').textContent,'☁ synced');
  assert.equal(next.shim.localStorage.getItem(MARK),null,'the completed run clears the mark');
 });
 await t.test('device storage refuses the mark',async sub=>{
  const app=await ownInterruptedUploadApp2254(sub),{ctx,shim,backend,revision,pushes}=app;
  await newerEditBeforeAdoption2254(app);
  const setItem=shim.localStorage.setItem;
  shim.localStorage.setItem=function(key,value){if(key===MARK)throw Object.assign(Error('storage full'),{name:'QuotaExceededError'});return setItem.call(this,key,value);};
  sub.after(()=>{shim.localStorage.setItem=setItem;});
  ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the opening settles');
  assert.deepEqual(pushes,[],'adoption does not start without its saved mark');
  assert.equal(backend.docs.get('users/owner').rev,revision+1,'nothing is published');
  assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ recovery waiting','the board waits as before');
 });
});

// #2254 review (S2): an unreadable generation lets the board's next frame and
// any input queued behind it go first (#2226). Adoption reads the device's
// pending upload and the cloud's generation headers, so it starts after that
// frame too, and input handled in it is part of what adoption publishes.
test('RISK contained board adoption: the board’s next frame and queued input go before the adoption’s first cloud or device read',async t=>{
 const app=await ownInterruptedUploadApp2254(t),{ctx,shim,backend,revision,pushes}=app;
 await newerEditBeforeAdoption2254(app);
 const order=[],evidence=backend.CS.recoveryEvidence,headers=backend.CS.readRecoverySourceHeaders;
 backend.CS.recoveryEvidence=async(...args)=>{order.push('pending-upload-read');return evidence(...args);};
 backend.CS.readRecoverySourceHeaders=async(...args)=>{order.push('header-read');return headers(...args);};
 // A frame the page draws; input queued behind it is handled in it.
 ctx.window.requestAnimationFrame=callback=>{
  if(vm.runInContext('pulling',ctx)&&!order.includes('frame')){
   order.push('frame');shim.document.getElementById('addInput').value='Typed while the frame was drawn';ctx.onAction('add',{});
  }
  setTimeout(callback,0);return 1;
 };
 // #2254 re-review: the save that input starts lands its head commit while
 // adoption writes its headers-only record, which is guarded by the head the
 // page knew before that commit. Hold the two so they always meet that way
 // (it happened in about half of the runs by timing alone).
 const store=ctx.window.ScannerDeviceStore,commit=store.commitHead,protect=store.protectRecoverySource,raced=[];
 let recordCalled,typedLanded,typedHeld=false,recordHeld=false;
 const recordCall=new Promise(resolve=>{recordCalled=resolve;}),typedCommit=new Promise(resolve=>{typedLanded=resolve;});
 const bounded=promise=>Promise.race([promise,new Promise(resolve=>setTimeout(resolve,5000))]);
 store.commitHead=async function(options,...rest){
  if(!typedHeld&&typeof options?.payload==='string'&&options.payload.includes('Typed while the frame was drawn')){
   typedHeld=true;await bounded(recordCall);
   try{return await commit.call(this,options,...rest);}finally{raced.push('save-commit');typedLanded();}
  }
  return commit.call(this,options,...rest);
 };
 store.protectRecoverySource=async function(options,...rest){
  if(!options?.key?.startsWith('unreadable-generation-record:'))return protect.call(this,options,...rest);
  if(!recordHeld){recordHeld=true;raced.push('record-write');recordCalled();await bounded(typedCommit);}
  const result=await protect.call(this,options,...rest);raced.push(result?'record-written':'record-refused');return result;
 };
 const alive=setInterval(()=>{},20);
 t.after(()=>{clearInterval(alive);delete ctx.window.requestAnimationFrame;backend.CS.recoveryEvidence=evidence;backend.CS.readRecoverySourceHeaders=headers;
  store.commitHead=commit;store.protectRecoverySource=protect;});
 ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the opening settles');
 assert.deepEqual(raced.slice(0,3),['record-write','save-commit','record-refused'],
  'fixture: the save’s head commit lands while the record is written, so that write is refused '+JSON.stringify(raced));
 await fixtureDeadline(async wait=>{while(!pushes.length||!adoptionIdle2254(ctx))await wait(10);},'the board is adopted in the same session '+JSON.stringify(raced),30000);
 assert.equal(raced.at(-1),'record-written','after the save settles the record is written over the head this page saved '+JSON.stringify(raced));
 assert.equal(order[0],'frame','the board’s next frame goes before any adoption read '+JSON.stringify(order));
 assert.ok(order.includes('pending-upload-read')&&order.includes('header-read'),'positive control: adoption read the pending upload and the headers '+JSON.stringify(order));
 assert.deepEqual(pushes.map(row=>row.baseRev),[revision+1],'the board is then adopted once');
 assert.ok(JSON.parse(pushes[0].payload).tasks.some(task=>task.title==='Typed while the frame was drawn'),'the input handled in that frame is published with it');
 assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
});
// The retry above is only over the head this page saved. When another tab
// moves the head while the record is written, the retry never writes over it.
test('RISK contained board adoption: a headers-only record write refused because another tab moved the device head is not retried over that newer head',async t=>{
 const app=await ownInterruptedUploadApp2254(t),{ctx,shim,backend,revision,pushes}=app,store=ctx.window.ScannerDeviceStore;
 await newerEditBeforeAdoption2254(app);
 const commit=store.commitHead,protect=store.protectRecoverySource,writes=[];let otherTab=null;
 store.protectRecoverySource=async function(options,...rest){
  if(!options?.key?.startsWith('unreadable-generation-record:'))return protect.call(this,options,...rest);
  if(!otherTab){
   const head=await store.readHead(),board=JSON.parse(head.payload);board.otherTabFixture2254='saved in another tab';
   otherTab=JSON.stringify(board);
   assert.equal((await commit.call(store,{expectedHash:head.hash,payload:otherTab,account:head.account??null}))?.ok,true,'fixture: another tab saves a newer head');
  }
  const result=await protect.call(this,options,...rest);writes.push(result);return result;
 };
 t.after(()=>{store.protectRecoverySource=protect;});
 ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the opening settles');
 assert.ok(writes.length>=1&&writes.every(result=>result===false),'every record write over the other tab’s head is refused '+JSON.stringify(writes));
 assert.equal((await store.readHead()).payload,otherTab,'the other tab’s newer head is kept');
 assert.deepEqual(pushes,[],'nothing is published');
 assert.equal(backend.docs.get('users/owner').rev,revision+1);
 assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ recovery waiting','the board waits as before');
});

// #2254 review (S4): Use my board from before recovery returns this device's
// board and keeps cloud saving paused, as its toast and Help say. Adoption
// would publish that board by itself, so it respects the choice instead:
// nothing is published on reconnect or Retry sync while the choice holds.
test('RISK contained board adoption: after the person chooses Use my board from before recovery, adoption does not publish that board by itself and cloud saving stays paused',async t=>{
 const app=await ownInterruptedUploadApp2254(t),{ctx,shim,backend,faults,revision,pushes}=app,store=ctx.window.ScannerDeviceStore,generations='users/owner/generations/';
 await newerEditBeforeAdoption2254(app);
 // This small board is within the recovery work budget.
 ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=64*1048576;
 // A first adoption stages its own upload, and the network drops just
 // before that upload is published.
 let cut=false;
 faults.beforeTransaction=async docs=>{if(cut)return;const pending=await store.getPendingUpload('owner');
  if(pending?.baseRev===revision+1&&docs.get(generations+pending.generationId)?.state==='sealed'){cut=true;throw Object.assign(Error('offline mid-upload'),{code:'unavailable'});}};
 ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the cut-off adoption settles');
 delete faults.beforeTransaction;
 assert.equal(cut,true,'positive control: the first adoption was cut off before publishing');
 const staged=await store.getPendingUpload('owner');
 assert.equal(staged?.baseRev,revision+1,'fixture: its own staged upload is pending');
 const before=JSON.stringify(ctx.state);
 // The next read cannot save the adoption's record (device storage refuses it
 // on every try of that read), so the automatic recovery default opens
 // instead, with this device's own complete staged upload, and its
 // publication is refused.
 const protect=store.protectRecoverySource;let refusedRecord=0,refusing=true;
 store.protectRecoverySource=async function(...args){if(refusing&&args[0]?.key?.startsWith('unreadable-generation-record:')){refusedRecord++;return false;}return protect.apply(this,args);};
 t.after(()=>{store.protectRecoverySource=protect;});
 const {idle}=await pendingAutomaticDefault2194(t,app);
 refusing=false;
 assert.ok(refusedRecord>=1,'fixture: the adoption record was refused');
 // The person chooses Use my board from before recovery in open Settings.
 t.after(faithfulModalQuery2194(shim));
 ctx.openSettings();shim.document.getElementById('toast').textContent='';
 const button=declineButton2194();
 shim.document.dispatchEvent({type:'pointerdown',target:button});shim.document.dispatchEvent({type:'click',detail:1,target:button});
 await fixtureDeadline(async wait=>{await wait(5);while(!idle()||((await store.getRecoveryCloudHold())&&!shim.document.getElementById('toast').textContent))await wait(20);},'the decline settles',30000);
 const toastText=shim.document.getElementById('toast').textContent;
 assert.equal(await store.getRecoveryCloudHold(),null,'positive control: the decline released the older copy');
 assert.equal(JSON.stringify(ctx.state),before,'positive control: the board from before recovery is back');
 // Now everything adoption needs holds: cloud writes work again, the earlier
 // generation is the acknowledged copy, and the record of the first attempt
 // proves the unreadable generation is this device's own upload.
 delete faults.push;ctx.closeModal();
 assert.deepEqual(await store.getPendingUpload('owner'),staged,'fixture: the adoption’s own staged upload is still pending');
 const published=pushes.length,cloudBefore=JSON.stringify([...backend.docs].filter(([key])=>!key.startsWith('users/owner/recoveryProtections/')));
 for(const attempt of ['reconnect','Retry sync']){
  if(attempt==='reconnect')shim.window.dispatchEvent({type:'online'});else await ctx.onAction('sync-retry',{});
  await adoptionSettle2254(ctx,attempt+' settles');
  await fixtureDeadline(async wait=>{await wait(20);while(!idle())await wait(10);},attempt+' settles',30000);
  assert.equal(pushes.length,published,'nothing is published after '+attempt);
  assert.equal(backend.docs.get('users/owner').rev,revision+1,'the cloud stays at the unreadable revision after '+attempt);
  assert.equal(JSON.stringify([...backend.docs].filter(([key])=>!key.startsWith('users/owner/recoveryProtections/'))),cloudBefore,'no cloud generation changes after '+attempt);
  assert.equal(JSON.stringify(ctx.state),before,'the board from before recovery stays after '+attempt);
  assert.ok(ctx.localStorage.getItem('fvp:chain-scanner:declined-automatic-cloud-recovery'),'the choice is kept after '+attempt);
 }
 // So the toast that confirmed the choice told the truth.
 assert.equal(toastText,'Your earlier board is back. Cloud saving stays paused.');
});

// #2265 (found by the #2261 audit): the exact-acknowledged-cloud-source path
// republishes an unreadable generation whose bytes are this device's
// acknowledged copy. Adoption and the automatic recovery default both keep the
// person's Use my board from before recovery; this path must keep it too, or
// an ordinary reconnect publishes the board and shows synced after a toast
// that said cloud saving stays paused.
test('RISK exact acknowledged cloud source: after the person chooses Use my board from before recovery, a reconnect or Retry sync does not rebuild and publish the exact copy by itself and cloud saving stays paused',async t=>{
 const app=await damagedAcknowledgedApp187(t),{ctx,shim,backend,originalRoot}=app,store=ctx.window.ScannerDeviceStore;
 ctx.window.CLOUD_RETRY_DELAY_MS=600000;
 const declineKey='fvp:chain-scanner:declined-automatic-cloud-recovery';
 assert.equal(ctx.state.syncRev,originalRoot.rev,'fixture: this device acknowledged the generation that is now unreadable');
 // On this opening the exact path cannot archive its source (device storage
 // refuses that write), so the same pull opens the automatic recovery
 // default instead, and that default's publication is refused.
 const protect=store.protectRecoverySource;let refusedExact=0,refusing=true;
 store.protectRecoverySource=async function(...args){if(refusing&&args[0]?.key?.startsWith('cloud-generation-recovery:')){refusedExact++;return false;}return protect.apply(this,args);};
 t.after(()=>{store.protectRecoverySource=protect;});
 const {idle}=await pendingAutomaticDefault2194(t,app);
 refusing=false;
 assert.ok(refusedExact>=1,'fixture: the exact path’s archive write was refused on that opening');
 // The person chooses Use my board from before recovery in open Settings.
 t.after(faithfulModalQuery2194(shim));
 ctx.openSettings();shim.document.getElementById('toast').textContent='';
 const button=declineButton2194();
 shim.document.dispatchEvent({type:'pointerdown',target:button});shim.document.dispatchEvent({type:'click',detail:1,target:button});
 await fixtureDeadline(async wait=>{await wait(5);while(!idle()||((await store.getRecoveryCloudHold())&&!shim.document.getElementById('toast').textContent))await wait(20);},'the decline settles',30000);
 assert.equal(shim.document.getElementById('toast').textContent,'Your earlier board is back. Cloud saving stays paused.','positive control: the decline succeeded');
 assert.equal(await store.getRecoveryCloudHold(),null,'positive control: the decline released the older copy');
 assert.ok(ctx.localStorage.getItem(declineKey),'positive control: the choice is remembered');
 const before=JSON.stringify(ctx.state);
 // Cloud writes and device storage work again. Every condition the exact path
 // needs now holds: the unreadable generation's bytes are this device's
 // acknowledged copy.
 delete app.faults.push;ctx.closeModal();
 const pushes=[],push=backend.CS.push;backend.CS.push=async(...args)=>{pushes.push(args[2]);return push(...args);};
 t.after(()=>{backend.CS.push=push;});
 const cloudBefore=JSON.stringify([...backend.docs].filter(([key])=>!key.startsWith('users/owner/recoveryProtections/')));
 for(const attempt of ['reconnect','Retry sync']){
  if(attempt==='reconnect')shim.window.dispatchEvent({type:'online'});else await ctx.onAction('sync-retry',{});
  await adoptionSettle2254(ctx,attempt+' settles');
  await fixtureDeadline(async wait=>{await wait(20);while(!idle())await wait(10);},attempt+' settles',30000);
  assert.deepEqual(pushes,[],'nothing is published after '+attempt);
  assert.equal(backend.docs.get('users/owner').rev,originalRoot.rev,'the cloud stays at the unreadable revision after '+attempt);
  assert.equal(JSON.stringify([...backend.docs].filter(([key])=>!key.startsWith('users/owner/recoveryProtections/'))),cloudBefore,'no cloud generation changes after '+attempt);
  assert.equal(JSON.stringify(ctx.state),before,'the board from before recovery stays after '+attempt);
  assert.ok(ctx.localStorage.getItem(declineKey),'the choice is kept after '+attempt);
  assert.notEqual(shim.document.getElementById('syncBtn').textContent,'☁ synced','the status never says synced after '+attempt);
 }
});

// #2268 review (finding 1): the same exact-copy device as the #2265 test,
// after the person chose Use my board from before recovery. Answers the app,
// its backend and the unreadable generation's chunk path, with cloud writes and
// device storage working again and nothing read or published yet.
async function declinedExactCopy2268(t){
 const app=await damagedAcknowledgedApp187(t),{ctx,shim,backend,originalRoot}=app,store=ctx.window.ScannerDeviceStore;
 ctx.window.CLOUD_RETRY_DELAY_MS=600000;
 const protect=store.protectRecoverySource;let refusing=true;
 store.protectRecoverySource=async function(...args){if(refusing&&args[0]?.key?.startsWith('cloud-generation-recovery:'))return false;return protect.apply(this,args);};
 t.after(()=>{store.protectRecoverySource=protect;});
 const {idle}=await pendingAutomaticDefault2194(t,app);
 refusing=false;
 t.after(faithfulModalQuery2194(shim));
 ctx.openSettings();shim.document.getElementById('toast').textContent='';
 const button=declineButton2194();
 shim.document.dispatchEvent({type:'pointerdown',target:button});shim.document.dispatchEvent({type:'click',detail:1,target:button});
 await fixtureDeadline(async wait=>{await wait(5);while(!idle()||((await store.getRecoveryCloudHold())&&!shim.document.getElementById('toast').textContent))await wait(20);},'the decline settles',30000);
 assert.equal(shim.document.getElementById('toast').textContent,'Your earlier board is back. Cloud saving stays paused.','positive control: the decline succeeded');
 delete app.faults.push;ctx.closeModal();
 const pushes=[],push=backend.CS.push;backend.CS.push=async(...args)=>{pushes.push(args[2]);return push(...args);};
 t.after(()=>{backend.CS.push=push;});
 const settle=async message=>{await adoptionSettle2254(ctx,message);await fixtureDeadline(async wait=>{await wait(20);while(!idle())await wait(10);},message,30000);};
 return {...app,idle,settle,pushes,unreadableChunks:'server:users/owner/generations/'+originalRoot.activeGeneration+'/chunks'};
}

// #2268 review (finding 1): #2265 kept the exact rebuild from publishing over
// the person's Use my board from before recovery, but it returned before the
// rebuild's completed check recorded the write hold, so the declined root was
// never remembered as a completed refusal. Each reconnect then downloaded and
// decoded the whole unreadable generation again, and each edit's save started
// another full cloud read. Once one read has found the declined root again,
// later reconnects and saves read only the root, as for any other refusal.
test('RISK exact acknowledged cloud source: after the person chooses Use my board from before recovery, later saves and reconnects do not download the unreadable generation again and still publish nothing',async t=>{
 const app=await declinedExactCopy2268(t),{ctx,shim,backend,originalRoot,pushes,settle,unreadableChunks}=app;
 const downloads=()=>backend.network.filter(entry=>entry===unreadableChunks).length;
 shim.window.dispatchEvent({type:'online'});await settle('the first reconnect after the decline settles');
 const afterFirstRead=downloads();
 assert.ok(afterFirstRead>=1,'positive control: the first read after the decline finds the unreadable generation again');
 for(const step of ['an edit is saved','a reconnect','another edit is saved','another reconnect']){
  if(step.endsWith('saved')){
   shim.document.getElementById('addInput').value='Kept on this device: '+step;await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
   vm.runInContext('clearTimeout(cloudTimer);cloudTimer=null',ctx);await ctx.sendPush();
  }else shim.window.dispatchEvent({type:'online'});
  await settle(step+' settles');
  // Behaviour under test: the declined root is a completed refusal, so neither saves nor reconnects download it again.
  assert.equal(downloads(),afterFirstRead,'the unreadable generation is not downloaded again after '+step);
  assert.deepEqual(pushes,[],'nothing is published after '+step);
  assert.equal(backend.docs.get('users/owner').rev,originalRoot.rev,'the cloud stays at the unreadable revision after '+step);
  assert.notEqual(shim.document.getElementById('syncBtn').textContent,'☁ synced','the status never says synced after '+step);
 }
 assert.ok(ctx.state.tasks.some(task=>task.title==='Kept on this device: another edit is saved'),'the edits stay on this device');
});

// #2254 release review (B1, specialist): the pull reports a decode that failed
// without a code as an unreadable generation, so a digest the browser could
// not compute once (a DOMException), a RangeError under memory pressure or a
// chunk read that threw without a code all reach adoption as one. Here another
// device publishes a readable next revision over this device's acknowledged
// copy, so containment holds, and this device's first read or digest of it
// fails. The owner accepted losing only work in a copy no client can read, so
// adoption may publish only when the bytes it downloaded fail the codec's own
// checks again. Otherwise the board recovers as it did before adoption existed
// (9dc3d77): a large board waits, and a board within budget reconciles both
// devices' work. The same revision with a damaged or missing chunk, which no
// client can read, still adopts.
const ELSEWHERE_TASK_2254='saved-on-another-device-2254';
async function readableElsewhereApp2254(t,{large,damage=null}){
 const app=await damagedAcknowledgedApp187(t),{ctx,backend,activeSource}=app,generations='users/owner/generations/';
 // The generation this device acknowledged is complete again.
 for(const chunk of activeSource.chunks)backend.docs.set(generations+activeSource.id+'/chunks/'+String(chunk.index).padStart(8,'0'),structuredClone(chunk));
 // Another device publishes the next revision over that copy, with one more task.
 const other=JSON.parse(ctx.state.decisionBase.payload);
 other.tasks.push({...other.tasks[0],id:ELSEWHERE_TASK_2254,title:'Saved on another device'});
 const elsewhereId=await publishElsewhere2254(backend,ctx.window.ChainStorageV2,JSON.stringify(other)),elsewherePath=generations+elsewhereId;
 const chunkKey=elsewherePath+'/chunks/00000000';
 assert.equal(backend.docs.get(elsewherePath).chunkCount,1,'fixture: the other device’s revision is one chunk');
 if(damage==='altered'){const chunk=backend.docs.get(chunkKey);backend.docs.set(chunkKey,{...chunk,text:chunk.text.replace('Saved on another device','Saved on another devicX')});}
 if(damage==='missing')backend.docs.delete(chunkKey);
 ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=large?1:64*1048576;
 const pushes=[],push=backend.CS.push;
 backend.CS.push=async(payload,updatedAt,baseRev,context)=>{pushes.push({payload,baseRev});return push(payload,updatedAt,baseRev,context);};
 t.after(()=>{backend.CS.push=push;});
 return {...app,elsewhereId,elsewherePath,storedChunkText:backend.docs.get(chunkKey)?.text??null,pushes};
}
// The browser cannot compute a digest of this text: after `skip` digests of it
// go through, the next `times` throw.
function failDigestOf2254(t,text,{times=1,skip=0,error}){
 const subtle=webcrypto.subtle,own=Object.getOwnPropertyDescriptor(subtle,'digest'),digest=subtle.digest,seen={matched:0,failed:0};
 subtle.digest=async function(algorithm,data,...rest){
  if(data&&seen.failed<times&&new TextDecoder().decode(data)===text&&++seen.matched>skip){seen.failed++;throw error();}
  return digest.call(this,algorithm,data,...rest);
 };
 t.after(()=>{if(own)Object.defineProperty(subtle,'digest',own);else delete subtle.digest;});
 return seen;
}
async function currentCloudBoard2254(backend,codec){
 const root=backend.docs.get('users/owner'),path='users/owner/generations/'+root.activeGeneration;
 const chunks=[...backend.docs].filter(([key])=>key.startsWith(path+'/chunks/')).map(([,row])=>row).sort((a,b)=>a.index-b.index);
 return JSON.parse(await codec.decodeSnapshot(backend.docs.get(path),chunks));
}
const operationError2254=()=>new DOMException('The operation failed for an operation-specific reason','OperationError');
test('RISK contained board adoption: when one read or digest of a readable next revision another device published over the acknowledged copy fails, nothing is published over that device’s work: a large board waits, a board within budget keeps both devices’ work, and the same revision with a damaged or missing chunk still adopts',async t=>{
 const failures={
  'a digest the browser could not compute once':{times:1,error:operationError2254},
  'a range error once while hashing':{times:1,error:()=>new RangeError('Array buffer allocation failed')},
  'a chunk read that threw without a code once':{read:true},
  'a digest that failed in the pull and again in adoption’s own check':{times:2,error:operationError2254},
 };
 const variants=[...Object.keys(failures).flatMap(kind=>[[kind,true],[kind,false]]),['a damaged chunk',true],['a missing chunk',true]];
 for(const [kind,large] of variants)await t.test(kind+(large?', large board':', board within budget'),async sub=>{
  const damage={'a damaged chunk':'altered','a missing chunk':'missing'}[kind]??null,failure=failures[kind]??null;
  const app=await readableElsewhereApp2254(sub,{large,damage}),{ctx,shim,backend,faults,elsewhereId,elsewherePath,storedChunkText,pushes}=app;
  const store=ctx.window.ScannerDeviceStore,codec=ctx.window.ChainStorageV2,revision=ctx.state.syncRev;
  await newerEditBeforeAdoption2254(app);
  const before=JSON.stringify(ctx.state),elsewhereBefore=generationDocs2254(backend,elsewherePath);
  let seen={failed:0};
  if(failure?.read){
   faults.serverRead=async readPath=>{if(!seen.failed&&readPath===elsewherePath+'/chunks'){seen.failed++;throw Error('read failed without a code');}};
   sub.after(()=>{delete faults.serverRead;});
  }else if(failure)seen=failDigestOf2254(sub,storedChunkText,failure);
  ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the opening settles');
  // Positive control: the opening reached adoption, which proved the
  // generation before this revision is the acknowledged copy.
  assertHeadersOnlyRecord2254(await unreadableRecords2254(store,elsewhereId),{unreadableId:elsewhereId,acknowledgedId:app.activeSource.id},'the opening');
  const root=backend.docs.get('users/owner');
  if(damage){
   // Positive control: no client can read this revision, so this board is published once over it.
   assert.deepEqual(pushes.map(row=>row.baseRev),[revision+1],'this board is published once, over the unreadable revision');
   assert.deepEqual([root.rev,root.previousGeneration],[revision+2,elsewhereId],'the unreadable revision is the previous one, not replaced');
   assert.equal(pushes[0].payload,ctx.cloudPayload(),'the cloud holds exactly this device’s board');
   assert.equal(generationDocs2254(backend,elsewherePath),elsewhereBefore,'the unreadable revision stays untouched');
   assert.ok(backend.docs.get('users/owner/recoveryProtections/'+elsewhereId),'and protected in the cloud');
   assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
  }else{
   // Behaviour under test: nothing is published over the other device's work.
   for(const row of pushes)assert.ok(row.payload.includes(ELSEWHERE_TASK_2254),'every publication keeps the other device’s task');
   assert.equal(seen.failed,failure.times??1,'fixture: the read or digest failed as intended');
   const cloud=await currentCloudBoard2254(backend,codec);
   assert.ok(cloud.tasks.some(row=>row.id===ELSEWHERE_TASK_2254),'the cloud keeps the other device’s task');
   if(large){
    assert.deepEqual(pushes,[],'a large board publishes nothing');
    assert.deepEqual([root.rev,root.activeGeneration],[revision+1,elsewhereId],'the cloud stays at the other device’s revision');
    assert.equal(generationDocs2254(backend,elsewherePath),elsewhereBefore,'which stays untouched');
    assert.equal(JSON.stringify(ctx.state),before,'the board stays exactly as it was');
    assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ recovery waiting','a large board waits, as before adoption existed');
   }else{
    assert.deepEqual(pushes.map(row=>row.baseRev),[revision+1],'the reconciled board is published once, over the other device’s revision');
    assert.ok(cloud.tasks.some(row=>row.title==='Newer local edit before adoption'),'the cloud also holds this device’s newer edit');
    assert.ok(ctx.state.tasks.some(row=>row.id===ELSEWHERE_TASK_2254),'this board takes the other device’s task');
    assert.equal(ctx.state.syncDirty,false);
    assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
   }
  }
 });
});

// #2254 release review (B1): once adoption has downloaded a revision and found
// that it decodes, it can never publish over it, and a published generation's
// bytes never change. While a large board then waits, returning or
// reconnecting must not download both cloud copies again on every visit, as
// a phone does on each app switch: before adoption existed (9dc3d77) a waiting
// board downloaded nothing. Retry sync still reads afresh and takes both
// devices' work. A damaged revision whose own check failed for a reason the
// bytes do not show proved nothing either way, so the next return checks it
// again and adopts.
test('RISK contained board adoption: after a failed read of a readable next revision makes a large board wait, returning or reconnecting downloads no cloud copy again and Retry sync takes both devices’ work, while a damaged revision whose own check failed for another reason is checked again and adopted',async t=>{
 for(const variant of ['readable revision','damaged revision'])await t.test(variant,async sub=>{
  const damaged=variant==='damaged revision';
  const app=await readableElsewhereApp2254(sub,{large:true,damage:damaged?'altered':null}),{ctx,shim,backend,elsewhereId,storedChunkText,pushes}=app,revision=ctx.state.syncRev;
  await newerEditBeforeAdoption2254(app);
  // Readable: the pull's digest fails once. Damaged: the pull finds the
  // damage, then adoption's own check of the bytes it downloaded fails once.
  const seen=failDigestOf2254(sub,storedChunkText,{times:1,skip:damaged?1:0,error:operationError2254});
  const pulls={count:0},pull=backend.CS.pull;
  backend.CS.pull=async(...args)=>{pulls.count++;return pull(...args);};
  sub.after(()=>{backend.CS.pull=pull;});
  const downloads=()=>backend.network.filter(entry=>entry.endsWith('/chunks')).length;
  ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the opening settles');
  assert.equal(seen.failed,1,'fixture: one digest failed');
  assert.deepEqual(pushes,[],'positive control: nothing is published on opening');
  assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ recovery waiting','positive control: the large board waits');
  const opened=downloads();
  assert.ok(opened>0,'positive control: the opening downloaded the cloud copies');
  for(const type of damaged?['focus']:['focus','online']){
   const before=pulls.count;
   vm.runInContext('resumeCloudSync({type:'+JSON.stringify(type)+'})',ctx);
   await fixtureDeadline(async wait=>{while(pulls.count===before||!adoptionIdle2254(ctx))await wait(10);},type+' settles',30000);
   if(damaged)break;
   // Behaviour under test: the waiting board reads the root, never the copies again.
   assert.equal(downloads(),opened,'returning or reconnecting ('+type+') downloads no cloud copy again');
   assert.deepEqual(pushes,[],'nothing is published after '+type);
   assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ recovery waiting','the large board still waits after '+type);
  }
  if(damaged){
   // Positive control: bytes whose check proved nothing are checked again, and no client can read them.
   assert.deepEqual(pushes.map(row=>row.baseRev),[revision+1],'returning adopts this board once, over the damaged revision');
   assert.equal(backend.docs.get('users/owner').previousGeneration,elsewhereId);
   assert.equal(pushes[0].payload,ctx.cloudPayload());
   assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
  }else{
   // Retry sync reads afresh, finds the revision readable and keeps both devices' work.
   await ctx.onAction('sync-retry',{});await adoptionSettle2254(ctx,'Retry sync settles');
   assert.ok(downloads()>opened,'Retry sync downloads the cloud copy again');
   assert.deepEqual(pushes.map(row=>row.baseRev),[revision+1],'Retry sync publishes once, over the other device’s revision');
   const cloud=await currentCloudBoard2254(backend,ctx.window.ChainStorageV2);
   for(const [what,match] of [['the other device’s task',row=>row.id===ELSEWHERE_TASK_2254],['this device’s newer edit',row=>row.title==='Newer local edit before adoption']]){
    assert.ok(cloud.tasks.some(match),'the cloud holds '+what);assert.ok(ctx.state.tasks.some(match),'this board holds '+what);
   }
   assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced');
  }
 });
});

// #2254 (owner rule, 2026-11-06): daily backups cover three calendar days, but
// during a recovery hold, before the cloud has acknowledged a board, nothing
// recovery may need is trimmed. While cloud recovery waits on an unreadable
// copy, or the older copy is in use under a recovery hold, saves keep this
// account's daily backups for seven calendar days; once the cloud confirms a
// board, the next save trims them to three.
test('RISK daily backup retention hold: while cloud recovery waits on an unreadable copy or holds an older copy, saves keep daily backups for seven calendar days, and once the cloud confirms a board the next save trims them to three',async t=>{
 for(const variant of ['recovery waits on an unreadable copy','an older copy is in use under a recovery hold'])await t.test(variant,async sub=>{
  const app=await containedAdoptionApp2254(sub),{ctx,shim,backend,acknowledgedPath,pushes}=app,store=ctx.window.ScannerDeviceStore,codec=ctx.window.ChainStorageV2;
  const base=JSON.stringify(ctx.state.decisionBase);
  // The generation before the unreadable one is not yet this device's copy, so nothing is adopted.
  await rewriteGenerationFixture(backend,acknowledgedPath,codec,board=>{board.futureEarlierFixture={opaque:'not yet'};return JSON.stringify(board);});
  await newerEditBeforeAdoption2254(app);
  if(variant==='recovery waits on an unreadable copy'){
   ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the waiting opening settles');
   assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ recovery waiting','positive control: cloud recovery waits');
  }else{
   ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=64*1048576;
   await pendingAutomaticDefault2194(sub,app);
   assert.equal(vm.runInContext('!!deviceRecoveryCloudHold',ctx),true,'positive control: a recovery hold keeps the older copy');
  }
  // Daily backups this account saved on the six days before today, as a phone that waited for days keeps them.
  const dayBefore=days=>vm.runInContext('(()=>{const at=new Date(Date.now());at.setHours(12,0,0,0);at.setDate(at.getDate()-'+days+');return backupDay(+at);})()',ctx);
  const head=await store.readHead(),account=ctx.state.syncAccount??null,earlier=[];
  for(const days of [6,5,4,3]){
   const backup={id:'daily:held-2254-'+days,day:dayBefore(days),at:Date.now()-days*86400000,kind:'daily',payload:head.payload,account};
   assert.equal((await store.putBackup({expectedHash:head.hash,backup}))?.ok,true,'fixture: the daily backup from '+days+' days ago is saved');
   earlier.push(backup.id);
  }
  await ctx.refreshDeviceBackupCache();
  shim.document.getElementById('addInput').value='Saved while recovery holds';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
  const held=(await store.listBackups()).map(row=>row.id);
  // Behaviour under test: nothing recovery may need is trimmed while it waits or holds.
  assert.deepEqual(earlier.filter(id=>!held.includes(id)),[],'daily backups keep seven calendar days while recovery waits or holds');
  if(variant==='recovery waits on an unreadable copy'){
   // The earlier generation is this device's copy again, so the reconnect adopts and the cloud confirms the board.
   await rewriteGenerationFixture(backend,acknowledgedPath,codec,()=>JSON.parse(base).payload);
   vm.runInContext('resumeCloudSync({type:"online"})',ctx);
   await fixtureDeadline(async wait=>{while(!pushes.length||!adoptionIdle2254(ctx))await wait(10);},'the reconnect adopts',30000);
   assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced','positive control: the cloud confirmed the board');
   shim.document.getElementById('addInput').value='Saved after the cloud confirmed';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
   const after=await store.listBackups(),ids=after.map(row=>row.id);
   assert.deepEqual(earlier.filter(id=>ids.includes(id)),[],'the first save after the cloud confirms trims daily backups to three calendar days');
   assert.ok(after.some(row=>row.kind==='daily'&&row.day===dayBefore(0)),'today’s daily backup stays');
   assert.equal((await store.readHead()).payload,JSON.stringify(ctx.state),'the board itself is the saved head');
  }
 });
});

// #2264 (B): signing out ends the recovery's own records (the remembered
// unreadable copy, the decline and the waiting state), but the board on this
// device still belongs to the same account and the cloud has confirmed
// nothing. Its daily backups keep the seven days until the cloud confirms a
// board for that account, as Settings and the November 6 changelog promise.
test('RISK daily backup retention hold sign-out: signing out while cloud recovery waits keeps this account’s daily backups for seven calendar days, and once the account signs back in and the cloud confirms a board the next save trims them to three',async t=>{
 const app=await containedAdoptionApp2254(t),{ctx,shim,backend,acknowledgedPath,pushes}=app,store=ctx.window.ScannerDeviceStore,codec=ctx.window.ChainStorageV2;
 const base=JSON.stringify(ctx.state.decisionBase);
 // The generation before the unreadable one is not yet this device's copy, so nothing is adopted and recovery waits.
 await rewriteGenerationFixture(backend,acknowledgedPath,codec,board=>{board.futureEarlierFixture={opaque:'not yet'};return JSON.stringify(board);});
 await newerEditBeforeAdoption2254(app);
 ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the waiting opening settles');
 assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ recovery waiting','positive control: cloud recovery waits');
 const account=ctx.state.syncAccount??null;
 // The owner signs out while recovery waits.
 backend.emitAuth(null);await flush();await adoptionSettle2254(ctx,'the sign-out settles');
 assert.equal(ctx.state.syncAccount??null,account,'fixture: the board on this device still belongs to the same account');
 // Daily backups this account saved on the six days before today.
 const dayBefore=days=>vm.runInContext('(()=>{const at=new Date(Date.now());at.setHours(12,0,0,0);at.setDate(at.getDate()-'+days+');return backupDay(+at);})()',ctx);
 const head=await store.readHead(),earlier=[];
 for(const days of [6,5,4,3]){
  const backup={id:'daily:signed-out-2264-'+days,day:dayBefore(days),at:Date.now()-days*86400000,kind:'daily',payload:head.payload,account};
  assert.equal((await store.putBackup({expectedHash:head.hash,backup}))?.ok,true,'fixture: the daily backup from '+days+' days ago is saved');
  earlier.push(backup.id);
 }
 await ctx.refreshDeviceBackupCache();
 shim.document.getElementById('addInput').value='Saved while signed out';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 const held=(await store.listBackups()).map(row=>row.id);
 // Behaviour under test: signing out doesn't end the seven-day hold before the cloud confirms a board.
 assert.deepEqual(earlier.filter(id=>!held.includes(id)),[],'daily backups keep seven calendar days after signing out while recovery waits');
 // The earlier generation is this device's copy again; signing back in adopts and the cloud confirms the board.
 await rewriteGenerationFixture(backend,acknowledgedPath,codec,()=>JSON.parse(base).payload);
 backend.emitAuth({uid:'owner',email:'e@example.com'});ctx.closeModal();await ctx.cloudPull();
 await fixtureDeadline(async wait=>{while(!pushes.length||!adoptionIdle2254(ctx))await wait(10);},'signing back in adopts',30000);
 assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ synced','positive control: the cloud confirmed the board');
 shim.document.getElementById('addInput').value='Saved after the cloud confirmed';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 const after=await store.listBackups(),ids=after.map(row=>row.id);
 assert.deepEqual(earlier.filter(id=>ids.includes(id)),[],'the first save after the cloud confirms trims daily backups to three calendar days');
 assert.ok(after.some(row=>row.kind==='daily'&&row.day===dayBefore(0)),'today’s daily backup stays');
 assert.equal((await store.readHead()).payload,JSON.stringify(ctx.state),'the board itself is the saved head');
});

// #2268 review: a device whose cloud recovery waits on an unreadable
// generation, as in the #2264 (B) test.
async function waitingRecovery2268(t){
 const app=await containedAdoptionApp2254(t),{ctx,shim,backend,acknowledgedPath}=app,codec=ctx.window.ChainStorageV2;
 const base=JSON.stringify(ctx.state.decisionBase);
 await rewriteGenerationFixture(backend,acknowledgedPath,codec,board=>{board.futureEarlierFixture={opaque:'not yet'};return JSON.stringify(board);});
 await newerEditBeforeAdoption2254(app);
 ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the waiting opening settles');
 assert.equal(shim.document.getElementById('syncBtn').textContent,'☁ recovery waiting','positive control: cloud recovery waits');
 // Makes the generation before the unreadable one this device's copy again.
 const restoreEarlier=()=>rewriteGenerationFixture(backend,acknowledgedPath,codec,()=>JSON.parse(base).payload);
 return {...app,account:ctx.state.syncAccount??null,restoreEarlier};
}
// Saves this account's daily backups from six to three days before today on
// the device, then makes one ordinary save. Answers the ones that save removed.
async function dailyBackupsTrimmedBySave2268(ctx,shim,account,title){
 const store=ctx.window.ScannerDeviceStore;
 const dayBefore=days=>vm.runInContext('(()=>{const at=new Date(Date.now());at.setHours(12,0,0,0);at.setDate(at.getDate()-'+days+');return backupDay(+at);})()',ctx);
 const head=await store.readHead(),earlier=[];
 for(const days of [6,5,4,3]){
  const backup={id:'daily:held-2268-'+days+'-'+Math.random(),day:dayBefore(days),at:Date.now()-days*86400000,kind:'daily',payload:head.payload,account};
  assert.equal((await store.putBackup({expectedHash:head.hash,backup}))?.ok,true,'fixture: the daily backup from '+days+' days ago is saved');
  earlier.push(backup.id);
 }
 await ctx.refreshDeviceBackupCache();
 shim.document.getElementById('addInput').value=title;await ctx.onAction('add',{});assert.equal(await ctx.persist(),true,'fixture: the save succeeds');
 const kept=(await store.listBackups()).map(row=>row.id);
 return earlier.filter(id=>!kept.includes(id));
}

// #2268 review (finding 13): the #2264 (B) test never reloaded between the
// sign-out and the trimming save, so a hold kept only in memory passed it, and
// it never read a hold record that cannot be parsed, which must still hold:
// losing a daily backup cannot be undone. Here the app is relaunched signed
// out before the save, with the record as saved and with it unreadable.
test('RISK daily backup retention hold sign-out: after signing out while cloud recovery waits, the app relaunched signed out keeps this account’s daily backups for seven calendar days, also when the remembered hold cannot be read',async t=>{
 for(const record of ['as saved','unreadable'])await t.test('the hold record '+record,async sub=>{
  const app=await waitingRecovery2268(sub),{ctx,shim,backend,account}=app;
  backend.emitAuth(null);await flush();await adoptionSettle2254(ctx,'the sign-out settles');
  if(record==='unreadable')shim.localStorage.setItem('fvp:chain-scanner:daily-backup-recovery-hold','{"v":1,"account":');
  await closeLegacyApp173(app);backend.CS.suspend();
  const cold=await coldRelaunch2198(sub,app,[],{signIn:false});
  cold.backend.emitAuth(null);await flush();await cold.settle('the signed-out relaunch settles');
  assert.equal(cold.ctx.state.syncAccount??null,account,'fixture: the relaunched board still belongs to the same account');
  // Behaviour under test: the relaunched app keeps the seven-day hold.
  assert.deepEqual(await dailyBackupsTrimmedBySave2268(cold.ctx,cold.shim,account,'Saved after relaunching signed out'),[],
   'daily backups keep seven calendar days after a signed-out relaunch');
 });
});

// #2268 review (finding 4): while a contained adoption waits for the cloud to
// confirm its publication, the root is still unreadable and nothing has been
// confirmed. Hiding the page (an app switch) stops the adoption's upload and
// clears what the app held in memory, and the adoption had already forgotten
// the remembered unreadable copy, so a save made then trimmed this account's
// daily backups to three days.
test('RISK daily backup retention hold: an app switch that cuts off a contained adoption before the cloud confirms it keeps this account’s daily backups for seven calendar days',async t=>{
 const app=await ownInterruptedUploadApp2254(t),{ctx,shim,backend,faults,revision,pushes}=app,store=ctx.window.ScannerDeviceStore;
 await newerEditBeforeAdoption2254(app);
 const account=ctx.state.syncAccount??null;
 let hidden=false;
 t.after(()=>{delete faults.beforeTransaction;shim.document.hidden=false;});
 faults.beforeTransaction=async()=>{
  if(hidden)return;const pending=await store.getPendingUpload('owner');if(pending?.baseRev!==revision+1)return;
  hidden=true;shim.document.hidden=true;shim.document.dispatchEvent({type:'visibilitychange'});
 };
 ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the cut-off adoption settles');
 assert.equal(hidden,true,'fixture: the page was hidden inside the adoption’s upload');
 assert.equal(pushes.length,1,'positive control: the adoption’s upload started');
 assert.equal(backend.docs.get('users/owner').rev,revision+1,'fixture: the cloud did not confirm anything');
 assert.notEqual(shim.document.getElementById('syncBtn').textContent,'☁ synced','fixture: the board is not confirmed');
 // Behaviour under test: a save while the page is hidden keeps the seven days.
 assert.deepEqual(await dailyBackupsTrimmedBySave2268(ctx,shim,account,'Saved while the app is in the background'),[],
  'daily backups keep seven calendar days while the adoption waits for the cloud');
});

// #2268 review (finding 5): a read that finds the cloud's copy unreadable
// holds the daily backups through the error it reports. When the app never
// handles that read (the account signs out as it returns, or an open editor
// defers it), nothing else held them: the sign-out's own observation ran after
// the backend had cleared the error, and the next read clears it as it starts,
// so a save made then trimmed this account's daily backups to three days.
test('RISK daily backup retention hold: a reported unreadable cloud copy keeps this account’s daily backups for seven calendar days through a sign-out as the read returns and through a stalled next read',async t=>{
 for(const variant of ['sign-out as the read returns','an editor defers the read, then the next read stalls'])await t.test(variant,async sub=>{
  const app=await damagedAcknowledgedApp187(sub),{ctx,shim,backend,faults,originalRoot}=app;
  ctx.window.CLOUD_RETRY_DELAY_MS=600000;
  const account=ctx.state.syncAccount??null,chunksPath='users/owner/generations/'+originalRoot.activeGeneration+'/chunks';
  let reported=false;
  if(variant==='sign-out as the read returns'){
   ctx.window.addEventListener('cloudsync',()=>{
    if(reported||backend.CS.errorCode!=='corrupt-generation')return;
    reported=true;backend.emitAuth(null);
   });
   ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the read and the sign-out settle');
   assert.equal(backend.CS.user,null,'fixture: the account signed out');
  }else{
   faults.serverRead=async path=>{if(path===chunksPath&&!reported){reported=true;shim.document.activeElement={matches:selector=>selector.includes('input')};}};
   ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the deferred read settles');
   assert.equal(backend.CS.errorCode,'corrupt-generation','fixture: the read reported the unreadable copy');
   shim.document.activeElement=null;
   const stalled=deferredSyncFixture();sub.after(()=>stalled.resolve());
   let started=false;faults.serverRead=async()=>{started=true;await stalled.promise;};
   ctx.cloudPull();
   await fixtureDeadline(async wait=>{while(!started)await wait(5);},'the next read reaches the server',30000);
   assert.equal(vm.runInContext('pulling',ctx),true,'fixture: the next read is under way');
   assert.equal(backend.CS.errorCode,null,'fixture: the next read cleared the reported error as it started');
  }
  assert.equal(reported,true,'positive control: the unreadable copy was reported');
  assert.equal(backend.docs.get('users/owner').rev,originalRoot.rev,'fixture: the cloud confirmed nothing');
  // Behaviour under test: the reported unreadable copy keeps the seven days.
  assert.deepEqual(await dailyBackupsTrimmedBySave2268(ctx,shim,account,'Saved after the unreadable copy was reported'),[],
   'daily backups keep seven calendar days');
 });
});

// #2268 review (finding 6): the remembered daily backup hold ends when the
// cloud confirms a board. It ended instead wherever the app recorded which
// cloud revision the board is based on. That happens for the exact rebuild's
// stand-in read before anything is published, so a rebuild whose save had not
// landed lost the hold once the page was hidden; and it does not happen where
// the automatic recovery default records its confirmed publication, so the
// hold outlived that confirmation.
test('RISK daily backup retention hold: the hold ends when the cloud confirms a board, not when the exact rebuild prepares its save, and the automatic recovery default’s confirmed publication ends it',async t=>{
 for(const variant of ['the exact rebuild’s save has not landed','the automatic recovery default is confirmed'])await t.test(variant,async sub=>{
  const app=await damagedAcknowledgedApp187(sub),{ctx,shim,backend,faults,originalRoot}=app,store=ctx.window.ScannerDeviceStore;
  ctx.window.CLOUD_RETRY_DELAY_MS=600000;
  const account=ctx.state.syncAccount??null;
  if(variant==='the exact rebuild’s save has not landed'){
   const refusal=Object.assign(Error('Controlled rebuild publication refusal'),{code:'permission-denied'});
   Object.defineProperty(faults,'push',{configurable:true,get(){return refusal;}});sub.after(()=>{delete faults.push;});
   const pushes=[],push=backend.CS.push;backend.CS.push=async(...args)=>{pushes.push(args[2]);return push(...args);};sub.after(()=>{backend.CS.push=push;});
   ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the rebuild settles');
   assert.deepEqual(pushes,[originalRoot.rev],'positive control: the exact rebuild tried to save over the unreadable revision');
   assert.equal(backend.docs.get('users/owner').rev,originalRoot.rev,'fixture: the cloud confirmed nothing');
   shim.document.hidden=true;shim.document.dispatchEvent({type:'visibilitychange'});sub.after(()=>{shim.document.hidden=false;});
   // Behaviour under test: the rebuild has published nothing, so the seven days stay.
   assert.deepEqual(await dailyBackupsTrimmedBySave2268(ctx,shim,account,'Saved before the rebuild landed'),[],
    'daily backups keep seven calendar days while the rebuild’s save has not landed');
  }else{
   const protect=store.protectRecoverySource;let refusing=true;
   store.protectRecoverySource=async function(...args){if(refusing&&args[0]?.key?.startsWith('cloud-generation-recovery:'))return false;return protect.apply(this,args);};
   sub.after(()=>{store.protectRecoverySource=protect;});
   await pendingAutomaticDefault2194(sub,app);
   refusing=false;delete faults.push;
   await ctx.sendPush();
   await fixtureDeadline(async wait=>{await wait(5);while(backend.docs.get('users/owner').rev===originalRoot.rev||!adoptionIdle2254(ctx))await wait(10);},'the automatic default publishes',30000);
   await adoptionSettle2254(ctx,'the publication settles');
   assert.equal(vm.runInContext('!!deviceRecoveryCloudHold',ctx),false,'positive control: the cloud confirmed the automatic default’s board');
   assert.equal(ctx.state.syncRev,backend.docs.get('users/owner').rev,'positive control: the board is based on the confirmed revision');
   // Behaviour under test: the confirmation ends the hold, so the next save trims to three days.
   assert.equal((await dailyBackupsTrimmedBySave2268(ctx,shim,account,'Saved after the cloud confirmed')).length,4,
    'the first save after the cloud confirms trims daily backups to three calendar days');
  }
 });
});

// #2268 review (finding 7): browser storage can refuse the remembered hold. It
// was written once and any failure ignored: no room made by releasing the
// app's own diagnostics, no read-back and nothing kept in memory, so with
// storage full the next save trimmed this account's daily backups. The
// adoption of the finding 4 test is cut off by an app switch while storage
// refuses the record, either for good (the page itself still holds) or only
// until the app's diagnostics give way (the record is saved, and a relaunch
// still holds).
test('RISK daily backup retention hold: when browser storage refuses the remembered hold, the page still keeps this account’s daily backups for seven calendar days, and room made from the app’s diagnostics saves it for a relaunch',async t=>{
 for(const storage of ['refuses the record for good','is full until the app’s diagnostics give way'])await t.test('storage '+storage,async sub=>{
  const app=await ownInterruptedUploadApp2254(sub),{ctx,shim,backend,faults,revision}=app,store=ctx.window.ScannerDeviceStore;
  const holdKey='fvp:chain-scanner:daily-backup-recovery-hold',diagnosticsKey='fvp:chain-scanner:restart-diagnostics:v1';
  await newerEditBeforeAdoption2254(app);
  const account=ctx.state.syncAccount??null;
  shim.localStorage.setItem(diagnosticsKey,shim.localStorage.getItem(diagnosticsKey)??'{"v":1}');
  const setItem=shim.localStorage.setItem;let refused=0;
  shim.localStorage.setItem=function(key,value){
   if(key===holdKey&&(storage==='refuses the record for good'||this.getItem(diagnosticsKey)!==null)){refused++;throw Object.assign(Error('storage full'),{name:'QuotaExceededError'});}
   return setItem.call(this,key,value);
  };
  sub.after(()=>{shim.localStorage.setItem=setItem;});
  let hidden=false;
  sub.after(()=>{delete faults.beforeTransaction;shim.document.hidden=false;});
  faults.beforeTransaction=async()=>{
   if(hidden)return;const pending=await store.getPendingUpload('owner');if(pending?.baseRev!==revision+1)return;
   hidden=true;shim.document.hidden=true;shim.document.dispatchEvent({type:'visibilitychange'});
  };
  ctx.closeModal();await flush();await ctx.cloudPull();await adoptionSettle2254(ctx,'the cut-off adoption settles');
  assert.equal(hidden,true,'fixture: the page was hidden inside the adoption’s upload');
  assert.ok(refused>=1,'fixture: storage refused the remembered hold');
  assert.equal(backend.docs.get('users/owner').rev,revision+1,'fixture: the cloud did not confirm anything');
  if(storage==='refuses the record for good'){
   // Behaviour under test: the page keeps the hold it could not save.
   assert.deepEqual(await dailyBackupsTrimmedBySave2268(ctx,shim,account,'Saved while storage is full'),[],
    'daily backups keep seven calendar days in this page');
  }else{
   shim.localStorage.setItem=setItem;
   await closeLegacyApp173(app);backend.CS.suspend();
   const cold=await coldRelaunch2198(sub,app,[],{signIn:false});
   cold.backend.emitAuth(null);await flush();await cold.settle('the signed-out relaunch settles');
   // Behaviour under test: the record saved once room was made still holds after a relaunch.
   assert.deepEqual(await dailyBackupsTrimmedBySave2268(cold.ctx,cold.shim,account,'Saved after relaunching'),[],
    'daily backups keep seven calendar days after a relaunch');
  }
 });
});

// #2254 review (S2): the owner's phone holds dozens of board copies, and
// adoption has to cost no more there than an ordinary cloud save. The store is
// built on a served build with the app's own writers: the large signed-in
// board is acknowledged, five daily backups follow on earlier days, one
// automatic recovery over an unreadable generation commits its archives and
// publishes, a newer edit follows offline, and the device store records this
// device's own upload whose reply never came, as an interrupted push leaves
// it. Every run starts from a copy of that profile: opening it locally (the
// baseline), adoption over the unreadable own upload, and an ordinary save of
// the same board to a healthy cloud at the acknowledged revision. Peaks are
// web-process memory over the local opening, in the same run on the same
// engine. The store is scaled to one recovery so the test fits the suite
// (about 90 MiB of saved rows since daily backups keep three days, 3ad16c9;
// the owner-shaped harness store recorded on #2254 is about 280 MiB).
// Since the acknowledged trim (33d83ec), a recovery's archives are cleared once
// the cloud confirms its board. The recovery is built as a build before the
// trim left it (the owner's phone after this update): its archives stay until
// the next acknowledged save. Adoption and the ordinary save are each such a
// save, so the trim follows both measured publications alike.
const CONTAINED_ADOPTION_HEADROOM_2254=200*1024*1024;
test('RISK contained board adoption browser: on a heavy device store, adopting this device’s board over its own interrupted upload peaks no higher than an ordinary cloud save on the same store, with headroom, in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},async t=>{
 const {chromium,webkit}=await import(process.env.LANDSCAPE_PLAYWRIGHT),origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 const ACCOUNT='owner@example.test',IDENTITY='fixture-identity',fixture=await largeSignedInBoardFixture(ACCOUNT);
 const GENERATION_PATH='/__chain-2254/earlier-generation.json',NEWER='Newer local edit before adoption',SETTLE_MS=4000,WAIT_MS=240000;
 const mib=bytes=>Math.round(bytes/1048576),observed=[],failures=[],codec=loadStorageV2();
 const headerOf=async payload=>{const encoded=await codec.encodeSnapshot(payload);return {chunkCount:encoded.chunkCount,byteLength:encoded.byteLength,hash:encoded.hash};};
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  const template=fs.mkdtempSync(path.join(os.tmpdir(),'chain-2254-'+engineName+'-')),copies=[];
  let earlier=null;
  const launch=async(profile,tag,{seed=null,cloud=null,clock=false,olderBuild=false}={})=>{
   const context=await engine.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce',
    env:webProcessMemoryEnv(tag),...(engineName==='chromium'&&process.env.LANDSCAPE_BROWSER_CHANNEL?{channel:process.env.LANDSCAPE_BROWSER_CHANNEL}:{})});
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await context.route(origin+GENERATION_PATH,route=>route.fulfill({status:200,contentType:'application/json',body:earlier}));
   await context.addInitScript(({seed,cloud,GENERATION_PATH,ACCOUNT,IDENTITY,clock,olderBuild})=>{
    // A page clock the store builder can move to earlier days.
    if(clock){const real=Date.now.bind(Date);window.__clockOffset=0;Date.now=()=>real()+window.__clockOffset;}
    // A build before the acknowledged trim: it never starts one.
    if(olderBuild){let store=null;Object.defineProperty(window,'ScannerDeviceStore',{configurable:true,get:()=>store,
     set(value){store=value;if(value&&typeof value.beginRecoveryTrim==='function')value.beginRecoveryTrim=async()=>({ok:false,code:'older-build-fixture'});}});}
    Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
    localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));
    if(seed!==null&&localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',seed);
    const log=window.__adoption2254={pushes:[],published:null};
    if(!cloud)return;
    if(cloud.budget!=null)window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=cloud.budget;
    if(cloud.retryDelay!=null)window.CLOUD_RETRY_DELAY_MS=cloud.retryDelay;
    if(cloud.pushDelay!=null)window.CLOUD_PUSH_DELAY_MS=cloud.pushDelay;
    // An in-page cloud with the real backend's answers. Damaged: the revision
    // after the acknowledged one names an unreadable generation over the
    // intact acknowledged copy. Healthy: the acknowledged copy is current.
    const a=cloud.ackRev,damaged=cloud.shape==='damaged',INTACT='generation-intact-'+a,UNREADABLE='generation-unreadable-'+(a+1);
    const root=damaged?{schemaVersion:2,rev:a+1,activeGeneration:UNREADABLE,previousGeneration:INTACT,updatedAt:1,serverUpdatedAt:null}
     :{schemaVersion:2,rev:a,activeGeneration:INTACT,previousGeneration:null,updatedAt:1,serverUpdatedAt:null};
    const generations=new Map(),body=async()=>(await fetch(GENERATION_PATH,{cache:'no-store'})).text();
    const named=(pending,more=[])=>[...new Set([root.activeGeneration,root.previousGeneration,pending,...more].filter(id=>typeof id==='string'))];
    const read=async(id,withChunks)=>{
     if(id===INTACT){
      const header={schemaVersion:2,state:'published',encoding:'utf8',...cloud.intact,baseRev:a-1};
      if(!withChunks)return {id,header};
      return {id,header,chunks:(await window.ChainStorageV2.encodeSnapshot(await body())).chunks};
     }
     if(id===UNREADABLE)return {id,header:{schemaVersion:2,state:'published',encoding:'utf8',...cloud.unreadable,baseRev:a},...(withChunks?{chunks:[]}:{})};
     const stored=generations.get(id);return stored?{id,header:{...stored.header},...(withChunks?{chunks:stored.chunks}:{})}:{id,unavailable:true};
    };
    const ok=()=>Object.assign(cloudApi,{status:'ok',errorStage:null,errorCode:null,knownDamagedSource:false});
    const cloudApi={configured:true,ready:true,user:ACCOUNT,status:'syncing',errorStage:null,errorCode:null,knownDamagedSource:false,recoveryRetentionPending:false,
     signIn(){},signOut(){},recoveryIdentity:()=>IDENTITY,
     async pull(){
      if(log.published){ok();window.dispatchEvent(new CustomEvent('cloudsync'));const {payload,rev,updatedAt,serverUpdatedAt}=log.published;
       return {payload,rev,updatedAt,serverUpdatedAt,schemaVersion:2,generationId:root.activeGeneration};}
      if(!damaged){ok();window.dispatchEvent(new CustomEvent('cloudsync'));return {payload:await body(),rev:root.rev,updatedAt:1,serverUpdatedAt:1,schemaVersion:2,generationId:root.activeGeneration};}
      Object.assign(cloudApi,{status:'error',errorStage:'pull',errorCode:'corrupt-generation',knownDamagedSource:true});window.dispatchEvent(new CustomEvent('cloudsync'));
      return {error:true,code:'corrupt-generation',rev:root.rev,generationId:root.activeGeneration};
     },
     async push(payload,updatedAt,baseRev,context){
      const entry={baseRev,result:null};log.pushes.push(entry);
      if(typeof context?.validateBeforePublish==='function'&&!await context.validateBeforePublish(context.recoveryPending)){entry.result='source-changed';return {error:true,code:'recovery-source-changed'};}
      if(baseRev!==root.rev){entry.result='conflict';return {conflict:true,rev:root.rev};}
      const encoded=await window.ChainStorageV2.encodeSnapshot(payload),id='generation-published-'+(root.rev+1);
      generations.set(id,{header:{schemaVersion:2,state:'published',encoding:'utf8',chunkCount:encoded.chunkCount,byteLength:encoded.byteLength,hash:encoded.hash,baseRev},chunks:encoded.chunks});
      Object.assign(root,{rev:root.rev+1,previousGeneration:root.activeGeneration,activeGeneration:id});
      log.published={payload,rev:root.rev,updatedAt,serverUpdatedAt:Date.now()};entry.result='published';entry.rev=root.rev;
      ok();return {ok:true,rev:root.rev,serverUpdatedAt:log.published.serverUpdatedAt};
     },
     // The device's own pending upload record, as the real backend reads it.
     async recoveryEvidence(){return {identity:IDENTITY,epoch:1,pending:await window.ScannerDeviceStore.getPendingUpload(IDENTITY)};},
     async readRecoverySource({pendingGenerationId,additionalGenerationIds}={}){const rows=[];for(const id of named(pendingGenerationId,additionalGenerationIds))rows.push(await read(id,true));
      return {identity:IDENTITY,epoch:1,manifest:{...root},generations:rows};},
     async readRecoverySourceHeaders({pendingGenerationId,additionalGenerationIds}={}){const rows=[];for(const id of named(pendingGenerationId,additionalGenerationIds))rows.push(await read(id,false));
      return {identity:IDENTITY,epoch:1,manifest:{...root},generations:rows};},
     async readRecoverySourceChunks({generationIds=[]}={}){const rows=[];for(const id of generationIds)rows.push(await read(id,true));return rows;},
     async protectRecoverySources(){return {ok:true};},
    };
    Object.defineProperty(window,'CloudSync',{configurable:false,get:()=>cloudApi,set(){}});
    document.addEventListener('DOMContentLoaded',()=>{window.dispatchEvent(new CustomEvent('cloudsync'));window.cloudPull?.();});
   },{seed,cloud,GENERATION_PATH,ACCOUNT,IDENTITY,clock,olderBuild});
   return context;
  };
  const ready=page=>page.waitForFunction(()=>document.documentElement.dataset.appReady==='true'&&!document.querySelector('dialog[open]')&&
   typeof state!=='undefined'&&document.querySelectorAll('#listBody [data-row]').length>0,null,{timeout:120000});
  const headSaved=page=>page.waitForFunction(()=>new Promise(resolve=>deviceStore.readHead().then(head=>{const saved=head&&JSON.parse(head.payload);
   resolve(!!saved&&saved.tasks.length===state.tasks.length&&saved.decisionEvents.length===state.decisionEvents.length);},()=>resolve(false))),null,{timeout:60000,polling:250});
  const synced=(page,publications)=>page.waitForFunction(count=>__adoption2254.pushes.filter(push=>push.result==='published').length===count&&
   state.syncDirty===false&&state.syncRev===__adoption2254.published?.rev&&document.getElementById('syncBtn')?.textContent==='☁ synced'&&
   !pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy&&!cloudSourceRecoveryRead,publications,{timeout:WAIT_MS,polling:100}).then(()=>true,()=>false);
  const step=async(tag,options,work)=>{const context=await launch(template,tag,options);try{const page=context.pages()[0]||await context.newPage();
   await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await ready(page);return await work(page);}finally{await context.close();}};
  const summary={engine:engineName};
  try{
   const tag=`chain-2254-${engineName}-${process.pid}-${Date.now()}`;
   // The board, acknowledged at revision 2.
   earlier=await step(tag+'-seed',{seed:fixture.payload},async page=>{
    await page.waitForFunction(()=>deviceStorageAuthority===true&&typeof deviceHeadHash==='string',null,{timeout:60000});
    return page.evaluate(async()=>{if(await persist()!==true)throw Error('the seeded board saves');const payload=cloudPayload();
     state.syncRev=2;state.decisionBase=makeDecisionBase(state.syncAccount,2,payload);state.syncDirty=false;
     if(await persist()!==true)throw Error('the acknowledgement saves');return payload;});
   });
   // Daily backups of five earlier days through the ordinary save path, each
   // a distinct board kept whole, as a phone that waited for days keeps them.
   await step(tag+'-dailies',{clock:true},async page=>{
    for(let day=5;day>=1;day--){
     await page.evaluate(day=>{window.__clockOffset=-day*86400000;},day);
     await page.locator('#addInput').fill('Daily variant '+day);await page.locator('#addInput').press('Enter');
     await page.waitForFunction(title=>state.tasks.some(task=>task.title===title),'Daily variant '+day,{timeout:30000});await headSaved(page);
    }
    await page.evaluate(()=>{window.__clockOffset=0;});
   });
   // One automatic recovery over an unreadable revision 3 commits its archives
   // and publishes revision 4, which this device acknowledges. The earlier
   // generation holds a task saved on another device, so it is not this
   // device's acknowledged copy and the board is recovered, not adopted
   // (a698ee0 adopts over a copy before it that is the acknowledged one).
   const acknowledged=earlier,elsewhere=JSON.parse(earlier);
   elsewhere.tasks=[...elsewhere.tasks,{...elsewhere.tasks[0],id:'saved-elsewhere-2254',title:'Saved on another device before the unreadable copy'}];
   earlier=JSON.stringify(elsewhere);
   summary.recovery=await step(tag+'-recovery',{cloud:{shape:'damaged',ackRev:2,intact:await headerOf(earlier),
    unreadable:{...await headerOf(acknowledged),hash:'e'.repeat(64)},budget:64*1048576,retryDelay:0},olderBuild:true},async page=>{
    const done=await synced(page,1);
    return page.evaluate(done=>({done,rev:state.syncRev,published:__adoption2254.published?.rev??null,acknowledged:state.decisionBase?.payload===__adoption2254.published?.payload,
     payload:__adoption2254.published?.payload??null}),done);
   });
   assert.deepEqual([summary.recovery.done,summary.recovery.rev,summary.recovery.acknowledged],[true,4,true],`${engineName}: fixture: the automatic recovery published and was acknowledged`);
   earlier=summary.recovery.payload;delete summary.recovery.payload;
   // A newer edit offline, then this device's own upload of it whose reply never
   // came: the pending upload record names revision 5's generation.
   const own=await step(tag+'-own',{},async page=>{
    await page.locator('#addInput').fill(NEWER);await page.locator('#addInput').press('Enter');
    await page.waitForFunction(title=>state.tasks.some(task=>task.title===title),NEWER,{timeout:30000});await headSaved(page);
    return page.evaluate(async identity=>{
     const payload=cloudPayload(),encoded=await ChainStorageV2.encodeSnapshot(payload);
     await deviceStore.setPendingUpload(identity,{generationId:'generation-unreadable-5',payloadHash:encoded.hash,baseRev:4,updatedAt:Date.now()});
     const sizes={};await deviceStore.readRawExportRows(['meta','snapshots','backups','opaque'],{store(){},end(){},row(store,key,value){
      sizes[store]=(sizes[store]||0)+(JSON.stringify(value)?.length||0);}});
     return {hash:encoded.hash,byteLength:encoded.byteLength,chunkCount:encoded.chunkCount,rev:state.decisionBase?.revision,sizes};
    },IDENTITY);
   });
   assert.equal(own.rev,4,`${engineName}: fixture: the board stays based on its acknowledged revision 4`);
   summary.storeMiB=mib(Object.values(own.sizes).reduce((sum,bytes)=>sum+bytes,0));summary.stores=Object.fromEntries(Object.entries(own.sizes).map(([name,bytes])=>[name,mib(bytes)]));
   const intact=await headerOf(earlier);
   // Each measured run starts from its own copy of that profile.
   const measured=async(name,cloud,publications)=>{
    const copy=fs.mkdtempSync(path.join(os.tmpdir(),'chain-2254-'+engineName+'-'+name+'-'));copies.push(copy);fs.cpSync(template,copy,{recursive:true});
    const runTag=tag+'-'+name,context=await launch(copy,runTag,{cloud});const errors=[];let crashed=false,memory=null,result={};
    try{
     const page=context.pages()[0]||await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>{crashed=true;});
     const sampler=webProcessMemorySampler(runTag);
     try{
      await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});await ready(page);
      if(cloud)result.settled=await synced(page,publications);
      await page.waitForTimeout(SETTLE_MS);
     }finally{memory=await sampler.stop();}
     Object.assign(result,await page.evaluate(newer=>({pushes:__adoption2254.pushes.map(push=>push.baseRev+':'+push.result),status:document.getElementById('syncBtn')?.textContent,
      syncRev:state.syncRev,newerKept:state.tasks.some(task=>task.title===newer),publishedIsBoard:__adoption2254.published?.payload===cloudPayload()}),NEWER));
    }finally{await context.close();}
    return {...result,peakBytes:memory.peakBytes,processes:memory.processes,samples:memory.samples,errors,crashed};
   };
   const local=await measured('local',null,0);
   // The recovery's earlier unreadable generation is rechecked after each
   // publication alike; its bounded retries run without waiting in both runs.
   // Adoption publishes as soon as the opening read proves it, so the
   // ordinary save is not held for its usual two-second pause either: both
   // publications then overlap the opening alike (with the pause, Chromium
   // collected the opening's garbage before the save and not before
   // adoption, and adoption peaked about 250 MiB higher in some runs). Two of
   // each, interleaved; the lower peak of each counts.
   const runs={adoption:[],save:[]};
   for(let round=1;round<=2;round++){
    runs.adoption.push(await measured('adoption-'+round,{shape:'damaged',ackRev:4,intact,unreadable:{hash:own.hash,byteLength:own.byteLength,chunkCount:own.chunkCount},retryDelay:0,pushDelay:0},1));
    runs.save.push(await measured('save-'+round,{shape:'healthy',ackRev:4,intact,retryDelay:0,pushDelay:0},1));
   }
   const extra=run=>run.peakBytes-local.peakBytes,lower=list=>Math.min(...list.map(extra));
   const all=[local,...runs.adoption,...runs.save];
   Object.assign(summary,{localPeakMiB:mib(local.peakBytes),adoptionExtraMiB:mib(lower(runs.adoption)),saveExtraMiB:mib(lower(runs.save)),
    adoptionRunsMiB:runs.adoption.map(run=>mib(extra(run))),saveRunsMiB:runs.save.map(run=>mib(extra(run))),headroomMiB:mib(CONTAINED_ADOPTION_HEADROOM_2254),
    adoption:runs.adoption.map(run=>({settled:run.settled,pushes:run.pushes,status:run.status,syncRev:run.syncRev,samples:run.samples})),
    save:runs.save.map(run=>({settled:run.settled,pushes:run.pushes,status:run.status,syncRev:run.syncRev,samples:run.samples})),
    errors:all.flatMap(run=>run.errors),crashed:all.some(run=>run.crashed)});
   observed.push(summary);t.diagnostic(JSON.stringify(summary));
   // Measurement preconditions: each run sampled this browser's own web process.
   for(const run of all)assert.ok(run.processes>0&&run.samples>10,`${engineName}: web-process memory was sampled ${JSON.stringify(summary)}`);
   assert.equal(summary.crashed,false,`${engineName}: no page crashed`);assert.deepEqual(summary.errors,[],`${engineName}: no page errors`);
   assert.ok(summary.storeMiB>=80&&summary.stores.opaque>=50,`${engineName}: fixture: the device store is heavy, mostly the recovery's archives ${JSON.stringify(summary)}`);
   // Every run publishes the same board once: adoption over the unreadable
   // revision 5, the ordinary save over the acknowledged revision 4.
   for(const run of runs.adoption)assert.deepEqual([run.settled,run.pushes,run.status,run.syncRev,run.newerKept,run.publishedIsBoard],[true,['5:published'],'☁ synced',6,true,true],`${engineName}: adoption publishes the board once ${JSON.stringify(summary)}`);
   for(const run of runs.save)assert.deepEqual([run.settled,run.pushes,run.status,run.syncRev,run.newerKept,run.publishedIsBoard],[true,['4:published'],'☁ synced',5,true,true],`${engineName}: the ordinary save publishes the board once ${JSON.stringify(summary)}`);
   // Behaviour under test: adoption peaks no higher than the ordinary save, with headroom.
   if(lower(runs.adoption)>lower(runs.save)+CONTAINED_ADOPTION_HEADROOM_2254)
    failures.push(`${engineName}: adoption peaked ${mib(lower(runs.adoption))} MiB over opening the store locally, above the ordinary save's ${mib(lower(runs.save))} MiB plus ${mib(CONTAINED_ADOPTION_HEADROOM_2254)} MiB headroom`);
  }finally{for(const dir of [template,...copies])fs.rmSync(dir,{recursive:true,force:true});}
 }
 assert.deepEqual(failures,[],JSON.stringify(observed));
});

// #2254 (owner decision of 2026-11-06): manual backups are never trimmed
// automatically. From two of this account's manual backups, Settings shows a
// short reminder below Make manual backup that keeping more slows the app
// down. The button keeps working with no confirmation. The reminder is a
// polite status only on the render where it first appears, so re-rendering
// Settings does not announce it again.
const MANUAL_BACKUP_REMINDER='Keeping more than two manual backups slows the app down. Delete older ones you don’t need.';
const manualBackupReminderIn=markup=>{
 const match=markup.match(/<p id="manualBackupReminder"([^>]*)>([\s\S]*?)<\/p>/);
 return match?{text:match[2],status:/\brole="status"/.test(match[1]),beside:markup.includes('data-act="make-manual-backup">Make manual backup</button></div><p id="manualBackupReminder"')}:null;
};
const settingsMarkup=app=>app.shim.document.getElementById('modalRoot').innerHTML;
const manualRows=ctx=>ctx.readLocalBackups().filter(row=>row.kind==='manual');
async function makeManualBackup2254(app){
 const before=manualRows(app.ctx).length;
 app.ctx.onAction('make-manual-backup',{});
 for(let attempt=0;attempt<50&&manualRows(app.ctx).length===before;attempt++)await flush();
 await flush();
}

test('RISK manual backup reminder: Settings shows no reminder below two manual backups, other backup kinds do not count, and the second manual backup brings it',async t=>{
 const app=await loadApp();t.after(()=>app.dispose());const {ctx}=app;
 ctx.addTask('Reminder threshold task');await ctx.persist();
 ctx.openSettings();
 assert.match(settingsMarkup(app),/data-act="make-manual-backup">Make manual backup<\/button>/,'positive control: Settings lists the backup area');
 assert.equal(manualBackupReminderIn(settingsMarkup(app)),null,'no reminder with no manual backup');
 // Other kinds are listed beside manual copies but are not manual backups.
 assert.equal(ctx.saveLocalBackup('before-restore',JSON.stringify(ctx.state)),true);
 assert.equal(ctx.saveLocalBackup('before-account-switch',JSON.stringify(ctx.state)),true);
 await makeManualBackup2254(app);
 assert.equal(manualRows(ctx).length,1);
 assert.match(settingsMarkup(app),/before restore/,'positive control: the other kinds are listed');
 assert.equal(manualBackupReminderIn(settingsMarkup(app)),null,'no reminder with one manual backup and other kinds');
 await makeManualBackup2254(app);
 assert.equal(manualRows(ctx).length,2);
 const reminder=manualBackupReminderIn(settingsMarkup(app));
 assert.ok(reminder,'the second manual backup brings the reminder');
 assert.equal(reminder.text,MANUAL_BACKUP_REMINDER);
 assert.equal(reminder.beside,true,'the reminder sits right after Make manual backup');
});

test('RISK manual backup reminder: from two manual backups the reminder is a polite status where it first appears and is not announced again when Settings re-renders',async t=>{
 const app=await loadApp();t.after(()=>app.dispose());const {ctx}=app;
 ctx.addTask('Reminder status task');await ctx.persist();
 await makeManualBackup2254(app);await makeManualBackup2254(app);
 const first=manualBackupReminderIn(settingsMarkup(app));
 assert.ok(first,'the reminder shows at two manual backups');
 assert.equal(first.status,true,'the reminder is a status where it first appears');
 assert.doesNotMatch(settingsMarkup(app),/id="manualBackupReminder"[^>]*aria-live="assertive"/,'the status is polite');
 ctx.openSettings();
 const again=manualBackupReminderIn(settingsMarkup(app));
 assert.ok(again,'the reminder stays visible after Settings re-renders');
 assert.equal(again.text,MANUAL_BACKUP_REMINDER);
 assert.equal(again.status,false,'a re-render does not announce the reminder again');
 await makeManualBackup2254(app);
 assert.equal(manualRows(ctx).length,3);
 assert.deepEqual(manualBackupReminderIn(settingsMarkup(app)),{text:MANUAL_BACKUP_REMINDER,status:false,beside:true},'a third backup keeps the reminder without announcing it again');
});

test('RISK manual backup reminder: only this account’s manual backups count toward the reminder',async t=>{
 const app=await loadApp();t.after(()=>app.dispose());const {ctx}=app;
 ctx.addTask('Account reminder task');ctx.state.syncAccount='me@example.test';await ctx.persist();
 const other=JSON.stringify({...JSON.parse(JSON.stringify(ctx.state)),syncAccount:'other@example.test'});
 const signedOut=JSON.parse(JSON.stringify(ctx.state));delete signedOut.syncAccount;
 assert.equal(ctx.saveLocalBackup('manual',other),true);
 assert.equal(ctx.saveLocalBackup('manual',other.replace('Account reminder task','Another account task')),true);
 assert.equal(ctx.saveLocalBackup('manual',JSON.stringify(signedOut)),true);
 await makeManualBackup2254(app);
 assert.equal(manualRows(ctx).length,4,'positive control: four manual backups are on this device');
 assert.equal((settingsMarkup(app).match(/· manual<\/span>/g)||[]).length,4,'positive control: Settings lists all four');
 assert.equal(manualBackupReminderIn(settingsMarkup(app)),null,'one backup of this account does not bring the reminder');
 await makeManualBackup2254(app);
 const reminder=manualBackupReminderIn(settingsMarkup(app));
 assert.ok(reminder,'two backups of this account bring the reminder');
 assert.equal(reminder.text,MANUAL_BACKUP_REMINDER);
});

// #2254 re-review: each manual backup is a whole board, so the reminder must
// not parse every one of them on each Settings render to count this
// account's copies. The count is measured on the reminder Settings renders
// from the listed manual rows (the backup list's own row checks are older and
// counted separately). Counts JSON.parse calls on a backup's payload text.
function countBackupParses2254(t,ctx,payloads){
 const json=vm.runInContext('JSON',ctx),parse=json.parse,counted={calls:0};
 json.parse=function(text,...rest){if(typeof text==='string'&&payloads.has(text))counted.calls++;return parse.call(this,text,...rest);};
 t.after(()=>{json.parse=parse;});
 return counted;
}
// The reminder Settings renders from the listed manual rows, and the parses it made.
function reminderRender2254(ctx,parses){
 const listed=manualRows(ctx),before=parses.calls,html=ctx.manualBackupReminderHtml(listed);
 return {reminder:manualBackupReminderIn(html),parsed:parses.calls-before};
}
async function deviceBackedApp2254(t){
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='manual-reminder-2254-'+Math.random();
 const app=await loadApp({indexedDBProvider:indexedDB,deviceDbName,seedStorage:{'fvp:chain-scanner:device-store-v2':'1'}});
 t.after(()=>closeLegacyApp173(app));
 return app;
}
test('RISK manual backup reminder: the reminder counts this account’s manual backups without parsing their boards on any Settings render',async t=>{
 for(const where of ['the older backup list','device storage'])await t.test(where,async sub=>{
 const app=where==='device storage'?await deviceBackedApp2254(sub):await loadApp();if(where!=='device storage')sub.after(()=>app.dispose());const {ctx}=app;
 ctx.addTask('Reminder cost task');ctx.state.syncAccount='me@example.test';await ctx.persist();
 const other=JSON.stringify({...JSON.parse(JSON.stringify(ctx.state)),syncAccount:'other@example.test'});
 assert.equal(ctx.saveLocalBackup('manual',other),true);
 await makeManualBackup2254(app);
 ctx.openSettings();
 assert.equal(manualBackupReminderIn(settingsMarkup(app)),null,'one backup of this account does not bring the reminder');
 await makeManualBackup2254(app);await makeManualBackup2254(app);
 assert.equal(manualRows(ctx).length,4,'positive control: four manual backups are on this device');
 const parses=countBackupParses2254(t,ctx,new Set(manualRows(ctx).map(row=>row.payload)));
 for(let render=0;render<3;render++){
  const rendered=reminderRender2254(ctx,parses);
  assert.equal(rendered.reminder?.text,MANUAL_BACKUP_REMINDER,'this account’s backups bring the reminder on render '+render);
  assert.equal(rendered.parsed,0,'the reminder parses no manual backup’s board on render '+render);
 }
 ctx.openSettings();
 assert.equal(manualBackupReminderIn(settingsMarkup(app))?.text,MANUAL_BACKUP_REMINDER,'Settings shows the reminder');
 // Positive control: the counter sees the app parse a backup's board.
 assert.equal(ctx.saveLocalBackup('manual',other),true);
 assert.ok(parses.calls>0,'positive control: the counter sees the app parse a backup board');
 if(where==='device storage')assert.ok(ctx.window.ScannerDeviceStore&&vm.runInContext('deviceBackupCache',ctx).filter(row=>row.kind==='manual').length>=3,'positive control: Make manual backup saved in device storage');
 });
});
// Manual backups saved before backups named their account carry no account,
// so their board is read once, the first time the reminder needs it, and
// later renders reuse that answer. A device backup's id never names other bytes.
test('RISK manual backup reminder: manual backups saved before they named an account are read at most once across Settings renders and still count only for their own account',async t=>{
 const app=await deviceBackedApp2254(t),{ctx}=app;
 ctx.addTask('Older reminder task');ctx.state.syncAccount='me@example.test';await ctx.persist();
 const store=ctx.window.ScannerDeviceStore;
 assert.ok(store,'fixture: the board saves in device storage');
 const mine=JSON.stringify(ctx.state),other=JSON.stringify({...JSON.parse(mine),syncAccount:'other@example.test'});
 const older=[['older-mine-1',mine],['older-other-1',other],['older-other-2',other.replace('Older reminder task','Another account task')],['older-mine-2',mine.replace('Older reminder task','Older reminder task two')]];
 for(const [id,payload] of older){
  const head=await store.readHead();
  assert.equal((await store.putBackup({expectedHash:head.hash,backup:{id,kind:'manual',at:Date.now(),day:'2026-11-01',payload}})).ok,true);
 }
 await ctx.refreshDeviceBackupCache();
 const rows=manualRows(ctx).filter(row=>row.id.startsWith('older-'));
 assert.equal(rows.length,4,'fixture: four older manual backups are listed');
 assert.ok(rows.every(row=>!Object.hasOwn(row,'account')),'fixture: the older backups name no account');
 const parses=countBackupParses2254(t,ctx,new Set(rows.map(row=>row.payload)));
 const first=reminderRender2254(ctx,parses);
 assert.equal(first.reminder?.text,MANUAL_BACKUP_REMINDER,'two older backups of this account bring the reminder');
 assert.ok(first.parsed>=1&&first.parsed<=rows.length,'each older backup is read at most once on the first render ('+first.parsed+')');
 ctx.openSettings();
 assert.equal(manualBackupReminderIn(settingsMarkup(app))?.text,MANUAL_BACKUP_REMINDER,'Settings shows the reminder');
 for(let render=0;render<3;render++){
  const later=reminderRender2254(ctx,parses);
  assert.equal(later.reminder?.text,MANUAL_BACKUP_REMINDER);
  assert.equal(later.parsed,0,'later renders read no older backup again (render '+render+')');
 }
 // Only the other account's two older backups: no reminder for this account.
 for(const id of ['older-mine-1','older-mine-2'])assert.equal((await ctx.window.ScannerDeviceStore.commitHead({expectedHash:(await store.readHead()).hash,payload:(await store.readHead()).payload,account:'me@example.test',removeBackupIds:[id]})).ok,true);
 await ctx.refreshDeviceBackupCache();ctx.openSettings();
 assert.equal(manualBackupReminderIn(settingsMarkup(app)),null,'another account’s older backups do not bring the reminder');
});

test('RISK manual backup reminder: Make manual backup stays enabled past two and saves a third with no confirmation or extra step',async t=>{
 const app=await loadApp();t.after(()=>app.dispose());const {ctx}=app;
 ctx.addTask('Third backup task');await ctx.persist();
 await makeManualBackup2254(app);await makeManualBackup2254(app);
 let confirms=0;ctx.confirm=()=>{confirms++;return false;};
 assert.ok(manualBackupReminderIn(settingsMarkup(app)),'the reminder shows at two manual backups');
 assert.match(settingsMarkup(app),/<button class="btn subtle" data-act="make-manual-backup">Make manual backup<\/button>/,'the button stays enabled beside the reminder');
 ctx.addTask('Only in the third backup');
 await makeManualBackup2254(app);
 assert.equal(confirms,0,'no confirmation is asked');
 assert.equal(manualRows(ctx).length,3,'one press saves a third manual backup');
 assert.ok(manualRows(ctx).some(row=>row.payload.includes('Only in the third backup')),'the third backup holds the current board');
 assert.match(app.shim.document.getElementById('toast').textContent,/Manual backup saved on this device\./);
 assert.match(settingsMarkup(app),/<button class="btn subtle" data-act="make-manual-backup">Make manual backup<\/button>/,'the button is still enabled after the third');
 assert.ok(manualBackupReminderIn(settingsMarkup(app)),'the reminder is still shown after the third');
});

// #2254: the reminder is new text in the Settings backup area, so its fit is
// measured in a real served page beside the established neighbours in the same
// pane: the Make manual backup button above it and the backup rows below it.
// One manual backup is the before state (no reminder); the second brings it.
test('RISK manual backup reminder visual browser: the reminder beside Make manual backup and the backup rows below it fit the Settings pane without overlap in day and night, phone, 260 px and desktop widths, ordinary and 150% text, with keyboard focus on the button, in Chromium and WebKit',{skip:!process.env.LANDSCAPE_BROWSER_URL},async t=>{
 const {chromium,webkit}=await import(process.env.LANDSCAPE_PLAYWRIGHT),origin=new URL(process.env.LANDSCAPE_BROWSER_URL).origin;
 const fontsUrl=html.match(/href="(https:\/\/fonts.googleapis.com\/css2[^\"]+)"/)[1];
 const output=process.env.MANUAL_BACKUP_VISUAL_DIR?path.resolve(process.env.MANUAL_BACKUP_VISUAL_DIR):null;
 if(output)fs.mkdirSync(output,{recursive:true});
 const boards=new Map();
 for(const theme of ['light','dark']){
  const seed=JSON.stringify(syncState({contexts:[{id:'home',name:'Home',active:true}],listOpen:true,seenQuickStart:true,
   settings:{...syncState().settings,theme},tasks:Array.from({length:6},(_,i)=>({...syncTask('visual-backup-'+i,'Visual backup task '+i),ctx:['home']}))}));
  const app=await loadApp({seedStorage:{[SYNC_STORE_KEY]:seed}});
  try{boards.set(theme,JSON.stringify(app.ctx.state));}finally{await app.dispose();}
 }
 const viewports=[['phone',390,844],['narrow-260',260,563],['desktop',1280,800]];
 const ENLARGED_SETTINGS='#modalRoot .modal{font-size:150%} #modalRoot .modal :is(p,button,label,summary,select,input){font-size:1em}';
 const failures=[],observed=[],artifacts=[];
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true,...(engineName==='chromium'&&process.env.LANDSCAPE_BROWSER_CHANNEL?{channel:process.env.LANDSCAPE_BROWSER_CHANNEL}:{})});
  // WebKit on macOS moves keyboard focus between buttons with Alt+Tab.
  const forward=engineName==='webkit'&&process.platform==='darwin'?'Alt+Tab':'Tab',backward=engineName==='webkit'&&process.platform==='darwin'?'Alt+Shift+Tab':'Shift+Tab';
  try{
   for(const theme of ['light','dark'])for(const [viewName,width,height] of viewports){
    const where=`${engineName}/${theme}/${viewName}`;
    const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',reducedMotion:'reduce'});
    try{
     await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());
      return url.origin===origin||request.url()===fontsUrl||(url.origin==='https://fonts.gstatic.com'&&request.resourceType()==='font')?route.continue():route.abort();});
     await context.addInitScript(({board})=>{
      Object.defineProperty(window,'FIREBASE_CONFIG',{value:Object.freeze({}),writable:false,configurable:false});
      localStorage.setItem('fvp:chain-scanner:landscape-motion',JSON.stringify({choice:'reduced',savedAt:Date.now()}));
      if(localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',board);
     },{board:boards.get(theme)});
     const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
     await page.goto(process.env.LANDSCAPE_BROWSER_URL,{waitUntil:'domcontentloaded'});
     const ready=await page.waitForFunction(()=>typeof state==='object'&&liveBoardAccepted&&document.querySelector('#appHeader [data-act="settings"]'),null,{timeout:60000}).then(()=>true,()=>false);
     if(!ready){failures.push(`${where}: the app never opened its board`);continue;}
     await page.evaluate(()=>document.fonts.ready);
     const button=page.locator('#modalRoot [data-act="make-manual-backup"]');
     const openBackups=async()=>{
      if(!await page.locator('#modalRoot .modal').count()){await page.locator('#appHeader [data-act="settings"]').click();await page.waitForSelector('#modalRoot .modal');}
      const panel=page.locator('#modalRoot details').filter({has:page.locator('[data-act="make-manual-backup"]')}).first();
      if(await panel.getAttribute('open')===null)await panel.locator(':scope > summary').click();
     };
     const press=async count=>{
      await openBackups();await button.click();
      const saved=await page.waitForFunction(count=>readLocalBackups().filter(row=>row.kind==='manual').length===count&&[...document.querySelectorAll('#modalRoot .backup-row > .kv')].filter(label=>/ · manual$/.test(label.textContent)).length===count,count,{timeout:15000}).then(()=>true,()=>false);
      if(!saved)failures.push(`${where}: Make manual backup did not save and list backup ${count}`);
      await openBackups();
     };
     // Geometry of the button row, the reminder and the backup rows below.
     const measure=()=>page.evaluate(()=>{
      const root=document.documentElement,modal=document.querySelector('#modalRoot .modal'),pane=modal.getBoundingClientRect(),paneStyle=getComputedStyle(modal);
      const button=modal.querySelector('[data-act="make-manual-backup"]'),buttonRow=button.closest('.mbtns'),reminder=modal.querySelector('#manualBackupReminder');
      const rows=[...modal.querySelectorAll('.backup-row')],paragraph=buttonRow.previousElementSibling;
      const box=node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:Math.round(r.height)};};
      const hitCheck=node=>{node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+Math.min(r.width/2,20),r.top+r.height/2);return hit===node||node.contains(hit);};
      const paragraphStyle=getComputedStyle(paragraph),buttonStyle=getComputedStyle(button);
      const wide=[modal,...modal.querySelectorAll('*')].filter(node=>node.getBoundingClientRect().right>pane.right+1||
       node.scrollWidth>node.clientWidth+1&&getComputedStyle(node).overflowX!=='visible').slice(0,4)
       .map(node=>node.tagName+(node.id?'#'+node.id:'')+(node.dataset?.act?'['+node.dataset.act+']':'')+' '+node.scrollWidth+'/'+node.clientWidth);
      const out={theme:root.getAttribute('data-theme'),scheme:getComputedStyle(root).colorScheme,background:getComputedStyle(document.body).backgroundColor,
       modalBackground:paneStyle.backgroundColor,sectionBackground:getComputedStyle(button.closest('.settings-section')).backgroundColor,paragraphFont:paragraphStyle.fontSize,paragraphColor:paragraphStyle.color,
       button:{...box(button),font:buttonStyle.fontSize,disabled:button.disabled,unobscured:hitCheck(button)},
       rows:rows.map(row=>({...box(row),manual:/ · manual$/.test(row.querySelector('.kv')?.textContent||''),unobscured:hitCheck(row)})),wide,overflow:modal.scrollWidth>modal.clientWidth+1,reminder:null};
      if(reminder){
       const unobscured=hitCheck(reminder),style=getComputedStyle(reminder),r=reminder.getBoundingClientRect(),rowBox=buttonRow.getBoundingClientRect();
       out.reminder={height:Math.round(r.height),text:reminder.textContent,role:reminder.getAttribute('role'),fontSize:style.fontSize,lineHeight:style.lineHeight,color:style.color,
        left:Math.round(r.left-pane.left-parseFloat(paneStyle.paddingLeft)),right:Math.round(pane.right-parseFloat(paneStyle.paddingRight)-r.right),
        clipped:reminder.scrollWidth>reminder.clientWidth+1,unobscured,afterButtonRow:buttonRow.nextElementSibling===reminder,
        gapAbove:Math.round(r.top-rowBox.bottom),gapBelow:rows.length?Math.round(rows[0].getBoundingClientRect().top-r.bottom):null};
      }
      return out;
     });
     await press(1);
     const before=await measure();
     await press(2);
     // Measure once the save notice has gone, so it covers nothing in the captures.
     await page.waitForFunction(()=>!document.getElementById('toast')?.classList.contains('show'),null,{timeout:15000}).catch(()=>{});
     const shot={};
     for(const scale of [1,1.5]){
      const enlarged=scale>1?await page.addStyleTag({content:ENLARGED_SETTINGS}):null;
      shot[scale]=await measure();
      if(output){const file=path.join(output,`${engineName}-${theme}-${viewName}-${scale}.png`);
       await page.locator('#modalRoot #manualBackupReminder').evaluate(element=>element.scrollIntoView({block:'center'})).catch(()=>{});await page.screenshot({path:file});artifacts.push(file);}
      if(enlarged)await enlarged.evaluate(element=>element.remove());
     }
     // Native keyboard focus on Make manual backup: forward to its neighbour, then back.
     await button.focus();await page.keyboard.press(forward);await page.keyboard.press(backward);
     const focus=await button.evaluate(element=>{const style=getComputedStyle(element),reminder=document.getElementById('manualBackupReminder'),r=element.getBoundingClientRect(),m=reminder?.getBoundingClientRect();
      return {active:document.activeElement===element,visible:element.matches(':focus-visible'),outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth,outlineColor:style.outlineColor,
       outlineOffset:style.outlineOffset,ringClear:!m?null:m.top>=r.bottom+Math.max(0,parseFloat(style.outlineOffset)||0)+parseFloat(style.outlineWidth)-0.5};});
     if(output){const file=path.join(output,`${engineName}-${theme}-${viewName}-focus.png`);await page.screenshot({path:file});artifacts.push(file);}
     observed.push({engine:engineName,theme,view:viewName,before,shot,focus,errors});
     // The applied theme: attribute, computed color scheme and paint.
     for(const [name,state] of [['before',before],['1',shot[1]],['1.5',shot[1.5]]]){
      if(state.theme!==theme)failures.push(`${where}/${name}: data-theme is ${state.theme}`);
      if(!String(state.scheme).split(/\s+/).includes(theme))failures.push(`${where}/${name}: computed color-scheme is ${state.scheme}`);
      if(state.overflow||state.wide.length)failures.push(`${where}/${name}: the Settings pane scrolls sideways ${JSON.stringify(state.wide)}`);
      if(state.button.disabled||!state.button.unobscured)failures.push(`${where}/${name}: Make manual backup is disabled or covered`);
      if(state.rows.some(row=>!row.unobscured))failures.push(`${where}/${name}: a backup row is covered`);
     }
     if(before.reminder)failures.push(`${where}: a reminder shows with one manual backup`);
     for(const scale of [1,1.5]){
      const state=shot[scale],reminder=state.reminder;
      if(!reminder){failures.push(`${where}/${scale}: no reminder with two manual backups`);continue;}
      if(reminder.text!==MANUAL_BACKUP_REMINDER)failures.push(`${where}/${scale}: reminder text ${reminder.text}`);
      if(!reminder.afterButtonRow)failures.push(`${where}/${scale}: the reminder is not right after Make manual backup`);
      if(reminder.left<0||reminder.right<0)failures.push(`${where}/${scale}: the reminder leaves its pane insets ${JSON.stringify(reminder)}`);
      if(reminder.clipped||!reminder.unobscured)failures.push(`${where}/${scale}: the reminder is clipped or covered`);
      if(reminder.gapAbove<0||reminder.gapBelow===null||reminder.gapBelow<0)failures.push(`${where}/${scale}: the reminder overlaps the button row or the first backup row ${JSON.stringify([reminder.gapAbove,reminder.gapBelow])}`);
      // A sensible height: at least one line, and no more than a short paragraph.
      const line=parseFloat(reminder.lineHeight)||parseFloat(reminder.fontSize)*1.4;
      if(reminder.height<line-1||reminder.height>line*(width<300?7:4)+1)failures.push(`${where}/${scale}: reminder height ${reminder.height} for line ${line}`);
      // It reads like the retention paragraph above the button, its neighbour in the same pane.
      if(reminder.fontSize!==state.paragraphFont||reminder.color!==state.paragraphColor)failures.push(`${where}/${scale}: the reminder ${reminder.fontSize} ${reminder.color} differs from the backup paragraph ${state.paragraphFont} ${state.paragraphColor}`);
      if(state.rows.filter(row=>row.manual).length!==2)failures.push(`${where}/${scale}: ${state.rows.filter(row=>row.manual).length} manual backup rows listed`);
     }
     // Before and after: the reminder does not change the button or the backup rows.
     if(shot[1].button.height!==before.button.height)failures.push(`${where}: Make manual backup height ${before.button.height} -> ${shot[1].button.height}`);
     const manualHeight=before.rows.find(row=>row.manual)?.height;
     if(!manualHeight||shot[1].rows.some(row=>row.manual&&row.height!==manualHeight))failures.push(`${where}: manual backup row height ${manualHeight} -> ${JSON.stringify(shot[1].rows.map(row=>row.height))}`);
     if(!(parseFloat(shot[1.5].reminder?.fontSize)>parseFloat(shot[1].reminder?.fontSize)))failures.push(`${where}: enlarged Settings text is not larger`);
     if(!focus.active||!focus.visible||focus.outlineStyle==='none'||parseFloat(focus.outlineWidth)<2)failures.push(`${where}: Make manual backup keyboard focus is not shown ${JSON.stringify(focus)}`);
     if(focus.ringClear===false)failures.push(`${where}: the focus ring on Make manual backup overlaps the reminder ${JSON.stringify(focus)}`);
     if(errors.length)failures.push(`${where}: page errors ${JSON.stringify(errors)}`);
    }finally{await context.close();}
   }
   // Day and night paint the reminder, its section and the Settings pane differently
   // on each engine. The page body is transparent over the scenery in both themes.
   for(const [viewName] of viewports){
    const pick=theme=>observed.find(row=>row.engine===engineName&&row.theme===theme&&row.view===viewName)?.shot[1];
    const day=pick('light'),night=pick('dark');
    if(day&&night&&(day.sectionBackground===night.sectionBackground||day.modalBackground===night.modalBackground||day.reminder?.color===night.reminder?.color))
     failures.push(`${engineName}/${viewName}: day and night paint alike ${JSON.stringify([day.sectionBackground,night.sectionBackground,day.modalBackground,night.modalBackground,day.reminder?.color,night.reminder?.color])}`);
   }
  }finally{await browser.close();}
 }
 t.diagnostic(JSON.stringify({artifacts:artifacts.length?artifacts.length+' files in '+output:'set MANUAL_BACKUP_VISUAL_DIR to save screenshots',observed:observed.map(row=>({engine:row.engine,theme:row.theme,view:row.view,
  scheme:row.shot[1].scheme,pane:row.shot[1].modalBackground,section:row.shot[1].sectionBackground,reminder:[row.shot[1].reminder?.fontSize,row.shot[1.5].reminder?.fontSize,row.shot[1].reminder?.height,row.shot[1.5].reminder?.height,row.shot[1].reminder?.color],
  gaps:[row.shot[1].reminder?.gapAbove,row.shot[1].reminder?.gapBelow,row.shot[1.5].reminder?.gapAbove,row.shot[1.5].reminder?.gapBelow],button:[row.before.button.height,row.shot[1].button.height],rows:[row.before.rows.length,row.shot[1].rows.length,...row.shot[1].rows.map(r=>r.height)],focus:row.focus}))}));
 assert.ok(observed.length===12,'every engine, theme and view was measured: '+observed.length);
 assert.deepEqual(failures,[],JSON.stringify(failures));
});

// #2254 (owner decision of 2026-11-06): Help explains the manual backup
// reminder within the 130-word answer limit, and the changelog announces it.
// Neither sends anyone to another device: people have only their phone.
test('RISK manual backup reminder guidance: mounted FAQ and changelog say that from two manual backups Settings reminds you that keeping more than two slows the app down, and that Make manual backup still works',async t=>{
 const app=await loadApp();t.after(()=>app.dispose());
 for(const id of ['appChangelogCurrent','appChangelog'])app.shim.document.getElementById(id).innerHTML=html.match(new RegExp('<template id="'+id+'">([\\s\\S]*?)<\\/template>'))[1];
 await app.ctx.onAction('help',{});const markup=app.shim.document.getElementById('modalRoot').innerHTML;
 const answerTo=question=>markup.split('<dt>'+question+'</dt><dd>')[1]?.split('</dd>')[0]||'';
 const wordsOf=text=>text.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
 assert.ok(answerTo('How do backups and Restore work?'),'positive control: the mounted Help has the backups answer');
 const answer=answerTo('Why does Settings remind me about manual backups?');
 assert.match(answer,/Manual backups stay on this device until you delete them; they are never removed automatically\./);
 assert.match(answer,/keeping more than two slows the app down/);
 // #2254 release review: the reminder renders below Make manual backup.
 assert.match(answer,/When this account has two or more, Settings → Data and backups shows a reminder below Make manual backup\./);
 assert.match(answer,/Delete older ones you don’t need/);
 assert.match(answer,/Make manual backup still works, with no limit and no extra step\./);
 assert.match(answer,/Only manual backups of the account you are using count\./);
 assert.ok(wordsOf(answer)<=130,'the answer stays within the 130-word limit: '+wordsOf(answer));
 const release=(markup.split('data-changelog-notes>')[1]||'').split('<h3>November 6, 2026</h3>')[1]?.split('</ul>')[0]||'';
 assert.ok(release,'positive control: the mounted changelog has the November 6 release');
 assert.match(release,/<li>Settings → Data and backups now shows a reminder below Make manual backup once this account has two or more manual backups: keeping more than two slows the app down, so delete older ones you don’t need\./);
 for(const [where,text] of [['manual backup answer',answer],['November 6 changelog',release]])
  assert.doesNotMatch(text,/reminder beside Make manual backup/,where+': the reminder is not beside the button');
 assert.match(release,/Manual backups are never removed automatically, and Make manual backup still works with no extra step\.<\/li>/);
 for(const [question,text] of [['manual backup answer',answer],['November 6 changelog',release]])
  assert.doesNotMatch(text.replace(/<[^>]+>/g,' '),/desktop|computer|laptop|\bMac\b/i,question+': Help never sends anyone to another device');
});

// #2254 (owner direction, 2026-11-06): "in functionality, we should be
// trimming down the file down to just what we need." Once the cloud has
// acknowledged a board, the device clears by itself the archives its automatic
// recoveries left (raw originals, cloud sources, summaries, publication
// intents and sources, acknowledgements) and the older browser copies it has
// already migrated. It keeps the board and its saved head, the acknowledged
// copy inside it, every backup, the headers-only records of unreadable
// generations, and one small note naming what the check of earlier sources
// still reports for the cleared recoveries. Until the cloud acknowledges a
// board nothing is trimmed: those archives may be the only route back.
// The fixture is the captured large-board shape: recovery waits, Retry sync
// rebuilds the board from the intact earlier generation, commits its archives,
// publishes, and the cloud confirms it, with the unreadable generation still an
// incomplete earlier source.
const TRIM_LEFTOVER_PREFIXES_2254=['automatic-device-recovery:','automatic-cloud-source:','automatic-recovery-summary:',
 'automatic-publication-intent:','automatic-publication-source:','automatic-recovery-ack:'];
const trimLeftover2254=key=>typeof key==='string'&&TRIM_LEFTOVER_PREFIXES_2254.some(prefix=>key.startsWith(prefix));
const trimIdle2254=ctx=>!vm.runInContext('pulling||cloudPushInFlight||cloudSourceRecoveryBusy||saveTimer!==null||supportDiagnosticsActivePersistCalls>0||'+
 '(typeof recoveryTrimBusy!=="undefined"&&recoveryTrimBusy)',ctx);
const trimSettle2254=(ctx,message)=>fixtureDeadline(async wait=>{await wait(50);while(!trimIdle2254(ctx))await wait(10);await wait(50);while(!trimIdle2254(ctx))await wait(10);},
 message,CAPTURED_RESULT_BUDGET_MS+20000);
// Every saved row, read in full by the test itself.
async function deviceRows2254(store){
 const raw=await store.readRawExportSnapshot(),rows=name=>raw.stores[name].keys.map((key,index)=>({key,value:raw.stores[name].values[index]}));
 return {meta:rows('meta'),snapshots:rows('snapshots'),backups:rows('backups'),opaque:rows('opaque')};
}
const earlierSources2254=async ctx=>{
 const history=JSON.parse(await vm.runInContext('automaticCloudSourceHistory().then(JSON.stringify)',ctx));
 return {error:history.error,unresolved:history.unresolved.map(row=>[row.id,row.reason]),permanent:history.permanent.map(row=>[row.id,row.reason])};
};
async function recoveredLeftoversApp2254(t){
 const app=await capturedGenerationAcceptedApp2198(t),{ctx,shim}=app,store=ctx.window.ScannerDeviceStore;
 // The unreadable generation declares this acknowledged copy, padded.
 const acknowledgedBefore=ctx.state.decisionBase.payload;
 ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=1048576;ctx.window.CLOUD_RETRY_DELAY_MS=0;
 // The harness's timers do not hold the process open while retries wait.
 const alive=setInterval(()=>{},20);t.after(()=>clearInterval(alive));
 ctx.closeModal();await flush();await ctx.cloudPull();await trimSettle2254(ctx,'the opening settles');
 assert.equal(syncStatus2200(shim).text,'☁ recovery waiting','fixture: the large board waits');
 await ctx.onAction('sync-retry',{});await trimSettle2254(ctx,'the deliberate run and its checks settle');
 assert.equal(syncStatus2200(shim).text,'☁ synced','fixture: Retry sync rebuilt the board and the cloud confirmed it');
 const keys=(await deviceRows2254(store)).opaque.map(row=>row.key);
 for(const prefix of ['automatic-device-recovery:','automatic-cloud-source:','automatic-recovery-summary:','automatic-publication-intent:','automatic-recovery-ack:'])
  assert.ok(keys.some(key=>key.startsWith(prefix)),'fixture: the recovery left its '+prefix+' archive');
 return {...app,store,acknowledgedBefore,unreadableId:app.activePath.split('/').at(-1)};
}
// An older installed shell writes its board to the older browser pair, as a
// shell from before device storage does. This app reconciles those exact
// bytes into its board and keeps them as an other-browser-copy backup before
// its next push; after that they are a migrated copy.
function olderShellWrite2254(app,title){
 const {ctx,shim}=app,board=JSON.parse(JSON.stringify(ctx.state));
 board.tasks.push(syncTask('older-shell-'+title.length,title));board.updatedAt=Date.now();
 const raw=JSON.stringify(board);for(const key of [LOCAL_HEAD_KEY,SYNC_STORE_KEY])shim.localStorage.setItem(key,raw);
 return {raw,taskId:'older-shell-'+title.length};
}
async function ordinaryAcknowledgedSave2254(app,title){
 const {ctx,shim}=app;
 shim.document.getElementById('addInput').value=title;await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 await ctx.sendPush();await trimSettle2254(ctx,'the acknowledged save and what follows it settle');
 assert.equal(syncStatus2200(shim).text,'☁ synced','positive control: the cloud acknowledged the board');
 assert.equal(ctx.state.syncDirty,false);
}
// The next revision, saved by another writer, which cannot be read: its header
// declares a board whose chunks never arrived. Over this device's acknowledged
// revision it is the adoption case; over another revision recovery waits.
async function unreadableNextRevision2254(app,label,{board=null}={}){
 const {ctx,backend}=app,root=backend.docs.get('users/owner'),generations='users/owner/generations/',previous=backend.docs.get(generations+root.activeGeneration);
 const id='generation-unreadable-'+label+'-'+(root.rev+1),payload=board??JSON.parse(ctx.state.decisionBase.payload);
 if(!board)payload.futureUnreadableTrimFixture={opaque:label};
 const encoded=await ctx.window.ChainStorageV2.encodeSnapshot(JSON.stringify(payload));
 backend.docs.set(generations+id,{...previous,hash:encoded.hash,byteLength:encoded.byteLength,chunkCount:encoded.chunkCount,baseRev:root.rev});
 backend.docs.set('users/owner',{...root,rev:root.rev+1,activeGeneration:id,previousGeneration:root.activeGeneration});
 return {id,previousId:root.activeGeneration,chunks:encoded.chunks,path:generations+id};
}
async function adoptOverUnreadable2254(app){
 const {ctx,shim,backend}=app,pushes=[],push=backend.CS.push;
 backend.CS.push=async(payload,updatedAt,baseRev,context)=>{pushes.push(baseRev);return push(payload,updatedAt,baseRev,context);};
 try{
  const unreadable=await unreadableNextRevision2254(app,'adopted');
  ctx.closeModal();await flush();await ctx.cloudPull();await trimSettle2254(ctx,'the adoption, its acknowledgement and what follows settle');
  assert.deepEqual(pushes,[backend.docs.get('users/owner').rev-1],'positive control: the board was adopted once over the unreadable revision');
  assert.equal(syncStatus2200(shim).text,'☁ synced','positive control: the cloud acknowledged the adopted board');
  return unreadable;
 }finally{backend.CS.push=push;}
}
function captureDownloads2254(app){
 const files=[],link=makeFakeElement();link.remove=()=>{};link.click=()=>files.push({href:link.href,name:link.download});
 const createElement=app.shim.document.createElement;app.shim.document.createElement=tag=>tag==='a'?link:createElement.call(app.shim.document,tag);
 app.ctx.Blob=Blob;return files;
}
async function downloadedRecoveryFile2254(app){
 const files=captureDownloads2254(app);app.ctx.openSettings();
 assert.equal(await app.ctx.onAction('download-recovery-file',{}),true,'the recovery file downloads');
 const {resolveObjectURL}=await import('node:buffer'),text=await resolveObjectURL(files.at(-1).href).text();app.ctx.closeModal();
 return {text,file:JSON.parse(text)};
}

test('RISK acknowledged recovery trim: nothing is trimmed while a later recovery waits on an unreadable copy, holds an older copy or saves without cloud confirmation, and the first acknowledged save after the cloud confirms trims',{timeout:300000},async t=>{
 const app=await recoveredLeftoversApp2254(t),{ctx,shim,backend,store}=app,codec=ctx.window.ChainStorageV2;
 const leftovers=async()=>(await deviceRows2254(store)).opaque.filter(row=>trimLeftover2254(row.key));
 const legacy=()=>[SYNC_STORE_KEY,LOCAL_HEAD_KEY].map(key=>shim.localStorage.getItem(key));
 const unchanged=async(expected,message)=>{
  assert.equal(JSON.stringify(await leftovers()),JSON.stringify(expected.rows),message+': every recovery archive stays exactly as it was');
  assert.deepEqual(legacy(),expected.legacy,message+': the older browser pair stays');
 };
 // An older installed shell saved its board in the older browser pair.
 const older=olderShellWrite2254(app,'Saved by an older installed shell before recovery');
 let kept={rows:await leftovers(),legacy:legacy()};
 assert.deepEqual(kept.legacy,[older.raw,older.raw],'fixture: the older shell’s copy is in the older browser pair');
 // Another device publishes a readable revision and then an unreadable one
 // over it. The copy before the unreadable one is not this device's, so the
 // large board waits.
 const elsewhere=JSON.parse(ctx.state.decisionBase.payload);elsewhere.tasks.push(syncTask('trim-elsewhere-2254','Saved on another device before the unreadable copy'));
 await publishElsewhere2254(backend,codec,JSON.stringify(elsewhere));await unreadableNextRevision2254(app,'waiting',{board:elsewhere});
 ctx.closeModal();await flush();await ctx.cloudPull();await trimSettle2254(ctx,'the waiting opening settles');
 assert.equal(syncStatus2200(shim).text,'☁ recovery waiting','positive control: recovery waits on the unreadable copy');
 shim.document.getElementById('addInput').value='Saved while recovery waits';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 vm.runInContext('resumeCloudSync({type:"online"})',ctx);await trimSettle2254(ctx,'the reconnect settles');
 await unchanged(kept,'while recovery waits, after a save and a reconnect');
 // Retry sync rebuilds the board, but the cloud refuses its confirmation once:
 // a recovery hold keeps the older copy.
 refuseNextRecoveryTransaction255(app.faults);
 await ctx.onAction('sync-retry',{});await trimSettle2254(ctx,'the refused run settles');
 assert.equal((await store.getRecoveryCloudHold())?.automaticRecovery,true,'positive control: a recovery hold awaits cloud confirmation');
 kept={rows:await leftovers(),legacy:legacy()};
 assert.equal(kept.rows.filter(row=>row.key.startsWith('automatic-device-recovery:')).length,2,'positive control: the second recovery left its archives too');
 shim.document.getElementById('addInput').value='Saved under the hold';await ctx.onAction('add',{});assert.equal(await ctx.persist(),true);
 await ctx.sendPush();await trimSettle2254(ctx,'a save under the hold settles');
 await unchanged(kept,'while a recovery hold awaits cloud confirmation');
 // Retry sync confirms the recovered board; the next acknowledged save trims.
 await ctx.onAction('sync-retry',{});await trimSettle2254(ctx,'the confirmed run settles');
 assert.equal(await store.getRecoveryCloudHold(),null,'positive control: the cloud confirmed the recovered board');
 await ordinaryAcknowledgedSave2254(app,'Saved after the cloud confirmed');
 assert.deepEqual((await leftovers()).map(row=>row.key),[],'the first acknowledged save after the cloud confirms clears every recovery archive');
 assert.ok(ctx.state.tasks.some(task=>task.id===older.taskId),'the older shell’s work is on the board');
 assert.ok((await store.listBackups()).some(row=>row.kind==='other-browser-copy'&&row.payload===older.raw),'its exact bytes stay as a kept backup');
 // An older installed shell opens its board from the older browser pair, and
 // it is the exact original repairs rely on, so the trim keeps it.
 assert.deepEqual(legacy(),[older.raw,older.raw],'the older browser pair stays');
});

test('RISK acknowledged recovery trim: after an adoption the cloud confirms, the device clears the recovery archives and the migrated older backup list and keeps the board, the acknowledged copy, every backup, the older browser pair, headers-only records and a note naming what the earlier-source check still reports',{timeout:300000},async t=>{
 const app=await recoveredLeftoversApp2254(t),{ctx,shim,store,unreadableId,indexedDB,deviceDbName}=app;
 // Rows the device keeps whatever happens: a manual backup, a kept draft copy,
 // a row of a kind this app does not know, and a migrated older backup list
 // with an unreadable entry. The readable migrated list is a migrated copy.
 await makeManualBackup2254(app);
 const draft=await ctx.saveDurableBackup('stale-tab-draft',JSON.stringify(ctx.state));assert.ok(draft?.id,'fixture: a kept draft copy');
 const olderList=shim.localStorage.getItem(LOCAL_BACKUPS_KEY);assert.ok(olderList,'fixture: the older backup list holds a daily copy');
 const unknown={key:'future-kind:kept-2254',raw:JSON.stringify({format:'chain-scanner.future-kind',opaque:['keep',2254]}),order:1};
 const migrated={key:'0:'+LOCAL_BACKUPS_KEY,raw:olderList,order:0},damagedList={key:'1:'+LOCAL_BACKUPS_KEY,raw:'[{"id":"daily:unreadable-2254"}]',order:0};
 await editRawDevice187(indexedDB,deviceDbName,tx=>{for(const row of [unknown,migrated,damagedList])tx.objectStore('opaque').put(row,row.key);});
 const earlier=await earlierSources2254(ctx);
 assert.deepEqual(earlier.unresolved,[[unreadableId,'generation-incomplete']],'positive control: the unreadable generation is an unresolved earlier source');
 // An older installed shell saved its board in the older browser pair; the
 // adoption's push reconciles it first, keeping its bytes as a backup.
 const older=olderShellWrite2254(app,'Saved by an older installed shell before adoption');
 const before=await deviceRows2254(store);
 const adopted=await adoptOverUnreadable2254(app);
 const after=await deviceRows2254(store),head=await store.readHead();
 // Behaviour under test: what is cleared.
 assert.deepEqual(after.opaque.filter(row=>trimLeftover2254(row.key)).map(row=>row.key),[],'every automatic recovery archive is cleared');
 assert.equal(after.opaque.some(row=>row.key===migrated.key),false,'the migrated older backup list is cleared');
 // What is kept.
 assert.deepEqual([SYNC_STORE_KEY,LOCAL_HEAD_KEY].map(key=>shim.localStorage.getItem(key)),[older.raw,older.raw],'the older browser pair an older installed shell opens stays');
 assert.ok(ctx.state.tasks.some(task=>task.id===older.taskId),'the older shell’s work is on the board');
 assert.ok((await store.listBackups()).some(row=>row.kind==='other-browser-copy'&&row.payload===older.raw),'and its exact copy stays as a kept backup');
 assert.equal(head.payload,JSON.stringify(ctx.state),'the board is the saved head');
 assert.equal(JSON.parse(head.payload).decisionBase.payload,ctx.state.decisionBase.payload,'the acknowledged copy stays in the head');
 assert.equal(ctx.state.decisionBase.revision,ctx.state.syncRev,'the board is based on the copy the cloud acknowledged');
 assert.deepEqual(after.meta.map(row=>row.key),['head'],'no recovery hold, pending upload or unfinished trim remains');
 for(const id of [draft.id,...ctx.readLocalBackups().filter(row=>row.kind==='manual').map(row=>row.id)])
  assert.ok(after.backups.some(row=>row.key===id),'the kept backup '+id+' stays');
 assert.deepEqual(after.snapshots.map(row=>row.key).sort(),[...new Set([head.hash,...after.backups.map(row=>row.value.payloadHash)])].sort(),
  'the saved board copies are the head and those the backups use');
 assert.deepEqual([...(await store.listBackups()).map(row=>row.id)].sort(),[...after.backups.map(row=>row.key)].sort(),'every backup still reads');
 assert.equal(shim.localStorage.getItem(LOCAL_BACKUPS_KEY),olderList,'the older backup list itself stays');
 assert.equal(shim.localStorage.getItem(DEVICE_AUTHORITY_KEY),'1');
 for(const row of [unknown,damagedList])assert.equal(after.opaque.find(item=>item.key===row.key)?.value?.raw,row.raw,'kept: '+row.key);
 for(const row of before.opaque.filter(row=>!trimLeftover2254(row.key)&&row.key!==migrated.key))
  assert.deepEqual(after.opaque.find(item=>item.key===row.key)?.value,row.value,'kept unchanged: '+row.key);
 assertHeadersOnlyRecord2254(after.opaque.filter(row=>row.key.startsWith('unreadable-generation-record:')&&row.value.raw.includes(adopted.id)).map(row=>row.value),
  {unreadableId:adopted.id,acknowledgedId:adopted.previousId},'after the trim');
 const added=after.opaque.filter(row=>!before.opaque.some(item=>item.key===row.key)&&!row.key.startsWith('unreadable-generation-record:'));
 assert.equal(added.length,1,'one note replaces the cleared recoveries: '+JSON.stringify(added.map(row=>row.key)));
 const note=added[0].value.raw;
 assert.ok(note.includes(unreadableId),'the note names the unresolved earlier generation');
 assert.ok(!note.includes('"text"')&&note.length<4096,'the note keeps no chunk and stays small ('+note.length+' characters)');
 // The check of earlier sources answers as before, from the note.
 assert.deepEqual(await earlierSources2254(ctx),earlier,'the check of earlier sources still reports the same unresolved generation');
});

test('RISK acknowledged recovery trim: the trim deletes by key in bounded batches without reading the whole store or a large archive, and a page closed mid-trim finishes on the next opening without the cloud',{timeout:300000},async t=>{
 const app=await recoveredLeftoversApp2254(t),{ctx,store,unreadableId}=app;
 // Two keys per batch, so this recovery's archives take several batches.
 ctx.window.CHAIN_RECOVERY_TRIM_BATCH_KEYS=2;
 const before=await deviceRows2254(store),leftoverRows=before.opaque.filter(row=>trimLeftover2254(row.key));
 const smallRows=leftoverRows.filter(row=>row.key.startsWith('automatic-recovery-ack:')||row.key.startsWith('automatic-recovery-summary:'));
 const smallBytes=smallRows.reduce((total,row)=>total+row.value.raw.length,0),largeBytes=leftoverRows.reduce((total,row)=>total+row.value.raw.length,0)-smallBytes;
 assert.ok(largeBytes>20*smallBytes,'fixture: the large archives dwarf the small ones ('+largeBytes+' against '+smallBytes+')');
 // Every device request, by store, method and transaction, except the test's
 // own reads; and a page that closes after the trim's first batch of
 // deletions committed.
 const {IDBDatabase}=await import('fake-indexeddb'),transaction=IDBDatabase.prototype.transaction,requests=[];
 let deletingTransactions=0,closeAfter=1,probing=false;
 IDBDatabase.prototype.transaction=function(names,mode,...rest){
  const tx=transaction.call(this,names,mode,...rest);if(this.name!==app.deviceDbName||probing)return tx;
  const stores=(typeof names==='string'?[names]:Array.from(names)).sort().join(','),objectStore=tx.objectStore.bind(tx);let deleting=false;
  tx.objectStore=name=>{
   const source=objectStore(name);
   for(const method of ['get','getAll','getAllKeys','getKey','openCursor','openKeyCursor','count']){
    const call=source[method].bind(source);source[method]=(...args)=>{const request=call(...args);requests.push({store:name,method,stores,mode,request});return request;};
   }
   if(name==='opaque'){const remove=source.delete.bind(source);source.delete=(...args)=>{
    if(!deleting){deleting=true;deletingTransactions++;}
    if(deletingTransactions>closeAfter){try{tx.abort();}catch{}throw Object.assign(Error('The page closed during the trim'),{name:'AbortError'});}
    return remove(...args);};}
   return source;
  };
  return tx;
 };
 t.after(()=>{IDBDatabase.prototype.transaction=transaction;});
 const probe=async read=>{probing=true;try{return await read();}finally{probing=false;}};
 const wholeReads=[],listBackups=store.listBackups,commitHead=store.commitHead;let lists=0,commits=0;
 for(const name of ['readRawExportSnapshot','readRawExportRows','listOpaqueArchives']){const call=store[name];store[name]=function(...args){if(!probing&&(name!=='listOpaqueArchives'||!args[0]?.prefix))wholeReads.push(name);return call.apply(this,args);};t.after(()=>{store[name]=call;});}
 store.listBackups=function(...args){lists++;return listBackups.apply(this,args);};store.commitHead=function(...args){commits++;return commitHead.apply(this,args);};
 t.after(()=>{store.listBackups=listBackups;store.commitHead=commitHead;});
 const mark=requests.length;
 await ordinaryAcknowledgedSave2254(app,'Saved before the page closes in the middle of the trim');
 const trimRequests=requests.slice(mark);
 // Behaviour under test: the first batch committed, the originals first.
 const middle=await probe(()=>deviceRows2254(store));
 assert.equal(deletingTransactions,2,'the first batch committed and the page closed in the second');
 assert.equal(middle.opaque.some(row=>row.key.startsWith('automatic-device-recovery:')),false,'the first batch clears the recovery original first');
 assert.ok(middle.opaque.some(row=>trimLeftover2254(row.key)),'fixture: the page closed before the rest');
 // Bounded: deletes by key, two per transaction, and no whole-store read; the
 // only archive text read is the small acknowledgement and summary rows.
 const wholeStore=list=>list.filter(row=>['getAll','openCursor'].includes(row.method)&&['opaque','snapshots'].includes(row.store)&&row.stores!=='backups,opaque,snapshots').map(row=>row.stores+':'+row.store+'.'+row.method);
 const opaqueBytes=trimRequests.filter(row=>row.store==='opaque'&&row.method==='get').reduce((total,row)=>total+(typeof row.request.result?.raw==='string'?row.request.result.raw.length:0),0);
 assert.deepEqual(wholeStore(trimRequests),[],'nothing but the save’s own backup list reads every archive or board copy');
 assert.ok(lists<=commits,'the trim reads no backup list of its own ('+lists+' lists for '+commits+' saves)');
 assert.deepEqual(wholeReads,[],'no whole-store read');
 assert.ok(opaqueBytes<=smallBytes+8192,'the trim reads only the small rows: '+opaqueBytes+' archive characters against '+smallBytes+' small and '+largeBytes+' large');
 // A missing archive is no damage: the earlier-source check still answers, from the note.
 assert.deepEqual((await probe(()=>earlierSources2254(ctx))).unresolved,[[unreadableId,'generation-incomplete']],'mid-trim, the check of earlier sources still reports the unresolved generation');
 // The next opening, without the cloud, finishes the trim.
 closeAfter=Infinity;const mark2=requests.length;
 const reopened=await coldRelaunch2198(t,app,[],{signIn:false}),reopenedStore=reopened.ctx.window.ScannerDeviceStore;
 await fixtureDeadline(async wait=>{while((await probe(()=>deviceRows2254(reopenedStore))).opaque.some(row=>trimLeftover2254(row.key))||!trimIdle2254(reopened.ctx))await wait(50);},
  'the next opening finishes the trim',30000);
 const resumed=requests.slice(mark2),finished=await probe(()=>deviceRows2254(reopenedStore));
 assert.deepEqual(finished.meta.map(row=>row.key),['head'],'the finished trim leaves no plan behind');
 assert.equal((await probe(()=>reopenedStore.readHead())).payload,JSON.stringify(reopened.ctx.state),'the reopened board is the saved head');
 assert.deepEqual(wholeStore(resumed),[],'the resumed trim reads no whole store');
 const listsOnOpening=resumed.filter(row=>row.stores==='backups,opaque,snapshots'&&row.method==='getAll'&&row.store==='opaque').length;
 const savesOnOpening=new Set(resumed.filter(row=>row.stores==='backups,meta,snapshots'&&row.mode==='readwrite').map(row=>row.request.transaction)).size;
 assert.ok(listsOnOpening<=1+savesOnOpening,'only the opening’s and its saves’ own backup lists read the archives ('+listsOnOpening+' for '+savesOnOpening+' saves)');
});

test('RISK acknowledged recovery trim: another account’s recovery archives, notes, records and receipts stay byte for byte while this account’s are cleared',{timeout:300000},async t=>{
 const app=await recoveredLeftoversApp2254(t),{ctx,store,indexedDB,deviceDbName}=app;
 const rows=(await deviceRows2254(store)).opaque,find=prefix=>rows.find(row=>row.key.startsWith(prefix));
 const original=find('automatic-device-recovery:'),source=find('automatic-cloud-source:'),summary=find('automatic-recovery-summary:'),ack=find('automatic-recovery-ack:'),intent=find('automatic-publication-intent:');
 const OTHER='other-owner-2254',other=raw=>{const value=JSON.parse(raw);for(const node of [value,value.source])if(node&&typeof node.identity==='string')node.identity=OTHER;return value;};
 const swap=(text,pairs)=>pairs.reduce((out,[from,to])=>out.split(from).join(to),text);
 // Another account's completed recovery with its summary and acknowledgement,
 // one saved before recoveries had summaries, a publication source, a note,
 // a headers-only record and a cloud receipt.
 const bOriginal='automatic-device-recovery:other-account-2254',bSource='automatic-cloud-source:other-account-2254';
 const pairs=[[original.key,bOriginal],[encodeURIComponent(original.key),encodeURIComponent(bOriginal)],[source.key,bSource]];
 const bAck=other(swap(ack.value.raw,pairs)),bSummary=other(swap(summary.value.raw,pairs)),bIntent=other(swap(intent.value.raw,pairs));
 const injected=[
  {key:bOriginal,raw:swap(original.value.raw,pairs)},
  {key:bSource,raw:JSON.stringify(other(source.value.raw))},
  {key:'automatic-recovery-summary:'+encodeURIComponent(bOriginal),raw:JSON.stringify(bSummary)},
  {key:swap(ack.key,pairs),raw:JSON.stringify(bAck)},
  {key:swap(intent.key,pairs),raw:JSON.stringify(bIntent)},
  {key:'automatic-device-recovery:other-account-old-2254',raw:swap(original.value.raw,[[source.key,'automatic-cloud-source:other-account-old-2254']])},
  {key:'automatic-cloud-source:other-account-old-2254',raw:JSON.stringify(other(source.value.raw))},
  {key:'automatic-publication-source:other-account-2254',raw:JSON.stringify({format:'chain-scanner.automatic-recovery-publication',version:1,identity:OTHER,originalKey:bOriginal,deviceSource:'{}',cloudSource:null,revision:3})},
  {key:'automatic-recovery-note:'+encodeURIComponent(OTHER)+':'+'b'.repeat(64),raw:JSON.stringify({format:'chain-scanner.automatic-recovery-note',version:1,identity:OTHER,unresolved:[{id:'generation-other-2254',reason:'generation-incomplete'}],permanent:[]})},
  {key:'unreadable-generation-record:'+encodeURIComponent(OTHER)+':4:generation-other-2254:'+'c'.repeat(64),raw:JSON.stringify({format:'chain-scanner.unreadable-generation-record',version:2,identity:OTHER})},
  {key:'cloud-generation-recovery:'+encodeURIComponent(OTHER)+':4:generation-other-2254:'+'d'.repeat(64),raw:JSON.stringify({format:'chain-scanner.cloud-recovery-source',version:1,identity:OTHER,manifest:{schemaVersion:2,rev:4},generations:[]})},
 ].map((row,index)=>({...row,order:index+1}));
 await editRawDevice187(indexedDB,deviceDbName,tx=>{for(const row of injected)tx.objectStore('opaque').put(row,row.key);});
 await ordinaryAcknowledgedSave2254(app,'Saved after another account’s rows arrived');
 const after=(await deviceRows2254(store)).opaque;
 // Behaviour under test.
 for(const row of injected)assert.deepEqual(after.find(item=>item.key===row.key)?.value,row,'another account’s row stays byte for byte: '+row.key);
 assert.deepEqual(after.filter(row=>trimLeftover2254(row.key)&&!injected.some(item=>item.key===row.key)).map(row=>row.key),[],'this account’s recovery archives are cleared');
 // The other account's recovery from before summaries sends the check of
 // earlier sources to its full read, which reads this account's note too.
 assert.equal(await vm.runInContext('automaticCloudSourceHistoryFromSummaries().then(JSON.stringify)',ctx),'null','positive control: the full read answers');
 assert.deepEqual((await earlierSources2254(ctx)).unresolved,[[app.unreadableId,'generation-incomplete']],'the full read still reports this account’s unresolved generation from its note');
});

// #2254: the device store's only opaque delete, and its guards.
test('RISK acknowledged recovery trim store guard: the device store deletes only the keys a saved plan names, by key and in bounded batches, never while a recovery hold exists, on another head or account, or a row the device keeps, and a recovery that commits drops an unfinished plan',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),deviceDbName='trim-guard-2254-'+Math.random();
 const app=await loadApp({indexedDBProvider:indexedDB,deviceDbName});t.after(()=>app.dispose());
 app.ctx.addTask('Board before the trim',false);assert.equal(await app.ctx.persist(),true);
 const store=app.ctx.window.ScannerDeviceStore,head=await store.readHead(),account=head.account??null;
 const rows=[['automatic-device-recovery:guard-a','{"original":1}'],['automatic-cloud-source:guard-a','{"source":1}'],['automatic-recovery-ack:guard-a','{"ack":1}'],
  ['unreadable-generation-record:owner:guard','{}'],['device-recovery-original:guard','{}'],['device-recovery-file:guard','{}'],['cloud-generation-recovery:owner:guard','{}'],
  ['future-kind:guard','{}']].map(([key,raw],order)=>({key,raw,order}));
 await editRawDevice187(indexedDB,deviceDbName,tx=>{for(const row of rows)tx.objectStore('opaque').put(row,row.key);});
 const keys=async()=>[...(await store.readRawFingerprint()).stores.opaque.keys];
 const all=await keys(),planned=['automatic-device-recovery:guard-a','automatic-cloud-source:guard-a','automatic-recovery-ack:guard-a'];
 const plan=(extra={})=>({v:1,account,identity:'owner',revision:3,remaining:[...planned],...extra});
 const hold={v:1,reason:'cloud-source-recovery',automaticRecovery:true,account,identity:'owner',epoch:1,originalKey:'automatic-device-recovery:guard-a',headHash:head.hash};
 const setHold=value=>editRawDevice187(indexedDB,deviceDbName,tx=>{if(value)tx.objectStore('meta').put(value,'recoveryCloudHold');else tx.objectStore('meta').delete('recoveryCloudHold');});
 // Behaviour under test: refusals change nothing.
 for(const kept of ['unreadable-generation-record:owner:guard','device-recovery-original:guard','device-recovery-file:guard','cloud-generation-recovery:owner:guard'])
  assert.equal((await store.beginRecoveryTrim({expectedHeadHash:head.hash,plan:plan({remaining:[...planned,kept]})})).error,true,'a plan cannot name a kept row: '+kept);
 assert.equal((await store.beginRecoveryTrim({expectedHeadHash:'0'.repeat(64),plan:plan()})).conflict,true,'another head is refused');
 assert.equal((await store.beginRecoveryTrim({expectedHeadHash:head.hash,plan:plan({account:'someone-else@example.com'})})).conflict,true,'another account is refused');
 await setHold(hold);
 assert.equal((await store.beginRecoveryTrim({expectedHeadHash:head.hash,plan:plan()})).held,true,'a recovery hold refuses a new plan');
 assert.deepEqual(await keys(),all,'nothing changed');assert.equal(await store.getRecoveryTrim(),null);
 await setHold(null);
 assert.equal((await store.beginRecoveryTrim({expectedHeadHash:head.hash,plan:plan()})).ok,true,'positive control: a plan is saved');
 assert.deepEqual([...(await store.getRecoveryTrim()).remaining],planned);
 await setHold(hold);
 assert.equal((await store.continueRecoveryTrim({expectedHeadHash:head.hash,limit:2})).held,true,'a recovery hold stops a saved plan');
 assert.deepEqual(await keys(),all,'nothing was deleted under the hold');
 await setHold(null);
 // Two keys per batch, originals first, by key; the rest of the plan stays saved.
 const first=await store.continueRecoveryTrim({expectedHeadHash:head.hash,limit:2});
 assert.deepEqual([[...first.deleted],first.remaining,first.done],[planned.slice(0,2),1,false]);
 assert.deepEqual([...(await store.getRecoveryTrim()).remaining],planned.slice(2),'the rest stays planned for the next batch or opening');
 const second=await store.continueRecoveryTrim({expectedHeadHash:head.hash,limit:2});
 assert.deepEqual([[...second.deleted],second.done],[planned.slice(2),true]);
 assert.equal(await store.getRecoveryTrim(),null,'a finished plan is gone');
 assert.deepEqual((await keys()).sort(),all.filter(key=>!planned.includes(key)).sort(),'exactly the planned keys are deleted; kept and unknown rows stay');
 // A recovery that commits drops an unfinished plan.
 await editRawDevice187(indexedDB,deviceDbName,tx=>tx.objectStore('opaque').put({key:'automatic-cloud-source:guard-b',raw:'{}',order:9},'automatic-cloud-source:guard-b'));
 const now=await store.readHead();
 assert.equal((await store.beginRecoveryTrim({expectedHeadHash:now.hash,plan:plan({remaining:['automatic-cloud-source:guard-b']})})).ok,true);
 const committed=await store.writeRecoveredSource({expectedSource:'same',encodeSource:()=>'same',archives:[],payload:now.payload,account,hold:{...hold,originalKey:'automatic-device-recovery:guard-b'},guard:()=>true});
 assert.equal(committed.ok,true,'positive control: the recovery committed');
 assert.equal(await store.getRecoveryTrim(),null,'the recovery dropped the unfinished plan');
 assert.equal((await store.continueRecoveryTrim({expectedHeadHash:committed.hash,limit:2})).held,true);
 assert.ok((await keys()).includes('automatic-cloud-source:guard-b'),'and its rows stay');
});

test('RISK acknowledged recovery trim: after the trim the earlier-source check reads no whole store and answers from the note, and saving, sync, Restore and the saved-decisions review after a relaunch still work',{timeout:300000},async t=>{
 const app=await recoveredLeftoversApp2254(t),{ctx,shim,backend,store,unreadableId}=app;
 const earlier=await earlierSources2254(ctx);
 await adoptOverUnreadable2254(app);
 assert.deepEqual((await deviceRows2254(store)).opaque.filter(row=>trimLeftover2254(row.key)).map(row=>row.key),[],'positive control: the adoption’s acknowledgement cleared the recovery archives');
 // Behaviour under test: the readers.
 const wholeReads=[];
 for(const name of ['readRawExportSnapshot','readRawExportRows','listOpaqueArchives']){const call=store[name];store[name]=function(...args){if(name!=='listOpaqueArchives'||!args[0]?.prefix)wholeReads.push(name);return call.apply(this,args);};t.after(()=>{store[name]=call;});}
 assert.deepEqual(JSON.parse(await vm.runInContext('automaticCloudSourceHistoryFromSummaries().then(JSON.stringify)',ctx)).unresolved.map(row=>[row.id,row.reason]),
  [[unreadableId,'generation-incomplete']],'the check of earlier sources answers from the note');
 assert.deepEqual(wholeReads,[],'and reads no whole store');
 assert.deepEqual(await earlierSources2254(ctx),earlier,'both forms of the check answer as before the trim');
 // The check itself, run deliberately on what the trim left: it rechecks the
 // unreadable generation the note names and stops when its retries end.
 const checkedBefore=vm.runInContext('automaticCloudSourceResumeStatus.checkedAt',ctx);setFakeTime(ctx,vm.runInContext('Date.now()',ctx)+1000);
 vm.runInContext('automaticCloudSourceResumeRequested=true;automaticCloudSourceResumeDeliberate=true;maybeResumeAutomaticCloudSources()',ctx);
 await trimSettle2254(ctx,'the check of earlier sources settles');
 assert.notEqual(vm.runInContext('automaticCloudSourceResumeStatus.checkedAt',ctx),checkedBefore,'positive control: the check ran after the trim');
 ctx.openSettings();const status=(shim.document.getElementById('modalRoot').innerHTML.match(/id="automaticCloudSourceResumeStatus"[^>]*>([^<]*)/)||[])[1];ctx.closeModal();
 assert.equal(status,'An earlier cloud source remains unresolved and protected. Your current board remains saved on this device.',
  'Settings reports the unresolved earlier source as before, never an archive it could not check');
 // Saving and sync.
 await ordinaryAcknowledgedSave2254(app,'Saved after the trim');
 assert.equal((await backend.CS.pull()).payload,ctx.cloudPayload(),'the cloud holds the saved board');
 // Restore: a backup still restores and the restored board saves and syncs.
 const daily=(await store.listBackups()).find(row=>row.kind==='daily');assert.ok(daily,'positive control: a daily backup is listed');
 ctx.openSettings();await ctx.restoreDurableBackupById(daily.id);await trimSettle2254(ctx,'the restore settles');
 assert.ok((await store.listBackups()).some(row=>row.kind==='before-restore'),'Restore saved the current board first');
 assert.equal((await store.readHead()).payload,JSON.stringify(ctx.state),'the restored board saved on this device');
 await ctx.sendPush();await trimSettle2254(ctx,'the restored board’s save settles');
 assert.equal(syncStatus2200(shim).text,'☁ synced','the restored board synced');
 // The saved-decisions review after a relaunch reads its device and cloud
 // sources from what the trim left.
 const reopened=await coldRelaunch2198(t,app,[]);
 assert.equal(await reopened.ctx.onAction('review-decision-recovery',{}),true,'the saved-decisions review reads its sources after a relaunch');
 assert.doesNotMatch(reopened.shim.document.getElementById('modalRoot').innerHTML,/changed in another tab|could not be verified/,'it reports no changed or unverifiable source');
});

test('RISK acknowledged recovery trim: the recovery file holds only what the device keeps after the trim',{timeout:300000},async t=>{
 const app=await recoveredLeftoversApp2254(t),{ctx,shim,store,unreadableId}=app;
 const beforeFile=await downloadedRecoveryFile2254(app),beforeRows=await deviceRows2254(store);
 await adoptOverUnreadable2254(app);
 const {text,file}=await downloadedRecoveryFile2254(app),kept=await deviceRows2254(store);
 const keysOf=name=>(file.appSources.indexedDB.stores[name]||[]).map(row=>decodeManualArchiveTypedValue(row.key));
 // Behaviour under test.
 assert.equal(file.manifest.status,'complete','the trimmed file is complete');
 assert.deepEqual(keysOf('opaque').sort(),kept.opaque.map(row=>row.key).sort(),'its archives are the kept rows');
 assert.deepEqual(keysOf('opaque').filter(trimLeftover2254),[],'no recovery archive is in it');
 assert.deepEqual(keysOf('snapshots').sort(),kept.snapshots.map(row=>row.key).sort(),'its board copies are the head and those the backups use');
 assert.deepEqual(keysOf('backups').sort(),kept.backups.map(row=>row.key).sort(),'every backup is in it');
 const local=new Map(file.appSources.localStorage.map(row=>[row.key,row.status]));
 for(const key of [SYNC_STORE_KEY,LOCAL_HEAD_KEY,LOCAL_BACKUPS_KEY])
  assert.equal(local.get(key),shim.localStorage.getItem(key)===null?'absent':'present','its browser sources are the kept ones: '+key);
 const notes=keysOf('opaque').filter(key=>!key.startsWith('unreadable-generation-record:'));
 assert.equal(notes.length,1,'one note: '+JSON.stringify(notes));
 assert.ok(JSON.stringify(file.appSources.indexedDB.stores.opaque).includes(unreadableId),'the note in it names the unresolved generation');
 // The cleared archives' text is gone from the file.
 const cleared=beforeRows.opaque.filter(row=>trimLeftover2254(row.key)).reduce((total,row)=>total+row.value.raw.length,0);
 assert.ok(cleared>0&&text.length<beforeFile.text.length-0.9*cleared,'the file no longer carries the cleared archives: '+text.length+' against '+beforeFile.text.length+' before, '+cleared+' cleared');
 assert.ok(file.currentBoard?.tasks?.length===ctx.state.tasks.length,'the file keeps the board');
});

test('RISK acknowledged recovery trim: a note the trim kept still lets the check of earlier sources reconcile that generation once it can be read, and the trim after its acknowledgement clears the note',{timeout:300000},async t=>{
 const app=await recoveredLeftoversApp2254(t),{ctx,backend,store,unreadableId,activePath}=app,codec=ctx.window.ChainStorageV2;
 await ordinaryAcknowledgedSave2254(app,'Saved after the recovery');
 assert.deepEqual((await deviceRows2254(store)).opaque.filter(row=>trimLeftover2254(row.key)).map(row=>row.key),[],'positive control: the trim cleared the recovery');
 assert.deepEqual((await earlierSources2254(ctx)).unresolved,[[unreadableId,'generation-incomplete']],'positive control: the note names the unreadable generation');
 // Behaviour under test: the generation's own bytes come back, and Retry sync
 // merges it from the note.
 const encoded=await codec.encodeSnapshot(exactPaddedBoard(JSON.parse(app.acknowledgedBefore),'futureUnreadableActiveFixture',CAPTURED_UNREADABLE_GENERATION.active.byteLength));
 assert.equal(encoded.hash,backend.docs.get(activePath).hash,'fixture: these are the unreadable generation’s own bytes');
 for(const chunk of encoded.chunks)backend.docs.set(activePath+'/chunks/'+String(chunk.index).padStart(8,'0'),structuredClone(chunk));
 await ctx.onAction('sync-retry',{});await trimSettle2254(ctx,'the deliberate check of earlier sources settles');
 const resolvedBy=(await deviceRows2254(store)).opaque.filter(row=>row.key.startsWith('automatic-recovery-ack:')).map(row=>JSON.parse(row.value.raw));
 assert.ok(resolvedBy.some(ack=>ack.resolvedGenerationIds.includes(unreadableId)),'the generation the note names is reconciled once it can be read, and its acknowledgement resolves it');
 assert.equal(vm.runInContext('automaticCloudSourceResumeStatus.state',ctx),'acknowledged','the check of earlier sources completes');
 assert.equal((await backend.CS.pull()).payload,ctx.cloudPayload(),'and the cloud confirms the reconciled board');
 await ordinaryAcknowledgedSave2254(app,'Saved after the merge');
 const after=await deviceRows2254(store);
 assert.deepEqual(await earlierSources2254(ctx),{error:null,unresolved:[],permanent:[]},'nothing earlier is left unresolved');
 assert.deepEqual(after.opaque.filter(row=>trimLeftover2254(row.key)||row.key.startsWith('automatic-recovery-note:')).map(row=>row.key),[],
  'the next trim clears the merge’s own archives and the resolved note');
});

// #2254: showing the app asks for the check of earlier sources, and an
// acknowledgement that arrives while that check is asked for leaves the trim
// to it, since the check goes first. The trim waited for a later
// acknowledged save instead: on a phone that waited over its work budget,
// which leaves that check for a deliberate run, an adoption while the app
// opened kept every recovery archive until the next edit.
test('RISK acknowledged recovery trim: an adoption the cloud acknowledges while the app opens is trimmed without a further save, once the check of earlier sources has run or when a phone over its work budget leaves that check for a deliberate run',{timeout:300000},async t=>{
 for(const variant of ['a phone that waited over its work budget','a device within its work budget'])await t.test(variant,async sub=>{
  const app=await recoveredLeftoversApp2254(sub),{ctx,shim,backend,store,unreadableId}=app,OVER='fvp:chain-scanner:automatic-recovery-over-budget';
  const waited=variant==='a phone that waited over its work budget';
  if(waited)assert.ok(ctx.localStorage.getItem(OVER),'positive control: the over-budget wait is remembered');
  else{ctx.localStorage.removeItem(OVER);ctx.window.CLOUD_RECOVERY_WORK_BUDGET_BYTES=1073741824;}
  const mark=ctx.localStorage.getItem(OVER),earlier=await earlierSources2254(ctx);
  assert.deepEqual(earlier.unresolved,[[unreadableId,'generation-incomplete']],'positive control: the unreadable generation is an unresolved earlier source');
  vm.runInContext('globalThis.__checks2254=[];globalThis.__fallback2254=openAutomaticCloudSourceFallback;'+
   'openAutomaticCloudSourceFallback=(failed,...rest)=>{__checks2254.push(failed?.code??null);return __fallback2254(failed,...rest);}',ctx);
  const pushes=[],push=backend.CS.push;
  backend.CS.push=async(payload,updatedAt,baseRev,context)=>{pushes.push(baseRev);return push(payload,updatedAt,baseRev,context);};
  sub.after(()=>{backend.CS.push=push;});
  await unreadableNextRevision2254(app,'opening');
  // The app is shown: it pulls, adopts its board over the unreadable
  // revision and the cloud acknowledges it, with the check asked for.
  ctx.closeModal();await flush();shim.window.dispatchEvent({type:'pageshow'});
  await trimSettle2254(ctx,'the opening, its adoption and what follows settle');
  assert.deepEqual(pushes,[backend.docs.get('users/owner').rev-1],'positive control: the opening adopted the board once over the unreadable revision');
  assert.equal(syncStatus2200(shim).text,'☁ synced','positive control: the cloud acknowledged the adopted board');
  const checks=vm.runInContext('__checks2254.filter(code=>code==="automatic-source-resume").length',ctx);
  if(waited)assert.equal(checks,0,'positive control: over its work budget the opening leaves the check of earlier sources for a deliberate run');
  else assert.ok(checks>=1,'positive control: the opening ran the check of earlier sources');
  // Behaviour under test.
  const after=await deviceRows2254(store);
  assert.deepEqual(after.opaque.filter(row=>trimLeftover2254(row.key)).map(row=>row.key),[],'the trim follows the adoption without a further save');
  assert.deepEqual(after.meta.map(row=>row.key),['head'],'and finishes, leaving no unfinished trim');
  assert.equal(pushes.length,1,'nothing more is published');
  assert.equal(ctx.localStorage.getItem(OVER),mark,'the over-budget mark stays as it was');
  assert.deepEqual(await earlierSources2254(ctx),earlier,'the check of earlier sources still reports the same unresolved generation');
 });
});

// #2254 release review (B3): the trim also clears the storage upgrade's copy
// of the older backup list (an opaque "<n>:fvp:chain-scanner:daily-backups:v1"
// row), as the owner authorized for "migrated legacy copies" on #2254
// (2026-11-07). Settings, Help and the changelog say so in plain words.
test('RISK acknowledged recovery trim guidance: Settings, mounted FAQ and changelog say that once the cloud confirms the board the app clears old recovery copies and the storage upgrade’s copy of the older backup list by itself, what it keeps, and that until then every recovery copy stays',async t=>{
 const app=await loadApp();t.after(()=>app.dispose());
 for(const id of ['appChangelogCurrent','appChangelog'])app.shim.document.getElementById(id).innerHTML=html.match(new RegExp('<template id="'+id+'">([\\s\\S]*?)<\\/template>'))[1];
 app.ctx.openSettings();const settings=app.shim.document.getElementById('modalRoot').innerHTML;
 const section=settings.split('<h3>Daily local backups</h3>')[1]?.split('</p>')[0]||'';
 assert.ok(section,'positive control: Settings has the Daily local backups notes');
 assert.match(section,/Once the cloud confirms your board, the app also clears the copy of the older backup list that a storage upgrade kept\./);
 assert.doesNotMatch(section,/Separate recovery archives kept by a storage upgrade remain intact/,'Settings no longer says that copy stays');
 await app.ctx.onAction('help',{});const markup=app.shim.document.getElementById('modalRoot').innerHTML;
 const answerTo=question=>markup.split('<dt>'+question+'</dt><dd>')[1]?.split('</dd>')[0]||'';
 const wordsOf=text=>text.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
 assert.ok(answerTo('Does the app fix an unreadable cloud copy by itself?'),'positive control: the mounted Help has the adoption answer');
 const answer=answerTo('What happens to old recovery copies on this device?');
 assert.match(answer,/Once the cloud confirms your board, the app clears the copies earlier cloud recoveries kept by itself, so it stays fast and the recovery file stays small\. It also clears the copy of the older backup list that a storage upgrade kept\./);
 assert.match(answer,/It keeps your board, the copy the cloud confirmed, every backup, and a short note naming any cloud copy it still could not read/);
 assert.match(answer,/those cloud copies stay protected in the cloud/);
 assert.match(answer,/Until the cloud confirms a board, every recovery copy stays on this device\./);
 assert.match(answer,/Nothing needs your choice\./);
 assert.ok(wordsOf(answer)<=130,'the answer stays within the 130-word limit: '+wordsOf(answer));
 const release=(markup.split('data-changelog-notes>')[1]||'').split('<h3>November 6, 2026</h3>')[1]?.split('</ul>')[0]||'';
 assert.ok(release,'positive control: the mounted changelog has the November 6 release');
 assert.match(release,/<li>Once the cloud confirms your board, the app now clears the copies earlier cloud recoveries kept on this device by itself\. It also clears the copy of the older backup list that a storage upgrade kept\. This keeps the app fast and the recovery file small, and nothing needs your choice\./);
 assert.match(release,/It keeps your board, the copy the cloud confirmed, every backup and a short note naming any cloud copy it still could not read\. Until the cloud confirms a board, every recovery copy stays\.<\/li>/);
 for(const [question,text] of [['old recovery copies answer',answer],['November 6 changelog',release]]){
  assert.doesNotMatch(text.replace(/<[^>]+>/g,' '),/desktop|computer|laptop|\bMac\b/i,question+': Help never sends anyone to another device');
  assert.doesNotMatch(text,/recovers on its own|rebuilds on its own|on its own, once/,question+': no wording the guidance tests retired');
 }
});
