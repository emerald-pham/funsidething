import assert from 'node:assert/strict';
import {runSceneScenarios} from './button-safety-scenes.mjs';
import {runCloudScenarios} from './button-safety-cloud.mjs';
import {runTransferScenarios,rawIdentity,assertArchive} from './button-safety-transfer.mjs';
import fs from 'node:fs';
const ready=()=>!!document.getElementById('exportTransferDialog')&&!document.querySelector('[data-act="copy-export"]').disabled&&!document.querySelector('[data-act="download-export"]').disabled;
export async function runRapidScenarios(h){
 await runSceneScenarios({scenario:async(name,options,execute)=>{
  if(name==='Help FAQ and changelog disclosures toggle and close')return;
  await h.scenario('rapid '+name,options,async ui=>{
   const act=async(action,expect,selector)=>ui.burst(action,expect,{selector,semantics:action==='cycle-theme'?'Ten choices traverse the three appearance values and retain the tenth saved choice':'The first press opens or closes its UI; obscured or absent controls cannot act again',expectedAccepted:action==='cycle-theme'?10:1});
   const click=async(selector,expect,description)=>{
    const action=await ui.page.locator(selector).first().evaluate(el=>el.dataset.act||(['landscapeMotion','scenePreset','sceneTime','locationAction'].map((key,i)=>el.dataset[key]===undefined?null:['motion:','scene-preset:','scene-time:','location:'][i]+el.dataset[key]).find(Boolean))||(el.hasAttribute('data-scene-view')?'scene-view':null));
    assert.ok(action,'Reviewed rapid scene control');
    const one=action.startsWith('motion:')||action.endsWith(':close')||action==='scene-view';
    return ui.burst(action,expect,{selector,semantics:description+'; '+(one?'first press closes or replaces this control; later attempts cannot activate it':'all available repeated choices retain the same explicit saved value'),expectedAccepted:one?1:action==='location:request'?{min:1,max:10}:10});
   };
   await execute({...ui,act,click});
  });
 }});
 await h.scenario('rapid all Help and changelog disclosures',{},async ui=>{
  await ui.burst('help',()=>!!document.querySelector('#modalRoot .help'),{semantics:'The first press opens Help and the resulting modal obscures later Help presses',expectedAccepted:1});
  const count=await ui.page.locator('#modalRoot .help summary').count();assert.ok(count>=3,'Actual mounted Help disclosures');
  for(let i=0;i<count;i++){
   const selector=await ui.page.locator('#modalRoot .help summary').nth(i).evaluate(summary=>{const parts=[];for(let el=summary;el&&el.parentElement;el=el.parentElement){if(el.id){parts.unshift('#'+CSS.escape(el.id));break;}const peers=[...el.parentElement.children].filter(peer=>peer.tagName===el.tagName);parts.unshift(el.tagName.toLowerCase()+':nth-of-type('+(peers.indexOf(el)+1)+')');}return parts.join(' > ');});
   await ui.expose(selector);const before=await ui.page.locator(selector).evaluate(el=>el.parentElement.open);
   await ui.burst('disclosure',new Function('return document.querySelectorAll("#modalRoot .help summary")['+i+']?.parentElement.open==='+String(before)),{selector,semantics:'Ten trusted summary presses toggle the same disclosure an even number of times',expectedAccepted:10});
  }
  await ui.burst('close-modal',()=>!document.querySelector('#modalRoot .modal'),{selector:'#modalRoot [data-act="close-modal"]',semantics:'The first Close removes its dialog; later attempts cannot close another control',expectedAccepted:1});
 });
 await runCloudScenarios({scenario:async(name,options,execute)=>{
  if(name==='cloud sync signs out and rejects signed-out authentication safely')return;
  await h.scenario('rapid '+name,options,async ui=>{
   const act=(action,expect,selector)=>ui.burst(action,expect,{selector,semantics:'Repeated '+action+' preserves the reviewed source, choice, and protected failure outcome',expectedAccepted:{min:1,max:10}});
   const expectReload=action=>ui.burst(action,()=>document.documentElement.dataset.appReady==='true',{selector:'#modalRoot [data-act="'+action+'"]',semantics:'The first Reload opens one new usable document; its old dialog cannot reload again',expectedAccepted:1,reload:true});
   await execute({...ui,act,expectReload});
  });
 }});

 await h.scenario('rapid prepared Export Copy and Download retain exact sources',{retainedCopies:3},async ui=>{
  const original=await rawIdentity(ui);
  await ui.burst('settings',()=>!!document.getElementById('stHorizon'),{semantics:'The first Settings press opens its dialog and obscures further presses',expectedAccepted:1});
  await ui.burst('export-backup',ready,{semantics:'The first export prepares one protected snapshot; busy or obscured presses cannot start another',expectedAccepted:1});
  await ui.burst('copy-export',()=>window.__buttonClipboard.length===10&&/copied/i.test(document.getElementById('exportTransferStatus').textContent),{semantics:'Ten available Copy presses write the same immutable prepared archive exactly ten times',expectedAccepted:10});
  const copies=await ui.page.evaluate(()=>window.__buttonClipboard);assert.equal(copies.length,10);assert.ok(copies.every(raw=>raw===copies[0]));assertArchive(copies[0],{copies:3});
  const downloads=[];ui.page.on('download',download=>downloads.push(download));
  await ui.burst('download-export',()=>/download.*started/i.test(document.getElementById('exportTransferStatus').textContent),{semantics:'Ten available Download presses each start a native download of the same prepared archive',expectedAccepted:10});
  for(let n=0;n<100&&downloads.length<10;n++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(downloads.length,10,'Ten real browser download events');
  for(const download of downloads){assert.equal(await download.failure(),null);assert.equal(fs.readFileSync(await download.path(),'utf8'),copies[0]);}
  assert.equal(await rawIdentity(ui),original,'Ten transfer presses preserve every exact original source');
 });
 await h.scenario('rapid pending Copy disables reentry without losing the archive',{clipboardDeferred:true},async ui=>{
  const original=await rawIdentity(ui);await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.act('export-backup',ready);
  await ui.burst('copy-export',()=>window.__buttonClipboardPending.length===1&&document.querySelector('[data-act="copy-export"]').disabled&&document.querySelector('[data-act="download-export"]').disabled,{semantics:'The first Copy starts its clipboard promise; the disabled control refuses nine later presses',expectedAccepted:1});
  assert.equal(await ui.page.evaluate(()=>window.__buttonClipboard.length),1,'Only one clipboard operation starts');
  await ui.page.evaluate(()=>window.__buttonClipboardPending[0].resolve());
  await ui.waitFor(()=>!document.querySelector('[data-act="copy-export"]').disabled&&/copied/i.test(document.getElementById('exportTransferStatus').textContent));
  assert.equal(await rawIdentity(ui),original,'Busy Copy reentry retains exact original sources');
 });
 await runTransferScenarios({scenario:async(name,options,execute)=>{
  if(!name.startsWith('guarded '))return;
  await h.scenario('rapid '+name,options,async ui=>{
   const act=(action,expect,selector)=>ui.burst(action,expect,{selector,semantics:'Repeated '+action+' retains guarded file/paste preview, exact drafts and one confirmed replacement',expectedAccepted:{min:1,max:10}});
   await execute({...ui,act});
  });
 }});
 await h.scenario('rapid clipboard completion belongs to its prepared transfer',{clipboardDeferred:true},async ui=>{
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.act('export-backup',ready);
  await ui.act('copy-export',()=>window.__buttonClipboardPending.length===1&&document.querySelector('[data-act="copy-export"]').disabled);
  await ui.act('close-modal',()=>!document.getElementById('exportTransferDialog'));
  await ui.act('settings',()=>!!document.getElementById('stHorizon'));await ui.act('export-backup',ready);
  await ui.act('copy-export',()=>window.__buttonClipboardPending.length===2&&document.querySelector('[data-act="copy-export"]').disabled);
  const before=await ui.page.locator('#exportTransferStatus').textContent();
  await ui.page.evaluate(()=>window.__buttonClipboardPending[0].resolve());
  await ui.page.waitForTimeout(30);
  assert.equal(await ui.page.locator('[data-act="copy-export"]').isDisabled(),true,'obsolete clipboard completion must keep the new transfer busy');
  assert.equal(await ui.page.locator('[data-act="download-export"]').isDisabled(),true,'obsolete clipboard completion cannot unlock the new Download');
  assert.equal(await ui.page.locator('#exportTransferStatus').textContent(),before,'obsolete clipboard completion cannot replace the new status');
  await ui.page.evaluate(()=>window.__buttonClipboardPending[1].resolve());
  await ui.waitFor(()=>!document.querySelector('[data-act="copy-export"]').disabled&&/copied/i.test(document.getElementById('exportTransferStatus').textContent));
 });
}
