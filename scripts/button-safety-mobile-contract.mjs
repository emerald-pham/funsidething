import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const MOBILE_MEMORY_BYTES=512000000;
export const MOBILE_IMAGE='mcr.microsoft.com/playwright@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e';
export const MOBILE_SCENARIO='rapid scanner candidate actions with 400 active tasks';
export const MOBILE_PROFILE={name:'iPhone 13 WebKit equivalent, full app viewport',viewport:{width:390,height:844},screen:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true};
export const MOBILE_STORY={savedTasks:400,yesCount:10,distinctTasks:true,windowMs:2000,memoryBudgetBytes:MOBILE_MEMORY_BYTES,motions:['normal','reduced']};
export const mobileDigest=value=>createHash('sha256').update(value).digest('hex');
const hash=value=>assert.match(value||'',/^[a-f0-9]{64}$/,'Exact SHA256 required');
export function verifyMobileFunctionalReport(report,{candidateCommit,candidateTree,motion}={}){
 assert.equal(report.kind,'button-mobile-functional','Actual mobile consumer report required');assert.equal(report.status,'passed');assert.equal(report.engine,'webkit');
 for(const [key,value]of Object.entries({candidateCommit,candidateTree}))if(value!==undefined)assert.equal(report[key],value,'Mobile exact source '+key);
 for(const key of ['candidateCommit','candidateTree'])assert.match(report[key]||'',/^[a-f0-9]{40}$/);
 assert.equal(report.scenarios?.length,1);assert.equal(report.scenarios[0].name,MOBILE_SCENARIO);assert.equal(report.scenarios[0].status,'passed');assert.equal(report.scenarios[0].setup.durableTasks,400);
 const story=report.mobileStory;assert.ok(story,'Distinct offered-task evidence required');
 assert.deepEqual(story.profile,MOBILE_PROFILE);assert.equal(story.motion,motion||story.motion);assert.ok(MOBILE_STORY.motions.includes(story.motion));
 const observed=story.observed;assert.equal(observed.width,390);assert.equal(observed.height,844);assert.equal(observed.screenWidth,390);assert.equal(observed.screenHeight,844);assert.equal(observed.deviceScaleFactor,3);assert.ok(Number.isSafeInteger(observed.maxTouchPoints)&&observed.maxTouchPoints>=0,'Record native capability metadata without spoofing it');assert.equal(observed.coarsePointer,true);assert.match(observed.userAgent,/iPhone.*AppleWebKit.*Mobile/);assert.equal(observed.appMotion,story.motion);assert.equal(observed.appliedMotion,story.motion);assert.equal(observed.reducedMedia,story.motion==='reduced');
 const yes=report.rapidOutcomes?.find(row=>row.action==='act:yes');assert.equal(yes?.bursts.length,1);const burst=yes.bursts[0];assert.equal(burst.attempts,10);assert.equal(burst.trustedPresses,10);assert.equal(burst.acceptedClicks,10);assert.equal(burst.refused,0);assert.equal(burst.disappeared,0);assert.equal(burst.unrelatedClicks,0);assert.ok(burst.windowMs<=2000&&burst.windowMs>=0);assert.ok(burst.maxFrameGapMs<1000);
 const presses=(report.presses||[]).filter(row=>row.action==='act:yes'),clicks=(report.clicks||[]).filter(row=>row.action==='act:yes');assert.equal(presses.length,10);assert.equal(clicks.length,10);
 const ids=presses.map(row=>row.offeredTaskId);assert.equal(new Set(ids).size,10,'Ten distinct actually offered tasks required');assert.ok(ids.every(id=>typeof id==='string'&&id.length>0));
 for(let i=0;i<10;i++){assert.equal(presses[i].pointerType,'touch');assert.equal(presses[i].trusted,true);assert.equal(clicks[i].trusted,true);assert.equal(clicks[i].offeredTaskId,ids[i],'The accepted click must refer to the delivered offered task');const attempt=burst.attemptDetails[i];assert.equal(attempt.acceptedClicks,1);assert.equal(attempt.neutralRelease,false);assert.equal(attempt.nativeDownAction,'act:yes');assert.equal(attempt.availability.disabled,false);assert.equal(attempt.availability.present,true);assert.equal(attempt.availability.hit,true);}
 assert.ok(presses.at(-1).at-presses[0].at<=2000);assert.equal(story.initialChain.length,1);assert.deepEqual(story.acceptedTaskIds,ids);assert.deepEqual(story.finalChain,[...story.initialChain,...ids]);assert.deepEqual(story.durableChain,story.finalChain);assert.equal(new Set(story.finalChain).size,11);
 assert.equal(story.taskCount,400);assert.equal(story.durableTaskCount,400);assert.equal(story.retainedSourceCount,2);for(const key of ['taskIdentityHash','unknownSourceHash','protectedSourcesHash']){hash(story.before[key]);assert.equal(story.after[key],story.before[key],'Original source preservation: '+key);}hash(story.durableHash);
 assert.deepEqual(report.errors,[]);for(const key of ['contextClosed','browserClosed','serverClosed'])assert.equal(report.cleanup?.[key],true);return report;
}
export function verifyMemoryBoundary(snapshot,{successful=false}={}){
 assert.equal(snapshot?.platform,'linux','Linux kernel memory accounting required');assert.equal(snapshot.controller,'cgroup-v2');assert.equal(snapshot.scope,'entire-container-process-tree');assert.equal(snapshot.memoryMaxBytes,MOBILE_MEMORY_BYTES,'Exact512MB hard limit required');assert.equal(snapshot.swapMaxBytes,0,'Swap must be disabled');assert.equal(snapshot.swapCurrentBytes,0);assert.ok(snapshot.currentBytes>0&&snapshot.peakBytes>=snapshot.currentBytes);assert.equal(typeof snapshot.membership,'string');assert.ok(snapshot.membership.startsWith('0::'));
 for(const key of ['oom','oom_kill','max'])assert.ok(Number.isSafeInteger(snapshot.events?.[key])&&snapshot.events[key]>=0);
 if(successful)assert.ok(snapshot.peakBytes<=MOBILE_MEMORY_BYTES,'Successful client exceeded512MB');return snapshot;
}
function bundleFile(root,relative,sha){
 assert.ok(typeof relative==='string'&&!path.isAbsolute(relative)&&relative.split(/[\\/]/).every(part=>part&&part!=='.'&&part!=='..'),'Safe mobile artifact path required');let file=root;for(const part of relative.split('/')){file=path.join(file,part);assert.equal(fs.lstatSync(file).isSymbolicLink(),false);}const bytes=fs.readFileSync(file);assert.equal(mobileDigest(bytes),sha,'Mobile raw artifact hash mismatch');return JSON.parse(bytes);
}
export function mobileArtifactInventory(root){
 const files=[];function visit(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);assert.equal(entry.isSymbolicLink(),false,'Mobile artifact symlinks forbidden');if(entry.isDirectory())visit(file);else{assert.equal(entry.isFile(),true);const relative=path.relative(root,file).split(path.sep).join('/');if(relative==='report.json')continue;const bytes=fs.readFileSync(file);files.push({path:relative,sha256:mobileDigest(bytes),bytes:bytes.length});}}}visit(root);return files.sort((a,b)=>a.path.localeCompare(b.path));
}
// Moby EventOOM marks a container even when only the intentional child dies:
// https://github.com/moby/moby/blob/v28.0.4/daemon/monitor.go#L159-L173
export function verifyMobileContainerExit(state,{control=false}={}){
 assert.equal(state.Running,false);assert.equal(state.ExitCode,0);assert.equal(typeof state.OOMKilled,'boolean','Raw Docker OOM flag required');
 if(!control)assert.equal(state.OOMKilled,false,'Acceptance client must not encounter Docker OOM');return state;
}
export function verifyMobileMemoryReport(report,{artifactRoot,...identity}={}){
 assert.equal(report.schemaVersion,1);assert.equal(report.kind,'button-mobile-memory');assert.equal(report.status,'passed','Capped mobile job must pass');assert.deepEqual(report.requiredStory,MOBILE_STORY);assert.equal(report.image,MOBILE_IMAGE);assert.ok(artifactRoot,'Actual mobile artifact bundle required');assert.deepEqual(report.artifacts,mobileArtifactInventory(artifactRoot),'Complete immutable mobile artifact inventory required');
 for(const [key,value]of Object.entries(identity))if(value!==undefined)assert.equal(report[key],value,'Mobile report identity '+key);
 for(const key of ['candidateCommit','candidateTree'])assert.match(report[key]||'',/^[a-f0-9]{40}$/);
 const control=report.negativeControl;verifyMemoryBoundary(control.before);verifyMemoryBoundary(control.after);assert.equal(control.childSignal,'SIGKILL','Kernel must stop the over-budget control');assert.equal(control.childExitCode,null);assert.ok(control.after.events.oom_kill>control.before.events.oom_kill,'Actual kernel OOM-kill event required');assert.ok(control.after.events.max>control.before.events.max);assert.ok(control.requestedBytes>MOBILE_MEMORY_BYTES);
 assert.deepEqual(report.cases?.map(row=>row.motion).sort(),['normal','reduced']);const ids=[control.containerId];
 for(const row of [control,...report.cases]){
  assert.match(row.containerId||'',/^[a-f0-9]{64}$/);assert.equal(row.image,MOBILE_IMAGE);assert.equal(row.dockerMemoryBytes,MOBILE_MEMORY_BYTES);assert.equal(row.dockerMemorySwapBytes,MOBILE_MEMORY_BYTES);assert.equal(row.containerExitCode,0);assert.equal(typeof row.containerOOMKilled,'boolean');
  const raw=bundleFile(artifactRoot,row.insidePath,row.insideSha256),before=bundleFile(artifactRoot,row.dockerBeforePath,row.dockerBeforeSha256),after=bundleFile(artifactRoot,row.dockerAfterPath,row.dockerAfterSha256);
  assert.equal(raw.status,'passed');assert.deepEqual(raw.errors,[]);assert.deepEqual(raw.before,row.before);assert.deepEqual(raw.after,row.after);assert.equal(raw.nodeVersion,row.nodeVersion);
  for(const [key,value]of Object.entries({Id:row.containerId}))assert.equal(before[key],value);assert.equal(after.Id,row.containerId);assert.equal(before.Config.Image,MOBILE_IMAGE);assert.equal(before.HostConfig.Memory,MOBILE_MEMORY_BYTES);assert.equal(before.HostConfig.MemorySwap,MOBILE_MEMORY_BYTES);assert.equal(after.State.OOMKilled,row.containerOOMKilled,'Raw Docker OOM flag must match the envelope');verifyMobileContainerExit(after.State,{control:row===control});
  if(row===control){assert.equal(raw.childSignal,row.childSignal);assert.equal(raw.childExitCode,row.childExitCode);assert.equal(raw.requestedBytes,row.requestedBytes);}else{assert.equal(raw.motion,row.motion);assert.equal(raw.nativeReportSha256,row.nativeReportSha256);assert.equal(row.nativeReportPath,row.motion+'/'+raw.nativeReportPath);}
 }
 for(const row of report.cases){ids.push(row.containerId);verifyMemoryBoundary(row.before,{successful:true});verifyMemoryBoundary(row.after,{successful:true});for(const key of ['oom','oom_kill'])assert.equal(row.after.events[key],row.before.events[key],'No client OOM may pass');assert.equal(row.before.events.oom_kill,0,'Fresh capped client required');const native=bundleFile(artifactRoot,row.nativeReportPath,row.nativeReportSha256);verifyMobileFunctionalReport(native,{candidateCommit:report.candidateCommit,candidateTree:report.candidateTree,motion:row.motion});assert.equal(native.runtime.platform,'linux');assert.match(row.nodeVersion||'',/^v22\./);}
 assert.equal(new Set(ids).size,3,'Negative control and each motion need a fresh container');assert.deepEqual(report.errors,[]);assert.equal(report.cleanup.containersRemoved,true);return report;
}
