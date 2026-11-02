import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {runOwnedNativeProcess,readNativeProcessTable,readLinuxNativeProcessTable,verifyHostedNativeCallerReceipts} from './hosted-native-callers.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const cwd=fileURLToPath(new URL('../..',import.meta.url));
const owner=new URL('./hosted-native-callers.mjs',import.meta.url).href;
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
async function until(predicate,ms=3000){const end=Date.now()+ms;while(Date.now()<end){if(predicate())return true;await delay(10);}return false;}

test('owned native process streams before its deadline and reaps a detached TERM-ignoring descendant',async t=>{
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-native-')),pidfile=path.join(outputDir,'fixture.json'),token='owned-'+path.basename(outputDir);
 const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)',token+'-foreign'],{stdio:'ignore'});
 const descendant=`process.on('SIGTERM',()=>{});console.log('descendant-ready');setInterval(()=>{},1000)`;
 const fixture=`import{spawn}from'node:child_process';import fs from'node:fs';const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)},${JSON.stringify(token)}],{detached:true,stdio:['ignore','pipe','inherit']});c.stdout.once('data',()=>{fs.writeFileSync(${JSON.stringify(pidfile)},JSON.stringify({root:process.pid,descendant:c.pid,token:${JSON.stringify(token)}}));console.error('pw:browser <launched> pid='+c.pid);console.log('# native-frontier '+JSON.stringify({root:'fixture',event:'ready'}));});setInterval(()=>{},1000);`;
 const script=`import{runOwnedNativeProcess}from${JSON.stringify(owner)};import fs from'node:fs';const r=await runOwnedNativeProcess(${JSON.stringify({cwd,outputDir,env:{...process.env,NODE_TEST_CONTEXT:undefined},executable:process.execPath,args:['--input-type=module','-e',fixture],timeoutMs:800})});fs.writeFileSync(${JSON.stringify(path.join(outputDir,'result.json'))},JSON.stringify(r));`;
 const runner=spawn(process.execPath,['--input-type=module','-e',script],{cwd,stdio:['ignore','pipe','pipe']});
 let runnerOutput='';runner.stderr.on('data',chunk=>runnerOutput+=chunk);runner.stdout.on('data',chunk=>runnerOutput+=chunk);
 const exited=new Promise(resolve=>runner.once('exit',(code,signal)=>resolve({code,signal})));
 let identities;
 t.after(async()=>{
  // Independent fixture finalizer never guesses a browser PID from its name.
  if(fs.existsSync(pidfile))identities=JSON.parse(fs.readFileSync(pidfile));
  for(const pid of [identities?.descendant,identities?.root,runner.pid,sentinel.pid])if(pid&&alive(pid))try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  await exited;await until(()=>!alive(sentinel.pid));
  t.diagnostic('Owned fixture identities and retained lifecycle evidence: '+outputDir+' '+JSON.stringify(identities));
 });
 assert.equal(await until(()=>fs.existsSync(pidfile)),true,'Real nested process became ready');identities=JSON.parse(fs.readFileSync(pidfile));
 const streamed=await until(()=>fs.existsSync(path.join(outputDir,'stdout.tap'))&&fs.readFileSync(path.join(outputDir,'stdout.tap'),'utf8').includes('native-frontier'),300);
 const observedWhileRunning=streamed&&alive(identities.root);
 const termination=await exited;assert.equal(termination.code,0,runnerOutput);
 const receipt=JSON.parse(fs.readFileSync(path.join(outputDir,'result.json')));
 assert.equal(observedWhileRunning,true,'Actual frontier bytes must be durable while the owned child is still running before its deadline');
 assert.equal(receipt.timedOut,true);assert.equal(receipt.cleanup.complete,true,'Deadline return requires independently witnessed detached descendant non-liveness');
 assert.equal(alive(identities.descendant),false,'Detached browser-like child must be gone before return');assert.equal(alive(sentinel.pid),true,'Unrelated sentinel stays alive');
 assert.ok(receipt.signals.some(row=>row.signal==='SIGKILL'&&row.pid===identities.descendant),'TERM-ignoring descendant requires recorded bounded KILL escalation');
});

test('owned native process retains real normal output and closes without teardown signals',async()=>{
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-normal-'));
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['-e',"console.log('normal-output');console.error('normal-stderr');setTimeout(()=>{},80)"],timeoutMs:1000});
 assert.equal(receipt.status,0);assert.equal(receipt.signal,null);assert.equal(receipt.cleanup.complete,true);assert.deepEqual(receipt.signals,[]);
 assert.equal(fs.readFileSync(receipt.files.stdout,'utf8'),'normal-output\n');assert.equal(fs.readFileSync(receipt.files.stderr,'utf8'),'normal-stderr\n');
 assert.ok(receipt.processes.every(row=>row.identity.startIdentity&&row.identity.pgid>0&&row.last.status==='nonlive'));
});

test('owned native process reconciles a witnessed executable-only terminal read after actual exit',async t=>{
 const retainedRoot=path.resolve(process.env.CHAIN_NATIVE_OUTPUT||os.tmpdir());fs.mkdirSync(retainedRoot,{recursive:true});
 const outputDir=fs.mkdtempSync(path.join(retainedRoot,'chain-owned-terminal-')),ready=path.join(outputDir,'ready'),exitRequest=path.join(outputDir,'exit');
 const before=new Set(readNativeProcessTable().map(row=>row.pid));let prior,partial;
 const visibility={policy:'delay-terminal-table-view-until-real-absence',reads:[],dropped:0};
 const signals=[];
 const readProcessTable=options=>{
  const rows=readNativeProcessTable(options),row=prior?rows.find(row=>row.pid===prior.pid):rows.find(row=>row.ppid===process.pid&&row.executable===process.execPath&&!before.has(row.pid));
  if(row){if(!prior)prior={...row};else if(!partial&&fs.existsSync(ready)){
   partial={...row,executable:null,enrichment:{status:'unavailable',errors:[{field:'executable',code:'ENOENT'}]}};
   rows[rows.indexOf(row)]=partial;
   // The fixture exits normally only after this actual identity observation.
   fs.writeFileSync(exitRequest,'exit');
  }else if(partial&&/^[ZX]/.test(row.state)){
   // This absence-only control delays the terminal table view. The saved raw
   // row remains literal; only a real later kernel ESRCH can prove absence.
   rows[rows.indexOf(row)]=partial;
  }}
  if(prior){const read={observed:{utc:new Date().toISOString(),monotonicMs:performance.now()},raw:row?structuredClone(row):null,view:rows.find(row=>row.pid===prior.pid)??null};if(visibility.reads.length<256)visibility.reads.push(read);else visibility.dropped++;}
  return rows;
 };
 const fixture=`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(exitRequest)})){clearInterval(timer);console.log('actual-normal-exit');}},5);`;
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['-e',fixture],timeoutMs:2000,system:{readProcessTable,signalProcess:(pid,signal)=>{signals.push({pid,signal});process.kill(pid,signal);}}});
 fs.writeFileSync(path.join(outputDir,'fixture-process-reads.json'),JSON.stringify(visibility,null,2)+'\n');
 t.diagnostic('Real terminal identity chronology and receipt: '+outputDir);
 if(process.env.CHAIN_NATIVE_OUTPUT)assert.equal(path.dirname(outputDir),path.resolve(process.env.CHAIN_NATIVE_OUTPUT),'The strict absence control retains its lifecycle receipt in collected native output before asserting');
 for(const file of ['process.json','frontier.jsonl','stdout.tap','stderr.txt'])assert.ok(fs.existsSync(path.join(outputDir,file)),'The strict absence control retains '+file+' before asserting');
 assert.ok(prior&&partial,'The actual child was fully witnessed before executable-only loss');
 for(const key of ['pid','ppid','startIdentity','startPrecision','uid','pidNamespace'])assert.equal(partial[key],prior[key],key+' remains exact through the partial read');
 assert.equal(receipt.status,0);assert.equal(receipt.exit.code,0);assert.equal(receipt.close.code,0);assert.equal(alive(prior.pid),false,'Independent kernel probe proves the actual witnessed child is gone');
 assert.ok(signals.some(row=>row.pid===prior.pid&&row.signal===0),'The consumer independently observed kernel absence');assert.equal(signals.some(row=>row.signal!==0),false,'Executable loss grants no teardown signal authority');
 assert.equal(receipt.processes.find(row=>row.identity.pid===prior.pid).last.status,'nonlive');
 assert.equal(receipt.cleanup.complete,true,'A previously witnessed exact child with only terminal executable loss and subsequent actual exit plus ESRCH must complete cleanup');
 assert.equal(receipt.incidents.length,1);const incident=receipt.incidents[0];
 assert.equal(incident.status,'resolved');assert.deepEqual(incident.observation,partial);assert.deepEqual(incident.priorIdentity,prior);assert.equal(incident.priorProof.kind,'actual-spawn-child');assert.equal(incident.resolution.proof.kind,'kernel-absence');assert.equal(incident.resolution.proof.result,'ESRCH');assert.ok(incident.observed.monotonicMs<=incident.resolution.observed.monotonicMs);
 assert.deepEqual(receipt.refusals,[]);
});

