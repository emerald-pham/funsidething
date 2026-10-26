#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MOBILE_MEMORY_BYTES,MOBILE_IMAGE,MOBILE_SCENARIO,MOBILE_STORY,mobileDigest,mobileArtifactInventory,verifyMemoryBoundary,verifyMobileFunctionalReport,verifyMobileMemoryReport} from './button-safety-mobile-contract.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function readMemoryBoundary({platform=process.platform,read=file=>fs.readFileSync(file,'utf8')}={}){
 if(platform!=='linux')throw Error('Required512MB proof needs Linux cgroup-v2 kernel enforcement; an uncapped mobile functional run is separate.');
 const directory='/sys/fs/cgroup/',number=name=>{const raw=read(directory+name).trim();if(!/^\d+$/.test(raw))throw Error('Unbounded or unreadable cgroup '+name);return Number(raw);};
 const events=Object.fromEntries(read(directory+'memory.events').trim().split('\n').map(line=>{const [key,value]=line.split(/\s+/);return[key,Number(value)];}));
 const result={platform,controller:'cgroup-v2',scope:'entire-container-process-tree',memoryMaxBytes:number('memory.max'),swapMaxBytes:number('memory.swap.max'),swapCurrentBytes:number('memory.swap.current'),currentBytes:number('memory.current'),peakBytes:number('memory.peak'),events,membership:read('/proc/self/cgroup').trim()};verifyMemoryBoundary(result);return result;
}
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8',timeout:15000});if(r.status!==0)throw Error('Mobile source identity failed: '+r.stderr);return r.stdout.trim();};
function identity(){return{candidateCommit:git('rev-parse','HEAD'),candidateTree:git('rev-parse','HEAD^{tree}'),sourceSha:process.env.CHAIN_TEST_SOURCE_SHA||git('rev-parse','HEAD'),repository:process.env.GITHUB_REPOSITORY,runId:process.env.GITHUB_RUN_ID,runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT),eventPolicy:process.env.CHAIN_TEST_EVENT_POLICY};}
async function inside(output,motion,control){
 fs.mkdirSync(output,{recursive:true});const report={status:'running',nodeVersion:process.version,errors:[]};try{
  report.before=readMemoryBoundary();if(!/^v22\./.test(process.version))throw Error('The minimal consumer must use Node22.');
  if(control){
   report.requestedBytes=1024*1024*1024;
   const child=spawnSync(process.execPath,['--input-type=module','-e',"import fs from 'node:fs';fs.writeFileSync('/proc/self/oom_score_adj','1000');const committed=[];for(let i=0;i<1024;i++)committed.push(Buffer.alloc(1048576,165));process.stdout.write(String(committed.length));"],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
   report.childSignal=child.signal;report.childExitCode=child.status;report.childError=child.error?.message||null;report.after=readMemoryBoundary();
   if(child.signal!=='SIGKILL'||report.after.events.oom_kill<=report.before.events.oom_kill||report.after.events.max<=report.before.events.max)throw Error('The real over-budget negative control did not produce a kernel OOM kill.');
  }else{
   if(!MOBILE_STORY.motions.includes(motion))throw Error('Explicit normal or reduced mobile motion required');
   const {runButtonSafety}=await import('./button-safety-native.mjs');const result=await runButtonSafety({repo:root,engine:'webkit',port:0,outputDir:output,scenarioFilter:MOBILE_SCENARIO,mobileYesMotion:motion});
   verifyMobileFunctionalReport(result.report,{...identity(),motion});report.nativeReportPath=path.basename(result.reportPath);report.nativeReportSha256=mobileDigest(fs.readFileSync(result.reportPath));report.motion=motion;report.after=readMemoryBoundary();verifyMemoryBoundary(report.after,{successful:true});for(const key of ['oom','oom_kill'])if(report.after.events[key]!==report.before.events[key])throw Error('The capped mobile client encountered OOM');
  }
  report.status='passed';
 }catch(error){report.status='failed';report.errors.push(error.stack||String(error));try{report.after=readMemoryBoundary();}catch{}throw error;}
 finally{write(path.join(output,'inside.json'),report);}
}
export function containerArgs({repo,output,nodeBinary,motion,control,eventPolicy}){
 const args=['create','--init','--network','none','--cap-drop','ALL','--read-only','--memory',String(MOBILE_MEMORY_BYTES),'--memory-swap',String(MOBILE_MEMORY_BYTES),'--shm-size','67108864','--tmpfs','/tmp:rw,nosuid,size=67108864','--user',String(process.getuid())+':'+String(process.getgid()),'--workdir','/repo','--mount','type=bind,src='+repo+',dst=/repo,readonly','--mount','type=bind,src='+output+',dst=/evidence','--mount','type=bind,src='+nodeBinary+',dst=/opt/chain-node,readonly','--env','HOME=/tmp','--env','CI=true','--env','CHAIN_TEST_EVENT_POLICY='+eventPolicy,'--env','GIT_CONFIG_COUNT=1','--env','GIT_CONFIG_KEY_0=safe.directory','--env','GIT_CONFIG_VALUE_0=/repo',MOBILE_IMAGE,'/opt/chain-node','scripts/button-safety-mobile-memory.mjs','--inside','--output-dir','/evidence'];
 if(control)args.push('--control');else args.push('--motion',motion);return args;
}
export async function runCappedMobile({outputDir}){
 if(process.platform!=='linux'||process.env.CI!=='true'||!['push','pull_request'].includes(process.env.CHAIN_TEST_EVENT_POLICY))throw Error('Capped mobile acceptance requires the isolated hosted Linux push/pull-request runtime; local functional evidence cannot waive it.');
 const output=path.resolve(outputDir);if(output===root||output.startsWith(root+path.sep))throw Error('Capped mobile evidence must be outside the checkout');fs.mkdirSync(output,{recursive:true});if(fs.readdirSync(output).length)throw Error('Capped mobile output must be new and empty');
 const source=identity();if(git('status','--porcelain=v1'))throw Error('Capped mobile requires exact clean committed source');
 const report={schemaVersion:1,kind:'button-mobile-memory',status:'running',requiredStory:MOBILE_STORY,image:MOBILE_IMAGE,...source,cases:[],errors:[],cleanup:{containersRemoved:false}},owned=new Set();
 const docker=(args,{allowFailure=false,timeout=60000}={})=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout,maxBuffer:8*1024*1024});if(!allowFailure&&(r.error||r.status!==0))throw Error('Owned mobile container command failed: '+(r.error?.message||r.stderr));return r;};
 const inspect=id=>JSON.parse(docker(['inspect',id]).stdout)[0];
 try{
  docker(['pull',MOBILE_IMAGE],{timeout:180000});
  for(const [label,motion,control]of [['negative',null,true],['normal','normal',false],['reduced','reduced',false]]){
   const directory=path.join(output,label);fs.mkdirSync(directory);
   const id=docker(containerArgs({repo:root,output:directory,nodeBinary:fs.realpathSync(process.execPath),motion,control,eventPolicy:source.eventPolicy})).stdout.trim();if(!/^[a-f0-9]{64}$/.test(id))throw Error('Exact created container identity required');owned.add(id);
   const before=inspect(id);write(path.join(directory,'docker-before.json'),before);if(before.HostConfig.Memory!==MOBILE_MEMORY_BYTES||before.HostConfig.MemorySwap!==MOBILE_MEMORY_BYTES||before.Config.Image!==MOBILE_IMAGE)throw Error('Docker did not configure exact512MB/no-swap image boundary');
   const run=docker(['start','--attach',id],{allowFailure:true,timeout:60000});fs.writeFileSync(path.join(directory,'stdout.txt'),run.stdout||'');fs.writeFileSync(path.join(directory,'stderr.txt'),run.stderr||'');
   const after=inspect(id);write(path.join(directory,'docker-after.json'),after);if(run.error||run.status!==0||after.State.Running||after.State.ExitCode!==0||after.State.OOMKilled)throw Error('Capped '+label+' did not finish cleanly: '+(run.error?.message||run.stderr));
   const result=JSON.parse(fs.readFileSync(path.join(directory,'inside.json'),'utf8'));if(result.status!=='passed')throw Error('Capped '+label+' inside consumer did not pass');
   const rawFile=name=>({path:label+'/'+name,sha256:mobileDigest(fs.readFileSync(path.join(directory,name)))}),insideRaw=rawFile('inside.json'),beforeRaw=rawFile('docker-before.json'),afterRaw=rawFile('docker-after.json');
   const row={...result,insidePath:insideRaw.path,insideSha256:insideRaw.sha256,dockerBeforePath:beforeRaw.path,dockerBeforeSha256:beforeRaw.sha256,dockerAfterPath:afterRaw.path,dockerAfterSha256:afterRaw.sha256,containerId:id,image:before.Config.Image,dockerMemoryBytes:before.HostConfig.Memory,dockerMemorySwapBytes:before.HostConfig.MemorySwap,containerExitCode:after.State.ExitCode,containerOOMKilled:after.State.OOMKilled};
   if(control)report.negativeControl=row;else{row.nativeReportPath=label+'/'+row.nativeReportPath;report.cases.push(row);}
   docker(['rm',id]);owned.delete(id);write(path.join(output,'report.json'),report);
  }
  report.cleanup.containersRemoved=true;report.status='passed';report.artifacts=mobileArtifactInventory(output);verifyMobileMemoryReport(report,{artifactRoot:output,...source});return report;
 }catch(error){report.status='failed';report.errors.push(error.stack||String(error));throw error;}
 finally{let removed=true;for(const id of owned){const r=docker(['rm','--force',id],{allowFailure:true});if(r.error||r.status!==0)removed=false;}report.cleanup.containersRemoved=removed;report.artifacts=mobileArtifactInventory(output);write(path.join(output,'report.json'),report);}
}
if(path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];try{
  if(args.includes('--inside'))await inside(path.resolve(value('--output-dir')),value('--motion'),args.includes('--control'));
  else if(args.includes('--verify')){const file=path.resolve(value('--verify'));verifyMobileMemoryReport(JSON.parse(fs.readFileSync(file,'utf8')),{artifactRoot:path.dirname(file),...identity()});process.stdout.write('Capped mobile memory report verified.\n');}
  else if(args.includes('--run')){await runCappedMobile({outputDir:value('--output-dir')});process.stdout.write('Capped mobile report: '+path.join(path.resolve(value('--output-dir')),'report.json')+'\n');}
  else throw Error('Choose --run, --inside or --verify');
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
