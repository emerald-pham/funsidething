import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {runSceneScenarios} from './button-safety-scenes.mjs';
import {runCloudScenarios} from './button-safety-cloud.mjs';
import {runTransferScenarios,rawIdentity,assertArchive} from './button-safety-transfer.mjs';
import fs from 'node:fs';
import {runRapidCoreScenarios} from './button-safety-rapid-core.mjs';
const ready=()=>!!document.getElementById('exportTransferDialog')&&!document.querySelector('[data-act="copy-export"]').disabled&&!document.querySelector('[data-act="download-export"]').disabled;
export async function runRapidScenarios(h){
 await h.scenario('ordinary obsolete Copy cannot alter replacement transfer',{clipboardDeferred:true,retainedCopies:3,decorate:board=>{
  board.mode='work';board.chain=['synthetic-kept'];board.candidateId=null;board.listOpen=true;board.protectedBackupIds=['gate-retained-1'];
  board.tasks[63].ratingHistory=[{v:1,id:'ordinary-obsolete-copy-prior-history',at:1000,seq:1,kind:'edit',after:{mu:25,sigma:8.333333333,likelihood:1/64,eligible:true,fallback:false,topK:1,n:64,samples:250},basis:'ordinary-obsolete-copy-prior-basis',futureHistory:{opaque:['retain',19]}}];board.tasks[63].ratingHistoryHead='ordinary-obsolete-copy-prior-history';
 }},async ui=>{
 const hash=value=>createHash('sha256').update(value).digest('hex'),copy=value=>JSON.parse(JSON.stringify(value));
 const scenario='ordinary obsolete Copy cannot alter replacement transfer',exactKeys=(value,keys,label)=>assert.deepEqual(Object.keys(value).sort(),keys.slice().sort(),label);
 const taskLiteral={id:'synthetic-kept',title:'Synthetic retained task',url:null,due:null,startsAt:null,evergreen:false,evergreenHours:18,evergreenResetAtDay:true,mu:25,sigma:8.333333333,done:false,createdAt:1,completedAt:null,lastDoneAt:null,ctx:[],futureTask:{opaque:['retain',7]}};
 const expectedSeed={v:1,tasks:[copy(taskLiteral)],contexts:[],chain:['synthetic-kept'],considered:{},cantAt:{},workedAt:{},workLog:[],mode:'work',scanMode:'descending',candidateId:null,passId:'synthetic-existing-pass',passStartedAt:0,interventionActive:false,interventionP:0,snooze:0,decisionsMs:[],presentedAt:0,listOpen:true,ctxOpen:true,histOpen:false,updatedAt:1,syncAccount:null,syncRev:0,syncDirty:true,seenQuickStart:true,settings:{scanMode:'descending',theme:'light',skipOldestFirstDot:false,horizonMin:60,thresholdPct:25,samples:250,cantMin:30,workedHours:8},futureBoard:{opaque:['retain',11]}};
 for(let index=1;index<64;index++)expectedSeed.tasks.push({...copy(taskLiteral),id:'synthetic-populated-'+index,title:'Synthetic retained task '+index,createdAt:1+index,futureTask:{opaque:['retain',index]}});
 expectedSeed.futurePopulated={version:7,opaque:'p'.repeat(1048576)};expectedSeed.protectedBackupIds=['gate-retained-1'];
 const priorHistory={v:1,id:'ordinary-obsolete-copy-prior-history',at:1000,seq:1,kind:'edit',after:{mu:25,sigma:8.333333333,likelihood:1/64,eligible:true,fallback:false,topK:1,n:64,samples:250},basis:'ordinary-obsolete-copy-prior-basis',futureHistory:{opaque:['retain',19]}};
 expectedSeed.tasks[63].ratingHistory=[copy(priorHistory)];expectedSeed.tasks[63].ratingHistoryHead=priorHistory.id;
 const seedRaw=JSON.stringify(expectedSeed),seedHash=hash(seedRaw),manualIds=['gate-retained-0','gate-retained-1','gate-retained-2'],manualPayloads=[0,1,2].map(index=>JSON.stringify({...expectedSeed,futureSourceRole:index}));
 const expectedLive=copy(expectedSeed);expectedLive.v=2;expectedLive.tasks=expectedLive.tasks.map(row=>({...row,prerequisiteRevision:0,prerequisiteIds:[],prerequisiteId:null,prerequisiteMirror:null,prerequisiteOps:{}}));
 expectedLive.settings={horizonMin:60,thresholdPct:25,samples:250,cantMin:30,workedHours:16,postponeHours:1,evergreenHours:18,evergreenResetAtDay:true,scanMode:'descending',squaredDefaultVersion:1,listMetric:'rank',excludeNoContext:false,lastTaskWoop:false,skipOldestFirstDot:false,floatingHeader:false,patternedIndicators:false,showPostpone:true,theme:'light',dateFormat:'system',hourlyQuotes:{},scene:{time:null,season:null,location:null}};
 Object.assign(expectedLive,{deletionLog:[],deletedTaskIds:{},clearedHistoryIds:{},restoredTaskIds:{},restoredHistoryIds:{},restoredTaskOps:{},restoredHistoryOps:{},deletedAfterRestoreOps:{},clearedAfterRestoreOps:{},chance:null,addOpen:true});
 const safeValue=(node,value,label)=>{
  if(value===undefined){assert.deepEqual(node,{type:'undefined'},label);return;}
  if(value===null){assert.deepEqual(node,{type:'null'},label);return;}
  if(typeof value!=='object'){assert.ok(['string','number','boolean'].includes(typeof value));if(typeof value==='number')assert.ok(Number.isFinite(value)&&!Object.is(value,-0));assert.deepEqual(node,{type:typeof value,value},label);return;}
  if(Array.isArray(value)){exactKeys(node,['type','items','properties'],label);assert.equal(node.type,'array');assert.deepEqual(node.properties,[]);assert.deepEqual(Object.keys(value),Array.from({length:value.length},(_,i)=>String(i)));assert.equal(node.items.length,value.length);value.forEach((item,index)=>safeValue(node.items[index],item,label+'['+index+']'));return;}
  exactKeys(node,['type','entries'],label);assert.equal(node.type,'object');assert.ok(node.entries.every(row=>Array.isArray(row)&&row.length===2));assert.deepEqual(node.entries.map(row=>row[0]),Object.keys(value));node.entries.forEach(([key,item])=>safeValue(item,value[key],label+'.'+key));
 };
 const rowsExact=(actual,expected,label)=>{assert.equal(actual.length,expected.length,label);assert.equal(new Set(actual.map(row=>row.id)).size,actual.length,label);for(const row of expected){const matches=actual.filter(item=>item.id===row.id);assert.equal(matches.length,1,label);assert.deepEqual(matches[0],row,label);assert.equal(JSON.stringify(matches[0]),JSON.stringify(row),label);}};
 const localKeys=['fvp:chain-scanner:v1','fvp:chain-scanner:protected:v1','fvp:chain-scanner:daily-backups:v1','fvp:chain-scanner:device-store-v2'];
 const pendingLiteral={generationId:'gate-pending',payloadHash:seedHash,baseRev:0,updatedAt:7,account:'gate-owner'};
 const snapshotKeys=['current','currentHash','durable','durableHash','capturedAtMs','backups','opaque','pending','pendingOwner','hold','timeZone','localSources','indexedDB','view','presses','clicks'];
 const opaqueLiteral={type:'array',items:[{type:'object',entries:[['key',{type:'string',value:'gate-opaque-exact'}],['raw',{type:'string',value:'opaque exact bytes\u0000retain'}],['futureBytes',{type:'typed-array',constructor:'Uint8Array',buffer:{type:'array-buffer',base64:'ABH/'},byteOffset:0,length:3}],['futureMinusZero',{type:'special-number',value:'-0'}]]}],properties:[]};
 // This independent value encoder serves only the test's literal source map.
 const literalValue=value=>{
  if(value===null)return{type:'null'};
  if(Object.is(value,-0))return{type:'special-number',value:'-0'};
  if(ArrayBuffer.isView(value))return{type:'typed-array',constructor:'Uint8Array',buffer:{type:'array-buffer',base64:Buffer.from(value.buffer).toString('base64')},byteOffset:0,length:value.length};
  if(Array.isArray(value))return{type:'array',items:value.map(literalValue),properties:[]};
  if(typeof value==='object')return{type:'object',entries:Object.entries(value).map(([key,item])=>[key,literalValue(item)])};
  return{type:typeof value,value};
 };
 const allClicks=['act:settings','disclosure','act:export-backup','act:copy-export','act:close-modal','act:settings','disclosure','act:export-backup','act:copy-export'],allPresses=allClicks.slice();
 const verifyObsoleteCopySources=phases=>{
  const names=['seed','settings-old','prepared-old','pending-old','closed','settings-new','prepared-new','pending-new','obsolete-settled','completed-new','final-source'];assert.deepEqual(phases.map(row=>row.phase),names,'All eleven complete old/close/replacement/obsolete/new-completion sources, once in order');
  const[seed,settingsOld,preparedOld,pendingOld,closed,settingsNew,preparedNew,pendingNew,obsoleteSettled,completedNew,finalSource]=phases;
  const originalRows=manualIds.map((id,index)=>{const row=seed.backups.find(item=>item.id===id);assert.ok(row);exactKeys(row,['id','kind','at','day','payload'],'Complete original manual');assert.equal(row.kind,'manual');assert.equal(row.day,'2026-10-25');assert.ok(Number.isSafeInteger(row.at)&&row.at>0&&row.at<=seed.capturedAtMs);assert.equal(row.payload,manualPayloads[index]);return{id,kind:'manual',at:row.at,day:'2026-10-25',payload:manualPayloads[index]};});
  const iso=(text,lower,upper)=>{assert.equal(typeof text,'string');const at=Date.parse(text);assert.ok(Number.isFinite(at)&&at>=lower&&at<=upper);assert.equal(new Date(at).toISOString(),text);return at;};
  assert.equal(seed.localSources.length,4);assert.deepEqual(seed.localSources.map(row=>row.key),localKeys);
  const legacyDaily=JSON.parse(seed.localSources[2].raw);assert.equal(legacyDaily.length,1,'Boot creates only its first local daily copy');const daily=legacyDaily[0];exactKeys(daily,['id','day','at','kind','payload'],'Complete boot daily source');assert.equal(daily.kind,'daily');assert.equal(daily.payload,JSON.stringify(expectedLive));assert.ok(Number.isSafeInteger(daily.at)&&daily.at>0&&daily.at<=seed.capturedAtMs);assert.match(daily.id,new RegExp('^'+daily.at+'-[a-z0-9]+$'));
  const dayParts=new Intl.DateTimeFormat('en-US',{timeZone:seed.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(daily.at));assert.equal(daily.day,['year','month','day'].map(type=>dayParts.find(row=>row.type===type).value).join('-'));
  const expectedDaily={id:daily.id,day:daily.day,at:daily.at,kind:'daily',payload:JSON.stringify(expectedLive)},expectedLocal=[{key:localKeys[0],status:'present',raw:seedRaw},{key:localKeys[1],status:'absent'},{key:localKeys[2],status:'present',raw:JSON.stringify([expectedDaily])},{key:localKeys[3],status:'present',raw:'1'}];
  const sourceFingerprint=hash(JSON.stringify([{key:localKeys[0],raw:seedRaw}])),headNode=seed.indexedDB.meta.find(row=>row.key.value==='head')?.value;assert.ok(headNode);
  const committedAt=headNode.entries.find(([key])=>key==='committedAt')?.[1]?.value;assert.ok(Number.isSafeInteger(committedAt)&&committedAt>0&&committedAt<=seed.capturedAtMs);
  const originalSnapshots=[{hash:seedHash,payload:seedRaw},...manualPayloads.map(payload=>({hash:hash(payload),payload}))].sort((a,b)=>a.hash<b.hash?-1:1);
  const encodeRow=(key,value)=>({key:literalValue(key),value:literalValue(value)}),expectedStores={
   meta:[encodeRow('head',{hash:seedHash,account:null,sourceFingerprint,schemaVersion:2,committedAt}),encodeRow('pending:gate-owner',pendingLiteral)],
   snapshots:originalSnapshots.map(row=>encodeRow(row.hash,row)),
   backups:originalRows.map(row=>encodeRow(row.id,{id:row.id,kind:'manual',at:row.at,day:'2026-10-25',payloadHash:hash(row.payload)})),
   opaque:[encodeRow('0:gate-opaque-exact',{key:'gate-opaque-exact',raw:'opaque exact bytes\u0000retain',futureBytes:new Uint8Array([0,17,255]),futureMinusZero:-0,order:0})]
  };
  const expectedBoardExport=copy(expectedLive);for(const key of['syncRev','syncAccount','syncIdentity','lastCloudServerAt','syncDirty','protectedBackupIds','decisionBase'])delete expectedBoardExport[key];
  const counts={meta:2,snapshots:4,backups:3,opaque:1},database=seed.view.database;assert.match(database,/^button-[a-f0-9-]{36}$/);
  const verifyArchive=(raw,lowerPhase,upperPhase)=>{
   assert.equal(typeof raw,'string');const archive=JSON.parse(raw);exactKeys(archive,['format','formatVersion','capturedAt','currentBoard','manifest','appSources','repairInfo'],'Complete archive object');assert.equal(archive.format,'chain-scanner.recovery-archive');assert.equal(archive.formatVersion,1);iso(archive.capturedAt,lowerPhase.capturedAtMs,upperPhase.capturedAtMs);
   assert.deepEqual(archive.currentBoard,expectedBoardExport,'Every independent canonical current-board export field, including all64 tasks, history, settings and unknowns');
   assert.deepEqual(archive.appSources,{localStorage:expectedLocal,indexedDB:{database,stores:expectedStores}},'Every complete independently specified raw local/IDB source');
   const localManifest=Object.fromEntries(expectedLocal.map(row=>[row.key,{status:row.status==='present'?'included':'absent'}]));
   assert.deepEqual(archive.manifest,{status:'complete',consistency:'single-readonly-idb-transaction-and-unchanged-live-sources',sources:{currentBoard:{status:'included',format:'existing-board-json'},localStorage:localManifest,indexedDB:{database,schemaVersion:2,stores:Object.fromEntries(Object.entries(counts).map(([key,rowCount])=>[key,{status:'included',rowCount}]))}},failures:[]},'The complete archive manifest agrees with all independent full sources');
   exactKeys(archive.repairInfo,['version','debugLog'],'Complete retained metadata-only repair information');assert.equal(archive.repairInfo.version,1);const log=archive.repairInfo.debugLog;exactKeys(log,['schema','version','metadataOnly','boardDataIncluded','capturedAt','localTime','utcOffsetMinutes','app','serviceWorker','restartDiagnostics','save','recoverySources','recentErrors','events','sourceOperations','retention'],'Complete debug metadata is retained, never used as board/source authority');assert.equal(log.schema,'funsidething.support-diagnostics');assert.equal(log.version,1);assert.equal(log.metadataOnly,true);assert.equal(log.boardDataIncluded,false);assert.ok(Buffer.byteLength(JSON.stringify(log))<=24*1024);assert.equal(raw,JSON.stringify(archive,null,2),'The entire original archive JSON is preserved, including all debug metadata');
   assert.ok(upperPhase.capturedAtMs>=Date.parse(archive.capturedAt));return archive;
  };
  const oldRaw=preparedOld.view.preparedRaw,newRaw=preparedNew.view.preparedRaw,oldArchive=verifyArchive(oldRaw,settingsOld,preparedOld),newArchive=verifyArchive(newRaw,settingsNew,preparedNew);assert.ok(Date.parse(newArchive.capturedAt)>Date.parse(oldArchive.capturedAt),'A genuinely new prepared transfer has a later capture identity');assert.notEqual(newRaw,oldRaw,'Both complete distinct prepared archives stay independently retained');
  const statuses=[null,null,'Ready. Choose Copy or Download.','Copying the prepared archive…',null,null,'Ready. Choose Copy or Download.','Copying the prepared archive…','Copying the prepared archive…','Copied the same recovery archive available from Download.','Copied the same recovery archive available from Download.'];
  const clickCounts=[0,1,3,4,5,6,8,9,9,9,9],pressCounts=clickCounts.slice(),dialogIndexes=[2,3,6,7,8,9,10],busyIndexes=[3,7,8],archiveByPhase=[null,null,oldRaw,oldRaw,null,null,newRaw,newRaw,newRaw,newRaw,newRaw];
  for(const[ordinal,phase]of phases.entries()){
   exactKeys(phase.sourceValue,['type','entries'],'Complete lossless Copy source root');assert.equal(phase.sourceValue.type,'object');assert.equal(phase.sourceValueEncoding,'chain-scanner.manual-archive-value/v1');assert.deepEqual(phase.sourceValue.entries.map(row=>row[0]),snapshotKeys);
   assert.deepEqual(Object.keys(phase).filter(key=>!snapshotKeys.includes(key)&&!['sourceValueEncoding','sourceValue','schemaVersion','phase','scenario','sourceIdentity'].includes(key)),[],'No unexamined source field');
   for(const[key,node]of phase.sourceValue.entries){if(key==='opaque')assert.deepEqual(node,opaqueLiteral);else safeValue(node,phase[key],'lossless '+key);assert.ok(Object.hasOwn(phase,key));}
   assert.ok(Number.isSafeInteger(phase.capturedAtMs)&&phase.capturedAtMs>=seed.capturedAtMs);if(ordinal)assert.ok(phase.capturedAtMs>=phases[ordinal-1].capturedAtMs);
   assert.deepEqual(JSON.parse(phase.current),expectedLive,'The complete independently literal hydrated current board remains exact');assert.equal(phase.current,JSON.stringify(expectedLive));assert.equal(phase.currentHash,hash(phase.current));assert.equal(phase.durable,seedRaw,'Every original durable raw byte remains exact');assert.equal(phase.durableHash,seedHash);rowsExact(phase.backups,originalRows,'Neither transfer nor obsolete completion creates/replaces/retires any device backup');assert.deepEqual(phase.pending,pendingLiteral);assert.equal(phase.pendingOwner,null);assert.equal(phase.hold,null);assert.equal(phase.timeZone,seed.timeZone);assert.deepEqual(phase.localSources,expectedLocal);assert.deepEqual(phase.indexedDB,expectedStores,'Every raw IDB key/value, metadata, pending/typed/negativezero original stays exact');
   exactKeys(phase.view,['documentId','ready','database','dialogOpen','status','copyDisabled','downloadDisabled','preparedRaw','clipboard','pendingCount'],'Complete actual transfer UI and external clipboard boundary');assert.ok(phase.view.documentId);assert.equal(phase.view.documentId,seed.view.documentId);assert.equal(phase.view.ready,true);assert.equal(phase.view.database,database);assert.equal(phase.view.dialogOpen,dialogIndexes.includes(ordinal));assert.equal(phase.view.status,statuses[ordinal]);assert.equal(phase.view.copyDisabled,dialogIndexes.includes(ordinal)?busyIndexes.includes(ordinal):null);assert.equal(phase.view.downloadDisabled,dialogIndexes.includes(ordinal)?false:null);assert.equal(phase.view.pendingCount,ordinal>=7?2:ordinal>=3?1:0);assert.deepEqual(phase.view.clipboard,ordinal>=7?[oldRaw,newRaw]:ordinal>=3?[oldRaw]:[],'Both actual clipboard operations retain their own complete source archive bytes');assert.equal(phase.view.preparedRaw,archiveByPhase[ordinal],'Old close retires only its transfer, and old completion never changes the replacement archive');
   assert.equal(phase.clicks.length,clickCounts[ordinal]);assert.equal(phase.presses.length,pressCounts[ordinal]);assert.deepEqual(phase.clicks.map(row=>row.action),allClicks.slice(0,clickCounts[ordinal]));assert.deepEqual(phase.presses.map(row=>row.action),allPresses.slice(0,pressCounts[ordinal]));
   for(const[kind,rows]of[['press',phase.presses],['click',phase.clicks]])rows.forEach((row,index)=>{exactKeys(row,kind==='press'?['at','action','pointerType','trusted','offeredTaskId']:['at','action','trusted','offeredTaskId'],'Complete native '+kind);assert.equal(row.trusted,true);assert.equal(row.offeredTaskId,null);if(kind==='press')assert.equal(row.pointerType,'mouse');assert.ok(Number.isFinite(row.at)&&row.at<=phase.capturedAtMs);if(index)assert.ok(row.at>rows[index-1].at);});
   phase.clicks.forEach((click,index)=>{const press=phase.presses[index];assert.ok(click.at>=press.at);assert.equal(click.action,press.action);});
  }
  for(const phase of phases)assert.deepEqual(phase.current,seed.current);
  assert.deepEqual(obsoleteSettled.view,pendingNew.view,'After the old actual clipboard promise settles, every newer UI/busy/status/archive/clipboard field stays byte exact');assert.equal(JSON.stringify(obsoleteSettled.view),JSON.stringify(pendingNew.view));
  assert.deepEqual(obsoleteSettled.presses,pendingNew.presses);assert.deepEqual(obsoleteSettled.clicks,pendingNew.clicks);assert.equal(obsoleteSettled.view.preparedRaw,newRaw);assert.equal(completedNew.view.preparedRaw,newRaw);assert.equal(completedNew.view.copyDisabled,false);assert.equal(completedNew.view.downloadDisabled,false);
  return{phases:names,copy:{attempted:2,accepted:2,refused:0,disappeared:0,clipboardOperations:2},archives:{old:{sha256:hash(oldRaw),bytes:Buffer.byteLength(oldRaw)},replacement:{sha256:hash(newRaw),bytes:Buffer.byteLength(newRaw)},complete:true,oldSettlementPreservedReplacement:true,replacementCompletedTruthfully:true},source:{currentHash:seed.currentHash,durableHash:seedHash,manualIds,stores:counts,localKeys,unchanged:true}};
 };
 const snapshots=[];
 const capture=async phase=>{
  const snapshot=await ui.page.evaluate(async()=>{
   const head=await ScannerDeviceStore.readHead(),current=JSON.stringify(state),sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
   const snapshot={current,currentHash:await sha256(current),durable:head.payload,durableHash:head.hash,capturedAtMs:Date.now(),backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),pending:await ScannerDeviceStore.getPendingUpload('gate-owner'),pendingOwner:await ScannerDeviceStore.getPendingUpload('owner'),hold:await ScannerDeviceStore.getRecoveryCloudHold(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,localSources:readManualArchiveLocalSources(),indexedDB:encodeManualArchiveSnapshot(await ScannerDeviceStore.readRawExportSnapshot()).stores,
    view:{documentId:window.__installedFixture.documentId,ready:document.documentElement.dataset.appReady==='true',database:window.CHAIN_STORAGE_DB_NAME,dialogOpen:!!document.getElementById('exportTransferDialog'),status:document.getElementById('exportTransferStatus')?.textContent??null,copyDisabled:document.getElementById('copyExportButton')?.disabled??null,downloadDisabled:document.getElementById('downloadExportButton')?.disabled??null,preparedRaw:exportTransferPayload,clipboard:structuredClone(window.__buttonClipboard),pendingCount:window.__buttonClipboardPending.length},presses:structuredClone(window.__buttonNativePresses),clicks:structuredClone(window.__buttonNativeClicks)};
   snapshot.capturedAtMs=Date.now();return{...snapshot,sourceValueEncoding:'chain-scanner.manual-archive-value/v1',sourceValue:encodeManualArchiveValue(snapshot,'ordinary obsolete Copy sourceSnapshot')};
  });
  ui.recordOrdinaryWoopPhase(phase,snapshot);snapshots.push({phase,...snapshot});return snapshot;
 };
 await ui.waitFor(()=>document.documentElement.dataset.appReady==='true',12000,'Accepted ordinary saved board ready');await capture('seed');
 await ui.act('settings',()=>!!document.getElementById('stHorizon'));await capture('settings-old');
 await ui.act('export-backup',ready,'#modalRoot [data-act="export-backup"]');await capture('prepared-old');
 await ui.act('copy-export',()=>window.__buttonClipboardPending.length===1&&document.getElementById('copyExportButton')?.disabled===true&&document.getElementById('downloadExportButton')?.disabled===false);await capture('pending-old');
 await ui.act('close-modal',()=>!document.getElementById('exportTransferDialog')&&!document.querySelector('#modalRoot .modal'),'#modalRoot [data-act="close-modal"]');await capture('closed');
 await ui.act('settings',()=>!!document.getElementById('stHorizon'));await capture('settings-new');
 await ui.act('export-backup',ready,'#modalRoot [data-act="export-backup"]');await capture('prepared-new');
 await ui.act('copy-export',()=>window.__buttonClipboardPending.length===2&&document.getElementById('copyExportButton')?.disabled===true&&document.getElementById('downloadExportButton')?.disabled===false);await capture('pending-new');
 await ui.page.evaluate(()=>window.__buttonClipboardPending[0].resolve());await ui.page.waitForTimeout(30);await capture('obsolete-settled');
 await ui.page.evaluate(()=>window.__buttonClipboardPending[1].resolve());
 await ui.waitFor(()=>document.getElementById('exportTransferStatus')?.textContent==='Copied the same recovery archive available from Download.'&&document.getElementById('copyExportButton')?.disabled===false&&document.getElementById('downloadExportButton')?.disabled===false,12000,'Only the newer Copy completion truthfully settles its own transfer');await capture('completed-new');await capture('final-source');
 const semantic=verifyObsoleteCopySources(snapshots);
 // Classifications bind the two already verified real UI Copy click/down pairs;
 // the intervening actual close/replacement is outside an immediate repeat loop.
 const attempts=[{phase:3,receiptIndex:3,role:'old-copy'},{phase:7,receiptIndex:8,role:'new-copy'}].map(({phase,receiptIndex,role})=>{const press=snapshots[phase].presses[receiptIndex],click=snapshots[phase].clicks[receiptIndex];assert.equal(press.action,'act:copy-export');assert.equal(press.trusted,true);assert.equal(click.action,'act:copy-export');assert.equal(click.trusted,true);assert.ok(click.at>=press.at);return{receiptId:scenario+':'+role,actionFamily:'act:copy-export',trusted:press.trusted,result:'accepted',receiptAtMs:press.at};});
 ui.recordRepeatOutcome(scenario,attempts,JSON.stringify(semantic));
 });

 await h.scenario('ordinary pending Copy refuses reentry',{clipboardDeferred:true,retainedCopies:3,decorate:board=>{
  board.mode='work';board.chain=['synthetic-kept'];board.candidateId=null;board.listOpen=true;board.protectedBackupIds=['gate-retained-1'];
  board.tasks[63].ratingHistory=[{v:1,id:'ordinary-copy-prior-history',at:1000,seq:1,kind:'edit',after:{mu:25,sigma:8.333333333,likelihood:1/64,eligible:true,fallback:false,topK:1,n:64,samples:250},basis:'ordinary-copy-prior-basis',futureHistory:{opaque:['retain',19]}}];board.tasks[63].ratingHistoryHead='ordinary-copy-prior-history';
 }},async ui=>{
 const hash=value=>createHash('sha256').update(value).digest('hex'),copy=value=>JSON.parse(JSON.stringify(value));
 const scenario='ordinary pending Copy refuses reentry',exactKeys=(value,keys,label)=>assert.deepEqual(Object.keys(value).sort(),keys.slice().sort(),label);
 const taskLiteral={id:'synthetic-kept',title:'Synthetic retained task',url:null,due:null,startsAt:null,evergreen:false,evergreenHours:18,evergreenResetAtDay:true,mu:25,sigma:8.333333333,done:false,createdAt:1,completedAt:null,lastDoneAt:null,ctx:[],futureTask:{opaque:['retain',7]}};
 const expectedSeed={v:1,tasks:[copy(taskLiteral)],contexts:[],chain:['synthetic-kept'],considered:{},cantAt:{},workedAt:{},workLog:[],mode:'work',scanMode:'descending',candidateId:null,passId:'synthetic-existing-pass',passStartedAt:0,interventionActive:false,interventionP:0,snooze:0,decisionsMs:[],presentedAt:0,listOpen:true,ctxOpen:true,histOpen:false,updatedAt:1,syncAccount:null,syncRev:0,syncDirty:true,seenQuickStart:true,settings:{scanMode:'descending',theme:'light',skipOldestFirstDot:false,horizonMin:60,thresholdPct:25,samples:250,cantMin:30,workedHours:8},futureBoard:{opaque:['retain',11]}};
 for(let index=1;index<64;index++)expectedSeed.tasks.push({...copy(taskLiteral),id:'synthetic-populated-'+index,title:'Synthetic retained task '+index,createdAt:1+index,futureTask:{opaque:['retain',index]}});
 expectedSeed.futurePopulated={version:7,opaque:'p'.repeat(1048576)};expectedSeed.protectedBackupIds=['gate-retained-1'];
 const priorHistory={v:1,id:'ordinary-copy-prior-history',at:1000,seq:1,kind:'edit',after:{mu:25,sigma:8.333333333,likelihood:1/64,eligible:true,fallback:false,topK:1,n:64,samples:250},basis:'ordinary-copy-prior-basis',futureHistory:{opaque:['retain',19]}};
 expectedSeed.tasks[63].ratingHistory=[copy(priorHistory)];expectedSeed.tasks[63].ratingHistoryHead=priorHistory.id;
 const seedRaw=JSON.stringify(expectedSeed),seedHash=hash(seedRaw),manualIds=['gate-retained-0','gate-retained-1','gate-retained-2'],manualPayloads=[0,1,2].map(index=>JSON.stringify({...expectedSeed,futureSourceRole:index}));
 const expectedLive=copy(expectedSeed);expectedLive.v=2;expectedLive.tasks=expectedLive.tasks.map(row=>({...row,prerequisiteRevision:0,prerequisiteIds:[],prerequisiteId:null,prerequisiteMirror:null,prerequisiteOps:{}}));
 expectedLive.settings={horizonMin:60,thresholdPct:25,samples:250,cantMin:30,workedHours:16,postponeHours:1,evergreenHours:18,evergreenResetAtDay:true,scanMode:'descending',squaredDefaultVersion:1,listMetric:'rank',excludeNoContext:false,lastTaskWoop:false,skipOldestFirstDot:false,floatingHeader:false,patternedIndicators:false,showPostpone:true,theme:'light',dateFormat:'system',hourlyQuotes:{},scene:{time:null,season:null,location:null}};
 Object.assign(expectedLive,{deletionLog:[],deletedTaskIds:{},clearedHistoryIds:{},restoredTaskIds:{},restoredHistoryIds:{},restoredTaskOps:{},restoredHistoryOps:{},deletedAfterRestoreOps:{},clearedAfterRestoreOps:{},chance:null,addOpen:true});
 const safeValue=(node,value,label)=>{
  if(value===undefined){assert.deepEqual(node,{type:'undefined'},label);return;}
  if(value===null){assert.deepEqual(node,{type:'null'},label);return;}
  if(typeof value!=='object'){assert.ok(['string','number','boolean'].includes(typeof value));if(typeof value==='number')assert.ok(Number.isFinite(value)&&!Object.is(value,-0));assert.deepEqual(node,{type:typeof value,value},label);return;}
  if(Array.isArray(value)){exactKeys(node,['type','items','properties'],label);assert.equal(node.type,'array');assert.deepEqual(node.properties,[]);assert.deepEqual(Object.keys(value),Array.from({length:value.length},(_,i)=>String(i)));assert.equal(node.items.length,value.length);value.forEach((item,index)=>safeValue(node.items[index],item,label+'['+index+']'));return;}
  exactKeys(node,['type','entries'],label);assert.equal(node.type,'object');assert.ok(node.entries.every(row=>Array.isArray(row)&&row.length===2));assert.deepEqual(node.entries.map(row=>row[0]),Object.keys(value));node.entries.forEach(([key,item])=>safeValue(item,value[key],label+'.'+key));
 };
 const rowsExact=(actual,expected,label)=>{assert.equal(actual.length,expected.length,label);assert.equal(new Set(actual.map(row=>row.id)).size,actual.length,label);for(const row of expected){const matches=actual.filter(item=>item.id===row.id);assert.equal(matches.length,1,label);assert.deepEqual(matches[0],row,label);assert.equal(JSON.stringify(matches[0]),JSON.stringify(row),label);}};
 const localKeys=['fvp:chain-scanner:v1','fvp:chain-scanner:protected:v1','fvp:chain-scanner:daily-backups:v1','fvp:chain-scanner:device-store-v2'];
 const pendingLiteral={generationId:'gate-pending',payloadHash:seedHash,baseRev:0,updatedAt:7,account:'gate-owner'};
 const snapshotKeys=['current','currentHash','durable','durableHash','capturedAtMs','backups','opaque','pending','pendingOwner','hold','timeZone','localSources','indexedDB','downloadedArchive','view','presses','clicks'];
 const opaqueLiteral={type:'array',items:[{type:'object',entries:[['key',{type:'string',value:'gate-opaque-exact'}],['raw',{type:'string',value:'opaque exact bytes\u0000retain'}],['futureBytes',{type:'typed-array',constructor:'Uint8Array',buffer:{type:'array-buffer',base64:'ABH/'},byteOffset:0,length:3}],['futureMinusZero',{type:'special-number',value:'-0'}]]}],properties:[]};
 // This independent value encoder serves only the test's literal source map.
 const literalValue=value=>{
  if(value===null)return{type:'null'};
  if(Object.is(value,-0))return{type:'special-number',value:'-0'};
  if(ArrayBuffer.isView(value))return{type:'typed-array',constructor:'Uint8Array',buffer:{type:'array-buffer',base64:Buffer.from(value.buffer).toString('base64')},byteOffset:0,length:value.length};
  if(Array.isArray(value))return{type:'array',items:value.map(literalValue),properties:[]};
  if(typeof value==='object')return{type:'object',entries:Object.entries(value).map(([key,item])=>[key,literalValue(item)])};
  return{type:typeof value,value};
 };
 const allClicks=['act:settings','disclosure','act:export-backup','act:copy-export','act:download-export'],allPresses=[...allClicks.slice(0,4),null,allClicks[4]];
 const verifyCopySources=phases=>{
  const names=['seed','settings','prepared','pending-refused','completed','downloaded','final-source'];assert.deepEqual(phases.map(row=>row.phase),names,'All seven complete pending Copy phases, once in order');
  const[seed,settings,prepared,pending,completed,downloaded,finalSource]=phases;
  const originalRows=manualIds.map((id,index)=>{const row=seed.backups.find(item=>item.id===id);assert.ok(row);exactKeys(row,['id','kind','at','day','payload'],'Complete original manual');assert.equal(row.kind,'manual');assert.equal(row.day,'2026-10-25');assert.ok(Number.isSafeInteger(row.at)&&row.at>0&&row.at<=seed.capturedAtMs);assert.equal(row.payload,manualPayloads[index]);return{id,kind:'manual',at:row.at,day:'2026-10-25',payload:manualPayloads[index]};});
  const iso=(text,lower,upper)=>{assert.equal(typeof text,'string');const at=Date.parse(text);assert.ok(Number.isFinite(at)&&at>=lower&&at<=upper);assert.equal(new Date(at).toISOString(),text);return at;};
  assert.equal(seed.localSources.length,4);assert.deepEqual(seed.localSources.map(row=>row.key),localKeys);
  const legacyDaily=JSON.parse(seed.localSources[2].raw);assert.equal(legacyDaily.length,1,'Boot creates only its first local daily copy');const daily=legacyDaily[0];exactKeys(daily,['id','day','at','kind','payload'],'Complete boot daily source');assert.equal(daily.kind,'daily');assert.equal(daily.payload,JSON.stringify(expectedLive));assert.ok(Number.isSafeInteger(daily.at)&&daily.at>0&&daily.at<=seed.capturedAtMs);assert.match(daily.id,new RegExp('^'+daily.at+'-[a-z0-9]+$'));
  const dayParts=new Intl.DateTimeFormat('en-US',{timeZone:seed.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(daily.at));assert.equal(daily.day,['year','month','day'].map(type=>dayParts.find(row=>row.type===type).value).join('-'));
  const expectedDaily={id:daily.id,day:daily.day,at:daily.at,kind:'daily',payload:JSON.stringify(expectedLive)},expectedLocal=[{key:localKeys[0],status:'present',raw:seedRaw},{key:localKeys[1],status:'absent'},{key:localKeys[2],status:'present',raw:JSON.stringify([expectedDaily])},{key:localKeys[3],status:'present',raw:'1'}];
  const sourceFingerprint=hash(JSON.stringify([{key:localKeys[0],raw:seedRaw}])),headNode=seed.indexedDB.meta.find(row=>row.key.value==='head')?.value;assert.ok(headNode);
  const committedAt=headNode.entries.find(([key])=>key==='committedAt')?.[1]?.value;assert.ok(Number.isSafeInteger(committedAt)&&committedAt>0&&committedAt<=seed.capturedAtMs);
  const originalSnapshots=[{hash:seedHash,payload:seedRaw},...manualPayloads.map(payload=>({hash:hash(payload),payload}))].sort((a,b)=>a.hash<b.hash?-1:1);
  const encodeRow=(key,value)=>({key:literalValue(key),value:literalValue(value)}),expectedStores={
   meta:[encodeRow('head',{hash:seedHash,account:null,sourceFingerprint,schemaVersion:2,committedAt}),encodeRow('pending:gate-owner',pendingLiteral)],
   snapshots:originalSnapshots.map(row=>encodeRow(row.hash,row)),
   backups:originalRows.map(row=>encodeRow(row.id,{id:row.id,kind:'manual',at:row.at,day:'2026-10-25',payloadHash:hash(row.payload)})),
   opaque:[encodeRow('0:gate-opaque-exact',{key:'gate-opaque-exact',raw:'opaque exact bytes\u0000retain',futureBytes:new Uint8Array([0,17,255]),futureMinusZero:-0,order:0})]
  };
  const expectedBoardExport=copy(expectedLive);for(const key of['syncRev','syncAccount','syncIdentity','lastCloudServerAt','syncDirty','protectedBackupIds','decisionBase'])delete expectedBoardExport[key];
  const counts={meta:2,snapshots:4,backups:3,opaque:1},database=seed.view.database;assert.match(database,/^button-[a-f0-9-]{36}$/);
  const verifyArchive=(raw,phase)=>{
   assert.equal(typeof raw,'string');const archive=JSON.parse(raw);exactKeys(archive,['format','formatVersion','capturedAt','currentBoard','manifest','appSources','repairInfo'],'Complete archive object');assert.equal(archive.format,'chain-scanner.recovery-archive');assert.equal(archive.formatVersion,1);iso(archive.capturedAt,settings.capturedAtMs,prepared.capturedAtMs);
   assert.deepEqual(archive.currentBoard,expectedBoardExport,'Every independent canonical current-board export field, including all64 tasks, history, settings and unknowns');
   assert.deepEqual(archive.appSources,{localStorage:expectedLocal,indexedDB:{database,stores:expectedStores}},'Every complete independently specified raw local/IDB source');
   const localManifest=Object.fromEntries(expectedLocal.map(row=>[row.key,{status:row.status==='present'?'included':'absent'}]));
   assert.deepEqual(archive.manifest,{status:'complete',consistency:'single-readonly-idb-transaction-and-unchanged-live-sources',sources:{currentBoard:{status:'included',format:'existing-board-json'},localStorage:localManifest,indexedDB:{database,schemaVersion:2,stores:Object.fromEntries(Object.entries(counts).map(([key,rowCount])=>[key,{status:'included',rowCount}]))}},failures:[]},'The complete archive manifest agrees with all independent full sources');
   exactKeys(archive.repairInfo,['version','debugLog'],'Complete retained metadata-only repair information');assert.equal(archive.repairInfo.version,1);const log=archive.repairInfo.debugLog;exactKeys(log,['schema','version','metadataOnly','boardDataIncluded','capturedAt','localTime','utcOffsetMinutes','app','serviceWorker','restartDiagnostics','save','recoverySources','recentErrors','events','sourceOperations','retention'],'Complete debug metadata is retained, never used as board/source authority');assert.equal(log.schema,'funsidething.support-diagnostics');assert.equal(log.version,1);assert.equal(log.metadataOnly,true);assert.equal(log.boardDataIncluded,false);assert.ok(Buffer.byteLength(JSON.stringify(log))<=24*1024);assert.equal(raw,JSON.stringify(archive,null,2),'The entire original archive JSON is preserved, including all debug metadata');
   assert.ok(phase.capturedAtMs>=Date.parse(archive.capturedAt));return archive;
  };
  const statuses=[null,null,'Ready. Choose Copy or Download.','Copying the prepared archive… Download started. The archive contains the exact prepared export.','Copied the same recovery archive available from Download. Download started. The archive contains the exact prepared export.','Copied the same recovery archive available from Download. Download started. The archive contains the exact prepared export.','Copied the same recovery archive available from Download. Download started. The archive contains the exact prepared export.'];
  const clickCounts=[0,1,3,5,5,5,5],pressCounts=[0,1,3,6,6,6,6];
  for(const[ordinal,phase]of phases.entries()){
   exactKeys(phase.sourceValue,['type','entries'],'Complete lossless Copy source root');assert.equal(phase.sourceValue.type,'object');assert.equal(phase.sourceValueEncoding,'chain-scanner.manual-archive-value/v1');assert.deepEqual(phase.sourceValue.entries.map(row=>row[0]),snapshotKeys);
   assert.deepEqual(Object.keys(phase).filter(key=>!snapshotKeys.includes(key)&&!['sourceValueEncoding','sourceValue','schemaVersion','phase','scenario','sourceIdentity'].includes(key)),[],'No unexamined source field');
   for(const[key,node]of phase.sourceValue.entries){if(key==='opaque')assert.deepEqual(node,opaqueLiteral);else safeValue(node,phase[key],'lossless '+key);assert.ok(Object.hasOwn(phase,key));}
   assert.ok(Number.isSafeInteger(phase.capturedAtMs)&&phase.capturedAtMs>=seed.capturedAtMs);if(ordinal)assert.ok(phase.capturedAtMs>=phases[ordinal-1].capturedAtMs);
   assert.deepEqual(JSON.parse(phase.current),expectedLive,'The complete independently literal hydrated current board remains exact');assert.equal(phase.current,JSON.stringify(expectedLive));assert.equal(phase.currentHash,hash(phase.current));assert.equal(phase.durable,seedRaw,'Every original durable raw byte remains exact');assert.equal(phase.durableHash,seedHash);rowsExact(phase.backups,originalRows,'Copy/Download never creates/replaces/retires any device backup');assert.deepEqual(phase.pending,pendingLiteral);assert.equal(phase.pendingOwner,null);assert.equal(phase.hold,null);assert.equal(phase.timeZone,seed.timeZone);assert.deepEqual(phase.localSources,expectedLocal);assert.deepEqual(phase.indexedDB,expectedStores,'Every raw IDB key/value, metadata, pending/typed/negativezero original stays exact');
   exactKeys(phase.view,['documentId','ready','database','dialogOpen','status','copyDisabled','downloadDisabled','preparedRaw','clipboard','pendingCount'],'Complete actual Copy/Download UI and external clipboard boundary');assert.ok(phase.view.documentId);assert.equal(phase.view.documentId,seed.view.documentId);assert.equal(phase.view.ready,true);assert.equal(phase.view.database,database);assert.equal(phase.view.dialogOpen,ordinal>=2);assert.equal(phase.view.status,statuses[ordinal]);assert.equal(phase.view.copyDisabled,ordinal<2?null:ordinal===3);assert.equal(phase.view.downloadDisabled,ordinal<2?null:false);assert.equal(phase.view.pendingCount,ordinal===3?1:0);assert.equal(phase.downloadedArchive,ordinal>=3?prepared.view.preparedRaw:null,'The actual trusted Download while clipboard is pending saves the original full archive');assert.deepEqual(phase.view.clipboard,ordinal>=3?[prepared.view.preparedRaw]:[]);
   if(ordinal<2)assert.equal(phase.view.preparedRaw,null);else{assert.equal(phase.view.preparedRaw,prepared.view.preparedRaw,'Copy completion and Download retain the exact originally prepared full archive');verifyArchive(phase.view.preparedRaw,phase);}
   assert.equal(phase.clicks.length,clickCounts[ordinal]);assert.equal(phase.presses.length,pressCounts[ordinal]);assert.deepEqual(phase.clicks.map(row=>row.action),allClicks.slice(0,clickCounts[ordinal]));assert.deepEqual(phase.presses.map(row=>row.action),allPresses.slice(0,pressCounts[ordinal]));
   for(const[kind,rows]of[['press',phase.presses],['click',phase.clicks]])rows.forEach((row,index)=>{exactKeys(row,kind==='press'?['at','action','pointerType','trusted','offeredTaskId']:['at','action','trusted','offeredTaskId'],'Complete native '+kind);assert.equal(row.trusted,true);assert.equal(row.offeredTaskId,null);if(kind==='press')assert.equal(row.pointerType,'mouse');assert.ok(Number.isFinite(row.at)&&row.at<=phase.capturedAtMs);if(index)assert.ok(row.at>rows[index-1].at);});
   phase.clicks.forEach((click,index)=>{const press=phase.presses[index===4?5:index];assert.ok(click.at>=press.at);assert.equal(click.action,press.action);});
  }
  for(const phase of phases)assert.deepEqual(phase.current,seed.current);
  return{phases:names,copy:{attempted:2,accepted:1,refused:1,disappeared:0,clipboardOperations:1},archive:{sha256:hash(prepared.view.preparedRaw),bytes:Buffer.byteLength(prepared.view.preparedRaw),complete:true,downloadMatches:true,downloadedWhileCopyPending:true},source:{currentHash:seed.currentHash,durableHash:seedHash,manualIds,stores:counts,localKeys,unchanged:true}};
 };
 const snapshots=[];
 const capture=async(phase,downloadedArchive=null)=>{
  const snapshot=await ui.page.evaluate(async downloadedArchive=>{
   const head=await ScannerDeviceStore.readHead(),current=JSON.stringify(state),sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
   const snapshot={current,currentHash:await sha256(current),durable:head.payload,durableHash:head.hash,capturedAtMs:Date.now(),backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),pending:await ScannerDeviceStore.getPendingUpload('gate-owner'),pendingOwner:await ScannerDeviceStore.getPendingUpload('owner'),hold:await ScannerDeviceStore.getRecoveryCloudHold(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,localSources:readManualArchiveLocalSources(),indexedDB:encodeManualArchiveSnapshot(await ScannerDeviceStore.readRawExportSnapshot()).stores,downloadedArchive,
    view:{documentId:window.__installedFixture.documentId,ready:document.documentElement.dataset.appReady==='true',database:window.CHAIN_STORAGE_DB_NAME,dialogOpen:!!document.getElementById('exportTransferDialog'),status:document.getElementById('exportTransferStatus')?.textContent??null,copyDisabled:document.getElementById('copyExportButton')?.disabled??null,downloadDisabled:document.getElementById('downloadExportButton')?.disabled??null,preparedRaw:exportTransferPayload,clipboard:structuredClone(window.__buttonClipboard),pendingCount:window.__buttonClipboardPending.length},presses:structuredClone(window.__buttonNativePresses),clicks:structuredClone(window.__buttonNativeClicks)};
   snapshot.capturedAtMs=Date.now();return{...snapshot,sourceValueEncoding:'chain-scanner.manual-archive-value/v1',sourceValue:encodeManualArchiveValue(snapshot,'ordinary pending Copy sourceSnapshot')};
  },downloadedArchive);
  ui.recordOrdinaryWoopPhase(phase,snapshot);snapshots.push({phase,...snapshot});return snapshot;
 };
 await ui.waitFor(()=>document.documentElement.dataset.appReady==='true',12000,'Accepted ordinary saved board ready');await capture('seed');
 await ui.act('settings',()=>!!document.getElementById('stHorizon'));await capture('settings');
 await ui.act('export-backup',ready,'#modalRoot [data-act="export-backup"]');await capture('prepared');
  const attempts=await ui.repeat('act:copy-export',2,()=>window.__buttonClipboardPending.length===1&&document.getElementById('copyExportButton')?.disabled===true&&document.getElementById('downloadExportButton')?.disabled===false,'#modalRoot [data-act="copy-export"]','One Copy starts the deferred clipboard operation; the disabled second native press is refused while Download remains available');
  const downloading=ui.page.waitForEvent('download',{timeout:12000});await ui.act('download-export',()=>document.getElementById('exportTransferStatus')?.textContent==='Copying the prepared archive… Download started. The archive contains the exact prepared export.'&&document.getElementById('copyExportButton')?.disabled===true&&document.getElementById('downloadExportButton')?.disabled===false);
  const download=await downloading;assert.equal(await download.failure(),null,'Independent trusted Download completes before clipboard settlement');const downloadedArchive=fs.readFileSync(await download.path(),'utf8');
  assert.equal(downloadedArchive,await ui.page.evaluate(()=>window.__buttonClipboard[0]),'The actual complete downloaded file bytes equal the still-pending clipboard payload');
  await capture('pending-refused',downloadedArchive);
  await ui.page.evaluate(()=>window.__buttonClipboardPending[0].resolve());
  const settledStatus='Copied the same recovery archive available from Download. Download started. The archive contains the exact prepared export.';
  await ui.waitFor(()=>document.getElementById('exportTransferStatus')?.textContent===settledStatus&&document.getElementById('copyExportButton')?.disabled===false&&document.getElementById('downloadExportButton')?.disabled===false,12000,'Copy truthfully settles independently after Download');await capture('completed',downloadedArchive);
  await capture('downloaded',downloadedArchive);await capture('final-source',downloadedArchive);const semantic=verifyCopySources(snapshots);ui.recordRepeatOutcome(scenario,attempts,JSON.stringify(semantic));
 });

 await runRapidCoreScenarios(h);
 await runSceneScenarios({scenario:async(name,options,execute)=>{
  if(name==='Help FAQ and changelog disclosures toggle and close')return;
  await h.scenario('rapid '+name,options,async ui=>{
   const act=async(action,expect,selector)=>ui.burst(action,expect,{selector,semantics:action==='cycle-theme'?'Ten choices traverse the three appearance values and retain the tenth saved choice':'The first press opens or closes its UI; obscured or absent controls cannot act again',expectedAccepted:action==='cycle-theme'?10:1});
   const click=async(selector,expect,description)=>{
    const action=await ui.page.locator(selector).first().evaluate(el=>el.dataset.act||(['landscapeMotion','scenePreset','sceneTime','locationAction'].map((key,i)=>el.dataset[key]===undefined?null:['motion:','scene-preset:','scene-time:','location:'][i]+el.dataset[key]).find(Boolean))||(el.hasAttribute('data-scene-view')?'scene-view':null));
    assert.ok(action,'Reviewed rapid scene control');
    const one=action.startsWith('motion:')||action.endsWith(':close')||action==='location:reset'||action==='scene-view';
    return ui.burst(action,expect,{selector,semantics:description+'; '+(one?'first press closes or replaces this control; later attempts cannot activate it':'all available repeated choices retain the same explicit saved value'),expectedAccepted:one?1:action==='location:request'?{min:1,max:10}:10});
   };
   await execute({...ui,act,click});
  });
 }});
 await h.scenario('rapid all Help and changelog disclosures',{},async ui=>{
  await ui.burst('help',()=>!!document.querySelector('#modalRoot .help'),{semantics:'The first press opens Help and the resulting modal obscures later Help presses',expectedAccepted:1});
  const count=await ui.page.locator('#modalRoot .help summary').count();assert.ok(count>=3,'Actual mounted Help disclosures');
  for(let i=0;i<count;i++){
   const selector=await ui.page.locator('#modalRoot .help summary').nth(i).evaluate(summary=>{const parts=[];for(let el=summary;el&&el.parentElement;el=el.parentElement){if(el.id){parts.unshift('#'+CSS.escape(el.id));break;}const peers=[...el.parentElement.children].filter(peer=>peer.tagName===el.tagName);parts.unshift(el.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(el)+1)+')');}return parts.join(' > ');});
   await ui.expose(selector);const before=await ui.page.locator(selector).evaluate(el=>el.parentElement.open);
   await ui.burst('disclosure',new Function('return document.querySelectorAll("#modalRoot .help summary")['+i+']?.parentElement.open==='+String(before)),{selector,semantics:'Ten trusted summary presses toggle the same disclosure an even number of times',expectedAccepted:10});
  }
  await ui.burst('close-modal',()=>!document.querySelector('#modalRoot .modal'),{selector:'#modalRoot [data-act="close-modal"]',semantics:'The first Close removes its dialog; later attempts cannot close another control',expectedAccepted:1});
 });
 await runCloudScenarios({scenario:async(name,options,execute)=>{
  if(name==='cloud sync signs out and rejects signed-out authentication safely')return;
  await h.scenario('rapid '+name,options,async ui=>{
   const act=(action,expect,selector)=>ui.burst(action,expect,{selector,semantics:'Repeated '+action+' preserves the reviewed source, choice, and protected failure outcome',expectedAccepted:action==='choose-cloud-recovery-source'?10:{min:1,max:10}});
   const expectReload=action=>ui.burst(action,()=>document.documentElement.dataset.appReady==='true',{selector:'#modalRoot [data-act="'+action+'"]',semantics:'The first Reload opens one new usable document; its old dialog cannot reload again',expectedAccepted:1,reload:true});
   await execute({...ui,act,expectReload});
  });
 }});

 await h.scenario('rapid prepared Export Copy and Download retain exact sources',{retainedCopies:3},async ui=>{
  const original=await rawIdentity(ui);
  await ui.burst('settings',()=>!!document.getElementById('stHorizon'),{semantics:'The first Settings press opens its dialog and obscures further presses',expectedAccepted:1});
  await ui.burst('export-backup',ready,{semantics:'The first export prepares one protected snapshot; busy or obscured presses cannot start another',expectedAccepted:1});
  await ui.burst('copy-export',()=>window.__buttonClipboard.length===10&&/copied/i.test(document.getElementById('exportTransferStatus').textContent),{semantics:'Ten available Copy presses write the same immutable prepared archive exactly ten times',expectedAccepted:10});
  const copies=await ui.page.evaluate(()=>window.__buttonClipboard);assert.equal(copies.length,10);assert.ok(copies.every(raw=>raw===copies[0]));assertArchive(copies[0],{copies:3});
  const downloads=[];ui.page.on('download',download=>downloads.push(download));
  await ui.burst('download-export',()=>/download.*started/i.test(document.getElementById('exportTransferStatus').textContent),{semantics:'Ten available Download presses each start a native download of the same prepared archive',expectedAccepted:10});
  for(let n=0;n<100&&downloads.length<10;n++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(downloads.length,10,'Ten real browser download events');
  for(const download of downloads){assert.equal(await download.failure(),null);assert.equal(fs.readFileSync(await download.path(),'utf8'),copies[0]);}
  assert.equal(await rawIdentity(ui),original,'Ten transfer presses preserve every exact original source');
 });
 await h.scenario('rapid pending Copy disables reentry without losing the archive',{clipboardDeferred:true},async ui=>{
  const original=await rawIdentity(ui);await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.act('export-backup',ready);
  await ui.burst('copy-export',()=>window.__buttonClipboardPending.length===1&&document.querySelector('[data-act="copy-export"]').disabled&&document.querySelector('[data-act="download-export"]').disabled,{semantics:'The first Copy starts its clipboard promise; the disabled control refuses nine later presses',expectedAccepted:1});
  assert.equal(await ui.page.evaluate(()=>window.__buttonClipboard.length),1,'Only one clipboard operation starts');
  await ui.page.evaluate(()=>window.__buttonClipboardPending[0].resolve());
  await ui.waitFor(()=>!document.querySelector('[data-act="copy-export"]').disabled&&/copied/i.test(document.getElementById('exportTransferStatus').textContent));
  assert.equal(await rawIdentity(ui),original,'Busy Copy reentry retains exact original sources');
 });
 await runTransferScenarios({scenario:async(name,options,execute)=>{
  if(!name.startsWith('guarded '))return;
  await h.scenario('rapid '+name,options,async ui=>{
   const act=(action,expect,selector)=>ui.burst(action,expect,{selector,semantics:'Repeated '+action+' retains guarded file/paste preview, exact drafts and one confirmed replacement',expectedAccepted:{min:1,max:10}});
   await execute({...ui,act});
  });
 }});
 await h.scenario('rapid clipboard completion belongs to its prepared transfer',{clipboardDeferred:true},async ui=>{
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.act('export-backup',ready);
  await ui.act('copy-export',()=>window.__buttonClipboardPending.length===1&&document.querySelector('[data-act="copy-export"]').disabled);
  await ui.act('close-modal',()=>!document.getElementById('exportTransferDialog'));
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.act('export-backup',ready);
  await ui.act('copy-export',()=>window.__buttonClipboardPending.length===2&&document.querySelector('[data-act="copy-export"]').disabled);
  const before=await ui.page.locator('#exportTransferStatus').textContent();
  await ui.page.evaluate(()=>window.__buttonClipboardPending[0].resolve());
  await ui.page.waitForTimeout(30);
  assert.equal(await ui.page.locator('[data-act="copy-export"]').isDisabled(),true,'obsolete clipboard completion must keep the new transfer busy');
  assert.equal(await ui.page.locator('[data-act="download-export"]').isDisabled(),true,'obsolete clipboard completion cannot unlock the new Download');
  assert.equal(await ui.page.locator('#exportTransferStatus').textContent(),before,'obsolete clipboard completion cannot replace the new status');
  await ui.page.evaluate(()=>window.__buttonClipboardPending[1].resolve());
  await ui.waitFor(()=>!document.querySelector('[data-act="copy-export"]').disabled&&/copied/i.test(document.getElementById('exportTransferStatus').textContent));
 });
}
