// Nonmergeable causal probe. Original scene bodies and state effects still run.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const RASTER_VARIANTS=['baseline','backdrop-raster-off','foreground-raster-off','both-raster-off'];
const canvasCommands=['fill','stroke','fillRect','strokeRect','clearRect','drawImage','fillText','strokeText','putImageData'];
const glCommands=['texImage2D','drawArrays'];
const hash=value=>createHash('sha256').update(value).digest('hex');

function installSceneRasterDiagnostic(variant){
 if(window.__sceneRasterDiagnostic)throw Error('Raster diagnostic installed twice');
 const canvasCommands=['fill','stroke','fillRect','strokeRect','clearRect','drawImage','fillText','strokeText','putImageData'],glCommands=['texImage2D','drawArrays'];
 const variants=['baseline','backdrop-raster-off','foreground-raster-off','both-raster-off'];if(!variants.includes(variant))throw Error('Unknown raster diagnostic variant');
 let phase=null;const contexts=new Set(),counts={backdrop:{},foreground:{}},scopes={backdrop:0,foreground:0};
 const selected=name=>variant==='both-raster-off'||variant===name+'-raster-off';
 const install=(prototype,command,api)=>{
  const original=prototype?.[command];if(typeof original!=='function')throw Error('Required raster command unavailable: '+api+':'+command);
  Object.defineProperty(prototype,command,{configurable:true,writable:true,value:function(...args){
   if(phase===null)return original.apply(this,args);
   const key=api+':'+command,row=counts[phase][key]||(counts[phase][key]={invoked:0,suppressed:0});row.invoked++;
   if(api==='webgl'){if(contexts.size>=4&&!contexts.has(this))throw Error('Unexpected raster context count');contexts.add(this);}
   if(selected(phase)){row.suppressed++;return;}
   return original.apply(this,args);
  }});
 };
 for(const command of canvasCommands)install(CanvasRenderingContext2D.prototype,command,'2d');
 const webglAvailable=typeof WebGLRenderingContext!=='undefined';if(webglAvailable)for(const command of glCommands)install(WebGLRenderingContext.prototype,command,'webgl');
 const data=window.__sceneRasterDiagnostic={
  scope(name,original){if(!Object.hasOwn(scopes,name)||typeof original!=='function')throw Error('Unknown scene scope');return function(...args){const prior=phase;phase=name;scopes[name]++;try{return original.apply(this,args);}finally{phase=prior;}};},
  // Called only after the original native attempt, never before trusted input.
  snapshot(){const glErrors=[];for(const context of contexts){const code=context.getError();if(code!==context.NO_ERROR)glErrors.push(code);}return{kind:'nonqualifying-scoped-raster-submissions',variant,installed:true,currentScope:phase,canvasCommands,glCommands,webglAvailable,checkedGlContexts:contexts.size,glErrors,scopes:{...scopes},counts:JSON.parse(JSON.stringify(counts)),retained:['original-bodies','geometry','model','timeline','copy','memoization','scheduling','dimensions','allocation','paths','transforms','clips','state','shader-initialization']};}
 };return data;
}

export function buildRasterOverlay(source,variant){
 assert.ok(RASTER_VARIANTS.includes(variant),'Explicit raster diagnostic variant required');
 const sourceSha256=hash(source);assert.equal(sourceSha256,'a19438f21edac2edca77fe873896d6edb5574152846a76eaaa9bca87c139ae98','Exact frozen b176 landscape bytes required');
 const anchor="  window.addEventListener('pageshow'";assert.equal(source.split(anchor).length,2,'One first-start installation boundary required');
 const overlay='/* chain-raster-diagnostic:start */\nconst rasterDiagnostic=('+installSceneRasterDiagnostic.toString()+')('+JSON.stringify(variant)+');\npaintBackground=rasterDiagnostic.scope(\'backdrop\',paintBackground);\npaintLife=rasterDiagnostic.scope(\'foreground\',paintLife);\n/* chain-raster-diagnostic:end */\n';
 const body=source.replace(anchor,overlay+anchor);
 return{body,receipt:{kind:'nonqualifying-served-raster-overlay',variant,frozenAppCommit:'b176026825e4f9539780f745fe60e09cf348d288',sourceSha256,overlaySha256:hash(overlay),servedSha256:hash(body),sourceBytes:Buffer.byteLength(source),overlayBytes:Buffer.byteLength(overlay),servedBytes:Buffer.byteLength(body)}};
}

export function verifyRasterObservation(data,{variant}={}){
 assert.ok(RASTER_VARIANTS.includes(variant));assert.ok(data,'Actual installed raster observation required');assert.equal(data.kind,'nonqualifying-scoped-raster-submissions');assert.equal(data.variant,variant);assert.equal(data.installed,true);assert.equal(data.currentScope,null);assert.deepEqual(data.canvasCommands,canvasCommands);assert.deepEqual(data.glCommands,glCommands);assert.deepEqual(data.glErrors,[],'Raster suppression cannot substitute a GL error');
 for(const phase of ['backdrop','foreground']){
  assert.ok(Number.isSafeInteger(data.scopes?.[phase])&&data.scopes[phase]>0,'Both original scene bodies must execute');let total=0;
  for(const [key,row]of Object.entries(data.counts?.[phase]||{})){
   assert.ok(canvasCommands.map(name=>'2d:'+name).concat(glCommands.map(name=>'webgl:'+name)).includes(key),'Unknown submission command');assert.ok(Number.isSafeInteger(row.invoked)&&row.invoked>=0);assert.ok(Number.isSafeInteger(row.suppressed)&&row.suppressed>=0);assert.equal(row.suppressed,variant==='both-raster-off'||variant===phase+'-raster-off'?row.invoked:0,'Exact selected phase suppression required');total+=row.invoked;
  }
  assert.ok(total>0,'An inactive phase cannot establish suppression');
 }
 return data;
}
