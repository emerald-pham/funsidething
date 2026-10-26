#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {MOBILE_MEMORY_BYTES,mobileBudgetBytes,MOBILE_DRIVER_BYTES,MOBILE_MEMORY_SCOPE,MOBILE_IMAGE,MOBILE_SCENARIO,MOBILE_STORY,mobileDigest,mobileArtifactInventory,verifyMemoryBoundary,verifyMobileFunctionalReport,verifyMobileMemoryReport,verifyMobileStressReport,classifyMobileStressOutcome,verifyMobileContainerExit,verifyMobileContainerConfig} from './button-safety-mobile-contract.mjs';
import {hostedButtonPolicy} from './button-safety-ci-policy.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const write=(file,value)=>{const temporary=file+'.tmp-'+process.pid;fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n');fs.renameSync(temporary,file);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
async function awaitFile(file,{timeout=30000,abort}={}){const began=Date.now();for(;;){if(fs.existsSync(file))return json(file);if(abort)abort();if(Date.now()-began>timeout)throw Error('Owned mobile handoff timed out: '+path.basename(file));await pause(20);}}
const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8',timeout:15000});if(r.status!==0)throw Error('Mobile source identity failed: '+r.stderr);return r.stdout.trim();};
function identity(){return{candidateCommit:git('rev-parse','HEAD'),candidateTree:git('rev-parse','HEAD^{tree}'),sourceSha:process.env.CHAIN_TEST_SOURCE_SHA||git('rev-parse','HEAD'),repository:process.env.GITHUB_REPOSITORY,runId:process.env.GITHUB_RUN_ID,runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT),eventPolicy:process.env.CHAIN_TEST_EVENT_POLICY};}
function kernelPageObservation({architecture=process.arch,read=file=>fs.readFileSync(file)}={}){
 assert.equal(architecture,'x64','Pinned Linux x64 budget runtime required');
 const auxv=read('/proc/self/auxv');assert.ok(Buffer.isBuffer(auxv)&&auxv.length>0&&auxv.length%16===0,'Actual ELF64 Linux auxv required');const entries=[];
 for(let offset=0;offset<auxv.length;offset+=16){const type=auxv.readBigUInt64LE(offset);if(type===0n)break;if(type===6n)entries.push(auxv.subarray(offset,offset+16));}
 assert.equal(entries.length,1,'One kernel AT_PAGESZ observation required');const entry=entries[0],bytes=Number(entry.readBigUInt64LE(8));assert.equal(bytes,4096,'Unsupported pinned x64 kernel page size');
 return{source:'/proc/self/auxv:AT_PAGESZ',architecture,wordBytes:8,endianness:'LE',entryHex:entry.toString('hex'),bytes};
}
function kernelSnapshot({platform=process.platform,architecture=process.arch,read=file=>fs.readFileSync(file),scope=MOBILE_MEMORY_SCOPE}={}){
 if(platform!=='linux')throw Error('Profile budget proof needs Linux cgroup-v2 kernel enforcement; an uncapped mobile functional run is separate.');
 const directory='/sys/fs/cgroup/',number=name=>{const raw=read(directory+name).toString().trim();if(!/^\d+$/.test(raw))throw Error('Unbounded or unreadable cgroup '+name);return Number(raw);};
 const events=Object.fromEntries(read(directory+'memory.events').toString().trim().split('\n').map(line=>{const [key,value]=line.split(/\s+/);return[key,Number(value)];}));
 return{pageSizeObservation:kernelPageObservation({architecture,read}),platform,controller:'cgroup-v2',scope,memoryMaxBytes:number('memory.max'),swapMaxBytes:number('memory.swap.max'),swapCurrentBytes:number('memory.swap.current'),currentBytes:number('memory.current'),peakBytes:number('memory.peak'),events,membership:read('/proc/self/cgroup').toString().trim()};
}
export function readMemoryBoundary(options={}){const result=kernelSnapshot(options);verifyMemoryBoundary(result,options);return result;}
function processIdentity(pid,{hashExecutable=false}={}){
 const base='/proc/'+pid,stat=fs.readFileSync(base+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' '),executable=fs.readlinkSync(base+'/exe');
 return{pid:Number(pid),ppid:Number(fields[1]),startTime:fields[19],cgroup:fs.readFileSync(base+'/cgroup','utf8').trim(),namespace:fs.readlinkSync(base+'/ns/net'),pidNamespace:fs.readlinkSync(base+'/ns/pid'),executable,...(hashExecutable?{executableSha256:mobileDigest(fs.readFileSync(base+'/exe'))}:{})};
}
function browserProcesses(){
 const rows=[];for(const pid of fs.readdirSync('/proc').filter(v=>/^\d+$/.test(v)))try{rows.push(processIdentity(pid));}catch(error){if(!['ENOENT','ESRCH','EACCES'].includes(error.code))throw error;}
 // This private PID namespace contains only init, the owner and its engine.
 // Include reparented/daemonized helpers too; ancestry alone can lose them.
 return rows.filter(row=>row.pid!==1&&row.pid!==process.pid);
}
async function browserServer(output,control,budgetProfile='required-1gb'){
 const budget=mobileBudgetBytes(budgetProfile);
 fs.mkdirSync(output,{recursive:true});const source=identity(),report={...source,budgetProfile,status:'running',role:'browser',scope:MOBILE_MEMORY_SCOPE,nodeVersion:process.version,hostedPolicy:hostedButtonPolicy(),uid:process.getuid(),gid:process.getgid(),namespace:fs.readlinkSync('/proc/self/ns/net'),pidNamespace:fs.readlinkSync('/proc/self/ns/pid'),ownerPid:process.pid,errors:[],cleanup:{}};
 const file=path.join(output,'browser-server.json'),readyFile=path.join(output,'ready.json'),requestFile=path.join(output,'owner-request.json');let server,monitor,monitorError;const seen=new Map();
 try{
  assert.match(process.version,/^v22\./);assert.ok(report.uid>0&&report.gid>0);report.before=readMemoryBoundary({budgetProfile});
  const playwright=await import('playwright'),packageInfo=json(path.join(path.dirname(fileURLToPath(import.meta.resolve('playwright'))),'package.json'));
  assert.equal(packageInfo.version,'1.62.1');
  const executable=playwright.webkit.executablePath(),revision=executable.match(/\/webkit-(\d+)\//)?.[1];assert.equal(revision,'2336','Pinned image WebKit revision required');
  // The Docker kernel cap already exists before launchServer creates any engine process.
  server=await playwright.webkit.launchServer({headless:true,host:'127.0.0.1',port:0});
  const child=server.process(),rootProcess=processIdentity(child.pid,{hashExecutable:true});
  report.browser={endpointSha256:mobileDigest(server.wsEndpoint()),rootPid:child.pid,rootStartTime:rootProcess.startTime,executable,executableSha256:mobileDigest(fs.readFileSync(executable)),playwrightVersion:packageInfo.version,revision,version:null,processes:[]};
  const capture=()=>{for(const item of browserProcesses()){
   assert.equal(item.cgroup,report.before.membership,'Browser descendant escaped capped membership');assert.equal(item.namespace,report.namespace);
   const key=item.pid+':'+item.startTime;if(!seen.has(key))try{seen.set(key,{...item,executableSha256:mobileDigest(fs.readFileSync('/proc/'+item.pid+'/exe'))});}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
  }report.browser.processes=[...seen.values()];};
  capture();monitor=setInterval(()=>{try{capture();}catch(error){monitorError??=error;}},20);
  const connection=await playwright.webkit.connect(server.wsEndpoint());report.browser.version=connection.version();await connection.close();assert.ok(child.exitCode===null&&child.signalCode===null,'Disconnect must leave owned browser live');
  const token=randomUUID();write(readyFile,{status:'ready',budgetProfile,...source,hostedPolicy:report.hostedPolicy,endpoint:server.wsEndpoint(),token,namespace:report.namespace,browser:report.browser});
  const request=await awaitFile(requestFile,{timeout:60000,abort:()=>{if(monitorError)throw monitorError;if(child.exitCode!==null||child.signalCode!==null)throw Error('Owned WebKit exited before closure request');}});assert.equal(request.token,token);assert.equal(request.action,control?'control':'close');
  if(control){
   assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);capture();
   const allocator=spawnSync(process.execPath,['--input-type=module','-e',"import fs from 'node:fs';fs.writeFileSync('/proc/self/oom_score_adj','1000');process.stdout.write(JSON.stringify({membership:fs.readFileSync('/proc/self/cgroup','utf8').trim(),pid:process.pid,ppid:process.ppid,pidNamespace:fs.readlinkSync('/proc/self/ns/pid')})+'\\n');const committed=[];for(let i=0;i<"+Math.ceil(2*budget/1048576)+";i++)committed.push(Buffer.alloc(1048576,165));process.stdout.write(String(committed.length));"],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
   report.control={requestedBytes:Math.ceil(2*budget/1048576)*1048576,childSignal:allocator.signal,childExitCode:allocator.status,childError:allocator.error?.message||null,...JSON.parse(allocator.stdout.split('\n')[0]),browserAlive:true,browserPid:child.pid};
   const after=readMemoryBoundary({budgetProfile});assert.equal(allocator.signal,'SIGKILL');assert.equal(allocator.status,null);assert.ok(after.events.oom_kill>report.before.events.oom_kill&&after.events.max>report.before.events.max,'Real kernel OOM control required in live browser group');
  }
  if(monitorError)throw monitorError;
  report.status='passed';
 }catch(error){report.status='failed';report.errors.push(error.stack||String(error));throw error;}
 finally{
  clearInterval(monitor);
  if(server)try{const child=server.process();await server.close();report.cleanup.serverClosed=true;report.engineExit={exitCode:child.exitCode,signal:child.signalCode};assert.ok(child.exitCode!==null||child.signalCode!==null,'Owned engine exit must be observed');report.cleanup.engineExited=true;if(budgetProfile!=='stress-512mb'||control){assert.equal(child.exitCode,0,'Owned engine must exit cleanly');assert.equal(child.signalCode,null);}}catch(error){report.status='failed';report.errors.push('owner cleanup: '+String(error));}
  try{report.after=readMemoryBoundary({budgetProfile});}catch(error){report.status='failed';report.errors.push(String(error));}
  if(!control&&report.before&&report.after)for(const key of ['oom','oom_kill'])if(report.after.events[key]!==report.before.events[key]){report.status='failed';report.errors.push('Browser budget OOM: '+key);}
  write(file,report);if(report.status!=='passed')process.exitCode=1;
 }
}
async function driver(output,motion,control,budgetProfile='required-1gb'){
 mobileBudgetBytes(budgetProfile);
 fs.mkdirSync(output,{recursive:true});const source=identity(),report={...source,budgetProfile,status:'running',role:'external-driver',nodeVersion:process.version,hostedPolicy:hostedButtonPolicy(),errors:[]};const file=path.join(output,'inside.json');let ready,requested=false;
 const closeOwner=async()=>{if(!requested){assert.ok(ready);write(path.join(output,'owner-request.json'),{token:ready.token,action:control?'control':'close'});requested=true;}const result=await awaitFile(path.join(output,'browser-server.json'));if(budgetProfile!=='stress-512mb'||control)assert.equal(result.status,'passed','Browser owner must finish successfully');assert.equal(result.cleanup?.serverClosed,true);assert.equal(result.cleanup.engineExited,true);return result;};
 try{
  assert.match(process.version,/^v22\./);report.playwrightVersion=json(path.join(path.dirname(fileURLToPath(import.meta.resolve('playwright'))),'package.json')).version;assert.equal(report.playwrightVersion,'1.62.1');report.driver=kernelSnapshot({scope:'external-driver'});assert.equal(report.driver.memoryMaxBytes,MOBILE_DRIVER_BYTES);assert.equal(report.driver.swapMaxBytes,0);assert.equal(report.driver.swapCurrentBytes,0);report.driver.namespace=fs.readlinkSync('/proc/self/ns/net');report.driver.pidNamespace=fs.readlinkSync('/proc/self/ns/pid');
  ready=await awaitFile(path.join(output,'ready.json'));assert.equal(ready.budgetProfile,budgetProfile);for(const key of ['candidateCommit','candidateTree'])assert.equal(ready[key],source[key]);assert.deepEqual(ready.hostedPolicy,report.hostedPolicy);assert.equal(ready.namespace,report.driver.namespace);
  if(control){const result=await closeOwner();Object.assign(report,result.control);report.before=result.before;report.after=result.after;}
  else{
   assert.ok(MOBILE_STORY.motions.includes(motion));const {runButtonSafety}=await import('./button-safety-native.mjs');
   let result,appError;
   try{result=await runButtonSafety({repo:root,engine:'webkit',port:0,outputDir:output,scenarioFilter:MOBILE_SCENARIO,mobileYesMotion:motion,browserServerEndpoint:ready.endpoint,closeBrowserServer:async()=>{const owned=await closeOwner();return owned.cleanup;}});}catch(error){appError=error;}
   // Persist the original native failure and audit it separately from driver
   // execution. A failed application is never rewritten as a functional pass.
   const files=fs.readdirSync(output).filter(name=>/^button-safety-webkit-.*\.json$/.test(name));assert.equal(files.length,1,'One actual native attempt report required');
   report.nativeReportPath=files[0];report.nativeReportSha256=mobileDigest(fs.readFileSync(path.join(output,files[0])));report.motion=motion;
   const native=result?.report||json(path.join(output,files[0])),owned=await closeOwner();report.before=owned.before;report.after=owned.after;
   if(budgetProfile==='stress-512mb')report.appOutcome=classifyMobileStressOutcome(report,native,owned);
   else{if(appError)throw appError;verifyMobileFunctionalReport(native,{...source,motion});report.appOutcome='passed';}
  }
  report.status='passed';
 }catch(error){report.status='failed';report.errors.push(error.stack||String(error));throw error;}
 finally{
  if(ready&&!requested)try{await closeOwner();}catch(error){report.status='failed';report.errors.push('owner cleanup: '+String(error));}
  try{report.driverAfter=kernelSnapshot({scope:'external-driver'});}catch(error){report.status='failed';report.errors.push(String(error));}
  write(file,report);if(report.status!=='passed')process.exitCode=1;
 }
}
export function containerArgs({repo,output,nodeBinary,motion,control,eventPolicy,eventName,eventRef,role='browser',browserContainerId,containerName,ownershipToken,budgetProfile='required-1gb'}){
 const budget=mobileBudgetBytes(budgetProfile);
 if(!['browser','driver'].includes(role))throw Error('Explicit supported mobile container role required');
 if(role==='driver'&&!/^[a-f0-9]{64}$/.test(browserContainerId||''))throw Error('Exact browser container identity required');
 if(!process.getuid?.()||!process.getgid?.())throw Error('Mobile containers require a nonroot owner UID and GID');
 const memory=role==='browser'?budget:MOBILE_DRIVER_BYTES;
 const args=['create','--init','--network',role==='browser'?'none':'container:'+browserContainerId,'--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--memory',String(memory),'--memory-swap',String(memory),'--shm-size','67108864','--tmpfs','/tmp:rw,nosuid,size=67108864','--user',String(process.getuid())+':'+String(process.getgid()),'--workdir','/repo','--mount','type=bind,src='+repo+',dst=/repo,readonly','--mount','type=bind,src='+output+',dst=/evidence','--mount','type=bind,src='+nodeBinary+',dst=/opt/chain-node,readonly','--env','HOME=/tmp','--env','CI=true','--env','CHAIN_TEST_EVENT_POLICY='+eventPolicy,'--env','GITHUB_EVENT_NAME='+eventName,'--env','GITHUB_REF='+eventRef,'--env','GIT_CONFIG_COUNT=1','--env','GIT_CONFIG_KEY_0=safe.directory','--env','GIT_CONFIG_VALUE_0=/repo',MOBILE_IMAGE,'/opt/chain-node','scripts/button-safety-mobile-memory.mjs',role==='browser'?'--browser-server':'--driver','--output-dir','/evidence','--profile',budgetProfile];
 if(containerName||ownershipToken){assert.match(containerName||'',/^chain-mobile-[a-zA-Z0-9-]+$/);assert.match(ownershipToken||'',/^[a-zA-Z0-9-]{10,64}$/);args.splice(1,0,'--name',containerName,'--label','chain.mobile.owner='+ownershipToken);}
 for(const key of ['GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','CHAIN_TEST_SOURCE_SHA'])if(process.env[key])args.splice(args.indexOf(MOBILE_IMAGE),0,'--env',key+'='+process.env[key]);
 if(control)args.push('--control');else args.push('--motion',motion);return args;
}
export async function runCappedMobile({outputDir,budgetProfile='required-1gb'}){
 mobileBudgetBytes(budgetProfile);
 if(process.platform!=='linux'||process.env.CI!=='true')throw Error('Capped mobile acceptance requires the isolated hosted Linux push/pull-request runtime; local functional evidence cannot waive it.');
 const diagnosticMotion=process.env.CHAIN_DIAGNOSTIC_MOTION;assert.ok(['normal','reduced'].includes(diagnosticMotion),'Diagnostic carrier requires one explicit motion');assert.equal(budgetProfile,'required-1gb','This diagnostic cannot change the required budget');
 const hostedPolicy=hostedButtonPolicy(),output=path.resolve(outputDir);if(output===root||output.startsWith(root+path.sep))throw Error('Capped mobile evidence must be outside the checkout');fs.mkdirSync(output,{recursive:true});if(fs.readdirSync(output).length)throw Error('Capped mobile output must be new and empty');
 const source=identity();if(git('status','--porcelain=v1'))throw Error('Capped mobile requires exact clean committed source');
 const ownerToken=randomUUID(),report={schemaVersion:3,budgetProfile,kind:'button-mobile-memory-diagnostic',scope:MOBILE_MEMORY_SCOPE,status:'running',requiredStory:{...MOBILE_STORY,memoryBudgetBytes:mobileBudgetBytes(budgetProfile)},image:MOBILE_IMAGE,ownerToken,...source,hostedPolicy,cases:[],errors:[],cleanup:{containersRemoved:false}},owned=new Map(),commands=new Set();let interrupted=null,cleaning=false;
 const persistOwnership=()=>write(path.join(output,'ownership.json'),{ownerToken,...source,objects:[...owned].map(([identity,metadata])=>({identity,...metadata}))});
 const onSignal=signal=>{interrupted??=signal;if(!cleaning)for(const child of commands)child.kill('SIGTERM');};
 const handlers=Object.fromEntries(['SIGINT','SIGTERM'].map(signal=>[signal,()=>onSignal(signal)]));for(const [signal,handler]of Object.entries(handlers))process.on(signal,handler);
 // Await Docker without blocking signal delivery. Container cleanup belongs to
 // this owner even if create succeeded but start/connect never happened.
 const docker=async(args,{allowFailure=false,timeout=60000}={})=>{
  if(interrupted&&!allowFailure)throw Error('Owned mobile run interrupted: '+interrupted);
  const result=await new Promise(resolve=>{
   const child=spawn('docker',args,{stdio:['ignore','pipe','pipe']}),chunks={stdout:[],stderr:[]};let failure,bytes=0;
   commands.add(child);const timer=setTimeout(()=>{failure=Error('Docker command timed out');child.kill('SIGKILL');},timeout);
   for(const stream of ['stdout','stderr'])child[stream].on('data',chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024){failure=Error('Docker output exceeded its bound');child.kill('SIGKILL');}else chunks[stream].push(chunk);});
   child.on('error',error=>failure=error);child.on('close',(status,signal)=>{clearTimeout(timer);commands.delete(child);resolve({status,signal,error:failure,stdout:Buffer.concat(chunks.stdout).toString(),stderr:Buffer.concat(chunks.stderr).toString()});});
  });
  if(!allowFailure&&(interrupted||result.error||result.status!==0))throw Error('Owned mobile container command failed: '+(interrupted||result.error?.message||result.stderr));return result;
 };
 const inspect=async id=>JSON.parse((await docker(['inspect',id])).stdout)[0];
 const preserve=async(id,{directory,role})=>{
  const snapshot=await docker(['inspect',id],{allowFailure:true});if(snapshot.status===0)fs.writeFileSync(path.join(directory,role+'-partial-inspect.json'),snapshot.stdout);
  const logs=await docker(['logs',id],{allowFailure:true});fs.writeFileSync(path.join(directory,role+'-stdout.txt'),logs.stdout||'');fs.writeFileSync(path.join(directory,role+'-stderr.txt'),logs.stderr||'');
 };
 try{
  await docker(['pull',MOBILE_IMAGE],{timeout:180000});const image=JSON.parse((await docker(['image','inspect',MOBILE_IMAGE])).stdout)[0];assert.ok(image.RepoDigests.includes(MOBILE_IMAGE));assert.equal(image.Architecture,'amd64');assert.equal(image.Os,'linux');report.imageId=image.Id;write(path.join(output,'image.json'),image);report.imageInspectPath='image.json';report.imageInspectSha256=mobileDigest(fs.readFileSync(path.join(output,'image.json')));
  for(const [label,motion,control]of [['negative',null,true],[diagnosticMotion,diagnosticMotion,false]]){
   const directory=path.join(output,label);fs.mkdirSync(directory);let browserId,driverId;
   const create=async role=>{
    const name='chain-mobile-'+randomUUID(),metadata={directory,role,name};owned.set(name,metadata);persistOwnership();
    const id=(await docker(containerArgs({repo:root,output:directory,nodeBinary:fs.realpathSync(process.execPath),motion,control,...hostedPolicy,role,browserContainerId:browserId,containerName:name,ownershipToken:ownerToken,budgetProfile}))).stdout.trim();assert.match(id,/^[a-f0-9]{64}$/);owned.delete(name);owned.set(id,metadata);persistOwnership();return id;
   };
   browserId=await create('browser');const before=await inspect(browserId);verifyMobileContainerConfig(before,{role:'browser',budgetProfile});assert.equal(before.Image,image.Id);write(path.join(directory,'docker-before.json'),before);
   await docker(['start',browserId]);await awaitFile(path.join(directory,'ready.json'),{abort:()=>{if(interrupted)throw Error('Owned mobile run interrupted: '+interrupted);if(fs.existsSync(path.join(directory,'browser-server.json')))throw Error('Capped browser exited before ready: '+fs.readFileSync(path.join(directory,'browser-server.json'),'utf8'));}});
   const browserStarted=await inspect(browserId);assert.equal(browserStarted.State.Running,true);const browserHost={...processIdentity(browserStarted.State.Pid),containerId:browserId};
   driverId=await create('driver');const driverBefore=await inspect(driverId);verifyMobileContainerConfig(driverBefore,{role:'driver',browserContainerId:browserId,budgetProfile});assert.equal(driverBefore.Image,image.Id);write(path.join(directory,'driver-before.json'),driverBefore);
   await docker(['start',driverId]);const driverStarted=await inspect(driverId);assert.equal(driverStarted.State.Running,true);const driverHost={...processIdentity(driverStarted.State.Pid),containerId:driverId};assert.notEqual(browserHost.cgroup,driverHost.cgroup);assert.equal(browserHost.namespace,driverHost.namespace);const membership={pageSizeObservation:kernelPageObservation(),browser:browserHost,driver:driverHost};write(path.join(directory,'membership.json'),membership);
   const driverWait=await docker(['wait',driverId],{allowFailure:true,timeout:60000});if(interrupted)throw Error('Owned mobile run interrupted: '+interrupted);const browserWait=await docker(['wait',browserId],{allowFailure:true,timeout:15000});if(interrupted)throw Error('Owned mobile run interrupted: '+interrupted);
   for(const id of [browserId,driverId])await preserve(id,owned.get(id));
   const after=await inspect(browserId),driverAfter=await inspect(driverId);write(path.join(directory,'docker-after.json'),after);write(path.join(directory,'driver-after.json'),driverAfter);
   assert.equal(driverWait.error,undefined);assert.equal(browserWait.error,undefined);assert.equal(driverWait.status,0);assert.equal(browserWait.status,0);verifyMobileContainerExit(driverAfter.State);
   const result=json(path.join(directory,'inside.json')),server=json(path.join(directory,'browser-server.json'));assert.equal(result.status,'passed');
   let appOutcome='passed';
   if(!control&&budgetProfile==='stress-512mb')appOutcome=classifyMobileStressOutcome({before:server.before,after:server.after},json(path.join(directory,result.nativeReportPath)),server);
   if(appOutcome==='kernel-oom'){assert.equal(after.State.Running,false);assert.ok([0,1,137].includes(after.State.ExitCode));}else{verifyMobileContainerExit(after.State,{control});assert.equal(server.status,'passed');}
   if(!control)assert.equal(result.appOutcome,appOutcome);
   const raw=name=>({path:label+'/'+name,sha256:mobileDigest(fs.readFileSync(path.join(directory,name)))}),row={...result,appOutcome,containerId:browserId,image:MOBILE_IMAGE,dockerMemoryBytes:before.HostConfig.Memory,dockerMemorySwapBytes:before.HostConfig.MemorySwap,containerExitCode:after.State.ExitCode,containerOOMKilled:after.State.OOMKilled,server,membership,driver:{...result.driver,containerId:driverId,networkMode:driverBefore.HostConfig.NetworkMode,containerExitCode:driverAfter.State.ExitCode,containerOOMKilled:driverAfter.State.OOMKilled}};
   for(const [key,name]of [['inside','inside.json'],['browserServer','browser-server.json'],['membership','membership.json'],['dockerBefore','docker-before.json'],['dockerAfter','docker-after.json']]){const artifact=raw(name);row[key+'Path']=artifact.path;row[key+'Sha256']=artifact.sha256;}
   for(const [key,name]of [['dockerBefore','driver-before.json'],['dockerAfter','driver-after.json']]){const artifact=raw(name);row.driver[key+'Path']=artifact.path;row.driver[key+'Sha256']=artifact.sha256;}
   if(control)report.negativeControl=row;else{row.nativeReportPath=label+'/'+row.nativeReportPath;report.cases.push(row);}
   for(const id of [driverId,browserId]){await docker(['rm',id]);owned.delete(id);persistOwnership();}write(path.join(output,'report.json'),report);
  }
  report.cleanup.containersRemoved=true;report.status=report.cases.every(row=>row.appOutcome==='passed')?'passed':'failed';report.artifacts=mobileArtifactInventory(output);return report; // Diagnostic-only single motion: canonical verifier must reject kind and incomplete matrix.
 }catch(error){report.status='failed';report.errors.push(error.stack||String(error));throw error;}
 finally{
  cleaning=true;let removed=true;
  for(const [key,metadata]of [...owned].sort((a,b)=>a[1].role==='driver'?-1:b[1].role==='driver'?1:0)){
   let id=key;
   if(!/^[a-f0-9]{64}$/.test(id)){
    const recovered=await docker(['inspect',metadata.name],{allowFailure:true});
    // A killed/timed-out create CLI can leave daemon work in flight. An
    // early missing name is not proof that creation can no longer complete.
    // Keep the durable intent until positive owned removal is observed.
    if(recovered.status!==0){removed=false;continue;}
    const value=JSON.parse(recovered.stdout)[0];if(value.Config?.Labels?.['chain.mobile.owner']!==ownerToken){removed=false;continue;}id=value.Id;
   }
   await preserve(id,metadata);const result=await docker(['rm','--force',id],{allowFailure:true});if(result.error||result.status!==0)removed=false;else owned.delete(key);
  }
  if(interrupted){report.status='failed';report.interruptionSignal=interrupted;}persistOwnership();report.cleanup.containersRemoved=removed;report.artifacts=mobileArtifactInventory(output);write(path.join(output,'report.json'),report);
  for(const [signal,handler]of Object.entries(handlers))process.off(signal,handler);
 }
}
if(path.resolve(process.argv[1]||'')===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];try{
  const budgetProfile=args.includes('--profile')?value('--profile'):'required-1gb';mobileBudgetBytes(budgetProfile);
  if(args.includes('--browser-server'))await browserServer(path.resolve(value('--output-dir')),args.includes('--control'),args.includes('--profile')?value('--profile'):'required-1gb');
  else if(args.includes('--driver'))await driver(path.resolve(value('--output-dir')),value('--motion'),args.includes('--control'),args.includes('--profile')?value('--profile'):'required-1gb');
  else if(args.includes('--verify')){const file=path.resolve(value('--verify'));(args.includes('--profile')&&value('--profile')==='stress-512mb'?verifyMobileStressReport:verifyMobileMemoryReport)(JSON.parse(fs.readFileSync(file,'utf8')),{artifactRoot:path.dirname(file),...identity()});process.stdout.write('Capped mobile memory report verified.\n');}
  else if(args.includes('--run')){const report=await runCappedMobile({outputDir:value('--output-dir'),budgetProfile});process.stdout.write('Capped mobile '+budgetProfile+' outcome: '+report.status+'\nCapped mobile report: '+path.join(path.resolve(value('--output-dir')),'report.json')+'\n');}
  else throw Error('Choose --run, --browser-server, --driver or --verify');
 }catch(error){process.stderr.write(error.stack||String(error));process.exitCode=1;}
}
