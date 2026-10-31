import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {protectedTestFingerprint} from './test-first-gate.mjs';
import {browserInit,appModule,authModule,firestoreModule,fixture as installedFixture} from './installed-client-fixture.mjs';
import {buttonFixture,populateButtonWorkload,TASK_COUNT} from './button-safety-fixture.mjs';
import {MOBILE_PROFILE,MOBILE_SCENARIO} from './button-safety-mobile-contract.mjs';
import {hostedButtonPolicy} from './button-safety-ci-policy.mjs';
import {classifyButtonStartupTimeline,verifyButtonSafetyReport} from './button-safety-contract.mjs';
import {startNativeTimelineCapture,verifyNativeTimelineRuntime} from './button-safety-timeline.mjs';
import {canonicalStartupSource,decodeStartupValue,startupDifferences,ordinaryInlineSources,ORDINARY_OPERATION_CATALOG} from './button-safety-startup.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const fixtureSourceForAuthMode=Object.freeze({'signed-out':'signed-out-installed','reconcile-held':'reconcile-held-installed'});
const MIME={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.md':'text/markdown; charset=utf-8'};
export async function runButtonSafety({repo,engine,outputDir,port=0,profile,control=null,probe=false,scenarioFilter=null,mobileYesMotion=null,browserServerEndpoint=null,closeBrowserServer=null,startupOpening=null,startupCapture=null,startupRetentionProfile}){
 const selectedProfile=mobileYesMotion?'workload-diagnostic':profile??'ordinary';
 assert.ok(['ordinary','workload-diagnostic'].includes(selectedProfile),'Unknown button safety profile');
 if(mobileYesMotion&&profile!==undefined)assert.equal(profile,'workload-diagnostic','Mobile button safety requires the original workload-diagnostic profile');
 const ordinaryTimeline=!!startupOpening&&startupCapture==='timeline';
 if(startupRetentionProfile!==undefined)assert.ok(['canonical-json-48mib-memory-png-v1','canonical-json-56mib-memory-png-v1','canonical-json-4216mib-memory-png-v1'].includes(startupRetentionProfile)&&ordinaryTimeline&&selectedProfile==='ordinary'&&!mobileYesMotion&&!probe&&!scenarioFilter&&!control&&!browserServerEndpoint,'Explicit startup retention profile requires the known ordinary startup Timeline route');
 assert.ok(['chromium','webkit'].includes(engine),'Explicit supported engine');
 if(startupCapture!==null)assert.ok(['jpeg','timeline'].includes(startupCapture)&&startupOpening&&!mobileYesMotion&&!probe&&!scenarioFilter&&!control&&!browserServerEndpoint,'Startup capture selection requires known mode on the ordinary startup operation only');
 if(startupCapture==='timeline')verifyNativeTimelineRuntime();
 if(startupOpening){
  assert.equal(engine,'webkit','Ordinary startup diagnostic names WebKit');assert.equal(control,null);assert.equal(probe,false);assert.equal(scenarioFilter,null);assert.equal(mobileYesMotion,null);assert.equal(browserServerEndpoint,null);
  assert.match(startupOpening.sourceCommit||'',/^[a-f0-9]{40}$/,'Immutable startup application source required');
  assert.equal(startupOpening.raw,JSON.stringify(installedFixture('signed-out')),'Ordinary startup retains exact existing64-task fixture bytes');
  scenarioFilter='ordinary saved-board opening';
 }
 if(browserServerEndpoint!==null){assert.equal(engine,'webkit');assert.ok(mobileYesMotion,'Remote launch is only admitted for the capped mobile consumer');assert.match(browserServerEndpoint,/^ws:\/\/127\.0\.0\.1:[1-9][0-9]*\/[a-zA-Z0-9_-]+$/);assert.equal(typeof closeBrowserServer,'function','Remote browser requires owner-confirmed closure');}
 if(mobileYesMotion){assert.equal(engine,'webkit');assert.ok(['normal','reduced'].includes(mobileYesMotion));assert.ok(scenarioFilter===null||scenarioFilter===MOBILE_SCENARIO);scenarioFilter=MOBILE_SCENARIO;}
 assert.ok(control===null||['pageerror','unhandled','reload','navigation','stall','short-stall','async-pending','async-predicate-false','close','crash','new-action','top-layer-release'].includes(control),'Known explicit sensitivity control');
 if(control==='top-layer-release'){assert.equal(probe,true,'Top-layer sensitivity uses the existing public probe');assert.equal(selectedProfile,'ordinary','Top-layer sensitivity uses the accepted ordinary64 fixture');assert.equal(mobileYesMotion,null);assert.equal(startupOpening,null);}
 let hostedPolicy=null;
 if(process.env.CI==='true'){
  hostedPolicy=hostedButtonPolicy(process.env,{allowUnselectedDispatch:selectedProfile==='ordinary'});
 }else{
  const ledgerPath=process.env.CODEX_COORDINATION_FILE||process.env.DOW_EMULATOR_COORDINATION_FILE;
  assert.ok(ledgerPath&&path.isAbsolute(ledgerPath),'Local named-engine launch requires explicit canonical coordination ledger');
  const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
  const owners=(ledger.entries||[]).filter(entry=>['active','parked'].includes(entry.status));
  const repoPath=fs.realpathSync(repo);
  const own=owners.find(entry=>{
   if(entry.status!=='active')return false;
   try{return fs.realpathSync(entry.worktree)===repoPath;}
   catch(error){
    // Missing foreign paths cannot identify this owner, but remain in owners
    // so their active/parked resource claims still refuse conflicting launches.
    if(error.code==='ENOENT'||error.code==='ENOTDIR')return false;
    throw error;
   }
  });
  assert.ok(own,'Active worktree allocation required before native launch');
  assert.ok(own.lease?.state==='healthy'&&Date.parse(own.lease.expiresAt)>Date.now()&&!own.lease.ownerConfirmationRequired,'Current healthy worktree lease required before native launch');
  for(const resource of ['browser-runtime:playwright-'+engine,'loopback:127.0.0.1:'+port]){
   assert.ok(own.resources?.includes(resource),'Local named-engine allocation missing: '+resource);
   assert.ok(!owners.some(entry=>entry!==own&&entry.resources?.includes(resource)),'Conflicting local native allocation: '+resource);
  }
  assert.ok(Number.isSafeInteger(port)&&port>0,'Explicit allocated local native port required');
 }

 const inventoryBytes=fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'));
 const inventory=JSON.parse(inventoryBytes);
 const profileDefinition=inventory.profiles?.[selectedProfile];
 assert.ok(profileDefinition&&Array.isArray(profileDefinition.requiredScenarios),'Independent selected button profile required');
 const fixtureTaskCount=profileDefinition.fixture?.savedTasks??profileDefinition.requiredWorkload?.savedTasks??TASK_COUNT;
 const selectedScenarios=new Set(profileDefinition.requiredScenarios);
 fs.mkdirSync(outputDir,{recursive:true});
 const git=(...args)=>execFileSync('git',args,{cwd:repo,maxBuffer:32*1024*1024}),candidateCommit=git('rev-parse','HEAD').toString().trim(),candidateTree=git('rev-parse','HEAD^{tree}').toString().trim();
 const diagnosticProfile=selectedProfile==='workload-diagnostic';
 const report={schemaVersion:1,kind:mobileYesMotion?'button-mobile-functional':probe?'button-sensitivity':scenarioFilter?'button-diagnostic':'button-safety',engine,candidateCommit,candidateTree,hostedPolicy,status:'running',startedAt:new Date().toISOString(),profile:selectedProfile,requiredActions:inventory.requiredActions,requiredScenarios:profileDefinition.requiredScenarios,...(diagnosticProfile?{requiredWorkload:profileDefinition.requiredWorkload,requiredRapidActions:profileDefinition.requiredRapidActions}:{}),inventorySha256:digest(inventoryBytes),observedActions:[],outcomes:[],errors:[],cleanup:{},limits:['Synthetic isolated browser storage and Firebase/clipboard/geolocation boundaries.',mobileYesMotion?'Emulated mobile WebKit; uncapped functional evidence unless independently bound to a verified Linux cgroup report; no physical iPhone or private-board recovery claim.':'Native desktop engine; no physical iPhone or private-board recovery claim.']};
 const reportPath=path.join(outputDir,'button-safety-'+engine+'-'+randomUUID()+'.json'),save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save();
 if(startupOpening){report.kind='startup-diagnostic';report.scope='ordinary-startup-diagnostic';report.limits.push('Ordinary uncapped64-task opening only; no button, mobile memory, release or physical-iOS qualification.');}
 if(ordinaryTimeline){
  const changed=[...new Set([...git('diff','--name-only','HEAD').toString().split('\n'),...git('ls-files','--others','--exclude-standard').toString().split('\n')].filter(Boolean))].sort();let patch=git('diff','--binary','--full-index','HEAD');
  for(const file of changed)try{git('ls-files','--error-unmatch',file);}catch{try{git('diff','--no-index','--binary','--full-index','/dev/null',file);}catch(error){if(error.status!==1)throw error;patch=Buffer.concat([patch,error.stdout]);}}
  report.toolingSource={commit:candidateCommit,tree:candidateTree,fullPatchSha256:digest(patch),protectedFingerprint:protectedTestFingerprint(git('diff','--unified=0','HEAD','--','tests.js').toString().split('\n')),files:changed.map(file=>({path:file,sha256:digest(fs.lstatSync(path.join(repo,file)).isSymbolicLink()?fs.readlinkSync(path.join(repo,file)):fs.readFileSync(path.join(repo,file)))})),exclusions:['Git-ignored files','External runtime/environment separately bound at launch']};
 }
 const appCommit=startupOpening?.sourceCommit||candidateCommit;
 if(startupOpening){assert.equal(git('rev-parse',appCommit+'^{commit}').toString().trim(),appCommit);report.appSource={commit:appCommit,tree:git('rev-parse',appCommit+'^{tree}').toString().trim()};report.fixture={bytes:Buffer.byteLength(startupOpening.raw),sha256:digest(startupOpening.raw),tasks:64};}
 const prefix='/button-'+randomUUID()+'/',sdk='/sdk-'+randomUUID()+'/',sources=new Map(),diagnosticSources=new Map(),retainedSources=new Map();let origin,scriptSequence=0,sourceManifest;
 const runtimeAssets=JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8')).requiredRuntimeAssets;
 // Only reviewed runtime Markdown joins the existing asset types; repository guidance stays private.
 for(const file of (startupOpening?git('ls-tree','-r','--name-only',appCommit):git('ls-files')).toString().trim().split('\n'))if(file!=='tests.js'&&!file.startsWith('scripts/')&&(/\.(html|js|css|svg|png|webmanifest)$/.test(file)||Object.hasOwn(runtimeAssets,file)))sources.set(file,startupOpening?git('show',appCommit+':'+file):fs.readFileSync(path.join(repo,file)));
 report.assets=Object.fromEntries([...sources].map(([file,bytes])=>[file,digest(bytes)]));
 if(!startupOpening)for(const [file,hash]of Object.entries(runtimeAssets))assert.equal(report.assets[file],hash,'Reviewed runtime asset missing or changed: '+file);
 const {verifyButtonInventorySource}=await import('./button-safety-contract.mjs');if(!startupOpening)verifyButtonInventorySource([...sources].filter(([file])=>/\.(?:js|html)$/.test(file)).map(([,bytes])=>bytes.toString()).join('\n'),JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8')));
 for(const [file,bytes]of sources)assert.equal(digest(bytes),digest(git('show',appCommit+':'+file)),'Button run requires exact committed app bytes: '+file);
 let server,browser,context,page,armed=false,closing=false,stopStartupCapture=null,interrupted=null;
 const check=()=>{assert.equal(report.errors.length,0,'Native button safety detected '+report.errors.join(', '));};
 const retainSource=(url,value,kind)=>{
  if(!ordinaryTimeline)return;const bytes=Buffer.isBuffer(value)?value:Buffer.from(value),sha256=digest(bytes),previous=retainedSources.get(url);
  if(previous){assert.equal(previous.sha256,sha256,'Owned source URL bytes changed');return previous;}
  const directory=path.join(outputDir,'startup-sources');fs.mkdirSync(directory,{recursive:true});const relative='startup-sources/source-'+String(retainedSources.size+1).padStart(4,'0')+'.txt';fs.writeFileSync(path.join(outputDir,relative),bytes,{flag:'wx'});const row={url,kind,path:relative,sha256,bytes:bytes.length};retainedSources.set(url,row);return row;
 };
 const diagnostic=(fn,arg,name)=>{const source=canonicalStartupSource(fn,arg,origin+prefix+'__startup-diagnostic__/'+(name||'source-'+(++scriptSequence))+'.js');diagnosticSources.set(new URL(source.url).pathname,source.content);retainSource(source.url,source.content,'instrumentation');return source;};
 const evalPage=(fn,arg)=>ordinaryTimeline?page.evaluate(diagnostic(fn,arg).content):page.evaluate(fn,arg);
 const initScript=(owner,fn,arg)=>ordinaryTimeline?owner.addInitScript({content:diagnostic(typeof fn==='object'?fn.content:fn,arg).content}):owner.addInitScript(fn,arg);
 const evaluateElement=(selector,fn)=>ordinaryTimeline?evalPage('('+fn.toString()+')(document.querySelector('+JSON.stringify(selector)+'))'):page.locator(selector).first().evaluate(fn);

 const bounded=async(work,label,timeoutMs=2500)=>{let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native button safety detected stalled responsiveness: '+label)),timeoutMs);})]);}finally{clearTimeout(timer);}};
 const beginStartupCapture=async()=>{
  const bounds={maxDurationMs:12000,maxFrames:120,maxTotalBytes:8388608,maxFrameBytes:262144};
  const capture=report.startupCapture={schemaVersion:1,selected:true,provider:'playwright-public-screencast',status:'running',bounds,startedBeforeNavigation:false,startedHostMonotonicMs:performance.now(),stoppedHostMonotonicMs:null,stopReason:null,clock:{reportedTimestampBasis:'engine-or-Date.now-fallback-ambiguous',hostEpochBasis:'Date.now',hostMonotonicBasis:'performance.now',pageClockConversion:'unavailable'},counts:{received:0,accepted:0,dropped:0,oversized:0,writeRefused:0},totalBytes:0,frames:[],errors:[],cleanup:{stopAttempted:false,stopped:false,timerCleared:false},overhead:'Selected external JPEG delivery and synchronous bounded file writes; no page-clock/compositor conversion'};
  let halted=false,stopPromise,timer;
  stopStartupCapture=reason=>{
   if(stopPromise)return stopPromise;halted=true;clearTimeout(timer);capture.cleanup.timerCleared=true;capture.stopReason=reason;capture.stoppedHostMonotonicMs=performance.now();capture.cleanup.stopAttempted=true;
   stopPromise=(async()=>{try{await page.screencast.stop();capture.cleanup.stopped=true;}catch(error){capture.errors.push('stop: '+String(error).slice(0,240));}finally{capture.status=capture.errors.length?'error':capture.frames.length?'captured':'unavailable';save();}})();return stopPromise;
  };
  if(!page.screencast||typeof page.screencast.start!=='function'||typeof page.screencast.stop!=='function'){capture.errors.push('unsupported: pinned public page.screencast unavailable');await stopStartupCapture('unsupported');return;}
  const framesDir=path.join(outputDir,'startup-frames');
  try{
   fs.mkdirSync(framesDir);
   timer=setTimeout(()=>{void stopStartupCapture('duration-limit');},bounds.maxDurationMs);
   await page.screencast.start({size:{width:1100,height:850},quality:65,onFrame:frame=>{
    const hostReceiptEpochMs=Date.now(),hostReceiptMonotonicMs=performance.now();capture.counts.received++;
    if(halted){capture.counts.dropped++;return;}
    if(hostReceiptMonotonicMs-capture.startedHostMonotonicMs>bounds.maxDurationMs){capture.counts.dropped++;void stopStartupCapture('duration-limit');return;}
    const data=frame.data;if(!Buffer.isBuffer(data)||data.length===0||data.subarray(0,2).toString('hex')!=='ffd8'||data.subarray(-2).toString('hex')!=='ffd9'){capture.counts.dropped++;capture.errors.push('invalid JPEG callback');void stopStartupCapture('capture-error');return;}
    if(data.length>bounds.maxFrameBytes){capture.counts.oversized++;return;}
    if(capture.frames.length>=bounds.maxFrames||capture.totalBytes+data.length>bounds.maxTotalBytes){capture.counts.dropped++;void stopStartupCapture(capture.frames.length>=bounds.maxFrames?'frame-limit':'byte-limit');return;}
    const index=capture.frames.length+1,relative='startup-frames/frame-'+String(index).padStart(4,'0')+'.jpg';
    try{fs.writeFileSync(path.join(outputDir,relative),data,{flag:'wx'});}catch(error){capture.counts.writeRefused++;capture.errors.push('write-refused: '+String(error).slice(0,240));void stopStartupCapture('write-refused');return;}
    capture.frames.push({index,path:relative,bytes:data.length,sha256:digest(data),reportedTimestampMs:frame.timestamp,hostReceiptEpochMs,hostReceiptMonotonicMs,viewportWidth:frame.viewportWidth,viewportHeight:frame.viewportHeight,pageClockSample:{status:'unavailable',reason:'No independent same-document compositor clock sample; callback receipt is not page paint'}});capture.counts.accepted++;capture.totalBytes+=data.length;
    if(capture.frames.length===bounds.maxFrames)void stopStartupCapture('frame-limit');
   }});if(halted)await page.screencast.stop();capture.startedBeforeNavigation=true;save();
  }catch(error){capture.errors.push('capture: '+String(error).slice(0,240));await stopStartupCapture('capture-error');}
 };
 const captureSignals=startupCapture?Object.fromEntries(['SIGINT','SIGTERM'].map(signal=>[signal,()=>{interrupted??=signal;void(async()=>{await stopStartupCapture?.('interrupted');})().catch(error=>{report.errors.push('capture interruption cleanup: '+String(error));});}])):{};
 for(const [signal,handler]of Object.entries(captureSignals))process.on(signal,handler);

 try{
  const sdkBodies={'firebase-app.js':appModule,'firebase-auth.js':authModule,'firebase-firestore.js':firestoreModule.replace('const rpc=(kind,args)=>window.__installedRPC(kind,args)',"const rpc=async(kind,args)=>{const result=await window.__installedRPC(kind,args);if(result?.fixtureFailure)throw Object.assign(Error('Synthetic external SDK refusal'),{code:result.fixtureFailure});return result;}")};
  server=http.createServer((req,res)=>{
   const pathname=new URL(req.url,'http://127.0.0.1').pathname;
   const name=pathname.slice(prefix.length)||'index.html',module=pathname.startsWith(sdk)?pathname.slice(sdk.length):null;
   const observer=pathname===prefix+'__button-observer';
   const generated=ordinaryTimeline?diagnosticSources.get(pathname):null;
   const bytes=generated|| (observer?'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated storage fixture</title>':module?sdkBodies[module]:pathname.startsWith(prefix)&&!name.includes('..')?sources.get(name):null);
   if(ordinaryTimeline){report.sourceResponses??=[];report.sourceResponses.push({url:origin+pathname,status:bytes?200:404,mime:generated||module?'text/javascript':MIME[path.extname(name)]||'text/plain',sha256:bytes?digest(bytes):null});}
   res.writeHead(bytes?200:404,{'Content-Type':generated?'text/javascript':observer?'text/html':module?'text/javascript':MIME[path.extname(name)]||'text/plain','Cache-Control':'no-store'});res.end(bytes||'Not found');
  });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;
  if(ordinaryTimeline){for(const [file,bytes]of sources)retainSource(origin+prefix+file,bytes,'app');retainSource(origin+prefix,sources.get('index.html'),'app');for(const [file,bytes]of Object.entries(sdkBodies))retainSource(origin+sdk+file,bytes,'synthetic-sdk');sourceManifest={app:report.appSource,inlineSources:ordinaryInlineSources(sources.get('index.html')),operationCatalog:ORDINARY_OPERATION_CATALOG,documentURL:origin+prefix,origin,appPrefix:prefix,assets:[...sources].map(([file,bytes])=>({path:file,sha256:digest(bytes),bytes:bytes.length})),sdk:Object.entries(sdkBodies).map(([name,bytes])=>({name,url:origin+sdk+name,sha256:digest(bytes)})),generated:[],fixture:report.fixture};}
  if(interrupted)throw Error('Startup capture interrupted before launch: '+interrupted);
  const playwright=await import('playwright');browser=browserServerEndpoint?await playwright[engine].connect(browserServerEndpoint,{timeout:15000}):await playwright[engine].launch({headless:true});browser.on('disconnected',()=>{if(!closing)report.errors.push('browser-disconnected');});report.runtime={engine,version:browser.version(),playwright:'1.62.1',platform:process.platform,nodeVersion:process.version,browserConnection:browserServerEndpoint?'remote-owned':'local-owned',...(browserServerEndpoint?{browserEndpointSha256:digest(browserServerEndpoint)}:{})};
  const {runButtonScenarios}=await import('./button-safety-scenarios.mjs');
  const observed=new Set(),outcomes=new Map(),rapidOutcomes=new Map();
  const actionFor=el=>{
   if(el===document.documentElement)return null; // Landscape uses this root attribute only as rendered state.
   if(el.closest('[data-saved-preview][inert][aria-hidden="true"]'))return null;
   if(el.matches('summary'))return 'disclosure';
   if(el.dataset.act)return 'act:'+el.dataset.act;
   for(const [key,prefix]of [['landscapeMotion','motion:'],['scenePreset','scene-preset:'],['sceneTime','scene-time:'],['locationAction','location:']])if(el.dataset[key]!==undefined)return prefix+el.dataset[key];
   if(el.hasAttribute('data-scene-view'))return 'scene-view';
   return 'button-id:'+el.id;
  };
  const scenario=async(name,options,execute)=>{
   if(scenarioFilter&&name!==scenarioFilter)return;
   if(!scenarioFilter&&!probe&&!selectedScenarios.has(name))return;
   const scenarioFixture=selectedProfile==='ordinary'&&!probe&&!startupOpening?profileDefinition.scenarioFixtures?.[name]:null;
   if(selectedProfile==='ordinary'&&!probe&&!startupOpening){
    assert.ok(scenarioFixture&&typeof scenarioFixture==='object','Trusted ordinary scenario fixture required: '+name);
    assert.equal(scenarioFixture.savedTasks,fixtureTaskCount,'Ordinary scenario uses its independently declared base size: '+name);
    assert.equal(scenarioFixture.source,fixtureSourceForAuthMode[scenarioFixture.authMode],'Ordinary source label must match its installed fixture mode: '+name);
    assert.equal(scenarioFixture.fixtureRole,profileDefinition.scenarioRoles?.[name]||'active','Ordinary fixture role must match its independent inventory: '+name);
    if(options.authMode!==undefined)assert.equal(options.authMode,scenarioFixture.authMode,'Scenario helper cannot select an unreviewed ordinary auth mode: '+name);
    if(options.fixtureRole!==undefined)assert.equal(options.fixtureRole,scenarioFixture.fixtureRole,'Scenario helper cannot select an unreviewed ordinary fixture role: '+name);
   }
   const fixtureRole=scenarioFixture?.fixtureRole||options.fixtureRole||profileDefinition.scenarioRoles?.[name]||'active';
   const fixtureMode=scenarioFixture?.authMode||options.authMode||profileDefinition.fixture?.authMode||'signed-out';
   if(context){closing=true;await context.close();closing=false;}
   const device=mobileYesMotion?playwright.devices['iPhone 13']:null;
   context=await browser.newContext({...(device?{userAgent:device.userAgent,screen:MOBILE_PROFILE.screen,deviceScaleFactor:3,isMobile:true,hasTouch:true}:{}),serviceWorkers:'block',viewport:mobileYesMotion?MOBILE_PROFILE.viewport:options.viewport||{width:1100,height:850},reducedMotion:startupOpening||mobileYesMotion==='normal'?'no-preference':'reduce'});
   if(mobileYesMotion)options={...options,retainedCopies:2};
   const board=startupOpening?JSON.parse(startupOpening.raw):buttonFixture(fixtureMode,{profile:selectedProfile});
   if(scenarioFixture){
    assert.equal(board.syncAccount,scenarioFixture.syncAccount,'Ordinary fixture uses its independently declared seed account: '+name);
    assert.equal(board.syncRev,scenarioFixture.seedSyncRev,'Ordinary fixture uses its independently declared seed revision: '+name);
   }
   if(options.board)Object.assign(board,options.board);
   if(options.decorate)options.decorate(board);
   if(!startupOpening)populateButtonWorkload(board,{role:fixtureRole,taskCount:fixtureTaskCount});
   await context.exposeBinding('__installedRPC',(_,kind,args)=>{
    if((kind==='get'||kind==='list')&&options.cloudReadFail)return{fixtureFailure:'unavailable'};
    if(kind==='get')return structuredClone(options.remote?.get(args[0])??null);
    if(kind==='list')return structuredClone([...options.remote||[]].filter(([key])=>key.startsWith(args[0]+'/')));
    if(kind==='apply'){if(options.cloudWriteFail)return{fixtureFailure:'unavailable'};assert.ok(options.remote,'Cloud fixture writes need an isolated remote Map');for(const [op,key,value]of args[0]){if(op==='delete')options.remote.delete(key);else if(op==='update')options.remote.set(key,{...options.remote.get(key),...structuredClone(value)});else options.remote.set(key,structuredClone(value));}return null;}
    throw Error('Unexpected cloud write in button fixture');
   });
   const dbName='button-'+randomUUID();
   // The neutral pointer-release iframe must never reseed shared browser
   // preferences or app storage while a button burst is in progress.
   await initScript(context,{content:'if(window.top===window){('+browserInit.toString()+')('+JSON.stringify({dbName,authMode:fixtureMode,sdkBase:origin+sdk})+');'+((startupOpening||mobileYesMotion)?'localStorage.setItem("fvp:chain-scanner:landscape-motion",JSON.stringify({choice:'+JSON.stringify(startupOpening?'normal':mobileYesMotion)+',savedAt:Date.now()}));':'')+'}'});
   // Retained sources are seeded once in the observer below, not serialized
   // into every later page/frame bootstrap. Ordinary fixtures keep their seed.
   if(!options.retainedCopies)await initScript(context,({board})=>{
    if(window.top!==window)return;
    if(!localStorage.getItem('fvp:chain-scanner:device-store-v2')&&localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',JSON.stringify(board));
   },{board});
   await initScript(context,({clipboardFail,clipboardDeferred,geoFail})=>{
    if(window.top!==window)return;
    window.__buttonClipboard=[];window.__buttonClipboardPending=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(clipboardFail)throw new DOMException('Synthetic clipboard permission refused','NotAllowedError');window.__buttonClipboard.push(text);if(clipboardDeferred)await new Promise((resolve,reject)=>window.__buttonClipboardPending.push({resolve,reject}));}}});
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(success,failure)=>geoFail?failure?.({code:1,message:'Synthetic location refused'}):success({coords:{latitude:40.7,longitude:-74,accuracy:20}})}});
   },{clipboardFail:options.clipboardFail,clipboardDeferred:options.clipboardDeferred,geoFail:options.geoFail});
   await initScript(context,()=>{
    if(window.top!==window)return;
    window.__buttonRefuseWrites=false;window.__buttonRefuseReads=false;
    const tx=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode==='readonly'&&window.__buttonRefuseReads)throw new DOMException('Synthetic saved source read refused','UnknownError');if(mode==='readwrite'&&window.__buttonRefuseWrites)throw new DOMException('Synthetic saved source write refused','QuotaExceededError');return tx.call(this,stores,mode,...rest);};
    const put=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(window.__buttonRefuseWrites&&key.startsWith('fvp:chain-scanner:'))throw new DOMException('Synthetic browser storage write refused','QuotaExceededError');return put.call(this,key,value);};
   });
   if(options.retainedCopies){
    const observer=await context.newPage();await observer.goto(origin+prefix+'__button-observer');await observer.addScriptTag({content:sources.get('device-store-v2.js').toString()});
    report.retainedSources??=[];report.retainedSources.push(await observer.evaluate(async({dbName,board,count,mobile,ordinaryUndo})=>{
     const seedStartedAtMs=Date.now();
     const raw=JSON.stringify(board),legacyKey='fvp:chain-scanner:v1',legacyBefore=localStorage.getItem(legacyKey);let legacySeeded=false;
     if(!localStorage.getItem('fvp:chain-scanner:device-store-v2')&&legacyBefore===null){localStorage.setItem(legacyKey,raw);legacySeeded=true;}
     const store=ChainStorageV2.createDeviceStore({dbName});await store.open();
     const backups=Array.from({length:count},(_,i)=>({id:'gate-retained-'+i,kind:'manual',at:Date.now()-i,day:'2026-10-25',payload:JSON.stringify({...board,futureSourceRole:i})}));
     if(ordinaryUndo){
      if(count!==3)throw Error('The admitted ordinary Undo source fixture requires its exact three originals');
      const kinds=['manual','latest','future-recovery'],roles=['manual','pinned-automatic','unknown-kind'];
      backups.forEach((row,index)=>{row.kind=kinds[index];row.futureRetained={role:roles[index],raw:roles[index]+' original\u0000bytes',opaque:['retain',[13,17,19][index]],flag:true,empty:null};});
     }
     // Capture generated fixture inputs before migration/readback.
     const inputRows=ordinaryUndo?structuredClone(backups):null;
     const result=await store.migrateLegacy({headPayload:raw,account:null,sourceFingerprint:await ChainStorageV2.hashPayload(JSON.stringify([{key:'fvp:chain-scanner:v1',raw}])),backups,opaqueArchives:[{key:'gate-opaque-exact',raw:'opaque exact bytes\u0000retain',futureBytes:new Uint8Array([0,17,255]),futureMinusZero:-0}]});
     if(!result.verified)throw Error('Native retained source fixture failed');const head=await store.readHead();await store.setPendingUpload('gate-owner',{generationId:'gate-pending',payloadHash:head.hash,baseRev:0,updatedAt:7});
     const legacyAfter=localStorage.getItem(legacyKey),retainedSources=[];
     for(const row of (await store.listBackups()).filter(row=>row.id.startsWith('gate-retained-')).sort((a,b)=>a.id.localeCompare(b.id))){const saved=JSON.parse(row.payload);retainedSources.push({id:row.id,payloadHash:await ChainStorageV2.hashPayload(row.payload),...(mobile?{durableTasks:saved.tasks.length,unknownBytes:new TextEncoder().encode(saved.futurePopulated.opaque).byteLength}:{})});}
     let workload;if(mobile){const saved=JSON.parse(head.payload),opaque=(await store.listOpaqueArchives()).find(row=>row.key==='gate-opaque-exact' );workload={durableTasks:saved.tasks.length,activeTasks:saved.tasks.filter(row=>!row.done).length,distinctTaskIds:new Set(saved.tasks.map(row=>row.id)).size,unknownBytes:new TextEncoder().encode(saved.futurePopulated.opaque).byteLength,taskIdentityHash:await ChainStorageV2.hashPayload(JSON.stringify(saved.tasks.map(row=>({id:row.id,title:row.title,createdAt:row.createdAt})))),unknownSourceHash:await ChainStorageV2.hashPayload(JSON.stringify({board:saved.futureBoard,populated:saved.futurePopulated,tasks:saved.tasks.map(row=>({id:row.id,future:row.futureTask}))})),opaque:opaque?{key:opaque.key,rawHash:await ChainStorageV2.hashPayload(opaque.raw),futureBytes:Array.from(opaque.futureBytes),futureMinusZero:Object.is(opaque.futureMinusZero,-0)}:null,pending:await store.getPendingUpload('gate-owner')};}
     const bootstrap={delivery:'observer-evaluate-once',legacySeeded,legacyBeforeHash:legacyBefore===null?null:await ChainStorageV2.hashPayload(legacyBefore),legacyPayloadHash:legacyAfter===null?null:await ChainStorageV2.hashPayload(legacyAfter),headPayloadHash:await ChainStorageV2.hashPayload(head.payload),headPayloadBytes:new TextEncoder().encode(head.payload).byteLength,...(mobile?{workload}:{}),retainedSources};
     let ordinaryUndoFixtureSeed;
     if(ordinaryUndo)ordinaryUndoFixtureSeed={seedStartedAtMs,seedFinishedAtMs:Date.now(),headPayload:raw,headHash:head.hash,
      rows:inputRows,readbackRows:await store.listBackups(),pending:await store.getPendingUpload('gate-owner')};
     await store.close();return{count,eachPayloadBytes:backups[0].payload.length,ids:backups.map(row=>row.id),bootstrap,...(ordinaryUndo?{ordinaryUndoFixtureSeed}: {})};
    },{dbName,board,count:options.retainedCopies,mobile:!!mobileYesMotion,ordinaryUndo:name==='ordinary Undo consumes two saved edit frames'}));
    const proof=report.retainedSources.at(-1).bootstrap,expected=digest(JSON.stringify(board));
    assert.equal(proof.legacyPayloadHash,proof.legacySeeded?expected:proof.legacyBeforeHash,'Observer retains exact guarded legacy bytes');
    assert.equal(proof.headPayloadHash,expected,'Observer reads back exact fixture head');assert.equal(proof.headPayloadBytes,Buffer.byteLength(JSON.stringify(board)));
    assert.deepEqual(proof.retainedSources,Array.from({length:options.retainedCopies},(_,i)=>({id:'gate-retained-'+i,payloadHash:digest(JSON.stringify({...board,futureSourceRole:i})),...(mobileYesMotion?{durableTasks:board.tasks.length,unknownBytes:Buffer.byteLength(board.futurePopulated.opaque)}:{})})).sort((a,b)=>a.id.localeCompare(b.id)),'Observer reads back both exact retained sources');
    if(mobileYesMotion){
     const observed=await observer.evaluate(()=>({width:innerWidth,height:innerHeight,screenWidth:screen.width,screenHeight:screen.height,deviceScaleFactor:devicePixelRatio,maxTouchPoints:navigator.maxTouchPoints,coarsePointer:matchMedia('(pointer:coarse)').matches,userAgent:navigator.userAgent,reducedMedia:matchMedia('(prefers-reduced-motion:reduce)').matches,appMotion:JSON.parse(localStorage.getItem('fvp:chain-scanner:landscape-motion')).choice}));
     report.mobileAttempt={phase:'before-app-navigation',scenario:name,profile:MOBILE_PROFILE,motion:mobileYesMotion,observed,headPayloadHash:proof.headPayloadHash};save();
    }
    await observer.close();
   }
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   page=await context.newPage();page.setDefaultTimeout(4000);let localArmed=false,allowedNavigation=null;
   if(startupOpening)await initScript(page,()=>{
    const unavailable=reason=>({status:'unavailable',atMs:null,reason});
    window.__buttonStartupTimeline={schemaVersion:1,status:'incomplete',clock:{basis:'page-performance',timeOrigin:performance.timeOrigin},observations:{navigationStart:{status:'observed',atMs:0,basis:'Performance navigation timeOrigin'},firstBackgroundPaint:unavailable('This external WebKit recorder has no supported first-background compositor/pixel timestamp'),completeBoardPaint:unavailable('DOM readiness and rAF are not completed-board paint evidence'),firstTrustedInputReceipt:unavailable('No trusted input received yet'),firstVisibleResponse:unavailable('DOM mutation and rAF are not visible-response paint evidence'),overlappingWorkIntervals:{status:'unavailable',intervals:[],reason:'No supported operation/caller main-thread trace on this capture route; frame gaps do not establish work or cause'}},proxies:{},overhead:'One capture listener and bounded DOM-ready timestamp; neither measures paint'};
    document.addEventListener('DOMContentLoaded',()=>{window.__buttonStartupTimeline.proxies.domContentLoadedAtMs=performance.now();},{once:true});
    document.addEventListener('pointerdown',event=>{if(event.isTrusted&&window.__buttonStartupTimeline.observations.firstTrustedInputReceipt.status!=='observed')window.__buttonStartupTimeline.observations.firstTrustedInputReceipt={status:'observed',atMs:performance.now(),basis:'Trusted native pointerdown capture listener',trusted:true};},true);
   });

   if(ordinaryTimeline)await initScript(page,({inputPrefix})=>{
    if(window.top!==window)return;window.__ordinaryStartup={inputPrefix,operationId:null,receipts:[]};
    for(const kind of ['pointerdown','click'])document.addEventListener(kind,event=>{const s=window.__ordinaryStartup,document=window.__nativeTimelineDocument,target=event.target.closest?.('[data-act]');if(!s.operationId||!event.isTrusted||!document)return;
     const receipt={operationId:s.operationId,kind,action:target?'act:'+target.dataset.act:null,targetId:target?.id||null,trusted:event.isTrusted,pageMs:performance.now(),eventTimeStamp:event.timeStamp,documentId:document.id,timeOrigin:document.timeOrigin,fixtureDocumentId:window.__installedFixture.documentId,sequence:s.receipts.length+1};s.receipts.push(receipt);performance.mark(inputPrefix+JSON.stringify(receipt),{startTime:receipt.pageMs});
    },true);
   },{inputPrefix:'startup-input:'+randomUUID()+':'});
   page.on('pageerror',error=>report.errors.push('pageerror: '+error.message));
   page.on('crash',()=>report.errors.push('page-crash'));
   page.on('close',()=>{if(!closing)report.errors.push('unexpected-close');});
   page.on('framenavigated',frame=>{if(localArmed&&frame===page.mainFrame()){if(allowedNavigation&&allowedNavigation.remaining===1&&frame.url()===allowedNavigation.url){allowedNavigation.remaining--;report.allowedNavigations??=[];report.allowedNavigations.push({scenario:name,url:frame.url(),action:allowedNavigation.action});}else report.errors.push('unexpected-navigation-or-reload: '+frame.url());}});
   page.on('popup',popup=>report.errors.push('unexpected-popup: '+popup.url()));
   if(options.importRaw)page.on('filechooser',chooser=>chooser.setFiles({name:'gate-board.json',mimeType:'application/json',buffer:Buffer.from(options.importRaw)}));
   page.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt'?'Safety gate context':undefined));
   await page.exposeBinding('__buttonFault',async()=>{if(control==='close')await page.close();if(control==='crash'){const session=await context.newCDPSession(page);void session.send('Page.crash').catch(()=>{});}});
   await page.exposeBinding('__buttonSafetyFailure',(_,message)=>report.errors.push(message));
   await page.exposeBinding('__buttonUnidentified',(_,html)=>{report.unidentifiedButtons??=[];if(!report.unidentifiedButtons.includes(html))report.unidentifiedButtons.push(html);});
   await page.exposeBinding('__buttonObserved',(_,keys)=>{for(const key of keys)observed.add(key);});
   await page.exposeBinding('__buttonPressed',(_,receipt)=>{report.presses??=[];report.presses.push({scenario:name,...receipt});});
   await page.exposeBinding('__buttonClicked',(_,receipt)=>{report.clicks??=[];report.clicks.push({scenario:name,...receipt});});
   await initScript(page,({keySource})=>{
    if(window.top!==window)return;
    const key=eval('('+keySource+')');
    window.__buttonNativePresses=[];window.__buttonNativeClicks=[];
    document.addEventListener('pointerdown',event=>{if(event.isTrusted){const h=window.__buttonHeartbeat;if(h?.inputArmed&&h.inputAt===null){const now=performance.now();h.preInputMaxGapMs=Math.max(h.preInputMaxGapMs,now-h.at);h.inputAt=now;h.inputArmed=false;}const target=event.target.closest('button,summary,[data-act],[role="button"]')||document.documentElement;window.__buttonNativeDownTarget=target;const receipt={at:performance.timeOrigin+performance.now(),action:key(target),pointerType:event.pointerType,trusted:true,offeredTaskId:key(target)==='act:yes'?state.candidateId:null};window.__buttonNativePresses.push(receipt);void window.__buttonPressed(receipt);}},true);
    window.__buttonHeartbeat={at:performance.now(),maxGapMs:0,frames:0,inputArmed:false,inputAt:null,inputMaxGapMs:0,preInputMaxGapMs:0,timeOrigin:performance.timeOrigin};const pulse=now=>{const h=window.__buttonHeartbeat;h.maxGapMs=Math.max(h.maxGapMs,now-h.at);if(h.inputAt!==null)h.inputMaxGapMs=Math.max(h.inputMaxGapMs,now-Math.max(h.at,h.inputAt));else if(h.inputArmed)h.preInputMaxGapMs=Math.max(h.preInputMaxGapMs,now-h.at);h.at=now;h.frames++;if(h.clickAt!==undefined&&h.firstFrameAfterClickMs===undefined)h.firstFrameAfterClickMs=now-h.clickAt;requestAnimationFrame(pulse);};requestAnimationFrame(pulse);
    addEventListener('unhandledrejection',event=>void window.__buttonSafetyFailure('unhandledrejection: '+String(event.reason)));
    document.addEventListener('click',event=>{const el=event.target.closest('button,summary,[data-act],[role="button"],[data-scene-view],[data-landscape-motion],[data-scene-time],[data-scene-preset],[data-location-action]');if(el&&event.isTrusted){window.__buttonHeartbeat.clickAt=performance.now();delete window.__buttonHeartbeat.firstFrameAfterClickMs;const receipt={at:performance.timeOrigin+performance.now(),action:key(el),trusted:true,offeredTaskId:key(el)==='act:yes'?state.candidateId:null};window.__buttonNativeClicks.push(receipt);void window.__buttonClicked(receipt);}},true);
    const scan=()=>{if(document.documentElement){const els=[...document.querySelectorAll('button,summary,[data-act],[role="button"],[data-scene-view],[data-landscape-motion],[data-scene-time],[data-scene-preset],[data-location-action]')];void window.__buttonObserved(els.map(key).filter(value=>value!==null));for(const el of els)if(key(el)?.startsWith('button-id:'))void window.__buttonUnidentified(el.outerHTML.slice(0,1000));}};
    addEventListener('DOMContentLoaded',()=>{scan();new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});});
   },{keySource:actionFor.toString()});
   if(startupCapture==='jpeg')await bounded(beginStartupCapture(),'startup public screencast start');
   if(startupCapture==='timeline')await bounded(startNativeTimelineCapture({page,outputDir,...(startupRetentionProfile===undefined?{}:{retentionProfile:startupRetentionProfile}),sourceURL:origin+prefix+'__startup-diagnostic__/clock-init.js',onStop:stop=>{stopStartupCapture=stop;},onSave:capture=>{report.startupCapture=capture;if(ordinaryTimeline&&capture.instrumentation){diagnosticSources.set(new URL(capture.instrumentation.url).pathname,capture.instrumentation.content);retainSource(capture.instrumentation.url,capture.instrumentation.content,'instrumentation');}save();if(capture.errors.length&&!interrupted){interrupted='native Timeline diagnostic: '+capture.errors[0];closing=true;void(async()=>{await stopStartupCapture?.('native-diagnostic-error');})().catch(error=>{report.errors.push('native diagnostic abort cleanup: '+String(error));});}}}),'startup native Timeline start');
   if(interrupted)throw Error('Startup capture interrupted: '+interrupted);
   await page.goto(origin+prefix);if(interrupted)throw Error('Startup capture interrupted: '+interrupted);await page.waitForFunction(()=>typeof state!=='undefined'&&state&&window.ScannerDeviceStore);await page.waitForFunction(()=>window.CloudSync?.ready);if(mobileYesMotion)await page.waitForFunction(motion=>document.documentElement.dataset.landscapeMotion===motion,mobileYesMotion,{timeout:12000});localArmed=true;
   const setup=await bounded((async()=>{for(let attempt=0;attempt<200;attempt++){
    const result=await evalPage(async({captureFixtureMode,waitForSavedDecision})=>{const head=await ScannerDeviceStore.readHead();if(waitForSavedDecision&&!(CloudSync?.ready===true&&CloudSync.user==='fixture@example.invalid'&&CloudSync.status==='ok'&&state.syncDirty===false&&!pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy&&head?.payload===JSON.stringify(state)&&state.syncAccount==='fixture@example.invalid'&&state.syncIdentity==='owner'&&state.syncRev===4))return null;return{currentTasks:state.tasks.length,activeTasks:state.tasks.filter(task=>!task.done).length,durableTasks:head?.payload?JSON.parse(head.payload).tasks.length:0,durableHash:head?.hash,...(captureFixtureMode?{authMode:window.__installedFixture?.authMode}:{})};},{captureFixtureMode:Boolean(scenarioFixture),waitForSavedDecision:name==='ordinary repeated saved decision choice'});
    if(result&&result.currentTasks===(startupOpening?64:fixtureTaskCount)&&result.durableTasks===(startupOpening?64:fixtureTaskCount)){
     const row={...result,fixtureRole};
     if(scenarioFixture){
      assert.equal(row.authMode,fixtureMode,'Ordinary page retained the installed auth fixture: '+name);
      row.source=fixtureSourceForAuthMode[row.authMode];
     }
     return row;
    }
    await new Promise(resolve=>setTimeout(resolve,25));
   }throw Error('Independent saved-board setup did not reach durable storage');})(),startupOpening?'ordinary saved-board durable setup':fixtureTaskCount+'-task durable setup',12000);
   const prepareReleaseSurface=async()=>{
    const receipt=await bounded(evalPage(async identity=>{
     const sink=document.createElement('iframe');sink.id='__buttonReleaseSink';sink.title='Native test release surface';sink.hidden=true;
     sink.srcdoc='<!doctype html><style>html,body{margin:0;width:100%;height:100%}</style>';
     sink.style.cssText='position:fixed;left:0;top:0;width:8px;height:8px;border:0;margin:0;padding:0;inset:auto;z-index:2147483647';
     const layer=document.createElement('dialog');layer.id='__buttonReleaseLayer';layer.style.cssText='position:fixed;width:8px;height:8px;max-width:none;max-height:none;margin:0;padding:0;border:0;inset:auto;overflow:hidden';document.body.append(layer);
     await new Promise(resolve=>{sink.addEventListener('load',resolve,{once:true});layer.append(sink);});
     sink.contentWindow.__buttonReleaseDocumentId=identity;
     return{documentId:identity,readyState:sink.contentDocument.readyState};
    },randomUUID()),'prepare neutral release document');
    assert.equal(receipt.readyState,'complete','The isolated release document is loaded before input');
    report.releaseSurfaces??=[];report.releaseSurfaces.push({scenario:name,...receipt});
   };
   if(!mobileYesMotion)await prepareReleaseSurface();
   if(options.writeFailAfterReady)await evalPage(()=>window.__buttonRefuseWrites=true);
   if(options.readFailAfterReady)await evalPage(()=>window.__buttonRefuseReads=true);
   if(options.downloadFail)await evalPage(()=>{URL.createObjectURL=()=>{throw new DOMException('Synthetic download refused','NotAllowedError');};});
   const expose=async selector=>{
    // Open each actual ancestor disclosure through its native summary consumer.
    const indexes=await evaluateElement(selector,el=>{const all=[...document.querySelectorAll('details')],rows=[];for(let p=el.parentElement;p;p=p.parentElement)if(p.matches('details')&&!p.open&&!(el.matches('summary')&&el.parentElement===p))rows.unshift(all.indexOf(p));return rows;});
    for(const index of indexes){await step('details >> nth='+index+' >> :scope > summary',new Function('return document.querySelectorAll("details")['+index+']?.open===true'),'Expand containing disclosure');}
   };
   const waitFor=async(expect,timeoutMs=2500,label='expected state')=>bounded((async()=>{while(true){
    try{if(await evalPage(expect)===true)return;}
    catch(error){
     // A permitted reload can retire the context between click and readback.
     // Only that transient driver failure is retried; navigation accounting,
     // page errors, durable outcomes and the original deadline remain required.
     if(!allowedNavigation||!/Execution context was destroyed, most likely because of a navigation/.test(error.message))throw error;
     check();
    }
    await new Promise(resolve=>setTimeout(resolve,25));
   }})(),label,timeoutMs);
   const step=async(selector,expect,description=selector,clickOptions={})=>{
    await expose(selector);const target=page.locator(selector).first();
    const action=await evaluateElement(selector,actionFor);assert.ok(action,'Passive inert appearance replicas cannot earn action coverage');const before=report.clicks?.length||0;
    const opening=await bounded(evalPage(()=>({...window.__buttonHeartbeat})),'opening heartbeat');
    if(opening.inputAt===null&&!(report.presses||[]).length&&opening.maxGapMs>=1000){
     report.samples??=[];report.samples.push({scenario:name,action,phase:'opening-before-input',openingMaxFrameGapMs:opening.maxGapMs,preInputMaxFrameGapMs:opening.preInputMaxGapMs,inputMaxFrameGapMs:opening.inputMaxGapMs,firstTrustedInputAt:null,inputStatus:'not-reached'});
     throw Error('Native button safety detected blocked opening frame loop');
    }
    await bounded(evalPage(()=>{window.__buttonHeartbeat.maxGapMs=0;window.__buttonHeartbeat.at=performance.now();window.__buttonHeartbeat.inputArmed=true;window.__buttonHeartbeat.inputAt=null;window.__buttonHeartbeat.inputMaxGapMs=0;window.__buttonHeartbeat.preInputMaxGapMs=0;return window.__buttonHeartbeat.frames;}),'preclick heartbeat');const started=Date.now();
    await bounded(mobileYesMotion?target.tap(clickOptions):target.click(clickOptions),name+' / '+description);
    if(expect)await waitFor(expect,control==='async-pending'||control==='async-predicate-false'?2500:12000,'outcome '+description);
    else assert.fail('Every button step requires an independent expected outcome: '+description);
    if(name==='ordinary two distinct scanner decisions'){
     assert.ok(report.inFlightRepeat,'The two-input source observation belongs to the existing ordinary repeat');
     report.inFlightRepeat.currentObservation=await bounded(evalPage(()=>{
      const candidates=document.querySelectorAll('#scan .card.cand .title'),benchmarks=document.querySelectorAll('#scan .card.bench .title'),buttons=document.querySelectorAll('#scan [data-act="yes"]'),candidate=candidates[0],benchmark=benchmarks[0],yes=buttons[0],c=candidate?.getBoundingClientRect(),b=benchmark?.getBoundingClientRect(),y=yes?.getBoundingClientRect();
      const afterCurrent=JSON.stringify(state);
      return{afterCurrent,targetAcknowledgement:{documentId:window.__installedFixture.documentId,observedAtMs:performance.timeOrigin+performance.now(),
       candidate:{count:candidates.length,text:candidate?.textContent.trim()??null,connected:candidate?.isConnected??false,visible:!!(c?.width&&c?.height)&&getComputedStyle(candidate).visibility!=='hidden'},
       benchmark:{count:benchmarks.length,text:benchmark?.textContent.trim()??null,connected:benchmark?.isConnected??false,visible:!!(b?.width&&b?.height)&&getComputedStyle(benchmark).visibility!=='hidden'},
       yes:{count:buttons.length,candidate:yes?.dataset.candidate??null,benchmark:yes?.dataset.benchmark??null,connected:yes?.isConnected??false,disabled:yes?.disabled??null,visible:!!(y?.width&&y?.height)&&getComputedStyle(yes).visibility!=='hidden'}}};
     }),'ordinary distinct complete current and useful visible DOM observation');
    }
    await bounded(evalPage(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(true)))),'frame '+description);
    if(name!=='ordinary two distinct scanner decisions')await new Promise(resolve=>setTimeout(resolve,30));check();
    const heartbeat=await bounded(evalPage(()=>({...window.__buttonHeartbeat})),'continuous heartbeat');
    report.samples??=[];report.samples.push({scenario:name,action,elapsedMs:Date.now()-started,maxFrameGapMs:heartbeat.maxGapMs,preInputMaxFrameGapMs:heartbeat.preInputMaxGapMs,inputMaxFrameGapMs:heartbeat.inputMaxGapMs,firstTrustedInputAt:heartbeat.inputAt===null?null:heartbeat.timeOrigin+heartbeat.inputAt,eventToFirstFrameMs:heartbeat.firstFrameAfterClickMs});
    // Preserve the complete-step threshold. Separate phases explain a cold or
    // actionability stall without resetting it away or charging it to a handler.
    assert.ok(heartbeat.maxGapMs<1000,'Native button safety detected blocked frame loop: '+(heartbeat.preInputMaxGapMs>=1000&&heartbeat.inputMaxGapMs<1000?'pre-input / ':'')+description+' '+heartbeat.maxGapMs+'ms');
    assert.ok((report.clicks||[]).slice(before).some(row=>row.action===action),'Trusted native click observed: '+description);
    const row=outcomes.get(action)||{action,status:'passed',events:['click'],assertions:0,responsive:true,steps:[]};row.assertions++;report.outcomes=[...outcomes.values(),...(outcomes.has(action)?[]:[row])];row.steps.push({scenario:name,description,elapsedMs:Date.now()-started,maxFrameGapMs:heartbeat.maxGapMs,frames:heartbeat.frames});outcomes.set(action,row);return action;
   };
   const nativeInput=async(kind,selector,value)=>{
    await expose(selector);const target=page.locator(selector);await evalPage(()=>{window.__buttonHeartbeat.maxGapMs=0;window.__buttonHeartbeat.at=performance.now();});const started=Date.now();
    await bounded(kind==='fill'?target.fill(value):target.selectOption(value),kind+' '+selector);
    assert.equal(await target.inputValue(),value,'Native '+kind+' exact draft value: '+selector);
    await bounded(evalPage(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()))),'input frame '+selector);check();
    const heartbeat=await bounded(evalPage(()=>({...window.__buttonHeartbeat})),'input heartbeat '+selector);report.inputSamples??=[];report.inputSamples.push({kind,selector,characters:value.length,elapsedMs:Date.now()-started,maxFrameGapMs:heartbeat.maxGapMs});assert.ok(heartbeat.maxGapMs<1000,'Native button safety detected blocked input frame loop: '+selector+' '+heartbeat.maxGapMs+'ms');
   };
   const pasteBoundary=async(selector,value,expect)=>{
    await expose(selector);const target=page.locator(selector);await bounded(target.focus(),'paste focus');
    // Clipboard population is fixture setup, like the existing native file
    // chooser buffer. Keep full protocol ingress separate from user dispatch.
    const preparedAt=Date.now(),sha256=digest(value),characters=value.length;
    const prepare=async route=>evalPage(async({sha256,characters,route})=>{
     const text=route==='page-held-copy'?window.__buttonClipboard?.findLast(raw=>typeof raw==='string'&&raw.length===characters):window.__buttonPasteFixture;
     if(typeof text!=='string'||text.length!==characters)return null;
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
     if(hash!==sha256)return null;window.__buttonPasteFixture=text;return{route,characters,sha256:hash,verified:true};
    },{sha256,characters,route});
    let preparation=await bounded(prepare('page-held-copy'),'clipboard fixture Copy identity');
    if(!preparation){await bounded(evalPage(text=>{window.__buttonPasteFixture=text;},value),'clipboard fixture complete ingress');preparation=await bounded(prepare('staged-complete-text'),'clipboard fixture ingress identity');}
    assert.ok(preparation,'Complete clipboard fixture must match independently hashed source bytes');
    preparation.elapsedMs=Date.now()-preparedAt;preparation.boundary='fixture preparation; excluded from consumer frame budget';
    try{
     await evalPage(()=>{window.__buttonHeartbeat.maxGapMs=0;window.__buttonHeartbeat.at=performance.now();});const started=Date.now();
     const receipt=await bounded(target.evaluate(box=>{const text=window.__buttonPasteFixture;const data=new DataTransfer();data.setData('text/plain',text);const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});box.dispatchEvent(event);return{trusted:event.isTrusted,prevented:event.defaultPrevented,characters:data.getData('text/plain').length};}),'clipboard event boundary '+selector);
     assert.equal(receipt.trusted,false,'Isolated clipboard input is explicitly a simulated external boundary');assert.equal(receipt.characters,characters,'Complete clipboard source reaches the actual consumer');assert.equal(receipt.prevented,true,'Large paste must bypass native multiline insertion');
     await waitFor(expect,12000,'clipboard paste outcome');await bounded(evalPage(()=>new Promise(resolve=>requestAnimationFrame(resolve))),'paste frame');check();
     const heartbeat=await bounded(evalPage(()=>({...window.__buttonHeartbeat})),'paste heartbeat');report.inputSamples??=[];report.inputSamples.push({kind:'clipboard-event-boundary',selector,...receipt,fixturePreparation:preparation,elapsedMs:Date.now()-started,maxFrameGapMs:heartbeat.maxGapMs});assert.ok(heartbeat.maxGapMs<1000,'Native button safety detected blocked paste frame loop: '+heartbeat.maxGapMs+'ms');
    }finally{await bounded(evalPage(()=>{delete window.__buttonPasteFixture;}),'clipboard fixture release');}
   };
   const burst=async(actionName,expect,{selector,semantics,expectedAccepted=10,reload=false}={})=>{
    assert.ok(typeof semantics==='string'&&semantics.length>=10,'Explicit independent repeated-effect semantics required');
    selector??='[data-act="'+actionName+'"]';if(!selector.startsWith('#')&&await page.locator('#modalRoot '+selector).count())selector='#modalRoot '+selector;
    await expose(selector);const target=page.locator(selector).first();
    const originalBox=await bounded((async()=>{for(;;){
     try{await target.scrollIntoViewIfNeeded();return await target.boundingBox();}
     catch(error){if(!/Element is not attached to the DOM/.test(error.message))throw error;check();await new Promise(resolve=>setTimeout(resolve,25));}
    }})(),'rapid target scroll');assert.ok(originalBox,'Rapid target is initially rendered');
    const action=await evaluateElement(selector,actionFor);assert.ok(action===actionName||action==='act:'+actionName,'Rapid target action must match independent family');
    await evalPage(()=>{window.__buttonHeartbeat.maxGapMs=0;window.__buttonHeartbeat.at=performance.now();});const start={presses:report.presses?.length||0,clicks:report.clicks?.length||0};
    const previousDocument=reload?await evalPage(()=>window.__installedFixture.documentId):null;if(reload)allowedNavigation={url:page.url(),remaining:1,action};
    const attempts=[];report.inFlightBurst={scenario:name,action,attempts};const began=Date.now();
    for(let index=0;index<10;index++){
     // Keep a realistic ten-per-second cadence inside the unchanged two-second
     // burst bound. It lets normal button styling settle between real presses.
     const cadenceDelay=began+index*100-Date.now();if(cadenceDelay>0)await new Promise(resolve=>setTimeout(resolve,cadenceDelay));
     let availability={present:false,disabled:false,hit:false},box=originalBox;
     const snapshot=await bounded(target.evaluateAll((els,backdrop)=>{
      const el=els[0];if(!el)return null;let r=el.getBoundingClientRect();
      if(r.width&&r.height&&(r.y<0||r.x<0||r.bottom>innerHeight||r.right>innerWidth)&&!el.closest('[inert]')){el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});r=el.getBoundingClientRect();}
      // Do not force a complete paint between rapid presses. The independent
      // continuous heartbeat and post-burst frame check measure responsiveness;
      // current hit testing plus the actual delivered down bind each press.
      if(!el.isConnected)return null;r=el.getBoundingClientRect();
      const box={x:r.x,y:r.y,width:r.width,height:r.height};
      const hit=document.elementFromPoint(r.x+(backdrop?5:r.width/2),r.y+(backdrop?5:r.height/2));
      // A harmless subpixel width transition is not an unavailable button.
      // Current hit testing and the delivered-down check decide eligibility.
      return{box,present:!!(r.width&&r.height),disabled:el.matches(':disabled'),hit:!!hit&&(el===hit||el.contains(hit))};
     },action==='act:mback'),'rapid target availability');
     if(snapshot){availability=snapshot;if(snapshot.present)box=snapshot.box;}
     const before={clicks:report.clicks?.length||0,presses:report.presses?.length||0};
     const pressPoint=availability.present&&availability.hit?{x:box.x+(action==='act:mback'?5:box.width/2),y:box.y+(action==='act:mback'?5:box.height/2)}:{x:originalBox.x+originalBox.width/2,y:originalBox.y+originalBox.height/2};
     if(availability.disabled)await bounded(evalPage(point=>{
      // WebKit can suppress even a captured pointerdown on a disabled button.
      // An independently observed disabled target earns only a refused attempt:
      // receive the trusted down on a neutral marker at that same point.
      const marker=document.createElement('span');marker.id='__buttonDisabledAttempt';marker.style.cssText='position:fixed;left:'+(point.x-2)+'px;top:'+(point.y-2)+'px;width:4px;height:4px;z-index:2147483647';(document.querySelector('dialog[open]')||document.body).append(marker);
     },pressPoint),'rapid disabled refusal marker');
     let down,neutralDocumentId=null;
     if(mobileYesMotion){
      assert.ok(availability.present&&availability.hit&&!availability.disabled,'Mobile Yes must remain an enabled current touch target');
      await bounded(page.touchscreen.tap(pressPoint.x,pressPoint.y),'rapid native touch '+actionName);
      down=await bounded(evalPage(()=>{const receipt=window.__buttonNativePresses.at(-1);return{action:receipt?.action,canRelease:receipt?.pointerType==='touch'&&receipt?.trusted===true};}),'rapid delivered touch');
      assert.equal(down.action,action,'Actual native touch must reach the requested action');
     }else{
     await bounded((async()=>{await page.mouse.move(pressPoint.x,pressPoint.y);await page.mouse.down();})(),'rapid native down '+actionName);
     // The browser's delivered down is authoritative. If an asynchronous
     // replacement wins the final coordinate race, release neutrally just as
     // for an already absent control; never click a different app action.
     down=await bounded(evalPage(({point,action})=>{const el=window.__buttonNativeDownTarget,hit=document.elementFromPoint(point.x,point.y),receipt=window.__buttonNativePresses.at(-1);return{action:receipt?.action,canRelease:receipt?.action===action&&!!el?.isConnected&&(hit===el||el.contains(hit))};},{point:pressPoint,action}),'rapid delivered down');
     if(availability.present&&availability.hit&&!availability.disabled&&down.canRelease)await bounded(page.mouse.up(),'rapid native release '+actionName);
     else{
      // Chromium can clamp an outside-viewport release onto the modal backdrop
      // and synthesize a different click. Release in a separate neutral document
      // in the top layer above any open modal; prepare it once per document,
      // then reveal only for a refused
      // release. The app still records every trusted attempted down.
      // Put the prepared release document under the existing pointer. A held
      // mouse move invokes Playwright drag interception across every frame;
      // it is controller work and is unnecessary for a separate-document up.
      neutralDocumentId=await bounded(evalPage(point=>{const sink=document.getElementById('__buttonReleaseSink');if(!sink?.isConnected||sink.contentDocument?.readyState!=='complete'||!sink.contentWindow.__buttonReleaseDocumentId)throw Error('Prepared neutral release document unavailable');const layer=document.getElementById('__buttonReleaseLayer');layer.style.left=(point.x-4)+'px';layer.style.top=(point.y-4)+'px';sink.style.left=(point.x-4)+'px';sink.style.top=(point.y-4)+'px';sink.hidden=false;layer.showModal();return sink.contentWindow.__buttonReleaseDocumentId;},pressPoint),'rapid release surface');
      await bounded((async()=>{await page.mouse.up();await evalPage(()=>{const sink=document.getElementById('__buttonReleaseSink');if(sink){document.getElementById('__buttonReleaseLayer').close();sink.hidden=true;}document.getElementById('__buttonDisabledAttempt')?.remove();});})(),'rapid refused press '+actionName);
     }
     }
     if(reload&&index===0){await bounded(page.waitForFunction(old=>window.__installedFixture?.documentId!==old&&document.documentElement.dataset.appReady==='true',previousDocument),'rapid bounded reload',2000);assert.equal(allowedNavigation.remaining,0,'Exactly one expected rapid reload');allowedNavigation=null;if(!mobileYesMotion)await prepareReleaseSurface();}
     await bounded(evalPage(()=>true),'rapid native receipt');const recentClicks=(report.clicks||[]).slice(before.clicks);const unrelated=recentClicks.filter(row=>row.action!==null&&row.action!==action);assert.deepEqual(unrelated,[],'Rapid attempt activated a different app action');const received={presses:(report.presses||[]).slice(before.presses),clicks:recentClicks.filter(row=>row.action===action)};
     attempts.push({index,availability,nativeDownAction:down.action,neutralDocumentId,neutralRelease:!availability.present||!availability.hit||availability.disabled||!down.canRelease,trustedPresses:received.presses.length,acceptedClicks:received.clicks.length,classification:received.clicks.length?'accepted':availability.present?'refused':'disappeared',at:received.presses[0]?.at});
    }
    const finished=Date.now();report.inFlightBurst.windowMs=finished-began;const presses=(report.presses||[]).slice(start.presses);
    assert.equal(presses.length,10,'Ten browser-trusted native press receipts: '+actionName);
    assert.ok(finished-began<=2000,'Ten native press attempts must finish within two seconds: '+actionName+' '+(finished-began)+'ms');
    await waitFor(expect,12000,'rapid outcome '+actionName);await bounded(evalPage(()=>new Promise(resolve=>requestAnimationFrame(resolve))),'rapid response '+actionName);check();
    const heartbeat=await evalPage(()=>({...window.__buttonHeartbeat}));assert.ok(heartbeat.maxGapMs<1000,'Rapid button action blocked frame loop: '+actionName+' '+heartbeat.maxGapMs+'ms');
    const acceptedClicks=attempts.reduce((sum,row)=>sum+row.acceptedClicks,0),refused=attempts.filter(row=>row.classification==='refused').length,disappeared=attempts.filter(row=>row.classification==='disappeared').length;
    if(typeof expectedAccepted==='number')assert.equal(acceptedClicks,expectedAccepted,'Independent accepted native click count: '+actionName);
    else assert.ok(acceptedClicks>=expectedAccepted.min&&acceptedClicks<=expectedAccepted.max,'Independent accepted native click bounds: '+actionName);
    const row=rapidOutcomes.get(action)||{action,status:'passed',responsive:true,assertions:0,bursts:[]};row.assertions++;
    row.bursts.push({scenario:name,attempts:10,trustedPresses:presses.length,unrelatedClicks:0,windowMs:finished-began,browserWindowMs:presses.at(-1).at-presses[0].at,acceptedClicks,refused,disappeared,semantics,maxFrameGapMs:heartbeat.maxGapMs,attemptDetails:attempts});rapidOutcomes.set(action,row);report.rapidOutcomes=[...rapidOutcomes.values()];
    const normal=outcomes.get(action)||{action,status:'passed',events:['click'],assertions:0,responsive:true,steps:[]};normal.assertions++;normal.steps.push({scenario:name,description:'Rapid '+semantics,elapsedMs:finished-began,maxFrameGapMs:heartbeat.maxGapMs});outcomes.set(action,normal);report.outcomes=[...outcomes.values()];
    delete report.inFlightBurst;return row.bursts.at(-1);
   };
   const writeOrdinaryUndoSource=(phase,snapshot)=>{
    assert.equal(name,'ordinary Undo consumes two saved edit frames','Full Undo phases belong only to the admitted ordinary case');
    assert.equal(selectedProfile,'ordinary');
    const file='ordinary-undo-'+phase+'.json',artifact={schemaVersion:1,phase,scenario:name,
      sourceIdentity:{candidateCommit,candidateTree,inventorySha256:digest(inventoryBytes)},...snapshot};
    const bytes=JSON.stringify(artifact,null,2)+'\n';fs.writeFileSync(path.join(outputDir,file),bytes,{flag:'wx'});
    return{phase,file,sha256:digest(bytes),bytes:Buffer.byteLength(bytes),currentHash:snapshot.currentHash,durableHash:snapshot.durableHash,
      currentBytes:Buffer.byteLength(snapshot.current),durableBytes:Buffer.byteLength(snapshot.durable)};
   };
   const recordOrdinaryUndoPhase=(phase,snapshot)=>{
    const order=['B0','B1','B2','U1','U2'];report.ordinaryUndoPhases??=[];
    assert.equal(phase,order[report.ordinaryUndoPhases.length],'Retain each complete ordinary Undo phase once and in order');
    assert.equal(typeof snapshot.current,'string');assert.equal(typeof snapshot.durable,'string');
    assert.equal(snapshot.currentHash,digest(snapshot.current));assert.equal(snapshot.durableHash,digest(snapshot.durable));
    report.ordinaryUndoPhases.push(writeOrdinaryUndoSource(phase,snapshot));save();
   };
   const recordOrdinaryUndoSeedSource=snapshot=>{
    assert.equal(report.ordinaryUndoSeedSource,undefined,'Retain the original seeded Undo sources exactly once');
    report.ordinaryUndoSeedSource=writeOrdinaryUndoSource('seed-source',snapshot);save();
   };
   const recordOrdinaryUndoFinalSource=snapshot=>{
    assert.equal(report.ordinaryUndoFinalSource,undefined,'Retain the final Undo sources exactly once');
    // Write before semantic/hash assertions so mismatches retain their actual values.
    report.ordinaryUndoFinalSource=writeOrdinaryUndoSource('final-source',snapshot);save();
   };
   const topLayerProbe=probe&&control==='top-layer-release'&&name==='detector sensitivity';
   const topLayerDefinition=topLayerProbe?{name:'detector sensitivity',file:'scripts/button-safety-native.mjs',actionFamilies:['act:scene-time-settings'],minimumAttempts:2,assertionId:'ordinary-top-layer-intended-target-refusal',expected:'Two intended scene opener attempts accept the first and neutrally refuse the genuinely covered second; the real overlapping preset receives no click and every complete saved source stays exact.'}:null;
   const captureTopLayerPhase=async phase=>{
    assert.ok(topLayerProbe,'The complete source observer belongs only to the named ordinary probe');
    const snapshot=await page.evaluate(async()=>{
     const head=await ScannerDeviceStore.readHead(),current=JSON.stringify(state),sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
     const settingsOpen=!!document.querySelector('#modalRoot .settings-section'),timeDialogOpen=document.getElementById('sceneTimeDialog')?.open===true;let geometry=null;
     if(settingsOpen){
      const selector='#modalRoot [data-act="scene-time-settings"]',els=document.querySelectorAll(selector),el=els[0],r=el.getBoundingClientRect(),box={x:r.x,y:r.y,width:r.width,height:r.height},point={x:r.x+r.width/2,y:r.y+r.height/2},hit=document.elementFromPoint(point.x,point.y),hitControl=hit?.closest('button,summary,[data-act],[role="button"]');
      const presetSelector='#sceneTimeDialog[open] [data-scene-preset="first-light"]',presets=document.querySelectorAll(presetSelector),preset=presets[0],p=preset?.getBoundingClientRect();
      geometry={point,opener:{selector,count:els.length,connected:el.isConnected,visible:!!(r.width&&r.height),disabled:el.matches(':disabled'),box},preset:preset?{selector:presetSelector,count:presets.length,connected:preset.isConnected,visible:!!(p.width&&p.height),box:{x:p.x,y:p.y,width:p.width,height:p.height}}:null,hitAction:hitControl?.dataset.act?'act:'+hitControl.dataset.act:hitControl?.dataset.scenePreset?'scene-preset:'+hitControl.dataset.scenePreset:null,covered:!!preset&&!!hit&&(hit===preset||preset.contains(hit))};
     }
     const snapshot={current,currentHash:await sha256(current),durable:head.payload,durableHash:head.hash,capturedAtMs:Date.now(),backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),pending:await ScannerDeviceStore.getPendingUpload('gate-owner'),pendingOwner:await ScannerDeviceStore.getPendingUpload('owner'),hold:await ScannerDeviceStore.getRecoveryCloudHold(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      view:{documentId:window.__installedFixture.documentId,authMode:window.__installedFixture.authMode,ready:document.documentElement.dataset.appReady==='true',sceneReady:typeof window.applySyncedSceneTime==='function',sceneTime:LivingSky.readSceneTime(localStorage),sceneSeason:LivingSky.readSceneSeason(localStorage),sceneIntents:Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).filter(key=>key.startsWith('fvp:chain-scanner:pending-scene-choice:v1:')).sort().map(key=>({key,raw:localStorage.getItem(key)})),settingsOpen,timeDialogOpen,geometry},presses:structuredClone(window.__buttonNativePresses),clicks:structuredClone(window.__buttonNativeClicks)};
     snapshot.capturedAtMs=Date.now();return{...snapshot,sourceValueEncoding:'chain-scanner.manual-archive-value/v1',sourceValue:encodeManualArchiveValue(snapshot,'ordinary top-layer sourceSnapshot')};
    });
    recordOrdinaryWoopPhase(phase,snapshot);return snapshot;
   };
   const repeat=async(actionFamily,attemptCount,expect,selector,description)=>{
    const definition=topLayerProbe?topLayerDefinition:profileDefinition.requiredRepeatCases?.find(row=>row.name===name);
    assert.ok(definition,'Independent ordinary repeat definition required: '+name);
    assert.ok(definition.actionFamilies.includes(actionFamily),'Ordinary repeat action belongs to its selected case: '+name);
    assert.ok(Number.isSafeInteger(attemptCount)&&attemptCount>=definition.minimumAttempts,'Required ordinary native repeat attempts: '+name);
    const attempts=[];report.inFlightRepeat={scenario:name,actionFamily,attempts};
    for(let index=0;index<attemptCount;index++){
     const before={presses:report.presses?.length||0,clicks:report.clicks?.length||0};
     if(topLayerProbe&&index===1){
      const target=page.locator(selector).first();
      const availability=await bounded(target.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{box:{x:r.x,y:r.y,width:r.width,height:r.height},present:!!(r.width&&r.height),disabled:el.matches(':disabled'),hit:!!hit&&(el===hit||el.contains(hit))};}),'ordinary top-layer covered target');
      assert.ok(availability.present&&!availability.disabled&&!availability.hit,'The second intended opener is really covered, present and enabled');
      const pressPoint={x:availability.box.x+availability.box.width/2,y:availability.box.y+availability.box.height/2};
      await bounded((async()=>{await page.mouse.move(pressPoint.x,pressPoint.y);await page.mouse.down();})(),'ordinary top-layer native down');
      const down=await bounded(page.evaluate(()=>({action:window.__buttonNativePresses.at(-1)?.action})),'ordinary top-layer delivered down');
      assert.equal(down.action,'scene-preset:first-light','The real overlapping preset receives the actual native down');
      const neutralDocumentId=await bounded(page.evaluate(point=>{const sink=document.getElementById('__buttonReleaseSink');if(!sink?.isConnected||sink.contentDocument?.readyState!=='complete'||!sink.contentWindow.__buttonReleaseDocumentId)throw Error('Prepared neutral release document unavailable');const layer=document.getElementById('__buttonReleaseLayer');layer.style.left=(point.x-4)+'px';layer.style.top=(point.y-4)+'px';sink.style.left=(point.x-4)+'px';sink.style.top=(point.y-4)+'px';sink.hidden=false;layer.showModal();return sink.contentWindow.__buttonReleaseDocumentId;},pressPoint),'ordinary top-layer release surface');
      await bounded((async()=>{await page.mouse.up();await page.evaluate(()=>{const sink=document.getElementById('__buttonReleaseSink');if(sink){document.getElementById('__buttonReleaseLayer').close();sink.hidden=true;}});})(),'ordinary top-layer refused release');
      await bounded(page.evaluate(()=>true),'ordinary top-layer native receipt');const presses=(report.presses||[]).slice(before.presses),clicks=(report.clicks||[]).slice(before.clicks);assert.equal(presses.length,1,'One actual trusted down for the covered intended opener');assert.deepEqual(clicks,[],'A neutrally refused covered target produces no preset or other app click');const press=presses[0];assert.equal(press.scenario,name);assert.equal(press.action,'scene-preset:first-light');assert.equal(press.trusted,true);assert.equal(press.pointerType,'mouse');assert.ok(Number.isFinite(press.at)&&press.at>=0);await waitFor(expect,12000,'ordinary top-layer stays open after neutral refusal');check();
      attempts.push({receiptId:name+':'+randomUUID(),actionFamily,trusted:true,result:'refused',receiptAtMs:press.at,nativeRefusal:{index,availability,nativeDownAction:down.action,neutralDocumentId,neutralRelease:true,trustedPresses:presses.length,acceptedClicks:clicks.length,classification:'refused',at:press.at}});await captureTopLayerPhase('refused');save();continue;
     }
     if(name==='ordinary pending Copy refuses reentry'&&index===1){
      // The existing disabled-target marker/down/separate-document release
      // boundary records a real refused attempt without forging an app click.
      const target=page.locator(selector).first();
      const availability=await bounded(target.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{box:{x:r.x,y:r.y,width:r.width,height:r.height},present:!!(r.width&&r.height),disabled:el.matches(':disabled'),hit:!!hit&&(el===hit||el.contains(hit))};}),'ordinary pending Copy disabled target');
      assert.ok(availability.present&&availability.hit&&availability.disabled,'The second Copy attempt targets the actually disabled current control');
      const pressPoint={x:availability.box.x+availability.box.width/2,y:availability.box.y+availability.box.height/2};
      await bounded(page.evaluate(point=>{const marker=document.createElement('span');marker.id='__buttonDisabledAttempt';marker.style.cssText='position:fixed;left:'+(point.x-2)+'px;top:'+(point.y-2)+'px;width:4px;height:4px;z-index:2147483647';(document.querySelector('dialog[open]')||document.body).append(marker);},pressPoint),'ordinary disabled refusal marker');
      await bounded((async()=>{await page.mouse.move(pressPoint.x,pressPoint.y);await page.mouse.down();})(),'ordinary pending Copy native down');
      const down=await bounded(page.evaluate(()=>{const receipt=window.__buttonNativePresses.at(-1);return{action:receipt?.action};}),'ordinary pending Copy delivered down');
      const neutralDocumentId=await bounded(page.evaluate(point=>{const sink=document.getElementById('__buttonReleaseSink');if(!sink?.isConnected||sink.contentDocument?.readyState!=='complete'||!sink.contentWindow.__buttonReleaseDocumentId)throw Error('Prepared neutral release document unavailable');const layer=document.getElementById('__buttonReleaseLayer');layer.style.left=(point.x-4)+'px';layer.style.top=(point.y-4)+'px';sink.style.left=(point.x-4)+'px';sink.style.top=(point.y-4)+'px';sink.hidden=false;layer.showModal();return sink.contentWindow.__buttonReleaseDocumentId;},pressPoint),'ordinary pending Copy release surface');
      await bounded((async()=>{await page.mouse.up();await page.evaluate(()=>{const sink=document.getElementById('__buttonReleaseSink');if(sink){document.getElementById('__buttonReleaseLayer').close();sink.hidden=true;}document.getElementById('__buttonDisabledAttempt')?.remove();});})(),'ordinary pending Copy refused release');
      await bounded(page.evaluate(()=>true),'ordinary pending Copy native receipt');const presses=(report.presses||[]).slice(before.presses),clicks=(report.clicks||[]).slice(before.clicks);assert.equal(presses.length,1,'One actual trusted down for refused Copy');assert.deepEqual(clicks,[],'A refused Copy attempt produces no app click or unrelated action');const press=presses[0];assert.equal(press.scenario,name);assert.equal(press.action,null);assert.equal(press.trusted,true);assert.equal(press.pointerType,'mouse');assert.ok(Number.isFinite(press.at)&&press.at>=0);assert.equal(down.action,null);await waitFor(expect,12000,'ordinary pending Copy remains busy after refusal');check();
      attempts.push({receiptId:name+':'+randomUUID(),actionFamily,trusted:true,result:'refused',receiptAtMs:press.at,nativeRefusal:{index,availability,nativeDownAction:down.action,neutralDocumentId,neutralRelease:true,trustedPresses:presses.length,acceptedClicks:clicks.length,classification:'refused',at:press.at}});save();continue;
     }
     await step(selector,expect,description+' '+(index+1));
     const presses=(report.presses||[]).slice(before.presses),clicks=(report.clicks||[]).slice(before.clicks);
     assert.equal(presses.length,1,'One trusted native press receipt per ordinary repeat attempt: '+name);
     const press=presses[0];assert.equal(press.scenario,name);assert.equal(press.action,actionFamily);assert.equal(press.trusted,true);
     assert.ok(Number.isFinite(press.at)&&press.at>=0,'Actual native press timestamp required: '+name);
     assert.deepEqual(clicks.filter(row=>row.action!==null&&row.action!==actionFamily),[],'No unrelated native action during ordinary repeat: '+name);
     assert.equal(clicks.length,1,'One trusted matching click per ordinary repeat attempt: '+name);
     const click=clicks[0];assert.equal(click.scenario,name);assert.equal(click.action,actionFamily);assert.equal(click.trusted,true);
     assert.ok(Number.isFinite(click.at)&&click.at>=press.at,'Native click follows its trusted press: '+name);
     if(name==='ordinary two distinct scanner decisions')assert.ok(report.inFlightRepeat.currentObservation,'Complete in-memory current/target observation required after each accepted input');
     attempts.push({receiptId:name+':'+randomUUID(),actionFamily,trusted:true,result:'accepted',receiptAtMs:press.at,...(name==='ordinary two distinct scanner decisions'?report.inFlightRepeat.currentObservation:{})});
     if(name==='ordinary two distinct scanner decisions')delete report.inFlightRepeat.currentObservation;
     if(topLayerProbe&&index===0){
      // Move only the real rendered preset into the intended opener's current
      // coordinate. No app state, handler, source or synthetic click is changed.
      await bounded(page.evaluate(()=>{const opener=document.querySelector('#modalRoot [data-act="scene-time-settings"]'),dialog=document.querySelector('#sceneTimeDialog[open]'),preset=dialog?.querySelector('[data-scene-preset="first-light"]');if(!opener||!preset)throw Error('Actual opener and open scene preset required');const r=opener.getBoundingClientRect();preset.style.cssText='position:fixed;left:'+(r.x+r.width/2-20)+'px;top:'+(r.y+r.height/2-10)+'px;width:40px;height:20px;min-width:0;min-height:0;max-width:none;max-height:none;margin:0;padding:0;z-index:2147483647';}),'ordinary top-layer real preset overlap');
      await waitFor(()=>{const opener=document.querySelector('#modalRoot [data-act="scene-time-settings"]'),preset=document.querySelector('#sceneTimeDialog[open] [data-scene-preset="first-light"]');if(!opener||!preset)return false;const r=opener.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&(hit===preset||preset.contains(hit));},12000,'Actual real preset covers the intended opener point');
      await captureTopLayerPhase('opened');
     }
     if(name==='ordinary Undo consumes two saved edit frames'){
      const snapshot=await page.evaluate(index=>window.__ordinaryUndoSavedPhases?.[index],index);
      assert.ok(snapshot,'The completed native Undo input must retain its complete board phase');
      snapshot.currentHash=digest(snapshot.current);recordOrdinaryUndoPhase('U'+(index+1),snapshot);
     }
     if(name!=='ordinary two distinct scanner decisions')save();
    }
    if(name==='ordinary two distinct scanner decisions')save();
    return attempts;
   };
   const recordRepeatOutcome=(caseName,attempts,evidence)=>{
    const definition=topLayerProbe?topLayerDefinition:profileDefinition.requiredRepeatCases?.find(row=>row.name===caseName);
    assert.ok(definition,'Independent ordinary repeat definition required: '+caseName);assert.equal(caseName,name,'Repeat evidence is bound to the current scenario');
    assert.ok(Array.isArray(attempts)&&attempts.length>=definition.minimumAttempts,'Complete native repeat attempts required: '+caseName);
    assert.ok(typeof evidence==='string'&&evidence.trim().length>0,'Independent ordinary semantic evidence required: '+caseName);
    assert.ok(attempts.every(row=>definition.actionFamilies.includes(row.actionFamily)&&row.trusted===true&&
      ['accepted','refused','disappeared'].includes(row.result)&&Number.isFinite(row.receiptAtMs)&&row.receiptAtMs>=0),
      'Every ordinary repeat is bound to trusted source-owned native input: '+caseName);
    const receiptIds=attempts.map(row=>row.receiptId);assert.ok(receiptIds.every(id=>typeof id==='string'&&id.length>0));
    assert.equal(new Set(receiptIds).size,receiptIds.length,'Ordinary repeat receipt identifiers are unique: '+caseName);
    const accounting={attempted:attempts.length,accepted:0,refused:0,disappeared:0};
    for(const attempt of attempts)accounting[attempt.result]++;
    const outcome={name:caseName,status:'running',attempts,accounting,
      assertions:[{id:definition.assertionId,status:'passed',expected:definition.expected,evidence}],
      sourceIdentity:{candidateCommit,candidateTree,inventorySha256:digest(inventoryBytes),durableHash:setup.durableHash}};
    report.repeatOutcomes??=[];
    assert.equal(report.repeatOutcomes.some(row=>row.name===caseName),false,'One ordinary repeat outcome per selected case: '+caseName);
    report.repeatOutcomes.push(outcome);delete report.inFlightRepeat;save();
   };
   const recordOrdinaryWoopPhase=(phase,snapshot)=>{
    if(topLayerProbe){
     assert.equal(selectedProfile,'ordinary');const order=['seed','settings','opened','refused','final-source'];report.ordinaryTopLayerPhases??=[];assert.equal(phase,order[report.ordinaryTopLayerPhases.length],'Retain every complete top-layer source phase once in order');
     const file='ordinary-top-layer-release-'+phase+'.json',artifact={schemaVersion:1,phase,scenario:name,sourceIdentity:{candidateCommit,candidateTree,inventorySha256:digest(inventoryBytes)},...snapshot};
     const bytes=JSON.stringify(artifact,null,2)+'\n';fs.writeFileSync(path.join(outputDir,file),bytes,{flag:'wx'});report.ordinaryTopLayerPhases.push({phase,file,sha256:digest(bytes),bytes:Buffer.byteLength(bytes),currentHash:snapshot.currentHash,durableHash:snapshot.durableHash,currentBytes:Buffer.byteLength(snapshot.current),durableBytes:Buffer.byteLength(snapshot.durable)});save();return;
    }
    if(name==='ordinary obsolete Copy cannot alter replacement transfer'){
     assert.equal(selectedProfile,'ordinary');const order=['seed','settings-old','prepared-old','pending-old','closed','settings-new','prepared-new','pending-new','obsolete-settled','completed-new','final-source'];report.ordinaryObsoleteCopyPhases??=[];assert.equal(phase,order[report.ordinaryObsoleteCopyPhases.length],'Retain every complete old/replacement Copy source phase once in order');
     const file='ordinary-obsolete-copy-'+phase+'.json',artifact={schemaVersion:1,phase,scenario:name,sourceIdentity:{candidateCommit,candidateTree,inventorySha256:digest(inventoryBytes)},...snapshot};
     const bytes=JSON.stringify(artifact,null,2)+'\n';fs.writeFileSync(path.join(outputDir,file),bytes,{flag:'wx'});report.ordinaryObsoleteCopyPhases.push({phase,file,sha256:digest(bytes),bytes:Buffer.byteLength(bytes),currentHash:snapshot.currentHash,durableHash:snapshot.durableHash,currentBytes:Buffer.byteLength(snapshot.current),durableBytes:Buffer.byteLength(snapshot.durable)});save();return;
    }
    if(name==='ordinary pending Copy refuses reentry'){
     assert.equal(selectedProfile,'ordinary');const order=['seed','settings','prepared','pending-refused','completed','downloaded','final-source'];report.ordinaryPendingCopyPhases??=[];assert.equal(phase,order[report.ordinaryPendingCopyPhases.length],'Retain every complete pending Copy source phase once in order');
     const file='ordinary-pending-copy-'+phase+'.json',artifact={schemaVersion:1,phase,scenario:name,sourceIdentity:{candidateCommit,candidateTree,inventorySha256:digest(inventoryBytes)},...snapshot};
     const bytes=JSON.stringify(artifact,null,2)+'\n';fs.writeFileSync(path.join(outputDir,file),bytes,{flag:'wx'});report.ordinaryPendingCopyPhases.push({phase,file,sha256:digest(bytes),bytes:Buffer.byteLength(bytes),currentHash:snapshot.currentHash,durableHash:snapshot.durableHash,currentBytes:Buffer.byteLength(snapshot.current),durableBytes:Buffer.byteLength(snapshot.durable)});save();return;
    }
    if(name==='ordinary scene choice survives reopen and task Undo'){
     assert.equal(selectedProfile,'ordinary');const order=['seed','locked','closed','reopened','edit-one','edit-two','undone-two','final-source'];report.ordinarySceneChoicePhases??=[];assert.equal(phase,order[report.ordinarySceneChoicePhases.length],'Retain every complete scene/reopen/task-Undo source phase once in order');
     const file='ordinary-scene-choice-'+phase+'.json',artifact={schemaVersion:1,phase,scenario:name,sourceIdentity:{candidateCommit,candidateTree,inventorySha256:digest(inventoryBytes)},...snapshot};
     const bytes=JSON.stringify(artifact,null,2)+'\n';fs.writeFileSync(path.join(outputDir,file),bytes,{flag:'wx'});report.ordinarySceneChoicePhases.push({phase,file,sha256:digest(bytes),bytes:Buffer.byteLength(bytes),currentHash:snapshot.currentHash,durableHash:snapshot.durableHash,currentBytes:Buffer.byteLength(snapshot.current),durableBytes:Buffer.byteLength(snapshot.durable)});save();return;
    }
    if(name==='ordinary two distinct scanner decisions'){
     assert.equal(selectedProfile,'ordinary');const order=['seed','accepted-two','reopened','final-source'];report.ordinaryDistinctDecisionPhases??=[];assert.equal(phase,order[report.ordinaryDistinctDecisionPhases.length],'Retain every complete distinct-decision source phase once in order');
     const file='ordinary-distinct-decision-'+phase+'.json',artifact={schemaVersion:1,phase,scenario:name,sourceIdentity:{candidateCommit,candidateTree,inventorySha256:digest(inventoryBytes)},...snapshot};
     const bytes=JSON.stringify(artifact,null,2)+'\n';fs.writeFileSync(path.join(outputDir,file),bytes,{flag:'wx'});report.ordinaryDistinctDecisionPhases.push({phase,file,sha256:digest(bytes),bytes:Buffer.byteLength(bytes),currentHash:snapshot.currentHash,durableHash:snapshot.durableHash,currentBytes:Buffer.byteLength(snapshot.current),durableBytes:Buffer.byteLength(snapshot.durable)});save();return;
    }
    if(name==='ordinary repeated saved decision choice'){
     assert.equal(selectedProfile,'ordinary');const cancelOrder=['cancel-selected','cancel-closed','cancel-reopened'],isCancel=cancelOrder.includes(phase),order=isCancel?cancelOrder:['seed','settings','baseline-saved','settings-review','read-refused','reviewed','selected','repeated','write-refused','reviewed-retry','selected-retry','applied','final-source'];const references=isCancel?(report.ordinarySavedDecisionCancelPhases??=[]):(report.ordinarySavedDecisionPhases??=[]);assert.equal(phase,order[references.length],'Retain every complete saved-decision source phase once in order');
     const file='ordinary-saved-decision-'+phase+'.json',artifact={schemaVersion:1,phase,scenario:name,sourceIdentity:{candidateCommit,candidateTree,inventorySha256:digest(inventoryBytes)},...snapshot};
     const bytes=JSON.stringify(artifact,null,2)+'\n';fs.writeFileSync(path.join(outputDir,file),bytes,{flag:'wx'});references.push({phase,file,sha256:digest(bytes),bytes:Buffer.byteLength(bytes),currentHash:snapshot.currentHash,durableHash:snapshot.durableHash,currentBytes:Buffer.byteLength(snapshot.current),durableBytes:Buffer.byteLength(snapshot.durable)});save();return;
    }
    if(name==='ordinary repeated cloud source choice'){
     assert.equal(selectedProfile,'ordinary');const cancelOrder=['cancel-selected','cancel-closed','cancel-reopened'],isCancel=cancelOrder.includes(phase),order=isCancel?cancelOrder:['seed','menu','read-refused','reviewed','selected','repeated','keyboard','alternate','write-refused','final-source'];const references=isCancel?(report.ordinaryCloudSourceCancelPhases??=[]):(report.ordinaryCloudSourcePhases??=[]);assert.equal(phase,order[references.length],'Retain every complete cloud-choice source phase once in order');
     const file='ordinary-cloud-source-'+phase+'.json',artifact={schemaVersion:1,phase,scenario:name,sourceIdentity:{candidateCommit,candidateTree,inventorySha256:digest(inventoryBytes)},...snapshot};
     // Same external source writer: retain the full lossless actual read before assertions.
     const bytes=JSON.stringify(artifact,null,2)+'\n';fs.writeFileSync(path.join(outputDir,file),bytes,{flag:'wx'});references.push({phase,file,sha256:digest(bytes),bytes:Buffer.byteLength(bytes),currentHash:snapshot.currentHash,durableHash:snapshot.durableHash,currentBytes:Buffer.byteLength(snapshot.current),durableBytes:Buffer.byteLength(snapshot.durable)});save();return;
    }
    if(name==='ordinary final WOOP repeated Next retains answers'){
     assert.equal(selectedProfile,'ordinary');const order=['seed','opened','outcome-filled','outcome-repeated','obstacle-filled','obstacle-repeated','plan-filled','saved','reopened','deleted','deleted-reopened','final-source'];report.ordinaryFinalWoopPhases??=[];
     assert.equal(phase,order[report.ordinaryFinalWoopPhases.length],'Retain every complete final WOOP source phase once and in order');
     const file='ordinary-final-woop-'+phase+'.json',artifact={schemaVersion:1,phase,scenario:name,sourceIdentity:{candidateCommit,candidateTree,inventorySha256:digest(inventoryBytes)},...snapshot};
     // The full lossless actual read is durable before any semantic/hash assertion.
     const bytes=JSON.stringify(artifact,null,2)+'\n';fs.writeFileSync(path.join(outputDir,file),bytes,{flag:'wx'});report.ordinaryFinalWoopPhases.push({phase,file,sha256:digest(bytes),bytes:Buffer.byteLength(bytes),currentHash:snapshot.currentHash,durableHash:snapshot.durableHash,currentBytes:Buffer.byteLength(snapshot.current),durableBytes:Buffer.byteLength(snapshot.durable)});save();return;
    }
    assert.equal(name,'ordinary overdue WOOP repeated Next retains answers','WOOP source artifacts belong only to the admitted case');assert.equal(selectedProfile,'ordinary');
    const order=['seed','scan','opened','outcome-filled','repeated','obstacle-filled','answered','plan-filled','saved','reopened'];report.ordinaryWoopPhases??=[];
    assert.equal(phase,order[report.ordinaryWoopPhases.length],'Retain every complete WOOP source phase once and in order');
    const file='ordinary-woop-'+phase+'.json',artifact={schemaVersion:1,phase,scenario:name,sourceIdentity:{candidateCommit,candidateTree,inventorySha256:digest(inventoryBytes)},...snapshot};
    // Preserve the complete actual read before any semantic/hash assertion.
    const bytes=JSON.stringify(artifact,null,2)+'\n';fs.writeFileSync(path.join(outputDir,file),bytes,{flag:'wx'});
    report.ordinaryWoopPhases.push({phase,file,sha256:digest(bytes),bytes:Buffer.byteLength(bytes),currentHash:snapshot.currentHash,durableHash:snapshot.durableHash,
      currentBytes:Buffer.byteLength(snapshot.current),durableBytes:Buffer.byteLength(snapshot.durable)});save();
   };
   const reopenOrdinaryWoop=async()=>{
    if(name==='ordinary two distinct scanner decisions'){
     assert.equal(selectedProfile,'ordinary');const before=await page.evaluate(()=>window.__installedFixture.documentId);assert.equal(allowedNavigation,null);allowedNavigation={url:page.url(),remaining:1,action:'ordinary-distinct-decisions-browser-reopen'};
     await page.reload({waitUntil:'domcontentloaded'});await waitFor(new Function('return window.__installedFixture?.documentId!=='+JSON.stringify(before)+'&&document.documentElement.dataset.appReady==="true"&&window.CloudSync?.ready'),12000,'Actual browser reopen of both saved independent scanner decisions');
     assert.equal(allowedNavigation.remaining,0,'Exactly one same-route distinct-decision browser reopen');allowedNavigation=null;check();return;
    }
    if(name==='ordinary scene choice survives reopen and task Undo'){
     assert.equal(selectedProfile,'ordinary');const before=await page.evaluate(()=>window.__installedFixture.documentId);assert.equal(allowedNavigation,null);allowedNavigation={url:page.url(),remaining:1,action:'ordinary-scene-browser-reopen'};
     await page.reload({waitUntil:'domcontentloaded'});await waitFor(new Function('return window.__installedFixture?.documentId!=='+JSON.stringify(before)+'&&document.documentElement.dataset.appReady==="true"&&window.CloudSync?.ready&&typeof window.applySyncedSceneTime==="function"'),12000,'Actual browser reopen of saved independent scene');
     assert.equal(allowedNavigation.remaining,0,'Exactly one same-route scene browser reopen');allowedNavigation=null;check();return;
    }
    if(name==='ordinary final WOOP repeated Next retains answers'){
     assert.equal(selectedProfile,'ordinary');const before=await page.evaluate(()=>window.__installedFixture.documentId);assert.equal(allowedNavigation,null);allowedNavigation={url:page.url(),remaining:1,action:'ordinary-final-woop-browser-reopen'};
     await page.reload({waitUntil:'domcontentloaded'});await waitFor(new Function('return window.__installedFixture?.documentId!=='+JSON.stringify(before)+'&&document.documentElement.dataset.appReady==="true"&&window.CloudSync?.ready'),12000,'Actual browser reopen of saved/deleted final WOOP');
     assert.equal(allowedNavigation.remaining,0,'Exactly one same-route browser reopen');allowedNavigation=null;check();return;
    }
    assert.equal(name,'ordinary overdue WOOP repeated Next retains answers');assert.equal(selectedProfile,'ordinary');
    const before=await page.evaluate(()=>window.__installedFixture.documentId);assert.equal(allowedNavigation,null);
    allowedNavigation={url:page.url(),remaining:1,action:'ordinary-woop-browser-reopen'};
    await page.reload({waitUntil:'domcontentloaded'});
    await waitFor(new Function('return window.__installedFixture?.documentId!=='+JSON.stringify(before)+'&&document.documentElement.dataset.appReady==="true"&&window.CloudSync?.ready'),12000,'Actual browser reopen of saved ordinary WOOP');
    assert.equal(allowedNavigation.remaining,0,'Exactly one same-route browser reopen');allowedNavigation=null;check();
   };
   const ui={page,profile:selectedProfile,...(topLayerProbe?{captureTopLayerPhase}:{}),recordOrdinaryCloudSourcePhase:recordOrdinaryWoopPhase,recordOrdinaryWoopPhase,reopenOrdinaryWoop,mobileYesMotion,recordMobileStory:value=>{report.mobileStory=value;},click:step,waitFor,burst,repeat,recordRepeatOutcome,recordOrdinaryUndoPhase,recordOrdinaryUndoSeedSource,recordOrdinaryUndoFinalSource,ordinaryUndoFixtureSeed:name==='ordinary Undo consumes two saved edit frames'?report.retainedSources?.at(-1)?.ordinaryUndoFixtureSeed:undefined,pasteBoundary,backdrop:()=>step('.mback',()=>!document.querySelector('#modalRoot .modal'),'Dismiss dialog backdrop',{position:{x:5,y:5}}),expectReload:async action=>{const before=await evalPage(()=>window.__installedFixture.documentId);allowedNavigation={url:page.url(),remaining:1,action};const expected=new Function('return window.__installedFixture?.documentId!=='+JSON.stringify(before)+'&&document.documentElement.dataset.appReady==="true"');await step('[data-act="'+action+'"]',expected,action+' bounded reload');assert.equal(allowedNavigation.remaining,0,'exactly one expected same-route reload');allowedNavigation=null;},act:async(action,expect,selector)=>{if(!selector){selector='[data-act="'+action+'"]';if(await page.locator('#modalRoot '+selector).count())selector='#modalRoot '+selector;}return step(selector,expect,action);},fill:(selector,value)=>nativeInput('fill',selector,value),select:(selector,value)=>nativeInput('select',selector,value),expose};
   report.scenarios??=[];const record={name,status:'running',setup};report.scenarios.push(record);save();
   if(control==='new-action')await evalPage(()=>{const button=document.createElement('button');button.dataset.act='gate-new-untested';button.textContent='New untested button';document.body.append(button);});
   if(control){
    await evalPage(control=>{document.querySelector('[data-act="settings"]').addEventListener('click',event=>{
     if(control==='close'||control==='crash')void window.__buttonFault();
     if(control==='pageerror')throw Error('button sensitivity pageerror');
     if(control==='unhandled')void Promise.reject(Error('button sensitivity unhandled'));
     if(control==='reload')location.reload();
     if(control==='navigation')location.href='/unexpected-button-navigation';
     if(control==='async-pending'){event?.stopImmediatePropagation();return new Promise(()=>{});}
     if(control==='stall'||control==='short-stall'){const end=Date.now()+(control==='short-stall'?1300:15000);while(Date.now()<end){}}
    },true);},control);
   }
   await execute(ui);check();record.status='passed';
   for(const outcome of report.repeatOutcomes||[])if(outcome.name===name&&outcome.status==='running')outcome.status='passed';
  };
  if(startupOpening)await scenario('ordinary saved-board opening',{},async ui=>{
   const before=await page.locator('#addToggle').getAttribute('aria-expanded');
   if(ordinaryTimeline)await evalPage(operationId=>{window.__ordinaryStartup.operationId=operationId;},randomUUID());
   await ui.act('toggle-add',new Function('return document.getElementById("addToggle").getAttribute("aria-expanded")!=='+JSON.stringify(before)));
   report.startupTimeline=classifyButtonStartupTimeline(await evalPage(()=>{window.__buttonStartupTimeline.proxies.actionDomOutcomeObservedAtMs=performance.now();return window.__buttonStartupTimeline;}));
   report.openingResult={functional:'passed',tasks:await evalPage(()=>state.tasks.length),timing:report.startupTimeline.status};
   if(startupCapture)report.openingResult.savedHeadHash=await bounded(evalPage(async()=>{const head=await ScannerDeviceStore.readHead();return ChainStorageV2.hashPayload(head.payload);}),'startup exact post-action durable board');
  });
  else if(mobileYesMotion){const {runRapidCoreScenarios}=await import('./button-safety-rapid-core.mjs');await runRapidCoreScenarios({scenario});}
  else if(probe&&control==='top-layer-release')await scenario('detector sensitivity',{retainedCopies:3},async ui=>{
   await ui.waitFor(()=>document.documentElement.dataset.appReady==='true'&&typeof window.applySyncedSceneTime==='function',12000,'Existing scene controls finish loading');
   await ui.captureTopLayerPhase('seed');
   await ui.act('settings',()=>!!document.querySelector('#modalRoot .settings-section'));
   await ui.page.locator('#modalRoot [data-act="scene-time-settings"]').scrollIntoViewIfNeeded();
   await ui.waitFor(()=>{const el=document.querySelector('#modalRoot [data-act="scene-time-settings"]');if(!el)return false;const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>0&&r.height>0&&!el.disabled&&!!hit&&(el===hit||el.contains(hit));},12000,'Current intended opener is actually available');
   await ui.captureTopLayerPhase('settings');
   const attempts=await ui.repeat('act:scene-time-settings',2,()=>document.getElementById('sceneTimeDialog')?.open===true,'#modalRoot [data-act="scene-time-settings"]','Open scene time once and neutrally refuse its real covered target');
   const final=await ui.captureTopLayerPhase('final-source');
   ui.recordRepeatOutcome('detector sensitivity',attempts,JSON.stringify({intendedOpenerAttempts:2,accepted:attempts.filter(row=>row.result==='accepted').length,refused:attempts.filter(row=>row.result==='refused').length,coveringAction:attempts[1].nativeRefusal.nativeDownAction,currentHash:final.currentHash,durableHash:final.durableHash,completePhases:5,unrelatedClicks:0}));
  });
  else if(probe)await scenario('detector sensitivity',{},async ui=>{await ui.act('settings',control==='async-predicate-false'?async()=>false:()=>!!document.getElementById('stHorizon'));});
  else if(scenarioFilter==='ordinary pending Copy refuses reentry'||scenarioFilter==='ordinary obsolete Copy cannot alter replacement transfer'){const {runRapidScenarios}=await import('./button-safety-rapid.mjs');await runRapidScenarios({scenario});}
  else if(scenarioFilter?.startsWith('rapid ')){const {runRapidScenarios}=await import('./button-safety-rapid.mjs');await runRapidScenarios({scenario});}
  else {
   await runButtonScenarios({scenario});
   if(diagnosticProfile){const {runRapidScenarios}=await import('./button-safety-rapid.mjs');await runRapidScenarios({scenario});}
   else{const {runRapidCoreScenarios}=await import('./button-safety-rapid-core.mjs');await runRapidCoreScenarios({scenario});if(!scenarioFilter){const {runRapidScenarios}=await import('./button-safety-rapid.mjs');await runRapidScenarios({scenario:async(caseName,options,execute)=>{if(caseName==='ordinary pending Copy refuses reentry'||caseName==='ordinary obsolete Copy cannot alter replacement transfer')await scenario(caseName,options,execute);}});}}
  }
  if(scenarioFilter)assert.equal(report.scenarios?.length,1,'Exactly one requested diagnostic scenario must execute');
  if(!startupOpening)for(const action of observed)assert.ok(report.requiredActions.includes(action),'New untested button action: '+action);
  report.observedActions=[...observed].sort();report.outcomes=[...outcomes.values()];report.rapidOutcomes=[...rapidOutcomes.values()];if(scenarioFilter&&!startupOpening)report.scope='focused-diagnostic';
  report.status='passed';
 }catch(error){report.status='failed';report.failure=error.stack;if(startupOpening&&page)try{report.startupTimeline=classifyButtonStartupTimeline(await bounded(evalPage(()=>window.__buttonStartupTimeline),'startup timeline after failure'));}catch{}try{report.failureObservation=await bounded(evalPage(()=>({modal:document.getElementById('modalRoot')?.innerText,toast:document.getElementById('toast')?.innerText,heartbeat:{...window.__buttonHeartbeat},mode:state.mode,chain:state.chain,candidateId:state.candidateId,taskTitles:state.tasks.slice(0,10).map(t=>({id:t.id,title:t.title}))})),'failure observation');}catch(observationError){report.failureObservationError=String(observationError);}throw error;}
 finally{
  closing=true;
  let cleanupError;const failedBeforeCleanup=report.status==='failed';
  const close=async work=>{try{await work();}catch(error){cleanupError??=error;report.status='failed';report.failure??=error.stack||String(error);report.errors.push('cleanup: '+String(error));(report.cleanupFailures??=[]).push({name:error.name||null,message:error.message||String(error),stack:error.stack||null});}};
  if(stopStartupCapture)await close(async()=>{await stopStartupCapture(interrupted?'interrupted':'case-finished');});
  if(ordinaryTimeline)await close(async()=>{
   const capture=report.startupCapture||null,availability={capture:{status:capture?.status||'unavailable',reason:capture?'Actual provider terminal outcome':'Provider did not produce capture metadata'},input:{status:'not-reached',reason:'No trusted operation receipt available'},clock:{status:capture?.facts?.calibration?.status==='bounded'?'available':'unavailable',reason:'Only actual matched same-document native anchors can bound the page clock'},custody:{status:'unavailable',reason:'Owned page unavailable after stop'}};
   let readback;
   if(page&&!page.isClosed())try{
    readback=await bounded(evalPage(async()=>{
    const encode=(value,depth=0)=>{if(depth>64)throw Error('Typed custody depth');if(value===null)return{type:'null'};if(value===undefined)return{type:'undefined'};if(typeof value==='number')return{type:'number',value:Object.is(value,-0)?'-0':Number.isFinite(value)?value:String(value)};if(typeof value==='string'||typeof value==='boolean')return{type:typeof value,value};if(value instanceof Uint8Array)return{type:'uint8array',values:Array.from(value)};if(value instanceof Date)return{type:'date',value:value.toISOString()};if(Array.isArray(value))return{type:'array',values:value.map(v=>encode(v,depth+1))};if(typeof value!=='object'||Object.prototype.toString.call(value)!=='[object Object]')throw Error('Unsupported custody value');return{type:'object',entries:Object.entries(value).map(([k,v])=>[k,encode(v,depth+1)])};};
    const raw=await ScannerDeviceStore.readRawExportSnapshot(),head=await ScannerDeviceStore.readHead();return{phase:'post-stop',state:encode(state),headPayload:head.payload,rawSnapshot:encode(raw),legacySources:Object.keys(localStorage).filter(key=>key.startsWith('fvp:chain-scanner:')).map(key=>({key,raw:localStorage.getItem(key)})),observer:window.__ordinaryStartup};
   }),'startup complete post-stop source custody');readback.state=decodeStartupValue(readback.state);
    const app=sources.get('index.html')?.toString()||'';readback.differences=startupDifferences(JSON.parse(startupOpening.raw),readback.state).map(path=>{const field=path.split('.').at(-1),quote=app.split('\n').find(line=>line.includes('.'+field)&&/(?:=|delete)/.test(line));return{path,sourceQuote:quote||'UNPROVED SOURCE DIFFERENCE: '+path};});
    availability.custody={status:'available',reason:'One bounded read-only post-stop typed snapshot'};
    if(readback.observer?.receipts?.length)availability.input={status:'available',reason:'Actual retained trusted operation receipts'};
   }catch(error){readback=undefined;availability.custody={status:'unavailable',reason:String(error),error:{name:error.name||null,message:error.message||String(error),stack:error.stack||null}};}
   sourceManifest??={app:report.appSource,fixture:report.fixture,availability:'Source manifest initialization not reached'};
   sourceManifest.generated=[...retainedSources.values()].filter(row=>row.kind==='instrumentation').map(({url,bytes,sha256})=>({url,bytes,sha256}));
   const captureBytes=Buffer.from(JSON.stringify(capture,null,2)+'\n'),inventory=capture?[...capture.events.map(({path,bytes,sha256})=>({...([2,3].includes(capture.schemaVersion)?{kind:'canonical'}:{}),path,bytes,sha256})),...capture.frames.map(({path,bytes,sha256})=>({...([2,3].includes(capture.schemaVersion)?{kind:'derived-png'}:{}),path,bytes,sha256})),...(capture.orphans||[]).map(({path,bytes,sha256})=>({kind:'orphan',path,bytes,sha256}))]:[],inventoryBytes=Buffer.from(JSON.stringify(inventory,null,2)+'\n');
   fs.writeFileSync(path.join(outputDir,'startup-native-capture.json'),captureBytes,{flag:'wx'});fs.writeFileSync(path.join(outputDir,'startup-raw-inventory.json'),inventoryBytes,{flag:'wx'});fs.writeFileSync(path.join(outputDir,'startup-fixture.json'),startupOpening.raw,{flag:'wx'});
   const observer=readback?.observer,binding={schemaVersion:1,evidenceKind:'actual-native',sourceManifest,availability,actionReceipts:observer?.receipts||[],inputPrefix:observer?.inputPrefix||null,custodyReadbacks:readback?[readback]:[],frameAnnotations:{status:'unreviewed',evidenceKind:'actual-native',inspector:'pending-independent-PNG-inspection',viewport:{width:1100,height:850},reviewedFrames:[],states:[]}};if(readback)delete readback.observer;
   const modules=['scripts/button-safety-native.mjs','scripts/button-safety-startup.mjs','scripts/button-safety-contract.mjs','scripts/button-safety-timeline-core.mjs','scripts/button-safety-timeline.mjs'].map(file=>({path:file,sha256:digest(fs.readFileSync(path.join(repo,file)))}));
   const spec={schemaVersion:1,...(startupRetentionProfile===undefined?{}:{retentionProfile:startupRetentionProfile}),reportPath:path.basename(reportPath),capturePath:'startup-native-capture.json',captureSha256:digest(captureBytes),rawInventoryPath:'startup-raw-inventory.json',rawInventorySha256:digest(inventoryBytes),fixturePath:'startup-fixture.json',sources:[...retainedSources.values()],appBinding:binding,producer:{sourcePacketSha256:digest(JSON.stringify(report.toolingSource)),toolingSource:report.toolingSource,recorderId:path.basename(reportPath,'.json'),recorderIdKind:'collector-report-id; outer recorder identity joined separately',captureSha256:digest(captureBytes),rawInventorySha256:digest(inventoryBytes),modules,sourceIdentity:'Actual candidate HEAD/tree plus exact dirty module hashes; no original1472 producer reuse'},consumer:{kind:'ordinary-runtime-consumer',modules}};
   fs.writeFileSync(path.join(outputDir,'startup-evidence-inputs.json'),JSON.stringify(spec,null,2)+'\n',{flag:'wx'});
   report.startupObservation={schemaVersion:2,kind:'ordinary-startup-engine-observation',status:'incomplete',clock:{basis:'page-performance',timeOrigin:capture?.documents?.[0]?.timeOrigin},observations:{},availability,evidenceInputs:'startup-evidence-inputs.json',gaps:['Independent complete native PNG inspection/annotations pending; no observed-state timestamp invented']};
   if(capture?.status==='error'){report.status='failed';report.failure??=capture.errors.join('\n');if(!failedBeforeCleanup)cleanupError??=Error(capture.errors[0]||'Native Timeline capture failed');}
  });
  for(const [signal,handler]of Object.entries(captureSignals))process.off(signal,handler);
  if(context)await close(async()=>{await context.close();report.cleanup.contextClosed=true;});
  if(browser)await close(async()=>{
   await browser.close();
   if(browserServerEndpoint){report.cleanup.browserDisconnected=true;const owned=await closeBrowserServer();assert.equal(owned?.serverClosed,true,'BrowserServer owner closure required');assert.equal(owned.engineExited,true,'Observed engine exit required after remote disconnect');report.cleanup.browserServerClosed=true;}
   report.cleanup.browserClosed=true;
  });
  if(server)await close(async()=>{await new Promise(resolve=>server.close(resolve));report.cleanup.serverClosed=true;});
  report.finishedAt=new Date().toISOString();save();if(ordinaryTimeline)fs.writeFileSync(path.join(outputDir,'startup-report-reference.json'),JSON.stringify({reportPath:path.basename(reportPath),sha256:digest(fs.readFileSync(reportPath))},null,2)+'\n',{flag:'wx'});if(cleanupError&&!failedBeforeCleanup)throw cleanupError;
 }
 if(!startupOpening&&!probe&&!scenarioFilter&&!mobileYesMotion){
  try{verifyButtonSafetyReport(report,{inventory,inventorySha256:digest(inventoryBytes),candidateCommit,candidateTree,engine,expectedProfile:selectedProfile});}
  catch(error){report.status='failed';report.failure=error.stack;save();throw error;}
 }
 return{report,reportPath};
}
