import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  test, recoveryReadClock187, runNativeRecoveryInspection226, runNativeRecoveryInspectionMatrix226,
  __dirname, html, flush, loadApp, fixtureDeadline, SYNC_STORE_KEY, LOCAL_HEAD_KEY, HOUR, syncTask,
  syncState, loadAppAtTime, hydrateUnchangedEditorDraft, makeSyncHarness, syncSettle, PAST_DEBOUNCE,
  exerciseCompletionEditorBoundaries, divergentCloudSourceApp187,
} from "./shared.js";

test('RISK automatic source status native: historical retry checking stop and confirmation remain current',
async t=>{
 const engine=process.env.CHAIN_RECOVERY_TEST_ENGINE||'chromium';
 await runNativeRecoveryInspectionMatrix226(t,engine,(theme,width)=>({theme,history:true,boundedAck:theme==='dark'&&width===390}));
});

test('RISK integrated automatic recovery native: persisted startup status and neighboring controls remain usable with one browser and isolated contexts',async t=>{const engine=process.env.CHAIN_RECOVERY_TEST_ENGINE||'chromium';
 await runNativeRecoveryInspectionMatrix226(t,engine,(theme,width)=>({theme,engine}));
});

test('RISK cloud source inspection: native asynchronous updates retain focus disclosure scroll and current source roles',async t=>runNativeRecoveryInspection226(t));

test('RISK cloud source inspection: narrow native progress updates preserve exact visible text',async t=>runNativeRecoveryInspection226(t,360));

