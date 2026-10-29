import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buttonFixture as fixture} from './button-safety-fixture.mjs';

const MANIFEST = 'users/owner';

function sameBoardRemote(profile='workload-diagnostic'){
  return new Map([[MANIFEST,{payload:JSON.stringify(fixture('reconcile-held',{profile})),rev:4,updatedAt:1}]]);
}

async function damagedCurrentRemote(){
  await import('../device-store-v2.js');
  const encode=globalThis.ChainStorageV2?.encodeSnapshot;
  assert.equal(typeof encode,'function','The installed device-store codec builds an actual cloud generation fixture');
  const encoded=await encode(JSON.stringify(fixture('reconcile-held')));
  const {chunks,...header}=encoded;
  const current='gate-held-current',previous='gate-valid-previous';
  const remote=new Map([
    [MANIFEST,{schemaVersion:2,rev:4,activeGeneration:current,previousGeneration:previous}],
    [MANIFEST+'/generations/'+current,{...header,hash:'f'.repeat(64),state:'published',baseRev:3}],
    [MANIFEST+'/generations/'+previous,{...header,state:'published',baseRev:2}],
    ...chunks.map(chunk=>[MANIFEST+'/generations/'+previous+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk])
  ]);
  return remote;
}

async function replacePreviousWithCurrentBoard(ui,remote){
  const manifest=remote.get(MANIFEST),generation=manifest?.previousGeneration;
  assert.equal(typeof generation,'string','The damaged manifest names an explicit previous source');
  const payload=await ui.page.evaluate(()=>JSON.stringify(state));
  assert.equal(typeof payload,'string','The accepted current device board is readable before review');
  const encoded=await globalThis.ChainStorageV2.encodeSnapshot(payload),{chunks,...header}=encoded;
  const prefix=MANIFEST+'/generations/'+generation;
  for(const key of [...remote.keys()])if(key.startsWith(prefix+'/chunks/'))remote.delete(key);
  remote.set(prefix,{...header,state:'published',baseRev:2});
  for(const chunk of chunks)remote.set(prefix+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk);
}

function assertFixtureBoard(board,label){
  const original=fixture('reconcile-held');
  assert.ok(board&&Array.isArray(board.tasks),label+' keeps a readable durable board');
  assert.deepEqual(board.tasks.map(({id,futureTask})=>({id,futureTask})),
    original.tasks.map(({id,futureTask})=>({id,futureTask})),label+' retains each exact task extension');
  assert.deepEqual(board.futureBoard,original.futureBoard,label+' retains the exact unknown board value');
  assert.deepEqual(board.futurePopulated,original.futurePopulated,label+' retains the exact large unknown board value');
}

async function assertCurrentAndStoredFixtureBoard(ui,label){
  const boards=await ui.page.evaluate(async()=>{
    const head=await window.ScannerDeviceStore.readHead();
    return {current:JSON.parse(JSON.stringify(state)),stored:head?.payload?JSON.parse(head.payload):null};
  });
  assertFixtureBoard(boards.current,label+' active board');
  assertFixtureBoard(boards.stored,label+' saved board');
}

async function assertPublished(remote,label){
  const root=remote.get(MANIFEST);
  assert.equal(root?.schemaVersion,2,label+' publishes a generation manifest');
  assert.ok(Number.isSafeInteger(root?.rev)&&root.rev>4,label+' advances the confirmed cloud revision');
  assert.equal(typeof root.activeGeneration,'string',label+' selects its published generation');
  const header=remote.get(MANIFEST+'/generations/'+root.activeGeneration);
  assert.equal(header?.state,'published',label+' leaves the selected generation published');
  assert.ok(remote.has(MANIFEST+'/generations/'+root.activeGeneration+'/chunks/00000000'),label+' publishes generation bytes');
  const prefix=MANIFEST+'/generations/'+root.activeGeneration+'/chunks/';
  const chunks=[...remote].filter(([key])=>key.startsWith(prefix)).map(([,chunk])=>chunk).sort((a,b)=>a.index-b.index);
  const board=JSON.parse(await globalThis.ChainStorageV2.decodeSnapshot(header,chunks));
  assertFixtureBoard(board,label+' cloud copy');
}

async function readRemoteBoard(remote,label){
  await import('../device-store-v2.js');
  const root=remote.get(MANIFEST);
  if(typeof root?.payload==='string')return JSON.parse(root.payload);
  assert.equal(root?.schemaVersion,2,label+' has a supported generation manifest');
  const generation=root.activeGeneration,header=remote.get(MANIFEST+'/generations/'+generation);
  assert.equal(header?.state,'published',label+' selects a published generation');
  const prefix=MANIFEST+'/generations/'+generation+'/chunks/';
  const chunks=[...remote].filter(([key])=>key.startsWith(prefix)).map(([,chunk])=>chunk).sort((a,b)=>a.index-b.index);
  return JSON.parse(await globalThis.ChainStorageV2.decodeSnapshot(header,chunks));
}

