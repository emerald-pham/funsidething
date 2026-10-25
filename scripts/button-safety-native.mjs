import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {browserInit,appModule,authModule,firestoreModule} from './installed-client-fixture.mjs';
import {buttonFixture,populateButtonWorkload,TASK_COUNT} from './button-safety-fixture.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const MIME={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
export async function runButtonSafety({repo,engine,outputDir,port=0,control=null,probe=false,scenarioFilter=null}){
 assert.ok(['chromium','webkit'].includes(engine),'Explicit supported engine');
 assert.ok(control===null||['pageerror','unhandled','reload','navigation','stall','short-stall','async-pending','async-predicate-false','close','crash','new-action'].includes(control),'Known explicit sensitivity control');
 if(process.env.CI==='true'){
  assert.equal(process.env.CHAIN_TEST_EVENT_POLICY==='push'||process.env.CHAIN_TEST_EVENT_POLICY==='pull_request',true,'Isolated CI requires the explicit grouped fixture policy');
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
 const report={schemaVersion:1,kind:probe?'button-sensitivity':scenarioFilter?'button-diagnostic':'button-safety',engine,candidateCommit,candidateTree,status:'running',startedAt:new Date().toISOString(),requiredActions:JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8')).requiredActions,requiredScenarios:JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8')).requiredScenarios,requiredWorkload:JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8')).requiredWorkload,requiredRapidActions:JSON.parse(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'),'utf8')).requiredRapidActions,inventorySha256:digest(fs.readFileSync(path.join(repo,'scripts/button-safety-inventory.json'))),observedActions:[],outcomes:[],errors:[],cleanup:{},limits:['Synthetic isolated browser storage and Firebase/clipboard/geolocation boundaries.','Native desktop engine; no physical iPhone or private-board recovery claim.']};
 const reportPath=path.join(outputDir,'button-safety-'+engine+'-'+randomUUID()+'.json'),save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save();
 const prefix='/button-'+randomUUID()+'/',sdk='/sdk-'+randomUUID()+'/',sources=new Map();
 for(const file of git('ls-files').toString().trim().split('\n'))if(file!=='tests.js'&&!file.startsWith('scripts/')&&/\.(html|js|css|svg|png|webmanifest)$/.test(file))sources.set(file,fs.readFileSync(path.join(repo,file)));
 report.assets=Object.fromEntries([...sources].map(([file,bytes])=>[file,digest(bytes)]));
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
   const bytes=observer?'<!doctype html><title>Isolated storage fixture</title>':module?{'firebase-app.js':appModule,'firebase-auth.js':authModule,'firebase-firestore.js':firestoreModule.replace('const rpc=(kind,args)=>window.__installedRPC(kind,args)',"const rpc=async(kind,args)=>{const result=await window.__installedRPC(kind,args);if(result?.fixtureFailure)throw Object.assign(Error('Synthetic external SDK refusal'),{code:result.fixtureFailure});return result;}")}[module]:pathname.startsWith(prefix)&&!name.includes('..')?sources.get(name):null;
   res.writeHead(bytes?200:404,{'Content-Type':module?'text/javascript':MIME[path.extname(name)]||'text/plain','Cache-Control':'no-store'});res.end(bytes||'Not found');
  });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;
  const playwright=await import('playwright');browser=await playwright[engine].launch({headless:true});browser.on('disconnected',()=>{if(!closing)report.errors.push('browser-disconnected');});report.runtime={engine,version:browser.version(),playwright:'1.62.1'};
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
   context=await browser.newContext({serviceWorkers:'block',viewport:options.viewport||{width:1100,height:850},reducedMotion:'reduce'});
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
   await context.addInitScript(browserInit,{dbName,authMode:options.authMode||'signed-out',sdkBase:origin+sdk});
   await context.addInitScript(({board,clipboardFail,clipboardDeferred,geoFail})=>{
    if(!localStorage.getItem('fvp:chain-scanner:device-store-v2')&&localStorage.getItem('fvp:chain-scanner:v1')===null)localStorage.setItem('fvp:chain-scanner:v1',JSON.stringify(board));
    window.__buttonClipboard=[];window.__buttonClipboardPending=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(clipboardFail)throw new DOMException('Synthetic clipboard permission refused','NotAllowedError');window.__buttonClipboard.push(text);if(clipboardDeferred)await new Promise((resolve,reject)=>window.__buttonClipboardPending.push({resolve,reject}));}}});
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(success,failure)=>geoFail?failure?.({code:1,message:'Synthetic location refused'}):success({coords:{latitude:40.7,longitude:-74,accuracy:20}})}});
   },{board,clipboardFail:options.clipboardFail,clipboardDeferred:options.clipboardDeferred,geoFail:options.geoFail});
   await context.addInitScript(()=>{
    window.__buttonRefuseWrites=false;window.__buttonRefuseReads=false;
    const tx=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode==='readonly'&&window.__buttonRefuseReads)throw new DOMException('Synthetic saved source read refused','UnknownError');if(mode==='readwrite'&&window.__buttonRefuseWrites)throw new DOMException('Synthetic saved source write refused','QuotaExceededError');return tx.call(this,stores,mode,...rest);};
    const put=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(window.__buttonRefuseWrites&&key.startsWith('fvp:chain-scanner:'))throw new DOMException('Synthetic browser storage write refused','QuotaExceededError');return put.call(this,key,value);};
   });
   if(options.retainedCopies){
    const observer=await context.newPage();await observer.goto(origin+prefix+'__button-observer');await observer.addScriptTag({content:sources.get('device-store-v2.js').toString()});
    report.retainedSources??=[];report.retainedSources.push(await observer.evaluate(async({dbName,board,count})=>{
     const store=ChainStorageV2.createDeviceStore({dbName});await store.open();const raw=JSON.stringify(board);
     const backups=Array.from({length:count},(_,i)=>({id:'gate-retained-'+i,kind:'manual',at:Date.now()-i,day:'2026-10-25',payload:JSON.stringify({...board,futureSourceRole:i})}));
     const result=await store.migrateLegacy({headPayload:raw,account:null,sourceFingerprint:await ChainStorageV2.hashPayload(JSON.stringify([{key:'fvp:chain-scanner:v1',raw}])),backups,opaqueArchives:[{key:'gate-opaque-exact',raw:'opaque exact bytes\u0000retain',futureBytes:new Uint8Array([0,17,255]),futureMinusZero:-0}]});
     if(!result.verified)throw Error('Native retained source fixture failed');const head=await store.readHead();await store.setPendingUpload('gate-owner',{generationId:'gate-pending',payloadHash:head.hash,baseRev:0,updatedAt:7});await store.close();
     return{count,eachPayloadBytes:backups[0].payload.length,ids:backups.map(row=>row.id)};
    },{dbName,board,count:options.retainedCopies}));await observer.close();
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
   await page.exposeBinding('__buttonClicked',(_,key)=>{report.clicks??=[];report.clicks.push({scenario:name,action:key,at:Date.now()});});
   await page.addInitScript(({keySource})=>{
    const key=eval('('+keySource+')');
    window.__buttonNativePresses=[];window.__buttonNativeClicks=[];
    document.addEventListener('pointerdown',event=>{if(event.isTrusted){const receipt={at:performance.timeOrigin+performance.now(),action:key(event.target.closest('button,summary,[data-act],[role="button"]')||document.documentElement)};window.__buttonNativePresses.push(receipt);void window.__buttonPressed(receipt);}},true);
    window.__buttonHeartbeat={at:performance.now(),maxGapMs:0,frames:0};const pulse=now=>{const h=window.__buttonHeartbeat;h.maxGapMs=Math.max(h.maxGapMs,now-h.at);h.at=now;h.frames++;if(h.clickAt!==undefined&&h.firstFrameAfterClickMs===undefined)h.firstFrameAfterClickMs=now-h.clickAt;requestAnimationFrame(pulse);};requestAnimationFrame(pulse);
    addEventListener('unhandledrejection',event=>void window.__buttonSafetyFailure('unhandledrejection: '+String(event.reason)));
    document.addEventListener('click',event=>{const el=event.target.closest('button,summary,[data-act],[role="button"],[data-scene-view],[data-landscape-motion],[data-scene-time],[data-scene-preset],[data-location-action]');if(el&&event.isTrusted){window.__buttonHeartbeat.clickAt=performance.now();delete window.__buttonHeartbeat.firstFrameAfterClickMs;window.__buttonNativeClicks.push({at:performance.now(),action:key(el)});void window.__buttonClicked(key(el));}},true);
    const scan=()=>{if(document.documentElement){const els=[...document.querySelectorAll('button,summary,[data-act],[role="button"],[data-scene-view],[data-landscape-motion],[data-scene-time],[data-scene-preset],[data-location-action]')];void window.__buttonObserved(els.map(key).filter(value=>value!==null));for(const el of els)if(key(el)?.startsWith('button-id:'))void window.__buttonUnidentified(el.outerHTML.slice(0,1000));}};
    addEventListener('DOMContentLoaded',()=>{scan();new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});});
   },{keySource:actionFor.toString()});
   await page.goto(origin+prefix);await page.waitForFunction(()=>typeof state!=='undefined'&&state&&window.ScannerDeviceStore);await page.waitForFunction(()=>window.CloudSync?.ready);localArmed=true;
   const setup=await bounded((async()=>{for(let attempt=0;attempt<200;attempt++){
    const result=await page.evaluate(async()=>{const head=await ScannerDeviceStore.readHead();return{currentTasks:state.tasks.length,activeTasks:state.tasks.filter(task=>!task.done).length,durableTasks:head?.payload?JSON.parse(head.payload).tasks.length:0,durableHash:head?.hash};});
    if(result.currentTasks===TASK_COUNT&&result.durableTasks===TASK_COUNT)return{...result,fixtureRole:options.fixtureRole||'active'};
    await new Promise(resolve=>setTimeout(resolve,25));
   }throw Error('Independent400-task setup did not reach durable storage');})(),'400-task durable setup',12000);
   if(options.writeFailAfterReady)await page.evaluate(()=>window.__buttonRefuseWrites=true);
   if(options.readFailAfterReady)await page.evaluate(()=>window.__buttonRefuseReads=true);
   if(options.downloadFail)await page.evaluate(()=>{URL.createObjectURL=()=>{throw new DOMException('Synthetic download refused','NotAllowedError');};});
   const expose=async selector=>{
    // Open each actual ancestor disclosure through its native summary consumer.
    const indexes=await page.locator(selector).first().evaluate(el=>{const all=[...document.querySelectorAll('details')],rows=[];for(let p=el.parentElement;p;p=p.parentElement)if(p.matches('details')&&!p.open&&!(el.matches('summary')&&el.parentElement===p))rows.unshift(all.indexOf(p));return rows;});
    for(const index of indexes){await step('details >> nth='+index+' >> :scope > summary',new Function('return document.querySelectorAll("details")['+index+']?.open===true'),'Expand containing disclosure');}
   };
   const waitFor=async(expect,timeoutMs=2500,label='expected state')=>bounded((async()=>{while(true){if(await page.evaluate(expect)===true)return;await new Promise(resolve=>setTimeout(resolve,25));}})(),label,timeoutMs);
   const step=async(selector,expect,description=selector,clickOptions={})=>{
    await expose(selector);const target=page.locator(selector).first();
    const action=await target.evaluate(actionFor);assert.ok(action,'Passive inert appearance replicas cannot earn action coverage');const before=report.clicks?.length||0;
    await bounded(page.evaluate(()=>{window.__buttonHeartbeat.maxGapMs=0;window.__buttonHeartbeat.at=performance.now();return window.__buttonHeartbeat.frames;}),'preclick heartbeat');const started=Date.now();
    await bounded(target.click(clickOptions),name+' / '+description);
    if(expect)await waitFor(expect,control==='async-pending'||control==='async-predicate-false'?2500:12000,'outcome '+description);
    else assert.fail('Every button step requires an independent expected outcome: '+description);
    await bounded(page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(true)))),'frame '+description);
    await new Promise(resolve=>setTimeout(resolve,30));check();
    const heartbeat=await bounded(page.evaluate(()=>({...window.__buttonHeartbeat})),'continuous heartbeat');
    report.samples??=[];report.samples.push({scenario:name,action,elapsedMs:Date.now()-started,maxFrameGapMs:heartbeat.maxGapMs,eventToFirstFrameMs:heartbeat.firstFrameAfterClickMs});
    assert.ok(heartbeat.maxGapMs<1000,'Native button safety detected blocked frame loop: '+description+' '+heartbeat.maxGapMs+'ms');
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
   const burst=async(actionName,expect,{selector,semantics,expectedAccepted=10,reload=false}={})=>{
    assert.ok(typeof semantics==='string'&&semantics.length>=10,'Explicit independent repeated-effect semantics required');
    selector??='[data-act="'+actionName+'"]';if(!selector.startsWith('#')&&await page.locator('#modalRoot '+selector).count())selector='#modalRoot '+selector;
    await expose(selector);const target=page.locator(selector).first();await bounded(target.scrollIntoViewIfNeeded(),'rapid target scroll');const originalBox=await target.boundingBox();assert.ok(originalBox,'Rapid target is initially rendered');
    const action=await target.evaluate(actionFor);assert.ok(action===actionName||action==='act:'+actionName,'Rapid target action must match independent family');
    await page.evaluate(()=>{window.__buttonHeartbeat.maxGapMs=0;window.__buttonHeartbeat.at=performance.now();});const start={presses:report.presses?.length||0,clicks:report.clicks?.length||0};
    const previousDocument=reload?await page.evaluate(()=>window.__installedFixture.documentId):null;if(reload)allowedNavigation={url:page.url(),remaining:1,action};
    const attempts=[];const began=Date.now();
    for(let index=0;index<10;index++){
     let availability={present:false,disabled:false,hit:false},box=originalBox;
     const snapshot=await bounded(target.evaluateAll((els,backdrop)=>{const el=els[0];if(!el)return null;let r=el.getBoundingClientRect();if(r.width&&r.height&&(r.y<0||r.x<0||r.bottom>innerHeight||r.right>innerWidth)&&!el.closest('[inert]')){el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});r=el.getBoundingClientRect();}const hit=document.elementFromPoint(r.x+(backdrop?5:r.width/2),r.y+(backdrop?5:r.height/2));return{box:{x:r.x,y:r.y,width:r.width,height:r.height},present:!!(r.width&&r.height),disabled:el.matches(':disabled'),hit:!!hit&&(el===hit||el.contains(hit))};},action==='act:mback'),'rapid target availability');
     if(snapshot){availability=snapshot;if(snapshot.present)box=snapshot.box;}
     const before={clicks:report.clicks?.length||0,presses:report.presses?.length||0};
     if(availability.present&&availability.hit)await bounded(page.mouse.click(box.x+(action==='act:mback'?5:box.width/2),box.y+(action==='act:mback'?5:box.height/2)),'rapid native press '+actionName);
     else{
      // The original control has disappeared or is obscured by its result. A
      // real down followed by release outside the viewport cannot activate a
      // different app control under its former position.
      await bounded((async()=>{await page.mouse.move(originalBox.x+originalBox.width/2,originalBox.y+originalBox.height/2);await page.mouse.down();await page.mouse.move(-10,-10);await page.mouse.up();})(),'rapid refused press '+actionName);
     }
     if(reload&&index===0){await bounded(page.waitForFunction(old=>window.__installedFixture?.documentId!==old&&document.documentElement.dataset.appReady==='true',previousDocument),'rapid bounded reload',2000);assert.equal(allowedNavigation.remaining,0,'Exactly one expected rapid reload');allowedNavigation=null;}
     await bounded(page.evaluate(()=>true),'rapid native receipt');const received={presses:(report.presses||[]).slice(before.presses),clicks:(report.clicks||[]).slice(before.clicks).filter(row=>row.action===action)};
     attempts.push({index,availability,trustedPresses:received.presses.length,acceptedClicks:received.clicks.length,classification:received.clicks.length?'accepted':availability.present?'refused':'disappeared',at:received.presses[0]?.at});
    }
    const finished=Date.now();const presses=(report.presses||[]).slice(start.presses);
    assert.equal(presses.length,10,'Ten browser-trusted native press receipts: '+actionName);
    assert.ok(finished-began<=2000,'Ten native press attempts must finish within two seconds: '+actionName+' '+(finished-began)+'ms');
    await waitFor(expect,12000,'rapid outcome '+actionName);await bounded(page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve))),'rapid response '+actionName);check();
    const heartbeat=await page.evaluate(()=>({...window.__buttonHeartbeat}));assert.ok(heartbeat.maxGapMs<1000,'Rapid button action blocked frame loop: '+actionName+' '+heartbeat.maxGapMs+'ms');
    const acceptedClicks=attempts.reduce((sum,row)=>sum+row.acceptedClicks,0),refused=attempts.filter(row=>row.classification==='refused').length,disappeared=attempts.filter(row=>row.classification==='disappeared').length;
    if(typeof expectedAccepted==='number')assert.equal(acceptedClicks,expectedAccepted,'Independent accepted native click count: '+actionName);
    else assert.ok(acceptedClicks>=expectedAccepted.min&&acceptedClicks<=expectedAccepted.max,'Independent accepted native click bounds: '+actionName);
    const row=rapidOutcomes.get(action)||{action,status:'passed',responsive:true,assertions:0,bursts:[]};row.assertions++;
    row.bursts.push({scenario:name,attempts:10,trustedPresses:presses.length,windowMs:finished-began,browserWindowMs:presses.at(-1).at-presses[0].at,acceptedClicks,refused,disappeared,semantics,maxFrameGapMs:heartbeat.maxGapMs,attemptDetails:attempts});rapidOutcomes.set(action,row);report.rapidOutcomes=[...rapidOutcomes.values()];
    const normal=outcomes.get(action)||{action,status:'passed',events:['click'],assertions:0,responsive:true,steps:[]};normal.assertions++;normal.steps.push({scenario:name,description:'Rapid '+semantics,elapsedMs:finished-began,maxFrameGapMs:heartbeat.maxGapMs});outcomes.set(action,normal);report.outcomes=[...outcomes.values()];
    return row.bursts.at(-1);
   };
   const ui={page,click:step,waitFor,burst,backdrop:()=>step('.mback',()=>!document.querySelector('#modalRoot .modal'),'Dismiss dialog backdrop',{position:{x:5,y:5}}),expectReload:async action=>{const before=await page.evaluate(()=>window.__installedFixture.documentId);allowedNavigation={url:page.url(),remaining:1,action};const expected=new Function('return window.__installedFixture?.documentId!=='+JSON.stringify(before)+'&&document.documentElement.dataset.appReady==="true"');await step('[data-act="'+action+'"]',expected,action+' bounded reload');assert.equal(allowedNavigation.remaining,0,'exactly one expected same-route reload');allowedNavigation=null;},act:async(action,expect,selector)=>{if(!selector){selector='[data-act="'+action+'"]';if(await page.locator('#modalRoot '+selector).count())selector='#modalRoot '+selector;}return step(selector,expect,action);},fill:(selector,value)=>nativeInput('fill',selector,value),select:(selector,value)=>nativeInput('select',selector,value),expose};
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
  if(probe)await scenario('detector sensitivity',{},async ui=>{await ui.act('settings',control==='async-predicate-false'?async()=>false:()=>!!document.getElementById('stHorizon'));});
  else if(scenarioFilter?.startsWith('rapid ')){const {runRapidScenarios}=await import('./button-safety-rapid.mjs');await runRapidScenarios({scenario});}
  else {await runButtonScenarios({scenario});const {runRapidScenarios}=await import('./button-safety-rapid.mjs');await runRapidScenarios({scenario});}
  if(scenarioFilter)assert.equal(report.scenarios?.length,1,'Exactly one requested diagnostic scenario must execute');
  for(const action of observed)assert.ok(report.requiredActions.includes(action),'New untested button action: '+action);
  report.observedActions=[...observed].sort();report.outcomes=[...outcomes.values()];report.rapidOutcomes=[...rapidOutcomes.values()];if(scenarioFilter)report.scope='focused-diagnostic';
  report.status='passed';
 }catch(error){report.status='failed';report.failure=error.stack;try{report.failureObservation=await bounded(page.evaluate(()=>({modal:document.getElementById('modalRoot')?.innerText,toast:document.getElementById('toast')?.innerText,mode:state.mode,chain:state.chain,candidateId:state.candidateId,taskTitles:state.tasks.slice(0,10).map(t=>({id:t.id,title:t.title}))})),'failure observation');}catch(observationError){report.failureObservationError=String(observationError);}throw error;}
 finally{
  closing=true;
  if(context){await context.close();report.cleanup.contextClosed=true;}
  if(browser){await browser.close();report.cleanup.browserClosed=true;}
  if(server){await new Promise(resolve=>server.close(resolve));report.cleanup.serverClosed=true;}
  report.finishedAt=new Date().toISOString();save();
 }
 return{report,reportPath};
}