test('RISK iOS source replay: a fresh native review offers a validated previous board after timed-out headers settle late',async t=>{
 const clock=recoveryReadClock187(),app=await divergentCloudSourceApp187(t,{timeoutMs:1000,sourcePadding:2000000,timerProvider:clock.provider}),{ctx,shim,backend,originalRoot}=app,store=ctx.window.ScannerDeviceStore;
 await fixtureDeadline(async wait=>{while(true){const save=ctx.buildSupportDiagnosticsReport().save;if(save.debouncePending.value===false&&save.activePersistCalls.value===0)return;await wait();}},'ordinary fixture saves finish before source-inspection preservation is measured');
 const currentPath='users/owner/generations/'+originalRoot.activeGeneration,previousPath='users/owner/generations/'+originalRoot.previousGeneration;
 const previousHeader=backend.docs.get(previousPath),previousChunks=[...backend.docs].filter(([key])=>key.startsWith(previousPath+'/chunks/')).map(([,row])=>row).sort((a,b)=>a.index-b.index);
 assert.equal(backend.docs.get(currentPath).chunkCount,8,'synthetic current source has the report-shaped declared chunk count');
 assert.equal(previousChunks.length,8,'synthetic previous source has eight independently available rows');
 const decoded=await ctx.window.ChainStorageV2.decodeSnapshot(previousHeader,previousChunks);
 assert.equal(JSON.parse(decoded).futureIOSReportFixture.opaque.length,2000000,'the synthetic previous payload is independently complete and hash-validated, unlike an unverified diagnostic row count');
 const local=JSON.stringify(ctx.state),head=await store.readHead(),pending=await store.getPendingUpload('owner'),raw=await store.readRawExportSnapshot(),cloud=JSON.stringify([...backend.docs]);
 let releaseHeaders,releasePrevious,oldPreviousHeld=false,obsoleteCurrentQueries=0,first,fresh;
 const headersGate=new Promise(resolve=>releaseHeaders=resolve),previousGate=new Promise(resolve=>releasePrevious=resolve),headerReads=new Map();let previousQueries=0;
 app.faults.serverRead=async path=>{
  if(path===currentPath||path===previousPath){const count=(headerReads.get(path)||0)+1;headerReads.set(path,count);if(path===currentPath&&count===1)await headersGate;}
  if(path===currentPath+'/chunks'&&headerReads.get(currentPath)===1)obsoleteCurrentQueries++;
  if(path===previousPath+'/chunks'&&++previousQueries===1){oldPreviousHeld=true;await previousGate;}
 };
 t.after(async()=>{releaseHeaders();releasePrevious();delete app.faults.serverRead;await Promise.allSettled([first,fresh].filter(Boolean));clock.stop();});
 clock.activate(app);first=ctx.onAction('review-cloud-source-recovery',{});
 await fixtureDeadline(async wait=>{while(headerReads.size<2||!oldPreviousHeld)await wait();},'both native headers enter and the previous chunk request is already issued before timeout');
 await clock.advance(1001);assert.equal(await first,false,'the native review reaches its unchanged configured SDK deadline');
 assert.match(shim.document.getElementById('modalRoot').innerHTML,/Cloud request timed out/);
 releaseHeaders();
 await flush();assert.equal(oldPreviousHeld,true,'the old previous chunk request remains issued and held');assert.equal(obsoleteCurrentQueries,0,'a timed-out late header must not start new dependent chunk requests');
 fresh=ctx.onAction('review-cloud-source-recovery',{});
 await fixtureDeadline(async wait=>{while((headerReads.get(currentPath)||0)<2||(headerReads.get(previousPath)||0)<2)await wait();},'fresh native review overlaps the old unfinished previous-source query');
 releasePrevious();
 assert.equal(await fresh,true,'a fresh complete read must finish the actual guarded preview after an earlier timeout');assert.equal(obsoleteCurrentQueries,0,'the retired current header never schedules chunks even after all late replies settle');
 const modal=shim.document.getElementById('modalRoot').innerHTML;
 const button=modal.match(new RegExp('<button[^>]*data-act="choose-cloud-recovery-source"[^>]*data-value="generation:'+originalRoot.previousGeneration+'"[^>]*>'))?.[0];
 assert.ok(button,'the independently valid previous source remains a visible deliberate choice');
 assert.doesNotMatch(button,/disabled/,'a previous valid board is selectable even though the current source has no chunks');
 assert.doesNotMatch(modal,/data-act="choose-cloud-recovery-source"[^>]*aria-pressed="true"/,'nothing chooses the older board automatically');
 assert.equal(await ctx.onAction('apply-cloud-source-recovery',{}),false,'no source choice is consent to replace the board');
 assert.ok(JSON.stringify(ctx.state)===local,'accepted device work is unchanged');assert.equal((await store.readHead()).hash,head.hash);
 assert.deepEqual(await store.getPendingUpload('owner'),pending);assert.deepEqual(await store.readRawExportSnapshot(),raw,'all original readable device sources remain exact');
 assert.ok(JSON.stringify([...backend.docs])===cloud,'source discovery and a late obsolete result perform no cloud writes');
 t.diagnostic(JSON.stringify({currentDeclaredChunks:8,currentReceivedChunks:0,previousReceivedChunks:8,previousIndependentlyValidated:true,oldTimeoutThenOverlappingFreshRead:true,visiblePreviousChoice:true,automaticChoice:false}));
});

