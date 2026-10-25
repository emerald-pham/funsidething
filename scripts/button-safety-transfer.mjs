import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buttonFixture as fixture} from './button-safety-fixture.mjs';

function decode(value){
 switch(value?.type){
  case 'null':return null;case 'undefined':return undefined;case 'string':case 'number':case 'boolean':return value.value;
  case 'special-number':return value.value==='-0'?-0:Number(value.value);
  case 'object':return Object.fromEntries(value.entries.map(([key,item])=>[key,decode(item)]));
  case 'array':{const out=value.items.map(decode);for(const [key,item]of value.properties||[])out[key]=decode(item);return out;}
  case 'array-buffer':{const bytes=Buffer.from(value.base64,'base64');return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
  case 'typed-array':return new globalThis[value.constructor](decode(value.buffer),value.byteOffset,value.length);
  default:assert.fail('Unknown synthetic archive value type: '+value?.type);
 }
}
async function rawIdentity(ui){
 return ui.page.evaluate(async()=>{
  const snapshot=await ScannerDeviceStore.readRawExportSnapshot();
  const raw=JSON.stringify(snapshot,(_,value)=>typeof value==='number'&&Object.is(value,-0)?{gateSpecialNumber:'-0'}:ArrayBuffer.isView(value)?{gateTyped:value.constructor.name,values:Array.from(value)}:value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),n=>n.toString(16).padStart(2,'0')).join('');
 });
}
function assertArchive(raw,{copies=0,partial=false,unsaved=false}={}){
 const archive=JSON.parse(raw);assert.equal(archive.format,'chain-scanner.recovery-archive');assert.equal(archive.formatVersion,1);
 assert.equal(archive.manifest.status,partial?'partial':'complete','complete versus partial is explicit');
 assert.deepEqual(archive.currentBoard.futureBoard,{opaque:['retain',11]},'unknown board field retained');
 assert.deepEqual(archive.currentBoard.tasks.find(task=>task.id==='synthetic-kept').futureTask,{opaque:['retain',7]},'unknown task field retained');
 if(unsaved)assert.ok(archive.currentBoard.tasks.some(task=>task.title==='Gate accepted unsaved work'),'accepted unsaved task belongs to the exported current board');
 if(copies){
  const stores=archive.appSources.indexedDB.stores;
  const backups=stores.backups.map(row=>decode(row.value));for(let i=0;i<copies;i++)assert.ok(backups.some(row=>row.id==='gate-retained-'+i),'retained backup '+i+' included');
  const snapshots=stores.snapshots.map(row=>decode(row.value));
  for(let i=0;i<copies;i++)assert.ok(snapshots.some(row=>typeof row.payload==='string'&&JSON.parse(row.payload).futureSourceRole===i),'exact distinct retained payload '+i+' included');
  const opaque=stores.opaque.map(row=>decode(row.value)).find(row=>row.key==='gate-opaque-exact');
  assert.equal(opaque.raw,'opaque exact bytes\u0000retain');assert.deepEqual(Array.from(opaque.futureBytes),[0,17,255]);assert.ok(Object.is(opaque.futureMinusZero,-0),'typed raw negative zero preserved');
  assert.ok(stores.meta.some(row=>decode(row.key)==='pending:gate-owner'),'pending source retained as evidence');
 }
 return archive;
}
function transferFixture(board){board.passStartedAt=Date.now();board.tasks=board.tasks.slice(0,64);}
const ready=()=>!!document.getElementById('exportTransferDialog')&&!document.querySelector('[data-act="copy-export"]').disabled&&!document.querySelector('[data-act="download-export"]').disabled&&!document.querySelector('#exportTransferDialog textarea');
const copied=()=>window.__buttonClipboard.length>0&&/copied/i.test(document.getElementById('exportTransferStatus')?.textContent||'')&&!document.querySelector('#exportTransferDialog textarea');

