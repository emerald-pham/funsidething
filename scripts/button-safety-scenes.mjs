import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Full-app scenarios for the scene, motion, location, and help controls.
// Expected results inspect only rendered DOM or the app's read-only public state.
function sceneFixture({seenQuickStart=true}={}){
  return {decorate(board){
    board.seenQuickStart=seenQuickStart;
    board.settings={...board.settings,theme:'light',scene:{time:null,season:null,location:null}};
  }};
}

function disclosureExpectation(index,open){
  // Playwright serializes the predicate into the page, so embed only the
  // numeric summary index and expected boolean instead of capturing Node state.
  return new Function(`return document.querySelectorAll('#modalRoot .help summary')[${index}]?.parentElement.open === ${open};`);
}

function scenePresetExpectation(preset){
  // Presets are a fixed list below; embedding the literal keeps this predicate
  // independent of Node closures when Playwright evaluates it in the page.
  const value=JSON.stringify(preset);
  return new Function(`return state.settings.scene.time===${value}
    && [...document.querySelectorAll('#sceneTimeDialog [data-scene-preset]')].some(button=>button.dataset.scenePreset===${value}
      && button.getAttribute('aria-pressed')==='true');`);
}

export async function runSceneScenarios(h){
  await h.scenario('ordinary scene choice survives reopen and task Undo',{retainedCopies:3,decorate:board=>{
    board.mode='work';board.chain=['synthetic-kept'];board.candidateId=null;board.listOpen=true;board.protectedBackupIds=['gate-retained-1'];
    board.tasks[63].ratingHistory=[{v:1,id:'ordinary-scene-prior-history',at:1000,seq:1,kind:'edit',after:{mu:25,sigma:8.333333333,likelihood:1/64,eligible:true,fallback:false,topK:1,n:64,samples:250},basis:'ordinary-scene-prior-basis',futureHistory:{opaque:['retain',19]}}];
    board.tasks[63].ratingHistoryHead='ordinary-scene-prior-history';
  }},async ui=>{
 const hash=value=>createHash('sha256').update(value).digest('hex'),copy=value=>JSON.parse(JSON.stringify(value));
 const scenario='ordinary scene choice survives reopen and task Undo',exactKeys=(value,keys,label)=>assert.deepEqual(Object.keys(value).sort(),keys.slice().sort(),label);
 const taskLiteral={id:'synthetic-kept',title:'Synthetic retained task',url:null,due:null,startsAt:null,evergreen:false,evergreenHours:18,evergreenResetAtDay:true,mu:25,sigma:8.333333333,done:false,createdAt:1,completedAt:null,lastDoneAt:null,ctx:[],futureTask:{opaque:['retain',7]}};
 const expectedSeed={v:1,tasks:[copy(taskLiteral)],contexts:[],chain:['synthetic-kept'],considered:{},cantAt:{},workedAt:{},workLog:[],mode:'work',scanMode:'descending',candidateId:null,passId:'synthetic-existing-pass',passStartedAt:0,interventionActive:false,interventionP:0,snooze:0,decisionsMs:[],presentedAt:0,listOpen:true,ctxOpen:true,histOpen:false,updatedAt:1,syncAccount:null,syncRev:0,syncDirty:true,seenQuickStart:true,settings:{scanMode:'descending',theme:'light',skipOldestFirstDot:false,horizonMin:60,thresholdPct:25,samples:250,cantMin:30,workedHours:8},futureBoard:{opaque:['retain',11]}};
 for(let index=1;index<64;index++)expectedSeed.tasks.push({...copy(taskLiteral),id:'synthetic-populated-'+index,title:'Synthetic retained task '+index,createdAt:1+index,futureTask:{opaque:['retain',index]}});
 expectedSeed.futurePopulated={version:7,opaque:'p'.repeat(1048576)};expectedSeed.protectedBackupIds=['gate-retained-1'];
 const priorHistory={v:1,id:'ordinary-scene-prior-history',at:1000,seq:1,kind:'edit',after:{mu:25,sigma:8.333333333,likelihood:1/64,eligible:true,fallback:false,topK:1,n:64,samples:250},basis:'ordinary-scene-prior-basis',futureHistory:{opaque:['retain',19]}};
 expectedSeed.tasks[63].ratingHistory=[copy(priorHistory)];expectedSeed.tasks[63].ratingHistoryHead=priorHistory.id;
 const seedRaw=JSON.stringify(expectedSeed),seedHash=hash(seedRaw),manualIds=['gate-retained-0','gate-retained-1','gate-retained-2'],manualPayloads=[0,1,2].map(index=>JSON.stringify({...expectedSeed,futureSourceRole:index}));
 const expectedLive=copy(expectedSeed);expectedLive.v=2;expectedLive.tasks=expectedLive.tasks.map(row=>({...row,prerequisiteRevision:0,prerequisiteIds:[],prerequisiteId:null,prerequisiteMirror:null,prerequisiteOps:{}}));
 expectedLive.settings={horizonMin:60,thresholdPct:25,samples:250,cantMin:30,workedHours:16,postponeHours:1,evergreenHours:18,evergreenResetAtDay:true,scanMode:'descending',squaredDefaultVersion:1,listMetric:'rank',excludeNoContext:false,lastTaskWoop:false,skipOldestFirstDot:false,floatingHeader:false,patternedIndicators:false,showPostpone:true,theme:'light',dateFormat:'system',hourlyQuotes:{},scene:{time:null,season:null,location:null}};
 Object.assign(expectedLive,{deletionLog:[],deletedTaskIds:{},clearedHistoryIds:{},restoredTaskIds:{},restoredHistoryIds:{},restoredTaskOps:{},restoredHistoryOps:{},deletedAfterRestoreOps:{},clearedAfterRestoreOps:{},chance:null,addOpen:true});
 const opaqueLiteral={type:'array',items:[{type:'object',entries:[['key',{type:'string',value:'gate-opaque-exact'}],['raw',{type:'string',value:'opaque exact bytes\u0000retain'}],['futureBytes',{type:'typed-array',constructor:'Uint8Array',buffer:{type:'array-buffer',base64:'ABH/'},byteOffset:0,length:3}],['futureMinusZero',{type:'special-number',value:'-0'}]]}],properties:[]};
 const snapshotKeys=['current','currentHash','durable','durableHash','capturedAtMs','backups','opaque','pending','pendingOwner','hold','timeZone','view','presses','clicks'];
 const pendingLiteral={generationId:'gate-pending',payloadHash:seedHash,baseRev:0,updatedAt:7,account:'gate-owner'},chosenScene={time:'23:15',season:'winter',location:null};
 const titleEdits=[{id:'synthetic-kept',title:'Scene first independent task edit'},{id:'synthetic-populated-1',title:'Scene second independent task edit'}];
 const safeValue=(node,value,label)=>{
  if(value===undefined){assert.deepEqual(node,{type:'undefined'},label);return;}
  if(value===null){assert.deepEqual(node,{type:'null'},label);return;}
  if(typeof value!=='object'){assert.ok(['string','number','boolean'].includes(typeof value));if(typeof value==='number')assert.ok(Number.isFinite(value)&&!Object.is(value,-0));assert.deepEqual(node,{type:typeof value,value},label);return;}
  if(Array.isArray(value)){exactKeys(node,['type','items','properties'],label);assert.equal(node.type,'array');assert.deepEqual(node.properties,[]);assert.deepEqual(Object.keys(value),Array.from({length:value.length},(_,i)=>String(i)));assert.equal(node.items.length,value.length);value.forEach((item,index)=>safeValue(node.items[index],item,label+'['+index+']'));return;}
  exactKeys(node,['type','entries'],label);assert.equal(node.type,'object');assert.ok(node.entries.every(row=>Array.isArray(row)&&row.length===2));assert.deepEqual(node.entries.map(row=>row[0]),Object.keys(value));node.entries.forEach(([key,item])=>safeValue(item,value[key],label+'.'+key));
 };
 const rowsExact=(actual,expected,label)=>{assert.equal(actual.length,expected.length,label);assert.equal(new Set(actual.map(row=>row.id)).size,actual.length,label);for(const row of expected){const matches=actual.filter(item=>item.id===row.id);assert.equal(matches.length,1,label);assert.deepEqual(matches[0],row,label);assert.equal(JSON.stringify(matches[0]),JSON.stringify(row),label);}};
 const fnv=text=>{let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return h>>>0;};
 const ratings=expectedSeed.tasks.map(task=>({taskId:task.id,mu:25,sigma:8.333333333})).sort((a,b)=>a.taskId<b.taskId?-1:a.taskId>b.taskId?1:0),learning=JSON.stringify([null,ratings.map(({taskId,mu,sigma})=>[taskId,mu,sigma]),[]]);
 const expectedBaseline={v:1,account:null,sourceBaseId:null,sourceRevision:0,includedActionIds:[],ratings,chainIds:['synthetic-kept'],passId:'synthetic-existing-pass',passAt:0,considered:{},cantAt:{},workedAt:{},observedRatingHistoryIds:[priorHistory.id],id:'dlb2:'+Array.from({length:4},(_,index)=>fnv('decision-learning-v2:'+index+':'+learning).toString(16).padStart(8,'0')).join('')};
 const basisInput=JSON.stringify([ratings.map(({taskId,mu,sigma})=>[taskId,mu,sigma,true]),250]),historyBasis=fnv('history:'+basisInput).toString(16)+':'+fnv('basis:'+basisInput).toString(16)+':'+basisInput.length;
 const frontier=events=>{const named=new Set(events.flatMap(row=>row.observedActionIds));return events.map(row=>row.id).filter(id=>!named.has(id)).sort();};
 const verifySceneSources=phases=>{
  const names=['seed','locked','closed','reopened','edit-one','edit-two','undone-two','final-source'];assert.deepEqual(phases.map(row=>row.phase),names,'All complete scene sources are retained in order');
  const[seed,locked,closed,reopened,first,second,undone,finalSource]=phases;
  const docOne=['act:settings','act:scene-time-settings','scene-time:lock','scene-time:close','act:close-modal'],docTwo=['act:edit','act:save-edit','act:edit','act:save-edit','act:undo','act:undo'];
  const prefixes=[[],docOne.slice(0,3),docOne,[],docTwo.slice(0,2),docTwo.slice(0,4),docTwo,docTwo];
  const fullInput=(phase,actions)=>{
   assert.equal(phase.presses.length,actions.length);assert.equal(phase.clicks.length,actions.length);
   actions.forEach((action,index)=>{const press=phase.presses[index],click=phase.clicks[index];exactKeys(press,['at','action','pointerType','trusted','offeredTaskId'],'Complete scene down receipt');exactKeys(click,['at','action','trusted','offeredTaskId'],'Complete scene click receipt');assert.equal(press.action,action);assert.equal(click.action,action);assert.equal(press.pointerType,'mouse');assert.equal(press.trusted,true);assert.equal(click.trusted,true);assert.equal(press.offeredTaskId,null);assert.equal(click.offeredTaskId,null);assert.ok(Number.isFinite(press.at)&&Number.isFinite(click.at)&&click.at>=press.at&&click.at<=phase.capturedAtMs);if(index)assert.ok(press.at>phase.clicks[index-1].at);});
  };
  phases.forEach((phase,index)=>{
   exactKeys(phase.sourceValue,['type','entries'],'Complete lossless scene source root');assert.equal(phase.sourceValue.type,'object');assert.equal(phase.sourceValueEncoding,'chain-scanner.manual-archive-value/v1');assert.deepEqual(phase.sourceValue.entries.map(row=>row[0]),snapshotKeys);
   assert.deepEqual(Object.keys(phase).filter(key=>!snapshotKeys.includes(key)&&!['sourceValueEncoding','sourceValue','schemaVersion','phase','scenario','sourceIdentity'].includes(key)),[],'No unexamined source field');
   for(const[key,node]of phase.sourceValue.entries){if(key==='opaque')assert.deepEqual(node,opaqueLiteral,'Exact complete typed opaque original');else safeValue(node,phase[key],'lossless '+key);assert.ok(Object.hasOwn(phase,key));}
   assert.equal(phase.currentHash,hash(phase.current));assert.equal(phase.durableHash,hash(phase.durable));assert.deepEqual(phase.pending,pendingLiteral);assert.equal(phase.pendingOwner,null);assert.equal(phase.hold,null);assert.ok(Number.isSafeInteger(phase.capturedAtMs));assert.equal(typeof phase.timeZone,'string');
   exactKeys(phase.view,['documentId','ready','sceneReady','sceneTime','sceneSeason','sceneIntents','timeDialogOpen','modalOpen','undoDisabled'],'Complete scene UI/mirror state');assert.ok(phase.view.documentId);assert.equal(phase.view.ready,true);assert.equal(phase.view.sceneReady,true);assert.deepEqual(phase.view.sceneIntents,[],'A fully durable accepted scene retires its complete staged scene intent');
   if(index<3)assert.equal(phase.view.documentId,seed.view.documentId);else{assert.notEqual(phase.view.documentId,seed.view.documentId,'The saved scene genuinely reopens in a different app document');assert.equal(phase.view.documentId,reopened.view.documentId);}
   assert.equal(phase.view.sceneTime,index?'23:15':null);assert.equal(phase.view.sceneSeason,index?'winter':null);assert.equal(phase.view.timeDialogOpen,index===1);assert.equal(phase.view.modalOpen,index===1);assert.equal(phase.view.undoDisabled,false,'The public header Undo remains enabled; exact task reversals are verified below');fullInput(phase,prefixes[index]);
  });
  assert.equal(seed.durable,seedRaw,'The full independent64-task raw seed stays exact');assert.equal(seed.durableHash,seedHash);assert.deepEqual(JSON.parse(seed.current),expectedLive,'Complete independently specified hydrated scene seed');
  const originals=manualIds.map((id,index)=>{const row=seed.backups.find(item=>item.id===id);assert.ok(row);exactKeys(row,['id','kind','at','day','payload'],'Complete original manual source');assert.equal(row.kind,'manual');assert.equal(row.day,'2026-10-25');assert.ok(Number.isSafeInteger(row.at)&&row.at>0&&row.at<=seed.capturedAtMs);assert.equal(row.payload,manualPayloads[index]);return copy(row);});rowsExact(seed.backups,originals,'Exactly all three raw manual originals');
  const used=new Set(),fresh=id=>{assert.match(id,/^t.+/);assert.ok(!used.has(id),'Generated identities remain distinct');used.add(id);return id;};
  const eventFields=(event,click,previous)=>{assert.ok(event);fresh(event.id);fresh(event.actionId);assert.ok(Number.isSafeInteger(event.at)&&event.at>=Math.floor(click.at));return{actionId:event.actionId,at:event.at,account:null,baseId:null,passId:'synthetic-existing-pass',passAt:0,scanMode:'descending',chainIds:['synthetic-kept'],observedActionIds:frontier(previous)};};
  const saveTime=(actual,previous,phase,click)=>{assert.ok(Number.isSafeInteger(actual.updatedAt)&&actual.updatedAt>previous.updatedAt&&actual.updatedAt>=Math.floor(click.at)&&actual.updatedAt<=phase.capturedAtMs);return actual.updatedAt;};
  const lockedBoard=JSON.parse(locked.current),sceneEvents=lockedBoard.decisionEvents;assert.equal(sceneEvents?.length,2);
  const sceneAction=fresh(sceneEvents[0].actionId),sceneAt=sceneEvents[0].at;assert.ok(Number.isSafeInteger(sceneAt)&&sceneAt>=Math.floor(locked.clicks[2].at)&&sceneAt<=lockedBoard.updatedAt);
  const expectedEvents=['time','season'].map((property,index)=>{const event=sceneEvents[index];fresh(event.id);const expected={v:1,id:event.id,at:sceneAt,account:null,baseId:null,kind:'current-choice',actionId:sceneAction,target:{type:'scene',id:'board',property},value:chosenScene[property],after:{present:true},before:{present:true,value:null},passId:'synthetic-existing-pass',passAt:0,scanMode:'descending',chainIds:['synthetic-kept'],observedActionIds:[]};assert.deepEqual(event,expected,'Complete literal scene choice event');return expected;});
  const expectedLocked=copy(expectedLive);expectedLocked.settings.scene=copy(chosenScene);expectedLocked.decisionBaseline=copy(expectedBaseline);expectedLocked.decisionEvents=copy(expectedEvents);expectedLocked.updatedAt=saveTime(lockedBoard,expectedLive,locked,locked.clicks[2]);assert.ok(sceneAt<=expectedLocked.updatedAt);
  assert.deepEqual(lockedBoard,expectedLocked,'Only the independently chosen scene and its complete authority/save facts change');assert.equal(locked.current,JSON.stringify(expectedLocked));assert.equal(locked.durable,locked.current);
  for(const phase of[closed,reopened]){assert.equal(phase.current,locked.current);assert.equal(phase.durable,locked.durable);rowsExact(phase.backups,locked.backups,'Closing/reopening preserves every exact saved source');}
  const expectedBoards=[expectedLocked],titleEvents=[];let previous=copy(expectedLocked);
  for(let index=0;index<2;index++){
   const phase=[first,second][index],actual=JSON.parse(phase.current),edit=titleEdits[index],event=actual.decisionEvents?.at(-1),click=phase.clicks[index*2+1],fields=eventFields(event,click,previous.decisionEvents),before=expectedLive.tasks.find(task=>task.id===edit.id).title;
   const expectedEvent={v:1,id:event.id,at:fields.at,account:null,baseId:null,kind:'current-choice',actionId:fields.actionId,target:{type:'task',id:edit.id,property:'title'},value:edit.title,after:{present:true},before:{present:true,value:before},taskContextIds:{[edit.id]:[]},passId:'synthetic-existing-pass',passAt:0,scanMode:'descending',chainIds:['synthetic-kept'],observedActionIds:fields.observedActionIds};assert.deepEqual(event,expectedEvent);titleEvents.push(copy(expectedEvent));
   const expected=copy(previous),task=expected.tasks.find(task=>task.id===edit.id),observed=actual.tasks.find(task=>task.id===edit.id),row=observed.ratingHistory?.[0];assert.equal(observed.ratingHistory.length,1);fresh(row.id);assert.ok(Number.isSafeInteger(row.at)&&row.at>=fields.at&&row.at<=actual.updatedAt);assert.ok(Number.isSafeInteger(row.after.topK)&&row.after.topK>=1&&row.after.topK<=64);
   const expectedRow={v:1,id:row.id,at:row.at,seq:1,kind:'edit',change:'observation',after:{mu:25,sigma:8.333333333,likelihood:1/64,eligible:true,fallback:false,topK:row.after.topK,n:64,samples:250},basis:historyBasis};assert.deepEqual(row,expectedRow,'Complete title-only editor observation, with actual independently bounded sampled rank');
   task.title=edit.title;task.ratingHistory=[expectedRow];task.ratingHistoryHead=row.id;expected.decisionEvents.push(expectedEvent);expected.updatedAt=saveTime(actual,previous,phase,click);assert.ok(event.at<=actual.updatedAt);assert.deepEqual(actual,expected,'The complete edit board preserves every unrelated field/history/source');assert.equal(phase.current,JSON.stringify(expected));assert.equal(phase.durable,phase.current);expectedBoards.push(copy(expected));previous=copy(expected);
  }
  const undoBoard=JSON.parse(undone.current),undoEvents=[];let undoOneTemplate;
  assert.equal(undoBoard.decisionEvents?.length,6,'Both scene choices, both title edits and two exact Undo facts remain ordered');
  for(let index=0;index<2;index++){
   const event=undoBoard.decisionEvents[4+index],click=undone.clicks[4+index],fields=eventFields(event,click,previous.decisionEvents),target=titleEvents[1-index];
   const expectedEvent={...fields,v:1,id:event.id,kind:'undo',baselineId:expectedBaseline.id,targetActionId:target.actionId,targetEventIds:[target.id]};assert.deepEqual(event,expectedEvent,'Each trusted Undo reverses exactly its own latest task edit');assert.ok(event.at<=undoBoard.updatedAt);undoEvents.push(copy(expectedEvent));previous.decisionEvents.push(expectedEvent);previous.tasks.find(task=>task.id===titleEdits[1-index].id).title=expectedLive.tasks.find(task=>task.id===titleEdits[1-index].id).title;if(!index)undoOneTemplate=copy(previous);
  }
  previous.updatedAt=saveTime(undoBoard,expectedBoards[2],undone,undone.clicks[5]);assert.deepEqual(undoBoard,previous,'Both task titles reverse while scene choices, all histories and every other current field stay exact');assert.equal(undone.current,JSON.stringify(previous));assert.equal(undone.durable,undone.current);expectedBoards.push(copy(previous));
  for(const key of snapshotKeys.filter(key=>!['capturedAtMs'].includes(key)))assert.deepEqual(finalSource[key],undone[key],'A final read retains complete '+key);
  const dayAt=(at,timeZone)=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));return['year','month','day'].map(type=>parts.find(row=>row.type===type).value).join('-');};
  const daily=new Map(),sourceIds=new Set(manualIds),sourceNonces=new Set();let oldLatest;
  for(let index=0;index<4;index++){
   const phase=[locked,first,second,undone][index],expected=expectedBoards[index],click=phase.clicks[index===0?2:index<3?(index-1)*2+1:5],generated=phase.backups.filter(row=>!manualIds.includes(row.id));assert.ok(generated.every(row=>['daily','latest'].includes(row.kind)));const latest=generated.filter(row=>row.kind==='latest');assert.equal(latest.length,1);
   const automatic=(row,kind,raw,lower,upper)=>{exactKeys(row,['id','day','at','kind','payload'],'Complete automatic source row');assert.equal(row.kind,kind);assert.equal(row.payload,raw);assert.ok(Number.isSafeInteger(row.at)&&row.at>=Math.floor(lower)&&row.at<=upper);const identity=row.id.match(/^(daily|latest):([0-9]+):(t.+)$/);assert.ok(identity&&identity[1]===kind);assert.ok(Number(identity[2])>=row.at&&Number(identity[2])<=phase.capturedAtMs);assert.ok(!sourceIds.has(row.id)&&!sourceNonces.has(identity[3]));sourceIds.add(row.id);sourceNonces.add(identity[3]);assert.equal(row.day,dayAt(row.at,phase.timeZone));};
   automatic(latest[0],'latest',JSON.stringify(expected),click.at,phase.capturedAtMs);if(oldLatest)assert.ok(!phase.backups.some(row=>row.id===oldLatest));oldLatest=latest[0].id;
   for(const row of generated.filter(row=>row.kind==='daily'))if(!daily.has(row.day)){
    let raw=JSON.stringify(expected),lower=click.at,upper=phase.capturedAtMs;
    if(index===3&&row.at<Math.floor(click.at)){const middle=JSON.parse(row.payload);assert.ok(Number.isSafeInteger(middle.updatedAt)&&middle.updatedAt>=undoEvents[0].at&&middle.updatedAt<undone.presses[5].at);const independent=copy(undoOneTemplate);independent.updatedAt=middle.updatedAt;assert.deepEqual(middle,independent,'A day boundary may retain only the complete independently specified first Undo board');raw=JSON.stringify(independent);lower=undone.clicks[4].at;upper=undone.presses[5].at;}
    automatic(row,'daily',raw,lower,upper);daily.set(row.day,copy(row));
   }
   assert.equal(daily.has(latest[0].day),true,'Every saved local day has its exact first daily source');rowsExact(phase.backups,[...originals,...daily.values(),latest[0]],'Every original/automatic lifecycle source is accounted');
  }
  assert.deepEqual(undoBoard.tasks[63].ratingHistory,[priorHistory]);assert.deepEqual(undoBoard.settings.scene,chosenScene);assert.deepEqual(undoBoard.tasks.slice(0,2).map(task=>task.title),expectedLive.tasks.slice(0,2).map(task=>task.title));
  return{phases:names,chosenScene:copy(chosenScene),reopened:true,documentIds:[seed.view.documentId,reopened.view.documentId],editTaskIds:titleEdits.map(row=>row.id),sceneEventIds:expectedEvents.map(row=>row.id),taskEditEventIds:titleEvents.map(row=>row.id),undoEventIds:undoEvents.map(row=>row.id),orderedUndoTargets:titleEvents.slice().reverse().map(row=>row.id),currentHash:undone.currentHash,durableHash:undone.durableHash,fullBoardsPreserved:true,sceneAuthorityRetained:true,priorHistoryPreserved:true,typedOpaquePreserved:true,pendingPreserved:true,allOriginalSourcesPreserved:true,automaticLifecycleValidated:true};
 };
 const snapshots=[];
 const sourceSnapshot=()=>ui.page.evaluate(async()=>{
  const head=await ScannerDeviceStore.readHead(),current=JSON.stringify(state),sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const snapshot={current,currentHash:await sha256(current),durable:head.payload,durableHash:head.hash,capturedAtMs:Date.now(),backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),pending:await ScannerDeviceStore.getPendingUpload('gate-owner'),pendingOwner:await ScannerDeviceStore.getPendingUpload('owner'),hold:await ScannerDeviceStore.getRecoveryCloudHold(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
   view:{documentId:window.__installedFixture.documentId,ready:document.documentElement.dataset.appReady==='true',sceneReady:typeof window.applySyncedSceneTime==='function',sceneTime:LivingSky.readSceneTime(localStorage),sceneSeason:LivingSky.readSceneSeason(localStorage),sceneIntents:Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).filter(key=>key.startsWith('fvp:chain-scanner:pending-scene-choice:v1:')).sort().map(key=>({key,raw:localStorage.getItem(key)})),timeDialogOpen:document.getElementById('sceneTimeDialog')?.open===true,modalOpen:!!document.querySelector('#modalRoot .modal'),undoDisabled:document.querySelector('#appHeader [data-act="undo"]').disabled},presses:structuredClone(window.__buttonNativePresses),clicks:structuredClone(window.__buttonNativeClicks)};
  snapshot.capturedAtMs=Date.now();return{...snapshot,sourceValueEncoding:'chain-scanner.manual-archive-value/v1',sourceValue:encodeManualArchiveValue(snapshot,'ordinary scene choice sourceSnapshot')};
 });
 const capture=async phase=>{const snapshot=await sourceSnapshot();ui.recordOrdinaryWoopPhase(phase,snapshot);snapshots.push({phase,...snapshot});return snapshot;};
 await ui.waitFor(()=>document.documentElement.dataset.appReady==='true'&&typeof window.applySyncedSceneTime==='function',12000,'Existing scene controls finish loading');
 await capture('seed');
 await ui.act('settings',()=>!!document.querySelector('#modalRoot .settings-section'));
 await ui.act('scene-time-settings',()=>document.getElementById('sceneTimeDialog')?.open===true,'#modalRoot [data-act="scene-time-settings"]');
 await ui.fill('#sceneTimeInput','23:15');await ui.select('#sceneSeasonInput','winter');
 await ui.click('#sceneTimeDialog [data-scene-time="lock"]',async()=>{const head=await ScannerDeviceStore.readHead();return state.settings.scene.time==='23:15'&&state.settings.scene.season==='winter'&&document.getElementById('sceneTimeDialog')?.open===true&&head?.payload===JSON.stringify(state)&&!Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).some(key=>key.startsWith('fvp:chain-scanner:pending-scene-choice:v1:'));},'Lock independent23:15 winter scene and verify its complete durable save');
 const locked=await capture('locked');
 await ui.click('#sceneTimeDialog [data-scene-time="close"]',()=>document.getElementById('sceneTimeDialog')?.open===false,'Close saved scene dialog');
 await ui.act('close-modal',()=>!document.querySelector('#modalRoot .modal'),'#modalRoot [data-act="close-modal"]');await capture('closed');
 await ui.reopenOrdinaryWoop();await capture('reopened');
 await ui.act('edit',()=>!!document.getElementById('etTitle'),'#listBody [data-act="edit"][data-id="synthetic-kept"]');
 await ui.fill('#etTitle','Scene first independent task edit');
 await ui.act('save-edit',async()=>{const head=await ScannerDeviceStore.readHead();return !document.getElementById('etTitle')&&state.tasks.find(task=>task.id==='synthetic-kept')?.title==='Scene first independent task edit'&&head?.payload===JSON.stringify(state);},'#modalRoot [data-act="save-edit"]');await capture('edit-one');
 await ui.act('edit',()=>!!document.getElementById('etTitle'),'#listBody [data-act="edit"][data-id="synthetic-populated-1"]');
 await ui.fill('#etTitle','Scene second independent task edit');
 await ui.act('save-edit',async()=>{const head=await ScannerDeviceStore.readHead();return !document.getElementById('etTitle')&&state.tasks.find(task=>task.id==='synthetic-populated-1')?.title==='Scene second independent task edit'&&head?.payload===JSON.stringify(state);},'#modalRoot [data-act="save-edit"]');await capture('edit-two');
 const attempts=await ui.repeat('act:undo',2,async()=>{const head=await ScannerDeviceStore.readHead(),first=state.tasks.find(task=>task.id==='synthetic-kept'),second=state.tasks.find(task=>task.id==='synthetic-populated-1');return state.settings.scene.time==='23:15'&&state.settings.scene.season==='winter'&&['Scene first independent task edit','Synthetic retained task'].includes(first?.title)&&second?.title==='Synthetic retained task 1'&&head?.payload===JSON.stringify(state);},'#appHeader [data-act="undo"]','Undo each of two separately saved task edits while keeping the chosen scene');
 await capture('undone-two');await capture('final-source');const semantic=verifySceneSources(snapshots);
 // The validated first-document Lock belongs to this repeat after the reopen.
 const lockPress=locked.presses.find(row=>row.action==='scene-time:lock');
 const lockAttempt={receiptId:scenario+':scene-time:lock:'+locked.view.documentId+':'+lockPress.at,actionFamily:lockPress.action,trusted:lockPress.trusted,result:'accepted',receiptAtMs:lockPress.at};
 ui.recordRepeatOutcome(scenario,[lockAttempt,...attempts],JSON.stringify(semantic));
  });

  await h.scenario('theme preference changes through its button',sceneFixture(),async ui=>{
    await ui.act('cycle-theme',()=>state.settings.theme==='dark'&&document.documentElement.getAttribute('data-theme')==='dark','#themeBtn');
  });

  await h.scenario('motion settings open and both choices respond',sceneFixture(),async ui=>{
    await ui.act('scene-settings',()=>document.getElementById('motionDialog')?.open===true,'#motionButton');
    await ui.click('#motionDialog [data-landscape-motion="normal"]',()=>{
      const choice=JSON.parse(localStorage.getItem('fvp:chain-scanner:landscape-motion'));
      return !document.getElementById('motionDialog')?.open
        && document.querySelector('#motionDialog [data-landscape-motion="normal"]')?.getAttribute('aria-pressed')==='true'
        && choice?.choice==='normal';
    },'Choose normal motion');
    await ui.act('scene-settings',()=>document.getElementById('motionDialog')?.open===true,'#motionButton');
    await ui.click('#motionDialog [data-landscape-motion="reduced"]',()=>{
      const choice=JSON.parse(localStorage.getItem('fvp:chain-scanner:landscape-motion'));
      return !document.getElementById('motionDialog')?.open
        && document.querySelector('#motionDialog [data-landscape-motion="reduced"]')?.getAttribute('aria-pressed')==='true'
        && choice?.choice==='reduced'
        && document.documentElement.dataset.landscapeMotion==='reduced';
    },'Choose reduced motion');
  });

  await h.scenario('scene time presets, lock, live time, and close',sceneFixture(),async ui=>{
    await ui.act('settings',()=>!!document.querySelector('#modalRoot .settings-section'));
    await ui.act('scene-time-settings',()=>document.getElementById('sceneTimeDialog')?.open===true,'#modalRoot [data-act="scene-time-settings"]');
    for(const preset of ['00:00','12:00','first-light','sunrise','sunset','last-light']){
      await ui.click(`[data-scene-preset="${preset}"]`,scenePresetExpectation(preset),`Choose scene preset ${preset}`);
    }
    await ui.fill('#sceneTimeInput','21:15');
    await ui.select('#sceneSeasonInput','winter');
    await ui.click('#sceneTimeDialog [data-scene-time="lock"]',()=>state.settings.scene.time==='21:15'
      && state.settings.scene.season==='winter'&&document.getElementById('sceneTimeDialog')?.open===true,'Lock scene time');
    await ui.click('#sceneTimeDialog [data-scene-time="live"]',()=>state.settings.scene.time===null
      && state.settings.scene.season===null&&document.getElementById('sceneTimeDialog')?.open===true,'Use live scene time');
    await ui.click('#sceneTimeDialog [data-scene-time="close"]',()=>document.getElementById('sceneTimeDialog')?.open===false,'Close scene time');
  });

  await h.scenario('location request, save name, reset, and close',sceneFixture(),async ui=>{
    await ui.act('settings',()=>!!document.querySelector('#modalRoot .settings-section'));
    await ui.act('location-settings',()=>document.getElementById('locationDialog')?.open===true,'#modalRoot [data-act="location-settings"]');
    await ui.click('#locationDialog [data-location-action="request"]',()=>document.getElementById('locationDialog')?.open===true
      && document.getElementById('locationCurrent')?.textContent==='Near New York, NY'
      && state.settings.scene.location?.enabled===true
      && state.settings.scene.location.latitude===40.7
      && state.settings.scene.location.longitude===-74,'Request location');
    await ui.fill('#locationName','Safety scenario sky');
    await ui.fill('#locationTimezone','America/Los_Angeles');
    await ui.click('#locationDialog [data-location-action="save-name"]',()=>document.getElementById('locationCurrent')?.textContent==='Safety scenario sky'
      && state.settings.scene.location?.label==='Safety scenario sky'
      && state.settings.scene.location?.timezone==='America/Los_Angeles','Save location name and time zone');
    await ui.click('#locationDialog [data-location-action="reset"]',()=>document.getElementById('locationCurrent')?.textContent==='Using the default sky. Enable location to make it yours.'
      && state.settings.scene.location===null,'Reset location');
    await ui.click('#locationDialog [data-location-action="close"]',()=>document.getElementById('locationDialog')?.open===false,'Close location settings');
  });

  await h.scenario('denied location request leaves the default sky',({...sceneFixture(),geoFail:true}),async ui=>{
    await ui.act('settings',()=>!!document.querySelector('#modalRoot .settings-section'));
    await ui.act('location-settings',()=>document.getElementById('locationDialog')?.open===true,'#modalRoot [data-act="location-settings"]');
    await ui.click('#locationDialog [data-location-action="request"]',()=>document.getElementById('locationDialog')?.open===true
      && document.getElementById('locationCurrent')?.textContent==='Using the default sky. Enable location to make it yours.'
      && /denied/i.test(document.getElementById('locationStatus')?.textContent||'')
      && state.settings.scene.location===null,'Denied location request');
    await ui.click('#locationDialog [data-location-action="close"]',()=>document.getElementById('locationDialog')?.open===false,'Close denied location settings');
  });

  await h.scenario('scene view enters and returns to the task view',sceneFixture(),async ui=>{
    await ui.click('#viewScene',()=>document.documentElement.classList.contains('viewing-scene')
      && document.getElementById('exitScene')?.hidden===false
      && document.querySelector('.wrap')?.inert===true,'Enter scene view');
    await ui.click('#exitScene',()=>!document.documentElement.classList.contains('viewing-scene')
      && document.getElementById('exitScene')?.hidden===true
      && document.querySelector('.wrap')?.inert===false,'Exit scene view');
  });

  await h.scenario('Help FAQ and changelog disclosures toggle and close',sceneFixture(),async ui=>{
    await ui.act('help',()=>!!document.querySelector('#modalRoot .help'));
    const count=await ui.page.locator('#modalRoot .help summary').count();
    if(count<2)throw new Error(`Expected rendered FAQ and changelog disclosures, found ${count}`);
    const labels=[];
    for(let index=0;index<count;index++){
      const selector=await ui.page.locator('#modalRoot .help summary').nth(index).evaluate(summary=>{
        const parts=[];
        for(let node=summary;node&&node.parentElement;node=node.parentElement){
          if(node.id){parts.unshift('#'+CSS.escape(node.id));break;}
          const siblings=[...node.parentElement.children].filter(sibling=>sibling.tagName===node.tagName);
          parts.unshift(node.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(node)+1)+')');
        }
        return parts.join(' > ');
      });
      const label=(await ui.page.locator(selector).evaluate(summary=>summary.textContent.trim())).replace(/\s+/g,' ');
      labels.push(label);
      let open=await ui.page.locator(selector).evaluate(summary=>summary.parentElement.open);
      await ui.click(selector,disclosureExpectation(index,!open),`Toggle ${label} disclosure`);
      open=await ui.page.locator(selector).evaluate(summary=>summary.parentElement.open);
      await ui.click(selector,disclosureExpectation(index,!open),`Toggle ${label} disclosure again`);
    }
    for(const required of ['Quick start','Scene and appearance','Changelog']){
      if(!labels.some(label=>label.toLowerCase().includes(required.toLowerCase())))
        throw new Error(`Expected rendered help disclosure: ${required}`);
    }
    await ui.act('close-modal',()=>!document.querySelector('#modalRoot .modal'),'#modalRoot [data-act="close-modal"]');
  });

  await h.scenario('first-run Quick Start can be acknowledged',sceneFixture({seenQuickStart:false}),async ui=>{
    await ui.act('ok-quickstart',()=>state.seenQuickStart===true&&!document.querySelector('#modalRoot .modal'),'#modalRoot [data-act="ok-quickstart"]');
  });
}
