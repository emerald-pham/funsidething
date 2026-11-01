import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {runOwnedNativeProcess,readNativeProcessTable,readLinuxNativeProcessTable,verifyHostedNativeCallerReceipts} from './hosted-native-callers.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

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

test('Linux proc reader ignores inaccessible foreign enrichment without losing owned scans',()=>{
 let rows;assert.doesNotThrow(()=>{rows=readLinuxNativeProcessTable(linuxProcDouble({foreign:true}));},'A protected foreign process must not fail the owned scan');assert.deepEqual(rows,[],'A different UID is excluded before protected exe/namespace enrichment');
});

test('Linux proc reader preserves valid owned stat identity when enrichment disappears',()=>{
 const rows=readLinuxNativeProcessTable(linuxProcDouble({enrichmentLost:true}));
 assert.equal(rows.length,1,'A valid live stat must not disappear because one later enrichment link vanished');assert.equal(rows[0].state,'S');assert.equal(rows[0].startIdentity,'987654');assert.equal(rows[0].enrichment.status,'unavailable');assert.equal(rows[0].enrichment.errors[0].field,'executable');
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
