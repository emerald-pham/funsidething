import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const CANVAS_HIDDEN_RULE='\n/* Nonmergeable canvas-composition diagnostic only. */\n#landscape canvas{visibility:hidden!important}\n';
export function diagnosticCanvasVariant(originalCss,{variant,motion}){
 assert.ok(['baseline','canvas-hidden'].includes(variant),'Explicit diagnostic rendering variant required');
 assert.equal(motion,'reduced','Canvas causal comparison fixes Reduced motion');
 const injected=variant==='canvas-hidden'?CANVAS_HIDDEN_RULE:'',served=Buffer.concat([originalCss,Buffer.from(injected)]);
 return{served,receipt:{kind:'nonqualifying-canvas-composition-diagnostic',variant,motion,injectionBoundary:'HTTP stylesheet response before document scene startup',frozenCssSha256:sha(originalCss),servedCssSha256:sha(served),injectedCss:injected,injectedCssSha256:sha(injected),injectedBytes:Buffer.byteLength(injected),acceptanceEligible:false}};
}
// Bounded command counters only. No payloads, arguments, pixels or per-draw arrays.
export function installDiagnosticCanvasObserver(variant){
 if(window.top!==window||window.__mobileCanvasObservation)return;
 const data=window.__mobileCanvasObservation={variant,drawCommands:0,byOperation:{fillRect:0,drawImage:0,clearRect:0},firstSceneDrawAt:null};
 for(const name of Object.keys(data.byOperation)){
  const original=CanvasRenderingContext2D.prototype[name];
  CanvasRenderingContext2D.prototype[name]=function(...args){data.drawCommands++;data.byOperation[name]++;if(data.firstSceneDrawAt===null&&this.canvas.matches('#landscape canvas'))data.firstSceneDrawAt=performance.now();return original.apply(this,args);};
 }
 window.__readDiagnosticCanvas=()=>({...data,byOperation:{...data.byOperation},observedAt:performance.now(),appReady:document.documentElement.dataset.appReady==='true',canvases:[...document.querySelectorAll('#landscape canvas')].map(canvas=>({width:canvas.width,height:canvas.height,visibility:getComputedStyle(canvas).visibility}))});
}
