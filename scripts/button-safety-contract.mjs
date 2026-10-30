import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deriveOrdinaryStartupObservation} from './button-safety-startup.mjs';
import {verifyNativeTimelineCapture,deriveNativeTimelineEvidence} from './button-safety-timeline-core.mjs';
export function sourceButtonTemplates(source){
 const counts={};
 for(const match of source.matchAll(/<(?:button|summary)\b[^>]*>|<[a-z][^>]*\b(?:data-act|data-scene-view|data-landscape-motion|data-scene-time|data-scene-preset|data-location-action|role\s*=\s*[\"']button[\"'])[^>]*>|createElement\(\s*['"](?:button|summary)['"]\s*\)/g)){const key=digest(match[0]);counts[key]=(counts[key]||0)+1;}
 return Object.fromEntries(Object.entries(counts).sort(([a],[b])=>a.localeCompare(b)));
}
export function verifyButtonInventorySource(source,inventory){
 assert.deepEqual(sourceButtonTemplates(source),inventory.sourceTemplates,'Source button templates differ from reviewed native inventory');return true;
}
export const digest=value=>createHash('sha256').update(value).digest('hex');
// Diagnostic timing is independent of the application's functional verdict.
export function verifyButtonStartupCapture(capture){
 if(capture?.provider==='webkit-native-timeline')return verifyNativeTimelineCapture(capture);
 const check=(condition,message)=>assert.ok(condition,'Startup capture '+message),finite=value=>Number.isFinite(value)&&value>=0;
 check(capture?.schemaVersion===1&&capture.selected===true&&capture.provider==='playwright-public-screencast','known selected public provider required');
 check(JSON.stringify(capture.bounds)===JSON.stringify({maxDurationMs:12000,maxFrames:120,maxTotalBytes:8388608,maxFrameBytes:262144}),'fixed finite bounds required');
 check(['captured','unavailable','error'].includes(capture.status),'explicit outcome required');check(capture.startedBeforeNavigation===true,'must start before app navigation');
 check(finite(capture.startedHostMonotonicMs)&&finite(capture.stoppedHostMonotonicMs)&&capture.stoppedHostMonotonicMs>=capture.startedHostMonotonicMs&&capture.stoppedHostMonotonicMs-capture.startedHostMonotonicMs<=12000,'duration exceeds bound or mixes clocks');
 check(capture.clock?.reportedTimestampBasis==='engine-or-Date.now-fallback-ambiguous'&&capture.clock.hostEpochBasis==='Date.now'&&capture.clock.hostMonotonicBasis==='performance.now'&&capture.clock.pageClockConversion==='unavailable','reported/host/page clocks must remain distinct and ambiguous');
 const frames=capture.frames,counts=capture.counts;check(Array.isArray(frames)&&frames.length<=120,'accepted frame limit');check(counts&&['received','accepted','dropped','oversized','writeRefused'].every(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0),'bounded explicit counters');check(counts.accepted===frames.length&&counts.received===counts.accepted+counts.dropped+counts.oversized+counts.writeRefused,'frame counts must reconcile');
 const paths=new Set();let total=0;
 for(const [index,frame]of frames.entries()){
  check(frame.index===index+1&&/^startup-frames\/frame-[0-9]{4}\.jpg$/.test(frame.path)&&!paths.has(frame.path),'relative unique JPEG path/index required');paths.add(frame.path);
  check(Number.isSafeInteger(frame.bytes)&&frame.bytes>0&&frame.bytes<=262144,'per-frame byte limit');total+=frame.bytes;check(/^[a-f0-9]{64}$/.test(frame.sha256||''),'SHA256 required');
  check([frame.reportedTimestampMs,frame.hostReceiptEpochMs,frame.hostReceiptMonotonicMs].every(finite)&&frame.hostReceiptMonotonicMs>=capture.startedHostMonotonicMs&&frame.hostReceiptMonotonicMs<=capture.stoppedHostMonotonicMs,'separate finite frame clocks required');
  check(frame.viewportWidth===1100&&frame.viewportHeight===850,'original capture viewport required');
  check(frame.pageClockSample?.status==='unavailable'||frame.pageClockSample?.status==='observed'&&finite(frame.pageClockSample.timeOrigin)&&finite(frame.pageClockSample.nowMs)&&frame.pageClockSample.basis==='post-callback-receipt-upper-bound','page sample cannot claim compositor timing');
 }
 check(total===capture.totalBytes&&total<=8388608,'total byte/count mismatch');check(typeof capture.stopReason==='string'&&capture.stopReason.length>0,'explicit stop reason required');check(capture.cleanup?.stopAttempted===true&&capture.cleanup.stopped===true&&capture.cleanup.timerCleared===true,'owned stop and timer cleanup required');
 check(Array.isArray(capture.errors),'explicit capture errors required');if(capture.status==='captured')check(frames.length>0&&capture.errors.length===0,'captured requires real accepted frames without error');return capture;
}
export function classifyButtonStartupTimeline(timeline,capture=null,nativeInputs=null){
 if(timeline?.schemaVersion===2||nativeInputs?.appBinding){const nativeEvidence=deriveNativeTimelineEvidence({...nativeInputs,capture});if(nativeEvidence.status==='incomplete')return{status:'incomplete',ordinaryRouteEligible:false,nativeEvidence,gaps:['Partial native prefix cannot establish ordinary startup clock/input/custody or completed capture']};return deriveOrdinaryStartupObservation(timeline,capture,nativeInputs,nativeEvidence);}
 const names=['navigationStart','firstBackgroundPaint','completeBoardPaint','firstTrustedInputReceipt','firstVisibleResponse','overlappingWorkIntervals'];
 const observations=timeline?.observations||{},missing=[];
 const clockValid=timeline?.schemaVersion===1&&timeline.clock?.basis==='page-performance'&&Number.isFinite(timeline.clock.timeOrigin);
 for(const name of names){
  const row=observations[name];let valid=clockValid&&row?.status==='observed'&&typeof row.basis==='string'&&row.basis.length>0;
  if(name==='overlappingWorkIntervals')valid=valid&&Array.isArray(row.intervals)&&row.intervals.every(interval=>typeof interval.name==='string'&&typeof interval.caller==='string'&&['sync','async-wall'].includes(interval.kind)&&Number.isFinite(interval.startMs)&&interval.startMs>=0&&Number.isFinite(interval.endMs)&&interval.endMs>=interval.startMs);
  else valid=valid&&Number.isFinite(row.atMs)&&row.atMs>=0;
  if(!valid)missing.push(name);
 }
 if(!missing.length){const times=names.slice(0,5).map(name=>observations[name].atMs);if(times[0]!==0||times.some((value,index)=>index>0&&value<times[index-1]))missing.push('ordered-page-clock');}
 if(capture){verifyButtonStartupCapture(capture);missing.push('supplemental-clock-and-work-provenance');}
 const nativeEvidence=nativeInputs?deriveNativeTimelineEvidence({...nativeInputs,capture}):null;
 assert.ok(!timeline?.nativeEvidence||nativeEvidence,'Native Timeline derived claim requires its raw inputs');
 return{...timeline,status:missing.length?'incomplete':'complete',missing,...(nativeEvidence?{nativeEvidence,ordinaryRouteEligible:false}:{})};
}
export function verifyButtonSafetyReport(report,{inventory,inventorySha256,candidateCommit,candidateTree,engine,expectedProfile='ordinary',nativeInputs}={}){
 assert.equal(report.schemaVersion,1,'Known button report schema');
 assert.equal(report.kind,'button-safety','Native button report kind');
 assert.ok(['chromium','webkit'].includes(report.engine),'Named native engine required');
 assert.equal(report.scope,undefined,'Focused diagnostics cannot qualify complete button coverage');
 assert.equal(report.status,'passed','Native button run must pass; unavailable engine cannot pass');
 for(const [key,expected]of Object.entries({candidateCommit,candidateTree,engine,inventorySha256}))if(expected!==undefined)assert.equal(report[key],expected,'Button report '+key+' mismatch');
 for(const key of ['candidateCommit','candidateTree'])assert.match(report[key]||'',/^[a-f0-9]{40}$/,'Exact '+key+' required');
 assert.ok(inventory,'Independent button inventory required');
 const actions=inventory.requiredActions;
 const hasProfiles=Object.hasOwn(inventory,'profiles');let profile=null;
 if(hasProfiles){
  assert.ok(inventory.profiles&&typeof inventory.profiles==='object'&&!Array.isArray(inventory.profiles),'Independent button profile inventory required');
  assert.ok(['ordinary','workload-diagnostic'].includes(expectedProfile)&&Object.hasOwn(inventory.profiles,expectedProfile),'Unknown expected button safety profile');
  profile=inventory.profiles[expectedProfile];assert.ok(profile&&typeof profile==='object'&&!Array.isArray(profile),'Independent button profile definition required');
  assert.equal(report.profile,expectedProfile,'Button report profile mismatch');
  assert.match(report.inventorySha256||'',/^[a-f0-9]{64}$/,'Exact profile inventory identity required');
  assert.match(inventorySha256||'',/^[a-f0-9]{64}$/,'Independent profile inventory hash required');
  assert.equal(report.inventorySha256,inventorySha256,'Button report inventory hash mismatch');
  assert.ok(Array.isArray(profile.requiredScenarios)&&profile.requiredScenarios.length>0,'Independent profile scenario inventory required');
  if(expectedProfile==='ordinary'){
   assert.equal(profile.requiredScenarios.length,60,'All fifty ordinary flows and ten semantic repeats are required');
   assert.deepEqual(profile.fixture,{savedTasks:64,source:'signed-out-installed',authMode:'signed-out'},'Reviewed ordinary signed-out 64-task fixture required');
   assert.ok(Array.isArray(profile.requiredRepeatCases)&&profile.requiredRepeatCases.length===10,'All ten reviewed ordinary repeat cases are required');
  }else{
   assert.equal(profile.requiredScenarios.length,90,'All original workload-diagnostic scenarios are required');
   assert.deepEqual(profile.requiredScenarios,inventory.requiredScenarios,'Original diagnostic scenario inventory must remain intact');
   assert.deepEqual(profile.scenarioRoles,inventory.scenarioRoles,'Original diagnostic fixture roles must remain intact');
   assert.deepEqual(profile.requiredWorkload,{savedTasks:400,rapidAttempts:10,rapidWindowMs:2000},'Original diagnostic workload controls must remain intact');
   assert.deepEqual(profile.requiredWorkload,inventory.requiredWorkload,'Original diagnostic workload controls must remain intact');
   assert.deepEqual(profile.requiredRapidActions,actions,'All original diagnostic rapid action controls are required');
   assert.deepEqual(profile.requiredRapidActions,inventory.requiredRapidActions,'Original diagnostic rapid action inventory must remain intact');
  }
 }else{
  assert.equal(expectedProfile,'ordinary','Profile selection requires an independent profile inventory');
  assert.equal(report.profile,undefined,'A profile label requires an independent profile inventory');
 }
 for(const [file,hash]of Object.entries(inventory.requiredRuntimeAssets||{})){
  assert.match(hash,/^[a-f0-9]{64}$/,'Reviewed runtime asset SHA256 required: '+file);
  assert.equal(report.assets?.[file],hash,'Native runtime asset missing or changed: '+file);
 }
 assert.ok(Array.isArray(actions)&&actions.length>0,'Nonempty independent button inventory required');
 assert.equal(new Set(actions).size,actions.length,'Duplicate expected button action');
 assert.deepEqual(report.requiredActions,actions,'Report cannot waive required actions');
 for(const action of actions){
  const rows=(report.outcomes||[]).filter(row=>row.action===action);
  assert.equal(rows.length,1,'Missing required button action: '+action);
  const row=rows[0];assert.equal(row.status,'passed','Button action must execute successfully: '+action);
  assert.ok(row.events?.includes('click')||row.events?.includes('change')||row.events?.includes('submit'),'Real consumer event required: '+action);
  assert.ok(Number.isSafeInteger(row.assertions)&&row.assertions>0,'Independent outcome assertion required: '+action);
  assert.equal(row.responsive,true,'Button action responsiveness required: '+action);
 }
 assert.equal(report.outcomes.length,actions.length,'Unexpected or duplicate native outcome');
 const scenarios=profile?profile.requiredScenarios:inventory?.requiredScenarios;
 if(scenarios){
  assert.ok(Array.isArray(scenarios)&&scenarios.length>0,'Nonempty independent state scenario inventory required');
  assert.equal(new Set(scenarios).size,scenarios.length,'Duplicate expected native state scenario');
  assert.deepEqual(report.requiredScenarios,scenarios,'Report cannot waive required state scenarios');
  for(const name of scenarios){
   const rows=(report.scenarios||[]).filter(row=>row.name===name);
   assert.equal(rows.length,1,'Missing or duplicate required native state scenario: '+name);
   assert.equal(rows[0].status,'passed','Native state scenario must execute successfully: '+name);
  }
  assert.equal(report.scenarios.length,scenarios.length,'Unexpected native state scenario');
 }

 const workload=profile?profile.requiredWorkload:inventory.requiredWorkload;
 if(workload){
  assert.deepEqual(report.requiredWorkload,workload,'Report cannot waive required400-task/rapid workload');
  for(const row of report.scenarios||[]){
   const setup=row.setup,role=(profile?profile.scenarioRoles:inventory.scenarioRoles)?.[row.name]||'active';
   assert.ok(setup,'Independent400-task durable setup required: '+row.name);
   assert.equal(setup.currentTasks,workload.savedTasks,'Required current400-task source: '+row.name);
   assert.equal(setup.durableTasks,workload.savedTasks,'Required saved400-task readback: '+row.name);
   assert.equal(setup.fixtureRole,role,'Reviewed active/history fixture role: '+row.name);
   assert.match(setup.durableHash||'',/^[a-f0-9]{64}$/,'Exact durable source identity required');
   if(role==='active')assert.equal(setup.activeTasks,workload.savedTasks,'Diagnostic active workload must retain400tasks');
   else assert.ok(['sole','exhausted'].includes(role)&&setup.activeTasks>0,'Documented sole/exhausted workload required');
  }
  const rapid=profile?profile.requiredRapidActions:inventory.requiredRapidActions;
  assert.deepEqual(rapid,actions,'Every button/action family requires rapid coverage');
  assert.deepEqual(report.requiredRapidActions,rapid,'Report cannot waive rapid button families');
  for(const action of rapid){
   const rows=(report.rapidOutcomes||[]).filter(row=>row.action===action);
   assert.equal(rows.length,1,'Missing or duplicate required rapid action: '+action);
   const row=rows[0];assert.equal(row.status,'passed','Required rapid action must pass: '+action);assert.equal(row.responsive,true);assert.ok(row.assertions>0);
   assert.ok(Array.isArray(row.bursts)&&row.bursts.length>0,'Actual native press burst required: '+action);
   for(const burst of row.bursts){
    assert.equal(burst.attempts,workload.rapidAttempts,'Ten native press attempts required: '+action);
    assert.equal(burst.trustedPresses,workload.rapidAttempts,'Trusted native press receipts required: '+action);
    assert.equal(burst.unrelatedClicks,0,'A rapid attempt cannot silently activate another app action: '+action);
    assert.ok(Number.isFinite(burst.windowMs)&&burst.windowMs>=0&&burst.windowMs<=workload.rapidWindowMs,'Ten presses must finish within two seconds: '+action);
    assert.ok(Number.isSafeInteger(burst.acceptedClicks)&&burst.acceptedClicks>0,'Actual action click required: '+action);
    assert.ok(Number.isSafeInteger(burst.refused)&&burst.refused>=0&&Number.isSafeInteger(burst.disappeared)&&burst.disappeared>=0,'Explicit refused/disappeared press classification required');
    assert.equal(burst.acceptedClicks+burst.refused+burst.disappeared,workload.rapidAttempts,'All rapid press attempts must reconcile: '+action);
    assert.ok(typeof burst.semantics==='string'&&burst.semantics.length>=10,'Independent per-control repeated-effect semantics required');
   }
  }
  assert.equal(report.rapidOutcomes.length,rapid.length,'Unexpected or duplicate rapid action');
 }

 if(profile?.fixture){
  const fixture=profile.fixture;
  assert.deepEqual(fixture,{savedTasks:64,source:'signed-out-installed',authMode:'signed-out'},'Reviewed ordinary signed-out64-task base required');
  assert.ok(Array.isArray(scenarios)&&scenarios.length===60,'All sixty ordinary scenario fixtures are required');
  const scenarioFixtures=profile.scenarioFixtures;
  assert.ok(scenarioFixtures&&typeof scenarioFixtures==='object'&&!Array.isArray(scenarioFixtures),'Independent ordinary scenario fixture map required');
  assert.deepEqual(Object.keys(scenarioFixtures).sort(),[...scenarios].sort(),'Exact ordinary scenario fixture keys must match required scenarios');
  const seedVariants={
   'signed-out':{source:'signed-out-installed',syncAccount:null,seedSyncRev:0},
   'reconcile-held':{source:'reconcile-held-installed',syncAccount:'fixture@example.invalid',seedSyncRev:4}
  },fixtureCounts={'signed-out':0,'reconcile-held':0};
  for(const name of scenarios){
   const scenarioFixture=scenarioFixtures[name];assert.ok(scenarioFixture&&typeof scenarioFixture==='object'&&!Array.isArray(scenarioFixture),'Independent ordinary scenario fixture required: '+name);
   assert.deepEqual(Object.keys(scenarioFixture).sort(),['authMode','fixtureRole','savedTasks','seedSyncRev','source','syncAccount'],'Exact ordinary fixture input fields required: '+name);
   assert.equal(scenarioFixture.savedTasks,fixture.savedTasks,'Ordinary scenario keeps the signed-out 64-task base: '+name);
   assert.ok(Object.hasOwn(seedVariants,scenarioFixture.authMode),'Known ordinary auth fixture mode required: '+name);
   const seed=seedVariants[scenarioFixture.authMode];
   assert.equal(scenarioFixture.source,seed.source,'Reviewed ordinary source label required: '+name);
   assert.equal(scenarioFixture.syncAccount,seed.syncAccount,'Reviewed fixture seed account required: '+name);
   assert.equal(scenarioFixture.seedSyncRev,seed.seedSyncRev,'Reviewed fixture seed revision required: '+name);
   const role=profile.scenarioRoles?.[name]||'active';
   assert.equal(scenarioFixture.fixtureRole,role,'Scenario fixture role must match its independent role inventory: '+name);
   fixtureCounts[scenarioFixture.authMode]++;
  }
  assert.deepEqual(fixtureCounts,{'signed-out':54,'reconcile-held':6},'Ordinary profile retains fifty-four signed-out and six existing reconcile-held scenarios');
  // Seed account/revision values describe installed input only; this verifier does not infer post-bootstrap invariants.
  for(const row of report.scenarios||[]){
   const setup=row.setup,scenarioFixture=scenarioFixtures[row.name],role=scenarioFixture?.fixtureRole;
   assert.ok(scenarioFixture,'Report cannot add or select an unknown ordinary scenario fixture: '+row.name);
   assert.ok(setup,'Independent ordinary fixture setup required: '+row.name);
   assert.equal(setup.currentTasks,scenarioFixture.savedTasks,'Required ordinary current fixture count: '+row.name);
   assert.equal(setup.durableTasks,scenarioFixture.savedTasks,'Required ordinary durable fixture count: '+row.name);
   assert.equal(setup.source,scenarioFixture.source,'Required ordinary fixture source: '+row.name);
   assert.equal(setup.authMode,scenarioFixture.authMode,'Required ordinary fixture auth mode: '+row.name);
   assert.equal(setup.fixtureRole,role,'Reviewed ordinary active/history fixture role: '+row.name);
   assert.match(setup.durableHash||'',/^[a-f0-9]{64}$/,'Exact ordinary durable source identity required: '+row.name);
   if(role==='active')assert.equal(setup.activeTasks,scenarioFixture.savedTasks,'Ordinary flows require all fixture tasks active: '+row.name);
   else assert.ok(['sole','exhausted'].includes(role)&&setup.activeTasks>0,'Documented ordinary sole/exhausted fixture required: '+row.name);
  }
  assert.ok(Array.isArray(profile.requiredRepeatCases)&&profile.requiredRepeatCases.length>0,'Independent ordinary repeat inventory required');
  const repeatCases=profile.requiredRepeatCases,expectedNames=repeatCases.map(row=>row.name);
  assert.equal(new Set(expectedNames).size,expectedNames.length,'Duplicate expected ordinary repeat case');
  assert.ok(expectedNames.every(name=>scenarios.includes(name)),'Every ordinary repeat is a required state scenario');
  const repeatOutcomes=report.repeatOutcomes;
  assert.ok(Array.isArray(repeatOutcomes),'Trusted ordinary repeat receipts required');
  assert.equal(repeatOutcomes.length,repeatCases.length,'Unexpected ordinary repeat outcome');
  assert.deepEqual(repeatOutcomes.map(row=>row.name).sort(),[...expectedNames].sort(),'Report cannot omit, duplicate or add an ordinary repeat case');
  for(const definition of repeatCases){
   const rows=repeatOutcomes.filter(row=>row.name===definition.name);assert.equal(rows.length,1,'Missing or duplicate ordinary repeat case: '+definition.name);
   const outcome=rows[0];assert.equal(outcome.status,'passed','Ordinary repeat case must pass: '+definition.name);
   assert.ok(Number.isSafeInteger(definition.minimumAttempts)&&definition.minimumAttempts>0,'Independent ordinary repeat attempt minimum required: '+definition.name);
   const attempts=outcome.attempts;assert.ok(Array.isArray(attempts)&&attempts.length>=definition.minimumAttempts,'Trusted repeated native attempts required: '+definition.name);
   const receiptIds=attempts.map(row=>row.receiptId);assert.ok(receiptIds.every(id=>typeof id==='string'&&id.length>0),'Unique native attempt receipts required: '+definition.name);
   assert.equal(new Set(receiptIds).size,receiptIds.length,'Duplicate native attempt receipt: '+definition.name);
   const counts={attempted:attempts.length,accepted:0,refused:0,disappeared:0},seenFamilies=new Set();
   for(const attempt of attempts){
    assert.equal(attempt.trusted,true,'Trusted native input receipt required: '+definition.name);
    assert.ok(Array.isArray(definition.actionFamilies)&&definition.actionFamilies.includes(attempt.actionFamily),'Ordinary repeat action is not owned by its case: '+definition.name);
    seenFamilies.add(attempt.actionFamily);
    assert.ok(['accepted','refused','disappeared'].includes(attempt.result),'Explicit native input outcome required: '+definition.name);
    counts[attempt.result]+=1;
    assert.ok(Number.isFinite(attempt.receiptAtMs)&&attempt.receiptAtMs>=0,'Native receipt time required: '+definition.name);
   }
   for(const family of definition.actionFamilies)assert.ok(seenFamilies.has(family),'Ordinary repeat is missing owned action family '+family+': '+definition.name);
   assert.deepEqual(outcome.accounting,counts,'Ordinary repeated native inputs must reconcile: '+definition.name);
   const assertions=outcome.assertions;assert.ok(Array.isArray(assertions)&&assertions.length===1,'Independent ordinary semantic assertion required: '+definition.name);
   assert.equal(assertions[0].id,definition.assertionId,'Ordinary semantic assertion identity mismatch: '+definition.name);
   assert.equal(assertions[0].status,'passed','Ordinary semantic assertion must pass: '+definition.name);
   assert.equal(assertions[0].expected,definition.expected,'Ordinary semantic assertion must match the reviewed expectation: '+definition.name);
   assert.ok(typeof assertions[0].evidence==='string'&&assertions[0].evidence.trim().length>0,'Ordinary semantic assertion evidence required: '+definition.name);
   const scenario=(report.scenarios||[]).find(row=>row.name===definition.name);
   assert.ok(scenario?.setup,'Ordinary repeat source scenario setup required: '+definition.name);
   const source=outcome.sourceIdentity;
   assert.ok(source&&typeof source==='object','Ordinary repeat source identity required: '+definition.name);
   assert.equal(source.candidateCommit,report.candidateCommit,'Ordinary repeat candidate commit mismatch: '+definition.name);
   assert.equal(source.candidateTree,report.candidateTree,'Ordinary repeat candidate tree mismatch: '+definition.name);
   assert.equal(source.inventorySha256,report.inventorySha256,'Ordinary repeat inventory identity mismatch: '+definition.name);
   assert.equal(source.durableHash,scenario.setup.durableHash,'Ordinary repeat durable source mismatch: '+definition.name);
  }
 }
 assert.ok(Array.isArray(report.observedActions),'Observed native button inventory required');
 for(const action of report.observedActions)assert.ok(actions.includes(action),'New untested button action: '+action);
 assert.deepEqual(report.errors,[],'Native lifecycle or error detector failed');
 for(const key of ['contextClosed','browserClosed','serverClosed'])assert.equal(report.cleanup?.[key],true,'Button runtime cleanup required: '+key);
 return report.startupTimeline?{...report,startupTimeline:classifyButtonStartupTimeline(report.startupTimeline,report.startupCapture,nativeInputs)}:report;
}
