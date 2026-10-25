import assert from 'node:assert/strict';
import {fixture} from './installed-client-fixture.mjs';

const MANIFEST = 'users/owner';

function sameBoardRemote(){
  return new Map([[MANIFEST,{payload:JSON.stringify(fixture('reconcile-held')),rev:4,updatedAt:1}]]);
}

async function damagedCurrentRemote(){
  await import('../device-store-v2.js');
  const encode=globalThis.ChainStorageV2?.encodeSnapshot;
  assert.equal(typeof encode,'function','The installed device-store codec builds an actual cloud generation fixture');
  const encoded=await encode(JSON.stringify(fixture('reconcile-held')));
  const {chunks,...header}=encoded;
  const current='gate-held-current',previous='gate-valid-previous';
  const remote=new Map([
    [MANIFEST,{schemaVersion:2,rev:4,activeGeneration:current,previousGeneration:previous}],
    [MANIFEST+'/generations/'+current,{...header,hash:'f'.repeat(64),state:'published',baseRev:3}],
    [MANIFEST+'/generations/'+previous,{...header,state:'published',baseRev:2}],
    ...chunks.map(chunk=>[MANIFEST+'/generations/'+previous+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk])
  ]);
  return remote;
}

async function replacePreviousWithCurrentBoard(ui,remote){
  const manifest=remote.get(MANIFEST),generation=manifest?.previousGeneration;
  assert.equal(typeof generation,'string','The damaged manifest names an explicit previous source');
  const payload=await ui.page.evaluate(()=>JSON.stringify(state));
  assert.equal(typeof payload,'string','The accepted current device board is readable before review');
  const encoded=await globalThis.ChainStorageV2.encodeSnapshot(payload),{chunks,...header}=encoded;
  const prefix=MANIFEST+'/generations/'+generation;
  for(const key of [...remote.keys()])if(key.startsWith(prefix+'/chunks/'))remote.delete(key);
  remote.set(prefix,{...header,state:'published',baseRev:2});
  for(const chunk of chunks)remote.set(prefix+'/chunks/'+String(chunk.index).padStart(8,'0'),chunk);
}

function assertFixtureBoard(board,label){
  const original=fixture('reconcile-held');
  assert.ok(board&&Array.isArray(board.tasks),label+' keeps a readable durable board');
  assert.deepEqual(board.tasks.map(({id,futureTask})=>({id,futureTask})),
    original.tasks.map(({id,futureTask})=>({id,futureTask})),label+' retains each exact task extension');
  assert.deepEqual(board.futureBoard,original.futureBoard,label+' retains the exact unknown board value');
  assert.deepEqual(board.futurePopulated,original.futurePopulated,label+' retains the exact large unknown board value');
}

async function assertCurrentAndStoredFixtureBoard(ui,label){
  const boards=await ui.page.evaluate(async()=>{
    const head=await window.ScannerDeviceStore.readHead();
    return {current:JSON.parse(JSON.stringify(state)),stored:head?.payload?JSON.parse(head.payload):null};
  });
  assertFixtureBoard(boards.current,label+' active board');
  assertFixtureBoard(boards.stored,label+' saved board');
}

async function assertPublished(remote,label){
  const root=remote.get(MANIFEST);
  assert.equal(root?.schemaVersion,2,label+' publishes a generation manifest');
  assert.ok(Number.isSafeInteger(root?.rev)&&root.rev>4,label+' advances the confirmed cloud revision');
  assert.equal(typeof root.activeGeneration,'string',label+' selects its published generation');
  const header=remote.get(MANIFEST+'/generations/'+root.activeGeneration);
  assert.equal(header?.state,'published',label+' leaves the selected generation published');
  assert.ok(remote.has(MANIFEST+'/generations/'+root.activeGeneration+'/chunks/00000000'),label+' publishes generation bytes');
  const prefix=MANIFEST+'/generations/'+root.activeGeneration+'/chunks/';
  const chunks=[...remote].filter(([key])=>key.startsWith(prefix)).map(([,chunk])=>chunk).sort((a,b)=>a.index-b.index);
  const board=JSON.parse(await globalThis.ChainStorageV2.decodeSnapshot(header,chunks));
  assertFixtureBoard(board,label+' cloud copy');
}