test('owned native process reconciles a witnessed descendant while retaining its actual browser close',async t=>{
 const retainedRoot=path.resolve(process.env.CHAIN_NATIVE_OUTPUT||os.tmpdir());fs.mkdirSync(retainedRoot,{recursive:true});
 const outputDir=fs.mkdtempSync(path.join(retainedRoot,'chain-owned-terminal-descendant-')),ready=path.join(outputDir,'ready'),exitRequest=path.join(outputDir,'exit'),reapRequest=path.join(outputDir,'reap');let prior,partial,rootPid,terminal;
 const before=new Set(readNativeProcessTable().map(row=>row.pid)),visibility={policy:'retain-actual-terminal-row-before-parent-reap',reads:[],dropped:0};
 const signals=[];
 const readProcessTable=options=>{
  const rows=readNativeProcessTable(options);rootPid??=rows.find(row=>row.ppid===process.pid&&row.executable===process.execPath&&!before.has(row.pid))?.pid;
  const row=prior?rows.find(row=>row.pid===prior.pid):rows.find(row=>row.ppid===rootPid&&row.executable===process.execPath);
  if(row){if(!prior)prior={...row};else if(!partial&&fs.existsSync(ready)){partial={...row,executable:null,enrichment:{status:'unavailable',errors:[{field:'executable',code:'ENOENT'}]}};rows[rows.indexOf(row)]=partial;fs.writeFileSync(exitRequest,'exit');}}
  if(row&&partial&&/^[ZX]/.test(row.state)&&!terminal){terminal={observed:{utc:new Date().toISOString(),monotonicMs:performance.now()},identity:structuredClone(row)};fs.writeFileSync(reapRequest,'reap');}
  if(prior){const read={observed:{utc:new Date().toISOString(),monotonicMs:performance.now()},raw:row?structuredClone(row):null,view:rows.find(row=>row.pid===prior.pid)??null};if(visibility.reads.length<256)visibility.reads.push(read);else visibility.dropped++;}
  return rows;
 };
 const child=`const fs=require('node:fs');console.log('ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(exitRequest)}))clearInterval(timer);},5);`;
 const fixture=`import{spawn}from'node:child_process';import fs from'node:fs';const c=spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,stdio:['ignore','pipe','inherit']});c.stdout.once('data',()=>{console.log('pw:browser <launched> pid='+c.pid);fs.writeFileSync(${JSON.stringify(ready)},'ready');const wait=new Int32Array(new SharedArrayBuffer(4)),until=performance.now()+1000;while(!fs.existsSync(${JSON.stringify(reapRequest)})&&performance.now()<until)Atomics.wait(wait,0,0,5);if(!fs.existsSync(${JSON.stringify(reapRequest)}))console.error('FIXTURE_REAP_GATE_EXPIRED');});c.once('close',(code,signal)=>console.log('pw:browser [pid='+c.pid+'] <process did exit: exitCode='+code+', signal='+signal+'>'));`;
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['--input-type=module','-e',fixture],timeoutMs:2000,system:{readProcessTable,signalProcess:(pid,signal)=>{signals.push({pid,signal});process.kill(pid,signal);}}});
 fs.writeFileSync(path.join(outputDir,'fixture-process-reads.json'),JSON.stringify({...visibility,terminal},null,2)+'\n');
 t.diagnostic('Real descendant terminal chronology and actual browser close: '+outputDir);
 if(process.env.CHAIN_NATIVE_OUTPUT)assert.equal(path.dirname(outputDir),path.resolve(process.env.CHAIN_NATIVE_OUTPUT),'The witnessed descendant control retains its lifecycle receipt in collected native output before asserting');
 for(const file of ['process.json','frontier.jsonl','stdout.tap','stderr.txt'])assert.ok(fs.existsSync(path.join(outputDir,file)),'The witnessed descendant control retains '+file+' before asserting');
 assert.ok(prior&&partial);assert.equal(receipt.status,0);assert.equal(receipt.exit.code,0);assert.equal(receipt.exit.signal,null);assert.equal(receipt.close.code,0);assert.equal(receipt.close.signal,null);assert.equal(alive(prior.pid),false);assert.equal(receipt.cleanup.complete,true);assert.deepEqual(receipt.refusals,[]);assert.equal(signals.some(row=>row.signal!==0),false);
 assert.ok(terminal,'The real fixture parent retained an actual kernel terminal row before reaping');assert.match(terminal.identity.state,/^[ZX]/);
 for(const key of ['pid','ppid','startIdentity','startPrecision','uid','pidNamespace']){assert.equal(partial[key],prior[key],key+' remains exact through executable-only loss');assert.equal(terminal.identity[key],prior[key],key+' remains exact in the literal terminal row');}
 assert.doesNotMatch(fs.readFileSync(receipt.files.stderr,'utf8'),/FIXTURE_REAP_GATE_EXPIRED/);
 const incident=receipt.incidents[0];assert.equal(incident.status,'resolved');assert.deepEqual(incident.observation,partial);assert.deepEqual(incident.priorIdentity,prior);assert.equal(incident.priorProof.kind,'observed-owned-ancestry');assert.equal(incident.priorProof.parentIdentity.pid,prior.ppid);assert.equal(incident.resolution.proof.kind,'kernel-terminal-state');assert.deepEqual(incident.resolution.proof.identity,terminal.identity);assert.ok(incident.observed.monotonicMs<incident.resolution.proof.monotonicMs);
 assert.equal(receipt.browserLaunches.length,1);const browser=receipt.browserLaunches[0];assert.equal(browser.pid,prior.pid);assert.equal(browser.status,'owned');assert.equal(browser.actualExit.owner,true);assert.equal(browser.actualExit.exitCode,0);assert.equal(browser.actualExit.signal,null);assert.equal(browser.finalState.status,'nonlive');assert.equal(receipt.browserExits.length,1);
});