test('RISK rapid action durability: ten distinct mixed native actions progress through slow successful saves without a false failure',async t=>{
 const {IDBFactory}=await import('fake-indexeddb'),indexedDB=new IDBFactory(),dbName='rapid-native-save-'+Math.random(),at=Date.parse('2026-10-20T15:00:00Z');
 const tasks=[syncTask('rapid-anchor','Anchor'),syncTask('rapid-bench','Benchmark'),syncTask('rapid-cant','Candidate to skip and return'),syncTask('rapid-warmup','Next candidate'),...Array.from({length:12},(_,i)=>syncTask('rapid-candidate-'+i,'Candidate '+i)),syncTask('rapid-edit','Editor target'),syncTask('rapid-done','Completion target')];
 const board=syncState({tasks,chain:['rapid-anchor','rapid-bench'],candidateId:'rapid-cant',mode:'scan',scanMode:'descending',passId:'rapid-native-pass',passStartedAt:at-HOUR,snooze:100,syncAccount:null,syncRev:0,syncDirty:false,updatedAt:at-HOUR,futureRapid:{keep:'unknown original',values:[1,2,3]},settings:{horizonMin:60,thresholdPct:0,samples:250,cantMin:30,workedHours:8,theme:'system'}}),raw=JSON.stringify(board);
 const quietCloud=()=>({configured:false,ready:false,user:null,status:'off',async pull(){return {error:true};},async push(){return {error:true};}});
 const app=await loadAppAtTime(at,{seed:314159,seedStorage:{[SYNC_STORE_KEY]:raw,[LOCAL_HEAD_KEY]:raw},indexedDBProvider:indexedDB,deviceDbName:dbName,cloudSyncFactory:quietCloud}),{ctx,shim}=app,store=ctx.window.ScannerDeviceStore;
 assert.equal(await ctx.persist(),true);assert.equal((await store.readHead()).payload,JSON.stringify(ctx.state));
 const manual=await ctx.saveDurableBackup('manual',JSON.stringify(ctx.state)),originalManual=(await store.listBackups()).find(row=>row.id===manual.id);
 assert.ok(originalManual);assert.equal((await store.setPendingUpload('pending-original-owner',{generationId:'rapid-pending-original',payloadHash:'a'.repeat(64),baseRev:4,updatedAt:at})).ok,true);
 const originalPending=await store.getPendingUpload('pending-original-owner'),commit=store.commitHead.bind(store),calls=[],inFlight=new Set(),messages=[],toast=shim.document.getElementById('toast');let message=toast.textContent,delaying=true,entered;
 Object.defineProperty(toast,'textContent',{configurable:true,get:()=>message,set(value){message=value;messages.push(value);}});
 const firstCommit=new Promise(resolve=>entered=resolve);
 store.commitHead=async options=>{
  const call={payload:options.payload,finished:false},pending=(async()=>{const result=await commit(options);call.ok=result?.ok===true;call.committedAt=performance.now();calls.push(call);if(call.ok){entered(call);if(delaying)await new Promise(resolve=>setTimeout(resolve,700));}call.finished=true;return result;})();
  inFlight.add(pending);try{return await pending;}finally{inFlight.delete(pending);}
 };
 t.after(async()=>{delaying=false;ctx.suspendCloudSync();vm.runInContext('clearTimeout(saveTimer);clearTimeout(cloudTimer);clearCloudRetry()',ctx);await Promise.allSettled([...inFlight]);store.commitHead=commit;await app.dispose();});
 ctx.onAction('toggle-list',{});
 const first=await Promise.race([firstCommit,new Promise((_,reject)=>setTimeout(()=>reject(Error('ordinary background save did not reach real durability')),5000))]);
 assert.equal((await store.readHead()).payload,first.payload);assert.equal(first.finished,false,'the actual prior snapshot is durable while its acknowledgement remains pending');
 const facts=[],intentIds=new Set(),actionTimes=[],start=performance.now();
 const act=(name,invoke,check)=>{
  const before=new Set((ctx.state.decisionEvents||[]).map(event=>event.id));invoke();
  const added=ctx.state.decisionEvents.filter(event=>!before.has(event.id));assert.equal(added.length,1,name+' must be one distinct accepted intent');assert.equal(check(),true,name+' reaches its independently specified result');
  assert.ok(!intentIds.has(added[0].actionId));intentIds.add(added[0].actionId);facts.push(JSON.parse(JSON.stringify(added[0])));actionTimes.push(performance.now()-start);
 };
 const pause=()=>new Promise(resolve=>setTimeout(resolve,280)),editor=(id,action)=>{hydrateUnchangedEditorDraft(app,id);ctx.onAction(action,{dataset:{id}});};
 const firstControl={dataset:{candidate:'rapid-cant',benchmark:'rapid-bench'}};
 act('first Cant',()=>ctx.onAction('cant',firstControl),()=>ctx.state.considered['rapid-cant']==='cant');
 const afterFirst=JSON.stringify(ctx.state);ctx.onAction('cant',firstControl);assert.equal(JSON.stringify(ctx.state),afterFirst,'duplicate delivery of one detached control is not an eleventh intent');
 await pause();act('first Return',()=>editor('rapid-cant','return-candidate'),()=>ctx.state.considered['rapid-cant']===undefined&&!ctx.state.chain.includes('rapid-cant'));
 await pause();assert.equal(ctx.state.candidateId,'rapid-warmup');act('second Cant',()=>ctx.onAction('cant',{dataset:{candidate:'rapid-warmup',benchmark:'rapid-bench'}}),()=>ctx.state.considered['rapid-warmup']==='cant');
 await pause();act('second Return',()=>editor('rapid-warmup','return-candidate'),()=>ctx.state.considered['rapid-warmup']===undefined);
 await pause();assert.equal(ctx.state.candidateId,'rapid-cant');act('No',()=>ctx.onAction('no',{dataset:{candidate:'rapid-cant',benchmark:'rapid-bench'}}),()=>ctx.state.considered['rapid-cant']==='no');
 await pause();act('editor Save',()=>{hydrateUnchangedEditorDraft(app,'rapid-edit');shim.document.getElementById('etTitle').value='Changed during rapid actions';ctx.onAction('save-edit',{dataset:{id:'rapid-edit'}});},()=>ctx.state.tasks.find(task=>task.id==='rapid-edit').title==='Changed during rapid actions');
 await pause();act('Worked',()=>ctx.onAction('worked',{dataset:{benchmark:'rapid-bench'}}),()=>ctx.state.considered['rapid-bench']==='worked'&&ctx.state.workLog.filter(row=>row.taskId==='rapid-bench'&&row.kind==='worked').length===1);
 await pause();act('Worked Return',()=>editor('rapid-bench','return-candidate'),()=>ctx.state.considered['rapid-bench']===undefined);
 await pause();assert.equal(ctx.state.candidateId,'rapid-warmup');act('Dot',()=>editor('rapid-warmup','dot-task'),()=>JSON.stringify(ctx.state.chain)===JSON.stringify(['rapid-anchor','rapid-warmup']));
 await pause();assert.equal(ctx.state.candidateId,'rapid-bench');act('last Cant',()=>ctx.onAction('cant',{dataset:{candidate:'rapid-bench',benchmark:'rapid-warmup'}}),()=>ctx.state.considered['rapid-bench']==='cant');
 assert.equal(facts.length,10);assert.equal(intentIds.size,10);
 const end=performance.now()+12000;let head;
 do{head=await store.readHead();if(!inFlight.size&&head?.payload===JSON.stringify(ctx.state)&&vm.runInContext('lastPersistedRaw',ctx)===head.payload)break;await new Promise(resolve=>setTimeout(resolve,25));}while(performance.now()<end);
 assert.equal(head.payload,JSON.stringify(ctx.state),'latest accepted work is actually durable');assert.equal(vm.runInContext('lastPersistedRaw',ctx),head.payload);
 for(const fact of facts)assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.decisionEvents.find(event=>event.id===fact.id))),fact,'snapshot progress cannot replace original action IDs or times');
 assert.equal(ctx.state.decisionEvents.length,10);assert.deepEqual(JSON.parse(JSON.stringify(ctx.state.futureRapid)),board.futureRapid);
 assert.deepEqual(await store.getPendingUpload('pending-original-owner'),originalPending);assert.deepEqual((await store.listBackups()).find(row=>row.id===manual.id),originalManual);
 assert.deepEqual([...ctx.state.chain],['rapid-anchor','rapid-warmup']);assert.equal(ctx.state.considered['rapid-bench'],'cant');assert.equal(ctx.state.considered['rapid-cant'],'no');assert.equal(ctx.state.workLog.filter(row=>row.taskId==='rapid-bench'&&row.kind==='worked').length,1);
 t.diagnostic(JSON.stringify({distinctIntents:intentIds.size,actionTimes,successfulSnapshots:calls.filter(call=>call.ok).length,firstSnapshotStillPendingAtBurst:true,warningMessages:messages.filter(value=>/device-save:/.test(value))}));
 delaying=false;await app.dispose();
 const reopened=await loadAppAtTime(at+10000,{sharedStorage:shim.localStorage,indexedDBProvider:indexedDB,deviceDbName:dbName,cloudSyncFactory:quietCloud});t.after(()=>reopened.dispose());
 assert.equal((await reopened.ctx.window.ScannerDeviceStore.readHead()).payload,head.payload);assert.equal(JSON.stringify(reopened.ctx.state),head.payload,'cold reopen retains the complete accepted sequence');
 assert.doesNotMatch(messages.join('\n'),/device-save:.*changed-during-save|board kept changing while it was being saved/,'successful snapshots plus later accepted input are normal work, never an interaction-stopping save failure');
 assert.equal(ctx.deviceSaveIssue(),null);
});

