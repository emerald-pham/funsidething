import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {beginMobileYes,finishMobileYes} from './button-safety-mobile-scenario.mjs';

const ten=(ui,action,expected,selector,semantics)=>ui.burst(action,expected,{selector,semantics,expectedAccepted:10});
const once=(ui,action,expected,selector,semantics)=>ui.burst(action,expected,{selector,semantics,expectedAccepted:1});
const bounded=(ui,action,expected,selector,semantics,min=1,max=10)=>ui.burst(action,expected,{selector,semantics,expectedAccepted:{min,max}});

const activeBoard=board=>{
  board.contexts=[{id:'rapid-context',name:'Rapid context',active:true},{id:'rapid-delete-context',name:'Context to delete',active:true}];
  board.tasks[0].ctx=['rapid-context'];
  board.settings.showPostpone=true;
  board.settings.theme='light';
  board.addOpen=true;board.listOpen=false;board.ctxOpen=true;board.histOpen=false;
};

async function assert400(ui,label){
  const counts=await ui.page.evaluate(async()=>{
    const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;
    return {current:state.tasks.length,stored:stored?.tasks?.length,future:state.futurePopulated?.opaque?.length,
      storedFuture:stored?.futurePopulated?.opaque?.length};
  });
  assert.equal(counts.current,400,label+' starts with 400 active tasks');
  assert.equal(counts.stored,400,label+' starts with 400 durable tasks');
  assert.equal(counts.future,1048576,label+' retains the oversized unknown board field');
  assert.equal(counts.storedFuture,1048576,label+' retains the durable oversized unknown board field');
}

async function waitForStoredTaskCount(ui,count,label){
  const expected=new Function('return async()=>{const head=await window.ScannerDeviceStore.readHead();const stored=head?.payload?JSON.parse(head.payload):null;return state.tasks.length==='+JSON.stringify(count)+'&&stored?.tasks?.length==='+JSON.stringify(count)+'}')();
  await ui.waitFor(expected,12000,label);
}

async function ensureListOpen(ui,open=true){
  const current=await ui.page.evaluate(()=>state.listOpen===true);
  if(!current&&open)await ui.act('toggle-list',()=>state.listOpen===true);
  if(current&&!open)await ui.act('toggle-list',()=>state.listOpen===false);
}

async function ensureAddOpen(ui,open=true){
  const current=await ui.page.evaluate(()=>state.addOpen===true);
  if(!current&&open)await ui.act('toggle-add',()=>state.addOpen===true);
  if(current&&!open)await ui.act('toggle-add',()=>state.addOpen===false);
}

async function openEditor(ui,id){
  await ensureListOpen(ui,true);
  await ui.act('edit',()=>!!document.getElementById('etTitle'),'#listBody [data-act="edit"][data-id="'+id+'"]');
}

async function seedInstallPrompt(ui,outcome){
  await ui.page.evaluate(outcome=>{
    window.__rapidInstallPrompts=0;
    const event=new Event('beforeinstallprompt',{cancelable:true});
    Object.defineProperties(event,{prompt:{value:async()=>{window.__rapidInstallPrompts++;}},userChoice:{value:Promise.resolve({outcome})}});
    dispatchEvent(event);
  },outcome);
}

function historyRows(board){
  const task=board.tasks.find(row=>row.id==='synthetic-populated-6');
  task.ratingHistory=Array.from({length:25},(_,index)=>({v:1,id:'rapid-history-'+index,at:Date.now()-1000+index,
    seq:index+1,kind:index<2?'dislodge':'edit',after:{mu:25,sigma:8.333333333,likelihood:1,eligible:true,fallback:false,n:1,samples:250,topK:1}}));
}

function scannerBoard(board){
  activeBoard(board);board.contexts=[];board.tasks.forEach(task=>{task.ctx=[];task.due=null;task.startsAt=null;task.evergreen=false;});
  board.chain=[];board.considered={};board.cantAt={};board.workedAt={};board.mode='scan';board.candidateId=null;
  board.interventionActive=false;board.snooze=0;board.passStartedAt=0;board.passId='rapid-scan-pass';
  board.settings.thresholdPct=0;board.settings.skipOldestFirstDot=false;board.settings.scanMode='descending';board.settings.showPostpone=true;
}

function benchmarkBoard(board){
  scannerBoard(board);board.mode='work';board.chain=board.tasks.slice(0,20).map(task=>task.id);
  board.passStartedAt=Date.now()-60000;board.passId='rapid-benchmark-pass';
}

async function burstBenchmark(h,action,expected,semantics,expectedAccepted=10){
  await h.scenario('rapid benchmark '+action+' with 400 tasks',{decorate:benchmarkBoard},async ui=>{
    await assert400(ui,'Benchmark '+action);
    await ui.burst(action,expected,{selector:'[data-act="'+action+'"]',semantics,expectedAccepted});
  });
}