test('owned native process binds live TAP stdout browser logs to actual detached child identities',async()=>{
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-stdout-browser-'));
 const child="console.log('ready');setTimeout(()=>{},250)";
 const script=`import{spawn}from'node:child_process';const child=spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,stdio:['ignore','pipe','inherit']});child.stdout.once('data',()=>{const prefix=Buffer.from('雪 ready\\n# actual pw:browser <launched> pid='+child.pid+'\\n');process.stdout.write(prefix.subarray(0,1));setTimeout(()=>process.stdout.write(prefix.subarray(1)),10);});child.once('close',(exitCode,signal)=>console.log('# actual pw:browser [pid='+child.pid+'] <process did exit: exitCode='+exitCode+', signal='+signal+'>'));`;
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['--input-type=module','-e',script],timeoutMs:2000});
 assert.equal(receipt.status,0);assert.equal(receipt.cleanup.complete,true);assert.equal(receipt.browserLaunches.length,1,'A real browser launch log forwarded live as TAP stdout must be OS-bound');
 const launch=receipt.browserLaunches[0],bytes=fs.readFileSync(receipt.files.stdout);assert.equal(launch.status,'owned');assert.equal(launch.stream,'stdout');assert.equal(launch.offset,bytes.indexOf(Buffer.from('# actual pw:browser <launched>')));assert.ok(launch.identity.startIdentity);assert.ok(launch.identity.pgid>0);assert.equal(launch.finalState.status,'nonlive');assert.equal(launch.actualExit.owner,true);assert.equal(launch.actualExit.exitCode,0);assert.equal(launch.actualExit.signal,null);
 const rows=fs.readFileSync(receipt.files.frontier,'utf8').trim().split('\n').map(JSON.parse);assert.ok(rows.some(row=>row.kind==='line'&&row.line==='雪 ready'),'UTF8 split across actual chunks is retained without replacement in the frontier');
});

test('owned native process charges slow identity setup to the original child deadline',async()=>{
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-absolute-deadline-'));let reads=0,setupReturnedAt;
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['-e','setInterval(()=>{},1000)'],timeoutMs:300,system:{readProcessTable:()=>{const rows=readNativeProcessTable();if(++reads===2){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,400);setupReturnedAt=performance.now();}return rows;}}});
 const deadline=fs.readFileSync(receipt.files.frontier,'utf8').trim().split('\n').map(JSON.parse).find(row=>row.kind==='deadline');
 assert.equal(receipt.timedOut,true);assert.equal(receipt.cleanup.complete,true);assert.ok(deadline.monotonicMs-setupReturnedAt<300,'Slow pre-monitor identity setup must not start another full execution budget after it returns');
});

function linuxProcDouble({foreign=false,enrichmentLost=false}={}){
 const uid=process.getuid(),pid='41001',fields=Array.from({length:30},()=> '0');Object.assign(fields,{0:'S',1:'123',2:'41001',3:'41001',19:'987654'});
 const filesystem={readdirSync:()=>[pid],readFileSync:file=>file.endsWith('/stat')?pid+' (controlled) '+fields.join(' '):'Uid:\t'+(foreign?uid+1:uid)+'\t'+(foreign?uid+1:uid)+'\n',readlinkSync:file=>{if(foreign||enrichmentLost&&file.endsWith('/exe'))throw Object.assign(Error('controlled proc boundary'),{code:foreign?'EACCES':'ENOENT'});return file.endsWith('/exe')?'/owned/runtime/node':'pid:[41001]';}};
 return{filesystem,procRoot:'/controlled/proc'};
}

function withSameUidNoise(filesystem){
 const names=['1008','1865','952'],commands=['systemd','sudo','sd-pam'];let noiseStatReads=0;
 const noisePid=file=>/^\/controlled\/proc\/(\d+)\//.exec(file)?.[1];
 return{noiseStatReads:()=>noiseStatReads,filesystem:{
  readdirSync:root=>[...names,...filesystem.readdirSync(root)],
  readFileSync:(file,...args)=>{
   const pid=noisePid(file),index=names.indexOf(pid);if(index<0)return filesystem.readFileSync(file,...args);
   if(file.endsWith('/status'))return 'Uid:\t'+process.getuid()+'\n';
   assert.ok(file.endsWith('/stat'));noiseStatReads++;const fields=Array.from({length:30},()=> '0');Object.assign(fields,{0:'S',1:'1',2:pid,3:pid,19:String(100000+index)});return pid+' ('+commands[index]+') '+fields.join(' ');
  },
  readlinkSync:file=>{if(names.includes(noisePid(file)))throw Object.assign(Error('unrelated same-UID protected link'),{code:'EACCES'});return filesystem.readlinkSync(file);}
 }};
}

test('Linux proc reader ignores inaccessible foreign enrichment without losing owned scans',()=>{
 let rows;assert.doesNotThrow(()=>{rows=readLinuxNativeProcessTable(linuxProcDouble({foreign:true}));},'A protected foreign process must not fail the owned scan');assert.deepEqual(rows,[],'A different UID is excluded before protected exe/namespace enrichment');
});

test('Linux proc reader preserves valid owned stat identity when enrichment disappears',()=>{
 const rows=readLinuxNativeProcessTable(linuxProcDouble({enrichmentLost:true}));
 assert.equal(rows.length,1,'A valid live stat must not disappear because one later enrichment link vanished');assert.equal(rows[0].state,'S');assert.equal(rows[0].startIdentity,'987654');assert.equal(rows[0].enrichment.status,'unavailable');assert.equal(rows[0].enrichment.errors[0].field,'executable');
});