async function confirmedAction(ui,action,expected,selector){
 const revision=await ui.page.evaluate(()=>state.syncRev);
 const predicate=new Function('return ('+expected.toString().replace('state.syncRev>4','state.syncRev>'+revision)+')')();
 await ui.act(action,predicate,selector);
}
export async function runCloudScenarios(h){
  const ordinaryCloudOptions={authMode:'reconcile-held',remote:await damagedCurrentRemote(),retainedCopies:3,decorate:board=>{board.protectedBackupIds=['gate-retained-1'];}};
  await h.scenario('ordinary repeated cloud source choice',ordinaryCloudOptions,async ui=>{
 const hash=value=>createHash('sha256').update(value).digest('hex'),copy=value=>JSON.parse(JSON.stringify(value));
 const scenario='ordinary repeated cloud source choice',previousId='generation:gate-valid-previous';
 const taskLiteral={id:'synthetic-kept',title:'Synthetic retained task',url:null,due:null,startsAt:null,evergreen:false,evergreenHours:18,evergreenResetAtDay:true,mu:25,sigma:8.333333333,done:false,createdAt:1,completedAt:null,lastDoneAt:null,ctx:[],futureTask:{opaque:['retain',7]}};
 const expectedSeed={v:1,tasks:[copy(taskLiteral)],contexts:[],chain:[],considered:{},cantAt:{},workedAt:{},workLog:[],mode:'scan',scanMode:'descending',candidateId:null,passId:'synthetic-existing-pass',passStartedAt:0,interventionActive:false,interventionP:0,snooze:0,decisionsMs:[],presentedAt:0,listOpen:false,ctxOpen:true,histOpen:false,updatedAt:1,syncAccount:'fixture@example.invalid',syncRev:4,syncDirty:true,seenQuickStart:true,settings:{scanMode:'descending',theme:'light',skipOldestFirstDot:false,horizonMin:60,thresholdPct:25,samples:250,cantMin:30,workedHours:8},futureBoard:{opaque:['retain',11]}};
 for(let index=1;index<64;index++)expectedSeed.tasks.push({...copy(taskLiteral),id:'synthetic-populated-'+index,title:'Synthetic retained task '+index,createdAt:1+index,futureTask:{opaque:['retain',index]}});
 expectedSeed.futurePopulated={version:7,opaque:'p'.repeat(1048576)};expectedSeed.protectedBackupIds=['gate-retained-1'];
 const seedHash=hash(JSON.stringify(expectedSeed)),originalIds=['gate-retained-0','gate-retained-1','gate-retained-2'],originalPayloads=[0,1,2].map(index=>JSON.stringify({...expectedSeed,futureSourceRole:index}));
 const exactKeys=(value,keys,label)=>assert.deepEqual(Object.keys(value).sort(),keys.slice().sort(),label+' complete keys');
 const safeEncode=value=>{
  if(value===undefined)return{type:'undefined'};if(value===null)return{type:'null'};
  if(typeof value!=='object'){assert.ok(['string','number','boolean'].includes(typeof value));if(typeof value==='number')assert.ok(Number.isFinite(value)&&!Object.is(value,-0));return{type:typeof value,value};}
  if(Array.isArray(value)){assert.deepEqual(Object.keys(value),Array.from({length:value.length},(_,index)=>String(index)));return{type:'array',items:value.map(safeEncode),properties:[]};}
  return{type:'object',entries:Object.keys(value).map(key=>[key,safeEncode(value[key])])};
 };
 const opaqueOriginal={type:'object',entries:[['key',{type:'string',value:'gate-opaque-exact'}],['raw',{type:'string',value:'opaque exact bytes\u0000retain'}],['futureBytes',{type:'typed-array',constructor:'Uint8Array',buffer:{type:'array-buffer',base64:'ABH/'},byteOffset:0,length:3}],['futureMinusZero',{type:'special-number',value:'-0'}]]};
 const exactRows=(actual,expected,label)=>{assert.equal(actual.length,expected.length,label+' complete row count');assert.equal(new Set(actual.map(row=>row.id)).size,actual.length,label+' unique IDs');for(const row of expected){const matches=actual.filter(value=>value.id===row.id);assert.equal(matches.length,1);assert.deepEqual(matches[0],row);assert.equal(JSON.stringify(matches[0]),JSON.stringify(row));}};
 const verifyCloudChoiceSources=phases=>{
  const names=['seed','menu','read-refused','reviewed','selected','repeated','keyboard','alternate','write-refused','final-source'];assert.deepEqual(phases.map(row=>row.phase),names);
  const [seed,menu,readRefused,reviewed,selected,repeated,keyboard,alternate,writeRefused,finalSource]=phases;
  const snapshotKeys=['current','currentHash','durable','durableHash','headRecord','backups','opaque','pendingGate','pendingOwner','hold','backend','preview','remote','capturedAtMs','lastInputAtMs','timeZone','view'];
  const pendingGate={generationId:'gate-pending',payloadHash:seedHash,baseRev:0,updatedAt:7,account:'gate-owner'};
  const originalRows=originalIds.map((id,index)=>{const rows=seed.backups.filter(row=>row.id===id);assert.equal(rows.length,1);const row=rows[0];exactKeys(row,['id','kind','at','day','payload'],'Complete manual original');assert.equal(row.kind,'manual');assert.equal(row.day,'2026-10-25');assert.equal(row.payload,originalPayloads[index]);assert.ok(Number.isSafeInteger(row.at)&&row.at>0&&row.at<=seed.capturedAtMs);return copy(row);});exactRows(seed.backups,originalRows,'Seed originals');
  assert.equal(seed.pendingOwner,null);assert.equal(seed.hold,null);assert.equal(JSON.parse(seed.current).decisionBaseline,undefined);assert.equal(JSON.parse(seed.current).decisionEvents,undefined);
  const root=seed.remote.filter(([key])=>key==='users/owner');assert.equal(root.length,1);assert.deepEqual(root[0][1],{schemaVersion:2,rev:4,activeGeneration:'gate-held-current',previousGeneration:'gate-valid-previous'});
  const headers=seed.remote.filter(([key])=>/^users\/owner\/generations\/[^/]+$/.test(key));assert.equal(headers.length,2);assert.equal(headers.find(([key])=>key.endsWith('/gate-held-current'))[1].hash,'f'.repeat(64));
  for(const phase of phases){
   assert.equal(phase.sourceValueEncoding,'chain-scanner.manual-archive-value/v1');exactKeys(phase.sourceValue,['type','entries'],'Lossless complete source');assert.equal(phase.sourceValue.type,'object');assert.deepEqual(phase.sourceValue.entries.map(row=>row[0]),snapshotKeys);
   assert.deepEqual(Object.keys(phase).filter(key=>!snapshotKeys.includes(key)&&!['schemaVersion','phase','scenario','sourceIdentity','sourceValueEncoding','sourceValue'].includes(key)),[]);
   for(const [key,node]of phase.sourceValue.entries){if(key==='opaque')continue;assert.deepEqual(node,safeEncode(phase[key]),'Every actual source field/kind/key is lossless: '+key);if(!Object.hasOwn(phase,key))assert.ok(key==='lastInputAtMs'&&node.type==='undefined');}
   assert.equal(phase.currentHash,hash(phase.current));assert.equal(phase.durableHash,hash(phase.durable));assert.equal(phase.headRecord.payload,phase.durable);assert.equal(phase.headRecord.hash,phase.durableHash);assert.ok(Number.isSafeInteger(phase.capturedAtMs));assert.equal(typeof phase.timeZone,'string');
   assert.equal(phase.current,seed.current,'No local adoption or unrelated current-field change');assert.equal(phase.durable,seed.durable,'No durable adoption or unrelated saved-field change');assert.deepEqual(phase.headRecord,seed.headRecord,'Exact head authority retained');assert.deepEqual(phase.hold,seed.hold);assert.deepEqual(phase.pendingGate,pendingGate);assert.deepEqual(phase.pendingOwner,null);assert.deepEqual(phase.remote,seed.remote,'Every original remote manifest/header/chunk byte remains exact');
   assert.equal(phase.backend.user,'fixture@example.invalid');assert.equal(phase.backend.identity,'owner');assert.equal(phase.backend.epoch,seed.backend.epoch);assert.ok(Number.isSafeInteger(phase.backend.epoch)&&phase.backend.epoch>=0);
   for(const side of ['current','durable']){const board=JSON.parse(phase[side]);assert.equal(board.tasks.length,64);assert.equal(board.tasks.filter(row=>!row.done).length,64);assert.deepEqual(board.tasks.map(row=>row.id),expectedSeed.tasks.map(row=>row.id));assert.deepEqual(board.futureBoard,expectedSeed.futureBoard);assert.deepEqual(board.futurePopulated,expectedSeed.futurePopulated);board.tasks.forEach((row,index)=>assert.deepEqual(row.futureTask,{opaque:['retain',index===0?7:index]}));assert.deepEqual(board.protectedBackupIds,['gate-retained-1']);assert.equal(board.syncAccount,'fixture@example.invalid');assert.equal(board.syncRev,4);}
  }
  assert.equal(menu.view.title,'Cloud sync needs attention');assert.equal(readRefused.view.title,'Review cloud recovery sources');assert.match(readRefused.view.text,/cloud reads are still unavailable/i);assert.deepEqual(readRefused.view.choices,[]);assert.equal(readRefused.view.apply,null);
  assert.equal(reviewed.view.title,'Review cloud recovery sources');assert.deepEqual(reviewed.view.choices.map(row=>({value:row.value,selected:row.selected,disabled:row.disabled})),[{value:'device',selected:'false',disabled:false},{value:'generation:gate-held-current',selected:'false',disabled:true},{value:previousId,selected:'false',disabled:false}]);assert.equal(reviewed.view.apply.disabled,true);
  for(const phase of [selected,repeated,keyboard]){assert.equal(phase.preview.choice,previousId);assert.equal(phase.view.choices.find(row=>row.value===previousId).selected,'true');assert.equal(phase.view.apply.disabled,false);}
  const mounted=phase=>{const c=phase.view.continuity;exactKeys(c,['sameModal','sameButton','buttonConnected','sameSections','sameFacts','sections','facts','scrollTop','anchorScrollTop','focused'],'Complete mounted review continuity');assert.equal(c.sameModal,true);assert.equal(c.sameButton,true);assert.equal(c.buttonConnected,true);assert.ok(c.sections>=3&&c.facts>=2);assert.deepEqual(c.sameSections,Array(c.sections).fill(true));assert.deepEqual(c.sameFacts,Array(c.facts).fill(true));assert.ok(c.anchorScrollTop>0,'A real nonzero scroll anchor is tested');assert.equal(c.scrollTop,c.anchorScrollTop);};mounted(selected);mounted(repeated);mounted(keyboard);assert.equal(keyboard.view.continuity.focused,true);assert.deepEqual(keyboard.view.keyboard,{trusted:true,detail:0,value:previousId});assert.equal(repeated.view.html,selected.view.html);assert.equal(keyboard.view.html,selected.view.html);
  assert.equal(alternate.preview.choice,'device');assert.equal(alternate.view.choices.find(row=>row.value==='device').selected,'true');assert.equal(alternate.view.choices.find(row=>row.value===previousId).selected,'false');assert.notEqual(alternate.view.html,keyboard.view.html);assert.equal(alternate.view.continuity.sameModal,false);
  const pre=alternate,failed=writeRefused;assert.equal(failed.view.title,'Review cloud recovery sources');assert.match(failed.view.text,/cloud confirmation is unavailable/i);assert.equal(failed.preview.choice,null);assert.equal(failed.view.apply.disabled,true);
  for(const phase of phases.slice(0,8)){
   exactRows(phase.backups,originalRows,'No-save selection/refusal originals');assert.deepEqual(phase.sourceValue.entries.find(row=>row[0]==='opaque')[1],{type:'array',items:[opaqueOriginal],properties:[]});
  }
  assert.equal(pre.preview.account,'fixture@example.invalid');assert.equal(pre.preview.rev,4);assert.equal(pre.preview.local,pre.current);assert.equal(pre.preview.head,pre.durable);assert.deepEqual(pre.preview.headRecord,pre.headRecord);assert.deepEqual(pre.preview.evidence,{identity:'owner',epoch:seed.backend.epoch,pending:null});assert.deepEqual(pre.preview.holds,[]);
  const next=copy(JSON.parse(pre.current));Object.assign(next,{deletedTaskIds:next.deletedTaskIds||{},restoredTaskIds:next.restoredTaskIds||{},restoredTaskOps:next.restoredTaskOps||{},deletedAfterRestoreOps:next.deletedAfterRestoreOps||{},deletionLog:next.deletionLog||[],clearedHistoryIds:next.clearedHistoryIds||{},restoredHistoryIds:next.restoredHistoryIds||{},restoredHistoryOps:next.restoredHistoryOps||{},clearedAfterRestoreOps:next.clearedAfterRestoreOps||{}});
  const extra=failed.backups.filter(row=>!originalIds.includes(row.id)),copies=[...new Set([pre.current,pre.durable,...pre.preview.browser.map(row=>row.raw)].filter(row=>typeof row==='string'))];assert.equal(extra.length,copies.length+1);const holds=extra.filter(row=>row.kind==='decision-recovery-choice');assert.equal(holds.length,1);const hold=holds[0],prepared=JSON.parse(hold.payload),choice=prepared.recoveryChoice;exactKeys(choice,['kind','identity','account','revision','choiceId','source','deviceSource','cloudSource','pending'],'Complete prepared choice');assert.match(choice.choiceId,/^t.+/);
  assert.ok(Number.isSafeInteger(prepared.updatedAt)&&prepared.updatedAt>=Math.floor(failed.lastInputAtMs)&&prepared.updatedAt<=failed.capturedAtMs);next.syncAccount='fixture@example.invalid';next.syncIdentity='owner';next.syncRev=4;next.syncDirty=true;next.updatedAt=prepared.updatedAt;
  const expectedChoice={kind:'cloud-source',identity:'owner',account:'fixture@example.invalid',revision:4,choiceId:choice.choiceId,source:'device',deviceSource:pre.current,cloudSource:pre.preview.source,pending:null};assert.deepEqual(prepared,{...next,recoveryChoice:expectedChoice});assert.equal(hold.payload,JSON.stringify({...next,recoveryChoice:expectedChoice}),'Every complete prepared field is independently expected');
  const rowCopies=extra.filter(row=>row.kind==='cloud-source-recovery-device');assert.equal(rowCopies.length,copies.length);assert.deepEqual(rowCopies.map(row=>row.payload).sort(),copies.slice().sort());const ids=new Set(originalIds),nonces=new Set();
  for(const row of extra){exactKeys(row,['id','day','at','kind','payload'],'Complete added protection row');assert.ok(['cloud-source-recovery-device','decision-recovery-choice'].includes(row.kind));const match=row.id.match(/^(cloud-source-recovery-device|decision-recovery-choice):([0-9]+):(t.+)$/);assert.ok(match&&match[1]===row.kind);assert.ok(Number.isSafeInteger(row.at)&&row.at>=Math.floor(failed.lastInputAtMs)&&row.at<=failed.capturedAtMs);assert.ok(Number(match[2])>=row.at&&Number(match[2])<=failed.capturedAtMs);assert.equal(row.day,new Intl.DateTimeFormat('en-CA',{timeZone:failed.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(row.at));assert.ok(!ids.has(row.id)&&!nonces.has(match[3]));ids.add(row.id);nonces.add(match[3]);}
  const expectedRaw=JSON.stringify({format:'chain-scanner.cloud-recovery-source',version:1,identity:'owner',manifest:pre.preview.source.manifest,generations:pre.preview.source.generations,deviceSource:pre.current,deviceHead:pre.durable,deviceHeadRecord:copy(pre.headRecord),browserSources:pre.preview.browser,pending:null,deviceRecoveryHold:copy(pre.hold),preparedChoices:[],deviceAuthorityExact:safeEncode({headRecord:pre.headRecord,hold:pre.hold})});
  const archive={key:'cloud-generation-recovery:owner:4:gate-held-current:'+hash(expectedRaw),raw:expectedRaw};
  for(const phase of [failed,finalSource]){exactRows(phase.backups,[...originalRows,...extra],'Complete refused-publication lifecycle');assert.deepEqual(phase.sourceValue.entries.find(row=>row[0]==='opaque')[1],{type:'array',items:[opaqueOriginal,safeEncode(archive)],properties:[]});assert.equal(phase.opaque.length,2);assert.deepEqual(phase.opaque[1],archive);}
  assert.deepEqual(finalSource.backups,failed.backups);assert.equal(finalSource.current,failed.current);assert.equal(finalSource.durable,failed.durable);assert.deepEqual(finalSource.remote,failed.remote);
  assert.ok(phases.every(row=>row.view.documentId===seed.view.documentId),'No hidden navigation/adoption');
  return{selectedSource:previousId,alternateSource:'device',completeBoardsPreserved:true,exactRemoteSourcesPreserved:true,originalSourcesPreserved:true,typedOpaquePreserved:true,pendingPreserved:true,noAdoptionBeforeApply:true,readRefusalVerified:true,writeRefusalVerified:true,completeProtectionCopyLifecycleVerified:true,mountedFactsFocusScrollRetained:true,phases:names,currentHash:seed.currentHash,durableHash:seed.durableHash};
 };
 const verifyCloudChoiceFocus=(phases,presses,clicks,attempts)=>{
  const names=['seed','menu','read-refused','reviewed','selected','repeated','keyboard','alternate','write-refused','final-source'];assert.deepEqual(phases.map(row=>row.phase),names);
  assert.equal(presses.length,8);assert.equal(clicks.length,9);assert.equal(attempts.length,2);
  const nodes=new Map(),node=value=>{
   if(value===null)return null;exactKeys(value,['nodeId','tag','domId','action','value','connected'],'Complete live node descriptor');assert.ok(Number.isSafeInteger(value.nodeId)&&value.nodeId>0);assert.equal(typeof value.tag,'string');assert.ok(value.tag.length>0);for(const key of ['domId','action','value'])assert.ok(value[key]===null||typeof value[key]==='string');assert.equal(typeof value.connected,'boolean');
   const identity={tag:value.tag,domId:value.domId,action:value.action,value:value.value};if(nodes.has(value.nodeId))assert.deepEqual(identity,nodes.get(value.nodeId),'An observed node ID is never reused for another live node');else nodes.set(value.nodeId,identity);return value.nodeId;
  };
  const mount=value=>{
   exactKeys(value,['button','modal','sections','facts','sameModal','sameButton','sameSections','sameFacts','scrollTop','anchorScrollTop'],'Complete event-boundary mount facts');node(value.button);node(value.modal);value.sections.forEach(node);value.facts.forEach(node);assert.equal(typeof value.sameModal,'boolean');assert.equal(typeof value.sameButton,'boolean');assert.equal(value.sameSections.length,value.sections.length);assert.equal(value.sameFacts.length,value.facts.length);for(const same of [...value.sameSections,...value.sameFacts])assert.equal(typeof same,'boolean');assert.ok(value.scrollTop===null||Number.isFinite(value.scrollTop));assert.ok(Number.isFinite(value.anchorScrollTop));
  };
  let priorEvents=[],priorPreparations=[];
  for(const [phaseIndex,phase]of phases.entries()){
   const value=phase.view.focusEvidence;assert.ok(value&&value.schemaVersion===1,'Complete cloud-choice focus evidence required in every lossless phase');exactKeys(value,['schemaVersion','installed','anchor','events','preparations'],'Finite focus evidence schema');assert.equal(value.installed,phaseIndex>=4);assert.ok(Array.isArray(value.events));assert.ok(Array.isArray(value.preparations));assert.deepEqual(value.events.slice(0,priorEvents.length),priorEvents,'Every prior raw event remains in chronological phase evidence');assert.deepEqual(value.preparations.slice(0,priorPreparations.length),priorPreparations,'Every outside-dispatch preparation remains retained');
   if(!value.installed){assert.equal(value.anchor,null);assert.deepEqual(value.events,[]);assert.deepEqual(value.preparations,[]);}else mount(value.anchor);
   for(const [index,event]of value.events.entries()){
    exactKeys(event,['order','type','stage','atMs','timeStamp','eventPhase','trusted','detail','key','pointerType','action','value','target','relatedTarget','active','activeIsButton','mount','dispatchId','receivedFocus','sameReceivedFocus','receipts'],'Complete raw native focus event');assert.equal(event.order,index+1);assert.ok(['pointerdown','mousedown','blur','focusout','keydown','click'].includes(event.type));assert.ok(['capture','after-app-bubble'].includes(event.stage));assert.equal(event.eventPhase,event.stage==='capture'?1:3);assert.equal(event.trusted,true);assert.ok(Number.isFinite(event.atMs)&&Number.isFinite(event.timeStamp)&&event.timeStamp>=0);if(index)assert.ok(event.atMs>=value.events[index-1].atMs,'Raw observed events are chronological');assert.ok(event.detail===null||Number.isFinite(event.detail));assert.ok(event.key===null||typeof event.key==='string');assert.ok(event.pointerType===null||typeof event.pointerType==='string');assert.equal(event.action,'choose-cloud-recovery-source');assert.equal(event.value,previousId);node(event.target);node(event.relatedTarget);const active=node(event.active);assert.equal(event.activeIsButton,active===event.mount.button.nodeId);mount(event.mount);node(event.receivedFocus);
    if(['click','keydown'].includes(event.type)){assert.ok(Number.isSafeInteger(event.dispatchId)&&event.dispatchId>0);assert.equal(typeof event.sameReceivedFocus,'boolean');}else{assert.equal(event.stage,'capture');assert.equal(event.dispatchId,null);assert.equal(event.receivedFocus,null);assert.equal(event.sameReceivedFocus,null);}
    exactKeys(event.receipts,['presses','clicks','lastPressAtMs','lastClickAtMs'],'Exact existing native receipt boundary');assert.ok(Number.isSafeInteger(event.receipts.presses)&&event.receipts.presses>=0&&event.receipts.presses<=presses.length);assert.ok(Number.isSafeInteger(event.receipts.clicks)&&event.receipts.clicks>=0&&event.receipts.clicks<=clicks.length);assert.equal(event.receipts.lastPressAtMs,event.receipts.presses?presses[event.receipts.presses-1].at:null);assert.equal(event.receipts.lastClickAtMs,event.receipts.clicks?clicks[event.receipts.clicks-1].at:null);
   }
   for(const preparation of value.preparations){exactKeys(preparation,['kind','atMs','eventCount','active','button','sameActiveButton','outsideDispatch'],'Complete explicit outside-dispatch focus preparation');assert.ok(['selected-focus-before-observer','keyboard-focus-outside-dispatch'].includes(preparation.kind));assert.ok(Number.isFinite(preparation.atMs));assert.ok(Number.isSafeInteger(preparation.eventCount)&&preparation.eventCount>=0&&preparation.eventCount<=value.events.length);node(preparation.active);node(preparation.button);assert.equal(preparation.sameActiveButton,true);assert.equal(preparation.active.nodeId,preparation.button.nodeId);assert.equal(preparation.outsideDispatch,true);}
   priorEvents=value.events;priorPreparations=value.preparations;
  }
  const selected=phases[4],repeated=phases[5],keyboard=phases[6],selectedEvidence=selected.view.focusEvidence,repeatedEvidence=repeated.view.focusEvidence,keyboardEvidence=keyboard.view.focusEvidence,buttonId=selectedEvidence.anchor.button.nodeId;
  assert.equal(selected.view.continuity.focused,true,'First repeated pointer begins on the selected retained focused button');assert.deepEqual(selectedEvidence.events,[]);assert.equal(selectedEvidence.preparations.length,1);assert.equal(selectedEvidence.preparations[0].kind,'selected-focus-before-observer');assert.equal(selectedEvidence.preparations[0].eventCount,0);assert.equal(selectedEvidence.preparations[0].button.nodeId,buttonId);assert.deepEqual(repeatedEvidence.preparations,selectedEvidence.preparations);assert.equal(keyboardEvidence.preparations.length,2);const preparation=keyboardEvidence.preparations[1];assert.equal(preparation.kind,'keyboard-focus-outside-dispatch');assert.equal(preparation.eventCount,repeatedEvidence.events.length);assert.equal(preparation.button.nodeId,buttonId);
  const mounted=event=>{const value=event.mount;assert.equal(value.sameModal,true);assert.equal(value.sameButton,true);assert.equal(value.button.nodeId,buttonId);assert.equal(value.button.connected,true);assert.equal(value.modal.nodeId,selectedEvidence.anchor.modal.nodeId);assert.equal(value.modal.connected,true);for(const key of ['sections','facts']){assert.deepEqual(value[key].map(row=>row.nodeId),selectedEvidence.anchor[key].map(row=>row.nodeId));assert.ok(value[key].every(row=>row.connected));}assert.deepEqual(value.sameSections,Array(value.sections.length).fill(true));assert.deepEqual(value.sameFacts,Array(value.facts.length).fill(true));assert.ok(value.anchorScrollTop>0);assert.equal(value.scrollTop,value.anchorScrollTop);};
  const pair=(events,capture)=>{const index=events.indexOf(capture),after=events[index+1];assert.ok(after,'A complete after-application bubble observation is required');assert.equal(capture.stage,'capture');assert.equal(after.type,capture.type);assert.equal(after.stage,'after-app-bubble');assert.equal(after.dispatchId,capture.dispatchId);assert.equal(after.timeStamp,capture.timeStamp);assert.equal(after.detail,capture.detail);assert.deepEqual(after.target,capture.target);assert.deepEqual(after.receipts,capture.receipts);assert.equal(capture.sameReceivedFocus,true);assert.equal(after.sameReceivedFocus,true,'Application handler must preserve the exact live focus reference it receives');assert.equal(node(capture.receivedFocus),node(capture.active));assert.equal(node(after.receivedFocus),node(capture.active));assert.equal(node(after.active),node(capture.active));mounted(capture);mounted(after);return after;};
  const pointer=repeatedEvidence.events,pointerClicks=pointer.filter(event=>event.type==='click'&&event.stage==='capture');assert.equal(pointerClicks.length,2);assert.equal(pointer.filter(event=>event.type==='click').length,4);assert.equal(pointer.filter(event=>event.type==='pointerdown').length,2);assert.equal(pointer.filter(event=>event.type==='mousedown').length,2);assert.equal(pointer.filter(event=>event.type==='keydown').length,0);
  let previousEnd=-1;
  for(const [index,capture]of pointerClicks.entries()){
   const end=pointer.indexOf(capture),segment=pointer.slice(previousEnd+1,end),down=segment.filter(event=>event.type==='pointerdown'),mouse=segment.filter(event=>event.type==='mousedown');assert.equal(down.length,1);assert.equal(mouse.length,1);assert.equal(segment[0],down[0]);assert.ok(pointer.indexOf(down[0])<pointer.indexOf(mouse[0])&&pointer.indexOf(mouse[0])<end);assert.equal(down[0].pointerType,'mouse');assert.equal(down[0].receipts.presses,index+5);assert.equal(down[0].receipts.clicks,index+4);assert.equal(down[0].receipts.lastPressAtMs,attempts[index].receiptAtMs);assert.ok(down[0].atMs>=presses[index+4].at);assert.equal(capture.receipts.presses,index+5);assert.equal(capture.receipts.clicks,index+5);assert.equal(capture.receipts.lastClickAtMs,clicks[index+4].at);assert.ok(capture.atMs>=clicks[index+4].at);assert.ok(capture.detail>0);assert.equal(capture.key,null);if(index===0){assert.equal(down[0].activeIsButton,true);assert.ok(down[0].atMs>=selectedEvidence.preparations[0].atMs);}
   segment.forEach(mounted);if(down[0].activeIsButton&&!capture.activeIsButton){const transitions=segment.filter(event=>['blur','focusout'].includes(event.type));assert.ok(transitions.length>0,'Raw pointer focus loss must be located before application click capture');assert.ok(transitions.every(event=>event.target.nodeId===buttonId&&event.order<capture.order));}const after=pair(pointer,capture);previousEnd=pointer.indexOf(after);
  }
  assert.equal(previousEnd,pointer.length-1,'No unaccounted event remains after the two pointer repeats');
  const keyEvents=keyboardEvidence.events.slice(pointer.length),keyDown=keyEvents.filter(event=>event.type==='keydown'&&event.stage==='capture'),keyClicks=keyEvents.filter(event=>event.type==='click'&&event.stage==='capture');assert.equal(keyEvents.length,4);assert.equal(keyDown.length,1);assert.equal(keyClicks.length,1);assert.deepEqual(keyEvents.map(event=>event.type+':'+event.stage),['keydown:capture','keydown:after-app-bubble','click:capture','click:after-app-bubble']);const down=keyDown[0],capture=keyClicks[0];assert.equal(down.key,'Enter');assert.equal(down.activeIsButton,true);assert.equal(down.active.nodeId,buttonId);assert.ok(down.atMs>=preparation.atMs);assert.equal(down.receipts.presses,6);assert.equal(down.receipts.clicks,6);pair(keyEvents,down);assert.equal(capture.detail,0);assert.equal(capture.activeIsButton,true);assert.equal(capture.receipts.presses,6,'Enter adds no pointer press');assert.equal(capture.receipts.clicks,7);assert.equal(capture.receipts.lastClickAtMs,clicks[6].at);pair(keyEvents,capture);assert.equal(keyboard.view.continuity.focused,true);
  for(const phase of phases.slice(7)){const value=phase.view.focusEvidence;assert.deepEqual(value.preparations,keyboardEvidence.preparations);assert.deepEqual(value.events.slice(0,keyboardEvidence.events.length),keyboardEvidence.events);assert.ok(value.events.slice(keyboardEvidence.events.length).every(event=>['blur','focusout'].includes(event.type)),'Only raw departing focus events may follow the observed source button');}
 };
 const snapshots=[];
 const sourceSnapshot=async()=>{
  const remote=structuredClone([...ordinaryCloudOptions.remote]);
  return ui.page.evaluate(async remote=>{
   const head=await ScannerDeviceStore.readHead(),current=JSON.stringify(state),evidence=await CloudSync.recoveryEvidence(),p=cloudSourceRecoveryPreview,modal=document.querySelector('#modalRoot .modal'),anchor=window.__ordinaryCloudChoiceMount;
   const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
   const sections=[...modal?.querySelectorAll('section.settings-section')||[]],facts=[...modal?.querySelectorAll('pre[aria-label="Complete supported source"]')||[]],apply=modal?.querySelector('[data-act="apply-cloud-source-recovery"]');
   const snapshot={current,currentHash:await sha(current),durable:head.payload,durableHash:head.hash,headRecord:head,backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),pendingGate:await ScannerDeviceStore.getPendingUpload('gate-owner'),pendingOwner:await ScannerDeviceStore.getPendingUpload('owner'),hold:await ScannerDeviceStore.getRecoveryCloudHold(),
    backend:{user:CloudSync.user,identity:evidence.identity,epoch:evidence.epoch,status:CloudSync.status,errorCode:CloudSync.errorCode??null},
    preview:p?{account:p.account,rev:p.rev,choice:p.choice,local:p.local,head:p.head,headRecord:p.headRecord,browser:p.browser,hold:p.hold,holds:p.holds,source:p.source,evidence:p.evidence,draft:p.draft}:null,
    remote,capturedAtMs:Date.now(),lastInputAtMs:window.__buttonNativeClicks.at(-1)?.at,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
    view:{documentId:window.__installedFixture.documentId,title:modal?.querySelector('h2')?.textContent??null,html:modal?.innerHTML??'',text:modal?.innerText??'',choices:[...modal?.querySelectorAll('[data-act="choose-cloud-recovery-source"]')||[]].map(button=>({value:button.dataset.value,selected:button.getAttribute('aria-pressed'),disabled:button.disabled})),apply:apply?{disabled:apply.disabled}:null,
     continuity:anchor?{sameModal:anchor.modal===modal,sameButton:anchor.button===modal?.querySelector('[data-act="choose-cloud-recovery-source"][data-value="generation:gate-valid-previous"]'),buttonConnected:anchor.button.isConnected,sameSections:anchor.sections.map((node,index)=>node===sections[index]&&node.isConnected),sameFacts:anchor.facts.map((node,index)=>node===facts[index]&&node.isConnected),sections:anchor.sections.length,facts:anchor.facts.length,scrollTop:modal?.scrollTop??null,anchorScrollTop:anchor.scrollTop,focused:document.activeElement===anchor.button}:null,keyboard:window.__ordinaryCloudChoiceKeyboard??null,focusEvidence:window.__ordinaryCloudChoiceFocus?.snapshot()??{schemaVersion:1,installed:false,anchor:null,events:[],preparations:[]}}};
   snapshot.capturedAtMs=Date.now();return{...snapshot,sourceValueEncoding:'chain-scanner.manual-archive-value/v1',sourceValue:encodeManualArchiveValue(snapshot,'ordinary repeated cloud-source sourceSnapshot')};
  },remote);
 };
 const capture=async phase=>{const snapshot=await sourceSnapshot();ui.recordOrdinaryCloudSourcePhase(phase,snapshot);snapshots.push({phase,...snapshot});return snapshot;};
 await ui.page.waitForFunction(()=>CloudSync?.ready===true&&CloudSync.user==='fixture@example.invalid'&&CloudSync.status==='error'&&CloudSync.errorCode==='corrupt-generation'&&!pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy,null,{timeout:10000});
 await replacePreviousWithCurrentBoard(ui,ordinaryCloudOptions.remote);await capture('seed');
 await ui.act('sync',()=>document.querySelector('#modalRoot h2')?.textContent==='Cloud sync needs attention','#syncBtn');await capture('menu');
 ordinaryCloudOptions.cloudReadFail=true;
 await ui.act('review-cloud-source-recovery',()=>document.querySelector('#modalRoot h2')?.textContent==='Review cloud recovery sources'&&/cloud reads are still unavailable/i.test(document.getElementById('modalRoot').textContent)&&!document.querySelector('#modalRoot [data-act="choose-cloud-recovery-source"]')&&!document.querySelector('#modalRoot [data-act="apply-cloud-source-recovery"]'),'#modalRoot [data-act="review-cloud-source-recovery"]');await capture('read-refused');
 ordinaryCloudOptions.cloudReadFail=false;
 await ui.act('review-cloud-source-recovery',()=>{const root=document.getElementById('modalRoot'),previous=root.querySelector('[data-act="choose-cloud-recovery-source"][data-value="generation:gate-valid-previous"]');return previous&&!previous.disabled&&!cloudSourceRecoveryBusy&&!root.querySelector('[data-cloud-source-progress]')&&root.querySelector('[data-act="apply-cloud-source-recovery"]')?.disabled===true;},'#modalRoot [data-act="review-cloud-source-recovery"]');await capture('reviewed');
 const previousSelector='#modalRoot [data-act="choose-cloud-recovery-source"][data-value="generation:gate-valid-previous"]';
 await ui.act('choose-cloud-recovery-source',()=>document.querySelector('#modalRoot [data-value="generation:gate-valid-previous"]')?.getAttribute('aria-pressed')==='true'&&document.querySelector('#modalRoot [data-act="apply-cloud-source-recovery"]')?.disabled===false,previousSelector);
 await ui.page.locator(previousSelector).focus();await ui.page.locator(previousSelector).scrollIntoViewIfNeeded();
 await ui.page.evaluate(()=>{const modal=document.querySelector('#modalRoot .modal'),button=modal.querySelector('[data-act="choose-cloud-recovery-source"][data-value="generation:gate-valid-previous"]');button.scrollIntoView({block:'center',behavior:'instant'});window.__ordinaryCloudChoiceMount={modal,button,sections:[...modal.querySelectorAll('section.settings-section')],facts:[...modal.querySelectorAll('pre[aria-label="Complete supported source"]')],scrollTop:modal.scrollTop};
const saved=window.__ordinaryCloudChoiceMount,nodeIds=new WeakMap();let nextNodeId=0,nextDispatchId=0;const events=[],preparations=[],pending=new WeakMap(),activeDispatches=new Set();
const describe=node=>{if(!node)return null;if(!nodeIds.has(node))nodeIds.set(node,++nextNodeId);return{nodeId:nodeIds.get(node),tag:node.nodeName,domId:node.id||null,action:node.dataset?.act??null,value:node.dataset?.value??null,connected:node.isConnected};};
const mount=()=>{const current=document.querySelector('#modalRoot .modal'),sections=[...current?.querySelectorAll('section.settings-section')||[]],facts=[...current?.querySelectorAll('pre[aria-label="Complete supported source"]')||[]];return{button:describe(saved.button),modal:describe(saved.modal),sections:saved.sections.map(describe),facts:saved.facts.map(describe),sameModal:current===saved.modal,sameButton:current?.querySelector('[data-act="choose-cloud-recovery-source"][data-value="generation:gate-valid-previous"]')===saved.button,sameSections:saved.sections.map((node,index)=>node===sections[index]&&node.isConnected),sameFacts:saved.facts.map((node,index)=>node===facts[index]&&node.isConnected),scrollTop:current?.scrollTop??null,anchorScrollTop:saved.scrollTop};};
const controlFor=event=>event.target?.closest?.('[data-act="choose-cloud-recovery-source"]');
const record=(event,stage,dispatch=null)=>{const control=controlFor(event),active=document.activeElement,presses=window.__buttonNativePresses,clicks=window.__buttonNativeClicks;events.push({order:events.length+1,type:event.type,stage,atMs:performance.timeOrigin+performance.now(),timeStamp:event.timeStamp,eventPhase:event.eventPhase,trusted:event.isTrusted,detail:typeof event.detail==='number'?event.detail:null,key:typeof event.key==='string'?event.key:null,pointerType:typeof event.pointerType==='string'?event.pointerType:null,action:control?.dataset.act??null,value:control?.dataset.value??null,target:describe(event.target),relatedTarget:describe(event.relatedTarget),active:describe(active),activeIsButton:active===saved.button,mount:mount(),dispatchId:dispatch?.id??null,receivedFocus:dispatch?describe(dispatch.before):null,sameReceivedFocus:dispatch?active===dispatch.before:null,receipts:{presses:presses.length,clicks:clicks.length,lastPressAtMs:presses.at(-1)?.at??null,lastClickAtMs:clicks.at(-1)?.at??null}});};
const capture=event=>{if(controlFor(event)!==saved.button)return;let dispatch=null;if(event.type==='click'||event.type==='keydown'){dispatch={id:++nextDispatchId,before:document.activeElement};pending.set(event,dispatch);activeDispatches.add(event);}record(event,'capture',dispatch);};
const after=event=>{const dispatch=pending.get(event);if(!dispatch)return;record(event,'after-app-bubble',dispatch);pending.delete(event);activeDispatches.delete(event);};
for(const type of ['pointerdown','mousedown','blur','focusout','keydown','click'])document.addEventListener(type,capture,true);
// Installed after the app's existing delegated document listeners; no event or focus mutation.
for(const type of ['keydown','click'])document.addEventListener(type,after);
const preparation=kind=>{const active=document.activeElement;preparations.push({kind,atMs:performance.timeOrigin+performance.now(),eventCount:events.length,active:describe(active),button:describe(saved.button),sameActiveButton:active===saved.button,outsideDispatch:activeDispatches.size===0});};
preparation('selected-focus-before-observer');
window.__ordinaryCloudChoiceFocus={snapshot:()=>({schemaVersion:1,installed:true,anchor:mount(),events:structuredClone(events),preparations:structuredClone(preparations)}),noteKeyboardPreparation:()=>preparation('keyboard-focus-outside-dispatch')};
});await capture('selected');
 const attempts=await ui.repeat('act:choose-cloud-recovery-source',2,()=>document.querySelector('#modalRoot [data-value="generation:gate-valid-previous"]')?.getAttribute('aria-pressed')==='true',previousSelector,'Repeated eligible previous cloud source');await capture('repeated');
 await ui.page.locator(previousSelector).focus();await ui.page.evaluate(()=>{const saved=window.__ordinaryCloudChoiceMount;saved.scrollTop=saved.modal.scrollTop;window.__ordinaryCloudChoiceFocus.noteKeyboardPreparation();saved.button.addEventListener('click',event=>{window.__ordinaryCloudChoiceKeyboard={trusted:event.isTrusted,detail:event.detail,value:saved.button.dataset.value};},{once:true});});
 await ui.page.locator(previousSelector).press('Enter',{timeout:2500});await ui.waitFor(()=>window.__ordinaryCloudChoiceKeyboard?.trusted===true&&window.__ordinaryCloudChoiceKeyboard.detail===0&&document.activeElement===window.__ordinaryCloudChoiceMount.button,12000,'Actual Enter cloud-source choice');await capture('keyboard');
 await ui.act('choose-cloud-recovery-source',()=>document.querySelector('#modalRoot [data-value="device"]')?.getAttribute('aria-pressed')==='true'&&document.querySelector('#modalRoot [data-value="generation:gate-valid-previous"]')?.getAttribute('aria-pressed')==='false','#modalRoot [data-act="choose-cloud-recovery-source"][data-value="device"]');await capture('alternate');
 ordinaryCloudOptions.cloudWriteFail=true;
 await ui.act('apply-cloud-source-recovery',()=>document.querySelector('#modalRoot h2')?.textContent==='Review cloud recovery sources'&&/cloud confirmation is unavailable/i.test(document.getElementById('modalRoot').textContent)&&!cloudSourceRecoveryBusy&&document.querySelector('#modalRoot [data-act="apply-cloud-source-recovery"]')?.disabled===true,'#modalRoot [data-act="apply-cloud-source-recovery"]');await capture('write-refused');await capture('final-source');
 const semantic=verifyCloudChoiceSources(snapshots);
 const focusReceipts=await ui.page.evaluate(()=>({presses:window.__buttonNativePresses,clicks:window.__buttonNativeClicks}));verifyCloudChoiceFocus(snapshots,focusReceipts.presses,focusReceipts.clicks,attempts);
 ui.recordRepeatOutcome(scenario,attempts,JSON.stringify(semantic));
  });

  await h.scenario('cloud sync signs out and rejects signed-out authentication safely',{
    authMode:'reconcile-held',remote:sameBoardRemote()
  },async ui=>{
    await ui.page.waitForFunction(()=>window.CloudSync?.ready===true&&window.CloudSync.user==='fixture@example.invalid'&&
      window.CloudSync.status==='ok'&&state.syncDirty===false&&!pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy,null,{timeout:10000});
    await ui.act('sync',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return window.CloudSync?.user===null&&window.CloudSync.status==='signed-out'&&
        document.getElementById('syncBtn')?.textContent.includes('sign in')&&state.tasks.length===400&&
        state.futurePopulated?.opaque.length===1048576&&saved?.tasks.length===400&&saved.futurePopulated?.opaque.length===1048576;
    },'#syncBtn');
    await assertCurrentAndStoredFixtureBoard(ui,'Signed-out transition');
    await ui.act('sync',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return window.CloudSync?.user===null&&window.CloudSync.status==='error'&&window.CloudSync.errorStage==='sign-in'&&
        document.getElementById('syncBtn')?.textContent.includes('error')&&state.tasks.length===400&&
        state.futurePopulated?.opaque.length===1048576&&saved?.tasks.length===400&&saved.futurePopulated?.opaque.length===1048576;
    },'#syncBtn');
    await assertCurrentAndStoredFixtureBoard(ui,'Signed-out authentication failure');
  });

  const unavailableSync={authMode:'reconcile-held',remote:new Map(),cloudReadFail:true};
  await h.scenario('cloud retry, reload, and sign out preserve the device board during read failures',unavailableSync,async ui=>{
    await ui.page.waitForFunction(()=>window.CloudSync?.ready===true&&window.CloudSync.status==='error'&&
      window.CloudSync.errorCode==='unavailable'&&!pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy,null,{timeout:10000});
    await ui.act('sync',()=>document.querySelector('#modalRoot h2')?.textContent==='Cloud sync needs attention','#syncBtn');
    await ui.act('sync-retry',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return !document.querySelector('#modalRoot .modal')&&window.CloudSync?.status==='error'&&
        window.CloudSync.errorCode==='unavailable'&&state.tasks.length===400&&
        state.futurePopulated?.opaque.length===1048576&&saved?.tasks.length===400&&saved.futurePopulated?.opaque.length===1048576&&
        !pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy;
    },'#modalRoot [data-act="sync-retry"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud retry read failure');
    await ui.act('sync',()=>document.querySelector('#modalRoot h2')?.textContent==='Cloud sync needs attention','#syncBtn');
    await ui.expectReload('sync-reload');
    await ui.waitFor(async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return window.CloudSync?.ready===true&&window.CloudSync.status==='error'&&window.CloudSync.errorCode==='unavailable'&&
        state.tasks.length===400&&state.futurePopulated?.opaque.length===1048576&&
        saved?.tasks.length===400&&saved.futurePopulated?.opaque.length===1048576&&
        !pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy;
    },10000);
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud reload read failure');
    await ui.act('sync',()=>document.querySelector('#modalRoot h2')?.textContent==='Cloud sync needs attention','#syncBtn');
    await ui.act('sync-signout',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return window.CloudSync?.user===null&&window.CloudSync.status==='signed-out'&&
        state.tasks.length===400&&state.futurePopulated?.opaque.length===1048576&&
        saved?.tasks.length===400&&saved.futurePopulated?.opaque.length===1048576;
    },'#modalRoot [data-act="sync-signout"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud read failure and sign out');
  });

  const cloudOptions={authMode:'reconcile-held',remote:await damagedCurrentRemote()};
  await h.scenario('cloud recovery reviews, protects, and applies a source with read and write failures',cloudOptions,async ui=>{
    await ui.page.waitForFunction(()=>window.CloudSync?.ready===true&&window.CloudSync.user==='fixture@example.invalid'&&
      window.CloudSync.status==='error'&&window.CloudSync.errorCode==='corrupt-generation'&&
      !pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy,null,{timeout:10000});
    await replacePreviousWithCurrentBoard(ui,cloudOptions.remote);
    await ui.act('sync',()=>document.querySelector('#modalRoot h2')?.textContent==='Cloud sync needs attention','#syncBtn');

    cloudOptions.cloudReadFail=true;
    await ui.act('review-cloud-source-recovery',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      const modal=document.querySelector('#modalRoot');
      return modal?.querySelector('h2')?.textContent==='Review cloud recovery sources'&&
        /cloud reads are still unavailable/i.test(modal.textContent)&&
        !modal.querySelector('[data-act="choose-cloud-recovery-source"]')&&
        !modal.querySelector('[data-act="apply-cloud-source-recovery"]')&&state.tasks.length===400&&
        state.futurePopulated?.opaque.length===1048576&&saved?.tasks.length===400&&saved.futurePopulated?.opaque.length===1048576;
    },'#modalRoot [data-act="review-cloud-source-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud source review read failure');

    cloudOptions.cloudReadFail=false;
    await ui.act('review-cloud-source-recovery',()=>{
      const modal=document.querySelector('#modalRoot');
      const device=modal?.querySelector('[data-act="choose-cloud-recovery-source"][data-value="device"]');
      const previous=modal?.querySelector('[data-act="choose-cloud-recovery-source"][data-value="generation:gate-valid-previous"]');
      return modal?.querySelector('h2')?.textContent==='Review cloud recovery sources'&&device&&!device.disabled&&
        !cloudSourceRecoveryBusy&&!modal.querySelector('[data-cloud-source-progress]')&&
        previous&&!previous.disabled&&modal.querySelectorAll('[data-act="choose-cloud-recovery-source"][aria-pressed="true"]').length===0&&
        modal.querySelector('[data-act="apply-cloud-source-recovery"]')?.disabled===true;
    },'#modalRoot [data-act="review-cloud-source-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud source review');
    await ui.act('choose-cloud-recovery-source',()=>{
      const modal=document.querySelector('#modalRoot'),choice=modal?.querySelector('[data-act="choose-cloud-recovery-source"][data-value="device"]');
      return choice?.getAttribute('aria-pressed')==='true'&&modal.querySelector('[data-act="apply-cloud-source-recovery"]')?.disabled===false;
    },'#modalRoot [data-act="choose-cloud-recovery-source"][data-value="device"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Selected device cloud source');
    // Repeated consent to the same eligible source must leave its mounted review
    // intact, including keyboard focus and the user's place in the long facts.
    await ui.page.evaluate(()=>{
      const modal=document.querySelector('#modalRoot .modal'),button=modal.querySelector('[data-act="choose-cloud-recovery-source"][data-value="device"]');
      button.focus();button.scrollIntoView({block:'center',behavior:'instant'});
      window.__selectedSourceReview={modal,button,scrollTop:modal.scrollTop};
    });
    await ui.click('#modalRoot [data-act="choose-cloud-recovery-source"][data-value="device"]',()=>{
      const saved=window.__selectedSourceReview;
      return saved.modal===document.querySelector('#modalRoot .modal')&&saved.button.isConnected&&saved.modal.scrollTop===saved.scrollTop&&saved.button.getAttribute('aria-pressed')==='true';
    },'Repeated selected cloud source retains mounted facts and scroll');
    await ui.page.evaluate(()=>{const saved=window.__selectedSourceReview;saved.button.focus();saved.scrollTop=saved.modal.scrollTop;saved.button.addEventListener('click',event=>{window.__selectedSourceKeyboard={trusted:event.isTrusted,detail:event.detail};},{once:true});});
    await ui.page.locator('#modalRoot [data-act="choose-cloud-recovery-source"][data-value="device"]').press('Enter',{timeout:2500});
    await ui.waitFor(()=>{const saved=window.__selectedSourceReview,receipt=window.__selectedSourceKeyboard;return receipt?.trusted===true&&receipt.detail===0&&saved.modal===document.querySelector('#modalRoot .modal')&&saved.button.isConnected&&document.activeElement===saved.button&&saved.modal.scrollTop===saved.scrollTop;},12000,'Repeated keyboard source choice retains mounted facts, focus and scroll');
    await ui.click('#modalRoot [data-act="choose-cloud-recovery-source"][data-value="generation:gate-valid-previous"]',()=>document.querySelector('#modalRoot [data-value="generation:gate-valid-previous"]')?.getAttribute('aria-pressed')==='true'&&document.querySelector('#modalRoot [data-value="device"]')?.getAttribute('aria-pressed')==='false','An alternate cloud source still changes the selection');
    await ui.click('#modalRoot [data-act="choose-cloud-recovery-source"][data-value="device"]',()=>document.querySelector('#modalRoot [data-value="device"]')?.getAttribute('aria-pressed')==='true','Returning to the device source still changes the selection');



    const rootBeforeFailure=structuredClone(cloudOptions.remote.get(MANIFEST));
    cloudOptions.cloudWriteFail=true;
    await ui.act('apply-cloud-source-recovery',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      const modal=document.querySelector('#modalRoot');
      return modal?.querySelector('h2')?.textContent==='Review cloud recovery sources'&&
        /cloud confirmation is unavailable/i.test(modal.textContent)&&state.tasks.length===400&&
        state.futurePopulated?.opaque.length===1048576&&saved?.tasks.length===400&&saved.futurePopulated?.opaque.length===1048576;
    },'#modalRoot [data-act="apply-cloud-source-recovery"]');
    assert.deepEqual(cloudOptions.remote.get(MANIFEST),rootBeforeFailure,'A refused cloud write leaves the damaged root unchanged');
    await assertCurrentAndStoredFixtureBoard(ui,'Refused cloud source publication');

    cloudOptions.cloudWriteFail=false;
    await ui.act('review-cloud-source-recovery',()=>{
      const modal=document.querySelector('#modalRoot');
      return modal?.querySelector('h2')?.textContent==='Review cloud recovery sources'&&
        !cloudSourceRecoveryBusy&&!modal.querySelector('[data-cloud-source-progress]')&&
        !/cloud confirmation is unavailable/i.test(modal.textContent)&&
        !!modal.querySelector('[data-act="choose-cloud-recovery-source"][data-value="device"]');
    },'#modalRoot [data-act="review-cloud-source-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud source review after refused publication');
    await ui.act('choose-cloud-recovery-source',()=>{
      const modal=document.querySelector('#modalRoot'),choice=modal?.querySelector('[data-act="choose-cloud-recovery-source"][data-value="device"]');
      return choice?.getAttribute('aria-pressed')==='true'&&modal.querySelector('[data-act="apply-cloud-source-recovery"]')?.disabled===false;
    },'#modalRoot [data-act="choose-cloud-recovery-source"][data-value="device"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Selected device source for retry');
    await confirmedAction(ui,'apply-cloud-source-recovery',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return !document.querySelector('#modalRoot .modal')&&window.CloudSync?.status==='ok'&&state.syncDirty===false&&state.syncRev>4&&
        state.tasks.length===400&&state.futurePopulated?.opaque.length===1048576&&saved?.tasks.length===400&&
        saved.futurePopulated?.opaque.length===1048576&&saved.syncDirty===false;
    },'#modalRoot [data-act="apply-cloud-source-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud source recovery');
    await assertPublished(cloudOptions.remote,'Cloud source recovery');
  });

  const ordinaryDecisionOptions={authMode:'reconcile-held',remote:sameBoardRemote('ordinary'),retainedCopies:3,viewport:{width:1100,height:600},decorate:board=>{board.protectedBackupIds=['gate-retained-1'];}};
  await h.scenario('ordinary repeated saved decision choice',ordinaryDecisionOptions,async ui=>{
 const hash=value=>createHash('sha256').update(value).digest('hex'),copy=value=>JSON.parse(JSON.stringify(value));
 const scenario='ordinary repeated saved decision choice';
 const taskLiteral={id:'synthetic-kept',title:'Synthetic retained task',url:null,due:null,startsAt:null,evergreen:false,evergreenHours:18,evergreenResetAtDay:true,mu:25,sigma:8.333333333,done:false,createdAt:1,completedAt:null,lastDoneAt:null,ctx:[],futureTask:{opaque:['retain',7]}};
 const expectedSeed={v:1,tasks:[copy(taskLiteral)],contexts:[],chain:[],considered:{},cantAt:{},workedAt:{},workLog:[],mode:'scan',scanMode:'descending',candidateId:null,passId:'synthetic-existing-pass',passStartedAt:0,interventionActive:false,interventionP:0,snooze:0,decisionsMs:[],presentedAt:0,listOpen:false,ctxOpen:true,histOpen:false,updatedAt:1,syncAccount:'fixture@example.invalid',syncRev:4,syncDirty:true,seenQuickStart:true,settings:{scanMode:'descending',theme:'light',skipOldestFirstDot:false,horizonMin:60,thresholdPct:25,samples:250,cantMin:30,workedHours:8},futureBoard:{opaque:['retain',11]}};
 for(let index=1;index<64;index++)expectedSeed.tasks.push({...copy(taskLiteral),id:'synthetic-populated-'+index,title:'Synthetic retained task '+index,createdAt:1+index,futureTask:{opaque:['retain',index]}});
 expectedSeed.futurePopulated={version:7,opaque:'p'.repeat(1048576)};expectedSeed.protectedBackupIds=['gate-retained-1'];
 const seedHash=hash(JSON.stringify(expectedSeed)),originalIds=['gate-retained-0','gate-retained-1','gate-retained-2'],originalPayloads=[0,1,2].map(index=>JSON.stringify({...expectedSeed,futureSourceRole:index}));
 const exactKeys=(value,keys,label)=>assert.deepEqual(Object.keys(value).sort(),keys.slice().sort(),label+' complete keys');
 const safeEncode=value=>{
  if(value===undefined)return{type:'undefined'};if(value===null)return{type:'null'};
  if(typeof value!=='object'){assert.ok(['string','number','boolean'].includes(typeof value));if(typeof value==='number')assert.ok(Number.isFinite(value)&&!Object.is(value,-0));return{type:typeof value,value};}
  if(Array.isArray(value)){assert.deepEqual(Object.keys(value),Array.from({length:value.length},(_,index)=>String(index)));return{type:'array',items:value.map(safeEncode),properties:[]};}
  return{type:'object',entries:Object.keys(value).map(key=>[key,safeEncode(value[key])])};
 };
 const opaqueOriginal={type:'object',entries:[['key',{type:'string',value:'gate-opaque-exact'}],['raw',{type:'string',value:'opaque exact bytes\u0000retain'}],['futureBytes',{type:'typed-array',constructor:'Uint8Array',buffer:{type:'array-buffer',base64:'ABH/'},byteOffset:0,length:3}],['futureMinusZero',{type:'special-number',value:'-0'}]]};
 const exactRows=(actual,expected,label)=>{assert.equal(actual.length,expected.length,label+' complete row count');assert.equal(new Set(actual.map(row=>row.id)).size,actual.length,label+' unique IDs');for(const row of expected){const matches=actual.filter(value=>value.id===row.id);assert.equal(matches.length,1);assert.deepEqual(matches[0],row);assert.equal(JSON.stringify(matches[0]),JSON.stringify(row));}};
 const verifySavedDecisionSources=phases=>{
  const names=['seed','settings','baseline-saved','settings-review','read-refused','reviewed','selected','repeated','write-refused','reviewed-retry','selected-retry','applied','final-source'];
  assert.deepEqual(phases.map(row=>row.phase),names,'All complete saved-decision phases in actual order');
  const [seed,settings,baseline,settingsReview,readRefused,reviewed,selected,repeated,failed,retry,reselected,applied,finalSource]=phases;
  const snapshotKeys=['current','currentHash','durable','durableHash','headRecord','backups','opaque','pendingGate','pendingOwner','hold','backend','preview','remote','remoteBoard','capturedAtMs','lastInputAtMs','timeZone','view'];
  const pendingGate={generationId:'gate-pending',payloadHash:seedHash,baseRev:0,updatedAt:7,account:'gate-owner'};
  const originalRows=originalIds.map((id,index)=>{const matches=seed.backups.filter(row=>row.id===id);assert.equal(matches.length,1);const row=matches[0];exactKeys(row,['id','kind','at','day','payload'],'Complete manual original');assert.equal(row.kind,'manual');assert.equal(row.day,'2026-10-25');assert.equal(row.payload,originalPayloads[index]);assert.ok(Number.isSafeInteger(row.at)&&row.at>0&&row.at<=seed.capturedAtMs);return copy(row);});
  const ids=new Set(),nonces=new Set(),generated=new Map();
  const rowIdentity=(row,phase)=>{
   exactKeys(row,['id','kind','at','day','payload'],'Complete generated backup record');assert.equal(typeof row.payload,'string');
   const match=row.id.match(/^([a-z-]+):([0-9]+):(t.+)$/);assert.ok(match&&match[1]===row.kind||match&&['decision-recovery-confirmed','decision-recovery-superseded'].includes(row.kind)&&match[1]==='decision-recovery-choice');
   assert.ok(Number.isSafeInteger(row.at)&&row.at>0&&row.at<=phase.capturedAtMs);assert.ok(Number(match[2])>=row.at&&Number(match[2])<=phase.capturedAtMs);
   assert.equal(row.day,new Intl.DateTimeFormat('en-CA',{timeZone:phase.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(row.at));
   if(!generated.has(row.id)){assert.ok(!ids.has(row.id)&&!nonces.has(match[3]));ids.add(row.id);nonces.add(match[3]);generated.set(row.id,copy(row));}
   else{const prior=generated.get(row.id);assert.deepEqual(row,{...prior,kind:row.kind});assert.ok(row.kind===prior.kind||prior.kind==='decision-recovery-choice'&&['decision-recovery-confirmed','decision-recovery-superseded'].includes(row.kind));}
  };
  const remotePayload=phase=>{const root=phase.remote.find(([key])=>key==='users/owner')?.[1];assert.ok(root);assert.ok(Number.isSafeInteger(root.rev)&&root.rev>=4);if(root.payload!==undefined){assert.equal(root.payload,JSON.stringify(phase.remoteBoard));return root.payload;}assert.equal(root.schemaVersion,2);assert.equal(typeof root.activeGeneration,'string');const header=phase.remote.find(([key])=>key==='users/owner/generations/'+root.activeGeneration)?.[1];assert.equal(header?.state,'published');assert.equal(header?.hash,hash(JSON.stringify(phase.remoteBoard)));return JSON.stringify(phase.remoteBoard);};
  const checkBase=(base,account,revision,payload)=>{exactKeys(base,['v','id','account','revision','payload'],'Complete device decision-base identity');assert.match(base.id,/^db1:[a-f0-9]{32}$/);assert.deepEqual(base,{v:1,id:base.id,account,revision,payload});};
  for(const phase of phases){
   assert.equal(phase.sourceValueEncoding,'chain-scanner.manual-archive-value/v1');assert.deepEqual(phase.sourceValue.entries.map(row=>row[0]),snapshotKeys);exactKeys(phase.sourceValue,['type','entries'],'Complete typed source');assert.equal(phase.sourceValue.type,'object');
   assert.deepEqual(Object.keys(phase).filter(key=>!snapshotKeys.includes(key)&&!['schemaVersion','phase','scenario','sourceIdentity','sourceValueEncoding','sourceValue'].includes(key)),[]);
   for(const [key,node]of phase.sourceValue.entries){if(key==='opaque')continue;assert.deepEqual(node,safeEncode(phase[key]),'Lossless complete '+key);if(!Object.hasOwn(phase,key))assert.equal(key,'lastInputAtMs');}
   assert.deepEqual(phase.sourceValue.entries.find(row=>row[0]==='opaque')[1],{type:'array',items:[opaqueOriginal],properties:[]},'Exact typed opaque source including negative zero and typed-array bytes');
   assert.equal(phase.currentHash,hash(phase.current));assert.equal(phase.durableHash,hash(phase.durable));assert.equal(phase.headRecord.payload,phase.durable);assert.equal(phase.headRecord.hash,phase.durableHash);
   assert.deepEqual(phase.pendingGate,pendingGate);assert.equal(phase.pendingOwner,null);assert.equal(phase.hold,null);assert.equal(phase.backend.user,'fixture@example.invalid');assert.equal(phase.backend.identity,'owner');assert.equal(phase.backend.epoch,seed.backend.epoch);
   assert.ok(Number.isSafeInteger(phase.capturedAtMs)&&phase.capturedAtMs>=seed.capturedAtMs);assert.equal(typeof phase.timeZone,'string');
   for(const original of originalRows)assert.deepEqual(phase.backups.find(row=>row.id===original.id),original,'Every exact protected/manual original retained');
   assert.equal(new Set(phase.backups.map(row=>row.id)).size,phase.backups.length);for(const row of phase.backups.filter(row=>!originalIds.includes(row.id)))rowIdentity(row,phase);
   for(const side of ['current','durable']){const board=JSON.parse(phase[side]);assert.equal(board.tasks.length,64);assert.equal(board.tasks.filter(row=>!row.done).length,64);assert.deepEqual(board.tasks.map(row=>({id:row.id,title:row.title,createdAt:row.createdAt,futureTask:row.futureTask})),expectedSeed.tasks.map(row=>({id:row.id,title:row.title,createdAt:row.createdAt,futureTask:row.futureTask})));assert.deepEqual(board.futureBoard,expectedSeed.futureBoard);assert.deepEqual(board.futurePopulated,expectedSeed.futurePopulated);assert.deepEqual(board.protectedBackupIds,['gate-retained-1']);assert.deepEqual(board.workLog,[]);assert.deepEqual(board.chain,[]);assert.equal(board.settings.theme,'light');}
   remotePayload(phase);
  }
  const seedBoard=JSON.parse(seed.current);assert.equal(seed.current,seed.durable,'Actual healthy seed is durably readable');assert.equal(seedBoard.syncDirty,false);assert.equal(seedBoard.syncAccount,'fixture@example.invalid');assert.equal(seedBoard.syncIdentity,'owner');assert.ok(Number.isSafeInteger(seedBoard.syncRev)&&seedBoard.syncRev>=4);assert.equal(seedBoard.settings.horizonMin,60);assert.equal(seedBoard.decisionBaseline,undefined);assert.equal(seedBoard.decisionEvents,undefined);checkBase(seedBoard.decisionBase,'fixture@example.invalid',seedBoard.syncRev,remotePayload(seed));
  const literalLive=copy(expectedSeed);literalLive.v=2;literalLive.tasks=literalLive.tasks.map(row=>({...row,prerequisiteRevision:0,prerequisiteIds:[],prerequisiteId:null,prerequisiteMirror:null,prerequisiteOps:{}}));
  literalLive.settings={horizonMin:60,thresholdPct:25,samples:250,cantMin:30,workedHours:16,postponeHours:1,evergreenHours:18,evergreenResetAtDay:true,scanMode:'descending',squaredDefaultVersion:1,listMetric:'rank',excludeNoContext:false,lastTaskWoop:false,skipOldestFirstDot:false,floatingHeader:false,patternedIndicators:false,showPostpone:true,theme:'light',dateFormat:'system',hourlyQuotes:{},scene:{time:null,season:null,location:null}};
  Object.assign(literalLive,{deletionLog:[],deletedTaskIds:{},clearedHistoryIds:{},restoredTaskIds:{},restoredHistoryIds:{},restoredTaskOps:{},restoredHistoryOps:{},deletedAfterRestoreOps:{},clearedAfterRestoreOps:{},chance:null,addOpen:true,syncIdentity:'owner',syncRev:seedBoard.syncRev,syncDirty:false,decisionBase:copy(seedBoard.decisionBase)});
  if(Object.hasOwn(seedBoard,'lastCloudServerAt')){assert.ok(Number.isSafeInteger(seedBoard.lastCloudServerAt)&&seedBoard.lastCloudServerAt>0&&seedBoard.lastCloudServerAt<=seed.capturedAtMs);literalLive.lastCloudServerAt=seedBoard.lastCloudServerAt;}
  assert.deepEqual(seedBoard,literalLive,'Complete hydrated seed has independently declared fields and exact acknowledged authority');
  for(const side of ['current','durable'])assert.equal(settings[side],seed[side],'Opening Settings grants no decision authority');assert.deepEqual(settings.backups,seed.backups);assert.deepEqual(settings.remote,seed.remote);
  const eventFields=['v','id','at','account','baseId','kind','actionId','target','value','after','before','passId','passAt','scanMode','chainIds','observedActionIds'];
  const eventExpected=(event,property,value,before,baseId,baselineId,observed,phase)=>{exactKeys(event,eventFields,'Complete deliberate setting decision');assert.match(event.id,/^t.+/);assert.match(event.actionId,/^t.+/);assert.notEqual(event.id,event.actionId);assert.ok(Number.isSafeInteger(event.at)&&event.at>=Math.floor(phase.lastInputAtMs)&&event.at<=phase.capturedAtMs);const expected={v:1,id:event.id,at:event.at,account:'fixture@example.invalid',baseId,kind:'current-choice',actionId:event.actionId,target:{type:'setting',id:'board',property},value,after:{present:true},before:{present:true,value:before},passId:'synthetic-existing-pass',passAt:0,scanMode:'descending',chainIds:[],observedActionIds:observed};assert.deepEqual(event,expected);return expected;};
  const savedBoard=JSON.parse(baseline.current),baselineFact=savedBoard.decisionBaseline;assert.match(baselineFact.id,/^dlb2:[a-f0-9]+$/);
  assert.deepEqual(baselineFact,{v:1,account:'fixture@example.invalid',sourceBaseId:seedBoard.decisionBase.id,sourceRevision:seedBoard.syncRev,includedActionIds:[],ratings:expectedSeed.tasks.map(row=>({taskId:row.id,mu:25,sigma:8.333333333})).sort((a,b)=>a.taskId<b.taskId?-1:a.taskId>b.taskId?1:0),chainIds:[],passId:'synthetic-existing-pass',passAt:0,considered:{},cantAt:{},workedAt:{},observedRatingHistoryIds:[],id:baselineFact.id},'Complete independently expected decision baseline');
  assert.equal(savedBoard.decisionEvents.length,1);const horizonEvent=eventExpected(savedBoard.decisionEvents[0],'horizonMin',61,60,seedBoard.decisionBase.id,baselineFact.id,[],baseline);
  const expectedSaved=copy(seedBoard);expectedSaved.settings.horizonMin=61;expectedSaved.decisionBaseline=copy(baselineFact);expectedSaved.decisionEvents=[horizonEvent];assert.ok(Number.isSafeInteger(savedBoard.updatedAt)&&savedBoard.updatedAt>=horizonEvent.at&&savedBoard.updatedAt<=baseline.capturedAtMs);expectedSaved.updatedAt=savedBoard.updatedAt;expectedSaved.syncRev=savedBoard.syncRev;expectedSaved.syncDirty=false;assert.ok(savedBoard.syncRev>seedBoard.syncRev);checkBase(savedBoard.decisionBase,'fixture@example.invalid',savedBoard.syncRev,remotePayload(baseline));expectedSaved.decisionBase=copy(savedBoard.decisionBase);if(Object.hasOwn(savedBoard,'lastCloudServerAt')){assert.ok(Number.isSafeInteger(savedBoard.lastCloudServerAt)&&savedBoard.lastCloudServerAt>=horizonEvent.at&&savedBoard.lastCloudServerAt<=baseline.capturedAtMs);expectedSaved.lastCloudServerAt=savedBoard.lastCloudServerAt;}
  assert.deepEqual(savedBoard,expectedSaved,'Settings changes only the exact chosen setting, event, baseline and acknowledged bookkeeping');assert.equal(baseline.current,baseline.durable);
  for(const phase of [settingsReview,readRefused,reviewed,selected,repeated,failed,retry,reselected]){assert.equal(phase.current,baseline.current,'No adoption or unrelated current mutation before confirmed Apply');assert.equal(phase.durable,baseline.durable,'No durable authority before confirmed Apply');assert.deepEqual(phase.headRecord,baseline.headRecord);assert.deepEqual(phase.remote,baseline.remote,'Failed ACK and selection preserve every original remote byte');assert.deepEqual(phase.remoteBoard,baseline.remoteBoard);}
  for(const phase of [settingsReview,readRefused,reviewed,selected,repeated])assert.deepEqual(phase.backups,baseline.backups,'No-save controls preserve every complete source row');
  assert.equal(readRefused.view.title,'Review saved decisions');assert.match(readRefused.view.text,/cloud could not be read/i);assert.deepEqual(readRefused.view.choices,[]);assert.equal(readRefused.view.apply.disabled,true);
  for(const phase of [reviewed,retry]){assert.equal(phase.view.title,'Review saved decisions');assert.deepEqual(phase.view.choices.map(row=>({value:row.value,selected:row.selected,disabled:row.disabled})),[{value:'light',selected:'false',disabled:false}]);assert.equal(phase.view.apply.disabled,true);assert.equal(phase.preview.choice,null);}
  for(const phase of [selected,repeated,reselected]){assert.equal(phase.preview.choice,'light');assert.deepEqual(phase.view.choices.map(row=>({value:row.value,selected:row.selected,disabled:row.disabled})),[{value:'light',selected:'true',disabled:false}]);assert.equal(phase.view.apply.disabled,false);}
  for(const phase of [selected,repeated]){const continuity=phase.view.continuity;exactKeys(continuity,['sameModal','sameButton','buttonConnected','sameFacts','facts','scrollTop','anchorScrollTop','focused'],'Complete selected Light continuity');assert.equal(continuity.sameModal,true,'Repeated Light keeps the mounted review');assert.equal(continuity.sameButton,true);assert.equal(continuity.buttonConnected,true);assert.ok(continuity.facts>0);assert.deepEqual(continuity.sameFacts,Array(continuity.facts).fill(true));assert.ok(continuity.anchorScrollTop>0);assert.equal(continuity.scrollTop,continuity.anchorScrollTop);}
  assert.equal(repeated.view.html,selected.view.html);assert.equal(failed.view.title,'Review saved decisions');assert.match(failed.view.text,/cloud sync is not confirmed/i);assert.equal(failed.view.apply.disabled,true);assert.equal(failed.preview.choice,null);
  const backupNew=(phase,previous)=>phase.backups.filter(row=>!previous.backups.some(prior=>prior.id===row.id));
  const preparedFor=(phase,previous,kind)=>{const rows=backupNew(phase,previous),matches=rows.filter(row=>row.kind===kind);assert.equal(matches.length,1);return{rows,hold:matches[0],board:JSON.parse(matches[0].payload)};};
  const preparedExpected=(prepared,phase,pre)=>{const choice=prepared.recoveryChoice;exactKeys(choice,['identity','account','revision','choiceId','deviceSource','cloudSource','pending'],'Complete prepared Light consent');const event=prepared.decisionEvents.at(-1),expectedEvent=eventExpected(event,'theme','light','light',savedBoard.decisionBase.id,baselineFact.id,[horizonEvent.id],phase);const expected=copy(savedBoard);expected.decisionEvents.push(expectedEvent);expected.syncDirty=true;expected.updatedAt=event.at;expected.recoveryChoice={identity:'owner',account:'fixture@example.invalid',revision:savedBoard.syncRev,choiceId:event.id,deviceSource:baseline.current,cloudSource:copy(pre.preview.remote),pending:null};assert.deepEqual(prepared,expected,'Every complete prepared board field is independently expected');assert.equal(choice.choiceId,event.id);return{event:expectedEvent,board:expected};};
  const failedPrepared=preparedFor(failed,repeated,'decision-recovery-choice'),failedExpected=preparedExpected(failedPrepared.board,failed,selected);
  const verifyProtectionRows=(rows,pre,phase,hold,confirmedPayload=null)=>{
   const devicePayloads=[...new Set([pre.preview.local,pre.preview.head,...pre.preview.browser.map(row=>row.raw)].filter(value=>typeof value==='string'))];
   const devices=rows.filter(row=>row.kind==='decision-recovery-device');assert.deepEqual(devices.map(row=>row.payload).sort(),devicePayloads.slice().sort());
   const cloudRows=rows.filter(row=>row.kind==='decision-recovery-cloud');assert.deepEqual(cloudRows.map(row=>row.payload).sort(),[pre.preview.remote.payload,...(confirmedPayload===null?[]:[confirmedPayload])].sort());
   const pending=rows.filter(row=>row.kind==='decision-recovery-pending');assert.equal(pending.length,1);assert.equal(pending[0].payload,JSON.stringify({tasks:[],pending:null,evidence:pre.preview.evidence,browserSources:pre.preview.browser,local:pre.preview.local,cloud:pre.preview.remote}));
   assert.equal(rows.length,devices.length+cloudRows.length+pending.length+1);assert.ok(rows.includes(hold));for(const row of rows)assert.ok(row.at>=Math.floor(phase.lastInputAtMs),'Protection belongs to the explicit Apply');
  };
  verifyProtectionRows(failedPrepared.rows,selected,failed,failedPrepared.hold);exactRows(failed.backups,[...baseline.backups,...failedPrepared.rows],'Failed Apply adds only exact preservation copies');for(const phase of [retry,reselected])assert.deepEqual(phase.backups,failed.backups);
  const successRows=backupNew(applied,reselected).filter(row=>!['daily','latest'].includes(row.kind)),newHolds=successRows.filter(row=>row.kind==='decision-recovery-confirmed');assert.equal(newHolds.length,1);const successfulPrepared=JSON.parse(newHolds[0].payload),successExpected=preparedExpected(successfulPrepared,applied,reselected);assert.notEqual(successExpected.event.id,failedExpected.event.id);assert.notEqual(successExpected.event.actionId,failedExpected.event.actionId);
  const published=copy(successExpected.board);delete published.recoveryChoice;for(const key of ['syncRev','syncAccount','syncIdentity','lastCloudServerAt','syncDirty','protectedBackupIds','decisionBase'])delete published[key];const publishedRaw=JSON.stringify(published);assert.deepEqual(applied.remoteBoard,published);assert.equal(remotePayload(applied),publishedRaw);verifyProtectionRows(successRows,reselected,applied,newHolds[0],publishedRaw);
  const finalBoard=JSON.parse(applied.current),expectedApplied=copy(successExpected.board);delete expectedApplied.recoveryChoice;expectedApplied.syncDirty=false;expectedApplied.syncRev=finalBoard.syncRev;assert.ok(finalBoard.syncRev>savedBoard.syncRev);checkBase(finalBoard.decisionBase,'fixture@example.invalid',finalBoard.syncRev,publishedRaw);expectedApplied.decisionBase=copy(finalBoard.decisionBase);if(Object.hasOwn(finalBoard,'lastCloudServerAt')){assert.ok(Number.isSafeInteger(finalBoard.lastCloudServerAt)&&finalBoard.lastCloudServerAt>=successExpected.event.at&&finalBoard.lastCloudServerAt<=applied.capturedAtMs);expectedApplied.lastCloudServerAt=finalBoard.lastCloudServerAt;}
  assert.deepEqual(finalBoard,expectedApplied,'Only the newly explicitly confirmed choice reaches the current board');assert.equal(applied.current,applied.durable);assert.equal(applied.preview,null);assert.equal(applied.view.title,null);assert.equal(finalBoard.decisionEvents.some(row=>row.id===failedExpected.event.id),false,'Refused prepared decision never becomes accepted');
  const superseded=applied.backups.find(row=>row.id===failedPrepared.hold.id);assert.deepEqual(superseded,{...failedPrepared.hold,kind:'decision-recovery-superseded'});for(const row of failedPrepared.rows.filter(row=>row.id!==failedPrepared.hold.id))assert.deepEqual(applied.backups.find(copy=>copy.id===row.id),row);
  const oldStable=baseline.backups.filter(row=>row.kind!=='latest'),newAutomatic=applied.backups.filter(row=>!baseline.backups.some(prior=>prior.id===row.id)&&['daily','latest'].includes(row.kind));assert.ok(newAutomatic.filter(row=>row.kind==='latest').length===1);const dailyBefore=baseline.backups.filter(row=>row.kind==='daily');for(const row of dailyBefore)assert.deepEqual(applied.backups.find(copy=>copy.id===row.id),row,'First daily source stays exact');
  for(const row of newAutomatic){assert.equal(row.payload,applied.current);assert.ok(row.at>=Math.floor(applied.lastInputAtMs));}
  exactRows(applied.backups,[...oldStable,...failedPrepared.rows.map(row=>row.id===failedPrepared.hold.id?{...row,kind:'decision-recovery-superseded'}:row),...successRows,...newAutomatic],'Complete acknowledged lifecycle retains originals and exact refused/confirmed copies');
  for(const key of ['current','currentHash','durable','durableHash','headRecord','backups','opaque','pendingGate','pendingOwner','hold','remote','remoteBoard'])assert.deepEqual(finalSource[key],applied[key],'Final read preserves complete '+key);
  return{phases:names,theme:'light',horizonMin:61,currentHash:applied.currentHash,durableHash:applied.durableHash,refusedChoiceId:failedExpected.event.id,confirmedChoiceId:successExpected.event.id,completeBoardsPreserved:true,completeRecoveryLifecycleValidated:true,typedOpaquePreserved:true,pendingUploadPreserved:true,selectionDoesNotSave:true,failedAcknowledgementRemainsPending:true,explicitApplyAcknowledged:true,mountedReviewPreserved:true};
 };
 const sourceSnapshot=async()=>{
  const remote=[...ordinaryDecisionOptions.remote].map(([key,value])=>[key,structuredClone(value)]),remoteBoard=await readRemoteBoard(ordinaryDecisionOptions.remote,'Ordinary saved-decision exact remote');
  return ui.page.evaluate(async({remote,remoteBoard})=>{
   const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
   const head=await ScannerDeviceStore.readHead(),current=JSON.stringify(state),evidence=await CloudSync.recoveryEvidence(),p=decisionRecoveryPreview,modal=document.querySelector('#modalRoot .modal'),anchor=window.__ordinaryDecisionChoiceMount,button=modal?.querySelector('[data-act="choose-decision-recovery"][data-value="light"]'),facts=[...modal?.querySelectorAll('p,summary,code')||[]],apply=modal?.querySelector('[data-act="apply-decision-recovery"]');
   const snapshot={current,currentHash:await sha(current),durable:head.payload,durableHash:head.hash,headRecord:head,backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),pendingGate:await ScannerDeviceStore.getPendingUpload('gate-owner'),pendingOwner:await ScannerDeviceStore.getPendingUpload('owner'),hold:await ScannerDeviceStore.getRecoveryCloudHold(),backend:{user:CloudSync.user,identity:evidence.identity,epoch:evidence.epoch,status:CloudSync.status,errorCode:CloudSync.errorCode??null},preview:p?JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(p).filter(([key])=>key!=='backend')))):null,remote,remoteBoard,capturedAtMs:Date.now(),lastInputAtMs:window.__buttonNativeClicks.at(-1)?.at,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
    view:{documentId:window.__installedFixture.documentId,title:modal?.querySelector('h2')?.textContent??null,html:modal?.innerHTML??'',text:modal?.innerText??'',choices:[...modal?.querySelectorAll('[data-act="choose-decision-recovery"]')||[]].map(button=>({value:button.dataset.value,selected:button.getAttribute('aria-pressed'),disabled:button.disabled})),apply:apply?{disabled:apply.disabled}:null,continuity:anchor?{sameModal:anchor.modal===modal,sameButton:anchor.button===button,buttonConnected:anchor.button.isConnected,sameFacts:anchor.facts.map((node,index)=>node===facts[index]&&node.isConnected),facts:anchor.facts.length,scrollTop:modal?.scrollTop??null,anchorScrollTop:anchor.scrollTop,focused:document.activeElement===anchor.button}:null,focusDispatches:window.__ordinaryDecisionFocusDispatches?.map(row=>({...row}))??[]}};
   snapshot.capturedAtMs=Date.now();return{...snapshot,sourceValueEncoding:'chain-scanner.manual-archive-value/v1',sourceValue:encodeManualArchiveValue(snapshot,'ordinary repeated saved-decision sourceSnapshot')};
  },{remote,remoteBoard});
 };
 const snapshots=[],capture=async phase=>{const snapshot=await sourceSnapshot();ui.recordOrdinaryCloudSourcePhase(phase,snapshot);snapshots.push({phase,...snapshot});return snapshot;};
 const settled=async()=>{await ui.waitFor(async()=>{const head=await ScannerDeviceStore.readHead();return CloudSync?.ready===true&&CloudSync.user==='fixture@example.invalid'&&CloudSync.status==='ok'&&state.syncDirty===false&&!pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy&&head?.payload===JSON.stringify(state);},12000,'The existing real saved-settings baseline is settled and durably acknowledged');};
 await settled();await capture('seed');
 await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');await capture('settings');
 await ui.fill('#stHorizon','61');await ui.act('save-settings',()=>!document.querySelector('#stHorizon')&&state.settings.horizonMin===61&&state.decisionBaseline?.account==='fixture@example.invalid'&&state.decisionEvents?.some(event=>event.kind==='current-choice'&&event.target?.type==='setting'&&event.target.property==='horizonMin'&&event.value===61),'#modalRoot [data-act="save-settings"]');await settled();await capture('baseline-saved');
 await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');await capture('settings-review');
 ordinaryDecisionOptions.cloudReadFail=true;
 await ui.act('review-decision-recovery',()=>{const root=document.getElementById('modalRoot');return root.querySelector('h2')?.textContent==='Review saved decisions'&&/cloud could not be read/i.test(root.textContent)&&!root.querySelector('[data-act="choose-decision-recovery"]')&&root.querySelector('[data-act="apply-decision-recovery"]')?.disabled===true;},'#modalRoot [data-act="review-decision-recovery"]');await capture('read-refused');
 ordinaryDecisionOptions.cloudReadFail=false;
 await ui.act('review-decision-recovery',()=>{const root=document.getElementById('modalRoot'),light=root.querySelector('[data-act="choose-decision-recovery"][data-value="light"]');return root.querySelector('h2')?.textContent==='Review saved decisions'&&light&&!light.disabled&&light.getAttribute('aria-pressed')==='false'&&root.querySelector('[data-act="apply-decision-recovery"]')?.disabled===true&&!/Reading this device and the current cloud source/i.test(root.textContent);},'#modalRoot [data-act="review-decision-recovery"]');await capture('reviewed');
 const lightSelector='#modalRoot [data-act="choose-decision-recovery"][data-value="light"]';
 await ui.act('choose-decision-recovery',()=>document.querySelector('#modalRoot [data-value="light"]')?.getAttribute('aria-pressed')==='true'&&document.querySelector('#modalRoot [data-act="apply-decision-recovery"]')?.disabled===false,lightSelector);
 await ui.page.evaluate(()=>{
  const modal=document.querySelector('#modalRoot .modal'),button=modal.querySelector('[data-act="choose-decision-recovery"][data-value="light"]');button.focus();button.scrollIntoView({block:'center',behavior:'instant'});
  window.__ordinaryDecisionChoiceMount={modal,button,facts:[...modal.querySelectorAll('p,summary,code')],scrollTop:modal.scrollTop};window.__ordinaryDecisionFocusDispatches=[];let activeBefore=null;
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-act="choose-decision-recovery"]')!==button)return;activeBefore=document.activeElement;window.__ordinaryDecisionFocusDispatches.push({stage:'capture',trusted:event.isTrusted,atMs:performance.timeOrigin+performance.now(),sameActive:document.activeElement===activeBefore,buttonConnected:button.isConnected,sameModal:document.querySelector('#modalRoot .modal')===modal});},true);
  // Observe after the app's existing document handler; never repair focus.
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-act="choose-decision-recovery"]')!==button)return;window.__ordinaryDecisionFocusDispatches.push({stage:'after-app-bubble',trusted:event.isTrusted,atMs:performance.timeOrigin+performance.now(),sameActive:document.activeElement===activeBefore,buttonConnected:button.isConnected,sameModal:document.querySelector('#modalRoot .modal')===modal});});
 });
 await capture('selected');
 const attempts=await ui.repeat('act:choose-decision-recovery',2,()=>document.querySelector('#modalRoot [data-value="light"]')?.getAttribute('aria-pressed')==='true',lightSelector,'Repeated selected Light retains selection without authority');
 const repeated=await capture('repeated');
 assert.equal(repeated.view.continuity.sameModal,true,'Repeated Light keeps the mounted review');assert.equal(repeated.view.continuity.sameButton,true);assert.equal(repeated.view.continuity.buttonConnected,true);assert.deepEqual(repeated.view.continuity.sameFacts,Array(repeated.view.continuity.facts).fill(true));assert.ok(repeated.view.continuity.anchorScrollTop>0,'Light repeats exercise actual nonzero review scroll');assert.equal(repeated.view.continuity.scrollTop,repeated.view.continuity.anchorScrollTop);
 assert.equal(repeated.view.focusDispatches.length,4,'Each of the two real repeat inputs has raw before/after app-handler focus observations');assert.deepEqual(repeated.view.focusDispatches.map(row=>row.stage),['capture','after-app-bubble','capture','after-app-bubble']);for(const row of repeated.view.focusDispatches){assert.equal(row.trusted,true);assert.equal(row.sameActive,true);assert.equal(row.sameModal,true);assert.equal(row.buttonConnected,true);}
 ordinaryDecisionOptions.cloudWriteFail=true;
 await ui.act('apply-decision-recovery',()=>document.querySelector('#modalRoot h2')?.textContent==='Review saved decisions'&&/cloud sync is not confirmed/i.test(document.getElementById('modalRoot').textContent)&&!decisionRecoveryBusy&&document.querySelector('#modalRoot [data-act="apply-decision-recovery"]')?.disabled===true,'#modalRoot [data-act="apply-decision-recovery"]');await capture('write-refused');
 ordinaryDecisionOptions.cloudWriteFail=false;
 await ui.act('review-decision-recovery',()=>{const root=document.getElementById('modalRoot'),light=root.querySelector('[data-act="choose-decision-recovery"][data-value="light"]');return light&&!light.disabled&&light.getAttribute('aria-pressed')==='false'&&root.querySelector('[data-act="apply-decision-recovery"]')?.disabled===true&&!/Cloud sync is not confirmed|Reading this device and the current cloud source/i.test(root.textContent);},'#modalRoot [data-act="review-decision-recovery"]');await capture('reviewed-retry');
 await ui.act('choose-decision-recovery',()=>document.querySelector('#modalRoot [data-value="light"]')?.getAttribute('aria-pressed')==='true'&&document.querySelector('#modalRoot [data-act="apply-decision-recovery"]')?.disabled===false,lightSelector);await capture('selected-retry');
 await confirmedAction(ui,'apply-decision-recovery',async()=>{const head=await ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;return !document.querySelector('#modalRoot .modal')&&CloudSync?.status==='ok'&&state.syncDirty===false&&state.syncRev>4&&state.settings.theme==='light'&&state.tasks.length===64&&saved?.settings?.theme==='light'&&saved.tasks.length===64&&saved.syncDirty===false;},'#modalRoot [data-act="apply-decision-recovery"]');await settled();await capture('applied');await capture('final-source');
 const semantic=verifySavedDecisionSources(snapshots);ui.recordRepeatOutcome(scenario,attempts,JSON.stringify(semantic));
  });

  const decisionOptions={authMode:'reconcile-held',remote:sameBoardRemote()};
  await h.scenario('Settings decision review offers Light and saves it while protecting failures',decisionOptions,async ui=>{
    await ui.page.waitForFunction(()=>window.CloudSync?.ready===true&&window.CloudSync.user==='fixture@example.invalid'&&
      window.CloudSync.status==='ok'&&state.syncDirty===false&&!pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy,null,{timeout:10000});
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    await ui.fill('#stHorizon','61');
    await ui.act('save-settings',()=>!document.querySelector('#stHorizon')&&state.settings.horizonMin===61&&
      state.decisionBaseline?.account==='fixture@example.invalid'&&
      state.decisionEvents?.some(event=>event.kind==='current-choice'&&event.target?.type==='setting'&&
        event.target.property==='horizonMin'&&event.value===61),'#modalRoot [data-act="save-settings"]');
    await ui.waitFor(()=>window.CloudSync?.ready===true&&window.CloudSync.status==='ok'&&state.syncDirty===false&&
      !pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy,12000,'publish the real saved-settings decision baseline');
    const savedDeviceDecision=await ui.page.evaluate(async()=>{
      const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;
      const hasDecision=board=>board?.decisionEvents?.some(event=>event.kind==='current-choice'&&event.target?.type==='setting'&&
        event.target.property==='horizonMin'&&event.value===61)===true;
      return {currentHorizon:state.settings.horizonMin,storedHorizon:stored?.settings?.horizonMin,
        currentDecision:hasDecision(state),storedDecision:hasDecision(stored)};
    });
    assert.deepEqual(savedDeviceDecision,{currentHorizon:61,storedHorizon:61,currentDecision:true,storedDecision:true},
      'The real Settings choice is durably saved on this device');
    const savedDecisionBoard=await readRemoteBoard(decisionOptions.remote,'The real Settings save');
    assertFixtureBoard(savedDecisionBoard,'The real Settings save');
    assert.equal(savedDecisionBoard.settings.horizonMin,61,'The actual saved setting reaches the cloud fixture');
    assert.equal(savedDecisionBoard.decisionBaseline?.account,'fixture@example.invalid','The cloud fixture contains an account-bound decision baseline');
    assert.ok(savedDecisionBoard.decisionEvents?.some(event=>event.kind==='current-choice'&&event.target?.type==='setting'&&
      event.target.property==='horizonMin'&&event.value===61),'The cloud fixture contains the observed Settings choice');
    await assertCurrentAndStoredFixtureBoard(ui,'Saved decision baseline setup');
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');

    decisionOptions.cloudReadFail=true;
    await ui.act('review-decision-recovery',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      const modal=document.querySelector('#modalRoot');
      return modal?.querySelector('h2')?.textContent==='Review saved decisions'&&
        /cloud could not be read/i.test(modal.textContent)&&
        !modal.querySelector('[data-act="choose-decision-recovery"]')&&
        modal.querySelector('[data-act="apply-decision-recovery"]')?.disabled===true&&
        state.settings.theme==='light'&&saved?.settings?.theme==='light'&&state.tasks.length===400;
    },'#modalRoot [data-act="review-decision-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Saved-decision review read failure');

    decisionOptions.cloudReadFail=false;
    await ui.act('review-decision-recovery',()=>{
      const modal=document.querySelector('#modalRoot'),light=modal?.querySelector('[data-act="choose-decision-recovery"][data-value="light"]');
      return modal?.querySelector('h2')?.textContent==='Review saved decisions'&&
        /Saved appearance:\s*light/i.test(modal.textContent)&&light&&!light.disabled&&
        light.getAttribute('aria-pressed')==='false'&&modal.querySelector('[data-act="apply-decision-recovery"]')?.disabled===true&&
        !/Reading this device and the current cloud source/i.test(modal.textContent);
    },'#modalRoot [data-act="review-decision-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Saved-decision review');
    await ui.act('choose-decision-recovery',()=>{
      const modal=document.querySelector('#modalRoot'),light=modal?.querySelector('[data-act="choose-decision-recovery"][data-value="light"]');
      return light?.getAttribute('aria-pressed')==='true'&&modal.querySelector('[data-act="apply-decision-recovery"]')?.disabled===false;
    },'#modalRoot [data-act="choose-decision-recovery"][data-value="light"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Selected saved appearance');

    const rootBeforeFailure=structuredClone(decisionOptions.remote.get(MANIFEST));
    decisionOptions.cloudWriteFail=true;
    await ui.act('apply-decision-recovery',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      const modal=document.querySelector('#modalRoot');
      return modal?.querySelector('h2')?.textContent==='Review saved decisions'&&
        /cloud sync is not confirmed/i.test(modal.textContent)&&
        state.settings.theme==='light'&&saved?.settings?.theme==='light'&&state.tasks.length===400&&
        modal.querySelector('[data-act="apply-decision-recovery"]')?.disabled===true;
    },'#modalRoot [data-act="apply-decision-recovery"]');
    assert.deepEqual(decisionOptions.remote.get(MANIFEST),rootBeforeFailure,'A refused decision write leaves its current cloud root unchanged');
    await assertCurrentAndStoredFixtureBoard(ui,'Refused saved-decision publication');

    decisionOptions.cloudWriteFail=false;
    await ui.act('review-decision-recovery',()=>{
      const modal=document.querySelector('#modalRoot'),light=modal?.querySelector('[data-act="choose-decision-recovery"][data-value="light"]');
      return modal?.querySelector('h2')?.textContent==='Review saved decisions'&&light&&!light.disabled&&
        modal.querySelector('[data-act="apply-decision-recovery"]')?.disabled===true&&
        !/Cloud sync is not confirmed/i.test(modal.textContent)&&
        !/Reading this device and the current cloud source/i.test(modal.textContent);
    },'#modalRoot [data-act="review-decision-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Saved-decision review after refused publication');
    await ui.act('choose-decision-recovery',()=>{
      const modal=document.querySelector('#modalRoot'),light=modal?.querySelector('[data-act="choose-decision-recovery"][data-value="light"]');
      return light?.getAttribute('aria-pressed')==='true'&&modal.querySelector('[data-act="apply-decision-recovery"]')?.disabled===false;
    },'#modalRoot [data-act="choose-decision-recovery"][data-value="light"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Selected saved appearance for retry');
    await confirmedAction(ui,'apply-decision-recovery',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return !document.querySelector('#modalRoot .modal')&&window.CloudSync?.status==='ok'&&state.syncDirty===false&&state.syncRev>4&&
        state.settings.theme==='light'&&state.tasks.length===400&&saved?.settings?.theme==='light'&&
        saved.tasks.length===400&&saved.syncDirty===false;
    },'#modalRoot [data-act="apply-decision-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Saved-decision recovery');
    await assertPublished(decisionOptions.remote,'Saved-decision recovery');
    const appliedDecisionBoard=await readRemoteBoard(decisionOptions.remote,'The saved appearance decision');
    assert.equal(appliedDecisionBoard.settings.theme,'light','The confirmed cloud board keeps the selected appearance');
    assert.ok(appliedDecisionBoard.decisionEvents?.some(event=>event.kind==='current-choice'&&event.target?.type==='setting'&&
      event.target.property==='theme'&&event.value==='light'),'The confirmed cloud board records the new appearance decision');
  });
}