export async function runTransferScenarios(h){
 for(const [name,options,expected]of [
  ['populated comprehensive export',{decorate:transferFixture,retainedCopies:3},{copies:3}],
  ['oversized retained-source export',{viewport:{width:390,height:844},decorate:board=>{transferFixture(board);board.futurePopulated.opaque='p'.repeat(2*1024*1024);},retainedCopies:16},{copies:16}],
  ['accepted unsaved current board export',{decorate:transferFixture,writeFailAfterReady:true},{unsaved:true}],
 ])await h.scenario(name,options,async ui=>{
  if(expected.unsaved){await ui.fill('#addInput','Gate accepted unsaved work');await ui.act('add',()=>state.tasks.some(task=>task.title==='Gate accepted unsaved work'));}
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));
  const before=await rawIdentity(ui);await ui.act('export-backup',ready,'#modalRoot [data-act="export-backup"]');
  await ui.act('copy-export',copied);const copiedRaw=await ui.page.evaluate(()=>window.__buttonClipboard.at(-1));assertArchive(copiedRaw,expected);
  const downloading=ui.page.waitForEvent('download',{timeout:12000});await ui.act('download-export',()=>/download.*started/i.test(document.getElementById('exportTransferStatus')?.textContent||'')&&!document.querySelector('[data-act="download-export"]').disabled);
  const download=await downloading;assert.equal(await download.failure(),null,'native download succeeds');const downloaded=fs.readFileSync(await download.path(),'utf8');assert.equal(downloaded,copiedRaw,'Download and Copy use identical prepared payload bytes');
  for(let i=0;i<3;i++){const count=await ui.page.evaluate(()=>window.__buttonClipboard.length);await ui.act('copy-export',new Function('return window.__buttonClipboard.length==='+String(count+1)+'&&/copied/i.test(document.getElementById("exportTransferStatus")?.textContent||"")'));}
  assert.equal(await rawIdentity(ui),before,'export never changes any retained native device source');
  await ui.act('close-modal',()=>!document.getElementById('exportTransferDialog'));
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.act('view-support-diagnostics',()=>document.querySelector('#modalRoot h2')?.textContent==='Debug log');
  await ui.act('export-backup',ready,'[data-act="export-backup"][data-export-scope="repair"]');
  await ui.act('copy-export',copied);assertArchive(await ui.page.evaluate(()=>window.__buttonClipboard.at(-1)),expected);
  if(expected.copies===16){
   await ui.act('close-modal',()=>!document.getElementById('exportTransferDialog')&&!!document.getElementById('stHorizon'));
   const headBefore=await ui.page.evaluate(async()=>{const head=await ScannerDeviceStore.readHead();return{hash:head.hash,payload:head.payload};});
   await ui.select('#backupRestoreSource','paste');await ui.act('import-backup',()=>!!document.getElementById('jsonBox'));
   await ui.fill('#jsonBox',copiedRaw);await ui.act('preview-pasted-recovery',()=>!!document.querySelector('[data-act="confirm-file-restore"]'));
   await ui.act('cancel-file-restore',()=>!!document.getElementById('jsonBox'));
   assert.equal(await ui.page.locator('#jsonBox').inputValue(),copiedRaw,'oversized exported archive returns as the exact retained paste draft');
   const headAfter=await ui.page.evaluate(async()=>{const head=await ScannerDeviceStore.readHead();return{hash:head.hash,payload:head.payload};});assert.deepEqual(headAfter,headBefore,'oversized preview and Cancel preserve the exact durable current board');
   const ids=await ui.page.evaluate(async()=>{const rows=await ScannerDeviceStore.listBackups();return rows.filter(row=>row.id.startsWith('gate-retained-')).map(row=>({id:row.id,role:JSON.parse(row.payload).futureSourceRole}));});
   assert.equal(ids.length,16);for(let i=0;i<16;i++)assert.ok(ids.some(row=>row.id==='gate-retained-'+i&&row.role===i),'oversized import preview keeps retained original '+i);
   await ui.act('close-paste-recovery',()=>!!document.getElementById('stHorizon'));
  }
 });
 await h.scenario('clipboard refusal never renders payload or downloads',{decorate:transferFixture,clipboardFail:true},async ui=>{
  let downloads=0;ui.page.on('download',()=>downloads++);await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.act('export-backup',ready);
  await ui.act('copy-export',()=>window.__buttonClipboard.length===0&&/clipboard|could not copy|copy failed/i.test(document.getElementById('exportTransferStatus')?.textContent||'')&&!document.querySelector('#exportTransferDialog textarea'));
  assert.equal(downloads,0,'Copy refusal must never initiate a download');
 });
 await h.scenario('download refusal keeps the prepared export usable',{decorate:transferFixture,downloadFail:true},async ui=>{
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.act('export-backup',ready);
  await ui.act('download-export',()=>/download|unavailable|could not|failed/i.test(document.getElementById('exportTransferStatus')?.textContent||'')&&!document.querySelector('[data-act="copy-export"]').disabled);
  await ui.act('copy-export',copied);assertArchive(await ui.page.evaluate(()=>window.__buttonClipboard.at(-1)));
 });
 await h.scenario('unavailable saved-source export is visibly partial',{decorate:transferFixture,readFailAfterReady:true},async ui=>{
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.act('export-backup',ready);
  await ui.act('copy-export',copied);assertArchive(await ui.page.evaluate(()=>window.__buttonClipboard.at(-1)),{partial:true});
 });
 const imported=fixture('signed-out');imported.tasks=imported.tasks.slice(0,3);imported.tasks[0].title='Gate imported supported task';const importedRaw=JSON.stringify(imported);
 await h.scenario('guarded file import preview cancel and confirm',{decorate:transferFixture,importRaw:importedRaw},async ui=>{
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.select('#backupRestoreSource','file');
  await ui.act('import-backup',()=>!!document.querySelector('[data-act="confirm-file-restore"]'));
  await ui.act('cancel-file-restore',()=>!!document.getElementById('stHorizon')&&!state.tasks.some(task=>task.title==='Gate imported supported task'));
  await ui.act('import-backup',()=>!!document.querySelector('[data-act="confirm-file-restore"]'));
  await ui.act('confirm-file-restore',()=>state.tasks.some(task=>task.title==='Gate imported supported task')&&!document.querySelector('[data-act="confirm-file-restore"]'));
 });
 await h.scenario('guarded paste import rejects malformed data and retains cancelled draft',{decorate:transferFixture},async ui=>{
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.select('#backupRestoreSource','paste');await ui.act('import-backup',()=>!!document.getElementById('jsonBox'));
  await ui.fill('#jsonBox','{broken synthetic JSON');await ui.act('preview-pasted-recovery',()=>!!document.getElementById('jsonBox')&&!document.querySelector('[data-act="confirm-file-restore"]')&&state.tasks.length===400);
  await ui.fill('#jsonBox',importedRaw);await ui.act('preview-pasted-recovery',()=>!!document.querySelector('[data-act="confirm-file-restore"]'));
  await ui.act('cancel-file-restore',()=>!!document.getElementById('jsonBox')&&document.getElementById('jsonBox').value.includes('Gate imported supported task'));
  await ui.act('preview-pasted-recovery',()=>!!document.querySelector('[data-act="confirm-file-restore"]'));
  await ui.act('confirm-file-restore',()=>state.tasks.some(task=>task.title==='Gate imported supported task')&&!document.querySelector('[data-act="confirm-file-restore"]'));
  await ui.select('#backupRestoreSource','paste');await ui.act('import-backup',()=>!!document.getElementById('jsonBox'));
  await ui.act('close-paste-recovery',()=>!!document.getElementById('stHorizon')&&!document.getElementById('jsonBox'));
 });
}

export {rawIdentity,assertArchive};