test('Linux partial read diagnostics retain literal ordered kernel observations',()=>{
 const uid=process.getuid(),fields=Array.from({length:30},()=> '0');Object.assign(fields,{0:'R',1:'123',2:'41001',3:'41001',19:'987654'});
 const before='41001 (literal-read) '+fields.join(' '),after=before.replace(') R ',') Z ');let statReads=0;
 const filesystem={readdirSync:()=>['41001'],readFileSync:file=>file.endsWith('/stat')?(++statReads===1?before:after):'Uid:\t'+uid+'\t'+uid+'\n',readlinkSync:file=>{if(file.endsWith('/exe'))throw Object.assign(Error('literal executable read vanished'),{code:'ENOENT'});return 'pid:[41001]';}};
 const diagnostics={},rows=readLinuxNativeProcessTable({procRoot:'/controlled/proc',filesystem,diagnostics});
 assert.equal(rows.length,1);assert.equal(rows[0].state,'R');assert.equal(rows[0].startIdentity,'987654');assert.equal(rows[0].executable,null);assert.equal(rows[0].enrichment.errors[0].code,'ENOENT');
 assert.equal(diagnostics.windows?.length,1,'The existing Linux reader retains the ordered raw partial read rather than losing the first-observation evidence');
 const window=diagnostics.windows[0];assert.equal(window.tableReadId,1);assert.equal(window.rowOrdinal,0);assert.equal(window.pid,41001);
 assert.equal(Buffer.from(window.statBefore.rawBase64,'base64').toString(),before);assert.equal(Buffer.from(window.statAfter.rawBase64,'base64').toString(),after);
 assert.equal(window.statBefore.identity.state,'R');assert.equal(window.statAfter.identity.state,'Z');assert.equal(window.statAfter.identity.startIdentity,'987654');assert.equal(window.statAfter.identity.startPrecision,'kernel-clock-ticks');
 assert.equal(window.uid.value,uid);assert.equal(window.executable.error.code,'ENOENT');assert.equal(window.pidNamespace.value,'pid:[41001]');assert.equal(statReads,2,'One diagnostic after-stat read is the only additional kernel read');
 const reads=[window.statBefore,window.uid,window.executable,window.pidNamespace,window.statAfter];
 assert.ok(window.directoryListed.monotonicMs<=reads[0].started.monotonicMs);for(let index=0;index<reads.length;index++){assert.ok(reads[index].started.monotonicMs<=reads[index].finished.monotonicMs);if(index)assert.ok(reads[index-1].finished.monotonicMs<=reads[index].started.monotonicMs);}
 assert.equal(diagnostics.retainedBytes,Buffer.byteLength(JSON.stringify(diagnostics.windows)));assert.ok(diagnostics.retainedBytes<=65536);
 const scopedDiagnostics={};let tableReadId=0,scopedRows;
 const noisy=withSameUidNoise({...filesystem,readdirSync:()=>tableReadId===4?['41001']:[]});
 for(tableReadId=1;tableReadId<=4;tableReadId++){statReads=0;scopedRows=readLinuxNativeProcessTable({procRoot:'/controlled/proc',filesystem:noisy.filesystem,diagnostics:scopedDiagnostics,readContext:{id:tableReadId,started:{utc:new Date().toISOString(),monotonicMs:performance.now()},diagnosticPids:[123]}});}
 const evidenceDir=fs.mkdtempSync(path.join(process.env.CHAIN_NATIVE_OUTPUT||os.tmpdir(),'chain-scoped-read-literal-'));fs.writeFileSync(path.join(evidenceDir,'reads.json'),JSON.stringify({scopedDiagnostics,scopedRows,noiseStatReads:noisy.noiseStatReads()},null,2)+'\n');
 const scopedWindow=scopedDiagnostics.windows.find(row=>row.tableReadId===4&&row.pid===41001);
 assert.ok(scopedWindow,'A relevant direct-child partial read retains its exact tableReadId + PID window after repeated unrelated same-UID EACCES rows');
 assert.deepEqual(scopedRows.map(row=>row.pid),[1008,1865,952,41001],'Evidence filtering preserves every same-UID process row');assert.equal(scopedRows[3].state,'R');assert.equal(scopedRows[3].executable,null);
 assert.equal(scopedDiagnostics.windows.length,1);assert.equal(scopedDiagnostics.filteredWindows,12);assert.equal(scopedDiagnostics.omittedWindows,0);assert.equal(noisy.noiseStatReads(),12,'Filtered rows receive no additional diagnostic after-stat syscall');
 assert.equal(Buffer.from(scopedWindow.statBefore.rawBase64,'base64').toString(),before);assert.equal(Buffer.from(scopedWindow.statAfter.rawBase64,'base64').toString(),after);assert.equal(scopedWindow.uid.value,uid);assert.equal(scopedWindow.executable.error.code,'ENOENT');assert.equal(scopedWindow.pidNamespace.value,'pid:[41001]');
 const scopedReads=[scopedWindow.statBefore,scopedWindow.uid,scopedWindow.executable,scopedWindow.pidNamespace,scopedWindow.statAfter];for(let index=0;index<scopedReads.length;index++){assert.ok(scopedReads[index].started.monotonicMs<=scopedReads[index].finished.monotonicMs);if(index)assert.ok(scopedReads[index-1].finished.monotonicMs<=scopedReads[index].started.monotonicMs);}
});

test('Linux partial read diagnostics keep invocation and raw payload bounds explicit',()=>{
 const full=linuxProcDouble(),fullDiagnostics={};let fullStatReads=0;const fullRead=full.filesystem.readFileSync;full.filesystem.readFileSync=file=>{if(file.endsWith('/stat'))fullStatReads++;return fullRead(file);};
 const fullRows=readLinuxNativeProcessTable({...full,diagnostics:fullDiagnostics});assert.equal(fullRows[0].executable,'/owned/runtime/node');assert.equal(fullRows[0].enrichment.status,'complete');assert.equal(fullStatReads,1);assert.deepEqual(fullDiagnostics.windows,[],'A complete first observation gains no extra diagnostic kernel read');
 const diagnostics={},partial=linuxProcDouble({enrichmentLost:true});let statReads=0;const read=partial.filesystem.readFileSync;partial.filesystem.readFileSync=file=>{if(file.endsWith('/stat'))statReads++;return read(file);};
 for(let index=0;index<10;index++)readLinuxNativeProcessTable({...partial,diagnostics});
 assert.equal(diagnostics.windows.length,8);assert.equal(diagnostics.omittedWindows,2);assert.equal(statReads,18,'Only the first eight partial windows get one additional read across repeated table invocations');assert.equal(diagnostics.tableReads,10);assert.equal(diagnostics.status,'truncated');assert.equal(diagnostics.retainedBytes,Buffer.byteLength(JSON.stringify(diagnostics.windows)));assert.ok(diagnostics.retainedBytes<=65536);assert.ok(diagnostics.windows.every(window=>Buffer.byteLength(JSON.stringify(window))<=8192));
 const large=linuxProcDouble({enrichmentLost:true}),largeRead=large.filesystem.readFileSync,largeLink=large.filesystem.readlinkSync;large.filesystem.readFileSync=file=>file.endsWith('/stat')?largeRead(file).replace('(controlled)','('+'x'.repeat(5000)+')'):largeRead(file);large.filesystem.readlinkSync=file=>file.endsWith('/ns/pid')?'n'.repeat(2000):largeLink(file);
 const largeDiagnostics={},largeRows=readLinuxNativeProcessTable({...large,diagnostics:largeDiagnostics}),largeWindow=largeDiagnostics.windows[0];assert.equal(largeRows[0].pidNamespace,'n'.repeat(2000),'Diagnostic byte bounds leave the actual returned row unchanged');assert.equal(largeWindow.statBefore.truncated,true);assert.ok(Buffer.from(largeWindow.statBefore.rawBase64||'','base64').length<=2048);assert.equal(largeWindow.statBefore.sha256,createHash('sha256').update(large.filesystem.readFileSync('/controlled/proc/41001/stat')).digest('hex'));assert.equal(largeWindow.pidNamespace.truncated,true);assert.equal(largeWindow.pidNamespace.value,null);assert.ok(Buffer.from(largeWindow.pidNamespace.prefixBase64||'','base64').length<=1024);assert.ok(Buffer.byteLength(JSON.stringify(largeWindow))<=8192);assert.equal(largeDiagnostics.status,'truncated');
 const afterFailure=linuxProcDouble({enrichmentLost:true}),beforeRead=afterFailure.filesystem.readFileSync;let reads=0;afterFailure.filesystem.readFileSync=file=>{if(file.endsWith('/stat')&&++reads===2)throw Object.assign(Error('literal after-stat failure'),{code:'EIO'});return beforeRead(file);};const failedDiagnostics={},failedRows=readLinuxNativeProcessTable({...afterFailure,diagnostics:failedDiagnostics});assert.equal(failedRows[0].state,'S');assert.equal(failedDiagnostics.windows[0].statAfter.status,'unavailable');assert.equal(failedDiagnostics.windows[0].statAfter.error.code,'EIO');
 const oversized=linuxProcDouble({enrichmentLost:true}),oversizedRead=oversized.filesystem.readFileSync;oversized.filesystem.readFileSync=file=>file.endsWith('/stat')?oversizedRead(file).replace('987654','9'.repeat(10000)):oversizedRead(file);const oversizedDiagnostics={},oversizedRows=readLinuxNativeProcessTable({...oversized,diagnostics:oversizedDiagnostics});assert.equal(oversizedRows[0].startIdentity,'9'.repeat(10000));assert.equal(oversizedDiagnostics.windows[0].status,'unavailable');assert.equal(oversizedDiagnostics.windows[0].reason,'window-byte-cap');assert.equal(oversizedDiagnostics.status,'truncated','A window replaced by bounded unavailable evidence cannot claim complete diagnostics');assert.ok(oversizedDiagnostics.retainedBytes<=65536);
});

