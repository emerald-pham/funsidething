/* Isolated motion evidence: freeze repository sources and execute their actual
   actor painters, without booting the app or touching a saved board. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const files=['landscape-config.js','vendor/astronomy.min.js','stars.js','landscape-core.js','landscape-appearance.js','landscape-geometry.js','landscape-winter.js','landscape.js'];
export function readMotionBuild(repository,ref){
 const resolved=ref==='WORKTREE'?ref:execFileSync('git',['rev-parse',`${ref}^{commit}`],{cwd:repository,encoding:'utf8'}).trim();
 const sources=Object.fromEntries(files.map(file=>[file,resolved==='WORKTREE'?fs.readFileSync(path.join(repository,file),'utf8'):execFileSync('git',['show',`${resolved}:${file}`],{cwd:repository,encoding:'utf8',maxBuffer:4*1024*1024})]));
 const hash=createHash('sha256');for(const file of files)hash.update(file+'\0'+sources[file]+'\0');
 return {ref:resolved,sourcesHash:hash.digest('hex'),sources};
}
function painterProgram(build){
 const source=build.sources['landscape.js'];
 const between=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<0)throw new Error(`Missing painter boundary ${start}`);return source.slice(a,b);};
 const snippets=[between('  const colors=','  function layer(')];
 // The primitives are single-line declarations in both frozen revisions.
 snippets[1]=source.match(/^  function ellipse[^\n]+/m)[0]+'\n'+source.match(/^  function line[^\n]+/m)[0];
 snippets.push(between('  function person(','  function airplane('),between('  function paintWoodland(','  function reflectWaterObject('),between('  function paintGuest(','  const themeQuery='));
 return `(function(W,H){
 const S=globalThis.LivingSky,LandscapeAppearance=globalThis.LandscapeAppearance,LandscapeWinter=globalThis.LandscapeWinter;
 const geometry=globalThis.LandscapeGeometry.create(W,H),p=S.palette(25),TAU=Math.PI*2;
 const trail=x=>geometry.trail(x),middle=x=>geometry.middle(x),near=x=>geometry.near(x);
 let g;
 const paintGroundShadow=(ctx,x,y,height,width,fill)=>{ctx.save();ctx.globalAlpha*=.14;ellipse(ctx,x,y,width/2,1,fill);ctx.restore();};
 ${snippets.join('\n')}
 return {draw(ctx,options){
  g=ctx;const woodland=options.actor.startsWith('woodland:'),type=options.actor.replace('woodland:','');
  const duration=options.duration||S.eventDurations[type]||180;
  const e={type,duration,age:(options.reduced?.5:options.progress)*duration,seed:options.seed??.4,lane:options.lane??.5,reverse:!!options.reverse};
  let pose,ground;
  if(woodland){pose=geometry.woodlandPose(e);ground=x=>Math.max(near(x)+18,H-28-e.seed*25);}
  else if(LandscapeWinter.types.includes(type)){pose=LandscapeWinter.pose(type,e,geometry,W,H);ground=x=>geometry[type==='snowangel'?'near':'middle'](x)+pose.snowOffset;if(type==='snowman')pose={...pose,x:pose.builderX,y:pose.builderGroundY,scale:pose.builderScale};}
  else if(['walker','dogwalker','deer','rabbit'].includes(type)){const kind=type==='dogwalker'?'walker':type;pose=geometry.groundPose(kind,e);ground=x=>geometry.groundAnchor(kind,x);}
  else{pose=geometry.visitPose(e,geometry.motionProgress(e,'x'));ground=x=>trail(x)+20;}
  const zoom=options.zoom||6;g.save();g.translate(180,160);g.scale(zoom,zoom);g.translate(-pose.x,-pose.y);
  // World-fixed ground marks reveal contact sliding even with a tracking camera.
  g.beginPath();for(let dx=-180/zoom;dx<=180/zoom;dx+=1){const x=pose.x+dx;if(dx===-180/zoom)g.moveTo(x,ground(x));else g.lineTo(x,ground(x));}g.strokeStyle='#819b8d';g.lineWidth=.35;g.stroke();
  for(let x=Math.floor((pose.x-180/zoom)/5)*5;x<pose.x+180/zoom;x+=5)ellipse(g,x,ground(x),.35,.35,'#819b8d');
  g.lineCap='round';g.lineJoin='round';
  if(woodland)paintWoodland(e);
  else if(LandscapeWinter.types.includes(type))LandscapeWinter.paint(g,geometry,W,H,e,geometry.motionAge(e,'x'),p,{ellipse,line,color,skinColor,personHead,S,groundShadow:paintGroundShadow});
  else paintGuest(e,0,geometry.motionProgress(e,'x'),geometry.motionAge(e,'x'));
  g.restore();
  return {type,woodland,direction:e.reverse?-1:1,age:e.age,duration,scale:pose.scale||1,x:pose.x,y:pose.y,slope:(ground(pose.x+.1)-ground(pose.x-.1))/.2};
 }};
})`;
}
function loadProbe(build,width,height){
 const context=vm.createContext({Math,Date,Intl,JSON,console});
 for(const file of files.filter(f=>f!=='landscape.js'))vm.runInContext(build.sources[file],context,{filename:file});
 return vm.runInContext(painterProgram(build),context)(width,height);
}
export function createMotionProbe(build,{width=820,height=1180}={}){
 const renderer=loadProbe(build,width,height);
 return {sample(options){const commands=[],state={globalAlpha:1},g=new Proxy(state,{get(target,key){if(key in target)return target[key];return (...args)=>commands.push([key,...args]);},set(target,key,value){target[key]=value;commands.push(['set',key,value]);return true;}});const metadata=renderer.draw(g,options);if(commands.some(command=>command.some(value=>typeof value==='number'&&!Number.isFinite(value))))throw new Error('Nonfinite canvas command');return JSON.parse(JSON.stringify({metadata,commands}));}};
}
const safeJson=value=>JSON.stringify(value).replace(/</g,'\\u003c');
function framePage(build){
 const modules=files.filter(f=>f!=='landscape.js').map(file=>build.sources[file]);
 return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#eef4ef}canvas{display:block;width:360px;height:220px}</style><canvas width="360" height="220"></canvas><script>
 for(const source of ${safeJson(modules)}) (0,eval)(source);
 const factory=(0,eval)(${safeJson(painterProgram(build))});let renderer,lastViewport;
 window.paintMotion=options=>{const key=options.width+'x'+options.height;if(key!==lastViewport){renderer=factory(options.width,options.height);lastViewport=key;}const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.clearRect(0,0,360,220);ctx.fillStyle='#eef4ef';ctx.fillRect(0,0,360,220);return renderer.draw(ctx,options);};
 <\/script>`;
}
export function writeMotionReview({repository,beforeRef,afterRef,outputDir}){
 const builds=[readMotionBuild(repository,beforeRef),readMotionBuild(repository,afterRef)];fs.mkdirSync(outputDir,{recursive:true});
 const manifest={before:{ref:builds[0].ref,sourcesHash:builds[0].sourcesHash},after:{ref:builds[1].ref,sourcesHash:builds[1].sourcesHash},scope:'Actual isolated actor painters and real terrain; tracking crop/ground marks are diagnostic. Full scenery composition, task UI, typography and performance require separate runtime review.',viewports:[[390,844],[844,390],[820,1180],[1440,900]],actors:['walker','dogwalker','deer','rabbit','reader','couple','picnic','kite','snowman','snowangel','woodland:deer','woodland:fox','woodland:rabbit','woodland:raccoon']};
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Chain Scanner motion review</title><style>body{font:16px/1.45 system-ui;background:#f5f7f3;color:#294536;margin:24px}label{display:inline-block;margin:8px}select,input,button{font:inherit}main{display:flex;gap:20px;flex-wrap:wrap}iframe{border:1px solid #bbcbbb;width:360px;height:220px}code{overflow-wrap:anywhere}p{max-width:900px}</style><h1>Walking and carrying motion review</h1><p>Frozen actual actor painters on their real terrain. Ground marks stay fixed in world space; the camera follows the actor. Compare at natural size and magnified size. This isolated fixture does not establish full scene composition or typography.</p><p id="identity"></p><label>Actor <select id="actor">${manifest.actors.map(a=>`<option>${a}</option>`).join('')}</select></label><label>Viewport <select id="viewport">${manifest.viewports.map(([w,h])=>`<option value="${w},${h}">${w} × ${h}</option>`).join('')}</select></label><label>Direction <select id="reverse"><option value="false">Right</option><option value="true">Left</option></select></label><label>Lane / slope <input id="lane" type="range" min="0" max="1" step=".01" value=".5"></label><label>Playback speed <input id="speed" type="number" min=".25" max="4" step=".25" value="1"></label><label>Magnification <select id="zoom"><option>6</option><option>1</option><option>10</option></select></label><label><input id="reduced" type="checkbox">Reduced motion midpoint</label><label>Visit progress <input id="progress" type="range" min="0" max="1" step=".0001" value=".9"></label><button id="play">Play</button><button id="step">Step 1/30 s</button><main><section><h2>Before</h2><iframe title="Before motion" id="before"></iframe><pre id="beforeInfo"></pre></section><section><h2>After</h2><iframe title="After motion" id="after"></iframe><pre id="afterInfo"></pre></section></main><script>
 const manifest=${safeJson(manifest)},pages=${safeJson(builds.map(framePage))};document.getElementById('identity').textContent='Before '+manifest.before.ref+' · After '+manifest.after.ref;
 const ids=['actor','viewport','reverse','lane','speed','zoom','reduced','progress'],elements=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));let playing=false,last=0,raf;
 const options=()=>{const [width,height]=elements.viewport.value.split(',').map(Number);return {actor:elements.actor.value,width,height,reverse:elements.reverse.value==='true',lane:Number(elements.lane.value),zoom:Number(elements.zoom.value),reduced:elements.reduced.checked,progress:Number(elements.progress.value)};};
 const frames=['before','after'].map((id,i)=>{const frame=document.getElementById(id);frame.srcdoc=pages[i];return frame;});
 function draw(overrides={}){const value={...options(),...overrides};return frames.map((frame,i)=>{if(!frame.contentWindow.paintMotion)return null;const info=frame.contentWindow.paintMotion(value);document.getElementById(i?'afterInfo':'beforeInfo').textContent=JSON.stringify(info,null,2);return info;});}
 function tick(now){if(!playing)return;const dt=last?Math.min(.1,(now-last)/1000):0;last=now;const info=draw()[1];elements.progress.value=(Number(elements.progress.value)+dt*Number(elements.speed.value)/(info?.duration||100))%1;draw();raf=requestAnimationFrame(tick);}
 function stop(){playing=false;last=0;cancelAnimationFrame(raf);document.getElementById('play').textContent='Play';}
 document.getElementById('play').onclick=()=>{if(playing){stop();return;}if(elements.reduced.checked)return;playing=true;document.getElementById('play').textContent='Pause';raf=requestAnimationFrame(tick);};
 document.getElementById('step').onclick=()=>{stop();const info=draw()[1];elements.progress.value=Math.min(1,Number(elements.progress.value)+Number(elements.speed.value)/(30*(info?.duration||100)));draw();};
 for(const element of Object.values(elements))element.oninput=()=>{if(elements.reduced.checked)stop();draw();};
 for(const frame of frames)frame.onload=()=>draw();
 window.motionHarness={manifest,drawAt:(progress,overrides={})=>{stop();elements.progress.value=progress;return draw(overrides);},captureSequence:({start=.88,frames:count=60,fps=30,speed=1,...overrides}={})=>{stop();const duration=draw(overrides)[1]?.duration||100;return Array.from({length:count},(_,index)=>{const progress=Math.min(1,start+index*speed/(fps*duration));const metadata=draw({...overrides,progress});return {index,progress,metadata,images:frames.map(frame=>frame.contentDocument.querySelector('canvas').toDataURL('image/png'))};});}};
 <\/script></html>`;
 const htmlPath=path.join(outputDir,'motion-review.html'),manifestPath=path.join(outputDir,'manifest.json');fs.writeFileSync(htmlPath,html);fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');return {htmlPath,manifestPath};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [repository,beforeRef,afterRef,outputDir]=process.argv.slice(2);if(!outputDir)throw new Error('Usage: node scripts/motion-review-harness.mjs <repo> <before-sha> <after-sha|WORKTREE> <output-dir>');
 console.log(JSON.stringify(writeMotionReview({repository,beforeRef,afterRef,outputDir})));
}