export async function runRapidCoreScenarios(h){
  const ordinaryDistinctCase='ordinary two distinct scanner decisions';
  await h.scenario(ordinaryDistinctCase,{retainedCopies:3,decorate:board=>{
    board.chain=['synthetic-kept'];board.candidateId='synthetic-populated-1';board.settings.thresholdPct=0;board.protectedBackupIds=['gate-retained-1'];
    board.tasks[63].ratingHistory=[{v:1,id:'ordinary-distinct-prior-history',at:1000,seq:1,kind:'edit',after:{mu:25,sigma:8.333333333,likelihood:1/64,eligible:true,fallback:false,topK:1,n:64,samples:250},basis:'ordinary-distinct-prior-basis',futureHistory:{opaque:['retain',19]}}];
    board.tasks[63].ratingHistoryHead='ordinary-distinct-prior-history';
  }},async ui=>{
 const hash=value=>createHash('sha256').update(value).digest('hex'),copy=value=>JSON.parse(JSON.stringify(value));
 const scenario='ordinary two distinct scanner decisions',exactKeys=(value,keys,label)=>assert.deepEqual(Object.keys(value).sort(),keys.slice().sort(),label);
 const taskLiteral={id:'synthetic-kept',title:'Synthetic retained task',url:null,due:null,startsAt:null,evergreen:false,evergreenHours:18,evergreenResetAtDay:true,mu:25,sigma:8.333333333,done:false,createdAt:1,completedAt:null,lastDoneAt:null,ctx:[],futureTask:{opaque:['retain',7]}};
 const expectedSeed={v:1,tasks:[copy(taskLiteral)],contexts:[],chain:['synthetic-kept'],considered:{},cantAt:{},workedAt:{},workLog:[],mode:'scan',scanMode:'descending',candidateId:'synthetic-populated-1',passId:'synthetic-existing-pass',passStartedAt:0,interventionActive:false,interventionP:0,snooze:0,decisionsMs:[],presentedAt:0,listOpen:false,ctxOpen:true,histOpen:false,updatedAt:1,syncAccount:null,syncRev:0,syncDirty:true,seenQuickStart:true,settings:{scanMode:'descending',theme:'light',skipOldestFirstDot:false,horizonMin:60,thresholdPct:0,samples:250,cantMin:30,workedHours:8},futureBoard:{opaque:['retain',11]}};
 for(let index=1;index<64;index++)expectedSeed.tasks.push({...copy(taskLiteral),id:'synthetic-populated-'+index,title:'Synthetic retained task '+index,createdAt:1+index,futureTask:{opaque:['retain',index]}});
 expectedSeed.futurePopulated={version:7,opaque:'p'.repeat(1048576)};expectedSeed.protectedBackupIds=['gate-retained-1'];
 const priorHistory={v:1,id:'ordinary-distinct-prior-history',at:1000,seq:1,kind:'edit',after:{mu:25,sigma:8.333333333,likelihood:1/64,eligible:true,fallback:false,topK:1,n:64,samples:250},basis:'ordinary-distinct-prior-basis',futureHistory:{opaque:['retain',19]}};
 expectedSeed.tasks[63].ratingHistory=[copy(priorHistory)];expectedSeed.tasks[63].ratingHistoryHead=priorHistory.id;
 const seedRaw=JSON.stringify(expectedSeed),seedHash=hash(seedRaw),manualIds=['gate-retained-0','gate-retained-1','gate-retained-2'],manualPayloads=[0,1,2].map(index=>JSON.stringify({...expectedSeed,futureSourceRole:index}));
 const expectedLive=copy(expectedSeed);expectedLive.v=2;expectedLive.tasks=expectedLive.tasks.map(row=>({...row,prerequisiteRevision:0,prerequisiteIds:[],prerequisiteId:null,prerequisiteMirror:null,prerequisiteOps:{}}));
 expectedLive.settings={horizonMin:60,thresholdPct:1,samples:250,cantMin:30,workedHours:16,postponeHours:1,evergreenHours:18,evergreenResetAtDay:true,scanMode:'descending',squaredDefaultVersion:1,listMetric:'rank',excludeNoContext:false,lastTaskWoop:false,skipOldestFirstDot:false,floatingHeader:false,patternedIndicators:false,showPostpone:true,theme:'light',dateFormat:'system',hourlyQuotes:{},scene:{time:null,season:null,location:null}};
 Object.assign(expectedLive,{deletionLog:[],deletedTaskIds:{},clearedHistoryIds:{},restoredTaskIds:{},restoredHistoryIds:{},restoredTaskOps:{},restoredHistoryOps:{},deletedAfterRestoreOps:{},clearedAfterRestoreOps:{},chance:null,addOpen:true});
 const opaqueLiteral={type:'array',items:[{type:'object',entries:[['key',{type:'string',value:'gate-opaque-exact'}],['raw',{type:'string',value:'opaque exact bytes\u0000retain'}],['futureBytes',{type:'typed-array',constructor:'Uint8Array',buffer:{type:'array-buffer',base64:'ABH/'},byteOffset:0,length:3}],['futureMinusZero',{type:'special-number',value:'-0'}]]}],properties:[]};
 const snapshotKeys=['current','currentHash','durable','durableHash','capturedAtMs','lastInputAtMs','backups','opaque','pending','pendingOwner','hold','timeZone','view','presses','clicks'];
 const pendingLiteral={generationId:'gate-pending',payloadHash:seedHash,baseRev:0,updatedAt:7,account:'gate-owner'};
 const safeValue=(node,value,label)=>{
  if(value===undefined){assert.deepEqual(node,{type:'undefined'},label);return;}
  if(value===null){assert.deepEqual(node,{type:'null'},label);return;}
  if(typeof value!=='object'){assert.ok(['string','number','boolean'].includes(typeof value));if(typeof value==='number')assert.ok(Number.isFinite(value)&&!Object.is(value,-0));assert.deepEqual(node,{type:typeof value,value},label);return;}
  if(Array.isArray(value)){exactKeys(node,['type','items','properties'],label);assert.equal(node.type,'array');assert.deepEqual(node.properties,[]);assert.deepEqual(Object.keys(value),Array.from({length:value.length},(_,i)=>String(i)));assert.equal(node.items.length,value.length);value.forEach((item,index)=>safeValue(node.items[index],item,label+'['+index+']'));return;}
  exactKeys(node,['type','entries'],label);assert.equal(node.type,'object');assert.ok(node.entries.every(row=>Array.isArray(row)&&row.length===2));assert.deepEqual(node.entries.map(row=>row[0]),Object.keys(value));node.entries.forEach(([key,item])=>safeValue(item,value[key],label+'.'+key));
 };
 const rowsExact=(actual,expected,label)=>{assert.equal(actual.length,expected.length,label);assert.equal(new Set(actual.map(row=>row.id)).size,actual.length,label);for(const row of expected){const matches=actual.filter(item=>item.id===row.id);assert.equal(matches.length,1,label);assert.deepEqual(matches[0],row,label);assert.equal(JSON.stringify(matches[0]),JSON.stringify(row),label);}};
 const fnv=text=>{let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return h>>>0;};
 const phi=x=>Math.exp(-x*x/2)/Math.sqrt(2*Math.PI),cdf=x=>{if(x>0)return 1-cdf(-x);if(x< -1){let tail=0;for(let n=128;n>=1;n--)tail=n/(-x+tail);return phi(x)/(-x+tail);}const t=1/(1+0.2316419*Math.abs(x)),p=phi(x)*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?1-p:p;};
 const pair=(winner,loser)=>{winner.sigma=Math.sqrt(winner.sigma*winner.sigma+0.10*0.10);loser.sigma=Math.sqrt(loser.sigma*loser.sigma+0.10*0.10);const c=Math.sqrt(2*(25/6)*(25/6)+winner.sigma**2+loser.sigma**2),t=(winner.mu-loser.mu)/c;assert.ok(t>=-1&&t<=1,'The independently declared fixture remains on the central normal branch');const v=phi(t)/cdf(t),w=v*(v+t);winner.mu=winner.mu+(winner.sigma**2/c)*v;loser.mu=loser.mu-(loser.sigma**2/c)*v;winner.sigma=Math.sqrt(winner.sigma**2*(1-(winner.sigma**2/(c*c))*w));loser.sigma=Math.sqrt(loser.sigma**2*(1-(loser.sigma**2/(c*c))*w));};
 const likelihood=(tasks,id)=>{const weights=tasks.map(task=>({id:task.id,value:tasks.filter(other=>other.id!==task.id).reduce((sum,other)=>sum+cdf((task.mu-other.mu)/Math.sqrt(2*(25/6)*(25/6)+task.sigma**2+other.sigma**2)),0)/63})),max=Math.max(...weights.map(row=>row.value)),sum=weights.reduce((n,row)=>n+row.value/max,0);return(weights.find(row=>row.id===id).value/max)/sum;};
 const basis=tasks=>{const input=JSON.stringify([tasks.map(task=>[task.id,task.mu,task.sigma,true]).sort(([a],[b])=>a<b?-1:a>b?1:0),250]);return fnv('history:'+input).toString(16)+':'+fnv('basis:'+input).toString(16)+':'+input.length;};
 const nonce=value=>assert.match(value,/^t.+/,'Generated source identity remains explicit');
 const verifyDistinctSources=(phases,attempts)=>{
  const names=['seed','accepted-two','reopened','final-source'];assert.deepEqual(phases.map(row=>row.phase),names,'Every complete distinct-decision source phase is retained in order');
  const[seed,accepted,reopened,finalSource]=phases;
  for(const phase of phases){
   exactKeys(phase.sourceValue,['type','entries'],'Complete lossless source root');assert.equal(phase.sourceValue.type,'object');assert.equal(phase.sourceValueEncoding,'chain-scanner.manual-archive-value/v1');assert.deepEqual(phase.sourceValue.entries.map(row=>row[0]),snapshotKeys,'No source field omitted by the typed boundary');
   assert.deepEqual(Object.keys(phase).filter(key=>!snapshotKeys.includes(key)&&!['sourceValueEncoding','sourceValue','schemaVersion','phase','scenario','sourceIdentity'].includes(key)),[],'No unexamined source field');
   for(const[key,node]of phase.sourceValue.entries){if(key==='opaque')assert.deepEqual(node,opaqueLiteral,'Complete opaque bytes/NUL/negative zero');else safeValue(node,phase[key],'lossless '+key);if(!Object.hasOwn(phase,key))assert.ok(key==='lastInputAtMs'&&node.type==='undefined');}
   assert.equal(phase.currentHash,hash(phase.current));assert.equal(phase.durableHash,hash(phase.durable));assert.deepEqual(phase.pending,pendingLiteral);assert.equal(phase.pendingOwner,null);assert.equal(phase.hold,null);assert.ok(Number.isSafeInteger(phase.capturedAtMs));assert.equal(typeof phase.timeZone,'string');
   exactKeys(phase.view,['documentId','candidateId','benchmarkId','yes','text'],'Complete scanner view');assert.equal(typeof phase.view.documentId,'string');assert.ok(phase.view.documentId);assert.ok(phase.view.text.includes('Synthetic retained task'));
   exactKeys(phase.view.yes,['count','candidate','benchmark','disabled','visible'],'Complete rendered Yes binding');assert.equal(phase.view.yes.count,1);assert.equal(phase.view.yes.disabled,false);assert.equal(phase.view.yes.visible,true);assert.equal(phase.view.yes.candidate,phase.view.candidateId);assert.equal(phase.view.yes.benchmark,phase.view.benchmarkId);
  }
  assert.equal(seed.durable,seedRaw,'Independent literal64 preboot seed is exact');assert.equal(seed.durableHash,seedHash);assert.deepEqual(JSON.parse(seed.current),expectedLive,'Independent complete hydrated signed-out seed');assert.deepEqual(seed.presses,[]);assert.deepEqual(seed.clicks,[]);assert.equal(seed.view.candidateId,'synthetic-populated-1');assert.equal(seed.view.benchmarkId,'synthetic-kept');
  const originals=manualIds.map((id,index)=>{const matches=seed.backups.filter(row=>row.id===id);assert.equal(matches.length,1);const row=matches[0];exactKeys(row,['id','kind','at','day','payload'],'Complete independent manual source');assert.equal(row.kind,'manual');assert.equal(row.day,'2026-10-25');assert.ok(Number.isSafeInteger(row.at)&&row.at>0&&row.at<=seed.capturedAtMs);assert.equal(row.payload,manualPayloads[index]);return copy(row);});rowsExact(seed.backups,originals,'Exactly three pre-existing manual originals');
  assert.equal(accepted.current,accepted.durable,'Both accepted decisions reach exact current and durable bytes');assert.equal(accepted.presses.length,2);assert.equal(accepted.clicks.length,2);
  const offered=['synthetic-populated-1','synthetic-populated-2'];assert.equal(new Set(offered).size,2);
  for(let index=0;index<2;index++){const press=accepted.presses[index],click=accepted.clicks[index];exactKeys(press,['at','action','pointerType','trusted','offeredTaskId'],'Complete independent pre-app down receipt');exactKeys(click,['at','action','trusted','offeredTaskId'],'Complete pre-app click receipt');assert.equal(press.action,'act:yes');assert.equal(click.action,'act:yes');assert.equal(press.pointerType,'mouse');assert.equal(press.trusted,true);assert.equal(click.trusted,true);assert.equal(press.offeredTaskId,offered[index],'Native capture before app dispatch identifies this actual offered task');assert.equal(click.offeredTaskId,offered[index]);assert.ok(Number.isFinite(press.at)&&Number.isFinite(click.at)&&click.at>=press.at);if(index)assert.ok(press.at>accepted.clicks[index-1].at,'Two intentional separately delivered Yes inputs');}
  const generated=accepted.backups.filter(row=>!manualIds.includes(row.id));assert.ok(generated.every(row=>['daily','latest'].includes(row.kind)));
  const daily=generated.filter(row=>row.kind==='daily').sort((a,b)=>a.at-b.at),latest=generated.filter(row=>row.kind==='latest');assert.ok(daily.length>=1&&daily.length<=2);assert.equal(latest.length,1);
  assert.equal(attempts.length,2,'Both complete in-memory accepted boards precede the post-two durable observation');
  assert.equal(accepted.view.documentId,seed.view.documentId);assert.notEqual(reopened.view.documentId,seed.view.documentId,'Actual reload creates a different app document');assert.equal(finalSource.view.documentId,reopened.view.documentId);
  const actualBoards=attempts.map(attempt=>JSON.parse(attempt.afterCurrent)),expectedBoards=[],eventFacts=[],usedIds=new Set(),expectedBaseline={v:1,account:null,sourceBaseId:null,sourceRevision:0,includedActionIds:[],ratings:expectedSeed.tasks.map(task=>({taskId:task.id,mu:25,sigma:8.333333333})).sort((a,b)=>a.taskId<b.taskId?-1:a.taskId>b.taskId?1:0),chainIds:['synthetic-kept'],passId:'synthetic-existing-pass',passAt:0,considered:{},cantAt:{},workedAt:{},observedRatingHistoryIds:[priorHistory.id]};
  const learning=JSON.stringify([null,expectedBaseline.ratings.map(({taskId,mu,sigma})=>[taskId,mu,sigma]),[]]);expectedBaseline.id='dlb2:'+Array.from({length:4},(_,index)=>fnv('decision-learning-v2:'+index+':'+learning).toString(16).padStart(8,'0')).join('');
  let previous=copy(expectedLive);
  const metric=(value,tasks,id,label)=>{exactKeys(value,['mu','sigma','likelihood','eligible','fallback','topK','n','samples'],label);const task=tasks.find(row=>row.id===id);assert.equal(value.mu,task.mu);assert.equal(value.sigma,task.sigma);assert.equal(value.eligible,true);assert.equal(value.fallback,false);assert.equal(value.n,64);assert.equal(value.samples,250);assert.ok(Number.isInteger(value.topK)&&value.topK>=1&&value.topK<=64,'Rank is an actual independently bounded sampled observation');assert.ok(Number.isFinite(value.likelihood)&&Math.abs(value.likelihood-likelihood(tasks,id))<1e-12,'Complete-pool share matches independent normal probability within cache floating arithmetic');};
  for(let index=0;index<2;index++){
   const actual=actualBoards[index],candidateId=offered[index],benchmarkId=index?offered[0]:'synthetic-kept',expected=copy(previous),event=actual.decisionEvents?.[index],click=accepted.clicks[index];
   assert.equal(actual.decisionEvents.length,index+1,'Exactly one ordered accepted decision per actual Yes');nonce(event.id);nonce(event.actionId);assert.notEqual(event.id,event.actionId);for(const id of[event.id,event.actionId]){assert.ok(!usedIds.has(id));usedIds.add(id);}assert.ok(Number.isSafeInteger(event.at)&&event.at>=Math.floor(click.at)&&event.at<=actual.updatedAt&&actual.updatedAt<=accepted.capturedAtMs);if(index)assert.ok(event.at>eventFacts[0].at);
   const expectedEvent={actionId:event.actionId,at:event.at,account:null,baseId:null,passId:'synthetic-existing-pass',passAt:0,scanMode:'descending',chainIds:previous.chain.slice(),observedActionIds:index?[eventFacts[0].id]:[],v:1,id:event.id,kind:'comparison',action:'yes',ratingApplied:true,taskId:candidateId,taskContextIds:[],benchmarkContextIds:[],candidateId,benchmarkId,candidateContextIds:[],winnerId:candidateId,loserId:benchmarkId,baselineId:expectedBaseline.id};assert.deepEqual(event,expectedEvent,'Complete independently specified Yes gesture/fact');eventFacts.push(copy(expectedEvent));assert.deepEqual(actual.decisionEvents,eventFacts,'No dropped, reordered, retargeted or unrelated decision');assert.deepEqual(actual.decisionBaseline,expectedBaseline,'Complete literal shared decision baseline');
   const candidate=expected.tasks.find(task=>task.id===candidateId),benchmark=expected.tasks.find(task=>task.id===benchmarkId),actualCandidate=actual.tasks.find(task=>task.id===candidateId),ops=actualCandidate.comparisonOps;
   assert.equal(ops.length,1);nonce(ops[0].id);assert.ok(!usedIds.has(ops[0].id));usedIds.add(ops[0].id);assert.deepEqual(ops[0],{v:1,id:ops[0].id,observed:[],neutral:false},'Only the chosen candidate receives its exact comparison permission');candidate.comparisonOps=copy(ops);
   expected.decisionBaseline=copy(expectedBaseline);expected.decisionEvents=copy(eventFacts);pair(candidate,benchmark);
   for(const id of[candidateId,benchmarkId]){
    const target=expected.tasks.find(task=>task.id===id),beforeTask=previous.tasks.find(task=>task.id===id),observed=actual.tasks.find(task=>task.id===id),oldHistory=beforeTask.ratingHistory||[],row=observed.ratingHistory?.at(-1);
    assert.equal(observed.ratingHistory.length,oldHistory.length+1);assert.deepEqual(observed.ratingHistory.slice(0,-1),oldHistory,'Every prior ordered observation stays exact');exactKeys(row,['v','id','at','seq','kind','change','after','basis','before'],'Complete accepted Yes observation');metric(row.before,previous.tasks,id,'Before metrics');metric(row.after,expected.tasks,id,'After metrics');
    const expectedRow={v:1,id:event.id,at:event.at,seq:oldHistory.length+1,kind:'yes',change:'rating',after:copy(row.after),basis:basis(expected.tasks),before:copy(row.before)};assert.deepEqual(row,expectedRow);assert.equal(observed.ratingHistoryHead,event.id);target.ratingHistory=[...copy(oldHistory),expectedRow];target.ratingHistoryHead=event.id;
   }
   expected.chain=[...previous.chain,candidateId];expected.candidateId='synthetic-populated-'+(index+2);expected.presentedAt=actual.presentedAt;assert.ok(Number.isSafeInteger(actual.presentedAt)&&actual.presentedAt>=event.at&&actual.presentedAt<=actual.updatedAt);assert.ok(Number.isSafeInteger(actual.updatedAt)&&actual.updatedAt>previous.updatedAt);expected.updatedAt=actual.updatedAt;
   assert.deepEqual(actual.decisionsMs.slice(0,previous.decisionsMs.length),previous.decisionsMs);assert.ok(actual.decisionsMs.length===previous.decisionsMs.length||actual.decisionsMs.length===previous.decisionsMs.length+1);if(!previous.presentedAt)assert.deepEqual(actual.decisionsMs,previous.decisionsMs);else{const appended=actual.decisionsMs.slice(previous.decisionsMs.length);if(event.at-previous.presentedAt>300&&actual.updatedAt-previous.presentedAt<120000)assert.equal(appended.length,1);if(appended.length){const dt=appended[0];assert.ok(Number.isFinite(dt)&&dt>300&&dt<120000&&dt+previous.presentedAt>=event.at&&dt+previous.presentedAt<=actual.updatedAt);}}expected.decisionsMs=copy(actual.decisionsMs);
   assert.deepEqual(actual,expected,'The complete accepted board changes only the independently declared decision, ratings, observations and bounded save metadata');const raw=JSON.stringify(expected);assert.equal(attempts[index].afterCurrent,raw,'Exact complete independent in-memory accepted serialization, including every unknown field');if(index)assert.equal(accepted.current,raw,'The complete post-two durable observation contains B2');expectedBoards.push(raw);previous=copy(expected);
  }
  assert.deepEqual(JSON.parse(accepted.durable).chain,['synthetic-kept',...offered]);assert.deepEqual(JSON.parse(accepted.current).tasks[63].ratingHistory,[priorHistory],'Unrelated existing history and its unknown extension stay exact');assert.equal(accepted.view.candidateId,'synthetic-populated-3');assert.equal(accepted.view.benchmarkId,offered[1]);
  const dayAt=at=>new Intl.DateTimeFormat('en-CA',{timeZone:accepted.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at),sourceIds=new Set(manualIds),sourceNonces=new Set();
  for(const row of generated){exactKeys(row,['id','day','at','kind','payload'],'Complete new automatic source row');assert.ok(Number.isSafeInteger(row.at));const index=row.payload===expectedBoards[0]?0:1;assert.equal(row.payload,expectedBoards[index]);assert.ok(row.at>=eventFacts[index].at&&row.at<=accepted.capturedAtMs);const match=row.id.match(/^(daily|latest):([0-9]+):(t.+)$/);assert.ok(match&&match[1]===row.kind);assert.ok(Number(match[2])>=row.at&&Number(match[2])<=accepted.capturedAtMs);assert.equal(row.day,dayAt(row.at));assert.ok(!sourceIds.has(row.id)&&!sourceNonces.has(match[3]));sourceIds.add(row.id);sourceNonces.add(match[3]);}
  const firstCommitIndex=daily[0].payload===expectedBoards[0]?0:1;assert.equal(daily[0].payload,expectedBoards[firstCommitIndex],'First daily is exactly independently expected B1 or coalesced B2');assert.equal(latest[0].payload,expectedBoards[1]);
  if(firstCommitIndex===1){assert.equal(daily.length,1,'A coalesced B2 save creates one daily source');assert.equal(daily[0].day,latest[0].day);}
  else if(daily.length===2){assert.notEqual(daily[0].day,daily[1].day);assert.equal(daily[1].payload,expectedBoards[1]);assert.equal(daily[1].day,latest[0].day);}
  else assert.equal(latest[0].day,daily[0].day,'Serialized B1/B2 commits on one observed backup day retain its first daily and final latest');
  rowsExact(accepted.backups,[...originals,...daily,...latest],'All manual originals and exact coalesced or serialized automatic lifecycle rows remain');
  const acknowledgements=[];
  for(let index=0;index<2;index++){
   const attempt=attempts[index],ack=attempt.targetAcknowledgement,press=accepted.presses[index],click=accepted.clicks[index];assert.equal(typeof attempt.afterCurrent,'string');exactKeys(ack,['documentId','observedAtMs','candidate','benchmark','yes'],'Complete useful visible DOM acknowledgement');assert.equal(ack.documentId,seed.view.documentId);assert.ok(Number.isFinite(ack.observedAtMs)&&ack.observedAtMs>=click.at&&ack.observedAtMs<=accepted.capturedAtMs);if(!index)assert.ok(ack.observedAtMs<accepted.presses[1].at,'First acknowledged offered target precedes the next intentional input');
   const candidateId='synthetic-populated-'+(index+2),benchmarkId=offered[index];
   assert.deepEqual(ack.candidate,{count:1,text:'Synthetic retained task '+(index+2),connected:true,visible:true},'The actual next candidate title is connected and visible');assert.deepEqual(ack.benchmark,{count:1,text:'Synthetic retained task '+(index+1),connected:true,visible:true},'The accepted task becomes the useful visible benchmark');
   assert.deepEqual(ack.yes,{count:1,candidate:candidateId,benchmark:benchmarkId,connected:true,disabled:false,visible:true},'Exactly one visible enabled Yes targets the independently offered next pair');
   assert.ok(actualBoards[index].updatedAt<=Math.ceil(ack.observedAtMs));acknowledgements.push({candidateId,benchmarkId,observedAtMs:ack.observedAtMs,inputToVisibleDomObservationMs:ack.observedAtMs-press.at});
  }
  assert.ok(accepted.capturedAtMs>=acknowledgements[1].observedAtMs,'Durable/source observation occurs after both inputs');
  for(const key of snapshotKeys.filter(key=>!['capturedAtMs','lastInputAtMs','view','presses','clicks'].includes(key)))assert.deepEqual(reopened[key],accepted[key],'A real reopen preserves complete '+key);
  assert.deepEqual(reopened.presses,[]);assert.deepEqual(reopened.clicks,[]);assert.equal(reopened.lastInputAtMs,undefined,'The new document has no old page-local input');assert.deepEqual({...reopened.view,documentId:'',text:''},{...accepted.view,documentId:'',text:''},'The new document restores exact candidate/benchmark/Yes authority');
  for(const key of snapshotKeys.filter(key=>!['capturedAtMs','view'].includes(key)))assert.deepEqual(finalSource[key],reopened[key],'A final read preserves complete '+key);assert.deepEqual({...finalSource.view,text:''},{...reopened.view,text:''},'Final read preserves the exact reopened scanner bindings; live clock copy grants no board authority');assert.equal(finalSource.current,expectedBoards[1]);
  return{phases:names,offeredTaskIds:offered,decisionIds:eventFacts.map(row=>row.id),orderedChain:['synthetic-kept',...offered],currentHash:hash(expectedBoards[1]),durableHash:hash(expectedBoards[1]),completeBoardsPreserved:true,bothAcceptedInOrder:true,priorHistoryPreserved:true,typedOpaquePreserved:true,pendingUploadPreserved:true,originalSourcesPreserved:true,automaticBackupLifecycleValidated:true,differentDocumentReopen:true,acknowledgements,responseEvidence:{target:'visible-DOM-observation',paint:'unavailable',raf:'proxy-only',cloud:'not-applicable-signed-out',localDurability:'observed-after-both-inputs',localDurabilityObservationMs:accepted.capturedAtMs,optionalGoalMs:200,isVerdict:false}};
 };
 const snapshots=[];
 const sourceSnapshot=async()=>{
  const visible=await ui.page.locator('#scan [data-act="yes"]').isVisible();
  return ui.page.evaluate(async({visible})=>{
   const head=await ScannerDeviceStore.readHead(),current=JSON.stringify(state),sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
   const yes=document.querySelector('#scan [data-act="yes"]');
   const snapshot={current,currentHash:await sha256(current),durable:head.payload,durableHash:head.hash,capturedAtMs:Date.now(),lastInputAtMs:window.__buttonNativeClicks.at(-1)?.at,
    backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),pending:await ScannerDeviceStore.getPendingUpload('gate-owner'),pendingOwner:await ScannerDeviceStore.getPendingUpload('owner'),hold:await ScannerDeviceStore.getRecoveryCloudHold(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
    view:{documentId:window.__installedFixture.documentId,candidateId:state.candidateId,benchmarkId:state.chain.at(-1)??null,yes:{count:document.querySelectorAll('#scan [data-act="yes"]').length,candidate:yes?.dataset.candidate??null,benchmark:yes?.dataset.benchmark??null,disabled:yes?.disabled??null,visible},text:document.getElementById('scan')?.innerText??''},
    presses:structuredClone(window.__buttonNativePresses),clicks:structuredClone(window.__buttonNativeClicks)};
   snapshot.capturedAtMs=Date.now();return{...snapshot,sourceValueEncoding:'chain-scanner.manual-archive-value/v1',sourceValue:encodeManualArchiveValue(snapshot,'ordinary distinct decisions sourceSnapshot')};
  },{visible});
 };
 const capture=async phase=>{const snapshot=await sourceSnapshot();ui.recordOrdinaryWoopPhase(phase,snapshot);snapshots.push({phase,...snapshot});return snapshot;};
 await capture('seed');
 const attempts=await ui.repeat('act:yes',2,()=>{
  const n=window.__buttonNativeClicks.length,candidates=document.querySelectorAll('#scan .card.cand .title'),benchmarks=document.querySelectorAll('#scan .card.bench .title'),buttons=document.querySelectorAll('#scan [data-act="yes"]'),candidate=candidates[0],benchmark=benchmarks[0],yes=buttons[0];
  if(![1,2].includes(n)||candidates.length!==1||benchmarks.length!==1||buttons.length!==1||!candidate?.isConnected||!benchmark?.isConnected||!yes?.isConnected)return false;
  const c=candidate.getBoundingClientRect(),b=benchmark.getBoundingClientRect(),y=yes.getBoundingClientRect();
  return state.chain.length===n+1&&candidate.textContent.trim()==='Synthetic retained task '+(n+1)&&benchmark.textContent.trim()==='Synthetic retained task '+n&&yes.dataset.candidate==='synthetic-populated-'+(n+1)&&yes.dataset.benchmark==='synthetic-populated-'+n&&!yes.disabled&&c.width>0&&c.height>0&&b.width>0&&b.height>0&&y.width>0&&y.height>0&&getComputedStyle(candidate).visibility!=='hidden'&&getComputedStyle(benchmark).visibility!=='hidden'&&getComputedStyle(yes).visibility!=='hidden';
 },'#scan [data-act="yes"]','Ordinary two distinct intentional scanner Yes inputs without a per-save wait');
 await ui.waitFor(async()=>{const head=await ScannerDeviceStore.readHead();return head?.payload===JSON.stringify(state);},12000,'Both accepted decisions reach durable storage only after both inputs');
 await capture('accepted-two');await ui.reopenOrdinaryWoop();await capture('reopened');await capture('final-source');
 const semantic=verifyDistinctSources(snapshots,attempts);ui.recordRepeatOutcome(ordinaryDistinctCase,attempts,JSON.stringify(semantic));
  });

  const selectedEligibilityCase='ordinary repeated selected eligibility';
  await h.scenario(selectedEligibilityCase,{decorate:board=>{board.listOpen=true;}},async ui=>{
    const eligibleSelector='#listEligibilityRow [data-act="list-eligibility"][data-id="eligible"]';
    const ineligibleSelector='#listEligibilityRow [data-act="list-eligibility"][data-id="ineligible"]';
    await ui.page.locator(eligibleSelector).waitFor({state:'visible'});
    const sourceSnapshot=()=>ui.page.evaluate(async()=>{
      const head=await ScannerDeviceStore.readHead();
      return{current:JSON.stringify(state),durable:head.payload,durableHash:head.hash,
        backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),
        pending:await ScannerDeviceStore.getPendingUpload('gate-owner')};
    });
    const sourceBefore=await sourceSnapshot();
    await ui.act('list-eligibility',()=>document.querySelector('#listEligibilityRow [data-id="eligible"]')?.getAttribute('aria-pressed')==='true',eligibleSelector);
    const eligibleRows=await ui.page.evaluate(()=>document.querySelectorAll('#listBody [data-act="edit"]').length);
    assert.ok(eligibleRows>0,'Eligible filter begins with mounted ordinary task rows');
    await ui.page.locator(eligibleSelector).focus();
    const anchor=await ui.page.evaluate(()=>{
      const body=document.getElementById('listBody'),button=document.activeElement;
      body.scrollTop=180;
      const row=body.querySelector('[data-act="edit"]');
      window.__ordinarySelectedEligibility={row,button,scrollTop:body.scrollTop};
      return{scrollTop:body.scrollTop,hasRow:!!row,hasFocusedButton:button?.dataset?.id==='eligible'};
    });
    assert.ok(anchor.scrollTop>0&&anchor.hasRow&&anchor.hasFocusedButton,'The ordinary list has a focused selected control and a real scrolled row');
    const repeatedAttempts=await ui.repeat('act:list-eligibility',2,
      ()=>document.querySelector('#listEligibilityRow [data-id="eligible"]')?.getAttribute('aria-pressed')==='true',
      eligibleSelector,'Repeated selected Eligible native click');
    const continuity=await ui.page.evaluate(()=>{
      const saved=window.__ordinarySelectedEligibility,body=document.getElementById('listBody');
      return{row:saved.row===body.querySelector('[data-act="edit"]')&&saved.row.isConnected,
        button:saved.button.isConnected,selected:saved.button.getAttribute('aria-pressed')==='true',
        scroll:body.scrollTop===saved.scrollTop};
    });
    assert.deepEqual(continuity,{row:true,button:true,selected:true,scroll:true},'Repeated selection retains the actual ordinary row, selected control and scroll');
    // Preserve the existing WebKit rule: mouse down may blur a button, so prove
    // keyboard focus with the actual Enter consumer rather than forcing policy.
    await ui.page.locator(eligibleSelector).focus();await ui.page.locator(eligibleSelector).press('Enter');
    await ui.waitFor(()=>{
      const saved=window.__ordinarySelectedEligibility,body=document.getElementById('listBody');
      return saved.button.isConnected&&document.activeElement===saved.button&&saved.row===body.querySelector('[data-act="edit"]')&&body.scrollTop===saved.scrollTop;
    },12000,'Focused native Enter keeps the ordinary selected eligibility view mounted');
    const keyboardContinuity=await ui.page.evaluate(()=>{
      const saved=window.__ordinarySelectedEligibility,body=document.getElementById('listBody');
      return{row:saved.row===body.querySelector('[data-act="edit"]')&&saved.row.isConnected,
        button:saved.button.isConnected,selected:saved.button.getAttribute('aria-pressed')==='true',
        focused:document.activeElement===saved.button,scroll:body.scrollTop===saved.scrollTop};
    });
    assert.deepEqual(keyboardContinuity,{row:true,button:true,selected:true,focused:true,scroll:true},'Native Enter retains the actual selected control, row, focus and scroll');
    await ui.act('list-eligibility',()=>document.querySelector('#listEligibilityRow [data-id="ineligible"]')?.getAttribute('aria-pressed')==='true'&&
      document.querySelectorAll('#listBody [data-act="edit"]').length===0,ineligibleSelector);
    const changedFilter=await ui.page.evaluate(()=>({selected:document.querySelector('#listEligibilityRow [data-id="ineligible"]')?.getAttribute('aria-pressed'),
      rows:document.querySelectorAll('#listBody [data-act="edit"]').length}));
    assert.deepEqual(changedFilter,{selected:'true',rows:0},'A genuinely changed eligibility filter refreshes the visible rows');
    const sourceAfter=await sourceSnapshot();
    assert.deepEqual(sourceAfter,sourceBefore,'A changed eligibility filter refreshes only the view and preserves exact current, durable and protected sources');
    ui.recordRepeatOutcome(selectedEligibilityCase,repeatedAttempts,JSON.stringify({eligibleRows,repeatedContinuity:continuity,
      keyboardContinuity,changedFilter,sourcePreserved:true,durableHash:sourceBefore.durableHash,
      currentBytes:sourceBefore.current.length,durableBytes:sourceBefore.durable.length,
      backupCount:sourceBefore.backups.length,opaqueCount:sourceBefore.opaque.length,pendingUpload:sourceBefore.pending}));
  });

  const ordinaryWoopCase='ordinary overdue WOOP repeated Next retains answers';
  await h.scenario(ordinaryWoopCase,{retainedCopies:3,decorate:board=>{scannerBoard(board);for(const task of board.tasks)task.due='2000-01-01';board.protectedBackupIds=['gate-retained-1'];}},async ui=>{
    const sourceHash=value=>createHash('sha256').update(value).digest('hex');
    const sourceSeedHash='de1c0c4475e4dd231c851e4bdd1185ebb79df4bc55815d757fdf34b2b53a0fb2';
    const sourcePayloadHashes=["8b40d4d743065968b86abd8ce95cf50e57d0c3c60ec86c8cbd9ed2141de8e17e","f36b3867003d88e7045f7e5936e307f5e84eb50fe8d5352739e01d606646d8a3","d7019b1fc945de83dd5b7ee7c5a7ce2a67ced5e8c26a31fb690e6bfb7e826078"];
    const sourceOriginalIds=['gate-retained-0','gate-retained-1','gate-retained-2'];
    const sourceOpaqueLiteral={type:'array',items:[{type:'object',entries:[['key',{type:'string',value:'gate-opaque-exact'}],['raw',{type:'string',value:'opaque exact bytes\u0000retain'}],['futureBytes',{type:'typed-array',constructor:'Uint8Array',buffer:{type:'array-buffer',base64:'ABH/'},byteOffset:0,length:3}],['futureMinusZero',{type:'special-number',value:'-0'}]]}],properties:[]};
    const sourcePendingLiteral={generationId:'gate-pending',payloadHash:sourceSeedHash,baseRev:0,updatedAt:7,account:'gate-owner'};
    const sourceSnapshotKeys=['current','currentHash','durable','durableHash','capturedAtMs','lastInputAtMs','backups','opaque','pending','timeZone','timeZoneOffsetMinutes','view'];
    const sourceExactKeys=(value,expected,label)=>assert.deepEqual(Object.keys(value).sort(),expected.slice().sort(),label+' complete keys');
    const sourceSame=(actual,expected)=>JSON.stringify(actual)===JSON.stringify(expected);
    const assertSourceRows=(actual,expected,label)=>{
      assert.equal(actual.length,expected.length,label+' complete source row count');assert.equal(new Set(actual.map(row=>row.id)).size,actual.length,label+' unique source IDs');
      for(const row of expected){const matches=actual.filter(value=>value.id===row.id);assert.equal(matches.length,1,label+' '+row.id);assert.deepEqual(matches[0],row,label+' complete row '+row.id);assert.equal(JSON.stringify(matches[0]),JSON.stringify(row),label+' exact row serialization '+row.id);}
    };
    const assertSafeSourceValue=(node,value,label)=>{
      if(value===undefined){assert.deepEqual(node,{type:'undefined'},label);return;}
      if(value===null){assert.deepEqual(node,{type:'null'},label);return;}
      if(typeof value!=='object'){
        assert.ok(['string','number','boolean'].includes(typeof value),label+' supported source scalar');
        if(typeof value==='number')assert.ok(Number.isFinite(value)&&!Object.is(value,-0),label+' declared JSON-safe number');
        assert.deepEqual(node,{type:typeof value,value},label);return;
      }
      if(Array.isArray(value)){
        sourceExactKeys(node,['type','items','properties'],label);assert.equal(node.type,'array');assert.deepEqual(node.properties,[]);
        assert.deepEqual(Object.keys(value),Array.from({length:value.length},(_,index)=>String(index)),label+' dense source array');assert.equal(node.items.length,value.length);
        value.forEach((item,index)=>assertSafeSourceValue(node.items[index],item,label+'['+index+']'));return;
      }
      sourceExactKeys(node,['type','entries'],label);assert.equal(node.type,'object');
      assert.ok(Array.isArray(node.entries)&&node.entries.every(row=>Array.isArray(row)&&row.length===2),label+' complete encoded entry pairs');
      assert.deepEqual(node.entries.map(row=>row[0]),Object.keys(value),label+' retains every own source key in order');
      node.entries.forEach(([key,item])=>assertSafeSourceValue(item,value[key],label+'.'+key));
    };
    const assertLosslessSource=snapshot=>{
      assert.equal(snapshot.sourceValueEncoding,'chain-scanner.manual-archive-value/v1');
      sourceExactKeys(snapshot.sourceValue,['type','entries'],'lossless source root');assert.equal(snapshot.sourceValue.type,'object');
      assert.ok(Array.isArray(snapshot.sourceValue.entries)&&snapshot.sourceValue.entries.every(row=>Array.isArray(row)&&row.length===2),'Complete encoded source entry pairs');
      assert.deepEqual(snapshot.sourceValue.entries.map(row=>row[0]),sourceSnapshotKeys,'Every original sourceSnapshot key survives the typed boundary');
      const extra=Object.keys(snapshot).filter(key=>!sourceSnapshotKeys.includes(key)&&!['sourceValueEncoding','sourceValue','schemaVersion','phase','scenario','sourceIdentity'].includes(key));
      assert.deepEqual(extra,[],'No unexamined sourceSnapshot field');
      for(const [key,node]of snapshot.sourceValue.entries){
        if(key==='opaque')assert.deepEqual(node,sourceOpaqueLiteral,'Exact typed opaque source including NUL, backing bytes and negative zero');
        else assertSafeSourceValue(node,snapshot[key],'lossless '+key);
        if(!Object.hasOwn(snapshot,key))assert.ok(['lastInputAtMs'].includes(key)&&node.type==='undefined','Only explicitly encoded absent click times may be omitted by JSON');
      }
      assert.equal(snapshot.currentHash,sourceHash(snapshot.current));assert.equal(snapshot.durableHash,sourceHash(snapshot.durable));
      assert.ok(Number.isSafeInteger(snapshot.capturedAtMs));assert.equal(typeof snapshot.timeZone,'string');
      assert.ok(Number.isSafeInteger(snapshot.timeZoneOffsetMinutes));
      return sourceSame(snapshot.sourceValue.entries.find(row=>row[0]==='opaque')[1],sourceOpaqueLiteral);
    };
    const verifyWoopSources=phases=>{
      const names=['seed','scan','opened','outcome-filled','repeated','obstacle-filled','answered','plan-filled','saved','reopened'];
      assert.deepEqual(phases.map(row=>row.phase),names,'Every complete WOOP source phase is retained once and in order');
      const [seed,scan,opened,outcomeFilled,repeated,obstacleFilled,answered,planFilled,saved,reopened]=phases,copy=value=>JSON.parse(JSON.stringify(value));
      for(const phase of phases){
        assertLosslessSource(phase);assert.deepEqual(phase.pending,sourcePendingLiteral,'Exact original pending upload');
        sourceExactKeys(phase.view,['step','answer','validation','documentId','planText','answerControl'],'Complete actual WOOP view');
        const controlSteps={'opened':0,'outcome-filled':0,'repeated':1,'obstacle-filled':1,'answered':2,'plan-filled':2};
        const prompts=['What is the best outcome of doing this task?','What obstacle could get in your way?','What is your if/then obstacle-to-action plan?'];
        if(Object.hasOwn(controlSteps,phase.phase)){
          const step=controlSteps[phase.phase];assert.equal(phase.view.step,String(step),'The actual Next control retains the intended step at '+phase.phase);
          assert.deepEqual(phase.view.answerControl,{selector:'#modalRoot #woopAnswer',id:'woopAnswer',tagName:'TEXTAREA',connected:true,inModal:true,count:1,visible:true,disabled:false,readOnly:false,labelFor:'woopAnswer',labelCount:1,prompt:prompts[step]},'The exact available visible answer control and matching prompt at '+phase.phase);
        }else assert.equal(phase.view.answerControl,null,'No WOOP answer control on the scanner at '+phase.phase);
        for(const side of ['current','durable']){
          const board=JSON.parse(phase[side]);assert.equal(board.tasks.length,64);assert.equal(new Set(board.tasks.map(row=>row.id)).size,64);
          assert.deepEqual(board.protectedBackupIds,['gate-retained-1']);assert.equal(board.syncAccount,null);assert.equal(board.syncRev,0);
          assert.deepEqual(board.futureBoard,{opaque:['retain',11]});assert.deepEqual(board.futurePopulated,{version:7,opaque:'p'.repeat(1048576)});
          for(const task of board.tasks)assert.deepEqual(task.futureTask,{opaque:['retain',task.id==='synthetic-kept'?7:Number(task.id.slice('synthetic-populated-'.length))]});
        }
      }
      assert.equal(seed.durableHash,sourceSeedHash);assert.equal(Buffer.byteLength(seed.durable),1069744);
      const originals=sourceOriginalIds.map((id,index)=>{
        const rows=seed.backups.filter(row=>row.id===id);assert.equal(rows.length,1,'One literal original '+id);const row=rows[0];
        sourceExactKeys(row,['id','kind','at','day','payload'],'Complete manual original');assert.equal(row.kind,'manual');assert.equal(row.day,'2026-10-25');
        assert.ok(Number.isSafeInteger(row.at)&&row.at>0&&row.at<=seed.capturedAtMs);assert.equal(sourceHash(row.payload),sourcePayloadHashes[index]);
        assert.equal(Buffer.byteLength(row.payload),1069765);return copy(row);
      });
      assertSourceRows(seed.backups,originals,'Seed originals');
      for(const phase of phases.slice(1))assert.equal(phase.current,phase.durable,'Each completed action/reopen retains its exact full durable board');
      const openBoards={current:JSON.parse(opened.current),durable:JSON.parse(opened.durable)};
      for(const side of ['current','durable']){
        const board=openBoards[side];assert.equal(board.mode,'work');assert.deepEqual(board.chain,['synthetic-kept','synthetic-populated-1']);
        const target=board.tasks.find(row=>row.id==='synthetic-populated-1');assert.ok(target.woopPlan==null,'The prior task has no saved WOOP plan');
        assert.deepEqual(target.woopPlanOps||[],[],'The prior task has no hidden WOOP operation');
      }
      assert.equal(JSON.parse(scan.current).candidateId,'synthetic-populated-1');assert.deepEqual(JSON.parse(scan.current).chain,['synthetic-kept']);
      for(const phase of [outcomeFilled,repeated,obstacleFilled,answered,planFilled])for(const side of ['current','durable'])assert.equal(phase[side],opened[side],'Draft answers/invalid repeated Next cannot alter any complete saved field');
      assert.equal(opened.view.step,'0');assert.equal(opened.view.answer,'');assert.equal(opened.view.validation,'');
      assert.equal(repeated.view.step,'1');assert.equal(repeated.view.answer,'');assert.equal(repeated.view.validation,'Enter an answer before continuing (up to 4,000 characters).');
      assert.equal(answered.view.step,'2');assert.equal(answered.view.answer,'');assert.equal(answered.view.validation,'');
      const savedBoard=JSON.parse(saved.current),target=savedBoard.tasks.find(row=>row.id==='synthetic-populated-1'),plan=target.woopPlan;
      sourceExactKeys(plan,['v','id','outcome','obstacle','plan'],'Complete saved plan');assert.match(plan.id,/^t.+/);
      const expectedPlan={v:1,id:plan.id,outcome:'Ordinary overdue outcome',obstacle:'Ordinary overdue obstacle',plan:'If distracted, then take the next small action'};
      assert.deepEqual(plan,expectedPlan);assert.equal(target.woopPlanOps.length,1);const operation=target.woopPlanOps[0];
      sourceExactKeys(operation,['v','id','observed','value'],'Complete WOOP operation');assert.match(operation.id,/^t.+/);assert.notEqual(operation.id,plan.id);
      const expectedOperation={v:1,id:operation.id,observed:[],value:expectedPlan};assert.deepEqual(operation,expectedOperation);assert.equal(target.woopHead,operation.id);
      assert.ok(Number.isSafeInteger(savedBoard.updatedAt)&&savedBoard.updatedAt>=Math.floor(saved.lastInputAtMs)&&savedBoard.updatedAt<=saved.capturedAtMs,'Fresh save time belongs to actual final native input');
      assert.ok(savedBoard.updatedAt>openBoards.current.updatedAt,'Final Save is distinct from the earlier dot');
      const expectedFinal={};
      for(const side of ['current','durable']){
        const expected=copy(openBoards[side]),task=expected.tasks.find(row=>row.id==='synthetic-populated-1');
        task.woopPlanOps=[expectedOperation];task.woopHead=operation.id;task.woopPlan=expectedPlan;expected.updatedAt=savedBoard.updatedAt;
        expectedFinal[side]=JSON.stringify(expected);assert.equal(saved[side],expectedFinal[side],'Exact complete saved board, including every unrelated task/field/fact');
        assert.equal(reopened[side],expectedFinal[side],'Real browser reopen retains the exact complete saved board');
      }
      assert.equal(saved.view.step,null);assert.equal(saved.view.answer,null);assert.equal(reopened.view.step,null);assert.equal(reopened.view.answer,null);
      assert.ok(phases.slice(0,-1).every(row=>row.view.documentId===seed.view.documentId));assert.notEqual(reopened.view.documentId,saved.view.documentId,'Reopen is a real new browser document');
      // OW02/#1255 explicitly migrates the failed paused-scanner inclusion to real visible answer controls.
      for(const [phase,value]of [[outcomeFilled,'Ordinary overdue outcome'],[obstacleFilled,'Ordinary overdue obstacle'],[planFilled,'If distracted, then take the next small action']])
        assert.equal(phase.view.answer,value,'The actual visible WOOP control retains the complete literal answer at '+phase.phase);
      for(const phase of [saved,reopened]){
        assert.ok(phase.view.planText.includes('Scanning paused — do the chain from the newest dot up.'),'Actual saved/reopened paused work view is retained');
        assert.ok(phase.view.planText.includes('Resume scanning'),'The existing paused scanner exposes Resume scanning');
      }
      const daily=new Map(),seenIds=new Set(sourceOriginalIds),seenNonces=new Set();let priorRows=originals,priorLatest=null;
      const dayAt=(at,timeZone)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
      const validateAutomatic=(row,kind,phase)=>{
        sourceExactKeys(row,['id','day','at','kind','payload'],'Complete '+kind+' row');assert.equal(row.kind,kind);
        assert.ok(Number.isSafeInteger(row.at)&&row.at>=Math.floor(phase.lastInputAtMs)&&row.at<=phase.capturedAtMs,'Automatic row belongs to this actual saved input');
        const match=row.id.match(/^(daily|latest):([0-9]+):(t.+)$/);assert.ok(match&&match[1]===kind);const at=Number(match[2]);
        assert.ok(Number.isSafeInteger(at)&&at>=row.at&&at<=phase.capturedAtMs);assert.ok(!seenIds.has(row.id)&&!seenNonces.has(match[3]));seenIds.add(row.id);seenNonces.add(match[3]);
        assert.equal(row.day,dayAt(row.at,phase.timeZone));assert.equal(row.payload,phase.current);assert.equal(row.payload,phase.durable);
      };
      for(const phase of phases.slice(1)){
        if(['scan','opened','saved'].includes(phase.phase)){
          const generated=phase.backups.filter(row=>!sourceOriginalIds.includes(row.id));assert.ok(generated.every(row=>['daily','latest'].includes(row.kind)));
          const latest=generated.filter(row=>row.kind==='latest');assert.equal(latest.length,1);validateAutomatic(latest[0],'latest',phase);
          if(priorLatest)assert.equal(phase.backups.some(row=>row.id===priorLatest.id),false,'Previous unpinned latest is retired');
          if(!daily.has(latest[0].day)){
            const first=generated.filter(row=>row.kind==='daily'&&row.day===latest[0].day);assert.equal(first.length,1);validateAutomatic(first[0],'daily',phase);
            assert.equal(first[0].at,latest[0].at);daily.set(first[0].day,copy(first[0]));
          }
          assertSourceRows(phase.backups,[...originals,...daily.values(),latest[0]],'Complete '+phase.phase+' lifecycle row set');priorLatest=copy(latest[0]);
        }else assert.deepEqual(phase.backups,priorRows,'No-save draft/reopen retains every complete source row and its order');
        priorRows=copy(phase.backups);
      }
      return{targetTaskId:'synthetic-populated-1',plan:expectedPlan,repeatStep:'1',currentHash:sourceHash(expectedFinal.current),durableHash:sourceHash(expectedFinal.durable),
        completeBoardsPreserved:true,laterAnswersRetained:true,priorHistoryPreserved:true,originalSourcesPreserved:true,automaticBackupLifecycleValidated:true,typedOpaquePreserved:true,pendingUploadPreserved:true,durableReopenVerified:true,phases:names};
    };

    const snapshots=[];
    const sourceSnapshot=async()=>{
      const answerVisible=await ui.page.locator('#modalRoot #woopAnswer').isVisible();
      return ui.page.evaluate(async({answerVisible})=>{
        const head=await ScannerDeviceStore.readHead(),current=JSON.stringify(state);
        const sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
        const next=document.querySelector('#modalRoot [data-act="woop-next"]'),answer=document.querySelector('#modalRoot #woopAnswer'),label=document.querySelector('#modalRoot label[for="woopAnswer"]');
        const snapshot={current,currentHash:await sha256(current),durable:head.payload,durableHash:head.hash,capturedAtMs:Date.now(),
          lastInputAtMs:window.__buttonNativeClicks.at(-1)?.at,backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),
          pending:await ScannerDeviceStore.getPendingUpload('gate-owner'),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,timeZoneOffsetMinutes:new Date().getTimezoneOffset(),
          view:{step:next?.dataset.step??null,answer:answer?.value??null,validation:document.getElementById('woopValidation')?.textContent??null,
            documentId:window.__installedFixture.documentId,planText:document.getElementById('scan')?.innerText??'',
            answerControl:answer?{selector:'#modalRoot #woopAnswer',id:answer.id,tagName:answer.tagName,connected:answer.isConnected,inModal:!!answer.closest('#modalRoot .modal'),
              count:document.querySelectorAll('#modalRoot #woopAnswer').length,visible:answerVisible,disabled:answer.disabled,readOnly:answer.readOnly,
              labelFor:label?.htmlFor??null,labelCount:document.querySelectorAll('#modalRoot label[for="woopAnswer"]').length,prompt:label?.textContent??null}:null}};
        snapshot.capturedAtMs=Date.now();return{...snapshot,sourceValueEncoding:'chain-scanner.manual-archive-value/v1',sourceValue:encodeManualArchiveValue(snapshot,'ordinary overdue WOOP sourceSnapshot')};
      },{answerVisible});
    };
    const capture=async phase=>{const snapshot=await sourceSnapshot();ui.recordOrdinaryWoopPhase(phase,snapshot);snapshots.push({phase,...snapshot});return snapshot;};
    const waitForDurable=label=>ui.waitFor(async()=>{const head=await ScannerDeviceStore.readHead();return head?.payload===JSON.stringify(state);},12000,label+' exact complete durable board');
    await capture('seed');
    await ui.act('start-scan',()=>state.candidateId==='synthetic-populated-1'&&state.chain.length===1&&state.chain[0]==='synthetic-kept');
    await waitForDurable('Start scan');await capture('scan');
    await ui.act('run-woop',()=>document.querySelector('#modalRoot h2')?.textContent==='WOOP for overdue task'&&document.querySelector('#modalRoot [data-act="woop-next"]')?.dataset.step==='0',
      '#scan [data-act="run-woop"]');
    await waitForDurable('Choose overdue task');await capture('opened');
    await ui.fill('#woopAnswer','Ordinary overdue outcome');await capture('outcome-filled');
    const attempts=await ui.repeat('act:woop-next',2,()=>document.querySelector('#modalRoot [data-act="woop-next"]')?.dataset.step==='1'&&document.getElementById('woopAnswer')?.value==='',
      '#modalRoot [data-act="woop-next"]','Ordinary overdue WOOP repeated native Next');
    await capture('repeated');
    await ui.fill('#woopAnswer','Ordinary overdue obstacle');await capture('obstacle-filled');
    await ui.act('woop-next',()=>document.querySelector('#modalRoot [data-act="woop-next"]')?.dataset.step==='2'&&document.getElementById('woopAnswer')?.value==='',
      '#modalRoot [data-act="woop-next"]');await capture('answered');
    await ui.fill('#woopAnswer','If distracted, then take the next small action');await capture('plan-filled');
    await ui.act('woop-next',()=>!document.getElementById('woopAnswer')&&state.tasks.find(task=>task.id==='synthetic-populated-1')?.woopPlan?.plan==='If distracted, then take the next small action',
      '#modalRoot [data-act="woop-next"]');
    await waitForDurable('Save complete overdue WOOP plan');await capture('saved');
    await ui.reopenOrdinaryWoop();await waitForDurable('Reopen complete overdue WOOP plan');await capture('reopened');
    const semantic=verifyWoopSources(snapshots);ui.recordRepeatOutcome(ordinaryWoopCase,attempts,JSON.stringify(semantic));
  });

  const ordinaryFinalWoopCase='ordinary final WOOP repeated Next retains answers';
  await h.scenario(ordinaryFinalWoopCase,{fixtureRole:'sole',retainedCopies:3,decorate:board=>{
    board.tasks.forEach((task,index)=>{task.done=index!==0;task.completedAt=index?10000+index:null;task.lastDoneAt=index?10000+index:null;});
    board.settings.lastTaskWoop=true;board.mode='work';board.chain=['synthetic-kept'];board.protectedBackupIds=['gate-retained-1'];
    board.tasks[0].ratingHistory=[0,1].map(index=>({v:1,id:'ordinary-final-dislodge-'+index,at:1000+index,seq:index+1,kind:'dislodge',after:{mu:25,sigma:8.333333333,likelihood:1,eligible:true,fallback:false,n:1,samples:250,topK:1}}));
  }},async ui=>{
 const sourceHash=value=>createHash('sha256').update(value).digest('hex'),copy=value=>JSON.parse(JSON.stringify(value));
 const targetId='synthetic-kept',scenario='ordinary final WOOP repeated Next retains answers';
 // Independent literal fixture authority: 64 saved tasks, one active final task,
 // two pre-existing dislodge facts and three complete manual originals.
 const taskLiteral={id:'synthetic-kept',title:'Synthetic retained task',url:null,due:null,startsAt:null,evergreen:false,evergreenHours:18,evergreenResetAtDay:true,mu:25,sigma:8.333333333,done:false,createdAt:1,completedAt:null,lastDoneAt:null,ctx:[],futureTask:{opaque:['retain',7]}};
 const expectedSeed={v:1,tasks:[copy(taskLiteral)],contexts:[],chain:['synthetic-kept'],considered:{},cantAt:{},workedAt:{},workLog:[],mode:'work',scanMode:'descending',candidateId:null,passId:'synthetic-existing-pass',passStartedAt:0,interventionActive:false,interventionP:0,snooze:0,decisionsMs:[],presentedAt:0,listOpen:false,ctxOpen:true,histOpen:false,updatedAt:1,syncAccount:null,syncRev:0,syncDirty:true,seenQuickStart:true,settings:{scanMode:'descending',theme:'light',skipOldestFirstDot:false,horizonMin:60,thresholdPct:25,samples:250,cantMin:30,workedHours:8,lastTaskWoop:true},futureBoard:{opaque:['retain',11]}};
 for(let index=1;index<64;index++)expectedSeed.tasks.push({...copy(taskLiteral),id:'synthetic-populated-'+index,title:'Synthetic retained task '+index,createdAt:1+index,futureTask:{opaque:['retain',index]}});
 expectedSeed.futurePopulated={version:7,opaque:'p'.repeat(1048576)};
 expectedSeed.tasks.forEach((task,index)=>{task.done=index!==0;task.completedAt=index?10000+index:null;task.lastDoneAt=index?10000+index:null;});
 expectedSeed.protectedBackupIds=['gate-retained-1'];
 const expectedHistory=[0,1].map(index=>({v:1,id:'ordinary-final-dislodge-'+index,at:1000+index,seq:index+1,kind:'dislodge',after:{mu:25,sigma:8.333333333,likelihood:1,eligible:true,fallback:false,n:1,samples:250,topK:1}}));
 expectedSeed.tasks[0].ratingHistory=copy(expectedHistory);
 const sourceSeedRaw=JSON.stringify(expectedSeed),sourceSeedHash=sourceHash(sourceSeedRaw),sourceOriginalIds=['gate-retained-0','gate-retained-1','gate-retained-2'];
 const sourcePayloads=[0,1,2].map(index=>JSON.stringify({...expectedSeed,futureSourceRole:index}));
    const sourceOpaqueLiteral={type:'array',items:[{type:'object',entries:[['key',{type:'string',value:'gate-opaque-exact'}],['raw',{type:'string',value:'opaque exact bytes\u0000retain'}],['futureBytes',{type:'typed-array',constructor:'Uint8Array',buffer:{type:'array-buffer',base64:'ABH/'},byteOffset:0,length:3}],['futureMinusZero',{type:'special-number',value:'-0'}]]}],properties:[]};
    const sourcePendingLiteral={generationId:'gate-pending',payloadHash:sourceSeedHash,baseRev:0,updatedAt:7,account:'gate-owner'};
    const sourceSnapshotKeys=['current','currentHash','durable','durableHash','capturedAtMs','lastInputAtMs','backups','opaque','pending','timeZone','timeZoneOffsetMinutes','view'];
    const sourceExactKeys=(value,expected,label)=>assert.deepEqual(Object.keys(value).sort(),expected.slice().sort(),label+' complete keys');
    const sourceSame=(actual,expected)=>JSON.stringify(actual)===JSON.stringify(expected);
    const assertSourceRows=(actual,expected,label)=>{
      assert.equal(actual.length,expected.length,label+' complete source row count');assert.equal(new Set(actual.map(row=>row.id)).size,actual.length,label+' unique source IDs');
      for(const row of expected){const matches=actual.filter(value=>value.id===row.id);assert.equal(matches.length,1,label+' '+row.id);assert.deepEqual(matches[0],row,label+' complete row '+row.id);assert.equal(JSON.stringify(matches[0]),JSON.stringify(row),label+' exact row serialization '+row.id);}
    };
    const assertSafeSourceValue=(node,value,label)=>{
      if(value===undefined){assert.deepEqual(node,{type:'undefined'},label);return;}
      if(value===null){assert.deepEqual(node,{type:'null'},label);return;}
      if(typeof value!=='object'){
        assert.ok(['string','number','boolean'].includes(typeof value),label+' supported source scalar');
        if(typeof value==='number')assert.ok(Number.isFinite(value)&&!Object.is(value,-0),label+' declared JSON-safe number');
        assert.deepEqual(node,{type:typeof value,value},label);return;
      }
      if(Array.isArray(value)){
        sourceExactKeys(node,['type','items','properties'],label);assert.equal(node.type,'array');assert.deepEqual(node.properties,[]);
        assert.deepEqual(Object.keys(value),Array.from({length:value.length},(_,index)=>String(index)),label+' dense source array');assert.equal(node.items.length,value.length);
        value.forEach((item,index)=>assertSafeSourceValue(node.items[index],item,label+'['+index+']'));return;
      }
      sourceExactKeys(node,['type','entries'],label);assert.equal(node.type,'object');
      assert.ok(Array.isArray(node.entries)&&node.entries.every(row=>Array.isArray(row)&&row.length===2),label+' complete encoded entry pairs');
      assert.deepEqual(node.entries.map(row=>row[0]),Object.keys(value),label+' retains every own source key in order');
      node.entries.forEach(([key,item])=>assertSafeSourceValue(item,value[key],label+'.'+key));
    };
    const assertLosslessSource=snapshot=>{
      assert.equal(snapshot.sourceValueEncoding,'chain-scanner.manual-archive-value/v1');
      sourceExactKeys(snapshot.sourceValue,['type','entries'],'lossless source root');assert.equal(snapshot.sourceValue.type,'object');
      assert.ok(Array.isArray(snapshot.sourceValue.entries)&&snapshot.sourceValue.entries.every(row=>Array.isArray(row)&&row.length===2),'Complete encoded source entry pairs');
      assert.deepEqual(snapshot.sourceValue.entries.map(row=>row[0]),sourceSnapshotKeys,'Every original sourceSnapshot key survives the typed boundary');
      const extra=Object.keys(snapshot).filter(key=>!sourceSnapshotKeys.includes(key)&&!['sourceValueEncoding','sourceValue','schemaVersion','phase','scenario','sourceIdentity'].includes(key));
      assert.deepEqual(extra,[],'No unexamined sourceSnapshot field');
      for(const [key,node]of snapshot.sourceValue.entries){
        if(key==='opaque')assert.deepEqual(node,sourceOpaqueLiteral,'Exact typed opaque source including NUL, backing bytes and negative zero');
        else assertSafeSourceValue(node,snapshot[key],'lossless '+key);
        if(!Object.hasOwn(snapshot,key))assert.ok(['lastInputAtMs'].includes(key)&&node.type==='undefined','Only explicitly encoded absent click times may be omitted by JSON');
      }
      assert.equal(snapshot.currentHash,sourceHash(snapshot.current));assert.equal(snapshot.durableHash,sourceHash(snapshot.durable));
      assert.ok(Number.isSafeInteger(snapshot.capturedAtMs));assert.equal(typeof snapshot.timeZone,'string');
      assert.ok(Number.isSafeInteger(snapshot.timeZoneOffsetMinutes));
      return sourceSame(snapshot.sourceValue.entries.find(row=>row[0]==='opaque')[1],sourceOpaqueLiteral);
    };

 const verifyFinalWoopSources=phases=>{
  const names=['seed','opened','outcome-filled','outcome-repeated','obstacle-filled','obstacle-repeated','plan-filled','saved','reopened','deleted','deleted-reopened','final-source'];
  assert.deepEqual(phases.map(row=>row.phase),names,'Every complete final-WOOP source phase is retained once in order');
  const [seed,opened,outcomeFilled,outcomeRepeated,obstacleFilled,obstacleRepeated,planFilled,saved,reopened,deleted,deletedReopened,finalSource]=phases;
  const prompts=['What is the best outcome of doing this task?','What obstacle could get in your way?','What is your if/then obstacle-to-action plan?'];
  const steps={'opened':0,'outcome-filled':0,'outcome-repeated':1,'obstacle-filled':1,'obstacle-repeated':2,'plan-filled':2};
  for(const phase of phases){
   assertLosslessSource(phase);assert.deepEqual(phase.pending,sourcePendingLiteral,'The original pending upload remains exact');
   sourceExactKeys(phase.view,['step','answer','validation','documentId','planText','answerControl','scanHTML','savedAnswers','deleteControl','startVisible'],'Complete actual final WOOP view');
   if(Object.hasOwn(steps,phase.phase)){
    const step=steps[phase.phase];assert.equal(phase.view.step,String(step));
    assert.deepEqual(phase.view.answerControl,{selector:'#modalRoot #woopAnswer',id:'woopAnswer',tagName:'TEXTAREA',connected:true,inModal:true,count:1,visible:true,disabled:false,readOnly:false,labelFor:'woopAnswer',labelCount:1,prompt:prompts[step]},'Actual available visible final-WOOP answer control at '+phase.phase);
   }else{assert.equal(phase.view.answerControl,null);assert.equal(phase.view.step,null);assert.equal(phase.view.answer,null);}
   assert.equal(typeof phase.view.scanHTML,'string');assert.equal(typeof phase.view.planText,'string');
   for(const side of ['current','durable']){
    const board=JSON.parse(phase[side]);assert.equal(board.tasks.length,64);assert.deepEqual(board.tasks.map(task=>task.id),expectedSeed.tasks.map(task=>task.id));
    assert.equal(board.tasks.filter(task=>!task.done).length,1);assert.equal(board.tasks.find(task=>!task.done).id,targetId);assert.equal(board.mode,'work');assert.deepEqual(board.chain,[targetId]);
    assert.deepEqual(board.protectedBackupIds,['gate-retained-1']);assert.equal(board.syncAccount,null);assert.equal(board.syncRev,0);
    assert.deepEqual(board.futureBoard,{opaque:['retain',11]});assert.deepEqual(board.futurePopulated,{version:7,opaque:'p'.repeat(1048576)});
    assert.deepEqual(board.tasks[0].ratingHistory,expectedHistory,'Every pre-existing ordered history fact is retained');
    board.tasks.forEach((task,index)=>assert.deepEqual(task.futureTask,{opaque:['retain',index===0?7:index]}));
   }
  }
  assert.equal(seed.durable,sourceSeedRaw,'Exact independent complete sole-role seeded board');assert.equal(seed.durableHash,sourceSeedHash);
  const originals=sourceOriginalIds.map((id,index)=>{
   const rows=seed.backups.filter(row=>row.id===id);assert.equal(rows.length,1);const row=rows[0];sourceExactKeys(row,['id','kind','at','day','payload'],'Complete manual source');
   assert.equal(row.kind,'manual');assert.equal(row.day,'2026-10-25');assert.ok(Number.isSafeInteger(row.at)&&row.at>0&&row.at<=seed.capturedAtMs);assert.equal(row.payload,sourcePayloads[index]);return copy(row);
  });assertSourceRows(seed.backups,originals,'Seed originals');
  for(const side of ['current','durable']){
   assert.ok(JSON.parse(seed[side]).tasks[0].woopPlan==null);assert.deepEqual(JSON.parse(seed[side]).tasks[0].woopPlanOps||[],[]);
   for(const phase of [opened,outcomeFilled,outcomeRepeated,obstacleFilled,obstacleRepeated,planFilled])assert.equal(phase[side],seed[side],'Draft/invalid repeated Next preserves every complete saved field at '+phase.phase);
  }
  for(const [phase,value]of [[outcomeFilled,'Ordinary final outcome'],[obstacleFilled,'Ordinary final obstacle'],[planFilled,'If final obstacle, then take the next small action']])assert.equal(phase.view.answer,value,'Complete literal answer retained in actual visible control');
  assert.equal(opened.view.answer,'');assert.equal(opened.view.validation,'');
  for(const phase of [outcomeRepeated,obstacleRepeated]){assert.equal(phase.view.answer,'');assert.equal(phase.view.validation,'Enter an answer before continuing (up to 4,000 characters).');}
  const savedBoard=JSON.parse(saved.current),savedTask=savedBoard.tasks[0],plan=savedTask.woopPlan;
  sourceExactKeys(plan,['v','id','outcome','obstacle','plan'],'Complete saved plan');assert.match(plan.id,/^t.+/);
  const expectedPlan={v:1,id:plan.id,outcome:'Ordinary final outcome',obstacle:'Ordinary final obstacle',plan:'If final obstacle, then take the next small action'};assert.deepEqual(plan,expectedPlan);
  assert.equal(savedTask.woopPlanOps.length,1);const operation=savedTask.woopPlanOps[0];sourceExactKeys(operation,['v','id','observed','value'],'Complete save operation');assert.match(operation.id,/^t.+/);assert.notEqual(operation.id,plan.id);
  const expectedOperation={v:1,id:operation.id,observed:[],value:expectedPlan};assert.deepEqual(operation,expectedOperation);assert.equal(savedTask.woopHead,operation.id);
  assert.ok(Number.isSafeInteger(savedBoard.updatedAt)&&savedBoard.updatedAt>=Math.floor(saved.lastInputAtMs)&&savedBoard.updatedAt<=saved.capturedAtMs&&savedBoard.updatedAt>JSON.parse(seed.current).updatedAt,'Actual native Save owns a fresh real timestamp');
  const expectedSaved=copy(JSON.parse(seed.current));expectedSaved.tasks[0].woopPlanOps=[expectedOperation];expectedSaved.tasks[0].woopHead=operation.id;expectedSaved.tasks[0].woopPlan=expectedPlan;expectedSaved.updatedAt=savedBoard.updatedAt;
  for(const phase of [saved,reopened]){
   assert.equal(phase.current,JSON.stringify(expectedSaved),'Exact full saved current board');assert.equal(phase.durable,JSON.stringify(expectedSaved),'Exact full saved durable board after real reopen');
   assert.deepEqual(phase.view.savedAnswers,[expectedPlan.outcome,expectedPlan.obstacle,expectedPlan.plan],'Literal answers are actually rendered in the existing final-task saved plan');
   const control=phase.view.deleteControl;sourceExactKeys(control,['selector','tagName','connected','count','visible','disabled','benchmark','plan','head','binding','text'],'Complete actual Delete control');assert.match(control.binding,/^t.+/);
   assert.deepEqual(control, {selector:'#scan .woop-saved [data-act="woop-delete"]',tagName:'BUTTON',connected:true,count:1,visible:true,disabled:false,benchmark:targetId,plan:plan.id,head:operation.id,binding:control.binding,text:'Delete WOOP plan'});
  }
  const deletedBoard=JSON.parse(deleted.current),deletedTask=deletedBoard.tasks[0];assert.equal(deletedTask.woopPlan,null);assert.equal(deletedTask.woopPlanOps.length,2);
  const deletion=deletedTask.woopPlanOps[1];sourceExactKeys(deletion,['v','id','observed','value'],'Complete delete tombstone operation');assert.match(deletion.id,/^t.+/);assert.ok(![plan.id,operation.id].includes(deletion.id));
  const expectedDeletion={v:1,id:deletion.id,observed:[operation.id],value:null};assert.deepEqual(deletion,expectedDeletion);assert.equal(deletedTask.woopHead,deletion.id);
  assert.ok(Number.isSafeInteger(deletedBoard.updatedAt)&&deletedBoard.updatedAt>=Math.floor(deleted.lastInputAtMs)&&deletedBoard.updatedAt<=deleted.capturedAtMs&&deletedBoard.updatedAt>savedBoard.updatedAt,'Actual native Delete owns a later real timestamp');
  const expectedDeleted=copy(expectedSaved);expectedDeleted.tasks[0].woopPlanOps=[expectedOperation,expectedDeletion];expectedDeleted.tasks[0].woopHead=deletion.id;expectedDeleted.tasks[0].woopPlan=null;expectedDeleted.updatedAt=deletedBoard.updatedAt;
  for(const phase of [deleted,deletedReopened,finalSource])for(const side of ['current','durable'])assert.equal(phase[side],JSON.stringify(expectedDeleted),'Exact full deletion board/tombstone/ordered facts survives genuine reopen and final read');
  for(const phase of phases.filter(row=>!['saved','reopened'].includes(row.phase))){assert.deepEqual(phase.view.savedAnswers,[]);assert.equal(phase.view.deleteControl,null);}
  for(const phase of [seed,deleted,deletedReopened,finalSource])assert.equal(phase.view.startVisible,true,'The existing final-task walkthrough control is available');
  assert.ok(phases.slice(0,8).every(row=>row.view.documentId===seed.view.documentId));assert.notEqual(reopened.view.documentId,saved.view.documentId);assert.equal(deleted.view.documentId,reopened.view.documentId);assert.notEqual(deletedReopened.view.documentId,deleted.view.documentId);assert.equal(finalSource.view.documentId,deletedReopened.view.documentId);
      const daily=new Map(),seenIds=new Set(sourceOriginalIds),seenNonces=new Set();let priorRows=originals,priorLatest=null;
      const dayAt=(at,timeZone)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
      const validateAutomatic=(row,kind,phase)=>{
        sourceExactKeys(row,['id','day','at','kind','payload'],'Complete '+kind+' row');assert.equal(row.kind,kind);
        assert.ok(Number.isSafeInteger(row.at)&&row.at>=Math.floor(phase.lastInputAtMs)&&row.at<=phase.capturedAtMs,'Automatic row belongs to this actual saved input');
        const match=row.id.match(/^(daily|latest):([0-9]+):(t.+)$/);assert.ok(match&&match[1]===kind);const at=Number(match[2]);
        assert.ok(Number.isSafeInteger(at)&&at>=row.at&&at<=phase.capturedAtMs);assert.ok(!seenIds.has(row.id)&&!seenNonces.has(match[3]));seenIds.add(row.id);seenNonces.add(match[3]);
        assert.equal(row.day,dayAt(row.at,phase.timeZone));assert.equal(row.payload,phase.current);assert.equal(row.payload,phase.durable);
      };
      for(const phase of phases.slice(1)){
        if(['saved','deleted'].includes(phase.phase)){
          const generated=phase.backups.filter(row=>!sourceOriginalIds.includes(row.id));assert.ok(generated.every(row=>['daily','latest'].includes(row.kind)));
          const latest=generated.filter(row=>row.kind==='latest');assert.equal(latest.length,1);validateAutomatic(latest[0],'latest',phase);
          if(priorLatest)assert.equal(phase.backups.some(row=>row.id===priorLatest.id),false,'Previous unpinned latest is retired');
          if(!daily.has(latest[0].day)){
            const first=generated.filter(row=>row.kind==='daily'&&row.day===latest[0].day);assert.equal(first.length,1);validateAutomatic(first[0],'daily',phase);
            assert.equal(first[0].at,latest[0].at);daily.set(first[0].day,copy(first[0]));
          }
          assertSourceRows(phase.backups,[...originals,...daily.values(),latest[0]],'Complete '+phase.phase+' lifecycle row set');priorLatest=copy(latest[0]);
        }else assert.deepEqual(phase.backups,priorRows,'No-save draft/reopen retains every complete source row and its order');
        priorRows=copy(phase.backups);
      }

  return{targetTaskId:targetId,plan:expectedPlan,saveOperation:expectedOperation,deleteOperation:expectedDeletion,repeatSteps:['1','2'],currentHash:sourceHash(JSON.stringify(expectedDeleted)),durableHash:sourceHash(JSON.stringify(expectedDeleted)),completeBoardsPreserved:true,laterAnswersRetained:true,priorHistoryPreserved:true,originalSourcesPreserved:true,automaticBackupLifecycleValidated:true,typedOpaquePreserved:true,pendingUploadPreserved:true,durableReopenVerified:true,deletionReopenVerified:true,phases:names};
 };

 const snapshots=[];
 const sourceSnapshot=async()=>{
  const answerVisible=await ui.page.locator('#modalRoot #woopAnswer').isVisible(),deleteVisible=await ui.page.locator('#scan .woop-saved [data-act="woop-delete"]').isVisible(),startVisible=await ui.page.locator('#scan [data-act="woop-start"]').isVisible();
  return ui.page.evaluate(async({answerVisible,deleteVisible,startVisible})=>{
   const head=await ScannerDeviceStore.readHead(),current=JSON.stringify(state),sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
   const next=document.querySelector('#modalRoot [data-act="woop-next"]'),answer=document.querySelector('#modalRoot #woopAnswer'),label=document.querySelector('#modalRoot label[for="woopAnswer"]'),scan=document.getElementById('scan'),del=document.querySelector('#scan .woop-saved [data-act="woop-delete"]');
   const snapshot={current,currentHash:await sha256(current),durable:head.payload,durableHash:head.hash,capturedAtMs:Date.now(),lastInputAtMs:window.__buttonNativeClicks.at(-1)?.at,
    backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),pending:await ScannerDeviceStore.getPendingUpload('gate-owner'),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,timeZoneOffsetMinutes:new Date().getTimezoneOffset(),
    view:{step:next?.dataset.step??null,answer:answer?.value??null,validation:document.getElementById('woopValidation')?.textContent??null,documentId:window.__installedFixture.documentId,planText:scan?.innerText??'',
     answerControl:answer?{selector:'#modalRoot #woopAnswer',id:answer.id,tagName:answer.tagName,connected:answer.isConnected,inModal:!!answer.closest('#modalRoot .modal'),count:document.querySelectorAll('#modalRoot #woopAnswer').length,visible:answerVisible,disabled:answer.disabled,readOnly:answer.readOnly,labelFor:label?.htmlFor??null,labelCount:document.querySelectorAll('#modalRoot label[for="woopAnswer"]').length,prompt:label?.textContent??null}:null,
     scanHTML:scan?.innerHTML??'',savedAnswers:[...document.querySelectorAll('#scan .woop-saved dd')].map(el=>el.innerText),
     deleteControl:del?{selector:'#scan .woop-saved [data-act="woop-delete"]',tagName:del.tagName,connected:del.isConnected,count:document.querySelectorAll('#scan .woop-saved [data-act="woop-delete"]').length,visible:deleteVisible,disabled:del.disabled,benchmark:del.dataset.benchmark,plan:del.dataset.plan,head:del.dataset.head,binding:del.dataset.binding,text:del.textContent}:null,startVisible}};
   snapshot.capturedAtMs=Date.now();return{...snapshot,sourceValueEncoding:'chain-scanner.manual-archive-value/v1',sourceValue:encodeManualArchiveValue(snapshot,'ordinary final WOOP sourceSnapshot')};
  },{answerVisible,deleteVisible,startVisible});
 };
 const capture=async phase=>{const snapshot=await sourceSnapshot();ui.recordOrdinaryWoopPhase(phase,snapshot);snapshots.push({phase,...snapshot});return snapshot;};
 const waitForDurable=label=>ui.waitFor(async()=>{const head=await ScannerDeviceStore.readHead();return head?.payload===JSON.stringify(state);},12000,label+' exact complete durable board');
 await capture('seed');
 await ui.act('woop-start',()=>document.querySelector('#modalRoot h2')?.textContent==='WOOP for final task'&&document.querySelector('#modalRoot [data-act="woop-next"]')?.dataset.step==='0','#scan [data-act="woop-start"]');await capture('opened');
 await ui.fill('#woopAnswer','Ordinary final outcome');await capture('outcome-filled');
 const first=await ui.repeat('act:woop-next',2,()=>document.querySelector('#modalRoot [data-act="woop-next"]')?.dataset.step==='1'&&document.getElementById('woopAnswer')?.value==='','#modalRoot [data-act="woop-next"]','Ordinary final outcome Next');await capture('outcome-repeated');
 await ui.fill('#woopAnswer','Ordinary final obstacle');await capture('obstacle-filled');
 const second=await ui.repeat('act:woop-next',2,()=>document.querySelector('#modalRoot [data-act="woop-next"]')?.dataset.step==='2'&&document.getElementById('woopAnswer')?.value==='','#modalRoot [data-act="woop-next"]','Ordinary final obstacle Next');await capture('obstacle-repeated');
 await ui.fill('#woopAnswer','If final obstacle, then take the next small action');await capture('plan-filled');
 await ui.act('woop-next',()=>!document.getElementById('woopAnswer')&&state.tasks.find(task=>task.id==='synthetic-kept')?.woopPlan?.plan==='If final obstacle, then take the next small action','#modalRoot [data-act="woop-next"]');await waitForDurable('Save complete final WOOP');await capture('saved');
 await ui.reopenOrdinaryWoop();await waitForDurable('Reopen saved final WOOP');await capture('reopened');
 await ui.act('woop-delete',()=>state.tasks.find(task=>task.id==='synthetic-kept')?.woopPlan===null&&!document.querySelector('#scan [data-act="woop-delete"]')&&!!document.querySelector('#scan [data-act="woop-start"]'),'#scan .woop-saved [data-act="woop-delete"]');await waitForDurable('Delete final WOOP');await capture('deleted');
 await ui.reopenOrdinaryWoop();await waitForDurable('Reopen final WOOP tombstone');await capture('deleted-reopened');
 await capture('final-source');
 const semantic=verifyFinalWoopSources(snapshots);ui.recordRepeatOutcome(ordinaryFinalWoopCase,[...first,...second],JSON.stringify(semantic));
  });

  const ordinaryUndoCase='ordinary Undo consumes two saved edit frames';
  await h.scenario(ordinaryUndoCase,{retainedCopies:3,decorate:board=>{board.protectedBackupIds=['gate-retained-1'];}},async ui=>{
    const hash=value=>createHash('sha256').update(value).digest('hex');
    const copy=value=>JSON.parse(JSON.stringify(value));
    const priorId='synthetic-populated-1',targetId='synthetic-kept';
    const sourceHash=value=>createHash('sha256').update(value).digest('hex');
    const sourceSeedHash='434161b20aa6361220d67e96198d1694023a1ca67dd18e49984febe3fc97a780';
    const sourcePayloadHashes=['30a27913944098e121336a9a3f855ce8c875904fc3f7146ab44304b8b1adfc92','07c3efa01e76bdc9a34416bddd9182a75db7b09347c87804ceb58ac10954c42e','b71ec5d27bfb02cb307b943a9d6d90601ca575b99a67b128ab58f89198743c0b'];
    const sourceOriginalIds=['gate-retained-0','gate-retained-1','gate-retained-2'];
    const sourceOpaqueLiteral={type:'array',items:[{type:'object',entries:[['key',{type:'string',value:'gate-opaque-exact'}],['raw',{type:'string',value:'opaque exact bytes\u0000retain'}],['futureBytes',{type:'typed-array',constructor:'Uint8Array',buffer:{type:'array-buffer',base64:'ABH/'},byteOffset:0,length:3}],['futureMinusZero',{type:'special-number',value:'-0'}]]}],properties:[]};
    const sourcePendingLiteral={generationId:'gate-pending',payloadHash:sourceSeedHash,baseRev:0,updatedAt:7,account:'gate-owner'};
    const sourceSnapshotKeys=['current','currentHash','durable','durableHash','capturedAtMs','lastSaveClickAtMs','lastUndoClickAtMs','backups','opaque','pending','timeZone','timeZoneOffsetMinutes'];
    const sourceExactKeys=(value,expected,label)=>assert.deepEqual(Object.keys(value).sort(),expected.slice().sort(),label+' complete keys');
    const sourceSame=(actual,expected)=>JSON.stringify(actual)===JSON.stringify(expected);
    const assertSourceRows=(actual,expected,label)=>{
      assert.equal(actual.length,expected.length,label+' complete source row count');
      assert.equal(new Set(actual.map(row=>row.id)).size,actual.length,label+' unique source row IDs');
      for(const row of expected){
        const matches=actual.filter(value=>value.id===row.id);assert.equal(matches.length,1,label+' source row '+row.id);
        assert.deepEqual(matches[0],row,label+' complete source row '+row.id);
        assert.equal(JSON.stringify(matches[0]),JSON.stringify(row),label+' exact source row serialization '+row.id);
      }
      return actual.length===expected.length&&expected.every(row=>actual.some(value=>sourceSame(value,row)));
    };
    const assertSafeSourceValue=(node,value,label)=>{
      if(value===undefined){assert.deepEqual(node,{type:'undefined'},label);return;}
      if(value===null){assert.deepEqual(node,{type:'null'},label);return;}
      if(typeof value!=='object'){
        assert.ok(['string','number','boolean'].includes(typeof value),label+' supported source scalar');
        if(typeof value==='number')assert.ok(Number.isFinite(value)&&!Object.is(value,-0),label+' declared JSON-safe number');
        assert.deepEqual(node,{type:typeof value,value},label);return;
      }
      if(Array.isArray(value)){
        sourceExactKeys(node,['type','items','properties'],label);assert.equal(node.type,'array');assert.deepEqual(node.properties,[]);
        assert.deepEqual(Object.keys(value),Array.from({length:value.length},(_,index)=>String(index)),label+' dense source array');assert.equal(node.items.length,value.length);
        value.forEach((item,index)=>assertSafeSourceValue(node.items[index],item,label+'['+index+']'));return;
      }
      sourceExactKeys(node,['type','entries'],label);assert.equal(node.type,'object');
      assert.ok(Array.isArray(node.entries)&&node.entries.every(row=>Array.isArray(row)&&row.length===2),label+' complete encoded entry pairs');
      assert.deepEqual(node.entries.map(row=>row[0]),Object.keys(value),label+' retains every own source key in order');
      node.entries.forEach(([key,item])=>assertSafeSourceValue(item,value[key],label+'.'+key));
    };
    const assertLosslessSource=snapshot=>{
      assert.equal(snapshot.sourceValueEncoding,'chain-scanner.manual-archive-value/v1');
      sourceExactKeys(snapshot.sourceValue,['type','entries'],'lossless source root');assert.equal(snapshot.sourceValue.type,'object');
      assert.ok(Array.isArray(snapshot.sourceValue.entries)&&snapshot.sourceValue.entries.every(row=>Array.isArray(row)&&row.length===2),'Complete encoded source entry pairs');
      assert.deepEqual(snapshot.sourceValue.entries.map(row=>row[0]),sourceSnapshotKeys,'Every original sourceSnapshot key survives the typed boundary');
      const extra=Object.keys(snapshot).filter(key=>!sourceSnapshotKeys.includes(key)&&!['sourceValueEncoding','sourceValue','schemaVersion','phase','scenario','sourceIdentity'].includes(key));
      assert.deepEqual(extra,[],'No unexamined sourceSnapshot field');
      for(const [key,node]of snapshot.sourceValue.entries){
        if(key==='opaque')assert.deepEqual(node,sourceOpaqueLiteral,'Exact typed opaque source including NUL, backing bytes and negative zero');
        else assertSafeSourceValue(node,snapshot[key],'lossless '+key);
        if(!Object.hasOwn(snapshot,key))assert.ok(['lastSaveClickAtMs','lastUndoClickAtMs'].includes(key)&&node.type==='undefined','Only explicitly encoded absent click times may be omitted by JSON');
      }
      assert.equal(snapshot.currentHash,sourceHash(snapshot.current));assert.equal(snapshot.durableHash,sourceHash(snapshot.durable));
      assert.ok(Number.isSafeInteger(snapshot.capturedAtMs));assert.equal(typeof snapshot.timeZone,'string');
      assert.ok(Number.isSafeInteger(snapshot.timeZoneOffsetMinutes));
      return sourceSame(snapshot.sourceValue.entries.find(row=>row[0]==='opaque')[1],sourceOpaqueLiteral);
    };
    const assertSourceFixture=(input,seed)=>{
      assert.ok(input,'Complete existing observer fixture input required');
      sourceExactKeys(input,['seedStartedAtMs','seedFinishedAtMs','headPayload','headHash','rows','readbackRows','pending'],'complete observer fixture input');
      assert.equal(sourceHash(input.headPayload),sourceSeedHash);assert.equal(input.headHash,sourceSeedHash);
      assert.equal(Buffer.byteLength(input.headPayload),1069206);assert.equal(seed.durable,input.headPayload);assert.equal(seed.durableHash,sourceSeedHash);
      assert.ok(Number.isSafeInteger(input.seedStartedAtMs)&&Number.isSafeInteger(input.seedFinishedAtMs)&&input.seedFinishedAtMs>=input.seedStartedAtMs);
      assert.equal(input.rows.length,3);const kinds=['manual','latest','future-recovery'],roles=['manual','pinned-automatic','unknown-kind'];
      const expected=input.rows.map((row,index)=>{
        sourceExactKeys(row,['id','kind','at','day','payload','futureRetained'],'original fixture row');
        assert.ok(Number.isSafeInteger(row.at)&&row.at+index>=input.seedStartedAtMs&&row.at+index<=input.seedFinishedAtMs,'Original fixture timestamp belongs to its recorded seed interval');
        assert.equal(sourceHash(row.payload),sourcePayloadHashes[index]);assert.equal(Buffer.byteLength(row.payload),1069227);
        const value={id:sourceOriginalIds[index],kind:kinds[index],at:row.at,day:'2026-10-25',
          futureRetained:{role:roles[index],raw:roles[index]+' original\u0000bytes',opaque:['retain',[13,17,19][index]],flag:true,empty:null},payload:row.payload};
        assert.deepEqual(row,value,'Complete literal controlled fixture input');return value;
      });
      assertSourceRows(input.readbackRows,expected,'observer seed readback');assertSourceRows(seed.backups,expected,'opened seed');
      assert.deepEqual(input.pending,sourcePendingLiteral);assert.deepEqual(seed.pending,sourcePendingLiteral);
      for(const side of ['current','durable']){
        const board=JSON.parse(seed[side]);assert.equal(board.tasks.length,64);assert.deepEqual(board.protectedBackupIds,['gate-retained-1']);
      }
      assertLosslessSource(seed);return expected;
    };
    const inspectSourceLifecycle=(input,seed,sourcePhases,final,expectedBoards)=>{
      const originals=assertSourceFixture(input,seed),daily=new Map(),seenGeneratedIds=new Set(),seenNonces=new Set(),oldLatest=[];
      const originalChecks=[],lifecycleChecks=[],opaqueChecks=[],pendingChecks=[];
      assert.equal(sourcePhases.length,5);assert.equal(expectedBoards.length,5);
      const dayAt=(at,timeZone)=>{
        const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));
        return ['year','month','day'].map(type=>parts.find(row=>row.type===type).value).join('-');
      };
      const automatic=(row,kind,phase,expected,clickAt)=>{
        sourceExactKeys(row,['id','day','at','kind','payload'],kind+' automatic row');assert.equal(row.kind,kind);
        assert.ok(Number.isSafeInteger(row.at)&&row.at>=Math.floor(clickAt)&&row.at<=phase.capturedAtMs,kind+' automatic row belongs to the actual input/save interval');
        const identity=typeof row.id==='string'&&row.id.match(/^(daily|latest):([0-9]+):(t.+)$/);
        assert.ok(identity&&identity[1]===kind,kind+' automatic row identity');const created=Number(identity[2]);
        assert.ok(Number.isSafeInteger(created)&&created>=row.at&&created<=phase.capturedAtMs,kind+' automatic ID creation time');
        assert.ok(!seenGeneratedIds.has(row.id)&&!seenNonces.has(identity[3]),kind+' fresh automatic identity');seenGeneratedIds.add(row.id);seenNonces.add(identity[3]);
        assert.equal(row.day,dayAt(row.at,phase.timeZone),kind+' independently calculated local day');
        assert.equal(row.payload,expected.current,kind+' complete independently expected current payload');
        assert.equal(row.payload,expected.durable,kind+' complete independently expected durable payload');
      };
      for(let index=0;index<sourcePhases.length;index++){
        const phase=sourcePhases[index],expected=expectedBoards[index],clickAt=index<3?phase.lastSaveClickAtMs:phase.lastUndoClickAtMs;
        assert.equal(phase.current,expected.current);assert.equal(phase.durable,expected.durable);
        assert.equal(phase.currentHash,sourceHash(expected.current));assert.equal(phase.durableHash,sourceHash(expected.durable));
        for(const side of ['current','durable'])assert.deepEqual(JSON.parse(phase[side]).protectedBackupIds,['gate-retained-1'],'The real pinned automatic original remains pinned');
        assert.ok(Number.isFinite(clickAt)&&Number.isSafeInteger(phase.capturedAtMs));assert.deepEqual(phase.pending,sourcePendingLiteral,'Exact original pending upload source');
        pendingChecks.push(sourceSame(phase.pending,sourcePendingLiteral));
        const generated=phase.backups.filter(row=>!sourceOriginalIds.includes(row.id));
        assert.ok(generated.every(row=>row.kind==='daily'||row.kind==='latest'),'No extra/unknown generated source row is ignored');
        const latest=generated.filter(row=>row.kind==='latest');assert.equal(latest.length,1,'Exactly one unpinned rolling latest source');
        automatic(latest[0],'latest',phase,expected,clickAt);
        for(const id of oldLatest)assert.equal(phase.backups.some(row=>row.id===id),false,'Earlier unpinned rolling latest is retired');
        oldLatest.push(latest[0].id);
        if(!daily.has(latest[0].day)){
          const fresh=generated.filter(row=>row.kind==='daily'&&row.day===latest[0].day);assert.equal(fresh.length,1,'Exactly one first daily for the independently observed local day');
          automatic(fresh[0],'daily',phase,expected,clickAt);assert.equal(fresh[0].at,latest[0].at,'Daily/latest from one actual save share their capture time');
          daily.set(fresh[0].day,fresh[0]);
        }
        const immutable=[...originals,...daily.values()],expectedRows=[...immutable,latest[0]];
        lifecycleChecks.push(assertSourceRows(phase.backups,expectedRows,'phase '+index));
        originalChecks.push(immutable.every(row=>phase.backups.some(value=>sourceSame(value,row))));
        opaqueChecks.push(assertLosslessSource(phase));
      }
      const last=sourcePhases[4];assert.equal(final.current,expectedBoards[4].current);assert.equal(final.durable,expectedBoards[4].durable);
      lifecycleChecks.push(assertSourceRows(final.backups,last.backups,'final U2 readback'));
      assert.deepEqual(final.pending,sourcePendingLiteral,'Final pending original remains exact');pendingChecks.push(sourceSame(final.pending,sourcePendingLiteral));
      for(const side of ['current','durable'])assert.deepEqual(JSON.parse(final[side]).protectedBackupIds,['gate-retained-1']);
      opaqueChecks.push(assertLosslessSource(final));
      return{originalBackupsPreserved:originalChecks.every(Boolean)&&lifecycleChecks.every(Boolean),automaticBackupLifecycleValidated:lifecycleChecks.every(Boolean),
        originalOpaqueSourcesPreserved:opaqueChecks.every(Boolean),pendingUploadPreserved:pendingChecks.every(Boolean),
        baselineRollingId:oldLatest[0],immutableOriginalIds:[...originals,...daily.values()].map(row=>row.id),dailyOriginals:[...daily.values()]};
    };
    const sourceSnapshot=()=>ui.page.evaluate(async()=>{
      const head=await ScannerDeviceStore.readHead(),current=JSON.stringify(state);
      const sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
      const clicks=window.__buttonNativeClicks;
      const snapshot={current,currentHash:await sha256(current),durable:head.payload,durableHash:head.hash,
        capturedAtMs:Date.now(),lastSaveClickAtMs:clicks.findLast(row=>row.action==='act:save-edit')?.at,
        lastUndoClickAtMs:clicks.findLast(row=>row.action==='act:undo')?.at,
        backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),
        pending:await ScannerDeviceStore.getPendingUpload('gate-owner'),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeZoneOffsetMinutes:new Date().getTimezoneOffset()};
      snapshot.capturedAtMs=Date.now();
      return{...snapshot,sourceValueEncoding:'chain-scanner.manual-archive-value/v1',
        sourceValue:encodeManualArchiveValue(snapshot,'ordinary Undo sourceSnapshot')};
    });
    const saveTitle=async(id,title,label)=>{
      await openEditor(ui,id);await ui.fill('#etTitle',title);
      await ui.act('save-edit',new Function('return ()=>state.tasks.find(task=>task.id==='+JSON.stringify(id)+')?.title==='+JSON.stringify(title)+'&&!document.getElementById("etTitle")')(),
        '#modalRoot [data-act="save-edit"]');
      await ui.waitFor(new Function('return async()=>{const head=await ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;return state.tasks.find(task=>task.id==='+JSON.stringify(id)+')?.title==='+JSON.stringify(title)+'&&stored?.tasks?.find(task=>task.id==='+JSON.stringify(id)+')?.title==='+JSON.stringify(title)+'}')(),
        12000,label+' is an independently saved durable title edit');
      return ui.page.evaluate(async id=>{const head=await ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;return{current:state.tasks.find(task=>task.id===id)?.title,durable:stored?.tasks?.find(task=>task.id===id)?.title,durableHash:head.hash};},id);
    };
    const seededSources=await sourceSnapshot();ui.recordOrdinaryUndoSeedSource(seededSources);
    const fixtureSeed=ui.ordinaryUndoFixtureSeed;
    assert.ok(fixtureSeed,'The existing observer retains the admitted three original fixture inputs');
    assert.equal(hash(fixtureSeed.headPayload),'434161b20aa6361220d67e96198d1694023a1ca67dd18e49984febe3fc97a780');
    assert.equal(seededSources.durable,fixtureSeed.headPayload,'Opening preserves the exact independently frozen seed payload');
    assert.deepEqual(JSON.parse(seededSources.current).protectedBackupIds,['gate-retained-1']);
    assert.deepEqual(JSON.parse(seededSources.durable).protectedBackupIds,['gate-retained-1']);
    assertSourceFixture(fixtureSeed,seededSources);
    const initialTitles=await ui.page.evaluate(()=>({prior:state.tasks.find(task=>task.id==='synthetic-populated-1')?.title,
      target:state.tasks.find(task=>task.id==='synthetic-kept')?.title}));
    assert.equal(typeof initialTitles.prior,'string','The ordinary fixture has a separate prior-history task');
    assert.equal(typeof initialTitles.target,'string','The ordinary fixture has the exact target task');
    await ensureListOpen(ui,true);
    const priorTitle='Ordinary prior edit remains available';
    const priorSave=await saveTitle(priorId,priorTitle,'Prior history edit');
    const baseline=await sourceSnapshot();ui.recordOrdinaryUndoPhase('B0',baseline);
    const baselineBoard=JSON.parse(baseline.current),baselineDurable=JSON.parse(baseline.durable),
      baselineTargetTitle=baselineBoard.tasks.find(task=>task.id===targetId)?.title;
    assert.equal(priorSave.current,priorTitle);assert.equal(priorSave.durable,priorTitle);
    assert.equal(typeof baselineTargetTitle,'string');
    const undoWasAvailable=await ui.page.locator('[data-act="undo"]').isEnabled();
    assert.equal(undoWasAvailable,true,'One prior independently saved edit remains available before the two target edits');
    const frameOneTitle='Ordinary undo frame one',frameTwoTitle='Ordinary undo frame two';
    const frameOne=await saveTitle(targetId,frameOneTitle,'First target edit frame');
    const first=await sourceSnapshot();ui.recordOrdinaryUndoPhase('B1',first);
    const frameTwo=await saveTitle(targetId,frameTwoTitle,'Second target edit frame');
    const second=await sourceSnapshot();ui.recordOrdinaryUndoPhase('B2',second);
    assert.notEqual(frameOne.durableHash,priorSave.durableHash,'The first target edit commits a distinct durable frame');
    assert.notEqual(frameTwo.durableHash,frameOne.durableHash,'The second target edit commits a separate durable frame');
    assert.deepEqual({current:frameTwo.current,durable:frameTwo.durable},{current:frameTwoTitle,durable:frameTwoTitle},
      'Both independently saved edits reach the exact current and durable target');
    await ui.page.evaluate(({titles})=>{window.__ordinaryUndoExpectedTitles=titles;window.__ordinaryUndoCompleted=0;window.__ordinaryUndoSavedPhases=[];},
      {titles:[frameOneTitle,baselineTargetTitle]});
    const nextUndoFrameRestored=new Function('return async()=>{const completed=window.__ordinaryUndoCompleted,titles=window.__ordinaryUndoExpectedTitles;'+
      'const clicks=window.__buttonNativeClicks.filter(row=>row.action==="act:undo"&&row.trusted===true);'+
      'if(!Array.isArray(titles)||completed>=titles.length||clicks.length!==completed+1)return false;'+
      'const expected=titles[completed],head=await ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;'+
      'if(state.tasks.find(task=>task.id==="synthetic-kept")?.title!==expected||stored?.tasks?.find(task=>task.id==="synthetic-kept")?.title!==expected)return false;'+
      'const current=JSON.stringify(state),sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,"0")).join("");'+
      'const snapshot={current,currentHash:await sha256(current),durable:head.payload,durableHash:head.hash,capturedAtMs:Date.now(),lastSaveClickAtMs:window.__buttonNativeClicks.findLast(row=>row.action==="act:save-edit")?.at,lastUndoClickAtMs:clicks.at(-1).at,'+
      'backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),pending:await ScannerDeviceStore.getPendingUpload("gate-owner"),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,timeZoneOffsetMinutes:new Date().getTimezoneOffset()};snapshot.capturedAtMs=Date.now();'+
      'window.__ordinaryUndoSavedPhases.push({...snapshot,sourceValueEncoding:"chain-scanner.manual-archive-value/v1",sourceValue:encodeManualArchiveValue(snapshot,"ordinary Undo sourceSnapshot")});'+
      'window.__ordinaryUndoCompleted=completed+1;return true;}')();
    const attempts=await ui.repeat('act:undo',2,nextUndoFrameRestored,'[data-act="undo"]',
      'Undo restores one independently saved title frame');
    const undoPhases=await ui.page.evaluate(()=>window.__ordinaryUndoSavedPhases);
    assert.equal(undoPhases.length,2,'Both actual Undo inputs retain a complete current and durable phase');
    for(const phase of undoPhases)phase.currentHash=hash(phase.current);
    const restored=await sourceSnapshot();
    ui.recordOrdinaryUndoFinalSource(restored);
    const restoredBoard=JSON.parse(restored.current);
    assert.equal(restored.current,undoPhases[1].current,'Final current readback retains the exact second Undo phase');
    assert.equal(restored.durable,undoPhases[1].durable,'Final durable readback retains the exact second Undo phase');

    const parse=phase=>({current:JSON.parse(phase.current),durable:JSON.parse(phase.durable)});
    const states=[baseline,first,second,...undoPhases].map(parse),phases=[baseline,first,second,...undoPhases];
    const task=(board,id)=>board.tasks.find(row=>row.id===id);
    const keys=(value,expected,label)=>assert.deepEqual(Object.keys(value).sort(),expected.slice().sort(),label);
    const nonce=(value,label)=>assert.ok(typeof value==='string'&&value.length>0,label);
    const gestureKeys=['v','id','at','kind','actionId','account','baseId','passId','passAt','scanMode','chainIds','observedActionIds'];
    const validateGesture=(fact,phase,previousIds,label)=>{
      assert.equal(fact.v,1);nonce(fact.id,label+' unique fact identity');nonce(fact.actionId,label+' unique action identity');
      assert.equal(fact.account,baselineBoard.syncAccount);assert.equal(fact.baseId,null);
      assert.equal(fact.passId,baselineBoard.passId);assert.equal(fact.passAt,baselineBoard.passStartedAt);
      assert.equal(fact.scanMode,baselineBoard.scanMode);assert.deepEqual(fact.chainIds,baselineBoard.chain);
      assert.deepEqual(fact.observedActionIds,previousIds,label+' observes the preceding actual fact frontier');
      const clickAt=fact.kind==='undo'?phase.lastUndoClickAtMs:phase.lastSaveClickAtMs;
      assert.ok(Number.isFinite(fact.at)&&fact.at>=Math.floor(clickAt)&&fact.at<=phase.capturedAtMs,label+' retains its actual input/save time');
    };
    const validateTitle=(fact,id,before,title,phase,previousIds,label)=>{
      keys(fact,[...gestureKeys,'target','value','after','before','taskContextIds'],label+' complete title fact fields');
      assert.equal(fact.kind,'current-choice');assert.deepEqual(fact.target,{type:'task',id,property:'title'});
      assert.deepEqual(fact.before,{present:true,value:before});assert.deepEqual(fact.after,{present:true});assert.equal(fact.value,title);
      assert.deepEqual(fact.taskContextIds,{[id]:task(baselineBoard,id).ctx});validateGesture(fact,phase,previousIds,label);
    };
    assert.equal(baselineBoard.tasks.length,64);assert.equal(baselineDurable.tasks.length,64);
    assert.equal(baselineBoard.decisionEvents.length,1,'The baseline retains exactly the separate prior-title fact');
    const priorFact=baselineBoard.decisionEvents[0];validateTitle(priorFact,priorId,initialTitles.prior,priorTitle,baseline,[],'Prior edit');
    assert.deepEqual(baselineDurable.decisionEvents,baselineBoard.decisionEvents,'Prior fact is durably retained before target edits');
    const savedOne=states[1].current.decisionEvents,savedTwo=states[2].current.decisionEvents;
    assert.equal(savedOne.length,2);assert.equal(savedTwo.length,3);
    const titleOne=savedOne[1],titleTwo=savedTwo[2];
    validateTitle(titleOne,targetId,baselineTargetTitle,frameOneTitle,first,[priorFact.id],'First title edit');
    validateTitle(titleTwo,targetId,frameOneTitle,frameTwoTitle,second,[titleOne.id],'Second title edit');
    assert.deepEqual(savedOne,[priorFact,titleOne],'First edit preserves the complete prior fact');
    assert.deepEqual(savedTwo,[priorFact,titleOne,titleTwo],'Second edit preserves both earlier complete facts');
    const facts=[priorFact,titleOne,titleTwo],eventSequences=[baselineBoard.decisionEvents,savedOne,savedTwo];
    for(let index=0;index<2;index++){
      const phase=undoPhases[index],events=states[index+3].current.decisionEvents,target=index===0?titleTwo:titleOne;
      assert.equal(events.length,4+index,'Each actual Undo adds exactly one cancellation fact');
      const cancellation=events.at(-1);
      keys(cancellation,[...gestureKeys,'baselineId','targetActionId','targetEventIds'],'Complete Undo cancellation fields');
      assert.equal(cancellation.kind,'undo');assert.equal(cancellation.baselineId,baselineBoard.decisionBaseline.id);
      assert.equal(cancellation.targetActionId,target.actionId);assert.deepEqual(cancellation.targetEventIds,[target.id]);
      validateGesture(cancellation,phase,[facts.at(-1).id],'Undo '+(index+1));
      facts.push(cancellation);assert.deepEqual(events,facts,'Undo preserves every preceding immutable fact and adds only its targeted cancellation');
      eventSequences.push(copy(facts));
    }
    assert.equal(new Set(facts.map(row=>row.id)).size,5,'All five original/title/cancellation fact identities are distinct');
    assert.equal(new Set(facts.map(row=>row.actionId)).size,5,'Each saved edit or Undo has its own action identity');
    const observedTarget=task(states[1].current,targetId),observation=observedTarget.ratingHistory?.[0];
    assert.equal(task(baselineBoard,targetId).ratingHistory,undefined,'The real first target Save introduces its first honest observation');
    assert.equal(observedTarget.ratingHistory.length,1);keys(observation,['v','id','at','seq','kind','change','after','basis'],'Complete first edit observation fields');
    assert.equal(observation.v,1);assert.equal(observation.kind,'edit');assert.equal(observation.change,'observation');assert.equal(observation.seq,1);
    nonce(observation.id,'Original observation identity');nonce(observation.basis,'Original observation basis');
    assert.ok(observation.at>=Math.floor(first.lastSaveClickAtMs)&&observation.at<=first.capturedAtMs,'The observation retains its actual first Save time');
    assert.equal(observedTarget.ratingHistoryHead,observation.id);
    keys(observation.after,['mu','sigma','likelihood','eligible','fallback','topK','n','samples'],'Complete original observed metrics');
    assert.deepEqual({...observation.after,topK:0},{mu:task(baselineBoard,targetId).mu,sigma:task(baselineBoard,targetId).sigma,
      likelihood:1/64,eligible:true,fallback:false,topK:0,n:64,samples:baselineBoard.settings.samples});
    assert.ok(Number.isInteger(observation.after.topK)&&observation.after.topK>=1&&observation.after.topK<=64,'Sampled rank remains a valid independently bounded observation');
    assert.equal(observation.basis,task(baselineBoard,priorId).ratingHistory.at(-1).basis,'Title-only edits preserve the existing rating-pool basis');
    const expectedTitles=[baselineTargetTitle,frameOneTitle,frameTwoTitle,frameOneTitle,baselineTargetTitle],expectedHashes=[];
    for(let index=0;index<phases.length;index++){
      const phase=phases[index],boards=states[index],clickAt=index<3?phase.lastSaveClickAtMs:phase.lastUndoClickAtMs;
      assert.ok(Number.isFinite(clickAt)&&Number.isFinite(phase.capturedAtMs));
      const updatedAt=boards.current.updatedAt;
      assert.ok(Number.isFinite(updatedAt)&&updatedAt>=Math.floor(clickAt)&&updatedAt<=phase.capturedAtMs,'Phase '+index+' has fresh actual local Save metadata');
      assert.equal(boards.durable.updatedAt,updatedAt,'Current and durable save metadata are exactly bound');
      if(index>0)assert.ok(updatedAt>states[index-1].current.updatedAt,'Each separate saved edit/Undo advances its own local save timestamp');
      const expected={};
      for(const side of ['current','durable']){
        const board=copy(index===0?boards[side]:states[0][side]);
        assert.equal(boards[side].tasks.length,64);assert.equal(new Set(boards[side].tasks.map(row=>row.id)).size,64);
        if(index>0){
          const expectedTarget=task(board,targetId);expectedTarget.title=expectedTitles[index];
          expectedTarget.ratingHistory=copy(observedTarget.ratingHistory);expectedTarget.ratingHistoryHead=observation.id;
          board.decisionEvents=copy(eventSequences[index]);board.updatedAt=updatedAt;
        }
        const encoded=JSON.stringify(board),actual=phase[side];
        assert.equal(JSON.stringify(boards[side].tasks),JSON.stringify(board.tasks),'Phase '+index+' preserves all64 complete task objects and every unknown key');
        assert.equal(actual,encoded,'Phase '+index+' exact '+side+' expected board retains all unknown and immutable evidence');
        assert.equal(phase[side+'Hash'],hash(encoded),'Phase '+index+' exact '+side+' full-board hash');
        expected[side+'Hash']=hash(encoded);expected[side]=encoded;
      }
      expectedHashes.push(expected);
    }
    assert.equal(restored.currentHash,expectedHashes[4].currentHash,'The complete current result matches its independent expected board');
    assert.equal(restored.durableHash,expectedHashes[4].durableHash,'The complete durable result matches its independent expected board');
    assert.equal(restoredBoard.tasks.find(task=>task.id===priorId)?.title,priorTitle,
      'The earlier independent edit remains visible after undoing exactly two later frames');
    const undoRemainsAvailable=await ui.page.locator('[data-act="undo"]').isEnabled();
    assert.equal(undoRemainsAvailable,true,'The earlier Undo frame remains available after the two requested Undo inputs');
    const preservesRows=(before,after,key)=>before.every(row=>{
      const matches=after.filter(candidate=>candidate[key]===row[key]);
      return matches.length===1&&JSON.stringify(matches[0])===JSON.stringify(row);
    })&&after.filter(row=>before.some(previous=>previous[key]===row[key])).length===before.length;
    const sourceProof=inspectSourceLifecycle(fixtureSeed,seededSources,phases,restored,expectedHashes);
    const originalBackupsPreserved=preservesRows(baseline.backups.filter(row=>row.id!==sourceProof.baselineRollingId),restored.backups,'id')&&sourceProof.originalBackupsPreserved;
    const originalOpaqueSourcesPreserved=preservesRows(baseline.opaque,restored.opaque,'key')&&sourceProof.originalOpaqueSourcesPreserved;
    assert.equal(originalBackupsPreserved,true,'Every protected backup present before the target edits remains byte-for-byte intact');
    assert.equal(originalOpaqueSourcesPreserved,true,'Every protected opaque source present before the target edits remains byte-for-byte intact');
    assert.deepEqual(restored.pending,baseline.pending,'The pre-existing pending-upload source is unchanged');
    assert.equal(await ui.page.evaluate(()=>window.__ordinaryUndoCompleted),2,'The two separate Undo inputs restore two ordered frames');
    ui.recordRepeatOutcome(ordinaryUndoCase,attempts,JSON.stringify({priorTaskId:priorId,priorTitle,targetTaskId:targetId,baselineTargetTitle,
      frameTitles:[frameOneTitle,frameTwoTitle],durableHashes:[priorSave.durableHash,frameOne.durableHash,frameTwo.durableHash],
      baselineCurrentHash:baseline.currentHash,restoredCurrentHash:restored.currentHash,expectedCurrentHash:expectedHashes[4].currentHash,
      baselineDurableHash:baseline.durableHash,restoredDurableHash:restored.durableHash,expectedDurableHash:expectedHashes[4].durableHash,
      currentRestored:true,durableRestored:true,priorHistoryPreserved:true,originalBackupsPreserved,originalOpaqueSourcesPreserved,pendingUploadPreserved:sourceProof.pendingUploadPreserved,
      automaticBackupLifecycleValidated:sourceProof.automaticBackupLifecycleValidated,typedSourceValuesPreserved:sourceProof.originalOpaqueSourcesPreserved,
      fullTaskArraysPreserved:true,immutableFactsPreserved:true,freshSaveMetadataValidated:true,phases:['B0','B1','B2','U1','U2']}));
  });

  await h.scenario('rapid Add and context actions with 400 saved tasks',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Add/context');
    await ten(ui,'toggle-add',()=>state.addOpen===true&&document.getElementById('addToggle').getAttribute('aria-expanded')==='true',
      '#addToggle','Ten real toggles return the Add panel to its initially open state.');
    await ui.fill('#addStart','2026-10-01');
    await once(ui,'clear-task-date',()=>document.getElementById('addStart').value===''&&
      document.querySelector('#addStartClear').disabled,'#addStartClear',
      'The first clear removes its date and disables that now-empty control; remaining attempts are unavailable.');
    await ui.fill('#addDue','2026-10-02');
    await once(ui,'clear-task-date',()=>document.getElementById('addDue').value===''&&
      document.querySelector('#addDueClear').disabled,'#addDueClear',
      'The first clear removes its date and disables that now-empty control; remaining attempts are unavailable.');
    await ten(ui,'qctx',()=>document.querySelector('#quickCtxRow [data-act="qctx"][data-id="rapid-context"]')?.getAttribute('aria-pressed')==='false',
      '#quickCtxRow [data-act="qctx"][data-id="rapid-context"]',
      'Ten quick-add context presses return the draft chip to its initially unselected state.');

    await ui.select('#addPrerequisite','synthetic-populated-1');
    await once(ui,'add-dependency',()=>document.querySelectorAll('#addDependencies select').length===2&&
      !document.querySelector('#addDependencies [data-act="add-dependency"]'),
      '#addDependencies [data-act="add-dependency"]',
      'One dependency row is appended; the blank row prevents another until it is filled.');
    await ui.select('#addPrerequisite1','synthetic-populated-2');
    await once(ui,'remove-dependency',()=>document.querySelectorAll('#addDependencies select').length===1,
      '#addDependencies [data-act="remove-dependency"][data-index="1"]',
      'The selected added dependency row is removed; that row-specific button disappears.');
    await once(ui,'remove-dependency',()=>document.querySelectorAll('#addDependencies select').length===1&&
      document.querySelector('#addPrerequisite').value==='',
      '#addDependencies [data-act="remove-dependency"][data-index="0"]',
      'The final selected dependency is removed, leaving one empty row and no remove action.');

    await ui.fill('#addInput','Rapid Add accepted once');
    await ten(ui,'add',()=>state.tasks.length===401&&state.tasks.filter(task=>task.title==='Rapid Add accepted once').length===1&&
      document.getElementById('addInput').value==='',
      '#addButton','All ten native Add attempts are delivered; the typed draft is consumed exactly once and blank repeats add nothing.');
    await waitForStoredTaskCount(ui,401,'The one accepted Add is durably saved');
    await ui.burst('add-ctx',()=>state.contexts.filter(context=>context.name==='Safety gate context').length===10,
      {selector:'#ctxPanel [data-act="add-ctx"]',semantics:'Each accepted prompt creates one context; ten accepted context prompts add ten rows.',expectedAccepted:10});
    const contextPanelState=await ui.page.evaluate(()=>({open:state.ctxOpen===true,rendered:!!document.querySelector('#ctxPanel .ctxgrid')}));
    assert.equal(contextPanelState.rendered,contextPanelState.open,'Context panel starts with its saved open/closed state rendered');
    const contextPanelInitiallyOpen=contextPanelState.open;
    const contextPanelReturns=new Function('return ()=>state.ctxOpen==='+JSON.stringify(contextPanelInitiallyOpen)+
      '&& (!!document.querySelector("#ctxPanel .ctxgrid"))==='+JSON.stringify(contextPanelInitiallyOpen))();
    await ten(ui,'toggle-ctx',contextPanelReturns,
      '#ctxPanel [data-act="toggle-ctx"]','Ten context-panel toggles return the panel to its exact initial open/closed state.');
    await ten(ui,'cycle-context',()=>document.querySelector('#ctxPanel [data-act="cycle-context"][data-id="rapid-context"]')?.dataset.filterState==='included',
      '#ctxPanel [data-act="cycle-context"][data-id="rapid-context"]',
      'Ten included/excluded cycles return the context to its initially included state.');
    await ten(ui,'toggle-no-context',()=>state.settings.excludeNoContext===false&&
      document.querySelector('#ctxPanel [data-act="toggle-no-context"]')?.dataset.filterState!=='excluded',
      '#ctxPanel [data-act="toggle-no-context"]','Ten No context toggles return the saved exclusion choice to its initial value.');
  });

  await h.scenario('rapid Settings, theme, context management, and save with 400 tasks',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Settings/context management');
    await once(ui,'settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings','[data-act="settings"]',
      'The first Settings press opens its modal; later attempts are obscured by that modal.');
    const summaries=await ui.page.locator('#modalRoot details.settings-section > summary').count();
    assert.ok(summaries>0,'Settings renders its disclosure summaries');
    await ten(ui,'disclosure',()=>document.querySelector('#modalRoot details.settings-section > summary')?.parentElement.open===true,
      '#modalRoot details.settings-section > summary','Ten native summary presses return the initially open first Settings disclosure to open.');
    await ui.fill('#newCtxName','Rapid named context');
    await once(ui,'add-ctx-named',()=>state.contexts.filter(context=>context.name==='Rapid named context').length===1&&
      document.getElementById('newCtxName').value==='',
      '#modalRoot [data-act="add-ctx-named"]',
      'The first nonempty named-context press adds one context and rerenders Settings; later attempts are unavailable while its section is collapsed.');
    await once(ui,'del-ctx',()=>!state.contexts.some(context=>context.id==='rapid-delete-context'),
      '#modalRoot [data-act="del-ctx"][data-id="rapid-delete-context"]',
      'The first delete removes its context row; the same row-specific action disappears.');
    await ui.fill('#stHorizon','61');
    await once(ui,'save-settings',()=>state.settings.horizonMin===61&&!document.querySelector('#modalRoot .modal'),
      '#modalRoot [data-act="save-settings"]','The first Save settings press saves the draft and closes Settings; later attempts are unavailable.');
    await ten(ui,'cycle-theme',()=>state.settings.theme==='dark'&&document.documentElement.dataset.theme==='dark',
      '#themeBtn','Ten theme cycles from Light end on Dark (the defined three-state cycle plus one).');
  });

  await h.scenario('rapid All Tasks and bulk editing with 400 saved tasks',{decorate:board=>{
    activeBoard(board);board.tasks.forEach(task=>{task.url='https://example.com/'+task.id;});
  }},async ui=>{
    await assert400(ui,'All Tasks/bulk');
    await ensureListOpen(ui,true);
    await ten(ui,'toggle-list',()=>state.listOpen===true&&!document.getElementById('listBody').hidden,
      '#listWrap [data-act="toggle-list"]','Ten All Tasks toggles return the list to its initially open state.');
    await ten(ui,'list-tag',()=>document.querySelector('#listTagRow [data-act="list-tag"][data-id="c:rapid-context"]')?.getAttribute('aria-pressed')==='false',
      '#listTagRow [data-act="list-tag"][data-id="c:rapid-context"]','Ten repeated context filters return the tag filter to its initial unselected state.');
    const eligibleSelector='#listEligibilityRow [data-act="list-eligibility"][data-id="eligible"]';
    await ui.act('list-eligibility',()=>document.querySelector('#listEligibilityRow [data-id="eligible"]')?.getAttribute('aria-pressed')==='true',eligibleSelector);
    await ui.page.locator(eligibleSelector).focus();
    await ui.page.evaluate(()=>{const body=document.getElementById('listBody');body.scrollTop=180;window.__eligibleMounted={row:body.querySelector('[data-act="edit"]'),button:document.activeElement,scrollTop:body.scrollTop};});
    await ten(ui,'list-eligibility',()=>document.querySelector('#listEligibilityRow [data-act="list-eligibility"][data-id="eligible"]')?.getAttribute('aria-pressed')==='true',
      '#listEligibilityRow [data-act="list-eligibility"][data-id="eligible"]',
      'Ten repeated Eligible selections remain on the same explicitly selected filter.');
    const continuity=await ui.page.evaluate(()=>{const saved=window.__eligibleMounted,body=document.getElementById('listBody');return{row:saved.row===body.querySelector('[data-act="edit"]')&&saved.row.isConnected,button:saved.button.isConnected,scroll:body.scrollTop===saved.scrollTop};});
    assert.deepEqual(continuity,{row:true,button:true,scroll:true},'Repeated selected eligibility retains actual mounted rows, control and scroll');
    // WebKit may blur a button on native mouse down. Test keyboard focus through
    // the actual Enter consumer instead of overriding that platform policy.
    await ui.page.locator(eligibleSelector).focus();await ui.page.locator(eligibleSelector).press('Enter');
    await ui.waitFor(()=>{const saved=window.__eligibleMounted,body=document.getElementById('listBody');return saved.button.isConnected&&document.activeElement===saved.button&&saved.row===body.querySelector('[data-act="edit"]')&&body.scrollTop===saved.scrollTop;},12000,'Focused native Enter keeps the selected eligibility control and rows mounted');

    await ui.fill('#listSearch','rapid no match');
    await once(ui,'clear-list-filters',()=>document.getElementById('listSearch').value===''&&
      !document.querySelector('#listTagRow [aria-pressed="true"]')&&
      document.querySelector('#listEligibilityRow [data-id="all"]')?.getAttribute('aria-pressed')==='true'&&
      document.querySelectorAll('#listBody [data-act="edit"]').length===400,
      '#listBody [data-act="clear-list-filters"]',
      'The first Clear filters press restores all 400 rows; the empty-result action disappears.');

    await ten(ui,'bulk-select',()=>document.querySelector('#listBulkToolbar [data-act="bulk-select"]')?.getAttribute('aria-pressed')==='true',
      '#listBulkToolbar [data-act="bulk-select"]','Ten start-selection presses leave selection mode on; the action is idempotent.');
    await ten(ui,'bulk-toggle',()=>document.querySelector('#listBody [data-act="bulk-toggle"][data-id="synthetic-kept"]')?.getAttribute('aria-pressed')==='false',
      '#listBody [data-act="bulk-toggle"][data-id="synthetic-kept"]',
      'Ten presses on one task selection toggle it an even number of times back to unselected.');
    await ten(ui,'bulk-select-all',()=>document.querySelector('#listBulkToolbar [data-act="bulk-edit"]')?.disabled===false,
      '#listBulkToolbar [data-act="bulk-select-all"]','Ten Select all presses remain accepted and leave all 400 visible tasks selected.');
    await once(ui,'bulk-cancel',()=>document.querySelector('#listBulkToolbar [data-act="bulk-select"]')?.getAttribute('aria-pressed')==='false'&&
      !document.querySelector('#listBulkToolbar [data-act="bulk-cancel"]'),
      '#listBulkToolbar [data-act="bulk-cancel"]','The first Cancel selection press clears selection mode; its action disappears.');

    await ui.act('bulk-select',()=>document.querySelector('#listBulkToolbar [data-act="bulk-select"]')?.getAttribute('aria-pressed')==='true');
    await ui.act('bulk-select-all',()=>document.querySelector('#listBulkToolbar [data-act="bulk-edit"]')?.disabled===false);
    await once(ui,'bulk-edit',()=>document.querySelector('#modalRoot h2')?.textContent==='Edit 400 selected tasks'&&
      !!document.getElementById('bulkApplyUrl'),
      '#listBulkToolbar [data-act="bulk-edit"]','The first Edit press opens a 400-task modal; further attempts are obscured.');
    await ten(ui,'bulk-clear',()=>document.getElementById('bulkApplyUrl')?.checked===true&&
      document.getElementById('bulkStatusUrl')?.textContent.includes('Will clear'),
      '#modalRoot [data-act="bulk-clear"][data-field="url"]',
      'Ten repeated Clear-link intents remain accepted and idempotently mark the same field for all 400 selected tasks.');
    await once(ui,'bulk-save',()=>!document.getElementById('bulkApplyUrl')&&
      state.tasks.length===400&&state.tasks.every(task=>task.url===null),
      '#modalRoot [data-act="bulk-save"]','The first Save selected press clears the chosen field for 400 tasks and closes the modal.');
    await waitForStoredTaskCount(ui,400,'Bulk save preserves all 400 tasks');
  });

  await h.scenario('rapid editor, history, and task actions with 400 saved tasks',{decorate:board=>{
    activeBoard(board);board.tasks[0].due='2026-10-02';board.considered={'synthetic-populated-5':'no'};historyRows(board);
  }},async ui=>{
    await assert400(ui,'Editor/history');
    await ensureListOpen(ui,true);
    await once(ui,'edit',()=>document.querySelector('#modalRoot h2')?.textContent==='Edit task'&&!!document.getElementById('etTitle'),
      '#listBody [data-act="edit"][data-id="synthetic-kept"]','The first Edit press opens the modal; remaining attempts are covered by it.');
    await ui.fill('#etTitle','Rapid editor saved');
    await ui.fill('#etDue','2026-10-02');
    await once(ui,'clear-task-date',()=>document.getElementById('etDue').value===''&&document.getElementById('etDueClear').disabled,
      '#modalRoot #etDueClear','The first editor date clear empties the field and disables that control.');
    await ui.select('#etPrerequisite','synthetic-populated-1');
    await once(ui,'add-dependency',()=>document.querySelectorAll('#editDependencies select').length===2&&
      !document.querySelector('#editDependencies [data-act="add-dependency"]'),
      '#editDependencies [data-act="add-dependency"]','One editor dependency row is appended; the blank row hides the add action.');
    await ui.select('#etPrerequisite1','synthetic-populated-2');
    await once(ui,'remove-dependency',()=>document.querySelectorAll('#editDependencies select').length===1,
      '#editDependencies [data-act="remove-dependency"][data-index="1"]','The added editor dependency row is removed and its action disappears.');
    await ui.fill('#etTitle','Rapid editor saved');
    await once(ui,'save-edit',()=>state.tasks.find(task=>task.id==='synthetic-kept')?.title==='Rapid editor saved'&&
      !document.getElementById('etTitle'),
      '#modalRoot [data-act="save-edit"]','The first Save edit press saves the draft and closes the modal.');

    await openEditor(ui,'synthetic-kept');
    await once(ui,'done-task',()=>state.tasks.find(task=>task.id==='synthetic-kept')?.done===true&&
      !document.getElementById('etTitle'),
      '#modalRoot [data-act="done-task"]','The first Done press completes the edited task and closes the modal.');
    await ten(ui,'toggle-hist',()=>state.histOpen===false,'#histPanel [data-act="toggle-hist"]',
      'Ten History-panel toggles return the initially closed panel to closed.');
    await ui.act('toggle-hist',()=>state.histOpen===true);
    await once(ui,'restore',()=>state.tasks.find(task=>task.id==='synthetic-kept')?.done===false&&
      !document.querySelector('#histPanel [data-act="restore"][data-id="synthetic-kept"]'),
      '#histPanel [data-act="restore"][data-id="synthetic-kept"]','The first Restore press returns the task to the active board; its History row disappears.');

    await openEditor(ui,'synthetic-populated-1');
    await once(ui,'worked-task',()=>!!state.workedAt['synthetic-populated-1']&&!document.getElementById('etTitle'),
      '#modalRoot [data-act="worked-task"]','The first Worked press records the task and closes the editor.');
    await openEditor(ui,'synthetic-populated-2');
    await once(ui,'dot-task',()=>state.chain.includes('synthetic-populated-2')&&!document.getElementById('etTitle'),
      '#modalRoot [data-act="dot-task"]','The first Dot press adds the task to the chain and closes the editor.');
    await openEditor(ui,'synthetic-populated-5');
    await once(ui,'return-candidate',()=>state.considered['synthetic-populated-5']!=='no'&&
      !document.querySelector('#modalRoot [data-act="return-candidate"]'),
      '#modalRoot [data-act="return-candidate"]','The first Return press clears the saved skip; the now-unneeded editor action disappears.');
    await openEditor(ui,'synthetic-populated-6');
    await once(ui,'more-rating-history',()=>document.querySelectorAll('#taskRatingHistory .rating-event').length===25&&
      !document.querySelector('#taskRatingHistory [data-act="more-rating-history"]'),
      '#modalRoot [data-act="more-rating-history"]','The first More history press reveals all 25 saved observations and removes the paging action.');
    await once(ui,'close-modal',()=>!document.getElementById('etTitle'),'#modalRoot [data-act="close-modal"]',
      'The first Close press dismisses the editor; further attempts have no modal target.');

    await openEditor(ui,'synthetic-populated-4');
    await once(ui,'delete-task',()=>!state.tasks.some(task=>task.id==='synthetic-populated-4')&&
      !document.getElementById('etTitle'),
      '#modalRoot [data-act="delete-task"]','The first Delete press removes the selected task and closes the editor.');
    await waitForStoredTaskCount(ui,399,'Editor deletion is durably saved');
  });

  await h.scenario('rapid Undo consumes ten actual saved edit frames',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Undo');
    const originalTitle=await ui.page.evaluate(()=>state.tasks.find(task=>task.id==='synthetic-kept')?.title);
    const priorUndoEnabled=await ui.page.locator('[data-act="undo"]').isEnabled();
    assert.equal(typeof originalTitle,'string','Undo fixture has a concrete original title');
    for(let index=1;index<=10;index++){
      const title='Rapid undo frame '+index;
      await openEditor(ui,'synthetic-kept');await ui.fill('#etTitle',title);
      const savedTitle=new Function('return ()=>state.tasks.find(task=>task.id==="synthetic-kept")?.title==='+
        JSON.stringify(title)+'&&!document.getElementById("etTitle")')();
      await ui.act('save-edit',savedTitle);
    }
    await ui.waitFor(async()=>{
      const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;
      return stored?.tasks?.find(task=>task.id==='synthetic-kept')?.title==='Rapid undo frame 10';
    },12000,'All ten real edit frames are durably saved before Undo');
    const undoRestoredBaseline=new Function('return ()=>state.tasks.find(task=>task.id==="synthetic-kept")?.title==='+
      JSON.stringify(originalTitle)+'&&document.querySelector("[data-act=\\"undo\\"]")?.disabled==='+JSON.stringify(!priorUndoEnabled))();
    await ten(ui,'undo',undoRestoredBaseline,
      '[data-act="undo"]','Ten Undo presses consume the ten actual saved edit frames in order and restore the exact baseline title; earlier fixture history remains available.');
    await waitForStoredTaskCount(ui,400,'Undo preserves all 400 durable tasks');
    const durableBaseline=new Function('return async()=>{const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;'+
      'return stored?.tasks?.find(task=>task.id==="synthetic-kept")?.title==='+JSON.stringify(originalTitle)+'}')();
    await ui.waitFor(durableBaseline,12000,'Undo restores the exact durable baseline title');
    const restored=await ui.page.evaluate(async()=>{const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;return stored?.tasks?.find(task=>task.id==='synthetic-kept')?.title;});
    assert.equal(restored,originalTitle,'Ten accepted Undo actions restore the exact durable baseline title');
  });

  await h.scenario('rapid scanner candidate actions with 400 active tasks',{decorate:scannerBoard},async ui=>{
    await assert400(ui,'Scanner candidates');
    if(ui.mobileYesMotion)await ui.act('start-scan',()=>state.chain.length===1&&!!state.candidateId,'[data-act="start-scan"]');
    else await once(ui,'start-scan',()=>state.chain.length===1&&!!state.candidateId,'[data-act="start-scan"]',
      'The first Start press creates the initial dot and candidate; scanning controls replace Start.');
    const mobileBefore=ui.mobileYesMotion?await beginMobileYes(ui):null;
    const yesOutcome=()=>state.chain.length===11&&!!state.candidateId;
    try{await ten(ui,'yes',yesOutcome,'#scan [data-act="yes"]',
      'Ten Yes presses choose ten new offered candidates while 400 tasks keep scanning active.');}
    catch(error){const probe=await ui.page.evaluate(()=>({chain:state.chain.length,candidate:state.candidateId,mode:state.mode,
      intervention:state.interventionActive,snooze:state.snooze,considered:Object.keys(state.considered).length,
      scanText:document.querySelector('#scan')?.innerText}));error.message+='; final scanner state '+JSON.stringify(probe);throw error;}
    if(ui.mobileYesMotion){await finishMobileYes(ui,mobileBefore);return;}
    await ten(ui,'no',()=>Object.values(state.considered).filter(value=>value==='no').length===10&&!!state.candidateId,
      '#scan [data-act="no"]','Ten No presses skip ten distinct offered candidates; the next candidate remains available.');
    await ten(ui,'cant',()=>Object.values(state.considered).filter(value=>value==='cant').length===10&&!!state.candidateId,
      '#scan [data-act="cant"]','Ten Can’t presses record ten distinct temporary holds while preserving the next candidate.');
    await ten(ui,'postpone',()=>state.tasks.filter(task=>task.postponeOps?.some(op=>op.until>Date.now())).length===10&&!!state.candidateId,
      '#scan [data-act="postpone"]','Ten Postpone presses defer ten distinct candidates; the remaining active tasks keep the control available.');
    await ten(ui,'cand-done',()=>state.tasks.filter(task=>task.done).length===10&&!!state.candidateId,
      '#scan [data-act="cand-done"]','Ten candidate Done presses complete ten distinct tasks and keep the next candidate available.');
    await ten(ui,'cand-worked',()=>Object.keys(state.workedAt).length===10&&!!state.candidateId,
      '#scan [data-act="cand-worked"]','Ten candidate Worked presses record ten distinct tasks and keep scanning available.');
    await ten(ui,'reveal',()=>state.listOpen===true&&document.getElementById('listBody').getClientRects().length>0,
      '#scan [data-act="reveal"]','Ten repeated reveal presses keep All Tasks open while the same chain crumb remains visible.');
    await waitForStoredTaskCount(ui,400,'Scanner decisions preserve the 400-task board');
  });

  await burstBenchmark(h,'bench-done',()=>state.tasks.filter(task=>task.done).length===10&&state.chain.length===10,
    'Ten benchmark Done presses complete ten queued tasks; the next benchmark is exposed after each.');
  await burstBenchmark(h,'bench-cant',()=>Object.values(state.considered).filter(value=>value==='cant').length===10&&state.chain.length===10,
    'Ten benchmark Can’t presses remove ten current benchmarks and expose the next each time.');
  await burstBenchmark(h,'bench-postpone',()=>state.mode==='scan'&&state.chain.length===10&&
    state.tasks.filter(task=>task.postponeOps?.some(op=>op.until>Date.now())).length===10,
    'Ten benchmark Postpone presses defer ten distinct queued tasks, keep the remaining ten-item chain and leave the scanner in Scan mode.');
  await burstBenchmark(h,'dislodge',()=>Object.values(state.considered).filter(value=>value==='dislodged').length===10&&state.chain.length===10,
    'Ten Dislodge presses remove ten successive benchmarks while retaining the rest of the chain.');
  await burstBenchmark(h,'worked',()=>Object.keys(state.workedAt).length===10&&state.chain.length===10,
    'Ten benchmark Worked presses record ten queued tasks and expose the next benchmark each time.');

  await h.scenario('rapid scan and work transitions with 400 tasks',{decorate:board=>{
    scannerBoard(board);board.mode='work';board.chain=['synthetic-kept'];board.passStartedAt=Date.now()-60000;
  }},async ui=>{
    await assert400(ui,'Scan/work transitions');
    await once(ui,'resume-scan',()=>state.mode==='scan'&&!!state.candidateId,'[data-act="resume-scan"]',
      'The first Resume press starts scanning; its Work-mode control disappears.');
    await once(ui,'start-working',()=>state.mode==='work'&&!document.querySelector('#scan [data-act="start-working"]'),
      '#scan [data-act="start-working"]','The first Done adding press pauses scanning; the scan-mode control disappears.');
  });

  await h.scenario('rapid Continue scan from intervention with 400 tasks',{decorate:board=>{
    scannerBoard(board);board.chain=['synthetic-kept'];board.candidateId='synthetic-populated-1';
    board.interventionActive=true;board.interventionP=0.01;
  }},async ui=>{
    await assert400(ui,'Intervention');
    await once(ui,'continue-scan',()=>state.interventionActive===false&&state.mode==='scan',
      '#scan [data-act="continue-scan"]','Continue clears the intervention once; later attempts are unavailable after the prompt is dismissed.');
  });

  await h.scenario('rapid Rescan on an exhausted 400-task fixture',{fixtureRole:'exhausted',decorate:board=>{
    scannerBoard(board);board.settings.skipOldestFirstDot=true;board.passStartedAt=Date.now();
    for(const task of board.tasks)board.considered[task.id]='no';
  }},async ui=>{
    await once(ui,'rescan',()=>!Object.values(state.considered).includes('no')&&!!state.candidateId,
      '#scan [data-act="rescan"]','Rescan clears the skipped set once; its control disappears when a candidate becomes available.');
  });

  await h.scenario('rapid New pass on an exhausted 400-task fixture',{fixtureRole:'exhausted',decorate:board=>{
    scannerBoard(board);board.settings.skipOldestFirstDot=true;board.passStartedAt=Date.now();
    for(const task of board.tasks)board.considered[task.id]='no';
  }},async ui=>{
    await once(ui,'new-pass',()=>Object.keys(state.considered).length===0&&state.passStartedAt>0,
      '#scan [data-act="new-pass"]','Start a fresh pass clears the completed skipped pass once; active scanning replaces the button.');
  });

  await h.scenario('rapid overdue WOOP action with 400 tasks',{decorate:board=>{
    scannerBoard(board);for(const task of board.tasks)task.due='2000-01-01';
  }},async ui=>{
    await assert400(ui,'Overdue WOOP');
    await ui.act('start-scan',()=>!!state.candidateId);
    await once(ui,'run-woop',()=>document.querySelector('#modalRoot h2')?.textContent==='WOOP for overdue task'&&
      state.mode==='work'&&!!state.tasks.find(task=>task.id===state.candidateId||state.chain.includes(task.id)),
      '#scan [data-act="run-woop"]','The first Run WOOP press chooses the overdue task and opens its walkthrough; modal coverage blocks repeats.');
    await once(ui,'close-modal',()=>!document.querySelector('#modalRoot .modal'),'#modalRoot [data-act="close-modal"]',
      'The first Close press dismisses the overdue walkthrough; later attempts have no dialog target.');
  });

  await h.scenario('rapid final-task WOOP walkthrough and delete with 400 saved tasks',{
    fixtureRole:'sole',decorate:board=>{
      scannerBoard(board);board.tasks.forEach((task,index)=>{task.done=index!==0;task.completedAt=index?Date.now()-1000+index:null;task.lastDoneAt=index?Date.now()-1000+index:null;});
      board.settings.lastTaskWoop=true;board.mode='work';board.chain=['synthetic-kept'];
      board.tasks[0].ratingHistory=[0,1].map(index=>({v:1,id:'rapid-final-dislodge-'+index,at:Date.now()-2000+index,
        seq:index+1,kind:'dislodge',after:{mu:25,sigma:8.333333333,likelihood:1,eligible:true,fallback:false,n:1,samples:250,topK:1}}));
    }
  },async ui=>{
    await once(ui,'woop-start',()=>document.querySelector('#modalRoot h2')?.textContent==='WOOP for final task'&&
      !!document.getElementById('woopAnswer'),'#scan [data-act="woop-start"]',
      'The first final-task WOOP press opens its answer dialog; later attempts are covered.');
    await ui.fill('#woopAnswer','Rapid final outcome');
    await ten(ui,'woop-next',()=>document.querySelector('#modalRoot [data-act="woop-next"]')?.dataset.step==='1',
      '#modalRoot [data-act="woop-next"]','The first valid Next advances; remaining accepted presses have no answer and do not skip a WOOP step.');
    await ui.fill('#woopAnswer','Rapid final obstacle');
    await ten(ui,'woop-next',()=>document.querySelector('#modalRoot [data-act="woop-next"]')?.dataset.step==='2',
      '#modalRoot [data-act="woop-next"]','The first valid Next advances; remaining accepted presses cannot skip the required final answer.');
    await ui.fill('#woopAnswer','Rapid final if then plan');
    await once(ui,'woop-next',()=>!document.getElementById('woopAnswer')&&
      state.tasks.find(task=>task.id==='synthetic-kept')?.woopPlan?.outcome==='Rapid final outcome',
      '#modalRoot [data-act="woop-next"]','The first Save WOOP press stores the complete plan and closes the modal.');
    await once(ui,'woop-delete',()=>state.tasks.find(task=>task.id==='synthetic-kept')?.woopPlan===null&&
      !document.querySelector('#scan [data-act="woop-delete"]'),
      '#scan [data-act="woop-delete"]','The first Delete WOOP press removes the saved plan and replaces its action.');
  });

  await h.scenario('rapid backup creation, restore, and deletion with 400 saved tasks',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Backup controls');
    await once(ui,'settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings','[data-act="settings"]',
      'The first Settings press opens its modal; remaining attempts are obscured.');
    await ui.fill('#stHorizon','61');
    await ui.act('save-settings',()=>state.settings.horizonMin===61&&!document.getElementById('stHorizon'));
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    const manualBurst=await bounded(ui,'make-manual-backup',async()=>{
      const rows=await window.ScannerDeviceStore.listBackups(),manual=rows.filter(row=>row.kind==='manual');
      return manual.length>=1&&manual.length<=10&&manual.every(row=>{
        const payload=JSON.parse(row.payload);return payload.tasks?.length===400&&payload.settings?.horizonMin===61;
      })&&document.querySelector('#modalRoot h2')?.textContent==='Settings';
    },'#modalRoot [data-act="make-manual-backup"]',
    'Fast presses may start separate manual copies while saving; each retained copy must preserve all 400 tasks and the exact horizon, then the collapsed Data section makes the action unavailable.',1,10);
    const manualBackupCount=await ui.page.evaluate(async()=>
      (await window.ScannerDeviceStore.listBackups()).filter(row=>row.kind==='manual').length);
    assert.equal(manualBackupCount,manualBurst.acceptedClicks,'Each accepted Make manual backup press creates exactly one complete retained copy');
    await ui.fill('#stHorizon','77');
    await ui.act('save-settings',()=>state.settings.horizonMin===77&&!document.getElementById('stHorizon'));
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    await ui.expose('[data-act="restore-local-backup"][data-id]');
    const restoreId=await ui.page.evaluate(()=>[...document.querySelectorAll('.backup-row')]
      .find(row=>row.textContent.toLowerCase().includes('manual'))
      ?.querySelector('[data-act="restore-local-backup"][data-id]')?.dataset.id||null);
    assert.ok(restoreId,'At least one readable retained backup offers Restore');
    await bounded(ui,'restore-local-backup',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;
      return state.settings.horizonMin===61&&stored?.settings?.horizonMin===61&&state.tasks.length===400&&stored?.tasks?.length===400;
    },'[data-act="restore-local-backup"][data-id="'+restoreId+'"]',
    'The first confirmed restore reapplies the exact 400-task value; any repeated clicks are safe same-source repeats or become unavailable when Settings closes.');
    await ui.waitFor(async()=>{
      const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;
      return state.settings.horizonMin===61&&stored?.settings?.horizonMin===61&&state.tasks.length===400&&stored?.tasks?.length===400;
    },12000,'The repeated restore leaves the same 400-task source durable');
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    const expectedManualRemaining=manualBackupCount-1;
    const deletedManualBackup=new Function('return async()=>{const rows=await window.ScannerDeviceStore.listBackups();return !rows.some(row=>row.id==='+
      JSON.stringify(restoreId)+')&&rows.filter(row=>row.kind==="manual").length==='+JSON.stringify(expectedManualRemaining)+'}')();
    await bounded(ui,'delete-local-backup',deletedManualBackup,'[data-act="delete-local-backup"][data-id="'+restoreId+'"]',
      'Repeated confirms remain bound to the same selected backup ID; every other retained manual copy stays intact.',1,10);
  });

  await h.scenario('rapid history clearing preserves the remaining 400-task workspace',{decorate:board=>{
    activeBoard(board);board.workLog=[{id:'rapid-old-history',taskId:'synthetic-kept',title:'Old saved work',kind:'worked',at:Date.now()-60000}];
  }},async ui=>{
    await assert400(ui,'Clear history');
    await once(ui,'settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings','[data-act="settings"]',
      'The first Settings press opens its modal; later attempts are obscured.');
    await once(ui,'clear-done',()=>state.workLog.length===0&&!document.querySelector('#modalRoot [data-act="clear-done"]'),
      '#modalRoot [data-act="clear-done"]','The first confirmed Clear history press removes the one history entry; the action disappears.');
    await waitForStoredTaskCount(ui,400,'Clearing history preserves all 400 tasks');
  });

  await h.scenario('rapid reset confirms once and retains the 400-task backup',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Reset');
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    await once(ui,'wipe',()=>document.querySelector('#modalRoot h2')?.textContent==='Confirm reset'&&
      !!document.querySelector('#modalRoot [data-act="confirm-wipe"]'),
      '#modalRoot [data-act="wipe"]','The first Reset press opens confirmation; later attempts are covered by the dialog.');
    const sourceHash=await ui.page.evaluate(()=>ChainStorageV2.hashPayload(JSON.stringify(state)));
    const resetRetainsSource=new Function('return async()=>{'+
      'const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;'+
      'const backups=await window.ScannerDeviceStore.listBackups(),beforeReset=backups.filter(row=>row.kind==="before-reset");'+
      'return state.tasks.length===0&&stored?.tasks?.length===0&&beforeReset.length===1&&'+
      'JSON.parse(beforeReset[0].payload).tasks.length===400&&'+
      '(await ChainStorageV2.hashPayload(beforeReset[0].payload))==='+JSON.stringify(sourceHash)+'}')();
    await bounded(ui,'confirm-wipe',resetRetainsSource,'#modalRoot [data-act="confirm-wipe"]',
      'Ten trusted attempts start one reset; its in-flight guard suppresses duplicate effects, the completed dialog disappears, and exactly one byte-identical 400-task safety copy remains.');
  });

  await h.scenario('rapid Debug log and Help actions with 400 saved tasks',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Debug and Help');
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    await once(ui,'view-support-diagnostics',()=>document.querySelector('#modalRoot h2')?.textContent==='Debug log',
      '#modalRoot [data-act="view-support-diagnostics"]','The first Debug log press opens its modal; repeats are obscured.');
    await ten(ui,'select-support-diagnostics',()=>document.activeElement?.id==='supportDiagnosticsData'&&
      document.getElementById('supportDiagnosticsData').selectionStart===0&&
      document.getElementById('supportDiagnosticsData').selectionEnd===document.getElementById('supportDiagnosticsData').value.length,
      '#modalRoot [data-act="select-support-diagnostics"]','Ten Select presses keep the whole diagnostic text selected and never add board content.');
    await ten(ui,'refresh-support-diagnostics',()=>document.querySelector('#modalRoot h2')?.textContent==='Debug log',
      '#modalRoot [data-act="refresh-support-diagnostics"]','Ten refresh presses redraw the same Debug log surface without closing it.');
    await once(ui,'return-support-diagnostics',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings',
      '#modalRoot [data-act="return-support-diagnostics"]','The first Return press restores Settings; its Debug-only action disappears.');
    await once(ui,'close-modal',()=>!document.querySelector('#modalRoot .modal'),'#modalRoot [data-act="close-modal"]',
      'The first Close press dismisses Settings; later attempts have no modal target.');
    await once(ui,'help',()=>!!document.querySelector('#modalRoot .help'),'[data-act="help"]',
      'The first Help press opens its modal; further presses are refused while the toolbar point is obscured.');
    const helpSummary=await ui.page.locator('#modalRoot .help details summary').count();
    assert.ok(helpSummary>0,'Help renders FAQ disclosures');
    const firstFaqInitiallyOpen=await ui.page.locator('#modalRoot .help details summary').first().evaluate(summary=>summary.parentElement.open);
    const faqReturns=new Function('return ()=>document.querySelector("#modalRoot .help details summary")?.parentElement.open==='+JSON.stringify(firstFaqInitiallyOpen))();
    await ten(ui,'disclosure',faqReturns,
      '#modalRoot .help details summary','Ten Help disclosure presses return the FAQ to its exact initial open/closed state.');
    await once(ui,'reopen-apology',()=>document.querySelector('#modalRoot h2')?.textContent==='Sync and stability apology',
      '#modalRoot [data-act="reopen-apology"]','The first apology press opens its original notice; subsequent attempts are covered.');
    await once(ui,'mback',()=>!document.querySelector('#modalRoot .modal'),'#modalRoot .mback',
      'One native backdrop press dismisses the apology; further backdrop attempts disappear.');
  });

  await h.scenario('rapid first-run Quick Start acknowledges once with 400 tasks',{decorate:board=>{
    activeBoard(board);board.seenQuickStart=false;
  }},async ui=>{
    await assert400(ui,'Quick Start');
    await once(ui,'ok-quickstart',()=>!document.querySelector('#modalRoot .modal')&&state.seenQuickStart===true,
      '#modalRoot [data-act="ok-quickstart"]','The first OK press records acknowledgement and closes Quick Start; remaining attempts are unavailable.');
  });

  for(const outcome of ['accepted','dismissed'])await h.scenario('rapid native install '+outcome+' with 400 tasks',{decorate:activeBoard},async ui=>{
    await assert400(ui,'Native install '+outcome);
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    await seedInstallPrompt(ui,outcome);
    await once(ui,'install-app',()=>document.querySelector('#modalRoot h2')?.textContent==='Install this app on your phone'&&
      !!document.querySelector('#modalRoot [data-act="native-install"]'),
      '[data-act="install-app"]','The first install-help press opens the modal; later attempts are obscured.');
    const expectedInstallOutcome=outcome==='accepted'
      ?()=>window.__rapidInstallPrompts===1&&!document.querySelector('#modalRoot .modal')
      :()=>window.__rapidInstallPrompts===1&&document.querySelector('#modalRoot h2')?.textContent==='Install this app on your phone'&&
        !document.querySelector('#modalRoot [data-act="native-install"]');
    await once(ui,'native-install',expectedInstallOutcome,'#modalRoot [data-act="native-install"]',
    outcome==='accepted'?'The prompt is consumed once and closes Help; remaining attempts have no install control.':'The declined prompt is consumed once and restores manual instructions without an Install button.');
    if(outcome==='dismissed')await once(ui,'close-modal',()=>!document.querySelector('#modalRoot .modal'),
      '#modalRoot [data-act="close-modal"]','The first Done press closes the manual install instructions; repeats have no modal target.');
  });
}
