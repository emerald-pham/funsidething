import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {TIMELINE_PROVENANCE,createNativeTimelineProvider} from './button-safety-timeline-core.mjs';
export {TIMELINE_PROVENANCE,TIMELINE_BOUNDS,verifyNativeTimelineCapture,deriveNativeTimelineEvidence,createNativeTimelineProvider} from './button-safety-timeline-core.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const check=(ok,message)=>assert.ok(ok,'Native Timeline '+message);

export function verifyNativeTimelineRuntime(){
 check(process.version===TIMELINE_PROVENANCE.node&&process.platform==='darwin'&&process.arch==='arm64','pinned Node24.19/macOS arm64 required');
 check(!process.env.PLAYWRIGHT_BROWSERS_PATH&&!process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH,'browser path override is outside pinned native provenance');
 const require=createRequire(import.meta.url),root=path.dirname(require.resolve('playwright-core/package.json'));
 check(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version==='1.62.1','Playwright version mismatch');
 const registry=JSON.parse(fs.readFileSync(path.join(root,'browsers.json'))),wk=registry.browsers.find(x=>x.name==='webkit');check(wk?.revision==='2336'&&wk.browserVersion==='26.5','native revision mismatch');
 const native=path.join(process.env.HOME,'Library/Caches/ms-playwright/webkit-2336');
 const files={coreBundle:path.join(root,'lib/coreBundle.js'),protocol:path.join(native,'protocol.json'),wrapper:path.join(native,'pw_run.sh'),webkit:path.join(native,'WebKit.framework/Versions/A/WebKit'),webcore:path.join(native,'WebCore.framework/Versions/A/WebCore'),jsc:path.join(native,'JavaScriptCore.framework/Versions/A/JavaScriptCore'),executable:path.join(native,'Playwright.app/Contents/MacOS/Playwright')};
 for(const [key,file]of Object.entries(files))check(hash(fs.readFileSync(file))===TIMELINE_PROVENANCE[key],'runtime hash mismatch: '+key);
 for(const [file,expected]of Object.entries({'index.js':'a58fb2cec4293e7dcf73c58a179898a4f3986666451a19da4e731fa3af63265b','index.mjs':'3d36e2132d3c8b62397d23f0bb4177336aaee503203ae2a2c90fbeb5bf3317dd','../playwright/index.js':'4e98f65f0a9d9bcab8cffc0c5cfdd87fd3f5b0be74fc494ff166a466b204cd44','package.json':'07c47543631fef9508760365dee9fbe958c562093ec8d122543949ed231f233f'}))check(hash(fs.readFileSync(path.join(root,file)))===expected,'module entry hash mismatch: '+file);
 check(hash(fs.readFileSync(path.join(root,'browsers.json')))==='f306eed529599b1eaf2f8a85db9de2b23e1a3fe36c2b66434b7c9434fb627a99','registry hash mismatch');
 return{...TIMELINE_PROVENANCE};
}

// No caller option can replace the real guard; activation happens only on start.
export const startNativeTimelineCapture=createNativeTimelineProvider({verifyRuntime:verifyNativeTimelineRuntime});