test('owned partial read diagnostics survive the receipt without granting unknown custody',async t=>{
 const retainedRoot=path.resolve(process.env.CHAIN_NATIVE_OUTPUT||os.tmpdir());fs.mkdirSync(retainedRoot,{recursive:true});const outputDir=fs.mkdtempSync(path.join(retainedRoot,'chain-owned-read-diagnostic-'));
 const before=new Set(readNativeProcessTable().map(row=>row.pid)),unknownPid=2147483000,signals=[];let actualRoot;
 const readProcessTable=(options={})=>{
  const rows=readNativeProcessTable();actualRoot??=rows.find(row=>row.ppid===process.pid&&row.executable===process.execPath&&!before.has(row.pid));
  let filesystem={readdirSync:()=>[]};if(actualRoot&&rows.some(row=>row.pid===actualRoot.pid)){
   const fields=Array.from({length:30},()=> '0');Object.assign(fields,{0:'R',1:String(actualRoot.pid),2:String(unknownPid),3:String(unknownPid),19:'987654'});const raw=unknownPid+' (literal-unknown) '+fields.join(' ');let statReads=0;
   filesystem={readdirSync:()=>[String(unknownPid)],readFileSync:file=>file.endsWith('/stat')?(++statReads===1?raw:raw.replace(') R ',') Z ')):'Uid:\t'+process.getuid()+'\n',readlinkSync:file=>{if(file.endsWith('/exe'))throw Object.assign(Error('literal unknown executable'),{code:'ENOENT'});return 'pid:[41001]';}};
  }
  rows.push(...readLinuxNativeProcessTable({procRoot:'/controlled/proc',filesystem:withSameUidNoise(filesystem).filesystem,...options}));
  return rows;
 };
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['-e',"console.log('actual-root-output');setTimeout(()=>{},100)"],timeoutMs:2000,system:{readProcessTable,signalProcess:(pid,signal)=>{signals.push({pid,signal});process.kill(pid,signal);}}});
 t.diagnostic('Bounded controlled Linux read evidence and actual root receipt: '+outputDir);
 assert.ok(receipt.processReadDiagnostics?.windows.length>0,'The existing owned-process receipt retains its bounded literal first-observation read evidence');
 const saved=JSON.parse(fs.readFileSync(path.join(outputDir,'process.json')));assert.deepEqual(saved.processReadDiagnostics,receipt.processReadDiagnostics);assert.ok(receipt.processReadDiagnostics.windows.length<=8);assert.ok(receipt.processReadDiagnostics.retainedBytes<=65536);
 const incident=receipt.incidents.find(row=>row.observation.pid===unknownPid);assert.ok(incident);assert.equal(incident.status,'active');assert.equal(incident.priorIdentity,null);assert.equal(incident.priorProof,null);assert.equal(incident.priorReadId,null);assert.equal(incident.eligible,false);assert.equal(incident.observation.state,'R');assert.equal(receipt.cleanup.complete,false);assert.equal(receipt.status,0);assert.equal(receipt.close.code,0);assert.equal(signals.some(row=>row.pid===unknownPid),false,'A diagnostic terminal after-read grants an unknown no signal or zero-probe authority');assert.equal(receipt.processes.some(row=>row.identity.pid===unknownPid),false);
 const window=receipt.processReadDiagnostics.windows.find(row=>row.tableReadId===incident.observationReadId&&row.pid===unknownPid);assert.ok(window,'The actual unknown incident retains its tableReadId + PID window despite the unrelated same-UID prefix');assert.equal(window.statBefore.identity.state,'R');assert.equal(window.statAfter.identity.state,'Z');assert.equal(receipt.processReadDiagnostics.spawn.pid,actualRoot.pid);assert.ok(receipt.processReadDiagnostics.spawn.initialReadId>0);
 assert.equal(receipt.processReadDiagnostics.filteredWindows,receipt.processReadDiagnostics.tableReads*3);assert.ok(receipt.processes.every(row=>row.last.status==='nonlive'),'Known children really exit while unknown custody stays refused');
 for(const change of ['missing-core','pidNamespace','uid','startIdentity']){
  const traceDir=fs.mkdtempSync(path.join(retainedRoot,'chain-owned-read-core-')),initialPids=new Set(readNativeProcessTable().map(row=>row.pid)),trace=[],traceSignals=[];let actual,phase=0;
  const readTrace=options=>{
   const rows=readNativeProcessTable();actual??=rows.find(row=>row.ppid===process.pid&&row.executable===process.execPath&&!initialPids.has(row.pid));const present=actual&&rows.some(row=>row.pid===actual.pid),currentPhase=phase;
   const fields=Array.from({length:30},()=> '0');Object.assign(fields,{0:change==='missing-core'&&currentPhase>0?'Z':'S',1:String(process.pid),2:String(actual?.pid||0),3:String(actual?.pid||0),19:change==='startIdentity'&&currentPhase>0?'987655':'987654'});
   const raw=(actual?.pid||0)+' (literal-owned-core) '+fields.join(' '),lostCore=change==='missing-core'&&currentPhase>=2,partial=lostCore||change!=='missing-core'&&currentPhase>0;
   const missing=()=>{throw Object.assign(Error('controlled enrichment vanished'),{code:'ENOENT'});};
   const filesystem={readdirSync:()=>present?[String(actual.pid)]:[],readFileSync:file=>file.endsWith('/stat')?raw:lostCore?missing():'Uid:\t'+process.getuid()+'\n',readlinkSync:file=>partial&&file.endsWith('/exe')||lostCore?missing():file.endsWith('/exe')?process.execPath:change==='pidNamespace'&&currentPhase>0?'pid:[changed]':'pid:[41001]'};
   const literal=readLinuxNativeProcessTable({procRoot:'/controlled/proc',filesystem:withSameUidNoise(filesystem).filesystem,...options}),projected=literal.find(row=>row.pid===actual?.pid);
   // Linux's foreign-UID exclusion remains intact. This OS-seam control changes
   // only the returned observed UID; the literal raw UID remains separately saved.
   if(projected&&change==='uid'&&currentPhase>0)projected.uid=process.getuid()+1;
   trace.push({tableReadId:options.readContext.id,phase:currentPhase,actualIdentity:present?{...actual}:null,literalStat:present?raw:null,observation:projected?structuredClone(projected):null});if(present)phase++;
   return rows.filter(row=>row.pid!==actual?.pid).concat(literal);
  };
  const result=await runOwnedNativeProcess({cwd,outputDir:traceDir,args:['-e','setTimeout(()=>{},140)'],timeoutMs:2000,system:{readProcessTable:readTrace,signalProcess:(pid,signal)=>{traceSignals.push({pid,signal});process.kill(pid,signal);}}});
  fs.writeFileSync(path.join(traceDir,'fixture-reads.json'),JSON.stringify({change,trace,traceSignals},null,2)+'\n');t.diagnostic('Diagnostic-only '+change+' trace and actual child close: '+traceDir);
  const witnessed=result.processes.find(row=>row.identity.pid===actual.pid),changed=trace.find(row=>row.phase===(change==='missing-core'?2:1)&&row.observation),rawWindow=result.processReadDiagnostics.windows.find(row=>row.tableReadId===changed.tableReadId&&row.pid===actual.pid);
  assert.ok(rawWindow,'The relevant known PID raw window survives unrelated prefix rows');assert.ok(witnessed.terminalResolutionBlocked);assert.equal(result.cleanup.complete,false);assert.ok(result.refusals.some(row=>row.includes('identity changed')));assert.equal(result.status,0);assert.equal(result.close.code,0);assert.equal(alive(actual.pid),false);assert.equal(traceSignals.some(row=>row.signal!==0),false,'Diagnostics never restore teardown signal authority');assert.ok(result.processes.every(row=>row.last.status==='nonlive'));
  if(change==='missing-core'){
   assert.equal(witnessed.nonliveProof.kind,'kernel-terminal-state');assert.equal(witnessed.nonliveProof.identity.state,'Z');assert.equal(witnessed.nonliveProof.identity.uid,process.getuid());assert.equal(witnessed.nonliveProof.identity.pidNamespace,'pid:[41001]');assert.equal(rawWindow.statBefore.identity.state,'Z');assert.equal(rawWindow.statAfter.identity.state,'Z');assert.equal(rawWindow.statBefore.identity.startIdentity,'987654');for(const key of ['uid','executable','pidNamespace'])assert.equal(rawWindow[key].error.code,'ENOENT');
  }else{
   assert.notEqual(changed.observation[change],witnessed.identity[change]);assert.notEqual(changed.observation[change],null);assert.equal(result.incidents[0].status,'active');assert.equal(result.incidents[0].eligible,false);assert.ok(result.incidents[0].blocked);assert.ok(trace.some(row=>row.phase>1&&row.observation===null),'A later real absence does not erase an observed changed core');
  }
 }
});

