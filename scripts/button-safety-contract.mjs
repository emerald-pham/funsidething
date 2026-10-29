import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
export function classifyButtonStartupTimeline(timeline,capture=null){
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
 return{...timeline,status:missing.length?'incomplete':'complete',missing};
}
export function verifyButtonSafetyReport(report,{inventory,inventorySha256,candidateCommit,candidateTree,engine}={}){
 assert.equal(report.schemaVersion,1,'Known button report schema');
 assert.equal(report.kind,'button-safety','Native button report kind');
 assert.ok(['chromium','webkit'].includes(report.engine),'Named native engine required');
 assert.equal(report.scope,undefined,'Focused diagnostics cannot qualify complete button coverage');
 assert.equal(report.status,'passed','Native button run must pass; unavailable engine cannot pass');
 for(const [key,expected]of Object.entries({candidateCommit,candidateTree,engine,inventorySha256}))if(expected!==undefined)assert.equal(report[key],expected,'Button report '+key+' mismatch');
 for(const key of ['candidateCommit','candidateTree'])assert.match(report[key]||'',/^[a-f0-9]{40}$/,'Exact '+key+' required');
 assert.ok(inventory,'Independent button inventory required');
 for(const [file,hash]of Object.entries(inventory.requiredRuntimeAssets||{})){
  assert.match(hash,/^[a-f0-9]{64}$/,'Reviewed runtime asset SHA256 required: '+file);
  assert.equal(report.assets?.[file],hash,'Native runtime asset missing or changed: '+file);
 }
 const actions=inventory.requiredActions;
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
 const scenarios=inventory?.requiredScenarios;
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

 const workload=inventory.requiredWorkload;
 if(workload){
  assert.deepEqual(report.requiredWorkload,workload,'Report cannot waive required400-task/rapid workload');
  for(const row of report.scenarios||[]){
   const setup=row.setup,role=inventory.scenarioRoles?.[row.name]||'active';
   assert.ok(setup,'Independent400-task durable setup required: '+row.name);
   assert.equal(setup.currentTasks,workload.savedTasks,'Required current400-task source: '+row.name);
   assert.equal(setup.durableTasks,workload.savedTasks,'Required saved400-task readback: '+row.name);
   assert.equal(setup.fixtureRole,role,'Reviewed active/history fixture role: '+row.name);
   assert.match(setup.durableHash||'',/^[a-f0-9]{64}$/,'Exact durable source identity required');
   if(role==='active')assert.equal(setup.activeTasks,workload.savedTasks,'Ordinary flows require400active tasks');
   else assert.ok(['sole','exhausted'].includes(role)&&setup.activeTasks>0,'Documented sole/exhausted workload required');
  }
  const rapid=inventory.requiredRapidActions;
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
 assert.ok(Array.isArray(report.observedActions),'Observed native button inventory required');
 for(const action of report.observedActions)assert.ok(actions.includes(action),'New untested button action: '+action);
 assert.deepEqual(report.errors,[],'Native lifecycle or error detector failed');
 for(const key of ['contextClosed','browserClosed','serverClosed'])assert.equal(report.cleanup?.[key],true,'Button runtime cleanup required: '+key);
 return report.startupTimeline?{...report,startupTimeline:classifyButtonStartupTimeline(report.startupTimeline,report.startupCapture)}:report;
}
