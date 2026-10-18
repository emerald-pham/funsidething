import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {browserInit,appModule,authModule,firestoreModule,fixture} from './installed-client-fixture.mjs';

const OLD='779defa4e8c3465fdf535fe17dbe2227d2b76ea1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=15000){
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await check())return;await sleep(50);}
  assert.fail('Native lifecycle deadline: '+label);
}
async function ready(page,auth=true){
  await page.waitForFunction(()=>typeof state!=='undefined'&&state!==null&&window.ScannerDeviceStore);
  if(auth)await page.waitForFunction(()=>window.CloudSync?.ready&&window.CloudSync===window.__fixtureCloudSync);
}
async function observe(page){
  return page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.getRegistration();
    const worker=w=>w?{state:w.state,scriptURL:w.scriptURL}:null;
    const bytes=new TextEncoder().encode([...document.scripts].find(s=>!s.src&&!s.type&&/^\s*"use strict";/.test(s.textContent))?.textContent||'');
    return {documentId:window.__installedFixture.documentId,build:document.getElementById('appChangelogCurrent')?.innerHTML.match(/data-app-fingerprint="([^"]+)"/)?.[1],inlineSha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join(''),controller:worker(navigator.serviceWorker.controller),waiting:worker(registration?.waiting),state:JSON.stringify(state),head:await ScannerDeviceStore.readHead(),backups:await ScannerDeviceStore.listBackups(),opaque:await ScannerDeviceStore.listOpaqueArchives(),pending:await ScannerDeviceStore.getPendingUpload('owner'),draft:document.getElementById('addInput')?.value,browserSources:['fvp:chain-scanner:v1','fvp:chain-scanner:protected:v1'].map(key=>({key,raw:localStorage.getItem(key)})),auth:{ready:window.CloudSync?.ready,stage:window.CloudSync?.errorStage,user:!!window.CloudSync?.user}};
  });
}
function assertRetention(before,after){
  assert.equal(after.head.payload,before.head.payload,'durable head exact');
  assert.deepEqual(after.pending,before.pending,'pending generation exact');
  assert.deepEqual(after.opaque,before.opaque,'opaque archive exact');
  assert.deepEqual(after.browserSources,before.browserSources,'browser source copies exact');
  for(const backup of before.backups.filter(b=>!['daily','latest'].includes(b.kind)))assert.ok(after.backups.some(b=>JSON.stringify(b)===JSON.stringify(backup)),'protected/manual backup exact: '+backup.id);
  const board=JSON.parse(after.state);
  assert.deepEqual(board.futureBoard,{opaque:['retain',11]},'unknown board field retained');
  assert.deepEqual(board.tasks.find(t=>t.id==='synthetic-kept')?.futureTask,{opaque:['retain',7]},'unknown task field retained');
}
async function nativeAdd(page,title){
  if(!await page.locator('#addInput').isVisible())await page.locator('[data-act="toggle-add"]').click();
  await page.locator('#addInput').fill(title);await page.locator('#addPanel [data-act="add"]').click();
  await page.waitForFunction(title=>state.tasks.some(t=>t.title===title),title);
  await page.waitForFunction(()=>document.getElementById('addInput').value==='');
}