test('owned native process stops on the combined stream cap and retains the accepted prefix',async()=>{
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-cap-'));
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['-e',"setTimeout(()=>{process.stdout.write('a'.repeat(600));process.stderr.write('b'.repeat(600));},40);setInterval(()=>{},1000)"],timeoutMs:1000,outputLimitBytes:1024});
 assert.equal(receipt.outputLimit,true);assert.equal(receipt.bytes,1024);assert.equal(receipt.cleanup.complete,true);assert.equal(receipt.stopReason,'output-limit');
 assert.equal(fs.statSync(receipt.files.stdout).size+fs.statSync(receipt.files.stderr).size,1024);
 const events=fs.readFileSync(receipt.files.frontier,'utf8').trim().split('\n').map(JSON.parse);assert.ok(events.some(row=>row.kind==='output-limit'));assert.ok(events.some(row=>row.kind==='partial-line'));
});

test('owned native process refuses forged browser PID ownership and preserves a real foreign sentinel',async t=>{
 const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});t.after(()=>sentinel.kill('SIGKILL'));
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-forged-'));
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['-e',"console.error('pw:browser <launched> pid="+sentinel.pid+"');setTimeout(()=>{},80)"],timeoutMs:1000});
 assert.equal(receipt.status,0);assert.equal(receipt.cleanup.complete,false);assert.equal(receipt.browserLaunches[0].status,'unavailable');assert.ok(receipt.refusals.some(row=>row.includes('owned OS ancestry')));
 assert.equal(receipt.signals.some(row=>row.pid===sentinel.pid),false);assert.equal(alive(sentinel.pid),true);
});

test('owned native process refuses a changed start identity before signaling',async t=>{
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-reuse-'));let rootPid=null,reads=0;const signals=[];
 const priorPids=new Set(readNativeProcessTable().map(row=>row.pid));
 const readProcessTable=()=>{const rows=readNativeProcessTable();reads++;for(const row of rows)if(row.ppid===process.pid&&row.executable===process.execPath&&!priorPids.has(row.pid)){rootPid??=row.pid;if(row.pid===rootPid&&reads>5)row.startIdentity+='-reused';}return rows;};
 t.after(()=>{if(rootPid&&alive(rootPid))process.kill(rootPid,'SIGKILL');});
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['-e','setInterval(()=>{},1000)'],timeoutMs:180,system:{readProcessTable,signalProcess:(pid,signal)=>signals.push({pid,signal})}});
 assert.equal(receipt.runtime.systemBoundary,'controlled-test-only');assert.equal(receipt.cleanup.complete,false);assert.equal(receipt.timedOut,true);
 assert.ok(receipt.refusals.some(row=>row.includes('identity changed')||row.includes('changed identity')));assert.deepEqual(signals,[],'A reused PID must never receive a signal');
 assert.equal(alive(rootPid),true,'The independently owned finalizer, not a refused identity, closes the real fixture');
});

test('owned native process refuses ambiguous enrichment of a still-live owned identity',async t=>{
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-enrichment-'));let rootIdentity,reads=0;const signals=[];
 const initialPids=new Set(readNativeProcessTable().map(row=>row.pid));
 const readProcessTable=()=>{const rows=readNativeProcessTable();reads++;for(const row of rows)if(row.ppid===process.pid&&row.executable===process.execPath&&!initialPids.has(row.pid)){rootIdentity??={...row};if(reads>5)row.enrichment={status:'unavailable',errors:[{field:'executable',code:'ENOENT'}]};}return rows;};
 t.after(async()=>{if(rootIdentity){const current=readNativeProcessTable().find(row=>row.pid===rootIdentity.pid);if(current?.startIdentity===rootIdentity.startIdentity){process.kill(rootIdentity.pid,'SIGKILL');await until(()=>!alive(rootIdentity.pid));}}});
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['-e','setInterval(()=>{},1000)'],timeoutMs:180,system:{readProcessTable,signalProcess:(pid,signal)=>signals.push({pid,signal})}});
 assert.equal(receipt.cleanup.complete,false);assert.ok(receipt.refusals.some(row=>row.includes('enrichment unavailable')));assert.equal(receipt.processes.find(row=>row.identity.pid===rootIdentity.pid).last.status,'identity-unavailable');assert.deepEqual(signals,[]);assert.equal(alive(rootIdentity.pid),true,'Missing enrichment cannot be converted to OS non-liveness or authorize a signal');
});

