import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {browserInit,appModule,authModule,firestoreModule} from './installed-client-fixture.mjs';
import {buttonFixture,populateButtonWorkload,TASK_COUNT} from './button-safety-fixture.mjs';
import {MOBILE_PROFILE,MOBILE_SCENARIO} from './button-safety-mobile-contract.mjs';
import {hostedButtonPolicy} from './button-safety-ci-policy.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const MIME={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.md':'text/markdown; charset=utf-8'};
export async function runButtonSafety({repo,engine,outputDir,port=0,control=null,probe=false,scenarioFilter=null,mobileYesMotion=null,browserServerEndpoint=null,closeBrowserServer=null}){
 assert.ok(['chromium','webkit'].includes(engine),'Explicit supported engine');
 if(browserServerEndpoint!==null){assert.equal(engine,'webkit');assert.ok(mobileYesMotion,'Remote launch is only admitted for the capped mobile consumer');assert.match(browserServerEndpoint,/^ws:\/\/127\.0\.0\.1:[1-9][0-9]*\/[a-zA-Z0-9_-]+$/);assert.equal(typeof closeBrowserServer,'function','Remote browser requires owner-confirmed closure');}
 if(mobileYesMotion){assert.equal(engine,'webkit');assert.ok(['normal','reduced'].includes(mobileYesMotion));assert.ok(scenarioFilter===null||scenarioFilter===MOBILE_SCENARIO);scenarioFilter=MOBILE_SCENARIO;}
 assert.ok(control===null||['pageerror','unhandled','reload','navigation','stall','short-stall','async-pending','async-predicate-false','close','crash','new-action'].includes(control),'Known explicit sensitivity control');
 let hostedPolicy=null;
 if(process.env.CI==='true'){
  hostedPolicy=hostedButtonPolicy();
 }else{
  const ledgerPath=process.env.CODEX_COORDINATION_FILE||process.env.DOW_EMULATOR_COORDINATION_FILE;
  assert.ok(ledgerPath&&path.isAbsolute(ledgerPath),'Local named-engine launch requires explicit canonical coordination ledger');
  const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
  const owners=(ledger.entries||[]).filter(entry=>['active','parked'].includes(entry.status));
  const own=owners.find(entry=>entry.status==='active'&&fs.realpathSync(entry.worktree)===fs.realpathSync(repo));
  assert.ok(own,'Active worktree allocation required before native launch');
  assert.ok(own.lease?.state==='healthy'&&Date.parse(own.lease.expiresAt)>Date.now()&&!own.lease.ownerConfirmationRequired,'Current healthy worktree lease required before native launch');
  for(const resource of ['browser-runtime:playwright-'+engine,'loopback:127.0.0.1:'+port]){
   assert.ok(own.resources?.includes(resource),'Local named-engine allocation missing: '+resource);
   assert.ok(!owners.some(entry=>entry!==own&&entry.resources?.includes(resource)),'Conflicting local native allocation: '+resource);
  }
  assert.ok(Number.isSafeInteger(port)&&port>0,'Explicit allocated local native port required');
 }

 fs.mkdirSync(outputDir,{recursive:true});
 const git=(...args)=>execFileSync('git',args,{cwd:repo,maxBuffer:32*1024*1024}),candidateCommit=git('rev-parse','HEAD').toString().trim(),candidateTree=git('rev-parse','HEAD^{tree}').toString().trim();
 const report={schemaVersion:1,kind:mobileYesMotion?'button-mobile-functional':probe?'button-sensitivity':scenarioFilter?'button-diagnostic':'button-safety',engine,candidateCommit,candidateTree,hostedPolicy,status:'running',startedAt:new Date().toISOString(),requiredActions:JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8')).requiredActions,requiredScenarios:JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8')).requiredScenarios,requiredWorkload:JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8')).requiredWorkload,requiredRapidActions:JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8')).requiredRapidActions,inventorySha256:digest(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'))),observedActions:[],outcomes:[],errors:[],cleanup:{},limits:['Synthetic isolated browser storage and Firebase/clipboard/geolocation boundaries.',mobileYesMotion?'Emulated mobile WebKit; uncapped functional evidence unless independently bound to a verified Linux cgroup report; no physical iPhone or private-board recovery claim.':'Native desktop engine; no physical iPhone or private-board recovery claim.']};
 const reportPath=path.join(outputDir,'button-safety-'+engine+'-'+randomUUID()+'.json'),save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save();
 const prefix='/button-'+randomUUID()+'/',sdk='/sdk-'+randomUUID()+'/',sources=new Map();
 const runtimeAssets=JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8')).requiredRuntimeAssets;
 // Only reviewed runtime Markdown joins the existing asset types; repository guidance stays private.
 for(const file of git('ls-files').toString().trim().split('\n'))if(file!=='tests.js'&&!file.startsWith('scripts/')&&(/\.(html|js|css|svg|png|webmanifest)$/.test(file)||Object.hasOwn(runtimeAssets,file)))sources.set(file,fs.readFileSync(path.join(repo,file)));
 report.assets=Object.fromEntries([...sources].map(([file,bytes])=>[file,digest(bytes)]));
 for(const [file,hash]of Object.entries(runtimeAssets))assert.equal(report.assets[file],hash,'Reviewed runtime asset missing or changed: '+file);
 const {verifyButtonInventorySource}=await import('./button-safety-contract.mjs');verifyButtonInventorySource([...sources].filter(([file])=>/\.(?:js|html)$/.test(file)).map(([,bytes])=>bytes.toString()).join('\n'),JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8')));
 for(const [file,bytes]of sources)assert.equal(digest(bytes),digest(git('show','HEAD:'+file)),'Button run requires exact committed app bytes: '+file);
 let server,browser,context,page,armed=false,closing=false;
 const check=()=>{assert.equal(report.errors.length,0,'Native button safety detected '+report.errors.join(', '));};
 const bounded=async(work,label,timeoutMs=2500)=>{let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native button safety detected stalled responsiveness: '+label)),timeoutMs);})]);}finally{clearTimeout(timer);}};
 try{
  server=http.createServer((req,res)=>{
   const pathname=new URL(req.url,'http://127.0.0.1').pathname;
   const name=pathname.slice(prefix.length)||'index.html',module=pathname.startsWith(sdk)?pathname.slice(sdk.length):null;
   const observer=pathname===prefix+'__button-observer';
   const bytes=observer?'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated storage fixture</title>':module?{'firebase-app.js':appModule,'firebase-auth.js':authModule,'firebase-firestore.js':firestoreModule.replace('const rpc=(kind,args)=>window.__installedRPC(kind,args)',"const rpc=async(kind,args)=>{const result=await window.__installedRPC(kind,args);if(result?.fixtureFailure)throw Object.assign(Error('Synthetic external SDK refusal'),{code:result.fixtureFailure});return result;}")}[module]:pathname.startsWith(prefix)&&!name.includes('..')?sources.get(name):null;
   res.writeHead(bytes?200:404,{'Content-Type':observer?'text/html':module?'text/javascript':MIME[path.extname(name)]||'text/plain','Cache-Control':'no-store'});res.end(bytes||'Not found');
  });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;
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
   if(context){closing=true;await context.close();closing=false;}
   const device=mobileYesMotion?playwright.devices['iPhone 13']:null;
   context=await browser.newContext({...(device?{userAgent:device.userAgent,screen:MOBILE_PROFILE.screen,deviceScaleFactor:3,isMobile:true,hasTouch:true}:{}),serviceWorkers:'block',viewport:mobileYesMotion?MOBILE_PROFILE.viewport:options.viewport||{width:1100,height:850},reducedMotion:mobileYesMotion==='normal'?'no-preference':'reduce'});
   if(mobileYesMotion)options={...options,retainedCopies:2};
   const board=buttonFixture(options.authMode||'signed-out');
   if(options.board)Object.assign(board,options.board);
   if(options.decorate)options.decorate(board);
   populateButtonWorkload(board,{role:options.fixtureRole||'active'});
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
   await context.addInitScript({content:'if(window.top===window){('+browserInit.toString()+')('+JSON.stringify({dbName,authMode:options.authMode||'signed-out',sdkBase:origin+sdk})+');'+(mobileYesMotion?'localStorage.setItem("fvp:chain-scanner:landscape-motion",JSON.stringify({choice:'+JSON.stringify(mobileYesMotion)+',savedAt:Date.now()}));':'')+'}'});
   // Retained sources are seeded once in the observer below, not serialized
   // into every later page/frame bootstrap. Ordinary fixtures keep their seed.
   if(!options.retainedCopies)await context.addInitScript(({board})=>{
    if(window.top!==window)return;
    if(!localStorage.getItem('fvp:chain-scanner:device-store-v2')&&localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',JSON.stringify(board));
   },{board});
   await context.addInitScript(({clipboardFail,clipboardDeferred,geoFail})=>{
    if(window.top!==window)return;
    window.__buttonClipboard=[];window.__buttonClipboardPending=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(clipboardFail)throw new DOMException('Synthetic clipboard permission refused','NotAllowedError');window.__buttonClipboard.push(text);if(clipboardDeferred)await new Promise((resolve,reject)=>window.__buttonClipboardPending.push({resolve,reject}));}}});
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(success,failure)=>geoFail?failure?.({code:1,message:'Synthetic location refused'}):success({coords:{latitude:40.7,longitude:-74,accuracy:20}})}});
   },{clipboardFail:options.clipboardFail,clipboardDeferred:options.clipboardDeferred,geoFail:options.geoFail});
   await context.addInitScript(()=>{
    if(window.top!==window)return;
    window.__buttonRefuseWrites=false;window.__buttonRefuseReads=false;
    const tx=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode==='readonly'&&window.__buttonRefuseReads)throw new DOMException('Synthetic saved source read refused','UnknownError');if(mode==='readwrite'&&window.__buttonRefuseWrites)throw new DOMException('Synthetic saved source write refused','QuotaExceededError');return tx.call(this,stores,mode,...rest);};
    const put=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(window.__buttonRefuseWrites&&key.startsWith('fvp:chain-scanner:'))throw new DOMException('Synthetic browser storage write refused','QuotaExceededError');return put.call(this,key,value);};
   });
   if(options.retainedCopies){
    const observer=await context.newPage();await observer.goto(origin+prefix+'__button-observer');await observer.addScriptTag({content:sources.get('device-store-v2.js').toString()});
    report.retainedSources??=[];report.retainedSources.push(await observer.evaluate(async({dbName,board,count,mobile})=>{
     const raw=JSON.stringify(board),legacyKey='fvp:chain-scanner:v1',legacyBefore=localStorage.getItem(legacyKey);let legacySeeded=false;
     if(!localStorage.getItem('fvp:chain-scanner:device-store-v2')&&legacyBefore===null){localStorage.setItem(legacyKey,raw);legacySeeded=true;}
     const store=ChainStorageV2.createDeviceStore({dbName});await store.open();
     const backups=Array.from({length:count},(_,i)=>({id:'gate-retained-'+i,kind:'manual',at:Date.now()-i,day:'2026-10-25',payload:JSON.stringify({...board,futureSourceRole:i})}));
     const result=await store.migrateLegacy({headPayload:raw,account:null,sourceFingerprint:await ChainStorageV2.hashPayload(JSON.stringify([{key:'fvp:chain-scanner:v1',raw}])),backups,opaqueArchives:[{key:'gate-opaque-exact',raw:'opaque exact bytes\u0000retain',futureBytes:new Uint8Array([0,17,255]),futureMinusZero:-0}]});
     if(!result.verified)throw Error('Native retained source fixture failed');const head=await store.readHead();await store.setPendingUpload('gate-owner',{generationId:'gate-pending',payloadHash:head.hash,baseRev:0,updatedAt:7});
     const legacyAfter=localStorage.getItem(legacyKey),retainedSources=[];
     for(const row of (await store.listBackups()).filter(row=>row.id.startsWith('gate-retained-')).sort((a,b)=>a.id.localeCompare(b.id))){const saved=JSON.parse(row.payload);retainedSources.push({id:row.id,payloadHash:await ChainStorageV2.hashPayload(row.payload),...(mobile?{durableTasks:saved.tasks.length,unknownBytes:new TextEncoder().encode(saved.futurePopulated.opaque).byteLength}:{})});}
     let workload;if(mobile){const saved=JSON.parse(head.payload),opaque=(await store.listOpaqueArchives()).find(row=>row.key==='gate-opaque-exact' );workload={durableTasks:saved.tasks.length,activeTasks:saved.tasks.filter(row=>!row.done).length,distinctTaskIds:new Set(saved.tasks.map(row=>row.id)).size,unknownBytes:new TextEncoder().encode(saved.futurePopulated.opaque).byteLength,taskIdentityHash:await ChainStorageV2.hashPayload(JSON.stringify(saved.tasks.map(row=>({id:row.id,title:row.title,createdAt:row.createdAt})))),unknownSourceHash:await ChainStorageV2.hashPayload(JSON.stringify({board:saved.futureBoard,populated:saved.futurePopulated,tasks:saved.tasks.map(row=>({id:row.id,future:row.futureTask}))})),opaque:opaque?{key:opaque.key,rawHash:await ChainStorageV2.hashPayload(opaque.raw),futureBytes:Array.from(opaque.futureBytes),futureMinusZero:Object.is(opaque.futureMinusZero,-0)}:null,pending:await store.getPendingUpload('gate-owner')};}
     const bootstrap={delivery:'observer-evaluate-once',legacySeeded,legacyBeforeHash:legacyBefore===null?null:await ChainStorageV2.hashPayload(legacyBefore),legacyPayloadHash:legacyAfter===null?null:await ChainStorageV2.hashPayload(legacyAfter),headPayloadHash:await ChainStorageV2.hashPayload(head.payload),headPayloadBytes:new TextEncoder().encode(head.payload).byteLength,...(mobile?{workload}:{}),retainedSources};
     await store.close();return{count,eachPayloadBytes:backups[0].payload.length,ids:backups.map(row=>row.id),bootstrap};
    },{dbName,board,count:options.retainedCopies,mobile:!!mobileYesMotion}));
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
   await page.addInitScript(({keySource})=>{
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
   await page.goto(origin+prefix);await page.waitForFunction(()=>typeof state!=='undefined'&&state&&window.ScannerDeviceStore);await page.waitForFunction(()=>window.CloudSync?.ready);if(mobileYesMotion)await page.waitForFunction(motion=>document.documentElement.dataset.landscapeMotion===motion,mobileYesMotion,{timeout:12000});localArmed=true;
   const setup=await bounded((async()=>{for(let attempt=0;attempt<200;attempt++){
    const result=await page.evaluate(async()=>{const head=await ScannerDeviceStore.readHead();return{currentTasks:state.tasks.length,activeTasks:state.tasks.filter(task=>!task.done).length,durableTasks:head?.payload?JSON.parse(head.payload).tasks.length:0,durableHash:head?.hash};});
    if(result.currentTasks===TASK_COUNT&&result.durableTasks===TASK_COUNT)return{...result,fixtureRole:options.fixtureRole||'active'};
    await new Promise(resolve=>setTimeout(resolve,25));
   }throw Error('Independent400-task setup did not reach durable storage');})(),'400-task durable setup',12000);
   const prepareReleaseSurface=async()=>{
    const receipt=await bounded(page.evaluate(async identity=>{
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
   if(options.writeFailAfterReady)await page.evaluate(()=>window.__buttonRefuseWrites=true);
   if(options.readFailAfterReady)await page.evaluate(()=>window.__buttonRefuseReads=true);
   if(options.downloadFail)await page.evaluate(()=>{URL.createObjectURL=()=>{throw new DOMException('Synthetic download refused','NotAllowedError');};});
   const expose=async selector=>{
    // Open each actual ancestor disclosure through its native summary consumer.
    const indexes=await page.locator(selector).first().evaluate(el=>{const all=[...document.querySelectorAll('details')],rows=[];for(let p=el.parentElement;p;p=p.parentElement)if(p.matches('details')&&!p.open&&!(el.matches('summary')&&el.parentElement===p))rows.unshift(all.indexOf(p));return rows;});
    for(const index of indexes){await step('details >> nth='+index+' >> :scope > summary',new Function('return document.querySelectorAll("details")['+index+']?.open===true'),'Expand containing disclosure');}
   };
   const waitFor=async(expect,timeoutMs=2500,label='expected state')=>bounded((async()=>{while(true){
    try{if(await page.evaluate(expect)===true)return;}
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
    const action=await target.evaluate(actionFor);assert.ok(action,'Passive inert appearance replicas cannot earn action coverage');const before=report.clicks?.length||0;
    await bounded(page.evaluate(()=>{window.__buttonHeartbeat.maxGapMs=0;window.__buttonHeartbeat.at=performance.now();window.__buttonHeartbeat.inputArmed=true;window.__buttonHeartbeat.inputAt=null;window.__buttonHeartbeat.inputMaxGapMs=0;window.__buttonHeartbeat.preInputMaxGapMs=0;return window.__buttonHeartbeat.frames;}),'preclick heartbeat');const started=Date.now();
    await bounded(mobileYesMotion?target.tap(clickOptions):target.click(clickOptions),name+' / '+description);
    if(expect)await waitFor(expect,control==='async-pending'||control==='async-predicate-false'?2500:12000,'outcome '+description);
    else assert.fail('Every button step requires an independent expected outcome: '+description);
    await bounded(page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(true)))),'frame '+description);
    await new Promise(resolve=>setTimeout(resolve,30));check();
    const heartbeat=await bounded(page.evaluate(()=>({...window.__buttonHeartbeat})),'continuous heartbeat');
    report.samples??=[];report.samples.push({scenario:name,action,elapsedMs:Date.now()-started,maxFrameGapMs:heartbeat.maxGapMs,preInputMaxFrameGapMs:heartbeat.preInputMaxGapMs,inputMaxFrameGapMs:heartbeat.inputMaxGapMs,firstTrustedInputAt:heartbeat.inputAt===null?null:heartbeat.timeOrigin+heartbeat.inputAt,eventToFirstFrameMs:heartbeat.firstFrameAfterClickMs});
    // Preserve the complete-step threshold. Separate phases explain a cold or
    // actionability stall without resetting it away or charging it to a handler.
    assert.ok(heartbeat.maxGapMs<1000,'Native button safety detected blocked frame loop: '+(heartbeat.preInputMaxGapMs>=1000&&heartbeat.inputMaxGapMs<1000?'pre-input / ':'')+description+' '+heartbeat.maxGapMs+'ms');
    assert.ok((report.clicks||[]).slice(before).some(row=>row.action===action),'Trusted native click observed: '+description);
    const row=outcomes.get(action)||{action,status:'passed',events:['click'],assertions:0,responsive:true,steps:[]};row.assertions++;report.outcomes=[...outcomes.values(),...(outcomes.has(action)?[]:[row])];row.steps.push({scenario:name,description,elapsedMs:Date.now()-started,maxFrameGapMs:heartbeat.maxGapMs,frames:heartbeat.frames});outcomes.set(action,row);return action;
   };
   const nativeInput=async(kind,selector,value)=>{
    await expose(selector);const target=page.locator(selector);await page.evaluate(()=>{window.__buttonHeartbeat.maxGapMs=0;window.__buttonHeartbeat.at=performance.now();});const started=Date.now();
    await bounded(kind==='fill'?target.fill(value):target.selectOption(value),kind+' '+selector);
    assert.equal(await target.inputValue(),value,'Native '+kind+' exact draft value: '+selector);
    await bounded(page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()))),'input frame '+selector);check();
    const heartbeat=await bounded(page.evaluate(()=>({...window.__buttonHeartbeat})),'input heartbeat '+selector);report.inputSamples??=[];report.inputSamples.push({kind,selector,characters:value.length,elapsedMs:Date.now()-started,maxFrameGapMs:heartbeat.maxGapMs});assert.ok(heartbeat.maxGapMs<1000,'Native button safety detected blocked input frame loop: '+selector+' '+heartbeat.maxGapMs+'ms');
   };
   const pasteBoundary=async(selector,value,expect)=>{
    await expose(selector);const target=page.locator(selector);await bounded(target.focus(),'paste focus');
    // Clipboard population is fixture setup, like the existing native file
    // chooser buffer. Keep full protocol ingress separate from user dispatch.
    const preparedAt=Date.now(),sha256=digest(value),characters=value.length;
    const prepare=async route=>page.evaluate(async({sha256,characters,route})=>{
     const text=route==='page-held-copy'?window.__buttonClipboard?.findLast(raw=>typeof raw==='string'&&raw.length===characters):window.__buttonPasteFixture;
     if(typeof text!=='string'||text.length!==characters)return null;
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
     if(hash!==sha256)return null;window.__buttonPasteFixture=text;return{route,characters,sha256:hash,verified:true};
    },{sha256,characters,route});
    let preparation=await bounded(prepare('page-held-copy'),'clipboard fixture Copy identity');
    if(!preparation){await bounded(page.evaluate(text=>{window.__buttonPasteFixture=text;},value),'clipboard fixture complete ingress');preparation=await bounded(prepare('staged-complete-text'),'clipboard fixture ingress identity');}
    assert.ok(preparation,'Complete clipboard fixture must match independently hashed source bytes');
    preparation.elapsedMs=Date.now()-preparedAt;preparation.boundary='fixture preparation; excluded from consumer frame budget';
    try{
     await page.evaluate(()=>{window.__buttonHeartbeat.maxGapMs=0;window.__buttonHeartbeat.at=performance.now();});const started=Date.now();
     const receipt=await bounded(target.evaluate(box=>{const text=window.__buttonPasteFixture;const data=new DataTransfer();data.setData('text/plain',text);const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});box.dispatchEvent(event);return{trusted:event.isTrusted,prevented:event.defaultPrevented,characters:data.getData('text/plain').length};}),'clipboard event boundary '+selector);
     assert.equal(receipt.trusted,false,'Isolated clipboard input is explicitly a simulated external boundary');assert.equal(receipt.characters,characters,'Complete clipboard source reaches the actual consumer');assert.equal(receipt.prevented,true,'Large paste must bypass native multiline insertion');
     await waitFor(expect,12000,'clipboard paste outcome');await bounded(page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve))),'paste frame');check();
     const heartbeat=await bounded(page.evaluate(()=>({...window.__buttonHeartbeat})),'paste heartbeat');report.inputSamples??=[];report.inputSamples.push({kind:'clipboard-event-boundary',selector,...receipt,fixturePreparation:preparation,elapsedMs:Date.now()-started,maxFrameGapMs:heartbeat.maxGapMs});assert.ok(heartbeat.maxGapMs<1000,'Native button safety detected blocked paste frame loop: '+heartbeat.maxGapMs+'ms');
    }finally{await bounded(page.evaluate(()=>{delete window.__buttonPasteFixture;}),'clipboard fixture release');}
   };
   const burst=async(actionName,expect,{selector,semantics,expectedAccepted=10,reload=false}={})=>{
    assert.ok(typeof semantics==='string'&&semantics.length>=10,'Explicit independent repeated-effect semantics required');
    selector??='[data-act="'+actionName+'"]';if(!selector.startsWith('#')&&await page.locator('#modalRoot '+selector).count())selector='#modalRoot '+selector;
    await expose(selector);const target=page.locator(selector).first();
    const originalBox=await bounded((async()=>{for(;;){
     try{await target.scrollIntoViewIfNeeded();return await target.boundingBox();}
     catch(error){if(!/Element is not attached to the DOM/.test(error.message))throw error;check();await new Promise(resolve=>setTimeout(resolve,25));}
    }})(),'rapid target scroll');assert.ok(originalBox,'Rapid target is initially rendered');
    const action=await target.evaluate(actionFor);assert.ok(action===actionName||action==='act:'+actionName,'Rapid target action must match independent family');
    await page.evaluate(()=>{window.__buttonHeartbeat.maxGapMs=0;window.__buttonHeartbeat.at=performance.now();});const start={presses:report.presses?.length||0,clicks:report.clicks?.length||0};
    const previousDocument=reload?await page.evaluate(()=>window.__installedFixture.documentId):null;if(reload)allowedNavigation={url:page.url(),remaining:1,action};
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
     if(availability.disabled)await bounded(page.evaluate(point=>{
      // WebKit can suppress even a captured pointerdown on a disabled button.
      // An independently observed disabled target earns only a refused attempt:
      // receive the trusted down on a neutral marker at that same point.
      const marker=document.createElement('span');marker.id='__buttonDisabledAttempt';marker.style.cssText='position:fixed;left:'+(point.x-2)+'px;top:'+(point.y-2)+'px;width:4px;height:4px;z-index:2147483647';(document.querySelector('dialog[open]')||document.body).append(marker);
     },pressPoint),'rapid disabled refusal marker');
     let down,neutralDocumentId=null;
     if(mobileYesMotion){
      assert.ok(availability.present&&availability.hit&&!availability.disabled,'Mobile Yes must remain an enabled current touch target');
      await bounded(page.touchscreen.tap(pressPoint.x,pressPoint.y),'rapid native touch '+actionName);
      down=await bounded(page.evaluate(()=>{const receipt=window.__buttonNativePresses.at(-1);return{action:receipt?.action,canRelease:receipt?.pointerType==='touch'&&receipt?.trusted===true};}),'rapid delivered touch');
      assert.equal(down.action,action,'Actual native touch must reach the requested action');
     }else{
     await bounded((async()=>{await page.mouse.move(pressPoint.x,pressPoint.y);await page.mouse.down();})(),'rapid native down '+actionName);
     // The browser's delivered down is authoritative. If an asynchronous
     // replacement wins the final coordinate race, release neutrally just as
     // for an already absent control; never click a different app action.
     down=await bounded(page.evaluate(({point,action})=>{const el=window.__buttonNativeDownTarget,hit=document.elementFromPoint(point.x,point.y),receipt=window.__buttonNativePresses.at(-1);return{action:receipt?.action,canRelease:receipt?.action===action&&!!el?.isConnected&&(hit===el||el.contains(hit))};},{point:pressPoint,action}),'rapid delivered down');
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
      neutralDocumentId=await bounded(page.evaluate(point=>{const sink=document.getElementById('__buttonReleaseSink');if(!sink?.isConnected||sink.contentDocument?.readyState!=='complete'||!sink.contentWindow.__buttonReleaseDocumentId)throw Error('Prepared neutral release document unavailable');const layer=document.getElementById('__buttonReleaseLayer');layer.style.left=(point.x-4)+'px';layer.style.top=(point.y-4)+'px';sink.style.left=(point.x-4)+'px';sink.style.top=(point.y-4)+'px';sink.hidden=false;layer.showModal();return sink.contentWindow.__buttonReleaseDocumentId;},pressPoint),'rapid release surface');
      await bounded((async()=>{await page.mouse.up();await page.evaluate(()=>{const sink=document.getElementById('__buttonReleaseSink');if(sink){document.getElementById('__buttonReleaseLayer').close();sink.hidden=true;}document.getElementById('__buttonDisabledAttempt')?.remove();});})(),'rapid refused press '+actionName);
     }
     }
     if(reload&&index===0){await bounded(page.waitForFunction(old=>window.__installedFixture?.documentId!==old&&document.documentElement.dataset.appReady==='true',previousDocument),'rapid bounded reload',2000);assert.equal(allowedNavigation.remaining,0,'Exactly one expected rapid reload');allowedNavigation=null;if(!mobileYesMotion)await prepareReleaseSurface();}
     await bounded(page.evaluate(()=>true),'rapid native receipt');const recentClicks=(report.clicks||[]).slice(before.clicks);const unrelated=recentClicks.filter(row=>row.action!==null&&row.action!==action);assert.deepEqual(unrelated,[],'Rapid attempt activated a different app action');const received={presses:(report.presses||[]).slice(before.presses),clicks:recentClicks.filter(row=>row.action===action)};
     attempts.push({index,availability,nativeDownAction:down.action,neutralDocumentId,neutralRelease:!availability.present||!availability.hit||availability.disabled||!down.canRelease,trustedPresses:received.presses.length,acceptedClicks:received.clicks.length,classification:received.clicks.length?'accepted':availability.present?'refused':'disappeared',at:received.presses[0]?.at});
    }
    const finished=Date.now();report.inFlightBurst.windowMs=finished-began;const presses=(report.presses||[]).slice(start.presses);
    assert.equal(presses.length,10,'Ten browser-trusted native press receipts: '+actionName);
    assert.ok(finished-began<=2000,'Ten native press attempts must finish within two seconds: '+actionName+' '+(finished-began)+'ms');
    await waitFor(expect,12000,'rapid outcome '+actionName);await bounded(page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve))),'rapid response '+actionName);check();
    const heartbeat=await page.evaluate(()=>({...window.__buttonHeartbeat}));assert.ok(heartbeat.maxGapMs<1000,'Rapid button action blocked frame loop: '+actionName+' '+heartbeat.maxGapMs+'ms');
    const acceptedClicks=attempts.reduce((sum,row)=>sum+row.acceptedClicks,0),refused=attempts.filter(row=>row.classification==='refused').length,disappeared=attempts.filter(row=>row.classification==='disappeared').length;
    if(typeof expectedAccepted==='number')assert.equal(acceptedClicks,expectedAccepted,'Independent accepted native click count: '+actionName);
    else assert.ok(acceptedClicks>=expectedAccepted.min&&acceptedClicks<=expectedAccepted.max,'Independent accepted native click bounds: '+actionName);
    const row=rapidOutcomes.get(action)||{action,status:'passed',responsive:true,assertions:0,bursts:[]};row.assertions++;
    row.bursts.push({scenario:name,attempts:10,trustedPresses:presses.length,unrelatedClicks:0,windowMs:finished-began,browserWindowMs:presses.at(-1).at-presses[0].at,acceptedClicks,refused,disappeared,semantics,maxFrameGapMs:heartbeat.maxGapMs,attemptDetails:attempts});rapidOutcomes.set(action,row);report.rapidOutcomes=[...rapidOutcomes.values()];
    const normal=outcomes.get(action)||{action,status:'passed',events:['click'],assertions:0,responsive:true,steps:[]};normal.assertions++;normal.steps.push({scenario:name,description:'Rapid '+semantics,elapsedMs:finished-began,maxFrameGapMs:heartbeat.maxGapMs});outcomes.set(action,normal);report.outcomes=[...outcomes.values()];
    delete report.inFlightBurst;return row.bursts.at(-1);
   };
   const ui={page,mobileYesMotion,recordMobileStory:value=>{report.mobileStory=value;},click:step,waitFor,burst,pasteBoundary,backdrop:()=>step('.mback',()=>!document.querySelector('#modalRoot .modal'),'Dismiss dialog backdrop',{position:{x:5,y:5}}),expectReload:async action=>{const before=await page.evaluate(()=>window.__installedFixture.documentId);allowedNavigation={url:page.url(),remaining:1,action};const expected=new Function('return window.__installedFixture?.documentId!=='+JSON.stringify(before)+'&&document.documentElement.dataset.appReady==="true"');await step('[data-act="'+action+'"]',expected,action+' bounded reload');assert.equal(allowedNavigation.remaining,0,'exactly one expected same-route reload');allowedNavigation=null;},act:async(action,expect,selector)=>{if(!selector){selector='[data-act="'+action+'"]';if(await page.locator('#modalRoot '+selector).count())selector='#modalRoot '+selector;}return step(selector,expect,action);},fill:(selector,value)=>nativeInput('fill',selector,value),select:(selector,value)=>nativeInput('select',selector,value),expose};
   report.scenarios??=[];const record={name,status:'running',setup};report.scenarios.push(record);save();
   if(control==='new-action')await page.evaluate(()=>{const button=document.createElement('button');button.dataset.act='gate-new-untested';button.textContent='New untested button';document.body.append(button);});
   if(control){
    await page.evaluate(control=>{document.querySelector('[data-act="settings"]').addEventListener('click',event=>{
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
  };
  if(mobileYesMotion){const {runRapidCoreScenarios}=await import('./button-safety-rapid-core.mjs');await runRapidCoreScenarios({scenario});}
  else if(probe)await scenario('detector sensitivity',{},async ui=>{await ui.act('settings',control==='async-predicate-false'?async()=>false:()=>!!document.getElementById('stHorizon'));});
  else if(scenarioFilter?.startsWith('rapid ')){const {runRapidScenarios}=await import('./button-safety-rapid.mjs');await runRapidScenarios({scenario});}
  else {await runButtonScenarios({scenario});const {runRapidScenarios}=await import('./button-safety-rapid.mjs');await runRapidScenarios({scenario});}
  if(scenarioFilter)assert.equal(report.scenarios?.length,1,'Exactly one requested diagnostic scenario must execute');
  for(const action of observed)assert.ok(report.requiredActions.includes(action),'New untested button action: '+action);
  report.observedActions=[...observed].sort();report.outcomes=[...outcomes.values()];report.rapidOutcomes=[...rapidOutcomes.values()];if(scenarioFilter)report.scope='focused-diagnostic';
  report.status='passed';
 }catch(error){report.status='failed';report.failure=error.stack;try{report.failureObservation=await bounded(page.evaluate(()=>({modal:document.getElementById('modalRoot')?.innerText,toast:document.getElementById('toast')?.innerText,heartbeat:{...window.__buttonHeartbeat},mode:state.mode,chain:state.chain,candidateId:state.candidateId,taskTitles:state.tasks.slice(0,10).map(t=>({id:t.id,title:t.title}))})),'failure observation');}catch(observationError){report.failureObservationError=String(observationError);}throw error;}
 finally{
  closing=true;
  let cleanupError;
  const close=async work=>{try{await work();}catch(error){cleanupError??=error;report.status='failed';report.errors.push('cleanup: '+String(error));}};
  if(context)await close(async()=>{await context.close();report.cleanup.contextClosed=true;});
  if(browser)await close(async()=>{
   await browser.close();
   if(browserServerEndpoint){report.cleanup.browserDisconnected=true;const owned=await closeBrowserServer();assert.equal(owned?.serverClosed,true,'BrowserServer owner closure required');assert.equal(owned.engineExited,true,'Observed engine exit required after remote disconnect');report.cleanup.browserServerClosed=true;}
   report.cleanup.browserClosed=true;
  });
  if(server)await close(async()=>{await new Promise(resolve=>server.close(resolve));report.cleanup.serverClosed=true;});
  report.finishedAt=new Date().toISOString();save();if(cleanupError)throw cleanupError;
 }
 return{report,reportPath};
}
