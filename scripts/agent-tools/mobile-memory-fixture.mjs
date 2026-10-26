// Synthetic parser fixtures only. Never use these as native or512MB runtime proof.
import fs from 'node:fs';
import path from 'node:path';
import {MOBILE_IMAGE,mobileDigest,mobileArtifactInventory} from '../button-safety-mobile-contract.mjs';
export function createMobileBundle(directory,identity={}){
 fs.mkdirSync(directory,{recursive:true});const source={candidateCommit:'a'.repeat(40),candidateTree:'b'.repeat(40),sourceSha:'a'.repeat(40),repository:'example/fixture',runId:'fixture-run-1',runAttempt:1,eventPolicy:'local',...identity};
 const memory=()=>({platform:'linux',controller:'cgroup-v2',scope:'entire-container-process-tree',memoryMaxBytes:512000000,swapMaxBytes:0,swapCurrentBytes:0,currentBytes:50000000,peakBytes:100000000,events:{max:0,oom:0,oom_kill:0},membership:'0::/'});
 const row=(label,id)=>({status:'passed',nodeVersion:'v22.23.2',errors:[],before:memory(),after:memory(),containerId:id.repeat(64),image:MOBILE_IMAGE,dockerMemoryBytes:512000000,dockerMemorySwapBytes:512000000,containerExitCode:0,containerOOMKilled:false,label});
 const control=row('negative','1');Object.assign(control,{childSignal:'SIGKILL',childExitCode:null,requestedBytes:1073741824});control.after.events={max:1,oom:1,oom_kill:1};control.after.peakBytes=512000000;
 const native={};const cases=['normal','reduced'].map((motion,i)=>{
  const candidate=row(motion,String(i+2));candidate.motion=motion;candidate.nativeReportPath=motion+'/native.json';const ids=Array.from({length:10},(_,i)=>'offered-'+i),chain=['initial-dot',...ids],before={taskIdentityHash:'c'.repeat(64),unknownSourceHash:'d'.repeat(64),protectedSourcesHash:'e'.repeat(64)};
  native[motion]={schemaVersion:1,kind:'button-mobile-functional',status:'passed',engine:'webkit',candidateCommit:source.candidateCommit,candidateTree:source.candidateTree,runtime:{platform:'linux'},scenarios:[{name:'rapid scanner candidate actions with 400 active tasks',status:'passed',setup:{durableTasks:400}}],presses:ids.map((id,i)=>({action:'act:yes',offeredTaskId:id,at:i*100,pointerType:'touch',trusted:true})),clicks:ids.map(id=>({action:'act:yes',offeredTaskId:id,trusted:true})),rapidOutcomes:[{action:'act:yes',bursts:[{attempts:10,trustedPresses:10,acceptedClicks:10,refused:0,disappeared:0,unrelatedClicks:0,windowMs:1000,maxFrameGapMs:16,attemptDetails:ids.map(()=>({acceptedClicks:1,neutralRelease:false,nativeDownAction:'act:yes',availability:{disabled:false,present:true,hit:true}}))}]}],mobileStory:{profile:{name:'iPhone 13 WebKit equivalent, full app viewport',viewport:{width:390,height:844},screen:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true},motion,observed:{width:390,height:844,screenWidth:390,screenHeight:844,deviceScaleFactor:3,maxTouchPoints:0,coarsePointer:true,userAgent:'iPhone AppleWebKit Mobile',appMotion:motion,appliedMotion:motion,reducedMedia:motion==='reduced'},initialChain:['initial-dot'],acceptedTaskIds:ids,finalChain:chain,durableChain:[...chain],taskCount:400,durableTaskCount:400,retainedSourceCount:2,durableHash:'f'.repeat(64),before,after:{...before}},errors:[],cleanup:{contextClosed:true,browserClosed:true,serverClosed:true}};
  return candidate;
 });
 const report={schemaVersion:1,kind:'button-mobile-memory',status:'passed',requiredStory:{savedTasks:400,yesCount:10,distinctTasks:true,windowMs:2000,memoryBudgetBytes:512000000,motions:['normal','reduced']},image:MOBILE_IMAGE,...source,negativeControl:control,cases,errors:[],cleanup:{containersRemoved:true}};
 const bundle={directory,report,native};refreshMobileBundle(bundle);return bundle;
}
export function refreshMobileBundle({directory,report,native}){
 const write=(relative,value)=>{const file=path.join(directory,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');return mobileDigest(fs.readFileSync(file));};
 for(const row of [report.negativeControl,...report.cases]){
  const label=row.label;if(row.motion)row.nativeReportSha256=write(row.nativeReportPath,native[row.motion]);
  const raw={status:row.status,nodeVersion:row.nodeVersion,errors:row.errors,...(row.hostedPolicy?{hostedPolicy:row.hostedPolicy}:{}),before:row.before,after:row.after,...(row.motion?{motion:row.motion,nativeReportPath:path.basename(row.nativeReportPath),nativeReportSha256:row.nativeReportSha256}:{childSignal:row.childSignal,childExitCode:row.childExitCode,requestedBytes:row.requestedBytes})};
  for(const [key,file,value]of [['inside','inside.json',raw],['dockerBefore','docker-before.json',{Id:row.containerId,Config:{Image:row.image},HostConfig:{Memory:row.dockerMemoryBytes,MemorySwap:row.dockerMemorySwapBytes}}],['dockerAfter','docker-after.json',{Id:row.containerId,State:{Running:false,ExitCode:row.containerExitCode,OOMKilled:row.containerOOMKilled}}]]){row[key+'Path']=label+'/'+file;row[key+'Sha256']=write(row[key+'Path'],value);}
 }
 report.artifacts=mobileArtifactInventory(directory);write('report.json',report);
}