test('LEGACY MIGRATION: old v1 browser and cloud boards retain unique historyless tasks', async () => {
  const local = syncState({ v:1, tasks:[syncTask('legacy-local','Saved on old app')], syncRev:2 });
  delete local.deletedTaskIds;
  const remote = syncState({ v:1, tasks:[syncTask('legacy-cloud','Synced on old app')] });
  delete remote.deletedTaskIds;
  const h=makeSyncHarness({remote,rev:3});
  const {ctx,shim}=await loadApp({seedStorage:{[SYNC_STORE_KEY]:JSON.stringify(local)},cloudSyncFactory:h.factory});
  await ctx.cloudPull(); await syncSettle(PAST_DEBOUNCE);
  assert.deepEqual(new Set(Array.from(ctx.state.tasks,task=>task.id)),new Set(['legacy-local','legacy-cloud']));
  assert.deepEqual(new Set(JSON.parse(shim.localStorage.getItem(SYNC_STORE_KEY)).tasks.map(task=>task.id)),new Set(['legacy-local','legacy-cloud']));
  assert.deepEqual(new Set(h.remoteState().tasks.map(task=>task.id)),new Set(['legacy-local','legacy-cloud']));
});

test('Landscape location: visible default-sky copy does not name Orlando',()=>{
 assert.doesNotMatch(html,/Orlando|Live Florida|follows Florida/);
 const script=fs.readFileSync(path.join(__dirname,'location.js'),'utf8');
 assert.doesNotMatch(script,/Using Orlando, FL until you opt in/);
});
test('RISK completion convergence: native Done theme and editor Save finish after a conflicted recovery copy without an added trigger',{timeout:15000},async t=>exerciseCompletionEditorBoundaries(t,true));
test('RISK cloud acknowledgement durability: an older native editor CAS repair cannot rewind a confirmed revision',{timeout:15000},async t=>exerciseCompletionEditorBoundaries(t,false,true));

