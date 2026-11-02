import assert from 'node:assert/strict';
import {MOBILE_PROFILE} from './button-safety-mobile-contract.mjs';
async function sources(page){return page.evaluate(async()=>{
 const store=window.ScannerDeviceStore,head=await store.readHead(),board=JSON.parse(head.payload),backups=(await store.listBackups()).filter(row=>row.id.startsWith('gate-retained-')).map(row=>({id:row.id,payload:row.payload})).sort((a,b)=>a.id.localeCompare(b.id));
 const normalize=(_,value)=>typeof value==='number'&&Object.is(value,-0)?{minusZero:true}:ArrayBuffer.isView(value)?{type:value.constructor.name,values:Array.from(value)}:value;
 const hash=value=>ChainStorageV2.hashPayload(JSON.stringify(value,normalize));
 return {chain:[...state.chain],durableChain:[...board.chain],taskCount:state.tasks.length,durableTaskCount:board.tasks.length,durableHash:head.hash,retainedSourceCount:backups.length,
  taskIdentityHash:await hash(state.tasks.map(row=>({id:row.id,title:row.title,createdAt:row.createdAt}))),
  durableTaskIdentityHash:await hash(board.tasks.map(row=>({id:row.id,title:row.title,createdAt:row.createdAt}))),
  unknownSourceHash:await hash({board:state.futureBoard,populated:state.futurePopulated,tasks:state.tasks.map(row=>({id:row.id,future:row.futureTask}))}),
  durableUnknownSourceHash:await hash({board:board.futureBoard,populated:board.futurePopulated,tasks:board.tasks.map(row=>({id:row.id,future:row.futureTask}))}),
  protectedSourcesHash:await hash({backups,opaque:await store.listOpaqueArchives(),pending:await store.getPendingUpload('gate-owner')})};
 });}
export async function beginMobileYes(ui){
 const before=await sources(ui.page);assert.equal(before.chain.length,1);assert.equal(before.retainedSourceCount,2);
 const observed=await ui.page.evaluate(()=>({width:innerWidth,height:innerHeight,screenWidth:screen.width,screenHeight:screen.height,deviceScaleFactor:devicePixelRatio,maxTouchPoints:navigator.maxTouchPoints,coarsePointer:matchMedia('(pointer:coarse)').matches,userAgent:navigator.userAgent,reducedMedia:matchMedia('(prefers-reduced-motion:reduce)').matches,appMotion:JSON.parse(localStorage.getItem('fvp:chain-scanner:landscape-motion')).choice,appliedMotion:document.documentElement.dataset.landscapeMotion,canvasSizes:[...document.querySelectorAll('#landscape canvas')].map(el=>({width:el.width,height:el.height}))}));
 assert.equal(observed.appliedMotion,ui.mobileYesMotion);assert.ok(observed.canvasSizes.length===2&&observed.canvasSizes.every(row=>row.width>0&&row.height>0),'Actual scene must be mounted with the requested motion');
 return{before,observed};
}
export async function finishMobileYes(ui,{before,observed}){
 const receipts=await ui.page.evaluate(()=>({presses:window.__buttonNativePresses.filter(row=>row.action==='act:yes'),clicks:window.__buttonNativeClicks.filter(row=>row.action==='act:yes')}));
 const ids=receipts.presses.map(row=>row.offeredTaskId);assert.equal(ids.length,10);assert.equal(new Set(ids).size,10,'Ten different actually offered candidates');assert.deepEqual(receipts.clicks.map(row=>row.offeredTaskId),ids,'Accepted Yes must apply to the delivered offered task');
 const expected=[...before.chain,...ids];
 await ui.waitFor(new Function('return async()=>{const head=await ScannerDeviceStore.readHead();const saved=JSON.parse(head.payload);return JSON.stringify(state.chain)==='+JSON.stringify(JSON.stringify(expected))+'&&JSON.stringify(saved.chain)==='+JSON.stringify(JSON.stringify(expected))+'&&saved.tasks.length===400}')(),12000,'All ten distinct Yes choices are durably saved');
 const after=await sources(ui.page);assert.deepEqual(after.chain,expected);assert.deepEqual(after.durableChain,expected);assert.equal(after.taskCount,400);assert.equal(after.durableTaskCount,400);
 for(const key of ['taskIdentityHash','unknownSourceHash','protectedSourcesHash'])assert.equal(after[key],before[key],'Mobile Yes preserves original sources: '+key);assert.equal(after.durableTaskIdentityHash,after.taskIdentityHash);assert.equal(after.durableUnknownSourceHash,after.unknownSourceHash);
 ui.recordMobileStory({profile:MOBILE_PROFILE,motion:ui.mobileYesMotion,observed,initialChain:before.chain,acceptedTaskIds:ids,finalChain:after.chain,durableChain:after.durableChain,taskCount:after.taskCount,durableTaskCount:after.durableTaskCount,retainedSourceCount:after.retainedSourceCount,durableHash:after.durableHash,before,after});
}