test('owned native process retains an unknown partial descendant even after all witnessed processes exit',async t=>{
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-unknown-')),ready=path.join(outputDir,'ready'),exitRequest=path.join(outputDir,'exit');let actual,partial,rootPid;
 const signals=[];
 const child=`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(exitRequest)}))clearInterval(timer);},5);`;
 const fixture=`import{spawn}from'node:child_process';const c=spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,stdio:'ignore'});c.once('close',()=>console.log('actual-descendant-close'));`;
 const readProcessTable=()=>{
  const rows=readNativeProcessTable();rootPid??=rows.find(row=>row.ppid===process.pid&&row.executable===process.execPath)?.pid;
  for(const row of rows)if(row.ppid===rootPid&&row.executable===process.execPath){
   actual??={...row};const rejected={...row,executable:null,enrichment:{status:'unavailable',errors:[{field:'executable',code:'ENOENT'}]}};partial??=rejected;rows[rows.indexOf(row)]=rejected;
   if(fs.existsSync(ready))fs.writeFileSync(exitRequest,'exit');
  }
  return rows;
 };
 t.after(async()=>{if(actual){const row=readNativeProcessTable().find(row=>row.pid===actual.pid);if(row&&['startIdentity','startPrecision','uid','pidNamespace'].every(key=>row[key]===actual[key])&&alive(actual.pid)){process.kill(actual.pid,'SIGKILL');await until(()=>!alive(actual.pid));}}});

 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['--input-type=module','-e',fixture],timeoutMs:2000,system:{readProcessTable,signalProcess:(pid,signal)=>{signals.push({pid,signal});process.kill(pid,signal);}}});
 t.diagnostic('Unknown descendant actual OS row and provisional receipt: '+outputDir);
 assert.ok(actual&&partial);assert.equal(receipt.status,0);assert.equal(alive(actual.pid),false);assert.ok(receipt.processes.every(row=>row.last.status==='nonlive'),'All independently witnessed identities really ended');
 assert.equal(receipt.cleanup.complete,false,'An unowned partial row cannot be waived by all known processes exiting');assert.equal(receipt.processes.some(row=>row.identity.pid===actual.pid),false,'Rejected provisional identity never becomes owned');assert.equal(signals.some(row=>row.pid===actual.pid),false,'Unknown descendant never receives even an ownership probe');
 const incident=receipt.incidents.find(row=>row.observation.pid===actual.pid);assert.ok(incident);assert.equal(incident.kind,'unwitnessed-descendant');assert.equal(incident.status,'active');assert.equal(incident.eligible,false);assert.equal(incident.priorIdentity,null);assert.equal(incident.priorProof,null);assert.deepEqual(incident.observation,partial);assert.equal(incident.parentWitness.identity.pid,actual.ppid);assert.equal(incident.parentWitness.proof.kind,'actual-spawn-child');assert.ok(receipt.refusals.includes(incident.message));assert.ok(incident.observed.utc);assert.ok(incident.observations.length<=8);
});

test('owned native process never signals a live row whose executable field is absent',async t=>{
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-missing-executable-')),ready=path.join(outputDir,'ready'),before=new Set(readNativeProcessTable().map(row=>row.pid));let prior,partial;
 const signals=[];
 const readProcessTable=()=>{
  const rows=readNativeProcessTable(),row=rows.find(row=>row.ppid===process.pid&&row.executable===process.execPath&&!before.has(row.pid));
  if(row){if(!prior)prior={...row};else if(fs.existsSync(ready)){partial={...row,executable:null,enrichment:{status:'complete',errors:[]}};rows[rows.indexOf(row)]=partial;}}return rows;
 };
 const fixture=`require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setTimeout(()=>{},400);`;
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['-e',fixture],timeoutMs:180,system:{readProcessTable,signalProcess:(pid,signal)=>{if(signal===0)process.kill(pid,0);else signals.push({pid,signal});}}});
 t.diagnostic('Actual missing-executable field guard: '+outputDir);
 assert.ok(prior&&partial);assert.equal(receipt.timedOut,true);assert.equal(receipt.status,0);assert.equal(alive(prior.pid),false);assert.deepEqual(signals,[],'A missing executable field cannot authorize a signal even if enrichment incorrectly reports complete');assert.equal(receipt.cleanup.complete,false);assert.equal(receipt.incidents[0].status,'active');assert.equal(receipt.incidents[0].eligible,false);
});

test('owned native process never resumes signal authority after an intervening identity ambiguity',async t=>{
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-core-return-')),ready=path.join(outputDir,'ready'),before=new Set(readNativeProcessTable().map(row=>row.pid));let prior,changed=false,restored=false;
 const signals=[];
 const readProcessTable=()=>{
  const rows=readNativeProcessTable(),row=rows.find(row=>row.ppid===process.pid&&row.executable===process.execPath&&!before.has(row.pid));
  if(row){if(!prior)prior={...row};else if(fs.existsSync(ready)){if(!changed){rows[rows.indexOf(row)]={...row,startIdentity:row.startIdentity+'-ambiguous'};changed=true;}else restored=true;}}return rows;
 };
 const fixture=`require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setTimeout(()=>{},400);`;
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['-e',fixture],timeoutMs:180,system:{readProcessTable,signalProcess:(pid,signal)=>{if(signal===0)process.kill(pid,0);else signals.push({pid,signal});}}});
 t.diagnostic('Actual intervening core ambiguity and subsequent full OS row: '+outputDir);
 assert.ok(prior&&changed&&restored);assert.equal(receipt.timedOut,true);assert.equal(receipt.status,0);assert.equal(alive(prior.pid),false);assert.deepEqual(signals,[],'A later matching row cannot erase the unresolved ambiguity and regain signal authority');assert.equal(receipt.cleanup.complete,false);assert.ok(receipt.refusals.some(row=>row.includes('identity changed')));assert.ok(receipt.processes[0].terminalResolutionBlocked);
});

test('owned native process keeps terminal incidents unresolved after an intervening core ambiguity',async t=>{
 for(const field of ['startIdentity','startPrecision','uid','pidNamespace'])await t.test(field,async()=>{
  const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-terminal-core-')),ready=path.join(outputDir,'ready'),exitRequest=path.join(outputDir,'exit'),before=new Set(readNativeProcessTable().map(row=>row.pid));let prior,phase=0;
  const signals=[];
  const readProcessTable=()=>{
   const rows=readNativeProcessTable(),row=rows.find(row=>row.ppid===process.pid&&row.executable===process.execPath&&!before.has(row.pid));
   if(row){if(!prior)prior={...row};else if(fs.existsSync(ready)&&phase<2){
    const partial={...row,executable:null,enrichment:{status:'unavailable',errors:[{field:'executable',code:'ENOENT'}]}};
    if(phase++===1){partial[field]=field==='startIdentity'?row[field]+'-reused':null;partial.enrichment.errors.push({field,code:'ENOENT'});fs.writeFileSync(exitRequest,'exit');}
    rows[rows.indexOf(row)]=partial;
   }}return rows;
  };
  const fixture=`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(exitRequest)}))clearInterval(timer);},5);`;
  const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['-e',fixture],timeoutMs:2000,system:{readProcessTable,signalProcess:(pid,signal)=>{signals.push({pid,signal});process.kill(pid,signal);}}});
  assert.equal(phase,2);assert.equal(receipt.status,0);assert.equal(alive(prior.pid),false);assert.equal(receipt.cleanup.complete,false,field+' ambiguity cannot be repaired by later absence');assert.equal(receipt.incidents[0].status,'active');assert.equal(receipt.incidents[0].eligible,false);assert.ok(receipt.incidents[0].blocked);assert.ok(receipt.refusals.some(row=>row.includes('identity changed')));assert.equal(signals.some(row=>row.signal!==0),false);
 });
});