// The only caller is tests.js's required native child. No product behavior switches.
export async function runInstalledClientCase({mode,repo,oldCommit,candidateCommit,candidateTree,outputDir,port=0,timeoutMs=180000}){
  assert.ok(['signed-out','reconcile-held'].includes(mode));
  assert.equal(oldCommit,OLD,'immutable installed source must remain779');
  const git=(...args)=>execFileSync('git',args,{cwd:repo});
  for(const [name,value] of Object.entries({oldCommit,candidateCommit,candidateTree}))assert.match(value||'',/^[a-f0-9]{40}$/,'Explicit full '+name+' required');
  assert.equal(git('rev-parse',candidateCommit+'^{commit}').toString().trim(),candidateCommit);
  assert.equal(git('rev-parse',candidateCommit+'^{tree}').toString().trim(),candidateTree,'explicit candidate tree');
  git('merge-base','--is-ancestor',candidateCommit,'HEAD');
  assert.notEqual(candidateCommit,OLD,'old source cannot be the candidate');
  const bytes=(sha,file)=>git('show',sha+':'+file);
  function shell(sha){
    const sw=bytes(sha,'sw.js').toString(),match=sw.match(/\.addAll\(\[([\s\S]*?)\]\s*\.map/);assert.ok(match,'actual worker shell list');
    const entries=[...match[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
    const files=[...new Set(entries.map(p=>p==='./'?'index.html':p.replace(/^\.\//,'')))];
    const identities=Object.fromEntries([...files,'sw.js'].map(file=>[file,hash(bytes(sha,file))]));
    const fingerprint=createHash('sha256');for(const file of [...files].sort()){fingerprint.update(file);fingerprint.update('\0');fingerprint.update(bytes(sha,file));fingerprint.update('\0');}
    const cacheName=sw.match(/const CACHE_NAME = "([^"]+)"/)?.[1];assert.equal(cacheName,'chain-scanner-shell-'+fingerprint.digest('hex'),'immutable shell metadata must cohere');
    const html=bytes(sha,'index.html').toString(),inline=html.match(/<script>((?:\s*)"use strict";[\s\S]*?)<\/script>/)?.[1];
    assert.ok(inline,'actual inline app source');
    return {sha,entries,files,identities,cacheName,build:html.match(/data-app-fingerprint="([^"]+)"/)?.[1],inlineSha256:hash(inline)};
  }
  const old=shell(OLD),candidate=shell(candidateCommit);
  assert.notEqual(old.cacheName,candidate.cacheName,'delivery must cross a real shell version');
  // Dirty tests may serve a committed app, but the app assets themselves must be equal.
  for(const [file,digest] of Object.entries(candidate.identities))assert.equal(hash(fs.readFileSync(path.join(repo,file))),digest,'checkout app asset differs from explicit candidate: '+file);
  fs.mkdirSync(outputDir,{recursive:true});
  const reportPath=path.join(outputDir,mode+'-'+randomUUID()+'.json');
  const report={mode,oldCommit,candidateCommit,candidateTree,startedAt:new Date().toISOString(),status:'prepared',shells:{old,candidate},checkout:git('rev-parse','HEAD').toString().trim(),runnerDiff:hash(git('diff','HEAD')),requests:[],responses:[],observations:{},cleanup:{},limits:['Synthetic external SDK only; real app, IDB, worker and cache.','Local ephemeral Chromium profile, not physical-device or deployed acceptance.','Dirty runner serving explicit committed app is not final clean-candidate proof.']};
  const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save();
  let browser,context,server,watchdog,phase=OLD;
  const prefix='/installed-'+randomUUID()+'/',sdkPrefix='/fixture-sdk-'+randomUUID()+'/',dbName='installed-'+randomUUID();
  const board=fixture(mode),raw=JSON.stringify(board),remotePayload=JSON.stringify({...board,decisionBaseline:{v:99,opaque:'synthetic future authority'},futureRemote:{opaque:'exact'}});
  const remote=new Map(mode==='reconcile-held'?[['users/owner',{payload:remotePayload,rev:4,updatedAt:1}]]:[]),remoteBefore=JSON.stringify([...remote]),calls=[];
  const errors=[],external=[];
  try{
    const {chromium}=await import('playwright');
    server=http.createServer((req,res)=>{
      try{
        const url=new URL(req.url,'http://localhost'),file=decodeURIComponent(url.pathname.slice(prefix.length))||'index.html';
        let body,type='text/html';
        if(url.pathname.startsWith('/transport-probe/')){report.transportRequests??=[];report.transportRequests.push(url.pathname);body=JSON.stringify({path:url.pathname});type='application/json';}
        else if(url.pathname.startsWith(sdkPrefix)){const sdk=url.pathname.split('/').at(-1);body={'firebase-app.js':appModule,'firebase-auth.js':authModule,'firebase-firestore.js':firestoreModule}[sdk];assert.ok(body,'known synthetic SDK module');type='text/javascript';}
        else if(url.pathname==='/observer')body='<!doctype html><title>Native worker observer</title>';
        else {assert.ok(url.pathname.startsWith(prefix)&&!file.includes('..'),'isolated app scope');body=bytes(phase,file);type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':file.endsWith('.webmanifest')?'application/manifest+json':'text/plain';report.requests.push({phase,file,sha256:hash(body)});}
        res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Service-Worker-Allowed':prefix});res.end(body);
      }catch(error){report.requests.push({error:error.message,url:req.url});res.writeHead(404);res.end('Missing immutable asset');}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    const origin='http://127.0.0.1:'+server.address().port,url=origin+prefix;
    browser=await chromium.launch({headless:true});report.runtime={engine:'chromium',version:browser.version(),launchOptions:{headless:true},executableOverride:false,playwright:'1.62.1'};
    watchdog=setTimeout(()=>{report.deadline=true;save();void browser?.close();server?.closeAllConnections();},timeoutMs);
    context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1000,height:800},reducedMotion:'reduce'});
    await context.exposeBinding('__installedRPC',(_,kind,args)=>{calls.push({kind,args});if(kind==='get')return structuredClone(remote.get(args[0])??null);if(kind==='list')return [...remote].filter(([key])=>key.startsWith(args[0]+'/'));throw Error('Unexpected cloud write');});
    await context.addInitScript(browserInit,{dbName,authMode:mode,sdkBase:origin+sdkPrefix});
    await context.route('**/*',async route=>{const request=route.request(),u=new URL(request.url());if(u.origin===origin)return route.continue();external.push(u.origin+u.pathname);return route.abort();});
    const observer=await context.newPage();await observer.goto(origin+'/observer');await observer.addScriptTag({content:bytes(OLD,'device-store-v2.js').toString()});
    report.seed=await observer.evaluate(async({dbName,raw,account})=>{
      const store=ChainStorageV2.createDeviceStore({dbName});await store.open();
      const backups=[{id:'synthetic-manual',kind:'manual',at:2,day:'2026-10-18',payload:raw},{id:'synthetic-protected',kind:'before-decision-replacement',at:3,day:'2026-10-18',payload:raw}];
      const opaqueArchives=[{key:'synthetic-opaque',raw:'opaque exact bytes\u0000retain'}];
      for(const key of ['fvp:chain-scanner:v1','fvp:chain-scanner:protected:v1'])localStorage.setItem(key,raw);
      const sourceFingerprint=await ChainStorageV2.hashPayload(JSON.stringify([{key:'fvp:chain-scanner:protected:v1',raw},{key:'fvp:chain-scanner:v1',raw}]));
      const result=await store.migrateLegacy({headPayload:raw,account,sourceFingerprint,backups,opaqueArchives});await store.close();return result;
    },{dbName,raw,account:board.syncAccount});assert.equal(report.seed.verified,true);
    const attach=page=>{
      page.on('pageerror',error=>errors.push(error.message));
      page.on('response',async response=>{try{const u=new URL(response.url());if(u.origin!==origin||!u.pathname.startsWith(prefix))return;const file=u.pathname.slice(prefix.length)||'index.html';if(!candidate.identities[file])return;report.responses.push({file,sha256:hash(await response.body()),fromServiceWorker:response.fromServiceWorker()});}catch(error){report.responseError=error.message;}});
    };
    let page=await context.newPage();attach(page);await page.goto(url);await ready(page);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    if(mode==='reconcile-held')await page.waitForFunction(()=>CloudSync.errorStage==='reconcile');
    report.observations.old=await observe(page);assert.equal(report.observations.old.build,old.build);
    await page.evaluate(async()=>{const head=await ScannerDeviceStore.readHead();const record={generationId:'synthetic-pending',payloadHash:head.hash,baseRev:4,updatedAt:17};if(!(await ScannerDeviceStore.setPendingUpload('owner',record)).ok)throw Error('Pending seed rejected');});
    const second=await context.newPage();attach(second);await second.goto(url);await ready(second);await second.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await nativeAdd(second,'Accepted synthetic edit');assert.equal(await second.evaluate(()=>persist()),true);
    await second.locator('#addInput').fill('Unfinished synthetic draft');await second.locator('h1').click();
    const used=report.observations.used=await observe(second);assert.equal(used.draft,'Unfinished synthetic draft');
    phase=candidateCommit;await page.evaluate(()=>checkForAppUpdate());
    await until(()=>page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting),'candidate waiting with two old clients');
    const waiting=report.observations.waiting=await observe(second);assert.equal(waiting.documentId,used.documentId);assert.equal(waiting.build,old.build);assert.equal(waiting.draft,used.draft);assertRetention(used,waiting);
    async function verifyCache(){
      const rows=await observer.evaluate(async({scope,shell})=>{
        const cache=await caches.open(shell.cacheName),rows=[];
        for(const entry of shell.entries){const response=await cache.match(new URL(entry,scope).href);rows.push({entry,sha256:response?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join(''):null});}return rows;
      },{scope:url,shell:candidate});
      for(const row of rows)assert.equal(row.sha256,candidate.identities[row.entry==='./'?'index.html':row.entry.slice(2)],'candidate cache byte identity: '+row.entry);
      return rows;
    }
    report.stagedCache=await verifyCache();
    await page.close();
    const oneLeft=report.observations.oneLeft=await observe(second);assert.ok(oneLeft.waiting);assert.equal(oneLeft.documentId,used.documentId);assert.equal(oneLeft.draft,used.draft);assertRetention(used,oneLeft);
    await second.locator('#addPanel [data-act="add"]').click();await second.waitForFunction(()=>state.tasks.some(t=>t.title==='Unfinished synthetic draft')&&document.getElementById('addInput').value==='');
    assert.equal(await second.evaluate(()=>persist()),true);
    report.recoveryProof=await second.evaluate(async()=>{
      const head=await ScannerDeviceStore.readHead(),backup={id:'synthetic-before-delivery:'+head.hash,kind:'before-decision-replacement',at:Date.now(),day:new Date().toISOString().slice(0,10),payload:head.payload};
      const write=await ScannerDeviceStore.putBackup({expectedHash:head.hash,backup});if(!write.ok)throw Error('Recovery proof write failed');
      const read=(await ScannerDeviceStore.listBackups()).find(b=>b.id===backup.id);if(read?.payload!==head.payload)throw Error('Recovery readback mismatch');return read;
    });
    const accepted=report.observations.accepted=await observe(second);assert.equal(accepted.draft,'');assert.ok(JSON.parse(accepted.head.payload).tasks.some(t=>t.title==='Unfinished synthetic draft'),'accepted draft in durable head before final close');
    await second.close();
    await until(()=>observer.evaluate(async scope=>{const r=await navigator.serviceWorker.getRegistration(scope);return r?.active?.state==='activated'&&!r.waiting;},url),'natural last-client activation');
    page=await context.newPage();attach(page);let response=await page.goto(url);assert.equal(hash(await response.body()),candidate.identities['index.html'],'delivered document exact candidate');
    await ready(page);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    const reopened=report.observations.reopened=await observe(page);assert.equal(reopened.build,candidate.build);assert.equal(reopened.inlineSha256,candidate.inlineSha256,'delivered actual inline consumer');assertRetention(accepted,reopened);
    if(mode==='reconcile-held'){await page.waitForFunction(()=>CloudSync.errorStage==='reconcile');assert.equal((await observe(page)).auth.stage,'reconcile');}
    report.deliveredCache=await verifyCache();
    const onlineProbe='/transport-probe/'+randomUUID(),offlineProbe='/transport-probe/'+randomUUID();
    report.onlineTransport=await page.evaluate(async probe=>{const response=await fetch(probe,{cache:'no-store'});return {status:response.status,body:await response.json(),navigatorOnline:navigator.onLine};},origin+onlineProbe);
    assert.equal(report.onlineTransport.status,200);assert.equal(report.onlineTransport.body.path,onlineProbe);assert.ok(report.transportRequests.includes(onlineProbe),'online control reached real listener');
    await context.setOffline(true);
    // Keep the listener live: network-offline must block an uncached fetch,
    // rather than merely demonstrate that an origin server was shut down.
    report.offlineTransport=await page.evaluate(async probe=>{
      try{const response=await fetch(probe,{cache:'no-store'});return {failed:false,status:response.status,navigatorOnline:navigator.onLine};}
      catch(error){return {failed:true,name:error.name,navigatorOnline:navigator.onLine};}
    },origin+offlineProbe);
    assert.equal(report.offlineTransport.failed,true,'uncached non-navigation transport must fail before offline acceptance');
    assert.ok(!report.transportRequests.includes(offlineProbe),'offline request cannot reach the still-live listener');assert.equal(server.listening,true,'offline proof keeps the origin available');
    response=await page.reload({waitUntil:'load'});assert.equal(hash(await response.body()),candidate.identities['index.html'],'same delivered candidate offline document');assert.equal(response.fromServiceWorker(),true,'real worker supplies offline navigation');
    await ready(page,false);const offline=report.observations.offline=await observe(page);
    report.offlineNavigatorOnline=await page.evaluate(()=>navigator.onLine);assert.equal(offline.build,candidate.build);assert.equal(offline.inlineSha256,candidate.inlineSha256);assertRetention(accepted,offline);
    if(!await page.locator('#addInput').isVisible())await page.locator('[data-act="toggle-add"]').click();
    await page.locator('#addInput').fill('Offline local draft');assert.equal(await page.locator('#addInput').inputValue(),'Offline local draft','offline local consumer usable');
    assert.equal(JSON.stringify([...remote]),remoteBefore,'held remote payload/revision exact');assert.equal(calls.filter(call=>call.kind==='apply').length,0,'zero cloud writes');
    assert.deepEqual(errors,[],'native app has no uncaught errors');assert.equal(report.requests.filter(row=>row.error).length,0,'immutable serving complete');
    report.remote={before:remoteBefore,after:JSON.stringify([...remote]),calls};report.externalBlocked=external;report.status='passed';
    return {reportPath,mode,candidateCommit,candidateTree};
  }catch(error){report.status='failed';report.error={name:error.name,message:error.message,stack:error.stack};throw error;}
  finally{
    clearTimeout(watchdog);
    try{await context?.close();report.cleanup.contextClosed=true;}finally{
      try{await browser?.close();report.cleanup.browserClosed=true;}finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}report.cleanup.serverClosed=true;report.completedAt=new Date().toISOString();save();}
    }
  }
}