async function readRemoteBoard(remote,label){
  await import('../device-store-v2.js');
  const root=remote.get(MANIFEST);
  if(typeof root?.payload==='string')return JSON.parse(root.payload);
  assert.equal(root?.schemaVersion,2,label+' has a supported generation manifest');
  const generation=root.activeGeneration,header=remote.get(MANIFEST+'/generations/'+generation);
  assert.equal(header?.state,'published',label+' selects a published generation');
  const prefix=MANIFEST+'/generations/'+generation+'/chunks/';
  const chunks=[...remote].filter(([key])=>key.startsWith(prefix)).map(([,chunk])=>chunk).sort((a,b)=>a.index-b.index);
  return JSON.parse(await globalThis.ChainStorageV2.decodeSnapshot(header,chunks));
}

async function confirmedAction(ui,action,expected,selector){
 const revision=await ui.page.evaluate(()=>state.syncRev);
 const predicate=new Function('return ('+expected.toString().replace('state.syncRev>4','state.syncRev>'+revision)+')')();
 await ui.act(action,predicate,selector);
}
export async function runCloudScenarios(h){
  await h.scenario('cloud sync signs out and rejects signed-out authentication safely',{
    authMode:'reconcile-held',remote:sameBoardRemote()
  },async ui=>{
    await ui.page.waitForFunction(()=>window.CloudSync?.ready===true&&window.CloudSync.user==='fixture@example.invalid'&&
      window.CloudSync.status==='ok'&&state.syncDirty===false&&!pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy,null,{timeout:10000});
    await ui.act('sync',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return window.CloudSync?.user===null&&window.CloudSync.status==='signed-out'&&
        document.getElementById('syncBtn')?.textContent.includes('sign in')&&state.tasks.length===64&&
        state.futurePopulated?.opaque.length===1048576&&saved?.tasks.length===64&&saved.futurePopulated?.opaque.length===1048576;
    },'#syncBtn');
    await assertCurrentAndStoredFixtureBoard(ui,'Signed-out transition');
    await ui.act('sync',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return window.CloudSync?.user===null&&window.CloudSync.status==='error'&&window.CloudSync.errorStage==='sign-in'&&
        document.getElementById('syncBtn')?.textContent.includes('error')&&state.tasks.length===64&&
        state.futurePopulated?.opaque.length===1048576&&saved?.tasks.length===64&&saved.futurePopulated?.opaque.length===1048576;
    },'#syncBtn');
    await assertCurrentAndStoredFixtureBoard(ui,'Signed-out authentication failure');
  });

  const unavailableSync={authMode:'reconcile-held',remote:new Map(),cloudReadFail:true};
  await h.scenario('cloud retry, reload, and sign out preserve the device board during read failures',unavailableSync,async ui=>{
    await ui.page.waitForFunction(()=>window.CloudSync?.ready===true&&window.CloudSync.status==='error'&&
      window.CloudSync.errorCode==='unavailable'&&!pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy,null,{timeout:10000});
    await ui.act('sync',()=>document.querySelector('#modalRoot h2')?.textContent==='Cloud sync needs attention','#syncBtn');
    await ui.act('sync-retry',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return !document.querySelector('#modalRoot .modal')&&window.CloudSync?.status==='error'&&
        window.CloudSync.errorCode==='unavailable'&&state.tasks.length===64&&
        state.futurePopulated?.opaque.length===1048576&&saved?.tasks.length===64&&saved.futurePopulated?.opaque.length===1048576&&
        !pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy;
    },'#modalRoot [data-act="sync-retry"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud retry read failure');
    await ui.act('sync',()=>document.querySelector('#modalRoot h2')?.textContent==='Cloud sync needs attention','#syncBtn');
    await ui.expectReload('sync-reload');
    await ui.waitFor(async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return window.CloudSync?.ready===true&&window.CloudSync.status==='error'&&window.CloudSync.errorCode==='unavailable'&&
        state.tasks.length===64&&state.futurePopulated?.opaque.length===1048576&&
        saved?.tasks.length===64&&saved.futurePopulated?.opaque.length===1048576&&
        !pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy;
    },10000);
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud reload read failure');
    await ui.act('sync',()=>document.querySelector('#modalRoot h2')?.textContent==='Cloud sync needs attention','#syncBtn');
    await ui.act('sync-signout',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return window.CloudSync?.user===null&&window.CloudSync.status==='signed-out'&&
        state.tasks.length===64&&state.futurePopulated?.opaque.length===1048576&&
        saved?.tasks.length===64&&saved.futurePopulated?.opaque.length===1048576;
    },'#modalRoot [data-act="sync-signout"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud read failure and sign out');
  });

  const cloudOptions={authMode:'reconcile-held',remote:await damagedCurrentRemote()};
  await h.scenario('cloud recovery reviews, protects, and applies a source with read and write failures',cloudOptions,async ui=>{
    await ui.page.waitForFunction(()=>window.CloudSync?.ready===true&&window.CloudSync.user==='fixture@example.invalid'&&
      window.CloudSync.status==='error'&&window.CloudSync.errorCode==='corrupt-generation'&&
      !pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy,null,{timeout:10000});
    await replacePreviousWithCurrentBoard(ui,cloudOptions.remote);
    await ui.act('sync',()=>document.querySelector('#modalRoot h2')?.textContent==='Cloud sync needs attention','#syncBtn');

    cloudOptions.cloudReadFail=true;
    await ui.act('review-cloud-source-recovery',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      const modal=document.querySelector('#modalRoot');
      return modal?.querySelector('h2')?.textContent==='Review cloud recovery sources'&&
        /cloud reads are still unavailable/i.test(modal.textContent)&&
        !modal.querySelector('[data-act="choose-cloud-recovery-source"]')&&
        !modal.querySelector('[data-act="apply-cloud-source-recovery"]')&&state.tasks.length===64&&
        state.futurePopulated?.opaque.length===1048576&&saved?.tasks.length===64&&saved.futurePopulated?.opaque.length===1048576;
    },'#modalRoot [data-act="review-cloud-source-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud source review read failure');

    cloudOptions.cloudReadFail=false;
    await ui.act('review-cloud-source-recovery',()=>{
      const modal=document.querySelector('#modalRoot');
      const device=modal?.querySelector('[data-act="choose-cloud-recovery-source"][data-value="device"]');
      const previous=modal?.querySelector('[data-act="choose-cloud-recovery-source"][data-value="generation:gate-valid-previous"]');
      return modal?.querySelector('h2')?.textContent==='Review cloud recovery sources'&&device&&!device.disabled&&
        !cloudSourceRecoveryBusy&&!modal.querySelector('[data-cloud-source-progress]')&&
        previous&&!previous.disabled&&modal.querySelectorAll('[data-act="choose-cloud-recovery-source"][aria-pressed="true"]').length===0&&
        modal.querySelector('[data-act="apply-cloud-source-recovery"]')?.disabled===true;
    },'#modalRoot [data-act="review-cloud-source-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud source review');
    await ui.act('choose-cloud-recovery-source',()=>{
      const modal=document.querySelector('#modalRoot'),choice=modal?.querySelector('[data-act="choose-cloud-recovery-source"][data-value="device"]');
      return choice?.getAttribute('aria-pressed')==='true'&&modal.querySelector('[data-act="apply-cloud-source-recovery"]')?.disabled===false;
    },'#modalRoot [data-act="choose-cloud-recovery-source"][data-value="device"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Selected device cloud source');

    const rootBeforeFailure=structuredClone(cloudOptions.remote.get(MANIFEST));
    cloudOptions.cloudWriteFail=true;
    await ui.act('apply-cloud-source-recovery',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      const modal=document.querySelector('#modalRoot');
      return modal?.querySelector('h2')?.textContent==='Review cloud recovery sources'&&
        /cloud confirmation is unavailable/i.test(modal.textContent)&&state.tasks.length===64&&
        state.futurePopulated?.opaque.length===1048576&&saved?.tasks.length===64&&saved.futurePopulated?.opaque.length===1048576;
    },'#modalRoot [data-act="apply-cloud-source-recovery"]');
    assert.deepEqual(cloudOptions.remote.get(MANIFEST),rootBeforeFailure,'A refused cloud write leaves the damaged root unchanged');
    await assertCurrentAndStoredFixtureBoard(ui,'Refused cloud source publication');

    cloudOptions.cloudWriteFail=false;
    await ui.act('review-cloud-source-recovery',()=>{
      const modal=document.querySelector('#modalRoot');
      return modal?.querySelector('h2')?.textContent==='Review cloud recovery sources'&&
        !cloudSourceRecoveryBusy&&!modal.querySelector('[data-cloud-source-progress]')&&
        !/cloud confirmation is unavailable/i.test(modal.textContent)&&
        !!modal.querySelector('[data-act="choose-cloud-recovery-source"][data-value="device"]');
    },'#modalRoot [data-act="review-cloud-source-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud source review after refused publication');
    await ui.act('choose-cloud-recovery-source',()=>{
      const modal=document.querySelector('#modalRoot'),choice=modal?.querySelector('[data-act="choose-cloud-recovery-source"][data-value="device"]');
      return choice?.getAttribute('aria-pressed')==='true'&&modal.querySelector('[data-act="apply-cloud-source-recovery"]')?.disabled===false;
    },'#modalRoot [data-act="choose-cloud-recovery-source"][data-value="device"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Selected device source for retry');
    await confirmedAction(ui,'apply-cloud-source-recovery',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return !document.querySelector('#modalRoot .modal')&&window.CloudSync?.status==='ok'&&state.syncDirty===false&&state.syncRev>4&&
        state.tasks.length===64&&state.futurePopulated?.opaque.length===1048576&&saved?.tasks.length===64&&
        saved.futurePopulated?.opaque.length===1048576&&saved.syncDirty===false;
    },'#modalRoot [data-act="apply-cloud-source-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Cloud source recovery');
    await assertPublished(cloudOptions.remote,'Cloud source recovery');
  });

  const decisionOptions={authMode:'reconcile-held',remote:sameBoardRemote()};
  await h.scenario('Settings decision review offers Light and saves it while protecting failures',decisionOptions,async ui=>{
    await ui.page.waitForFunction(()=>window.CloudSync?.ready===true&&window.CloudSync.user==='fixture@example.invalid'&&
      window.CloudSync.status==='ok'&&state.syncDirty===false&&!pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy,null,{timeout:10000});
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');
    await ui.fill('#stHorizon','61');
    await ui.act('save-settings',()=>!document.querySelector('#stHorizon')&&state.settings.horizonMin===61&&
      state.decisionBaseline?.account==='fixture@example.invalid'&&
      state.decisionEvents?.some(event=>event.kind==='current-choice'&&event.target?.type==='setting'&&
        event.target.property==='horizonMin'&&event.value===61),'#modalRoot [data-act="save-settings"]');
    await ui.waitFor(()=>window.CloudSync?.ready===true&&window.CloudSync.status==='ok'&&state.syncDirty===false&&
      !pulling&&!cloudPushInFlight&&!cloudSourceRecoveryBusy,12000,'publish the real saved-settings decision baseline');
    const savedDeviceDecision=await ui.page.evaluate(async()=>{
      const head=await window.ScannerDeviceStore.readHead(),stored=head?.payload?JSON.parse(head.payload):null;
      const hasDecision=board=>board?.decisionEvents?.some(event=>event.kind==='current-choice'&&event.target?.type==='setting'&&
        event.target.property==='horizonMin'&&event.value===61)===true;
      return {currentHorizon:state.settings.horizonMin,storedHorizon:stored?.settings?.horizonMin,
        currentDecision:hasDecision(state),storedDecision:hasDecision(stored)};
    });
    assert.deepEqual(savedDeviceDecision,{currentHorizon:61,storedHorizon:61,currentDecision:true,storedDecision:true},
      'The real Settings choice is durably saved on this device');
    const savedDecisionBoard=await readRemoteBoard(decisionOptions.remote,'The real Settings save');
    assertFixtureBoard(savedDecisionBoard,'The real Settings save');
    assert.equal(savedDecisionBoard.settings.horizonMin,61,'The actual saved setting reaches the cloud fixture');
    assert.equal(savedDecisionBoard.decisionBaseline?.account,'fixture@example.invalid','The cloud fixture contains an account-bound decision baseline');
    assert.ok(savedDecisionBoard.decisionEvents?.some(event=>event.kind==='current-choice'&&event.target?.type==='setting'&&
      event.target.property==='horizonMin'&&event.value===61),'The cloud fixture contains the observed Settings choice');
    await assertCurrentAndStoredFixtureBoard(ui,'Saved decision baseline setup');
    await ui.act('settings',()=>document.querySelector('#modalRoot h2')?.textContent==='Settings');

    decisionOptions.cloudReadFail=true;
    await ui.act('review-decision-recovery',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      const modal=document.querySelector('#modalRoot');
      return modal?.querySelector('h2')?.textContent==='Review saved decisions'&&
        /cloud could not be read/i.test(modal.textContent)&&
        !modal.querySelector('[data-act="choose-decision-recovery"]')&&
        modal.querySelector('[data-act="apply-decision-recovery"]')?.disabled===true&&
        state.settings.theme==='light'&&saved?.settings?.theme==='light'&&state.tasks.length===64;
    },'#modalRoot [data-act="review-decision-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Saved-decision review read failure');

    decisionOptions.cloudReadFail=false;
    await ui.act('review-decision-recovery',()=>{
      const modal=document.querySelector('#modalRoot'),light=modal?.querySelector('[data-act="choose-decision-recovery"][data-value="light"]');
      return modal?.querySelector('h2')?.textContent==='Review saved decisions'&&
        /Saved appearance:\s*light/i.test(modal.textContent)&&light&&!light.disabled&&
        light.getAttribute('aria-pressed')==='false'&&modal.querySelector('[data-act="apply-decision-recovery"]')?.disabled===true&&
        !/Reading this device and the current cloud source/i.test(modal.textContent);
    },'#modalRoot [data-act="review-decision-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Saved-decision review');
    await ui.act('choose-decision-recovery',()=>{
      const modal=document.querySelector('#modalRoot'),light=modal?.querySelector('[data-act="choose-decision-recovery"][data-value="light"]');
      return light?.getAttribute('aria-pressed')==='true'&&modal.querySelector('[data-act="apply-decision-recovery"]')?.disabled===false;
    },'#modalRoot [data-act="choose-decision-recovery"][data-value="light"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Selected saved appearance');

    const rootBeforeFailure=structuredClone(decisionOptions.remote.get(MANIFEST));
    decisionOptions.cloudWriteFail=true;
    await ui.act('apply-decision-recovery',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      const modal=document.querySelector('#modalRoot');
      return modal?.querySelector('h2')?.textContent==='Review saved decisions'&&
        /cloud sync is not confirmed/i.test(modal.textContent)&&
        state.settings.theme==='light'&&saved?.settings?.theme==='light'&&state.tasks.length===64&&
        modal.querySelector('[data-act="apply-decision-recovery"]')?.disabled===true;
    },'#modalRoot [data-act="apply-decision-recovery"]');
    assert.deepEqual(decisionOptions.remote.get(MANIFEST),rootBeforeFailure,'A refused decision write leaves its current cloud root unchanged');
    await assertCurrentAndStoredFixtureBoard(ui,'Refused saved-decision publication');

    decisionOptions.cloudWriteFail=false;
    await ui.act('review-decision-recovery',()=>{
      const modal=document.querySelector('#modalRoot'),light=modal?.querySelector('[data-act="choose-decision-recovery"][data-value="light"]');
      return modal?.querySelector('h2')?.textContent==='Review saved decisions'&&light&&!light.disabled&&
        modal.querySelector('[data-act="apply-decision-recovery"]')?.disabled===true&&
        !/Cloud sync is not confirmed/i.test(modal.textContent)&&
        !/Reading this device and the current cloud source/i.test(modal.textContent);
    },'#modalRoot [data-act="review-decision-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Saved-decision review after refused publication');
    await ui.act('choose-decision-recovery',()=>{
      const modal=document.querySelector('#modalRoot'),light=modal?.querySelector('[data-act="choose-decision-recovery"][data-value="light"]');
      return light?.getAttribute('aria-pressed')==='true'&&modal.querySelector('[data-act="apply-decision-recovery"]')?.disabled===false;
    },'#modalRoot [data-act="choose-decision-recovery"][data-value="light"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Selected saved appearance for retry');
    await confirmedAction(ui,'apply-decision-recovery',async()=>{
      const head=await window.ScannerDeviceStore.readHead(),saved=head?.payload?JSON.parse(head.payload):null;
      return !document.querySelector('#modalRoot .modal')&&window.CloudSync?.status==='ok'&&state.syncDirty===false&&state.syncRev>4&&
        state.settings.theme==='light'&&state.tasks.length===64&&saved?.settings?.theme==='light'&&
        saved.tasks.length===64&&saved.syncDirty===false;
    },'#modalRoot [data-act="apply-decision-recovery"]');
    await assertCurrentAndStoredFixtureBoard(ui,'Saved-decision recovery');
    await assertPublished(decisionOptions.remote,'Saved-decision recovery');
    const appliedDecisionBoard=await readRemoteBoard(decisionOptions.remote,'The saved appearance decision');
    assert.equal(appliedDecisionBoard.settings.theme,'light','The confirmed cloud board keeps the selected appearance');
    assert.ok(appliedDecisionBoard.decisionEvents?.some(event=>event.kind==='current-choice'&&event.target?.type==='setting'&&
      event.target.property==='theme'&&event.value==='light'),'The confirmed cloud board records the new appearance decision');
  });
}