test('RISK Quick start content: essential steps stay brief and detailed help remains user-facing in existing sections',async()=>{
 const {ctx,shim}=await loadApp();ctx.openHelp();const help=shim.document.getElementById('modalRoot').innerHTML;
 const intro=help.split('<ol>')[1].split('</ol>')[0];assert.ok(intro.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length<=100,'getting-started steps should be brief');assert.doesNotMatch(intro,/TrueSkill|weighted random|25%|squared|Halving/i,'algorithm details belong in detailed help');
 const answers=[...help.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)];assert.ok(answers.length>=35,'retain existing help topics');for(const [,question,answer]of answers)assert.ok(answer.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length<=130,question+' should focus on user actions and consequences');
 const dependency=answers.find(x=>x[1]==='What is a prerequisite task?')[2];assert.match(dependency,/Hard dependency clears only after deletion or Done with Evergreen off/);assert.match(dependency,/recurring.*blocks again/i);assert.doesNotMatch(dependency,/saved edge evidence|operation identity|compatible app|future formats|old snapshots/);
 const data=help.split('<h3>Data and backups</h3>')[1];assert.match(data,/safe-update path protects unsaved work and unfinished drafts/i);assert.match(data,/protected.*compatible app/i);
});

test('RISK repository process: required installed-client native outcomes and artifacts execute exactly once',t=>{
 const required=['RISK native installed-client delivery: signed-out','RISK native installed-client delivery: reconcile-held'];
 const env={...process.env,CHAIN_INSTALLED_NATIVE_CHILD:'1'};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^RISK native installed-client delivery: (signed-out|reconcile-held)$',fileURLToPath(import.meta.url)],{cwd:__dirname,env,encoding:'utf8',timeout:405000,maxBuffer:32*1024*1024});
 const output=[result.stdout,result.stderr].filter(Boolean).join('\n');t.diagnostic(output);
 assert.equal(result.error,undefined,'Native selected-test infrastructure must work: '+(result.error?.message||output));
 assert.equal(result.signal,null,'Native selected-test run must finish: '+output);
 assert.equal(result.status,0,'Native selected-test run must succeed: '+output);
 const lines=(result.stdout||'').split(/\r?\n/);
 for(const name of required){
  const outcomes=lines.filter(line=>line.startsWith('ok ')&&line.replace(/^ok \d+ - /,'').split(' #')[0]===name);
  assert.equal(outcomes.length,1,'Required native case absent or duplicated: '+name+'\n'+output);
  assert.ok(!/ # (?:SKIP|TODO)\b/i.test(outcomes[0]),'Required native case must actually execute: '+name);
 }
 assert.equal(lines.filter(line=>/^ok \d+ - /.test(line)).length,required.length,'Exactly the required native outcomes must run');
 assert.equal(lines.filter(line=>/^1\.\.\d+$/.test(line)).at(-1),'1..'+required.length,'Native TAP plan must be complete and exact');
 assert.match(result.stdout||'',/^# cancelled 0$/m);assert.match(result.stdout||'',/^# skipped 0$/m);assert.match(result.stdout||'',/^# todo 0$/m);
 assert.ok(!/^not ok /m.test(result.stdout||''),'No native failure or cancellation may be hidden: '+output);
 const artifacts=lines.map(line=>line.match(/^# Native evidence: (.+)$/)?.[1]).filter(Boolean);
 assert.equal(artifacts.length,required.length,'Each required native outcome must retain an evidence artifact');
 assert.equal(new Set(artifacts).size,required.length,'Required native evidence artifacts must be distinct');
 const modes=new Set();
 for(const file of artifacts){
  assert.equal(path.dirname(path.resolve(file)),path.resolve(env.CHAIN_NATIVE_OUTPUT),'Required native evidence must be inside the declared artifact directory');
  assert.ok(fs.existsSync(file),'Required native evidence artifact is missing: '+file);
  const report=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.ok(['signed-out','reconcile-held'].includes(report.mode),'Required native artifact must identify a known case');
  assert.ok(!modes.has(report.mode),'Required native artifact case must not be duplicated');modes.add(report.mode);
  assert.equal(report.status,'passed','Required native artifact must record a successful case');
  assert.equal(report.oldCommit,'779defa4e8c3465fdf535fe17dbe2227d2b76ea1','Required native artifact keeps the immutable installed baseline');
  assert.equal(report.candidateCommit,env.CHAIN_NATIVE_CANDIDATE_SHA,'Required native artifact must identify the exact candidate');
  assert.equal(report.candidateTree,env.CHAIN_NATIVE_CANDIDATE_TREE,'Required native artifact must identify the exact tree');
  for(const key of ['contextClosed','browserClosed','serverClosed'])assert.equal(report.cleanup?.[key],true,'Required native artifact cleanup: '+key);
 }
 assert.deepEqual([...modes].sort(),['reconcile-held','signed-out'],'Both required native case artifacts must be retained');
});


if(process.env.CHAIN_INSTALLED_NATIVE_CHILD==='1'){
 test('RISK native installed-client delivery: signed-out',{timeout:210000},async t=>{
  const {runInstalledClientCase}=await import('../scripts/installed-client-regression.mjs');
  const result=await runInstalledClientCase({mode:'signed-out',repo:__dirname,oldCommit:'779defa4e8c3465fdf535fe17dbe2227d2b76ea1',candidateCommit:process.env.CHAIN_NATIVE_CANDIDATE_SHA,candidateTree:process.env.CHAIN_NATIVE_CANDIDATE_TREE,outputDir:process.env.CHAIN_NATIVE_OUTPUT,port:Number(process.env.CHAIN_NATIVE_PORT||0)});
  t.diagnostic('Native evidence: '+result.reportPath);
 });
 test('RISK native installed-client delivery: reconcile-held',{timeout:210000},async t=>{
  const {runInstalledClientCase}=await import('../scripts/installed-client-regression.mjs');
  const result=await runInstalledClientCase({mode:'reconcile-held',repo:__dirname,oldCommit:'779defa4e8c3465fdf535fe17dbe2227d2b76ea1',candidateCommit:process.env.CHAIN_NATIVE_CANDIDATE_SHA,candidateTree:process.env.CHAIN_NATIVE_CANDIDATE_TREE,outputDir:process.env.CHAIN_NATIVE_OUTPUT,port:Number(process.env.CHAIN_NATIVE_PORT||0)});
  t.diagnostic('Native evidence: '+result.reportPath);
 });

}

// Installed-client sensitivity controls run only by an explicitly allocated owner command.
if(process.env.CHAIN_INSTALLED_NATIVE_SENSITIVITY==='process'){
 test('RISK repository process: installed-client native registration sensitivities fail closed',async t=>{
  assert.ok(process.env.CHAIN_NATIVE_OUTPUT,'durable sensitivity output required');
  const source=fs.readFileSync(fileURLToPath(import.meta.url),'utf8');
  const start=source.indexOf("test('RISK repository process: required installed-client native outcomes and artifacts execute exactly once'");
  const end=source.indexOf('\n// Installed-client sensitivity controls');assert.ok(start>=0&&end>start);
  const actual=source.slice(start,end),heldStart=actual.indexOf(" test('RISK native installed-client delivery: reconcile-held'");
  const heldEnd=actual.indexOf('\n });',heldStart)+5;assert.ok(heldStart>0&&heldEnd>heldStart);
  const held=actual.slice(heldStart,heldEnd),nativeBody=held.slice(held.indexOf('async t=>{'));
  fs.mkdirSync(process.env.CHAIN_NATIVE_OUTPUT,{recursive:true});
  const directory=fs.mkdtempSync(path.join(process.env.CHAIN_NATIVE_OUTPUT,'process-sensitivity-'));
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const records=[];
  for(const variant of ['omission','duplicate','skip','missing-artifact']){
   const root=path.join(directory,variant);fs.mkdirSync(root);
   fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({type:'module'}));
   fs.symlinkSync(path.join(__dirname,'scripts'),path.join(root,'scripts'),'junction');
   const artifactFault='fs.copyFileSync(result.reportPath,'+JSON.stringify(path.join(root,'removed-report-preserved.json'))+');fs.unlinkSync(result.reportPath);';
   const replacement=variant==='omission'?'':variant==='duplicate'?held+'\n'+held:variant==='skip'?held.replace('{timeout:210000}','{timeout:210000,skip:true}'):held.replace("t.diagnostic('Native evidence: '",artifactFault+"t.diagnostic('Native evidence: '");
   const mutated=actual.slice(0,heldStart)+replacement+actual.slice(heldEnd);
   if(variant==='missing-artifact')assert.equal(replacement.replace(artifactFault,''),held,'only the external completed artifact is removed; actual callback bytes remain');
   else assert.equal(mutated.split(nativeBody).length-1,variant==='omission'?0:variant==='duplicate'?2:1,'actual native callback bytes retained in source variant');
   // Only the command's fixture location changes; the independent TAP consumer
   // and all remaining real native callback/import bytes are copied unchanged.
   const fixtureSource='import {test} from "node:test";import assert from "node:assert/strict";import {spawnSync} from "node:child_process";import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";\nconst __dirname='+JSON.stringify(__dirname)+';const variantRoot=path.dirname(fileURLToPath(import.meta.url));\n'+mutated.replace('cwd:__dirname,env,','cwd:variantRoot,env,');
   const file=path.join(root,'tests','native-process.test.js');fs.mkdirSync(path.dirname(file));fs.writeFileSync(file,fixtureSource);
   const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.CHAIN_INSTALLED_NATIVE_CHILD;
   const args=['--test','--test-reporter=tap','--test-name-pattern=^RISK repository process: required installed-client native outcomes and artifacts execute exactly once$','tests/native-process.test.js'];
   const result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',timeout:405000,maxBuffer:32*1024*1024});
   const output=[result.stdout,result.stderr].filter(Boolean).join('\n');
   const record={variant,file,sourceSha256:hash(fixtureSource),canonicalRegionSha256:hash(actual),realNativeBodySha256:hash(nativeBody),importedModuleSha256:hash(fs.readFileSync(path.join(__dirname,'scripts/installed-client-regression.mjs'))),command:[process.execPath,...args],cwd:root,status:result.status,signal:result.signal,error:result.error?.message,output};records.push(record);
   fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(records,null,2)+'\n');
   assert.equal(result.error,undefined,result.error?.message);assert.equal(result.signal,null);assert.notEqual(result.status,0,'actual command must reject '+variant+' native registration');
   assert.ok(!/Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|SyntaxError/.test(output),'infrastructure failure is not a qualifying native registration control');
   assert.match(output,variant==='missing-artifact'?/Required native evidence artifact is missing:/:variant==='skip'?/Required native case must actually execute: RISK native installed-client delivery: reconcile-held/:/Required native case absent or duplicated: RISK native installed-client delivery: reconcile-held/,'the required consumer must reject the actual registration or artifact fault');
  }
  t.diagnostic('Actual process sensitivity evidence: '+path.join(directory,'report.json'));
 });
}
if(process.env.CHAIN_INSTALLED_NATIVE_SENSITIVITY==='causal'){
 test('RISK native installed-client sensitivity: unsafe delivery and source loss are rejected',async t=>{
  const {runInstalledClientCase}=await import('../scripts/installed-client-regression.mjs');
  const expected={
   'wrong-candidate':/actual response must identify the declared candidate document/,
   'stale-byte':/candidate cache byte identity: \.\/device-store-v2\.js/,
   'unsafe-quiescence':/original blurred draft must be durably accepted before last-client replacement/,
   'source-loss':/protected\/manual backup exact: synthetic-protected/
  };
  for(const control of Object.keys(expected)){
   let failure;
   try{await runInstalledClientCase({mode:'signed-out',repo:__dirname,oldCommit:'779defa4e8c3465fdf535fe17dbe2227d2b76ea1',candidateCommit:process.env.CHAIN_NATIVE_CANDIDATE_SHA,candidateTree:process.env.CHAIN_NATIVE_CANDIDATE_TREE,outputDir:process.env.CHAIN_NATIVE_OUTPUT,port:Number(process.env.CHAIN_NATIVE_PORT||0),control});}catch(error){failure=error;}
   assert.equal(failure?.code,'ERR_ASSERTION','real native control must reach its intended assertion, not infrastructure: '+(failure?.stack||control));
   assert.match(failure.message,expected[control],'native control must expose its causal mismatch');
   const report=JSON.parse(fs.readFileSync(failure.reportPath,'utf8'));
   assert.equal(report.status,'failed');assert.deepEqual(report.cleanup,{contextClosed:true,browserClosed:true,serverClosed:true});
   assert.equal(report.remote.before,report.remote.after);assert.equal(report.remote.calls.filter(row=>row.kind==='apply').length,0);
   t.diagnostic(control+' rejected at actual native assertion; evidence '+failure.reportPath);
  }
 });
}