test('owned native process requires independent nonliveness proof after an absent terminal identity',async t=>{
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-terminal-absent-')),ready=path.join(outputDir,'ready'),exitRequest=path.join(outputDir,'exit');let prior,hidden=false,rootPid;
 const signals=[];
 const readProcessTable=()=>{
  const rows=readNativeProcessTable();rootPid??=rows.find(row=>row.ppid===process.pid&&row.executable===process.execPath)?.pid;
  const row=rows.find(row=>row.ppid===rootPid&&row.executable===process.execPath);
  if(row){if(!prior)prior={...row};else if(!hidden&&fs.existsSync(ready)){hidden=true;rows[rows.indexOf(row)]={...row,executable:null,enrichment:{status:'unavailable',errors:[{field:'executable',code:'ENOENT'}]}};fs.writeFileSync(exitRequest,'exit');return rows;}}
  return hidden?rows.filter(row=>row.pid!==prior.pid):rows;
 };
 const child=`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(exitRequest)}))clearInterval(timer);},5);`;
 const fixture=`import{spawn}from'node:child_process';const c=spawn(process.execPath,['-e',${JSON.stringify(child)}],{detached:true,stdio:'ignore'});c.once('close',()=>console.log('root-finished'));`;
 const receipt=await runOwnedNativeProcess({cwd,outputDir,args:['--input-type=module','-e',fixture],timeoutMs:2000,system:{readProcessTable,signalProcess:(pid,signal)=>{signals.push({pid,signal});if(pid===prior?.pid){assert.equal(signal,0);/* Deliberately withhold independent descendant ESRCH proof. */}else process.kill(pid,signal);}}});
 t.diagnostic('Actual descendant exit with deliberately unavailable independent kernel proof: '+outputDir);
 assert.equal(receipt.status,0);assert.equal(alive(prior.pid),false);assert.equal(receipt.cleanup.complete,false);assert.equal(receipt.incidents[0].status,'active');assert.equal(receipt.incidents[0].resolution,undefined);assert.ok(receipt.refusals.some(row=>row.includes('no kernel nonliveness proof')));assert.ok(signals.some(row=>row.pid===prior.pid&&row.signal===0));assert.equal(receipt.processes.find(row=>row.identity.pid===prior.pid).last.status,'identity-unavailable');
});

test('owned native process reaps its witnessed detached child after the root exits first',async t=>{
 const outputDir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-root-first-')),pidfile=path.join(outputDir,'child.json');let identity;
 const script=`import{spawn}from'node:child_process';import fs from'node:fs';const child=spawn(process.execPath,['-e',"console.log('ready');setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>{fs.writeFileSync(${JSON.stringify(pidfile)},JSON.stringify({pid:child.pid}));setTimeout(()=>process.exit(0),100);});`;
 t.after(()=>{if(identity){const current=readNativeProcessTable().find(row=>row.pid===identity.pid);if(current?.startIdentity===identity.startIdentity&&alive(identity.pid))process.kill(identity.pid,'SIGKILL');}});
 const pending=runOwnedNativeProcess({cwd,outputDir,args:['--input-type=module','-e',script],timeoutMs:1500});
 assert.equal(await until(()=>fs.existsSync(pidfile)),true);const pid=JSON.parse(fs.readFileSync(pidfile)).pid;identity=readNativeProcessTable().find(row=>row.pid===pid);assert.ok(identity);
 const receipt=await pending;assert.equal(receipt.status,0);assert.equal(receipt.stopReason,'descendant-outlived-root');assert.equal(receipt.cleanup.complete,true);assert.equal(alive(pid),false);assert.ok(receipt.signals.some(row=>row.pid===pid&&row.signal==='SIGTERM'));
});

test('hosted native receipt verification rejects missing duplicate unknown skipped and incomplete outcomes',()=>{
 // Literal case names from the two original complete native packets, separate
 // from the production selector and validator constants.
 const roots=[
  ['RISK repository process: retained native sources seed once without a persistent board bootstrap',['normal','reduced','ordinary']],
  ['RISK synced scene durability: native retained boards keep immediate scene locks through reload without changing tasks or sources',['normal','reduced']],
  ['RISK scenery startup: native mobile paints once while hidden return saved choices resize and rain preserve the scene',['normal visible','normal hidden then visible','reduced visible','reduced hidden then visible','controlled failing probe cleanup']],
  ['RISK repository process: ordinary repeated selected eligibility preserves rows receipts and sources',[]],
  ['RISK repository process: ordinary task Undo keeps unchanged scenery while separate scene choices repaint and save',[]],
  ['RISK repository process: refused saved decision capture waits for its refreshed unselected review',['chromium','webkit']],
  ['RISK repository process: ordinary top-layer release refuses a covered intended opener and preserves complete sources',['chromium','webkit']],
  ['RISK repository process: external browser termination retains lifecycle classification without app crash credit',['chromium owned external browser close','webkit owned external browser close']],
 ];
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chain-owned-union-'));
 const tap=entries=>{let output='TAP version 13\n',count=0;for(const [index,[root,children]]of entries.entries()){output+='# Subtest: '+root+'\n';for(const [i,name]of children.entries()){output+='    # Subtest: '+name+'\n    ok '+(i+1)+' - '+name+'\n';count++;}output+='ok '+(index+1)+' - '+root+'\n';count++;}return output+'1..'+entries.length+'\n# tests '+count+'\n# pass '+count+'\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';};
 const saved=tap([roots[5]]),remaining=tap(roots.filter((_,index)=>index!==5));
 const receipts=[saved,remaining].map((text,index)=>{const stdout=path.join(directory,index+'.tap');fs.writeFileSync(stdout,text);return{selection:index?'remaining-seven':'saved-decision',status:0,signal:null,timedOut:false,outputLimit:false,cleanup:{complete:true},browserLaunches:[{status:'owned',identity:{pid:41001,startIdentity:'literal-start'},finalState:{status:'nonlive'},actualExit:{owner:true,exitCode:0,signal:null}}],files:{stdout},bytes:Buffer.byteLength(text),executionElapsedMs:100};});
 assert.deepEqual(verifyHostedNativeCallerReceipts(receipts).issues,[]);assert.equal(verifyHostedNativeCallerReceipts(receipts).cases.length,24);
 const mutations={missing:text=>text.replace('    ok 2 - webkit\n',''),duplicate:text=>text.replace('    ok 2 - webkit\n','    ok 2 - webkit\n    ok 3 - webkit\n'),unknown:text=>text.replaceAll('chromium','unknown-engine'),skipped:text=>text.replace('    ok 2 - webkit\n','    ok 2 - webkit # SKIP\n'),incomplete:text=>text.slice(0,-1),malformed:()=> 'not a TAP stream\n','wrong pass':text=>text.replace('# pass 3\n','# pass 0\n'),'missing pass':text=>text.replace('# pass 3\n',''),'duplicate pass':text=>text.replace('# pass 3\n','# pass 3\n# pass 0\n')};
 for(const [name,change]of Object.entries(mutations)){fs.writeFileSync(receipts[0].files.stdout,change(saved));assert.ok(verifyHostedNativeCallerReceipts(receipts).issues.length>0,name);}
 fs.writeFileSync(receipts[0].files.stdout,saved);assert.ok(verifyHostedNativeCallerReceipts(receipts.slice(0,1)).issues.some(row=>row.includes('two serial')));
 const unbound=structuredClone(receipts);unbound[0].browserLaunches=[];assert.ok(verifyHostedNativeCallerReceipts(unbound).issues.some(row=>row.includes('browser')),'A native selection cannot pass with vacuous browser lifecycle evidence');
});
